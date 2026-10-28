// Food: whole-day calories and macros synced from Fitatu (scripts/fitatu_sync.py, every 2 hours), daily
// targets calculator, body weight, and a grocery list from the meals planned in Fitatu (grocery.js).

import { $, $$, esc, icon, toast, n0, n1, parseNum, today, addDays, fromDay, niceDate, relDay } from './util.js';
import * as store from './store.js';
import { push, page, sheet, chooseSheet } from './nav.js';
import { chart, fade, cssVar } from './charts.js';
import { sumEntries, suggestTargets, ACTIVITY, weightTrend, weeklyChange, latestWeight } from './food-calc.js';
import { settings, targets, dayTargets, saveSettings, ring, bar, allFoodEntries } from './food-ui.js';
import { openGrocery, plannedDays } from './grocery.js';

export const tab = { id: 'food', title: 'Food', icon: 'food', render };

let day = today();
let dayChosenAt = Date.now();

const entriesOf = (d) => allFoodEntries().filter((e) => e.day === d);
const fitatuStatus = () => store.all('fitatu-status')[0] || null;

// ---------- tab ----------
function render(el) {
  // After a long pause (e.g. next morning) jump back to today.
  if (Date.now() - dayChosenAt > 3 * 3600 * 1000) { day = today(); dayChosenAt = Date.now(); }
  el.innerHTML = '<div class="page-head"><h1>Food</h1></div><div id="fd-body"></div>';
  renderDiary($('#fd-body', el));
}

function dayTitle(d) {
  const r = relDay(fromDay(d));
  const year = fromDay(d).getFullYear() !== new Date().getFullYear();
  return r === 'Today' || r === 'Yesterday' ? `${r}, ${niceDate(fromDay(d))}` : niceDate(fromDay(d), { weekday: true, year });
}

function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!(min > 1)) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

function syncLine() {
  const st = fitatuStatus();
  if (!st) return '<div class="card fd-sync"><p class="small"><b>Not connected to Fitatu yet.</b> Add your Fitatu login as GitHub secrets and run the "Fitatu sync" action once (steps in FITATU-SETUP.md).</p></div>';
  if (st.last_error) return `<div class="fd-warn fd-sync">${icon('info')}<span class="small">Fitatu sync problem: ${esc(st.last_error)}${st.last_sync_at ? ` Last good sync ${esc(ago(st.last_sync_at))}.` : ''}</span></div>`;
  return `<p class="tiny muted center fd-sync">Synced from Fitatu ${st.last_sync_at ? esc(ago(st.last_sync_at)) : ''} · updates every 2 hours</p>`;
}

