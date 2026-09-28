// Goal-based running training plan: pure logic, no DOM, no store. Covered by tests/run-plan.test.js.
//
// A plan (config key 'run-plan') looks like:
//   { goal: { distance_km, time_s }, runsPerWeek, startedAt (ms), sessions: [Session…], history: [...] }
// A Session:
//   { id, index, week, phase, type, title, purpose, warmup, main, cooldown, totalKm, targetPace,
//     hrGuidance, tips: [...], status: 'planned'|'done'|'skipped', doneRunId, doneAt }
// `week` is 1-based, relative to plan.startedAt; `index` is the 0-based position in plan.sessions.
//
// Regenerating a plan (settings change, VDOT check-in, "Move"/"Skip") always keeps sessions that are
// already done/skipped and only rebuilds the sessions still 'planned'.

import * as C from './run-coach.js';

const DAY = 86400000;
const WEEK = 7 * DAY;
const CAP_WEEKS = 40;

const round1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------- fitness starting point ----------
// { vdot, reliable } — reliable means it comes from an actual hard effort (recent or old), not a guess
// from easy-run pace. When not reliable, the plan opens with a 5k time trial to calibrate.
export function startingVdot(ctx) {
  if (ctx.est) return { vdot: ctx.est.vdot, reliable: true };
  if (ctx.olderEst) return { vdot: ctx.olderEst.vdot, reliable: true };
  if (ctx.zoneVdot) return { vdot: ctx.zoneVdot, reliable: false };
  return { vdot: 30, reliable: false };
}

export function goalVdot(goal) {
  return C.vdotFromRace(goal.distance_km * 1000, goal.time_s);
}

// ---------- timeline ----------
// Conservative, documented rate of VDOT gain for a recreational runner: ~1 point per 4 weeks at
// 2 runs/week, ~1 point per 3 weeks at 3+ runs/week, slowing further the closer you get to goal
// (the last few points are the hardest). This is a rule of thumb, not a promise.
export function weeksPerVdotPoint(runsPerWeek, pointsFromGoal) {
  const base = runsPerWeek >= 3 ? 3 : 4;
  const nearGoal = pointsFromGoal <= 2 ? 1.6 : pointsFromGoal <= 5 ? 1.25 : 1;
  return base * nearGoal;
}

