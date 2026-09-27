// Recipe book: list with search + category filters, import from a link or pasted text, review/edit screen, detail page.

import { $, $$, esc, icon, toast, n0, n1, parseNum, local, today, uid } from './util.js';
import * as store from './store.js';
import { push, page, sheet, confirmSheet, chooseSheet } from './nav.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { parseIngredient, splitRecipeText, extractLinks, shortTitle, UNIT_LABEL } from './food-parse.js';
import { bestMatch, toGrams } from './food-db.js';
import { recipeTotals, perServing, macrosFor, ingredientStatus } from './food-calc.js';
import { CATEGORIES, suggestCategories, catLabel } from './food-cats.js';
import { getIndex, snap, rememberMatch, remembered, pickFood, macroLine, img, MEALS, mealLabel } from './food-ui.js';

// ---------- fetch-recipe endpoint ----------
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const importEndpoint = () => (isLocal ? 'http://localhost:5191' : SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/fetch-recipe` : null);

async function fetchLink(url) {
  const ep = importEndpoint();
  if (!ep) throw new Error("Link import isn't set up yet — paste the recipe text instead.");
  const headers = { 'Content-Type': 'application/json' };
  if (!isLocal) {
    let token = SUPABASE_KEY;
    try { const s = await store.client?.auth.getSession(); if (s?.data?.session?.access_token) token = s.data.session.access_token; } catch { /* offline */ }
    headers.apikey = SUPABASE_KEY;
    headers.Authorization = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 35000);
  let r;
  try {
    r = await fetch(ep, { method: 'POST', headers, body: JSON.stringify({ url }), signal: ctrl.signal });
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? 'That took too long. Try again, or paste the text instead.'
      : isLocal ? 'The local import helper is not running (node scripts/food-dev-proxy.js).' : 'No connection to the import service. Check your internet.');
  } finally { clearTimeout(t); }
  let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (r.status === 401 || r.status === 403) throw new Error('Log in (Me tab) to import links — or paste the recipe text instead.');
  if (!r.ok || !j) throw new Error(j?.error || `Import failed (${r.status}).`);
  return j;
}

// ---------- building a draft ----------
function linesToIngredients(lines) {
  return lines.map((line) => {
    const p = parseIngredient(line);
    return { raw: line, qty: p.qty, unit: p.unit, name: p.name, note: p.note, size: p.size, toTaste: p.toTaste, head: p.head, hint: p.grams ?? null };
  }).filter((i) => i.name || i.head);
}

export function draftFromFetched(j) {
  const ld = j.jsonld;
  const parsed = splitRecipeText(j.text || '');
  const useLd = ld && ld.ingredients?.length;
  const title = (ld?.title || j.title || parsed.title || '').trim();
  const d = {
    title: j.source === 'tiktok' ? (parsed.title || shortTitle(j.text) || 'TikTok recipe') : shortTitle(title) || title,
    image: j.image || ld?.image || null,
    source: { type: j.source, url: j.url, author: j.author || null },
    servings: (useLd && ld.servings) || parsed.servings || ld?.servings || 2,
    prepMin: ld?.prepMin || null,
    cookMin: ld?.cookMin || (ld?.totalMin && !ld?.prepMin ? ld.totalMin : null),
    ingredients: linesToIngredients(useLd ? ld.ingredients : parsed.ingredients),
    steps: useLd ? ld.steps : parsed.steps,
    notes: '',
    text: j.text || '',
    links: j.links || [],
    siteNutrition: ld?.nutrition || null,
  };
  if (j.source === 'youtube' && j.title) d.title = shortTitle(j.title) || j.title;
  if (!d.ingredients.length && !d.steps.length && j.text) d.notes = j.text.slice(0, 3000);
  return d;
}
export function draftFromText(text) {
  const p = splitRecipeText(text);
  return {
    title: p.title || 'My recipe', image: null, source: { type: 'text', url: extractLinks(text)[0] || null },
    servings: p.servings || 2, prepMin: null, cookMin: null,
    ingredients: linesToIngredients(p.ingredients), steps: p.steps, notes: '', text, links: [],
  };
}

// Match every ingredient to a food and compute grams (remembered choices first).
export async function matchAll(ings) {
  const index = await getIndex();
  for (const ing of ings) matchOne(index, ing);
  return ings;
}
function matchOne(index, ing) {
  if (ing.head) { ing.food = null; ing.grams = 0; return; }
  const mem = remembered(ing.name);
  if (mem) { ing.food = mem; ing.conf = 'user'; } else {
    const m = bestMatch(index, ing.name);
    ing.food = m ? snap(m.food) : null;
    ing.conf = m ? m.conf : null;
  }
  regrams(ing);
}
function regrams(ing) {
  if (!ing.food) { ing.grams = ing.toTaste ? 0 : null; ing.guess = false; return; }
  const g = toGrams({ qty: ing.qty, unit: ing.unit, size: ing.size, grams: ing.hint, toTaste: ing.toTaste, head: ing.head }, ing.food);
  ing.grams = g.grams;
  ing.guess = g.guess;
}

// ---------- import screen ----------
export function openImport({ url = '', text = '', auto = false } = {}) {
  let mode = text && !url ? 'text' : 'link';
  let busy = false;
  let error = '';
  push((el, s) => {
    const ep = importEndpoint();
    el.innerHTML = page({ title: 'Add a recipe', body: `
      <div class="seg" id="fd-mode"><button data-m="link" class="${mode === 'link' ? 'on' : ''}">From a link</button><button data-m="text" class="${mode === 'text' ? 'on' : ''}">Paste text</button><button data-m="blank" class="">Blank</button></div>
      ${mode === 'link' ? `
        <div class="card stack" style="margin-top:14px">
          <p class="small muted">Recipe website, TikTok or YouTube (also Shorts). Tip: in TikTok / YouTube tap <b>Share → Fit</b> to send it here directly.</p>
          <input id="fd-url" type="url" inputmode="url" placeholder="https://…" value="${esc(url)}" autocomplete="off">
          ${!ep ? '<p class="small error">Link import isn\'t set up yet — paste the recipe text instead.</p>' : ''}
          ${error ? `<p class="small error">${esc(error)}</p>` : ''}
          <button class="primary block" id="fd-go" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner fd-spin"></span> Reading the recipe…' : 'Import'}</button>
        </div>
        <div class="fd-sources"><span>${icon('food')} Websites</span><span>♪ TikTok</span><span>▶ YouTube</span></div>`
      : `<div class="card stack" style="margin-top:14px">
          <p class="small muted">Paste a recipe (e.g. an Instagram caption). Ingredients and steps are found automatically — you can fix everything on the next screen.</p>
          <textarea id="fd-text" rows="12" placeholder="Makaron z kurczakiem&#10;Składniki:&#10;200 g makaronu&#10;…">${esc(text)}</textarea>
          <button class="primary block" id="fd-parse">Continue</button></div>`}` });
    $$('#fd-mode button', el).forEach((b) => { b.onclick = () => {
      if (b.dataset.m === 'blank') { s.close(); setTimeout(() => editRecipe({ title: '', servings: 2, ingredients: [], steps: [], source: { type: 'manual' } }), 260); return; }
      mode = b.dataset.m; error = ''; s.render();
    }; });
    const go = $('#fd-go', el);
    if (go) {
      $('#fd-url', el).oninput = (e) => { url = e.target.value; };
      go.onclick = async () => {
        url = $('#fd-url', el).value.trim();
        const found = extractLinks(url)[0] || (/^[\w.-]+\.[a-z]{2,}\//i.test(url) ? `https://${url}` : null);
        if (!found) { error = 'Paste a link that starts with https://'; s.render(); return; }
        busy = true; error = ''; s.render();
        try {
          const j = await fetchLink(found);
          const d = draftFromFetched(j);
          await matchAll(d.ingredients);
          busy = false;
          s.close();
          setTimeout(() => editRecipe(d), 260);
        } catch (e) {
          busy = false; error = e.message; s.render();
        }
      };
      // Shared from another app: start right away.
      if (auto && url && !busy && !error) { auto = false; setTimeout(() => go.click(), 0); }
    }
    const parse = $('#fd-parse', el);
    if (parse) {
      $('#fd-text', el).oninput = (e) => { text = e.target.value; };
      parse.onclick = async () => {
        text = $('#fd-text', el).value;
        if (!text.trim()) return;
        const d = draftFromText(text);
        await matchAll(d.ingredients);
        s.close();
        setTimeout(() => editRecipe(d), 260);
      };
    }
  });
}

