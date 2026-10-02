// Pure helpers for paging the pull by (synced_at, id) so rows sharing one synced_at are never skipped.

// Quote a value for a PostgREST or()/and() filter.
const q = (v) => '"' + String(v).replace(/(["\\])/g, '\\$1') + '"';

// First page starts a bit before the last pull (overlap); returns an ISO string or null.
export function startSince(lastPull, overlapMs = 60000) {
  const t = Date.parse(lastPull);
  return Number.isFinite(t) ? new Date(t - overlapMs).toISOString() : null;
}

// Cursor after a page: the last row's (synced_at, id), or null for an empty/invalid page.
export function nextCursor(rows) {
  const last = Array.isArray(rows) ? rows[rows.length - 1] : null;
  return last && last.synced_at ? { at: last.synced_at, id: last.id ?? null } : null;
}

// Value for supabase-js .or(): rows strictly after the cursor in (synced_at, id) order.
// With no id (first page) it is simply synced_at > since.
export function afterFilter(cursor) {
  if (!cursor || !cursor.at) return null;
  if (cursor.id == null) return `synced_at.gt.${q(cursor.at)}`;
  return `synced_at.gt.${q(cursor.at)},and(synced_at.eq.${q(cursor.at)},id.gt.${q(cursor.id)})`;
}
