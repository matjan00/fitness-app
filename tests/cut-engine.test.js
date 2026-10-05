import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeExercise, setMark, prescribe, judgeSession, planSlot, range, setsText, lastText } from '../docs/cut-engine.js';

const S = (kg, ...reps) => reps.map((r) => ({ type: 'n', kg, reps: r }));
const slotPress = { reps: '6-10', sets: 4, kind: 'main' };
const slotIso = { reps: '12-15', sets: 3, kind: 'iso' };

test('exercise verdicts', () => {
  assert.equal(judgeExercise(S(40, 8, 8, 7), S(40, 9, 8, 8)), 'beat');      // more total reps, same weight
  assert.equal(judgeExercise(S(40, 8, 8, 7), S(40, 8, 8, 7)), 'matched');
  assert.equal(judgeExercise(S(40, 8, 8, 7), S(40, 8, 7, 7)), 'matched');   // −1 rep tolerance
  assert.equal(judgeExercise(S(40, 8, 8, 8), S(40, 8, 7, 6)), 'dropped');   // fewer reps at same weight
  assert.equal(judgeExercise(S(40, 8, 8), S(42.5, 8, 8)), 'beat');          // more weight, same reps
  assert.equal(judgeExercise(S(40, 10, 10), S(42.5, 9, 8)), 'beat');        // heavier, e1RM up
  assert.equal(judgeExercise(S(40, 10, 10), S(35, 10, 10)), 'dropped');     // e1RM down > 3 %
  assert.equal(judgeExercise([], S(40, 8)), null);
  // warm-ups ignored
  assert.equal(judgeExercise([{ type: 'w', kg: 20, reps: 10 }, ...S(40, 8)], [{ type: 'w', kg: 20, reps: 5 }, ...S(40, 8)]), 'matched');
});

test('set marks against the target', () => {
  assert.equal(setMark({ kg: 40, reps: 8 }, { kg: 40, reps: 9 }), 'up');
  assert.equal(setMark({ kg: 40, reps: 8 }, { kg: 40, reps: 8 }), 'on');
  assert.equal(setMark({ kg: 40, reps: 8 }, { kg: 40, reps: 7 }), 'down');
  assert.equal(setMark({ kg: 40, reps: 8 }, { kg: 42.5, reps: 8 }), 'up');
  assert.equal(setMark({ kg: 40, reps: 8 }, { kg: 40, reps: 0 }), null);
});

test('prescription: add weight when every set hits the top', () => {
  const rx = prescribe([{ sets: S(60, 10, 10, 10, 10) }], slotPress);
  assert.equal(rx.rule, 'up');
  assert.equal(rx.kg, 62.5);
  assert.deepEqual(rx.reps, [6, 6, 6, 6]);
  const iso = prescribe([{ sets: S(10, 15, 15, 15) }], slotIso);
  assert.equal(iso.kg, 12); // smallest jump on isolation
});

test('prescription: +1 rep on the weakest set at the same weight', () => {
  const rx = prescribe([{ sets: S(40, 8, 8, 7) }], { reps: '6-10', sets: 3, kind: 'main' });
  assert.equal(rx.rule, 'reps');
  assert.equal(rx.kg, 40);
  assert.deepEqual(rx.reps, [8, 8, 8]);
  // plan has 4 sets, last time 3: pad with the last value
  assert.deepEqual(prescribe([{ sets: S(40, 9, 8, 8) }], slotPress).reps, [9, 9, 9, 9]);
});

test('prescription: repeat, −5 %, −10 %', () => {
  const rep = prescribe([{ sets: S(40, 8, 7) }, { sets: S(40, 7, 5) }], { reps: '6-10', sets: 2, kind: 'main' });
  assert.equal(rep.rule, 'repeat');
  assert.equal(rep.kg, 40);
  const m5 = prescribe([{ sets: S(40, 7, 5) }, { sets: S(40, 7, 5) }], { reps: '6-10', sets: 2, kind: 'main' });
  assert.equal(m5.rule, 'minus5');
  assert.equal(m5.kg, 37.5);
  const m10 = prescribe([{ sets: S(50, 8, 8) }, { sets: S(50, 8, 8) }, { sets: S(50, 8, 7) }, { sets: S(50, 8, 7) }], { reps: '6-10', sets: 2, kind: 'main' });
  assert.equal(m10.rule, 'minus10');
  assert.equal(m10.kg, 45);
  assert.deepEqual(m10.reps, [6, 6]);
  assert.equal(prescribe([], slotPress), null);
});

test('prescription: deload uses 2 sets', () => {
  assert.equal(prescribe([{ sets: S(40, 8, 8, 7) }], slotPress, { sets: 2 }).reps.length, 2);
});

test('session verdict', () => {
  assert.equal(judgeSession([{ exercise_id: 'Leverage_Chest_Press', verdict: 'beat' }, { exercise_id: 'Side_Lateral_Raise', verdict: 'matched' }]), 'progressed');
  assert.equal(judgeSession([{ exercise_id: 'Leverage_Chest_Press', verdict: 'matched' }, { exercise_id: 'Side_Lateral_Raise', verdict: 'matched' }, { exercise_id: 'x', verdict: 'beat' }]), 'held');
  assert.equal(judgeSession([{ exercise_id: 'Leverage_Chest_Press', verdict: 'dropped' }, { exercise_id: 'x', verdict: 'beat' }]), 'dropped');
  assert.equal(judgeSession([{ exercise_id: 'x', verdict: 'dropped' }]), 'held'); // only main lifts make a session drop
  assert.equal(judgeSession([], { deload: true }), 'completed');
});

test('plan slots, swaps and text', () => {
  assert.equal(planSlot('Wide-Grip_Lat_Pulldown').name, 'Pull-Up');
  assert.equal(planSlot('Side_Lateral_Raise', 'C').reps, '12-15');
  assert.equal(planSlot('nope'), null);
  assert.deepEqual(range('12-20'), { lo: 12, hi: 20 });
  assert.equal(setsText(40, [9, 8, 8]), '40 kg × 9, 8, 8');
  assert.equal(setsText(0, [8, 8], true), 'BW × 8, 8');
  assert.equal(lastText(S(40, 8, 8, 7)), '40 kg × 8, 8, 7');
  assert.equal(lastText([...S(40, 8), ...S(35, 10)]), '40×8, 35×10');
});
