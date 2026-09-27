// Gym tracker: pure logic (no DOM, no store). Covered by tests/gym.test.js.
//
// Saved workout shape:
//   { id, name, routine_id, started_at, ended_at, notes,
//     exercises: [{ exercise_id, name, note, mode, rest, sets: [{ type: 'n'|'w'|'d'|'f', kg, reps, secs }] }] }
// Tracking modes: 'wr' weight × reps, 'bw' bodyweight reps (+ optional added kg), 't' duration in seconds.

// ---------- muscles ----------
export const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Calves', 'Forearms'];
const MUSCLE_MAP = {
  chest: 'Chest',
  lats: 'Back', 'middle back': 'Back', 'lower back': 'Back', traps: 'Back',
  shoulders: 'Shoulders', neck: 'Shoulders',
  biceps: 'Biceps', triceps: 'Triceps',
  quadriceps: 'Legs', hamstrings: 'Legs', adductors: 'Legs', abductors: 'Legs',
  glutes: 'Glutes', abdominals: 'Core', calves: 'Calves', forearms: 'Forearms',
};
export const muscleGroup = (m) => MUSCLE_MAP[String(m || '').toLowerCase()] || null;

// Muscle groups trained by an exercise (library exercise: primary muscles; custom exercise: its group `g`).
export function exGroups(ex) {
  if (!ex) return [];
  if (ex.g) return [ex.g];
  return [...new Set((ex.p || []).map(muscleGroup).filter(Boolean))];
}

// ---------- tracking type ----------
export const MODES = { wr: 'Weight & reps', bw: 'Bodyweight reps', t: 'Duration' };
export function defaultMode(ex) {
  if (!ex) return 'wr';
  if (ex.mode && MODES[ex.mode]) return ex.mode;
  if (ex.c === 'cardio' || ex.c === 'stretching' || /plank/i.test(ex.n || '')) return 't';
  if (ex.eq === 'body only') return 'bw';
  return 'wr';
}

// ---------- numbers ----------
export const fmtNum = (x) => {
  if (x == null || !Number.isFinite(+x)) return '';
  return String(Math.round(+x * 100) / 100);
};
export const fmtDur = (secs) => {
  secs = Math.max(0, Math.round(+secs || 0));
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};
// "1:30" → 90, "45" → 45, "1:02:03" → 3723. Returns null when empty/invalid.
export function parseDuration(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) {
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }
  return t.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}
// First whole number in a target like "8-12" → 8.
export const firstInt = (s) => {
  const m = String(s ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
};

// Estimated one-rep max (Epley). Only meaningful for 1–12 reps.
export function e1rm(kg, reps) {
  kg = Number(kg); reps = Number(reps);
  if (!(kg > 0) || !(reps >= 1) || reps > 12) return null;
  if (reps === 1) return kg;
  return Math.round(kg * (1 + reps / 30) * 10) / 10;
}

export const isWorking = (set) => set && set.type !== 'w';
export const setVolume = (set, mode = 'wr') => (mode === 't' ? 0 : (Number(set.kg) || 0) * (Number(set.reps) || 0));

export function formatSet(set, mode = 'wr', unit = false) {
  if (!set) return '';
  if (mode === 't') return set.secs != null ? fmtDur(set.secs) : '';
  if (mode === 'bw') {
    if (set.reps == null) return '';
    return set.kg ? `+${fmtNum(set.kg)} × ${set.reps}` : `${set.reps} reps`;
  }
  if (set.reps == null) return '';
  return `${fmtNum(set.kg || 0)}${unit ? ' kg' : ''} × ${set.reps}`;
}

// ---------- workout totals ----------
export const workoutDuration = (w) => Math.max(0, (Date.parse(w.ended_at) - Date.parse(w.started_at)) / 1000 || 0);
export function workoutVolume(w) {
  let v = 0;
  for (const e of w.exercises || []) for (const s of e.sets || []) if (isWorking(s)) v += setVolume(s, e.mode);
  return v;
}
export function workoutSetCount(w) {
  let n = 0;
  for (const e of w.exercises || []) n += (e.sets || []).length;
  return n;
}

// Best set of an exercise entry (for history cards): heaviest working set, then most reps / longest.
export function bestSet(entry) {
  const sets = (entry.sets || []).filter(isWorking);
  const pool = sets.length ? sets : entry.sets || [];
  let best = null;
  for (const s of pool) {
    if (!best) { best = s; continue; }
    if (entry.mode === 't') { if ((s.secs || 0) > (best.secs || 0)) best = s; continue; }
    const a = [Number(s.kg) || 0, Number(s.reps) || 0], b = [Number(best.kg) || 0, Number(best.reps) || 0];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) best = s;
  }
  return best;
}

// ---------- records ----------
export const PR_KINDS = {
  kg: 'Heaviest weight', e1rm: 'Best est. 1RM', vol: 'Best set volume', reps: 'Most reps', secs: 'Longest time',
};
export const kindsFor = (mode) => (mode === 't' ? ['secs'] : mode === 'bw' ? ['reps', 'kg'] : ['kg', 'e1rm', 'vol']);

