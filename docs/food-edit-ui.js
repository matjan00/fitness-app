// Shared UI for recipe detail screens (own recipes AND library recipes): tappable ingredient rows with an edit sheet,
// and the "Check these" card. Logic lives in food-check.js / food-copy.js (tested); this file is DOM only.
import { $, $$, esc, icon, toast, n0 } from './util.js';
import { sheet, push } from './nav.js';
import { loadFoods, unitOptions } from './food-db.js';
import { macrosFor } from './food-calc.js';
import { applyFix, ignoreWarning } from './food-check.js';
import { replaceIngredient, removeIngredient, amountPatch } from './food-copy.js';
import { pickFood, snap, rememberMatch, macroLine } from './food-ui.js';

let mapCache = null;
export async function foodsMap() {
  if (!mapCache) mapCache = Object.fromEntries((await loadFoods()).map((f) => [f.id, f]));
  return mapCache;
}

// ---------- ingredient rows ----------
// ings: own-shape ingredients; k = servings scale (library detail lets you change servings).
export function ingListHtml(ings, k = 1) {
  return ings.map((ing, i) => {
    if (ing.head) return `<div class="fd-li-head">${esc(ing.name)}</div>`;
    const counted = ing.food && ing.grams != null;
    const line = k !== 1 && counted ? `${n0(ing.grams * k)} g ${ing.name}` : (ing.raw || ing.name);
    const sub = ing.food ? `${esc(ing.food.name)}${ing.grams == null ? ' · <span class="fd-guess">no grams, not counted</span>' : ing.guess ? ' · <span class="fd-guess">estimated</span>' : ''}`
      : `<span class="fd-guess">${ing.toTaste ? 'not counted (to taste)' : 'no match, not counted'}</span>`;
    return `<button type="button" class="list-item fd-ingtap" data-ing="${i}"><div class="grow"><div>${esc(line)}</div><div class="sub ellipsis">${sub}</div></div>
      <div class="fd-li-g">${counted ? `${n0(ing.grams * k)} g<span>${n0(macrosFor(ing.food, ing.grams * k).kcal)} kcal</span>` : ''}</div></button>`;
  }).join('');
}

// ---------- "Check these" card ----------
export function checkCardHtml(warns) {
  if (!warns.length) return '';
  const dirTxt = (w) => (w.dir === 'over' ? `Total is probably about ${w.kcal} kcal per serving too high`
    : w.dir === 'under' ? `Total is probably about ${w.kcal} kcal per serving too low` : `Could be off by about ${w.kcal} kcal per serving`);
  return `<div class="card fd-check"><div class="fd-check-h">${icon('info')}<div><b>Check these</b> <span class="tiny muted">(could change calories a lot)</span></div></div>
    ${warns.map((w, n) => `<div class="fd-chk"><p class="small">${esc(w.message)}</p><p class="tiny fd-chk-k">${esc(dirTxt(w))}</p>
      <div class="fd-chk-btns">${w.fix?.patch ? `<button class="primary" data-wfix="${n}">Apply: ${esc(w.fix.label)}</button>` : ''}<button class="ghost" data-wedit="${n}">Edit</button><button class="link" data-wign="${n}">Ignore</button></div></div>`).join('')}</div>`;
}

// warns = checkRecipe(...) result rendered by checkCardHtml; foods = await foodsMap().
// Wire the ingredient rows + check card inside `el`.
//   getRec()   -> current own-shape recipe (a saved one, or an unsaved conversion of a library recipe)
//   commit(fn) -> async: newRec = fn(rec); saves it (creating the personal copy when needed) and repaints
export function bindEditing(el, { getRec, commit, warns, foods }) {
  const edit = async (i) => {
    const cur = getRec().ingredients[i];
    if (!cur) return;
    const res = await ingredientSheet(cur, getRec().servings);
    if (!res) return;
    if (res.op === 'remove') await commit((r) => removeIngredient(r, i));
    else await commit((r) => replaceIngredient(r, i, res.ing));
  };
  $$('[data-ing]', el).forEach((b) => { b.onclick = () => edit(+b.dataset.ing); });
  $$('[data-wfix]', el).forEach((b) => { b.onclick = async () => {
    const w = warns[+b.dataset.wfix];
    await commit((r) => replaceIngredient(r, w.i, applyFix(r.ingredients[w.i], w.fix, foods, w.kind)));
    toast('Updated');
  }; });
  $$('[data-wedit]', el).forEach((b) => { b.onclick = () => edit(warns[+b.dataset.wedit].i); });
  $$('[data-wign]', el).forEach((b) => { b.onclick = () => {
    const w = warns[+b.dataset.wign];
    return commit((r) => replaceIngredient(r, w.i, ignoreWarning(r.ingredients[w.i], w.kind)));
  }; });
}

