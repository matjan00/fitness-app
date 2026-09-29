// Recipe book: list with search + category filters, import from a link or pasted text, review/edit screen, detail page.

import { $, $$, esc, icon, toast, n0, n1, parseNum, local, today, uid } from './util.js';
import * as store from './store.js';
import { push, page, sheet, confirmSheet, chooseSheet } from './nav.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { parseIngredient, splitRecipeText, extractLinks, shortTitle, UNIT_LABEL } from './food-parse.js';
import { bestMatch, toGrams, search as searchFoods } from './food-db.js';
import { recipeTotals, perServing, macrosFor, ingredientStatus } from './food-calc.js';
import { CATEGORIES, suggestCategories, catLabel } from './food-cats.js';
import { getIndex, snap, rememberMatch, remembered, pickFood, macroLine, img, MEALS, mealLabel } from './food-ui.js';
import { compressFile, compressRemote } from './food-photo.js';
import { practisesChipsHtml, bindPractisesChips } from './food-learn.js';
import { checkCardHtml, ingListHtml, bindEditing, foodsCached } from './food-edit-ui.js';
import { checkRecipe } from './food-check.js';
import { withTotals } from './food-copy.js';

const CAT_DIMS = ['meal', 'technique', 'main'];

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

// Only the title + cover photo are auto-filled from a link now (see editRecipe's link field) — ingredients and
// steps are always typed or pasted in by hand. `shortTitle`/`extractProseIngredients` stay in food-parse.js and
// are still used by the "paste text" helper below via splitRecipeText.

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

