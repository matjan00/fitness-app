// Cut plan, one day at a time: the session scheduled for a day, the "green day" rules and streaks.
// Pure (no DOM, no store); covered by tests/cut-day.test.js. Days are local 'YYYY-MM-DD' strings.

import { addDays, weekOf } from './stats-calc.js';
import { CUT_DEFAULTS, ROUTINES } from './cut-calc.js';

const weekday = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)).getDay(); // 0 = Sunday
const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const num = (x) => (x == null || x === '' ? null : Number.isFinite(+x) ? +x : null);

// Example week from the plan (order flexible): Mon lift · Tue easy run · Wed lift · Thu quality run · Fri lift · Sat steps · Sun rest.
export const WEEK_TEMPLATE = { 1: 'lift', 2: 'easy', 3: 'lift', 4: 'quality', 5: 'lift', 6: 'steps', 0: 'rest' };
export const SESSION_LABEL = { lift: 'Upper body', easy: 'Easy run', quality: 'Quality run', steps: 'Steps only', rest: 'Rest' };
export const isScheduled = (kind) => kind === 'lift' || kind === 'easy' || kind === 'quality';

// Letter (A/B/C) of a workout: from its routine (cut: 'A') or its name ("Upper B").
export function liftLetter(w, routineCut = () => null) {
  const r = w?.routine_id ? routineCut(w.routine_id) : null;
  if (r) return r;
  const m = String(w?.name || '').match(/^Upper ([ABC])\b/);
  return m ? m[1] : null;
}

// The rotation never skips: the lift after the last completed A/B/C workout before `day` (A when none).
export function nextLift(workouts = [], day, routineCut) {
  const done = workouts.filter((w) => w && w.started_at && w.ended_at && localDay(w.started_at) < day)
    .map((w) => ({ day: localDay(w.started_at), at: w.started_at, letter: liftLetter(w, routineCut) }))
    .filter((x) => x.letter)
    .sort((a, b) => a.at.localeCompare(b.at));
  const last = done[done.length - 1];
  return last ? 'ABC'[('ABC'.indexOf(last.letter) + 1) % 3] : 'A';
}

// What is planned for a day: { kind, letter?, routine? }.
export function sessionFor(day, { workouts = [], routineCut } = {}) {
  const kind = WEEK_TEMPLATE[weekday(day)];
  if (kind !== 'lift') return { kind };
  const letter = nextLift(workouts, day, routineCut);
  return { kind, letter, routine: ROUTINES.find((r) => r.key === letter) };
}

// Was the day's session done? Lift: a finished workout that day. Run: a run that day.
export function sessionDone(kind, day, { workouts = [], runs = [] } = {}) {
  if (kind === 'lift') return workouts.some((w) => w && w.ended_at && w.started_at && localDay(w.started_at) === day);
  if (kind === 'easy' || kind === 'quality') return runs.some((r) => r && r.start && localDay(r.start) === day);
  return false;
}

// Facts of one day from the records: weigh-in, daily log, food diary sums (used when kcal/protein were not typed in).
export function dayFacts(day, { weights = [], dailies = [], meals = [] } = {}) {
  const w = weights.find((e) => e && e.day === day);
  const d = dailies.find((e) => e && e.day === day) || null;
  const m = meals.filter((e) => e && e.day === day);
  const diary = m.length ? m.reduce((a, e) => ({ kcal: a.kcal + (+e.kcal || 0), p: a.p + (+e.p || 0), c: a.c + (+e.c || 0), f: a.f + (+e.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 }) : null;
  const pick = (k) => num(d?.[k]) ?? (diary ? Math.round(diary[k]) : null);
  return {
    day,
    weight: w ? +w.kg : null,
    sleep: num(d?.sleepHours),
    steps: num(d?.steps),
    kcal: pick('kcal'), p: pick('p'), c: pick('c'), f: pick('f'),
    minimum: d?.minimum === true,
    note: d?.note || '',
    logged: Boolean(w || m.length || (d && ['sleepHours', 'steps', 'kcal', 'p'].some((k) => num(d[k]) != null))),
  };
}

// Green / yellow / red per the plan.
//  green: weighed, protein ≥ 140, kcal within target ±100, steps ≥ 10,000, sleep ≥ 7 h, session done (or none planned)
//  yellow: everything else green but steps 8,000–9,999, or a minimum day (weigh-in + protein ≥ 140 + 6,000 steps)
//  red: anything else. 'open' = today, not finished yet and not green.
// Returns { status, checks: [{ key, label, ok, warn }] , minimumMet }.
export function dayStatus(f, { kcalTarget = null, cfg = {}, session = { kind: 'rest' }, done = false, isToday = false } = {}) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  const planned = isScheduled(session.kind);
  const checks = [
    { key: 'weight', label: 'Weighed in', ok: f.weight != null },
    { key: 'protein', label: `Protein ≥ ${c.proteinMin} g`, ok: f.p != null && f.p >= c.proteinMin },
    { key: 'kcal', label: kcalTarget ? `Calories ${kcalTarget - c.kcalBand}–${kcalTarget + c.kcalBand}` : 'Calories logged', ok: f.kcal != null && (!kcalTarget || Math.abs(f.kcal - kcalTarget) <= c.kcalBand) },
    { key: 'steps', label: `Steps ≥ ${c.steps.toLocaleString('en-GB')}`, ok: f.steps != null && f.steps >= c.steps, warn: f.steps != null && f.steps >= c.stepsMin && f.steps < c.steps },
    { key: 'sleep', label: `Sleep ≥ ${c.sleep} h`, ok: f.sleep != null && f.sleep >= c.sleep },
    { key: 'session', label: planned ? `${SESSION_LABEL[session.kind]} done` : 'No session planned', ok: !planned || done },
  ];
  const minimumMet = f.weight != null && f.p != null && f.p >= c.proteinMin && f.steps != null && f.steps >= 6000;
  let status;
  if (checks.every((x) => x.ok)) status = 'green';
  else if (checks.every((x) => x.ok || x.warn)) status = 'yellow';
  else if (f.minimum && minimumMet) status = 'yellow';
  else status = isToday ? 'open' : 'red';
  return { status, checks, minimumMet };
}

// Counts back from `day` while `ok(day)` holds. Today counts only once it qualifies (it doesn't break a streak).
export function streak(day, ok, max = 400) {
  let n = 0;
  let d = day;
  if (!ok(d)) d = addDays(d, -1);
  while (n < max && ok(d)) { n++; d = addDays(d, -1); }
  return n;
}

// Weeks in a row (Monday-based) with a check-in, counting back from this week (an open week doesn't break it).
export function weekStreak(day, checkinDays = []) {
  const weeks = new Set(checkinDays.filter(Boolean).map((d) => weekOf(d)));
  let n = 0;
  let w = weekOf(day);
  if (!weeks.has(w)) w = addDays(w, -7);
  while (n < 60 && weeks.has(w)) { n++; w = addDays(w, -7); }
  return n;
}

// Minimum days used in the week of `day`.
export const minimumDaysInWeek = (day, dailies = []) => {
  const w = weekOf(day);
  return dailies.filter((d) => d && d.minimum === true && weekOf(d.day) === w).length;
};
