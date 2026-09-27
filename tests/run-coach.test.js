import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../docs/run-coach.js';
import { demoRuns, demoWorkouts, encodePolyline } from '../docs/run-demo.js';

const NOW = new Date(2026, 8, 27, 20, 0).getTime(); // Sunday 27 Sep 2026, 20:00 local
const DAY = 86400000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

let seq = 0;
// A steady run with per-km splits.
function mkRun({ daysAgo = 1, km = 8, pace = 360, hr = 145, hrDrift = 0, workout_type, name = 'Run', laps, splits, efforts, cadence, at } = {}) {
  const d = km * 1000;
  const n = Math.floor(km);
  const sp = splits || Array.from({ length: n }, (_, i) => ({ km: i + 1, d: 1000, s: pace, hr: hr ? hr + (hrDrift * i) / Math.max(1, n - 1) : undefined }));
  return {
    id: `r${++seq}`, name, start: new Date(at ?? NOW - daysAgo * DAY).toISOString(),
    distance_m: d, moving_s: Math.round(pace * km), avg_hr: hr || undefined, max_hr: hr ? hr + 12 : undefined,
    workout_type, splits: sp, laps, best_efforts: efforts, avg_cadence: cadence,
  };
}
// Interval session laps: warm-up, reps with jog recoveries, cool-down.
function intervalLaps(reps, repM, repPace, jogPace = 420) {
  const laps = [{ d: 2000, s: 2 * 360, hr: 140 }];
  for (let i = 0; i < reps; i++) {
    laps.push({ d: repM, s: Math.round((repM / 1000) * repPace), hr: 175 });
    if (i < reps - 1) laps.push({ d: 400, s: Math.round(0.4 * jogPace), hr: 150 });
  }
  laps.push({ d: 1500, s: 1.5 * 370, hr: 145 });
  return laps;
}

// ---------- VDOT maths ----------
test('VDOT matches Daniels tables', () => {
  near(C.vdotFromRace(5000, 19 * 60 + 57), 50, 0.3, '5k 19:57');
  near(C.vdotFromRace(10000, 41 * 60 + 21), 50, 0.3, '10k 41:21');
  near(C.vdotFromRace(42195, 3 * 3600 + 10 * 60 + 49), 50, 0.4, 'marathon 3:10:49');
  near(C.vdotFromRace(5000, 30 * 60 + 40), 30, 0.4, '5k 30:40');
  assert.equal(C.vdotFromRace(0, 100), null);
  assert.equal(C.vdotFromRace(5000, null), null);
});

test('raceTime inverts vdotFromRace', () => {
  near(C.raceTime(50, 5000), 1197, 4);
  near(C.raceTime(50, 10000), 2481, 8);
  near(C.vdotFromRace(10000, C.raceTime(43.3, 10000)), 43.3, 0.01);
  assert.equal(C.raceTime(null, 5000), null);
});

test('training paces at VDOT 50 match the tables (±5 s/km)', () => {
  const p = C.trainingPaces(50);
  near(p.marathon, 271, 5, 'M');
  near(p.threshold, 255, 5, 'T');
  near(p.interval, 235, 5, 'I');
  near(p.repetition, 221, 5, 'R');
  assert.ok(p.easy[0] < p.easy[1], 'easy range fast → slow');
  assert.ok(p.easy[0] > p.marathon && p.threshold > p.interval && p.interval > p.repetition);
  assert.equal(C.trainingPaces(null), null);
});

test('vdotFromEasyPace is the inverse of the easy range midpoint', () => {
  const v = C.vdotFromEasyPace(360);
  const e = C.trainingPaces(v).easy;
  near((e[0] + e[1]) / 2, 360, 0.5);
});

test('Riegel and formatting helpers', () => {
  near(C.riegel(1200, 5000, 10000), 1200 * 2 ** 1.06, 0.001);
  assert.equal(C.fmtPace(265), '4:25');
  assert.equal(C.fmtPace(299.6), '5:00');
  assert.equal(C.fmtPace(null), '–');
  assert.equal(C.fmtTime(3725), '1:02:05');
  assert.equal(C.fmtTime(1319), '21:59');
  assert.equal(C.paceRange([300, 330]), '5:00–5:30');
  assert.equal(C.kmShort(6), '6');
  assert.equal(C.kmShort(6.46), '6.5');
  assert.equal(C.paceOf({ distance_m: 5000, moving_s: 1500 }), 300);
  assert.equal(C.paceOf({ distance_m: 0, moving_s: 1500 }), null);
});

