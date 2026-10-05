// Cut plan × gym logger: prescriptions for an Upper A/B/C workout and its end-of-workout judgement.
// The rules are in cut-engine.js; this module only reads the store.

import * as store from './store.js';
import { workouts } from './gym-data.js';
import { cutSettings } from './cut.js';
import { PLAN, weekNumber } from './cut-calc.js';
import { planSlot, prescribe, judgeExercise, judgeSession, isMainLift, e1rmOf, workingSets } from './cut-engine.js';

const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// { letter, week, deload } for a routine of the cut program (null for any other routine).
export function cutContext(routine, at = new Date().toISOString()) {
  const letter = routine?.cut;
  if (!letter) return null;
  const week = weekNumber(cutSettings().startDate, localDay(at));
  return { letter, week, deload: Boolean(PLAN[week - 1]?.deload) };
}

// Sessions of one exercise before a time, oldest first: [{ sets, at }].
export function historyOf(exerciseId, { before = Infinity, exceptId = null } = {}) {
  return workouts()
    .filter((w) => w.id !== exceptId && Date.parse(w.started_at) < before)
    .map((w) => ({ at: w.started_at, ex: (w.exercises || []).find((e) => e.exercise_id === exerciseId) }))
    .filter((x) => x.ex && x.ex.sets?.length)
    .map((x) => ({ at: x.at, sets: x.ex.sets }))
    .reverse();
}

// Slot + prescription for an exercise in a cut workout. slot may come from the entry (after a swap).
export function rxFor(exerciseId, ctx, slot = planSlot(exerciseId, ctx.letter)) {
  if (!slot) return { slot: null, rx: null, sets: null };
  const sets = ctx.deload ? 2 : slot.sets;
  const hist = historyOf(exerciseId);
  return { slot, rx: prescribe(hist, slot, { sets }), sets, last: hist[hist.length - 1]?.sets || null };
}

// Judgement of a saved workout: per exercise verdict vs last time, e1RM change on main lifts, next prescription.
export function judgeWorkout(w, ctx) {
  const before = Date.parse(w.started_at);
  const exercises = (w.exercises || []).map((e) => {
    const hist = historyOf(e.exercise_id, { before, exceptId: w.id });
    const prev = hist[hist.length - 1]?.sets || null;
    const slot = e.slot || planSlot(e.exercise_id, ctx.letter);
    const verdict = prev ? judgeExercise(prev, e.sets) : null;
    const pe = prev ? e1rmOf(workingSets(prev)) : 0;
    const ce = e1rmOf(workingSets(e.sets));
    const nextCtx = { ...ctx, deload: Boolean(PLAN[ctx.week]?.deload) };
    const next = slot ? prescribe([...hist, { sets: e.sets }], slot, { sets: nextCtx.deload ? 2 : slot.sets }) : null;
    return { exercise_id: e.exercise_id, mode: e.mode, verdict, prev, main: isMainLift(e.exercise_id), e1rm: Math.round(ce * 10) / 10, e1rmPrev: Math.round(pe * 10) / 10, next };
  });
  const session = judgeSession(exercises, { deload: ctx.deload });
  return { session, exercises };
}

// Session verdicts of finished cut workouts, newest first (used for "2 dropped sessions in a row").
export const cutSessions = () => workouts().filter((w) => w.cut?.session).map((w) => ({ at: w.started_at, session: w.cut.session }));

export const routineCut = (id) => store.get(id)?.cut || null;
