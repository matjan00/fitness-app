// Cut plan: red flags, adaptive maintenance (TDEE) and "was yesterday logged?".
// Pure (no DOM, no store); covered by tests/cut-flags.test.js. Days are local 'YYYY-MM-DD' strings.

import { addDays, weekOf } from './stats-calc.js';
import { CUT_DEFAULTS, PLAN, emaTrend, trendOn, targetWeight, weekNumber, daysBetween } from './cut-calc.js';
import { weekTraining, dayFacts, minimumDaysInWeek, sessionDone, SESSION_LABEL } from './cut-day.js';
import { e1rmOf, workingSets } from './cut-engine.js';
import { MAIN_LIFTS } from './cut-calc.js';

const weekday = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)).getDay();
const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// ---------- adaptive maintenance ----------
// TDEE = average kcal − (weight change per day × 7,700) over a rolling 21-day window ending at `day`.
// The weight change is the slope of a straight line through the window's weigh-ins (least squares, one value per
// day): unlike the smoothed trend it does not lag at the start of a cut or after a gap. Needs at least 14 days with
// calories logged and 8 weigh-in days spread over 10+ days; otherwise null.
// `change` = kg over the whole window at that slope (so tdee = avgKcal − change × 7,700 / window).
export function adaptiveTdee(day, { weights = [], kcalOf = () => null, window = 21, minDays = 14 } = {}) {
  const from = addDays(day, -(window - 1));
  const kc = range(from, day).map(kcalOf).filter((k) => k != null && k > 0);
  if (kc.length < minDays) return null;
  const pts = emaTrend(weights).filter((r) => r.day >= from && r.day <= day).map((r) => [daysBetween(from, r.day), r.kg]);
  if (pts.length < 8 || pts[pts.length - 1][0] - pts[0][0] < 10) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const avg = kc.reduce((s, k) => s + k, 0) / kc.length;
  const change = Math.round(slope * window * 100) / 100;
  return { tdee: Math.round(avg - slope * 7700), avgKcal: Math.round(avg), days: kc.length, change, perWeek: Math.round(slope * 7 * 100) / 100 };
}

// ---------- logging ----------
// A day counts as logged when any of weight, sleep, steps or food was entered.
export const isLogged = (day, src) => dayFacts(day, src).logged;

