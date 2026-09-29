// PRIVATE recipe-library importer. Third-party recipe text must never be committed to this (public) repo, so recipes go
// into the user's private Supabase table `records` (kind 'library'); the app syncs them like any other record.
//
//   node scripts/library/import.mjs --dry-run [--verbose] [source ...]   no Supabase; writes scripts/library/.out/library.json, prints counts + coverage
//   SUPABASE_SECRET_KEY=... node scripts/library/import.mjs [source ...]  real run (GitHub Action "Recipe library import")
//
// Input: scripts/library/sources.json = { "exclude": ["seafood"], "sources": [ { source, urls[] | collections[] (+link_pattern, limit) | mealdb_ids[] | mealdb_categories[] } ] }
//   exclude: 'seafood' (shellfish etc.), add 'fish' to drop regular fish too.
// PRIVACY: GitHub Actions logs are public, so the output has only counts and generic messages (no titles, no urls, no user data).
// --verbose (local debugging only) also prints titles/urls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText } from '../../supabase/functions/fetch-recipe/extract.js';
import { loadIndex, mealdbToRaw } from './convert.mjs';
import { recordId, sourceIdOf, excluded, jsonLdToRaw, textToRaw, buildRecipe, SOURCE_NAMES, LICENSE } from './import-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const only = args.filter((a) => !a.startsWith('--'));
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://txhcnqwrdazgaxjwabln.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const polite = () => sleep(1000 + Math.random() * 1000);
const say = (...a) => console.log(...a);

const cfg = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8'));
const EXCLUDE = cfg.exclude || ['seafood'];
const entries = (Array.isArray(cfg) ? cfg : cfg.sources).filter((e) => !only.length || only.includes(e.source));
const overrides = JSON.parse(fs.readFileSync(path.join(here, 'mealdb-overrides.json'), 'utf8'));
const ctx = loadIndex();

async function getPage(url) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetchText(url, { headers: { 'Accept-Language': 'en-GB,en;q=0.9' } }); } catch (e) {
      if (attempt >= 1) throw e;
      await sleep(3000);
    }
  }
}
async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'fitness-app-personal-recipe-import/1.0' } });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch (e) { if (attempt >= 1) throw e; await sleep(3000); }
  }
}
const text = (r) => (typeof r === 'string' ? r : r?.text ?? '');

// Recipe links on a collection page (only links matching the entry's link_pattern, same host).
async function expandCollection(url, pattern, limit) {
  const html = text(await getPage(url));
  const re = new RegExp(pattern);
  const base = new URL(url);
  const out = [];
  for (const m of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.host !== base.host || !re.test(u.pathname)) continue;
    const clean = `${u.origin}${u.pathname}`;
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= (limit || 50)) break;
  }
  return out;
}

const stats = {};
const st = (s) => (stats[s] ||= { tried: 0, ok: 0, seafood: 0, fish: 0, failed: 0, image: 0, servings: 0, time: 0, published: 0, video: 0, ingr: 0, ingrMatched: 0 });
const records = [];
const seen = new Set();

function accept(source, sourceId, raw, published) {
  const s = st(source);
  const why = excluded(raw, EXCLUDE);
  if (why) { s[why]++; if (VERBOSE) say(`  excluded (${why}): ${raw.title}`); return; }
  const key = `${source}:${sourceId}`;
  if (seen.has(key)) return;
  seen.add(key);
  raw.id = key;
  const rec = buildRecipe({ ...raw, published }, ctx);
  s.ok++;
  if (rec.image) s.image++;
  if (rec.video) s.video++;
  if (!rec.est?.servings) s.servings++;
  if (!rec.est?.time) s.time++;
  if (rec.nutrition_basis === 'published') s.published++;
  s.ingr += rec.ingredients.length;
  s.ingrMatched += rec.ingredients.filter((i) => i.conf !== 'check').length;
  records.push({ source, sourceId, data: { ...rec, key } });
  if (VERBOSE) say(`  ok ${rec.title} | ${rec.per_serving.kcal} kcal P${rec.per_serving.p} (${rec.nutrition_basis}) | checks ${rec.checks}/${rec.ingredients.length}`);
}