// ---------- fitness estimate ----------
test('estimateVdot uses the best recent effort and ignores old or glitchy ones', () => {
  const recent5k = mkRun({ daysAgo: 10, km: 8, pace: 330, efforts: [{ name: '5k', s: 1320, distance: 5000 }, { name: '1k', s: 200, distance: 1000 }] });
  const old = mkRun({ daysAgo: 80, km: 5, pace: 240, workout_type: 1 }); // a race, but > 8 weeks ago
  const glitch = mkRun({ daysAgo: 5, km: 6, pace: 360, efforts: [{ name: '1 mile', s: 150, distance: 1609.34 }] });
  const est = C.estimateVdot([recent5k, old, glitch], NOW);
  near(est.vdot, C.vdotFromRace(5000, 1320), 0.001);
  assert.equal(est.effort.name, '5k');
  assert.equal(C.estimateVdot([old], NOW), null);
  assert.ok(C.estimateVdot([old], NOW, 16));
  assert.equal(C.estimateVdot([], NOW), null);
});

test('easy runs alone do not count as fitness efforts', () => {
  const runs = [mkRun({ daysAgo: 3, km: 8, pace: 360 }), mkRun({ daysAgo: 5, km: 10, pace: 355 }), mkRun({ daysAgo: 8, km: 6, pace: 365 })];
  assert.equal(C.estimateVdot(runs, NOW), null);
  const ctx = C.buildContext({ runs, now: NOW });
  assert.equal(ctx.zoneSource, 'easy-runs');
  assert.ok(runs.every((r) => ctx.classOf(r).type === 'easy'));
});

test('vdotHistory gives one rolling value per week with data', () => {
  const runs = [mkRun({ daysAgo: 60, km: 5, pace: 300, workout_type: 1 }), mkRun({ daysAgo: 3, km: 5, pace: 280, workout_type: 1 })];
  const h = C.vdotHistory(runs, NOW, 12);
  assert.ok(h.length >= 8);
  assert.ok(h[h.length - 1].vdot > h[0].vdot);
});

test('predictions include a Riegel cross-check range', () => {
  const est = { vdot: C.vdotFromRace(10000, 2700), effort: { s: 2700, distance: 10000 } };
  const p = C.predictions(est);
  near(p.k10.s, 2700, 2);
  assert.ok(p.k5.lo <= p.k5.s && p.k5.hi >= p.k5.s);
  assert.equal(C.predictions(null), null);
});

test('max HR: setting, then data (2nd highest), then default', () => {
  const runs = [mkRun({ hr: 180 }), mkRun({ hr: 170 }), mkRun({ hr: 150 })]; // max_hr 192, 182, 162
  assert.deepEqual(C.estimateMaxHr(runs, 199), { hr: 199, source: 'setting' });
  assert.deepEqual(C.estimateMaxHr(runs, null), { hr: 182, source: 'data' });
  assert.equal(C.estimateMaxHr([], '').source, 'default');
  assert.equal(C.estimateMaxHr([], 'abc').hr, 190);
});

// ---------- classification ----------
const ctx50 = { paces: C.trainingPaces(45), vdot: 45, avgDist: 8000 };

test('classifyRun detects races, intervals, tempo, long, recovery and easy', () => {
  const P = ctx50.paces;
  assert.equal(C.classifyRun(mkRun({ workout_type: 1 }), ctx50).type, 'race');
  const iv = C.classifyRun(mkRun({ km: 9, pace: 330, laps: intervalLaps(5, 1000, P.interval) }), ctx50);
  assert.equal(iv.type, 'intervals');
  assert.equal(iv.reps.length, 5);
  const tempoSplits = [360, 360, P.threshold, P.threshold, P.threshold, P.threshold, 370].map((s, i) => ({ km: i + 1, d: 1000, s }));
  assert.equal(C.classifyRun(mkRun({ km: 7, pace: 330, splits: tempoSplits }), ctx50).type, 'tempo');
  assert.equal(C.classifyRun(mkRun({ km: 16, pace: P.easy[1] }), ctx50).type, 'long');
  assert.equal(C.classifyRun(mkRun({ km: 5, pace: P.easy[1] + 15 }), ctx50).type, 'recovery');
  assert.equal(C.classifyRun(mkRun({ km: 8, pace: (P.easy[0] + P.easy[1]) / 2 }), ctx50).type, 'easy');
  // A solo 5k at predicted race pace counts as a race effort.
  assert.equal(C.classifyRun(mkRun({ km: 5, pace: C.raceTime(45, 5000) / 5 }), ctx50).type, 'race');
});