function renderDiary(box) {
  const t = dayTargets(day);
  const dayEntries = entriesOf(day);
  const sum = sumEntries(dayEntries);
  const logged = dayEntries.length > 0;
  const leftK = t ? t.kcal - sum.kcal : 0;
  const leftP = t?.p ? t.p - sum.p : 0;
  const oldDiary = logged && !dayEntries[0].fitatu;
  box.innerHTML = `
    ${syncLine()}
    <div class="fd-daynav">
      <button class="icon-btn" data-d="-1" aria-label="Previous day">${icon('back')}</button>
      <button class="fd-daylabel" id="fd-daypick">${esc(dayTitle(day))}</button>
      <button class="icon-btn fd-next" data-d="1" aria-label="Next day" ${day >= today() ? 'disabled' : ''}>${icon('back')}</button>
    </div>
    ${day !== today() ? '<div class="center" style="margin:-4px 0 8px"><button class="link small" id="fd-today">Back to today</button></div>' : ''}
    <div class="card fd-summary">
      <div class="fd-sum-top">${ring(sum.kcal, t?.kcal)}
        <div class="fd-sum-side">
          <div class="fd-sum-kcal"><b>${n0(sum.kcal)}</b> <span class="muted">${t ? `/ ${n0(t.kcal)} kcal` : 'kcal eaten'}</span></div>
          ${t?.liftDay ? `<p class="tiny muted">Lifting day: +${n0(t.liftDay)} kcal</p>` : ''}
          ${bar('Protein', sum.p, t?.p, 'fd-bp')}${bar('Carbs', sum.c, t?.c, 'fd-bc')}${bar('Fat', sum.f, t?.f, 'fd-bf')}
        </div></div>
      ${!logged ? `<p class="small muted" style="margin-top:10px">Nothing logged in Fitatu for this day${day === today() ? ' yet' : ''}.</p>` : ''}
      ${oldDiary ? '<p class="tiny muted" style="margin-top:10px">From the old in-app diary, before the Fitatu sync.</p>' : ''}
      ${t && logged ? `<div class="row between fd-left" style="margin-top:10px"><span class="small"><b>${leftK >= 0 ? `${n0(leftK)} kcal left` : `${n0(-leftK)} kcal over`}</b>${t.p ? ` · <b class="fd-p">${leftP > 0 ? `${n0(leftP)} g protein to go` : 'protein target hit'}</b>` : ''}</span>
        <button class="link small" id="fd-edittargets">Targets</button></div>` : ''}
      ${!t ? `<button class="soft block" id="fd-settargets" style="margin-top:12px">${icon('fire')} Set your daily targets</button>` : ''}
    </div>
    <button class="soft block fd-grocery" id="fd-grocery">${icon('list')} Grocery list${plannedDays().length ? ` <span class="pill">${plannedDays().length} day${plannedDays().length === 1 ? '' : 's'} planned</span>` : ''}</button>
    <h3 class="section-title">This week</h3>
    <div class="card" id="fd-week"></div>`;

  $$('[data-d]', box).forEach((b) => { b.onclick = () => shiftDay(+b.dataset.d, box); });
  $('#fd-today', box)?.addEventListener('click', () => { day = today(); renderDiary(box); });
  $('#fd-daypick', box).onclick = () => pickDate(box);
  $('#fd-grocery', box).onclick = openGrocery;
  $('#fd-settargets', box)?.addEventListener('click', () => openTargets());
  $('#fd-edittargets', box)?.addEventListener('click', () => openTargets());
  renderWeek($('#fd-week', box));

  // swipe left/right to change day
  let sx = null, sy = null;
  box.ontouchstart = (e) => { if (e.target.closest('canvas,input')) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
  box.ontouchend = (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftDay(dx < 0 ? 1 : -1, box);
  };
}

// Fitatu is where food gets logged, so there is nothing to show after today.
function shiftDay(n, box) {
  if (n > 0 && day >= today()) return;
  day = addDays(day, n);
  dayChosenAt = Date.now();
  renderDiary(box);
  box.classList.remove('fd-slide-l', 'fd-slide-r');
  void box.offsetWidth;
  box.classList.add(n > 0 ? 'fd-slide-l' : 'fd-slide-r');
}

function pickDate(box) {
  push((el, s) => {
    el.innerHTML = sheet({ title: 'Go to day', body: `<input type="date" id="fd-date" value="${day}" max="${today()}">
      <div class="sheet-actions" style="margin-top:14px"><button class="ghost" data-a="today">Today</button><button class="primary" data-a="ok">Go</button></div>` });
    $('[data-a=ok]', el).onclick = () => { const v = $('#fd-date', el).value; if (v) { day = v > today() ? today() : v; dayChosenAt = Date.now(); } s.close(); };
    $('[data-a=today]', el).onclick = () => { day = today(); s.close(); };
  }, { sheet: true, onClose: () => { if (box.isConnected) renderDiary(box); } });
}

// ---------- week ----------
function renderWeek(box) {
  const t = targets();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(day, -i));
  const sums = days.map((d) => sumEntries(entriesOf(d)));
  const logged = sums.filter((s) => s.kcal > 0);
  const avgK = logged.length ? logged.reduce((a, s) => a + s.kcal, 0) / logged.length : 0;
  const avgP = logged.length ? logged.reduce((a, s) => a + s.p, 0) / logged.length : 0;
  box.innerHTML = `<div class="stats" style="margin-bottom:12px">
      <div class="stat"><b>${n0(avgK)}</b><span>avg kcal${t ? ` / ${n0(t.kcal)}` : ''}</span></div>
      <div class="stat"><b>${n0(avgP)} g</b><span>avg protein${t ? ` / ${n0(t.p)}` : ''}</span></div>
      <div class="stat"><b>${logged.length}/7</b><span>days logged</span></div></div>
    <div class="chart-box short"><canvas id="fd-wchart"></canvas></div>
    <p class="tiny muted" style="margin-top:6px">Bars: calories · line: protein (g). Averages count only logged days.</p>`;
  const food = cssVar('--food'), prot = cssVar('--protein'), line = cssVar('--text-3');
  chart('fd-wchart', {
    type: 'bar',
    data: {
      labels: days.map((d) => fromDay(d).toLocaleDateString('en-GB', { weekday: 'narrow' })),
      datasets: [
        { label: 'kcal', data: sums.map((s) => Math.round(s.kcal)), backgroundColor: days.map((d) => (d === day ? food : `${food}77`)), borderRadius: 6, yAxisID: 'y', order: 2 },
        ...(t ? [{ type: 'line', label: 'Target kcal', data: days.map((d) => dayTargets(d).kcal), borderColor: line, borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5, yAxisID: 'y', order: 1 }] : []),
        { type: 'line', label: 'Protein g', data: sums.map((s) => (s.kcal > 0 ? Math.round(s.p) : null)), spanGaps: true, borderColor: prot, backgroundColor: prot, pointRadius: 2.5, borderWidth: 2, tension: 0.3, yAxisID: 'y2', order: 0 },
      ],
    },
    options: {
      scales: { y: { beginAtZero: true, grid: { display: false }, ticks: { maxTicksLimit: 4 } },
        y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { maxTicksLimit: 4 } }, x: { grid: { display: false } } },
    },
  });
}

