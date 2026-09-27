// Supabase Edge Function: fetch-recipe
//
// The phone app cannot download other websites directly (browsers block cross-site requests), so it asks this
// function: POST { url } → normalized recipe JSON (see extract.js). Supports recipe websites (schema.org JSON-LD),
// TikTok (caption via oEmbed) and YouTube / Shorts (video description).
//
// Deploy:  supabase functions deploy fetch-recipe
// (JWT verification stays ON: the app sends the logged-in user's token, so strangers cannot use it as a proxy.)

import { fetchRecipe, FetchError, isPrivateAddress } from './extract.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

// Resolve the host name and refuse private / loopback addresses (protects the internal network).
async function hostCheck(hostname: string) {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) return; // IP literals are checked in extract.js
  const addrs: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try {
      addrs.push(...(await Deno.resolveDns(hostname, type)));
    } catch {
      // no record of this type (or DNS lookups unavailable) — ignore
    }
  }
  if (addrs.some((a) => isPrivateAddress(a))) throw new FetchError('That address is not allowed.', 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST with {"url": "…"}' }, 405);

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send JSON: {"url": "…"}' }, 400);
  }
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url || url.length > 2000) return json({ error: 'Missing or too long "url".' }, 400);

  try {
    const result = await fetchRecipe(url, { hostCheck });
    return json(result);
  } catch (e) {
    if (e instanceof FetchError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong while reading that page.' }, 500);
  }
});
