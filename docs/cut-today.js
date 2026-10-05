// Cut plan "Today" card at the top of Home: week / phase / days to goal, today's session with a Start button,
// the daily checklist (each value entered in a few seconds), day status, minimum-day button and streaks.

import { $, $$, esc, icon, toast, today, n0, n1, parseNum, addDays, local } from './util.js';
import * as store from './store.js';
import { push, sheet } from './nav.js';
import { startWorkout } from './gym-workout.js';
import { cutSettings, currentTargets, openCutSettings, openPlan, addCutRoutines, startWeight, isSetUp } from './cut.js';
import { ROUTINES, PLAN, PROGRAM_NAME, EASY_PACE, weekNumber, daysToGoal, daysBetween, emaTrend, trendOn, targetWeight } from './cut-calc.js';
import { redFlags, rescheduleLifts, isLogged } from './cut-flags.js';
import { reviewNeeded, openReview, dueCheckin, checkinFor } from './cut-review.js';
import { nextLift, sessionFor, sessionDone, dayFacts, dayStatus, streak, weekStreak, minimumDaysInWeek, SESSION_LABEL } from './cut-day.js';

const STATUS = { green: ['Green day', 'up'], yellow: ['Yellow day', 'gold'], red: ['Red day', 'down'], open: ['In progress', ''] };

// ---------- data ----------
const routineCut = (id) => store.get(id)?.cut || null;
export function sources() {
  return {
    weights: store.all('bodyweight'), dailies: store.all('daily'), meals: store.all('meal'),
    workouts: store.all('workout'), runs: store.all('run'), checkins: store.all('checkin'), routineCut,
  };
}
const dayName = (d) => (d === today() ? 'today' : d === addDays(today(), 1) ? 'tomorrow' : new Date(`${d}T12:00`).toLocaleDateString('en-GB', { weekday: 'long' }));
export const currentFlags = (c = cutSettings()) => redFlags(today(), sources(), c, startWeight(c));
export async function saveDaily(day, patch) {
  const cur = store.all('daily').find((d) => d.day === day);
  await store.put('daily', { ...(cur || {}), ...patch, day });
}
async function saveWeight(day, kg) {
  const cur = store.all('bodyweight').find((e) => e.day === day);
  await store.put('bodyweight', { ...(cur ? { id: cur.id } : {}), day, kg: Math.round(kg * 100) / 100 });
}

// Status of any day (shared with streaks and, later, the weekly review).
export function statusOf(day, src = sources(), cfg = cutSettings(), kcalTarget = currentTargets(cfg).kcal) {
  const f = dayFacts(day, src);
  const session = sessionFor(day, { workouts: src.workouts, routineCut });
  const done = sessionDone(session.kind, day, src);
  const target = kcalTarget && session.kind === 'lift' ? kcalTarget + (+cfg.liftDayBonus || 0) : kcalTarget;
  return { facts: f, session, done, ...dayStatus(f, { kcalTarget: target, cfg, session, done, isToday: day === today() }) };
}

// ---------- quick entry sheets ----------
// fields: [{ name, label, value, mode }]; onSave(values) gets numbers (or null for empty fields).
function entrySheet(title, fields, onSave) {
  push((el, s) => {
    el.innerHTML = sheet({ title, body: `<form class="form ct-entry">
      <div class="form-row">${fields.map((f) => `<label>${esc(f.label)}<input name="${f.name}" inputmode="${f.mode || 'decimal'}" value="${esc(f.value ?? '')}" autocomplete="off"></label>`).join('')}</div>
      <div class="sheet-actions" style="margin-top:14px"><button type="button" class="ghost" data-a="no">Cancel</button><button type="submit" class="primary">Save</button></div></form>` });
    const form = $('form', el);
    setTimeout(() => form.elements[0]?.focus(), 250);
    $('[data-a=no]', el).onclick = () => s.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(fields.map((f) => [f.name, parseNum(form.elements[f.name].value)]));
      if ((await onSave(v)) === false) return;
      s.close();
    };
  }, { sheet: true });
}

