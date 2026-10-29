// Stats tab, one page: body weight (weigh-ins only) and gym progress (every exercise's e1RM, one charted at a time;
// PRs) over 7 d / 30 d / 90 d / 1 y.
// Calculations: stats-insights.js.
import { $, $$, esc, local, today, n1, niceDate, fromDay } from './util.js';
import * as store from './store.js';
import { chart, cssVar, seriesColor, onThemeChange } from './charts.js';
import { computePRs, PR_KINDS, formatMetric } from './gym-calc.js';
import { loadDb, exName } from './gym-data.js';
import { isSetUp, cutSettings } from './cut.js';
import { emaTrend, trendOn } from './cut-calc.js';
import { RANGES, addDays } from './stats-calc.js';
import { weightDays, strengthKept, recentPRs } from './stats-insights.js';

export const tab = { id: 'stats', title: 'Stats', icon: 'stats', render };
export const homeCard = null;

let days = local.get('statsRange', 30);
if (!RANGES.some((r) => r.days === days)) days = 30;

const thisYear = () => new Date().getFullYear();
const shortDay = (d) => niceDate(fromDay(d), { year: fromDay(d).getFullYear() !== thisYear() });
const signed = (x, d = 1) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`);

function chartCard(title, id, note = '') {
  return `<div class="card st-card"><h2>${title}</h2>${note ? `<p class="small muted st-note" id="${id}-note">${note}</p>` : `<p class="small muted st-note" id="${id}-note" hidden></p>`}
    <div class="st-chart"><canvas id="${id}"></canvas></div><div class="st-empty muted small" id="${id}-empty" hidden></div></div>`;
}
function empty(el, id, msg) {
  const e = $(`#${id}-empty`, el);
  $(`#${id}`, el).parentElement.hidden = Boolean(msg);
  e.hidden = !msg;
  e.textContent = msg || '';
  return !msg;
}

// ---------- data shared by the cards ----------
function gather() {
  const t = today();
  const weights = store.all('bodyweight');
  const workouts = store.all('workout').filter((w) => w?.started_at);
  const cut = isSetUp() ? cutSettings() : null;
  return { t, weights, workouts, cut, from: addDays(t, -days + 1) };
}

// ---------- page ----------
let themeHooked = false;
let dbAsked = false;
function render(el) {
  if (!themeHooked) { themeHooked = true; onThemeChange(() => { if (el.isConnected) render(el); }); }
  if (!dbAsked) { dbAsked = true; loadDb().then(() => { if (el.isConnected) render(el); }).catch(() => {}); }
  const g = gather();
  if (!g.weights.length && !g.workouts.length) {
    el.innerHTML = `<div class="page-head"><h1>Stats</h1></div><div class="card empty"><h2>Nothing to show yet</h2>
      <p class="small" style="margin:6px 0 14px">Weigh in or record a workout - your weight and strength appear here.</p>
      <div class="row" style="gap:8px;justify-content:center;flex-wrap:wrap"><button class="primary" data-go="gym">Start a workout</button></div></div>`;
    $$('[data-go]', el).forEach((b) => { b.onclick = () => window.showTab(b.dataset.go); });
    return;
  }
  const span = { 7: '7 days', 30: '30 days', 90: '90 days' }[days] || 'year';
  el.innerHTML = `<div class="page-head"><h1>Stats</h1></div>
    <div class="stack st-cards">
      <div class="seg st-range" role="group" aria-label="Range for the charts">${RANGES.map((r) => `<button data-days="${r.days}" class="${r.days === days ? 'on' : ''}">${r.label}</button>`).join('')}</div>
      ${chartCard('Body weight', 'st-weight')}
      <h3 class="section-title">Gym progress</h3>
      <div id="st-strength"></div>
      <div id="st-prs"></div>
    </div>
    <p class="tiny muted center" style="margin-top:16px">Charts show the last ${esc(span)}.</p>`;
  $$('.st-range button', el).forEach((b) => b.onclick = () => { days = Number(b.dataset.days); local.set('statsRange', days); render(el); });
  for (const f of [drawWeight, drawStrength, drawPRs]) {
    try { f(el, g); } catch (e) { console.error(e); }
  }
}

// ---------- charts ----------
const base = (labels, datasets, extra = {}) => ({
  data: { labels, datasets },
  options: {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
      y: { beginAtZero: true, grace: '5%' },
      ...(extra.scales || {}),
    },
    plugins: { legend: { display: Boolean(extra.legend), labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: extra.tooltip || {} } },
  },
});
const line = (label, data, color, o = {}) => ({ type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: 0.3, ...o });