// ---------- manual-first "new recipe" entry ----------
// A blank draft, optionally with a source link pre-filled (title + photo are fetched inside editRecipe itself).
export function blankDraft({ url = '' } = {}) {
  const found = url ? (extractLinks(url)[0] || (/^[\w.-]+\.[a-z]{2,}\//i.test(url) ? `https://${url}` : url)) : '';
  return { title: '', servings: 2, image: null, source: found ? { type: 'link', url: found } : { type: 'manual' }, ingredients: [], steps: [], notes: '', links: [] };
}

// Open the manual "new recipe" form. `url` (e.g. from Android share) pre-fills the link field and starts the
// title+photo fetch right away. `text` (a shared caption with no link) is run through the same best-effort
// parser as the "paste text" helper, so nothing shared to the app is lost.
export async function openManual({ url = '', text = '' } = {}) {
  const d = blankDraft({ url });
  if (text && !url) {
    const p = splitRecipeText(text);
    if (p.title) d.title = p.title;
    if (p.servings) d.servings = p.servings;
    d.ingredients = linesToIngredients(p.ingredients);
    await matchAll(d.ingredients);
    d.steps = p.steps;
  }
  editRecipe(d, { autoFetchLink: !!d.source?.url });
}

// Small "paste recipe text to fill in" helper sheet — secondary to typing things in by hand.
function pasteTextSheet() {
  return new Promise((resolve) => {
    let result = null;
    push((el, s) => {
      el.innerHTML = sheet({ title: 'Paste recipe text', body: `
        <p class="small muted" style="margin:-4px 0 10px">Paste a recipe (e.g. a website listing or an Instagram caption). Ingredients and steps are found automatically — added to what you already have.</p>
        <textarea id="fd-ptext" rows="10" placeholder="Makaron z kurczakiem&#10;Składniki:&#10;200 g makaronu&#10;…"></textarea>
        <div class="sheet-actions"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">Fill in</button></div>` });
      $('[data-a=ok]', el).onclick = () => { result = $('#fd-ptext', el).value; s.close(); };
      $('[data-a=no]', el).onclick = () => s.close();
      setTimeout(() => $('#fd-ptext', el)?.focus(), 250);
    }, { sheet: true, onClose: () => resolve(result) });
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

function catsHtml(r) {
  return Object.entries(CATEGORIES).map(([dim, c]) => `<div><p class="tiny muted" style="margin-bottom:6px">${esc(c.label)}</p>
    <div class="fd-chipwrap">${c.items.map((it) => {
      const on = r.cats[dim]?.includes(it.key);
      const suggested = on && !r.catsConfirmed[dim]?.includes(it.key);
      return `<button class="chip ${on ? 'on' : ''} ${suggested ? 'suggested' : ''}" data-dim="${dim}" data-key="${it.key}" title="${suggested ? 'Suggested — tap to confirm' : ''}">${esc(it.label)}${suggested ? ' ?' : ''}</button>`;
    }).join('')}</div></div>`).join('');
}

// Merge newly-suggested category chips into r.cats, skipping anything the user already removed.
function resuggest(r) {
  const sug = suggestCategories({ title: r.title, ingredients: r.ingredients, steps: r.steps });
  for (const dim of CAT_DIMS) {
    const list = (r.cats[dim] ||= []);
    const removed = r.catsRemoved[dim] || [];
    for (const key of sug[dim]) if (!list.includes(key) && !removed.includes(key)) list.push(key);
  }
}

export function editRecipe(draft, opts = {}) {
  const id = opts.id ?? null;
  let autoFetchLink = !!opts.autoFetchLink;
  const r = JSON.parse(JSON.stringify(draft));
  r.ingredients ||= [];
  r.steps ||= [];
  if (!r.cats) r.cats = suggestCategories({ title: r.title, ingredients: r.ingredients, steps: r.steps });
  r.catsConfirmed ||= {};
  r.catsRemoved ||= {};
  // Editing an existing recipe: its saved tags were already chosen, not fresh suggestions — don't dash them.
  if (id) for (const dim of CAT_DIMS) if (!r.catsConfirmed[dim]) r.catsConfirmed[dim] = [...(r.cats[dim] || [])];
  let showText = false;
  let pendingFood = null; // a food picked from the ingredient-suggestion dropdown, for the next Add
  push((el, s) => {
    const t = recipeTotals(r.ingredients);
    const ps = perServing(t, r.servings);
    el.innerHTML = page({ title: id ? 'Edit recipe' : 'New recipe', right: '<button class="primary" id="fd-save">Save</button>', body: `
      <div class="form">
        <label>Recipe link (optional)<input id="fd-link" type="url" inputmode="url" value="${esc(r.source?.url || '')}" placeholder="https://tiktok.com/… or a recipe site" autocomplete="off"></label>
      </div>
      ${r._linkBusy ? '<p class="tiny muted"><span class="spinner fd-spin"></span> Fetching title & photo…</p>' : ''}
      ${r._linkErr && !r._linkBusy ? '<p class="tiny muted">Couldn’t get the photo — add your own.</p>' : ''}
      <div class="fd-edit-hero" style="margin-top:10px">${img(r.image, 'fd-hero-img')}
        ${r.image ? '<button class="icon-btn fd-img-x" id="fd-noimg" aria-label="Remove photo">' + icon('close') + '</button>' : ''}</div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="ghost small" id="fd-photopick">${icon('upload')} ${r.image ? 'Change photo' : 'Take / choose photo'}</button>
      </div>
      <input type="file" accept="image/*" id="fd-photofile" style="display:none">
      ${r.notice ? `<div class="card flat small" style="margin-top:12px">${icon('info')} ${esc(r.notice)}</div>` : ''}
      <div class="form" style="margin-top:12px">
        <label>Title<input id="fd-title" value="${esc(r.title)}" placeholder="Recipe name"></label>
        <div class="fd-3"><label>Servings<input id="fd-serv" inputmode="numeric" value="${esc(r.servings)}"></label>
        <label>Prep (min)<input id="fd-prep" inputmode="numeric" value="${esc(r.prepMin ?? '')}"></label>
        <label>Cook (min)<input id="fd-cook" inputmode="numeric" value="${esc(r.cookMin ?? '')}"></label></div>
      </div>
      <div class="card fd-totals" id="fd-tot" style="margin-top:14px">${totalsHtml(t, ps, r)}</div>

      <h3 class="section-title">Ingredients</h3>
      <div class="card fd-ings">${r.ingredients.length ? r.ingredients.map((ing, i) => ingRow(ing, i)).join('') : '<p class="small muted">No ingredients yet.</p>'}
        <div class="fd-addline" style="position:relative"><input id="fd-newline" placeholder="Add: e.g. 200 g ryżu" autocomplete="off"><button class="icon-btn" id="fd-addbtn" aria-label="Add">${icon('plus')}</button>
          <div id="fd-sugg" class="card fd-suggest" style="display:none"></div></div>
      </div>
      <p class="tiny muted" style="margin:8px 4px 0">Tap a food to change the match — your choice is remembered for future recipes.</p>
      <button class="link small" id="fd-pastehelp" style="margin:6px 4px 0;text-align:left">Paste recipe text to fill in</button>

      <h3 class="section-title">Steps</h3>
      <textarea id="fd-steps" rows="${Math.min(14, Math.max(4, r.steps.length * 2 + 1))}" placeholder="One step per line">${esc(r.steps.join('\n'))}</textarea>

      <h3 class="section-title">Categories</h3>
      <div class="card stack-sm" id="fd-cats">${catsHtml(r)}</div>

      <h3 class="section-title">Notes & source</h3>
      <div class="form">
        <textarea id="fd-notes" rows="3" placeholder="Your notes">${esc(r.notes || '')}</textarea>
        ${r.links?.length ? `<div class="card flat small">Links in the description:${r.links.map((l) => `<div class="row between" style="margin-top:6px"><span class="ellipsis grow">${esc(l)}</span><button class="link" data-link="${esc(l)}">Use</button></div>`).join('')}</div>` : ''}
        ${r.text ? `<button class="link small" id="fd-showtext" style="text-align:left">${showText ? 'Hide' : 'Show'} the original text</button>${showText ? `<pre class="fd-orig">${esc(r.text)}</pre>` : ''}` : ''}
      </div>
      ${id ? '<button class="ghost danger-text block" id="fd-delete" style="margin-top:22px">Delete recipe</button>' : ''}` });

    const refreshTotals = () => {
      const t2 = recipeTotals(r.ingredients);
      $('#fd-tot', el).innerHTML = totalsHtml(t2, perServing(t2, r.servings), r);
    };
    async function tryFetchLink(url) {
      r._linkFetched = url;
      r._linkBusy = true; r._linkErr = false;
      s.render();
      try {
        const j = await fetchLink(url);
        const rawTitle = (j.jsonld?.title || j.title || (j.source === 'tiktok' ? j.text : '') || '').trim();
        const t2 = shortTitle(rawTitle) || rawTitle || (j.author ? `Recipe by ${j.author}` : '');
        if (t2 && !r.title.trim()) r.title = t2;
        r.source = { type: j.source || 'link', url: j.url || url, author: j.author || null };
        const imgUrl = j.image || j.jsonld?.image || null;
        if (imgUrl) {
          const data = await compressRemote(imgUrl);
          if (data) r.image = data; else r._linkErr = true;
        }
      } catch {
        r._linkErr = true;
      } finally {
        r._linkBusy = false;
        s.render();
      }
    }
    const linkInput = $('#fd-link', el);
    linkInput.oninput = (e) => { r.source = { ...(r.source || {}), url: e.target.value.trim() || null }; };
    const tryTriggerFetch = () => {
      const raw = (r.source?.url || '').trim();
      if (!raw) return;
      const found = extractLinks(raw)[0] || (/^[\w.-]+\.[a-z]{2,}\//i.test(raw) ? `https://${raw}` : raw);
      if (found && found !== r._linkFetched) { r.source = { ...(r.source || {}), url: found }; tryFetchLink(found); }
    };
    linkInput.onblur = tryTriggerFetch;
    linkInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); tryTriggerFetch(); linkInput.blur(); } };
    linkInput.addEventListener('paste', () => setTimeout(tryTriggerFetch, 0));
    $('#fd-photopick', el).onclick = () => $('#fd-photofile', el).click();
    $('#fd-photofile', el).onchange = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = await compressFile(file);
        if (data) { r.image = data; r._linkErr = false; }
      } catch { toast('Could not use that photo'); }
      s.render();
    };
    const refreshCats = () => {
      const box = $('#fd-cats', el);
      if (!box) return;
      box.innerHTML = catsHtml(r);
      bindCatChips();
    };
    $('#fd-title', el).oninput = (e) => { r.title = e.target.value; };
    // Re-suggest tags on blur — patches just the category chips in place so it never steals focus
    // mid-click the way a full re-render would (e.g. tapping straight from Title into the next field).
    $('#fd-title', el).onblur = () => { resuggest(r); refreshCats(); };
    $('#fd-serv', el).oninput = (e) => { r.servings = Math.max(1, parseNum(e.target.value) || 1); refreshTotals(); };
    $('#fd-prep', el).oninput = (e) => { r.prepMin = parseNum(e.target.value); };
    $('#fd-cook', el).oninput = (e) => { r.cookMin = parseNum(e.target.value); };
    $('#fd-steps', el).oninput = (e) => { r.steps = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); };
    $('#fd-notes', el).oninput = (e) => { r.notes = e.target.value; };
    $('#fd-noimg', el)?.addEventListener('click', () => { r.image = null; s.render(); });
    $('#fd-showtext', el)?.addEventListener('click', () => { showText = !showText; s.render(); });
    $('#fd-pastehelp', el).onclick = async () => {
      const text = await pasteTextSheet();
      if (!text || !text.trim()) return;
      const p = splitRecipeText(text);
      if (!r.title.trim() && p.title) r.title = p.title;
      const newIngs = linesToIngredients(p.ingredients);
      await matchAll(newIngs);
      r.ingredients.push(...newIngs);
      r.steps.push(...p.steps);
      resuggest(r);
      s.render();
    };
    $$('[data-link]', el).forEach((b) => { b.onclick = () => { s.close(); setTimeout(() => editRecipe(blankDraft({ url: b.dataset.link }), { autoFetchLink: true }), 260); }; });
    function bindCatChips() {
      $$('.chip[data-dim]', el).forEach((b) => { b.onclick = () => {
        const dim = b.dataset.dim, key = b.dataset.key;
        const list = (r.cats[dim] ||= []);
        const confirmed = (r.catsConfirmed[dim] ||= []);
        const removed = (r.catsRemoved[dim] ||= []);
        const i = list.indexOf(key);
        if (i >= 0 && !confirmed.includes(key)) { confirmed.push(key); }
        else if (i >= 0) { list.splice(i, 1); const ci = confirmed.indexOf(key); if (ci >= 0) confirmed.splice(ci, 1); if (!removed.includes(key)) removed.push(key); }
        else { list.push(key); confirmed.push(key); const ri = removed.indexOf(key); if (ri >= 0) removed.splice(ri, 1); }
        refreshCats();
      }; });
    }
    bindCatChips();
    // ingredient food-suggestion dropdown while typing a new line
    const suggBox = $('#fd-sugg', el);
    const renderSugg = (list) => {
      if (!list.length) { suggBox.style.display = 'none'; suggBox.innerHTML = ''; return; }
      suggBox.style.display = 'block';
      suggBox.innerHTML = list.map((f, i) => `<button type="button" class="list-item" data-si="${i}"><div class="grow"><div class="ellipsis"><b>${esc(f.src === 'db' ? f.en : f.name)}</b></div><div class="sub ellipsis">${esc(f.src === 'db' ? (f.pl || '') : (f.brand || (f.src === 'custom' ? 'My food' : '')))}</div></div></button>`).join('');
      $$('[data-si]', suggBox).forEach((b) => { b.onclick = () => {
        pendingFood = list[+b.dataset.si];
        renderSugg([]);
        $('#fd-newline', el)?.focus();
      }; });
    };
    let suggTimer;
    const newlineInput = $('#fd-newline', el);
    newlineInput.oninput = () => {
      pendingFood = null;
      clearTimeout(suggTimer);
      const val = newlineInput.value;
      suggTimer = setTimeout(async () => {
        const p = parseIngredient(val);
        const name = (p.name || val).trim();
        if (name.length < 2) { renderSugg([]); return; }
        const index = await getIndex();
        const list = searchFoods(index, name, 6).map((x) => x.food);
        if (newlineInput.value === val) renderSugg(list);
      }, 150);
    };
    newlineInput.onblur = () => setTimeout(() => renderSugg([]), 150);
    // grams inputs
    $$('.fd-g', el).forEach((inp) => { inp.oninput = () => {
      const ing = r.ingredients[+inp.dataset.i];
      ing.grams = parseNum(inp.value);
      if (ing.hint != null) ing.hint = ing.grams;
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
      resuggest(r);
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
      resuggest(r);
      s.render();
    }; });
    const addLine = async () => {
      const inp = $('#fd-newline', el);
      const line = inp.value.trim();
      if (!line) return;
      const n = linesToIngredients([line]);
      if (pendingFood && n.length === 1 && !n[0].head) {
        n[0].food = snap(pendingFood);
        n[0].conf = 'user';
        regrams(n[0]);
        rememberMatch(n[0].name, pendingFood);
      } else {
        await matchAll(n);
      }
      pendingFood = null;
      r.ingredients.push(...n);
      resuggest(r);
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
        ingredients: r.ingredients.map(({ raw, qty, unit, name, note, size, toTaste, head, hint, food, conf, grams, guess, checkOk }) =>
          ({ raw, qty, unit, name, note, size, toTaste, head, hint, food, conf, grams, guess, checkOk })),
        steps: r.steps, notes: r.notes || '', cats: r.cats, text: (r.text || '').slice(0, 5000), siteNutrition: r.siteNutrition || null,
        totals: { kcal: t2.kcal, p: t2.p, c: t2.c, f: t2.f, grams: t2.grams, missing: t2.missing },
        created: draft.created || new Date().toISOString(),
        ...(r.from_library ? { from_library: r.from_library } : {}),
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
    // Opened from a shared link (Android share-target): fetch title + photo right away, once.
    if (autoFetchLink && r.source?.url && !r._linkFetched && !r._linkBusy) {
      autoFetchLink = false;
      setTimeout(() => tryFetchLink(r.source.url), 0);
    }
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
    const foods = foodsCached(() => s.render());
    const warns = foods ? checkRecipe(rec.ingredients || [], rec.servings, foods) : [];
    const ps = recipePer(rec);
    const t = rec.totals || recipeTotals(rec.ingredients);
    const time = (rec.prepMin || 0) + (rec.cookMin || 0);
    const src = rec.source?.url ? (() => { try { return new URL(rec.source.url).hostname.replace(/^www\./, ''); } catch { return 'source'; } })() : null;
    const cats = Object.entries(rec.cats || {}).flatMap(([dim, keys]) => (keys || []).map((k) => catLabel(dim, k)));
    el.innerHTML = page({ title: rec.title, right: `<button class="icon-btn" id="fd-edit" aria-label="Edit">${icon('edit')}</button>`, body: `
      ${img(rec.image, 'fd-hero-img')}
      <h2 class="fd-rtitle">${esc(rec.title)}</h2>
      ${rec.from_library ? `<div class="row between" style="margin:4px 0 8px"><span class="fd-badge mine">Your version of a library recipe</span><button class="link small" id="fd-reset">Reset to original</button></div>` : ''}
      <div class="fd-meta">${time ? `<span>${icon('timer')} ${time} min</span>` : ''}<span>${icon('food')} ${rec.servings} serving${rec.servings > 1 ? 's' : ''}</span>
        ${src ? `<a href="${esc(rec.source.url)}" target="_blank" rel="noopener noreferrer">${esc(rec.source.type === 'tiktok' ? 'TikTok' : rec.source.type === 'youtube' ? 'YouTube' : src)}${rec.source.author ? ` · ${esc(rec.source.author)}` : ''}</a>` : ''}</div>
      ${cats.length ? `<div class="fd-chipwrap" style="margin:10px 0 0">${cats.map((c) => `<span class="pill">${esc(c)}</span>`).join('')}</div>` : ''}
      ${practisesChipsHtml(rec)}
      <div class="card fd-totals" style="margin-top:14px"><div class="row between"><div><p class="tiny muted">Per serving${ps.grams ? ` (${n0(ps.grams)} g)` : ''}</p><div class="fd-big">${n0(ps.kcal)} <span>kcal</span></div></div>
        <div class="fd-pcf"><span class="fd-p">P ${n0(ps.p)} g</span><span class="fd-c">C ${n0(ps.c)} g</span><span class="fd-f">F ${n0(ps.f)} g</span></div></div>
        ${t.missing ? `<p class="fd-warn small">${icon('info')} ${t.missing} ingredient${t.missing > 1 ? 's' : ''} not counted — tap edit to fix.</p>` : ''}
        <button class="primary block" id="fd-log" style="margin-top:14px">${icon('plus')} Log to diary</button></div>
      ${checkCardHtml(warns)}
      <h3 class="section-title">Ingredients</h3>
      <div class="card"><div class="list">${ingListHtml(rec.ingredients || [])}</div></div>
      ${rec.steps?.length ? `<h3 class="section-title">Steps</h3><ol class="fd-steps">${rec.steps.map((st) => /:$/.test(st) && st.length < 50 ? `<li class="fd-step-head">${esc(st)}</li>` : `<li>${esc(st)}</li>`).join('')}</ol>` : ''}
      ${rec.notes ? `<h3 class="section-title">Notes</h3><div class="card"><p style="white-space:pre-wrap">${esc(rec.notes)}</p></div>` : ''}` });
    $('#fd-edit', el).onclick = () => editRecipe(rec, { id });
    $('#fd-log', el).onclick = () => logRecipe(rec);
    $('#fd-reset', el)?.addEventListener('click', async () => {
      if (await confirmSheet('Delete your version and go back to the original library recipe?', { ok: 'Reset to original', danger: true })) { await store.remove(id); toast('Back to the original'); s.close(); }
    });
    if (foods) bindEditing(el, { warns, foods, getRec: () => store.get(id), commit: async (fn) => { await store.put('recipe', withTotals(fn(store.get(id)))); s.render(); } });
    bindPractisesChips(el);
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
          source: { type: rec.lib ? 'library' : 'recipe', id: rec.id }, servings: mode === 'servings' ? a : null, grams: mode === 'grams' ? a : null,
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
      <p class="small" style="margin:6px 0 14px">Type it in, with smart help matching ingredients and macros as you go.</p>
      <button class="primary" id="fd-import2">Add your first recipe</button></div>`
      : list.length ? `<div class="fd-grid">${list.map((r) => { const ps = recipePer(r); return `<button class="fd-rcard" data-rid="${r.id}">${img(r.image)}
        <div class="fd-rcard-body"><b class="fd-2l">${esc(r.title)}</b>${r.from_library ? '<span class="fd-badge mine" style="align-self:flex-start">Your version</span>' : ''}<span class="small muted">${n0(ps.kcal)} kcal · <span class="fd-p">${n0(ps.p)} g P</span></span></div></button>`; }).join('')}</div>`
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
  $('#fd-import', box).onclick = () => editRecipe(blankDraft());
  $('#fd-import2', box)?.addEventListener('click', () => editRecipe(blankDraft()));
}

export { uid };