export function setMetric(set, kind, mode = 'wr') {
  if (!isWorking(set)) return 0;
  const kg = Number(set.kg) || 0, reps = Number(set.reps) || 0;
  switch (kind) {
    case 'kg': return reps > 0 ? kg : 0;
    case 'e1rm': return e1rm(kg, reps) || 0;
    case 'vol': return setVolume(set, mode);
    case 'reps': return reps;
    case 'secs': return Number(set.secs) || 0;
    default: return 0;
  }
}
export function formatMetric(kind, v) {
  if (kind === 'reps') return `${v} reps`;
  if (kind === 'secs') return fmtDur(v);
  return `${fmtNum(v)} kg`;
}

const byStart = (a, b) => (Date.parse(a.started_at) || 0) - (Date.parse(b.started_at) || 0);

// Walks all workouts in time order and returns Map(workoutId → [PR]) where
// PR = { exercise_id, ei, si, kind, value, prev }. A PR is a working set beating the best of all
// earlier workouts; the very first session of an exercise only sets the baseline.
export function computePRs(workouts) {
  const best = new Map(); // exercise_id → { kind: value }
  const out = new Map();
  for (const w of [...workouts].sort(byStart)) {
    const prs = [];
    const inThis = new Map(); // exercise_id → { kind: {value, ei, si} }
    (w.exercises || []).forEach((e, ei) => {
      const mode = e.mode || 'wr';
      let cand = inThis.get(e.exercise_id);
      if (!cand) inThis.set(e.exercise_id, (cand = {}));
      for (const kind of kindsFor(mode)) {
        (e.sets || []).forEach((s, si) => {
          const v = setMetric(s, kind, mode);
          if (v > 0 && (!cand[kind] || v > cand[kind].value)) cand[kind] = { value: v, ei, si };
        });
      }
    });
    for (const [exId, cand] of inThis) {
      const prev = best.get(exId);
      const next = { ...(prev || {}) };
      for (const [kind, c] of Object.entries(cand)) {
        const p = prev?.[kind];
        if (p > 0 && c.value > p) prs.push({ exercise_id: exId, ei: c.ei, si: c.si, kind, value: c.value, prev: p });
        if (!(p >= c.value)) next[kind] = c.value;
      }
      best.set(exId, next);
    }
    out.set(w.id, prs);
  }
  return out;
}

// All-time records of one exercise: { kind: { value, date, workout_id } }.
export function exerciseRecords(workouts, exerciseId) {
  const rec = {};
  for (const w of workouts) {
    for (const e of w.exercises || []) {
      if (e.exercise_id !== exerciseId) continue;
      for (const kind of kindsFor(e.mode || 'wr')) {
        for (const s of e.sets || []) {
          const v = setMetric(s, kind, e.mode || 'wr');
          if (v > 0 && (!rec[kind] || v > rec[kind].value || (v === rec[kind].value && Date.parse(w.started_at) < Date.parse(rec[kind].date)))) {
            rec[kind] = { value: v, date: w.started_at, workout_id: w.id, set: s };
          }
        }
      }
    }
  }
  return rec;
}

// Per-session series for charts: [{ date, e1rm, kg, vol, reps, secs }] oldest first.
export function exerciseSeries(workouts, exerciseId) {
  const out = [];
  for (const w of [...workouts].sort(byStart)) {
    const entries = (w.exercises || []).filter((e) => e.exercise_id === exerciseId);
    if (!entries.length) continue;
    const row = { date: w.started_at, e1rm: 0, kg: 0, vol: 0, reps: 0, secs: 0 };
    for (const e of entries) {
      for (const s of e.sets || []) {
        for (const k of ['e1rm', 'kg', 'reps', 'secs']) row[k] = Math.max(row[k], setMetric(s, k, e.mode || 'wr'));
        if (isWorking(s)) row.vol += setVolume(s, e.mode || 'wr');
      }
    }
    out.push(row);
  }
  return out;
}

// ---------- previous numbers ----------
// Map(exercise_id → { date, mode, sets }) of the most recent session of each exercise,
// optionally only from workouts that started before `before` (ms) and excluding workout `exceptId`.
export function lastSessions(workouts, { before = Infinity, exceptId = null } = {}) {
  const map = new Map();
  const sorted = workouts
    .filter((w) => w.id !== exceptId && (Date.parse(w.started_at) || 0) < before)
    .sort((a, b) => byStart(b, a));
  for (const w of sorted) {
    for (const e of w.exercises || []) {
      if (!map.has(e.exercise_id) && e.sets?.length) map.set(e.exercise_id, { date: w.started_at, mode: e.mode, sets: e.sets, rest: e.rest });
    }
  }
  return map;
}
// The previous set for the same position. Given today's `sets`, warm-ups are matched with last time's
// warm-ups and working sets with working sets (2nd working set ↔ 2nd working set); otherwise by index.
export function previousSet(session, index, sets = null) {
  if (!session || !session.sets) return null;
  if (!sets || !sets[index]) return session.sets[index] || null;
  const warm = (s) => s?.type === 'w';
  const isW = warm(sets[index]);
  let ord = 0;
  for (let j = 0; j < index; j++) if (warm(sets[j]) === isW) ord++;
  return session.sets.filter((s) => warm(s) === isW)[ord] || null;
}

