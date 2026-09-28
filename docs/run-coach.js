// Running coach: pure, rule-based logic (no DOM, no store). Covered by tests/run-coach.test.js.
//
// A run (kind 'run' record, written by the scheduled Garmin sync job, see scripts/garmin_sync.py):
//   { id, garmin_id, name, type, sport, start (ISO), start_local, distance_m, moving_s, elapsed_s, elev_m,
//     avg_hr, max_hr, avg_cadence (steps/min), avg_speed, max_speed, suffer, workout_type (1 race, 2 long, 3 workout),
//     splits:[{km, d, s, hr, elev}], laps:[{n, d, s, hr, cad}], best_efforts:[{name, s, distance, pr_rank}], polyline }
// Every field except start / distance_m / moving_s may be missing.
//
// Paces are seconds per km. "Faster" means a smaller number.

const DAY = 86400000;
const WEEK = 7 * DAY;

// ---------- small helpers ----------
const num = (x) => (x == null || x === '' || !Number.isFinite(+x) ? null : +x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, step = 1) => Math.round(x / step) * step;
export const median = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
const pad = (n) => String(n).padStart(2, '0');

export const startMs = (run) => Date.parse(run.start || run.start_local || '') || 0;
export const km = (m) => (num(m) || 0) / 1000;
export function paceOf(run) {
  const d = num(run.distance_m), s = num(run.moving_s) || num(run.elapsed_s);
  return d && d > 50 && s ? s / (d / 1000) : null;
}
const pace = (d, s) => (d > 0 && s > 0 ? s / (d / 1000) : null);

// "4:05" (per km, no unit)
export function fmtPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '–';
  let s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
// "22:31", "1:05:12"
export function fmtTime(secs) {
  if (!Number.isFinite(secs)) return '–';
  const t = Math.max(0, Math.round(secs));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export const fmtKm = (m, digits = 1) => `${(Math.round((num(m) || 0) / 10 ** (3 - digits)) / 10 ** digits).toFixed(digits)}`;
// "6", "6.5"
export const kmShort = (k) => String(Math.round(k * 10) / 10);
export const paceRange = (r) => (r ? `${fmtPace(r[0])}–${fmtPace(r[1])}` : '–');

// Local-time week key (Monday, 'YYYY-MM-DD') and day key.
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function weekStartMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
const addDaysMs = (ms, n) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekday = (ms) => DAY_NAMES[(new Date(ms).getDay() + 6) % 7];

// ---------- VDOT (Jack Daniels & Jimmy Gilbert) ----------
// velocity v in metres/minute, time t in minutes
const vo2At = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;
const pctMax = (t) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
// Velocity (m/min) that costs a given VO2.
const velocityFor = (vo2) => (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (4.6 + vo2))) / (2 * 0.000104);

export function vdotFromRace(distM, secs) {
  distM = num(distM); secs = num(secs);
  if (!distM || !secs || distM < 400 || secs < 60) return null;
  const t = secs / 60;
  const v = distM / t;
  const x = vo2At(v) / pctMax(t);
  return Number.isFinite(x) && x > 0 ? x : null;
}

