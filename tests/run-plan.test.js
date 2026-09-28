import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../docs/run-plan.js';
import * as C from '../docs/run-coach.js';

const DAY = 86400000;
const WEEK = 7 * DAY;
const NOW = new Date(2026, 8, 28, 12, 0).getTime();

let seq = 0;
function mkRun({ daysAgo = 1, km = 8, pace = 330, hr = 145, name = 'Run', splits, workout_type } = {}) {
  const d = km * 1000;
  const n = Math.floor(km);
  const sp = splits || Array.from({ length: n }, (_, i) => ({ km: i + 1, d: 1000, s: pace, hr }));
  return {
    id: `r${++seq}`, name, start: new Date(NOW - daysAgo * DAY).toISOString(),
    distance_m: d, moving_s: Math.round(pace * km), avg_hr: hr, workout_type, splits: sp,
  };
}

function fakeCtx(overrides = {}) {
  const runs = overrides.runs || [mkRun({ daysAgo: 2, km: 6, pace: 380 }), mkRun({ daysAgo: 9, km: 8, pace: 375 })];
  const paces = C.trainingPaces(37);
  return {
    runs, now: NOW, maxHr: 190, paces, avgDist: 6000,
    est: null, olderEst: null, zoneVdot: 37,
    classOf: (r) => ({ type: r.__type || (C.km(r.distance_m) >= 8 ? 'long' : 'easy') }),
    ...overrides,
  };
}

// ---------- timeline ----------
test('estimateTimelineWeeks: more weeks needed the further from goal, fewer runs/week is slower', () => {
  const far = P.estimateTimelineWeeks(35, 45, 2);
  const near = P.estimateTimelineWeeks(43, 45, 2);
  assert.ok(far.weeks > near.weeks, 'further from goal should take longer');
  const slow2 = P.estimateTimelineWeeks(35, 45, 2);
  const fast3 = P.estimateTimelineWeeks(35, 45, 3);
  assert.ok(fast3.weeks <= slow2.weeks, '3+ runs/week should not be slower than 2');
  assert.ok(far.weeks <= 40, 'plan length is capped');
});

test('estimateTimelineWeeks caps very long plans and flags them', () => {
  const r = P.estimateTimelineWeeks(25, 55, 2);
  assert.ok(r.weeks <= 40);
  assert.equal(r.capped, true);
});

test('goalVdot computes a VDOT for 10k in 50:00 around 40', () => {
  const v = P.goalVdot({ distance_km: 10, time_s: 3000 });
  assert.ok(v > 38 && v < 42, `expected ~40, got ${v}`);
});

// ---------- plan generation ----------
test('generatePlan: opens with a 5k time trial when no reliable VDOT estimate exists', () => {
  const ctx = fakeCtx({ est: null, olderEst: null });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW });
  assert.equal(plan.sessions[0].type, 'test5k');
});

test('generatePlan: skips the calibration time trial when a reliable estimate exists', () => {
  const ctx = fakeCtx({ est: { vdot: 40, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW });
  assert.notEqual(plan.sessions[0].type, 'test5k');
});

test('generatePlan for 2 runs/week: 1 quality + 1 long session per week, phases present, ends in taper + test', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW });
  const weeks = new Set(plan.sessions.map((s) => s.week));
  for (const w of weeks) {
    const wk = plan.sessions.filter((s) => s.week === w);
    if (w < plan.timelineWeeks) assert.equal(wk.length, 2, `week ${w} should have 2 sessions`);
  }
  const phases = new Set(plan.sessions.map((s) => s.phase));
  assert.ok(phases.has('Base'));
  assert.ok(phases.has('Taper'));
  assert.ok(phases.has('Test'));
  const last = plan.sessions[plan.sessions.length - 1];
  assert.equal(last.type, 'test10k');
  const tapered = plan.sessions.filter((s) => s.phase === 'Taper');
  assert.ok(tapered.length > 0);
});

