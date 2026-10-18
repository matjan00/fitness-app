// Cut plan weekly check-in and review, in two steps:
//  1. Check-in day (Sunday by default), in the morning: measurements and 3 photos (openCheckin). Optional nudge on Home.
//  2. The day after (Monday): the weekly review of the whole Monday–Sunday week, once Sunday's training and steps
//     are in: the numbers and grade, adjustment suggestions (Accept / Ignore, both logged) and a one-sentence
//     reflection. Measurements / photos from step 1 are shown and can still be added. Nothing is forced: a button on
//     Home from Monday to Wednesday, and a red flag after that.
//
// Records: one 'checkin' per week { day, forDay (the review day), waist, hips, chest, arm, thigh,
//   photos:{front,side,back → photo id}, reflection, grade, score, summary, suggestions:[{ key, text, choice }] };
//   until the review is done it holds only the measurements / photos. 'photo' { day, pose, data (JPEG data URL) }.

import { $, $$, esc, icon, toast, today, n0, n1, addDays } from './util.js';
import * as store from './store.js';
import { push, page } from './nav.js';
import { compressFile } from './food-photo.js';
import * as foodUi from './food-ui.js';
import { cutSettings, saveCut, currentTargets, startWeight, recordTargets } from './cut.js';
import { statusOf, sources } from './cut-today.js';
import { weekSummary, suggestions, liftChange, lastCheckinDay } from './cut-week.js';
import { dayFacts } from './cut-day.js';
import { runContext } from './run.js';
import { getPlan } from './run-plan-ui.js';
import * as RC from './run-coach.js';

const PARTS = [['waist', 'Waist (navel)'], ['hips', 'Hips'], ['chest', 'Chest'], ['arm', 'Arm (relaxed)'], ['thigh', 'Mid-thigh']];
const POSES = ['front', 'side', 'back'];
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// The review day is the day after the check-in day (Monday for a Sunday check-in): the last one on or before `day`,
// once the plan has run a full week before it. The review covers the 7 days before it.
export const reviewWeekday = (c = cutSettings()) => (+c.checkinDay + 1) % 7;
export function dueCheckin(day = today(), c = cutSettings()) {
  if (!c.startDate) return null;
  const r = lastCheckinDay(day, reviewWeekday(c));
  if (!r || r < addDays(c.startDate, 7)) return null; // the day after week 1 at the earliest
  return r;
}
// The week's check-in record (measurements / photos, and the review once done). Older records were keyed by the
// check-in day itself, the day before the review day.
export const checkinRecord = (r) => store.all('checkin').find((x) => x.forDay === r) || store.all('checkin').find((x) => x.forDay === addDays(r, -1));
// Done = this week's review has been completed (a grade given for this review day).
export const checkinFor = (r) => { const x = checkinRecord(r); return x?.grade && x.forDay === r ? x : null; };
// The review is due from the review day to 2 days after it (later it is a red flag); null when not due or done.
export function reviewNeeded(day = today()) {
  const r = dueCheckin(day);
  return r && day <= addDays(r, 2) && !checkinFor(r) ? r : null;
}
// Check-in day (Sunday) and the review days after it: measurements / photos still missing for the coming review.
// Returns the review day they are for, or null.
export function measurementsDue(day = today(), c = cutSettings()) {
  if (!c.startDate) return null;
  const isCheckinDay = new Date(`${day}T12:00`).getDay() === +c.checkinDay;
  const r = isCheckinDay ? addDays(day, 1) : reviewNeeded(day);
  if (!r || r < addDays(c.startDate, 7)) return null;
  const x = checkinRecord(r);
  return x && (x.waist > 0 || Object.keys(x.photos || {}).length) ? null : r;
}

function buildReview(ci) {
  const c = cutSettings();
  const src = sources();
  const tg = currentTargets(c);
  const st = (d) => statusOf(d, src, c, tg.kcal);
  const summary = weekSummary(ci, { statusOf: st, weights: src.weights, workouts: src.workouts, runs: src.runs, cfg: c, start: startWeight(c) });
  const last14 = range(addDays(ci, -14), addDays(ci, -1)).filter((d) => d >= c.startDate);
  const compliance = last14.length ? last14.filter((d) => ['green', 'yellow'].includes(st(d).status)).length / last14.length : 0;
  const sugg = suggestions({ weights: src.weights, checkinDay: ci, week: summary.week, compliance, targets: tg, cfg: c, liftDrop: liftChange(src.workouts, addDays(ci, -1)), sleep: summary.sleep });
  return { c, tg, summary, compliance, sugg };
}

