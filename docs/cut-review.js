// Cut plan weekly review (check-in day): measurements, 3 photos, the week's numbers and grade, adjustment
// suggestions (Accept / Ignore, both logged) and a required one-sentence reflection.
// It opens by itself on the check-in day and can't be dismissed until it is completed.
//
// Records: 'checkin' { day, forDay, waist, hips, chest, arm, thigh, photos:{front,side,back → photo id}, reflection,
//   grade, score, summary, suggestions:[{ key, text, choice }] }, 'photo' { day, pose, data (JPEG data URL) }.

import { $, $$, esc, icon, toast, today, n0, n1, addDays } from './util.js';
import * as store from './store.js';
import { push, page } from './nav.js';
import { compressFile } from './food-photo.js';
import * as foodUi from './food-ui.js';
import { cutSettings, saveCut, currentTargets, startWeight, recordTargets } from './cut.js';
import { statusOf, sources } from './cut-today.js';
import { weekSummary, suggestions, liftChange, lastCheckinDay } from './cut-week.js';

const PARTS = [['waist', 'Waist (navel)'], ['hips', 'Hips'], ['chest', 'Chest'], ['arm', 'Arm (relaxed)'], ['thigh', 'Mid-thigh']];
const POSES = ['front', 'side', 'back'];
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// The check-in this review is for: the last check-in day, once the plan has run a full week before it.
export function dueCheckin(day = today(), c = cutSettings()) {
  if (!c.startDate) return null;
  const ci = lastCheckinDay(day, c.checkinDay);
  if (!ci || ci < addDays(c.startDate, 7)) return null;
  return ci;
}
export const checkinFor = (ci) => store.all('checkin').find((x) => x.forDay === ci || (x.day >= addDays(ci, -1) && x.day <= addDays(ci, 2)));
// Forced on the check-in day and the 2 days after it while not done (later it is a red flag).
export function reviewNeeded(day = today()) {
  const ci = dueCheckin(day);
  return ci && day <= addDays(ci, 2) && !checkinFor(ci) ? ci : null;
}

function buildReview(ci) {
  const c = cutSettings();
  const src = sources();
  const tg = currentTargets(c);
  const st = (d) => statusOf(d, src, c, tg.kcal);
  const summary = weekSummary(ci, { statusOf: st, weights: src.weights, workouts: src.workouts, cfg: c, start: startWeight(c) });
  const last14 = range(addDays(ci, -14), addDays(ci, -1)).filter((d) => d >= c.startDate);
  const compliance = last14.length ? last14.filter((d) => ['green', 'yellow'].includes(st(d).status)).length / last14.length : 0;
  const sugg = suggestions({ weights: src.weights, checkinDay: ci, week: summary.week, compliance, targets: tg, cfg: c, liftDrop: liftChange(src.workouts, addDays(ci, -1)), sleep: summary.sleep });
  return { c, tg, summary, compliance, sugg };
}

const vs = (v, t, unit = '', digits = 0) => (v == null ? '–' : `${digits ? n1(v) : n0(v)}${unit}${t ? ` <span class="muted">/ ${n0(t)}</span>` : ''}`);