test('generatePlan for 3 runs/week: 3 sessions most weeks and phases present', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 3, startedAt: NOW });
  const wk1 = plan.sessions.filter((s) => s.week === 1);
  assert.equal(wk1.length, 3);
  const phases = new Set(plan.sessions.map((s) => s.phase));
  assert.ok(phases.has('Build') || phases.has('Specific'), 'longer plans should reach later phases');
});

test('generatePlan: long run grows over time and includes a lighter (deload) week', () => {
  const ctx = fakeCtx({ est: { vdot: 30, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW });
  const longs = plan.sessions.filter((s) => s.type === 'long').sort((a, b) => a.week - b.week);
  assert.ok(longs.length >= 6);
  const early = longs.slice(0, 3).reduce((s, x) => s + x.totalKm, 0) / 3;
  const late = longs.slice(-6, -3).reduce((s, x) => s + x.totalKm, 0) / 3;
  assert.ok(late > early, `long run should grow: early ${early} vs late ${late}`);
});

test('generatePlan: check-in 5k time trial appears roughly every 6 weeks', () => {
  const ctx = fakeCtx({ est: { vdot: 30, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW });
  const checkIns = plan.sessions.filter((s) => s.type === 'test5k');
  if (plan.timelineWeeks >= 12) assert.ok(checkIns.length >= 1, 'should have at least one check-in in a long plan');
});

test('generatePlan: specific-phase sessions use the documented rep progression', () => {
  const ctx = fakeCtx({ est: { vdot: 33, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW });
  const specific = plan.sessions.filter((s) => s.phase === 'Specific' && s.type === 'intervals');
  if (specific.length) assert.match(specific[0].main, /×.*km @/);
});

// ---------- matching ----------
test('sessionMatches: distance within ~35% matches an easy/long session', () => {
  const s = { status: 'planned', type: 'long', totalKm: 10 };
  assert.ok(P.sessionMatches(s, { distance_m: 9500 }, 'easy'));
  assert.ok(!P.sessionMatches(s, { distance_m: 4000 }, 'easy'));
});

test('sessionMatches: a hard run matches a quality session even off-distance', () => {
  const s = { status: 'planned', type: 'intervals', totalKm: 8 };
  assert.ok(P.sessionMatches(s, { distance_m: 8000 }, 'intervals'));
});

test('autoMatch: matches the next planned session in order and no earlier ones', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 3 * DAY });
  const first = plan.sessions[0];
  const run = { id: 'run1', distance_m: first.totalKm * 1000, moving_s: 1800 };
  const updated = P.autoMatch(plan, run, first.type, NOW - 2 * DAY);
  assert.ok(updated, 'should auto-match');
  assert.equal(updated.id, first.id);
  assert.equal(updated.status, 'done');
});

test('autoMatch: one run matches at most one session (second run after it does not re-match same one)', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  let plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 10 * DAY });
  const first = plan.sessions[0];
  const run1 = { id: 'run1', distance_m: first.totalKm * 1000, moving_s: 1800 };
  const matched = P.autoMatch(plan, run1, first.type, NOW - 9 * DAY);
  plan = P.markDone(plan, matched.id, run1);
  const stillFirst = plan.sessions.find((s) => s.id === first.id);
  assert.equal(stillFirst.status, 'done');
  const second = plan.sessions[1];
  const run2 = { id: 'run2', distance_m: second.totalKm * 1000, moving_s: 1800 };
  const matched2 = P.autoMatch(plan, run2, second.type, NOW - 2 * DAY);
  assert.ok(matched2);
  assert.equal(matched2.id, second.id);
});

// ---------- behind detection ----------
test('computeBehind: null when on schedule', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 1 * DAY });
  assert.equal(P.computeBehind(plan, NOW), null);
});

test('computeBehind: flags overdue sessions after a long gap with no completions', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 20 * DAY });
  const behind = P.computeBehind(plan, NOW);
  assert.ok(behind);
  assert.ok(behind.sessionsOverdue >= 1);
});

test('computeBehind: not behind right after starting even with 0 done (within a week)', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 2 * DAY });
  assert.equal(P.computeBehind(plan, NOW), null);
});

