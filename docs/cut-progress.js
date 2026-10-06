// Cut plan progress in the Stats tab: weight (weigh-ins, trend, projected line, goal), waist, e1RM per main lift,
// run pace, weekly grades, and two check-ins' photos side by side. Data prep: cut-week.js.

import { $, $$, esc, today, n1, niceDate, fromDay } from './util.js';
import * as store from './store.js';
import { chart, cssVar } from './charts.js';
import { cutSettings, startWeight } from './cut.js';
import { weightChart, liftSeries } from './cut-week.js';
import { addDays } from './stats-calc.js';

const short = (d) => niceDate(fromDay(d)).replace(/ \d{4}$/, '');
const POSES = ['front', 'side', 'back'];
const card = (title, id, note = '') => `<div class="card st-card"><h2>${title}</h2>${note ? `<p class="small muted">${note}</p>` : ''}
  <div class="st-chart"><canvas id="${id}"></canvas></div><p class="st-empty muted small" id="${id}-empty" hidden></p></div>`;
function empty(el, id, msg) {
  $(`#${id}`, el).parentElement.hidden = Boolean(msg);
  const e = $(`#${id}-empty`, el);
  e.hidden = !msg;
  e.textContent = msg || '';
  return Boolean(msg);
}
const lineOpts = (extra = {}) => ({
  responsive: true, interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: true, labels: { boxWidth: 10, boxHeight: 10 } } },
  scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { grace: '5%' }, ...extra },
});