// Race time (seconds) for a distance at a given VDOT (bisection; vdotFromRace falls as time rises).
export function raceTime(vdot, distM) {
  if (!vdot || !distM) return null;
  let lo = (distM / 1000) * 90, hi = (distM / 1000) * 1200; // 1:30/km … 20:00/km
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromRace(distM, mid) > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Riegel: T2 = T1 × (D2 / D1)^1.06
export const riegel = (t1, d1, d2, k = 1.06) => (t1 && d1 && d2 ? t1 * (d2 / d1) ** k : null);

// Training paces (sec/km) as fractions of VDOT, calibrated against Daniels' tables
// (VDOT 50 → E 5:07–5:38, M 4:31, T 4:15, I 3:55, R 3:41).
export function trainingPaces(vdot) {
  if (!vdot) return null;
  const p = (f) => 60000 / velocityFor(vdot * f);
  const marathon = raceTime(vdot, 42195) / 42.195;
  return {
    easy: [p(0.70), p(0.62)], // [faster end, slower end]
    marathon,
    threshold: p(0.88),
    interval: p(0.975),
    repetition: p(1.05),
  };
}

// VDOT whose easy-range midpoint equals a given pace. Used to guess zones before any hard effort exists.
export function vdotFromEasyPace(secPerKm) {
  if (!secPerKm) return null;
  let lo = 15, hi = 85;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const e = trainingPaces(mid).easy;
    if ((e[0] + e[1]) / 2 > secPerKm) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- fitness estimate ----------
const RACE_NAME = /\b(race|parkrun|time ?trial|tt|zawody|marathon|półmaraton|polmaraton)\b/i;
const EFFORT_NAMES = new Set(['1 mile', '2 mile', '5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon']);

// Candidate performances from one run: Strava best efforts (1 mile and longer) and the whole run (≥ 3 km).
export function effortsOf(run) {
  const out = [];
  const t = startMs(run);
  for (const e of run.best_efforts || []) {
    if (!EFFORT_NAMES.has(e.name)) continue;
    const v = vdotFromRace(e.distance, e.s);
    if (v && v < 85) out.push({ name: e.name, distance: +e.distance, s: +e.s, vdot: v, t, run_id: run.id });
  }
  const d = num(run.distance_m), s = num(run.moving_s);
  if (d >= 3000 && s) {
    const v = vdotFromRace(d, s);
    if (v && v < 85) out.push({ name: `${fmtKm(d)} km run`, distance: d, s, vdot: v, t, run_id: run.id, whole: true });
  }
  return out;
}

// Best effort-based VDOT within the last `weeks` weeks before `now`. Returns null when nothing qualifies.
// Only real efforts count: races (workout_type 1 or a race-like name), or efforts clearly faster than
// typical running — at least 90 % of the VDOT implied by treating the median pace as easy pace.
// (An easy run scores only ~70 % of it, a tempo run ~90 %+, a race ~100 %.)
export function estimateVdot(runs, now = Date.now(), weeks = 8) {
  const from = now - weeks * WEEK;
  const inWin = runs.filter((r) => { const t = startMs(r); return t >= from && t <= now; });
  if (!inWin.length) return null;
  const typical = median(runs.filter((r) => startMs(r) <= now && startMs(r) >= now - 16 * WEEK).map(paceOf).filter(Boolean));
  const floor = typical ? vdotFromEasyPace(typical) * 0.9 : 0;
  let best = null;
  for (const r of inWin) {
    const race = num(r.workout_type) === 1 || RACE_NAME.test(r.name || '');
    for (const e of effortsOf(r)) {
      if (!race && e.vdot < floor) continue;
      if (!best || e.vdot > best.vdot) best = e;
    }
  }
  return best ? { vdot: best.vdot, effort: best } : null;
}

// Weekly VDOT values (8-week rolling best) for the trend line.
export function vdotHistory(runs, now = Date.now(), weeks = 16) {
  const out = [];
  const thisWeek = weekStartMs(now);
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDaysMs(thisWeek, -7 * i);
    const end = Math.min(now, addDaysMs(ws, 7) - 1);
    const est = estimateVdot(runs, end);
    if (est) out.push({ week: dayKey(ws), vdot: est.vdot });
  }
  return out;
}

// Predicted 5k / 10k: VDOT time, with a Riegel cross-check from the effort the VDOT came from.
export function predictions(est) {
  if (!est) return null;
  const out = {};
  for (const [key, d] of [['k5', 5000], ['k10', 10000]]) {
    const v = raceTime(est.vdot, d);
    const r = est.effort ? riegel(est.effort.s, est.effort.distance, d) : null;
    const lo = r ? Math.min(v, r) : v, hi = r ? Math.max(v, r) : v;
    out[key] = { s: v, riegel: r, lo, hi };
  }
  return out;
}

// ---------- heart rate ----------
// The user's max HR setting, else the highest plausible max HR seen in the data, else a generic 190.
export function estimateMaxHr(runs, setting) {
  const s = num(setting);
  if (s && s > 120 && s < 230) return { hr: s, source: 'setting' };
  const seen = runs.map((r) => num(r.max_hr)).filter((x) => x && x > 120 && x < 225).sort((a, b) => b - a);
  // Use the 2nd highest when there are several, to ignore one-off sensor spikes.
  const v = seen.length >= 3 ? seen[1] : seen[0];
  if (v && v >= 165) return { hr: v, source: 'data' };
  return { hr: v && v > 190 ? v : 190, source: 'default' };
}

// ---------- classification ----------
export const TYPE_LABELS = {
  easy: 'Easy', recovery: 'Recovery', long: 'Long run', tempo: 'Tempo', intervals: 'Intervals', race: 'Race', workout: 'Workout',
};
export const HARD_TYPES = new Set(['tempo', 'intervals', 'race', 'workout']);

const fullSplits = (run) => (run.splits || []).filter((s) => num(s.d) >= 900 && num(s.s) > 0);

// Rep blocks from laps: consecutive "fast" laps merged. Needs ≥ 4 laps.
export function repsFromLaps(run, paces) {
  const laps = (run.laps || []).filter((l) => num(l.d) >= 100 && num(l.s) >= 20);
  if (laps.length < 4) return [];
  const lp = laps.map((l) => pace(l.d, l.s));
  const med = median(lp);
  const cut = paces ? Math.min(med * 0.95, paces.marathon + 5) : med * 0.9;
  const blocks = [];
  let cur = null;
  laps.forEach((l, i) => {
    if (lp[i] <= cut) {
      if (!cur) { cur = { d: 0, s: 0, hrS: 0, hrN: 0, laps: 0 }; blocks.push(cur); }
      cur.d += +l.d; cur.s += +l.s; cur.laps++;
      if (num(l.hr)) { cur.hrS += l.hr * l.s; cur.hrN += +l.s; }
    } else cur = null;
  });
  return blocks.map((b) => ({ d: b.d, s: b.s, pace: pace(b.d, b.s), hr: b.hrN ? b.hrS / b.hrN : null }));
}

// Longest stretch of consecutive km splits at or faster than a pace.
function sustainedBlock(run, maxPace) {
  const sp = fullSplits(run);
  let best = { n: 0, d: 0, s: 0 }, cur = { n: 0, d: 0, s: 0 };
  for (const s of sp) {
    if (pace(s.d, s.s) <= maxPace) {
      cur = { n: cur.n + 1, d: cur.d + +s.d, s: cur.s + +s.s };
      if (cur.d > best.d) best = cur;
    } else cur = { n: 0, d: 0, s: 0 };
  }
  return best;
}


// ctx: { paces, vdot, avgDist } — see buildContext.
export function classifyRun(run, ctx = {}) {
  const paces = ctx.paces;
  const d = num(run.distance_m) || 0;
  const p = paceOf(run);
  const mov = num(run.moving_s) || 0;
  const wt = num(run.workout_type);
  if (wt === 1) return { type: 'race' };

  const reps = repsFromLaps(run, paces);
  const shortReps = reps.filter((r) => r.d <= 3300);
  if (shortReps.length >= 3) return { type: 'intervals', reps: shortReps };

  if (paces && p && d >= 3000) {
    const pred = ctx.vdot ? raceTime(ctx.vdot, d) / (d / 1000) : null;
    const raceLike = pred && p <= pred * 1.02 && p <= paces.threshold;
    if (raceLike || (RACE_NAME.test(run.name || '') && p <= paces.threshold + 5)) return { type: 'race' };
  }

  const longMin = Math.max(12000, (ctx.avgDist || 0) * 1.5);
  const isLong = wt === 2 || d >= longMin || mov >= 80 * 60;

  if (paces) {
    // One sustained fast lap block (e.g. a 20-min tempo lap) or ≥ 3 consecutive km at ~threshold pace.
    const tBlock = reps.find((r) => r.s >= 10 * 60 && r.pace <= paces.threshold + 12);
    const sb = sustainedBlock(run, paces.threshold + 12);
    const tempoD = Math.max(tBlock ? tBlock.d : 0, sb.d);
    if (tempoD >= 2900 && !(isLong && tempoD < d * 0.3)) {
      return { type: 'tempo', tempo: tBlock && tBlock.d >= sb.d ? { d: tBlock.d, s: tBlock.s } : { d: sb.d, s: sb.s } };
    }
    if (!sb.d && !tBlock && p && d >= 3000 && d <= 16000 && p <= paces.threshold + 8) {
      return { type: 'tempo', tempo: { d, s: mov } };
    }
  }
  if (isLong) return { type: 'long' };
  if (wt === 3) return { type: 'workout' };
  if (paces && p && d <= 6500 && p >= paces.easy[1]) return { type: 'recovery' };
  return { type: 'easy' };
}

// Seconds spent easy vs hard in a run (for the 80/20 check).
export function intensityOf(run, cls, ctx = {}) {
  const total = num(run.moving_s) || 0;
  if (!total) return { easy: 0, hard: 0 };
  if (cls.type === 'race') return { easy: 0, hard: total };
  if (cls.type === 'intervals') {
    const hard = Math.min(total, cls.reps.reduce((s, r) => s + r.s, 0));
    return { easy: total - hard, hard };
  }
  const sp = fullSplits(run);
  const paces = ctx.paces;
  if (sp.length && (paces || ctx.maxHr)) {
    let hard = 0, tot = 0;
    for (const s of sp) {
      tot += +s.s;
      const hrHard = ctx.maxHr && num(s.hr) ? s.hr >= 0.85 * ctx.maxHr : false;
      const paceHard = paces ? pace(s.d, s.s) <= paces.marathon - 5 : false;
      if (hrHard || paceHard) hard += +s.s;
    }
    const share = tot ? hard / tot : 0;
    return { easy: total * (1 - share), hard: total * share };
  }
  if (cls.type === 'tempo' || cls.type === 'workout') return { easy: total / 2, hard: total / 2 };
  return { easy: total, hard: 0 };
}

// ---------- gym interaction ----------
const LEG_NAME = /squat|deadlift|lunge|leg press|leg curl|leg extension|hip thrust|step.?up|romanian|rdl|hack|calf raise|glute|bulgarian/i;
export const isLegByName = (ex) => LEG_NAME.test(String(ex?.name || ex?.exercise_id || '').replace(/_/g, ' '));

// Working leg sets in a gym workout. isLeg(exercise) → boolean overrides the name check when given.
export function legSets(workout, isLeg) {
  let n = 0;
  for (const ex of workout.exercises || []) {
    const leg = isLeg ? isLeg(ex) : isLegByName(ex);
    if (!leg) continue;
    n += (ex.sets || []).filter((s) => s && s.type !== 'w' && (s.done !== false)).length;
  }
  return n;
}
export const HEAVY_LEG_SETS = 6;

// A heavy leg workout that finished 0–30 h before `ms`.
export function legDayBefore(ms, workouts, isLeg) {
  let found = null;
  for (const w of workouts || []) {
    const end = Date.parse(w.ended_at || w.started_at || '');
    if (!end || end > ms || ms - end > 30 * 3600 * 1000) continue;
    if (legSets(w, isLeg) >= HEAVY_LEG_SETS && (!found || end > found.end)) found = { workout: w, end };
  }
  return found;
}

// ---------- context ----------
// Everything the screens need, computed once per data change.
export function buildContext({ runs = [], workouts = [], settings = {}, now = Date.now(), isLeg } = {}) {
  runs = runs.filter((r) => startMs(r) && num(r.distance_m) > 0).sort((a, b) => startMs(b) - startMs(a));
  const est = estimateVdot(runs, now, 8) || null;
  const olderEst = est ? null : estimateVdot(runs, now, 16);
  const recent = runs.filter((r) => startMs(r) >= now - 6 * WEEK && startMs(r) <= now);
  const avgDist = mean(recent.map((r) => +r.distance_m)) || 0;

  // Zones: real VDOT if we have a recent effort, else an older one, else a guess from typical easy-run pace.
  let zoneVdot = est?.vdot || olderEst?.vdot || null;
  let zoneSource = est ? 'effort' : olderEst ? 'old-effort' : null;
  if (!zoneVdot) {
    const typical = median(recent.map(paceOf).filter(Boolean)) || median(runs.slice(0, 12).map(paceOf).filter(Boolean));
    zoneVdot = typical ? vdotFromEasyPace(typical) : null;
    zoneSource = zoneVdot ? 'easy-runs' : null;
  }
  const paces = trainingPaces(zoneVdot);
  const maxHr = estimateMaxHr(runs, settings.max_hr);
  const ctx = {
    now, runs, workouts, isLeg, settings,
    runsPerWeek: clamp(num(settings.runs_per_week) || 4, 3, 6),
    focus: settings.focus === '10k' ? '10k' : '5k',
    est, olderEst, vdot: est?.vdot || olderEst?.vdot || null, zoneVdot, zoneSource, paces,
    maxHr: maxHr.hr, maxHrSource: maxHr.source, avgDist,
  };
  ctx.classes = new Map(runs.map((r) => [r.id, classifyRun(r, ctx)]));
  ctx.classOf = (r) => ctx.classes.get(r.id) || classifyRun(r, ctx);
  ctx.review = weeklyReview(ctx);
  ctx.plan = planWeek(ctx);
  ctx.nextPlan = planWeek(ctx, { next: true });
  ctx.today = todaySuggestion(ctx);
  ctx.prs = personalRecords(runs);
  ctx.predictions = predictions(est || olderEst);
  return ctx;
}

// ---------- per-run feedback ----------
// Returns up to 4 { tone: 'pr'|'good'|'tip'|'warn'|'info', text }.
export function runFeedback(run, ctx = {}) {
  const out = [];
  const cls = ctx.classOf ? ctx.classOf(run) : classifyRun(run, ctx);
  const paces = ctx.paces;
  const p = paceOf(run);
  const d = num(run.distance_m) || 0;
  const easyTxt = paces ? `${paceRange(paces.easy)}/km` : null;

  // PRs first — the most motivating.
  const prs = (run.best_efforts || []).filter((e) => num(e.pr_rank) === 1 && ['1k', '1 mile', '5k', '10k', 'Half-Marathon', 'Marathon'].includes(e.name));
  if (prs.length) {
    const top = prs.sort((a, b) => b.distance - a.distance)[0];
    out.push({ tone: 'pr', text: `New personal best: ${top.name} in ${fmtTime(top.s)}${prs.length > 1 ? ` (+${prs.length - 1} more PR${prs.length > 2 ? 's' : ''})` : ''}. Hard work paying off!` });
  }

  // Main verdict by type.
  if (cls.type === 'race') {
    const v = vdotFromRace(d, num(run.moving_s));
    out.push({ tone: 'good', text: `${fmtKm(d, 2)} km in ${fmtTime(num(run.moving_s))} (${fmtPace(p)}/km)${v ? ` — a VDOT of ${v.toFixed(1)}` : ''}. Take 1–2 easy days before the next hard session.` });
  } else if (cls.type === 'intervals') {
    const reps = cls.reps;
    const avg = pace(reps.reduce((s, r) => s + r.d, 0), reps.reduce((s, r) => s + r.s, 0));
    const repLen = median(reps.map((r) => r.d));
    const repTxt = `${reps.length} × ${repLen >= 950 ? `${fmtKm(round(repLen, 100), 1).replace('.0', '')} km` : `${round(repLen, 50)} m`}`;
    if (paces) {
      const target = repLen < 700 ? paces.repetition : paces.interval;
      const diff = avg - target;
      if (diff < -8) out.push({ tone: 'tip', text: `${repTxt} averaging ${fmtPace(avg)}/km — faster than your target ${fmtPace(target)}/km. Strong, but running reps too hard adds fatigue without extra benefit.` });
      else if (diff > 10) out.push({ tone: 'info', text: `${repTxt} averaging ${fmtPace(avg)}/km (target ${fmtPace(target)}/km). Fine if it felt hard — heat, hills and tired legs all slow reps down.` });
      else out.push({ tone: 'good', text: `${repTxt} averaging ${fmtPace(avg)}/km — right on your target of ${fmtPace(target)}/km. Textbook session.` });
    } else out.push({ tone: 'good', text: `${repTxt} averaging ${fmtPace(avg)}/km. Quality work like this is what makes you faster.` });
    if (reps.length >= 3) {
      const first = reps[0].pace, last = reps[reps.length - 1].pace;
      if (last > first * 1.04) out.push({ tone: 'tip', text: `The last rep was ${Math.round(last - first)} s/km slower than the first. Start the first reps a little more conservatively to keep them even.` });
      else if (Math.max(...reps.map((r) => r.pace)) - Math.min(...reps.map((r) => r.pace)) <= 6) out.push({ tone: 'good', text: 'Very even reps — great pacing control.' });
    }
  } else if (cls.type === 'tempo') {
    const tp = pace(cls.tempo.d, cls.tempo.s);
    const segTxt = cls.tempo.d < d * 0.9 ? `${fmtKm(cls.tempo.d)} km tempo section` : 'Tempo run';
    if (paces) {
      const diff = tp - paces.threshold;
      if (diff < -8) out.push({ tone: 'tip', text: `${segTxt} at ${fmtPace(tp)}/km — quicker than your threshold pace ${fmtPace(paces.threshold)}/km. Tempo should feel "comfortably hard"; going faster turns it into a race.` });
      else out.push({ tone: 'good', text: `${segTxt} at ${fmtPace(tp)}/km (threshold ${fmtPace(paces.threshold)}/km). This raises the pace you can hold for 5k and 10k.` });
    } else out.push({ tone: 'good', text: `${segTxt} at ${fmtPace(tp)}/km. Nice sustained effort.` });
  } else if (paces && p) {
    const label = cls.type === 'long' ? 'Long run' : cls.type === 'recovery' ? 'Recovery run' : 'Easy run';
    if (p < paces.easy[0] - 10) {
      out.push({ tone: 'tip', text: `${label} at ${fmtPace(p)}/km — your easy pace is ${easyTxt}. Slowing down helps you recover and makes the hard sessions count.` });
    } else if (p <= paces.easy[1] + 30) {
      out.push({ tone: 'good', text: `${label} at ${fmtPace(p)}/km — nicely inside your easy range (${easyTxt}).${cls.type === 'long' ? ' Long easy runs build the engine for 10k.' : ''}` });
    } else {
      out.push({ tone: 'info', text: `${label} at a relaxed ${fmtPace(p)}/km. Perfectly fine for recovery — easy can't really be too slow.` });
    }
  } else if (p) {
    out.push({ tone: 'info', text: `${fmtKm(d)} km at ${fmtPace(p)}/km. Log a few more runs and the coach will learn your paces.` });
  }

  // Pacing within a steady run.
  const sp = fullSplits(run);
  if (sp.length >= 4 && cls.type !== 'intervals') {
    const half = sp.length >> 1;
    const a = sp.slice(0, half), b = sp.slice(sp.length - half);
    const pa = pace(a.reduce((s, x) => s + +x.d, 0), a.reduce((s, x) => s + +x.s, 0));
    const pb = pace(b.reduce((s, x) => s + +x.d, 0), b.reduce((s, x) => s + +x.s, 0));
    const lastP = pace(sp[sp.length - 1].d, sp[sp.length - 1].s);
    const avgP = pace(sp.reduce((s, x) => s + +x.d, 0), sp.reduce((s, x) => s + +x.s, 0));
    if (pb < pa * 0.98) out.push({ tone: 'good', text: `Negative split: second half ${Math.round(pa - pb)} s/km faster than the first. That's how the best races are run.` });
    else if (pb > pa * 1.05 && (cls.type === 'race' || cls.type === 'tempo')) out.push({ tone: 'tip', text: `You slowed by ${Math.round(pb - pa)} s/km in the second half. Starting 5–10 s/km slower usually gives a faster finish time.` });
    else if (lastP > avgP * 1.07 && cls.type !== 'recovery') out.push({ tone: 'info', text: `The last km faded to ${fmtPace(lastP)}/km. Probably fatigue or a hill — worth watching if it keeps happening.` });
    else if (Math.abs(pb - pa) <= pa * 0.02 && out.length < 3) out.push({ tone: 'good', text: 'Very even pacing from start to finish.' });
  }

  // Heart-rate drift (aerobic decoupling) on steady runs.
  if (['easy', 'long', 'recovery'].includes(cls.type)) {
    const hs = sp.slice(1).filter((s) => num(s.hr));
    if (hs.length >= 4 && (num(run.moving_s) || 0) >= 30 * 60) {
      const half = hs.length >> 1;
      const ef = (arr) => (arr.reduce((s, x) => s + +x.d, 0) / arr.reduce((s, x) => s + +x.s, 0)) / mean(arr.map((x) => +x.hr));
      const e1 = ef(hs.slice(0, half)), e2 = ef(hs.slice(hs.length - half));
      const drift = ((e1 - e2) / e1) * 100;
      if (drift > 6) out.push({ tone: 'info', text: `Heart rate drifted ${Math.round(drift)} % relative to pace. Heat, dehydration or low endurance cause this — more easy mileage will bring it down.` });
      else if (drift < 3.5 && cls.type === 'long') out.push({ tone: 'good', text: `Heart rate stayed steady relative to pace (${Math.max(0, drift).toFixed(1)} % drift) — solid aerobic endurance.` });
    } else if (num(run.avg_hr) && ctx.maxHr && run.avg_hr > 0.85 * ctx.maxHr && cls.type !== 'long') {
      out.push({ tone: 'tip', text: `Average heart rate was ${Math.round(run.avg_hr)} bpm (${Math.round((run.avg_hr / ctx.maxHr) * 100)} % of max) — high for an easy run. Try slowing down until breathing feels conversational.` });
    }
  }

  // Heavy leg day right before a hard run.
  if (HARD_TYPES.has(cls.type) && ctx.workouts) {
    const lg = legDayBefore(startMs(run), ctx.workouts, ctx.isLeg);
    if (lg) out.push({ tone: 'tip', text: 'You did a heavy leg session less than a day before this. Hard runs go better on fresh legs — try leg day right after a hard run instead.' });
  }

  // Cadence (steps per minute).
  const cad = num(run.avg_cadence);
  if (cad && cad > 100 && out.length < 4) {
    if (cad < 160 && cls.type !== 'recovery') out.push({ tone: 'tip', text: `Cadence averaged ${Math.round(cad)} steps/min. A slightly quicker, shorter stride (about +5 %) can reduce overstriding and impact.` });
    else if (cad >= 175 && HARD_TYPES.has(cls.type)) out.push({ tone: 'good', text: `Cadence ${Math.round(cad)} steps/min — quick, efficient turnover.` });
  }
  return out.slice(0, 4);
}

// ---------- weekly review ----------
export function weeklySeries(runs, ctx = {}, now = Date.now(), weeks = 12) {
  const start0 = weekStartMs(now);
  const list = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDaysMs(start0, -7 * i);
    list.push({ start: ws, week: dayKey(ws), km: 0, runs: 0, secs: 0, longest: 0, easy: 0, hard: 0, elev: 0 });
  }
  const first = list[0].start;
  for (const r of runs) {
    const t = startMs(r);
    if (t < first || t > now) continue;
    const w = list.find((x, i) => t >= x.start && (i === list.length - 1 || t < list[i + 1].start));
    if (!w) continue;
    const k = km(r.distance_m);
    w.km += k; w.runs++; w.secs += num(r.moving_s) || 0; w.elev += num(r.elev_m) || 0;
    w.longest = Math.max(w.longest, k);
    const cls = ctx.classOf ? ctx.classOf(r) : classifyRun(r, ctx);
    const it = intensityOf(r, cls, ctx);
    w.easy += it.easy; w.hard += it.hard;
  }
  return list;
}

