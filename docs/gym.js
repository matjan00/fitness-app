// Gym tracker: the Gym tab (routines, history, progress, exercise library), the Home card,
// the "workout in progress" banner, gym settings and the workout detail page.
//   gym-calc.js      pure logic (PRs, stats, previous sets…) – tested in tests/gym.test.js
//   gym-data.js      exercise library + cached reads of workouts/routines + settings
//   gym-lib.js       exercise library/picker, exercise detail, custom exercises
//   gym-workout.js   active workout screen, rest timer, finish summary, editing past workouts
//   gym-routines.js  routine editor + starter programs
import { $, esc, icon, toast, local, mins, bigKg, niceDate, niceTime, relDay, clock } from './util.js';
import * as store from './store.js';
import { push, page, chooseSheet, confirmSheet } from './nav.js';
import { chart, cssVar } from './charts.js';
import {
  MUSCLE_GROUPS, workoutVolume, workoutDuration, bestSet, formatSet, weeklySeries, muscleSets, weekStreak, weekKey,
  isWorking, e1rm, fmtNum,
} from './gym-calc.js';
import {
  loadDb, exName, groupsOf, workouts, routines, prsOf, settings, saveSettings, refreshTab, routineLastUsed,
} from './gym-data.js';
import { mountLibrary, openExercise, thumb, handleImgErrors, setLabels, prListHtml } from './gym-lib.js';
import { initWorkout, startWorkout, openActive, activeWorkout, editWorkout, setWake } from './gym-workout.js';
import { editRoutine, routineMenu, addStarters, saveWorkoutAsRoutine } from './gym-routines.js';

export function init() {
  initWorkout();
  loadDb().then(refreshTab).catch((e) => console.warn(e));
}

const elapsed = (a) => clock((Date.now() - Date.parse(a.started_at)) / 1000);
const setsIn = (w) => w.exercises.reduce((n, e) => n + e.sets.length, 0);

// ---------- tab ----------
const SEGS = [['routines', 'Routines'], ['history', 'History'], ['progress', 'Progress'], ['exercises', 'Exercises']];
let seg = local.get('gym.seg', 'routines');
const libState = { q: '', g: 'All', eq: '' };
let historyLimit = 30;

export const tab = { id: 'gym', title: 'Gym', icon: 'gym', render };

function render(el) {
  if (!SEGS.some(([k]) => k === seg)) seg = 'routines';
  const a = activeWorkout();
  el.innerHTML = `<div class="page-head"><h1>Gym</h1></div>
    <button class="primary block gx-start ${a ? 'gx-resume' : ''}">${icon(a ? 'play' : 'plus')} ${a ? `Resume workout · <span data-gx-elapsed>${elapsed(a)}</span>` : 'Start empty workout'}</button>
    <div class="seg gx-seg">${SEGS.map(([k, v]) => `<button data-s="${k}" class="${seg === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="gx-segbody"></div>`;
  handleImgErrors(el);
  $('.gx-start', el).onclick = () => (activeWorkout() ? openActive() : startWorkout());
  $('.gx-seg', el).onclick = (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.dataset.s === seg) return;
    seg = b.dataset.s;
    local.set('gym.seg', seg);
    render(el);
  };
  const body = $('.gx-segbody', el);
  ({ routines: renderRoutines, history: renderHistory, progress: renderProgress, exercises: renderExercises })[seg](body);
}