export function openReview(ci = dueCheckin()) {
  if (!ci) { toast('The first review is after your first full week'); return; }
  const { c, tg, summary: s, compliance, sugg } = buildReview(ci);
  const prev = store.all('checkin').filter((x) => x.forDay !== ci).sort((a, b) => b.day.localeCompare(a.day))[0];
  const done = checkinFor(ci);
  const choice = Object.fromEntries((done?.suggestions || []).map((x) => [x.key, x.choice]));
  const photos = {};
  let completed = Boolean(done);
  push((el, scr) => {
    el.innerHTML = page({ title: 'Weekly review', back: completed, body: `
      <p class="small muted" style="margin:0 2px 12px">Week ${s.week} · ${esc(new Date(`${s.from}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} – ${esc(new Date(`${s.to}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}. The numbers vs your targets, plainly.</p>
      <div class="card ct-grade"><div class="row between"><div><p class="tiny muted">Week grade</p><b class="ct-big">${s.grade}</b></div>
        <div class="small" style="text-align:right">${n0(s.score * 100)}%<br><span class="muted">${s.green} green · ${s.yellow} yellow of ${s.days} days</span></div></div></div>
      <div class="card stack-sm" style="margin-top:12px">
        <div class="row between"><span>Trend</span><b>${s.trendFrom != null && s.trendTo != null ? `${n1(s.trendFrom)} → ${n1(s.trendTo)} kg (${s.change > 0 ? '+' : ''}${n1(s.change)})` : '–'}</b></div>
        <div class="row between"><span>Target this week</span><b>${s.target ? `${n1(s.target)} kg${s.trendTo != null ? ` <span class="${s.trendTo - s.target > 1 ? 'down' : 'muted'}">(${s.trendTo - s.target > 0 ? '+' : ''}${n1(s.trendTo - s.target)})</span>` : ''}` : '–'}</b></div>
        <div class="row between"><span>Calories (avg)</span><b>${vs(s.kcal, tg.kcal)}</b></div>
        <div class="row between"><span>Protein (avg)</span><b>${vs(s.protein, tg.p, ' g')}</b></div>
        <div class="row between"><span>Steps (avg)</span><b>${vs(s.steps, c.steps)}</b></div>
        <div class="row between"><span>Sleep (avg)</span><b>${vs(s.sleep, c.sleep, ' h', 1)}</b></div>
        <div class="row between"><span>Sessions</span><b>${s.sessionsDone} / ${s.sessionsPlanned}</b></div>
        <div class="row between"><span>Lifts</span><b>${s.sessions.length ? esc(s.sessions.map((x) => x[0].toUpperCase() + x.slice(1)).join(' · ')) : '–'}</b></div>
        <div class="row between"><span>Compliance (2 weeks)</span><b>${n0(compliance * 100)}%</b></div>
      </div>

      <h3 class="section-title">Adjustments</h3>
      <div class="stack-sm">${sugg.map((x) => `<div class="card"><p class="small">${esc(x.text)}</p>
        ${x.change ? `<div class="fab-row" style="margin-top:10px" data-s="${x.key}">
          <button class="${choice[x.key] === 'accepted' ? 'primary' : 'ghost'}" data-c="accepted" ${completed ? 'disabled' : ''}>Accept</button>
          <button class="${choice[x.key] === 'ignored' ? 'soft' : 'ghost'}" data-c="ignored" ${completed ? 'disabled' : ''}>Ignore</button></div>` : ''}</div>`).join('')}</div>

      <h3 class="section-title">Measurements (cm)</h3>
      <div class="card form"><div class="ct-meas">${PARTS.map(([k, l]) => `<label>${l}<input name="${k}" inputmode="decimal" value="${esc(done?.[k] ?? '')}" placeholder="${prev?.[k] != null ? esc(String(prev[k])) : ''}" ${completed ? 'disabled' : ''}></label>`).join('')}</div>
        <p class="tiny muted">Same tape, same spots, morning.</p></div>

      <h3 class="section-title">Photos</h3>
      <div class="ct-photos">${POSES.map((p) => {
        const id = done?.photos?.[p];
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
      const photoIds = {};
      for (const [pose, data] of Object.entries(photos)) photoIds[pose] = (await store.put('photo', { day: today(), pose, data })).id;
      await applyChoices(sugg, choice, c);
      await store.put('checkin', {
        day: today(), forDay: ci, ...meas, photos: photoIds, reflection, grade: s.grade, score: Math.round(s.score * 100) / 100,
        summary: { ...s, compliance: Math.round(compliance * 100) / 100 },
        suggestions: sugg.map((x) => ({ key: x.key, text: x.text, choice: x.change ? choice[x.key] : null })),
      });
      completed = true;
      toast(`Week ${s.week} reviewed: ${s.grade}`);
      scr.close();
    });
  }, {
    onClose: () => {
      if (!completed) setTimeout(() => { toast('Finish the weekly review first'); openReview(ci); }, 350);
    },
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
