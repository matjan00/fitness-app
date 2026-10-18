// Cut plan "Today" card at the top of Home: week / phase / days to goal, today's session with a Start button,
// the daily checklist (each value entered in a few seconds), day status, minimum-day button and streaks.

import { $, $$, esc, icon, toast, today, n0, n1, parseNum, addDays, local } from './util.js';
import * as store from './store.js';
import { push, sheet } from './nav.js';
import { startWorkout } from './gym-workout.js';
import { cutSettings, currentTargets, openCutSettings, openPlan, addCutRoutines, syncCutRoutines, startWeight, isSetUp } from './cut.js';
import { PLAN, PROGRAM_NAME, EASY_PACE, weekNumber, daysToGoal, daysBetween, emaTrend, trendOn, targetWeight } from './cut-calc.js';
import { redFlags, isLogged } from './cut-flags.js';
import { openReview, dueCheckin, checkinFor, measurementsDue, openCheckin } from './cut-review.js';
import { liftDayExtra, sessionFor, sessionDone, dayFacts, dayStatus, handStepsPatch, streak, weekStreak, minimumDaysInWeek, weekTraining, TRAIN_CHOICES, SESSION_LABEL } from './cut-day.js';

const STATUS = { green: ['Green day', 'up'], yellow: ['Yellow day', 'gold'], red: ['Red day', 'down'], open: ['In progress', ''] };

