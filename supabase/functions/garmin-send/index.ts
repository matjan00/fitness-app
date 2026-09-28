// Supabase Edge Function: garmin-send
//
// "Send to watch" button: the app cannot hold a GitHub token, so it asks this function:
//   POST { session_id, steps, name }
// which (1) stores the ready-made workout steps in a 'garmin-send-request' record and (2) starts the GitHub
// Action .github/workflows/garmin-send.yml (workflow_dispatch) that logs in to Garmin and uploads the workout.
//
// Deploy:  supabase functions deploy garmin-send
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):  GITHUB_DISPATCH_TOKEN  (fine-grained PAT, this repo
//   only, Actions: read & write - see GARMIN-SETUP.md). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
//   SUPABASE_ANON_KEY are provided to edge functions automatically.
// JWT verification stays ON; the function additionally requires the real logged-in user (not just the public key).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

const REPO = 'matjan00/fitness-app';
const WORKFLOW = 'garmin-send.yml';
const REQUEST_KIND = 'garmin-send-request';
const MIN_GAP_MS = 2 * 60 * 1000;
// Same fixed namespace as scripts/garmin_sync.py, so the Python job derives the same record id.
const NAMESPACE = '6f2f5a3e-6a1a-4a55-9c2e-6d0d6a1a3b10';

// RFC 4122 version-5 UUID (SHA-1), matching Python's uuid.uuid5(NAMESPACE, name).
async function uuid5(namespace: string, name: string): Promise<string> {
  const ns = namespace.replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16));
  const nm = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nm.length);
  data.set(ns);
  data.set(nm, ns.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

// Structural check of the step list the app sends (device-neutral steps, see docs/run-plan.js sessionSteps()).
function validSteps(steps: unknown, depth = 0): boolean {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 30) return false;
  return steps.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const st = s as Record<string, unknown>;
    if (st.kind === 'repeat') return depth === 0 && Number.isInteger(st.reps) && (st.reps as number) >= 1 && (st.reps as number) <= 99 && validSteps(st.steps, 1);
    if (!['warmup', 'run', 'recovery', 'cooldown'].includes(st.kind as string)) return false;
    return typeof st.distance_m === 'number' || typeof st.duration_s === 'number' || st.open === true;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const userId = await loggedInUserId(req);
  if (!userId) return json({ error: 'Please log in to send workouts to your watch.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ghToken = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!supabaseUrl || !serviceKey || !ghToken) {
    return json({ error: 'not_configured', message: 'Sending to the watch is not set up yet.' }, 503);
  }

  let body: { session_id?: unknown; steps?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send JSON: {"session_id","steps","name"}' }, 400);
  }
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!sessionId || sessionId.length > 64 || !/^[\w.-]+$/.test(sessionId)) return json({ error: 'Missing or invalid session_id.' }, 400);
  if (!validSteps(body.steps) || JSON.stringify(body.steps).length > 20000) return json({ error: 'The workout steps are missing or invalid.' }, 400);

  const rest = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const recordId = await uuid5(NAMESPACE, `${userId}:garmin-send-request`);

  // Rate limit: at most one send every 2 minutes.
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/records?id=eq.${recordId}&select=data`, { headers: rest });
    if (r.ok) {
      const rows = await r.json();
      const last = Date.parse(rows?.[0]?.data?.requested_at || '');
      if (Number.isFinite(last) && Date.now() - last < MIN_GAP_MS) {
        const wait = Math.ceil((MIN_GAP_MS - (Date.now() - last)) / 1000);
        return json({ error: 'too_soon', message: `Please wait ${wait} seconds before sending again.`, retry_after_s: wait }, 429);
      }
    }
  } catch {
    // if the check itself fails, carry on
  }

  const requestedAt = new Date().toISOString();
  const row = {
    id: recordId,
    user_id: userId,
    kind: REQUEST_KIND,
    data: { session_id: sessionId, name, steps: body.steps, requested_at: requestedAt },
    updated_at: requestedAt,
    deleted: false,
  };
  const w = await fetch(`${supabaseUrl}/rest/v1/records?on_conflict=id`, {
    method: 'POST',
    headers: { ...rest, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([row]),
  });
  if (!w.ok) return json({ error: 'Could not save the request.' }, 502);

  const d = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'fitness-app-garmin-send',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { session_id: sessionId } }),
  });
  if (!d.ok) {
    // 401/403/404 from GitHub = token missing, expired or without the right permission.
    const expired = d.status === 401 || d.status === 403 || d.status === 404;
    return json(
      { error: expired ? 'not_configured' : 'dispatch_failed', message: expired ? 'The GitHub token is missing, expired or lacks permission.' : `GitHub refused the request (${d.status}).` },
      expired ? 503 : 502,
    );
  }
  return json({ ok: true, requested_at: requestedAt });
});