function drawWeight(el, g) {
  const rows = weightDays(g.weights, g.t, days);
  if (!empty(el, 'st-weight', rows.some((r) => r.kg != null) ? '' : 'No weigh-ins in this period yet.')) return;
  chart('st-weight', base(rows.map((r) => shortDay(r.day)), [
    line('Weigh-in', rows.map((r) => r.kg), cssVar('--accent'), { spanGaps: true, tension: 0.2, pointRadius: days > 90 ? 1.5 : 2.5 }),
  ], {
    scales: { y: { beginAtZero: false, grace: '10%' } },
    tooltip: { label: (c) => (c.parsed.y == null ? null : `${n1(c.parsed.y)} kg`) },
  }));
}

// Body weight on a day (for pull-ups / dips): the trend, else the last weigh-in.
const bodyOn = (g) => { const tr = emaTrend(g.weights); return (d) => trendOn(tr, d); };

// Every exercise trained since `since` (most-trained first); the picked one is charted. The pick is kept on the device.
let pickedLift = local.get('statsLift', null);
function drawStrength(el, g) {
  const since = g.cut?.startDate && g.cut.startDate <= g.t ? g.cut.startDate : g.from;
  const lifts = strengthKept(g.workouts, since, bodyOn(g), Infinity, 1);
  const box = $('#st-strength', el);
  if (!lifts.length) { box.innerHTML = `<div class="card"><h2>Strength</h2><p class="small muted" style="margin-top:6px">Exercises you train ${g.cut ? 'since the cut started' : 'in this period'} show here with their estimated 1-rep max.</p></div>`; return; }
  const cur = lifts.find((l) => l.id === pickedLift) || lifts[0];
  const name = (l) => exName(l.id, l.id);
  const change = (l) => (l.sessions.length < 2 ? '<em class="muted">1 session</em>' : `<em class="${l.change < -5 ? 'st-bad' : l.change < 0 ? 'st-warn' : 'st-good'}">${signed(l.change, 1)}%</em>`);
  box.innerHTML = `<div class="card st-card"><h2>Strength ${g.cut ? 'kept on the cut' : ''}</h2>
    <p class="small muted">Estimated 1-rep max, change since ${g.cut ? 'the cut started' : esc(shortDay(since))}. Down more than 5% is a sign to eat a bit more.</p>
    <label class="st-pick">Exercise<select id="st-lift-pick">${lifts.map((l) => `<option value="${esc(l.id)}" ${l === cur ? 'selected' : ''}>${esc(name(l))}</option>`).join('')}</select></label>
    <div class="st-chart"><canvas id="st-lifts"></canvas></div>
    <div class="st-lifts">${lifts.map((l) => `<button class="row between st-lift ${l === cur ? 'on' : ''}" data-lift="${esc(l.id)}"><span class="ellipsis">${esc(name(l))}${l.bw ? ' <span class="tiny muted">(+ body)</span>' : ''}</span>
      <span class="st-lift-num"><b>${n1(l.sessions[l.sessions.length - 1].e1rm)} kg</b> ${change(l)}</span></button>`).join('')}</div></div>`;
  const pick = (id) => { pickedLift = id; local.set('statsLift', id); drawStrength(el, g); };
  $('#st-lift-pick', box).onchange = (e) => pick(e.target.value);
  $$('[data-lift]', box).forEach((b) => { b.onclick = () => pick(b.dataset.lift); });
  chart('st-lifts', base(cur.sessions.map((s) => shortDay(s.day)), [
    line(name(cur), cur.sessions.map((s) => s.e1rm), seriesColor(0), { pointRadius: cur.sessions.length > 24 ? 1.5 : 3, tension: 0.25 }),
  ], { scales: { y: { beginAtZero: false, grace: '10%' } }, tooltip: { label: (c) => `${c.dataset.label}: ${n1(c.parsed.y)} kg` } }));
}

function drawPRs(el, g) {
  const prs = recentPRs(g.workouts, computePRs(g.workouts), g.from);
  $('#st-prs', el).innerHTML = `<div class="card"><h2>Personal records</h2>${prs.length ? `<div class="list" style="margin-top:6px">${prs.map((p) => `<div class="list-item" style="cursor:default"><div class="grow"><div class="ellipsis"><b>${esc(exName(p.exercise_id, p.exercise_id))}</b></div>
      <div class="sub">${esc(PR_KINDS[p.kind] || p.kind)}: ${esc(formatMetric(p.kind, p.value))} <span class="muted">(was ${esc(formatMetric(p.kind, p.prev))}${p.n > 1 ? ` · ${p.n} record sessions` : ''})</span></div></div><span class="tiny muted">${esc(shortDay(p.day))}</span></div>`).join('')}</div>`
    : `<p class="small muted" style="margin-top:6px">No new records in this period${g.cut ? ' - on a cut, holding your numbers is a win' : ''}.</p>`}</div>`;
}
