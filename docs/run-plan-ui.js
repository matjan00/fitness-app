// UI for the goal-based training plan: goal card, next-session card, behind banner, setup flow and
// schedule screen. Plan state lives in store config 'run-plan' (see docs/run-plan.js for the shape).

import { $, $$, esc, icon, toast, niceDate } from './util.js';
import * as store from './store.js';
import { push, page, sheet, confirmSheet, chooseSheet } from './nav.js';
import * as C from './run-coach.js';
import * as P from './run-plan.js';
import { openRun } from './run-detail.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const KEY = 'run-plan';
export const getPlan = () => { const { id, key, ...cfg } = store.getConfig(KEY, {}); return cfg.goal ? cfg : null; };
export const savePlan = (plan) => store.setConfig(KEY, plan);
export const resetPlan = () => store.setConfig(KEY, {});

const PHASE_BLURB = {
  Base: 'building an aerobic base with easy running, strides and short tempo efforts.',
  Build: 'alternating threshold and VO2max sessions to raise your fitness ceiling.',
  Specific: 'running at goal 10k pace so race rhythm becomes automatic.',
  Taper: 'cutting volume while keeping a little sharpness, so you arrive fresh.',
  Test: 'race week — the goal-distance time trial.',
};

// ---------- send a planned session to the Garmin watch ----------
// App -> edge function 'garmin-send' (saves the steps + starts a GitHub Action) -> the action uploads the workout to
// Garmin Connect and writes a 'garmin-send' status record, which we pull (store.syncNow) and show here.
const WATCH_POLL_MS = 10000;
const WATCH_TIMEOUT_MS = 3 * 60 * 1000;
const WATCH_SETUP_MSG = 'Sending to the watch needs a one-time setup — ask Claude.';
const WATCH_OK_MSG = 'On your watch ✓ — open Garmin Connect on your phone to sync the watch, then find it under Training › Workouts / today\'s workout.';
const watchUi = new Map(); // sessionId -> { phase: 'sending'|'error'|'timeout', text }

const sendStatusFor = (sessionId) => {
  const st = store.all('garmin-send')[0];
  return st && st.session_id === sessionId ? st : null;
};

// The state line and button label for one session's watch block.
function watchView(sessionId) {
  const ui = watchUi.get(sessionId);
  if (ui?.phase === 'sending') return { busy: true, label: 'Sending…', text: 'Sending… this takes about a minute.', tone: '' };
  if (ui) return { busy: false, label: 'Try again', text: ui.text, tone: 'err' };
  const st = sendStatusFor(sessionId);
  if (st?.state === 'sent') return { busy: false, label: 'Send again', text: WATCH_OK_MSG, tone: 'ok' };
  if (st?.state === 'error') return { busy: false, label: 'Try again', text: `Could not send it to the watch: ${st.error || 'unknown error'}`, tone: 'err' };
  return { busy: false, label: 'Send to watch', text: '', tone: '' };
}

export function watchHtml(s) {
  if (s.status !== 'planned' || !store.configured) return '';
  const v = watchView(s.id);
  return `<div class="rn-watch" data-watch="${esc(s.id)}" style="margin-top:12px">
    <button class="ghost block" data-a="rn-watch"${v.busy ? ' disabled' : ''}>${icon('run')} ${esc(v.label)}</button>
    <p class="small ${v.tone === 'err' ? '' : 'muted'} rn-watch-msg" style="margin-top:6px${v.tone === 'err' ? ';color:var(--danger,#c0392b)' : ''}">${esc(v.text)}</p></div>`;
}

function refreshWatch(sessionId) {
  const v = watchView(sessionId);
  document.querySelectorAll(`[data-watch="${CSS.escape(sessionId)}"]`).forEach((box) => {
    const b = box.querySelector('button');
    const p = box.querySelector('.rn-watch-msg');
    if (b) { b.disabled = v.busy; b.lastChild.textContent = ` ${v.label}`; }
    if (p) { p.textContent = v.text; p.classList.toggle('muted', v.tone !== 'err'); p.style.color = v.tone === 'err' ? 'var(--danger,#c0392b)' : ''; }
  });
}