// The week's running in one line: km, how much was easy, quality reps on target.
function runWeekLine(from, to) {
  let rc = null;
  try { rc = runContext(); } catch { /* run tab not loaded */ }
  if (!rc) return null;
  const inWeek = rc.runs.filter((r) => { const d = RC.dayKey(RC.startMs(r)); return d >= from && d <= to; });
  if (!inWeek.length) return null;
  const km = inWeek.reduce((a, r) => a + RC.km(r.distance_m), 0);
  const hard = inWeek.filter((r) => RC.HARD_TYPES.has(rc.classOf(r).type));
  const hardKm = hard.reduce((a, r) => a + RC.km(r.distance_m), 0);
  const plan = getPlan();
  let hit = 0, n = 0;
  for (const r of hard) {
    const sess = plan?.sessions.find((x) => x.doneRunId === r.id);
    const sc = sess?.targetPace && RC.repScore(rc.classOf(r), sess.targetPace);
    if (sc) { hit += sc.hit; n += sc.n; }
  }
  const parts = [`${km.toFixed(1)} km in ${inWeek.length} run${inWeek.length === 1 ? '' : 's'}`, `${Math.round(((km - hardKm) / km) * 100)}% easy`];
  if (n) parts.push(`${hit}/${n} reps on target`);
  const easy = inWeek.filter((r) => !RC.HARD_TYPES.has(rc.classOf(r).type)).map((r) => RC.easyRunChecks(r, rc.maxHr)).filter(Boolean);
  if (easy.some((x) => x.drift >= 5)) parts.push('easy-run heart rate drifted - check fuel and pace');
  return parts.join(' · ');
}

const vs = (v, t, unit = '', digits = 0) => (v == null ? '–' : `${digits ? n1(v) : n0(v)}${unit}${t ? ` <span class="muted">/ ${n0(t)}</span>` : ''}`);

