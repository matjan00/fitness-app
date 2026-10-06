// Gym tracker: the active workout screen (logging sets, rest timer, finish + summary) and editing past workouts.
//
// The workout in progress lives in localStorage ('gym.active') and is saved on every change, so closing the
// app never loses it. Inputs update the model directly; the screen only re-renders on structural changes
// (adding/removing sets or exercises), so the keyboard never loses focus while typing.
import { $, $$, esc, icon, toast, uid, parseNum, clock, mins, bigKg, niceDate, niceTime } from './util.js';
import * as store from './store.js';
import { push, chooseSheet, confirmSheet } from './nav.js';
import {
  MODES, fmtNum, fmtDur, firstInt, previousSet, parseRepRange, suggestNext, weightStep, isStalled, deloadKg, exerciseSeries, lastSessions, exerciseRecords, setMetric, kindsFor, isWorking,
  workoutVolume, workoutDuration, formatSet, bestSet, routineFromWorkout, routineChanged,
} from './gym-calc.js';
import {
  loadDb, exName, groupsOf, modeFor, restFor, settings, saveSettings, workouts, last, prsOf, getActive, saveActive, clearActive,
} from './gym-data.js';
import { pickExercises, openExercise, thumb, handleImgErrors, setLabels, prListHtml } from './gym-lib.js';
import { cutContext, rxFor, judgeWorkout } from './cut-gym.js';
import { setMark, setsText, VERDICT, SESSION_VERDICT, planSlot } from './cut-engine.js';

// Mark of a ticked set against today's target (cut workouts): coloured glyph + label for screen readers.
const MARK_GLYPH = { up: '▲', on: '=', down: '▼' };
const MARK_LABEL = { up: 'Above target', on: 'On target', down: 'Below target' };

let active = null;          // the workout in progress (same object that is saved to localStorage)
export const activeWorkout = () => active;
const persist = () => { if (active) saveActive(active); };

export function initWorkout() {
  active = getActive();
  if (active && !Array.isArray(active.exercises)) { active = null; clearActive(); }
  if (active) { ensureTicker(); wake(true); }
}

const REST_CHOICES = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const restLabel = (s) => (s ? fmtDur(s) : 'Off');

// ---------- sets ----------
const newSet = (o = {}) => ({ type: 'n', kg: '', reps: '', m: '', s: '', done: false, tk: '', tr: '', ...o });
function makeEntry(exId, r = null) {
  const mode = modeFor(exId);
  const prev = last().get(exId);
  let sets;
  if (r) {
    const n = Math.max(1, Math.min(20, Number(r.sets) || 3));
    sets = Array.from({ length: n }, () => newSet({ tk: r.kg != null && r.kg !== '' ? fmtNum(r.kg) : '', tr: r.reps != null ? String(r.reps) : '' }));
  } else if (prev?.sets?.length) {
    sets = prev.sets.slice(0, 12).map((p) => newSet({ type: p.type || 'n' }));
  } else {
    sets = [newSet(), newSet(), newSet()];
  }
  return { k: uid(), exercise_id: exId, name: exName(exId), note: null, mode, rest: r?.rest ?? restFor(exId), sets };
}

// Cut plan workout: the slot (rep range, kind) and today's prescription become the set targets (tk/tr).
function applyRx(e, ctx, slot) {
  const { slot: sl, rx, sets } = rxFor(e.exercise_id, ctx, slot);
  if (!sl) return e;
  e.slot = { name: sl.name, reps: sl.reps, sets: sl.sets, kind: sl.kind, alt: sl.alt, exercise_id: sl.exercise_id };
  e.rx = rx;
  e.rest = sl.rest ?? e.rest;
  const lo = sl.reps.split('-')[0];
  e.sets = Array.from({ length: sets }, (_, i) => newSet({ tk: rx ? String(rx.kg) : '', tr: rx ? String(rx.reps[i]) : lo }));
  return e;
}

// Values a set would get when ticked with empty inputs: previous numbers, else routine target.
// In a cut workout the prescription comes first (one tap confirms the target).
function fillValues(e, i, prevMap) {
  const set = e.sets[i];
  const sess = prevMap.get(e.exercise_id);
  const p = sess && (sess.mode || 'wr') === e.mode ? previousSet(sess, i, e.sets) : null;
  const above = e.sets[i - 1];
  if (e.rx && e.mode !== 't') return { kg: set.tk || (p?.kg != null ? fmtNum(p.kg) : ''), reps: set.tr || '' };
  if (e.mode === 't') {
    const secs = p?.secs ?? firstInt(set.tr);
    if (secs != null) return { m: String(Math.floor(secs / 60)), s: String(secs % 60) };
    return { m: above?.m || '', s: above?.s || '' };
  }
  const kg = p ? (p.kg != null && p.kg !== '' ? fmtNum(p.kg) : '') : set.tk || '';
  const reps = p?.reps != null ? String(p.reps) : set.tr || '';
  // Nothing from last time or the routine: fall back to the set above.
  return { kg: kg || (p ? '' : above?.kg || ''), reps: reps || above?.reps || '' };
}
function setValues(s, mode) {
  if (mode === 't') {
    const secs = Math.round((parseNum(s.m) || 0) * 60 + (parseNum(s.s) || 0));
    return { type: s.type, secs };
  }
  const reps = parseNum(s.reps);
  const kg = parseNum(s.kg);
  return { type: s.type, kg: mode === 'bw' ? (kg || null) : kg, reps: reps == null ? null : Math.round(reps) };
}
function validSet(v, mode) {
  if (mode === 't') return v.secs > 0;
  return v.reps > 0 && (mode === 'bw' || (v.kg != null && v.kg >= 0));
}

