// Local-first data store.
//
// Every item (workout, routine, body weight entry, recipe, meal, run…) is a "record":
//   { id, kind, data, updated_at, deleted }
// Records live in the phone's IndexedDB so the app works with no signal, and are mirrored in memory
// for fast synchronous reads. Changes are queued in an "outbox" and pushed to Supabase when online;
// changes made elsewhere (laptop, the Strava job) are pulled down by comparing the server's synced_at.
//
// Public API (items are plain objects: { id, ...data }):
//   all(kind)            → array of live items of that kind
//   get(id)              → one item or undefined
//   put(kind, item)      → saves (creates or replaces); returns the item with an id
//   remove(id)           → soft-deletes
//   onChange(fn)         → fn(kinds:Set) after any local or synced change; returns unsubscribe
//   syncNow(), syncState() and the auth helpers below.

import { uid } from './util.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const DB_NAME = 'fitness-app';
const mem = new Map();          // id → record
let outbox = new Set();         // ids waiting to be pushed
let lastPull = null;            // server synced_at of the newest pulled row
let idb = null;
const listeners = new Set();

// ---------- IndexedDB ----------
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('records', { keyPath: 'id' });
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const tx = (store, mode, fn) => new Promise((resolve, reject) => {
  const t = idb.transaction(store, mode);
  const r = fn(t.objectStore(store));
  t.oncomplete = () => resolve(r?.result);
  t.onerror = () => reject(t.error);
});
const idbAll = () => new Promise((resolve, reject) => {
  const req = idb.transaction('records').objectStore('records').getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const metaGet = (k) => new Promise((resolve) => {
  const req = idb.transaction('meta').objectStore('meta').get(k);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => resolve(undefined);
});
const metaSet = (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k));
const saveRecords = (recs) => tx('records', 'readwrite', (s) => recs.forEach((r) => s.put(r)));

export async function openStore() {
  try {
    idb = await openIdb();
    (await idbAll()).forEach((r) => mem.set(r.id, r));
    outbox = new Set((await metaGet('outbox')) || []);
    lastPull = (await metaGet('lastPull')) || null;
  } catch (e) {
    // Private mode or storage blocked: keep working in memory only.
    console.warn('IndexedDB unavailable, data will not persist', e);
    idb = null;
  }
}

// ---------- reads ----------
const toItem = (r) => ({ ...r.data, id: r.id });
export const all = (kind) => {
  const out = [];
  for (const r of mem.values()) if (r.kind === kind && !r.deleted) out.push(toItem(r));
  return out;
};
export const get = (id) => {
  const r = mem.get(id);
  return r && !r.deleted ? toItem(r) : undefined;
};
export const kindOf = (id) => mem.get(id)?.kind;

// ---------- writes ----------
function emit(kinds) {
  listeners.forEach((fn) => { try { fn(kinds); } catch (e) { console.error(e); } });
}
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

async function writeLocal(recs) {
  recs.forEach((r) => { mem.set(r.id, r); outbox.add(r.id); });
  if (idb) {
    await saveRecords(recs);
    await metaSet('outbox', [...outbox]);
  }
  emit(new Set(recs.map((r) => r.kind)));
  scheduleSync();
}

export async function put(kind, item) {
  const { id = uid(), ...data } = item;
  const rec = { id, kind, data: JSON.parse(JSON.stringify(data)), updated_at: new Date().toISOString(), deleted: false };
  await writeLocal([rec]);
  return { ...data, id };
}

export async function putMany(kind, items) {
  const now = new Date().toISOString();
  const recs = items.map(({ id = uid(), ...data }) => ({ id, kind, data: JSON.parse(JSON.stringify(data)), updated_at: now, deleted: false }));
  await writeLocal(recs);
  return recs.map(toItem);
}

export async function remove(id) {
  const r = mem.get(id);
  if (!r) return;
  await writeLocal([{ ...r, deleted: true, updated_at: new Date().toISOString() }]);
}

// A single settings object per "key" (e.g. 'settings', 'food-targets'), stored as kind 'config'.
// Uses a stable id derived from the key so every device updates the same row.
const configId = (key) => {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
};
export const getConfig = (key, defaults = {}) => ({ ...defaults, ...(get(configId(key)) || {}), id: undefined });
export const setConfig = (key, value) => put('config', { ...value, key, id: configId(key) });

// ---------- sync with Supabase ----------
export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY && window.supabase);
export const client = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let syncing = null;
let syncTimer = null;
let state = { status: configured ? 'idle' : 'local', error: null, at: null };
export const syncState = () => ({ ...state, pending: outbox.size });
const setState = (s) => { state = { ...state, ...s }; emit(new Set(['__sync'])); };

