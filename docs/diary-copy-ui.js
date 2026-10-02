// Food diary: copy a meal / a whole day to another day, move an entry to another meal. DOM + store; logic is in diary-copy.js.
import { $, esc, toast, today, addDays, fromDay, niceDate, relDay } from './util.js';
import * as store from './store.js';
import { push, sheet, chooseSheet } from './nav.js';
import { MEALS, mealLabel } from './food-ui.js';
import { copiedEntries, movedEntry, dayChoices, copyMessage } from './diary-copy.js';

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

// Copy all entries of one meal (on `from`) to another day and/or meal.
export async function copyMeal(from, mealKey, entries) {
  if (!entries.length) return;
  const day = await pickDay(`Copy ${mealLabel(mealKey).toLowerCase()} to which day?`, from);
  if (!day) return;
  const meal = await chooseSheet(`Copy into which meal on ${dayName(day)}?`, [
    { value: mealKey, label: `${mealLabel(mealKey)} (same meal)`, icon: 'swap' },
    ...MEALS.filter((m) => m.key !== mealKey).map((m) => ({ value: m.key, label: m.label })),
  ]);
  if (!meal) return;
  await copyTo(entries, day, meal);
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
