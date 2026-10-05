// Cut plan (fit-cut-plan.md): settings, the dated 11(+2)-week plan and the Upper A/B/C routines.
// Plan maths lives in cut-calc.js. Calories and macros are the food targets, shared with the Food tab.
//
// Records: 'daily' (daily log), 'checkin' (weekly check-in), 'targets' (targets history), config 'cut'.

import { $, $$, esc, icon, toast, today, n0, n1, n2, parseNum, niceDate, fromDay } from './util.js';
import * as store from './store.js';
import { push, page } from './nav.js';
import * as foodUi from './food-ui.js';
import { loadDb, exById } from './gym-data.js';
import {
  CUT_DEFAULTS, CUT_TARGETS, PROGRAM_NAME, EASY_PACE, routineRecords, planWeeks, weekNumber, startWeightFrom,
  targetsChanged, daysToGoal,
} from './cut-calc.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- data ----------
export function cutSettings() {
  const { id, key, ...c } = store.getConfig('cut', {});
  return { ...CUT_DEFAULTS, ...c };
}
export async function saveCut(patch) {
  const { id, key, ...cur } = store.getConfig('cut', {});
  await store.setConfig('cut', { ...cur, ...patch });
}
export const isSetUp = () => Boolean(cutSettings().startDate);
export const startWeight = (c = cutSettings()) => startWeightFrom(store.all('bodyweight'), c.startDate, c.startWeight);
// Current kcal/macros (food targets) + step target.
export const currentTargets = (c = cutSettings()) => ({ ...(foodUi.targets() || {}), steps: c.steps });

const targetsLog = () => store.all('targets').sort((a, b) => a.day.localeCompare(b.day) || String(a.at || '').localeCompare(String(b.at || '')));

// Logs a targets-history row when kcal/macros/steps differ from the latest one.
export async function recordTargets(next, reason) {
  const log = targetsLog();
  if (!targetsChanged(log[log.length - 1], next)) return;
  await store.put('targets', { day: today(), at: new Date().toISOString(), kcal: next.kcal ?? null, p: next.p ?? null, c: next.c ?? null, f: next.f ?? null, steps: next.steps ?? null, reason });
}

// Adds Upper A / B / C (program "Cut 11 weeks") unless they are already there.
export async function addCutRoutines() {
  if (store.all('routine').some((r) => r.program === PROGRAM_NAME)) { toast('The Upper A / B / C routines are already in Gym'); return; }
  await loadDb().catch(() => {});
  const recs = routineRecords(Date.now()).map((r) => ({ ...r, exercises: r.exercises.filter((x) => exById(x.exercise_id)) }));
  await store.putMany('routine', recs);
  toast('Added Upper A, B and C to Gym');
}

