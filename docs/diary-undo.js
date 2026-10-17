// Undo for food-diary changes: every add, edit, move, copy and remove shows a toast with Undo for a few seconds.
import { toast } from './util.js';
import * as store from './store.js';

const UNDO_MS = 6000;

// Entries were added (store results with ids): Undo removes them.
export function undoAdded(msg, added) {
  const ids = (added || []).map((e) => e.id).filter(Boolean);
  toast(msg, UNDO_MS, ids.length ? { label: 'Undo', run: async () => { await store.removeMany(ids); toast('Undone'); } } : null);
}

// Entries are about to change (move, edit): pass copies of them as they were; Undo puts them back.
export function undoChanged(msg, before) {
  const snap = (before || []).filter(Boolean).map((e) => ({ ...e }));
  toast(msg, UNDO_MS, snap.length ? { label: 'Undo', run: async () => { await store.putMany('meal', snap); toast('Undone'); } } : null);
}

// Remove entries from the diary (same ids come back on Undo).
export async function removeEntries(entries, msg = 'Removed') {
  const snap = entries.filter(Boolean).map((e) => ({ ...e }));
  if (!snap.length) return;
  await store.removeMany(snap.map((e) => e.id));
  undoChanged(msg, snap);
}
