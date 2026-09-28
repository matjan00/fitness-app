// Running: Garmin-synced run history, fitness estimate, per-run feedback, weekly review and a weekly plan.
//
//   run-coach.js   pure coaching logic (tested)       scripts/garmin_sync.py  GitHub Action that pulls
//   run-detail.js  list rows + run detail screens                            from Garmin Connect every 3h
//   run-demo.js    sample runs for "Try with demo data" (memory only)
//
// Runs are kind 'run' records written by the scheduled Garmin sync job; the app only reads them and
// shows a status card built from the kind 'garmin-status' record the job also writes
// ({ last_sync_at, runs_total, full_sync_done, last_error }). Settings live in store config 'run':
// { runs_per_week, focus: '5k'|'10k', max_hr }.

import { $, $$, esc, icon, toast, niceDate, relDay, mins } from './util.js';
import * as store from './store.js';
import { push, sheet } from './nav.js';
import { chart, fade, cssVar } from './charts.js';
import * as C from './run-coach.js';
import { demoRuns, demoWorkouts } from './run-demo.js';
import { runRow, wireRows, openRun, openAllRuns, feedbackHtml } from './run-detail.js';

export const tab = { id: 'run', title: 'Run', icon: 'run', render: renderTab };
export const homeCard = { order: 15, render: renderHome };
export const meSection = { order: 20, render: renderMe };

const DEFAULTS = { runs_per_week: 4, focus: '5k', max_hr: null };
let demo = null;            // { runs, workouts } while exploring demo data (never saved)
let syncing = false;
let version = 0;            // bumped when runs / workouts / settings change
let cache = { key: '', ctx: null };
let legMuscles = null;      // exercise id → primary muscles (from data/exercises.json)
let tabEl = null, homeEl = null, meEl = null;
let planView = null;        // 'this' | 'next' | null (automatic: next week once this one is wrapped up)

// ---------- Garmin sync status ----------
const garminStatus = () => store.all('garmin-status')[0] || null;

