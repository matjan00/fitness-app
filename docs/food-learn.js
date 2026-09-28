// "Learn to cook" section of the Food tab: short technique/flavour lessons, learned/practice progress,
// and links to the user's own recipes that use a lesson's technique tags. Pure content lives in
// data/lessons.json (lazy-loaded once, cached in memory). Progress is one config object, kind 'config'
// key 'learn': { [lessonId]: { learned: bool, practice: [{ day, rating, note }] } }.

import { $, $$, esc, icon, toast, today, niceDate, fromDay } from './util.js';
import * as store from './store.js';
import { push, page, sheet } from './nav.js';
import { CATEGORIES, catLabel } from './food-cats.js';

// ---------- data loading ----------
let lessonsPromise = null;
let lessonsCache = null;
export function loadLessons(url = 'data/lessons.json') {
  if (lessonsCache) return Promise.resolve(lessonsCache);
  if (!lessonsPromise) {
    lessonsPromise = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Could not load lessons (${r.status})`);
      return r.json();
    }).then((j) => { lessonsCache = j; return j; }).catch((e) => { lessonsPromise = null; throw e; });
  }
  return lessonsPromise;
}
export const lessonsLoaded = () => lessonsCache;
const lessonById = (id) => lessonsCache?.find((l) => l.id === id) || null;

// ---------- progress ----------
const progress = () => store.getConfig('learn', {});
const lessonProgress = (id) => progress()[id] || { learned: false, practice: [] };
async function saveLessonProgress(id, patch) {
  const p = progress();
  const cur = p[id] || { learned: false, practice: [] };
  const next = { ...p, [id]: { ...cur, ...patch } };
  delete next.id; delete next.key;
  await store.setConfig('learn', next);
}

// Lessons whose technique tags overlap a recipe's technique tags.
export function lessonsForTechniques(techniqueKeys = []) {
  if (!lessonsCache || !techniqueKeys.length) return [];
  return lessonsCache.filter((l) => (l.techniques || []).some((t) => techniqueKeys.includes(t)));
}

// ---------- Food-tab section: the learning path grouped by module ----------
export function renderLearn(box) {
  box.innerHTML = '<div class="card center" style="padding:34px 0"><span class="spinner"></span></div>';
  loadLessons().then((lessons) => drawPath(box, lessons)).catch(() => {
    box.innerHTML = '<div class="card empty"><p>Could not load the lessons. Check your connection and try again.</p></div>';
  });
}

function statusOf(l) {
  const p = lessonProgress(l.id);
  if (p.practice?.length) return { key: 'practised', label: `Practised ${p.practice.length}×` };
  if (p.learned) return { key: 'learned', label: 'Learned' };
  return { key: 'new', label: 'New' };
}

function drawPath(box, lessons) {
  const p = progress();
  const learnedCount = lessons.filter((l) => p[l.id]?.learned).length;
  const modules = [];
  for (const l of lessons) if (!modules.includes(l.module)) modules.push(l.module);
  box.innerHTML = `
    <div class="card fd-learn-hero">
      <div class="row between"><h2>Learn to cook</h2><span class="pill">${learnedCount}/${lessons.length} learned</span></div>
      <p class="small muted" style="margin-top:6px">Short, practical lessons on technique and flavour — cook better, not just log food.</p>
    </div>
    ${modules.map((m) => {
      const items = lessons.filter((l) => l.module === m);
      const done = items.filter((l) => p[l.id]?.learned).length;
      return `<h3 class="section-title">${esc(m)} <span class="muted" style="font-weight:600">${done}/${items.length}</span></h3>
        <div class="card fd-learn-list">${items.map((l) => lessonCard(l)).join('')}</div>`;
    }).join('')}`;
  $$('[data-lesson]', box).forEach((b) => { b.onclick = () => openLesson(b.dataset.lesson, box); });
}

function lessonCard(l) {
  const st = statusOf(l);
  return `<button class="list-item fd-learn-item" data-lesson="${l.id}">
    <div class="grow"><div class="ellipsis"><b>${esc(l.title)}</b></div><div class="sub">${esc(l.summary)}</div></div>
    <div class="fd-learn-meta"><span class="tiny muted">${l.minutes} min</span><span class="fd-learn-status fd-learn-${st.key}">${esc(st.label)}</span></div>
  </button>`;
}

// ---------- lesson screen ----------
export function openLesson(id, refreshBox) {
  push((el, s) => {
    const l = lessonById(id);
    if (!l) { el.innerHTML = page({ title: 'Lesson', body: '<div class="empty">Lesson not found.</div>' }); return; }
    const prog = lessonProgress(id);
    const recipes = recipesFor(l.techniques);
    const videoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(l.videoQuery)}`;
    el.innerHTML = page({ title: l.title, sub: `${l.module} · ${l.minutes} min`, body: `
      <p class="fd-learn-summary">${esc(l.summary)}</p>

      <h3 class="section-title">Why it works</h3>
      <div class="card"><p>${esc(l.why)}</p></div>

      <h3 class="section-title">Steps</h3>
      <div class="card"><ol class="fd-steps">${l.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol></div>

      <h3 class="section-title">Common mistakes</h3>
      <div class="card stack-sm">${l.mistakes.map((m) => `<div class="fd-learn-mistake"><b>${esc(m.mistake)}</b><p class="small muted" style="margin-top:2px">${esc(m.fix)}</p></div>`).join('')}</div>

      ${l.doneness.length ? `<h3 class="section-title">Doneness</h3>
      <div class="card"><ul class="fd-learn-ul">${l.doneness.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>` : ''}

      <h3 class="section-title">Flavour tips</h3>
      <div class="card"><ul class="fd-learn-ul">${l.flavorTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>

      <h3 class="section-title">Practise this week</h3>
      <div class="card"><p><b>${esc(l.practice.task)}</b></p><p class="small muted" style="margin-top:6px">${esc(l.practice.successCriteria)}</p></div>

      <h3 class="section-title">Level up</h3>
      <div class="card"><p>${esc(l.levelUp)}</p></div>

      ${recipes.length ? `<h3 class="section-title">Your recipes using this</h3>
      <div class="card"><div class="list">${recipes.map((r) => `<button class="list-item" data-recipe="${r.id}"><div class="grow ellipsis">${esc(r.title)}</div></button>`).join('')}</div></div>` : ''}

      ${prog.practice?.length ? `<h3 class="section-title">Your practice history</h3>
      <div class="card"><div class="list">${prog.practice.slice().reverse().map((pr) => `<div class="list-item" style="cursor:default"><div class="grow"><div>${esc(niceDate(fromDay(pr.day)))}${pr.note ? ` <span class="muted">— ${esc(pr.note)}</span>` : ''}</div></div><b>${'★'.repeat(pr.rating)}${'☆'.repeat(5 - pr.rating)}</b></div>`).join('')}</div></div>` : ''}

      <div class="row" style="gap:8px;margin-top:16px">
        <button class="soft grow" id="fd-lvid">${icon('play')} Watch videos</button>
      </div>
      <button class="${prog.learned ? 'soft' : 'primary'} block" id="fd-llearn" style="margin-top:10px">${icon('check')} ${prog.learned ? 'Learned ✓ (tap to unmark)' : 'Mark as learned'}</button>
      <button class="ghost block" id="fd-lpractice" style="margin-top:10px">${icon('bolt')} I practised this</button>
    ` });
    $('#fd-lvid', el).onclick = () => window.open(videoUrl, '_blank', 'noopener');
    $('#fd-llearn', el).onclick = async () => { await saveLessonProgress(id, { learned: !prog.learned }); s.render(); refreshBox && drawIfConnected(refreshBox); };
    $('#fd-lpractice', el).onclick = () => practiceSheet(id, () => { s.render(); refreshBox && drawIfConnected(refreshBox); });
    $$('[data-recipe]', el).forEach((b) => { b.onclick = () => { import('./food-recipes.js').then((m) => m.openRecipe(b.dataset.recipe)); }; });
  });
}