export function renderProgress(el) {
  const c = cutSettings();
  const checkins = store.all('checkin').sort((a, b) => (a.forDay || a.day).localeCompare(b.forDay || b.day));
  el.innerHTML = `<div class="stack st-cards">
    ${card('Weight', 'cp-weight', 'Dots are weigh-ins, the line is the trend. Dashed: the planned line and the goal.')}
    ${card('Waist', 'cp-waist', 'From the weekly check-ins (cm).')}
    ${card('Strength', 'cp-lifts', 'Estimated 1-rep max of the main lifts, best set of each session.')}
    ${card('Run pace', 'cp-pace', 'Average pace of each run (min/km, lower is faster).')}
    ${card('Weekly grades', 'cp-grades')}
    <div class="card"><h2>Photos</h2>${checkins.filter((x) => Object.keys(x.photos || {}).length).length >= 1 ? `
      <div class="form-row" style="margin-top:8px"><label>Compare<select id="cp-a">${opts(checkins, 0)}</select></label><label>with<select id="cp-b">${opts(checkins, checkins.length - 1)}</select></label></div>
      <div class="seg" id="cp-pose" style="margin-top:10px">${POSES.map((p, i) => `<button data-p="${p}" class="${i ? '' : 'on'}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
      <div class="cp-photos" id="cp-photos"></div>` : '<p class="small muted">Photos from your weekly check-ins appear here, two weeks side by side.</p>'}</div>
  </div>`;
  for (const f of [drawWeight, drawWaist, drawLifts, drawPace, drawGrades]) { try { f(el, c, checkins); } catch (e) { console.error(e); } }
  let pose = 'front';
  const photos = () => {
    const box = $('#cp-photos', el);
    if (!box) return;
    const pick = (id) => checkins[+$(id, el).value];
    box.innerHTML = [pick('#cp-a'), pick('#cp-b')].map((ci) => {
      const ph = ci?.photos?.[pose] && store.get(ci.photos[pose]);
      return `<figure>${ph?.data ? `<img src="${ph.data}" alt="">` : '<div class="cp-none small muted">No photo</div>'}<figcaption class="tiny muted">${ci ? esc(label(ci)) : ''}</figcaption></figure>`;
    }).join('');
  };
  $$('#cp-pose button', el).forEach((b) => { b.onclick = () => { pose = b.dataset.p; $$('#cp-pose button', el).forEach((x) => x.classList.toggle('on', x === b)); photos(); }; });
  $('#cp-a', el)?.addEventListener('change', photos);
  $('#cp-b', el)?.addEventListener('change', photos);
  photos();
}
const label = (ci) => `${ci.summary?.week ? `W${ci.summary.week} · ` : ''}${short(ci.forDay || ci.day)}`;
const opts = (list, sel) => list.map((ci, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(label(ci))}</option>`).join('');

function drawWeight(el, c) {
  const rows = weightChart(store.all('bodyweight'), c, startWeight(c), today());
  if (empty(el, 'cp-weight', rows.some((r) => r.kg != null) ? '' : 'Weigh in to see your weight chart.')) return;
  const acc = cssVar('--food');
  chart('cp-weight', {
    type: 'line',
    data: {
      labels: rows.map((r) => short(r.day)),
      datasets: [
        { label: 'Weigh-in', data: rows.map((r) => r.kg), showLine: false, pointRadius: 2.5, backgroundColor: cssVar('--text-3'), borderColor: 'transparent' },
        { label: 'Trend', data: rows.map((r) => r.trend), borderColor: acc, borderWidth: 2.5, pointRadius: 0, tension: 0.3, spanGaps: true },
        { label: 'Plan', data: rows.map((r) => r.projected), borderColor: cssVar('--run'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
        { label: 'Goal', data: rows.map((r) => r.goal), borderColor: cssVar('--gold'), borderDash: [2, 3], borderWidth: 1.5, pointRadius: 0 },
      ],
    },
    options: lineOpts(),
  });
}

function drawWaist(el, c, checkins) {
  const rows = checkins.filter((x) => x.waist > 0);
  if (empty(el, 'cp-waist', rows.length ? '' : 'Measure your waist at the weekly check-in.')) return;
  chart('cp-waist', { type: 'line', data: { labels: rows.map((x) => short(x.forDay || x.day)), datasets: [
    { label: 'Waist', data: rows.map((x) => x.waist), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'), pointRadius: 3, borderWidth: 2, tension: 0.3 }] },
  options: { ...lineOpts(), plugins: { legend: { display: false } } } });
}

function drawLifts(el, c) {
  const series = liftSeries(store.all('workout'), addDays(c.startDate, -28));
  const names = Object.keys(series);
  if (empty(el, 'cp-lifts', names.length ? '' : 'Log Upper A / B / C workouts to see your strength.')) return;
  const days = [...new Set(names.flatMap((n) => series[n].map((x) => x.day)))].sort();
  const colors = ['--gym', '--run', '--food', '--gold', '--protein'];
  chart('cp-lifts', { type: 'line', data: { labels: days.map(short), datasets: names.map((n, i) => {
    const m = new Map(series[n].map((x) => [x.day, x.e1rm]));
    return { label: n, data: days.map((d) => m.get(d) ?? null), spanGaps: true, borderColor: cssVar(colors[i % colors.length]), backgroundColor: cssVar(colors[i % colors.length]), pointRadius: 2.5, borderWidth: 2, tension: 0.25 };
  }) }, options: lineOpts() });
}

function drawPace(el, c) {
  const runs = store.all('run').filter((r) => r.start && +r.distance_m > 500 && (+r.moving_s || +r.elapsed_s) > 0 && r.start.slice(0, 10) >= addDays(c.startDate, -28))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (empty(el, 'cp-pace', runs.length ? '' : 'Runs appear here after your Garmin sync.')) return;
  const pace = (r) => Math.round((+r.moving_s || +r.elapsed_s) / (+r.distance_m / 1000)); // seconds per km
  const mmss = (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
  chart('cp-pace', { type: 'line', data: { labels: runs.map((r) => short(r.start.slice(0, 10))), datasets: [
    { label: 'Pace', data: runs.map(pace), borderColor: cssVar('--run'), backgroundColor: cssVar('--run'), pointRadius: 3, borderWidth: 2, tension: 0.25 }] },
  options: { ...lineOpts({ y: { reverse: true, grace: 0, ticks: { stepSize: 15, callback: mmss } } }), plugins: { legend: { display: false },
    tooltip: { callbacks: { label: (t) => `${mmss(t.parsed.y)} /km` } } } } });
}

function drawGrades(el, c, checkins) {
  const rows = checkins.filter((x) => x.score != null);
  if (empty(el, 'cp-grades', rows.length ? '' : 'Grades appear after your first weekly review.')) return;
  chart('cp-grades', { type: 'bar', data: { labels: rows.map((x) => `${x.summary?.week ? `W${x.summary.week}` : short(x.forDay || x.day)} · ${x.grade}`), datasets: [
    { label: 'Score %', data: rows.map((x) => Math.round(x.score * 100)), backgroundColor: rows.map((x) => cssVar(x.score >= 0.8 ? '--up' : x.score >= 0.6 ? '--gold' : '--down')), borderRadius: 6 }] },
  options: { ...lineOpts({ y: { min: 0, max: 100 } }), plugins: { legend: { display: false } } } });
}
export { n1 };