// ---------- targets ----------
export function openTargets() {
  const cfg = settings();
  const lw = latestWeight(store.all('bodyweight'));
  const prof = { sex: 'male', age: '', height: '', activity: 'moderate', goal: 'maintain', rate: 0.5, proteinPerKg: 1.8, ...(cfg.profile || {}) };
  prof.weight = lw ? lw.kg : (prof.weight ?? '');
  let tg = { ...(cfg.targets || {}) };
  // Built once; typing in the profile only repaints the suggestion card, so the field you tap next is never replaced.
  const suggestion = () => suggestTargets({ ...prof, age: +prof.age, height: +prof.height, weight: parseNum(prof.weight) || 0 });
  const sugHtml = (sug) => (sug ? `
        <div class="row between"><div><p class="tiny muted">Suggested for you</p><div class="fd-big">${n0(sug.kcal)} <span>kcal</span></div></div>
          <div class="fd-pcf"><span class="fd-p">P ${sug.protein}</span><span class="fd-c">C ${sug.carbs}</span><span class="fd-f">F ${sug.fat}</span></div></div>
        <p class="tiny muted" style="margin-top:8px">At rest you burn ≈ ${n0(sug.bmr)} kcal, with your activity ≈ ${n0(sug.tdee)} kcal${sug.delta ? `; ${sug.delta > 0 ? '+' : '−'}${n0(Math.abs(sug.delta))} kcal a day for your goal` : ''}.</p>
        <button class="soft block" id="fd-use" style="margin-top:12px">Use these numbers</button>`
    : '<p class="small muted">Fill in age, height and weight to get a suggestion.</p>');
  push((el, scr) => {
    el.innerHTML = page({ title: 'Daily targets', right: '<button class="primary" id="fd-tsave">Save</button>', body: `
      <p class="small muted" style="margin:0 2px 14px">Your calorie need is estimated from your body (Mifflin-St Jeor formula) times how active you are. To lose weight you eat a bit less than that, to gain a bit more. Plenty of protein keeps your muscle, fat is about 27% of calories and the rest is carbs.</p>
      <div class="card form" id="fd-prof">
        <div class="seg" id="fd-sex"><button data-v="male" class="${prof.sex === 'male' ? 'on' : ''}">Male</button><button data-v="female" class="${prof.sex === 'female' ? 'on' : ''}">Female</button></div>
        <div class="fd-3"><label>Age<input name="age" inputmode="numeric" value="${esc(prof.age ?? '')}"></label>
          <label>Height (cm)<input name="height" inputmode="numeric" value="${esc(prof.height ?? '')}"></label>
          <label>Weight (kg)<input name="weight" inputmode="decimal" value="${esc(prof.weight)}"></label></div>
        <label>Activity<select name="activity">${ACTIVITY.map((a) => `<option value="${a.key}" ${a.key === prof.activity ? 'selected' : ''}>${esc(a.label)} — ${esc(a.hint)}</option>`).join('')}</select></label>
        <div class="seg" id="fd-goal">${['lose', 'maintain', 'gain'].map((g) => `<button data-v="${g}" class="${prof.goal === g ? 'on' : ''}">${g === 'lose' ? 'Lose weight' : g === 'gain' ? 'Gain' : 'Maintain'}</button>`).join('')}</div>
        <label id="fd-pace" ${prof.goal === 'maintain' ? 'hidden' : ''}>Pace<select name="rate">${[0.25, 0.5, 0.75, 1].map((r) => `<option value="${r}" ${+prof.rate === r ? 'selected' : ''}>${r} kg per week${r === 0.5 ? ' (recommended)' : ''}</option>`).join('')}</select></label>
        <label>Protein<select name="proteinPerKg">${[1.6, 1.8, 2, 2.2].map((r) => `<option value="${r}" ${+prof.proteinPerKg === r ? 'selected' : ''}>${r} g per kg of body weight</option>`).join('')}</select></label>
      </div>
      <div class="card" style="margin-top:12px" id="fd-sug"></div>
      <h3 class="section-title">Your targets (you can change any number)</h3>
      <div class="card form" id="fd-tg">
        <div class="form-row"><label>Calories (kcal)<input name="kcal" inputmode="numeric" value="${esc(tg.kcal ?? '')}"></label>
        <label>Protein (g)<input name="p" inputmode="numeric" value="${esc(tg.p ?? '')}"></label></div>
        <div class="form-row"><label>Carbs (g)<input name="c" inputmode="numeric" value="${esc(tg.c ?? '')}"></label>
        <label>Fat (g)<input name="f" inputmode="numeric" value="${esc(tg.f ?? '')}"></label></div>
        <p class="tiny muted" id="fd-tgsum"></p>
      </div>` });
    const tgSum = () => {
      const v = (n) => parseNum($(`#fd-tg [name=${n}]`, el).value) || 0;
      const e = v('p') * 4 + v('c') * 4 + v('f') * 9;
      const k = v('kcal');
      const off = k && e && Math.abs(e - k) > k * 0.05;
      $('#fd-tgsum', el).textContent = e ? `Protein, carbs and fat add up to ${n0(e)} kcal${off ? ` - ${n0(Math.abs(e - k))} kcal ${e > k ? 'more' : 'less'} than your calorie target. Change carbs or fat to match.` : '.'}` : '';
    };
    const setTg = (v) => { ['kcal', 'p', 'c', 'f'].forEach((k) => { $(`#fd-tg [name=${k}]`, el).value = v[k] ?? ''; }); readTg(); tgSum(); };
    const readTg = () => { ['kcal', 'p', 'c', 'f'].forEach((k) => { tg[k] = parseNum($(`#fd-tg [name=${k}]`, el).value); }); };
    const paintSug = () => {
      const sug = suggestion();
      $('#fd-sug', el).innerHTML = sugHtml(sug);
      $('#fd-use', el)?.addEventListener('click', () => setTg({ kcal: sug.kcal, p: sug.protein, c: sug.carbs, f: sug.fat }));
    };
    $$('#fd-tg input', el).forEach((i) => { i.oninput = () => { readTg(); tgSum(); }; });
    $$('#fd-prof input', el).forEach((i) => { i.oninput = () => { prof[i.name] = i.value; paintSug(); }; });
    $$('#fd-prof select', el).forEach((i) => { i.onchange = () => { prof[i.name] = i.value; paintSug(); }; });
    const segPick = (id, key) => $$(`#${id} button`, el).forEach((b) => { b.onclick = () => {
      prof[key] = b.dataset.v;
      $$(`#${id} button`, el).forEach((x) => x.classList.toggle('on', x === b));
      $('#fd-pace', el).hidden = prof.goal === 'maintain';
      paintSug();
    }; });
    segPick('fd-sex', 'sex');
    segPick('fd-goal', 'goal');
    paintSug();
    tgSum();
    $('#fd-tsave', el).onclick = async () => {
      readTg();
      if (!(tg.kcal > 0)) { toast('Set at least a calorie target'); return; }
      await saveSettings({
        profile: { sex: prof.sex, age: +prof.age || null, height: +prof.height || null, activity: prof.activity, goal: prof.goal, rate: +prof.rate, proteinPerKg: +prof.proteinPerKg },
        targets: { kcal: Math.round(tg.kcal), p: Math.round(tg.p || 0), c: Math.round(tg.c || 0), f: Math.round(tg.f || 0) },
      });
      const w = parseNum(prof.weight);
      if (w > 20 && w < 400 && (!lw || Math.abs(lw.kg - w) > 0.01)) await logWeight(w);
      toast('Targets saved');
      scr.close();
    };
  });
}

