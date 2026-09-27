// Supabase Edge Function "strava": connects a user's Strava account and copies their runs into `records`.
//
// Called from the app with supabase.functions.invoke('strava', { body: { action, ... } }) — the user's
// login token comes along in the Authorization header and is checked here.
//   { action: 'status' }                           → { connected, athlete_name, last_sync_at, pending, client_id }
//   { action: 'exchange', code, scope }            → stores tokens after the Strava OAuth redirect
//   { action: 'sync' }                             → { added, updated, deleted, pending, rate_limited }
//   { action: 'disconnect', delete_runs?: bool }   → revokes access at Strava and forgets the tokens
//
// Secrets (Supabase → Edge Functions → Secrets): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// Deploy with JWT verification off (this function verifies the user itself):
//   supabase functions deploy strava --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isRun, mapActivity, planSync, runRecordId } from './map.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const API = 'https://www.strava.com/api/v3';
const FIRST_SYNC_DAYS = 183;       // first sync: about 6 months of history
const RESYNC_DAYS = 21;            // later syncs re-check the last 3 weeks (edits, deletions)
const MAX_DETAILS = 40;            // detailed-activity requests per call (Strava: 100 reads / 15 min)
const PARALLEL = 4;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
class RateLimited extends Error {}

// Strava rate-limit headroom from the last response ("usage,limit" for 15 min and daily windows).
let headroom = 100;
function trackLimits(res: Response) {
  const usage = (res.headers.get('X-ReadRateLimit-Usage') || res.headers.get('X-RateLimit-Usage') || '').split(',').map(Number);
  const limit = (res.headers.get('X-ReadRateLimit-Limit') || res.headers.get('X-RateLimit-Limit') || '').split(',').map(Number);
  if (usage.length === 2 && limit.length === 2 && usage.every(Number.isFinite) && limit.every(Number.isFinite)) {
    headroom = Math.min(limit[0] - usage[0], limit[1] - usage[1]);
  }
}

async function stravaGet(path: string, token: string) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  trackLimits(res);
  if (res.status === 429) throw new RateLimited('Strava rate limit reached');
  if (res.status === 401) throw new HttpError(409, 'Strava access was revoked. Please connect Strava again.');
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `Strava error ${res.status}`);
  return res.json();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(400, body?.message === 'Bad Request' ? 'Strava rejected the login code — please try connecting again.' : `Strava: ${body?.message || res.status}`);
  return body;
}