// ---------- ingredient sheet: amount, unit, other food, remove; totals update live ----------
export function ingredientSheet(ing, servings = 1) {
  return new Promise((resolve) => {
    let result = null;
    const w = { ...ing };
    let changedFood = false;
    let unitKey = 'g';
    let amount = w.grams == null ? '' : String(Math.round(w.grams * 10) / 10);
    push((el, s) => {
      const paint = () => {
        const opts = unitOptions(w.food);
        if (!opts.some((o) => o.key === unitKey)) unitKey = 'g';
        el.innerHTML = sheet({ title: w.name || 'Ingredient', body: `
          <p class="tiny muted" style="margin:-4px 0 10px">${esc(w.raw || '')}</p>
          <button class="fd-foodbtn conf-${w.food ? (w.conf || 'medium') : 'none'}" id="ig-food"><span class="fd-dot"></span><span class="ellipsis">${w.food ? esc(w.food.name) : 'No match - tap to choose'}</span><span class="fd-conf">Change food</span></button>
          <div class="form-row" style="margin-top:12px"><label>Amount<input id="ig-amt" inputmode="decimal" value="${esc(amount)}"></label>
            <label>Unit<select id="ig-unit">${opts.map((o) => `<option value="${o.key}" ${o.key === unitKey ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label></div>
          <div class="card flat" id="ig-m" style="margin:14px 0"></div>
          <div class="sheet-actions"><button class="ghost danger-text" data-a="del">Remove</button><button class="primary" data-a="ok">Save</button></div>` });
        const cur = () => opts.find((o) => o.key === unitKey) || opts[0];
        const grams = () => (parseFloat(String($('#ig-amt', el).value).replace(',', '.')) || 0) * cur().grams;
        const upd = () => {
          const g = grams();
          $('#ig-m', el).innerHTML = w.food && g > 0
            ? `<p class="small" style="margin-bottom:6px">${n0(g)} g${servings > 1 ? ` · ${n0(macrosFor(w.food, g).kcal / servings)} kcal per serving` : ''}</p>${macroLine(macrosFor(w.food, g))}`
            : '<p class="small muted">Pick a food and an amount to count this ingredient.</p>';
        };
        $('#ig-amt', el).oninput = upd;
        $('#ig-unit', el).onchange = (e) => {
          const g = grams();
          unitKey = e.target.value;
          amount = g ? String(Math.round((g / cur().grams) * 100) / 100) : '';
          $('#ig-amt', el).value = amount;
          upd();
        };
        $('#ig-food', el).onclick = async () => {
          amount = String(Math.round(grams() * 10) / 10 || '');
          unitKey = 'g';
          const f = await pickFood({ title: 'Change food', query: w.name || '', hint: `"${w.raw || w.name}"` });
          if (!f) return;
          w.food = snap(f); w.conf = 'user'; changedFood = true;
          rememberMatch(w.name, f);
          paint();
        };
        $('[data-a=del]', el).onclick = () => { result = { op: 'remove' }; s.close(); };
        $('[data-a=ok]', el).onclick = () => {
          const o = cur();
          const a = parseFloat(String($('#ig-amt', el).value).replace(',', '.'));
          if (w.food && !(a > 0)) { toast('Enter an amount'); return; }
          const patch = a > 0 ? amountPatch(w, a, o.key, o.grams, o.label) : {};
          result = { op: 'save', ing: { ...w, ...patch, conf: changedFood ? 'user' : w.conf } };
          s.close();
        };
        upd();
      };
      paint();
    }, { sheet: true, onClose: () => resolve(result) });
  });
}

// Synchronous access for render functions: returns the map once loaded (and starts loading it otherwise).
export function foodsCached(onReady) {
  if (!mapCache) foodsMap().then(() => onReady?.());
  return mapCache;
}