function editItem(key, day, f) {
  const daily = (patch) => saveDaily(day, patch);
  if (key === 'weight') {
    return entrySheet('Morning weight', [{ name: 'kg', label: 'Weight (kg)', value: f.weight }], async (v) => {
      if (!(v.kg > 20 && v.kg < 400)) { toast('Enter your weight in kg'); return false; }
      await saveWeight(day, v.kg);
    });
  }
  if (key === 'sleep') {
    return entrySheet('Sleep last night', [{ name: 'h', label: 'Hours', value: f.sleep }], async (v) => {
      if (v.h != null && !(v.h >= 0 && v.h <= 16)) { toast('Enter hours, e.g. 7.5'); return false; }
      await daily({ sleepHours: v.h });
    });
  }
  if (key === 'steps') {
    return entrySheet('Steps', [{ name: 'n', label: 'Steps', value: f.steps, mode: 'numeric' }], async (v) => {
      await daily({ steps: v.n == null ? null : Math.round(v.n) });
    });
  }
  // food: day totals from the separate food app (empty = use the Food tab diary)
  return entrySheet('Food totals', [
    { name: 'kcal', label: 'kcal', value: f.kcal, mode: 'numeric' }, { name: 'p', label: 'Protein', value: f.p, mode: 'numeric' },
    { name: 'c', label: 'Carbs', value: f.c, mode: 'numeric' }, { name: 'f', label: 'Fat', value: f.f, mode: 'numeric' },
  ], async (v) => { await daily({ kcal: v.kcal, p: v.p, c: v.c, f: v.f }); });
}

// ---------- runs ----------
const parsePace = (t) => { const [m, s] = String(t).split(':').map(Number); return m * 60 + (s || 0); };
const fmtPace = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
const paceSecs = (r) => { const km = (+r.distance_m || 0) / 1000; const s = +r.moving_s || +r.elapsed_s || 0; return km > 0 && s > 0 ? s / km : null; };
function todaysRun() {
  const d = today();
  return store.all('run').filter((r) => r.start && new Date(r.start).toDateString() === new Date(`${d}T12:00`).toDateString())
    .sort((a, b) => (+b.distance_m || 0) - (+a.distance_m || 0))[0] || null;
}
function logRun(kind) {
  push((el, s) => {
    el.innerHTML = sheet({ title: `Log ${SESSION_LABEL[kind].toLowerCase()}`, body: `<form class="form ct-entry">
      <div class="form-row"><label>Distance (km)<input name="km" inputmode="decimal" autocomplete="off"></label>
      <label>Time (mm:ss or h:mm:ss)<input name="t" inputmode="text" placeholder="32:30" autocomplete="off"></label></div>
      <p class="small muted ct-pace">&nbsp;</p>
      <div class="sheet-actions" style="margin-top:10px"><button type="button" class="ghost" data-a="no">Cancel</button><button type="submit" class="primary">Save</button></div></form>` });
    const form = $('form', el);
    const secs = () => { const p = form.t.value.trim().split(':').map(Number); if (p.some((x) => !Number.isFinite(x))) return 0; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60; };
    form.oninput = () => { const km = parseNum(form.km.value); const t = secs(); $('.ct-pace', el).textContent = km > 0 && t > 0 ? `Pace ${fmtPace(t / km)}/km` : ' '; };
    setTimeout(() => form.km.focus(), 250);
    $('[data-a=no]', el).onclick = () => s.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const km = parseNum(form.km.value), t = secs();
      if (!(km > 0 && t > 0)) { toast('Enter distance and time'); return; }
      await store.put('run', { name: SESSION_LABEL[kind], type: 'running', sport: 'running', manual: true, start: new Date(Date.now() - t * 1000).toISOString(), distance_m: Math.round(km * 1000), moving_s: t, elapsed_s: t });
      toast('Run saved');
      s.close();
    };
  }, { sheet: true });
}

// Weekly review button: due (check-in day and the 2 days after) or done (grade).
function reviewBtn() {
  const ci = dueCheckin();
  if (!ci || today() > addDays(ci, 2)) return '';
  const done = checkinFor(ci);
  return done ? `<button class="link small" id="ct-review" style="margin-top:10px">Weekly review done · grade ${esc(done.grade || '–')}</button>`
    : `<button class="primary block" id="ct-review" style="margin-top:10px">${icon('flag')} Weekly review</button>`;
}

