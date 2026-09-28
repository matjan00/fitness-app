// Recipe link fetching + extraction. Plain JavaScript with no Deno/Node-specific APIs, so the same code runs in the
// Supabase Edge Function (index.ts), in the local dev proxy (scripts/food-dev-proxy.js) and in node tests.
//
//   fetchRecipe(url, { fetchImpl, hostCheck, timeoutMs, maxBytes }) → normalized result:
//     { source: 'web'|'tiktok'|'youtube', url, title, image, author, text, links: [], jsonld: null | {
//         ingredients: [], steps: [], servings, yield, prepMin, cookMin, totalMin, nutrition: { kcal, protein, carbs, fat, servingSize } | null,
//         description, keywords, category, cuisine },
//       transcript: null | string, transcriptLang: null | string }
//
//   For TikTok/YouTube, `transcript` is a best-effort fallback: the video's spoken subtitles (auto-generated
//   or not), cleaned of WebVTT timestamps/markup, used only when the caption/description text itself doesn't
//   already look like it holds a recipe (few/no "quantity + unit" lines). The app decides what to do with it.
//
// Everything below the fetch helpers is pure (string in → object out) and unit-tested in tests/food-extract.test.js.

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10000;

export class FetchError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// ---------- URL safety ----------
function ipv4Private(h) {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function isPrivateAddress(host) {
  let h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (ipv4Private(h)) return true;
  if (h.includes(':')) {
    // IPv6 literal
    if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Private(mapped[1]);
    return false;
  }
  return false;
}
export function checkUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new FetchError('That does not look like a link.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError('Only http(s) links can be imported.');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')
    || h === 'metadata.google.internal' || isPrivateAddress(h) || /^\d+$/.test(h)) {
    throw new FetchError('That address is not allowed.');
  }
  if (u.username || u.password) throw new FetchError('Links with passwords are not allowed.');
  return u;
}

export function classify(url) {
  const h = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, '');
  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
  if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h === 'youtube-nocookie.com') return 'youtube';
  if (h === 'instagram.com' || h.endsWith('.instagram.com')) return 'instagram';
  return 'web';
}

export function youtubeId(url) {
  const u = new URL(url);
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (u.searchParams.get('v')) return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

// ---------- fetching ----------
async function readCapped(res, maxBytes) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new FetchError('That page is too big to import.', 413);
  if (!res.body || !res.body.getReader) {
    const t = await res.text();
    if (t.length > maxBytes) throw new FetchError('That page is too big to import.', 413);
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new FetchError('That page is too big to import.', 413); }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  const ct = res.headers.get('content-type') || '';
  let charset = (ct.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
  if (!ct.match(/charset=/i)) {
    // look for <meta charset> in the first bytes
    const head = new TextDecoder('utf-8').decode(buf.slice(0, 4096));
    const m = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (m) charset = m[1];
  }
  try { return new TextDecoder(charset.toLowerCase()).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

// GET with manual redirects (every hop is checked), a timeout and a size cap.
export async function fetchText(url, opts = {}) {
  const { fetchImpl = fetch, hostCheck, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, headers = {}, accept } = opts;
  let current = checkUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop < 6; hop++) {
      if (hostCheck) await hostCheck(current.hostname);
      let res;
      try {
        res = await fetchImpl(current.href, {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
            'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
            ...headers,
          },
        });
      } catch (e) {
        if (ctrl.signal.aborted) throw new FetchError('The site took too long to answer.', 504);
        throw new FetchError(`Could not reach the site (${e.message || e}).`, 502);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = checkUrl(new URL(res.headers.get('location'), current).href);
        try { await res.body?.cancel(); } catch { /* ignore */ }
        continue;
      }
      if (!res.ok) throw new FetchError(`The site answered with an error (${res.status}).`, 502);
      const text = await readCapped(res, maxBytes);
      return { url: current.href, text, contentType: res.headers.get('content-type') || '' };
    }
    throw new FetchError('Too many redirects.', 502);
  } catch (e) {
    if (ctrl.signal.aborted && !(e instanceof FetchError)) throw new FetchError('The site took too long to answer.', 504);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- text helpers ----------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  bdquo: '„', rdquo: '”', ldquo: '“', lsquo: '‘', rsquo: '’', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', times: '×', middot: '·',
  bull: '•', oacute: 'ó', Oacute: 'Ó', eacute: 'é', aacute: 'á', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', copy: '©', reg: '®',
  trade: '™', shy: '', zwj: '', zwnj: '', ccedil: 'ç', egrave: 'è', iacute: 'í', ntilde: 'ñ', uacute: 'ú' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m; } catch { return m; }
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}
// HTML fragment → plain text with line breaks for block elements.
export function htmlToText(html) {
  let s = String(html ?? '');
  s = s.replace(/<(script|style|noscript|svg|iframe|template|head)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|ul|ol|blockquote|figure|table)>/gi, '\n');
  s = s.replace(/<(p|div|h[1-6]|tr|section|article|ul|ol|blockquote|table)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter((l, i, arr) => l || (arr[i - 1] && arr[i - 1].trim()))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const clean = (s) => htmlToText(s).replace(/\s*\n\s*/g, ' ').trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}
