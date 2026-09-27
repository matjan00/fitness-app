// Run list rows, the run detail screen and the "All runs" screen.

import { $, $$, esc, icon, niceDate, niceTime, relDay } from './util.js';
import { push, page } from './nav.js';
import { chart, cssVar } from './charts.js';
import * as C from './run-coach.js';

const TONE_ICON = { pr: 'trophy', good: 'check', tip: 'info', warn: 'info', info: 'note' };

export const typeLabel = (t) => C.TYPE_LABELS[t] || 'Run';
export const typePill = (t) => `<span class="pill rn-pill rn-t-${esc(t)}">${esc(typeLabel(t))}</span>`;

const prCount = (run) => (run.best_efforts || []).filter((e) => Number(e.pr_rank) === 1 && ['1k', '1 mile', '5k', '10k', 'Half-Marathon', 'Marathon'].includes(e.name)).length;

export function runRow(run, ctx, { showDate = 'rel' } = {}) {
  const cls = ctx.classOf(run);
  const p = C.paceOf(run);
  const prs = prCount(run);
  const when = showDate === 'rel' ? relDay(run.start) : niceDate(run.start, { weekday: true });
  return `<button class="list-item rn-run" data-run="${esc(run.id)}">
    <span class="rn-dot rn-t-${esc(cls.type)}">${icon(cls.type === 'race' ? 'trophy' : cls.type === 'intervals' || cls.type === 'tempo' ? 'bolt' : 'run')}</span>
    <div class="grow">
      <div class="rn-run-title"><b class="ellipsis">${esc(run.name || 'Run')}</b>${prs ? `<span class="pill gold rn-pr">${icon('trophy')}${prs > 1 ? `${prs} PRs` : 'PR'}</span>` : ''}</div>
      <p class="sub">${esc(when)} · <span class="rn-type rn-t-${esc(cls.type)}">${esc(typeLabel(cls.type))}</span></p>
      <p class="rn-meta">${C.fmtTime(run.moving_s)}${run.avg_hr ? ` · <span class="rn-hr">${icon('heart')}${Math.round(run.avg_hr)}</span>` : ''}${run.elev_m >= 30 ? ` · ↑${Math.round(run.elev_m)} m` : ''}</p>
    </div>
    <div class="rn-right"><b>${C.km(run.distance_m).toFixed(2)} km</b><p class="sub">${C.fmtPace(p)}/km</p></div>
  </button>`;
}

// Wire clicks on rows rendered with runRow inside `root`.
export function wireRows(root, ctx, getRun) {
  $$('[data-run]', root).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const r = getRun(b.dataset.run);
      if (r) openRun(r, ctx);
    };
  });
}

export function feedbackHtml(items) {
  if (!items.length) return '';
  return `<ul class="rn-fb">${items.map((f) => `<li class="rn-fb-${esc(f.tone)}"><span class="rn-fb-ic">${icon(TONE_ICON[f.tone] || 'info')}</span><p>${esc(f.text)}</p></li>`).join('')}</ul>`;
}

// ---------- polyline → SVG ----------
export function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i <= str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

function routeSvg(polyline) {
  let pts;
  try { pts = decodePolyline(polyline); } catch { return ''; }
  if (pts.length < 2) return '';
  const lat0 = pts[0][0] * (Math.PI / 180);
  const xy = pts.map(([la, ln]) => [ln * Math.cos(lat0), -la]);
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 320, H = 180, pad = 14;
  const s = Math.min((W - 2 * pad) / (maxX - minX || 1e-9), (H - 2 * pad) / (maxY - minY || 1e-9));
  const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
  const P = xy.map(([x, y]) => [(x - minX) * s + ox, (y - minY) * s + oy]);
  const d = P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  const a = P[0], b = P[P.length - 1];
  return `<svg class="rn-route" viewBox="0 0 ${W} ${H}" role="img" aria-label="Route">
    <path d="${d}" class="rn-route-halo"/><path d="${d}" class="rn-route-line"/>
    <circle cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="5" class="rn-route-end"/>
    <circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="5" class="rn-route-start"/>
  </svg>`;
}

// ---------- detail screen ----------
const MAIN_EFFORTS = ['400m', '1/2 mile', '1k', '1 mile', '2 mile', '5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon'];