function scheduleSync(delay = 1500) {
  if (!configured) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), delay);
}

export async function session() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await syncNow();
}

export async function signOut() {
  await client.auth.signOut();
  setState({ status: 'signed-out' });
}

export function syncNow() {
  if (!configured) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    if (!navigator.onLine) { setState({ status: 'offline' }); return; }
    const s = await session();
    if (!s) { setState({ status: 'signed-out' }); return; }
    setState({ status: 'syncing', error: null });
    try {
      await push();
      await pull();
      setState({ status: 'idle', at: new Date().toISOString() });
    } catch (e) {
      setState({ status: 'error', error: e.message || String(e) });
      throw e;
    }
  })().finally(() => { syncing = null; });
  return syncing;
}

async function push() {
  const ids = [...outbox];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200).map((id) => mem.get(id)).filter(Boolean);
    const rows = batch.map(({ id, kind, data, updated_at, deleted }) => ({ id, kind, data, updated_at, deleted }));
    const { error } = await client.from('records').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    // Only clear what didn't change while we were uploading.
    batch.forEach((r) => { if (mem.get(r.id)?.updated_at === r.updated_at) outbox.delete(r.id); });
  }
  if (idb) await metaSet('outbox', [...outbox]);
}

async function pull() {
  const changedKinds = new Set();
  // Start a minute before the last pull: a write that committed slightly late (e.g. a long server job)
  // could carry an earlier synced_at than rows we already saw. Re-reading a few rows is harmless.
  let since = lastPull ? new Date(Date.parse(lastPull) - 60000).toISOString() : null;
  for (;;) {
    let q = client.from('records').select('id,kind,data,updated_at,deleted,synced_at').order('synced_at').order('id').limit(1000);
    if (since) q = q.gt('synced_at', since);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data.length) break;
    const toSave = [];
    for (const row of data) {
      const local = mem.get(row.id);
      const localNewer = local && outbox.has(row.id) && Date.parse(local.updated_at) > Date.parse(row.updated_at);
      if (localNewer) continue;
      if (local && local.updated_at && Date.parse(local.updated_at) === Date.parse(row.updated_at) && local.deleted === row.deleted) continue;
      const rec = { id: row.id, kind: row.kind, data: row.data, updated_at: row.updated_at, deleted: row.deleted };
      mem.set(rec.id, rec);
      toSave.push(rec);
      changedKinds.add(rec.kind);
    }
    if (idb && toSave.length) await saveRecords(toSave);
    lastPull = since = data[data.length - 1].synced_at;
    if (idb) await metaSet('lastPull', lastPull);
    if (data.length < 1000) break;
  }
  if (changedKinds.size) emit(changedKinds);
}

if (configured) {
  window.addEventListener('online', () => scheduleSync(200));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(200); });
  setInterval(() => { if (document.visibilityState === 'visible') scheduleSync(0); }, 120000);
}

// ---------- backup ----------
export function exportAll() {
  return { app: 'fitness-app', exported_at: new Date().toISOString(), records: [...mem.values()] };
}
export async function importAll(json) {
  if (json?.app !== 'fitness-app' || !Array.isArray(json.records)) throw new Error('This is not a fitness app backup file.');
  const recs = json.records.filter((r) => r && r.id && r.kind);
  await writeLocal(recs.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
  return recs.length;
}
