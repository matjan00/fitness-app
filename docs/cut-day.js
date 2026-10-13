// Cut plan, one day at a time: the day's session (your Gym / Run / No training pick), the weekly
// training goal, the "green day" rules and streaks.
// Pure (no DOM, no store); covered by tests/cut-day.test.js. Days are local 'YYYY-MM-DD' strings.

import { addDays, weekOf } from './stats-calc.js';
import { CUT_DEFAULTS, ROUTINES } from './cut-calc.js';

const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const num = (x) => (x == null || x === '' ? null : Number.isFinite(+x) ? +x : null);

// Training is chosen day by day (Gym / Run / No training). What counts is the week (Monday–Sunday):
// 3 gym sessions and 2 runs, on whichever days suit you.
export const WEEK_GOAL = { lift: 3, run: 2 };
export const TRAIN_CHOICES = [['lift', 'Gym'], ['run', 'Run'], ['none', 'No training']];
export const SESSION_LABEL = { lift: 'Upper body', easy: 'Easy run', quality: 'Quality run', steps: 'Steps only', rest: 'No training', travel: 'Travel day' };
export const isScheduled = (kind) => kind === 'lift' || kind === 'easy' || kind === 'quality';
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const isTravel = (d, dailies) => dailies.some((x) => x && x.day === d && x.travel === true);
const choiceOn = (d, dailies) => dailies.find((x) => x && x.day === d)?.train || null;

// The week's training so far (days up to and including `through`) and whether the goal can still be met:
// one session a day on the days left after `through`. Travel days aren't held against you: they don't count
// as days left, and each one shrinks the week's goal in proportion (3 travel days → 2 gym + 1 run).
// Returns { lift, run, goal, liftLeft, runLeft, daysLeft, onTrack, complete }.
export function weekTraining(day, { workouts = [], runs = [], dailies = [], through = day, goal: full = WEEK_GOAL } = {}) {
  const from = weekOf(day);
  const to = addDays(from, 6);
  const away = range(from, to).filter((d) => isTravel(d, dailies)).length;
  const goal = { lift: Math.round((full.lift * (7 - away)) / 7), run: Math.round((full.run * (7 - away)) / 7) };
  const sofar = through < from ? [] : range(from, through < to ? through : to);
  const lift = sofar.filter((d) => sessionDone('lift', d, { workouts })).length;
  const run = sofar.filter((d) => sessionDone('easy', d, { runs })).length;
  const liftLeft = Math.max(0, goal.lift - lift);
  const runLeft = Math.max(0, goal.run - run);
  const daysLeft = through >= to ? 0 : range(through < from ? from : addDays(through, 1), to).filter((d) => !isTravel(d, dailies)).length;
  return { lift, run, goal, liftLeft, runLeft, daysLeft, onTrack: liftLeft + runLeft <= daysLeft, complete: liftLeft + runLeft === 0 };
}

// What to do on a day nobody chose for: whatever the week still needs, the bigger gap first,
// but never gym two days in a row while a run is still due. 'none' once the week is complete.
export function suggestTraining(day, src = {}) {
  const w = weekTraining(day, { ...src, through: addDays(day, -1) });
  if (w.complete) return 'none';
  const liftedYesterday = sessionDone('lift', addDays(day, -1), { workouts: src.workouts || [] });
  if (w.liftLeft && !(liftedYesterday && w.runLeft) && w.liftLeft >= w.runLeft) return 'lift';
  return w.runLeft ? 'run' : 'lift';
}

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

// The session for a day: { kind, choice, chosen, letter?, routine? }.
// `choice` is what you picked (Gym / Run / No training); without a pick, what you actually did that day,
// else the suggestion. A run is the week's easy run first, then the quality run.
export function sessionFor(day, { workouts = [], runs = [], routineCut, dailies = [] } = {}) {
  if (isTravel(day, dailies)) return { kind: 'travel', choice: 'none', chosen: false };
  const picked = choiceOn(day, dailies);
  const choice = picked
    || (sessionDone('lift', day, { workouts }) ? 'lift' : sessionDone('easy', day, { runs }) ? 'run' : suggestTraining(day, { workouts, runs, dailies }));
  const base = { choice, chosen: Boolean(picked) };
  if (choice === 'none') return { kind: 'rest', ...base };
  if (choice === 'run') {
    const before = weekTraining(day, { workouts, runs, dailies, through: addDays(day, -1) }).run;
    return { kind: before >= 1 ? 'quality' : 'easy', ...base };
  }
  const letter = nextLift(workouts, day, routineCut);
  return { kind: 'lift', ...base, letter, routine: ROUTINES.find((r) => r.key === letter) };
}

// Was the day's session done? Lift: a finished workout that day. Run: a run that day.
export function sessionDone(kind, day, { workouts = [], runs = [] } = {}) {
  if (kind === 'lift') return workouts.some((w) => w && w.ended_at && w.started_at && localDay(w.started_at) === day);
  if (kind === 'easy' || kind === 'quality') return runs.some((r) => r && r.start && localDay(r.start) === day);
  return false;
}

// Facts of one day from the records: weigh-in, daily log, food diary sums (used when kcal/protein were not typed in).
// Steps the phone counted for a daily record (the steps-webhook edge function writes them the morning
// after), or null.
function phoneSteps(d) {
  return d?.stepsSource === 'phone' ? num(d.stepsPhone) ?? num(d.steps) : null;
}

