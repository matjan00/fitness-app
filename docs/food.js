// Food: diary (Fitatu-style), recipe book, targets calculator, body weight. See food-recipes.js / food-ui.js for the rest.

import { $, $$, esc, icon, toast, n0, n1, parseNum, local, today, addDays, fromDay, niceDate, relDay } from './util.js';
import * as store from './store.js';
import { push, page, sheet, chooseSheet } from './nav.js';
import { chart, fade, cssVar } from './charts.js';
import { sumEntries, suggestTargets, ACTIVITY, weightTrend, weeklyChange, latestWeight, macrosFor } from './food-calc.js';
import { MEALS, mealLabel, settings, targets, saveSettings, ring, bar, pickFood, amountSheet, snap, customFoodForm, img } from './food-ui.js';
import { renderBook, openImport, logRecipe, recipePer, openRecipe } from './food-recipes.js';
import { loadFoods } from './food-db.js';

export const tab = { id: 'food', title: 'Food', icon: 'food', render };

let day = today();
let dayChosenAt = Date.now();
const view = () => local.get('fd-view', 'diary');

function entriesOf(d, meal) {
  return store.all('meal').filter((e) => e.day === d && (!meal || e.meal === meal)).sort((a, b) => (a.t || '').localeCompare(b.t || ''));
}
const mealNow = () => { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack'; };

// ---------- tab ----------
function render(el) {
  // After a long pause (e.g. next morning) jump back to today.
  if (Date.now() - dayChosenAt > 3 * 3600 * 1000) { day = today(); dayChosenAt = Date.now(); }
  const v = view();
  el.innerHTML = `<div class="page-head row between"><h1>Food</h1>
      <div class="seg fd-viewseg"><button data-v="diary" class="${v === 'diary' ? 'on' : ''}">Diary</button><button data-v="recipes" class="${v === 'recipes' ? 'on' : ''}">Recipes</button></div></div>
    <div id="fd-body"></div>`;
  $$('.fd-viewseg button', el).forEach((b) => { b.onclick = () => { local.set('fd-view', b.dataset.v); render(el); }; });
  const body = $('#fd-body', el);
  if (v === 'recipes') renderBook(body); else renderDiary(body);
}

function dayTitle(d) {
  const r = relDay(fromDay(d));
  return r === 'Today' || r === 'Yesterday' ? `${r}, ${niceDate(fromDay(d))}` : niceDate(fromDay(d), { weekday: true });
}

function renderDiary(box) {
  const t = targets();
  const sum = sumEntries(entriesOf(day));
  box.innerHTML = `
    <div class="fd-daynav">
      <button class="icon-btn" data-d="-1" aria-label="Previous day">${icon('back')}</button>
      <button class="fd-daylabel" id="fd-daypick">${esc(dayTitle(day))}</button>
      <button class="icon-btn fd-next" data-d="1" aria-label="Next day">${icon('back')}</button>
    </div>
    ${day !== today() ? '<div class="center" style="margin:-4px 0 8px"><button class="link small" id="fd-today">Back to today</button></div>' : ''}
    <div class="card fd-summary">
      <div class="fd-sum-top">${ring(sum.kcal, t?.kcal)}
        <div class="fd-sum-side">
          <div class="fd-sum-kcal"><b>${n0(sum.kcal)}</b> <span class="muted">${t ? `/ ${n0(t.kcal)} kcal` : 'kcal eaten'}</span></div>
          ${bar('Protein', sum.p, t?.p, 'fd-bp')}${bar('Carbs', sum.c, t?.c, 'fd-bc')}${bar('Fat', sum.f, t?.f, 'fd-bf')}
        </div></div>
      ${!t ? `<button class="soft block" id="fd-settargets" style="margin-top:12px">${icon('fire')} Set your daily targets</button>` : ''}
    </div>
    ${MEALS.map((m) => mealCard(m, entriesOf(day, m.key))).join('')}
    <h3 class="section-title">This week</h3>
    <div class="card" id="fd-week"></div>`;

  $$('[data-d]', box).forEach((b) => { b.onclick = () => shiftDay(+b.dataset.d, box); });
  $('#fd-today', box)?.addEventListener('click', () => { day = today(); renderDiary(box); });
  $('#fd-daypick', box).onclick = () => pickDate(box);
  $('#fd-settargets', box)?.addEventListener('click', () => openTargets());
  $$('[data-add]', box).forEach((b) => { b.onclick = () => addTo(b.dataset.add); });
  $$('[data-entry]', box).forEach((b) => { b.onclick = () => editEntry(store.get(b.dataset.entry)); });
  renderWeek($('#fd-week', box));

  // swipe left/right to change day
  let sx = null, sy = null;
  box.ontouchstart = (e) => { if (e.target.closest('canvas,.chips,input')) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
  box.ontouchend = (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftDay(dx < 0 ? 1 : -1, box);
  };
}

function shiftDay(n, box) {
  day = addDays(day, n);
  dayChosenAt = Date.now();
  renderDiary(box);
  box.classList.remove('fd-slide-l', 'fd-slide-r');
  void box.offsetWidth;
  box.classList.add(n > 0 ? 'fd-slide-l' : 'fd-slide-r');
}

function pickDate(box) {
  push((el, s) => {
    el.innerHTML = sheet({ title: 'Go to day', body: `<input type="date" id="fd-date" value="${day}" max="${addDays(today(), 7)}">
      <div class="sheet-actions" style="margin-top:14px"><button class="ghost" data-a="today">Today</button><button class="primary" data-a="ok">Go</button></div>` });
    $('[data-a=ok]', el).onclick = () => { const v = $('#fd-date', el).value; if (v) { day = v; dayChosenAt = Date.now(); } s.close(); };
    $('[data-a=today]', el).onclick = () => { day = today(); s.close(); };
  }, { sheet: true, onClose: () => { if (box.isConnected) renderDiary(box); } });
}

function mealCard(m, list) {
  const s = sumEntries(list);
  return `<div class="card fd-meal">
    <div class="card-head" style="margin-bottom:${list.length ? 6 : 0}px"><div><h2>${esc(m.label)}</h2>
      <p class="tiny muted">${list.length ? `${n0(s.kcal)} kcal · P ${n0(s.p)} · C ${n0(s.c)} · F ${n0(s.f)}` : 'Nothing yet'}</p></div>
      <button class="icon-btn fd-addbtn" data-add="${m.key}" aria-label="Add to ${esc(m.label)}">${icon('plus')}</button></div>
    ${list.length ? `<div class="list">${list.map((e) => `<button class="list-item fd-entry" data-entry="${e.id}">
      <div class="grow"><div class="ellipsis">${esc(e.label)}</div><div class="sub">${esc(amountTxt(e))}</div></div>
      <div class="fd-entry-k"><b>${n0(e.kcal)}</b><span>kcal</span></div></button>`).join('')}</div>` : ''}
  </div>`;
}
function amountTxt(e) {
  if (e.source?.type === 'recipe') return e.servings ? `${n1(e.servings)} serving${e.servings === 1 ? '' : 's'}` : `${n0(e.grams)} g`;
  if (e.source?.type === 'quick') return `Quick add · P ${n0(e.p)} · C ${n0(e.c)} · F ${n0(e.f)}`;
  if (e.unit && e.unit !== 'g' && e.qty) return `${n1(e.qty)} × ${e.unit} · ${n0(e.grams)} g`;
  return `${n0(e.grams)} g`;
}

// ---------- adding ----------
async function addTo(meal) {
  const y = entriesOf(addDays(day, -1), meal);
  const opts = [
    { value: 'recipe', label: 'From my recipes', icon: 'note' },
    { value: 'food', label: 'Search food', icon: 'search' },
    { value: 'quick', label: 'Quick add calories', icon: 'fire' },
  ];
  if (y.length) opts.push({ value: 'copy', label: `Copy yesterday's ${mealLabel(meal).toLowerCase()} (${y.length})`, icon: 'swap' });
  const v = await chooseSheet(`Add to ${mealLabel(meal)}`, opts);
  if (v === 'recipe') pickRecipe(meal);
  else if (v === 'food') addFood(meal);
  else if (v === 'quick') quickAdd(meal);
  else if (v === 'copy') {
    const now = new Date().toISOString();
    await store.putMany('meal', y.map(({ id, ...e }) => ({ ...e, day, t: now })));
    toast(`Copied ${y.length} item${y.length > 1 ? 's' : ''}`);
  }
}

function pickRecipe(meal) {
  const d = day;
  push((el, s) => {
    const recs = store.all('recipe');
    const last = {};
    store.all('meal').forEach((e) => { if (e.source?.type === 'recipe') last[e.source.id] = Math.max(last[e.source.id] || 0, Date.parse(e.t || e.day) || 0); });
    recs.sort((a, b) => (last[b.id] || 0) - (last[a.id] || 0) || a.title.localeCompare(b.title));
    let q = '';
    const draw = () => {
      const list = recs.filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()));
      $('#fd-rlist', el).innerHTML = list.length ? list.map((r) => { const ps = recipePer(r); return `<button class="list-item" data-rid="${r.id}">${img(r.image, 'fd-thumb')}
        <div class="grow"><div class="ellipsis"><b>${esc(r.title)}</b></div><div class="sub">${n0(ps.kcal)} kcal · P ${n0(ps.p)} g per serving</div></div></button>`; }).join('')
        : `<div class="empty"><p>${recs.length ? 'No recipe matches.' : 'No recipes yet.'}</p><button class="primary" id="fd-imp" style="margin-top:12px">Add a recipe</button></div>`;
      $$('[data-rid]', el).forEach((b) => { b.onclick = async () => { await logRecipe(store.get(b.dataset.rid), { day: d, meal }); s.close(); }; });
      $('#fd-imp', el)?.addEventListener('click', () => { s.close(); setTimeout(() => openImport(), 260); });
    };
    el.innerHTML = page({ title: `${mealLabel(meal)} · recipe`, body: `<div class="search">${icon('search')}<input id="fd-q" type="search" placeholder="Search my recipes"></div>
      <div class="card" style="margin-top:12px;padding-top:4px;padding-bottom:4px"><div class="list" id="fd-rlist"></div></div>` });
    $('#fd-q', el).oninput = (e) => { q = e.target.value; draw(); };
    draw();
  });
}

