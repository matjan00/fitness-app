// Cut plan cards at the bottom of the Stats tab: waist, weekly grades, and two check-ins' photos side by side.
// (Weight with the plan line, strength and running are in the main Stats charts: stats.js.)

import { $, $$, esc, today, n1, niceDate, fromDay } from './util.js';
import * as store from './store.js';
import { chart, cssVar } from './charts.js';
import { cutSettings } from './cut.js';

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
    ${card('Waist', 'cp-waist', 'From the weekly check-ins (cm).')}
    ${card('Weekly grades', 'cp-grades')}
    <div class="card"><h2>Photos</h2>${checkins.filter((x) => Object.keys(x.photos || {}).length).length >= 1 ? `
      <div class="form-row" style="margin-top:8px"><label>Compare<select id="cp-a">${opts(checkins, 0)}</select></label><label>with<select id="cp-b">${opts(checkins, checkins.length - 1)}</select></label></div>
      <div class="seg" id="cp-pose" style="margin-top:10px">${POSES.map((p, i) => `<button data-p="${p}" class="${i ? '' : 'on'}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
      <div class="cp-photos" id="cp-photos"></div>` : '<p class="small muted">Photos from your weekly check-ins appear here, two weeks side by side.</p>'}</div>
  </div>`;
  for (const f of [drawWaist, drawGrades]) { try { f(el, c, checkins); } catch (e) { console.error(e); } }
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

function drawWaist(el, c, checkins) {
  const rows = checkins.filter((x) => x.waist > 0);
  if (empty(el, 'cp-waist', rows.length ? '' : 'Measure your waist at the weekly check-in.')) return;
  chart('cp-waist', { type: 'line', data: { labels: rows.map((x) => short(x.forDay || x.day)), datasets: [
    { label: 'Waist', data: rows.map((x) => x.waist), borderColor: cssVar('--text'), backgroundColor: cssVar('--text'), pointRadius: 3, borderWidth: 2, tension: 0.3 }] },
  options: { ...lineOpts(), plugins: { legend: { display: false } } } });
}

function drawGrades(el, c, checkins) {
  const rows = checkins.filter((x) => x.score != null);
  if (empty(el, 'cp-grades', rows.length ? '' : 'Grades appear after your first weekly review.')) return;
  chart('cp-grades', { type: 'bar', data: { labels: rows.map((x) => `${x.summary?.week ? `W${x.summary.week}` : short(x.forDay || x.day)} · ${x.grade}`), datasets: [
    { label: 'Score %', data: rows.map((x) => Math.round(x.score * 100)), backgroundColor: rows.map((x) => cssVar(x.score >= 0.8 ? '--up' : x.score >= 0.6 ? '--gold' : '--down')), borderRadius: 6 }] },
  options: { ...lineOpts({ x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, font: { size: 10 } } }, y: { min: 0, max: 100 } }), plugins: { legend: { display: false } } } });
}
export { n1 };
