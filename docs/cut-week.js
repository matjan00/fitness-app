// Cut plan weekly review: week summary, grade and the automatic adjustment rules. Pure; tests/cut-week.test.js.
// The review week is the 7 days before the check-in day.

import { addDays } from './stats-calc.js';
import { CUT_DEFAULTS, emaTrend, trendOn, targetWeight, weekNumber } from './cut-calc.js';
import { isScheduled } from './cut-day.js';
import { e1rmOf, workingSets } from './cut-engine.js';
import { MAIN_LIFTS } from './cut-calc.js';

const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const STRENGTH = { progressed: 1, held: 0.8, dropped: 0, completed: 1 };

// A ≥ 90 % · B ≥ 80 % · C ≥ 70 % · D ≥ 60 % · E ≥ 50 % · F below 50 %.
export const GRADES = [[0.9, 'A'], [0.8, 'B'], [0.7, 'C'], [0.6, 'D'], [0.5, 'E']];
export const gradeOf = (pct) => GRADES.find(([min]) => pct >= min)?.[1] || 'F';

// statusOf(day) → { status, facts, session, done } (cut-today.statusOf). workouts: finished workouts with .cut.session.
// Returns the numbers the review shows and the grade.
export function weekSummary(checkinDay, { statusOf, weights = [], workouts = [], cfg = {}, start = null, checkinDone = true } = {}) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  const from = addDays(checkinDay, -7), to = addDays(checkinDay, -1);
  const days = range(from, to).filter((d) => !c.startDate || d >= c.startDate).map((d) => ({ day: d, ...statusOf(d) }));
  const tr = emaTrend(weights);
  const tFrom = trendOn(tr, addDays(from, -1)) ?? tr.find((r) => r.day >= from)?.trend ?? null;
  const tTo = trendOn(tr, to);
  const wk = weekNumber(c.startDate, to);
  const green = days.filter((d) => d.status === 'green').length;
  const yellow = days.filter((d) => d.status === 'yellow').length;
  const sched = days.filter((d) => isScheduled(d.session.kind));
  const done = sched.filter((d) => d.done).length;
  const sessions = workouts.filter((w) => w?.cut?.session && w.started_at.slice(0, 10) >= from && w.started_at.slice(0, 10) <= to);
  const strength = sessions.length ? avg(sessions.map((w) => STRENGTH[w.cut.session] ?? 0.8)) : null;
  const parts = [
    days.length ? (green + yellow * 0.5) / days.length : 0,
    sched.length ? done / sched.length : 1,
    checkinDone ? 1 : 0,
    ...(strength != null ? [strength] : []),
  ];
  const score = avg(parts);
  const f = (k) => avg(days.map((d) => d.facts[k]));
  return {
    from, to, week: wk, days: days.length, green, yellow,
    trendFrom: tFrom, trendTo: tTo, change: tFrom != null && tTo != null ? Math.round((tTo - tFrom) * 100) / 100 : null,
    target: start ? targetWeight(start, c.goalWeight, c.rate, wk) : null,
    kcal: f('kcal'), protein: f('p'), steps: f('steps'), sleep: f('sleep'),
    sessionsDone: done, sessionsPlanned: sched.length,
    strength, sessions: sessions.map((w) => w.cut.session),
    score, grade: gradeOf(score),
  };
}

// Main lift e1RM change over the last 2 weeks: the biggest drop, in % (positive = down), null without data.
export function liftChange(workouts = [], to) {
  const from = addDays(to, -13);
  let worst = null;
  for (const id of MAIN_LIFTS) {
    const ses = workouts.filter((w) => w?.ended_at && w.started_at.slice(0, 10) <= to)
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .map((w) => ({ day: w.started_at.slice(0, 10), e: (w.exercises || []).find((x) => x.exercise_id === id) }))
      .filter((x) => x.e).map((x) => ({ day: x.day, v: e1rmOf(workingSets(x.e.sets)) })).filter((x) => x.v > 0);
    const before = ses.filter((x) => x.day < from);
    const recent = ses.filter((x) => x.day >= from);
    if (!before.length || !recent.length) continue;
    const pct = (1 - recent[recent.length - 1].v / before[before.length - 1].v) * 100;
    if (worst == null || pct > worst) worst = Math.round(pct * 10) / 10;
  }
  return worst;
}

