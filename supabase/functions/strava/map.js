// Strava → app record mapping. Plain JavaScript with no Deno / Node APIs, so it runs inside the
// Supabase edge function (index.ts) and in the node tests (tests/run-strava.test.js).

export const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun', 'Treadmill']);

// Is a Strava activity (summary or detailed) a run we keep?
export function isRun(a) {
  return Boolean(a) && (RUN_TYPES.has(a.sport_type) || RUN_TYPES.has(a.type));
}

// Deterministic record id for (user, Strava activity) so a re-sync updates the same row.
// Format is a valid UUID: first block from the user id, last block = activity id in hex.
export function runRecordId(userId, stravaId) {
  const u = String(userId || '').replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(8, '0').slice(0, 8);
  const hex = BigInt(String(stravaId)).toString(16).padStart(12, '0').slice(-12);
  return `${u}-57a0-4000-8000-${hex}`;
}

const n = (x) => (x == null || !Number.isFinite(+x) ? null : +x);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r0 = (x) => (x == null ? null : Math.round(x));

// Signature of the parts of a summary that matter; when it changes the detail is fetched again.
export function summarySig(a) {
  return [a.name, a.sport_type || a.type, n(a.distance), n(a.moving_time), n(a.workout_type), n(a.average_heartrate)].join('|');
}

// Strava reports run cadence per leg (e.g. 85) — the app uses steps per minute (170).
const spm = (c) => (n(c) ? r0(c < 120 ? c * 2 : c) : null);

// Map a summary activity (from GET /athlete/activities) and optionally its detailed version
// (GET /activities/{id}) to the compact run record stored in records.data.
export function mapActivity(summary, detail = null) {
  const a = { ...summary, ...(detail || {}) };
  const type = a.sport_type || a.type;
  const data = {
    strava_id: String(a.id),
    name: a.name || 'Run',
    type: type === 'Treadmill' ? 'Run' : type,
    sport: type,
    trainer: Boolean(a.trainer) || type === 'Treadmill' || undefined,
    start: a.start_date,
    start_local: a.start_date_local,
    distance_m: r1(n(a.distance)) || 0,
    moving_s: r0(n(a.moving_time)) || 0,
    elapsed_s: r0(n(a.elapsed_time)),
    elev_m: r1(n(a.total_elevation_gain)),
    avg_hr: r1(n(a.average_heartrate)),
    max_hr: r0(n(a.max_heartrate)),
    avg_cadence: spm(a.average_cadence),
    avg_speed: n(a.average_speed),
    max_speed: n(a.max_speed),
    suffer: r0(n(a.suffer_score)),
    workout_type: n(a.workout_type),
    device: a.device_name || undefined,
    polyline: a.map?.summary_polyline || a.map?.polyline || undefined,
    sig: summarySig(summary),
    detail: Boolean(detail),
  };
  if (detail) {
    data.description = detail.description ? String(detail.description).slice(0, 500) : undefined;
    data.calories = r0(n(detail.calories));
    data.splits = (detail.splits_metric || []).map((s, i) => ({
      km: n(s.split) || i + 1,
      d: r1(n(s.distance)),
      s: r0(n(s.moving_time) ?? n(s.elapsed_time)),
      hr: r1(n(s.average_heartrate)),
      elev: r1(n(s.elevation_difference)),
    })).filter((s) => s.d > 0 && s.s > 0);
    data.laps = (detail.laps || []).map((l, i) => ({
      n: n(l.lap_index) || i + 1,
      d: r1(n(l.distance)),
      s: r0(n(l.moving_time) ?? n(l.elapsed_time)),
      hr: r1(n(l.average_heartrate)),
      cad: spm(l.average_cadence),
    })).filter((l) => l.d > 0 && l.s > 0);
    data.best_efforts = (detail.best_efforts || []).map((e) => ({
      name: e.name,
      s: r0(n(e.elapsed_time)),
      distance: n(e.distance),
      pr_rank: n(e.pr_rank),
    })).filter((e) => e.s > 0 && e.distance > 0);
  }
  // Drop empty values to keep rows small.
  for (const k of Object.keys(data)) if (data[k] === undefined || data[k] === null) delete data[k];
  return data;
}

// Given the summaries from Strava and the existing run rows ({id, data}), decide what to do.
// Returns { upserts: [{id, data}], needDetail: [summary], unchanged: number, toDelete: [id] }.
//   - new or changed runs (or runs still missing details) need a detail fetch;
//   - windowStart (ms): existing runs that started after it but are no longer on Strava are deleted.
export function planSync({ userId, summaries, existing, windowStart = null, listComplete = false }) {
  const byStrava = new Map(existing.map((r) => [String(r.data?.strava_id), r]));
  const seen = new Set();
  const needDetail = [];
  let unchanged = 0;
  for (const a of summaries) {
    if (!isRun(a)) continue;
    const sid = String(a.id);
    seen.add(sid);
    const old = byStrava.get(sid);
    if (old && !old.deleted && old.data?.detail && old.data?.sig === summarySig(a)) { unchanged++; continue; }
    needDetail.push(a);
  }
  const toDelete = [];
  if (listComplete && windowStart != null) {
    for (const r of existing) {
      if (r.deleted) continue;
      const t = Date.parse(r.data?.start || '');
      if (t >= windowStart && !seen.has(String(r.data?.strava_id))) toDelete.push(r.id);
    }
  }
  // Newest first, so recent runs get their details first when the rate limit bites.
  needDetail.sort((a, b) => Date.parse(b.start_date) - Date.parse(a.start_date));
  return { needDetail, unchanged, toDelete, recordId: (a) => runRecordId(userId, a.id) };
}
