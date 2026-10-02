// Gym tracker: exercise library (browse / picker), exercise detail page and custom exercises.
import { $, $$, esc, icon, toast, niceDate } from './util.js';
import * as store from './store.js';
import { push, page, sheet, chooseSheet, confirmSheet } from './nav.js';
import { chart, fade, cssVar } from './charts.js';
import {
  MUSCLE_GROUPS, MODES, exGroups, sortExercises, matchesSearch, exerciseRecords, exerciseSeries, PR_KINDS,
  formatMetric, formatSet, isWorking, e1rm, fmtNum, fmtDur,
} from './gym-calc.js';
import {
  loadDb, allExercises, exById, exName, IMG, recent, workouts, modeFor, prsOf, saveSettings, settings,
} from './gym-data.js';

export const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'body only', 'kettlebells', 'bands', 'e-z curl bar',
  'medicine ball', 'exercise ball', 'foam roll', 'other'];
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const PAGE = 60;

// Small square picture of an exercise (first frame), with the initial as a fallback.
export function thumb(id, cls = '') {
  const ex = exById(id);
  const letter = esc((ex?.n || exName(id) || '?').trim()[0] || '?');
  const img = ex && !ex.custom && ex.im ? `<img src="${IMG(id)}" alt="" loading="lazy" decoding="async">` : '';
  return `<span class="gx-thumb ${cls}">${letter}${img}</span>`;
}
// Remove pictures that fail to load (offline, missing) so the letter shows.
export function handleImgErrors(root) {
  if (root.dataset.gxImg) return;
  root.dataset.gxImg = '1';
  root.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
}

const subLine = (ex) => {
  const g = exGroups(ex);
  return [g.join(', ') || (ex.p?.[0] ? cap(ex.p[0]) : ''), ex.eq ? cap(ex.eq) : '', ex.custom ? 'Custom' : ''].filter(Boolean).join(' · ');
};

// ---------- library list (used by the Exercises tab and the picker) ----------
// opts: { mode: 'browse'|'multi'|'single', state: {q, g, eq}, selected: [] ids, onPick(id), onChange() }
export function mountLibrary(root, opts) {
  const st = opts.state;
  handleImgErrors(root);
  root.innerHTML = `
    <div class="gx-lib-top ${opts.sticky ? 'sticky' : ''}">
      <div class="search">${icon('search')}<input type="search" class="gx-q" placeholder="Search exercises" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="chips gx-groups">${['All', ...MUSCLE_GROUPS].map((g) => `<button class="chip ${st.g === g ? 'on' : ''}" data-g="${g}">${g}</button>`).join('')}</div>
      <div class="gx-lib-row">
        <select class="gx-eq" aria-label="Equipment"><option value="">All equipment</option>
          ${EQUIPMENT.map((e) => `<option value="${esc(e)}" ${st.eq === e ? 'selected' : ''}>${esc(cap(e))}</option>`).join('')}</select>
        <button class="soft gx-new">${icon('plus')} Custom</button>
      </div>
    </div>
    <div class="gx-exlist"><div class="gx-loading"><div class="spinner"></div></div></div>
    <div class="gx-sentinel"></div>`;

  let items = [];
  let shown = 0;
  const listEl = $('.gx-exlist', root);
  const row = (ex) => {
    const selIdx = opts.selected ? opts.selected.indexOf(ex.id) : -1;
    const right = opts.mode === 'multi'
      ? `<span class="gx-sel">${selIdx >= 0 ? selIdx + 1 : ''}</span>`
      : `<svg class="chev" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>`;
    return `<button class="gx-ex ${selIdx >= 0 ? 'on' : ''}" data-id="${esc(ex.id)}">${thumb(ex.id)}
      <span class="grow"><b class="ellipsis">${esc(ex.n)}</b><span class="sub ellipsis">${esc(subLine(ex))}</span></span>${right}</button>`;
  };
  const more = () => {
    if (shown >= items.length) return;
    listEl.insertAdjacentHTML('beforeend', items.slice(shown, shown + PAGE).map(row).join(''));
    shown += PAGE;
  };
  const filter = () => {
    const rec = recent();
    items = sortExercises(allExercises().filter((ex) => (st.g === 'All' || exGroups(ex).includes(st.g))
      && (!st.eq || ex.eq === st.eq) && matchesSearch(ex, st.q)), rec);
    shown = 0;
    listEl.innerHTML = items.length ? '' : `<div class="empty small">No exercises found.<br>
      <button class="link gx-new2" style="margin-top:10px">Create “${esc(st.q || 'custom exercise')}”</button></div>`;
    more();
  };

  loadDb().then(filter).catch((e) => { listEl.innerHTML = `<p class="error small">${esc(e.message)}</p>`; });

  const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) more(); }, { rootMargin: '600px' });
  io.observe($('.gx-sentinel', root));

  let t = null;
  $('.gx-q', root).oninput = (e) => {
    st.q = e.target.value;
    clearTimeout(t);
    t = setTimeout(filter, 120);
  };
  $('.gx-q', root).onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
  $('.gx-groups', root).onclick = (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    st.g = b.dataset.g;
    $$('.gx-groups .chip', root).forEach((x) => x.classList.toggle('on', x === b));
    filter();
  };
  $('.gx-eq', root).onchange = (e) => { st.eq = e.target.value; filter(); };
  const create = async () => {
    const ex = await editCustomExercise({ n: st.q.trim().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), g: st.g !== 'All' ? st.g : '', eq: st.eq || '' });
    if (ex) {
      if (opts.mode === 'browse') filter(); else opts.onPick(ex.id);
    }
  };
  root.onclick = (e) => {
    if (e.target.closest('.gx-new, .gx-new2')) { create(); return; }
    const b = e.target.closest('.gx-ex');
    if (!b) return;
    const id = b.dataset.id;
    if (opts.mode === 'multi') {
      opts.onPick(id);
      const i = opts.selected.indexOf(id);
      b.classList.toggle('on', i >= 0);
      $$('.gx-ex.on', listEl).forEach((x) => { $('.gx-sel', x).textContent = opts.selected.indexOf(x.dataset.id) + 1 || ''; });
      $('.gx-sel', b).textContent = i >= 0 ? i + 1 : '';
    } else if (opts.mode === 'single') {
      opts.onPick(id);
    } else {
      openExercise(id);
    }
  };
}

