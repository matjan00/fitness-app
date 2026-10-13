// Supabase Edge Function: steps-webhook
//
// Receives phone steps from the HC Webhook Android app (it reads Health Connect and POSTs JSON, see
// STEPS-SETUP.md). Every step interval is kept in the step_samples table (supabase/steps.sql); each
// finished day's total goes into the cut plan's 'daily' record as steps (stepsSource 'phone').
// Steps typed in by hand in the app are never overwritten.
//
// The phone has no Supabase login, so this function checks a shared secret instead: the app sends it
// in an x-api-key header (a custom header set in HC Webhook).
//
// Deploy:  supabase functions deploy steps-webhook --no-verify-jwt
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):  STEPS_WEBHOOK_KEY (the shared secret).
//   Optional: STEPS_USER_ID (else the project's only user), STEPS_TIME_ZONE (default Europe/Warsaw).
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided to edge functions automatically.

import { TIME_ZONE, localDay, addDays, parseSteps, daysToTotal, dayTotal, mergeSteps } from './logic.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

// Same fixed namespace and daily id as scripts/garmin_sync.py daily_record_id().
const NAMESPACE = '6f2f5a3e-6a1a-4a55-9c2e-6d0d6a1a3b10';
const DAILY_KIND = 'daily';

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

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const key = Deno.env.get('STEPS_WEBHOOK_KEY') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !supabaseUrl || !serviceKey) return json({ error: 'Steps sync is not set up yet.' }, 503);
  if (!sameSecret(req.headers.get('x-api-key') || '', key)) return json({ error: 'Wrong or missing x-api-key header.' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  const tz = Deno.env.get('STEPS_TIME_ZONE') || TIME_ZONE;
  const samples = parseSteps(body);
  const rest = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  try {
    let userId = Deno.env.get('STEPS_USER_ID') || '';
    if (!userId) {
      const r = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, { headers: rest });
      const b = r.ok ? await r.json() : null;
      userId = b?.users?.[0]?.id || '';
      if (!userId) return json({ error: 'No user found in the project.' }, 500);
    }

    if (samples.length) {
      const r = await fetch(`${supabaseUrl}/rest/v1/step_samples?on_conflict=user_id,start_time,end_time`, {
        method: 'POST',
        headers: { ...rest, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(samples.map((s) => ({ ...s, user_id: userId, received_at: new Date().toISOString() }))),
      });
      if (!r.ok) return json({ error: 'Could not save the steps.' }, 500);
    }

    const today = localDay(Date.now(), tz);
    const days = daysToTotal(samples, today, tz);
    // Intervals from a day before the oldest day up to today cover every local day in `days`.
    const from = `${addDays(days[0], -1)}T00:00:00Z`;
    const to = `${addDays(today, 1)}T00:00:00Z`;
    // Paged: the API returns at most 1000 rows per request.
    const stored: { start_time: string; end_time: string; count: number }[] = [];
    for (let offset = 0; offset < 50000; offset += 1000) {
      const sr = await fetch(
        `${supabaseUrl}/rest/v1/step_samples?user_id=eq.${userId}&start_time=gte.${from}&start_time=lt.${to}&select=start_time,end_time,count&order=start_time,end_time&limit=1000&offset=${offset}`,
        { headers: rest },
      );
      if (!sr.ok) return json({ error: 'Could not read the steps back.' }, 500);
      const page = await sr.json();
      stored.push(...page);
      if (page.length < 1000) break;
    }

    const dr = await fetch(
      `${supabaseUrl}/rest/v1/records?user_id=eq.${userId}&kind=eq.${DAILY_KIND}&deleted=eq.false&data->>day=in.(${days.join(',')})&select=id,data,updated_at&order=updated_at.asc`,
      { headers: rest },
    );
    if (!dr.ok) return json({ error: 'Could not read the daily log.' }, 500);
    const existing = new Map<string, { id: string; data: Record<string, unknown> }>();
    for (const row of await dr.json()) existing.set(row.data?.day, row); // most recently updated wins

    const rows = [];
    for (const day of days) {
      const cur = existing.get(day);
      const data = mergeSteps(cur?.data, day, dayTotal(stored, day, tz));
      if (!data) continue;
      rows.push({
        id: cur?.id || (await uuid5(NAMESPACE, `${userId}:daily:${day}`)),
        user_id: userId,
        kind: DAILY_KIND,
        data,
        updated_at: new Date().toISOString(),
        deleted: false,
      });
    }
    if (rows.length) {
      const r = await fetch(`${supabaseUrl}/rest/v1/records?on_conflict=id`, {
        method: 'POST',
        headers: { ...rest, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
      if (!r.ok) return json({ error: 'Could not save the daily log.' }, 500);
    }

    return json({ ok: true, received: samples.length, days_saved: rows.map((r) => `${r.data.day}: ${r.data.steps}`) });
  } catch {
    return json({ error: 'Something went wrong.' }, 500);
  }
});