async function tokenRow(userId: string) {
  const { data, error } = await admin.from('strava_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// A valid access token, refreshed when it expires within 2 minutes.
async function accessToken(row: any) {
  if (Date.parse(row.expires_at) - Date.now() > 120_000) return row.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
  const upd = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(t.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('strava_tokens').update(upd).eq('user_id', row.user_id);
  if (error) throw new Error(error.message);
  Object.assign(row, upd);
  return row.access_token;
}

// ---------- actions ----------
async function status(userId: string) {
  const row = await tokenRow(userId);
  let pending = 0;
  if (row) {
    const { count } = await admin.from('records').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('kind', 'run').eq('deleted', false).eq('data->>detail', 'false');
    pending = count || 0;
  }
  return {
    connected: Boolean(row),
    athlete_name: row?.athlete_name || null,
    athlete_id: row?.athlete_id || null,
    last_sync_at: row?.last_sync_at || null,
    pending,
    client_id: CLIENT_ID || null,
  };
}

async function exchange(userId: string, body: any) {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new HttpError(500, 'Strava is not set up on the server yet (missing secrets).');
  if (!body.code) throw new HttpError(400, 'Missing code');
  const scope = String(body.scope || '');
  if (scope && !/activity:read/.test(scope)) {
    throw new HttpError(400, 'Please allow access to your activities (tick "View data about your activities") when connecting.');
  }
  const t = await tokenRequest({ code: String(body.code), grant_type: 'authorization_code' });
  const a = t.athlete || {};
  const row = {
    user_id: userId,
    athlete_id: a.id,
    athlete_name: [a.firstname, a.lastname].filter(Boolean).join(' ') || null,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(t.expires_at * 1000).toISOString(),
    scope: scope || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('strava_tokens').upsert(row, { onConflict: 'user_id' });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new HttpError(409, 'This Strava account is already linked to another login.');
    throw new Error(error.message);
  }
  return { connected: true, athlete_name: row.athlete_name };
}

async function existingRuns(userId: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('records')
      .select('id,deleted,sid:data->>strava_id,sig:data->>sig,detail:data->>detail,start:data->>start')
      .eq('user_id', userId).eq('kind', 'run').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data.map((r: any) => ({ id: r.id, deleted: r.deleted, data: { strava_id: r.sid, sig: r.sig, detail: r.detail === 'true', start: r.start } })));
    if (data.length < 1000) break;
  }
  return out;
}

async function sync(userId: string) {
  const row = await tokenRow(userId);
  if (!row) throw new HttpError(409, 'Strava is not connected.');
  const token = await accessToken(row);
  const now = Date.now();
  const days = row.full_sync_done ? RESYNC_DAYS : FIRST_SYNC_DAYS;
  const windowStart = now - days * 86400_000;
  let rateLimited = false;

  // 1. List activities in the window (newest pages first are not guaranteed, so read them all).
  const summaries: any[] = [];
  let listComplete = false;
  try {
    for (let page = 1; page <= 12; page++) {
      const list = await stravaGet(`/athlete/activities?after=${Math.floor(windowStart / 1000)}&per_page=100&page=${page}`, token);
      if (!Array.isArray(list)) break;
      summaries.push(...list);
      if (list.length < 100) { listComplete = true; break; }
    }
  } catch (e) {
    if (e instanceof RateLimited) rateLimited = true; else throw e;
  }

  // 2. Decide what needs details. Older runs still missing details are retried too.
  const existing = await existingRuns(userId);
  const plan = planSync({ userId, summaries, existing, windowStart, listComplete });
  const inWindow = new Set(summaries.map((a) => String(a.id)));
  const olderPending = existing.filter((r) => !r.deleted && !r.data.detail && r.data.strava_id && !inWindow.has(r.data.strava_id))
    .map((r) => ({ id: Number(r.data.strava_id), _older: true }));
  const queue = [...plan.needDetail, ...olderPending];
  const existingIds = new Set(existing.filter((r) => !r.deleted).map((r) => r.id));

  // 3. Fetch details within the rate-limit budget.
  const rows: any[] = [];
  const nowIso = new Date().toISOString();
  const detailed = new Set<string>();
  let budget = Math.min(MAX_DETAILS, Math.max(0, headroom - 8));
  let i = 0;
  const worker = async () => {
    while (i < queue.length && budget > 0 && !rateLimited) {
      const a = queue[i++];
      budget--;
      try {
        const d = await stravaGet(`/activities/${a.id}?include_all_efforts=false`, token);
        if (!d) continue;
        if (!isRun(d)) continue;
        const summary = a._older ? d : a;
        rows.push({ id: runRecordId(userId, d.id), user_id: userId, kind: 'run', data: mapActivity(summary, d), updated_at: nowIso, deleted: false });
        detailed.add(String(d.id));
      } catch (e) {
        if (e instanceof RateLimited) rateLimited = true; else throw e;
      }
      if (headroom < 8) budget = 0;
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  // New runs we could not fetch details for yet: store the summary so they show up now.
  for (const a of plan.needDetail) {
    const id = runRecordId(userId, a.id);
    if (detailed.has(String(a.id)) || existingIds.has(id)) continue;
    rows.push({ id, user_id: userId, kind: 'run', data: mapActivity(a, null), updated_at: nowIso, deleted: false });
  }

  let added = 0, updated = 0;
  for (const r of rows) (existingIds.has(r.id) ? updated++ : added++);
  for (let k = 0; k < rows.length; k += 200) {
    const { error } = await admin.from('records').upsert(rows.slice(k, k + 200), { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  // Runs deleted on Strava (only when the whole window was listed).
  let deleted = 0;
  if (plan.toDelete.length) {
    const { error } = await admin.from('records').update({ deleted: true, updated_at: nowIso })
      .eq('user_id', userId).in('id', plan.toDelete);
    if (error) throw new Error(error.message);
    deleted = plan.toDelete.length;
  }

  const pending = queue.filter((a) => !detailed.has(String(a.id))).length;
  await admin.from('strava_tokens').update({
    last_sync_at: nowIso,
    full_sync_done: row.full_sync_done || listComplete,
    updated_at: nowIso,
  }).eq('user_id', userId);

  return { added, updated, deleted, unchanged: plan.unchanged, pending, rate_limited: rateLimited };
}

async function disconnect(userId: string, body: any) {
  const row = await tokenRow(userId);
  if (row) {
    try {
      const token = await accessToken(row);
      await fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } catch { /* already revoked — still forget it here */ }
    await admin.from('strava_tokens').delete().eq('user_id', userId);
  }
  let removed = 0;
  if (body.delete_runs) {
    const { data, error } = await admin.from('records').update({ deleted: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('kind', 'run').eq('deleted', false).select('id');
    if (error) throw new Error(error.message);
    removed = data?.length || 0;
  }
  return { connected: false, removed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Please log in first.' }, 401);
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return json({ error: 'Please log in again.' }, 401);
    const userId = data.user.id;
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case 'status': return json(await status(userId));
      case 'exchange': return json(await exchange(userId, body));
      case 'sync': return json(await sync(userId));
      case 'disconnect': return json(await disconnect(userId, body));
      default: return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof RateLimited ? 429 : 500;
    return json({ error: e?.message || String(e) }, status);
  }
});
