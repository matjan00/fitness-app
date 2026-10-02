// Stats tab: graphs of food, body weight, running and gym over 7 d / 30 d / 90 d / 1 y. Calculations: stats-calc.js.
import { $, $$, esc, local, today, n0, n1, niceDate } from './util.js';
import * as store from './store.js';
import { chart, cssVar, fade } from './charts.js';
import { targets } from './food-ui.js';
import { workoutVolume } from './gym-calc.js';
import { RANGES, dailyNutrition, weeklyNutrition, averageLogged, weightSeries, runWeekly, gymWeekly, weeksFor } from './stats-calc.js';

export const tab = { id: 'stats', title: 'Stats', icon: 'stats', render };
export const homeCard = null;

let days = local.get('statsRange', 30);
if (!RANGES.some((r) => r.days === days)) days = 30;

const shortDay = (d) => niceDate(d).replace(/ \d{4}$/, '');

function section(title, id, note) {
  return `<div class="card st-card"><h2>${title}</h2>${note ? `<p class="small muted">${note}</p>` : ''}
    <div class="st-chart"><canvas id="${id}"></canvas></div><div class="st-empty muted small" id="${id}-empty" hidden></div></div>`;
}

function empty(el, id, msg) {
  const e = $(`#${id}-empty`, el);
  $(`#${id}`, el).parentElement.hidden = Boolean(msg);
  e.hidden = !msg;
  e.textContent = msg || '';
  return !msg;
}

function render(el) {
  const label = RANGES.find((r) => r.days === days).label;
  el.innerHTML = `<div class="page-head"><h1>Stats</h1></div>
    <div class="seg st-range">${RANGES.map((r) => `<button data-days="${r.days}" class="${r.days === days ? 'on' : ''}">${r.label}</button>`).join('')}</div>
    <div class="stack st-cards">
      ${section('Calories', 'st-kcal')}
      ${section('Protein, carbs &amp; fat', 'st-macros', 'Grams per day, dashed lines are your targets.')}
      ${section('Body weight', 'st-weight', 'Dots are weigh-ins, the line is the 7-day average.')}
      ${section('Running', 'st-run')}
      ${section('Gym sessions', 'st-gym')}
      ${section('Gym volume', 'st-vol', 'Total kg lifted (weight × reps) per week.')}
    </div>
    <p class="tiny muted center" style="margin-top:16px">Showing the last ${esc(label)}.</p>`;
  $$('.st-range button', el).forEach((b) => b.onclick = () => {
    days = Number(b.dataset.days);
    local.set('statsRange', days);
    render(el);
  });
  const draw = [drawFood, drawWeight, drawRun, drawGym];
  for (const f of draw) { try { f(el); } catch (e) { console.error(e); } }
}

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
    plugins: { tooltip: { callbacks: extra.tooltip || {} } },
  },
});

const line = (label, data, color, o = {}) => ({
  type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: 0.3, ...o,
});
const target = (label, v, n, color) => ({
  type: 'line', label, data: Array(n).fill(v), borderColor: color, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false,
});

function drawFood(el) {
  const daily = dailyNutrition(store.all('meal'), today(), days);
  const weekly = days > 90;
  const rows = weekly ? weeklyNutrition(daily) : daily;
  const t = targets();
  const ok = empty(el, 'st-kcal', rows.some((r) => r.logged) ? '' : 'No food logged in this period yet.');
  empty(el, 'st-macros', ok ? '' : 'No food logged in this period yet.');
  if (!ok) return;
  const labels = rows.map((r) => (weekly ? 'wk ' : '') + shortDay(r.day));
  const val = (k) => rows.map((r) => (r.logged ? Math.round(r[k]) : null));
  const food = cssVar('--food');
  const avg = averageLogged(daily);
  $('#st-kcal', el).closest('.st-card').querySelector('h2').insertAdjacentHTML('afterend',
    `<p class="small muted">${weekly ? 'Average per logged day, by week.' : 'Per day.'} ${avg ? `Average ${n0(avg.kcal)} kcal${t ? ` of ${n0(t.kcal)} target` : ''} (${avg.days} days logged).` : ''}</p>`);
  const sets = [{ type: 'bar', label: 'Eaten', data: val('kcal'), backgroundColor: food, borderRadius: 4, maxBarThickness: 18 }];
  if (t?.kcal) sets.push(target('Target', t.kcal, rows.length, cssVar('--text-2')));
  chart('st-kcal', base(labels, sets, { tooltip: { label: (c) => `${c.dataset.label}: ${n0(c.parsed.y)} kcal` } }));

  const ms = [['p', 'Protein', '--protein'], ['c', 'Carbs', '--carbs'], ['f', 'Fat', '--fat']];
  const mset = [];
  for (const [k, name, v] of ms) {
    const col = cssVar(v);
    mset.push(line(name, val(k), col, { spanGaps: true, tension: weekly ? 0.4 : 0.3, pointRadius: rows.length <= 31 ? 2 : 0 }));
    if (t?.[k]) mset.push(target(`${name} target`, t[k], rows.length, col));
  }
  chart('st-macros', base(labels, mset, { tooltip: { label: (c) => `${c.dataset.label}: ${n0(c.parsed.y)} g` } }));
}

function drawWeight(el) {
  const s = weightSeries(store.all('bodyweight'), today(), days);
  if (!empty(el, 'st-weight', s.length ? '' : 'No weigh-ins in this period yet.')) return;
  const col = cssVar('--accent');
  chart('st-weight', base(s.map((e) => shortDay(e.day)), [
    line('7-day average', s.map((e) => +e.avg.toFixed(2)), col, { backgroundColor: fade(col), fill: true }),
    { type: 'line', label: 'Weigh-in', data: s.map((e) => e.kg), showLine: false, pointRadius: 3, borderColor: col, backgroundColor: col },
  ], {
    scales: { y: { beginAtZero: false, grace: '10%' } },
    tooltip: { label: (c) => `${c.dataset.label}: ${n1(c.parsed.y)} kg` },
  }));
}

function drawRun(el) {
  const r = runWeekly(store.all('run'), today(), weeksFor(days));
  if (!empty(el, 'st-run', r.some((w) => w.km > 0) ? '' : 'No runs in this period yet.')) return;
  chart('st-run', base(r.map((w) => shortDay(w.week)), [
    { type: 'bar', label: 'Distance', data: r.map((w) => +w.km.toFixed(1)), backgroundColor: cssVar('--run'), borderRadius: 4, maxBarThickness: 22 },
  ], { tooltip: { label: (c) => `${n1(c.parsed.y)} km (${r[c.dataIndex].runs} run${r[c.dataIndex].runs === 1 ? '' : 's'})` } }));
}

function drawGym(el) {
  const g = gymWeekly(store.all('workout'), today(), weeksFor(days), workoutVolume);
  const none = g.some((w) => w.sessions > 0) ? '' : 'No gym sessions in this period yet.';
  empty(el, 'st-gym', none);
  empty(el, 'st-vol', none);
  if (none) return;
  const labels = g.map((w) => shortDay(w.week));
  const col = cssVar('--gym');
  chart('st-gym', base(labels, [
    { type: 'bar', label: 'Sessions', data: g.map((w) => w.sessions), backgroundColor: col, borderRadius: 4, maxBarThickness: 22 },
  ], { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }));
  chart('st-vol', base(labels, [
    line('Volume', g.map((w) => Math.round(w.volume)), col, { backgroundColor: fade(col), fill: true, pointRadius: 2 }),
  ], { tooltip: { label: (c) => `${n0(c.parsed.y)} kg` } }));
}