// Daily-record patch for steps added by hand: they go on top of the phone's count, now and when the
// phone's count arrives later (supabase/functions/steps-webhook/logic.js mergeSteps adds stepsExtra).
export function handStepsPatch(d, extra) {
  const phone = phoneSteps(d);
  const add = num(extra);
  return { steps: phone == null && add == null ? null : (phone || 0) + (add || 0), stepsExtra: add };
}

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
    stepsPhone: phoneSteps(d),
    stepsExtra: num(d?.stepsExtra),
    kcal: pick('kcal'), p: pick('p'), c: pick('c'), f: pick('f'),
    minimum: d?.minimum === true,
    travel: d?.travel === true,
    note: d?.note || '',
    logged: Boolean(w || m.length || (d && ['sleepHours', 'steps', 'kcal', 'p'].some((k) => num(d[k]) != null))),
  };
}

// Green / yellow / red per the plan.
//  green: weighed, protein ≥ 140, kcal within target ±100, steps ≥ 10,000, sleep ≥ 7 h, session done (or none planned)
//  yellow: everything else green but steps 8,000–9,999, or a minimum day (weigh-in + protein ≥ 140 + 6,000 steps)
//  red: anything else. 'open' = today, not finished yet and not green.
// Returns { status, checks: [{ key, label, ok, warn }] , minimumMet }.
// `week` (from weekTraining, as of the end of the day) makes the session check "still on track for the
// week's 3 gym + 2 runs" rather than "did the planned session".
export function dayStatus(f, { kcalTarget = null, cfg = {}, session = { kind: 'rest' }, done = false, isToday = false, week = null } = {}) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  if (f.travel) return travelStatus(f, { kcalTarget, c, isToday });
  const planned = isScheduled(session.kind);
  const sessionCheck = week
    ? { key: 'session', label: `Week on track: gym ${week.lift}/${week.goal.lift} · runs ${week.run}/${week.goal.run}`, ok: week.onTrack }
    : { key: 'session', label: planned ? `${SESSION_LABEL[session.kind]} done` : 'No session planned', ok: !planned || done };
  const checks = [
    { key: 'weight', label: 'Weighed in', ok: f.weight != null },
    { key: 'protein', label: `Protein ≥ ${c.proteinMin} g`, ok: f.p != null && f.p >= c.proteinMin },
    { key: 'kcal', label: kcalTarget ? `Calories ${kcalTarget - c.kcalBand}–${kcalTarget + c.kcalBand}` : 'Calories logged', ok: f.kcal != null && (!kcalTarget || Math.abs(f.kcal - kcalTarget) <= c.kcalBand) },
    { key: 'steps', label: `Steps ≥ ${c.steps.toLocaleString('en-GB')}`, ok: f.steps != null && f.steps >= c.steps, warn: f.steps != null && f.steps >= c.stepsMin && f.steps < c.steps },
    { key: 'sleep', label: `Sleep ≥ ${c.sleep} h`, ok: f.sleep != null && f.sleep >= c.sleep },
    sessionCheck,
  ];
  const minimumMet = f.weight != null && f.p != null && f.p >= c.proteinMin && f.steps != null && f.steps >= 6000;
  let status;
  if (checks.every((x) => x.ok)) status = 'green';
  else if (checks.every((x) => x.ok || x.warn)) status = 'yellow';
  else if (f.minimum && minimumMet) status = 'yellow';
  else status = isToday ? 'open' : 'red';
  return { status, checks, minimumMet };
}

// Travel day: only the morning weigh-in is required. Calories, when entered, should be roughly on target
// (±300 kcal, else yellow); steps are optional and never count against the day. No session is expected.
function travelStatus(f, { kcalTarget, c, isToday }) {
  const kcalOk = f.kcal == null || !kcalTarget || Math.abs(f.kcal - kcalTarget) <= c.travelKcalBand;
  const checks = [
    { key: 'weight', label: 'Weighed in', ok: f.weight != null },
    { key: 'kcal', label: kcalTarget ? `Calories roughly ${kcalTarget - c.travelKcalBand}–${kcalTarget + c.travelKcalBand} (optional)` : 'Calories (optional)', ok: kcalOk, warn: !kcalOk },
    { key: 'steps', label: 'Steps (optional)', ok: true },
    { key: 'session', label: 'Travel day — no session', ok: true },
  ];
  const status = f.weight == null ? (isToday ? 'open' : 'red') : kcalOk ? 'green' : 'yellow';
  return { status, checks, minimumMet: false };
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

// Extra kcal on a cut-plan lifting day (weekly review: "+150 kcal on lifting days"). A lifting day is a day you
// chose Gym for or any day with a finished workout. 0 when there is no bonus or the plan hasn't started.
export function liftDayExtra(day, { cfg = {}, workouts = [], dailies = [] } = {}) {
  const bonus = +cfg.liftDayBonus || 0;
  if (!bonus || !cfg.startDate || !day || day < cfg.startDate) return 0;
  const lift = choiceOn(day, dailies) === 'lift' || workouts.some((w) => w && w.ended_at && w.started_at && localDay(w.started_at) === day);
  return lift ? bonus : 0;
}

// Days marked as travel days (Set of 'YYYY-MM-DD').
export const travelDays = (dailies = []) => new Set(dailies.filter((d) => d && d.travel === true).map((d) => d.day));
