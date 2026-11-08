// Cut plan, one day at a time: the day's session (your Gym / Run / No training pick), the weekly
// training goal, the "green day" rules and streaks.
// Pure (no DOM, no store); covered by tests/cut-day.test.js. Days are local 'YYYY-MM-DD' strings.

import { addDays, weekOf } from './stats-calc.js';
import { CUT_DEFAULTS, ROUTINES } from './cut-calc.js';

const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const num = (x) => (x == null || x === '' ? null : Number.isFinite(+x) ? +x : null);

// Training is chosen day by day (Gym / No training). What counts is the week (Monday–Sunday):
// 3 gym sessions, on whichever days suit you. No running (WEEK_GOAL.run stays 0).
export const WEEK_GOAL = { lift: 3, run: 0 };
export const TRAIN_CHOICES = [['lift', 'Gym'], ['none', 'No training']];
export const SESSION_LABEL = { lift: 'Upper body', easy: 'Easy run', quality: 'Quality run', steps: 'Steps only', rest: 'No training', travel: 'Travel day' };
export const isScheduled = (kind) => kind === 'lift' || kind === 'easy' || kind === 'quality';
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const isTravel = (d, dailies) => dailies.some((x) => x && x.day === d && x.travel === true);
const choiceOn = (d, dailies) => { const t = dailies.find((x) => x && x.day === d)?.train; return t === 'lift' || t === 'none' ? t : null; }; // old 'run' picks are ignored