export function weeklyReview(ctx) {
  const { runs, now } = ctx;
  const weeks = weeklySeries(runs, ctx, now, 12);
  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];
  const prevWeek = weeks[weeks.length - 3];
  const messages = [];
  const firstRun = runs.length ? startMs(runs[runs.length - 1]) : now;

  // Acute : chronic load (km in the last 7 days vs weekly average of the last 28).
  const kmIn = (days) => runs.filter((r) => startMs(r) > now - days * DAY && startMs(r) <= now).reduce((s, r) => s + km(r.distance_m), 0);
  const acute = kmIn(7), chronic = kmIn(28) / 4;
  const acwr = now - firstRun >= 21 * DAY && chronic >= 5 ? acute / chronic : null;
  let load = 'ok';
  if (acwr != null && acwr > 1.5) {
    load = 'high';
    messages.push({ tone: 'warn', text: `Load spike: ${acute.toFixed(0)} km in the last 7 days is ${acwr.toFixed(1)}× your recent weekly average. Take an extra rest day and keep the next runs easy.` });
  } else if (acwr != null && acwr > 1.3) {
    load = 'raised';
    messages.push({ tone: 'tip', text: `Training load is rising fast (${acwr.toFixed(1)}× your 4-week average). Keep the next few days easy to let your body adapt.` });
  } else if (lastWeek && prevWeek && prevWeek.km >= 5 && lastWeek.km > prevWeek.km * 1.15 && lastWeek.km - prevWeek.km >= 5) {
    load = 'raised';
    messages.push({ tone: 'tip', text: `Last week's distance jumped ${Math.round((lastWeek.km / prevWeek.km - 1) * 100)} % (${prevWeek.km.toFixed(0)} → ${lastWeek.km.toFixed(0)} km). Increases of about 10 % a week are safer.` });
  } else if (acwr != null && acwr < 0.7 && chronic >= 10 && thisWeek.start + 3 * DAY < now) {
    messages.push({ tone: 'info', text: 'A lighter stretch — good for recovery. Build back up gradually rather than all at once.' });
  }

  // Intensity balance over the last 4 weeks.
  const last4 = weeks.slice(-4);
  const easyS = last4.reduce((s, w) => s + w.easy, 0), hardS = last4.reduce((s, w) => s + w.hard, 0);
  const runs4 = last4.reduce((s, w) => s + w.runs, 0);
  const easyShare = easyS + hardS > 0 ? easyS / (easyS + hardS) : null;
  if (easyShare != null && runs4 >= 4) {
    const pct = Math.round(easyShare * 100);
    if (easyShare < 0.7) messages.push({ tone: 'tip', text: `Only ${pct} % of your running time was easy in the last 4 weeks. Most fast runners keep about 80 % easy — slow down the in-between runs.` });
    else if (hardS < 60 && runs4 >= 6) messages.push({ tone: 'tip', text: 'All easy lately. Adding one faster session a week (intervals or tempo) is the quickest way to improve your 5k and 10k.' });
    else if (easyShare >= 0.72 && easyShare <= 0.92) messages.push({ tone: 'good', text: `${pct} % easy / ${100 - pct} % hard over 4 weeks — a great balance for getting faster.` });
  }

  // Long run share of last completed week.
  if (lastWeek && lastWeek.km >= 15 && lastWeek.runs >= 2 && lastWeek.longest / lastWeek.km > 0.45) {
    messages.push({ tone: 'tip', text: `Last week's long run was ${Math.round((lastWeek.longest / lastWeek.km) * 100)} % of the week. Keeping it to about a third spreads the load more safely.` });
  }

  // Consistency streak: weeks in a row with 2+ runs (the current week counts once it qualifies).
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].runs >= 2) streak++;
    else if (i === weeks.length - 1) continue;
    else break;
  }
  if (streak >= 3) messages.push({ tone: 'good', text: `${streak} weeks in a row with 2+ runs. Consistency is what makes you faster — keep it going!` });

  // Gym interaction in the last 14 days.
  const clashes = runs.filter((r) => startMs(r) > now - 14 * DAY && HARD_TYPES.has(ctx.classOf ? ctx.classOf(r).type : classifyRun(r, ctx).type)
    && legDayBefore(startMs(r), ctx.workouts, ctx.isLeg));
  if (clashes.length) {
    const r = clashes[0];
    messages.push({ tone: 'tip', text: `Your hard run on ${weekday(startMs(r))} came within a day of a heavy leg session. Put leg day on the same day as a hard run (after it) or before a rest day, so quality runs get fresh legs.` });
  }

  return { weeks, thisWeek, lastWeek, acute, chronic, acwr, load, easyShare, streak, messages: messages.slice(0, 5) };
}

