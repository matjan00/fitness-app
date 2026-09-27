// Gym tracker: routine editor, routine actions and the one-tap starter programs.
import { $, $$, esc, icon, toast } from './util.js';
import * as store from './store.js';
import { push, page, chooseSheet, confirmSheet } from './nav.js';
import { fmtNum, routineFromWorkout } from './gym-calc.js';
import { loadDb, exName, exById, routines, restFor, modeFor } from './gym-data.js';
import { pickExercises, thumb, handleImgErrors } from './gym-lib.js';

const REST = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const restTxt = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Off');
export const programs = () => [...new Set(routines().map((r) => (r.program || '').trim()).filter(Boolean))].sort();

// Opens the editor. `routine` may be an existing routine, or a draft without id (e.g. from a workout).
export async function editRoutine(routine = null) {
  await loadDb().catch(() => {});
  const d = routine
    ? JSON.parse(JSON.stringify({ name: '', program: '', exercises: [], ...routine }))
    : { name: '', program: '', exercises: [] };
  const isNew = !d.id;
  push((el, s) => {
    handleImgErrors(el);
    const progs = programs();
    el.innerHTML = page({
      title: isNew ? 'New routine' : 'Edit routine',
      right: `<button class="primary gx-rsave">Save</button>`,
      body: `<div class="form gx-redit">
          <label>Routine name<input class="gx-rname" value="${esc(d.name)}" maxlength="60" placeholder="e.g. Push day" autocomplete="off"></label>
          <label><span>Program / folder <span class="tiny muted" style="font-weight:500">(optional)</span></span>
            <input class="gx-rprog" value="${esc(d.program || '')}" maxlength="40" placeholder="e.g. Push Pull Legs" autocomplete="off"></label>
          ${progs.length ? `<div class="chips gx-progchips">${progs.map((p) => `<button type="button" class="chip ${p === d.program ? 'on' : ''}" data-p="${esc(p)}">${icon('folder')} ${esc(p)}</button>`).join('')}</div>` : ''}
        </div>
        <h3 class="section-title">Exercises${d.exercises.length ? ` · ${d.exercises.length}` : ''}</h3>
        <div class="stack gx-rexs">${d.exercises.map((x, i) => exRow(x, i, d.exercises.length)).join('')
          || `<div class="card empty small">No exercises yet — add some below.</div>`}</div>
        <button class="primary block gx-radd" style="margin-top:14px">${icon('plus')} Add exercises</button>`,
    });
    const f = (sel) => $(sel, el);
    f('.gx-rname').oninput = (e) => { d.name = e.target.value; };
    f('.gx-rprog').oninput = (e) => {
      d.program = e.target.value;
      $$('.gx-progchips .chip', el).forEach((c) => c.classList.toggle('on', c.dataset.p === d.program.trim()));
    };
    const chips = f('.gx-progchips');
    if (chips) {
      chips.onclick = (e) => {
        const b = e.target.closest('[data-p]');
        if (!b) return;
        d.program = d.program === b.dataset.p ? '' : b.dataset.p;
        f('.gx-rprog').value = d.program;
        $$('.chip', chips).forEach((c) => c.classList.toggle('on', c.dataset.p === d.program));
      };
    }
    f('.gx-rexs').oninput = (e) => {
      const card = e.target.closest('[data-i]');
      if (!card) return;
      const x = d.exercises[+card.dataset.i];
      const k = e.target.dataset.f;
      if (k === 'sets') x.sets = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
      else if (k === 'kg') { const n = Number(String(e.target.value).replace(',', '.')); x.kg = e.target.value.trim() === '' || !Number.isFinite(n) ? null : n; }
      else if (k === 'reps') x.reps = e.target.value.trim();
    };
    f('.gx-rexs').onchange = (e) => {
      const card = e.target.closest('[data-i]');
      if (card && e.target.dataset.f === 'rest') d.exercises[+card.dataset.i].rest = Number(e.target.value);
      if (card && e.target.dataset.f === 'sets') e.target.value = d.exercises[+card.dataset.i].sets;
    };
    f('.gx-rexs').onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const i = +b.closest('[data-i]').dataset.i;
      const a = b.dataset.a;
      if (a === 'up' && i > 0) [d.exercises[i - 1], d.exercises[i]] = [d.exercises[i], d.exercises[i - 1]];
      else if (a === 'down' && i < d.exercises.length - 1) [d.exercises[i + 1], d.exercises[i]] = [d.exercises[i], d.exercises[i + 1]];
      else if (a === 'del') d.exercises.splice(i, 1);
      else return;
      s.render();
    };
    f('.gx-radd').onclick = async () => {
      const ids = await pickExercises({ multi: true });
      if (!ids.length) return;
      d.exercises.push(...ids.map((id) => {
        const m = modeFor(id);
        return { exercise_id: id, sets: 3, reps: m === 't' ? '60' : '8-12', kg: null, rest: restFor(id) };
      }));
      s.render();
      requestAnimationFrame(() => $('.gx-rexs', el)?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    };
    f('.gx-rsave').onclick = async () => {
      d.name = d.name.trim();
      d.program = (d.program || '').trim();
      if (!d.name) { toast('Give the routine a name'); f('.gx-rname').focus(); return; }
      if (!d.exercises.length) { toast('Add at least one exercise'); return; }
      if (isNew) d.order = Date.now();
      await store.put('routine', d);
      toast(isNew ? 'Routine created' : 'Routine saved');
      s.close();
    };
    if (isNew && !d.name) setTimeout(() => f('.gx-rname')?.focus(), 300);
  });
}