function metaContent(html, keys) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const k of keys) {
    for (const t of tags) {
      const n = (attr(t, 'property') || attr(t, 'name') || attr(t, 'itemprop') || '').toLowerCase();
      if (n === k) {
        const c = attr(t, 'content');
        if (c) return c.trim();
      }
    }
  }
  return null;
}

// ---------- JSON-LD ----------
function lenientJson(raw) {
  const txt = String(raw).trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/^\s*\/\/.*$/gm, '');
  try { return JSON.parse(txt); } catch { /* try harder */ }
  try {
    // control characters inside strings and trailing commas are common on WordPress sites
    return JSON.parse(txt.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1'));
  } catch { return null; }
}
const typeIs = (o, t) => {
  const ty = o && o['@type'];
  return Array.isArray(ty) ? ty.some((x) => String(x).toLowerCase() === t) : String(ty || '').toLowerCase() === t;
};
function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipe(n, depth + 1); if (r) return r; }
    return null;
  }
  if (typeIs(node, 'recipe')) return node;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'hasPart']) {
    if (node[k]) { const r = findRecipe(node[k], depth + 1); if (r) return r; }
  }
  return null;
}
export function findJsonLdRecipe(html) {
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const data = lenientJson(m[1]);
    const r = findRecipe(data);
    if (r) return r;
  }
  return null;
}