// Adjustment suggestions from 2 weeks of trend data (Part 1 "Automatic adjustment rules").
//   compliance: share of the last 14 days that were green or yellow (0–1)
//   targets: { kcal, steps }; liftDrop: % from liftChange; sleep: this week's average
// Returns [{ key, text, change? }] — change is what Accept applies: { kcal } / { steps } / { liftDayBonus }.
export function suggestions({ weights = [], checkinDay, week, compliance, targets = {}, cfg = {}, liftDrop = null, sleep = null }) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  const out = [];
  const tr = emaTrend(weights);
  const a = trendOn(tr, addDays(checkinDay, -15));
  const b = trendOn(tr, addDays(checkinDay, -1));
  if (a == null || b == null) {
    out.push({ key: 'data', text: 'Not enough weigh-ins for 2 weeks of trend yet — no change to targets.' });
  } else {
    const loss = (a - b) / 2;
    const lossTxt = `Losing ${loss.toFixed(2)} kg/week (2-week trend)`;
    if (loss < 0.5) {
      if (compliance < 0.85) out.push({ key: 'compliance', text: `${lossTxt} with ${Math.round(compliance * 100)}% compliance — no change to targets. Fix compliance first.` });
      else if ((targets.kcal || 0) <= 1650 || (targets.kcal || 0) - 100 < c.kcalFloor) out.push({ key: 'steps', text: `${lossTxt} at ${Math.round(compliance * 100)}% compliance: +2,000 steps a day (calories are already low).`, change: { steps: (targets.steps || c.steps) + 2000 } });
      else out.push({ key: 'kcal', text: `${lossTxt} at ${Math.round(compliance * 100)}% compliance: −100 kcal a day.`, change: { kcal: targets.kcal - 100 } });
    } else if (loss > 1 && week > 2) {
      out.push({ key: 'fast', text: `${lossTxt} — faster than planned: +150 kcal a day.`, change: { kcal: (targets.kcal || 0) + 150 } });
    } else {
      out.push({ key: 'ok', text: `${lossTxt} — on pace. No change.` });
    }
  }
  if (liftDrop != null && liftDrop > 5) out.push({ key: 'lifts', text: `A main lift is down ${liftDrop}% over 2 weeks: +150 kcal on lifting days, and check your sleep.`, change: { liftDayBonus: 150 } });
  if (sleep != null && sleep < 6.5) out.push({ key: 'sleep', text: `Average sleep ${sleep.toFixed(1)} h — sleep is this week's #1 fix.` });
  return out;
}

// The check-in day on or before `day` (null before the plan has a full week).
export function lastCheckinDay(day, checkinDay) {
  let d = day;
  for (let i = 0; i < 7; i++) {
    if (new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay() === +checkinDay) return d;
    d = addDays(d, -1);
  }
  return null;
}

// ---------- progress charts (Stats tab) ----------
// Weight chart from a week before the start to the end of the plan (or today if later):
// [{ day, kg (weigh-in or null), trend, projected, goal }].
export function weightChart(weights = [], cfg = {}, start = null, day) {
  const c = { ...CUT_DEFAULTS, ...cfg };
  if (!c.startDate) return [];
  const tr = emaTrend(weights);
  const byDay = new Map(tr.map((r) => [r.day, r]));
  const end = [addDays(c.startDate, 13 * 7 - 1), day].sort().pop();
  return range(addDays(c.startDate, -7), end).map((d) => {
    const w = byDay.get(d);
    const weeks = Math.max(0, (Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(+c.startDate.slice(0, 4), +c.startDate.slice(5, 7) - 1, +c.startDate.slice(8, 10))) / 6048e5);
    return {
      day: d, kg: w ? w.kg : null, trend: d <= day ? trendOn(tr, d) : null,
      projected: start > 0 && d >= c.startDate ? Math.round(Math.max(c.goalWeight, start - c.rate * weeks) * 100) / 100 : null,
      goal: c.goalWeight,
    };
  });
}

// Best-set e1RM per session for each main lift (weight × reps sets only; Pull-Up and Lat Pulldown together):
// { [label]: [{ day, e1rm }] }.
export const LIFT_LABELS = { Leverage_Chest_Press: 'Chest press', Standing_Military_Press: 'Overhead press', Dumbbell_Incline_Row: 'DB row', Pullups: 'Pull-up / pulldown', 'Wide-Grip_Lat_Pulldown': 'Pull-up / pulldown', Incline_Dumbbell_Press: 'Incline DB press' };
export function liftSeries(workouts = [], since = '') {
  const out = {};
  for (const w of [...workouts].filter((x) => x?.ended_at && x.started_at.slice(0, 10) >= since).sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    for (const e of w.exercises || []) {
      const label = LIFT_LABELS[e.exercise_id];
      if (!label || (e.mode && e.mode !== 'wr')) continue;
      const v = e1rmOf(workingSets(e.sets));
      if (v > 0) (out[label] ||= []).push({ day: w.started_at.slice(0, 10), e1rm: Math.round(v * 10) / 10 });
    }
  }
  return out;
}
