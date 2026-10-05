// Cut plan "Today" card at the top of Home: week / phase / days to goal, today's session with a Start button,
// the daily checklist (each value entered in a few seconds), day status, minimum-day button and streaks.

import { $, $$, esc, icon, toast, today, n0, n1, parseNum, addDays } from './util.js';
import * as store from './store.js';
import { push, sheet } from './nav.js';
import { startWorkout } from './gym-workout.js';
import { cutSettings, currentTargets, openCutSettings, openPlan, addCutRoutines } from './cut.js';
import { PLAN, PROGRAM_NAME, EASY_PACE, weekNumber, daysToGoal, daysBetween } from './cut-calc.js';
import { sessionFor, sessionDone, dayFacts, dayStatus, streak, weekStreak, minimumDaysInWeek, SESSION_LABEL } from './cut-day.js';

const STATUS = { green: ['Green day', 'up'], yellow: ['Yellow day', 'gold'], red: ['Red day', 'down'], open: ['In progress', ''] };

// ---------- data ----------
const routineCut = (id) => store.get(id)?.cut || null;
function sources() {
  return {
    weights: store.all('bodyweight'), dailies: store.all('daily'), meals: store.all('meal'),
    workouts: store.all('workout'), runs: store.all('run'), checkins: store.all('checkin'),
  };
}
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
  return { facts: f, session, done, ...dayStatus(f, { kcalTarget, cfg, session, done, isToday: day === today() }) };
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
    return `<div class="ct-sess"><div class="row between"><b>${SESSION_LABEL[sess.kind]}</b>${done ? `<span class="pill up">${icon('check')} Done</span>` : ''}</div>
      <p class="small muted">${esc(txt)}</p></div>`;
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
    ${wk > 0 ? sessionBlock(st.session, st.done, wk) : ''}
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
  $('#ct-yday', el).onclick = () => openDay(addDays(day, -1));
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
