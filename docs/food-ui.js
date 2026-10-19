// Shared Food pieces: daily targets (also used by the cut plan and Stats) and the kcal ring / macro bars.

import { esc, n0 } from './util.js';
import * as store from './store.js';
import { liftDayExtra } from './cut-day.js';
import { foodEntries } from './food-calc.js';

// What was eaten: Fitatu day totals, plus the old in-app diary for days before the sync (food-calc.js foodEntries).
export const allFoodEntries = () => foodEntries(store.all('fitatu-day'), store.all('meal'));

export const settings = () => store.getConfig('food', {});
export const targets = () => settings().targets || null;
// Targets for one day: on cut-plan lifting days the weekly review's lifting-day bonus is added (kcal, as carbs).
export function dayTargets(d) {
  const t = targets();
  if (!t) return null;
  const cut = store.getConfig('cut', {});
  const extra = liftDayExtra(d, { cfg: cut, workouts: store.all('workout'), dailies: store.all('daily') });
  return extra ? { ...t, kcal: t.kcal + extra, c: Math.round((t.c || 0) + extra / 4), liftDay: extra } : t;
}
export async function saveSettings(patch) {
  const cur = settings();
  delete cur.id;
  await store.setConfig('food', { ...cur, ...patch });
}

// Kcal ring: eaten vs target.
export function ring(eaten, target, { size = 132, label = 'left' } = {}) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = target ? Math.min(1, eaten / target) : 0;
  const over = target && eaten > target;
  const left = target ? Math.round(target - eaten) : null;
  return `<div class="fd-ring" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fd-ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fd-ring-fg ${over ? 'over' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <div class="fd-ring-txt">${left == null ? `<b>${n0(eaten)}</b><span>kcal eaten</span>`
      : over ? `<b class="down">${n0(-left)}</b><span>kcal over</span>` : `<b>${n0(left)}</b><span>kcal ${label}</span>`}</div>
  </div>`;
}
export function bar(label, value, target, cls, unit = 'g') {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return `<div class="fd-bar ${cls}"><div class="row between"><span>${esc(label)}</span>
    <span class="muted small"><b>${n0(Math.round(value))}</b>${target ? ` / ${n0(target)}` : ''} ${unit}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
}
