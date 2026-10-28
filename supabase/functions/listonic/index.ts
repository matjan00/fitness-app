// Supabase Edge Function "listonic": puts the app's grocery list on a Listonic shopping list.
//
// Called from the app (docs/grocery.js) with the user's login token in the Authorization header:
//   { action: 'lists' }                          → { lists: [{ id, name }] }
//   { action: 'send', list_id, items: [{name, amount, unit}] } → { added, updated }
// A product already on the list and not crossed off gets its amount replaced instead of a second copy.
//
// Listonic has no public API: this uses the private one of its web app (see logic.js), which can
// change without notice. It logs in as the user with their Listonic email and password.
// Secrets (Supabase → Edge Functions → Secrets): LISTONIC_EMAIL, LISTONIC_PASSWORD.
// Deploy:  supabase functions deploy listonic
// JWT verification stays ON; the function additionally requires the real logged-in user (not just the public key).

import { listChoices, parseItems, planSend } from './logic.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

const API = 'https://api.listonic.com/api';
// Static values of Listonic's web app (in its public JS, not secrets).
const CLIENT_ID = 'listonicv2';
const CLIENT_SECRET = 'fjdfsoj9874jdfhjkh34jkhffdfff';
const REDIRECT_URI = 'https://listonicv2api.jestemkucharzem.pl';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Returns the logged-in user's id, or null. (The platform's JWT check also accepts the public key, so verify here.)
async function loggedInUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
  if (!auth.startsWith('Bearer ') || !url) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { authorization: auth, apikey: key } });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === 'string' ? u.id : null;
  } catch {
    return null;
  }
}

async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${API}/loginextended?provider=password&autoMerge=1&autoDestruct=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', clientauthorization: `Bearer ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}` },
    body: new URLSearchParams({ username: email, password, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI }),
  });
  if (r.status === 400 || r.status === 401) throw new HttpError(502, 'Listonic rejected the email or password (check the LISTONIC_EMAIL / LISTONIC_PASSWORD secrets).');
  const body = await r.json().catch(() => null);
  if (!r.ok || !body?.access_token) throw new HttpError(502, `Listonic login failed (HTTP ${r.status}).`);
  return body.access_token;
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404) throw new HttpError(404, 'That Listonic list no longer exists. Pick another one.');
  if (!r.ok) throw new HttpError(502, `Listonic refused a request (HTTP ${r.status}).`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!(await loggedInUserId(req))) return json({ error: 'Please log in first.' }, 401);

  const email = Deno.env.get('LISTONIC_EMAIL');
  const password = Deno.env.get('LISTONIC_PASSWORD');
  if (!email || !password) return json({ error: 'not_configured', message: 'Listonic is not set up yet (see LISTONIC-SETUP.md).' }, 503);

  let body: { action?: unknown; list_id?: unknown; items?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }

  try {
    const token = await login(email, password);
    if (body.action === 'lists') {
      return json({ lists: listChoices(await call(token, 'GET', '/lists?includeShares=false&archive=false&includeItems=false')) });
    }
    if (body.action === 'send') {
      const listId = typeof body.list_id === 'string' && /^\d{1,20}$/.test(body.list_id) ? body.list_id : '';
      const items = parseItems(body.items);
      if (!listId || !items) return json({ error: 'Missing list_id or items.' }, 400);
      const existing = await call(token, 'GET', `/lists/${listId}/items`);
      const { add, update } = planSend(existing, items);
      for (const it of add) await call(token, 'POST', `/lists/${listId}/items`, it);
      for (const u of update) await call(token, 'PATCH', `/lists/${listId}/items/${u.id}`, { Amount: u.Amount, Unit: u.Unit });
      return json({ added: add.length, updated: update.length });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: 'listonic', message: e.message }, e.status);
    return json({ error: 'listonic', message: 'Could not reach Listonic. Try again in a minute.' }, 502);
  }
});