function drawIfConnected(box) { if (box?.isConnected) renderLearn(box); }

function recipesFor(techniqueKeys = []) {
  if (!techniqueKeys.length) return [];
  return store.all('recipe').filter((r) => (r.cats?.technique || []).some((t) => techniqueKeys.includes(t)));
}

function practiceSheet(id, onDone) {
  let rating = 4;
  push((el, s) => {
    el.innerHTML = sheet({ title: 'I practised this', body: `
      <div class="fd-learn-stars" id="fd-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= rating ? 'on' : ''}">${icon('heart')}</button>`).join('')}</div>
      <textarea id="fd-pnote" rows="3" placeholder="Optional note — what worked, what to try next time"></textarea>
      <div class="sheet-actions"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">Save</button></div>` });
    const paint = () => $$('#fd-stars button', el).forEach((b) => b.classList.toggle('on', +b.dataset.star <= rating));
    $$('#fd-stars button', el).forEach((b) => { b.onclick = () => { rating = +b.dataset.star; paint(); }; });
    $('[data-a=no]', el).onclick = () => s.close();
    $('[data-a=ok]', el).onclick = async () => {
      const note = $('#fd-pnote', el).value.trim();
      const prog = lessonProgress(id);
      const practice = [...(prog.practice || []), { day: today(), rating, note }];
      await saveLessonProgress(id, { practice, learned: true });
      toast('Nice — logged your practice');
      s.close();
      onDone?.();
    };
  }, { sheet: true });
}

// Category chips for a recipe's detail screen: "Practises: <lesson title>" for lessons whose technique
// tags overlap the recipe's. Returns HTML, or '' if lessons aren't loaded yet or none match.
export function practisesChipsHtml(recipe) {
  if (!lessonsCache) return '';
  const keys = recipe.cats?.technique || [];
  if (!keys.length) return '';
  const matches = lessonsForTechniques(keys);
  if (!matches.length) return '';
  return `<div class="fd-chipwrap" style="margin-top:8px">${matches.map((l) => `<button class="pill fd-learn-pill" data-lesson-link="${l.id}">Practises: ${esc(l.title)}</button>`).join('')}</div>`;
}
export function bindPractisesChips(el) {
  el.querySelectorAll('[data-lesson-link]').forEach((b) => { b.onclick = () => openLesson(b.dataset.lessonLink); });
}

export { CATEGORIES, catLabel };