function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return clean(String(v));
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (typeof v === 'object') return asText(v.name ?? v.text ?? v['@value'] ?? '');
  return '';
}
function imageUrl(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const x of v) { const u = imageUrl(x); if (u) return u; }
    return null;
  }
  return v.url || v.contentUrl || v['@id'] || null;
}
export function flattenInstructions(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string') {
    const t = htmlToText(v);
    t.split(/\n+/).map((x) => x.replace(/^•\s*/, '').trim()).filter(Boolean).forEach((x) => out.push(x));
    return out;
  }
  if (Array.isArray(v)) { v.forEach((x) => flattenInstructions(x, out)); return out; }
  if (typeof v === 'object') {
    if (typeIs(v, 'howtosection') || v.itemListElement) {
      if (v.name) out.push(`${clean(v.name).replace(/:$/, '')}:`);
      flattenInstructions(v.itemListElement, out);
      return out;
    }
    const t = v.text ?? v.name ?? v.description;
    if (t) flattenInstructions(String(t), out);
  }
  return out;
}
export function durationMin(v) {
  if (v == null || v === '') return null;
  const m = String(v).trim().match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; }
  const min = (Number(m[4] || 0) * 1440) + (Number(m[5] || 0) * 60) + Number(m[6] || 0) + Number(m[7] || 0) / 60;
  return min > 0 ? Math.round(min) : null;
}
const firstNum = (v) => {
  const m = String(v ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
function servingsOf(y) {
  if (y == null) return null;
  const list = Array.isArray(y) ? y : [y];
  for (const x of list) {
    const n = firstNum(x);
    if (n && n > 0 && n <= 100) return Math.round(n);
  }
  return null;
}

export function normalizeJsonLd(r) {
  const n = r.nutrition && typeof r.nutrition === 'object' ? r.nutrition : null;
  const nutrition = n ? {
    kcal: firstNum(n.calories), protein: firstNum(n.proteinContent), carbs: firstNum(n.carbohydrateContent), fat: firstNum(n.fatContent),
    servingSize: asText(n.servingSize) || null,
  } : null;
  let ingredients = r.recipeIngredient ?? r.ingredients ?? [];
  if (typeof ingredients === 'string') ingredients = ingredients.split(/\n|<br\s*\/?>/i);
  ingredients = (Array.isArray(ingredients) ? ingredients : [ingredients]).map((x) => clean(typeof x === 'string' ? x : asText(x))).filter(Boolean);
  return {
    title: clean(r.name || r.headline || ''),
    image: imageUrl(r.image),
    author: asText(r.author) || null,
    description: clean(r.description || ''),
    ingredients,
    steps: flattenInstructions(r.recipeInstructions),
    servings: servingsOf(r.recipeYield ?? r.yield),
    yield: asText(r.recipeYield) || null,
    prepMin: durationMin(r.prepTime),
    cookMin: durationMin(r.cookTime),
    totalMin: durationMin(r.totalTime),
    nutrition: nutrition && (nutrition.kcal || nutrition.protein) ? nutrition : null,
    keywords: asText(r.keywords) || null,
    category: asText(r.recipeCategory) || null,
    cuisine: asText(r.recipeCuisine) || null,
  };
}

// Inner HTML of the element whose opening tag ends at `from` (nesting-aware for the same tag name).
function innerOf(html, from, name, max = 200000) {
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m.index - from > max) return null;
    if (/\/>$/.test(m[0])) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return null;
}
const VOID = new Set(['meta', 'link', 'img', 'input', 'br', 'hr', 'source']);

// Microdata (itemprop="recipeIngredient") for older sites without JSON-LD.
function microdata(html) {
  const grab = (prop) => {
    const out = [];
    const re = new RegExp(`<(\\w+)\\b[^>]*itemprop\\s*=\\s*["'](?:[^"']*\\s)?${prop}(?:\\s[^"']*)?["'][^>]*>`, 'gi');
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0];
      const content = attr(tag, 'content');
      if (content != null) { out.push(content); continue; }
      const name = m[1].toLowerCase();
      if (VOID.has(name)) continue;
      const inner = innerOf(html, re.lastIndex, name);
      if (inner != null) out.push(inner);
    }
    return out;
  };
  const ingredients = [...grab('recipeIngredient'), ...grab('ingredients')].map(clean).filter(Boolean);
  if (!ingredients.length) return null;
  // Instructions are often a whole blog article: keep the paragraphs after a "how to" heading if there is one.
  let lines = grab('recipeInstructions').flatMap((h) => htmlToText(h).split('\n')).map((l) => l.replace(/^•\s*/, '').trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^(przepis na|sposób przygotowania|sposob przygotowania|przygotowanie|wykonanie|instructions|method|directions)\b/i.test(l) && l.length < 60);
  if (start >= 0) lines = lines.slice(start + 1);
  const steps = lines.filter((l) => l.length > 40).slice(0, 40);
  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  return {
    ingredients, steps, servings: servingsOf(grab('recipeYield')[0]), title: clean(h1 || ''),
    prepMin: durationMin(grab('prepTime')[0]), cookMin: durationMin(grab('cookTime')[0]), totalMin: durationMin(grab('totalTime')[0]),
    category: clean(grab('recipeCategory')[0] || '') || null, keywords: clean(grab('keywords')[0] || '') || null,
  };
}

