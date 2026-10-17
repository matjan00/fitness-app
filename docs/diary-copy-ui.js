// Food diary: copy or delete a meal, save a meal as a recipe, copy a whole day to another day, move an entry to another meal. DOM + store; logic is in diary-copy.js.
import { $, esc, toast, today, addDays, fromDay, niceDate, relDay } from './util.js';
import * as store from './store.js';
import { push, sheet, chooseSheet } from './nav.js';
import { MEALS, mealLabel } from './food-ui.js';
import { copiedEntries, movedEntry, dayChoices, copyMessage, copyTarget, deleteMessage, mealRecipeDraft } from './diary-copy.js';
import { editRecipe } from './food-recipes.js';

const dayName = (d) => {
  const r = relDay(fromDay(d));
  return r === 'Today' || r === 'Yesterday' || r === 'Tomorrow' ? r : niceDate(fromDay(d), { weekday: true });
};

// Resolves a day ('YYYY-MM-DD') or null: yesterday / today / tomorrow buttons, or any date.
function pickDay(title, current) {
  return new Promise((resolve) => {
    let result = null;
    push((el, s) => {
      const t = today();
      el.innerHTML = sheet({ title, body: `<div class="menu">${dayChoices(t, addDays).map((c) => `
        <button data-day="${c.day}"><span>${esc(c.label)} · ${esc(niceDate(fromDay(c.day), { weekday: true }))}${c.day === current ? ' (shown now)' : ''}</span></button>`).join('')}</div>
        <p class="tiny muted" style="margin:12px 4px 6px">Or pick another date</p>
        <input type="date" id="fd-cdate" value="${esc(current)}">
        <div class="sheet-actions" style="margin-top:14px"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">Choose</button></div>` });
      el.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => { result = b.dataset.day; s.close(); }; });
      $('[data-a=ok]', el).onclick = () => { result = $('#fd-cdate', el).value || null; s.close(); };
      $('[data-a=no]', el).onclick = () => s.close();
    }, { sheet: true, onClose: () => resolve(result) });
  });
}

async function copyTo(entries, day, meal) {
  if (!entries.length) return;
  await store.putMany('meal', copiedEntries(entries, { day, meal }));
  toast(copyMessage(entries.length, { mealName: meal ? mealLabel(meal) : null, dayName: dayName(day) }));
}

// One sheet for a meal copy: day (yesterday / today / tomorrow or any date) + meal. Resolves { day, meal } or null.
// Same day and same meal are allowed, so e.g. lunch can be copied to dinner of the same day.
function pickTarget(title, from, mealKey) {
  return new Promise((resolve) => {
    let result = null, day = from, meal = mealKey;
    push((el, s) => {
      const t = today();
      const dayBtns = dayChoices(t, addDays).map((c) => `<button class="chip${c.day === day ? ' on' : ''}" data-day="${c.day}">${esc(c.label)}</button>`).join('');
      el.innerHTML = sheet({ title, body: `
        <p class="tiny muted" style="margin:0 4px 6px">Day</p>
        <div class="chips" style="flex-wrap:wrap">${dayBtns}</div>
        <input type="date" id="fd-cdate" value="${esc(day)}" style="margin-top:6px">
        <p class="tiny muted" style="margin:14px 4px 6px">Into meal</p>
        <div class="chips" style="flex-wrap:wrap">${MEALS.map((m) => `<button class="chip${m.key === meal ? ' on' : ''}" data-meal="${m.key}">${esc(m.label)}</button>`).join('')}</div>
        <div class="sheet-actions" style="margin-top:14px"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">Copy</button></div>` });
      const dateEl = $('#fd-cdate', el);
      const sync = () => el.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', b.dataset.day === day));
      el.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => { day = b.dataset.day; dateEl.value = day; sync(); }; });
      dateEl.onchange = () => { if (dateEl.value) { day = dateEl.value; sync(); } };
      el.querySelectorAll('[data-meal]').forEach((b) => { b.onclick = () => { meal = b.dataset.meal; el.querySelectorAll('[data-meal]').forEach((x) => x.classList.toggle('on', x === b)); }; });
      $('[data-a=ok]', el).onclick = () => { result = copyTarget(day, meal); s.close(); };
      $('[data-a=no]', el).onclick = () => s.close();
    }, { sheet: true, onClose: () => resolve(result) });
  });
}

// Copy all entries of one meal (on `from`) to any meal of any day, including the same day.
export async function copyMeal(from, mealKey, entries) {
  if (!entries.length) return;
  const target = await pickTarget(`Copy ${mealLabel(mealKey).toLowerCase()} to`, from, mealKey);
  if (!target) return;
  await copyTo(entries, target.day, target.meal);
}

// Meal header "⋯" menu: copy the meal, save it as a recipe, or delete every entry in it (with Undo on the toast).
export async function mealMenu(day, mealKey, entries) {
  if (!entries.length) return;
  const name = mealLabel(mealKey);
  const n = entries.length;
  const v = await chooseSheet(name, [
    { value: 'copy', label: 'Copy to another day or meal', icon: 'copy' },
    { value: 'recipe', label: 'Save as a recipe', icon: 'note' },
    { value: 'del', label: `Delete ${name.toLowerCase()} (${n} item${n === 1 ? '' : 's'})`, icon: 'trash', danger: true },
  ]);
  if (v === 'copy') await copyMeal(day, mealKey, entries);
  else if (v === 'recipe') saveMealAsRecipe(mealKey, entries);
  else if (v === 'del') await deleteMeal(mealKey, entries);
}

// Opens the new-recipe form filled with the meal's ingredients; the user names it and saves it to My recipes.
export function saveMealAsRecipe(mealKey, entries) {
  const draft = mealRecipeDraft(entries, { lookup: (id) => store.get(id) });
  if (!draft.ingredients.length) { toast('Nothing in this meal to save'); return; }
  editRecipe(draft);
}

// Removes each entry the same way a single "Remove from diary" does; Undo puts them back with the same ids.
export async function deleteMeal(mealKey, entries) {
  if (!entries.length) return;
  const snapshot = entries.map((e) => ({ ...e }));
  for (const e of snapshot) await store.remove(e.id);
  toast(deleteMessage(snapshot.length, mealLabel(mealKey)), 6000, {
    label: 'Undo',
    run: async () => { await store.putMany('meal', snapshot); toast('Restored'); },
  });
}

// Copy a whole day (every meal keeps its place).
export async function copyDay(from, entries) {
  if (!entries.length) return;
  const day = await pickDay('Copy this whole day to which day?', from);
  if (!day) return;
  await copyTo(entries, day, null);
}

// Move one entry (any kind) to another meal of the same day.
export async function moveEntry(entry) {
  if (!entry) return;
  const meal = await chooseSheet(`Move “${entry.label}” to`, MEALS.filter((m) => m.key !== entry.meal).map((m) => ({ value: m.key, label: m.label })));
  const moved = meal && movedEntry(entry, meal);
  if (!moved) return;
  const { id, ...data } = moved;
  await store.put('meal', { id, ...data });
  toast(`Moved to ${mealLabel(meal)}`);
}
