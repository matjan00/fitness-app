// Stats tab: the numbers behind the summary cards and the newer charts (trend, rate of loss, maintenance, protein,
// strength kept, sets per muscle, PRs, habits, weekly plan, running, training load, the weekly story).
// Pure: no DOM, no store - everything comes in as arguments. Tests: tests/stats-insights.test.js.
// Days are local 'YYYY-MM-DD' strings; weeks start on Monday.

import { addDays, weekOf, dayList } from './stats-calc.js';
import { emaTrend, trendOn, daysBetween } from './cut-calc.js';

const pad = (n) => String(n).padStart(2, '0');
// The local calendar day of an ISO time (a workout at 00:30 belongs to that night's date, not the UTC one).
export const localDay = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---------- weight ----------
// One row per calendar day of the range (days without a weigh-in keep their place, so gaps look like gaps):
// [{ day, kg|null, trend|null, plan|null }]. planOf(day) → planned weight or null.
export function weightDays(entries = [], end, days, planOf = () => null) {
  const tr = emaTrend(entries);
  const kg = new Map(tr.map((r) => [r.day, r.kg]));
  return dayList(end, days).map((day) => ({ day, kg: kg.get(day) ?? null, trend: trendOn(tr, day), plan: planOf(day) }));
}

// Rate of change of the trend: kg per week over the last 2 and 4 weeks, and as % of body weight per week.
// null until there is a trend 14 days back.
export function lossRate(entries = [], day) {
  const tr = emaTrend(entries);
  const now = trendOn(tr, day);
  const at = (n) => (tr.length && tr[0].day <= addDays(day, -n) ? trendOn(tr, addDays(day, -n)) : null);
  const w2 = at(14), w4 = at(28);
  if (now == null || w2 == null) return { trend: now, kg2: null, kg4: null, pct: null };
  const kg2 = r2((now - w2) / 2);
  const kg4 = w4 == null ? null : r2((now - w4) / 4);
  const ref = kg4 ?? kg2;
  return { trend: now, kg2, kg4, pct: r2((ref / now) * 100) };
}

// When the trend reaches `goal` at `kgPerWeek` (negative = losing): 'YYYY-MM-DD', or null when not heading there.
export function goalDate(trend, kgPerWeek, goal, day) {
  if (!(trend > 0) || !(goal > 0) || !kgPerWeek) return null;
  if (Math.abs(trend - goal) < 0.05) return day;
  if ((goal - trend) / kgPerWeek <= 0) return null;
  const weeks = (goal - trend) / kgPerWeek;
  return weeks > 104 ? null : addDays(day, Math.ceil(weeks * 7));
}

// ---------- food ----------
// Per-day calories and macros from factsOf(day) → { kcal, p, c, f } (the diary, or what was typed in the cut
// checklist; same source as the plan). [{ day, kcal, p, c, f, logged }].
export function nutritionDays(end, days, factsOf) {
  return dayList(end, days).map((day) => {
    const f = factsOf(day) || {};
    const logged = f.kcal > 0 || f.p > 0;
    return { day, kcal: +f.kcal || 0, p: +f.p || 0, c: +f.c || 0, f: +f.f || 0, logged };
  });
}

// Protein over logged days: { avg g, perKg (g per kg of trend weight), hit (days ≥ target), days }.
export function proteinSummary(rows, target, kg) {
  const l = rows.filter((r) => r.logged);
  if (!l.length) return null;
  const avg = mean(l.map((r) => r.p));
  return { avg: Math.round(avg), perKg: kg > 0 ? r1(avg / kg) : null, hit: target > 0 ? l.filter((r) => r.p >= target).length : null, days: l.length };
}

// Weekly intake vs learned maintenance: [{ week, intake|null, tdee|null }]. tdeeOf(day) → { tdee } | null.
export function maintenanceWeeks(weeks, rows, tdeeOf, today) {
  return weeks.map((w) => {
    const days = rows.filter((r) => r.logged && r.day >= w && r.day <= addDays(w, 6));
    const end = addDays(w, 6) < today ? addDays(w, 6) : today;
    return { week: w, intake: days.length ? Math.round(mean(days.map((r) => r.kcal))) : null, tdee: tdeeOf(end)?.tdee ?? null };
  });
}