// Workout record from a session. Returns { exercises, dropped }.
function collect(sess) {
  let dropped = 0;
  const exercises = [];
  for (const e of sess.exercises) {
    const sets = [];
    for (const s of e.sets) {
      const v = setValues(s, e.mode);
      if (!s.done || !validSet(v, e.mode)) { dropped++; continue; }
      sets.push(v);
    }
    if (sets.length) exercises.push({ exercise_id: e.exercise_id, name: exName(e.exercise_id, e.name), note: (e.note || '').trim(), mode: e.mode, rest: e.rest, sets });
  }
  return { exercises, dropped };
}

const liveStats = (sess) => {
  let vol = 0, n = 0;
  for (const e of sess.exercises) {
    for (const s of e.sets) {
      if (!s.done) continue;
      n++;
      const v = setValues(s, e.mode);
      if (isWorking(v) && e.mode !== 't') vol += (v.kg || 0) * (v.reps || 0);
    }
  }
  return `${bigKg(vol)} · ${n} set${n === 1 ? '' : 's'}`;
};

// ---------- start / resume ----------
const defaultName = () => {
  const h = new Date().getHours();
  return h < 11 ? 'Morning workout' : h < 17 ? 'Afternoon workout' : 'Evening workout';
};

export async function startWorkout(routine = null) {
  if (active) {
    const v = await chooseSheet('A workout is already in progress', [
      { value: 'resume', label: `Resume “${active.name}”`, icon: 'play' },
      { value: 'discard', label: 'Discard it and start new', icon: 'trash', danger: true },
    ]);
    if (v === 'resume') return openActive();
    if (v !== 'discard') return;
    endActive();
  }
  await loadDb().catch(() => {});
  active = {
    id: uid(),
    name: routine?.name || defaultName(),
    routine_id: routine?.id || null,
    started_at: new Date().toISOString(),
    notes: '',
    exercises: (routine?.exercises || []).filter((r) => r.exercise_id).map((r) => makeEntry(r.exercise_id, r)),
    rest: null,
  };
  const ctx = cutContext(routine);
  if (ctx) {
    active.cut = ctx;
    active.exercises.forEach((e) => applyRx(e, ctx));
  }
  persist();
  ensureTicker();
  wake(true);
  openActive();
  if (!routine) setTimeout(() => $('.gx-workout .gx-addex')?.focus(), 300);
}

export async function openActive() {
  if (!active) return;
  if ($('.screen.gx-workout:not(.closing)')) return;
  await loadDb().catch(() => {});
  openSession(active, 'active');
}

function endActive() {
  active = null;
  clearActive();
  wake(false);
  tick();
}

export function editWorkout(w) {
  const sess = {
    id: w.id,
    name: w.name || 'Workout',
    routine_id: w.routine_id || null,
    started_at: w.started_at,
    ended_at: w.ended_at,
    notes: w.notes || '',
    exercises: (w.exercises || []).map((e) => ({
      k: uid(), exercise_id: e.exercise_id, name: e.name, note: e.note || null, mode: e.mode || 'wr', rest: e.rest ?? 90,
      sets: e.sets.map((s) => newSet({
        type: s.type || 'n', done: true,
        kg: s.kg != null ? fmtNum(s.kg) : '', reps: s.reps != null ? String(s.reps) : '',
        m: s.secs != null ? String(Math.floor(s.secs / 60)) : '', s: s.secs != null ? String(s.secs % 60) : '',
      })),
    })),
  };
  loadDb().catch(() => {}).then(() => openSession(sess, 'edit', w));
}

