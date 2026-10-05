import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutRunSessions } from '../docs/cut-run.js';
import { generatePlan, sessionSteps, regeneratePlan } from '../docs/run-plan.js';

test('cut plan: an easy and a quality run every week for 13 weeks', () => {
  const s = cutRunSessions();
  assert.equal(s.length, 26);
  assert.deepEqual(s.slice(0, 2).map((x) => x.type), ['easy', 'intervals']);
  assert.equal(s[0].main.startsWith('35 min easy'), true);
  assert.equal(s[21].type, 'test5k'); // week 11
  assert.equal(s[9].type, 'strides'); // week 5 deload
});

test('cut plan goes through the normal plan format and watch steps', () => {
  const start = new Date('2026-10-12T00:00:00').getTime();
  const plan = generatePlan({ ctx: {}, goal: { cut: true, distance_km: 5, time_s: 1560 }, runsPerWeek: 4, startedAt: start });
  assert.equal(plan.runsPerWeek, 2);
  assert.equal(plan.sessions.length, 26);
  assert.equal(plan.sessions[3].index, 3);
  assert.equal(plan.sessions[3].status, 'planned');
  const w1 = sessionSteps(plan.sessions[1]);
  assert.deepEqual(w1[0], { kind: 'warmup', duration_s: 600 });
  assert.equal(w1[1].reps, 4);
  assert.equal(w1[1].steps[0].distance_m, 800);
  assert.equal(w1[1].steps[0].pace_min_s_per_km, 320);
  assert.deepEqual(w1[1].steps[1], { kind: 'recovery', duration_s: 120 });
  const w6 = sessionSteps(plan.sessions[11]);
  assert.equal(w6[1].reps, 2);
  assert.equal(w6[1].steps[0].duration_s, 600);
  assert.deepEqual(w6[1].steps[1], { kind: 'recovery', duration_s: 180 });
  assert.equal(sessionSteps(plan.sessions[15])[1].duration_s, 1200); // week 8: 20 min tempo
  // regenerating keeps done sessions and stays a cut plan
  plan.sessions[0] = { ...plan.sessions[0], status: 'done' };
  const re = regeneratePlan(plan, {});
  assert.equal(re.sessions.length, 26);
  assert.equal(re.sessions[0].status, 'done');
});