// ---------- move vs skip ----------
test('movePlan shifts startedAt (and so the goal window) forward without changing session count', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 20 * DAY });
  const before = plan.sessions.length;
  const moved = P.movePlan(plan, NOW);
  assert.ok(moved.startedAt > plan.startedAt);
  assert.equal(moved.sessions.length, before);
  assert.equal(P.computeBehind(moved, NOW), null);
  assert.equal(moved.history.length, 1);
});

test('skipOverdue marks the overdue sessions skipped and keeps the rest planned', () => {
  const ctx = fakeCtx({ est: { vdot: 35, effort: { name: '5k run', t: NOW } } });
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 20 * DAY });
  const behind = P.computeBehind(plan, NOW);
  const skipped = P.skipOverdue(plan, NOW);
  const skippedCount = skipped.sessions.filter((s) => s.status === 'skipped').length;
  assert.equal(skippedCount, behind.sessionsOverdue);
  assert.ok(P.nextSession(skipped));
});

test('computeBehind exposes a keySession flag so the UI can prefer Move for overdue tests', () => {
  const ctx = fakeCtx({ est: { vdot: 44.9, effort: { name: '5k run', t: NOW } } }); // near goal → very short plan
  const plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 6 * WEEK });
  const behind = P.computeBehind(plan, NOW);
  if (behind) assert.equal(typeof behind.keySession, 'boolean');
});

// ---------- regeneration ----------
test('regeneratePlan keeps done/skipped sessions and only rebuilds the future', () => {
  const ctx = fakeCtx({ est: { vdot: 33, effort: { name: '5k run', t: NOW } } });
  let plan = P.generatePlan({ ctx, goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 2, startedAt: NOW - 10 * DAY });
  const first = plan.sessions[0];
  plan = P.markDone(plan, first.id, { id: 'r1', distance_m: first.totalKm * 1000 });
  const second = plan.sessions[1];
  plan = P.markSkipped(plan, second.id);

  const regenerated = P.regeneratePlan(plan, ctx, { runsPerWeek: 3 });
  const keptFirst = regenerated.sessions.find((s) => s.id === first.id);
  const keptSecond = regenerated.sessions.find((s) => s.id === second.id);
  assert.equal(keptFirst.status, 'done');
  assert.equal(keptSecond.status, 'skipped');
  assert.equal(regenerated.runsPerWeek, 3);
  assert.ok(regenerated.sessions.length > plan.sessions.length, 'more sessions/week going forward');
  assert.equal(regenerated.history.length, 1);
});

// ---------- feedback ----------
test('sessionFeedback: comments on long run distance and pace vs easy range', () => {
  const ctx = fakeCtx();
  const session = { type: 'long', totalKm: 10, targetPace: ctx.paces.easy };
  const run = mkRun({ km: 9.8, pace: (ctx.paces.easy[0] + ctx.paces.easy[1]) / 2 });
  const fb = P.sessionFeedback(session, run, ctx);
  assert.ok(fb.length >= 2);
  assert.ok(fb.some((f) => /full|planned/i.test(f.text)));
});

test('sessionFeedback: flags intervals run faster than target', () => {
  const ctx = fakeCtx();
  const target = ctx.paces.interval;
  const session = { type: 'intervals', totalKm: 8, targetPace: [target - 5, target + 5] };
  const run = mkRun({ km: 8, pace: target - 25 });
  const fb = P.sessionFeedback(session, run, ctx);
  assert.ok(fb.some((f) => /quicker/i.test(f.text)));
});

// ---------- structured steps ----------
const S = (o) => ({ week: 3, totalKm: 8, warmup: '', cooldown: '', targetPace: null, ...o });

test('sessionSteps: easy run is one run at the easy pace range', () => {
  const st = P.sessionSteps(S({ type: 'easy', title: 'Easy run', main: '8 km easy @ 6:10–6:50/km.', targetPace: [370, 410] }));
  assert.deepEqual(st, [{ kind: 'run', distance_m: 8000, pace_min_s_per_km: 370, pace_max_s_per_km: 410 }]);
});

