// Daily food totals, targets (TDEE) and body-weight trend. Pure functions — tests/food-calc.test.js.

export const round = (x, d = 0) => {
  const k = 10 ** d;
  return Math.round((Number(x) || 0) * k) / k;
};

const addMacros = (a, b) => ({ kcal: (a.kcal || 0) + (b.kcal || 0), p: (a.p || 0) + (b.p || 0), c: (a.c || 0) + (b.c || 0), f: (a.f || 0) + (b.f || 0) });

// Sum of diary entries (each has kcal, p, c, f)
export function sumEntries(entries = []) {
  return entries.reduce((acc, e) => addMacros(acc, e), { kcal: 0, p: 0, c: 0, f: 0 });
}

// What was eaten, as {day, kcal, p, c, f} entries: one per day synced from Fitatu ('fitatu-day'
// records), plus the old in-app diary entries ('meal' records) for days Fitatu has nothing for.
export function foodEntries(fitatuDays = [], meals = []) {
  const synced = new Map();
  for (const d of fitatuDays) if (d && d.day) synced.set(d.day, { day: d.day, kcal: +d.kcal || 0, p: +d.p || 0, c: +d.c || 0, f: +d.f || 0, fitatu: true });
  return [...synced.values(), ...meals.filter((m) => m && m.day && !synced.has(m.day))];
}

// ---------- targets ----------
export const ACTIVITY = [
  { key: 'sedentary', factor: 1.2, label: 'Sedentary', hint: 'Desk job, little exercise' },
  { key: 'light', factor: 1.375, label: 'Lightly active', hint: 'Training 1–3× a week' },
  { key: 'moderate', factor: 1.55, label: 'Moderately active', hint: 'Training 3–5× a week' },
  { key: 'very', factor: 1.725, label: 'Very active', hint: 'Hard training 6–7× a week' },
  { key: 'extra', factor: 1.9, label: 'Extremely active', hint: 'Physical job + daily training' },
];

// Mifflin-St Jeor
export function bmr({ sex, age, height, weight }) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

// goal: 'lose' | 'maintain' | 'gain'; rate: kg per week (e.g. 0.5)
// Returns suggested daily targets: kcal, protein (g), fat (g), carbs (g).
export function suggestTargets({ sex = 'male', age, height, weight, activity = 'moderate', goal = 'maintain', rate = 0.5, proteinPerKg = 1.8, fatPct = 0.27 }) {
  if (!(age > 0 && height > 0 && weight > 0)) return null;
  const b = bmr({ sex, age, height, weight });
  const factor = (ACTIVITY.find((a) => a.key === activity) || ACTIVITY[2]).factor;
  const tdee = b * factor;
  // 1 kg of body fat ≈ 7700 kcal
  const delta = goal === 'lose' ? -(rate * 7700) / 7 : goal === 'gain' ? (rate * 7700) / 7 : 0;
  let kcal = tdee + delta;
  const floor = sex === 'female' ? 1200 : 1500;
  kcal = Math.max(kcal, Math.min(floor, tdee));
  const protein = proteinPerKg * weight;
  const fat = (kcal * fatPct) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return {
    bmr: round(b), tdee: round(tdee), kcal: round(kcal / 10) * 10,
    protein: round(protein), fat: round(fat), carbs: round(carbs), delta: round(delta),
  };
}

// ---------- body weight ----------
// entries: [{ day: 'YYYY-MM-DD', kg }] in any order → sorted with a trailing 7-day average `avg`.
export function weightTrend(entries = [], windowDays = 7) {
  const sorted = [...entries].filter((e) => e && e.day && e.kg > 0).sort((a, b) => a.day.localeCompare(b.day));
  const t = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  return sorted.map((e, i) => {
    const now = t(e.day);
    let sum = 0, n = 0;
    for (let j = i; j >= 0; j--) {
      if (now - t(sorted[j].day) >= windowDays) break;
      sum += sorted[j].kg; n++;
    }
    return { ...e, avg: sum / n };
  });
}

// Change of the 7-day average over the last week (kg/week), or null without enough data.
export function weeklyChange(entries = []) {
  const tr = weightTrend(entries);
  if (tr.length < 2) return null;
  const last = tr[tr.length - 1];
  const t = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  const target = t(last.day) - 7;
  // closest entry at least ~5 days before the last one
  let ref = null;
  for (let i = tr.length - 2; i >= 0; i--) {
    const d = t(tr[i].day);
    if (d <= t(last.day) - 5) { ref = tr[i]; if (d <= target) break; }
  }
  if (!ref) return null;
  const days = t(last.day) - t(ref.day);
  return ((last.avg - ref.avg) / days) * 7;
}

export function latestWeight(entries = []) {
  const s = [...entries].filter((e) => e && e.kg > 0).sort((a, b) => b.day.localeCompare(a.day));
  return s[0] || null;
}
