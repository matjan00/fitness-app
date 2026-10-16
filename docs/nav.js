// Screen stack on top of the bottom-tab layout.
//
//   push(build, opts) opens a full-screen page (or a bottom sheet with {sheet:true}).
//     build(el, screen) fills `el`; call screen.render() to redraw it, screen.close() to go back.
//   Android's back button / gesture closes the top screen (each push adds a browser history entry).
//   opts.onClose() runs after it is closed.
//
// Screen layout helper: page({title, left, right, body, footer}) returns HTML for a standard page:
// a header with a back button and a scrollable body (.scroll).

import { icon, esc } from './util.js';

const stack = [];
let onReveal = () => {};
export const setRevealHandler = (fn) => { onReveal = fn; };
export const depth = () => stack.length;
export const top = () => stack[stack.length - 1];

// Going back is asynchronous (history.back() → popstate later). If code closes a screen and opens
// another straight away, the new screen must wait until the back step has landed; otherwise the
// pending back would close the new screen instead and the stack would drift from browser history.
let pendingBack = 0;          // back steps requested but not yet received
const waiting = [];           // screens to open once pendingBack reaches 0
let backTimer = null;

function goBack(steps) {
  pendingBack += steps;
  clearTimeout(backTimer);
  // Safety net: if the browser never reports the back step, don't block new screens forever.
  backTimer = setTimeout(() => { pendingBack = 0; flushWaiting(); }, 1000);
  history.go(-steps);
}

function flushWaiting() {
  while (pendingBack === 0 && waiting.length) activate(waiting.shift());
}

function activate(screen) {
  const { el, opts } = screen;
  // Stack order must follow open order: a full page opened from a sheet (e.g. "Change food" picker) would
  // otherwise sit behind it, because sheets have a fixed higher z-index than pages.
  el.style.zIndex = Math.min(95, 40 + 4 * stack.length + (opts.sheet ? 1 : 0));
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  screen.returnFocus = document.activeElement;
  document.body.append(el);
  stack.push(screen);
  history.pushState({ depth: stack.length }, '');
  screen.render();
  if (opts.sheet) {
    el.addEventListener('click', (e) => { if (e.target === el) screen.close(); });
    swipeToClose(screen);
  }
  requestAnimationFrame(() => el.classList.add('open'));
  document.body.classList.add('has-screen');
  syncInert();
  focusScreen(screen);
}

// Swipe a bottom sheet down to close it. The drag starts from the grab handle / title strip, or from
// anywhere in the sheet while its content is scrolled to the top (so long sheets still scroll first).
// Past CLOSE_PX, or on a quick downward flick, it closes through screen.close() (onClose still runs);
// otherwise it springs back. Fields and range sliders keep their own touches.
const CLOSE_PX = 90;
const FLICK = 0.6;           // px per ms
const HEAD_PX = 48;          // top strip of an unscrolled sheet (grab + title): drag handle
const SCRIM = 0.45;          // matches .sheet-wrap.open
const KEEP_TOUCH = 'input, textarea, select, [contenteditable="true"], [data-no-swipe]';

function swipeToClose(screen) {
  const wrap = screen.el;
  let d = null;   // current gesture

  // Can content between the touch point and the sheet still scroll up? Then the finger scrolls instead.
  const scrolled = (t, sh) => {
    for (let n = t; n && n !== wrap; n = n.parentElement) {
      if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true;
      if (n === sh) break;
    }
    return false;
  };

  function start(x, y, target) {
    const sh = target.closest?.('.sheet');
    if (!sh || !wrap.contains(sh) || target.closest(KEEP_TOUCH)) return false;
    // Once the sheet is scrolled its top strip holds content, so only the strip of an unscrolled sheet counts.
    const busy = scrolled(target, sh);
    const head = !!target.closest('.grab, .sheet-title') || (!busy && y - sh.getBoundingClientRect().top < HEAD_PX);
    if (!head && busy) return false;
    d = { sh, target, x, y, head, dy: 0, on: false, samples: [{ y, t: performance.now() }] };
    return true;
  }

  // Returns true when the move belongs to the sheet drag (caller should block the browser's own scroll).
  function move(x, y) {
    if (!d) return false;
    const dy = y - d.y, dx = x - d.x;
    if (!d.on) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) { d = null; return false; } // sideways: not ours
      if (dy < -4 && !d.head) { d = null; return false; }                                // scrolling up
      if (dy <= 0) return false;
      if (!d.head && scrolled(d.target, d.sh)) { d = null; return false; } // content scrolled since touchstart
      if (dy < 6) return true;
      d.on = true;
      d.sh.style.transition = 'none';
      wrap.style.transition = 'none';
    }
    d.dy = Math.max(0, dy);
    d.sh.style.transform = `translateY(${d.dy}px)`;
    const h = d.sh.offsetHeight || 1;
    wrap.style.background = `rgba(8, 10, 14, ${(SCRIM * Math.max(0, 1 - d.dy / h)).toFixed(3)})`;
    d.samples.push({ y, t: performance.now() });
    if (d.samples.length > 5) d.samples.shift();
    return true;
  }

  function end() {
    if (!d) return;
    const g = d; d = null;
    if (!g.on) return;
    const a = g.samples[0], b = g.samples[g.samples.length - 1];
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    g.sh.style.transition = '';
    wrap.style.transition = '';
    if (g.dy > CLOSE_PX || (v > FLICK && g.dy > 20)) {
      g.sh.style.transform = 'translateY(100%)';
      wrap.style.background = 'rgba(8, 10, 14, 0)'; // stays clear while the back step lands
      screen.close();
    } else {
      g.sh.style.transform = '';
      wrap.style.background = '';
    }
    // A drag that ends over a button must not also press it.
    const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
    wrap.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => wrap.removeEventListener('click', eat, { capture: true }), 350);
  }

  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { end(); return; }
    const t = e.touches[0];
    start(t.clientX, t.clientY, e.target);
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
  }, { passive: false });
  wrap.addEventListener('touchend', end);
  wrap.addEventListener('touchcancel', end);

  // Mouse (desktop / testing): drag by the handle strip only, so text selection still works.
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (!start(e.clientX, e.clientY, e.target) || !d.head) { d = null; return; }
    const mv = (ev) => { if (move(ev.clientX, ev.clientY)) ev.preventDefault(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); end(); };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  });
}