// ---------- data ----------
const routineCut = (id) => store.get(id)?.cut || null;
export function sources() {
  return {
    weights: store.all('bodyweight'), dailies: store.all('daily'), meals: store.all('meal'),
    workouts: store.all('workout'), runs: store.all('run'), checkins: store.all('checkin'), routineCut,
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
  const session = sessionFor(day, { workouts: src.workouts, runs: src.runs, routineCut, dailies: src.dailies });
  const done = sessionDone(session.kind, day, src);
  const week = weekTraining(day, src);
  const target = kcalTarget ? kcalTarget + liftDayExtra(day, { cfg, workouts: src.workouts, dailies: src.dailies }) : kcalTarget;
  return { facts: f, session, done, week, ...dayStatus(f, { kcalTarget: target, cfg, session, done, week, isToday: day === today() }) };
}

// ---------- quick entry sheets ----------
// fields: [{ name, label, value, mode }]; onSave(values) gets numbers (or null for empty fields).
function entrySheet(title, fields, onSave, note = '') {
  push((el, s) => {
    el.innerHTML = sheet({ title, body: `<form class="form ct-entry">
      ${note ? `<p class="small muted">${esc(note)}</p>` : ''}
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
      await daily({ sleepHours: v.h, sleepSource: null }); // typed by hand: the Garmin sync leaves it alone
    });
  }
  if (key === 'steps') {
    const note = f.stepsPhone != null
      ? `Your phone counted ${n0(f.stepsPhone)}. Steps you add here go on top.`
      : 'Only steps your phone did not count (e.g. walking without it). The phone\'s count is added to this the morning after.';
    return entrySheet('Steps added by hand', [{ name: 'n', label: 'Steps', value: f.stepsExtra, mode: 'numeric' }], async (v) => {
      if (v.n != null && !(v.n >= 0 && v.n <= 100000)) { toast('Enter a number of steps'); return false; }
      const cur = store.all('daily').find((d) => d.day === day);
      await daily(handStepsPatch(cur, v.n == null ? null : Math.round(v.n)));
    }, note);
  }
  // food: day totals from the separate food app (empty = use the Food tab diary)
  return entrySheet('Food totals', [
    { name: 'kcal', label: 'Calories (kcal)', value: f.kcal, mode: 'numeric' }, { name: 'p', label: 'Protein (g)', value: f.p, mode: 'numeric' },
    { name: 'c', label: 'Carbs (g)', value: f.c, mode: 'numeric' }, { name: 'f', label: 'Fat (g)', value: f.f, mode: 'numeric' },
  ], async (v) => { await daily({ kcal: v.kcal, p: v.p, c: v.c, f: v.f }); }, 'Day totals from your food app. Leave empty to use the Food tab diary.');
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
// Manual run entry; `kind` is today's plan session (tempo, easy…) or null from the Run tab.
export function logRun(kind = null) {
  push((el, s) => {
    el.innerHTML = sheet({ title: kind ? `Log ${SESSION_LABEL[kind].toLowerCase()}` : 'Log a run', body: `<form class="form ct-entry">
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
      await store.put('run', { name: kind ? SESSION_LABEL[kind] : 'Run', type: 'running', sport: 'running', manual: true, start: new Date(Date.now() - t * 1000).toISOString(), distance_m: Math.round(km * 1000), moving_s: t, elapsed_s: t });
      toast('Run saved');
      s.close();
    };
  }, { sheet: true });
}

// Check-in day (Sunday): a nudge for measurements + photos. Review day and the 2 days after (Mon–Wed): the weekly
// review of the finished week, or "done · grade". Neither opens by itself.
function reviewBtn() {
  const m = measurementsDue();
  const r = dueCheckin();
  const due = r && today() <= addDays(r, 2);
  const done = due && checkinFor(r);
  const ci = m ? `<button class="${due && !done ? 'ghost' : 'soft'} block" id="ct-checkin" style="margin-bottom:8px">${icon('scale')} Check-in: measurements &amp; photos</button>` : '';
  if (!due) return ci;
  return ci + (done ? `<button class="link small ct-revdone" id="ct-review">Weekly review done · grade ${esc(done.grade || '–')} ›</button>`
    : `<button class="primary block" id="ct-review" style="margin-bottom:12px">${icon('flag')} Weekly review of last week</button>`);
}

// ---------- day type: normal / minimum / travel ----------
function dayTypeHtml(f, st, minUsed) {
  const type = f.travel ? 'travel' : f.minimum ? 'minimum' : 'normal';
  const hint = {
    normal: 'Bad day or illness? Minimum day. Away for work? Travel day.',
    minimum: st.minimumMet ? 'Minimum met: weigh-in, protein and 6,000 steps. Counts as yellow.' : 'Minimum day: weigh-in, protein ≥ 140 g and 6,000 steps. Counts as yellow.',
    travel: 'Travel day: only the morning weigh-in counts. Calories roughly on target if you log them; steps optional; no session.',
  }[type];
  return `<div class="seg ct-daytype" style="margin-top:12px" role="group" aria-label="Day type">${['normal', 'minimum', 'travel'].map((t) => `<button type="button" data-t="${t}" class="${t === type ? 'on' : ''}" aria-pressed="${t === type}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    <p class="tiny ${minUsed > 1 && type === 'minimum' ? 'down' : 'muted'}" style="margin-top:6px">${esc(hint)}${minUsed > 1 && type === 'minimum' ? ` ${minUsed} minimum days this week — more than 1 is flagged.` : ''}</p>`;
}
function bindDayType(el, day, f, minUsed) {
  $$('.ct-daytype button', el).forEach((b) => { b.onclick = async () => {
    const t = b.dataset.t;
    await saveDaily(day, { minimum: t === 'minimum', travel: t === 'travel' });
    if (t === 'minimum' && !f.minimum && minUsed >= 1) toast('That is more than 1 minimum day this week — it will be flagged');
  }; });
}

// Mark (or clear) a range of upcoming days as travel days.
function planTravel() {
  const upcoming = store.all('daily').filter((d) => d.travel && d.day >= today()).map((d) => d.day).sort();
  push((el, s) => {
    el.innerHTML = sheet({ title: 'Travel days', body: `<form class="form ct-entry">
      <p class="small muted">On travel days only the morning weigh-in counts; calories roughly, steps optional, no session.</p>
      <div class="form-row"><label>From<input type="date" name="from" value="${today()}" required></label><label>To<input type="date" name="to" value="${today()}" required></label></div>
      ${upcoming.length ? `<p class="small">Planned: ${esc(upcoming.map((d) => new Date(`${d}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })).join(', '))}</p>` : ''}
      <div class="sheet-actions" style="margin-top:12px"><button type="button" class="ghost" data-a="clear">Clear these days</button><button type="submit" class="primary">Mark as travel</button></div></form>` });
    const form = $('form', el);
    const days = () => {
      const a = form.from.value, b = form.to.value;
      if (!a || !b || b < a) { toast('Pick a start and an end date'); return null; }
      const out = [];
      for (let d = a; d <= b && out.length < 60; d = addDays(d, 1)) out.push(d);
      return out;
    };
    const apply = async (travel) => {
      const list = days();
      if (!list) return;
      for (const d of list) await saveDaily(d, travel ? { travel: true, minimum: false } : { travel: false });
      toast(travel ? `${list.length} travel day${list.length > 1 ? 's' : ''} marked` : 'Travel days cleared');
      s.close();
    };
    form.onsubmit = (e) => { e.preventDefault(); apply(true); };
    $('[data-a=clear]', el).onclick = () => apply(false);
  }, { sheet: true });
}

// ---------- the card ----------
// Today's pick (Gym / Run / No training) and the week's 3 gym + 2 runs: done so far and whether it still fits.
function trainingHtml(st, day, src) {
  const w = st.week; // counts include today
  const freeToday = !st.done && !sessionDone('lift', day, src) && !sessionDone('easy', day, src);
  const need = w.liftLeft + w.runLeft;
  const days = w.daysLeft + (freeToday ? 1 : 0);
  const sum = `Gym ${w.lift}/${w.goal.lift} · runs ${w.run}/${w.goal.run}`;
  const line = w.complete ? `${sum} · week done`
    : need <= days ? `${sum} · ${need} to go in ${days} day${days === 1 ? '' : 's'}, on track`
      : `${sum} · ${need} to go but only ${days} day${days === 1 ? '' : 's'} left`;
  const sel = st.session.chosen || st.done ? st.session.choice : null;
  const label = Object.fromEntries(TRAIN_CHOICES)[st.session.choice];
  return `<div class="row between" style="margin:2px 0 6px"><h3 class="ct-sub">Today's training</h3>
      ${sel ? '' : `<span class="tiny muted">Suggested: ${esc(label)}</span>`}</div>
    <div class="seg ct-train" role="group" aria-label="Today's training">${TRAIN_CHOICES.map(([v, t]) => `<button type="button" data-v="${v}" class="${v === sel ? 'on' : ''}" aria-pressed="${v === sel}">${t}</button>`).join('')}</div>
    <p class="tiny ${need > days ? 'warn' : 'muted'} ct-weekline">${esc(line)}</p>`;
}

function sessionBlock(sess, done, wk) {
  const plan = PLAN[Math.min(Math.max(wk, 1), PLAN.length) - 1];
  if (sess.kind === 'lift') {
    const r = sess.routine;
    const deload = plan?.deload;
    // A different workout than the rotation's next one still counts for the week; say which one it was.
    if (done && sess.did && sess.did.letter !== sess.letter) {
      return `<div class="ct-sess"><div class="row between"><b>${esc(sess.did.name)}</b><span class="pill up">${icon('check')} Done</span></div>
        <p class="small muted">Counts toward this week's gym sessions. Next in the rotation: ${esc(r.name)}.</p></div>`;
    }
    return `<div class="ct-sess"><div class="row between"><b>${esc(r.name)}${deload ? ' · deload' : ''}</b>${done ? `<span class="pill up">${icon('check')} Done</span>` : ''}</div>
      <p class="small muted">${r.exercises.length} exercises · ${esc(r.exercises.filter((x) => x.kind === 'main').map((x) => x.name).join(', '))}${deload ? ' · 2 sets each' : ''}</p>
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
  const note = { steps: 'No session — hit your steps.', travel: 'Weigh in this morning. Calories and steps are optional, roughly is fine.' }[sess.kind] || 'No session today. Hit your steps; on check-in day, take measurements and photos.';
  return `<div class="ct-sess"><b>${SESSION_LABEL[sess.kind]}</b><p class="small muted">${note}</p></div>`;
}

// The day at a glance, right under the title: calories and protein still to eat, and the weight trend.
function headStats(f, tg, trend) {
  const kcalLeft = tg.kcal ? tg.kcal - (f.kcal || 0) : null;
  const pLeft = tg.p ? Math.max(0, tg.p - (f.p || 0)) : null;
  const kg = trend ?? f.weight;
  return `<div class="stats ct-headstats">
    <div class="stat"><b class="${kcalLeft != null && kcalLeft < 0 ? 'warn' : ''}">${kcalLeft == null ? '–' : n0(Math.abs(kcalLeft))}</b><span>${kcalLeft != null && kcalLeft < 0 ? 'kcal over' : 'kcal left'}</span></div>
    <div class="stat"><b>${pLeft == null ? '–' : `${n0(pLeft)}<small> g</small>`}</b><span>protein left</span></div>
    <div class="stat"><b>${kg == null ? '–' : `${n1(kg)}<small> kg</small>`}</b><span>${trend != null ? 'trend weight' : 'weight'}</span></div>
  </div>`;
}

function render(el) {
  const c = cutSettings();
  if (!c.startDate) {
    el.innerHTML = `<div class="card ct-today"><div class="card-head"><h2>Cut plan</h2></div>
      <p class="small muted">A daily checklist, workouts that progress from what you actually lift, and weekly check-ins toward your goal weight.</p>
      <button class="ghost block" id="ct-setup" style="margin-top:12px">Set up the plan</button></div>`;
    $('#ct-setup', el).onclick = openCutSettings;
    return;
  }
  const day = today();
  const src = sources();
  const tg = currentTargets(c);
  const st = statusOf(day, src, c, tg.kcal);
  const f = st.facts;
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
  const proteinStreak = streak(day, (d) => { if (!inPlan(d)) return false; const fx = dayFacts(d, src); return fx.travel || (fx.p ?? 0) >= c.proteinMin; });
  const checkinStreak = weekStreak(day, src.checkins.map((x) => x.day));
  const minUsed = minimumDaysInWeek(day, src.dailies);
  const [stLabel, stCls] = STATUS[st.status];
  const v = (x, unit = '') => (x == null ? '<span class="ct-add">Add</span>' : `${x}${unit}`);
  const ok = (key) => st.checks.find((x) => x.key === key);
  // The icon says whether something is entered (+ = add it, ✓ = entered); the colour says whether it hits
  // the target (green), is close or short (amber).
  const row = (key, label, value, extra = '', has = false) => {
    const chk = ok(key);
    const cls = !has ? '' : chk?.ok ? 'ok' : 'warn';
    return `<button class="list-item ct-item" data-k="${key}"><span class="ct-tick ${cls}">${icon(has ? 'check' : 'plus')}</span>
      <div class="grow"><b>${label}</b><div class="sub">${esc(extra || (key === 'weight' && !chk?.ok ? 'Morning, before food' : chk?.label) || '')}</div></div><span class="ct-val">${value}</span></button>`;
  };
  const food = f.kcal == null && f.p == null ? v(null) : `${f.kcal == null ? '–' : n0(f.kcal)} kcal · P ${f.p == null ? '–' : n0(f.p)}`;

  el.innerHTML = `<div class="card ct-today">
    <div class="card-head"><div><h2>${head}</h2><p class="tiny muted">${wk > 0 && left != null ? `${left} day${left === 1 ? '' : 's'} to goal · ` : ''}goal ${n1(c.goalWeight)} kg</p></div>
      <button class="link" id="ct-plan">Plan</button></div>
    ${headStats(f, tg, trend)}
    ${flags.length ? `<details class="ct-flags"><summary>${icon('flag')} ${flags.length === 1 ? esc(flags[0].text) : `${flags.length} things to fix`}</summary>
      ${flags.length > 1 ? flags.map((x) => `<p>${esc(x.text)}</p>`).join('') : ''}</details>` : ''}
    ${reviewBtn()}
    ${wk > 0 && !f.travel ? trainingHtml(st, day, src) : ''}
    ${wk > 0 ? sessionBlock(st.session, st.done, wk) : ''}
    <div class="row between" style="margin:14px 0 4px"><h3 class="ct-sub">Today</h3><span class="pill ${stCls}">${stLabel}</span></div>
    <div class="list">
      ${row('weight', 'Weight', v(f.weight == null ? null : n1(f.weight), ' kg'), trend != null ? `trend ${n1(trend)} kg${plan && !plan.buffer && start ? ` · target ${n1(targetWeight(start, c.goalWeight, c.rate, wk))} by ${new Date(`${addDays(c.startDate, wk * 7 - 1)}T12:00`).toLocaleDateString('en-GB', { weekday: 'short' })}` : ''}` : '', f.weight != null)}
      ${row('sleep', 'Sleep', v(f.sleep == null ? null : n1(f.sleep), ' h'), '', f.sleep != null)}
      ${row('steps', 'Steps', v(f.steps == null ? null : n0(f.steps)), f.stepsPhone != null && f.stepsExtra ? `phone ${n0(f.stepsPhone)} + ${n0(f.stepsExtra)} by hand` : '', f.steps != null)}
      ${row(f.travel ? 'kcal' : 'protein', 'Food', food, '', f.kcal != null || f.p != null)}
    </div>
    ${dayTypeHtml(f, st, minUsed)}
    <div class="row between ct-links"><button class="link small" id="ct-yday">Edit yesterday</button><button class="link small" id="ct-trip">Plan travel days</button></div>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${greenStreak}</b><span>green days</span></div>
      <div class="stat"><b>${proteinStreak}</b><span>protein days</span></div>
      <div class="stat"><b>${checkinStreak}</b><span>check-ins</span></div>
    </div></div>`;

  $('#ct-plan', el).onclick = openPlan;
  $$('.ct-item', el).forEach((b) => { b.onclick = () => editItem(['protein', 'kcal'].includes(b.dataset.k) ? 'food' : b.dataset.k, day, f); });
  bindDayType(el, day, f, minUsed);
  $$('.ct-train button', el).forEach((b) => { b.onclick = () => saveDaily(day, { train: b.dataset.v }); });
  $('#ct-trip', el).onclick = planTravel;
  $('#ct-review', el)?.addEventListener('click', () => openReview());
  $('#ct-checkin', el)?.addEventListener('click', () => openCheckin());
  $('#ct-yday', el).onclick = () => openDay(addDays(day, -1));
  $('#ct-logrun', el)?.addEventListener('click', () => logRun(st.session.kind));
  $('#ct-start', el)?.addEventListener('click', async () => {
    await syncCutRoutines();
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
        <div class="row between" style="margin-bottom:8px"><span class="small muted">${st.session.chosen || st.done || day >= today() ? `${esc(SESSION_LABEL[st.session.kind])}${st.session.routine ? ` (${esc(st.session.routine.name)})` : ''}` : 'No training'}</span><span class="pill ${stCls}">${stLabel}</span></div>
        <div class="list">${st.checks.map((x) => `<div class="list-item"><span class="ct-tick ${x.ok ? 'ok' : x.warn ? 'warn' : ''}">${icon(x.ok ? 'check' : 'close')}</span><div class="grow">${esc(x.label)}</div></div>`).join('')}</div>
        <div class="fab-row" style="margin-top:12px;flex-wrap:wrap">
          <button class="ghost" data-k="weight">Weight${f.weight != null ? ` ${n1(f.weight)}` : ''}</button>
          <button class="ghost" data-k="sleep">Sleep${f.sleep != null ? ` ${n1(f.sleep)} h` : ''}</button>
          <button class="ghost" data-k="steps">Steps${f.steps != null ? ` ${n0(f.steps)}` : ''}</button>
          <button class="ghost" data-k="food">Food${f.kcal != null ? ` ${n0(f.kcal)}` : ''}</button>
        </div>
        ${dayTypeHtml(f, st, minimumDaysInWeek(day, store.all('daily')))}` });
      $$('[data-k]', el).forEach((b) => { b.onclick = () => editItem(b.dataset.k, day, f); });
      bindDayType(el, day, f, minimumDaysInWeek(day, store.all('daily')));
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
    const y = addDays(today(), -1);
    if (!c.startDate || y < c.startDate || local.get('cut.askedYesterday') === today()) return;
    if (!isLogged(y, sources())) {
      local.set('cut.askedYesterday', today());
      toast('Yesterday is not logged yet');
      openDay(y);
      return;
    }
    const msg = reminderText();
    if (msg) toast(msg, 4500);
  }, 600);
  setTimeout(() => syncCutRoutines().catch(() => {}), 1500);
  scheduleReminders();
}

// ---------- reminders ----------
// Morning: weigh-in. Evening: food, steps and sleep. Shown as a prompt when the app opens; as a phone
// notification at 8:00 and 21:00 when switched on (only while the app is open or in the background —
// a web app can't wake itself up once the phone has closed it).
function reminderText(day = today(), hour = new Date().getHours()) {
  if (!isSetUp() || day < cutSettings().startDate) return '';
  const f = dayFacts(day, sources());
  if (hour >= 5 && hour < 12 && f.weight == null) return 'Morning weigh-in: after the bathroom, before food.';
  if (hour >= 19) {
    const miss = [f.kcal == null && 'food', f.steps == null && 'steps', f.sleep == null && 'sleep'].filter(Boolean);
    if (miss.length) return `Evening log: ${miss.join(', ')} still missing for today.`;
  }
  return '';
}
const timers = [];
function scheduleReminders() {
  timers.splice(0).forEach(clearTimeout);
  if (!cutSettings().reminders || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  for (const h of [8, 21]) {
    const at = new Date();
    at.setHours(h, 0, 0, 0);
    if (at <= new Date()) at.setDate(at.getDate() + 1);
    timers.push(setTimeout(async () => {
      const msg = reminderText(today(), h);
      if (msg) {
        try { (await navigator.serviceWorker?.ready)?.showNotification('Fit', { body: msg, icon: 'icon-192.png', tag: `cut-${h}` }); }
        catch { try { new Notification('Fit', { body: msg }); } catch { /* not allowed */ } }
      }
      scheduleReminders();
    }, at - new Date()));
  }
}
export { scheduleReminders };