// ---------- review / edit ----------
function fmtQty(x) {
  const w = Math.floor(x + 1e-9);
  const f = x - w;
  const fr = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']].find(([v]) => Math.abs(f - v) < 0.02);
  if (f < 0.02) return String(w);
  if (fr) return `${w || ''}${fr[1]}`;
  return String(Math.round(x * 100) / 100).replace('.', ',');
}
const confLabel = { user: 'Your choice', high: 'Good match', medium: 'Check', low: 'Unsure' };
function qtyTxt(ing) {
  if (ing.qty == null && !ing.unit) return '';
  const q = ing.qty == null ? '' : fmtQty(ing.qty);
  return `${q}${ing.unit ? ` ${UNIT_LABEL[ing.unit] || ing.unit}` : ''}`;
}

export function editRecipe(draft, { id = null } = {}) {
  const r = JSON.parse(JSON.stringify(draft));
  r.ingredients ||= [];
  r.steps ||= [];
  if (!r.cats) r.cats = suggestCategories({ title: r.title, ingredients: r.ingredients, steps: r.steps });
  let showText = false;
  push((el, s) => {
    const t = recipeTotals(r.ingredients);
    const ps = perServing(t, r.servings);
    el.innerHTML = page({ title: id ? 'Edit recipe' : 'Review recipe', right: '<button class="primary" id="fd-save">Save</button>', body: `
      <div class="fd-edit-hero">${img(r.image, 'fd-hero-img')}
        ${r.image ? '<button class="icon-btn fd-img-x" id="fd-noimg" aria-label="Remove photo">' + icon('close') + '</button>' : ''}</div>
      <div class="form" style="margin-top:12px">
        <label>Title<input id="fd-title" value="${esc(r.title)}" placeholder="Recipe name"></label>
        <div class="fd-3"><label>Servings<input id="fd-serv" inputmode="numeric" value="${esc(r.servings)}"></label>
        <label>Prep (min)<input id="fd-prep" inputmode="numeric" value="${esc(r.prepMin ?? '')}"></label>
        <label>Cook (min)<input id="fd-cook" inputmode="numeric" value="${esc(r.cookMin ?? '')}"></label></div>
      </div>
      <div class="card fd-totals" id="fd-tot" style="margin-top:14px">${totalsHtml(t, ps, r)}</div>

      <h3 class="section-title">Ingredients</h3>
      <div class="card fd-ings">${r.ingredients.length ? r.ingredients.map((ing, i) => ingRow(ing, i)).join('') : '<p class="small muted">No ingredients yet.</p>'}
        <div class="fd-addline"><input id="fd-newline" placeholder="Add: e.g. 200 g ryżu" autocomplete="off"><button class="icon-btn" id="fd-addbtn" aria-label="Add">${icon('plus')}</button></div>
      </div>
      <p class="tiny muted" style="margin:8px 4px 0">Tap a food to change the match — your choice is remembered for future recipes.</p>

      <h3 class="section-title">Steps</h3>
      <textarea id="fd-steps" rows="${Math.min(14, Math.max(4, r.steps.length * 2 + 1))}" placeholder="One step per line">${esc(r.steps.join('\n'))}</textarea>

      <h3 class="section-title">Categories</h3>
      <div class="card stack-sm">${Object.entries(CATEGORIES).map(([dim, c]) => `<div><p class="tiny muted" style="margin-bottom:6px">${esc(c.label)}</p>
        <div class="fd-chipwrap">${c.items.map((it) => `<button class="chip ${r.cats[dim]?.includes(it.key) ? 'on' : ''}" data-dim="${dim}" data-key="${it.key}">${esc(it.label)}</button>`).join('')}</div></div>`).join('')}</div>

      <h3 class="section-title">Notes & source</h3>
      <div class="form">
        <textarea id="fd-notes" rows="3" placeholder="Your notes">${esc(r.notes || '')}</textarea>
        <label>Source link<input id="fd-src" type="url" value="${esc(r.source?.url || '')}" placeholder="https://…"></label>
        ${r.links?.length ? `<div class="card flat small">Links in the description:${r.links.map((l) => `<div class="row between" style="margin-top:6px"><span class="ellipsis grow">${esc(l)}</span><button class="link" data-link="${esc(l)}">Import</button></div>`).join('')}</div>` : ''}
        ${r.text ? `<button class="link small" id="fd-showtext" style="text-align:left">${showText ? 'Hide' : 'Show'} the original text</button>${showText ? `<pre class="fd-orig">${esc(r.text)}</pre>` : ''}` : ''}
      </div>
      ${id ? '<button class="ghost danger-text block" id="fd-delete" style="margin-top:22px">Delete recipe</button>' : ''}` });

    const refreshTotals = () => {
      const t2 = recipeTotals(r.ingredients);
      $('#fd-tot', el).innerHTML = totalsHtml(t2, perServing(t2, r.servings), r);
    };
    $('#fd-title', el).oninput = (e) => { r.title = e.target.value; };
    $('#fd-serv', el).oninput = (e) => { r.servings = Math.max(1, parseNum(e.target.value) || 1); refreshTotals(); };
    $('#fd-prep', el).oninput = (e) => { r.prepMin = parseNum(e.target.value); };
    $('#fd-cook', el).oninput = (e) => { r.cookMin = parseNum(e.target.value); };
    $('#fd-steps', el).oninput = (e) => { r.steps = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); };
    $('#fd-notes', el).oninput = (e) => { r.notes = e.target.value; };
    $('#fd-src', el).oninput = (e) => { r.source = { ...(r.source || {}), url: e.target.value.trim() || null }; };
    $('#fd-noimg', el)?.addEventListener('click', () => { r.image = null; s.render(); });
    $('#fd-showtext', el)?.addEventListener('click', () => { showText = !showText; s.render(); });
    $$('[data-link]', el).forEach((b) => { b.onclick = () => openImport({ url: b.dataset.link }); });
    $$('.chip[data-dim]', el).forEach((b) => { b.onclick = () => {
      const list = (r.cats[b.dataset.dim] ||= []);
      const i = list.indexOf(b.dataset.key);
      if (i >= 0) list.splice(i, 1); else list.push(b.dataset.key);
      b.classList.toggle('on', i < 0);
    }; });
    // grams inputs
    $$('.fd-g', el).forEach((inp) => { inp.oninput = () => {
      const ing = r.ingredients[+inp.dataset.i];
      ing.grams = parseNum(inp.value);
      ing.guess = false;
      const row = inp.closest('.fd-ing');
      row.querySelector('.fd-ing-k').textContent = ing.food && ing.grams != null ? `${n0(macrosFor(ing.food, ing.grams).kcal)} kcal` : '';
      row.classList.toggle('warn', ingredientStatus(ing) === 'nofood' || ingredientStatus(ing) === 'nograms');
      refreshTotals();
    }; });
    $$('[data-food]', el).forEach((b) => { b.onclick = async () => {
      const ing = r.ingredients[+b.dataset.food];
      const f = await pickFood({ title: 'Match ingredient', query: ing.name, hint: `“${ing.raw}”` });
      if (!f) return;
      ing.food = snap(f);
      ing.conf = 'user';
      regrams(ing);
      rememberMatch(ing.name, f);
      s.render();
    }; });
    $$('[data-menu]', el).forEach((b) => { b.onclick = async () => {
      const i = +b.dataset.menu;
      const ing = r.ingredients[i];
      const v = await chooseSheet(ing.raw || ing.name, [
        { value: 'edit', label: 'Edit line', icon: 'edit' },
        ...(ing.food ? [{ value: 'unmatch', label: 'Don\'t count this ingredient', icon: 'close' }] : []),
        { value: 'up', label: 'Move up', icon: 'up' },
        { value: 'del', label: 'Delete', icon: 'trash', danger: true },
      ]);
      if (v === 'edit') {
        const line = await promptLine(ing.raw || ing.name);
        if (line != null && line.trim()) {
          const [n] = linesToIngredients([line.trim()]);
          if (n) { r.ingredients[i] = n; await matchAll([n]); }
        }
      } else if (v === 'unmatch') { ing.food = null; ing.conf = null; ing.grams = null; ing.toTaste = true; }
      else if (v === 'up' && i > 0) { [r.ingredients[i - 1], r.ingredients[i]] = [r.ingredients[i], r.ingredients[i - 1]]; }
      else if (v === 'del') r.ingredients.splice(i, 1);
      s.render();
    }; });
    const addLine = async () => {
      const inp = $('#fd-newline', el);
      const line = inp.value.trim();
      if (!line) return;
      const n = linesToIngredients([line]);
      await matchAll(n);
      r.ingredients.push(...n);
      s.render();
      setTimeout(() => $('#fd-newline', el)?.focus(), 50);
    };
    $('#fd-addbtn', el).onclick = addLine;
    $('#fd-newline', el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } };
    $('#fd-save', el).onclick = async () => {
      if (!r.title.trim()) { toast('Give the recipe a name'); $('#fd-title', el).focus(); return; }
      const t2 = recipeTotals(r.ingredients);
      const item = {
        ...(id ? { id } : {}), title: r.title.trim(), image: r.image || null, source: r.source || null, servings: r.servings || 1,
        prepMin: r.prepMin || null, cookMin: r.cookMin || null,
        ingredients: r.ingredients.map(({ raw, qty, unit, name, note, size, toTaste, head, hint, food, conf, grams, guess }) =>
          ({ raw, qty, unit, name, note, size, toTaste, head, hint, food, conf, grams, guess })),
        steps: r.steps, notes: r.notes || '', cats: r.cats, text: (r.text || '').slice(0, 5000), siteNutrition: r.siteNutrition || null,
        totals: { kcal: t2.kcal, p: t2.p, c: t2.c, f: t2.f, grams: t2.grams, missing: t2.missing },
        created: draft.created || new Date().toISOString(),
      };
      const saved = await store.put('recipe', item);
      toast(id ? 'Recipe saved' : 'Recipe added to your book');
      s.close();
      if (!id) setTimeout(() => openRecipe(saved.id), 260);
    };
    $('#fd-delete', el)?.addEventListener('click', async () => {
      if (await confirmSheet('Delete this recipe?', { ok: 'Delete', danger: true })) {
        await store.remove(id);
        toast('Recipe deleted');
        history.go(-2);
      }
    });
  });
}