// ---------- plan ----------
const DAY_SLOTS = {
  3: [1, 3, 6],
  4: [1, 2, 4, 6],
  5: [0, 1, 3, 4, 6],
  6: [0, 1, 2, 3, 5, 6],
};
const LAYOUTS = {
  3: ['quality', 'easy', 'long'],
  4: ['intervals', 'easy', 'tempo', 'long'],
  5: ['easy', 'intervals', 'tempo', 'strides', 'long'],
  6: ['easy', 'intervals', 'easy', 'tempo', 'strides', 'long'],
};

const pt = (paces, key, fallback) => (paces ? `${fmtPace(paces[key])}/km` : fallback);

// opts.next: plan for next week (this week counts as completed, nothing is marked done).
export function planWeek(ctx, opts = {}) {
  const next = Boolean(opts.next);
  const { review, paces, runsPerWeek: n, focus, now } = ctx;
  const weeks = review.weeks;
  const done = next ? weeks.slice(-3) : weeks.slice(-4, -1); // last 3 completed weeks
  const base = mean(done.map((w) => w.km)) || 0;
  const weekIdx = Math.floor(weekStartMs(now) / WEEK) + (next ? 1 : 0);
  const deload = review.load === 'high' || review.load === 'raised';
  let target;
  if (base < 5) target = n * 4;
  else if (deload) target = base * 0.85;
  else target = Math.min(base * 1.07, base + 5);
  target = Math.max(target, n * 3);

  const easyTxt = paces ? `${paceRange(paces.easy)}/km` : 'conversational pace';
  const iPace = pt(paces, 'interval', 'hard but controlled (3–5k race effort)');
  const rPace = pt(paces, 'repetition', 'fast and relaxed (mile race effort)');
  const tPace = pt(paces, 'threshold', 'comfortably hard (you could say a few words)');
  const mPace = pt(paces, 'marathon', 'steady');
  const wu = 2, cd = 1.5;

  const layout = LAYOUTS[n].map((k) => (k === 'quality' ? (focus === '10k' ? 'tempo' : 'intervals') : k));
  const sessions = [];

  const intervals = () => {
    if (review.load === 'high') {
      return { type: 'fartlek', hard: false, title: 'Easy fartlek', detail: `${wu} km easy, then 6 × 1 min brisk / 2 min easy, ${cd} km easy. Light and playful this week.`, km: wu + cd + 3 };
    }
    const iv = clamp(target * 0.08, 3, 8);
    const opt = focus === '10k' ? ['1k', '1200', 'mile'][weekIdx % 3] : ['1k', '800', '400'][weekIdx % 3];
    let reps, detail;
    if (opt === '800') { reps = clamp(Math.round(iv / 0.8), 4, 8); detail = `${reps} × 800 m @ ${iPace}, 2 min jog between`; return mk(reps * 0.8, detail); }
    if (opt === '400') { reps = clamp(Math.round(Math.min(iv, target * 0.05) / 0.4), 6, 10); detail = `${reps} × 400 m @ ${rPace}, 400 m walk/jog between`; return mk(reps * 0.4, detail); }
    if (opt === '1200') { reps = clamp(Math.round(iv / 1.2), 3, 6); detail = `${reps} × 1.2 km @ ${iPace}, 3 min jog between`; return mk(reps * 1.2, detail); }
    if (opt === 'mile') { reps = clamp(Math.round(iv / 1.6), 3, 5); detail = `${reps} × 1.6 km @ ${pt(paces, 'interval', 'hard')} (slightly slower is fine), 3 min jog between`; return mk(reps * 1.6, detail); }
    reps = clamp(Math.round(iv), 3, 6);
    detail = `${reps} × 1 km @ ${iPace}, 2–3 min jog between`;
    return mk(reps, detail);
    function mk(repKm, main) {
      return { type: 'intervals', hard: true, title: 'Intervals', detail: `${wu} km warm-up, ${main}, ${cd} km cool-down.`, km: wu + cd + repKm * 1.4 };
    }
  };
  const tempo = () => {
    if (review.load === 'high') return easy('Easy run', 'Swapped from tempo while your load settles.');
    const tv = clamp(target * (focus === '10k' ? 0.12 : 0.1), 3, 10);
    const tp = paces ? paces.threshold : 330;
    let main;
    if (weekIdx % 2 === 0) {
      const minutes = clamp(round((tv * tp) / 60, 5), 15, 40);
      main = `${minutes} min steady @ ${tPace}`;
      return { type: 'tempo', hard: true, title: 'Tempo run', detail: `${wu} km warm-up, ${main}, ${cd} km cool-down.`, km: wu + cd + (minutes * 60) / tp };
    }
    const reps = tv >= 5 ? clamp(Math.round(tv / 2), 2, 5) : clamp(Math.round(tv), 3, 6);
    const len = tv >= 5 ? 2 : 1;
    main = `${reps} × ${len} km @ ${tPace}, 1 min jog between`;
    return { type: 'tempo', hard: true, title: 'Cruise intervals', detail: `${wu} km warm-up, ${main}, ${cd} km cool-down.`, km: wu + cd + reps * len * 1.1 };
  };
  function easy(title = 'Easy run', extra = '') {
    return { type: 'easy', hard: false, title, detail: `Relaxed @ ${easyTxt}.${extra ? ` ${extra}` : ''}`, km: 0 };
  }
  const strides = () => ({ type: 'strides', hard: false, title: 'Easy + strides', detail: `Relaxed @ ${easyTxt}, then 6 × 20 s strides (quick and smooth, full recovery).`, km: 0 });
  const long = () => {
    const k = clamp(round(target * (n <= 4 ? 0.33 : 0.28), 0.5), 6, focus === '10k' ? 22 : 18);
    const finish = focus === '10k' && target >= 30 && weekIdx % 2 === 1 && !deload;
    return { type: 'long', hard: false, title: 'Long run', detail: finish ? `${kmShort(k)} km easy @ ${easyTxt}, with the last 3 km @ ${mPace}.` : `${kmShort(k)} km easy @ ${easyTxt}. Walk breaks are fine.`, km: k };
  };

  const makers = { intervals, tempo, easy: () => easy(), strides, long };
  layout.forEach((k, i) => sessions.push({ ...makers[k](), day: DAY_NAMES[DAY_SLOTS[n][i]], dayIdx: DAY_SLOTS[n][i] }));

  // Spread the remaining distance over the easy runs (≥ 3 km each).
  const fixed = sessions.filter((s) => s.km).reduce((a, s) => a + s.km, 0);
  const easyOnes = sessions.filter((s) => !s.km);
  const longKm = sessions.find((s) => s.type === 'long')?.km || 10;
  const each = easyOnes.length ? clamp(round((target - fixed) / easyOnes.length, 0.5), 3, Math.max(4, round(longKm * 0.85, 0.5))) : 0;
  easyOnes.forEach((s) => {
    s.km = each;
    s.detail = `${kmShort(each)} km ${s.detail[0].toLowerCase()}${s.detail.slice(1)}`;
  });
  sessions.forEach((s) => { s.km = round(s.km, 0.5); });
  const total = sessions.reduce((a, s) => a + s.km, 0);

  const notes = [];
  if (review.load === 'high') notes.push('Recovery week: your load jumped, so this week is lighter with no hard intervals.');
  else if (deload) notes.push('Slightly lighter week to absorb the recent increase.');
  else if (base >= 5) notes.push(`About ${Math.round(total)} km — a small step up from your recent ${Math.round(base)} km/week.`);
  else notes.push('Starter week: short, easy runs to build the habit. The plan grows with you.');
  if (!ctx.est) notes.push(ctx.zoneSource === 'easy-runs' ? 'Paces are estimated from your easy runs. Run a hard 5k (race or time trial) to calibrate them.' : 'Paces come from an older effort — a fresh 5k time trial will sharpen them.');

  // Mark sessions already done this week (in order: hard → hard slot, long → long, rest → easy slots).
  const thisWeekRuns = next ? [] : ctx.runs.filter((r) => startMs(r) >= weekStartMs(now) && startMs(r) <= now).sort((a, b) => startMs(a) - startMs(b));
  const extra = [];
  for (const r of thisWeekRuns) {
    const t = ctx.classOf ? ctx.classOf(r).type : classifyRun(r, ctx).type;
    const free = (pred) => sessions.find((s) => !s.done && pred(s));
    let slot;
    if (HARD_TYPES.has(t)) slot = free((s) => s.type === (t === 'race' ? 'intervals' : t)) || free((s) => s.hard) || free((s) => !s.hard && s.type !== 'long');
    else if (t === 'long') slot = free((s) => s.type === 'long') || free((s) => !s.hard);
    else slot = free((s) => ['easy', 'strides', 'fartlek'].includes(s.type)) || free((s) => s.type === 'long' && km(r.distance_m) >= s.km * 0.7) || null;
    if (slot) { slot.done = true; slot.run_id = r.id; } else extra.push(r.id);
  }
  return { targetKm: total, base, deload, sessions, notes, extra };
}