// ---------- the screen ----------
function openSession(sess, kind, original = null) {
  const isActive = kind === 'active';
  const prevMap = isActive ? last() : lastSessions(workouts(), { before: Date.parse(sess.started_at), exceptId: sess.id });
  const recCache = new Map();
  const bests = (id) => {
    if (!recCache.has(id)) {
      const all = isActive ? workouts() : workouts().filter((w) => w.id !== sess.id && Date.parse(w.started_at) < Date.parse(sess.started_at));
      recCache.set(id, exerciseRecords(all, id));
    }
    return recCache.get(id);
  };
  const save = isActive ? persist : () => {};
  let view = 'log';
  let summary = null;
  let focusAfter = null;

  const isPR = (e, s) => {
    if (!s.done) return false;
    const v = setValues(s, e.mode);
    if (!isWorking(v)) return false;
    const rec = bests(e.exercise_id);
    return kindsFor(e.mode).some((k) => rec[k] && setMetric(v, k, e.mode) > rec[k].value);
  };

  function rowHtml(e, i, labels) {
    const s = e.sets[i];
    const sess2 = prevMap.get(e.exercise_id);
    const p = sess2 && (sess2.mode || 'wr') === e.mode ? previousSet(sess2, i, e.sets) : null;
    const f = fillValues(e, i, prevMap);
    const prevTxt = p ? formatSet(p, e.mode) : '';
    const inp = (field, ph, mode, hint) => `<input class="gx-in" data-f="${field}" type="text" inputmode="${mode}" enterkeyhint="${hint}" autocomplete="off" placeholder="${esc(ph || '–')}" value="${esc(s[field])}" aria-label="${field}">`;
    const cells = e.mode === 't'
      ? inp('m', f.m, 'numeric', 'next') + inp('s', f.s, 'numeric', 'done')
      : inp('kg', f.kg || (e.mode === 'bw' ? '+0' : ''), 'decimal', 'next') + inp('reps', f.reps, 'numeric', 'done');
    return `<div class="gx-row t-${s.type} ${s.done ? 'done' : ''}" data-i="${i}">
      <button class="gx-tag t-${s.type}" data-act="type" aria-label="Set type">${labels[i]}</button>
      <button class="gx-prev" data-act="prev" ${p ? '' : 'disabled'}>${prevTxt ? esc(prevTxt) : '–'}</button>
      ${cells}
      <button class="gx-chk" data-act="check" aria-label="Complete set">${icon('check')}</button>
      ${isPR(e, s) ? `<span class="gx-rowpr">${icon('trophy')}</span>` : ''}${markHtml(e, s)}
    </div>`;
  }

  // ⬆️ / ➡️ / ⬇️ of a ticked set against today's target (cut workouts).
  function markHtml(e, s) {
    if (!e.rx || !s.done || e.mode === 't') return '';
    const m = setMark({ kg: parseNum(s.tk) || 0, reps: parseNum(s.tr) }, setValues(s, e.mode));
    return m ? `<span class="ct-mark ${m}" role="img" aria-label="${MARK_LABEL[m]}" title="${MARK_LABEL[m]}">${MARK_GLYPH[m]}</span>` : '';
  }

  // "Go up: 62.5 kg × 8" from last time's sets and the routine's rep range (default 8-12); deload when stalled.
  function hintHtml(e) {
    if (e.slot && e.mode !== 't') {
      const bw = e.mode === 'bw';
      if (!e.rx) return `<p class="gx-hint">${e.sets.length} × ${esc(e.slot.reps)} · first time: work up to a weight that leaves ~2 reps in reserve (RPE 7–8). <span>That becomes your baseline.</span></p>`;
      return `<p class="gx-hint">Target ${esc(setsText(e.rx.kg, e.rx.reps.slice(0, e.sets.length), bw))} <span>${esc(e.rx.text)}</span></p>`;
    }
    if (e.mode !== 'wr') return '';
    const sess = prevMap.get(e.exercise_id);
    if (!sess || (sess.mode || 'wr') !== 'wr') return '';
    if (isStalled(exerciseSeries(workouts(), e.exercise_id), 'wr')) {
      const d = deloadKg(sess.sets);
      return d ? `<p class="gx-hint">Stalled 3+ sessions — try a lighter week: ${esc(fmtNum(d))} kg <span>(about 10% less)</span></p>` : '';
    }
    const range = parseRepRange(e.sets.find((s) => s.tr)?.tr);
    const sg = suggestNext(sess.sets, range, weightStep(groupsOf(e.exercise_id)));
    return sg ? `<p class="gx-hint">${esc(sg.text)} <span>${esc(sg.why)}</span></p>` : '';
  }

  function exHtml(e, ei) {
    const labels = setLabels(e.sets);
    const heads = e.mode === 't' ? '<span>MIN</span><span>SEC</span>' : e.mode === 'bw' ? '<span>+KG</span><span>REPS</span>' : '<span>KG</span><span>REPS</span>';
    return `<section class="card gx-exc" data-k="${e.k}" data-ei="${ei}">
      <div class="gx-exh">
        <button class="gx-exname" data-act="info">${thumb(e.exercise_id, 'sm')}${e.slot && e.slot.exercise_id === e.exercise_id
          ? `<span class="ct-exname"><span class="ellipsis">${esc(e.slot.name)}</span><span class="tiny muted ellipsis">${esc(exName(e.exercise_id, e.name))}</span></span>`
          : `<span class="ellipsis">${esc(exName(e.exercise_id, e.name))}</span>`}</button>
        <button class="icon-btn" data-act="menu" aria-label="Exercise options">${icon('more')}</button>
      </div>
      <div class="gx-exmeta">
        ${isActive ? `<button class="pill ${e.rest ? 'accent' : ''}" data-act="rest">${icon('timer')} ${e.rest ? `Rest ${restLabel(e.rest)}` : 'Rest off'}</button>` : ''}
        ${e.mode !== 'wr' ? `<button class="pill" data-act="mode">${esc(MODES[e.mode])}</button>` : ''}
      </div>
      ${e.note != null ? `<textarea class="gx-note" data-act="note" rows="1" placeholder="Add a note…">${esc(e.note)}</textarea>` : ''}
      ${isActive ? hintHtml(e) : ''}
      <div class="gx-sets">
        <div class="gx-shead"><span>SET</span><span>PREVIOUS</span>${heads}<span class="gx-hchk">${icon('check')}</span></div>
        ${e.sets.map((_, i) => rowHtml(e, i, labels)).join('')}
      </div>
      <button class="gx-addset" data-act="addset">${icon('plus')} Add set</button>
    </section>`;
  }

  function logHtml() {
    const dt = new Date(sess.started_at);
    const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const head = isActive
      ? `<header class="bar gx-wbar">
          <button class="icon-btn" data-nav="back" aria-label="Minimize">${icon('down')}</button>
          <div class="bar-title"><h1 data-gx-elapsed>${clock((Date.now() - Date.parse(sess.started_at)) / 1000)}</h1><p class="gx-live">${liveStats(sess)}</p></div>
          <div class="bar-right"><button class="primary gx-finish">Finish</button></div>
        </header>`
      : `<header class="bar gx-wbar">
          <button class="icon-btn" data-nav="back" aria-label="Cancel">${icon('close')}</button>
          <div class="bar-title"><h1>Edit workout</h1></div>
          <div class="bar-right"><button class="primary gx-save">Save</button></div>
        </header>`;
    const meta = isActive ? '' : `<div class="form-row gx-editmeta">
        <label>Start<input type="datetime-local" class="gx-start" value="${localIso}"></label>
        <label>Duration (min)<input type="text" inputmode="numeric" class="gx-dur" value="${Math.round(workoutDuration(sess) / 60)}"></label>
      </div>`;
    return `${head}
      <div class="scroll gx-wscroll">
        <div class="gx-whead">
          <input class="gx-wname" value="${esc(sess.name)}" maxlength="60" aria-label="Workout name" enterkeyhint="done">
          ${meta}
          <textarea class="gx-wnote" rows="1" placeholder="Workout note…" aria-label="Workout note">${esc(sess.notes)}</textarea>
        </div>
        ${sess.exercises.length ? sess.exercises.map(exHtml).join('') : `<div class="card empty gx-noex">${icon('gym')}<p><b>Let's get moving</b><br>Add your first exercise to start logging sets.</p></div>`}
        <button class="primary block gx-addex">${icon('plus')} Add exercise</button>
        ${isActive ? `<button class="ghost block gx-discard danger-text">Discard workout</button>` : `<button class="ghost block gx-delete danger-text">Delete workout</button>`}
      </div>
      ${isActive ? restBarHtml() : ''}`;
  }

  push((el, s) => {
    handleImgErrors(el);
    if (view === 'summary') { el.innerHTML = summaryHtml(summary); bindSummary(el, s, summary); return; }
    el.innerHTML = logHtml();
    if (isActive) { tick(); }
    autosize($$('textarea', el));
    if (focusAfter) {
      const f = focusAfter;
      focusAfter = null;
      requestAnimationFrame(() => {
        const card = $(`.gx-exc[data-k="${f.k}"]`, el);
        const target = f.sel ? $(f.sel, card) : card;
        if (card && f.scroll) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (target && f.sel) target.focus();
      });
    }

    const entry = (node) => {
      const c = node.closest('.gx-exc');
      return c ? sess.exercises.find((x) => x.k === c.dataset.k) : null;
    };

    el.oninput = (ev) => {
      const t = ev.target;
      if (t.classList.contains('gx-wname')) { sess.name = t.value; save(); return; }
      if (t.classList.contains('gx-wnote')) { sess.notes = t.value; autosize([t]); save(); return; }
      const e = entry(t);
      if (!e) return;
      if (t.classList.contains('gx-note')) { e.note = t.value; autosize([t]); save(); return; }
      if (t.classList.contains('gx-in')) {
        const row = t.closest('.gx-row');
        const set = e.sets[+row.dataset.i];
        set[t.dataset.f] = t.value;
        save();
        if (set.done) updateRow(e, +row.dataset.i, row);
      }
    };
    el.onfocusin = (ev) => { if (ev.target.classList.contains('gx-in')) ev.target.select(); };
    el.onkeydown = (ev) => {
      const t = ev.target;
      if (ev.key !== 'Enter') return;
      if (t.classList.contains('gx-wname')) { t.blur(); return; }
      if (t.classList.contains('gx-in')) {
        ev.preventDefault();
        const ins = $$('.gx-in', t.closest('.gx-row'));
        const i = ins.indexOf(t);
        if (i < ins.length - 1) ins[i + 1].focus(); else t.blur();
      }
    };

    el.onclick = async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('gx-finish')) return finish(s);
      if (b.classList.contains('gx-save')) return saveEdit(s);
      if (b.classList.contains('gx-addex')) return addExercises(s);
      if (b.classList.contains('gx-discard')) {
        if (await confirmSheet('Discard this workout? Nothing will be saved.', { ok: 'Discard', danger: true })) {
          endActive();
          s.close();
          toast('Workout discarded');
        }
        return;
      }
      if (b.classList.contains('gx-delete')) {
        if (await confirmSheet('Delete this workout permanently?', { ok: 'Delete', danger: true })) {
          await store.remove(sess.id);
          toast('Workout deleted');
          s.close();
        }
        return;
      }
      const rb = b.dataset.rest;
      if (rb) {
        if (!active?.rest) return;
        if (rb === 'skip') active.rest = null;
        else {
          active.rest.end += Number(rb) * 1000;
          const rem = (active.rest.end - Date.now()) / 1000;
          if (rem <= 0) active.rest = null; else active.rest.total = Math.max(active.rest.total, rem);
        }
        persist();
        tick();
        return;
      }
      const act = b.dataset.act;
      if (!act) return;
      const e = entry(b);
      if (!e) return;
      const row = b.closest('.gx-row');
      const i = row ? +row.dataset.i : -1;
      switch (act) {
        case 'check': return toggleSet(e, i, row);
        case 'prev': {
          const ps = prevMap.get(e.exercise_id);
          const p = ps && (ps.mode || 'wr') === e.mode ? previousSet(ps, i, e.sets) : null;
          if (!p) return;
          const set = e.sets[i];
          if (e.mode === 't') { set.m = String(Math.floor((p.secs || 0) / 60)); set.s = String((p.secs || 0) % 60); }
          else { set.kg = p.kg != null ? fmtNum(p.kg) : ''; set.reps = p.reps != null ? String(p.reps) : ''; }
          $$('.gx-in', row).forEach((x) => { x.value = set[x.dataset.f]; });
          save();
          return;
        }
        case 'type': {
          const v = await chooseSheet(`Set ${setLabels(e.sets)[i]}`, [
            { value: 'n', label: 'Normal set', icon: 'check' },
            { value: 'w', label: 'Warm-up (W)', icon: 'fire' },
            { value: 'd', label: 'Drop set (D)', icon: 'down' },
            { value: 'f', label: 'Failure (F)', icon: 'up' },
            { value: 'del', label: 'Delete set', icon: 'trash', danger: true },
          ]);
          if (!v) return;
          if (v === 'del') e.sets.splice(i, 1); else e.sets[i].type = v;
          save();
          s.render();
          return;
        }
        case 'addset': {
          const lastSet = e.sets[e.sets.length - 1];
          e.sets.push(newSet(lastSet ? { kg: lastSet.kg, reps: lastSet.reps, m: lastSet.m, s: lastSet.s, tk: lastSet.tk, tr: lastSet.tr, type: lastSet.type === 'w' ? 'n' : lastSet.type } : {}));
          save();
          s.render();
          return;
        }
        case 'info': return openExercise(e.exercise_id);
        case 'rest': return chooseRest(e, s);
        case 'mode': return chooseMode(e, s);
        case 'menu': return exMenu(e, s);
        default:
      }
    };
  }, { className: isActive ? 'gx-workout' : 'gx-workout gx-editing' });

  function updateRow(e, i, row) {
    const s = e.sets[i];
    row.classList.toggle('done', s.done);
    $('.gx-rowpr', row)?.remove();
    $('.ct-mark', row)?.remove();
    const badge = (isPR(e, s) ? `<span class="gx-rowpr">${icon('trophy')}</span>` : '') + markHtml(e, s);
    if (badge) row.insertAdjacentHTML('beforeend', badge);
    const live = $('.gx-live', row.closest('.screen'));
    if (live) live.textContent = liveStats(sess);
  }

  function toggleSet(e, i, row) {
    const s = e.sets[i];
    if (s.done) {
      s.done = false;
      save();
      updateRow(e, i, row);
      return;
    }
    const f = fillValues(e, i, prevMap);
    for (const k of Object.keys(f)) if (s[k] === '' && f[k] !== '') s[k] = e.mode === 't' || k === 'kg' ? f[k] : String(firstInt(f[k]) ?? '');
    const v = setValues(s, e.mode);
    $$('.gx-in', row).forEach((x) => { x.value = s[x.dataset.f]; });
    if (!validSet(v, e.mode)) {
      const need = e.mode === 't' ? '.gx-in[data-f="s"]' : v.reps > 0 ? '.gx-in[data-f="kg"]' : '.gx-in[data-f="reps"]';
      toast(e.mode === 't' ? 'Enter a time first' : v.reps > 0 ? 'Enter the weight first' : 'Enter reps first');
      $(need, row)?.focus();
      return;
    }
    s.done = true;
    save();
    updateRow(e, i, row);
    row.classList.remove('pop');
    void row.offsetWidth;
    row.classList.add('pop');
    buzz(15);
    if (isActive) {
      unlockAudio();
      if (e.rest > 0) {
        active.rest = { end: Date.now() + e.rest * 1000, total: e.rest, k: e.k };
        persist();
        tick();
      }
    }
    // Move focus to the next unfinished set of this exercise if the keyboard is open.
    const next = e.sets.findIndex((x, j) => j > i && !x.done);
    if (next >= 0 && document.activeElement?.classList.contains('gx-in')) $('.gx-in', $$('.gx-row', row.parentNode)[next])?.focus();
    else document.activeElement?.blur?.();
  }

  async function chooseRest(e, s) {
    const v = await chooseSheet(`Rest timer · ${exName(e.exercise_id, e.name)}`, REST_CHOICES.map((r) => ({ value: String(r), label: r ? `${restLabel(r)}${r === e.rest ? '  ✓' : ''}` : `Off${!e.rest ? '  ✓' : ''}`, icon: 'timer' })));
    if (v == null) return;
    e.rest = Number(v);
    save();
    const st = settings();
    await saveSettings({ rests: { ...st.rests, [e.exercise_id]: e.rest } });
    s.render();
  }

  async function chooseMode(e, s) {
    const v = await chooseSheet('Tracking type', Object.entries(MODES).map(([k, l]) => ({ value: k, label: `${l}${k === e.mode ? '  ✓' : ''}` })));
    if (!v || v === e.mode) return;
    e.mode = v;
    const st = settings();
    await saveSettings({ modes: { ...st.modes, [e.exercise_id]: v } });
    save();
    s.render();
  }

  async function exMenu(e, s) {
    const idx = sess.exercises.indexOf(e);
    const opts = [
      ...(isActive ? [{ value: 'rest', label: `Rest timer (${restLabel(e.rest)})`, icon: 'timer' }] : []),
      ...(e.slot && active?.cut ? [e.slot.alt && e.exercise_id !== e.slot.alt ? { value: 'alt', label: `Swap to ${exName(e.slot.alt)}`, icon: 'swap' }
        : e.exercise_id !== e.slot.exercise_id ? { value: 'alt', label: `Back to ${exName(e.slot.exercise_id)}`, icon: 'swap' } : null].filter(Boolean) : []),
      { value: 'replace', label: 'Replace exercise', icon: 'swap' },
      ...(idx > 0 ? [{ value: 'up', label: 'Move up', icon: 'up' }] : []),
      ...(idx < sess.exercises.length - 1 ? [{ value: 'down', label: 'Move down', icon: 'down' }] : []),
      { value: 'note', label: e.note != null ? 'Remove note' : 'Add note', icon: 'note' },
      { value: 'mode', label: `Tracking: ${MODES[e.mode]}`, icon: 'list' },
      { value: 'remove', label: 'Remove exercise', icon: 'trash', danger: true },
    ];
    const v = await chooseSheet(exName(e.exercise_id, e.name), opts);
    if (!v) return;
    if (v === 'rest') return chooseRest(e, s);
    if (v === 'mode') return chooseMode(e, s);
    if (v === 'replace' || v === 'alt') {
      const id = v === 'alt' ? (e.exercise_id !== e.slot.alt ? e.slot.alt : e.slot.exercise_id) : (await pickExercises({ multi: false }))[0];
      if (!id) return;
      const fresh = makeEntry(id);
      e.exercise_id = id;
      e.name = fresh.name;
      e.mode = fresh.mode;
      if (isActive) e.rest = fresh.rest;
      e.sets = e.sets.map((x) => newSet({ type: x.type, done: false }));
      // A swapped exercise keeps the plan slot but is judged on its own history.
      if (isActive && active.cut && e.slot) applyRx(e, active.cut, { ...e.slot, rest: e.rest });
    } else if (v === 'up' || v === 'down') {
      const j = v === 'up' ? idx - 1 : idx + 1;
      [sess.exercises[idx], sess.exercises[j]] = [sess.exercises[j], sess.exercises[idx]];
      focusAfter = { k: e.k, scroll: true };
    } else if (v === 'note') {
      if (e.note != null) e.note = null;
      else { e.note = ''; focusAfter = { k: e.k, sel: '.gx-note' }; }
    } else if (v === 'remove') {
      const hasData = e.sets.some((x) => x.done);
      if (hasData && !(await confirmSheet(`Remove ${exName(e.exercise_id, e.name)} and its sets?`, { ok: 'Remove', danger: true }))) return;
      sess.exercises.splice(sess.exercises.indexOf(e), 1);
    }
    save();
    s.render();
  }

  async function addExercises(s) {
    const ids = await pickExercises({ multi: true });
    if (!ids.length) return;
    const added = ids.map((id) => makeEntry(id));
    if (!isActive) added.forEach((x) => { x.rest = restFor(x.exercise_id); });
    sess.exercises.push(...added);
    focusAfter = { k: added[0].k, scroll: true };
    save();
    s.render();
  }

  async function finish(s) {
    const { exercises, dropped } = collect(sess);
    if (!exercises.length) {
      if (await confirmSheet('No sets are ticked yet. Tick the sets you did (✓) before finishing — or discard this workout?', { ok: 'Discard workout', danger: true, cancel: 'Keep going' })) {
        endActive();
        s.close();
        toast('Workout discarded');
      }
      return;
    }
    if (dropped && !(await confirmSheet(`${dropped} set${dropped > 1 ? 's are' : ' is'} not ticked and will be dropped. Finish workout?`, { ok: 'Finish', cancel: 'Keep going' }))) return;
    const rec = {
      name: (sess.name || '').trim() || defaultName(),
      routine_id: sess.routine_id,
      started_at: sess.started_at,
      ended_at: new Date().toISOString(),
      notes: (sess.notes || '').trim(),
      exercises,
    };
    if (sess.cut) {
      const j = judgeWorkout({ ...rec, id: sess.id, exercises: exercises.map((x) => ({ ...x, slot: sess.exercises.find((y) => y.exercise_id === x.exercise_id)?.slot })) }, sess.cut);
      rec.cut = { ...sess.cut, session: j.session, verdicts: Object.fromEntries(j.exercises.filter((x) => x.verdict).map((x) => [x.exercise_id, x.verdict])) };
      sess.judged = j;
    }
    const saved = await store.put('workout', rec);
    endActive();
    summary = { w: saved, prs: prsOf(saved.id), cut: sess.judged || null };
    const r = !sess.cut && saved.routine_id && store.get(saved.routine_id);
    if (r) {
      const next = routineFromWorkout(saved, r);
      if (routineChanged(r.exercises || [], next)) summary.routine = { r, next };
    }
    view = 'summary';
    s.render();
    const sc = $('.scroll', s.el);
    if (sc) sc.scrollTop = 0;
  }

  async function saveEdit(s) {
    const { exercises, dropped } = collect(sess);
    if (!exercises.length) { toast('Tick at least one set, or delete the workout'); return; }
    if (dropped && !(await confirmSheet(`${dropped} unticked or empty set${dropped > 1 ? 's' : ''} will be removed. Save?`, { ok: 'Save' }))) return;
    const el = s.el;
    const start = $('.gx-start', el)?.value;
    const startMs = start ? new Date(start).getTime() : Date.parse(sess.started_at);
    const durMin = parseNum($('.gx-dur', el)?.value);
    const dur = durMin != null && durMin >= 0 ? durMin * 60000 : Date.parse(sess.ended_at) - Date.parse(sess.started_at);
    await store.put('workout', {
      ...original,
      id: sess.id,
      name: (sess.name || '').trim() || 'Workout',
      notes: (sess.notes || '').trim(),
      started_at: new Date(startMs).toISOString(),
      ended_at: new Date(startMs + dur).toISOString(),
      exercises,
    });
    toast('Workout saved');
    s.close();
  }
}

// ---------- finish summary ----------
// Cut plan: session verdict, verdict per exercise vs last time, e1RM change on main lifts, next prescription.
function cutSummaryHtml(cut, w) {
  const cls = { progressed: 'up', held: '', dropped: 'down', completed: '' }[cut.session];
  return `<div class="card ct-verdict"><div class="row between"><b>Session</b><span class="pill ${cls}">${esc(SESSION_VERDICT[cut.session])}</span></div>
    <p class="tiny muted" style="margin-top:6px">${cut.session === 'completed' ? 'Deload week: judged on completion only.' : 'Progressed: half the exercises beat last time and no main lift dropped. Held: no main lift dropped.'}</p></div>
    <h3 class="section-title">Vs last time · next session</h3>
    <div class="card list">${cut.exercises.map((x) => {
      const v = x.verdict ? VERDICT[x.verdict] : null;
      const e1 = x.main && x.e1rmPrev && x.e1rm ? ` · e1RM ${fmtNum(x.e1rmPrev)} → ${fmtNum(x.e1rm)} kg` : '';
      return `<div class="list-item"><div class="grow"><b class="ellipsis" style="display:block">${esc(planSlot(x.exercise_id)?.exercise_id === x.exercise_id ? planSlot(x.exercise_id).name : exName(x.exercise_id))}</b>
        <span class="sub">${v ? `${v[0]} ${v[1]}` : 'First time — baseline set'}${e1}</span>
        ${x.next ? `<span class="sub" style="display:block">Next: ${esc(setsText(x.next.kg, x.next.reps, x.mode === 'bw'))}</span>` : ''}</div></div>`;
    }).join('')}</div>`;
}

function summaryHtml({ w, prs, routine, routineDone, cut }) {
  const secs = workoutDuration(w);
  const nSets = w.exercises.reduce((a, e) => a + e.sets.length, 0);
  const confetti = Array.from({ length: 26 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--r:${(i * 53) % 360}deg;--c:${i % 4}"></i>`).join('');
  return `<header class="bar"><span></span><div class="bar-title"><h1>Workout complete</h1></div>
      <div class="bar-right"><button class="icon-btn" data-nav="back" aria-label="Close">${icon('close')}</button></div></header>
    <div class="scroll gx-sum">
      <div class="hero gx-sumhero"><div class="gx-confetti">${confetti}</div>
        <div class="gx-medal">${icon(prs.length ? 'trophy' : 'check')}</div>
        <h2>${prs.length ? `${prs.length} new record${prs.length > 1 ? 's' : ''}!` : 'Great work!'}</h2>
        <p class="muted">${esc(w.name)} · ${esc(niceDate(w.started_at, { weekday: true }))} ${esc(niceTime(w.started_at))}</p>
        <div class="stats">
          <div class="stat"><b>${mins(secs)}</b><span>Duration</span></div>
          <div class="stat"><b>${bigKg(workoutVolume(w))}</b><span>Volume</span></div>
          <div class="stat"><b>${nSets}</b><span>Sets</span></div>
        </div>
      </div>
      ${cut ? cutSummaryHtml(cut, w) : ''}
      ${prs.length ? `<h3 class="section-title">Personal records</h3>${prListHtml(prs)}` : ''}
      ${routine ? `<div class="card gx-upd"><div class="row">${icon('sync')}<div class="grow"><b>Update “${esc(routine.r.name)}”?</b>
          <p class="small muted">Use today's sets and weights as the new targets next time.</p></div></div>
          <button class="soft block gx-updbtn" ${routineDone ? 'disabled' : ''}>${routineDone ? 'Routine updated ✓' : "Update routine with today's numbers"}</button></div>` : ''}
      <h3 class="section-title">Exercises</h3>
      <div class="card list">${w.exercises.map((e) => {
        const b = bestSet(e);
        return `<div class="list-item">${thumb(e.exercise_id, 'sm')}<div class="grow"><b class="ellipsis" style="display:block">${esc(exName(e.exercise_id, e.name))}</b>
          <span class="sub">${e.sets.length} set${e.sets.length > 1 ? 's' : ''} · best ${esc(formatSet(b, e.mode, true))}</span></div></div>`;
      }).join('')}</div>
      <button class="primary block gx-done" style="margin-top:18px">Done</button>
    </div>`;
}
function bindSummary(el, s, sum) {
  $('.gx-done', el).onclick = () => s.close();
  const u = $('.gx-updbtn', el);
  if (u) {
    u.onclick = async () => {
      const cur = store.get(sum.routine.r.id) || sum.routine.r;
      await store.put('routine', { ...cur, exercises: sum.routine.next });
      sum.routineDone = true;
      toast('Routine updated');
      s.render();
    };
  }
}