export function openRun(run, ctx) {
  push((el) => {
    const cls = ctx.classOf(run);
    const fb = C.runFeedback(run, ctx);
    const p = C.paceOf(run);
    const splits = (run.splits || []).filter((s) => s.d > 0 && s.s > 0);
    const laps = (run.laps || []).filter((l) => l.d > 0 && l.s > 0);
    const lapsUseful = laps.length > 1 && !laps.every((l) => Math.abs(l.d - 1000) < 30 || l === laps[laps.length - 1]);
    const efforts = (run.best_efforts || []).filter((e) => MAIN_EFFORTS.includes(e.name)).sort((a, b) => a.distance - b.distance);
    const repSet = new Set();
    if (cls.type === 'intervals') {
      const cut = ctx.paces ? Math.min(C.median(laps.map((l) => l.s / (l.d / 1000))) * 0.95, ctx.paces.marathon + 5) : null;
      laps.forEach((l, i) => { if (cut && l.s / (l.d / 1000) <= cut) repSet.add(i); });
    }
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${esc(l)}</span></div>`;
    const stats = [
      stat(`${C.km(run.distance_m).toFixed(2)}<small> km</small>`, 'Distance'),
      stat(C.fmtTime(run.moving_s), 'Moving time'),
      stat(`${C.fmtPace(p)}<small>/km</small>`, 'Avg pace'),
      run.avg_hr ? stat(`${Math.round(run.avg_hr)}<small> bpm</small>`, 'Avg heart rate') : '',
      run.max_hr ? stat(`${Math.round(run.max_hr)}<small> bpm</small>`, 'Max heart rate') : '',
      run.elev_m != null ? stat(`${Math.round(run.elev_m)}<small> m</small>`, 'Elevation') : '',
      run.avg_cadence ? stat(`${Math.round(run.avg_cadence)}`, 'Cadence (spm)') : '',
      run.suffer ? stat(`${Math.round(run.suffer)}`, 'Relative effort') : '',
      run.calories ? stat(`${Math.round(run.calories)}`, 'Calories') : '',
    ].join('');

    el.innerHTML = page({
      title: run.name || 'Run',
      sub: esc(`${niceDate(run.start, { weekday: true, year: new Date(run.start).getFullYear() !== new Date().getFullYear() })} · ${niceTime(run.start)}`),
      body: `
        <div class="rn-detail-tags">${typePill(cls.type)}${run.trainer ? '<span class="pill">Treadmill</span>' : ''}${run.sport === 'TrailRun' ? '<span class="pill">Trail</span>' : ''}
          ${efforts.filter((e) => Number(e.pr_rank) === 1).map((e) => `<span class="pill gold">${icon('trophy')}${esc(e.name)} PR</span>`).join('')}</div>
        <div class="stats rn-dstats">${stats}</div>
        ${fb.length ? `<div class="card rn-coach"><div class="card-head"><h2>Coach</h2></div>${feedbackHtml(fb)}</div>` : ''}
        ${run.detail === false ? '<p class="card flat small muted">Splits and laps are still loading from Strava — they appear after the next sync.</p>' : ''}
        ${run.polyline ? `<div class="card rn-route-card">${routeSvg(run.polyline)}</div>` : ''}
        ${splits.length >= 2 ? `<div class="card"><div class="card-head"><h2>Splits</h2><span class="tiny muted rn-legend"><i class="rn-lg-pace"></i>pace${splits.some((s) => s.hr) ? '<i class="rn-lg-hr"></i>heart rate' : ''}</span></div>
          <div class="chart-box"><canvas id="rn-splits"></canvas></div>
          <table class="rn-table"><thead><tr><th>Km</th><th>Pace</th><th>HR</th><th>Elev</th></tr></thead><tbody>
          ${splits.map((s) => `<tr><td>${s.d < 950 ? C.kmShort(Math.round(s.d / 10) / 100) : s.km}</td><td><b>${C.fmtPace(s.s / (s.d / 1000))}</b></td><td>${s.hr ? Math.round(s.hr) : '–'}</td><td>${s.elev != null ? `${s.elev > 0 ? '+' : ''}${Math.round(s.elev)} m` : '–'}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
        ${lapsUseful ? `<div class="card"><div class="card-head"><h2>Laps</h2>${repSet.size ? `<span class="tiny muted">${repSet.size} fast reps highlighted</span>` : ''}</div>
          <table class="rn-table"><thead><tr><th>#</th><th>Dist</th><th>Time</th><th>Pace</th><th>HR</th></tr></thead><tbody>
          ${laps.map((l, i) => `<tr class="${repSet.has(i) ? 'rn-rep' : ''}"><td>${i + 1}</td><td>${l.d >= 1000 ? `${C.kmShort(Math.round(l.d / 10) / 100)} km` : `${Math.round(l.d)} m`}</td><td>${C.fmtTime(l.s)}</td><td><b>${C.fmtPace(l.s / (l.d / 1000))}</b></td><td>${l.hr ? Math.round(l.hr) : '–'}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
        ${efforts.length ? `<div class="card"><div class="card-head"><h2>Best efforts</h2></div>
          <table class="rn-table"><tbody>${efforts.map((e) => `<tr><td>${esc(e.name)}</td><td><b>${C.fmtTime(e.s)}</b></td><td class="muted">${C.fmtPace(e.s / (e.distance / 1000))}/km</td><td>${Number(e.pr_rank) === 1 ? '<span class="pill gold">PR</span>' : Number(e.pr_rank) === 2 ? '<span class="pill">2nd</span>' : Number(e.pr_rank) === 3 ? '<span class="pill">3rd</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${run.description ? `<div class="card flat small">${esc(run.description)}</div>` : ''}
        ${run.strava_id && !run.demo ? `<a class="rn-strava-link" href="https://www.strava.com/activities/${encodeURIComponent(run.strava_id)}" target="_blank" rel="noopener">View on Strava</a>` : ''}
      `,
    });
    if (splits.length >= 2) drawSplits($('#rn-splits', el), splits);
  });
}

function drawSplits(canvas, splits) {
  const paces = splits.map((s) => s.s / (s.d / 1000));
  const fast = Math.min(...paces), slow = Math.max(...paces);
  const lo = Math.floor((fast - 10) / 30) * 30, hi = Math.ceil((slow + 10) / 30) * 30;
  const run = cssVar('--run');
  const hasHr = splits.some((s) => s.hr);
  const hrs = splits.map((s) => s.hr || null);
  chart(canvas, {
    type: 'bar',
    data: {
      labels: splits.map((s) => (s.d < 950 ? C.kmShort(Math.round(s.d / 10) / 100) : String(s.km))),
      datasets: [
        { type: 'bar', data: paces, base: hi, backgroundColor: paces.map((p) => (p === fast ? run : `${run}99`)), borderRadius: 5, yAxisID: 'y', order: 2 },
        ...(hasHr ? [{ type: 'line', data: hrs, borderColor: cssVar('--down'), backgroundColor: cssVar('--down'), pointRadius: 0, borderWidth: 2, tension: 0.35, yAxisID: 'hr', order: 1, spanGaps: true }] : []),
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 6 } },
        y: { reverse: true, min: lo, max: hi, ticks: { callback: (v) => C.fmtPace(v), stepSize: 30, maxTicksLimit: 6 } },
        ...(hasHr ? { hr: { position: 'right', grid: { display: false }, min: Math.floor((Math.min(...hrs.filter(Boolean)) - 25) / 10) * 10, max: Math.ceil((Math.max(...hrs.filter(Boolean)) + 5) / 10) * 10, ticks: { maxTicksLimit: 4 } } } : {}),
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (it) => `Km ${it[0].label}`,
            label: (it) => (it.dataset.yAxisID === 'hr' ? ` ${Math.round(it.raw)} bpm` : ` ${C.fmtPace(it.raw)}/km`),
          },
        },
      },
    },
  });
}

// ---------- all runs ----------
export function openAllRuns(ctx) {
  push((el) => {
    const groups = new Map();
    for (const r of ctx.runs) {
      const d = new Date(r.start);
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (!groups.has(k)) groups.set(k, { label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), runs: [], m: 0 });
      const g = groups.get(k);
      g.runs.push(r);
      g.m += Number(r.distance_m) || 0;
    }
    el.innerHTML = page({
      title: 'All runs',
      sub: `${ctx.runs.length} runs`,
      body: [...groups.values()].map((g) => `
        <div class="row between rn-month"><h3 class="section-title">${esc(g.label)}</h3><span class="small muted">${g.runs.length} runs · ${C.kmShort(Math.round(g.m / 100) / 10)} km</span></div>
        <div class="card rn-list">${g.runs.map((r) => runRow(r, ctx, { showDate: 'date' })).join('')}</div>`).join(''),
    });
    wireRows(el, ctx, (id) => ctx.runs.find((r) => r.id === id));
  });
}