function garminStatusText(st) {
  if (!st) return '';
  if (st.last_error) return `Garmin sync problem: ${st.last_error}`;
  const when = st.last_sync_at ? `last sync ${relDay(st.last_sync_at).toLowerCase()} ${new Date(st.last_sync_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'not synced yet';
  const runs = st.runs_total ? ` · ${st.runs_total} run${st.runs_total === 1 ? '' : 's'}` : '';
  return `Synced automatically from Garmin every 3 hours · ${when}${runs}`;
}

export function settings() {
  const { id, key, ...cfg } = store.getConfig('run', DEFAULTS);
  return { ...DEFAULTS, ...cfg };
}
async function saveSettings(patch) {
  await store.setConfig('run', { ...settings(), ...patch });
}

// ---------- data ----------
const runsOf = () => (demo ? demo.runs : store.all('run').filter((r) => r.start && Number(r.distance_m) > 0));
const workoutsOf = () => [...store.all('workout'), ...(demo ? demo.workouts : [])];

const LEG_MUSCLES = new Set(['quadriceps', 'hamstrings', 'glutes', 'adductors', 'abductors']);
function isLeg(ex) {
  const p = legMuscles?.get(ex.exercise_id);
  if (p) return p.some((m) => LEG_MUSCLES.has(m));
  return C.isLegByName(ex);
}
function loadExercises() {
  if (legMuscles) return;
  legMuscles = new Map();
  fetch('data/exercises.json').then((r) => r.json()).then((list) => {
    legMuscles = new Map(list.map((e) => [e.id, e.p || []]));
    version++;
    rerender();
  }).catch(() => {});
}

function getCtx() {
  const now = Date.now();
  const key = `${demo ? 'demo' : 'real'}|${version}|${C.dayKey(now)}|${new Date(now).getHours()}`;
  if (cache.key !== key) {
    const workouts = workoutsOf();
    if (workouts.length) loadExercises();
    cache = { key, ctx: C.buildContext({ runs: runsOf(), workouts, settings: settings(), now, isLeg }) };
  }
  return cache.ctx;
}
const findRun = (id) => getCtx().runs.find((r) => r.id === id);

function rerender() {
  if (tabEl?.isConnected && tabEl.dataset.tab === 'run') renderTab(tabEl);
  if (homeEl?.isConnected) renderHome(homeEl);
  if (meEl?.isConnected) renderMe(meEl);
}

export function init() {
  store.onChange((kinds) => {
    if (kinds.has('run') || kinds.has('workout') || kinds.has('config') || kinds.has('garmin-status')) version++;
    if (kinds.has('garmin-status')) rerender();
  });
}

// "Refresh" just pulls whatever the Garmin GitHub Action already saved to Supabase — the job
// itself runs on its own schedule (every 3 hours), the app never talks to Garmin directly.
async function doSync(silent) {
  if (syncing || demo || !store.configured) return;
  syncing = true;
  rerender();
  try {
    await store.syncNow();
    if (!silent) toast('Refreshed', 2000);
  } catch (e) {
    if (!silent) toast(e.message || 'Could not refresh', 4000);
  } finally {
    syncing = false;
    rerender();
  }
}

function startDemo() {
  const now = Date.now();
  demo = { runs: demoRuns(now), workouts: demoWorkouts(now) };
  version++;
  toast('Demo data loaded — nothing is saved');
  rerender();
}
function stopDemo() {
  demo = null;
  version++;
  rerender();
}

// ---------- small render helpers ----------
const pct = (a, b) => (b > 0 ? Math.round((a / b - 1) * 100) : null);
const kmTxt = (k) => (k >= 100 ? String(Math.round(k)) : (Math.round(k * 10) / 10).toFixed(1));
const weekTitle = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const TONE_ICON = { good: 'check', tip: 'info', warn: 'info', info: 'note', pr: 'trophy' };

function syncButton() {
  if (demo || !store.configured) return '';
  return `<button class="icon-btn rn-sync ${syncing ? 'rn-spin' : ''}" data-a="sync" aria-label="Refresh runs" ${syncing ? 'disabled' : ''}>${icon('sync')}</button>`;
}

function demoBar() {
  return demo ? `<div class="rn-demo-bar">${icon('info')}<span class="grow">Demo data — explore freely, nothing is saved.</span><button class="link small" data-a="exit-demo">Exit demo</button></div>` : '';
}

// ---------- Run tab ----------
function renderTab(el) {
  tabEl = el;
  const runs = runsOf();
  if (!runs.length) return renderSetup(el);
  const ctx = getCtx();
  const rv = ctx.review;
  el.innerHTML = `
    <div class="page-head row between">
      <div><p class="muted">Week of ${esc(weekTitle(rv.thisWeek.start))}</p><h1>Run</h1></div>
      <div class="row">${syncButton()}</div>
    </div>
    ${demoBar()}
    <div class="stack">
      ${heroHtml(ctx)}
      ${fitnessHtml(ctx)}
      ${planHtml(ctx)}
      ${notesHtml(ctx)}
    </div>
    <h3 class="section-title">Recent runs</h3>
    <div class="card rn-list">${ctx.runs.slice(0, 6).map((r) => runRow(r, ctx)).join('')}
      ${ctx.runs.length > 6 ? `<button class="rn-all" data-a="all">All ${ctx.runs.length} runs ${icon('back')}</button>` : ''}</div>
    <h3 class="section-title">Progress</h3>
    <div class="stack">
      ${volumeHtml(ctx)}
      ${intensityHtml(ctx)}
      ${easyTrendHtml(ctx)}
      ${prHtml(ctx)}
      ${pacesHtml(ctx)}
    </div>
    <p class="tiny muted center rn-foot">Coaching is rule-based guidance, not medical advice. Listen to your body.${!demo && garminStatus() ? ' · Data from Garmin' : ''}</p>`;

  wireRows(el, ctx, findRun);
  el.querySelector('[data-a="sync"]')?.addEventListener('click', () => doSync(false));
  el.querySelector('[data-a="exit-demo"]')?.addEventListener('click', stopDemo);
  el.querySelector('[data-a="all"]')?.addEventListener('click', () => openAllRuns(ctx));
  el.querySelector('[data-a="vdot-info"]')?.addEventListener('click', vdotInfo);
  $$('[data-plan]', el).forEach((b) => { b.onclick = () => { planView = b.dataset.plan; renderTab(el); }; });
  $$('[data-pr]', el).forEach((b) => { b.onclick = () => { const r = findRun(b.dataset.pr); if (r) openRun(r, ctx); }; });
  const todayRun = el.querySelector('[data-today-run]');
  if (todayRun) todayRun.onclick = () => { const r = findRun(todayRun.dataset.todayRun); if (r) openRun(r, ctx); };
  drawTabCharts(el, ctx);
}

function heroHtml(ctx) {
  const { thisWeek: tw, lastWeek: lw } = ctx.review;
  const target = ctx.plan.targetKm;
  const d = pct(tw.km, lw.km);
  const avgPace = tw.km ? tw.secs / tw.km : null;
  return `<div class="rn-hero">
    <div class="row between"><span class="rn-hero-label">This week</span>
      ${d != null ? `<span class="rn-hero-chip">${d >= 0 ? '+' : ''}${d}% vs last week</span>` : ''}</div>
    <div class="rn-big">${kmTxt(tw.km)}<small> km</small></div>
    <div class="rn-hero-track"><i style="width:${Math.min(100, target ? (tw.km / target) * 100 : 0).toFixed(1)}%"></i></div>
    <p class="rn-hero-sub">${tw.km >= target ? 'Weekly target reached — great work!' : `${kmTxt(Math.max(0, target - tw.km))} km to go of ~${Math.round(target)} km planned`}</p>
    <div class="rn-hero-stats">
      <div><b>${tw.runs}</b><span>run${tw.runs === 1 ? '' : 's'}</span></div>
      <div><b>${tw.secs ? mins(tw.secs) : '0 min'}</b><span>time</span></div>
      <div><b>${avgPace ? C.fmtPace(avgPace) : '–'}</b><span>avg /km</span></div>
      <div><b>${kmTxt(lw.km)}</b><span>last week</span></div>
    </div>
  </div>`;
}

function fitnessHtml(ctx) {
  const est = ctx.est || ctx.olderEst;
  const pr = ctx.predictions;
  if (!est) {
    return `<div class="card rn-fit">
      <div class="card-head"><h2>Fitness</h2><button class="icon-btn rn-info" data-a="vdot-info" aria-label="About the fitness score">${icon('info')}</button></div>
      <p class="small">No hard effort yet to measure your fitness. Run a <b>5k as fast as you can</b> (a parkrun or a solo time trial) and your fitness score and race predictions appear here.</p>
      ${ctx.paces ? '<p class="tiny muted" style="margin-top:8px">Until then, training paces are estimated from your easy runs.</p>' : ''}
    </div>`;
  }
  const hist = C.vdotHistory(ctx.runs, ctx.now, 16);
  const first = hist[0]?.vdot, last = est.vdot;
  const delta = first && hist.length > 1 ? last - first : null;
  const e = est.effort;
  const range = (p) => (Math.round(p.hi) - Math.round(p.lo) >= 5 ? `<small>${C.fmtTime(p.lo)}–${C.fmtTime(p.hi)}</small>` : '');
  return `<div class="card rn-fit">
    <div class="card-head"><h2>Fitness</h2><button class="icon-btn rn-info" data-a="vdot-info" aria-label="About the fitness score">${icon('info')}</button></div>
    <div class="rn-fit-row">
      <div class="rn-vdot"><b>${est.vdot.toFixed(1)}</b><span>VDOT</span>
        ${delta != null && Math.abs(delta) >= 0.1 ? `<em class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲ +' : '▼ '}${delta.toFixed(1)} in ${hist.length} wk</em>` : ''}</div>
      <div class="rn-spark">${hist.length > 1 ? '<canvas id="rn-vdot-chart"></canvas>' : ''}</div>
    </div>
    <div class="rn-preds">
      <div><span>5 km prediction</span><b>${C.fmtTime(pr.k5.s)}</b>${range(pr.k5)}</div>
      <div><span>10 km prediction</span><b>${C.fmtTime(pr.k10.s)}</b>${range(pr.k10)}</div>
    </div>
    <p class="tiny muted">Based on ${esc(e.whole ? `your ${e.name}` : `your best ${e.name}`)} on ${esc(niceDate(e.t))}${ctx.est ? '' : ' (over 8 weeks ago — a fresh 5k will update it)'}.</p>
  </div>`;
}

function vdotInfo() {
  push((el) => {
    el.innerHTML = sheet({
      title: 'How the coach measures fitness',
      body: `<div class="stack-sm small rn-sheet-text">
        <p><b>VDOT</b> is a running fitness score from coach Jack Daniels. It comes from your fastest recent efforts (races, time trials, and the best 1 mile / 5k / 10k segments found inside your runs) over the last 8 weeks.</p>
        <p>From VDOT the app predicts your 5k and 10k times and sets your <b>training paces</b>. The small range under a prediction is a cross-check with the Riegel formula.</p>
        <p>The score only rises when you run a fast effort — so an all-out 5k every 4–8 weeks keeps it accurate.</p>
        <p class="muted">Predictions assume you've trained for the distance. Heat, hills and wind make real times slower.</p>
      </div><button class="primary block" data-nav="back" style="margin-top:16px">Got it</button>`,
    });
  }, { sheet: true });
}

function showNextWeek(ctx) {
  if (planView) return planView === 'next';
  const dow = (new Date(ctx.now).getDay() + 6) % 7;
  const allDone = ctx.plan.sessions.every((s) => s.done);
  return allDone || (dow === 6 && ctx.today.kind !== 'session');
}

function planHtml(ctx) {
  const nextWeek = showNextWeek(ctx);
  const plan = nextWeek ? ctx.nextPlan : ctx.plan, today = ctx.today;
  const next = nextWeek ? null : today.session;
  const todayBody = today.kind === 'done' && today.run_id
    ? `<button class="rn-today rn-today-done" data-today-run="${esc(today.run_id)}"><span class="rn-today-k">Today</span><b>${esc(today.title)} ${icon('check')}</b><p>${esc(today.detail)}</p></button>`
    : `<div class="rn-today rn-today-${esc(today.kind)}"><span class="rn-today-k">Today</span><b>${esc(today.title)}</b><p>${esc(today.detail)}</p></div>`;
  return `<div class="card rn-plan">
    <div class="card-head"><h2>${nextWeek ? 'Next week' : "This week's plan"}</h2><span class="pill rn-pill-run">~${Math.round(plan.targetKm)} km · ${ctx.runsPerWeek} runs</span></div>
    <div class="seg rn-plan-seg"><button data-plan="this" class="${nextWeek ? '' : 'on'}">This week</button><button data-plan="next" class="${nextWeek ? 'on' : ''}">Next week</button></div>
    ${nextWeek ? '' : todayBody}
    <div class="rn-sessions">${plan.sessions.map((s) => `
      <div class="rn-sess ${s.done ? 'done' : ''} ${next && s === next ? 'next' : ''}">
        <span class="rn-day">${esc(s.day)}</span>
        <div class="grow"><b>${esc(s.title)}${s.hard ? ` <span class="rn-hard">${icon('bolt')}</span>` : ''}</b><p>${esc(s.detail)}</p></div>
        <span class="rn-sess-end">${s.done ? `<span class="rn-check">${icon('check')}</span>` : `<span class="rn-sess-km">${C.kmShort(s.km)} km</span>`}</span>
      </div>`).join('')}</div>
    ${plan.notes.map((n) => `<p class="tiny muted rn-note">${esc(n)}</p>`).join('')}
    <p class="tiny muted rn-note">Days are a suggestion — move runs around your week, just keep hard days apart.</p>
  </div>`;
}

function notesHtml(ctx) {
  const msgs = ctx.review.messages;
  if (!msgs.length) return '';
  return `<div class="card"><div class="card-head"><h2>Coach notes</h2><span class="tiny muted">recent weeks</span></div>
    ${feedbackHtml(msgs)}</div>`;
}

function volumeHtml(ctx) {
  const weeks = ctx.review.weeks;
  const done = weeks.slice(0, -1).filter((w) => w.km > 0);
  const avg = done.length ? done.reduce((s, w) => s + w.km, 0) / done.length : 0;
  return `<div class="card"><div class="card-head"><h2>Weekly distance</h2><span class="small muted">avg ${kmTxt(avg)} km</span></div>
    <div class="chart-box"><canvas id="rn-weeks"></canvas></div></div>`;
}

function intensityHtml(ctx) {
  const share = ctx.review.easyShare;
  if (share == null) return '';
  const e = Math.round(share * 100);
  return `<div class="card"><div class="card-head"><h2>Easy vs hard</h2><span class="small muted">last 4 weeks</span></div>
    <div class="rn-split"><i class="rn-split-easy" style="width:${e}%"></i><i class="rn-split-hard" style="width:${100 - e}%"></i><b class="rn-split-target"></b></div>
    <div class="row between small rn-split-legend"><span><i class="rn-dot-easy"></i>Easy ${e}%</span><span class="muted tiny">target ≈ 80 / 20</span><span><i class="rn-dot-hard"></i>Hard ${100 - e}%</span></div>
    <p class="tiny muted" style="margin-top:6px">By time, using heart rate${ctx.maxHrSource === 'default' ? ' (estimated max)' : ''} and pace per km.</p></div>`;
}

function easyTrendHtml(ctx) {
  const tr = C.easyPaceTrend(ctx);
  let msg;
  if (tr.points.length < 4) msg = `<p class="small muted">Needs a few more easy runs with heart rate between ${tr.lo} and ${tr.hi} bpm. This shows your aerobic fitness improving without racing.</p>`;
  else if (tr.slope == null) msg = '<p class="small muted">Keep going — the trend appears after 3 weeks of easy runs.</p>';
  else if (tr.slope <= -2) msg = `<p class="small"><b class="up">Getting fitter:</b> about ${Math.round(-tr.slope)} s/km faster per month at the same heart rate.</p>`;
  else if (tr.slope >= 3) msg = `<p class="small"><b class="down">${Math.round(tr.slope)} s/km per month slower</b> at the same heart rate — often heat, fatigue or a busy stretch. Prioritise sleep and easy runs.</p>`;
  else msg = '<p class="small">Steady at the same heart rate. Consistent easy mileage will move this.</p>';
  return `<div class="card"><div class="card-head"><h2>Easy pace at ${tr.lo}–${tr.hi} bpm</h2></div>
    ${tr.points.length >= 2 ? '<div class="chart-box short rn-chart-gap"><canvas id="rn-easy"></canvas></div>' : ''}${msg}</div>`;
}

function prHtml(ctx) {
  const rows = ctx.prs;
  if (!rows.some((r) => r.best)) return '';
  return `<div class="card"><div class="card-head"><h2>Personal records</h2><span class="rn-gold">${icon('trophy')}</span></div>
    <div class="rn-prs">${rows.map((r) => (r.best ? `<button class="rn-pr-row" data-pr="${esc(r.best.run_id)}"><span>${esc(r.label)}</span><b>${C.fmtTime(r.best.s)}</b><span class="muted small">${C.fmtPace(r.best.s / (r.m / 1000))}/km</span><span class="muted tiny">${esc(niceDate(r.best.t, { year: new Date(r.best.t).getFullYear() !== new Date().getFullYear() }))}</span></button>`
      : `<div class="rn-pr-row"><span>${esc(r.label)}</span><b class="muted">–</b><span></span><span></span></div>`)).join('')}</div></div>`;
}

const PACE_INFO = [
  ['easy', 'Easy', 'Most of your running. You can chat in full sentences.'],
  ['marathon', 'Marathon', 'Steady; good for long-run finishes.'],
  ['threshold', 'Threshold', 'Comfortably hard — tempo runs, 1 km cruise reps.'],
  ['interval', 'Interval', 'Hard 2–5 min reps, about 3–5k race pace.'],
  ['repetition', 'Repetition', 'Short fast reps (200–400 m), full recovery.'],
];
function pacesHtml(ctx) {
  const p = ctx.paces;
  if (!p) return '';
  const src = ctx.zoneSource === 'easy-runs' ? 'Estimated from your easy runs' : ctx.zoneSource === 'old-effort' ? 'From an older effort' : `From VDOT ${ctx.zoneVdot.toFixed(1)}`;
  return `<div class="card" id="rn-paces"><div class="card-head"><h2>Training paces</h2><span class="tiny muted">${esc(src)}</span></div>
    <div class="rn-paces">${PACE_INFO.map(([k, name, desc]) => `<div class="rn-pace-row"><span class="rn-zone rn-z-${k}"></span>
      <div class="grow"><b>${name}</b><p class="tiny muted">${desc}</p></div>
      <b class="rn-pace-val">${k === 'easy' ? C.paceRange(p.easy) : C.fmtPace(p[k])}<small>/km</small></b></div>`).join('')}</div></div>`;
}

function drawTabCharts(el, ctx) {
  const run = cssVar('--run');
  const vd = $('#rn-vdot-chart', el);
  if (vd) {
    const hist = C.vdotHistory(ctx.runs, ctx.now, 16);
    chart(vd, {
      type: 'line',
      data: { labels: hist.map((h) => h.week), datasets: [{ data: hist.map((h) => h.vdot), borderColor: run, backgroundColor: fade(run), fill: true, pointRadius: 0, borderWidth: 2.5, tension: 0.35 }] },
      options: { scales: { x: { display: false }, y: { display: false, grace: '10%' } }, plugins: { tooltip: { enabled: false } }, animation: false },
    });
  }
  const wk = $('#rn-weeks', el);
  if (wk) {
    const weeks = ctx.review.weeks;
    chart(wk, {
      type: 'bar',
      data: {
        labels: weeks.map((w) => weekTitle(w.start)),
        datasets: [{ data: weeks.map((w) => Math.round(w.km * 10) / 10), backgroundColor: weeks.map((w, i) => (i === weeks.length - 1 ? run : `${run}80`)), borderRadius: 6, maxBarThickness: 26 }],
      },
      options: {
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 5 } } },
        plugins: { tooltip: { callbacks: { title: (it) => `Week of ${it[0].label}`, label: (it) => ` ${it.raw} km · ${weeks[it.dataIndex].runs} runs` } } },
      },
    });
  }
  const ez = $('#rn-easy', el);
  if (ez) {
    const pts = C.easyPaceTrend(ctx).points;
    const xs = pts.map((p) => p.t), ys = pts.map((p) => p.pace);
    let line = null;
    if (pts.length >= 3) {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      const k = sxx ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx : 0;
      line = xs.map((x) => my + k * (x - mx));
    }
    chart(ez, {
      type: 'line',
      data: {
        labels: pts.map((p) => new Date(p.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [
          { data: ys, showLine: false, pointRadius: 3.5, pointBackgroundColor: `${run}aa`, pointBorderWidth: 0 },
          ...(line ? [{ data: line, borderColor: cssVar('--up'), borderWidth: 2, pointRadius: 0, borderDash: [5, 4] }] : []),
        ],
      },
      options: {
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 4, maxRotation: 0 } }, y: { reverse: true, ticks: { callback: (v) => C.fmtPace(v), maxTicksLimit: 4 } } },
        plugins: { tooltip: { filter: (it) => it.datasetIndex === 0, callbacks: { label: (it) => ` ${C.fmtPace(it.raw)}/km at ${Math.round(pts[it.dataIndex].hr)} bpm` } } },
      },
    });
  }
}

// ---------- setup (no runs yet) ----------
function renderSetup(el) {
  el.innerHTML = `
    <div class="page-head"><h1>Run</h1></div>
    <div class="rn-hero rn-setup">
      <span class="rn-setup-ic">${icon('run')}</span>
      <h2>Your running coach</h2>
      <p>Every run on your Garmin watch lands here automatically — with feedback on each run, your fitness and 5k/10k predictions, and a weekly plan to get faster.</p>
      <div id="rn-connect" class="rn-connect">${garminBox()}</div>
      <button class="rn-demo-btn" data-a="demo">${icon('play')} Try with demo data</button>
    </div>
    <h3 class="section-title">How it works</h3>
    <div class="card rn-steps">
      <div><span>1</span><p><b>Set up once.</b> Add your Garmin login as GitHub secrets — see GARMIN-SETUP.md, or ask Claude.</p></div>
      <div><span>2</span><p><b>Runs to your watch.</b> Nothing to do here — a scheduled job pulls new runs from Garmin Connect every 3 hours.</p></div>
      <div><span>3</span><p><b>Run.</b> New runs appear when you open this tab. The coach adapts your plan every week.</p></div>
    </div>`;
  el.querySelector('[data-a="demo"]').onclick = startDemo;
  el.querySelector('[data-a="refresh"]')?.addEventListener('click', () => doSync(false));
}

function garminBox() {
  if (!store.configured) return '<p class="small rn-setup-note">Online sync isn’t set up yet, so Garmin runs can’t appear here. You can explore everything with demo data meanwhile.</p>';
  const st = garminStatus();
  const text = st ? garminStatusText(st) : 'Setup: add your Garmin login as GitHub secrets — ask Claude. Once done, runs appear here automatically within a few hours.';
  return `<p class="small rn-setup-note">${esc(text)}</p>
    <button class="rn-garmin-btn" data-a="refresh" ${syncing ? 'disabled' : ''}>${icon('sync')} ${syncing ? 'Refreshing…' : 'Refresh'}</button>`;
}

// ---------- Home card ----------
function renderHome(el) {
  homeEl = el;
  const runs = runsOf();
  if (!runs.length) {
    el.innerHTML = `<button class="card rn-home rn-home-empty">
      <span class="rn-dot rn-t-long">${icon('run')}</span>
      <div class="grow"><b>Running coach</b><p class="small muted">Runs synced automatically from Garmin get feedback, a fitness score and a weekly plan for a faster 5k and 10k.</p></div>
      <span class="rn-chev">${icon('back')}</span></button>`;
    el.firstElementChild.onclick = () => window.showTab?.('run');
    return;
  }
  const ctx = getCtx();
  const { thisWeek: tw, lastWeek: lw } = ctx.review;
  const last = ctx.runs[0];
  const fb = C.runFeedback(last, ctx)[0];
  const d = pct(tw.km, lw.km);
  const today = ctx.today;
  el.innerHTML = `<div class="card rn-home" role="button" tabindex="0">
    <div class="card-head"><h2 class="rn-home-title">${icon('run')}Running${demo ? ' <span class="pill gold">Demo</span>' : ''}</h2><span class="link">Open</span></div>
    <div class="rn-home-week">
      <div><b>${kmTxt(tw.km)}<small> km</small></b><span>this week</span></div>
      <div><b>${kmTxt(lw.km)}<small> km</small></b><span>last week</span></div>
      <div><b class="${d == null ? '' : d >= 0 ? 'up' : 'muted'}">${d == null ? '–' : `${d >= 0 ? '+' : ''}${d}%`}</b><span>change</span></div>
    </div>
    <button class="rn-home-last" data-run="${esc(last.id)}">
      <p class="small"><b>${esc(last.name || 'Run')}</b> <span class="muted">· ${esc(relDay(last.start))} · ${C.km(last.distance_m).toFixed(1)} km · ${C.fmtPace(C.paceOf(last))}/km</span></p>
      ${fb ? `<p class="small rn-home-fb rn-fb-${esc(fb.tone)}">${icon(TONE_ICON[fb.tone] || 'info')}<span>${esc(fb.text)}</span></p>` : ''}
    </button>
    <div class="rn-home-today"><span class="rn-today-k">Today</span><b>${esc(today.title)}</b><p class="small muted">${esc(today.detail)}</p></div>
  </div>`;
  const card = el.firstElementChild;
  card.onclick = () => window.showTab?.('run');
  card.onkeydown = (e) => { if (e.key === 'Enter') window.showTab?.('run'); };
  wireRows(el, ctx, findRun);
}

// ---------- Me section ----------
function renderMe(el) {
  meEl = el;
  const cfg = settings();
  const ctx = getCtx();
  const st = garminStatus();
  el.innerHTML = `<h3 class="section-title">Running</h3>
    <div class="card stack rn-me">
      <div class="rn-garmin-row">
        <span class="rn-garmin-logo">${icon('run')}</span>
        <div class="grow"><b>Garmin</b><p class="small muted" id="rn-st-text">${esc(store.configured ? (st ? garminStatusText(st) : 'Setup: add your Garmin login as GitHub secrets — ask Claude.') : 'Needs online sync, which isn’t set up yet.')}</p></div>
        <div id="rn-st-actions" class="row">${store.configured ? `<button class="icon-btn ${syncing ? 'rn-spin' : ''}" data-a="sync" aria-label="Refresh" ${syncing ? 'disabled' : ''}>${icon('sync')}</button>` : ''}</div>
      </div>
      <div><p class="rn-label">Runs per week</p><div class="seg" id="rn-rpw">${[3, 4, 5, 6].map((n) => `<button data-v="${n}" class="${ctx.runsPerWeek === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div><p class="rn-label">Goal</p><div class="seg" id="rn-focus">${['5k', '10k'].map((f) => `<button data-v="${f}" class="${ctx.focus === f ? 'on' : ''}">${f === '5k' ? 'Faster 5k' : 'Faster 10k'}</button>`).join('')}</div></div>
      <label>Max heart rate (optional)
        <input id="rn-maxhr" inputmode="numeric" autocomplete="off" placeholder="${ctx.maxHrSource === 'data' ? `${ctx.maxHr} — highest seen in your runs` : `${ctx.maxHr} — rough default`}" value="${esc(cfg.max_hr || '')}"></label>
      ${demo ? '<button class="ghost" id="rn-exit-demo">Exit demo data</button>' : ''}
    </div>`;

  $$('#rn-rpw button', el).forEach((b) => { b.onclick = () => saveSettings({ runs_per_week: Number(b.dataset.v) }); });
  $$('#rn-focus button', el).forEach((b) => { b.onclick = () => saveSettings({ focus: b.dataset.v }); });
  $('#rn-maxhr', el).onchange = (e) => {
    const raw = e.target.value.trim();
    const v = Number(raw);
    if (raw && !(v >= 120 && v <= 230)) { toast('Max heart rate should be between 120 and 230'); return; }
    saveSettings({ max_hr: raw ? Math.round(v) : null });
  };
  $('#rn-exit-demo', el)?.addEventListener('click', stopDemo);
  $('[data-a="sync"]', el)?.addEventListener('click', () => doSync(false));
}