// ---------- routines ----------
function renderRoutines(el) {
  const rs = routines();
  if (!rs.length) {
    el.innerHTML = `<div class="card empty gx-empty">${icon('folder')}
      <p><b>No routines yet</b><br>Routines are saved workouts you can start with one tap.</p>
      <div class="stack-sm" style="margin-top:14px">
        <button class="primary gx-starters">${icon('plus')} Add starter programs</button>
        <button class="ghost gx-newr">Create my own routine</button>
      </div></div>`;
    $('.gx-starters', el).onclick = addStarters;
    $('.gx-newr', el).onclick = () => editRoutine();
    return;
  }
  const groups = new Map();
  for (const r of rs) {
    const p = (r.program || '').trim();
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  el.innerHTML = `<div class="gx-rtools"><button class="soft gx-newr">${icon('plus')} New routine</button>
      <button class="ghost gx-starters">${icon('folder')} Starter programs</button></div>
    ${keys.map((k) => `<h3 class="section-title gx-prog">${icon(k ? 'folder' : 'list')} <span class="grow ellipsis">${esc(k || (keys.length > 1 ? 'Other routines' : 'My routines'))}</span><span class="gx-count">${groups.get(k).length}</span></h3>
      <div class="stack">${groups.get(k).map(routineCard).join('')}</div>`).join('')}`;
  $('.gx-newr', el).onclick = () => editRoutine();
  $('.gx-starters', el).onclick = addStarters;
  el.onclick = (e) => {
    const card = e.target.closest('[data-r]');
    if (!card) return;
    const r = store.get(card.dataset.r);
    if (!r) return;
    if (e.target.closest('.gx-rgo')) startWorkout(r);
    else if (e.target.closest('.gx-rmenu')) routineMenu(r);
    else editRoutine(r);
  };
}

function routineCard(r) {
  const ex = r.exercises || [];
  const lastUsed = routineLastUsed(r.id);
  const sets = ex.reduce((a, x) => a + (Number(x.sets) || 0), 0);
  return `<div class="card gx-rcard" data-r="${esc(r.id)}">
    <div class="row between"><div class="grow"><h2 class="ellipsis">${esc(r.name)}</h2>
      <p class="tiny muted">${ex.length} exercise${ex.length === 1 ? '' : 's'} · ${sets} sets${lastUsed ? ` · last ${esc(relDay(lastUsed).toLowerCase())}` : ''}</p></div>
      <button class="icon-btn gx-rmenu" aria-label="Routine options">${icon('more')}</button></div>
    <p class="small muted gx-rsum">${ex.map((x) => esc(exName(x.exercise_id))).join(' · ') || 'No exercises'}</p>
    <button class="primary gx-rgo">${icon('play')} Start</button>
  </div>`;
}

// ---------- history ----------
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const monthOf = (d) => { d = new Date(d); return `${d.getFullYear()}-${d.getMonth()}`; };
const monthLabel = (d) => monthFmt.format(new Date(d));
function renderHistory(el) {
  const ws = workouts();
  if (!ws.length) {
    el.innerHTML = `<div class="card empty gx-empty">${icon('list')}<p><b>No workouts yet</b><br>Finished workouts show up here.</p></div>`;
    return;
  }
  const perMonth = new Map();
  for (const w of ws) { const m = monthOf(w.started_at); perMonth.set(m, (perMonth.get(m) || 0) + 1); }
  let html = '';
  let month = '';
  for (const w of ws.slice(0, historyLimit)) {
    const m = monthOf(w.started_at);
    if (m !== month) {
      const n = perMonth.get(m);
      html += `<h3 class="section-title gx-month"><span class="grow">${esc(monthLabel(w.started_at))}</span><span class="gx-count">${n} workout${n === 1 ? '' : 's'}</span></h3>`;
      month = m;
    }
    html += workoutCard(w);
  }
  if (ws.length > historyLimit) html += `<button class="ghost block gx-more" style="margin-top:12px">Show more (${ws.length - historyLimit})</button>`;
  el.innerHTML = `<div class="stack gx-hist">${html}</div>`;
  el.onclick = (e) => {
    if (e.target.closest('.gx-more')) { historyLimit += 30; renderHistory(el); return; }
    const c = e.target.closest('[data-w]');
    if (c) openWorkout(c.dataset.w);
  };
}

function workoutCard(w) {
  const prs = prsOf(w.id);
  const shown = w.exercises.slice(0, 6);
  return `<button class="card gx-wcard" data-w="${esc(w.id)}">
    <div class="row between"><div class="grow"><h2 class="ellipsis">${esc(w.name || 'Workout')}</h2>
      <p class="tiny muted">${esc(relDay(w.started_at))} · ${esc(niceTime(w.started_at))}</p></div>
      ${prs.length ? `<span class="pill gold">${icon('trophy')} ${prs.length} PR${prs.length > 1 ? 's' : ''}</span>` : ''}</div>
    <div class="gx-wstats"><span>${icon('timer')} ${mins(workoutDuration(w))}</span><span>${icon('gym')} ${bigKg(workoutVolume(w))}</span><span>${icon('list')} ${setsIn(w)} sets</span></div>
    <div class="gx-wex">${shown.map((e) => {
      const b = bestSet(e);
      return `<div class="gx-wexr"><span class="grow ellipsis">${e.sets.length} × ${esc(exName(e.exercise_id, e.name))}</span><span class="muted">${esc(formatSet(b, e.mode, true))}</span></div>`;
    }).join('')}${w.exercises.length > shown.length ? `<p class="tiny muted">+${w.exercises.length - shown.length} more</p>` : ''}</div>
  </button>`;
}

// ---------- workout detail ----------
export function openWorkout(id) {
  push((el, s) => {
    const w = store.get(id);
    if (!w) {
      // Deleted (e.g. from the edit screen on top): close this page too.
      el.innerHTML = page({ title: 'Workout', body: '<div class="card empty">This workout was deleted.</div>' });
      setTimeout(() => s.close(), 0);
      return;
    }
    handleImgErrors(el);
    const prs = prsOf(w.id);
    const prSet = new Set(prs.map((p) => `${p.ei}:${p.si}`));
    el.innerHTML = page({
      title: w.name || 'Workout',
      sub: esc(`${niceDate(w.started_at, { weekday: true, year: true })} · ${niceTime(w.started_at)}`),
      right: `<button class="icon-btn gx-wmenu" aria-label="Workout options">${icon('more')}</button>`,
      body: `<div class="stats gx-dstats">
          <div class="stat"><b>${mins(workoutDuration(w))}</b><span>Duration</span></div>
          <div class="stat"><b>${bigKg(workoutVolume(w))}</b><span>Volume</span></div>
          <div class="stat"><b>${setsIn(w)}</b><span>Sets</span></div>
          <div class="stat"><b>${prs.length}</b><span>PRs</span></div>
        </div>
        ${w.notes ? `<div class="card gx-notecard">${icon('note')}<p>${esc(w.notes)}</p></div>` : ''}
        ${prs.length ? `<h3 class="section-title">Records</h3>${prListHtml(prs)}` : ''}
        <h3 class="section-title">Exercises</h3>
        <div class="stack">${w.exercises.map((e, ei) => {
          const labels = setLabels(e.sets);
          return `<div class="card gx-dex"><button class="gx-exname" data-x="${esc(e.exercise_id)}">${thumb(e.exercise_id, 'sm')}<span class="ellipsis">${esc(exName(e.exercise_id, e.name))}</span></button>
            ${e.note ? `<p class="small muted gx-note-view">${esc(e.note)}</p>` : ''}
            <div class="gx-dsets"><div class="gx-dhead"><span>SET</span><span>${e.mode === 't' ? 'TIME' : e.mode === 'bw' ? 'REPS' : 'WEIGHT × REPS'}</span><span>${e.mode === 'wr' ? 'EST. 1RM' : ''}</span></div>
            ${e.sets.map((st, si) => {
              const one = e.mode === 'wr' && isWorking(st) ? e1rm(st.kg, st.reps) : null;
              return `<div class="gx-drow"><span class="gx-tag t-${st.type}">${labels[si]}</span><span>${esc(formatSet(st, e.mode, true))}${prSet.has(`${ei}:${si}`) ? ` <span class="gx-tro">${icon('trophy')}</span>` : ''}</span><span class="muted">${one ? fmtNum(one) : ''}</span></div>`;
            }).join('')}</div></div>`;
        }).join('')}</div>`,
    });
    el.onclick = async (e) => {
      const x = e.target.closest('[data-x]');
      if (x) { openExercise(x.dataset.x); return; }
      if (!e.target.closest('.gx-wmenu')) return;
      const v = await chooseSheet(w.name || 'Workout', [
        { value: 'edit', label: 'Edit workout', icon: 'edit' },
        { value: 'routine', label: 'Save as routine', icon: 'folder' },
        { value: 'again', label: 'Repeat this workout', icon: 'play' },
        { value: 'del', label: 'Delete workout', icon: 'trash', danger: true },
      ]);
      if (v === 'edit') editWorkout(w);
      else if (v === 'routine') saveWorkoutAsRoutine(w);
      else if (v === 'again') {
        startWorkout({ id: store.get(w.routine_id) ? w.routine_id : null, name: w.name, exercises: w.exercises.map((ex) => ({ exercise_id: ex.exercise_id, sets: ex.sets.length, reps: '', kg: null, rest: ex.rest })) });
      } else if (v === 'del') {
        if (await confirmSheet('Delete this workout permanently?', { ok: 'Delete', danger: true })) {
          await store.remove(w.id);
          toast('Workout deleted');
          s.close();
        }
      }
    };
  });
}

// ---------- progress ----------
function renderProgress(el) {
  const ws = workouts();
  if (!ws.length) {
    el.innerHTML = `<div class="card empty gx-empty">${icon('chart')}<p><b>Nothing to show yet</b><br>Your charts fill up as you log workouts.</p></div>`;
    return;
  }
  const weeks = weeklySeries(ws, 12);
  const thisWeek = weeks[weeks.length - 1];
  const totalVol = ws.reduce((a, w) => a + workoutVolume(w), 0);
  const totalTime = ws.reduce((a, w) => a + workoutDuration(w), 0);
  const ms = muscleSets(ws, groupsOf, Date.now() - 7 * 864e5);
  const maxSets = Math.max(24, ...Object.values(ms));
  const pct = (n) => (n / maxSets) * 100;
  el.innerHTML = `
    <div class="stats gx-pstats">
      <div class="stat"><b>${thisWeek.count}</b><span>This week</span></div>
      <div class="stat"><b>${weekStreak(ws)}</b><span>Week streak</span></div>
      <div class="stat"><b>${ws.length}</b><span>Workouts</span></div>
      <div class="stat"><b>${bigKg(totalVol)}</b><span>Total volume</span></div>
      <div class="stat"><b>${mins(totalTime)}</b><span>Total time</span></div>
      <div class="stat"><b>${ws.reduce((a, w) => a + prsOf(w.id).length, 0)}</b><span>Records</span></div>
    </div>
    <h3 class="section-title">Workouts per week</h3>
    <div class="card"><div class="chart-box short"><canvas class="gx-c1"></canvas></div></div>
    <h3 class="section-title">Weekly volume</h3>
    <div class="card"><div class="chart-box"><canvas class="gx-c2"></canvas></div></div>
    <h3 class="section-title">Sets per muscle · last 7 days</h3>
    <div class="card gx-muscles">
      <p class="tiny muted gx-mhint"><span class="gx-mkey"></span> Aim for about <b>10–20 working sets per muscle each week</b> to keep growing.</p>
      ${MUSCLE_GROUPS.map((g) => {
        const n = ms[g] || 0;
        const cls = n >= 10 && n <= 20 ? 'ok' : n > 20 ? 'hi' : n > 0 ? 'lo' : '';
        return `<div class="gx-mrow"><span class="gx-mname">${g}</span>
          <div class="gx-mtrack"><div class="gx-mband" style="left:${pct(10)}%;width:${pct(10)}%"></div>
          <div class="gx-mfill ${cls}" style="width:${pct(n)}%"></div></div><b class="gx-mn">${n}</b></div>`;
      }).join('')}
    </div>`;
  const labels = weeks.map((w) => new Date(`${w.week}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  const color = cssVar('--gym') || '#f2542d';
  const bg = weeks.map((_, i) => (i === weeks.length - 1 ? color : `${color}88`));
  const opts = (tick, label) => ({
    scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 4, precision: 0, callback: tick } } },
    plugins: { tooltip: { callbacks: { title: (c) => `Week of ${c[0].label}`, label } } },
  });
  chart($('.gx-c1', el), {
    type: 'bar',
    data: { labels, datasets: [{ data: weeks.map((w) => w.count), backgroundColor: bg, borderRadius: 6, maxBarThickness: 22 }] },
    options: opts(undefined, (c) => `${c.parsed.y} workout${c.parsed.y === 1 ? '' : 's'}`),
  });
  chart($('.gx-c2', el), {
    type: 'bar',
    data: { labels, datasets: [{ data: weeks.map((w) => Math.round(w.volume)), backgroundColor: bg, borderRadius: 6, maxBarThickness: 22 }] },
    options: opts((v) => (v >= 1000 ? `${v / 1000}t` : v), (c) => `${Math.round(c.parsed.y).toLocaleString('en-GB')} kg`),
  });
}

// ---------- exercises ----------
function renderExercises(el) {
  el.innerHTML = '<div class="gx-libwrap"></div>';
  mountLibrary($('.gx-libwrap', el), { mode: 'browse', state: libState });
}

// ---------- home card ----------
export const homeCard = {
  order: 10,
  render(el) {
    const ws = workouts();
    const wk = weekKey(Date.now());
    const week = ws.filter((w) => weekKey(w.started_at) === wk);
    const lastW = ws[0];
    const a = activeWorkout();
    const used = (r) => Date.parse(routineLastUsed(r.id) || '') || 0;
    const rs = [...routines()].sort((x, y) => used(y) - used(x)).slice(0, 3);
    const lastPrs = lastW ? prsOf(lastW.id).length : 0;
    el.innerHTML = `<div class="card gx-home">
      <div class="card-head"><h2 class="gx-hh">${icon('gym')} Gym <span class="gx-hsub">this week</span></h2><button class="link gx-open">See all</button></div>
      <div class="stats gx-hstats">
        <div class="stat"><b>${week.length}</b><span>Workout${week.length === 1 ? '' : 's'}</span></div>
        <div class="stat"><b>${bigKg(week.reduce((s, w) => s + workoutVolume(w), 0))}</b><span>Volume</span></div>
        <div class="stat"><b>${mins(week.reduce((s, w) => s + workoutDuration(w), 0))}</b><span>Time</span></div>
      </div>
      ${lastW ? `<button class="gx-last" data-w="${esc(lastW.id)}"><span class="grow"><span class="tiny muted">Last workout</span>
          <b class="ellipsis">${esc(lastW.name || 'Workout')}</b><span class="small muted">${esc(relDay(lastW.started_at))} · ${mins(workoutDuration(lastW))} · ${bigKg(workoutVolume(lastW))}${lastPrs ? ` · ${lastPrs} PR${lastPrs > 1 ? 's' : ''}` : ''}</span></span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>` : ''}
      <button class="primary block gx-hstart">${icon(a ? 'play' : 'plus')} ${a ? `Resume workout · <span data-gx-elapsed>${elapsed(a)}</span>` : 'Start workout'}</button>
      ${!a && rs.length ? `<div class="chips gx-quick">${rs.map((r) => `<button class="chip" data-r="${esc(r.id)}">${icon('play')} ${esc(r.name)}</button>`).join('')}</div>` : ''}
    </div>`;
    $('.gx-open', el).onclick = () => window.showTab?.('gym');
    $('.gx-hstart', el).onclick = () => (activeWorkout() ? openActive() : startWorkout());
    const lw = $('.gx-last', el);
    if (lw) lw.onclick = () => openWorkout(lw.dataset.w);
    const q = $('.gx-quick', el);
    if (q) q.onclick = (e) => { const b = e.target.closest('[data-r]'); const r = b && store.get(b.dataset.r); if (r) startWorkout(r); };
  },
};

// ---------- banner above the tab bar ----------
export function banner(el) {
  const a = activeWorkout();
  if (!a) return false;
  el.innerHTML = `<button class="gx-banner"><span class="gx-bdot"></span>
    <span class="grow gx-btxt"><b class="ellipsis">${esc(a.name || 'Workout')}</b><span class="tiny">In progress · <span data-gx-elapsed>${elapsed(a)}</span><span data-gx-restwrap hidden> · Rest <span data-gx-rest></span></span></span></span>
    <span class="gx-bgo">Resume</span></button>`;
  $('.gx-banner', el).onclick = () => openActive();
  return true;
}

// ---------- settings (Me tab) ----------
export const meSection = {
  order: 10,
  render(el) {
    const s = settings();
    el.innerHTML = `<h3 class="section-title">Gym</h3><div class="card stack gx-set">
      <label class="switch">Default rest timer<select class="gx-srest">${[30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((r) => `<option value="${r}" ${Number(s.rest) === r ? 'selected' : ''}>${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}</option>`).join('')}</select></label>
      <label class="switch">Sound when rest is over<input type="checkbox" class="gx-ssound" ${s.sound ? 'checked' : ''}></label>
      <label class="switch">Keep screen on during workouts<input type="checkbox" class="gx-swake" ${s.wake ? 'checked' : ''}></label>
    </div>`;
    $('.gx-srest', el).onchange = (e) => saveSettings({ rest: Number(e.target.value) }).then(() => toast('Default rest saved'));
    $('.gx-ssound', el).onchange = (e) => saveSettings({ sound: e.target.checked });
    $('.gx-swake', el).onchange = async (e) => { await saveSettings({ wake: e.target.checked }); setWake(e.target.checked); };
  },
};