async function addFood(meal) {
  const d = day;
  const f = await pickFood({ title: `${mealLabel(meal)} · food` });
  if (!f) return;
  const last = store.all('meal').filter((e) => e.food?.id === f.id).sort((a, b) => (b.t || '').localeCompare(a.t || ''))[0];
  // Small countable things (egg, banana, slice…) default to pieces; everything else to 100 g.
  const byPiece = f.u?.piece && f.u.piece <= 150;
  const a = await amountSheet(f, { grams: last?.grams || 100, unit: last?.unit || (byPiece ? 'piece' : 'g'), qty: last?.qty ?? (byPiece ? 1 : undefined) });
  if (!a) return;
  await saveFoodEntry({ day: d, meal, food: f, ...a });
  toast(`Added to ${mealLabel(meal)}`);
}
async function saveFoodEntry({ id, t, day: d, meal, food, grams, qty, unit }) {
  const m = macrosFor(food, grams);
  await store.put('meal', {
    ...(id ? { id } : {}), t: t || new Date().toISOString(), day: d, meal, label: food.src === 'db' ? food.en : food.name,
    source: { type: 'food', src: food.src, id: food.id }, food: snap(food), grams, qty, unit, ...m,
  });
}

function quickAdd(meal, entry = null) {
  const d = entry?.day || day;
  push((el, s) => {
    el.innerHTML = sheet({ title: entry ? 'Edit quick add' : `Quick add · ${mealLabel(meal)}`, body: `<form class="form" id="fd-qa" onsubmit="return false">
      <label>Name<input name="label" value="${esc(entry?.label || '')}" placeholder="e.g. Coffee with milk"></label>
      <div class="form-row"><label>Calories (kcal)<input name="kcal" inputmode="decimal" value="${entry ? Math.round(entry.kcal) : ''}"></label>
      <label>Protein (g)<input name="p" inputmode="decimal" value="${entry ? Math.round(entry.p * 10) / 10 : ''}"></label></div>
      <div class="form-row"><label>Carbs (g)<input name="c" inputmode="decimal" value="${entry ? Math.round(entry.c * 10) / 10 : ''}"></label>
      <label>Fat (g)<input name="f" inputmode="decimal" value="${entry ? Math.round(entry.f * 10) / 10 : ''}"></label></div>
      <p class="tiny muted" id="fd-qahint"></p>
      <div class="sheet-actions">${entry ? '<button type="button" class="ghost danger-text" data-a="del">Remove</button>' : '<button type="button" class="ghost" data-a="no">Cancel</button>'}<button type="button" class="primary" data-a="ok">${entry ? 'Save' : 'Add'}</button></div></form>` });
    const fm = $('#fd-qa', el);
    const hint = () => {
      const p = parseNum(fm.p.value) || 0, c = parseNum(fm.c.value) || 0, f = parseNum(fm.f.value) || 0;
      const est = p * 4 + c * 4 + f * 9;
      $('#fd-qahint', el).textContent = est ? `Protein, carbs and fat add up to ~${n0(est)} kcal.` : 'Only calories are required.';
    };
    fm.oninput = hint; hint();
    $('[data-a=ok]', el).onclick = async () => {
      let kcal = parseNum(fm.kcal.value);
      const p = parseNum(fm.p.value) || 0, c = parseNum(fm.c.value) || 0, f = parseNum(fm.f.value) || 0;
      if (kcal == null && (p || c || f)) kcal = p * 4 + c * 4 + f * 9;
      if (kcal == null || kcal < 0) { fm.kcal.focus(); return; }
      await store.put('meal', { ...(entry ? { id: entry.id, t: entry.t } : { t: new Date().toISOString() }), day: d, meal: entry?.meal || meal,
        label: fm.label.value.trim() || 'Quick add', source: { type: 'quick' }, kcal, p, c, f });
      toast(entry ? 'Saved' : `Added to ${mealLabel(meal)}`);
      s.close();
    };
    $('[data-a=no]', el)?.addEventListener('click', () => s.close());
    $('[data-a=del]', el)?.addEventListener('click', async () => { await store.remove(entry.id); toast('Removed'); s.close(); });
    setTimeout(() => (entry ? fm.kcal : fm.label).focus(), 250);
  }, { sheet: true });
}