// ---------- body weight ----------
async function logWeight(kg, d = today()) {
  const existing = store.all('bodyweight').find((e) => e.day === d);
  await store.put('bodyweight', { ...(existing ? { id: existing.id } : {}), day: d, kg: Math.round(kg * 100) / 100 });
}

function weightCard(box) {
  const entries = store.all('bodyweight');
  const tr = weightTrend(entries);
  const last = tr[tr.length - 1];
  const wc = weeklyChange(entries);
  const todayE = entries.find((e) => e.day === today());
  box.innerHTML = `<div class="card">
    <div class="card-head"><h2>Body weight</h2>${tr.length ? '<button class="link" id="fd-whist">History</button>' : ''}</div>
    <div class="row" style="gap:8px"><input id="fd-w" inputmode="decimal" placeholder="${last ? n1(last.kg) : 'kg, e.g. 80,5'}" value="${todayE ? esc(String(todayE.kg)) : ''}" style="flex:1;min-width:0">
      <button class="primary" id="fd-wlog">${todayE ? 'Update' : 'Log'} today</button></div>
    ${tr.length ? `<div class="stats" style="margin-top:12px">
      <div class="stat"><b>${n1(last.kg)}</b><span>kg · ${esc(relDay(fromDay(last.day)))}</span></div>
      <div class="stat"><b>${n1(last.avg)}</b><span>kg 7-day avg</span></div>
      <div class="stat"><b>${wc == null ? '–' : `${wc > 0 ? '+' : ''}${n1(wc)}`}</b><span>kg per week</span></div></div>
      ${tr.length > 1 ? '<div class="chart-box" style="margin-top:12px"><canvas id="fd-wchart2"></canvas></div>' : ''}`
      : '<p class="small muted" style="margin-top:10px">Weigh yourself in the morning a few times a week. The 7-day average smooths out daily water swings.</p>'}
  </div>`;
  $('#fd-wlog', box).onclick = async () => {
    const v = parseNum($('#fd-w', box).value);
    if (!(v > 20 && v < 400)) { toast('Enter your weight in kg'); return; }
    await logWeight(v);
    toast('Weight saved');
  };
  $('#fd-w', box).onkeydown = (e) => { if (e.key === 'Enter') $('#fd-wlog', box).click(); };
  $('#fd-whist', box)?.addEventListener('click', openWeightHistory);
  if (tr.length > 1) {
    const recent = tr.slice(-90);
    const acc = cssVar('--food');
    chart('fd-wchart2', {
      type: 'line',
      data: {
        labels: recent.map((e) => niceDate(fromDay(e.day))),
        datasets: [
          { label: 'Weight', data: recent.map((e) => e.kg), borderColor: 'transparent', backgroundColor: cssVar('--text-3'), pointRadius: 2.5, showLine: false },
          { label: '7-day avg', data: recent.map((e) => Math.round(e.avg * 10) / 10), borderColor: acc, backgroundColor: fade(acc), fill: true, pointRadius: 0, borderWidth: 2.5, tension: 0.35 },
        ],
      },
      options: { scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 5 } }, y: { ticks: { maxTicksLimit: 5 } } } },
    });
  }
}

