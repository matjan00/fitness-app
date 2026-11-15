// Day status (green / yellow / red) of one finished day, worked out on the server from the synced records,
// with the app's own rules (docs/cut-day.js), so it always matches what the Today card shows.
// Plain JavaScript with no Deno / Node APIs: it runs inside the edge function (index.ts) and in the node
// tests (tests/day-status.test.js).
//
// Used by MacroDroid on the phone (DAY-STATUS-SETUP.md): every morning it asks for yesterday's status
// and blocks X and Instagram for the day when it was red.

import { dayFacts, sessionFor, sessionDone, weekTraining, weekCardio, liftDayExtra, dayStatus } from '../../../docs/cut-day.js';
import { CUT_DEFAULTS } from '../../../docs/cut-calc.js';

export const TIME_ZONE = 'Europe/Warsaw';

// 'YYYY-MM-DD' of an instant in the given time zone.
export function localDay(instant, tz = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// An instant as a wall-clock time in `tz`, without a zone ('2026-11-14T08:05:00'). The app's rules read the
// day of a workout or run with the runtime's local time; a string without a zone is read as local time,
// so the day comes out as the Warsaw day whatever time zone the server runs in.
export function wallTime(instant, tz = TIME_ZONE) {
  const d = new Date(instant);
  if (Number.isNaN(+d)) return instant;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

// The day to judge: ?day=YYYY-MM-DD, else yesterday in `tz`. Null for a bad day or one that isn't over yet.
export function dayToJudge(param, now = Date.now(), tz = TIME_ZONE) {
  const today = localDay(now, tz);
  if (param == null || param === '') return addDays(today, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(param) || Number.isNaN(Date.parse(`${param}T12:00:00Z`))) return null;
  return param < today ? param : null;
}

// Status of `day` from the records ({ id, kind, data } rows of the records table, not deleted).
export function statusFromRecords(day, records = [], tz = TIME_ZONE) {
  const by = {};
  for (const r of records) {
    if (!r || !r.data || typeof r.data !== 'object') continue;
    (by[r.kind] ||= []).push({ ...r.data, id: r.id });
  }
  const list = (k) => by[k] || [];
  const config = (key) => list('config').find((c) => c.key === key) || {};
  const { id: _a, key: _b, ...cfg } = config('cut');
  const kcal = config('food').targets?.kcal ?? null;
  const cuts = new Map(list('routine').filter((r) => r.cut).map((r) => [r.id, r.cut]));
  const routineCut = (id) => cuts.get(id) || null;
  const src = {
    weights: list('bodyweight'),
    dailies: list('daily'),
    workouts: list('workout').map((w) => ({ ...w, started_at: w.started_at && wallTime(w.started_at, tz) })),
    runs: list('run').map((r) => ({ ...r, start: r.start && wallTime(r.start, tz) })),
    routineCut,
  };
  const f = dayFacts(day, src);
  const session = sessionFor(day, src);
  const done = sessionDone(session.kind, day, src);
  const week = weekTraining(day, src);
  const cardio = weekCardio(day, { dailies: src.dailies, goal: cfg.cardioWeek ?? CUT_DEFAULTS.cardioWeek });
  const kcalTarget = kcal ? kcal + liftDayExtra(day, { cfg, workouts: src.workouts, dailies: src.dailies }) : kcal;
  const { status, checks } = dayStatus(f, { kcalTarget, cfg, session, done, week, cardio, isToday: false });
  return { day, status, red: status === 'red', checks: checks.map((c) => ({ label: c.label, ok: Boolean(c.ok) })) };
}