// ---------- rest timer, elapsed clock, alarm ----------
let ticker = null;
let audio = null;
function ensureTicker() {
  if (!ticker) ticker = setInterval(tick, 250);
}
function restBarHtml() {
  return `<div class="gx-rest" hidden>
    <div class="gx-rest-track"><div class="gx-rest-fill"></div></div>
    <div class="gx-rest-row">
      <button class="gx-rbtn" data-rest="-15">−15</button>
      <div class="gx-rest-mid">${icon('timer')}<b data-gx-rest>0:00</b></div>
      <button class="gx-rbtn" data-rest="15">+15</button>
      <button class="gx-rbtn skip" data-rest="skip">Skip</button>
    </div>
  </div>`;
}
export function tick() {
  const now = Date.now();
  if (!active) {
    if (ticker) { clearInterval(ticker); ticker = null; }
    $$('.gx-rest').forEach((x) => { x.hidden = true; });
    return;
  }
  const el = clock((now - Date.parse(active.started_at)) / 1000);
  $$('[data-gx-elapsed]').forEach((x) => { if (x.textContent !== el) x.textContent = el; });
  const r = active.rest;
  if (r) {
    const rem = (r.end - now) / 1000;
    if (rem <= 0) {
      active.rest = null;
      persist();
      if (rem > -5) alarm();
    } else {
      const txt = clock(Math.ceil(rem));
      $$('[data-gx-rest]').forEach((x) => { x.textContent = txt; });
      $$('.gx-rest-fill').forEach((x) => { x.style.width = `${Math.min(100, (rem / r.total) * 100)}%`; });
      $$('.gx-rest').forEach((x) => { x.hidden = false; });
      $$('[data-gx-restwrap]').forEach((x) => { x.hidden = false; });
      return;
    }
  }
  $$('.gx-rest, [data-gx-restwrap]').forEach((x) => { x.hidden = true; });
}

function buzz(p) {
  try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(p); } catch { /* ignore */ }
}
function unlockAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function alarm() {
  buzz([250, 120, 250]);
  toast('Rest over — next set!');
  if (!settings().sound) return;
  try {
    unlockAudio();
    if (!audio) return;
    const t0 = audio.currentTime + 0.02;
    [0, 0.22, 0.44].forEach((d, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  } catch { /* ignore */ }
}

// ---------- keep the screen on ----------
let lock = null;
async function wake(on) {
  try {
    if (on && active && settings().wake && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
      if (!lock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      }
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch { lock = null; }
}
export const setWake = (on) => wake(on);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active) { wake(true); tick(); }
});

function autosize(list) {
  list.forEach((t) => { t.style.height = 'auto'; t.style.height = `${Math.min(200, t.scrollHeight + 2)}px`; });
}