// ---------- settings page ----------
export function openCutSettings() {
  const c = cutSettings();
  const fs = foodUi.settings();
  const prof = { sex: 'male', age: '', height: '', ...(fs.profile || {}) };
  // First set-up starts from the plan's numbers; afterwards the saved targets.
  const tg = c.startDate ? { ...CUT_TARGETS, ...(fs.targets || {}) } : { ...CUT_TARGETS };
  push((el, s) => {
    const sw = startWeightFrom(store.all('bodyweight'), c.startDate, null);
    const num = (name, label, value, mode = 'decimal') => `<label>${label}<input name="${name}" inputmode="${mode}" value="${esc(value ?? '')}"></label>`;
    el.innerHTML = page({ title: 'Cut plan', right: '<button class="primary" id="ct-save">Save</button>', body: `
      <p class="small muted" style="margin:0 2px 14px">11 weeks of cutting at a steady pace, keeping muscle and strength. Changing the start date moves the whole plan.</p>
      <div class="card form">
        <div class="form-row"><label>Start date<input type="date" name="startDate" value="${esc(c.startDate || '')}"></label>
          ${num('goalWeight', 'Goal (kg)', c.goalWeight)}</div>
        <div class="form-row">${num('startWeight', 'Start weight (kg)', c.startWeight ?? '')}
          <label>Pace<select name="rate">${[0.5, 0.75, 1].map((r) => `<option value="${r}" ${+c.rate === r ? 'selected' : ''}>${r} kg / week</option>`).join('')}</select></label></div>
        <p class="tiny muted">Leave start weight empty to use the average of your first 3 morning weigh-ins from the start date${sw ? ` (now ${n1(sw)} kg)` : ''}.</p>
        <div class="seg" id="ct-sex"><button type="button" data-v="male" class="${prof.sex === 'male' ? 'on' : ''}">Male</button><button type="button" data-v="female" class="${prof.sex === 'female' ? 'on' : ''}">Female</button></div>
        <div class="form-row">${num('age', 'Age', prof.age, 'numeric')}${num('height', 'Height (cm)', prof.height, 'numeric')}</div>
      </div>
      <h3 class="section-title">Daily targets</h3>
      <div class="card form">
        <div class="form-row">${num('kcal', 'Calories (kcal)', tg.kcal, 'numeric')}${num('p', 'Protein (g)', tg.p, 'numeric')}</div>
        <div class="form-row">${num('f', 'Fat (g)', tg.f, 'numeric')}${num('c', 'Carbs (g)', tg.c, 'numeric')}</div>
        <div class="form-row">${num('steps', 'Steps', c.steps, 'numeric')}${num('sleep', 'Sleep (h)', c.sleep)}</div>
        <div class="form-row">${num('kcalFloor', 'Calorie floor', c.kcalFloor, 'numeric')}
          <label>Check-in day<select name="checkinDay">${DAYS.map((d, i) => `<option value="${i}" ${+c.checkinDay === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div>
        <p class="tiny muted">Calories and macros are the same targets the Food tab uses. Start: 1,750 kcal · 150 g protein · 55 g fat · 165 g carbs.</p>
      </div>
      <h3 class="section-title">Gym</h3>
      <div class="card row between"><div class="grow"><b>Upper A / B / C</b><p class="small muted">3 upper-body routines, rotated A → B → C</p></div>
        <button class="ghost" id="ct-routines">${icon('plus')} Add</button></div>` });
    let sex = prof.sex;
    $$('#ct-sex button', el).forEach((b) => { b.onclick = () => { sex = b.dataset.v; $$('#ct-sex button', el).forEach((x) => x.classList.toggle('on', x === b)); }; });
    $('#ct-routines', el).onclick = addCutRoutines;
    $('#ct-save', el).onclick = async () => {
      const v = (n) => $(`[name=${n}]`, el).value;
      const nv = (n) => parseNum(v(n));
      const startDate = v('startDate') || null;
      const goal = nv('goalWeight');
      if (!(goal > 30 && goal < 300)) { toast('Enter a goal weight in kg'); return; }
      const kcal = nv('kcal');
      if (!(kcal > 800)) { toast('Enter a calorie target'); return; }
      const cut = {
        startDate, goalWeight: goal, rate: +v('rate'),
        startWeight: nv('startWeight') > 30 ? nv('startWeight') : null,
        steps: Math.round(nv('steps') || CUT_DEFAULTS.steps), sleep: nv('sleep') || CUT_DEFAULTS.sleep,
        kcalFloor: Math.round(nv('kcalFloor') || CUT_DEFAULTS.kcalFloor), checkinDay: +v('checkinDay'),
      };
      const targets = { kcal: Math.round(kcal), p: Math.round(nv('p') || 0), c: Math.round(nv('c') || 0), f: Math.round(nv('f') || 0) };
      await saveCut(cut);
      await foodUi.saveSettings({ targets, profile: { ...(fs.profile || {}), sex, age: Math.round(nv('age')) || null, height: Math.round(nv('height')) || null } });
      await recordTargets({ ...targets, steps: cut.steps }, 'Edited in settings');
      toast('Cut plan saved');
      s.close();
    };
  });
}

// ---------- plan page ----------
export function openPlan() {
  push((el) => {
    const c = cutSettings();
    const start = startWeight(c);
    const weeks = planWeeks(c, start);
    const cur = weekNumber(c.startDate, today());
    el.innerHTML = page({ title: 'The plan', body: `
      ${!c.startDate ? '<div class="card small muted" style="margin-bottom:12px">Set a start date in the Cut plan settings to date the weeks.</div>'
        : !start ? '<div class="card small muted" style="margin-bottom:12px">Target weights appear after your first morning weigh-in from the start date.</div>' : ''}
      <div class="card stats" style="margin-bottom:12px">
        <div class="stat"><b>${start ? n1(start) : '–'}</b><span>start kg</span></div>
        <div class="stat"><b>${n1(c.goalWeight)}</b><span>goal kg</span></div>
        <div class="stat"><b>${n2(c.rate)}</b><span>kg / week</span></div>
      </div>
      <div class="stack-sm">${weeks.map((w) => `<div class="card ct-week${w.week === cur ? ' on' : ''}${w.deload ? ' deload' : ''}${w.buffer ? ' buffer' : ''}">
        <div class="row between"><b>Week ${w.week} · ${esc(w.phase)}${w.week === cur ? ' <span class="pill accent">Now</span>' : ''}</b>
          <b>${w.target ? `${n1(w.target)} kg` : '—'}</b></div>
        ${w.from ? `<p class="tiny muted">${esc(niceDate(fromDay(w.from)))} – ${esc(niceDate(fromDay(w.to)))}</p>` : ''}
        <p class="small">${esc(w.focus)}${w.checkpoint ? ` <b>Checkpoint ${w.checkpoint}.</b>` : ''}</p>
        <p class="small muted">Quality: ${esc(w.quality.text)} · Easy: ${w.easyMin} min @ ${EASY_PACE}</p>
      </div>`).join('')}</div>
      <p class="tiny muted" style="margin:14px 2px">Target = trend weight at the end of the week. After the goal: +150 kcal per week for 3–4 weeks toward maintenance, keeping 65–66 kg.</p>` });
  });
}

// ---------- Me section ----------
export const meSection = {
  order: 5,
  render(el) {
    const c = cutSettings();
    const wk = weekNumber(c.startDate, today());
    const left = daysToGoal(c.startDate, today());
    const t = currentTargets(c);
    el.innerHTML = `<h3 class="section-title" style="margin-top:4px">Cut plan</h3>
      <div class="card"><div class="card-head" style="margin-bottom:6px"><h2>${c.startDate ? (wk ? `Week ${wk} of 11` : `Starts ${esc(niceDate(fromDay(c.startDate)))}`) : 'Not set up'}</h2>
        <button class="link" id="ct-edit">${c.startDate ? 'Edit' : 'Set up'}</button></div>
        <p class="small muted">Goal ${n1(c.goalWeight)} kg at ${n2(c.rate)} kg/week${c.startDate && wk ? ` · ${n0(left)} days to go` : ''}${t.kcal ? ` · ${n0(t.kcal)} kcal, ${n0(t.p || 0)} g protein, ${n0(t.steps)} steps` : ''}</p>
        <button class="ghost block" id="ct-plan" style="margin-top:12px">${icon('list')} View the plan</button></div>`;
    $('#ct-edit', el).onclick = openCutSettings;
    $('#ct-plan', el).onclick = openPlan;
  },
};