// Picker screen. Resolves with the chosen ids ([] when cancelled).
export async function pickExercises({ multi = true, title } = {}) {
  await loadDb().catch(() => {});
  return new Promise((resolve) => {
    const selected = [];
    const state = { q: '', g: 'All', eq: '' };
    let result = [];
    push((el, s) => {
      el.innerHTML = page({
        title: title || (multi ? 'Add exercises' : 'Replace exercise'),
        body: '<div class="gx-picker"></div>',
        footer: multi ? `<button class="primary block gx-add" ${selected.length ? '' : 'disabled'}>${addLabel()}</button>` : '',
      });
      function addLabel() { return selected.length ? `Add ${selected.length} exercise${selected.length > 1 ? 's' : ''}` : 'Select exercises'; }
      mountLibrary($('.gx-picker', el), {
        mode: multi ? 'multi' : 'single',
        state,
        selected,
        sticky: true,
        onPick(id) {
          if (!multi) { result = [id]; s.close(); return; }
          const i = selected.indexOf(id);
          if (i >= 0) selected.splice(i, 1); else selected.push(id);
          const btn = $('.gx-add', el);
          btn.disabled = !selected.length;
          btn.textContent = addLabel();
        },
      });
      const add = $('.gx-add', el);
      if (add) add.onclick = () => { result = [...selected]; s.close(); };
    }, { onClose: () => resolve(result) });
  });
}

