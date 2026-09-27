// Realistic sample runs for "Try with demo data". Lives in memory only — never saved to the store.
// Pure (no DOM); deterministic for a given `now` so the demo looks the same all day.

import { trainingPaces, raceTime } from './run-coach.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Google encoded polyline (what Strava's map.summary_polyline uses).
export function encodePolyline(points) {
  let out = '', pl = 0, pg = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5);
    out += enc(a - pl) + enc(b - pg);
    pl = a; pg = b;
  }
  return out;
}

function route(distM, rnd, variant) {
  // A lumpy loop around a park in Warsaw sized to the run distance.
  const lat0 = 52.2125 + (variant % 3) * 0.004, lng0 = 20.995 + (variant % 4) * 0.005;
  const r = distM / (2 * Math.PI) / 1.15;
  const pts = [];
  const n = 48;
  const wob = [rnd() * 0.25, rnd() * 0.2, rnd() * 2 * Math.PI];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const rr = r * (1 + wob[0] * Math.sin(3 * a + wob[2]) + wob[1] * Math.cos(5 * a));
    const dy = rr * Math.sin(a) * 0.8, dx = rr * Math.cos(a) * 1.2;
    pts.push([lat0 + dy / 111320, lng0 + dx / (111320 * Math.cos((lat0 * Math.PI) / 180))]);
  }
  return encodePolyline(pts);
}

const EFFORTS = [['400m', 400], ['1/2 mile', 804.67], ['1k', 1000], ['1 mile', 1609.34], ['2 mile', 3218.69], ['5k', 5000], ['10k', 10000], ['15k', 15000], ['Half-Marathon', 21097.5]];

// Build one run from segments [{ d, pace, lap }] (pace s/km). Fills splits, laps, HR, best efforts.
function buildRun({ id, start, name, segments, vdot, rnd, workout_type, variant, hot = 0 }) {
  const maxHr = 191, rest = 52;
  const vo2 = (p) => { const v = 60000 / p; return -4.6 + 0.182258 * v + 0.000104 * v * v; };
  // 10 m resolution stream of time and HR.
  const step = 10;
  const times = [0], hrs = [];
  let t = 0, hr = 100;
  let totalD = 0;
  const lapsOut = [];
  const totalLen = segments.reduce((s, x) => s + x.d, 0);
  for (const seg of segments) {
    const lap = { d: 0, s: 0, hrSum: 0, n: 0 };
    for (let d = 0; d < seg.d; d += step) {
      const noise = 1 + (rnd() - 0.5) * 0.03;
      const p = seg.pace * noise;
      const dt = (p / 1000) * step;
      t += dt; totalD += step;
      const f = Math.min(1.08, vo2(seg.pace) / vdot);
      const drift = (totalD / totalLen) * (0.035 + hot);
      const target = rest + (maxHr - rest) * Math.min(0.99, 0.18 + 0.8 * f + drift);
      hr += (target - hr) * Math.min(1, dt / 35);
      times.push(t); hrs.push(hr);
      lap.d += step; lap.s += dt; lap.hrSum += hr; lap.n++;
    }
    if (seg.lap !== false) lapsOut.push(lap);
    else {
      const prev = lapsOut[lapsOut.length - 1];
      if (prev) { prev.d += lap.d; prev.s += lap.s; prev.hrSum += lap.hrSum; prev.n += lap.n; } else lapsOut.push(lap);
    }
  }
  const dist = totalD;
  const splits = [];
  for (let k = 0; k * 1000 < dist; k++) {
    const i0 = k * 100, i1 = Math.min((k + 1) * 100, times.length - 1);
    const d = (i1 - i0) * step;
    if (d < 50) break;
    const h = hrs.slice(i0, i1);
    splits.push({ km: k + 1, d, s: Math.round(times[i1] - times[i0]), hr: Math.round((h.reduce((a, b) => a + b, 0) / h.length) * 10) / 10, elev: Math.round((rnd() - 0.5) * 12 * 10) / 10 });
  }
  const best = [];
  for (const [nm, m] of EFFORTS) {
    const w = Math.round(m / step);
    if (w >= times.length) continue;
    let b = Infinity;
    for (let i = 0; i + w < times.length; i++) b = Math.min(b, times[i + w] - times[i]);
    best.push({ name: nm, s: Math.round(b), distance: m });
  }
  const moving = Math.round(t);
  const avgHr = hrs.reduce((a, b) => a + b, 0) / hrs.length;
  const avgPace = moving / (dist / 1000);
  return {
    id, strava_id: String(9000000000 + id.length * 1000 + variant), name, type: 'Run', sport: 'Run',
    start: new Date(start).toISOString(), start_local: new Date(start).toISOString(),
    distance_m: dist, moving_s: moving, elapsed_s: moving + Math.round(rnd() * 90), elev_m: Math.round(20 + rnd() * 60),
    avg_hr: Math.round(avgHr * 10) / 10, max_hr: Math.round(Math.max(...hrs) + 2),
    avg_cadence: Math.round(186 - avgPace / 18 + (rnd() - 0.5) * 4),
    avg_speed: dist / moving, suffer: Math.round((moving / 60) * ((avgHr - 100) / 40) ** 2),
    workout_type, detail: true, demo: true,
    splits,
    laps: lapsOut.map((l, i) => ({ n: i + 1, d: Math.round(l.d), s: Math.round(l.s), hr: Math.round((l.hrSum / l.n) * 10) / 10 })),
    best_efforts: best,
    polyline: route(dist, rnd, variant),
  };
}