// Main readable text of a page (for sites without structured data): prefer <article>/<main>.
export function mainText(html, max = 20000) {
  const body = (html.match(/<article\b[\s\S]*?<\/article>/i) || html.match(/<main\b[\s\S]*?<\/main>/i) || html.match(/<body\b[\s\S]*<\/body>/i) || [html])[0];
  const stripped = body.replace(/<(nav|footer|header|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  let t = htmlToText(stripped);
  // Menus often contain a "Składniki" category list — start at the ingredients heading that is actually
  // followed by quantities ("2 szklanki mąki", "200 g …").
  const lines = t.split('\n');
  const qty = /^(?:•\s*)?(?:\d|½|¼|¾|pół\b|szczypta|garść)|\b\d+\s*(?:g|kg|ml|l|dag|szklank\w*|łyż\w*|tbsp|tsp|cups?|oz)\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (!/^(składniki|skladniki|ingredients?)\b/i.test(lines[i].trim()) || lines[i].length > 40) continue;
    const next = lines.slice(i + 1, i + 14).map((l) => l.trim()).filter((l) => l && l !== '•');
    if (next.filter((l) => qty.test(l)).length >= 2) { t = lines.slice(i).join('\n'); break; }
  }
  return t.length > max ? t.slice(0, max) : t;
}

export function extractFromHtml(html, url) {
  const ld = findJsonLdRecipe(html);
  const jsonld = ld ? normalizeJsonLd(ld) : null;
  const md = !jsonld ? microdata(html) : null;
  const siteless = (t) => {
    const s = String(t || '').replace(/\s+[|–—·•-]\s+[^|–—·•]{2,40}$/, '').trim();
    return s.length >= 3 ? s : String(t || '').trim();
  };
  const title = jsonld?.title || md?.title || siteless(metaContent(html, ['og:title', 'twitter:title'])
    || clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''));
  let image = jsonld?.image || metaContent(html, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']);
  if (image) { try { image = new URL(image, url).href; } catch { image = null; } }
  const author = jsonld?.author || metaContent(html, ['author', 'article:author', 'og:site_name']);
  const description = jsonld?.description || metaContent(html, ['og:description', 'description', 'twitter:description']) || '';
  const text = jsonld ? description : mainText(html);
  return {
    source: 'web', url, title: title || '', image: image || null, author: author || null, text,
    jsonld: jsonld || (md ? { image: null, author: null, description: '', yield: null, nutrition: null, cuisine: null, ...md } : null),
  };
}

// ---------- YouTube ----------
// Extract a JSON object literal assigned after `marker` (brace matching aware of strings).
export function jsonAfter(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i + marker.length);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } } }
  }
  return null;
}
export function parseYouTube(html, url) {
  const pr = jsonAfter(html, 'ytInitialPlayerResponse = ') || jsonAfter(html, 'ytInitialPlayerResponse=') || jsonAfter(html, '"playerResponse":');
  const vd = pr?.videoDetails;
  const thumbs = vd?.thumbnail?.thumbnails || [];
  let title = vd?.title || metaContent(html, ['og:title', 'title']) || '';
  let description = vd?.shortDescription || '';
  if (!description) {
    const mf = pr?.microformat?.playerMicroformatRenderer;
    description = mf?.description?.simpleText || (vd ? '' : metaContent(html, ['og:description', 'description'])) || '';
  }
  // YouTube's generic site description is not the video's
  if (/^(W YouTube możesz|Enjoy the videos and music you love|Auf YouTube findest du)/.test(description)) description = '';
  const id = vd?.videoId || (url ? youtubeId(url) : null);
  const image = (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null) || thumbs[thumbs.length - 1]?.url || metaContent(html, ['og:image']);
  return { source: 'youtube', url, title: decodeEntities(title), image, author: vd?.author || null, text: description, jsonld: null };
}

// ---------- TikTok ----------
export function parseTikTokOembed(json) {
  return { title: json?.title || '', author: json?.author_name || null, image: json?.thumbnail_url || null };
}
// Fallback when oEmbed fails: the page embeds its data as JSON.
export function parseTikTokHtml(html) {
  const data = jsonAfter(html, 'id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">')
    || jsonAfter(html, '<script id="SIGI_STATE" type="application/json">');
  let desc = '', author = null, image = null;
  const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
  if (item) { desc = item.desc || ''; author = item.author?.nickname || item.author?.uniqueId || null; image = item.video?.cover || null; }
  if (!desc && data?.ItemModule) {
    const first = Object.values(data.ItemModule)[0];
    if (first) { desc = first.desc || ''; author = first.nickname || first.author || null; }
  }
  if (!desc) desc = metaContent(html, ['og:description', 'description']) || '';
  return { title: desc, author, image: image || metaContent(html, ['og:image']) };
}

// ---------- subtitles / transcript (fallback when the caption/description has no recipe) ----------

// Rough check: does this text already contain at least two "quantity + unit" ingredient-shaped lines?
// (A lighter-weight cousin of the app's own parser — good enough to decide whether a video needs its
// spoken subtitles fetched at all; the app makes the final call with the full parser.)
const QTY_UNIT_RE = /\b\d+[.,]?\d*\s*(?:g|gr|gram\w*|kg|dag|dkg|ml|l|litr\w*|łyż\w*|szklank\w*|szt\w*|ząb\w*|ząb\w*|cup|cups|tbsp|tsp|oz|lb|garś\w*|garsc\w*|szczypt\w*|pinch\w*)\b/giu;
export function looksLikeRecipe(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  const hits = s.match(QTY_UNIT_RE) || [];
  return hits.length >= 2;
}