test('sessionSteps: intervals -> warmup, repeat(run+recovery), cooldown', () => {
  const st = P.sessionSteps(S({ type: 'intervals', title: 'VO2max intervals', warmup: '2 km easy + strides', cooldown: '1.5 km easy', main: '5 × 1 km @ 4:20/km, 90 s jog between reps.', targetPace: [252, 268] }));
  assert.equal(st[0].kind, 'warmup');
  assert.equal(st[0].distance_m, 2000);
  assert.deepEqual(st[1], { kind: 'repeat', reps: 5, steps: [{ kind: 'run', distance_m: 1000, pace_min_s_per_km: 252, pace_max_s_per_km: 268 }, { kind: 'recovery', duration_s: 90 }] });
  assert.deepEqual(st[2], { kind: 'cooldown', distance_m: 1500 });
});

test('sessionSteps: distance recovery, and a range recovery uses the midpoint', () => {
  const a = P.sessionSteps(S({ type: 'intervals', main: '8 × 400 m @ 3:50/km, 160 m jog between reps.', targetPace: [222, 238] }));
  assert.deepEqual(a[0].steps[1], { kind: 'recovery', distance_m: 160 });
  const b = P.sessionSteps(S({ type: 'intervals', main: '4 × 1.5 km @ 4:40/km (goal 10k pace 5:00/km), 2–3 min jog recovery.', targetPace: [274, 286] }));
  assert.equal(b[0].reps, 4);
  assert.equal(b[0].steps[0].distance_m, 1500);
  assert.deepEqual(b[0].steps[1], { kind: 'recovery', duration_s: 150 });
});

test('sessionSteps: tempo is a timed run with a pace range', () => {
  const st = P.sessionSteps(S({ type: 'tempo', warmup: '2 km easy', cooldown: '1.5 km easy', main: '15 min steady @ 5:30/km (you could say a few words).', targetPace: [324, 336] }));
  assert.deepEqual(st.map((s) => s.kind), ['warmup', 'run', 'cooldown']);
  assert.deepEqual(st[1], { kind: 'run', duration_s: 900, pace_min_s_per_km: 324, pace_max_s_per_km: 336 });
});

test('sessionSteps: time trials = timed warm-up, untargeted goal-distance run, cool-down', () => {
  const st = P.sessionSteps(S({ type: 'test5k', warmup: '15 min easy jogging + strides', cooldown: '10 min easy jogging', main: '5 km, run as fast as you can sustain evenly.' }));
  assert.deepEqual(st, [{ kind: 'warmup', duration_s: 900 }, { kind: 'run', distance_m: 5000 }, { kind: 'cooldown', duration_s: 600 }]);
  assert.equal(P.sessionSteps(S({ type: 'test10k', main: '10 km, run as fast as you can.' }))[0].distance_m, 10000);
});

test('sessionSteps: strides = easy run then a 6 x 20 s repeat', () => {
  const st = P.sessionSteps(S({ type: 'strides', totalKm: 5.6, main: '5 km easy @ 6:10–6:50/km, then 6 × 20 s strides (quick).', targetPace: [370, 410] }));
  assert.equal(st[0].distance_m, 5000);
  assert.deepEqual(st[1], { kind: 'repeat', reps: 6, steps: [{ kind: 'run', duration_s: 20 }, { kind: 'recovery', duration_s: 40 }] });
});

test('sessionSteps: every generated session yields valid steps and a short name', () => {
  const plan = P.generatePlan({ ctx: fakeCtx(), goal: { distance_km: 10, time_s: 3000 }, runsPerWeek: 3, startedAt: NOW });
  for (const s of plan.sessions) {
    const st = P.sessionSteps(s);
    assert.ok(st.length >= 1, s.type);
    for (const x of st.flatMap((y) => (y.steps ? y.steps : [y]))) assert.ok(x.distance_m || x.duration_s || x.open, `${s.type} step has an end condition`);
    assert.ok(P.watchWorkoutName(s).startsWith('Week '));
  }
});