// ---------- red flags ----------
// src: { weights, dailies, meals, workouts, runs, checkins, routineCut }, cfg: cut settings, start: start weight.
// Returns [{ key, text }] (empty when all is well). `day` is today; today itself is never held against you.
export function redFlags(day, src, cfg = {}, start = null) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  if (!c.startDate || day < c.startDate) return [];
  const flags = [];
  const inPlan = (d) => d >= c.startDate && d < day;
  const facts = (d) => dayFacts(d, src);

  // Training: 3 gym + 2 runs a week on any days. Flag this week once the goal no longer fits in the days left
  // (today still counts as a day left), else last week if it ended short. Weeks that began before the plan don't count.
  const wsrc = { workouts: src.workouts || [], runs: src.runs || [], dailies: src.dailies || [] };
  // Same basis as the Today card: sessions done today count, and today is still a free day until one is done.
  const sofar = weekTraining(day, { ...wsrc, through: day });
  const freeToday = !sessionDone('lift', day, wsrc) && !sessionDone('easy', day, wsrc)
    && !wsrc.dailies.some((x) => x && x.day === day && x.travel === true);
  const daysLeft = sofar.daysLeft + (freeToday ? 1 : 0);
  const now = { ...sofar, daysLeft, onTrack: sofar.liftLeft + sofar.runLeft <= daysLeft };
  const last = weekTraining(addDays(weekOf(day), -7), { ...wsrc, through: addDays(weekOf(day), -1) });
  const short = (w) => `gym ${w.lift}/${w.goal.lift}, runs ${w.run}/${w.goal.run}`;
  if (weekOf(day) >= c.startDate && !now.onTrack) {
    flags.push({ key: 'missed', text: `Behind on training: ${short(now)} with ${now.daysLeft} day${now.daysLeft === 1 ? '' : 's'} left this week` });
  } else if (addDays(weekOf(day), -7) >= c.startDate && !last.complete) {
    flags.push({ key: 'missed', text: `Last week's training fell short: ${short(last)}` });
  }

  // protein under the minimum 3 days in a row (unlogged days count as missed)
  const last3 = [1, 2, 3].map((n) => addDays(day, -n));
  // (travel days don't count)
  if (last3.every(inPlan) && last3.every((d) => !facts(d).travel && (facts(d).p ?? 0) < c.proteinMin)) {
    flags.push({ key: 'protein', text: `Protein under ${c.proteinMin} g for 3 days in a row` });
  }

  // no weigh-in for 3 days (today included once you have weighed in)
  const weighed = (d) => src.weights.some((e) => e && e.day === d);
  if (last3.every(inPlan) && !weighed(day) && last3.every((d) => !weighed(d))) {
    flags.push({ key: 'weighin', text: 'No weigh-in for 3 days' });
  }

  // weekly review skipped: the review day (the day after the check-in day) and the 2 days after it have passed
  // with nothing done for that week (neither the Sunday check-in nor the Monday review).
  let r = addDays(day, -3);
  while (weekday(r) !== (+c.checkinDay + 1) % 7) r = addDays(r, -1);
  if (inPlan(addDays(r, -1)) && daysBetween(c.startDate, r) >= 7
    && !(src.checkins || []).some((x) => x && (x.forDay === r || x.forDay === addDays(r, -1) || (x.day >= addDays(r, -1) && x.day <= addDays(r, 2))))) {
    flags.push({ key: 'checkin', text: 'Weekly review skipped' });
  }

  // trend weight behind the last finished week's target by more than 1 kg
  const wk = weekNumber(c.startDate, day) - 1;
  if (wk >= 1 && start > 0 && !PLAN[wk - 1]?.buffer) {
    const target = targetWeight(start, c.goalWeight, c.rate, wk);
    const t = trendOn(emaTrend(src.weights), addDays(c.startDate, wk * 7 - 1));
    if (t != null && target != null && t - target > 1) flags.push({ key: 'behind', text: `Trend ${t.toFixed(1)} kg is ${(t - target).toFixed(1)} kg behind the week ${wk} target (${target} kg)` });
  }

  // main lift e1RM down more than 5 % (latest session vs the best before it, last 6 weeks)
  const since = Date.parse(`${addDays(day, -42)}T00:00:00`);
  const down = [];
  for (const id of MAIN_LIFTS) {
    const ses = (src.workouts || []).filter((w) => w && w.ended_at && Date.parse(w.started_at) >= since)
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((w) => (w.exercises || []).find((e) => e.exercise_id === id)).filter(Boolean)
      .map((e) => e1rmOf(workingSets(e.sets))).filter((x) => x > 0);
    if (ses.length >= 2) {
      const best = Math.max(...ses.slice(0, -1));
      const cur = ses[ses.length - 1];
      if (cur < best * 0.95) down.push({ id, pct: Math.round((1 - cur / best) * 100) });
    }
  }
  const dropped = (src.workouts || []).filter((w) => w?.cut?.session).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 2);
  if (down.length) flags.push({ key: 'strength', text: `Main lift strength down ${Math.max(...down.map((d) => d.pct))}% — check sleep and calories on lifting days` });
  else if (dropped.length === 2 && dropped.every((w) => w.cut.session === 'dropped')) flags.push({ key: 'strength', text: 'Two "Dropped" sessions in a row — check sleep and calories on lifting days' });

  // more than one minimum day this week
  const mins = minimumDaysInWeek(day, src.dailies);
  if (mins > 1) flags.push({ key: 'minimum', text: `${mins} minimum days this week (1 allowed)` });

  // average sleep under 6.5 h over the last 7 days (days with sleep logged, at least 4)
  const sl = range(addDays(day, -7), addDays(day, -1)).filter(inPlan).map((d) => facts(d).sleep).filter((x) => x != null);
  if (sl.length >= 4 && sl.reduce((a, b) => a + b, 0) / sl.length < 6.5) flags.push({ key: 'sleep', text: `Average sleep ${(sl.reduce((a, b) => a + b, 0) / sl.length).toFixed(1)} h — sleep is this week's #1 fix` });

  return flags;
}

export { SESSION_LABEL, localDay };