function totalsHtml(t, ps, r) {
  const site = r.siteNutrition?.kcal ? `<p class="tiny muted" style="margin-top:6px">The website says ${n0(r.siteNutrition.kcal)} kcal${r.siteNutrition.protein ? `, ${n0(r.siteNutrition.protein)} g protein` : ''} per serving.</p>` : '';
  return `<div class="row between"><div><p class="tiny muted">Per serving</p><div class="fd-big">${n0(ps.kcal)} <span>kcal</span></div></div>
    <div class="fd-pcf"><span class="fd-p">P ${n0(ps.p)}</span><span class="fd-c">C ${n0(ps.c)}</span><span class="fd-f">F ${n0(ps.f)}</span></div></div>
    <p class="tiny muted" style="margin-top:6px">Whole recipe: ${n0(t.kcal)} kcal · ${n0(t.grams)} g · ${n0(ps.grams)} g per serving</p>
    ${t.missing ? `<p class="fd-warn small">${icon('info')} ${t.missing} ingredient${t.missing > 1 ? 's are' : ' is'} not counted — match ${t.missing > 1 ? 'them' : 'it'} or set grams.</p>` : ''}${site}`;
}

function ingRow(ing, i) {
  if (ing.head) {
    return `<div class="fd-ing fd-head"><b>${esc(ing.name)}</b><button class="icon-btn fd-more" data-menu="${i}" aria-label="More">${icon('more')}</button></div>`;
  }
  const st = ingredientStatus(ing);
  const warn = st === 'nofood' || st === 'nograms';
  const conf = ing.food ? (ing.conf || 'medium') : 'none';
  const k = ing.food && ing.grams != null ? `${n0(macrosFor(ing.food, ing.grams).kcal)} kcal` : '';
  return `<div class="fd-ing ${warn ? 'warn' : ''}">
    <div class="row" style="align-items:flex-start;gap:6px">
      <div class="grow"><div class="fd-ing-line"><b>${esc(qtyTxt(ing))}</b> ${esc(ing.name)}${ing.note ? ` <span class="muted">(${esc(ing.note)})</span>` : ''}</div></div>
      <button class="icon-btn fd-more" data-menu="${i}" aria-label="More">${icon('more')}</button>
    </div>
    <div class="fd-ing-match">
      <button class="fd-foodbtn conf-${conf}" data-food="${i}">
        <span class="fd-dot"></span><span class="ellipsis">${ing.food ? esc(ing.food.name) : ing.toTaste ? 'Not counted (to taste) — tap to match' : 'No match — tap to choose'}</span>
        ${ing.food ? `<span class="fd-conf">${confLabel[conf] || ''}</span>` : ''}</button>
      ${ing.food ? `<label class="fd-gwrap"><input class="fd-g" data-i="${i}" inputmode="decimal" value="${ing.grams ?? ''}" placeholder="?">g</label>` : ''}
    </div>
    <div class="row between tiny"><span class="${ing.guess ? 'fd-guess' : 'muted'}">${ing.food && ing.grams == null ? 'Set the grams' : ing.guess ? 'Estimated weight — check' : ''}</span><span class="fd-ing-k muted">${k}</span></div>
  </div>`;
}