// WebVTT (or near-VTT) → clean prose: drops the header, cue numbers, timestamp lines and inline tags,
// and collapses rolling/cumulative auto-caption lines (each new line repeating the previous one plus a
// few more words) down to the longest version of each.
export function cleanVtt(vtt) {
  const lines = String(vtt || '').replace(/\r/g, '').split('\n');
  const kept = [];
  for (let raw of lines) {
    let l = raw.trim();
    if (!l) continue;
    if (/^WEBVTT\b/i.test(l)) continue;
    if (/^(NOTE|STYLE|REGION|Kind|Language)\b/i.test(l)) continue;
    if (/^\d+$/.test(l)) continue; // cue number
    if (/^\d{2}(:\d{2}){1,2}[.,]\d{3}\s*-->/.test(l)) continue; // timestamp line (with optional cue settings)
    l = decodeEntities(l.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (l) kept.push(l);
  }
  const merged = [];
  for (const l of kept) {
    const last = merged[merged.length - 1];
    if (last && (l.startsWith(last) || last.startsWith(l))) merged[merged.length - 1] = l.length > last.length ? l : last;
    else merged.push(l);
  }
  return merged.join(' ').replace(/\s+/g, ' ').trim();
}

// YouTube's default caption format (XML: <text start="…" dur="…">…</text>) — used when the ?fmt=vtt
// request comes back empty.
export function youtubeCaptionXmlToText(xml) {
  const matches = [...String(xml || '').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)];
  const lines = matches.map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const merged = [];
  for (const l of lines) {
    const last = merged[merged.length - 1];
    if (last && (l.startsWith(last) || last.startsWith(l))) merged[merged.length - 1] = l.length > last.length ? l : last;
    else merged.push(l);
  }
  return merged.join(' ').replace(/\s+/g, ' ').trim();
}

// Pick the best subtitle/caption track: Polish first, then English, then whatever is there; within a
// language, a human-written track wins over an auto-generated ("ASR"/"asr") one.
export function pickSubtitle(list, getLang, isAsr = () => false) {
  if (!Array.isArray(list) || !list.length) return null;
  const groups = [['pl', 'pol'], ['en', 'eng']];
  const inGroup = (lang, g) => g.some((p) => lang.toLowerCase().startsWith(p));
  for (const g of groups) {
    const matches = list.filter((x) => inGroup(getLang(x) || '', g));
    if (matches.length) return matches.find((x) => !isAsr(x)) || matches[0];
  }
  return list[0];
}

// TikTok video JSON → its subtitle track list (video.subtitleInfos / claSubtitleInfos), each item like
// { LanguageCodeName: 'pol-PL', Url, Format: 'webvtt', Source: 'ASR' | 'MT' | ... }.
export function tiktokSubtitleList(html) {
  const data = jsonAfter(html, 'id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">')
    || jsonAfter(html, '<script id="SIGI_STATE" type="application/json">');
  const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct
    || (data?.ItemModule && Object.values(data.ItemModule)[0]) || null;
  const list = item?.video?.subtitleInfos || item?.video?.claSubtitleInfos || [];
  return Array.isArray(list) ? list : [];
}