// ---------- the card ----------
function sessionBlock(sess, done, wk) {
  const plan = PLAN[Math.min(Math.max(wk, 1), PLAN.length) - 1];
  if (sess.kind === 'lift') {
    const r = sess.routine;
    const deload = plan?.deload;
    return `<div class="ct-sess"><div class="row between"><b>${esc(r.name)}${deload ? ' · deload' : ''}</b>${done ? `<span class="pill up">${icon('check')} Done</span>` : ''}</div>
      <p class="small muted">${r.exercises.map((x) => `${esc(x.name)} ${deload ? 2 : x.sets}×${esc(x.reps)}`).join(' · ')}</p>
      ${done ? '' : `<button class="primary block" id="ct-start" style="margin-top:10px">${icon('play')} Start ${esc(r.name)}</button>`}</div>`;
  }
  if (sess.kind === 'easy' || sess.kind === 'quality') {
    const txt = sess.kind === 'easy' ? `${plan?.easyMin || 35} min @ ${EASY_PACE}` : `10 min warm-up · ${plan?.quality.text || ''} · 10 min cool-down`;
    const run = done ? todaysRun() : null;
    const target = sess.kind === 'easy' ? '6:45' : plan?.quality.pace;
    const pace = run ? paceSecs(run) : null;
    const vs = pace && target ? pace - parsePace(target) : null;
    return `<div class="ct-sess"><div class="row between"><b>${SESSION_LABEL[sess.kind]}</b>${done ? `<span class="pill up">${icon('check')} Done</span>` : ''}</div>
      <p class="small muted">${esc(txt)}</p>
      ${run ? `<p class="small" style="margin-top:6px">${n1((+run.distance_m || 0) / 1000)} km · ${fmtPace(pace)}/km average${vs != null ? ` · ${sess.kind === 'easy' ? (vs > 0 ? 'easy enough' : `${fmtPace(-vs)} faster than easy pace`) : `${vs <= 0 ? `${fmtPace(-vs)} faster` : `${fmtPace(vs)} slower`} than ${target}/km (whole run incl. warm-up)`}` : ''}</p>`
        : `<button class="ghost block" id="ct-logrun" style="margin-top:10px">${icon('plus')} Log run by hand</button><p class="tiny muted" style="margin-top:4px">Garmin runs appear by themselves after the next sync.</p>`}</div>`;
  }
  return `<div class="ct-sess"><b>${SESSION_LABEL[sess.kind]}</b><p class="small muted">${sess.kind === 'steps' ? 'No session — hit your steps.' : 'Rest. Check-in day is the day for measurements and photos.'}</p></div>`;
}

