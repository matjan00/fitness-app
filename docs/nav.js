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
  document.body.append(el);
  stack.push(screen);
  history.pushState({ depth: stack.length }, '');
  screen.render();
  if (opts.sheet) {
    el.addEventListener('click', (e) => { if (e.target === el) screen.close(); });
  }
  requestAnimationFrame(() => el.classList.add('open'));
  document.body.classList.add('has-screen');
}

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