async function callSendFunction(session) {
  let token = SUPABASE_KEY;
  try { const s = await store.client?.auth.getSession(); if (s?.data?.session?.access_token) token = s.data.session.access_token; } catch { /* offline */ }
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/garmin-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: session.id, steps: P.sessionSteps(session), name: P.watchWorkoutName(session, getPlan()?.sessions || []) }),
    });
  } catch {
    throw new Error('No connection — check your internet and try again.');
  }
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (r.ok) return body || {};
  if (r.status === 404 || body?.error === 'not_configured') throw new Error(WATCH_SETUP_MSG);
  if (r.status === 401) throw new Error('Log in to the app first (Settings, top-right on Home), then try again.');
  if (r.status === 429) throw new Error(body?.message || 'Please wait a couple of minutes before sending again.');
  throw new Error(body?.message || body?.error || 'Could not start the send. Try again in a minute.');
}

export async function sendToWatch(sessionId) {
  const session = getPlan()?.sessions?.find((x) => x.id === sessionId);
  if (!session || watchUi.get(sessionId)?.phase === 'sending') return;
  watchUi.set(sessionId, { phase: 'sending' });
  refreshWatch(sessionId);
  try {
    const { requested_at: requestedAt } = await callSendFunction(session);
    const started = Date.now();
    for (;;) {
      await new Promise((res) => setTimeout(res, WATCH_POLL_MS));
      try { await store.syncNow(); } catch { /* keep polling */ }
      const st = sendStatusFor(sessionId);
      if (st && (!requestedAt || st.requested_at === requestedAt)) {
        watchUi.delete(sessionId);
        if (st.state === 'error') watchUi.set(sessionId, { phase: 'error', text: `Could not send it to the watch: ${st.error || 'unknown error'}` });
        else toast('On your watch');
        break;
      }
      if (Date.now() - started > WATCH_TIMEOUT_MS) {
        watchUi.set(sessionId, { phase: 'timeout', text: 'Still waiting for Garmin. It may just be slow — check again in a few minutes, or try once more.' });
        break;
      }
    }
  } catch (e) {
    watchUi.set(sessionId, { phase: 'error', text: e.message || 'Could not send it to the watch.' });
  }
  refreshWatch(sessionId);
}

export function wireWatch(el) {
  el.querySelectorAll('[data-watch] [data-a="rn-watch"]').forEach((btn) =>
    btn.addEventListener('click', () => sendToWatch(btn.closest('[data-watch]').dataset.watch)));
}

// ---------- auto-matching new runs to the plan (fire-and-forget, called from run.js) ----------
export async function syncPlanMatches(ctx) {
  let plan = getPlan();
  if (!plan || !plan.sessions?.length) return false;
  let changed = false;
  const linked = new Set(plan.sessions.filter((s) => s.doneRunId).map((s) => s.doneRunId));
  const runs = [...ctx.runs].filter((r) => C.startMs(r) >= plan.startedAt && !linked.has(r.id)).sort((a, b) => C.startMs(a) - C.startMs(b));
  for (const r of runs) {
    const runType = ctx.classOf(r).type;
    const updated = P.autoMatch(plan, r, runType, C.startMs(r));
    if (updated) {
      plan = { ...plan, sessions: plan.sessions.map((s) => (s.id === updated.id ? updated : s)) };
      changed = true;
    }
  }
  if (changed) await savePlan(plan);
  return changed;
}