test('classifyRun copes with missing splits, laps and paces', () => {
  const bare = { id: 'x', start: new Date(NOW).toISOString(), distance_m: 6000, moving_s: 2100 };
  assert.equal(C.classifyRun(bare, {}).type, 'easy');
  assert.equal(C.classifyRun(bare, ctx50).type, 'easy');
  assert.equal(C.classifyRun({ ...bare, distance_m: 20000, moving_s: 7200 }, {}).type, 'long');
});

test('intensityOf splits time into easy and hard', () => {
  const P = ctx50.paces;
  const run = mkRun({ km: 6, pace: 330, splits: [360, 360, P.threshold, P.threshold, 360, 360].map((s, i) => ({ km: i + 1, d: 1000, s })) });
  const it = C.intensityOf(run, { type: 'tempo' }, ctx50);
  near(it.hard, (2 * P.threshold / (4 * 360 + 2 * P.threshold)) * run.moving_s, 1);
  assert.deepEqual(C.intensityOf({ moving_s: 0 }, { type: 'easy' }, ctx50), { easy: 0, hard: 0 });
});

// ---------- feedback ----------
test('feedback: easy run too fast gets a slow-down tip', () => {
  const P = ctx50.paces;
  const fb = C.runFeedback(mkRun({ km: 8, pace: P.easy[0] - 30 }), ctx50);
  assert.ok(fb.some((f) => f.tone === 'tip' && /easy pace is/.test(f.text)), JSON.stringify(fb));
  const ok = C.runFeedback(mkRun({ km: 8, pace: (P.easy[0] + P.easy[1]) / 2 }), ctx50);
  assert.ok(ok.some((f) => f.tone === 'good' && /easy range/.test(f.text)));
});

test('feedback: PRs come first and output is capped at 4', () => {
  const run = mkRun({ km: 8, pace: 300, cadence: 150, hrDrift: 20, efforts: [{ name: '5k', s: 1450, distance: 5000, pr_rank: 1 }, { name: '1k', s: 280, distance: 1000, pr_rank: 1 }] });
  const fb = C.runFeedback(run, ctx50);
  assert.equal(fb[0].tone, 'pr');
  assert.match(fb[0].text, /5k in 24:10/);
  assert.ok(fb.length <= 4);
});

test('feedback: intervals report rep pace against target and fading', () => {
  const P = ctx50.paces;
  const laps = intervalLaps(5, 1000, P.interval);
  laps[laps.length - 2].s = Math.round(P.interval * 1.08); // last rep slower
  const fb = C.runFeedback(mkRun({ km: 9, laps }), ctx50);
  assert.ok(fb.some((f) => /5 × 1 km averaging/.test(f.text)), JSON.stringify(fb));
  assert.ok(fb.some((f) => /last rep was/.test(f.text)));
});

test('feedback: HR drift and pacing on a long run', () => {
  const P = ctx50.paces;
  const drift = C.runFeedback(mkRun({ km: 16, pace: P.easy[1], hr: 140, hrDrift: 25 }), ctx50);
  assert.ok(drift.some((f) => /drifted/.test(f.text)), JSON.stringify(drift));
  const steady = C.runFeedback(mkRun({ km: 16, pace: P.easy[1], hr: 140, hrDrift: 1 }), ctx50);
  assert.ok(steady.some((f) => /steady relative to pace/.test(f.text)));
  const neg = [380, 375, 370, 365, 350, 345, 340, 335].map((s, i) => ({ km: i + 1, d: 1000, s }));
  assert.ok(C.runFeedback(mkRun({ km: 8, pace: 357, splits: neg }), ctx50).some((f) => /Negative split/.test(f.text)));
});

test('feedback works with no HR, no splits and no paces', () => {
  const bare = { id: 'b', start: new Date(NOW).toISOString(), distance_m: 5000, moving_s: 1800 };
  assert.ok(Array.isArray(C.runFeedback(bare, {})));
  assert.ok(C.runFeedback(bare, ctx50).length >= 1);
});

