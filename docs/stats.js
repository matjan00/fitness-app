// Stats tab, one page: the numbers that matter on a cut at the top (trend, rate of loss, maintenance, protein, this
// week vs last), then charts over 7 d / 30 d / 90 d / 1 y: calories, maintenance vs intake, macros, weight (with the
// plan line), weekly plan, running, strength kept, sets per muscle, PRs, training load and habits; the cut plan's
// waist / grades / photos last. Calculations: stats-calc.js (food, weeks) and stats-insights.js (everything new).
import { $, $$, esc, local, today, n0, n1, niceDate, fromDay } from './util.js';
import * as store from './store.js';
import { chart, cssVar, fade, seriesColor, onThemeChange } from './charts.js';
import { targets, allFoodEntries } from './food-ui.js';
import { computePRs, PR_KINDS, formatMetric } from './gym-calc.js';
import { loadDb, exName, groupsOf } from './gym-data.js';
import { runContext } from './run.js';
import { renderProgress } from './cut-progress.js';
import { isSetUp, cutSettings, startWeight } from './cut.js';
import { projectedWeight, daysToGoal, emaTrend, trendOn } from './cut-calc.js';
import { dayFacts, weekTraining } from './cut-day.js';
import { adaptiveTdee } from './cut-flags.js';
import { RANGES, addDays, weekOf, weekList, weeksFor, weeklyNutrition, averageLogged } from './stats-calc.js';
import {
  weightDays, lossRate, goalDate, nutritionDays, proteinSummary, maintenanceWeeks, strengthKept, setsPerMuscle, recentPRs,
  habits, runWeeks, trainingLoad, weekVsLast, weekStory, localDay,
} from './stats-insights.js';

export const tab = { id: 'stats', title: 'Stats', icon: 'stats', render };
export const homeCard = null;

let days = local.get('statsRange', 30);
if (!RANGES.some((r) => r.days === days)) days = 30;

const thisYear = () => new Date().getFullYear();
const shortDay = (d) => niceDate(fromDay(d), { year: fromDay(d).getFullYear() !== thisYear() });
const wkLabel = (w) => (w === weekOf(today()) ? 'This week' : `wk ${shortDay(w)}`);
const signed = (x, d = 1) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

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
const note = (el, id, html) => { const n = $(`#${id}-note`, el); if (n) { n.innerHTML = html; n.hidden = !html; } };

// ---------- data shared by the cards ----------
function gather() {
  const t = today();
  const src = { weights: store.all('bodyweight'), dailies: store.all('daily'), meals: allFoodEntries() };
  const factsOf = (d) => dayFacts(d, src);
  const workouts = store.all('workout').filter((w) => w?.started_at);
  // The Run tab's runs: duplicates (manual + watch, Strava + Garmin) and accidental recordings removed, each with its
  // type (easy / quality) for the easy-pace line.
  let runs = store.all('run').filter((r) => r?.start);
  let runType = null;
  try { const rc = runContext(); if (rc) { runs = rc.runs; runType = (r) => rc.classOf(r).type; } } catch { /* no runs yet */ }
  const cut = isSetUp() ? cutSettings() : null;
  const from = addDays(t, -days + 1);
  // Weekly charts: whole weeks covering the range, without empty weeks before the first data.
  const firstData = [...workouts.map((w) => localDay(w.started_at)), ...runs.map((r) => localDay(r.start)), ...src.meals.map((m) => m.day), ...src.weights.map((w) => w.day)]
    .filter(Boolean).sort()[0];
  let weeks = weekList(t, weeksFor(days));
  if (firstData) { const fw = weekOf(firstData); const trimmed = weeks.filter((w) => w >= fw); weeks = trimmed.length >= 4 ? trimmed : weeks.slice(-4); }
  const tdeeOf = (d) => adaptiveTdee(d, { weights: src.weights, kcalOf: (x) => factsOf(x).kcal });
  const training = (w) => weekTraining(w, { workouts, runs, dailies: src.dailies, through: addDays(w, 6) < t ? addDays(w, 6) : t });
  return { t, src, factsOf, workouts, runs, runType, cut, from, weeks, tdeeOf, training };
}