// Weeks of training needed to go from startVdot to goalVdotVal, plus a taper week and a test week.
// Capped at CAP_WEEKS; `capped` is true when the raw estimate exceeded the cap.
export function estimateTimelineWeeks(startVdotVal, goalVdotVal, runsPerWeek) {
  const totalGain = goalVdotVal - startVdotVal;
  if (totalGain <= 0) return { trainWeeks: 2, weeks: 4, capped: false };
  let gained = 0, weeks = 0;
  while (gained < totalGain && weeks < 300) {
    const pointsFromGoal = totalGain - gained;
    gained += 1 / weeksPerVdotPoint(runsPerWeek, pointsFromGoal);
    weeks++;
  }
  const trainWeeks = Math.max(3, weeks);
  const total = trainWeeks + 2; // + taper + test
  const capped = total > CAP_WEEKS;
  return { trainWeeks, weeks: Math.min(total, CAP_WEEKS), capped };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fuzzyMonth(ms) {
  const d = new Date(ms);
  const day = d.getDate();
  const part = day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late';
  return `${part} ${MONTHS[d.getMonth()]}`;
}
// A plain-language window ("late February – mid March") rather than a single promised date.
export function goalWindow(startedAt, weeks) {
  const from = startedAt + Math.max(0, weeks - 2) * WEEK;
  const to = startedAt + (weeks + 2) * WEEK;
  const a = fuzzyMonth(from), b = fuzzyMonth(to);
  return a === b ? a : `${a} – ${b}`;
}

// ---------- long run progression ----------
function currentLongRunKm(ctx) {
  const longs = (ctx.runs || []).filter((r) => ctx.classOf?.(r)?.type === 'long' || C.km(r.distance_m) >= 8);
  const recent = longs.filter((r) => C.startMs(r) >= (ctx.now || Date.now()) - 8 * WEEK);
  const sample = (recent.length ? recent : longs).map((r) => C.km(r.distance_m));
  if (sample.length) return clamp(C.median(sample) || sample[0], 5, 14);
  return clamp((ctx.avgDist ? C.km(ctx.avgDist) : 5) * 1.3, 5, 10);
}

// ---------- session builders ----------
let _id = 0;
const nextId = () => `pl${Date.now().toString(36)}${(_id++).toString(36)}`;

function mk({ index, week, phase, type, title, purpose, warmup = '', main, cooldown = '', totalKm, targetPace = null, hrGuidance = '', tips = [] }) {
  return {
    id: nextId(), index, week, phase, type, title, purpose, warmup, main, cooldown,
    totalKm: round1(totalKm), targetPace, hrGuidance, tips, status: 'planned', doneRunId: null, doneAt: null,
  };
}

const hrEasy = (maxHr) => (maxHr ? `Conversational — keep it below about ${Math.round(maxHr * 0.8)} bpm (≈80% of max).` : 'Conversational pace — you should be able to talk in full sentences.');

function easySession({ index, week, phase, km, paces, maxHr, long = false }) {
  return mk({
    index, week, phase, type: long ? 'long' : 'easy', title: long ? 'Long run' : 'Easy run',
    purpose: long ? 'Builds the aerobic endurance that lets you hold pace for the full 10 km.' : 'Easy mileage builds your aerobic base without adding fatigue — the foundation everything else sits on.',
    main: `${round1(km)} km easy${paces ? ` @ ${C.paceRange(paces.easy)}/km` : ''}. Walk breaks are fine.`,
    totalKm: km, targetPace: paces ? paces.easy : null, hrGuidance: hrEasy(maxHr),
    tips: long ? ['Start slower than you think you need to — the last third should still feel controlled.', 'Practise your race-day fuelling/hydration on the longer ones.'] : ['If you\'re breathing hard, slow down — easy runs are supposed to feel easy.'],
  });
}

function stridesSession({ index, week, phase, km, paces, maxHr }) {
  return mk({
    index, week, phase, type: 'strides', title: 'Easy + strides',
    purpose: 'Strides sharpen your running form and leg turnover without the fatigue of a hard workout.',
    main: `${round1(km)} km easy${paces ? ` @ ${C.paceRange(paces.easy)}/km` : ''}, then 6 × 20 s strides (quick and smooth, walk back to recover).`,
    totalKm: km + 0.6, targetPace: paces ? paces.easy : null, hrGuidance: hrEasy(maxHr),
    tips: ['Strides are fast but relaxed — think "smooth", not "sprint".'],
  });
}

function tempoSession({ index, week, phase, paces, minutes, maxHr }) {
  const tp = paces ? paces.threshold : 330;
  return mk({
    index, week, phase, type: 'tempo', title: 'Tempo run',
    purpose: 'Comfortably-hard tempo running raises the pace you can sustain for a race — it trains your lactate threshold.',
    warmup: '2 km easy', cooldown: '1.5 km easy',
    main: `${minutes} min steady${paces ? ` @ ${C.fmtPace(tp)}/km` : ' at a "comfortably hard" effort'} (you could say a few words, not hold a conversation).`,
    totalKm: 3.5 + (minutes * 60) / tp,
    targetPace: paces ? [tp - 6, tp + 6] : null,
    hrGuidance: maxHr ? `Should sit around 80–88% of max (≈${Math.round(maxHr * 0.8)}–${Math.round(maxHr * 0.88)} bpm).` : 'Comfortably hard — not a race effort.',
    tips: ['Even pace beats a fast start — hold back for the first few minutes.'],
  });
}

function intervalsSession({ index, week, phase, paces, reps, distM, maxHr, vo2max = true }) {
  const tp = paces ? (vo2max ? paces.interval : paces.repetition) : (vo2max ? 260 : 240);
  const recovery = distM >= 900 ? `${Math.round((distM / 1000) * (vo2max ? 90 : 60))} s jog` : `${Math.round(distM * 0.4)} m jog`;
  const distTxt = distM >= 1000 ? `${C.kmShort(distM / 1000)} km` : `${Math.round(distM)} m`;
  return mk({
    index, week, phase, type: 'intervals', title: vo2max ? 'VO2max intervals' : 'Speed reps',
    purpose: vo2max ? 'Hard 2–5 min intervals raise your top-end aerobic power (VO2max), which lifts your ceiling for everything slower.' : 'Short fast reps sharpen speed and running economy.',
    warmup: '2 km easy + strides', cooldown: '1.5 km easy',
    main: `${reps} × ${distTxt} @ ${C.fmtPace(tp)}/km, ${recovery} between reps.`,
    totalKm: 3.5 + (reps * distM) / 1000 * 1.4,
    targetPace: [tp - 8, tp + 8],
    hrGuidance: maxHr ? `Reps should push heart rate up near ${Math.round(maxHr * 0.9)}+ bpm by the end of each rep.` : 'Hard — a 3–5k race effort.',
    tips: ['Keep the early reps controlled; fading badly on the last one means you started too fast.'],
  });
}

// Specific-phase, 10k-pace intervals — blends current threshold/interval pace toward goal pace as the
// phase progresses, per the brief ("goal pace used only in specific-phase sessions as fitness nears it").
function specificSession({ index, week, phase, paces, goalPace, progress, reps, distKm, maxHr }) {
  const current = paces ? (distKm >= 2 ? paces.threshold : paces.interval) : goalPace + 15;
  const target = Math.round(current + (goalPace - current) * clamp(progress, 0, 1));
  return mk({
    index, week, phase, type: 'intervals', title: '10k-pace intervals',
    purpose: 'Running goal-pace segments with short recoveries teaches your body exactly the rhythm you need on race day.',
    warmup: '2 km easy', cooldown: '1.5 km easy',
    main: `${reps} × ${C.kmShort(distKm)} km @ ${C.fmtPace(target)}/km (goal 10k pace ${C.fmtPace(goalPace)}/km), 2–3 min jog recovery.`,
    totalKm: 3.5 + reps * distKm * 1.25,
    targetPace: [target - 6, target + 6],
    hrGuidance: maxHr ? `Aim to finish each rep around 85–92% of max (≈${Math.round(maxHr * 0.85)}–${Math.round(maxHr * 0.92)} bpm).` : 'Goal-race effort — hard but controlled.',
    tips: ['These reps should feel like "controlled hard", the pace you believe you can hold for the full 10k.'],
  });
}

function testSession({ index, week, phase, distKm, paces, goalPace, maxHr, isGoalDistance }) {
  const label = distKm === 5 ? '5 km time trial' : `${distKm} km time trial`;
  return mk({
    index, week, phase, type: distKm === 5 ? 'test5k' : 'test10k', title: label,
    purpose: isGoalDistance ? 'This is race day — an honest, all-out effort over the goal distance to see where you stand.' : 'A hard time trial over 5 km recalibrates your fitness score so the rest of the plan uses accurate paces.',
    warmup: '15 min easy jogging + strides', cooldown: '10 min easy jogging',
    main: `${distKm} km, run as fast as you can sustain evenly. Find a flat, measured route or a parkrun.${isGoalDistance ? ` Goal: under ${C.fmtTime(distKm === 5 ? goalPace * 5 : goalPace * 10)}.` : ''}`,
    totalKm: distKm + 4,
    targetPace: null,
    hrGuidance: 'Race effort — this should be uncomfortable by the finish.',
    tips: ['Pace evenly rather than starting too fast — a slight negative split (second half faster) is ideal.', isGoalDistance ? 'Get a good night\'s sleep beforehand and eat a familiar breakfast.' : 'Log this run as usual — the coach will pick up the new fitness estimate automatically.'],
  });
}

// ---------- plan generation ----------
// ctx: the object from run-coach's buildContext() (needs runs, est/olderEst/zoneVdot, paces, maxHr, now, classOf).
export function generatePlan({ ctx, goal, runsPerWeek, startedAt = Date.now() }) {
  runsPerWeek = clamp(Math.round(runsPerWeek) || 2, 2, 5);
  const start = startingVdot(ctx);
  const gVdot = goalVdot(goal);
  const timeline = estimateTimelineWeeks(start.vdot, gVdot, runsPerWeek);
  const totalWeeks = timeline.weeks;
  const trainWeeks = totalWeeks - 2; // excludes taper + test weeks
  const baseWeeks = Math.max(1, Math.round(trainWeeks * 0.35));
  const buildWeeks = Math.max(1, Math.round(trainWeeks * 0.4));
  const specificWeeks = Math.max(1, trainWeeks - baseWeeks - buildWeeks);

  const goalPace = C.raceTime(gVdot, 10000) / 10; // sec/km, needed even if goal distance isn't 10k
  const maxHr = ctx.maxHr;
  let longKm = currentLongRunKm(ctx);
  const longCap = 14;

  const specificReps = [{ reps: 5, distKm: 1 }, { reps: 4, distKm: 1.5 }, { reps: 3, distKm: 2 }, { reps: 2, distKm: 3 }];

  const sessions = [];
  let index = 0;
  let specificSeen = 0;

  for (let w = 1; w <= totalWeeks; w++) {
    const isTaper = w === totalWeeks - 1;
    const isTest = w === totalWeeks;
    const phase = isTest ? 'Test' : isTaper ? 'Taper' : w <= baseWeeks ? 'Base' : w <= baseWeeks + buildWeeks ? 'Build' : 'Specific';
    // Current-fitness paces: fixed at generation time (recalculated whenever the plan regenerates,
    // e.g. after a check-in time trial), per the brief.
    const paces = ctx.paces;
    const deload = !isTaper && !isTest && w % 4 === 0;
    const lighter = deload ? 0.8 : 1;

    // Long run for the week (skipped on test week; taper keeps a short one).
    if (!isTest) {
      longKm = clamp(w === 1 ? longKm : longKm + (w % 2 === 0 ? 1 : 0), 5, longCap);
    }
    const weekLongKm = isTaper ? Math.max(5, longKm * 0.6) : longKm * lighter;

    let quality;
    const isCheckIn = !isTest && !isTaper && w % 6 === 0;
    if (w === 1 && !start.reliable) {
      quality = testSession({ index, week: w, phase, distKm: 5, paces, goalPace, maxHr, isGoalDistance: false });
    } else if (isTest) {
      quality = testSession({ index, week: w, phase, distKm: goal.distance_km, paces, goalPace, maxHr, isGoalDistance: true });
    } else if (isCheckIn) {
      quality = testSession({ index, week: w, phase, distKm: 5, paces, goalPace, maxHr, isGoalDistance: false });
    } else if (isTaper) {
      quality = w % 2 === 0 ? tempoSession({ index, week: w, phase, paces, minutes: 15, maxHr }) : easySession({ index, week: w, phase, km: 5, paces, maxHr });
    } else if (phase === 'Base') {
      quality = w % 2 === 0 ? tempoSession({ index, week: w, phase, paces, minutes: 15, maxHr }) : stridesSession({ index, week: w, phase, km: 5, paces, maxHr });
    } else if (phase === 'Build') {
      quality = w % 2 === 0
        ? intervalsSession({ index, week: w, phase, paces, reps: 5, distM: 1000, maxHr, vo2max: true })
        : tempoSession({ index, week: w, phase, paces, minutes: clamp(18 + specificSeen, 15, 30), maxHr });
    } else { // Specific
      const r = specificReps[specificSeen % specificReps.length];
      const progress = specificSeen / Math.max(1, specificWeeks - 1);
      quality = specificSession({ index, week: w, phase, paces, goalPace, progress, reps: r.reps, distKm: r.distKm, maxHr });
      specificSeen++;
    }
    sessions.push(quality); index++;

    // Extra easy runs for 3+ runs/week.
    for (let e = 0; e < runsPerWeek - 2; e++) {
      sessions.push(easySession({ index, week: w, phase, km: Math.max(3, round1(weekLongKm * 0.4)), paces, maxHr }));
      index++;
    }

    if (!isTest) {
      sessions.push(easySession({ index, week: w, phase, km: weekLongKm, paces, maxHr, long: true }));
      index++;
    } else {
      // Test week: a short easy shakeout a few days before the effort.
      sessions.splice(sessions.length - 1, 0, easySession({ index, week: w, phase, km: 3, paces, maxHr }));
      sessions.forEach((s, i) => { s.index = i; });
      index = sessions.length;
    }
  }

  return {
    goal, runsPerWeek, startedAt, sessions,
    timelineWeeks: totalWeeks, timelineCapped: timeline.capped, startVdot: start.vdot, startReliable: start.reliable, goalVdot: gVdot,
    goalWindow: goalWindow(startedAt, totalWeeks),
    history: [],
  };
}

// ---------- matching completed runs to sessions ----------
const HARD_SESSION_TYPES = new Set(['tempo', 'intervals', 'test5k', 'test10k']);
const HARD_RUN_TYPES = new Set(['tempo', 'intervals', 'race', 'workout']);

export function sessionMatches(session, run, runType) {
  if (!session || session.status !== 'planned') return false;
  const distKm = C.km(run.distance_m);
  if (session.totalKm > 0 && distKm >= session.totalKm * 0.65 && distKm <= session.totalKm * 1.35) return true;
  if (HARD_SESSION_TYPES.has(session.type) && HARD_RUN_TYPES.has(runType)) return true;
  return false;
}

// Returns an updated copy of the session that should be auto-matched to `run`, or null.
export function autoMatch(plan, run, runType, runStartMs) {
  if (!plan || runStartMs < plan.startedAt) return null;
  let lastDoneIdx = -1;
  plan.sessions.forEach((s, i) => { if (s.status !== 'planned') lastDoneIdx = i; });
  const lastDoneAt = lastDoneIdx >= 0 ? (plan.sessions[lastDoneIdx].doneAt || plan.startedAt) : plan.startedAt;
  if (runStartMs < lastDoneAt) return null;
  const next = plan.sessions[lastDoneIdx + 1];
  if (!next || !sessionMatches(next, run, runType)) return null;
  return { ...next, status: 'done', doneRunId: run.id, doneAt: runStartMs };
}

export function markDone(plan, sessionId, run) {
  return {
    ...plan,
    sessions: plan.sessions.map((s) => (s.id === sessionId ? { ...s, status: 'done', doneRunId: run?.id || null, doneAt: run ? C.startMs(run) : Date.now() } : s)),
  };
}
export function markSkipped(plan, sessionId) {
  return { ...plan, sessions: plan.sessions.map((s) => (s.id === sessionId ? { ...s, status: 'skipped', doneRunId: null, doneAt: Date.now() } : s)) };
}
export function unlink(plan, sessionId) {
  return { ...plan, sessions: plan.sessions.map((s) => (s.id === sessionId ? { ...s, status: 'planned', doneRunId: null, doneAt: null } : s)) };
}

// ---------- per-session feedback ----------
export function sessionFeedback(session, run, ctx = {}) {
  const out = [];
  const p = C.paceOf(run);
  const distKm = C.km(run.distance_m);
  const paces = ctx.paces;

  if (session.type === 'long') {
    const pctDone = session.totalKm ? distKm / session.totalKm : null;
    if (pctDone != null) {
      if (pctDone >= 0.92) out.push({ tone: 'good', text: `Covered the full ${C.kmShort(session.totalKm)} km long run.` });
      else out.push({ tone: 'info', text: `Ran ${distKm.toFixed(1)} of the planned ${C.kmShort(session.totalKm)} km. Fine occasionally — try to hit the full distance next time.` });
    }
    if (paces && p) {
      if (p < paces.easy[0] - 10) out.push({ tone: 'tip', text: `Pace was ${C.fmtPace(p)}/km, faster than your easy range (${C.paceRange(paces.easy)}/km). Long runs pay off more when they're relaxed.` });
      else out.push({ tone: 'good', text: `Pace ${C.fmtPace(p)}/km stayed easy — good long-run discipline.` });
    }
  } else if (session.type === 'intervals' || session.type === 'tempo') {
    const target = session.targetPace;
    if (target && p) {
      const mid = (target[0] + target[1]) / 2;
      const diff = p - mid;
      if (diff < -8) out.push({ tone: 'tip', text: `Average ${C.fmtPace(p)}/km was quicker than the ${C.fmtPace(target[0])}–${C.fmtPace(target[1])}/km target. Strong, but running quality sessions too hard adds fatigue without much extra benefit.` });
      else if (diff > 12) out.push({ tone: 'info', text: `Average ${C.fmtPace(p)}/km landed slower than the ${C.fmtPace(target[0])}–${C.fmtPace(target[1])}/km target. Fine if it felt hard — heat, hills or tired legs all slow this down.` });
      else out.push({ tone: 'good', text: `Average ${C.fmtPace(p)}/km — right in the ${C.fmtPace(target[0])}–${C.fmtPace(target[1])}/km target zone.` });
    }
    const sp = (run.splits || []).filter((s) => Number(s.d) >= 900 && Number(s.s) > 0);
    if (sp.length >= 4) {
      const half = sp.length >> 1;
      const pace = (arr) => arr.reduce((s, x) => s + x.s, 0) / (arr.reduce((s, x) => s + x.d, 0) / 1000);
      const pa = pace(sp.slice(0, half)), pb = pace(sp.slice(sp.length - half));
      if (pb > pa * 1.05) out.push({ tone: 'tip', text: `You slowed by ${Math.round(pb - pa)} s/km in the second half. Starting a touch more conservatively usually holds together better.` });
      else if (pb <= pa * 1.01) out.push({ tone: 'good', text: 'Even effort start to finish.' });
    }
  } else if (session.type === 'test5k' || session.type === 'test10k') {
    out.push({ tone: 'good', text: `${distKm.toFixed(2)} km in ${C.fmtTime(run.moving_s)} (${C.fmtPace(p)}/km). This recalibrates your fitness and the rest of the plan.` });
  } else if (paces && p) {
    if (p < paces.easy[0] - 10) out.push({ tone: 'tip', text: `Ran at ${C.fmtPace(p)}/km — quicker than your easy range (${C.paceRange(paces.easy)}/km). Slowing down here protects the hard sessions.` });
    else out.push({ tone: 'good', text: `Nicely inside your easy range at ${C.fmtPace(p)}/km.` });
  }

  const next = session.type === 'long' ? 'Next long run, try to hold the same relaxed effort even as the distance grows.'
    : session.type === 'intervals' ? 'Next time, focus on even pacing across all the reps rather than fast early ones.'
    : session.type === 'tempo' ? 'Keep tempo runs at "comfortably hard" — you should be able to hold the pace for the whole segment.'
    : 'Keep stacking easy miles — consistency beats any single session.';
  out.push({ tone: 'info', text: `Next time: ${next}` });
  return out.slice(0, 4);
}

// ---------- behind / missed sessions ----------
export function computeBehind(plan, now = Date.now()) {
  if (!plan || !plan.sessions.length) return null;
  const doneOrSkipped = plan.sessions.filter((s) => s.status !== 'planned');
  const remaining = plan.sessions.filter((s) => s.status === 'planned');
  if (!remaining.length) return null;
  const weeksElapsed = (now - plan.startedAt) / WEEK;
  const expectedDone = Math.floor(weeksElapsed * plan.runsPerWeek);
  const overdue = expectedDone - doneOrSkipped.length;
  if (overdue < 1) return null;
  const lastAt = doneOrSkipped.map((s) => s.doneAt).filter(Boolean).sort((a, b) => b - a)[0] || plan.startedAt;
  if (now - lastAt < 7 * DAY) return null;
  const overdueSessions = remaining.slice(0, overdue);
  const keySession = overdueSessions.some((s) => s.type === 'test5k' || s.type === 'test10k');
  return { sessionsOverdue: overdue, nextSession: remaining[0], keySession };
}

// Shift the whole remaining plan forward so the current overdue session becomes "this week's".
export function movePlan(plan, now = Date.now()) {
  const behind = computeBehind(plan, now);
  if (!behind) return plan;
  const shiftWeeks = Math.max(1, Math.ceil(behind.sessionsOverdue / plan.runsPerWeek));
  return {
    ...plan,
    startedAt: plan.startedAt + shiftWeeks * WEEK,
    goalWindow: goalWindow(plan.startedAt + shiftWeeks * WEEK, plan.timelineWeeks),
    history: [...(plan.history || []), { at: now, action: 'move', shiftWeeks }],
  };
}

// Mark the overdue session(s) skipped and carry straight on with the next one.
export function skipOverdue(plan, now = Date.now()) {
  const behind = computeBehind(plan, now);
  if (!behind) return plan;
  let toSkip = behind.sessionsOverdue;
  const sessions = plan.sessions.map((s) => {
    if (toSkip > 0 && s.status === 'planned') { toSkip--; return { ...s, status: 'skipped', doneAt: now }; }
    return s;
  });
  return { ...plan, sessions, history: [...(plan.history || []), { at: now, action: 'skip', count: behind.sessionsOverdue }] };
}

// ---------- regeneration (settings change, check-in re-estimate) ----------
// Keeps every done/skipped session untouched; rebuilds only what's still 'planned'.
export function regeneratePlan(oldPlan, ctx, opts = {}) {
  const goal = opts.goal || oldPlan.goal;
  const runsPerWeek = opts.runsPerWeek || oldPlan.runsPerWeek;
  const startedAt = opts.startedAt || oldPlan.startedAt;
  const kept = oldPlan.sessions.filter((s) => s.status !== 'planned');
  const lastDoneIndex = kept.length ? Math.max(...kept.map((s) => s.index)) : -1;
  const fresh = generatePlan({ ctx, goal, runsPerWeek, startedAt });
  const future = fresh.sessions.filter((s) => s.index > lastDoneIndex).map((s, i) => ({ ...s, index: lastDoneIndex + 1 + i }));
  return {
    ...fresh,
    startedAt,
    sessions: [...kept, ...future],
    history: [...(oldPlan.history || []), { at: Date.now(), action: 'regenerate' }],
  };
}

// ---------- summary helpers for the UI ----------
export function planProgress(plan) {
  const done = plan.sessions.filter((s) => s.status === 'done').length;
  const total = plan.sessions.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
export function nextSession(plan) {
  return plan.sessions.find((s) => s.status === 'planned') || null;
}
export function currentWeekLabel(plan, session) {
  if (!session) return '';
  const weekSessions = plan.sessions.filter((s) => s.week === session.week);
  const pos = weekSessions.findIndex((s) => s.id === session.id) + 1;
  return `Week ${session.week} · session ${pos} of ${weekSessions.length} this week`;
}

// ---------- structured steps (for sending a session to a watch) ----------
// Device-neutral description of a session, derived from the session's own fields (so it also works for plans saved
// before this existed). Step shapes:
//   { kind: 'warmup'|'run'|'recovery'|'cooldown', distance_m | duration_s | open: true, pace_min_s_per_km?, pace_max_s_per_km? }
//   { kind: 'repeat', reps, steps: [ …run/recovery steps ] }
// pace_min = the FASTER end of the range (fewer seconds per km), pace_max = the slower end. No pace fields = no target.
const num = (s) => parseFloat(String(s).replace(',', '.'));

// "2 km easy", "1.5 km easy", "15 min easy jogging + strides" → { distance_m } | { duration_s } | null
function parseAmount(text) {
  const m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*(km|min)\b/i);
  if (!m) return null;
  const v = num(m[1]);
  return /km/i.test(m[2]) ? { distance_m: Math.round(v * 1000) } : { duration_s: Math.round(v * 60) };
}

// "5 × 1 km" / "8 × 400 m" → { reps, distance_m }
function parseReps(text) {
  const m = String(text || '').match(/(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*(km|m)\b/i);
  if (!m) return null;
  const v = num(m[2]);
  return { reps: Number(m[1]), distance_m: Math.round(/km/i.test(m[3]) ? v * 1000 : v) };
}

// "90 s jog", "160 m jog", "2–3 min jog recovery" → { duration_s } | { distance_m } (ranges use the midpoint)
function parseRecovery(text) {
  const t = String(text || '');
  let m = t.match(/,\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*(s|min)\b[^,.]*jog/i);
  if (m) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return { duration_s: Math.round(((a + b) / 2) * (m[3].toLowerCase() === 'min' ? 60 : 1)) };
  }
  m = t.match(/,\s*(\d+)\s*m\s*jog/i);
  if (m) return { distance_m: Number(m[1]) };
  return null;
}

const withPace = (step, pace) => (pace && pace.length === 2 ? { ...step, pace_min_s_per_km: Math.round(Math.min(...pace)), pace_max_s_per_km: Math.round(Math.max(...pace)) } : step);

export function sessionSteps(session) {
  if (!session) return [];
  const steps = [];
  const pace = session.targetPace;
  const warm = parseAmount(session.warmup);
  const cool = parseAmount(session.cooldown);
  const totalM = Math.round((session.totalKm || 0) * 1000);
  const main = session.main || '';
  if (warm) steps.push({ kind: 'warmup', ...warm });

  if (session.type === 'intervals') {
    const r = parseReps(main);
    if (r) {
      const rec = parseRecovery(main) || { duration_s: 90 };
      steps.push({ kind: 'repeat', reps: r.reps, steps: [withPace({ kind: 'run', distance_m: r.distance_m }, pace), { kind: 'recovery', ...rec }] });
    } else {
      steps.push(withPace({ kind: 'run', open: true }, pace));
    }
  } else if (session.type === 'tempo') {
    const a = parseAmount(main);
    steps.push(withPace({ kind: 'run', ...(a || { open: true }) }, pace));
  } else if (session.type === 'test5k' || session.type === 'test10k') {
    const m = main.match(/^(\d+(?:[.,]\d+)?)\s*km/i);
    const dist = m ? Math.round(num(m[1]) * 1000) : session.type === 'test5k' ? 5000 : 10000;
    steps.push({ kind: 'run', distance_m: dist }); // all-out, evenly paced: deliberately no pace target
  } else if (session.type === 'strides') {
    const s = main.match(/(\d+)\s*[×x]\s*(\d+)\s*s\s+strides/i);
    const easyM = Math.max(0, totalM - 600);
    steps.push(withPace({ kind: 'run', distance_m: easyM || 1000 }, pace));
    steps.push({ kind: 'repeat', reps: s ? Number(s[1]) : 6, steps: [{ kind: 'run', duration_s: s ? Number(s[2]) : 20 }, { kind: 'recovery', duration_s: 40 }] });
  } else {
    // easy / long / anything else: one run at the easy pace range
    const body = totalM - (warm && warm.distance_m ? warm.distance_m : 0) - (cool && cool.distance_m ? cool.distance_m : 0);
    steps.push(withPace(body > 0 ? { kind: 'run', distance_m: body } : { kind: 'run', open: true }, pace));
  }
  if (cool) steps.push({ kind: 'cooldown', ...cool });
  return steps;
}

// Short workout name shown on the watch, e.g. "Fit · W3 VO2max intervals 5×1 km".
export function watchWorkoutName(session) {
  if (!session) return 'Fit · run';
  let name = `Fit · W${session.week} ${session.title || 'Run'}`;
  const r = session.type === 'intervals' ? parseReps(session.main) : null;
  if (r) name += ` ${r.reps}×${r.distance_m >= 1000 ? `${round1(r.distance_m / 1000)} km` : `${r.distance_m} m`}`;
  else if (session.totalKm) name += ` ${round1(session.totalKm)} km`;
  return name.slice(0, 60);
}