async function editEntry(e) {
  if (!e) return;
  const type = e.source?.type;
  if (type === 'quick') return quickAdd(e.meal, e);
  if (type === 'recipe') {
    const rec = store.get(e.source.id);
    const v = await chooseSheet(rec ? e.label : `${e.label} (recipe deleted)`, [
      ...(rec ? [{ value: 'edit', label: 'Change amount or meal', icon: 'edit' }, { value: 'open', label: 'Open recipe', icon: 'note' }] : []),
      { value: 'del', label: 'Remove from diary', icon: 'trash', danger: true }]);
    if (v === 'edit') return logRecipe(rec, { entry: e });
    if (v === 'open') return openRecipe(rec.id);
    if (v === 'del') { await store.remove(e.id); toast('Removed'); }
    return;
  }
  const food = e.food || { src: 'custom', name: e.label, k: 0, p: 0, c: 0, f: 0 };
  const a = await amountSheet(food, { title: e.label, grams: e.grams, qty: e.qty, unit: e.unit, ok: 'Save', danger: 'Remove' });
  if (!a) return;
  if (a.remove) { await store.remove(e.id); toast('Removed'); return; }
  await saveFoodEntry({ id: e.id, t: e.t, day: e.day, meal: e.meal, food, ...a });
  toast('Saved');
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
        ...(t ? [{ type: 'line', label: 'Target kcal', data: days.map(() => t.kcal), borderColor: line, borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5, yAxisID: 'y', order: 1 }] : []),
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
  push((el, s) => {
    const sug = suggestTargets({ ...prof, age: +prof.age, height: +prof.height, weight: parseNum(prof.weight) || 0 });
    el.innerHTML = page({ title: 'Daily targets', right: '<button class="primary" id="fd-tsave">Save</button>', body: `
      <p class="small muted" style="margin:0 2px 14px">Your calorie need is estimated from your body (Mifflin-St Jeor formula) times how active you are. To lose weight you eat a bit less than that, to gain a bit more. Plenty of protein keeps your muscle, fat is about 27% of calories and the rest is carbs.</p>
      <div class="card form" id="fd-prof">
        <div class="seg" id="fd-sex"><button data-v="male" class="${prof.sex === 'male' ? 'on' : ''}">Male</button><button data-v="female" class="${prof.sex === 'female' ? 'on' : ''}">Female</button></div>
        <div class="fd-3"><label>Age<input name="age" inputmode="numeric" value="${esc(prof.age ?? '')}"></label>
          <label>Height (cm)<input name="height" inputmode="numeric" value="${esc(prof.height ?? '')}"></label>
          <label>Weight (kg)<input name="weight" inputmode="decimal" value="${esc(prof.weight)}"></label></div>
        <label>Activity<select name="activity">${ACTIVITY.map((a) => `<option value="${a.key}" ${a.key === prof.activity ? 'selected' : ''}>${esc(a.label)} — ${esc(a.hint)}</option>`).join('')}</select></label>
        <div class="seg" id="fd-goal">${['lose', 'maintain', 'gain'].map((g) => `<button data-v="${g}" class="${prof.goal === g ? 'on' : ''}">${g === 'lose' ? 'Lose weight' : g === 'gain' ? 'Gain' : 'Maintain'}</button>`).join('')}</div>
        ${prof.goal !== 'maintain' ? `<label>Pace<select name="rate">${[0.25, 0.5, 0.75, 1].map((r) => `<option value="${r}" ${+prof.rate === r ? 'selected' : ''}>${r} kg per week${r === 0.5 ? ' (recommended)' : ''}</option>`).join('')}</select></label>` : ''}
        <label>Protein<select name="proteinPerKg">${[1.6, 1.8, 2, 2.2].map((r) => `<option value="${r}" ${+prof.proteinPerKg === r ? 'selected' : ''}>${r} g per kg of body weight</option>`).join('')}</select></label>
      </div>
      <div class="card" style="margin-top:12px">${sug ? `
        <div class="row between"><div><p class="tiny muted">Suggested for you</p><div class="fd-big">${n0(sug.kcal)} <span>kcal</span></div></div>
          <div class="fd-pcf"><span class="fd-p">P ${sug.protein}</span><span class="fd-c">C ${sug.carbs}</span><span class="fd-f">F ${sug.fat}</span></div></div>
        <p class="tiny muted" style="margin-top:8px">At rest you burn ≈ ${n0(sug.bmr)} kcal, with your activity ≈ ${n0(sug.tdee)} kcal${sug.delta ? `; ${sug.delta > 0 ? '+' : '−'}${n0(Math.abs(sug.delta))} kcal a day for your goal` : ''}.</p>
        <button class="soft block" id="fd-use" style="margin-top:12px">Use these numbers</button>`
        : '<p class="small muted">Fill in age, height and weight to get a suggestion.</p>'}</div>
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
      $('#fd-tgsum', el).textContent = e ? `Protein, carbs and fat add up to ${n0(e)} kcal.` : '';
    };
    const readTg = () => { ['kcal', 'p', 'c', 'f'].forEach((k) => { tg[k] = parseNum($(`#fd-tg [name=${k}]`, el).value); }); };
    $$('#fd-tg input', el).forEach((i) => { i.oninput = () => { readTg(); tgSum(); }; });
    tgSum();
    const rerender = () => { readTg(); s.render(); };
    $$('#fd-prof input, #fd-prof select', el).forEach((i) => {
      i.onchange = () => { prof[i.name] = i.value; rerender(); };
    });
    $$('#fd-sex button', el).forEach((b) => { b.onclick = () => { prof.sex = b.dataset.v; rerender(); }; });
    $$('#fd-goal button', el).forEach((b) => { b.onclick = () => { prof.goal = b.dataset.v; rerender(); }; });
    $('#fd-use', el)?.addEventListener('click', () => { tg = { kcal: sug.kcal, p: sug.protein, c: sug.carbs, f: sug.fat }; s.render(); });
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
      s.close();
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
          <div class="fd-c"><b>${n0(t.c)}</b><span>carbs g</span></div><div class="fd-f"><b>${n0(t.f)}</b><span>fat g</span></div></div>`
          : '<p class="small muted">Calculate how much to eat for your goal (lose, keep or gain weight).</p>'}</div>
      <div id="fd-wbox" style="margin-top:12px"></div>
      <div class="card" style="margin-top:12px"><div class="card-head" style="margin-bottom:0"><div><h2>My foods</h2><p class="tiny muted">${store.all('food').length} saved · products you added from a label</p></div>
        <button class="link" id="fd-myfoods">Manage</button></div></div>`;
    $('#fd-tedit', el).onclick = () => openTargets();
    $('#fd-myfoods', el).onclick = openMyFoods;
    weightCard($('#fd-wbox', el));
  },
};

function openMyFoods() {
  push((el) => {
    const list = store.all('food').sort((a, b) => a.name.localeCompare(b.name));
    el.innerHTML = page({ title: 'My foods', body: `${list.length ? `<div class="card"><div class="list">${list.map((f) => `<button class="list-item" data-f="${f.id}">
      <div class="grow"><b class="ellipsis" style="display:block">${esc(f.name)}</b><div class="sub">${f.brand ? `${esc(f.brand)} · ` : ''}${n0(f.k)} kcal · P ${n1(f.p)} · C ${n1(f.c)} · F ${n1(f.f)} per 100 g</div></div></button>`).join('')}</div></div>`
      : '<div class="card empty">No foods yet. Add products from their nutrition label.</div>'}
      <button class="primary block" id="fd-newfood" style="margin-top:12px">${icon('plus')} New food</button>` });
    $$('[data-f]', el).forEach((b) => { b.onclick = () => customFoodForm({ ...store.get(b.dataset.f), src: 'custom' }); });
    $('#fd-newfood', el).onclick = () => customFoodForm();
  });
}

// ---------- Home card ----------
export const homeCard = {
  order: 20,
  render(el) {
    const t = targets();
    const s = sumEntries(entriesOf(today()));
    const bw = store.all('bodyweight');
    const w = weightTrend(bw);
    const last = w[w.length - 1];
    const wc = weeklyChange(bw);
    const left = t ? t.kcal - s.kcal : null;
    el.innerHTML = `<div class="card fd-home">
      <div class="card-head"><h2 class="row" style="gap:8px"><span class="fd-home-ic">${icon('food')}</span>Food today</h2>
        <button class="link" id="fd-hopen">Diary</button></div>
      <div class="fd-home-row">${ring(s.kcal, t?.kcal, { size: 96 })}
        <div class="grow stack-sm">
          ${bar('Calories', s.kcal, t?.kcal, 'fd-bk', 'kcal')}
          ${bar('Protein', s.p, t?.p, 'fd-bp')}
        </div></div>
      ${last ? `<p class="small muted fd-home-w">${icon('scale')} Weight ${n1(last.avg)} kg (7-day avg)${wc != null ? ` · ${wc > 0 ? '+' : ''}${n1(wc)} kg/week` : ''}</p>` : ''}
      ${!t ? '<p class="small muted" style="margin-top:10px">Set your daily targets in Me → Nutrition &amp; body.</p>' : left < 0 ? `<p class="small down" style="margin-top:10px">${n0(-left)} kcal over today's target</p>` : ''}
      <button class="primary block" id="fd-hlog" style="margin-top:12px">${icon('plus')} Log food</button>
    </div>`;
    $('#fd-hopen', el).onclick = () => { local.set('fd-view', 'diary'); day = today(); window.showTab('food'); };
    $('#fd-hlog', el).onclick = () => {
      local.set('fd-view', 'diary');
      day = today();
      window.showTab('food');
      setTimeout(() => addTo(mealNow()), 50);
    };
  },
};

// ---------- init: Android share target ----------
export function init() {
  const p = new URLSearchParams(location.search);
  const parts = ['share_title', 'share_text', 'share_url'].map((k) => p.get(k)).filter(Boolean);
  if (parts.length) {
    history.replaceState(history.state, '', location.pathname + location.hash);
    const all = parts.join('\n');
    const url = (all.match(/https?:\/\/[^\s<>"']+/) || [])[0];
    local.set('fd-view', 'recipes');
    setTimeout(() => {
      window.showTab('food');
      setTimeout(() => openImport(url ? { url, auto: true } : { text: all }), 60);
    }, 0);
  }
  // Warm up the food table in the background so the first search is instant.
  setTimeout(() => loadFoods().catch(() => {}), 1500);
}