// ---------- page ----------
let themeHooked = false;
let dbAsked = false;
function render(el) {
  if (!themeHooked) { themeHooked = true; onThemeChange(() => { if (el.isConnected) render(el); }); }
  if (!dbAsked) { dbAsked = true; loadDb().then(() => { if (el.isConnected) render(el); }).catch(() => {}); }
  const g = gather();
  const nothing = !g.src.meals.length && !g.src.weights.length && !g.workouts.length && !g.runs.length && !g.src.dailies.length;
  if (nothing) {
    el.innerHTML = `<div class="page-head"><h1>Stats</h1></div><div class="card empty"><h2>Nothing to show yet</h2>
      <p class="small" style="margin:6px 0 14px">Log food, weigh in, or record a workout or run - your trends, rate of loss and strength appear here.</p>
      <div class="row" style="gap:8px;justify-content:center;flex-wrap:wrap"><button class="primary" data-go="food">Log food</button><button class="soft" data-go="gym">Start a workout</button><button class="soft" data-go="run">Runs</button></div></div>`;
    $$('[data-go]', el).forEach((b) => { b.onclick = () => window.showTab(b.dataset.go); });
    return;
  }
  const span = { 7: '7 days', 30: '30 days', 90: '90 days' }[days] || 'year';
  el.innerHTML = `<div class="page-head"><h1>Stats</h1></div>
    <div class="stack st-cards">
      <div id="st-summary"></div>
      <div id="st-week"></div>
      <div id="st-food"></div>
      <div class="seg st-range" role="group" aria-label="Range for the charts">${RANGES.map((r) => `<button data-days="${r.days}" class="${r.days === days ? 'on' : ''}">${r.label}</button>`).join('')}</div>
      ${chartCard('Calories', 'st-kcal')}
      ${chartCard('Maintenance vs intake', 'st-tdee', 'Weekly. The gap between the lines is your deficit.')}
      ${chartCard('Protein, carbs &amp; fat', 'st-macros')}
      ${chartCard('Body weight', 'st-weight', 'Dots are weigh-ins, the line is the trend (the same one the cut plan uses).')}
      <h3 class="section-title">Training</h3>
      ${chartCard('Weekly plan', 'st-plan', 'Gym sessions and runs per week. Dashed: the goal of 3 gym + 2 runs.')}
      ${chartCard('Running', 'st-run', 'Km per week; the line is the pace of easy runs only (interval, tempo and long runs left out).')}
      <div id="st-strength"></div>
      ${chartCard('Hard sets per muscle', 'st-sets', 'Working sets per week, averaged over the range. Around 10+ a week per muscle keeps it growing; on a cut, holding them is the goal.')}
      <div id="st-prs"></div>
      <div id="st-load"></div>
      <div id="st-habits"></div>
      ${g.cut ? '<h3 class="section-title">Cut plan</h3><div id="st-cut"></div>' : ''}
    </div>
    <p class="tiny muted center" style="margin-top:16px">Charts show the last ${esc(span)}${days < 28 ? '; weekly charts show at least 4 weeks' : ''}.</p>`;
  $$('.st-range button', el).forEach((b) => b.onclick = () => { days = Number(b.dataset.days); local.set('statsRange', days); render(el); });
  for (const f of [drawSummary, drawWeek, drawFoodNumbers, drawFood, drawTdee, drawWeight, drawPlan, drawRun, drawStrength, drawSets, drawPRs, drawLoad, drawHabits]) {
    try { f(el, g); } catch (e) { console.error(e); }
  }
  if (g.cut) { try { renderProgress($('#st-cut', el)); } catch (e) { console.error(e); } }
}