// YouTube watch page JSON → its caption track list (captions.playerCaptionsTracklistRenderer.captionTracks),
// each item like { baseUrl, languageCode: 'pl', kind: 'asr' | undefined, name: { simpleText } }.
export function youtubeCaptionTracks(html) {
  const pr = jsonAfter(html, 'ytInitialPlayerResponse = ') || jsonAfter(html, 'ytInitialPlayerResponse=') || jsonAfter(html, '"playerResponse":');
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

// Links in a caption/description that look like a recipe page ("Przepis: https://…")
export function recipeLinks(text) {
  return [...String(text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0].replace(/[.,;:!?]+$/, ''))
    .filter((l) => { try { return classify(l) === 'web' && !/(instagram|facebook|fb\.me|linktr\.ee|patreon|amazon|allegro|bit\.ly\/?$|t\.me|twitter|x\.com|spotify|apple\.com|shop|sklep|discord)/i.test(new URL(l).hostname + new URL(l).pathname); } catch { return false; } })
    .slice(0, 5);
}

// ---------- main ----------
export async function fetchRecipe(rawUrl, opts = {}) {
  const url = checkUrl(rawUrl).href;
  const kind = classify(url);
  if (kind === 'instagram') throw new FetchError('Instagram links are not supported — copy the caption and paste it as text instead.', 422);

  if (kind === 'youtube') {
    const id = youtubeId(url);
    if (!id) throw new FetchError('Could not find the video id in that YouTube link.', 422);
    const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=pl`;
    const page = await fetchText(watch, { ...opts, headers: { Cookie: 'SOCS=CAI; CONSENT=YES+cb.20240101-00-p0.pl+FX+000' } });
    const out = parseYouTube(page.text, `https://www.youtube.com/watch?v=${id}`);
    if (!out.title && !out.text) throw new FetchError('YouTube did not return the video details. Paste the description as text instead.', 502);
    let transcript = null, transcriptLang = null;
    if (!looksLikeRecipe(out.text)) {
      try {
        const track = pickSubtitle(youtubeCaptionTracks(page.text), (t) => t.languageCode, (t) => t.kind === 'asr');
        if (track?.baseUrl) {
          const v = await fetchText(`${track.baseUrl}&fmt=vtt`, { ...opts, maxBytes: 500000, accept: 'text/vtt,*/*' });
          let cleaned = cleanVtt(v.text);
          if (!cleaned) {
            const x = await fetchText(track.baseUrl, { ...opts, maxBytes: 500000, accept: 'text/xml,*/*' });
            cleaned = youtubeCaptionXmlToText(x.text);
          }
          if (cleaned) { transcript = cleaned; transcriptLang = track.languageCode || null; }
        }
      } catch { /* subtitles are a best-effort extra */ }
    }
    return { ...out, links: recipeLinks(out.text), transcript, transcriptLang };
  }

  if (kind === 'tiktok') {
    let final = url;
    const h = new URL(url).hostname;
    // Short links (vm.tiktok.com/…, vt.tiktok.com/…, tiktok.com/t/…) redirect to the full video URL.
    if (/^(vm|vt)\./.test(h) || /^\/t\//.test(new URL(url).pathname)) {
      try { final = (await fetchText(url, { ...opts, maxBytes: MAX_BYTES })).url; } catch (e) { if (!(e instanceof FetchError)) throw e; }
    }
    final = final.split('?')[0];
    let meta = null;
    let pageHtml = null;
    try {
      const o = await fetchText(`https://www.tiktok.com/oembed?url=${encodeURIComponent(final)}`, { ...opts, accept: 'application/json' });
      meta = parseTikTokOembed(JSON.parse(o.text));
    } catch { /* fall back to the page */ }
    if (!meta || !meta.title) {
      try {
        const page = await fetchText(final, opts);
        pageHtml = page.text;
        const p = parseTikTokHtml(pageHtml);
        meta = { title: p.title || meta?.title || '', author: p.author || meta?.author || null, image: meta?.image || p.image };
      } catch (e) { if (!meta) throw e; }
    }
    if (!meta?.title) throw new FetchError('TikTok did not return the caption. Paste it as text instead.', 502);
    let transcript = null, transcriptLang = null;
    if (!looksLikeRecipe(meta.title)) {
      try {
        if (!pageHtml) pageHtml = (await fetchText(final, opts)).text;
        const sub = pickSubtitle(tiktokSubtitleList(pageHtml), (s) => s.LanguageCodeName, (s) => s.Source === 'ASR');
        if (sub?.Url) {
          const v = await fetchText(sub.Url, { ...opts, maxBytes: 500000, accept: 'text/vtt,*/*' });
          const cleaned = cleanVtt(v.text);
          if (cleaned) { transcript = cleaned; transcriptLang = sub.LanguageCodeName || null; }
        }
      } catch { /* subtitles are a best-effort extra */ }
    }
    return { source: 'tiktok', url: final, title: '', image: meta.image, author: meta.author, text: meta.title, jsonld: null, links: recipeLinks(meta.title), transcript, transcriptLang };
  }

  const page = await fetchText(url, opts);
  const out = extractFromHtml(page.text, page.url);
  return { ...out, links: out.jsonld ? [] : recipeLinks(out.text).slice(0, 0) };
}
