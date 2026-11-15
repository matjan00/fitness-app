// Supabase Edge Function: day-status
//
// Tells the phone whether yesterday was a red day, so MacroDroid can block X and Instagram for the day
// (DAY-STATUS-SETUP.md). The status uses the app's own rules (logic.js → docs/cut-day.js).
//
//   GET /functions/v1/day-status              → {"day":"2026-11-14","status":"red","red":true,"checks":[...]}
//   GET /functions/v1/day-status?format=text  → red        (just the status: green, yellow or red)
//   ?day=YYYY-MM-DD judges another finished day instead of yesterday.
//
// The phone has no Supabase login, so this function checks a shared secret in the x-api-key header.
//
// Deploy:  supabase functions deploy day-status --no-verify-jwt
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):  DAY_STATUS_KEY (the shared secret).
//   Optional: STEPS_USER_ID (else the project's only user), STEPS_TIME_ZONE (default Europe/Warsaw).
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided to edge functions automatically.

import { TIME_ZONE, addDays, dayToJudge, statusFromRecords } from './logic.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

// Only what the status rules read, and only around the day (its week, plus some days before it).
const KINDS = ['daily', 'bodyweight', 'fitatu-day', 'meal', 'workout', 'run', 'routine', 'config'];
// Workouts and runs are big (sets, GPS); only these fields are read, as flat columns (see unflatten).
const FIELDS: Record<string, string[]> = {
  workout: ['started_at', 'ended_at', 'routine_id', 'name'],
  run: ['start', 'distance_m', 'moving_s', 'elapsed_s'],
  routine: ['cut', 'program'],
};
const selectOf = (kind: string) =>
  FIELDS[kind] ? `id,kind,${FIELDS[kind].map((f) => `${f}:data->${f}`).join(',')}` : 'id,kind,data';
const unflatten = (kind: string, row: Record<string, unknown>) => {
  if (!FIELDS[kind]) return row;
  const data: Record<string, unknown> = {};
  for (const f of FIELDS[kind]) if (row[f] != null) data[f] = row[f];
  return { id: row.id, kind: row.kind, data };
};
const DAY_FIELD: Record<string, string> = { daily: 'day', bodyweight: 'day', 'fitatu-day': 'day', meal: 'day', workout: 'started_at', run: 'start' };

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const url = new URL(req.url);
  const asText = url.searchParams.get('format') === 'text';
  const fail = (error: string, status: number) => (asText ? text('error', status) : json({ error }, status));

  const key = Deno.env.get('DAY_STATUS_KEY') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !supabaseUrl || !serviceKey) return fail('Day status is not set up yet.', 503);
  if (!sameSecret(req.headers.get('x-api-key') || '', key)) return fail('Wrong or missing x-api-key header.', 401);

  const tz = Deno.env.get('STEPS_TIME_ZONE') || TIME_ZONE;
  const day = dayToJudge(url.searchParams.get('day'), Date.now(), tz);
  if (!day) return fail('day must be a finished day, as YYYY-MM-DD.', 400);
  const rest = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  try {
    let userId = Deno.env.get('STEPS_USER_ID') || '';
    if (!userId) {
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, { headers: rest });
      const b = r.ok ? await r.json() : null;
      userId = b?.users?.[0]?.id || '';
      if (!userId) return fail('No user found in the project.', 500);
    }

    // Newest first, so a day logged twice reads its latest copy.
    // From two weeks before the day to the end of its week (the week check looks at later travel days).
    const from = addDays(day, -14);
    const to = addDays(day, 8);
    const records: unknown[] = [];
    for (const kind of KINDS) {
      const f = DAY_FIELD[kind];
      const range = f ? `&data->>${f}=gte.${from}&data->>${f}=lt.${to}` : '';
      for (let offset = 0; offset < 20000; offset += 1000) {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/records?user_id=eq.${userId}&kind=eq.${kind}&deleted=eq.false${range}&select=${selectOf(kind)}&order=updated_at.desc&limit=1000&offset=${offset}`,
          { headers: rest },
        );
        if (!r.ok) return fail('Could not read the records.', 500);
        const page = await r.json();
        records.push(...page.map((row: Record<string, unknown>) => unflatten(kind, row)));
        if (page.length < 1000) break;
      }
    }

    const result = statusFromRecords(day, records, tz);
    return asText ? text(result.status) : json(result);
  } catch {
    return fail('Something went wrong.', 500);
  }
});
