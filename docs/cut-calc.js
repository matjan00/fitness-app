// 11-week cut plan (fit-cut-plan.md): plan data and pure calculations (no DOM, no store).
// Covered by tests/cut-calc.test.js. Days are local 'YYYY-MM-DD' strings.

import { addDays } from './stats-calc.js';

const dayIndex = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
export const daysBetween = (a, b) => dayIndex(b) - dayIndex(a);
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- settings ----------
// Calories/macros live in the food targets (one source for the whole app); these are the plan's own settings.
export const CUT_DEFAULTS = {
  startDate: null,      // first day of week 1
  startWeight: null,    // manual override; otherwise the average of the first 3 weigh-ins from startDate
  goalWeight: 65,
  rate: 0.75,           // kg of trend weight per week
  kcalFloor: 1550,
  steps: 10000,
  stepsMin: 8000,       // yellow, not failed
  sleep: 7,
  proteinMin: 140,
  kcalBand: 100,        // calories within target ±100
  checkinDay: 0,        // 0 = Sunday … 6 = Saturday (Date.getDay)
  maintenance: 2500,    // initial maintenance estimate (kcal); the app learns the real one from data
};
export const CUT_TARGETS = { kcal: 1750, p: 150, f: 55, c: 165 };
export const PLAN_WEEKS_TOTAL = 11;

// ---------- the plan ----------
// phase, deload, checkpoint, easy-run minutes and the quality-run session per week (13 = 11 + 2 buffer weeks).
const Q = (text, reps = null, metres = null, pace = null) => ({ text, reps, metres, pace });
export const PLAN = [
  { week: 1, phase: 'Re-entry', focus: 'Find working weights (RPE 7–8). Expect a bigger drop (holiday water).', easyMin: 35, quality: Q('4 × 800 m @ 5:25/km, 2 min jog between', 4, 800, '5:25') },
  { week: 2, phase: 'Block 1', focus: 'Progress', easyMin: 35, quality: Q('5 × 800 m @ 5:25/km, 2 min jog between', 5, 800, '5:25') },
  { week: 3, phase: 'Block 1', focus: 'Progress', easyMin: 35, quality: Q('4 × 1000 m @ 5:20/km, 2–3 min jog', 4, 1000, '5:20') },
  { week: 4, phase: 'Block 1', focus: 'Progress', checkpoint: 1, easyMin: 35, quality: Q('5 × 1000 m @ 5:20/km, 2–3 min jog', 5, 1000, '5:20') },
  { week: 5, phase: 'Deload', deload: true, focus: 'Same weights, half the sets. Calories unchanged.', easyMin: 30, quality: Q('Deload: 20 min easy + 6 × 20 s strides') },
  { week: 6, phase: 'Block 2', focus: 'Progress / hold', easyMin: 40, quality: Q('2 × 10 min tempo @ 5:35/km, 3 min jog', null, null, '5:35') },
  { week: 7, phase: 'Block 2', focus: 'Progress / hold', easyMin: 40, quality: Q('3 × 8 min tempo @ 5:35/km', null, null, '5:35') },
  { week: 8, phase: 'Block 2', focus: 'Hold', checkpoint: 2, easyMin: 40, quality: Q('20 min continuous tempo @ 5:40/km', null, null, '5:40') },
  { week: 9, phase: 'Block 2', focus: 'Hold', easyMin: 40, quality: Q('5 × 1000 m @ 5:15/km', 5, 1000, '5:15') },
  { week: 10, phase: 'Deload', deload: true, focus: 'Same weights, half the sets.', easyMin: 30, quality: Q('Deload: 20 min easy + 6 × 20 s strides') },
  { week: 11, phase: 'Final', focus: 'Goal week: re-test lifts + 5k time trial', easyMin: 45, quality: Q('5k time trial (benchmark)', 1, 5000, null) },
  { week: 12, phase: 'Buffer', buffer: true, focus: 'Only if behind. Otherwise start maintenance.', easyMin: 40, quality: Q('5 × 1000 m @ 5:15/km', 5, 1000, '5:15') },
  { week: 13, phase: 'Buffer', buffer: true, focus: 'Only if behind. Otherwise start maintenance.', easyMin: 40, quality: Q('20 min continuous tempo @ 5:40/km', null, null, '5:40') },
];
export const EASY_PACE = '6:30–6:45/km';