export function openReview(ci = dueCheckin()) {
  if (!ci) { toast('The first review is after your first full week'); return; }
  const { c, tg, summary: s, compliance, sugg } = buildReview(ci);
  const rec = checkinRecord(ci);
  const prev = store.all('checkin').filter((x) => x !== rec && x.forDay !== ci).sort((a, b) => b.day.localeCompare(a.day))[0];
  const done = checkinFor(ci);
  const lastDay = addDays(ci, -1);
  const stepsMissing = dayFacts(lastDay, sources()).steps == null;
  const lastDayName = new Date(`${lastDay}T12:00`).toLocaleDateString('en-GB', { weekday: 'long' });
  const choice = Object.fromEntries((done?.suggestions || []).map((x) => [x.key, x.choice]));
  const photos = {};
  let completed = Boolean(done);
  push((el, scr) => {
    el.innerHTML = page({ title: 'Weekly review', body: `
      ${!completed && stepsMissing ? `<div class="card flat small" style="margin-bottom:12px">${icon('info')} ${esc(lastDayName)}'s steps are not in yet - they usually arrive later. You can close this and come back once they are.</div>` : ''}
      <p class="small muted" style="margin:0 2px 12px">Week ${s.week} · ${esc(new Date(`${s.from}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} – ${esc(new Date(`${s.to}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}. The numbers vs your targets, plainly.</p>
      <div class="card ct-grade"><div class="row between"><div><p class="tiny muted">Week grade</p><b class="ct-big">${s.grade}</b></div>
        <div class="small" style="text-align:right">${n0(s.score * 100)}%<br><span class="muted">${s.green} green · ${s.yellow} yellow of ${s.days} day${s.days === 1 ? '' : 's'}</span></div></div>
        ${s.parts.some((x) => x.value < 0.8) ? `<p class="small" style="margin-top:8px">Pulled down by: ${s.parts.filter((x) => x.value < 0.8).sort((a, b) => a.value - b.value).map((x) => `<b>${esc(x.label)} ${n0(x.value * 100)}%</b>`).join(', ')}</p>` : ''}</div>
      <div class="card stack-sm" style="margin-top:12px">
        <div class="row between"><span>Trend</span><b>${s.trendFrom != null && s.trendTo != null ? `${n1(s.trendFrom)} → ${n1(s.trendTo)} kg (${s.change > 0 ? '+' : ''}${n1(s.change)})` : '–'}</b></div>
        <div class="row between"><span>Week ${s.week} target</span><b>${s.target ? `${n1(s.target)} kg${s.trendTo != null ? ` <span class="${s.trendTo - s.target > 1 ? 'down' : 'muted'}">(${s.trendTo - s.target > 0 ? '+' : ''}${n1(s.trendTo - s.target)})</span>` : ''}` : '–'}</b></div>
        ${s.kcal != null ? `<div class="row between"><span>Calories (avg)</span><b>${vs(s.kcal, tg.kcal)}</b></div>` : ''}
        ${s.protein != null ? `<div class="row between"><span>Protein (avg)</span><b>${vs(s.protein, tg.p, ' g')}</b></div>` : ''}
        ${s.steps != null ? `<div class="row between"><span>Steps (avg)</span><b>${vs(s.steps, c.steps)}</b></div>` : ''}
        ${s.sleep != null ? `<div class="row between"><span>Sleep (avg)</span><b>${vs(s.sleep, c.sleep, ' h', 1)}</b></div>` : ''}
        <div class="row between"><span>Training</span><b>gym ${s.gymDone}/${s.goal.lift} · runs ${s.runsDone}/${s.goal.run}</b></div>
        ${(() => { const rl = runWeekLine(s.from, s.to); return rl ? `<div class="row between" style="gap:12px"><span>Running</span><b style="text-align:right">${esc(rl)}</b></div>` : ''; })()}
        ${s.sessions.length ? `<div class="row between"><span>Lifts</span><b>${esc(s.sessions.map((x) => x[0].toUpperCase() + x.slice(1)).join(' · '))}</b></div>` : ''}
        <div class="row between"><span>Compliance (2 weeks)</span><b>${n0(compliance * 100)}%</b></div>
      </div>

      <h3 class="section-title">Adjustments</h3>
      <div class="stack-sm">${sugg.map((x) => `<div class="card"><p class="small">${esc(x.text)}</p>
        ${x.change ? `<div class="fab-row" style="margin-top:10px" data-s="${x.key}">
          <button class="${choice[x.key] === 'accepted' ? 'primary' : 'ghost'}" data-c="accepted" ${completed ? 'disabled' : ''}>Accept</button>
          <button class="${choice[x.key] === 'ignored' ? 'soft' : 'ghost'}" data-c="ignored" ${completed ? 'disabled' : ''}>Ignore</button></div>` : ''}</div>`).join('')}</div>

      <h3 class="section-title">Measurements (cm)</h3>
      <div class="card form"><div class="ct-meas">${PARTS.map(([k, l]) => `<label>${l}<input name="${k}" inputmode="decimal" value="${esc(rec?.[k] ?? '')}" placeholder="${prev?.[k] != null ? esc(String(prev[k])) : ''}" ${completed ? 'disabled' : ''}></label>`).join('')}</div>
        <p class="tiny muted">Same tape, same spots, morning.</p></div>

      <h3 class="section-title">Photos</h3>
      <div class="ct-photos">${POSES.map((p) => {
        const id = rec?.photos?.[p];
        const ph = id && store.get(id);
        return `<label class="ct-photo">${ph?.data ? `<img src="${ph.data}" alt="${p}">` : `${icon('plus')}<span>${p[0].toUpperCase() + p.slice(1)}</span>`}
          ${completed ? '' : `<input type="file" accept="image/*" data-p="${p}" hidden>`}</label>`;
      }).join('')}</div>
      <p class="tiny muted" style="margin:6px 2px 0">Same place, light, time and clothes. Photos are saved with your data (compressed).</p>

      <h3 class="section-title">Reflection</h3>
      <div class="card form"><label>What went wrong, and the one fix for next week?<textarea name="reflection" rows="3" ${completed ? 'disabled' : ''}>${esc(done?.reflection || '')}</textarea></label></div>
      ${completed ? '' : '<button class="primary block" id="ct-rdone" style="margin-top:16px">Complete review</button>'}` });

    $$('[data-s] button', el).forEach((b) => { b.onclick = () => {
      choice[b.parentNode.dataset.s] = b.dataset.c;
      $$('button', b.parentNode).forEach((x) => { x.className = x.dataset.c === choice[b.parentNode.dataset.s] ? (x.dataset.c === 'accepted' ? 'primary' : 'soft') : 'ghost'; });
    }; });
    $$('.ct-photo input', el).forEach((inp) => { inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const data = await compressFile(f).catch(() => null);
      if (!data) { toast('Could not read that photo'); return; }
      photos[inp.dataset.p] = data;
      const lab = inp.closest('.ct-photo');
      lab.querySelector('img')?.remove();
      lab.querySelectorAll('svg, span').forEach((x) => x.remove());
      lab.insertAdjacentHTML('afterbegin', `<img src="${data}" alt="">`);
    }; });
    $('#ct-rdone', el)?.addEventListener('click', async () => {
      const reflection = $('[name=reflection]', el).value.trim();
      if (reflection.length < 5) { toast('Write one sentence: what went wrong, and the one fix'); $('[name=reflection]', el).focus(); return; }
      const pending = sugg.filter((x) => x.change && !choice[x.key]);
      if (pending.length) { toast('Accept or ignore each adjustment'); return; }
      const meas = Object.fromEntries(PARTS.map(([k]) => { const v = Number(String($(`[name=${k}]`, el).value).replace(',', '.')); return [k, v > 0 ? v : null]; }));
      const photoIds = { ...(rec?.photos || {}) };
      for (const [pose, data] of Object.entries(photos)) photoIds[pose] = (await store.put('photo', { day: today(), pose, data })).id;
      await applyChoices(sugg, choice, c);
      await store.put('checkin', {
        ...(rec ? { id: rec.id } : {}), day: today(), forDay: ci, ...meas, photos: photoIds, reflection, grade: s.grade, score: Math.round(s.score * 100) / 100,
        summary: { ...s, compliance: Math.round(compliance * 100) / 100 },
        suggestions: sugg.map((x) => ({ key: x.key, text: x.text, choice: x.change ? choice[x.key] : null })),
      });
      completed = true;
      toast(`Week ${s.week} reviewed: ${s.grade}`);
      scr.close();
    });
  });
}

// ---------- check-in (measurements + photos, on the check-in day morning) ----------
export function openCheckin(r = measurementsDue() || dueCheckin()) {
  if (!r) { toast('The first check-in is at the end of week 1'); return; }
  const rec = checkinRecord(r);
  const prev = store.all('checkin').filter((x) => x !== rec).sort((a, b) => b.day.localeCompare(a.day))[0];
  const photos = {};
  push((el, scr) => {
    el.innerHTML = page({ title: 'Weekly check-in', body: `
      <p class="small muted" style="margin:0 2px 12px">Measurements and photos, best in the morning before eating. The weekly review with the numbers comes the day after, once the whole week is in.</p>
      <h3 class="section-title">Measurements (cm)</h3>
      <div class="card form"><div class="ct-meas">${PARTS.map(([k, l]) => `<label>${l}<input name="${k}" inputmode="decimal" value="${esc(rec?.[k] ?? '')}" placeholder="${prev?.[k] != null ? esc(String(prev[k])) : ''}"></label>`).join('')}</div>
        <p class="tiny muted">Same tape, same spots, morning. Grey numbers are last time's.</p></div>
      <h3 class="section-title">Photos</h3>
      <div class="ct-photos">${POSES.map((p) => {
        const ph = rec?.photos?.[p] && store.get(rec.photos[p]);
        return `<label class="ct-photo">${ph?.data ? `<img src="${ph.data}" alt="${p}">` : `${icon('plus')}<span>${p[0].toUpperCase() + p.slice(1)}</span>`}<input type="file" accept="image/*" data-p="${p}" hidden></label>`;
      }).join('')}</div>
      <p class="tiny muted" style="margin:6px 2px 0">Same place, light, time and clothes.</p>
      <button class="primary block" id="ct-cisave" style="margin-top:16px">Save check-in</button>` });
    $$('.ct-photo input', el).forEach((inp) => { inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const data = await compressFile(f).catch(() => null);
      if (!data) { toast('Could not read that photo'); return; }
      photos[inp.dataset.p] = data;
      const lab = inp.closest('.ct-photo');
      lab.querySelector('img')?.remove();
      lab.querySelectorAll('svg, span').forEach((x) => x.remove());
      lab.insertAdjacentHTML('afterbegin', `<img src="${data}" alt="">`);
    }; });
    $('#ct-cisave', el).onclick = async () => {
      const meas = Object.fromEntries(PARTS.map(([k]) => { const v = Number(String($(`[name=${k}]`, el).value).replace(',', '.')); return [k, v > 0 ? v : null]; }));
      const photoIds = { ...(rec?.photos || {}) };
      for (const [pose, data] of Object.entries(photos)) photoIds[pose] = (await store.put('photo', { day: today(), pose, data })).id;
      if (!Object.values(meas).some((v) => v > 0) && !Object.keys(photoIds).length) { toast('Add a measurement or a photo'); return; }
      await store.put('checkin', { ...(rec || {}), day: rec?.day || today(), forDay: r, ...meas, photos: photoIds });
      toast('Check-in saved - the review comes once the week is over');
      scr.close();
    };
  });
}

// Accepted suggestions change the targets (and are logged in the targets history).
async function applyChoices(sugg, choice, c) {
  const acc = sugg.filter((x) => x.change && choice[x.key] === 'accepted');
  if (!acc.length) return;
  const t = { ...(foodUi.targets() || {}) };
  let steps = c.steps;
  let bonus = c.liftDayBonus || 0;
  for (const x of acc) {
    if (x.change.kcal) {
      const d = x.change.kcal - (t.kcal || 0);
      t.kcal = x.change.kcal;
      t.c = Math.max(0, Math.round((t.c || 0) + d / 4)); // the change goes to carbs; protein and fat stay
    }
    if (x.change.steps) steps = x.change.steps;
    if (x.change.liftDayBonus) bonus = x.change.liftDayBonus;
  }
  await foodUi.saveSettings({ targets: t });
  await saveCut({ steps, liftDayBonus: bonus });
  await recordTargets({ ...t, steps }, `Weekly review: ${acc.map((x) => x.key).join(', ')}`);
}