function exRow(x, i, n) {
  const t = modeFor(x.exercise_id) === 't';
  return `<div class="card gx-rex" data-i="${i}">
    <div class="gx-rexh">${thumb(x.exercise_id, 'sm')}<b class="grow ellipsis">${esc(exName(x.exercise_id))}</b>
      <button class="icon-btn" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
      <button class="icon-btn" data-a="down" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
      <button class="icon-btn danger-text" data-a="del" aria-label="Remove">${icon('close')}</button></div>
    <div class="gx-rfields ${t ? 'c3' : ''}">
      <label>Sets<input data-f="sets" type="text" inputmode="numeric" value="${esc(x.sets)}"></label>
      <label>${t ? 'Secs' : 'Reps'}<input data-f="reps" type="text" inputmode="${t ? 'numeric' : 'text'}" value="${esc(x.reps ?? '')}" placeholder="${t ? '60' : '8-12'}"></label>
      ${t ? '' : `<label>Kg<input data-f="kg" type="text" inputmode="decimal" value="${x.kg != null ? esc(fmtNum(x.kg)) : ''}" placeholder="–"></label>`}
      <label>Rest<select data-f="rest">${REST.map((r) => `<option value="${r}" ${Number(x.rest ?? 90) === r ? 'selected' : ''}>${restTxt(r)}</option>`).join('')}</select></label>
    </div>
  </div>`;
}

export async function routineMenu(r) {
  const v = await chooseSheet(r.name, [
    { value: 'edit', label: 'Edit routine', icon: 'edit' },
    { value: 'dup', label: 'Duplicate', icon: 'list' },
    { value: 'del', label: 'Delete routine', icon: 'trash', danger: true },
  ]);
  if (v === 'edit') editRoutine(r);
  else if (v === 'dup') {
    const { id, ...rest } = r;
    await store.put('routine', { ...rest, name: `${r.name} (copy)`, order: Date.now() });
    toast('Routine duplicated');
  } else if (v === 'del') {
    if (await confirmSheet(`Delete routine “${r.name}”? Past workouts are kept.`, { ok: 'Delete', danger: true })) {
      await store.remove(r.id);
      toast('Routine deleted');
    }
  }
}

export function saveWorkoutAsRoutine(w) {
  editRoutine({ name: w.name || 'My routine', program: '', exercises: routineFromWorkout(w) });
}

// ---------- starter programs ----------
const X = (exercise_id, sets, reps, rest) => ({ exercise_id, sets, reps, kg: null, rest });
const STARTERS = {
  ppl: {
    program: 'Push Pull Legs',
    routines: [
      { name: 'Push', exercises: [X('Barbell_Bench_Press_-_Medium_Grip', 4, '6-8', 150), X('Incline_Dumbbell_Press', 3, '8-12', 120),
        X('Dumbbell_Shoulder_Press', 3, '8-12', 120), X('Side_Lateral_Raise', 3, '12-15', 60),
        X('Triceps_Pushdown_-_Rope_Attachment', 3, '10-12', 60), X('Triceps_Overhead_Extension_with_Rope', 3, '10-12', 60)] },
      { name: 'Pull', exercises: [X('Wide-Grip_Lat_Pulldown', 4, '8-10', 120), X('Bent_Over_Barbell_Row', 3, '6-10', 150),
        X('Seated_Cable_Rows', 3, '10-12', 90), X('Face_Pull', 3, '12-15', 60), X('Barbell_Curl', 3, '8-12', 75), X('Hammer_Curls', 3, '10-12', 60)] },
      { name: 'Legs', exercises: [X('Barbell_Squat', 4, '5-8', 180), X('Romanian_Deadlift', 3, '8-10', 150), X('Leg_Press', 3, '10-12', 120),
        X('Lying_Leg_Curls', 3, '10-12', 75), X('Standing_Calf_Raises', 4, '10-15', 60), X('Hanging_Leg_Raise', 3, '10-15', 60)] },
    ],
  },
  full: {
    program: 'Full Body',
    routines: [
      { name: 'Full Body A', exercises: [X('Barbell_Squat', 3, '5-8', 180), X('Barbell_Bench_Press_-_Medium_Grip', 3, '5-8', 150),
        X('Bent_Over_Barbell_Row', 3, '8-10', 120), X('Dumbbell_Shoulder_Press', 3, '8-12', 90), X('Plank', 3, '45', 60)] },
      { name: 'Full Body B', exercises: [X('Barbell_Deadlift', 3, '5', 180), X('Incline_Dumbbell_Press', 3, '8-12', 120),
        X('Wide-Grip_Lat_Pulldown', 3, '8-12', 90), X('Dumbbell_Lunges', 3, '10-12', 90), X('Side_Lateral_Raise', 3, '12-15', 60),
        X('Dumbbell_Bicep_Curl', 2, '10-12', 60)] },
    ],
  },
};

export async function addStarters() {
  const v = await chooseSheet('Add starter routines', [
    { value: 'ppl', label: 'Push / Pull / Legs (3 days)', icon: 'folder' },
    { value: 'full', label: 'Full Body A / B (2–3 days)', icon: 'folder' },
    { value: 'both', label: 'Both programs', icon: 'plus' },
  ]);
  if (!v) return;
  await loadDb().catch(() => {});
  const keys = v === 'both' ? ['ppl', 'full'] : [v];
  let order = Date.now();
  const items = [];
  for (const k of keys) {
    for (const r of STARTERS[k].routines) {
      items.push({
        name: r.name, program: STARTERS[k].program, order: order++,
        exercises: r.exercises.filter((x) => exById(x.exercise_id)),
      });
    }
  }
  await store.putMany('routine', items);
  toast(`Added ${items.length} routines`);
}