function openWeightHistory() {
  push((el, s) => {
    const list = store.all('bodyweight').sort((a, b) => b.day.localeCompare(a.day));
    el.innerHTML = page({ title: 'Weight history', body: `${list.length ? `<div class="card"><div class="list">${list.map((e) => `<button class="list-item" data-w="${e.id}">
      <div class="grow">${esc(niceDate(fromDay(e.day), { weekday: true, year: true }))}</div><b>${n1(e.kg)} kg</b></button>`).join('')}</div></div>` : '<div class="card empty">No entries yet.</div>'}
      <button class="ghost block" id="fd-wadd" style="margin-top:12px">${icon('plus')} Add a past entry</button>` });
    $$('[data-w]', el).forEach((b) => { b.onclick = async () => {
      const e = store.get(b.dataset.w);
      const v = await chooseSheet(`${niceDate(fromDay(e.day))} · ${n1(e.kg)} kg`, [{ value: 'del', label: 'Delete entry', icon: 'trash', danger: true }]);
      if (v === 'del') { await store.remove(e.id); toast('Deleted'); }
    }; });
    $('#fd-wadd', el).onclick = () => push((el2, s2) => {
      el2.innerHTML = sheet({ title: 'Add weight', body: `<div class="form-row"><label>Day<input type="date" id="fd-wd" value="${addDays(today(), -1)}" max="${today()}"></label>
        <label>Weight (kg)<input id="fd-wk" inputmode="decimal"></label></div><div class="sheet-actions" style="margin-top:14px"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">Save</button></div>` });
      $('[data-a=no]', el2).onclick = () => s2.close();
      $('[data-a=ok]', el2).onclick = async () => {
        const v = parseNum($('#fd-wk', el2).value), d = $('#fd-wd', el2).value;
        if (!(v > 20 && v < 400) || !d) return;
        await logWeight(v, d);
        s2.close();
      };
    }, { sheet: true });
  });
}