// ---------- goal card + next session + behind banner (shown on the Run tab in place of the generic plan) ----------
export function planSectionHtml(ctx, plan) {
  const behind = P.computeBehind(plan, ctx.now);
  const progress = P.planProgress(plan);
  const est = ctx.est || ctx.olderEst;
  const currentTime = est ? C.raceTime(est.vdot, plan.goal.distance_km * 1000) : null;
  const goalPct = plan.startVdot && plan.goalVdot > plan.startVdot
    ? Math.min(100, Math.round((((est?.vdot || plan.startVdot) - plan.startVdot) / (plan.goalVdot - plan.startVdot)) * 100))
    : (progress.pct);
  const next = P.nextSession(plan);

  return `
  ${behind ? behindBannerHtml(behind) : ''}
  <div class="card rn-goal">
    <div class="card-head"><h2>Goal: ${esc(plan.goal.distance_km)} km in ${esc(C.fmtTime(plan.goal.time_s))}</h2><button class="link small" data-a="rn-view-plan">View plan</button></div>
    <p class="small muted">Current estimated ${esc(plan.goal.distance_km)} km time: <b>${currentTime ? esc(C.fmtTime(currentTime)) : 'not yet measured'}</b></p>
    <div class="rn-hero-track" style="background:var(--card-2);margin-top:8px"><i style="width:${Math.max(0, Math.min(100, goalPct))}%;background:var(--run)"></i></div>
    <p class="rn-hero-sub" style="color:var(--text-2);margin-top:6px">Estimated goal window: <b>${esc(plan.goalWindow)}</b>${plan.timelineCapped ? ' (a stretch at this pace of training — sticking with more runs/week would speed it up)' : ''}</p>
    <p class="small muted" style="margin-top:4px">${progress.done} of ${progress.total} sessions done</p>
  </div>
  ${next ? nextSessionHtml(next, plan, ctx) : `<div class="card rn-plan-done"><p>Every planned session is complete — nice work! Head to Settings to set a new goal.</p></div>`}`;
}

function behindBannerHtml(behind) {
  return `<div class="card rn-behind">
    <div class="row" style="gap:10px;align-items:flex-start"><span class="rn-behind-ic">${icon('info')}</span>
      <div class="grow"><b>You're behind by ${behind.sessionsOverdue} session${behind.sessionsOverdue > 1 ? 's' : ''}</b>
      <p class="small muted">${behind.keySession ? 'One of them is a key test session — moving the plan is usually best.' : 'Move the plan forward, or skip the missed session(s) and carry on.'}</p></div></div>
    <div class="row" style="gap:8px;margin-top:10px"><button class="ghost" style="flex:1" data-a="rn-skip">Skip and continue</button><button class="primary" style="flex:1" data-a="rn-move">Move the plan</button></div>
  </div>`;
}