// ---------- gym interaction ----------
const legDay = (hoursBeforeNow) => ({
  id: 'g', started_at: new Date(NOW - (hoursBeforeNow + 1) * 3600e3).toISOString(), ended_at: new Date(NOW - hoursBeforeNow * 3600e3).toISOString(),
  exercises: [{ exercise_id: 'Barbell_Full_Squat', name: 'Barbell Full Squat', sets: [{ type: 'w' }, { type: 'n' }, { type: 'n' }, { type: 'n' }, { type: 'n' }] },
    { exercise_id: 'Leg_Press', name: 'Leg Press', sets: [{ type: 'n' }, { type: 'n' }] }],
});
test('leg-day detection', () => {
  assert.equal(C.legSets(legDay(5)), 6);
  assert.ok(C.legDayBefore(NOW, [legDay(20)]));
  assert.equal(C.legDayBefore(NOW, [legDay(40)]), null);
  assert.equal(C.legDayBefore(NOW, [{ ...legDay(5), exercises: [{ name: 'Bench Press', sets: Array(10).fill({ type: 'n' }) }] }]), null);
  assert.equal(C.legSets(legDay(5), () => false), 0);
  assert.ok(C.isLegByName({ exercise_id: 'Romanian_Deadlift' }));
});

test('hard run after heavy leg day gets a scheduling tip', () => {
  const P = ctx50.paces;
  const run = mkRun({ at: NOW, km: 9, laps: intervalLaps(5, 1000, P.interval) });
  const fb = C.runFeedback(run, { ...ctx50, workouts: [legDay(15)] });
  assert.ok(fb.some((f) => /leg session/.test(f.text)), JSON.stringify(fb));
});

// ---------- weekly review ----------
function weeksOfRuns(kmPerWeek, weeks, runsPerWeek = 3) {
  const out = [];
  for (let w = weeks; w >= 1; w--) for (let i = 0; i < runsPerWeek; i++) out.push(mkRun({ daysAgo: w * 7 + i * 2 - 6, km: kmPerWeek / runsPerWeek, pace: 360 }));
  return out;
}

test('weekly review: steady training gives a streak and no load warning', () => {
  const ctx = C.buildContext({ runs: weeksOfRuns(24, 8), now: NOW });
  assert.equal(ctx.review.weeks.length, 12);
  assert.equal(ctx.review.load, 'ok');
  assert.ok(ctx.review.streak >= 3);
  assert.ok(ctx.review.messages.some((m) => /weeks in a row/.test(m.text)));
});

test('weekly review: load spike is flagged and the plan backs off', () => {
  const runs = [...weeksOfRuns(15, 6), mkRun({ daysAgo: 1, km: 14 }), mkRun({ daysAgo: 2, km: 12 }), mkRun({ daysAgo: 3, km: 12 }), mkRun({ daysAgo: 4, km: 10 })];
  const ctx = C.buildContext({ runs, now: NOW });
  assert.equal(ctx.review.load, 'high');
  assert.equal(ctx.review.messages[0].tone, 'warn');
  assert.ok(!ctx.nextPlan.sessions.some((s) => s.type === 'intervals'));
  assert.ok(ctx.nextPlan.deload);
});

test('weekly review: too much hard running triggers the 80/20 tip', () => {
  const P = C.trainingPaces(45);
  const runs = [];
  for (let d = 1; d <= 26; d += 2) runs.push(mkRun({ daysAgo: d, km: 6, pace: P.threshold, hr: 172 }));
  runs.push(mkRun({ daysAgo: 20, km: 5, pace: C.raceTime(45, 5000) / 5, workout_type: 1 }));
  const ctx = C.buildContext({ runs, now: NOW, settings: { max_hr: 190 } });
  assert.ok(ctx.review.easyShare < 0.7);
  assert.ok(ctx.review.messages.some((m) => /80 % easy/.test(m.text)));
});

// ---------- plan ----------
test('plan has the right sessions for 3–6 runs a week and a modest increase', () => {
  const runs = weeksOfRuns(30, 6, 4);
  for (const n of [3, 4, 5, 6]) {
    for (const focus of ['5k', '10k']) {
      const ctx = C.buildContext({ runs, now: NOW, settings: { runs_per_week: n, focus } });
      const p = ctx.nextPlan;
      assert.equal(p.sessions.length, n);
      assert.equal(p.sessions.filter((s) => s.type === 'long').length, 1);
      const hard = p.sessions.filter((s) => s.hard).length;
      assert.equal(hard, n === 3 ? 1 : 2);
      assert.ok(p.targetKm <= p.base + 7, `target ${p.targetKm} vs base ${p.base}`);
      assert.ok(p.sessions.every((s) => s.km >= 3 && s.detail && s.day));
      // hard days never back to back
      const idx = p.sessions.filter((s) => s.hard).map((s) => s.dayIdx);
      for (let i = 1; i < idx.length; i++) assert.ok(idx[i] - idx[i - 1] >= 2);
    }
  }
});