// ---------- summary: trend, rate of loss, goal date ----------
function drawSummary(el, g) {
  const r = lossRate(g.src.weights, g.t);
  if (r.trend == null) { $('#st-summary', el).innerHTML = ''; return; }
  const rate = r.kg4 ?? r.kg2;
  const pct = r.pct;
  let band = '';
  if (pct != null && rate < 0) band = -pct > 1 ? '<span class="st-bad">faster than 1% a week - risk to muscle</span>'
    : -pct >= 0.5 ? '<span class="st-good">in the muscle-safe 0.5-1% range</span>' : '<span class="st-warn">slower than 0.5% a week</span>';
  else if (rate > 0) band = '<span class="st-warn">gaining</span>';
  const goal = g.cut?.goalWeight;
  const eta = goal && rate ? goalDate(r.trend, rate, goal, g.t) : null;
  const planEnd = g.cut ? addDays(g.t, daysToGoal(g.cut.startDate, g.t) ?? 0) : null;
  $('#st-summary', el).innerHTML = `<div class="card st-sum">
    <div class="st-tiles">
      <div class="st-tile"><b>${n1(r.trend)}<small> kg</small></b><span>trend weight</span></div>
      <div class="st-tile"><b>${rate == null ? '–' : `${signed(rate, 2)}<small> kg/wk</small>`}</b><span>${r.kg4 != null ? 'last 4 weeks' : 'last 2 weeks'}</span></div>
      <div class="st-tile"><b>${pct == null ? '–' : `${signed(pct, 2)}<small>%</small>`}</b><span>of body weight a week</span></div>
    </div>
    ${band ? `<p class="small" style="margin-top:8px">Rate: ${band}</p>` : rate == null ? '<p class="small muted" style="margin-top:8px">Rate of loss appears after two weeks of weigh-ins.</p>' : ''}
    ${goal ? `<p class="small" style="margin-top:4px">${eta ? `At this rate you reach <b>${n1(goal)} kg ≈ ${esc(shortDay(eta))}</b>${planEnd ? ` <span class="muted">(plan: ${esc(shortDay(planEnd))})</span>` : ''}` : `Goal ${n1(goal)} kg: not on course at the current rate`}.</p>` : ''}
  </div>`;
}

// ---------- this week vs last week + the story ----------
function drawWeek(el, g) {
  const rows = nutritionDays(g.t, 14, g.factsOf);
  const w = weekVsLast(g.t, { rows, weights: g.src.weights, training: g.training });
  const t = targets();
  const m = g.tdeeOf(g.t);
  const thisWeek = rows.filter((r) => r.day >= weekOf(g.t));
  const pHit = t?.p ? thisWeek.filter((r) => r.logged && r.p >= t.p).length : null;
  const lifts = strengthKept(g.workouts, g.cut?.startDate || addDays(g.t, -56), bodyOn(g));
  const lift = lifts[0] ? { name: exName(lifts[0].id, lifts[0].id), change: lifts[0].change } : null;
  const story = weekStory({ week: w.now, deficit: m && w.now.kcal != null ? m.tdee - w.now.kcal : null, proteinHit: pHit, proteinDays: thisWeek.filter((r) => r.logged).length, lift });
  const d = (label, now, delta, unit, good) => `<div class="st-tile"><b>${now ?? '–'}<small>${unit}</small></b><span>${label}${delta != null ? ` <em class="${good(delta) ? 'st-good' : 'st-warn'}">${signed(delta, 0)}</em>` : ''}</span></div>`;
  $('#st-week', el).innerHTML = `<div class="card"><h2>This week</h2>
    <p class="small" style="margin-top:4px">${esc(story) || 'Nothing logged this week yet.'}</p>
    <div class="st-tiles" style="margin-top:10px">
      ${d('avg kcal vs last wk', w.now.kcal != null ? n0(w.now.kcal) : null, w.delta.kcal, '', (x) => x <= 0)}
      ${d('avg protein vs last wk', w.now.p != null ? n0(w.now.p) : null, w.delta.p, ' g', (x) => x >= 0)}
      <div class="st-tile"><b>${w.now.lift}/${w.now.goal.lift}<small> gym</small> · ${w.now.run}/${w.now.goal.run}<small> run</small></b><span>last week ${w.prev.lift}/${w.prev.goal.lift} · ${w.prev.run}/${w.prev.goal.run}</span></div>
    </div></div>`;
}