function sessionBody(s, paceExtra = '') {
  return `<p class="small" style="margin-top:2px">${esc(s.purpose)}</p>
    <div class="rn-plan-detail">
      ${s.warmup ? `<div><b>Warm-up</b><p>${esc(s.warmup)}</p></div>` : ''}
      <div><b>Main set</b><p>${esc(s.main)}</p></div>
      ${s.cooldown ? `<div><b>Cool-down</b><p>${esc(s.cooldown)}</p></div>` : ''}
    </div>
    ${s.hrGuidance ? `<p class="small muted" style="margin-top:6px">${icon('heart')} ${esc(s.hrGuidance)}</p>` : ''}
    ${s.tips?.length ? `<ul class="rn-tips small muted">${s.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}${paceExtra}`;
}

function nextSessionHtml(s, plan, ctx) {
  return `<div class="card rn-next-session">
    <div class="card-head"><h2>${esc(s.title)}</h2><span class="pill rn-pill-run">${C.kmShort(s.totalKm)} km</span></div>
    <p class="tiny muted">${esc(P.currentWeekLabel(plan, s))} · ${esc(s.phase)} phase</p>
    ${sessionBody(s)}
    ${watchHtml(s)}
    <div class="row" style="gap:8px;margin-top:14px">
      <button class="ghost" style="flex:1" data-a="rn-skip-session" data-id="${esc(s.id)}">Skip</button>
      <button class="primary" style="flex:1" data-a="rn-mark-done" data-id="${esc(s.id)}">Mark done</button>
    </div>
  </div>`;
}

export function wirePlanSection(el, ctx, plan, afterChange) {
  wireWatch(el);
  el.querySelector('[data-a="rn-view-plan"]')?.addEventListener('click', () => openSchedule(ctx, plan, afterChange));
  el.querySelector('[data-a="rn-move"]')?.addEventListener('click', async () => {
    await savePlan(P.movePlan(plan, ctx.now));
    toast('Plan moved forward'); afterChange();
  });
  el.querySelector('[data-a="rn-skip"]')?.addEventListener('click', async () => {
    await savePlan(P.skipOverdue(plan, ctx.now));
    toast('Skipped — carrying on with the next session'); afterChange();
  });
  el.querySelector('[data-a="rn-mark-done"]')?.addEventListener('click', (e) => markDoneFlow(plan, e.target.closest('[data-id]').dataset.id, ctx, afterChange));
  el.querySelector('[data-a="rn-skip-session"]')?.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-id]').dataset.id;
    if (await confirmSheet('Skip this session? It will be marked skipped and the plan continues with the next one.', { ok: 'Skip' })) {
      await savePlan(P.markSkipped(plan, id));
      afterChange();
    }
  });
}

async function markDoneFlow(plan, sessionId, ctx, afterChange) {
  const linked = new Set(plan.sessions.filter((s) => s.doneRunId).map((s) => s.doneRunId));
  const candidates = ctx.runs.filter((r) => !linked.has(r.id) && C.startMs(r) >= plan.startedAt).slice(0, 8);
  const options = candidates.map((r) => ({ value: r.id, label: `${niceDate(r.start)} · ${C.km(r.distance_m).toFixed(1)} km · ${C.fmtTime(r.moving_s)}` }));
  options.push({ value: '__none__', label: 'Mark done without linking a run' });
  const choice = await chooseSheet('Which run was this?', options);
  if (!choice) return;
  const run = choice === '__none__' ? null : candidates.find((r) => r.id === choice);
  await savePlan(P.markDone(plan, sessionId, run));
  toast('Marked done'); afterChange();
}

// ---------- schedule screen ----------
export function openSchedule(ctx, planIn, afterChange = () => {}) {
  push((el, screen) => {
    const plan = getPlan() || planIn;
    const weeks = new Map();
    for (const s of plan.sessions) { if (!weeks.has(s.week)) weeks.set(s.week, []); weeks.get(s.week).push(s); }
    const rows = [...weeks.entries()].map(([w, sessions]) => `
      <div class="row between rn-month"><h3 class="section-title">Week ${w} · ${esc(sessions[0].phase)}</h3></div>
      <div class="card rn-list">${sessions.map((s) => scheduleRow(s)).join('')}</div>`).join('');
    el.innerHTML = page({
      title: 'Training plan',
      sub: `${plan.goal.distance_km} km in ${C.fmtTime(plan.goal.time_s)} · ${esc(plan.goalWindow)}`,
      body: rows,
    });
    $$('[data-sess]', el).forEach((b) => {
      b.onclick = () => {
        const s = plan.sessions.find((x) => x.id === b.dataset.sess);
        openSessionDetail(s, plan, ctx, () => { afterChange(); screen.render(); });
      };
    });
  });
}

function scheduleRow(s) {
  const status = s.status === 'done' ? `<span class="rn-check">${icon('check')}</span>` : s.status === 'skipped' ? '<span class="pill">Skipped</span>' : '';
  const sub = s.status === 'done' && s.doneAt ? `Done ${niceDate(s.doneAt)}` : s.status === 'skipped' ? 'Skipped' : `${C.kmShort(s.totalKm)} km planned`;
  return `<button class="list-item rn-run" data-sess="${esc(s.id)}">
    <span class="rn-dot rn-t-${esc(s.type === 'test5k' || s.type === 'test10k' ? 'race' : s.type)}">${icon(s.type.includes('test') ? 'trophy' : s.type === 'intervals' || s.type === 'tempo' ? 'bolt' : 'run')}</span>
    <div class="grow"><b>${esc(s.title)}</b><p class="sub">${esc(sub)}</p></div>
    ${status}</button>`;
}

function openSessionDetail(s, plan, ctx, afterChange) {
  push((el) => {
    const run = s.doneRunId ? ctx.runs.find((r) => r.id === s.doneRunId) : null;
    const fb = run ? P.sessionFeedback(s, run, ctx) : [];
    el.innerHTML = page({
      title: s.title,
      sub: `Week ${s.week} · ${esc(s.phase)} phase`,
      body: `
        ${sessionBody(s)}
        ${run ? `<div class="card rn-coach"><div class="card-head"><h2>How it went</h2></div>
          <button class="list-item rn-run" data-open-run="${esc(run.id)}"><span class="rn-dot rn-t-long">${icon('run')}</span>
            <div class="grow"><b>${esc(run.name || 'Run')}</b><p class="sub">${niceDate(run.start)} · ${C.km(run.distance_m).toFixed(1)} km · ${C.fmtPace(C.paceOf(run))}/km</p></div></button>
          <ul class="rn-fb">${fb.map((f) => `<li class="rn-fb-${esc(f.tone)}"><span class="rn-fb-ic">${icon('info')}</span><p>${esc(f.text)}</p></li>`).join('')}</ul>
          <button class="ghost block" style="margin-top:10px" data-a="unlink">Unlink this run</button></div>` : ''}
        ${watchHtml(s)}
        ${s.status === 'planned' ? `<div class="row" style="gap:8px;margin-top:16px">
          <button class="ghost" style="flex:1" data-a="skip">Skip</button><button class="primary" style="flex:1" data-a="done">Mark done</button></div>` : ''}
        ${s.status === 'skipped' ? '<p class="small muted" style="margin-top:12px">This session was skipped.</p>' : ''}
      `,
    });
    wireWatch(el);
    el.querySelector('[data-open-run]')?.addEventListener('click', () => openRun(run, ctx));
    el.querySelector('[data-a="unlink"]')?.addEventListener('click', async () => { await savePlan(P.unlink(getPlan(), s.id)); afterChange(); });
    el.querySelector('[data-a="done"]')?.addEventListener('click', () => markDoneFlow(getPlan(), s.id, ctx, afterChange));
    el.querySelector('[data-a="skip"]')?.addEventListener('click', async () => {
      if (await confirmSheet('Skip this session?', { ok: 'Skip' })) { await savePlan(P.markSkipped(getPlan(), s.id)); afterChange(); }
    });
  });
}

// ---------- setup flow ----------
export function openSetup(ctx, afterChange) {
  let goal = { distance_km: 10, time_s: 50 * 60 };
  let runsPerWeek = 2;
  let step = 'goal';
  push((el, screen) => {
    if (step === 'goal') el.innerHTML = setupGoalHtml(goal, runsPerWeek);
    else el.innerHTML = setupSummaryHtml(ctx, goal, runsPerWeek);
    wireSetup(el, screen);
  });

  function wireSetup(el, screen) {
    if (step === 'goal') {
      $$('[data-dist]', el).forEach((b) => { b.onclick = () => { goal.distance_km = Number(b.dataset.dist); screen.render(); }; });
      $$('[data-rpw]', el).forEach((b) => { b.onclick = () => { runsPerWeek = Number(b.dataset.rpw); screen.render(); }; });
      const t = $('#rn-goal-time', el);
      t.onchange = () => { const secs = parseTimeInput(t.value); if (secs) goal.time_s = secs; };
      el.querySelector('[data-a="next"]').onclick = () => {
        const secs = parseTimeInput(t.value);
        if (!secs) { toast('Enter a target time as mm:ss or h:mm:ss'); return; }
        goal.time_s = secs;
        step = 'summary'; screen.render();
      };
    } else {
      el.querySelector('[data-a="back"]').onclick = () => { step = 'goal'; screen.render(); };
      el.querySelector('[data-a="start"]').onclick = async () => {
        const plan = P.generatePlan({ ctx, goal, runsPerWeek, startedAt: Date.now() });
        await savePlan(plan);
        toast('Plan started');
        screen.close();
        afterChange();
      };
    }
  }
}

function parseTimeInput(v) {
  const parts = String(v || '').trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function setupGoalHtml(goal, runsPerWeek) {
  return page({
    title: 'Set your goal',
    body: `
      <p class="rn-label">Distance</p>
      <div class="seg">${[5, 10].map((d) => `<button data-dist="${d}" class="${goal.distance_km === d ? 'on' : ''}">${d} km</button>`).join('')}</div>
      <label style="margin-top:16px">Target time (mm:ss or h:mm:ss)
        <input id="rn-goal-time" inputmode="numeric" value="${esc(C.fmtTime(goal.time_s))}"></label>
      <p class="rn-label" style="margin-top:16px">Runs per week</p>
      <div class="seg">${[2, 3, 4, 5].map((n) => `<button data-rpw="${n}" class="${runsPerWeek === n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:10px">2 runs/week works — it just takes longer. Sessions aren't tied to weekdays; just leave at least one rest day between runs.</p>
    `,
    footer: '<button class="primary block" data-a="next">Next</button>',
  });
}