// ---------- Me tab section ----------
export const meSection = {
  order: 30,
  render(el) {
    const t = targets();
    el.innerHTML = `<h3 class="section-title" style="margin-top:4px">Nutrition &amp; body</h3>
      <div class="card"><div class="card-head" style="margin-bottom:${t ? 10 : 6}px"><h2>Daily targets</h2><button class="link" id="fd-tedit">${t ? 'Edit' : 'Set up'}</button></div>
        ${t ? `<div class="fd-tsum"><div><b>${n0(t.kcal)}</b><span>kcal</span></div><div class="fd-p"><b>${n0(t.p)}</b><span>protein g</span></div>
          <div class="fd-c"><b>${n0(t.c)}</b><span>carbs g</span></div><div class="fd-f"><b>${n0(t.f)}</b><span>fat g</span></div></div>
          ${+store.getConfig('cut', {}).liftDayBonus ? `<p class="tiny muted" style="margin-top:8px">+${n0(+store.getConfig('cut', {}).liftDayBonus)} kcal on cut-plan lifting days (from a weekly review).</p>` : ''}`
          : '<p class="small muted">Calculate how much to eat for your goal (lose, keep or gain weight).</p>'}</div>
      <div id="fd-wbox" style="margin-top:12px"></div>`;
    $('#fd-tedit', el).onclick = () => openTargets();
    weightCard($('#fd-wbox', el));
  },
};

// ---------- Home card ----------
export const homeCard = {
  order: 20,
  render(el) {
    const t = dayTargets(today());
    const s = sumEntries(entriesOf(today()));
    const bw = store.all('bodyweight');
    const w = weightTrend(bw);
    const last = w[w.length - 1];
    const wc = weeklyChange(bw);
    const left = t ? t.kcal - s.kcal : null;
    el.innerHTML = `<div class="card fd-home">
      <div class="card-head"><h2 class="row" style="gap:8px"><span class="fd-home-ic">${icon('food')}</span>Food today</h2>
        <button class="link" id="fd-hopen">Week</button></div>
      <div class="fd-home-row">${ring(s.kcal, t?.kcal, { size: 96 })}
        <div class="grow stack-sm">
          ${bar('Calories', s.kcal, t?.kcal, 'fd-bk', 'kcal')}
          ${bar('Protein', s.p, t?.p, 'fd-bp')}
        </div></div>
      ${last ? `<p class="small muted fd-home-w">${icon('scale')} Weight ${n1(last.avg)} kg (7-day avg)${wc != null ? ` · ${wc > 0 ? '+' : ''}${n1(wc)} kg/week` : ''}</p>` : ''}
      ${!t ? '<p class="small muted" style="margin-top:10px">No daily targets yet. <button class="link" id="fd-htargets">Set your targets</button></p>' : left < 0 ? `<p class="small down" style="margin-top:10px">${n0(-left)} kcal over today's target</p>` : ''}
      <p class="tiny muted" style="margin-top:10px">${s.kcal ? 'From Fitatu' : 'Nothing logged in Fitatu yet today'}${fitatuStatus()?.last_sync_at ? ` · synced ${esc(ago(fitatuStatus().last_sync_at))}` : ''}</p>
    </div>`;
    $('#fd-hopen', el).onclick = () => { day = today(); window.showTab('food'); };
    $('#fd-htargets', el)?.addEventListener('click', openTargets);
  },
};
