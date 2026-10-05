// Cut plan progression engine ("Workout judging" in fit-cut-plan.md). Pure; covered by tests/cut-engine.test.js.
//
// Every exercise is judged against the last time that same exercise was done (a swapped exercise has its own
// history), using the weight and reps of every working set. The next prescription comes from what was actually done.
//   sets: [{ type, kg, reps }] — warm-ups (type 'w') are ignored; bodyweight exercises have kg = added weight (or null).

import { ROUTINES, MAIN_LIFTS } from './cut-calc.js';

const work = (sets) => (sets || []).filter((s) => s && s.type !== 'w' && Number(s.reps) > 0)
  .map((s) => ({ kg: Number(s.kg) || 0, reps: Math.round(Number(s.reps)) }));
const epley = (kg, reps) => kg * (1 + reps / 30);
const bestE1rm = (ws) => Math.max(0, ...ws.map((s) => epley(s.kg, s.reps)));
const topKg = (ws) => Math.max(0, ...ws.map((s) => s.kg));
const totalReps = (ws) => ws.reduce((a, s) => a + s.reps, 0);
export const roundTo = (kg, step = 2.5) => Math.max(0, Math.round(kg / step) * step);
const fmt = (x) => String(Math.round(x * 100) / 100);

// Rep range "6-10" → { lo, hi }.
export function range(reps) {
  const m = String(reps ?? '').match(/(\d+)\s*[-–]\s*(\d+)/);
  if (m) return { lo: Math.min(+m[1], +m[2]), hi: Math.max(+m[1], +m[2]) };
  const n = parseInt(reps, 10);
  return n > 0 ? { lo: n, hi: n } : { lo: 8, hi: 12 };
}

// Plan slot of an exercise (also when it is the swap of a slot): { name, sets, reps, rest, kind, alt }.
export function planSlot(exerciseId, letter = null) {
  const list = letter ? ROUTINES.filter((r) => r.key === letter) : ROUTINES;
  for (const r of list) for (const x of r.exercises) if (x.exercise_id === exerciseId || x.alt === exerciseId) return x;
  return null;
}
export const isMainLift = (id) => MAIN_LIFTS.includes(id);
// Weight jump: +2.5 kg on presses, rows and pulldowns; the smallest jump (2 kg) on isolation work and crunches.
export const stepFor = (kind) => (kind === 'iso' || kind === 'crunch' ? 2 : 2.5);

// ⬆️ beat · ➡️ matched · ⬇️ dropped (null without a previous session to compare with).
//  - best-set e1RM down > 3 %                                         → dropped
//  - more weight (top working weight) at the same or more total reps   → beat
//  - same top weight: total reps +1 or more → beat, 0/−1 → matched, −2 or worse → dropped
//  - more weight with fewer reps, or less weight: e1RM up → beat, otherwise matched
export function judgeExercise(prevSets, curSets) {
  const p = work(prevSets), c = work(curSets);
  if (!p.length || !c.length) return null;
  const pe = bestE1rm(p), ce = bestE1rm(c);
  if (pe > 0 && ce < pe * 0.97) return 'dropped';
  const pk = topKg(p), ck = topKg(c);
  const pr = totalReps(p), cr = totalReps(c);
  if (ck === pk) {
    const d = cr - pr;
    return d >= 1 ? 'beat' : d >= -1 ? 'matched' : 'dropped';
  }
  if (ck > pk && cr >= pr) return 'beat';
  return ce > pe ? 'beat' : 'matched';
}

// Mark of one set against its target: 'up' | 'on' | 'down'.
export function setMark(target, actual) {
  const tk = Number(target?.kg) || 0, tr = Number(target?.reps) || 0;
  const ak = Number(actual?.kg) || 0, ar = Number(actual?.reps) || 0;
  if (!tr || !ar) return null;
  if (ak === tk) return ar > tr ? 'up' : ar === tr ? 'on' : 'down';
  const te = epley(tk, tr), ae = epley(ak, ar);
  return ae > te * 1.005 ? 'up' : ae < te * 0.995 ? 'down' : 'on';
}