function setupSummaryHtml(ctx, goal, runsPerWeek) {
  const plan = P.generatePlan({ ctx, goal, runsPerWeek, startedAt: Date.now() });
  const first4 = plan.sessions.slice(0, 4);
  return page({
    title: 'Your plan',
    body: `
      <div class="card rn-goal">
        <p>Goal: <b>${goal.distance_km} km in ${C.fmtTime(goal.time_s)}</b> with <b>${runsPerWeek} run${runsPerWeek > 1 ? 's' : ''}/week</b>.</p>
        <p class="small muted" style="margin-top:8px">Realistically that takes about <b>${plan.timelineWeeks} weeks</b> (estimated goal window: ${esc(plan.goalWindow)}). ${plan.startReliable ? '' : 'The first session is a 5 km time trial to measure your current fitness accurately.'}</p>
        <p class="small muted" style="margin-top:8px">Why so long: with ${runsPerWeek} run${runsPerWeek > 1 ? 's' : ''}/week, fitness (VDOT) realistically improves about ${runsPerWeek >= 3 ? '1 point every ~3 weeks' : '1 point every ~4 weeks'}, slower as you approach goal pace. Training more often — 3 to 5 runs/week — would shorten this.</p>
        ${plan.timelineCapped ? '<p class="small" style="margin-top:8px;color:var(--down)">This goal looks far away at the current level — the plan is capped at 40 weeks; expect to reassess along the way.</p>' : ''}
      </div>
      <h3 class="section-title">First sessions</h3>
      <div class="card rn-list">${first4.map((s) => `<div class="list-item"><span class="rn-dot rn-t-${esc(s.type.includes('test') ? 'race' : s.type)}">${icon(s.type.includes('test') ? 'trophy' : 'run')}</span>
        <div class="grow"><b>${esc(s.title)}</b><p class="sub">Week ${s.week} · ${esc(s.main)}</p></div></div>`).join('')}</div>
    `,
    footer: '<div class="row" style="gap:8px"><button class="ghost" style="flex:1" data-a="back">Back</button><button class="primary" style="flex:2" data-a="start">Start plan</button></div>',
  });
}

