// Gym tracker: data access shared by the gym screens (exercise library, workouts, settings, caches).
import * as store from './store.js';
import { local } from './util.js';
import { computePRs, defaultMode, exGroups, recentUse, lastSessions } from './gym-calc.js';

// ---------- exercise library ----------
let db = null;          // array of library exercises
let dbMap = new Map();
let dbPromise = null;
export const IMG = (id, frame = 0) => `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/${encodeURIComponent(id)}/${frame}.jpg`;

export function loadDb() {
  if (!dbPromise) {
    dbPromise = fetch('data/exercises.json')
      .then((r) => { if (!r.ok) throw new Error(`Could not load exercises (${r.status})`); return r.json(); })
      .then((list) => { db = list; dbMap = new Map(list.map((e) => [e.id, e])); return db; })
      .catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}
export const dbReady = () => Boolean(db);

const customToEx = (c) => ({ id: c.id, n: c.n || 'Custom exercise', eq: c.eq || 'other', p: [], s: [], c: 'strength', g: c.g || null, mode: c.mode || 'wr', custom: true, im: 0 });
export const customExercises = () => store.all('exercise').map(customToEx);
export function allExercises() {
  return [...customExercises(), ...(db || [])];
}
export function exById(id) {
  if (dbMap.has(id)) return dbMap.get(id);
  if (store.kindOf(id) === 'exercise') {
    const c = store.get(id);
    if (c) return customToEx(c);
  }
  return null;
}
// Readable name even before the library has loaded (library ids are the names with underscores).
export function exName(id, fallback) {
  const ex = exById(id);
  if (ex) return ex.n;
  if (fallback) return fallback;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(id))) return 'Deleted exercise';
  return String(id || 'Exercise').replace(/_/g, ' ');
}
export const groupsOf = (id) => exGroups(exById(id));

// ---------- settings ----------
export const SETTINGS_DEFAULTS = { rest: 90, sound: true, wake: true, modes: {}, rests: {} };
export const settings = () => {
  const s = store.getConfig('gym', SETTINGS_DEFAULTS);
  return { ...s, modes: s.modes || {}, rests: s.rests || {} };
};
export async function saveSettings(patch) {
  const { id, key, ...cur } = settings();
  await store.setConfig('gym', { ...cur, ...patch });
}
export const modeFor = (id) => settings().modes[id] || defaultMode(exById(id));
export const restFor = (id) => {
  const s = settings();
  return s.rests[id] ?? s.rest ?? 90;
};

// ---------- workouts (cached, newest first) ----------
let cache = null;
store.onChange((kinds) => { if (kinds.has('workout') || kinds.has('exercise') || kinds.has('routine')) cache = null; });
function c() {
  if (!cache) cache = {};
  return cache;
}
export function workouts() {
  const k = c();
  if (!k.workouts) k.workouts = store.all('workout').sort((a, b) => (Date.parse(b.started_at) || 0) - (Date.parse(a.started_at) || 0));
  return k.workouts;
}
export function prIndex() {
  const k = c();
  if (!k.prs) k.prs = computePRs(workouts());
  return k.prs;
}
export const prsOf = (id) => prIndex().get(id) || [];
export function recent() {
  const k = c();
  if (!k.recent) k.recent = recentUse(workouts());
  return k.recent;
}
export function last() {
  const k = c();
  if (!k.last) k.last = lastSessions(workouts());
  return k.last;
}
export function routines() {
  const k = c();
  if (!k.routines) {
    // Most recently used first within the stored order.
    k.routines = store.all('routine').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
  }
  return k.routines;
}
export function routineLastUsed(id) {
  const w = workouts().find((x) => x.routine_id === id);
  return w ? w.started_at : null;
}

// ---------- active workout (localStorage, survives closing the app) ----------
const ACTIVE = 'gym.active';
export const getActive = () => local.get(ACTIVE, null);
export const saveActive = (a) => local.set(ACTIVE, a);
export const clearActive = () => local.del(ACTIVE);

// Re-render the current tab (e.g. after the exercise library finished loading).
export function refreshTab() {
  const t = document.getElementById('view')?.dataset.tab;
  if ((t === 'gym' || t === 'home') && window.showTab) window.showTab(t);
}
