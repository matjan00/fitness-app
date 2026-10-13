// Phone steps (Health Connect, sent by the HC Webhook Android app) → the cut plan's daily log.
// Plain JavaScript with no Deno / Node APIs, so it runs inside the edge function (index.ts) and in
// the node tests (tests/steps-webhook.test.js).
//
// HC Webhook sends raw step intervals ({count, start_time, end_time}), and only the ones that are new
// since its last send, so one payload is never a whole day. The function keeps every interval in the
// step_samples table and adds them up per local day. Only finished days (before today) are written,
// so the log gets yesterday's final total, never a half-day count.

export const TIME_ZONE = 'Europe/Warsaw';
export const MAX_SAMPLES = 5000;
const MAX_COUNT = 100000; // per interval; anything above is junk

// 'YYYY-MM-DD' of an instant in the given time zone.
export function localDay(instant, tz = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The valid step intervals of a webhook body, normalised to ISO strings. Bad entries are dropped.
export function parseSteps(body) {
  const list = Array.isArray(body?.steps) ? body.steps.slice(0, MAX_SAMPLES) : [];
  const out = [];
  for (const s of list) {
    const count = Number(s?.count);
    const start = Date.parse(s?.start_time);
    const end = Date.parse(s?.end_time);
    if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) continue;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    out.push({ start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), count });
  }
  return out;
}

// Finished days whose total may have changed: the days of the new intervals that are before today,
// plus yesterday always (so a morning send with nothing new still settles yesterday). Oldest first.
export function daysToTotal(samples, today, tz = TIME_ZONE) {
  const days = new Set([addDays(today, -1)]);
  for (const s of samples) {
    const d = localDay(s.start_time, tz);
    if (d < today) days.add(d);
  }
  return [...days].sort();
}

// Total steps on a local day (an interval belongs to the day it started), or null when the phone
// recorded nothing that day. Some step apps keep one growing record per day (00:00 → now) and every
// send stores a longer copy of it, so an interval lying inside another one is an older copy of it
// and is not counted.
export function dayTotal(samples, day, tz = TIME_ZONE) {
  const list = samples
    .filter((s) => localDay(s.start_time, tz) === day)
    .map((s) => ({ start: Date.parse(s.start_time), end: Date.parse(s.end_time), count: s.count }))
    .sort((a, b) => a.start - b.start || b.end - a.end || b.count - a.count);
  let total = null;
  let reach = -Infinity; // furthest end of the intervals kept so far
  for (const s of list) {
    if (s.end <= reach) continue;
    total = (total || 0) + s.count;
    reach = s.end;
  }
  return total;
}

// New data for the daily record of `day`, or null if nothing should change. steps = the phone's
// total + stepsExtra (steps added by hand in the app, docs/cut-day.js handStepsPatch). A total typed
// before that option existed (steps without stepsSource 'phone' or stepsExtra) is left alone.
export function mergeSteps(existing, day, total) {
  const cur = { ...(existing || {}) };
  if (total == null) return null;
  if (cur.steps != null && cur.stepsSource !== 'phone' && cur.stepsExtra === undefined) return null;
  const steps = total + (Number(cur.stepsExtra) || 0);
  if (cur.steps === steps && cur.stepsPhone === total && cur.stepsSource === 'phone') return null;
  return { ...cur, day, steps, stepsPhone: total, stepsSource: 'phone' };
}