// Map(exercise_id → last used ms), for "recent first" ordering.
export function recentUse(workouts) {
  const m = new Map();
  for (const w of workouts) {
    const t = Date.parse(w.started_at) || 0;
    for (const e of w.exercises || []) if (!(m.get(e.exercise_id) >= t)) m.set(e.exercise_id, t);
  }
  return m;
}

// Library order: recently used first, then popular, then alphabetical.
export function sortExercises(list, recent = new Map()) {
  return [...list].sort((a, b) => {
    const ra = recent.get(a.id) || 0, rb = recent.get(b.id) || 0;
    if (ra !== rb) return rb - ra;
    const pa = a.pop || 999, pb = b.pop || 999;
    if (pa !== pb) return pa - pb;
    return String(a.n).localeCompare(String(b.n));
  });
}
export function matchesSearch(ex, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = String(ex.n || '').toLowerCase();
  return words.every((w) => name.includes(w));
}

// ---------- weekly stats ----------
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => {
  d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export function weekKey(d) {
  d = new Date(d);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}

// Last `weeks` weeks (oldest first): [{ week, count, volume, secs }].
export function weeklySeries(workouts, weeks = 12, now = Date.now()) {
  const rows = [];
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * (weeks - 1));
  const idx = new Map();
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + 7 * i);
    const row = { week: dayKey(d), count: 0, volume: 0, secs: 0 };
    idx.set(row.week, row);
    rows.push(row);
  }
  for (const w of workouts) {
    const row = idx.get(weekKey(w.started_at));
    if (!row) continue;
    row.count++;
    row.volume += workoutVolume(w);
    row.secs += workoutDuration(w);
  }
  return rows;
}

// Working sets per muscle group since `since` (ms). groupsOf(exercise_id) → ['Chest', …].
export function muscleSets(workouts, groupsOf, since) {
  const out = {};
  for (const w of workouts) {
    if (!((Date.parse(w.started_at) || 0) >= since)) continue;
    for (const e of w.exercises || []) {
      const n = (e.sets || []).filter(isWorking).length;
      if (!n) continue;
      for (const g of groupsOf(e.exercise_id) || []) out[g] = (out[g] || 0) + n;
    }
  }
  return out;
}

// Consecutive weeks (up to this one) with at least one workout. If this week has none yet,
// the streak still counts from last week.
export function weekStreak(workouts, now = Date.now()) {
  const weeks = new Set(workouts.map((w) => weekKey(w.started_at)));
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  if (!weeks.has(weekKey(d))) d.setDate(d.getDate() - 7);
  let n = 0;
  while (weeks.has(weekKey(d))) { n++; d.setDate(d.getDate() - 7); }
  return n;
}

// ---------- routines ----------
// Routine exercise list rebuilt from a finished workout (keeps rep ranges like "8-12").
// With an existing routine: exercises done today get today's numbers, the others stay as they were,
// and exercises added during the workout are appended.
export function routineFromWorkout(workout, old = null) {
  const fromW = (e, prev) => {
    const work = (e.sets || []).filter(isWorking);
    const top = bestSet({ ...e, sets: work.length ? work : e.sets || [] });
    let reps = prev?.reps ?? '';
    const isRange = /\d\s*-\s*\d/.test(String(reps));
    if (!isRange) reps = e.mode === 't' ? (top?.secs != null ? String(top.secs) : '') : (top?.reps != null ? String(top.reps) : String(reps));
    return {
      exercise_id: e.exercise_id,
      sets: work.length || (e.sets || []).length || 1,
      reps,
      kg: e.mode !== 't' && top?.kg ? Number(top.kg) : null,
      rest: e.rest ?? prev?.rest ?? 90,
    };
  };
  const done = workout.exercises || [];
  if (!old?.exercises?.length) return done.map((e) => fromW(e, null));
  const used = new Set();
  const out = old.exercises.map((o) => {
    const i = done.findIndex((x, j) => !used.has(j) && x.exercise_id === o.exercise_id);
    if (i < 0) return { ...o };
    used.add(i);
    return fromW(done[i], o);
  });
  done.forEach((e, i) => { if (!used.has(i)) out.push(fromW(e, null)); });
  return out;
}
export function routineChanged(oldExs = [], newExs = []) {
  if (oldExs.length !== newExs.length) return true;
  return oldExs.some((o, i) => {
    const n = newExs[i];
    return o.exercise_id !== n.exercise_id || Number(o.sets) !== Number(n.sets)
      || (Number(o.kg) || 0) !== (Number(n.kg) || 0) || String(o.reps ?? '') !== String(n.reps ?? '');
  });
}