const kmSegs = (distKm, pace, jitter = 0) => {
  const out = [];
  for (let i = 0; i < Math.floor(distKm); i++) out.push({ d: 1000, pace: pace + jitter * (i / distKm) });
  const rest = Math.round((distKm - Math.floor(distKm)) * 1000 / 10) * 10;
  if (rest >= 10) out.push({ d: rest, pace });
  return out;
};

export function demoRuns(now = Date.now()) {
  const day0 = new Date(now);
  day0.setHours(0, 0, 0, 0);
  const rnd = rng(Math.floor(day0.getTime() / 86400000));
  const monday = day0.getTime() - ((day0.getDay() + 6) % 7) * 86400000;
  const WEEKS = 22;
  const runs = [];
  let n = 0;
  for (let w = WEEKS - 1; w >= 0; w--) {
    const weekStart = monday - w * 7 * 86400000;
    const progress = (WEEKS - 1 - w) / (WEEKS - 1);
    const vdot = 40.5 + 4.5 * progress + (rnd() - 0.5) * 0.6;
    const P = trainingPaces(vdot);
    const easy = (P.easy[0] + P.easy[1]) / 2;
    const vol = 22 + 14 * progress;
    const plan = [
      { day: 1, kind: 'intervals' },
      { day: 3, kind: w % 2 ? 'tempo' : 'easy' },
      { day: 5, kind: w % 5 === 2 ? 'race' : 'easy' },
      { day: 6, kind: 'long' },
    ];
    if (w % 6 === 4) plan.splice(1, 1); // an occasional 3-run week
    for (const p of plan) {
      const hour = p.day >= 5 ? 9 : 18;
      const start = weekStart + p.day * 86400000 + (hour * 60 + Math.round(rnd() * 40)) * 60000;
      if (start > now) continue;
      const id = `demo-run-${w}-${p.day}`;
      let segments, name, workout_type = 0, hot = 0;
      if (p.kind === 'intervals') {
        const reps = 4 + Math.round(progress * 2);
        const repD = w % 3 === 0 ? 800 : 1000;
        segments = [...kmSegs(2, easy)];
        for (let i = 0; i < reps; i++) {
          segments.push({ d: repD, pace: P.interval * (1 + (i === reps - 1 && w % 4 === 1 ? 0.05 : 0) - 0.01 + rnd() * 0.02) });
          if (i < reps - 1) segments.push({ d: 400, pace: easy * 1.18 });
        }
        segments.push(...kmSegs(1.5, easy * 1.02));
        name = `${reps} × ${repD === 1000 ? '1 km' : '800 m'} intervals`;
        workout_type = 3;
      } else if (p.kind === 'tempo') {
        const tKm = 4 + Math.round(progress * 2);
        segments = [...kmSegs(2, easy), ...kmSegs(tKm, P.threshold + 3 - rnd() * 6).map((s, i) => ({ ...s, lap: i === 0 })), ...kmSegs(1.5, easy)];
        name = 'Tempo run';
        workout_type = 3;
      } else if (p.kind === 'race') {
        const target = raceTime(vdot, 5000) / 5 * (1 + (rnd() - 0.3) * 0.02);
        // Logged as its own activity (warm-up saved separately), slightly negative split.
        segments = kmSegs(5, target, -6);
        name = 'Parkrun 5k';
        workout_type = 1;
      } else if (p.kind === 'long') {
        const d = Math.round(vol * 0.32 * 2) / 2;
        segments = kmSegs(d, easy * 1.01, 8);
        name = 'Long Sunday run';
        workout_type = 2;
        hot = w === 1 ? 0.06 : 0;
      } else {
        const fast = w === 0 || w === 3; // a couple of easy runs done too fast, for the feedback demo
        const d = Math.round((vol - 8 - vol * 0.32) / 2 * 2) / 2 || 6;
        segments = kmSegs(Math.max(5, d), fast ? P.easy[0] - 25 : easy);
        name = p.day === 5 ? 'Saturday easy' : 'Easy run';
      }
      runs.push(buildRun({ id, start, name, segments, vdot, rnd, workout_type, variant: n++, hot }));
    }
  }
  // Strava-style PR ranks: effort faster than every earlier one.
  runs.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const bestSoFar = {};
  for (const r of runs) {
    for (const e of r.best_efforts) {
      if (!(e.name in bestSoFar) || e.s < bestSoFar[e.name]) {
        if (e.name in bestSoFar) e.pr_rank = 1;
        bestSoFar[e.name] = e.s;
      }
    }
  }
  runs.forEach((r, i) => { r.strava_id = String(12000000000 + i * 7919); });
  return runs.reverse();
}

// A few gym sessions so the gym/run interplay tips can be seen in the demo.
export function demoWorkouts(now = Date.now()) {
  const day0 = new Date(now);
  day0.setHours(0, 0, 0, 0);
  const monday = day0.getTime() - ((day0.getDay() + 6) % 7) * 86400000;
  const legs = (t) => ({
    id: `demo-gym-${t}`, name: 'Leg day', started_at: new Date(t).toISOString(), ended_at: new Date(t + 70 * 60000).toISOString(),
    exercises: [
      { exercise_id: 'Barbell_Full_Squat', name: 'Barbell Full Squat', sets: [{ type: 'w', kg: 40, reps: 8 }, ...Array(4).fill({ type: 'n', kg: 80, reps: 6 })] },
      { exercise_id: 'Romanian_Deadlift', name: 'Romanian Deadlift', sets: Array(3).fill({ type: 'n', kg: 70, reps: 8 }) },
    ],
  });
  const out = [];
  // Last week: legs on Monday evening (the day before intervals).
  out.push(legs(monday - 7 * 86400000 + 19 * 3600000));
  out.push(legs(monday - 14 * 86400000 + 12 * 3600000 + 2 * 86400000));
  return out.filter((w) => Date.parse(w.started_at) < now);
}