// ---------- maintenance, deficit, protein ----------
function drawFoodNumbers(el, g) {
  const rows = nutritionDays(g.t, days, g.factsOf);
  const t = targets();
  const kg = trendOn(emaTrend(g.src.weights), g.t);
  const p = proteinSummary(rows, t?.p, kg);
  const m = g.tdeeOf(g.t);
  const est = g.cut?.maintenance;
  if (!p && !m) { $('#st-food', el).innerHTML = ''; return; }
  $('#st-food', el).innerHTML = `<div class="card"><div class="st-tiles">
    <div class="st-tile"><b>${m ? n0(m.tdee) : '–'}<small> kcal</small></b><span>maintenance${m ? ' (from your data)' : ''}</span></div>
    <div class="st-tile"><b>${m ? `${n0(m.tdee - m.avgKcal)}` : '–'}<small> kcal</small></b><span>${m && m.tdee - m.avgKcal < 0 ? 'surplus' : 'deficit'} a day (3 wk)</span></div>
    <div class="st-tile"><b>${p?.perKg != null ? n1(p.perKg) : p ? n0(p.avg) : '–'}<small>${p?.perKg != null ? ' g/kg' : ' g'}</small></b><span>protein${p ? ` · ${n0(p.avg)} g avg` : ''}</span></div>
  </div>
  <p class="tiny muted" style="margin-top:8px">${m ? `Maintenance is learned from the last 3 weeks: you ate ${n0(m.avgKcal)} kcal a day while the scale moved ${signed(m.perWeek, 2)} kg a week${est ? ` (first estimate was ${n0(est)})` : ''}.` : 'Maintenance appears after 2-3 weeks of logged calories and 8+ weigh-ins.'}
  ${p ? ` Protein target hit on ${p.hit ?? '–'} of ${p.days} logged days${p.perKg != null ? '; 1.6-2.2 g per kg keeps muscle on a cut' : ''}.` : ''}</p></div>`;
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
    // Target / goal lines are explained in the card's note: keep them out of the legend so it stays one short row.
    plugins: { legend: { display: Boolean(extra.legend), labels: { boxWidth: 10, boxHeight: 10, filter: (it) => !/\s(target|goal)$/i.test(it.text) } }, tooltip: { callbacks: extra.tooltip || {} } },
  },
});
const line = (label, data, color, o = {}) => ({ type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, tension: 0.3, ...o });
const target = (label, v, n, color) => ({ type: 'line', label, data: Array(n).fill(v), borderColor: color, backgroundColor: color, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
// The current week is still running: draw its bar lighter so it doesn't read as a slump.
const barColors = (weeks, col) => weeks.map((w) => (w === weekOf(today()) ? `${col}77` : col));

function drawFood(el, g) {
  const daily = nutritionDays(g.t, days, g.factsOf);
  const weekly = days > 90;
  const rows = weekly ? weeklyNutrition(daily) : daily;
  const t = targets();
  const ok = empty(el, 'st-kcal', rows.some((r) => r.logged) ? '' : 'No food logged in this period yet.');
  empty(el, 'st-macros', ok ? '' : 'No food logged in this period yet.');
  if (!ok) return;
  const labels = rows.map((r) => (weekly ? wkLabel(r.day) : shortDay(r.day)));
  const val = (k) => rows.map((r) => (r.logged ? Math.round(r[k]) : null));
  const avg = averageLogged(daily);
  const m = g.tdeeOf(g.t);
  note(el, 'st-kcal', `${weekly ? 'Average per logged day, by week.' : 'Per day.'} ${avg ? `Average ${n0(avg.kcal)} kcal${t ? ` of ${n0(t.kcal)} target` : ''} (${avg.days} day${avg.days === 1 ? '' : 's'} logged).` : ''}`);
  const sets = [{ type: 'bar', label: 'Eaten', data: val('kcal'), backgroundColor: cssVar('--accent'), borderRadius: 4, maxBarThickness: 18 }];
  if (t?.kcal) sets.push(target('Target', t.kcal, rows.length, cssVar('--text-2')));
  if (m) sets.push(target('Maintenance', m.tdee, rows.length, cssVar('--fat')));
  chart('st-kcal', base(labels, sets, { legend: true, tooltip: { label: (c) => `${c.dataset.label}: ${n0(c.parsed.y)} kcal` } }));

  note(el, 'st-macros', `Grams ${weekly ? 'per day, averaged by week' : 'per day'}.${t ? ' Dashed lines are your targets.' : ''} Tap the legend to hide a line.`);
  const mset = [];
  for (const [k, name, v] of [['p', 'Protein', '--protein'], ['c', 'Carbs', '--carbs'], ['f', 'Fat', '--fat']]) {
    const col = cssVar(v);
    mset.push(line(name, val(k), col, { spanGaps: false, pointRadius: rows.length <= 31 ? 2 : 0 }));
    if (t?.[k]) mset.push({ ...target(`${name} target`, t[k], rows.length, col), hidden: false });
  }
  chart('st-macros', base(labels, mset, { legend: true, tooltip: { label: (c) => `${c.dataset.label}: ${n0(c.parsed.y)} g` } }));
}

function drawTdee(el, g) {
  const rows = nutritionDays(g.t, Math.max(days, 28) + 6, g.factsOf);
  const m = maintenanceWeeks(g.weeks, rows, g.tdeeOf, g.t);
  if (!empty(el, 'st-tdee', m.some((x) => x.tdee != null) ? '' : 'Appears once maintenance can be learned (2-3 weeks of calories and weigh-ins).')) return;
  const intake = cssVar('--accent'), tdee = cssVar('--fat');
  chart('st-tdee', base(g.weeks.map(wkLabel), [
    line('Intake', m.map((x) => x.intake), intake, { pointRadius: 2, spanGaps: true, fill: { target: 1, below: `${cssVar('--up')}33`, above: `${cssVar('--down')}33` } }),
    line('Maintenance', m.map((x) => x.tdee), tdee, { pointRadius: 2, spanGaps: true, borderDash: [5, 4] }),
  ], { legend: true, scales: { y: { beginAtZero: false, grace: '10%' } }, tooltip: { label: (c) => `${c.dataset.label}: ${n0(c.parsed.y)} kcal` } }));
}

function drawWeight(el, g) {
  const start = g.cut ? startWeight(g.cut) : null;
  const planOf = (d) => (g.cut && start && d >= g.cut.startDate ? projectedWeight(g.cut, start, d) : null);
  const rows = weightDays(g.src.weights, g.t, days, planOf);
  if (!empty(el, 'st-weight', rows.some((r) => r.kg != null) ? '' : 'No weigh-ins in this period yet.')) return;
  const sets = [
    { type: 'line', label: 'Weigh-in', data: rows.map((r) => r.kg), showLine: false, pointRadius: days > 90 ? 1.5 : 2.5, borderColor: 'transparent', backgroundColor: cssVar('--text-3') },
    line('Trend', rows.map((r) => r.trend), cssVar('--accent'), { borderWidth: 2.5, spanGaps: true }),
  ];
  if (rows.some((r) => r.plan != null)) sets.push(line('Plan', rows.map((r) => r.plan), cssVar('--text-2'), { borderDash: [5, 4], borderWidth: 1.5 }));
  if (g.cut?.goalWeight) sets.push(target('Goal', g.cut.goalWeight, rows.length, cssVar('--gold')));
  chart('st-weight', base(rows.map((r) => shortDay(r.day)), sets, {
    legend: true, scales: { y: { beginAtZero: false, grace: '10%' } },
    tooltip: { label: (c) => (c.parsed.y == null ? null : `${c.dataset.label}: ${n1(c.parsed.y)} kg`) },
  }));
}

function drawPlan(el, g) {
  const rows = g.weeks.map((w) => ({ w, ...g.training(w) }));
  if (!empty(el, 'st-plan', rows.some((r) => r.lift || r.run) ? '' : 'No workouts or runs in this period yet.')) return;
  const gym = cssVar('--accent'), run = cssVar('--up');
  const done = rows.filter((r) => r.w !== weekOf(g.t));
  note(el, 'st-plan', `Gym sessions and runs per week. Dashed: the goal of 3 gym + 2 runs.${done.length ? ` Goal met in ${done.filter((r) => r.lift >= r.goal.lift && r.run >= r.goal.run).length} of ${done.length} full weeks.` : ''}`);
  chart('st-plan', base(g.weeks.map(wkLabel), [
    { type: 'bar', label: 'Gym', data: rows.map((r) => r.lift), backgroundColor: barColors(g.weeks, gym), borderRadius: 4, maxBarThickness: 16 },
    { type: 'bar', label: 'Runs', data: rows.map((r) => r.run), backgroundColor: barColors(g.weeks, run), borderRadius: 4, maxBarThickness: 16 },
    target('Gym goal', 3, rows.length, gym), target('Run goal', 2, rows.length, run),
  ], { legend: true, scales: { y: { beginAtZero: true, suggestedMax: 4, ticks: { precision: 0 } } } }));
}

function drawRun(el, g) {
  const r = runWeeks(g.runs, g.weeks, g.runType);
  if (!empty(el, 'st-run', r.some((w) => w.km > 0) ? '' : 'No runs in this period yet (manual, Strava or Garmin).')) return;
  const col = cssVar('--up');
  chart('st-run', base(g.weeks.map(wkLabel), [
    { type: 'bar', label: 'Km', data: r.map((w) => w.km), backgroundColor: barColors(g.weeks, col), borderRadius: 4, maxBarThickness: 22, yAxisID: 'y' },
    line('Easy pace', r.map((w) => w.pace), cssVar('--text'), { yAxisID: 'y1', pointRadius: 2.5, spanGaps: true }),
  ], {
    legend: true,
    scales: { y1: { position: 'right', reverse: true, grid: { display: false }, ticks: { callback: mmss, maxTicksLimit: 4 } } },
    tooltip: { label: (c) => (c.dataset.yAxisID === 'y1' ? `Easy pace ${mmss(c.parsed.y)} /km` : `${n1(c.parsed.y)} km · ${r[c.dataIndex].min} min · ${r[c.dataIndex].runs} run${r[c.dataIndex].runs === 1 ? '' : 's'}`) },
  }));
}

// Body weight on a day (for pull-ups / dips): the trend, else the last weigh-in.
const bodyOn = (g) => { const tr = emaTrend(g.src.weights); return (d) => trendOn(tr, d); };

function drawStrength(el, g) {
  const since = g.cut?.startDate && g.cut.startDate <= g.t ? g.cut.startDate : g.from;
  const lifts = strengthKept(g.workouts, since, bodyOn(g));
  const box = $('#st-strength', el);
  if (!lifts.length) { box.innerHTML = `<div class="card"><h2>Strength</h2><p class="small muted" style="margin-top:6px">Lifts you train in 2+ sessions ${g.cut ? 'since the cut started' : 'in this period'} show here with their estimated 1-rep max.</p></div>`; return; }
  box.innerHTML = `<div class="card st-card"><h2>Strength ${g.cut ? 'kept on the cut' : ''}</h2>
    <p class="small muted">Estimated 1-rep max, change since ${g.cut ? 'the cut started' : esc(shortDay(since))}. Down more than 5% is a sign to eat a bit more.</p>
    <div class="st-lifts">${lifts.map((l, i) => `<div class="row between st-lift"><span class="row" style="gap:8px"><i class="st-dot" style="background:${seriesColor(i)}"></i>${esc(exName(l.id, l.id))}${l.bw ? ' <span class="tiny muted">(+ body)</span>' : ''}</span>
      <span><b>${n1(l.sessions[l.sessions.length - 1].e1rm)} kg</b> <em class="${l.change < -5 ? 'st-bad' : l.change < 0 ? 'st-warn' : 'st-good'}">${signed(l.change, 1)}%</em></span></div>`).join('')}</div>
    <div class="st-chart"><canvas id="st-lifts"></canvas></div></div>`;
  const dayset = [...new Set(lifts.flatMap((l) => l.sessions.map((s) => s.day)))].sort();
  chart('st-lifts', base(dayset.map(shortDay), lifts.map((l, i) => {
    const m = new Map(l.sessions.map((s) => [s.day, s.e1rm]));
    return line(exName(l.id, l.id), dayset.map((d) => m.get(d) ?? null), seriesColor(i), { spanGaps: true, pointRadius: dayset.length > 24 ? 0 : 2.5, tension: 0.25 });
  }), { scales: { y: { beginAtZero: false, grace: '10%' } }, tooltip: { label: (c) => `${c.dataset.label}: ${n1(c.parsed.y)} kg` } }));
}

function drawSets(el, g) {
  const from = days < 7 ? addDays(g.t, -6) : g.from;
  const m = setsPerMuscle(g.workouts, groupsOf, from, g.t);
  if (!empty(el, 'st-sets', m.length ? '' : 'No gym sessions in this period yet.')) return;
  const h = Math.max(160, m.length * 26 + 30);
  $('#st-sets', el).parentElement.style.height = `${h}px`;
  chart('st-sets', {
    type: 'bar',
    data: { labels: m.map((x) => x.group), datasets: [
      { label: 'Sets a week', data: m.map((x) => x.sets), backgroundColor: m.map((x) => cssVar(x.sets >= 10 ? '--up' : '--accent')), borderRadius: 4, maxBarThickness: 16 },
    ] },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${n1(c.parsed.x)} sets a week` } } },
      scales: { x: { beginAtZero: true, suggestedMax: 12, grid: { color: (c) => (c.tick?.value === 10 ? cssVar('--text-3') : cssVar('--line')) } }, y: { grid: { display: false } } } },
  });
}

function drawPRs(el, g) {
  const prs = recentPRs(g.workouts, computePRs(g.workouts), g.from);
  $('#st-prs', el).innerHTML = `<div class="card"><h2>Personal records</h2>${prs.length ? `<div class="list" style="margin-top:6px">${prs.map((p) => `<div class="list-item" style="cursor:default"><div class="grow"><div class="ellipsis"><b>${esc(exName(p.exercise_id, p.exercise_id))}</b></div>
      <div class="sub">${esc(PR_KINDS[p.kind] || p.kind)}: ${esc(formatMetric(p.kind, p.value))} <span class="muted">(was ${esc(formatMetric(p.kind, p.prev))}${p.n > 1 ? ` · ${p.n} record sessions` : ''})</span></div></div><span class="tiny muted">${esc(shortDay(p.day))}</span></div>`).join('')}</div>`
    : `<p class="small muted" style="margin-top:6px">No new records in this period${g.cut ? ' - on a cut, holding your numbers is a win' : ''}.</p>`}</div>`;
}

function drawLoad(el, g) {
  const l = trainingLoad(g.workouts, g.runs, g.t);
  if (!l) { $('#st-load', el).innerHTML = ''; return; }
  const v = l.ratio > 1.3 ? ['st-warn', 'a lot more than usual - watch for fatigue, sleep and food'] : l.ratio < 0.8 ? ['muted', 'less than usual'] : ['st-good', 'about your usual'];
  $('#st-load', el).innerHTML = `<div class="card"><h2>Training load</h2><div class="st-tiles" style="margin-top:6px">
    <div class="st-tile"><b>${n0(l.last7)}<small> min</small></b><span>last 7 days</span></div>
    <div class="st-tile"><b>${n0(l.usual)}<small> min</small></b><span>usual week (4 before)</span></div>
    <div class="st-tile"><b>×${l.ratio.toFixed(2)}</b><span class="${v[0]}">${v[1]}</span></div></div></div>`;
}

function drawHabits(el, g) {
  const goal = g.cut?.steps || 10000;
  const h = habits(g.t, days, g.factsOf, goal);
  if (!h.stepDays && !h.sleepDays) { $('#st-habits', el).innerHTML = ''; return; }
  $('#st-habits', el).innerHTML = `<div class="card"><h2>Steps &amp; sleep</h2><div class="st-tiles" style="margin-top:6px">
    <div class="st-tile"><b>${h.steps != null ? n0(h.steps) : '–'}</b><span>steps a day · ${goal.toLocaleString('en-GB')}+ on ${h.stepsHit}/${h.stepDays} days</span></div>
    <div class="st-tile"><b>${h.sleep != null ? `${n1(h.sleep)}<small> h</small>` : '–'}</b><span>sleep · 7 h+ on ${h.sleep7}/${h.sleepDays} nights</span></div></div>
    <p class="tiny muted" style="margin-top:8px">More steps is the first lever before eating less.</p></div>`;
}