// ---------- gym ----------
// One exercise entry in one session: best estimated 1RM (Epley, no rep cap - a 15-rep crunch set still has a
// number, and the same formula every session keeps the trend fair), best reps and best seconds of the working sets.
// Bodyweight exercises count body weight + added kg; without a known body weight they only have reps.
function entryBest(e, bodyKg) {
  const mode = e.mode || 'wr';
  const out = { e1rm: 0, reps: 0, secs: 0, done: false };
  for (const s of e.sets || []) {
    if (!s || s.type === 'w') continue;
    const reps = Number(s.reps) || 0, secs = Number(s.secs) || 0;
    if (!(reps > 0) && !(secs > 0)) continue;
    out.done = true;
    out.reps = Math.max(out.reps, reps);
    out.secs = Math.max(out.secs, secs);
    if (mode === 't' || !(reps > 0)) continue;
    const kg = mode === 'bw' ? (bodyKg > 0 ? bodyKg + (Number(s.kg) || 0) : 0) : Number(s.kg) || 0;
    if (kg > 0) out.e1rm = Math.max(out.e1rm, reps === 1 ? kg : kg * (1 + reps / 30));
  }
  return out;
}

// Every exercise trained since `since`, with its progress per session and the change from the first session:
// [{ id, unit, sessions: [{ day, value }], n, change (%), bw }]. unit is 'kg' (estimated 1RM) when the exercise was
// ever done with a load, else 'reps' or 's' (timed); sessions holds the days that have that number, n counts every
// session trained (a 0 kg or no-weigh-in day still counts as done). bodyOn(day) → body weight (for pull-ups and dips).
// Bodyweight lifts use the body weight of their first session throughout, so losing weight on a cut does not read
// as losing strength - only more reps or more added kg move them.
// Only exercises done in at least `minSessions` sessions; at most `limit`, most-trained first.
export function strengthKept(workouts = [], since, bodyOn = () => null, limit = 5, minSessions = 2) {
  const by = new Map();
  const list = workouts.filter((w) => w?.started_at && localDay(w.started_at) >= since).sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const w of list) {
    const day = localDay(w.started_at);
    for (const e of w.exercises || []) {
      let row = by.get(e.exercise_id);
      if (!row) { row = { id: e.exercise_id, days: [], bw: e.mode === 'bw', body: null, timed: e.mode === 't' }; by.set(e.exercise_id, row); }
      if (row.bw && !(row.body > 0)) row.body = bodyOn(day);
      const v = entryBest(e, row.body);
      if (!v.done) continue;
      const last = row.days[row.days.length - 1];
      if (last?.day === day) { last.e1rm = Math.max(last.e1rm, v.e1rm); last.reps = Math.max(last.reps, v.reps); last.secs = Math.max(last.secs, v.secs); }
      else row.days.push({ day, e1rm: v.e1rm, reps: v.reps, secs: v.secs });
    }
  }
  return [...by.values()].filter((r) => r.days.length >= minSessions)
    .sort((a, b) => b.days.length - a.days.length).slice(0, limit)
    .map(({ id, days, bw, timed }) => {
      const [unit, key] = days.some((d) => d.e1rm > 0) ? ['kg', 'e1rm'] : timed || !days.some((d) => d.reps > 0) ? ['s', 'secs'] : ['reps', 'reps'];
      const sessions = days.filter((d) => d[key] > 0).map((d) => ({ day: d.day, value: r1(d[key]) }));
      const first = sessions[0]?.value, last = sessions[sessions.length - 1]?.value;
      return { id, unit, sessions, n: days.length, bw, change: first > 0 ? r1(((last - first) / first) * 100) : null };
    });
}