function render(el) {
  const c = cutSettings();
  if (!c.startDate) {
    el.innerHTML = `<div class="card ct-today"><div class="card-head"><h2>Cut plan</h2></div>
      <p class="small muted">11 weeks to 65 kg: daily checklist, workouts that progress from what you actually lift, weekly check-ins.</p>
      <button class="primary block" id="ct-setup" style="margin-top:12px">Set up the plan</button></div>`;
    $('#ct-setup', el).onclick = openCutSettings;
    return;
  }
  const day = today();
  const src = sources();
  const tg = currentTargets(c);
  const st = statusOf(day, src, c, tg.kcal);
  const f = st.facts;
  const resched = rescheduleLifts(day, { workouts: src.workouts, startDate: c.startDate });
  if (resched?.day === day && st.session.kind !== 'lift') {
    const letter = nextLift(src.workouts, day, routineCut);
    st.session = { kind: 'lift', letter, routine: ROUTINES.find((r) => r.key === letter) };
    st.done = sessionDone('lift', day, src);
  }
  const flags = redFlags(day, src, c, startWeight(c));
  const start = startWeight(c);
  const trend = trendOn(emaTrend(src.weights), day);
  const wk = weekNumber(c.startDate, day);
  const plan = PLAN[wk - 1];
  const left = daysToGoal(c.startDate, day);
  const head = wk === 0 ? `Starts in ${daysBetween(day, c.startDate)} day${daysBetween(day, c.startDate) === 1 ? '' : 's'}`
    : plan ? `Week ${wk} of 11 · ${esc(plan.phase)}` : `Week ${wk} · plan finished`;

  // streaks (only days since the start count)
  const inPlan = (d) => d >= c.startDate;
  const greenStreak = streak(day, (d) => { if (!inPlan(d)) return false; const s = statusOf(d, src, c, tg.kcal); return s.status === 'green' || (s.status === 'yellow' && s.facts.minimum); });
  const proteinStreak = streak(day, (d) => inPlan(d) && (dayFacts(d, src).p ?? 0) >= c.proteinMin);
  const checkinStreak = weekStreak(day, src.checkins.map((x) => x.day));
  const minUsed = minimumDaysInWeek(day, src.dailies);
  const [stLabel, stCls] = STATUS[st.status];
  const v = (x, unit = '') => (x == null ? '<span class="muted">Tap to add</span>' : `${x}${unit}`);
  const ok = (key) => st.checks.find((x) => x.key === key);
  const row = (key, label, value) => {
    const chk = ok(key);
    return `<button class="list-item ct-item" data-k="${key}"><span class="ct-tick ${chk?.ok ? 'ok' : chk?.warn ? 'warn' : ''}">${icon(chk?.ok ? 'check' : 'plus')}</span>
      <div class="grow"><b>${label}</b><div class="sub">${chk ? esc(chk.label) : ''}</div></div><span class="ct-val">${value}</span></button>`;
  };
  const food = f.kcal == null && f.p == null ? v(null) : `${f.kcal == null ? '–' : n0(f.kcal)} kcal · P ${f.p == null ? '–' : n0(f.p)}`;

  el.innerHTML = `<div class="card ct-today">
    <div class="card-head"><div><h2>${head}</h2><p class="tiny muted">${wk > 0 && left != null ? `${left} days to goal · ` : ''}goal ${n1(c.goalWeight)} kg</p></div>
      <button class="link" id="ct-plan">Plan</button></div>
    ${flags.length ? `<div class="ct-flags">${flags.map((x) => `<p>${icon('flag')} ${esc(x.text)}</p>`).join('')}</div>` : ''}
    ${trend != null ? `<p class="small ct-trend">Trend <b>${n1(trend)} kg</b>${f.weight != null ? ` · today ${n1(f.weight)}` : ''}${plan && !plan.buffer && start ? ` · week ${wk} target ${n1(targetWeight(start, c.goalWeight, c.rate, wk))} kg` : ''}</p>` : ''}
    ${wk > 0 ? sessionBlock(st.session, st.done, wk) : ''}
    ${resched && !st.done ? `<p class="small ct-note">${icon('info')} Missed a lift this week. ${resched.day === day ? `Do ${esc(st.session.routine?.name || 'it')} today` : `Next lift ${dayName(resched.day)}`}, then the next one ${dayName(resched.then)} — never two lift days in a row.</p>` : ''}
    <div class="row between" style="margin:14px 0 4px"><h3 class="ct-sub">Today</h3><span class="pill ${stCls}">${stLabel}</span></div>
    <div class="list">
      ${row('weight', 'Weight', v(f.weight == null ? null : n1(f.weight), ' kg'))}
      ${row('sleep', 'Sleep', v(f.sleep == null ? null : n1(f.sleep), ' h'))}
      ${row('steps', 'Steps', v(f.steps == null ? null : n0(f.steps)))}
      ${row('protein', 'Food', food)}
    </div>
    <div class="row between" style="margin-top:12px;gap:8px">
      <button class="${f.minimum ? 'soft' : 'ghost'} grow" id="ct-min">${f.minimum ? `${icon('check')} Minimum day` : 'Minimum day'}</button>
      <button class="ghost" id="ct-yday">Yesterday</button>
    </div>
    ${reviewBtn()}
    <p class="tiny ${minUsed > 1 ? 'down' : 'muted'}" style="margin-top:6px">${f.minimum ? (st.minimumMet ? 'Minimum met: weigh-in, protein and 6,000 steps. Counts as yellow.' : 'Minimum day needs a weigh-in, protein ≥ 140 g and 6,000 steps.') : 'Bad day, travel or illness: weigh-in + protein + 6,000 steps.'}${minUsed > 1 ? ` ${minUsed} minimum days this week — more than 1 is flagged.` : ''}</p>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${greenStreak}</b><span>green days</span></div>
      <div class="stat"><b>${proteinStreak}</b><span>protein days</span></div>
      <div class="stat"><b>${checkinStreak}</b><span>check-in weeks</span></div>
    </div></div>`;

  $('#ct-plan', el).onclick = openPlan;
  $$('.ct-item', el).forEach((b) => { b.onclick = () => editItem(b.dataset.k === 'protein' ? 'food' : b.dataset.k, day, f); });
  $('#ct-min', el).onclick = async () => {
    await saveDaily(day, { minimum: !f.minimum });
    if (!f.minimum && minUsed >= 1) toast('That is more than 1 minimum day this week — it will be flagged');
  };
  $('#ct-review', el)?.addEventListener('click', () => openReview());
  $('#ct-yday', el).onclick = () => openDay(addDays(day, -1));
  $('#ct-logrun', el)?.addEventListener('click', () => logRun(st.session.kind));
  $('#ct-start', el)?.addEventListener('click', async () => {
    let r = store.all('routine').find((x) => x.program === PROGRAM_NAME && x.cut === st.session.letter);
    if (!r) { await addCutRoutines(); r = store.all('routine').find((x) => x.program === PROGRAM_NAME && x.cut === st.session.letter); }
    if (r) startWorkout(r);
  });
}

