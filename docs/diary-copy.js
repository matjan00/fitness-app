// Pure helpers for copying / moving food-diary entries. No DOM, no store. Tests: tests/diary-copy.test.js.
// A diary entry is a store record of kind 'meal': { id, day, meal, t, label, source, grams|servings, kcal, p, c, f, ... }.

export const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];
const sortKey = (e) => e.t || '';

// New entries (no id, so the store gives each a fresh one) with the same amounts and macros, put on `day` and,
// when `meal` is given, in that meal (otherwise each entry stays in its own meal). Original order is kept.
export function copiedEntries(entries, { day, meal = null, now = new Date() }) {
  const base = now.getTime();
  return [...entries].sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map(({ id, ...e }, i) => ({
    ...e,
    day,
    meal: meal || e.meal,
    t: new Date(base + i).toISOString(),
  }));
}

// The same entry in another meal (same id, so it is a move, not a copy). Returns null when nothing would change.
export function movedEntry(entry, meal) {
  if (!entry || !MEAL_KEYS.includes(meal) || entry.meal === meal) return null;
  return { ...entry, meal };
}

// Day picker shortcuts around `today` (both 'YYYY-MM-DD'); addDays(day, n) is passed in so this stays dependency-free.
export function dayChoices(today, addDays) {
  return [
    { day: addDays(today, -1), label: 'Yesterday' },
    { day: today, label: 'Today' },
    { day: addDays(today, 1), label: 'Tomorrow' },
  ];
}

// Short toast text, e.g. "Copied 3 items to Lunch · Tomorrow".
export function copyMessage(count, { mealName = null, dayName = '' } = {}) {
  const items = `${count} item${count === 1 ? '' : 's'}`;
  return `Copied ${items}${mealName ? ` to ${mealName}` : ''}${dayName ? ` · ${dayName}` : ''}`;
}