// The week's training so far (days up to and including `through`) and whether the goal can still be met:
// one session a day on the days left after `through`. The goal is always the full 3 gym + 2 runs; travel days
// just don't count as days left to fit them in.
// Returns { lift, run, goal, liftLeft, runLeft, daysLeft, onTrack, complete }.
export function weekTraining(day, { workouts = [], runs = [], dailies = [], through = day, goal = WEEK_GOAL } = {}) {
  const from = weekOf(day);
  const to = addDays(from, 6);
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
// else the suggestion.
export function sessionFor(day, { workouts = [], runs = [], routineCut, dailies = [] } = {}) {
  if (isTravel(day, dailies)) return { kind: 'travel', choice: 'none', chosen: false };
  const picked = choiceOn(day, dailies);
  const choice = picked
    || (sessionDone('lift', day, { workouts }) ? 'lift' : suggestTraining(day, { workouts, runs, dailies }));
  const base = { choice, chosen: Boolean(picked) };
  if (choice === 'none') return { kind: 'rest', ...base };
  const letter = nextLift(workouts, day, routineCut);
  // The workout actually finished that day, if any: it may be another routine than the rotation's next one.
  const w = workouts.filter((x) => x && x.ended_at && x.started_at && localDay(x.started_at) === day).pop();
  const did = w ? { name: w.name || 'Workout', letter: liftLetter(w, routineCut) } : null;
  return { kind: 'lift', ...base, letter, routine: ROUTINES.find((r) => r.key === letter), did };
}

// Was the day's session done? Lift: a finished workout that day. Run: a run that day.
const tinyRun = (r) => (r.distance_m != null && +r.distance_m < 500) || ((r.moving_s != null || r.elapsed_s != null) && (+r.moving_s || +r.elapsed_s || 0) < 180);
export function sessionDone(kind, day, { workouts = [], runs = [] } = {}) {
  if (kind === 'lift') return workouts.some((w) => w && w.ended_at && w.started_at && localDay(w.started_at) === day);
  // accidental recordings (under 500 m or 3 min) don't count as a run
  if (kind === 'easy' || kind === 'quality') return runs.some((r) => r && r.start && localDay(r.start) === day && !tinyRun(r));
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

// Distance of a day: km on the home bike (typed in) plus 1 km per 1,000 steps. null when neither is entered.
export function activeKm({ bikeKm, steps } = {}) {
  const b = num(bikeKm), s = num(steps);
  return b == null && s == null ? null : Math.round(((b || 0) + (s || 0) / 1000) * 10) / 10;
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
    bikeKm: num(d?.bikeKm),
    km: activeKm({ bikeKm: d?.bikeKm, steps: d?.steps }),
    kcal: pick('kcal'), p: pick('p'), c: pick('c'), f: pick('f'),
    minimum: d?.minimum === true,
    travel: d?.travel === true,
    note: d?.note || '',
    logged: Boolean(w || m.length || (d && ['sleepHours', 'steps', 'bikeKm', 'kcal', 'p'].some((k) => num(d[k]) != null))),
  };
}

// Green / yellow / red per the plan.
//  green: weighed, protein ≥ proteinMin (120), kcal within target ±100, distance ≥ 15 km (bike km + steps/1000), sleep ≥ 7.5 h, session done (or none planned)
//  yellow: everything else green but distance 12–15 km, or a minimum day (weigh-in + 6 km)
//  red: anything else. 'open' = today, not finished yet and not green.
//  With trackFood off, calories and protein are left out of every rule (minimum day: weigh-in + 6 km).
// Returns { status, checks: [{ key, label, ok, warn }] , minimumMet }.
// `week` (from weekTraining, as of the end of the day) makes the session check "still on track for the
// week's 3 gym + 2 runs" rather than "did the planned session".
export function dayStatus(f, { kcalTarget = null, cfg = {}, session = { kind: 'rest' }, done = false, isToday = false, week = null } = {}) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  if (f.travel) return travelStatus(f, { kcalTarget, c, isToday });
  const planned = isScheduled(session.kind);
  const km = f.km !== undefined ? f.km : activeKm(f);
  const sessionCheck = week
    ? { key: 'session', label: `Week on track: gym ${week.lift}/${week.goal.lift}${week.goal.run ? ` · runs ${week.run}/${week.goal.run}` : ''}`, ok: week.onTrack }
    : { key: 'session', label: planned ? `${SESSION_LABEL[session.kind]} done` : 'No session planned', ok: !planned || done };
  const checks = [
    { key: 'weight', label: 'Weighed in', ok: f.weight != null },
    ...(c.trackFood ? [
      { key: 'protein', label: `At least ${c.proteinMin} g protein`, ok: f.p != null && f.p >= c.proteinMin },
      { key: 'kcal', label: kcalTarget ? `Calories ${kcalTarget - c.kcalBand}–${kcalTarget + c.kcalBand}` : 'Calories logged', ok: f.kcal != null && (!kcalTarget || Math.abs(f.kcal - kcalTarget) <= c.kcalBand) },
    ] : []),
    { key: 'km', label: `Distance ≥ ${c.activeKm} km (bike + steps ÷ 1000)`, ok: km != null && km >= c.activeKm, warn: km != null && km >= c.activeKmMin && km < c.activeKm },
    { key: 'sleep', label: `Sleep ≥ ${c.sleep} h`, ok: f.sleep != null && f.sleep >= c.sleep },
    sessionCheck,
  ];
  const minimumMet = f.weight != null && (!c.trackFood || (f.p != null && f.p >= c.proteinMin)) && km != null && km >= c.minKm;
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
  const kcalOk = !c.trackFood || f.kcal == null || !kcalTarget || Math.abs(f.kcal - kcalTarget) <= c.travelKcalBand;
  const checks = [
    { key: 'weight', label: 'Weighed in', ok: f.weight != null },
    c.trackFood && { key: 'kcal', label: kcalTarget ? `Calories roughly ${kcalTarget - c.travelKcalBand}–${kcalTarget + c.travelKcalBand} (optional)` : 'Calories (optional)', ok: kcalOk, warn: !kcalOk },
    { key: 'km', label: 'Distance (optional)', ok: true },
    { key: 'session', label: 'Travel day — no session', ok: true },
  ].filter(Boolean);
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

// Minimum days used in the week of `day`.
export const minimumDaysInWeek = (day, dailies = []) => {
  const w = weekOf(day);
  return dailies.filter((d) => d && d.minimum === true && weekOf(d.day) === w).length;
};

// Extra kcal on a cut-plan lifting day (liftDayBonus). A lifting day is a day you
// chose Gym for or any day with a finished workout. 0 when there is no bonus or the plan hasn't started.
export function liftDayExtra(day, { cfg = {}, workouts = [], dailies = [] } = {}) {
  const bonus = +cfg.liftDayBonus || 0;
  if (!bonus || !cfg.startDate || !day || day < cfg.startDate) return 0;
  const lift = choiceOn(day, dailies) === 'lift' || workouts.some((w) => w && w.ended_at && w.started_at && localDay(w.started_at) === day);
  return lift ? bonus : 0;
}

// Days marked as travel days (Set of 'YYYY-MM-DD').
export const travelDays = (dailies = []) => new Set(dailies.filter((d) => d && d.travel === true).map((d) => d.day));