function promptLine(value) {
  return new Promise((resolve) => {
    let result = null;
    push((el, s) => {
      el.innerHTML = sheet({ title: 'Edit ingredient', body: `<input id="fd-line" value="${esc(value)}"><p class="tiny muted" style="margin:6px 2px 14px">e.g. “2 łyżki oliwy”, “200 g ryżu”, “1 cebula (150 g)”</p>
        <div class="sheet-actions"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">OK</button></div>` });
      const ok = () => { result = $('#fd-line', el).value; s.close(); };
      $('[data-a=ok]', el).onclick = ok;
      $('#fd-line', el).onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      $('[data-a=no]', el).onclick = () => s.close();
      setTimeout(() => $('#fd-line', el).focus(), 250);
    }, { sheet: true, onClose: () => resolve(result) });
  });
}

// ---------- detail ----------
export const recipePer = (rec) => perServing(rec.totals || recipeTotals(rec.ingredients || []), rec.servings);

export function openRecipe(id) {
  push((el, s) => {
    const rec = store.get(id);
    if (!rec) { el.innerHTML = page({ title: 'Recipe', body: '<div class="empty">This recipe was deleted.</div>' }); return; }
    const ps = recipePer(rec);
    const t = rec.totals || recipeTotals(rec.ingredients);
    const time = (rec.prepMin || 0) + (rec.cookMin || 0);
    const src = rec.source?.url ? (() => { try { return new URL(rec.source.url).hostname.replace(/^www\./, ''); } catch { return 'source'; } })() : null;
    const cats = Object.entries(rec.cats || {}).flatMap(([dim, keys]) => (keys || []).map((k) => catLabel(dim, k)));
    el.innerHTML = page({ title: rec.title, right: `<button class="icon-btn" id="fd-edit" aria-label="Edit">${icon('edit')}</button>`, body: `
      ${img(rec.image, 'fd-hero-img')}
      <h2 class="fd-rtitle">${esc(rec.title)}</h2>
      <div class="fd-meta">${time ? `<span>${icon('timer')} ${time} min</span>` : ''}<span>${icon('food')} ${rec.servings} serving${rec.servings > 1 ? 's' : ''}</span>
        ${src ? `<a href="${esc(rec.source.url)}" target="_blank" rel="noopener noreferrer">${esc(rec.source.type === 'tiktok' ? 'TikTok' : rec.source.type === 'youtube' ? 'YouTube' : src)}${rec.source.author ? ` · ${esc(rec.source.author)}` : ''}</a>` : ''}</div>
      ${cats.length ? `<div class="fd-chipwrap" style="margin:10px 0 0">${cats.map((c) => `<span class="pill">${esc(c)}</span>`).join('')}</div>` : ''}
      <div class="card fd-totals" style="margin-top:14px"><div class="row between"><div><p class="tiny muted">Per serving${ps.grams ? ` (${n0(ps.grams)} g)` : ''}</p><div class="fd-big">${n0(ps.kcal)} <span>kcal</span></div></div>
        <div class="fd-pcf"><span class="fd-p">P ${n0(ps.p)} g</span><span class="fd-c">C ${n0(ps.c)} g</span><span class="fd-f">F ${n0(ps.f)} g</span></div></div>
        ${t.missing ? `<p class="fd-warn small">${icon('info')} ${t.missing} ingredient${t.missing > 1 ? 's' : ''} not counted — tap edit to fix.</p>` : ''}
        <button class="primary block" id="fd-log" style="margin-top:14px">${icon('plus')} Log to diary</button></div>
      <h3 class="section-title">Ingredients</h3>
      <div class="card"><div class="list">${(rec.ingredients || []).map((ing) => ing.head ? `<div class="fd-li-head">${esc(ing.name)}</div>`
        : `<div class="list-item"><div class="grow"><div>${esc(ing.raw || ing.name)}</div>${ing.food ? `<div class="sub ellipsis">${esc(ing.food.name)}${ing.grams == null ? ' · <span class="fd-guess">no grams, not counted</span>' : ''}</div>` : `<div class="sub ${ing.toTaste ? 'muted' : 'fd-guess'}">not counted</div>`}</div>
          <div class="fd-li-g">${ing.food && ing.grams != null ? `${n0(ing.grams)} g<span>${n0(macrosFor(ing.food, ing.grams).kcal)} kcal</span>` : ''}</div></div>`).join('')}</div></div>
      ${rec.steps?.length ? `<h3 class="section-title">Steps</h3><ol class="fd-steps">${rec.steps.map((st) => /:$/.test(st) && st.length < 50 ? `<li class="fd-step-head">${esc(st)}</li>` : `<li>${esc(st)}</li>`).join('')}</ol>` : ''}
      ${rec.notes ? `<h3 class="section-title">Notes</h3><div class="card"><p style="white-space:pre-wrap">${esc(rec.notes)}</p></div>` : ''}` });
    $('#fd-edit', el).onclick = () => editRecipe(rec, { id });
    $('#fd-log', el).onclick = () => logRecipe(rec);
  });
}