// Next session from the history of this exercise (oldest first: [{ sets }]) and its plan slot.
// Returns { kg, reps:[per set], rule, text } or null without history (week 1: find working weights at RPE 7–8).
//   rules: 'up' add weight · 'reps' same weight, +1 rep on the weakest set(s) · 'repeat' a set was below the range
//          'minus5' below the range 2 sessions in a row · 'minus10' no improvement for 3 sessions
export function prescribe(history = [], slot = null, { sets = null } = {}) {
  const h = history.map((x) => ({ ...x, w: work(x.sets) })).filter((x) => x.w.length);
  if (!h.length) return null;
  const { lo, hi } = range(slot?.reps);
  const kind = slot?.kind || 'compound';
  const n = sets || slot?.sets || h[h.length - 1].w.length;
  const L = h[h.length - 1].w;
  const kg = topKg(L);
  const atTop = L.filter((s) => s.kg === kg);
  const below = (ws) => ws.some((s) => s.reps < lo);
  const pad = (arr) => Array.from({ length: n }, (_, i) => Math.min(hi, Math.max(lo, arr[i] ?? arr[arr.length - 1] ?? lo)));
  const step = stepFor(kind);
  const out = (k, reps, rule, why) => ({ kg: k, reps, rule, text: why });

  // Verdicts of the last sessions against the one before each.
  const verdicts = h.slice(1).map((x, i) => judgeExercise(h[i].sets, x.sets));
  const last3 = verdicts.slice(-3);
  if (last3.length === 3 && last3.every((v) => v !== 'beat')) {
    return out(roundTo(kg * 0.9, step), pad([lo]), 'minus10', 'No improvement for 3 sessions: −10% and rebuild');
  }
  if (h.length >= 2 && below(L) && below(h[h.length - 2].w)) {
    return out(roundTo(kg * 0.95, step), pad([lo]), 'minus5', 'Below the rep range 2 sessions in a row: −5%');
  }
  if (below(L)) {
    return out(kg, pad(atTop.map((s) => s.reps)), 'repeat', `A set was below ${lo} reps: same weight, repeat`);
  }
  if (atTop.length >= Math.min(n, L.length) && atTop.every((s) => s.reps >= hi) && L.every((s) => s.reps >= hi)) {
    return out(Math.round((kg + step) * 100) / 100, pad([lo]), 'up', `All sets hit ${hi}: +${fmt(step)} kg, back to ${lo} reps`);
  }
  // Same weight, +1 rep on the weakest set(s).
  const reps = pad(atTop.map((s) => s.reps));
  const min = Math.min(...reps);
  const next = reps.map((r) => (r === min ? Math.min(hi, r + 1) : r));
  return out(kg, next, 'reps', 'Same weight: +1 rep on your weakest set');
}

// Whole session: 'progressed' | 'held' | 'dropped' ('completed' in deload weeks).
//   exercises: [{ exercise_id, verdict }]
export function judgeSession(exercises = [], { deload = false } = {}) {
  if (deload) return 'completed';
  const judged = exercises.filter((e) => e.verdict);
  if (judged.some((e) => isMainLift(e.exercise_id) && e.verdict === 'dropped')) return 'dropped';
  const beat = judged.filter((e) => e.verdict === 'beat').length;
  return judged.length && beat * 2 >= judged.length ? 'progressed' : 'held';
}

export const VERDICT = { beat: ['⬆️', 'Beat'], matched: ['➡️', 'Matched'], dropped: ['⬇️', 'Dropped'] };
export const SESSION_VERDICT = { progressed: 'Progressed', held: 'Held', dropped: 'Dropped', completed: 'Completed (deload)' };
export const MARK = { up: '⬆️', on: '➡️', down: '⬇️' };

// "40 kg × 9, 8, 8" (bodyweight: "BW × 8, 8" or "BW+5 kg × 8").
export function setsText(kg, reps, bw = false) {
  const w = bw ? (kg > 0 ? `BW+${fmt(kg)} kg` : 'BW') : `${fmt(kg)} kg`;
  return `${w} × ${reps.join(', ')}`;
}
export function lastText(sets, bw = false) {
  const ws = work(sets);
  if (!ws.length) return '';
  const kg = topKg(ws);
  const same = ws.every((s) => s.kg === kg);
  return same ? setsText(kg, ws.map((s) => s.reps), bw) : ws.map((s) => `${bw ? (s.kg ? `+${fmt(s.kg)}` : 'BW') : fmt(s.kg)}×${s.reps}`).join(', ');
}
export { bestE1rm as e1rmOf, work as workingSets };