test('plan for a beginner with no history still works', () => {
  const ctx = C.buildContext({ runs: [], now: NOW, settings: { runs_per_week: 3 } });
  assert.equal(ctx.paces, null);
  assert.equal(ctx.plan.sessions.length, 3);
  assert.match(ctx.plan.sessions[0].detail, /hard but controlled|comfortably hard/);
  assert.ok(ctx.today.title);
  assert.equal(ctx.est, null);
});

test('plan marks this week\'s runs as done and today reflects it', () => {
  const runs = [...weeksOfRuns(24, 4), mkRun({ at: NOW - 2 * 3600e3, km: 8 })];
  const ctx = C.buildContext({ runs, now: NOW, settings: { runs_per_week: 4 } });
  assert.ok(ctx.plan.sessions.some((s) => s.done));
  assert.equal(ctx.today.kind, 'done');
});

test('today: after a hard run yesterday, suggest an easy session', () => {
  const P = C.trainingPaces(45);
  const wed = new Date(2026, 8, 23, 19).getTime(); // Wednesday evening
  const runs = [...weeksOfRuns(24, 4).map((r) => ({ ...r, start: new Date(Date.parse(r.start) - 5 * DAY).toISOString() })),
    mkRun({ at: wed - DAY, km: 9, laps: intervalLaps(5, 1000, P.interval) })];
  const ctx = C.buildContext({ runs, now: wed, settings: { runs_per_week: 4 } });
  const t = ctx.today;
  assert.ok(t.kind === 'rest' || (t.session && !t.session.hard), JSON.stringify(t));
});

// ---------- records & trends ----------
test('personal records pick the fastest effort per distance', () => {
  const a = mkRun({ daysAgo: 30, efforts: [{ name: '5k', s: 1500, distance: 5000 }] });
  const b = mkRun({ daysAgo: 3, efforts: [{ name: '5k', s: 1450, distance: 5000 }, { name: '1k', s: 270, distance: 1000 }] });
  const prs = C.personalRecords([a, b]);
  assert.equal(prs.find((p) => p.name === '5k').best.s, 1450);
  assert.equal(prs.find((p) => p.name === '5k').best.run_id, b.id);
  assert.equal(prs.find((p) => p.name === 'Half-Marathon').best, null);
});

test('easy pace trend detects improvement at the same heart rate', () => {
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push(mkRun({ daysAgo: 70 - i * 7, km: 8, pace: 380 - i * 2, hr: 140 }));
  const ctx = C.buildContext({ runs, now: NOW, settings: { max_hr: 190 } });
  const tr = C.easyPaceTrend(ctx);
  assert.equal(tr.points.length, 10);
  assert.ok(tr.slope < -5, `slope ${tr.slope}`);
});

// ---------- demo data ----------
test('demo data is deterministic, realistic and fully usable', () => {
  const a = demoRuns(NOW), b = demoRuns(NOW);
  assert.deepEqual(a.map((r) => r.moving_s), b.map((r) => r.moving_s));
  assert.ok(a.length > 60);
  assert.ok(a.every((r) => Date.parse(r.start) <= NOW && r.splits.length && r.best_efforts.length && r.polyline));
  const ctx = C.buildContext({ runs: a, workouts: demoWorkouts(NOW), now: NOW });
  assert.ok(ctx.vdot > 40 && ctx.vdot < 50, `vdot ${ctx.vdot}`);
  const types = new Set(a.map((r) => ctx.classOf(r).type));
  for (const t of ['easy', 'long', 'intervals', 'tempo', 'race']) assert.ok(types.has(t), `missing ${t}`);
  for (const r of a.slice(0, 20)) assert.ok(C.runFeedback(r, ctx).length >= 1);
});

test('polyline encoding round-trips the reference example', () => {
  // Example from Google's polyline algorithm documentation.
  assert.equal(encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});