// Upper A → B → C. kind: 'main' compound (also judged as a main lift), 'compound', 'iso' (isolation),
// 'crunch', 'pullup' (reps first, weight once 4 × 10). alt = suggested swap (judged on its own history).
const E = (exercise_id, name, sets, reps, rest, kind, alt = null) => ({ exercise_id, name, sets, reps, rest, kind, alt });
const CRUNCH = E('Cable_Crunch', 'Crunch (weighted or cable)', 3, '12-20', 60, 'crunch', 'Ab_Crunch_Machine');
export const ROUTINES = [
  { key: 'A', name: 'Upper A', exercises: [
    E('Leverage_Chest_Press', 'Machine Chest Press', 4, '6-10', 150, 'main', 'Dumbbell_Bench_Press'),
    E('Dumbbell_Incline_Row', 'Chest-Supported DB Row', 4, '8-10', 120, 'main'),
    E('Side_Lateral_Raise', 'DB Lateral Raise', 3, '12-15', 60, 'iso'),
    E('Dumbbell_Bicep_Curl', 'DB Curl', 3, '10-12', 60, 'iso'),
    CRUNCH,
  ] },
  { key: 'B', name: 'Upper B', exercises: [
    E('Standing_Military_Press', 'Overhead Press', 4, '6-8', 150, 'main', 'Dumbbell_Shoulder_Press'),
    E('Pullups', 'Pull-Up', 4, '6-10', 120, 'pullup', 'Wide-Grip_Lat_Pulldown'),
    E('Reverse_Machine_Flyes', 'Reverse Pec Deck', 3, '12-15', 60, 'iso'),
    E('Triceps_Pushdown', 'Triceps Pushdown', 3, '12-15', 60, 'iso'),
    CRUNCH,
  ] },
  { key: 'C', name: 'Upper C', exercises: [
    E('Incline_Dumbbell_Press', 'Incline DB Press', 3, '8-12', 120, 'main'),
    E('Seated_Cable_Rows', 'Seated Cable Row', 3, '10-12', 90, 'compound'),
    E('Side_Lateral_Raise', 'DB Lateral Raise', 3, '12-15', 60, 'iso'),
    E('Hammer_Curls', 'Hammer Curl', 3, '10-12', 60, 'iso'),
    E('Cable_Rope_Overhead_Triceps_Extension', 'Overhead Triceps Extension', 3, '12-15', 60, 'iso'),
    CRUNCH,
  ] },
];
export const PROGRAM_NAME = 'Cut 11 weeks';
// Main lifts (Pull-Up and Lat Pulldown count as one).
export const MAIN_LIFTS = ['Leverage_Chest_Press', 'Standing_Military_Press', 'Dumbbell_Incline_Row', 'Pullups', 'Wide-Grip_Lat_Pulldown', 'Incline_Dumbbell_Press'];

// Routine records for the gym module ({ name, program, exercises:[{exercise_id, sets, reps, kg, rest}] }).
export function routineRecords(order = 0) {
  return ROUTINES.map((r, i) => ({
    name: r.name, program: PROGRAM_NAME, order: order + i, cut: r.key,
    exercises: r.exercises.map((x) => ({ exercise_id: x.exercise_id, sets: x.sets, reps: x.reps, kg: null, rest: x.rest })),
  }));
}

// ---------- dates ----------
// Plan week of a day: 1 on the start date's first 7 days; 0 before the start; can run past 13.
export function weekNumber(startDate, day) {
  if (!startDate || !day) return 0;
  const d = daysBetween(startDate, day);
  return d < 0 ? 0 : Math.floor(d / 7) + 1;
}

// Start weight: manual value, else the average of the first 3 weigh-ins on/after the start date (null if none).
export function startWeightFrom(entries = [], startDate, manual = null) {
  if (Number(manual) > 0) return Number(manual);
  if (!startDate) return null;
  const first = entries.filter((e) => e && e.day >= startDate && Number(e.kg) > 0)
    .sort((a, b) => a.day.localeCompare(b.day)).slice(0, 3);
  return first.length ? Math.round((first.reduce((a, e) => a + Number(e.kg), 0) / first.length) * 100) / 100 : null;
}

// Target trend weight at the end of week n: start − rate × n, never below the goal.
export const targetWeight = (start, goal, rate, n) => (start > 0 ? r1(Math.max(goal, start - rate * n)) : null);

// The whole plan dated from the start: [{ ...PLAN row, from, to, target }]. Buffer weeks have no target.
export function planWeeks(cfg = {}, start = null) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  return PLAN.map((w) => ({
    ...w,
    from: c.startDate ? addDays(c.startDate, (w.week - 1) * 7) : null,
    to: c.startDate ? addDays(c.startDate, w.week * 7 - 1) : null,
    target: w.buffer ? null : targetWeight(start, c.goalWeight, c.rate, w.week),
  }));
}

// Projected weight on a day: the straight line start − rate × weeks elapsed, flattening at the goal.
export function projectedWeight(cfg, start, day) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  if (!(start > 0) || !c.startDate) return null;
  const weeks = Math.max(0, daysBetween(c.startDate, day)) / 7;
  return Math.round(Math.max(c.goalWeight, start - c.rate * weeks) * 100) / 100;
}

// Days until the planned goal date (end of week 11), not below 0.
export function daysToGoal(startDate, day) {
  if (!startDate) return null;
  return Math.max(0, daysBetween(day, addDays(startDate, PLAN_WEEKS_TOTAL * 7 - 1)));
}

// ---------- trend weight ----------
// Exponential moving average (α = 0.1) over the weigh-ins in day order; the first weigh-in seeds it.
// Returns [{ day, kg, trend }] oldest first.
export function emaTrend(entries = [], alpha = 0.1) {
  const list = entries.filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.day) && Number(e.kg) > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
  let t = null;
  return list.map((e) => {
    const kg = Number(e.kg);
    t = t == null ? kg : t + alpha * (kg - t);
    return { day: e.day, kg, trend: Math.round(t * 100) / 100 };
  });
}

// Latest trend value on or before a day (null without weigh-ins).
export function trendOn(trend, day) {
  let v = null;
  for (const r of trend) { if (r.day > day) break; v = r.trend; }
  return v;
}

// ---------- targets history ----------
// Did any tracked target change? (kcal, protein, carbs, fat, steps)
const TRACKED = ['kcal', 'p', 'c', 'f', 'steps'];
export const targetsChanged = (a = {}, b = {}) => TRACKED.some((k) => Number(a?.[k] ?? 0) !== Number(b?.[k] ?? 0));