// ---------- today ----------
export function todaySuggestion(ctx) {
  const { plan, now, runs, review } = ctx;
  const today = dayKey(now);
  const todayIdx = (new Date(now).getDay() + 6) % 7;
  const ranToday = runs.find((r) => dayKey(startMs(r)) === today);
  if (ranToday) return { kind: 'done', title: 'Done for today', detail: 'Nice work. Refuel, sleep well, and let it sink in.', run_id: ranToday.id };
  const remaining = plan.sessions.filter((s) => !s.done);
  if (!remaining.length) return { kind: 'rest', title: 'Week complete', detail: 'Every planned run is done. Rest, stretch or add easy cross-training.' };
  if (review.load === 'high') return { kind: 'rest', title: 'Rest day', detail: 'Your load spiked recently — a full rest day now helps you come back stronger.' };

  const yesterday = dayKey(addDaysMs(now, -1));
  const ranYesterdayHard = runs.some((r) => dayKey(startMs(r)) === yesterday && HARD_TYPES.has(ctx.classOf ? ctx.classOf(r).type : classifyRun(r, ctx).type));
  const legs = legDayBefore(now, ctx.workouts, ctx.isLeg);
  const daysLeft = 7 - todayIdx;
  // The next session, preferring the one planned for today or earlier.
  let next = remaining.find((s) => s.dayIdx <= todayIdx) || remaining[0];
  let why = '';
  if (next.hard && (ranYesterdayHard || legs)) {
    const alt = remaining.find((s) => !s.hard && s.type !== 'long');
    why = ranYesterdayHard ? 'You ran hard yesterday' : 'Your legs are still recovering from a heavy leg session';
    if (alt) return { kind: 'session', session: alt, title: alt.title, detail: `${alt.detail} ${why}, so keep today easy and save "${next.title}" for later in the week.` };
    return { kind: 'rest', title: 'Rest or easy day', detail: `${why}. Rest today and do "${next.title}" tomorrow.` };
  }
  if (remaining.length < daysLeft && next.dayIdx > todayIdx) {
    return { kind: 'rest', title: 'Rest day', detail: `Next up: ${next.title} on ${next.day}.`, session: next };
  }
  const note = remaining.length > daysLeft ? ` (${remaining.length} runs left and ${daysLeft} day${daysLeft > 1 ? 's' : ''} — skip an easy run rather than doubling up.)` : '';
  return { kind: 'session', session: next, title: next.title, detail: next.detail + note };
}