// ---------- Me section additions ----------
export function meGoalPlanHtml(plan) {
  if (!plan) return '';
  return `<div><p class="rn-label">Goal plan</p>
    <p class="small muted">${esc(plan.goal.distance_km)} km in ${esc(C.fmtTime(plan.goal.time_s))}</p>
    <p class="rn-label" style="margin-top:10px">Runs per week</p>
    <div class="seg" id="rn-plan-rpw">${[2, 3, 4, 5].map((n) => `<button data-v="${n}" class="${plan.runsPerWeek === n ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="row" style="gap:8px;margin-top:12px"><button class="ghost" style="flex:1" data-a="rn-edit-goal">Change goal</button><button class="danger-text" style="flex:1" data-a="rn-reset-plan">Reset plan</button></div></div>`;
}

export function wireMeGoalPlan(el, ctx, afterChange) {
  el.querySelector('[data-a="rn-edit-goal"]')?.addEventListener('click', () => openSetup(ctx, afterChange));
  $$('#rn-plan-rpw button', el).forEach((b) => {
    b.onclick = async () => {
      const plan = getPlan();
      if (!plan || plan.runsPerWeek === Number(b.dataset.v)) return;
      await savePlan(P.regeneratePlan(plan, ctx, { runsPerWeek: Number(b.dataset.v) }));
      toast('Runs per week updated — future sessions regenerated'); afterChange();
    };
  });
  el.querySelector('[data-a="rn-reset-plan"]')?.addEventListener('click', async () => {
    if (await confirmSheet('Reset the training plan? All progress is lost — you can set a new goal afterwards.', { ok: 'Reset', danger: true })) {
      await resetPlan(); toast('Plan reset'); afterChange();
    }
  });
}

// ---------- Home card fragment ----------
export function homeNextSessionHtml(plan, now) {
  const behind = P.computeBehind(plan, now);
  const next = P.nextSession(plan);
  if (!next) return '';
  return `<div class="rn-home-today"><span class="rn-today-k">${behind ? `Behind ${behind.sessionsOverdue} session${behind.sessionsOverdue > 1 ? 's' : ''}` : 'Next up'}</span>
    <b>${esc(next.title)}</b><p class="small muted">${esc(next.main)}</p></div>`;
}
