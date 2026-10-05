// Cut plan runs in the running coach's session format (see run-plan.js): 2 runs a week — an easy run and
// the week's quality run from fit-cut-plan.md. Pure; covered by tests/cut-run.test.js.
// Watch workouts are built from these fields by run-plan.js sessionSteps(), exactly as for any other plan.

import { PLAN } from './cut-calc.js';

const pace = (t) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
const band = (t, w = 5) => [pace(t) - w, pace(t) + w];
const EASY = [390, 405]; // 6:30–6:45/km
const WARM = '10 min easy';
// Rough km for a duration at a pace (only used for the planned distance shown in the app).
const kmFor = (min, secPerKm) => Math.round(((min * 60) / secPerKm) * 10) / 10;

// The quality run of a plan week as session fields.
const QUALITY = {
  1: { type: 'intervals', title: 'Intervals 4 × 800 m', main: '4 × 800 m @ 5:25/km, 2 min jog between reps.', pace: '5:25', km: 3.2 },
  2: { type: 'intervals', title: 'Intervals 5 × 800 m', main: '5 × 800 m @ 5:25/km, 2 min jog between reps.', pace: '5:25', km: 4 },
  3: { type: 'intervals', title: 'Intervals 4 × 1 km', main: '4 × 1 km @ 5:20/km, 2–3 min jog between reps.', pace: '5:20', km: 4 },
  4: { type: 'intervals', title: 'Intervals 5 × 1 km', main: '5 × 1 km @ 5:20/km, 2–3 min jog between reps.', pace: '5:20', km: 5 },
  5: { type: 'strides', title: 'Deload: easy + strides', main: '3 km easy (about 20 min), then 6 × 20 s strides (quick and smooth, walk back to recover).', km: 3 },
  6: { type: 'intervals', title: 'Tempo 2 × 10 min', main: '2 × 10 min tempo @ 5:35/km, 3 min jog between.', pace: '5:35', km: 3.6 },
  7: { type: 'intervals', title: 'Tempo 3 × 8 min', main: '3 × 8 min tempo @ 5:35/km, 2 min jog between.', pace: '5:35', km: 4.3 },
  8: { type: 'tempo', title: 'Tempo 20 min', main: '20 min continuous tempo @ 5:40/km.', pace: '5:40', km: 3.5 },
  9: { type: 'intervals', title: 'Intervals 5 × 1 km', main: '5 × 1 km @ 5:15/km, 2 min jog between reps.', pace: '5:15', km: 5 },
  10: { type: 'strides', title: 'Deload: easy + strides', main: '3 km easy (about 20 min), then 6 × 20 s strides (quick and smooth, walk back to recover).', km: 3 },
  11: { type: 'test5k', title: '5 km time trial', main: '5 km, run as fast as you can sustain evenly. Benchmark for the end of the cut.', km: 5 },
};
QUALITY[12] = QUALITY[9];
QUALITY[13] = QUALITY[8];

const PURPOSE = {
  intervals: 'Hard reps at a set pace keep your speed and aerobic power while you are eating less.',
  tempo: 'Comfortably-hard running holds your threshold fitness through the cut.',
  strides: 'Deload week: short, quick strides keep your legs sharp without fatigue.',
  test5k: 'Benchmark: an honest 5 km effort to see where you finish the cut.',
};

// [{ week, phase, type, title, purpose, warmup, main, cooldown, totalKm, targetPace, hrGuidance, tips }] in order:
// each week's easy run (Tue in the example week) then its quality run (Thu).
export function cutRunSessions(maxHr = null) {
  const out = [];
  for (const w of PLAN) {
    const easyKm = kmFor(w.easyMin, 400);
    out.push({
      week: w.week, phase: w.phase, type: 'easy', title: `Easy run ${w.easyMin} min`,
      purpose: 'Conversational running adds calorie burn and aerobic base without eating into recovery for the gym.',
      warmup: '', cooldown: '', main: `${w.easyMin} min easy @ 6:30–6:45/km (about ${easyKm} km). Walk breaks are fine.`,
      totalKm: easyKm, targetPace: EASY,
      hrGuidance: maxHr ? `Conversational — keep it below about ${Math.round(maxHr * 0.8)} bpm.` : 'Conversational pace — you should be able to talk in full sentences.',
      tips: ['If you are breathing hard, slow down. Easy runs should feel easy, even more so in a calorie deficit.'],
    });
    const q = QUALITY[w.week];
    const test = q.type === 'test5k';
    out.push({
      week: w.week, phase: w.phase, type: q.type, title: q.title, purpose: PURPOSE[q.type],
      warmup: test ? '15 min easy jogging + strides' : WARM, cooldown: WARM, main: q.main,
      totalKm: Math.round((q.km + (test ? 4 : 3)) * 10) / 10,
      targetPace: q.pace ? band(q.pace) : q.type === 'strides' ? EASY : null,
      hrGuidance: test ? 'Race effort — uncomfortable by the finish.' : q.type === 'strides' ? 'Easy, strides are quick but relaxed.' : 'Hard but controlled; the last rep should be as fast as the first.',
      tips: test ? ['Pace evenly — a slight negative split is ideal.'] : ['Always do the 10 min easy warm-up and cool-down.'],
    });
  }
  return out;
}
