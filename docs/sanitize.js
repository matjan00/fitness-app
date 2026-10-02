// Defensive loading: records can come back from sync/import in any shape (null fields, wrong types, half-written
// rows). Each cleaner returns a safe copy with the fields screens rely on, or null when the record is unusable
// (it is then skipped). Unknown fields are kept untouched. Pure — no DOM, no store.

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x, d = '') => (typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : d);
const numOrNull = (x) => { const n = typeof x === 'string' && !x.trim() ? NaN : Number(x); return x != null && typeof x !== 'boolean' && Number.isFinite(n) ? n : null; };
const finite = (x, d = 0) => numOrNull(x) ?? d;
const arrOf = (x, f) => (Array.isArray(x) ? x.map(f).filter(Boolean) : []);
const validDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const validDate = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));
// Input-like field (kept as typed text such as "+5" or "62.5"): string/number only.
const field = (x) => (typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : '');

export function cleanSet(s) {
  if (!isObj(s)) return null;
  const out = { ...s, type: ['n', 'w', 'd', 'f'].includes(s.type) ? s.type : 'n', done: s.done === true };
  for (const k of ['kg', 'reps', 'm', 's']) if (k in s) out[k] = field(s[k]);
  if ('secs' in s) out.secs = finite(s.secs);
  return out;
}

export function cleanWorkout(w) {
  if (!isObj(w) || !validDate(w.started_at)) return null;
  const exercises = arrOf(w.exercises, (e) => {
    if (!isObj(e)) return null;
    return { ...e, exercise_id: str(e.exercise_id), mode: ['wr', 'bw', 't'].includes(e.mode) ? e.mode : 'wr', sets: arrOf(e.sets, cleanSet) };
  });
  const out = { ...w, exercises };
  if (w.ended_at != null && !validDate(w.ended_at)) out.ended_at = null;
  return out;
}

export function cleanRoutine(r) {
  if (!isObj(r)) return null;
  return {
    ...r,
    name: str(r.name, 'Routine'),
    order: finite(r.order),
    exercises: arrOf(r.exercises, (e) => {
      if (!isObj(e) || !e.exercise_id) return null;
      return { ...e, sets: Math.max(1, Math.round(finite(e.sets, 1))), reps: field(e.reps), kg: numOrNull(e.kg), rest: numOrNull(e.rest) ?? 90 };
    }),
  };
}

// Diary entry: needs a valid day. Macros become finite numbers.
export function cleanMeal(m) {
  if (!isObj(m) || !validDay(m.day)) return null;
  const out = { ...m };
  for (const k of ['kcal', 'p', 'c', 'f']) out[k] = finite(m[k]);
  if ('t' in m && typeof m.t !== 'string') out.t = '';
  if ('meal' in m && typeof m.meal !== 'string') out.meal = '';
  if ('food' in m && !isObj(m.food)) out.food = null;
  if ('source' in m && !isObj(m.source)) out.source = null;
  return out;
}

export function cleanBodyweight(e) {
  if (!isObj(e) || !validDay(e.day)) return null;
  const kg = numOrNull(e.kg);
  return kg > 0 ? { ...e, kg } : null;
}

export function cleanRun(r) {
  if (!isObj(r) || !validDate(r.start)) return null;
  return { ...r, distance_m: Math.max(0, finite(r.distance_m)) };
}

// Own recipes and library recipes (both title/ingredients/steps).
export function cleanRecipe(r) {
  if (!isObj(r)) return null;
  const out = { ...r, title: str(r.title).trim() || 'Untitled recipe', ingredients: arrOf(r.ingredients, (i) => (isObj(i) ? i : typeof i === 'string' && i ? { name: i, raw: i } : null)), steps: arrOf(r.steps, (s) => (typeof s === 'string' ? s : null)) };
  if ('servings' in r) out.servings = finite(r.servings) > 0 ? finite(r.servings) : 1;
  if ('cats' in r && !isObj(r.cats)) delete out.cats;
  if ('catsConfirmed' in r && !isObj(r.catsConfirmed)) delete out.catsConfirmed;
  if ('catsRemoved' in r && !isObj(r.catsRemoved)) delete out.catsRemoved;
  if ('notes' in r) out.notes = str(r.notes);
  return out;
}

// Saved custom food: needs a name; per-100g style numbers become finite.
export function cleanFood(f) {
  if (!isObj(f) || typeof f.name !== 'string' || !f.name.trim()) return null;
  const out = { ...f };
  for (const k of ['kcal', 'p', 'c', 'f']) if (k in f) out[k] = finite(f[k]);
  return out;
}

export const CLEANERS = { food: cleanFood, workout: cleanWorkout, routine: cleanRoutine, meal: cleanMeal, bodyweight: cleanBodyweight, run: cleanRun, recipe: cleanRecipe, library: cleanRecipe };

// Clean one loaded item of a kind; kinds without a cleaner only need to be an object.
export function cleanItem(kind, item) {
  if (!isObj(item)) return null;
  const f = CLEANERS[kind];
  if (!f) return item;
  try { return f(item); } catch { return null; }
}
