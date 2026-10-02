// Stats tab: pure aggregation (no DOM, no store). Covered by tests/stats-calc.test.js.
// Days are local 'YYYY-MM-DD' strings; weeks start on Monday and are named by their Monday.

export const RANGES = [
  { days: 7, label: '7 d' },
  { days: 30, label: '30 d' },
  { days: 90, label: '90 d' },
  { days: 365, label: '1 y' },
];

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromDay = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const addDays = (s, n) => { const d = fromDay(s); d.setDate(d.getDate() + n); return dayOf(d); };
export const weekOf = (s) => addDays(s, -((fromDay(s).getDay() + 6) % 7));
const dayIndex = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const num = (x) => (Number.isFinite(+x) ? +x : 0);

// The `n` days ending at `end` (inclusive), oldest first.
export const dayList = (end, n) => Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));

// The `n` week-start days ending with the week of `end`, oldest first.
export const weekList = (end, n) => Array.from({ length: n }, (_, i) => addDays(weekOf(end), (i - n + 1) * 7));

// Weekly charts show at least 4 weeks so a 7 d range still has something to compare.
export const weeksFor = (days) => Math.max(4, Math.ceil(days / 7));

// Diary entries ('meal' records {day,kcal,p,c,f}) → one row per day: totals plus `logged` (any entry that day).
export function dailyNutrition(meals = [], end, days) {
  const rows = new Map(dayList(end, days).map((d) => [d, { day: d, kcal: 0, p: 0, c: 0, f: 0, logged: false }]));
  for (const m of meals) {
    const r = rows.get(m?.day);
    if (!r) continue;
    r.kcal += num(m.kcal); r.p += num(m.p); r.c += num(m.c); r.f += num(m.f);
    r.logged = true;
  }
  return [...rows.values()];
}

// Long ranges get unreadable as daily bars: average the *logged* days of each week instead.
export function weeklyNutrition(daily) {
  const weeks = new Map();
  for (const d of daily) {
    const k = weekOf(d.day);
    if (!weeks.has(k)) weeks.set(k, { day: k, kcal: 0, p: 0, c: 0, f: 0, n: 0 });
    if (!d.logged) continue;
    const w = weeks.get(k);
    w.kcal += d.kcal; w.p += d.p; w.c += d.c; w.f += d.f; w.n++;
  }
  return [...weeks.values()].map((w) => ({
    day: w.day, logged: w.n > 0,
    kcal: w.n ? w.kcal / w.n : 0, p: w.n ? w.p / w.n : 0, c: w.n ? w.c / w.n : 0, f: w.n ? w.f / w.n : 0,
  }));
}

// Average of the logged days (null when nothing was logged).
export function averageLogged(daily) {
  const l = daily.filter((d) => d.logged);
  if (!l.length) return null;
  const avg = (k) => l.reduce((s, d) => s + d[k], 0) / l.length;
  return { kcal: avg('kcal'), p: avg('p'), c: avg('c'), f: avg('f'), days: l.length };
}

// Body weight within the range, with a trailing 7-day average computed from ALL entries
// (so the first points of the range are not skewed). entries: [{day,kg}].
export function weightSeries(entries = [], end, days) {
  const from = addDays(end, -days + 1);
  const sorted = entries.filter((e) => e?.day && e.kg > 0).sort((a, b) => a.day.localeCompare(b.day));
  return sorted.map((e, i) => {
    let sum = 0, n = 0;
    for (let j = i; j >= 0 && dayIndex(e.day) - dayIndex(sorted[j].day) < 7; j--) { sum += sorted[j].kg; n++; }
    return { day: e.day, kg: e.kg, avg: sum / n };
  }).filter((e) => e.day >= from && e.day <= end);
}

// Running: kind 'run' records {start, distance_m} → km per week.
export function runWeekly(runs = [], end, weeks) {
  const list = weekList(end, weeks);
  const rows = new Map(list.map((w) => [w, { week: w, km: 0, runs: 0 }]));
  for (const r of runs) {
    if (!r?.start || !(r.distance_m > 0)) continue;
    const row = rows.get(weekOf(dayOf(new Date(r.start))));
    if (row) { row.km += r.distance_m / 1000; row.runs++; }
  }
  return list.map((w) => rows.get(w));
}

// Gym: kind 'workout' records → sessions and volume (kg) per week. `volumeOf(workout)` is injected (gym-calc.workoutVolume).
export function gymWeekly(workouts = [], end, weeks, volumeOf = () => 0) {
  const list = weekList(end, weeks);
  const rows = new Map(list.map((w) => [w, { week: w, sessions: 0, volume: 0 }]));
  for (const w of workouts) {
    if (!w?.started_at) continue;
    const row = rows.get(weekOf(dayOf(new Date(w.started_at))));
    if (row) { row.sessions++; row.volume += num(volumeOf(w)); }
  }
  return list.map((w) => rows.get(w));
}