// ---------- records & trends ----------
export const PR_DISTANCES = [
  { name: '1k', label: '1 km', m: 1000 },
  { name: '1 mile', label: '1 mile', m: 1609.34 },
  { name: '5k', label: '5 km', m: 5000 },
  { name: '10k', label: '10 km', m: 10000 },
  { name: 'Half-Marathon', label: 'Half marathon', m: 21097.5 },
];

export function personalRecords(runs) {
  return PR_DISTANCES.map((pd) => {
    let best = null;
    for (const r of runs) {
      for (const e of r.best_efforts || []) {
        if (e.name !== pd.name || !num(e.s)) continue;
        if (!best || e.s < best.s) best = { s: +e.s, t: startMs(r), run_id: r.id };
      }
    }
    return { ...pd, best };
  });
}

// Easy runs in a heart-rate band → pace over time, plus the trend (s/km per 30 days, negative = faster).
export function easyPaceTrend(ctx, days = 120) {
  const { runs, now, maxHr } = ctx;
  const lo = Math.round(maxHr * 0.65), hi = Math.round(maxHr * 0.8);
  const pts = runs.filter((r) => startMs(r) >= now - days * DAY && ['easy', 'long', 'recovery'].includes(ctx.classOf(r).type)
    && num(r.avg_hr) >= lo && num(r.avg_hr) <= hi && paceOf(r))
    .map((r) => ({ t: startMs(r), pace: paceOf(r), hr: +r.avg_hr, id: r.id }))
    .sort((a, b) => a.t - b.t);
  let slope = null;
  if (pts.length >= 4 && pts[pts.length - 1].t - pts[0].t >= 21 * DAY) {
    // Pace normalised to the band's mid HR (≈ 1 bpm ≈ 0.6 % pace) before fitting a line.
    const mid = (lo + hi) / 2;
    const ys = pts.map((p) => p.pace * (1 + 0.006 * (p.hr - mid)));
    const xs = pts.map((p) => (p.t - pts[0].t) / DAY);
    const mx = mean(xs), my = mean(ys);
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    slope = sxx ? (xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx) * 30 : null;
  }
  return { lo, hi, points: pts, slope };
}

// Short headline for a run list row.
export function runSummary(run) {
  return { km: km(run.distance_m), pace: paceOf(run), time: num(run.moving_s), hr: num(run.avg_hr) };
}