// Hard (working) sets per muscle group per week, averaged over the range: [{ group, sets }] most first.
export function setsPerMuscle(workouts = [], groupsOf, from, to) {
  const out = {};
  for (const w of workouts) {
    const d = w?.started_at && localDay(w.started_at);
    if (!d || d < from || d > to) continue;
    for (const e of w.exercises || []) {
      const n = (e.sets || []).filter((s) => s && s.type !== 'w').length;
      if (n) for (const g of groupsOf(e.exercise_id) || []) out[g] = (out[g] || 0) + n;
    }
  }
  const weeks = Math.max(1, (daysBetween(from, to) + 1) / 7);
  return Object.entries(out).map(([group, n]) => ({ group, sets: r1(n / weeks) })).sort((a, b) => b.sets - a.sets);
}

// Records set since `from`: one row per exercise - its newest record (e1RM before weight before reps), how much it
// improved on the best before the range, and how many sessions set a record. Newest first.
// prsByWorkout is gym-calc computePRs(workouts) (Map workout id → [PR]). [{ day, exercise_id, kind, value, prev, n }].
export function recentPRs(workouts = [], prsByWorkout, from, limit = 8) {
  const rank = { e1rm: 0, kg: 1, reps: 2, secs: 3, vol: 4 };
  const out = [];
  for (const w of workouts) {
    const day = w?.started_at && localDay(w.started_at);
    if (!day || day < from) continue;
    const best = new Map();
    for (const p of prsByWorkout.get(w.id) || []) {
      const cur = best.get(p.exercise_id);
      if (!cur || rank[p.kind] < rank[cur.kind]) best.set(p.exercise_id, p);
    }
    for (const p of best.values()) out.push({ day, exercise_id: p.exercise_id, kind: p.kind, value: p.value, prev: p.prev });
  }
  out.sort((a, b) => a.day.localeCompare(b.day));
  const per = new Map();
  for (const p of out) {
    const cur = per.get(p.exercise_id);
    // keep the newest record of the best kind; "prev" stays the value before the first record in the range
    if (!cur) per.set(p.exercise_id, { ...p, n: 1 });
    else per.set(p.exercise_id, { ...(rank[p.kind] <= rank[cur.kind] ? { ...p, prev: cur.kind === p.kind ? cur.prev : p.prev } : cur), n: cur.n + 1 });
  }
  return [...per.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
}

// ---------- habits ----------
// Steps and sleep from factsOf(day) → { steps, sleep }: averages over the days that have them.
export function habits(end, days, factsOf, stepGoal = 10000) {
  const f = dayList(end, days).map((d) => factsOf(d) || {});
  const steps = f.map((x) => x.steps).filter((x) => x > 0);
  const sleep = f.map((x) => x.sleep).filter((x) => x > 0);
  return {
    steps: steps.length ? Math.round(mean(steps)) : null, stepDays: steps.length, stepsHit: steps.filter((x) => x >= stepGoal).length,
    sleep: sleep.length ? r1(mean(sleep)) : null, sleepDays: sleep.length, sleep7: sleep.filter((x) => x >= 7).length,
  };
}

// ---------- running ----------
// Per week: km, minutes, runs and the average pace (s/km) of the EASY runs only - interval, tempo, race and long
// runs are left out so the pace line shows easy-running fitness, not the mix of run types. typeOf(run) is the Run
// tab's classification ('easy' | 'recovery' | 'long' | 'tempo' | 'intervals' | 'race' | 'workout'); without it long
// runs (≥ 1.3 × the usual distance, at least 9 km) are the only ones left out. [{ week, km, min, runs, pace|null }].
export function runWeeks(runs = [], weeks, typeOf = null) {
  const ok = runs.filter((r) => r?.start && +r.distance_m > 500 && (+r.moving_s || +r.elapsed_s) > 0 && localDay(r.start));
  const dists = ok.map((r) => +r.distance_m).sort((a, b) => a - b);
  const median = dists.length ? dists[Math.floor(dists.length / 2)] : 0;
  const isLong = (r) => +r.distance_m >= Math.max(9000, median * 1.3);
  return weeks.map((w) => {
    const rs = ok.filter((r) => weekOf(localDay(r.start)) === w);
    const easy = rs.filter((r) => (typeOf ? ['easy', 'recovery'].includes(typeOf(r)) : !isLong(r)));
    const secs = (r) => +r.moving_s || +r.elapsed_s;
    const pace = easy.length ? Math.round(easy.reduce((s, r) => s + secs(r), 0) / easy.reduce((s, r) => s + +r.distance_m / 1000, 0)) : null;
    return { week: w, km: r1(rs.reduce((s, r) => s + +r.distance_m / 1000, 0)), min: Math.round(rs.reduce((s, r) => s + secs(r), 0) / 60), runs: rs.length, pace };
  });
}

// ---------- training load ----------
// Minutes trained (gym sessions + runs) in the last 7 days vs the weekly average of the 4 weeks before.
// { last7, usual, ratio } - ratio > 1.3 means a lot more than usual, < 0.8 a lot less. null without history.
export function trainingLoad(workouts = [], runs = [], day) {
  const mins = new Map();
  const add = (d, m) => { if (d && m > 0) mins.set(d, (mins.get(d) || 0) + m); };
  for (const w of workouts) if (w?.started_at && w.ended_at) add(localDay(w.started_at), Math.min(180, (Date.parse(w.ended_at) - Date.parse(w.started_at)) / 60000));
  for (const r of runs) if (r?.start) add(localDay(r.start), (+r.moving_s || +r.elapsed_s || 0) / 60);
  const sum = (from, to) => [...mins].filter(([d]) => d >= from && d <= to).reduce((s, [, m]) => s + m, 0);
  const last7 = sum(addDays(day, -6), day);
  const before = sum(addDays(day, -34), addDays(day, -7));
  if (!(before > 0)) return null;
  const usual = before / 4;
  return { last7: Math.round(last7), usual: Math.round(usual), ratio: r2(last7 / usual) };
}

// ---------- this week vs last week ----------
// src: { rows (nutritionDays covering both weeks), weights, training(weekStart) → { lift, run, goal } }.
// { now: { kcal, p, trend, lift, run }, prev: {...}, delta: { kcal, p, trend } } - the current week counts days so far.
export function weekVsLast(day, { rows = [], weights = [], training = () => ({}) } = {}) {
  const tr = emaTrend(weights);
  const one = (from, to) => {
    const l = rows.filter((r) => r.logged && r.day >= from && r.day <= to);
    const t = training(from);
    const a = trendOn(tr, addDays(from, -1)), b = trendOn(tr, to);
    return { kcal: l.length ? Math.round(mean(l.map((r) => r.kcal))) : null, p: l.length ? Math.round(mean(l.map((r) => r.p))) : null,
      trend: a != null && b != null ? r2(b - a) : null, lift: t.lift ?? 0, run: t.run ?? 0, goal: t.goal || { lift: 3, run: 2 } };
  };
  const wk = weekOf(day);
  const now = one(wk, day);
  const prev = one(addDays(wk, -7), addDays(wk, -1));
  const d = (k) => (now[k] != null && prev[k] != null ? r2(now[k] - prev[k]) : null);
  return { now, prev, delta: { kcal: d('kcal'), p: d('p') } };
}

// The week in one sentence, e.g. "Trend −0.6 kg · deficit ~650 kcal/day · protein 6/7 days · Bench +1%".
export function weekStory({ week, deficit = null, proteinHit = null, proteinDays = null, lift = null } = {}) {
  const parts = [];
  if (week?.trend != null) parts.push(`Trend ${week.trend > 0 ? '+' : week.trend < 0 ? '−' : '±'}${Math.abs(week.trend).toFixed(1)} kg`);
  if (deficit != null) parts.push(deficit >= 0 ? `deficit ~${Math.round(deficit / 10) * 10} kcal/day` : `surplus ~${Math.round(-deficit / 10) * 10} kcal/day`);
  if (proteinHit != null && proteinDays) parts.push(`protein ${proteinHit}/${proteinDays} days`);
  if (week) parts.push(`gym ${week.lift}/${week.goal.lift} · runs ${week.run}/${week.goal.run}`);
  if (lift) parts.push(`${lift.name} ${lift.change > 0 ? '+' : ''}${lift.change}%`);
  return parts.join(' · ');
}