// ---------- custom exercises ----------
// Resolves with the saved exercise, or null.
export function editCustomExercise(init = {}) {
  return new Promise((resolve) => {
    const d = { n: '', g: '', eq: 'other', mode: 'wr', ...init };
    if (!d.eq) d.eq = 'other';
    let saved = null;
    push((el, s) => {
      el.innerHTML = sheet({
        title: d.id ? 'Edit exercise' : 'New custom exercise',
        body: `<form class="form gx-cform">
          <label>Name<input name="n" value="${esc(d.n)}" maxlength="80" required placeholder="e.g. Cable Y-Raise" autocomplete="off"></label>
          <div class="form-row">
            <label>Muscle group<select name="g"><option value="">Choose…</option>${MUSCLE_GROUPS.map((g) => `<option ${d.g === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
            <label>Equipment<select name="eq">${EQUIPMENT.map((e) => `<option value="${esc(e)}" ${d.eq === e ? 'selected' : ''}>${esc(cap(e))}</option>`).join('')}</select></label>
          </div>
          <label>Tracking<div class="seg gx-mode">${Object.entries(MODES).map(([k, v]) => `<button type="button" data-m="${k}" class="${d.mode === k ? 'on' : ''}">${esc(v)}</button>`).join('')}</div></label>
          <p class="error small" hidden></p>
          <button class="primary" type="submit">Save exercise</button>
        </form>` });
      const f = $('.gx-cform', el);
      $('.gx-mode', el).onclick = (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        d.mode = b.dataset.m;
        $$('.gx-mode button', el).forEach((x) => x.classList.toggle('on', x === b));
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        d.n = f.n.value.trim();
        d.g = f.g.value;
        d.eq = f.eq.value;
        if (!d.n) return;
        if (!d.g) { const er = $('.error', f); er.textContent = 'Choose a muscle group.'; er.hidden = false; return; }
        saved = await store.put('exercise', { id: d.id, n: d.n, g: d.g, eq: d.eq, mode: d.mode });
        const st = settings();
        if (st.modes[saved.id] && st.modes[saved.id] !== d.mode) {
          const modes = { ...st.modes };
          delete modes[saved.id];
          await saveSettings({ modes });
        }
        toast(d.id ? 'Exercise saved' : 'Exercise created');
        s.close();
      };
      if (!d.n) setTimeout(() => f.n.focus(), 250);
    }, { sheet: true, onClose: () => resolve(saved) });
  });
}

// ---------- exercise detail ----------
const detailTab = { v: 'about' };
export async function openExercise(id, tabName = 'about') {
  await loadDb().catch(() => {});
  detailTab.v = tabName;
  let timer = null;
  push((el, s) => {
    const ex = exById(id) || { id, n: exName(id), p: [], s: [], i: [], im: 0 };
    const mode = modeFor(id);
    const right = ex.custom ? `<button class="icon-btn gx-exmenu" aria-label="More">${icon('more')}</button>` : '';
    el.innerHTML = page({ title: ex.n, right, body: `<div class="gx-detail"></div>` });
    const body = $('.gx-detail', el);
    handleImgErrors(body);
    const pics = !ex.custom && ex.im
      ? `<div class="gx-anim"><img src="${IMG(id, 0)}" alt="${esc(ex.n)}"><img src="${IMG(id, 1)}" alt="" class="b"></div>` : '';
    body.innerHTML = `${pics}
      <div class="seg gx-dseg">${[['about', 'About'], ['history', 'History'], ['records', 'Records']].map(([k, v]) => `<button data-v="${k}" class="${detailTab.v === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="gx-dbody"></div>`;
    const show = () => {
      const box = $('.gx-dbody', body);
      if (detailTab.v === 'about') box.innerHTML = aboutHtml(ex, mode);
      else if (detailTab.v === 'history') box.innerHTML = historyHtml(id);
      else { box.innerHTML = recordsHtml(id, mode); recordsCharts(box, id, mode); }
    };
    show();
    $('.gx-dseg', body).onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      detailTab.v = b.dataset.v;
      $$('.gx-dseg button', body).forEach((x) => x.classList.toggle('on', x === b));
      show();
    };
    clearInterval(timer);
    const anim = $('.gx-anim', body);
    if (anim) {
      timer = setInterval(() => {
        if (!anim.isConnected) { clearInterval(timer); return; }
        anim.classList.toggle('flip');
      }, 800);
    }
    const menu = $('.gx-exmenu', el);
    if (menu) {
      menu.onclick = async () => {
        const v = await chooseSheet(ex.n, [{ value: 'edit', label: 'Edit exercise', icon: 'edit' }, { value: 'del', label: 'Delete exercise', icon: 'trash', danger: true }]);
        if (v === 'edit') {
          const c = store.get(id);
          await editCustomExercise({ ...c, id });
          s.render();
        } else if (v === 'del') {
          if (await confirmSheet(`Delete “${ex.n}”? Past workouts keep their sets.`, { ok: 'Delete', danger: true })) {
            await store.remove(id);
            toast('Exercise deleted');
            s.close();
          }
        }
      };
    }
  }, { onClose: () => clearInterval(timer) });
}

function aboutHtml(ex, mode) {
  const pills = (arr, cls) => arr.map((m) => `<span class="pill ${cls}">${esc(cap(m))}</span>`).join('');
  const muscles = ex.custom ? (ex.g ? pills([ex.g], 'accent') : '') : pills(ex.p || [], 'accent') + pills(ex.s || [], '');
  return `<div class="card stack">
      ${muscles ? `<div><p class="tiny muted gx-lbl2">Muscles</p><div class="row wrap gx-pills">${muscles}</div></div>` : ''}
      <div class="stats">
        <div class="stat"><b class="gx-statv">${esc(cap(ex.eq || '—'))}</b><span>Equipment</span></div>
        ${ex.l ? `<div class="stat"><b class="gx-statv">${esc(cap(ex.l))}</b><span>Level</span></div>` : ''}
        <div class="stat"><b class="gx-statv">${esc(MODES[mode])}</b><span>Tracking</span></div>
      </div>
    </div>
    ${ex.i?.length ? `<h3 class="section-title">How to</h3><div class="card"><ol class="gx-steps">${ex.i.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}`;
}

function sessionsOf(id) {
  const out = [];
  for (const w of workouts()) {
    const prs = prsOf(w.id);
    w.exercises.forEach((e, ei) => {
      if (e.exercise_id === id) out.push({ w, e, prSets: new Set(prs.filter((p) => p.ei === ei).map((p) => p.si)) });
    });
  }
  return out;
}

export function setLabels(sets) {
  let n = 0;
  return sets.map((s) => (s.type === 'w' ? 'W' : s.type === 'd' ? 'D' : s.type === 'f' ? 'F' : String(++n)));
}

function historyHtml(id) {
  const ss = sessionsOf(id);
  if (!ss.length) return `<div class="card empty">${icon('list')}<p>No history yet.<br>Log this exercise in a workout to see it here.</p></div>`;
  return ss.slice(0, 100).map(({ w, e, prSets }) => {
    const labels = setLabels(e.sets);
    return `<div class="card gx-hsess">
      <div class="row between"><b>${esc(w.name || 'Workout')}</b><span class="small muted">${esc(niceDate(w.started_at, { weekday: true, year: new Date(w.started_at).getFullYear() !== new Date().getFullYear() }))}</span></div>
      <div class="gx-hsets">${e.sets.map((st, i) => {
        const one = e.mode === 'wr' && isWorking(st) ? e1rm(st.kg, st.reps) : null;
        return `<div class="gx-hset"><span class="gx-tag t-${st.type}">${labels[i]}</span><span class="grow">${esc(formatSet(st, e.mode, true))}</span>
          ${prSets.has(i) ? `<span class="gx-tro">${icon('trophy')}</span>` : ''}${one ? `<span class="tiny muted">1RM ${fmtNum(one)}</span>` : ''}</div>`;
      }).join('')}</div>
      ${e.note ? `<p class="small muted gx-note-view">${esc(e.note)}</p>` : ''}
    </div>`;
  }).join('');
}

function recordsHtml(id, mode) {
  const rec = exerciseRecords(workouts(), id);
  const kinds = Object.keys(PR_KINDS).filter((k) => rec[k]);
  if (!kinds.length) return `<div class="card empty">${icon('trophy')}<p>No records yet.</p></div>`;
  const chartsFor = mode === 'wr' ? [['e1rm', 'Best est. 1RM per session'], ['kg', 'Heaviest weight per session']]
    : mode === 'bw' ? [['reps', 'Most reps per session']] : [['secs', 'Longest time per session']];
  return `<div class="gx-recs">${kinds.map((k) => `<div class="gx-rec">${icon('trophy')}<div class="grow"><span class="small muted">${PR_KINDS[k]}</span>
      <b>${esc(formatMetric(k, rec[k].value))}</b></div><span class="tiny muted">${esc(k === 'e1rm' || k === 'vol' ? formatSet(rec[k].set, 'wr', true) + ' · ' : '')}${esc(niceDate(rec[k].date, { year: true }))}</span></div>`).join('')}</div>
    ${chartsFor.map(([k, t]) => `<h3 class="section-title">${t}</h3><div class="card"><div class="chart-box"><canvas data-k="${k}"></canvas></div></div>`).join('')}`;
}

function recordsCharts(box, id, mode) {
  const series = exerciseSeries(workouts(), id).slice(-40);
  const color = cssVar('--gym') || '#f2542d';
  $$('canvas[data-k]', box).forEach((cv) => {
    const k = cv.dataset.k;
    const pts = series.filter((r) => r[k] > 0);
    chart(cv, {
      type: 'line',
      data: {
        labels: pts.map((r) => new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{ data: pts.map((r) => r[k]), borderColor: color, backgroundColor: fade(color), fill: true, tension: 0.3, pointRadius: pts.length > 20 ? 0 : 3, pointHitRadius: 8, pointBackgroundColor: color }],
      },
      options: {
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { ticks: { maxTicksLimit: 5, callback: (v) => (k === 'secs' ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : v) } } },
        plugins: { tooltip: { callbacks: { label: (c) => formatMetric(k, c.parsed.y) } } },
      },
    });
  });

}

// Records achieved in one workout, grouped per exercise, with the improvement.
export function prListHtml(prs) {
  const by = new Map();
  for (const p of prs) {
    if (!by.has(p.exercise_id)) by.set(p.exercise_id, []);
    by.get(p.exercise_id).push(p);
  }
  const delta = (p) => {
    const d = p.value - p.prev;
    return p.kind === 'reps' ? `+${d}` : p.kind === 'secs' ? `+${fmtDur(d)}` : `+${fmtNum(d)} kg`;
  };
  return `<div class="card gx-prlist">${[...by].map(([id, list]) => `<div class="gx-pr">${icon('trophy')}<div class="grow">
      <b class="ellipsis gx-prname">${esc(exName(id))}</b>
      ${list.map((p) => `<div class="gx-prk"><span class="muted grow">${PR_KINDS[p.kind]}</span><b>${esc(formatMetric(p.kind, p.value))}</b><span class="gx-up">${esc(delta(p))}</span></div>`).join('')}
    </div></div>`).join('')}</div>`;
}