// Log a recipe portion to the diary. Resolves after saving.
export function logRecipe(rec, { day = today(), meal = null, entry = null } = {}) {
  const ps = recipePer(rec);
  const h = new Date().getHours();
  let m = meal || entry?.meal || (h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack');
  let mode = entry?.grams && !entry?.servings ? 'grams' : 'servings';
  let amount = entry ? (mode === 'grams' ? entry.grams : entry.servings) : 1;
  return new Promise((resolve) => {
    push((el, s) => {
      el.innerHTML = sheet({ title: rec.title, body: `
        <div class="seg" id="fd-mealsel">${MEALS.map((x) => `<button data-m="${x.key}" class="${x.key === m ? 'on' : ''}">${esc(x.label)}</button>`).join('')}</div>
        <div class="form-row" style="margin-top:12px"><label>Amount<input id="fd-amt" inputmode="decimal" value="${esc(amount)}"></label>
        <label>Unit<select id="fd-mode"><option value="servings" ${mode === 'servings' ? 'selected' : ''}>serving(s)</option>${ps.grams ? `<option value="grams" ${mode === 'grams' ? 'selected' : ''}>grams</option>` : ''}</select></label></div>
        <div class="card flat" id="fd-m" style="margin:14px 0"></div>
        <div class="sheet-actions">${entry ? '<button class="ghost danger-text" data-a="del">Remove</button>' : '<button class="ghost" data-a="no">Cancel</button>'}<button class="primary" data-a="ok">${entry ? 'Save' : 'Add'}</button></div>` });
      const k = () => {
        const a = parseNum($('#fd-amt', el).value) || 0;
        return mode === 'grams' ? (ps.grams ? a / ps.grams : 0) : a;
      };
      const upd = () => { $('#fd-m', el).innerHTML = macroLine({ kcal: ps.kcal * k(), p: ps.p * k(), c: ps.c * k(), f: ps.f * k() }); };
      $$('#fd-mealsel button', el).forEach((b) => { b.onclick = () => { m = b.dataset.m; $$('#fd-mealsel button', el).forEach((x) => x.classList.toggle('on', x === b)); }; });
      $('#fd-amt', el).oninput = upd;
      $('#fd-mode', el).onchange = (e) => {
        const cur = parseNum($('#fd-amt', el).value) || 1;
        mode = e.target.value;
        $('#fd-amt', el).value = mode === 'grams' ? String(Math.round(cur * ps.grams)) : String(Math.round((cur / ps.grams) * 100) / 100);
        upd();
      };
      $('[data-a=ok]', el).onclick = async () => {
        const f = k();
        if (!(f > 0)) return;
        const a = parseNum($('#fd-amt', el).value);
        await store.put('meal', {
          ...(entry ? { id: entry.id, t: entry.t } : { t: new Date().toISOString() }), day: entry?.day || day, meal: m, label: rec.title,
          source: { type: 'recipe', id: rec.id }, servings: mode === 'servings' ? a : null, grams: mode === 'grams' ? a : null,
          per: { kcal: ps.kcal, p: ps.p, c: ps.c, f: ps.f, grams: ps.grams },
          kcal: ps.kcal * f, p: ps.p * f, c: ps.c * f, f: ps.f * f,
        });
        toast(entry ? 'Saved' : `Added to ${mealLabel(m)}`);
        s.close();
      };
      $('[data-a=no]', el)?.addEventListener('click', () => s.close());
      $('[data-a=del]', el)?.addEventListener('click', async () => { await store.remove(entry.id); toast('Removed'); s.close(); });
      upd();
    }, { sheet: true, onClose: () => resolve() });
  });
}

// ---------- recipe book (inside the Food tab) ----------
export function renderBook(box) {
  const f = local.get('fd-filter', { q: '', meal: null, technique: null, main: null });
  const all = store.all('recipe').sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const qf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
  const list = all.filter((r) => (!f.q || qf(`${r.title} ${(r.ingredients || []).map((i) => i.name).join(' ')}`).includes(qf(f.q)))
    && ['meal', 'technique', 'main'].every((d) => !f[d] || r.cats?.[d]?.includes(f[d])));
  // Only show filter chips that some recipe uses.
  const used = (dim) => CATEGORIES[dim].items.filter((it) => all.some((r) => r.cats?.[dim]?.includes(it.key)));
  const chips = (dim) => used(dim).map((it) => `<button class="chip ${f[dim] === it.key ? 'on' : ''}" data-fdim="${dim}" data-key="${it.key}">${esc(it.label)}</button>`).join('');
  const rows = ['meal', 'main', 'technique'].map(chips).filter(Boolean);
  const chipBar = () => {
    // One scrolling row when there are few filters, one row per dimension when there are many.
    const n = ['meal', 'main', 'technique'].reduce((a, d) => a + used(d).length, 0);
    return n <= 6 ? `<div class="chips">${rows.join('<span class="fd-chipsep"></span>')}</div>` : rows.map((r) => `<div class="chips">${r}</div>`).join('');
  };
  box.innerHTML = `
    <div class="row" style="gap:8px"><div class="search grow">${icon('search')}<input id="fd-rq" type="search" placeholder="Search recipes or ingredients" value="${esc(f.q)}"></div>
      <button class="primary" id="fd-import" style="padding:12px 14px">${icon('plus')} Add</button></div>
    ${all.length && rows.length ? `<div class="fd-filters">${chipBar()}</div>` : ''}
    ${!all.length ? `<div class="card empty" style="margin-top:14px">${icon('food')}<h2>Your recipe book is empty</h2>
      <p class="small" style="margin:6px 0 14px">Import from a recipe website, TikTok or YouTube — or paste the text. Macros are calculated for you.</p>
      <button class="primary" id="fd-import2">Add your first recipe</button></div>`
      : list.length ? `<div class="fd-grid">${list.map((r) => { const ps = recipePer(r); return `<button class="fd-rcard" data-rid="${r.id}">${img(r.image)}
        <div class="fd-rcard-body"><b class="fd-2l">${esc(r.title)}</b><span class="small muted">${n0(ps.kcal)} kcal · <span class="fd-p">${n0(ps.p)} g P</span></span></div></button>`; }).join('')}</div>`
      : '<div class="card empty" style="margin-top:14px">No recipes match these filters.</div>'}`;
  const inp = $('#fd-rq', box);
  let timer;
  inp.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      local.set('fd-filter', { ...f, q: inp.value });
      const pos = inp.selectionStart;
      renderBook(box);
      const ni = $('#fd-rq', box); ni.focus(); try { ni.setSelectionRange(pos, pos); } catch { /* search inputs */ }
    }, 200);
  };
  $$('[data-fdim]', box).forEach((b) => { b.onclick = () => {
    const d = b.dataset.fdim;
    local.set('fd-filter', { ...f, [d]: f[d] === b.dataset.key ? null : b.dataset.key });
    renderBook(box);
  }; });
  $$('[data-rid]', box).forEach((b) => { b.onclick = () => openRecipe(b.dataset.rid); });
  $('#fd-import', box).onclick = () => openImport();
  $('#fd-import2', box)?.addEventListener('click', () => openImport());
}

export { uid };