// A past day as a page: the same checklist, editable.
export function openDay(day) {
  push((el) => {
    const draw = () => {
      const st = statusOf(day);
      const f = st.facts;
      const [stLabel, stCls] = STATUS[st.status];
      el.innerHTML = sheet({ title: new Date(`${day}T12:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }), body: `
        <div class="row between" style="margin-bottom:8px"><span class="small muted">${esc(SESSION_LABEL[st.session.kind])}${st.session.routine ? ` (${esc(st.session.routine.name)})` : ''}</span><span class="pill ${stCls}">${stLabel}</span></div>
        <div class="list">${st.checks.map((x) => `<div class="list-item"><span class="ct-tick ${x.ok ? 'ok' : x.warn ? 'warn' : ''}">${icon(x.ok ? 'check' : 'close')}</span><div class="grow">${esc(x.label)}</div></div>`).join('')}</div>
        <div class="fab-row" style="margin-top:12px;flex-wrap:wrap">
          <button class="ghost" data-k="weight">Weight${f.weight != null ? ` ${n1(f.weight)}` : ''}</button>
          <button class="ghost" data-k="sleep">Sleep${f.sleep != null ? ` ${n1(f.sleep)} h` : ''}</button>
          <button class="ghost" data-k="steps">Steps${f.steps != null ? ` ${n0(f.steps)}` : ''}</button>
          <button class="ghost" data-k="food">Food${f.kcal != null ? ` ${n0(f.kcal)}` : ''}</button>
          <button class="${f.minimum ? 'soft' : 'ghost'}" data-k="min">Minimum day</button>
        </div>` });
      $$('[data-k]', el).forEach((b) => { b.onclick = async () => {
        if (b.dataset.k === 'min') { await saveDaily(day, { minimum: !f.minimum }); return; }
        editItem(b.dataset.k, day, f);
      }; });
    };
    draw();
    const off = store.onChange(() => { if (el.isConnected) draw(); else off(); });
  }, { sheet: true });
}

export const homeCard = { order: 0, render };

// "Log yesterday" first when yesterday (inside the plan) has nothing logged; asked once per day.
export function init() {
  setTimeout(() => {
    const c = cutSettings();
    if (reviewNeeded()) { openReview(); return; }
    const y = addDays(today(), -1);
    if (!c.startDate || y < c.startDate || local.get('cut.askedYesterday') === today()) return;
    if (isLogged(y, sources())) return;
    local.set('cut.askedYesterday', today());
    toast('Yesterday is not logged yet');
    openDay(y);
  }, 600);
}

// Red flags strip above the tab bar on the other tabs (Home shows them in the Today card).
export function banner(el) {
  if (document.getElementById('view')?.dataset.tab === 'home' || !isSetUp()) return false;
  const flags = currentFlags();
  if (!flags.length) return false;
  el.innerHTML = `<button class="ct-banner" onclick="showTab('home')">${icon('flag')} ${flags.length === 1 ? esc(flags[0].text) : `${flags.length} red flags — see Home`}</button>`;
  return true;
}