// Only the top screen is reachable by keyboard and screen readers; everything under it is inert.
function syncInert() {
  const behind = [$id('view'), $id('tabbar'), $id('banner')];
  behind.forEach((x) => { if (x) x.inert = stack.length > 0; });
  stack.forEach((s, i) => { s.el.inert = i < stack.length - 1; });
}
const $id = (id) => document.getElementById(id);

// Name the dialog after its heading and move focus there, so a screen reader announces where you are.
function focusScreen(screen) {
  const h = screen.el.querySelector('.bar-title h1, .sheet-title, h1, h2');
  if (screen.opts.label) screen.el.setAttribute('aria-label', screen.opts.label);
  else if (h) {
    h.id ||= `dlg-${Math.random().toString(36).slice(2, 8)}`;
    screen.el.setAttribute('aria-labelledby', h.id);
  }
  if (screen.el.contains(document.activeElement)) return; // the screen focused its own field (e.g. search)
  const target = h || screen.el.querySelector('.sheet, .scroll') || screen.el;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length && !e.defaultPrevented) top().close();
});

export function push(build, opts = {}) {
  const el = document.createElement('div');
  el.className = opts.sheet ? 'sheet-wrap' : 'screen';
  if (opts.className) el.classList.add(...opts.className.split(' '));
  let closing = false;
  const screen = {
    el,
    opts,
    render() {
      const sc = el.querySelector('.scroll');
      const pos = sc ? sc.scrollTop : 0;
      build(el, screen);
      const sc2 = el.querySelector('.scroll');
      if (sc2) sc2.scrollTop = pos;
    },
    close() {
      const i = waiting.indexOf(screen);
      if (i >= 0) { waiting.splice(i, 1); try { opts.onClose?.(); } catch (e) { console.error(e); } return; }
      if (closing || !stack.includes(screen)) return;
      closing = true;
      // Close this screen and anything opened on top of it.
      goBack(stack.length - stack.indexOf(screen));
    },
  };
  if (pendingBack > 0) waiting.push(screen);
  else activate(screen);
  return screen;
}

window.addEventListener('popstate', (e) => {
  // history.go(-n) fires a single popstate, so close every screen deeper than the state we landed on.
  const target = Math.max(0, Math.min(e.state?.depth ?? 0, stack.length - 1));
  const popped = stack.length - target;
  while (stack.length > target) closeTop();
  pendingBack = Math.max(0, pendingBack - popped);
  if (pendingBack === 0) clearTimeout(backTimer);
  const next = top();
  if (next) next.render(); else onReveal();
  flushWaiting();
});

function closeTop() {
  const s = stack.pop();
  if (!s) return;
  s.el.classList.remove('open');
  s.el.classList.add('closing');
  setTimeout(() => s.el.remove(), 220);
  if (!stack.length) document.body.classList.remove('has-screen');
  syncInert();
  if (s.returnFocus?.isConnected) s.returnFocus.focus({ preventScroll: true });
  try { s.opts.onClose?.(); } catch (e) { console.error(e); }
}

// Close every open screen (e.g. after finishing a workout).
export function closeAll() {
  waiting.length = 0;
  const n = stack.length - pendingBack;
  if (n > 0) goBack(n);
}

export function page({ title = '', back = true, right = '', body = '', footer = '', sub = '' }) {
  return `
    <header class="bar">
      ${back ? `<button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>` : '<span></span>'}
      <div class="bar-title"><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
      <div class="bar-right">${right}</div>
    </header>
    <div class="scroll">${body}</div>
    ${footer ? `<footer class="bar-foot">${footer}</footer>` : ''}`;
}

export function sheet({ title = '', body = '' }) {
  return `<div class="sheet"><div class="grab"></div>${title ? `<h2 class="sheet-title">${esc(title)}</h2>` : ''}${body}</div>`;
}

// Any element with data-nav="back" closes the screen it is in.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav="back"]');
  if (b) { e.preventDefault(); top()?.close(); }
});

// Simple confirm / choose dialogs as bottom sheets. Resolve with true/false or the chosen value.
export function confirmSheet(message, { ok = 'OK', danger = false, cancel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    push((el, s) => {
      el.innerHTML = sheet({ body: `<p class="sheet-msg">${esc(message)}</p>
        <div class="sheet-actions"><button class="ghost" data-a="no">${esc(cancel)}</button>
        <button class="${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button></div>` });
      el.querySelector('[data-a="yes"]').onclick = () => { result = true; s.close(); };
      el.querySelector('[data-a="no"]').onclick = () => s.close();
    }, { sheet: true, onClose: () => resolve(result) });
  });
}

export function chooseSheet(title, options) {
  // options: [{ value, label, icon?, danger? }]
  return new Promise((resolve) => {
    let result = null;
    push((el, s) => {
      el.innerHTML = sheet({ title, body: `<div class="menu">${options.map((o, i) => `
        <button data-i="${i}" class="${o.danger ? 'danger-text' : ''}">${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span></button>`).join('')}</div>` });
      el.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { result = options[+b.dataset.i].value; s.close(); }; });
    }, { sheet: true, onClose: () => resolve(result) });
  });
}
