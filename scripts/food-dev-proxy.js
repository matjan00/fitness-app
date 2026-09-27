// Local stand-in for the fetch-recipe Edge Function, for testing link imports on this PC:
//   node scripts/food-dev-proxy.js   →   POST http://localhost:5191  { "url": "…" }
// The app uses it automatically when it runs on localhost. Same code as the real function (extract.js).
import http from 'node:http';
import dns from 'node:dns/promises';
import { fetchRecipe, FetchError, isPrivateAddress } from '../supabase/functions/fetch-recipe/extract.js';

const port = Number(process.env.PORT) || 5191;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hostCheck(hostname) {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) return;
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new FetchError('That address is not allowed.', 400);
}

http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') return send(405, { error: 'Use POST' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10000) return send(413, { error: 'Too big' }); }
  let url = '';
  try { url = String(JSON.parse(raw).url || '').trim(); } catch { return send(400, { error: 'Send JSON: {"url": "…"}' }); }
  if (!url) return send(400, { error: 'Missing "url".' });
  const t0 = Date.now();
  try {
    const out = await fetchRecipe(url, { hostCheck });
    console.log(`OK ${Date.now() - t0}ms ${out.source} ${url}`);
    send(200, out);
  } catch (e) {
    console.log(`ERR ${Date.now() - t0}ms ${url}: ${e.message}`);
    send(e instanceof FetchError ? e.status : 500, { error: e instanceof FetchError ? e.message : 'Something went wrong while reading that page.' });
  }
}).listen(port, () => console.log(`fetch-recipe dev proxy on http://localhost:${port}`));
