// Cut plan: red flags, adaptive maintenance (TDEE), missed-lift rescheduling and "was yesterday logged?".
// Pure (no DOM, no store); covered by tests/cut-flags.test.js. Days are local 'YYYY-MM-DD' strings.

import { addDays, weekOf } from './stats-calc.js';
import { CUT_DEFAULTS, PLAN, emaTrend, trendOn, targetWeight, weekNumber, daysBetween } from './cut-calc.js';
import { WEEK_TEMPLATE, isScheduled, sessionFor, sessionDone, dayFacts, minimumDaysInWeek, SESSION_LABEL } from './cut-day.js';
import { e1rmOf, workingSets } from './cut-engine.js';
import { MAIN_LIFTS } from './cut-calc.js';

const weekday = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)).getDay();
const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// ---------- adaptive maintenance ----------
// TDEE = average kcal − (Δ trend kg × 7,700 / days) over a rolling 21-day window ending at `day`.
// Needs at least 14 days with calories logged and a trend at both ends; otherwise null.
export function adaptiveTdee(day, { weights = [], kcalOf = () => null, window = 21, minDays = 14 } = {}) {
  const from = addDays(day, -(window - 1));
  const kc = range(from, day).map(kcalOf).filter((k) => k != null && k > 0);
  if (kc.length < minDays) return null;
  const tr = emaTrend(weights);
  const a = trendOn(tr, from) ?? tr.find((r) => r.day >= from && r.day <= day)?.trend;
  const b = trendOn(tr, day);
  if (a == null || b == null) return null;
  const avg = kc.reduce((s, k) => s + k, 0) / kc.length;
  return { tdee: Math.round(avg - ((b - a) * 7700) / window), avgKcal: Math.round(avg), days: kc.length, change: Math.round((b - a) * 100) / 100 };
}

// ---------- missed lifts ----------
// Lift days planned before `day` in its week that were not made up: planned lift days minus days lifted so far.
export function missedLifts(day, { workouts = [], startDate = null } = {}) {
  const past = range(weekOf(day), addDays(day, -1)).filter((d) => !startDate || d >= startDate);
  const planned = past.filter((d) => WEEK_TEMPLATE[weekday(d)] === 'lift');
  const done = past.filter((d) => sessionDone('lift', d, { workouts })).length;
  const n = Math.max(0, planned.length - done);
  return n ? planned.filter((d) => !sessionDone('lift', d, { workouts })).slice(-n) : [];
}

// After a missed lift: the first day from `day` that doesn't follow a lift day, and the day after that for the
// following lift (the next planned lift day if it is at least 2 days later, else 2 days later) — never two lifts in a row.
// Returns { day, then } or null when no lift was missed this week.
export function rescheduleLifts(day, { workouts = [], startDate = null } = {}) {
  if (!missedLifts(day, { workouts, startDate }).length) return null;
  const doneOn = (d) => sessionDone('lift', d, { workouts });
  let d = day;
  if (doneOn(d)) return null;
  while (doneOn(addDays(d, -1))) d = addDays(d, 1);
  let then = addDays(d, 1);
  while (!(WEEK_TEMPLATE[weekday(then)] === 'lift' && daysBetween(d, then) >= 2) && daysBetween(d, then) < 2) then = addDays(then, 1);
  return { day: d, then };
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

  // 2 scheduled sessions missed in a week (this week so far, or last week)
  for (const ws of [weekOf(day), addDays(weekOf(day), -7)]) {
    const missed = range(ws, addDays(ws, 6)).filter((d) => inPlan(d)).filter((d) => {
      const s = sessionFor(d, { workouts: src.workouts, routineCut: src.routineCut });
      return isScheduled(s.kind) && !sessionDone(s.kind, d, src);
    });
    if (missed.length >= 2) {
      flags.push({ key: 'missed', text: `${missed.length} planned sessions missed ${ws === weekOf(day) ? 'this week' : 'last week'}` });
      break;
    }
  }

  // protein under the minimum 3 days in a row (unlogged days count as missed)
  const last3 = [1, 2, 3].map((n) => addDays(day, -n));
  if (last3.every(inPlan) && last3.every((d) => (facts(d).p ?? 0) < c.proteinMin)) {
    flags.push({ key: 'protein', text: `Protein under ${c.proteinMin} g for 3 days in a row` });
  }

  // no weigh-in for 3 days (today included once you have weighed in)
  const weighed = (d) => src.weights.some((e) => e && e.day === d);
  if (last3.every(inPlan) && !weighed(day) && last3.every((d) => !weighed(d))) {
    flags.push({ key: 'weighin', text: 'No weigh-in for 3 days' });
  }

  // weekly check-in skipped: the last check-in day (before today) has no check-in within 2 days of it
  let ci = addDays(day, -1);
  while (weekday(ci) !== +c.checkinDay) ci = addDays(ci, -1);
  if (inPlan(ci) && daysBetween(c.startDate, ci) >= 6
    && !(src.checkins || []).some((x) => x && x.day >= addDays(ci, -1) && x.day <= addDays(ci, 2))) {
    flags.push({ key: 'checkin', text: 'Weekly check-in skipped' });
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
