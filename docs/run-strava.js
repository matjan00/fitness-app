// Strava connection from the app side: OAuth redirect, and calls to the "strava" Supabase Edge Function
// (supabase/functions/strava). Tokens never reach the phone — only the function sees them.

import * as store from './store.js';
import { local } from './util.js';

const STATUS_KEY = 'run.strava';       // cached { connected, athlete_name, last_sync_at, pending, client_id, checked_at }
const SYNC_KEY = 'run.nextSync';       // ms timestamp when auto-sync may run again
const STATE_KEY = 'run.oauthState';

export const cachedStatus = () => local.get(STATUS_KEY, null);
export const isConnected = () => Boolean(cachedStatus()?.connected);

export async function ready() {
  if (!store.configured || !store.client) return { ok: false, why: 'not-configured' };
  if (!(await store.session())) return { ok: false, why: 'signed-out' };
  return { ok: true };
}

export async function call(action, extra = {}) {
  const r = await ready();
  if (!r.ok) throw new Error(r.why === 'not-configured' ? 'Online sync is not set up yet.' : 'Log in on the Me tab first.');
  const { data, error } = await store.client.functions.invoke('strava', { body: { action, ...extra } });
  if (error) {
    let msg = error.message || 'Could not reach the server';
    try {
      const body = await error.context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* not JSON */ }
    if (/Failed to send|fetch/i.test(msg)) msg = navigator.onLine ? 'Could not reach the Strava service. Is the "strava" function deployed?' : 'You are offline.';
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function refreshStatus() {
  const st = await call('status');
  local.set(STATUS_KEY, { ...st, checked_at: Date.now() });
  return st;
}

export const redirectUri = () => location.origin + location.pathname;

export function authorizeUrl(clientId) {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  local.set(STATE_KEY, state);
  const p = new URLSearchParams({
    client_id: String(clientId).trim(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state,
  });
  return `https://www.strava.com/oauth/authorize?${p}`;
}

// Called once at start-up. If we just came back from Strava, finish connecting.
// Returns null when there was nothing to do, else { ok, message }.
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  if (!q.has('state') && !q.has('scope')) return null; // not ours
  const code = q.get('code'), scope = q.get('scope') || '', state = q.get('state'), err = q.get('error');
  ['code', 'scope', 'state', 'error'].forEach((k) => q.delete(k));
  history.replaceState(history.state, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
  const expected = local.get(STATE_KEY, null);
  local.del(STATE_KEY);
  if (err) return { ok: false, message: err === 'access_denied' ? 'Strava connection cancelled.' : `Strava: ${err}` };
  if (!code) return null;
  if (expected && state !== expected) return { ok: false, message: 'Strava connection expired — please try again.' };
  if (!/activity:read/.test(scope)) return { ok: false, message: 'Please allow access to your activities when connecting Strava.' };
  await call('exchange', { code, scope });
  await refreshStatus().catch(() => {});
  return { ok: true, message: 'Strava connected — fetching your runs…' };
}

// Pull new runs from Strava into Supabase, then down to this phone.
export async function sync() {
  const res = await call('sync');
  await store.syncNow().catch(() => {});
  const wait = res.pending || res.rate_limited ? 16 : 30;
  local.set(SYNC_KEY, Date.now() + wait * 60000);
  const st = cachedStatus() || {};
  local.set(STATUS_KEY, { ...st, connected: true, last_sync_at: new Date().toISOString(), pending: res.pending || 0 });
  return res;
}

export const autoSyncDue = () => isConnected() && navigator.onLine && Date.now() >= local.get(SYNC_KEY, 0);
export const deferAutoSync = (mins) => local.set(SYNC_KEY, Date.now() + mins * 60000);

export async function disconnect(deleteRuns = false) {
  const res = await call('disconnect', { delete_runs: deleteRuns });
  local.set(STATUS_KEY, { ...(cachedStatus() || {}), connected: false, athlete_name: null, checked_at: Date.now() });
  local.del(SYNC_KEY);
  await store.syncNow().catch(() => {});
  return res;
}

export function syncMessage(res) {
  const parts = [];
  if (res.added) parts.push(`${res.added} new run${res.added > 1 ? 's' : ''}`);
  if (res.updated) parts.push(`${res.updated} updated`);
  if (res.deleted) parts.push(`${res.deleted} removed`);
  let msg = parts.length ? `Strava: ${parts.join(', ')}` : 'Runs are up to date';
  if (res.pending) msg += ` · details for ${res.pending} more will load on the next sync`;
  else if (res.rate_limited) msg += ' · Strava is busy, the rest will follow later';
  return msg;
}