for (const e of entries) {
  const source = e.source;
  if (!SOURCE_NAMES[source]) { say(`unknown source in sources.json (skipped)`); continue; }
  const s = st(source);
  let n = 0;
  const fail = (why, detail) => { s.failed++; say(`${source} #${n}: ${why}`); if (VERBOSE && detail) say(`  ${detail}`); };
  if (source === 'mealdb') {
    const ids = [...(e.mealdb_ids || [])];
    for (const c of e.mealdb_categories || []) {
      try { ids.push(...((await getJson(`https://www.themealdb.com/api/json/v1/1/filter.php?c=${encodeURIComponent(c)}`)).meals || []).map((m) => m.idMeal)); } catch { say('mealdb category list failed'); }
    }
    for (const id of ids) {
      n++; s.tried++;
      try {
        const meal = (await getJson(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${id}`)).meals?.[0];
        if (!meal) { fail('not found'); continue; }
        const raw = { ...mealdbToRaw(meal, overrides[id] || {}), category: meal.strCategory };
        raw.source.license = LICENSE;
        accept(source, String(id), raw, null);
      } catch (err) { fail('fetch/convert error', err.message); }
      await polite();
    }
    continue;
  }
  let urls = [...(e.urls || [])];
  for (const c of e.collections || []) {
    try { urls.push(...await expandCollection(c, e.link_pattern || '^/recipe', e.limit)); } catch (err) { say(`${source}: collection failed`); if (VERBOSE) say(`  ${err.message}`); }
    await polite();
  }
  urls = [...new Set(urls)];
  for (const url of urls) {
    n++; s.tried++;
    try {
      const html = text(await getPage(url));
      const raw = jsonLdToRaw(html, url, source) || (e.html_fallback ? textToRaw(html, url, source) : null);
      if (!raw) { fail('no recipe data on page', url); await polite(); continue; }
      const published = raw.published;
      delete raw.published;
      accept(source, sourceIdOf(url), raw, published);
    } catch (err) { fail('fetch/convert error', `${url} ${err.message}`); }
    await polite();
  }
}

// ---------- coverage (counts only) ----------
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
say('source        tried   ok  seafood fish fail  image servings time  published ingr-matched');
for (const [k, s] of Object.entries(stats)) {
  say(`${k.padEnd(13)} ${String(s.tried).padStart(5)} ${String(s.ok).padStart(4)} ${String(s.seafood).padStart(7)} ${String(s.fish).padStart(4)} ${String(s.failed).padStart(4)}  ${pct(s.image, s.ok).padStart(5)} ${pct(s.servings, s.ok).padStart(8)} ${pct(s.time, s.ok).padStart(5)} ${pct(s.published, s.ok).padStart(9)} ${pct(s.ingrMatched, s.ingr).padStart(13)}`);
}
say(`recipes ready: ${records.length}`);

// ---------- output ----------
const now = new Date().toISOString();
if (DRY) {
  const user = '00000000-0000-0000-0000-000000000000';
  const out = records.map((r) => ({ id: recordId(user, r.source, r.sourceId), kind: 'library', data: r.data, updated_at: now, deleted: false }));
  fs.mkdirSync(path.join(here, '.out'), { recursive: true });
  fs.writeFileSync(path.join(here, '.out', 'library.json'), JSON.stringify(out));
  say('dry run: written to scripts/library/.out/library.json (nothing sent)');
} else {
  if (!KEY) { console.error('SUPABASE_SECRET_KEY is not set.'); process.exit(1); }
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  let userId = process.env.SUPABASE_USER_ID;
  if (!userId) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers });
    if (!r.ok) { console.error('Could not look up the app user via Supabase Auth admin API.'); process.exit(1); }
    const body = await r.json();
    const users = Array.isArray(body) ? body : body.users;
    if (!users?.length) { console.error('No user found in the Supabase project.'); process.exit(1); }
    userId = users[0].id;
  }
  const rows = records.map((r) => ({ id: recordId(userId, r.source, r.sourceId), user_id: userId, kind: 'library', data: r.data, updated_at: now, deleted: false }));
  let saved = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/records?on_conflict=id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows.slice(i, i + 25)) });
    if (!res.ok) { console.error(`Could not save recipes to Supabase (batch ${i / 25 + 1}, status ${res.status}).`); process.exit(1); }
    saved += Math.min(25, rows.length - i);
  }
  say(`saved ${saved} recipes to the private library`);
}
