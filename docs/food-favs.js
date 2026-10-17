// Favourites and "I cooked it" ratings for own recipes. One config object: store.getConfig('library') =
// { favs: ['own-<recipe id>'], cooked: { 'own-<recipe id>': { rating, n, last } } } (key kept from the old library).
import { $, $$, toast, today } from './util.js';
import * as store from './store.js';
import { push, sheet } from './nav.js';
import { toggleFav, markCooked } from './food-library.js';

export const favKey = (rid) => `own-${rid}`;
export const favState = () => store.getConfig('library', { favs: [], cooked: {} });
const save = (s) => store.setConfig('library', { favs: s.favs || [], cooked: s.cooked || {} });

export const favSet = () => new Set(favState().favs || []);
export const isFav = (rid) => favSet().has(favKey(rid));
export const cookedOf = (rid) => favState().cooked?.[favKey(rid)] || null;
export const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

export async function toggleFavRecipe(rid) {
  const next = toggleFav(favState(), favKey(rid));
  await save(next);
  return next.favs.includes(favKey(rid));
}

// A deleted recipe leaves no favourite or rating behind.
export async function forgetRecipe(rid) {
  const s = favState();
  const k = favKey(rid);
  if (!(s.favs || []).includes(k) && !s.cooked?.[k]) return;
  const cooked = { ...(s.cooked || {}) };
  delete cooked[k];
  await save({ favs: (s.favs || []).filter((x) => x !== k), cooked });
}

// "How was it?" 1-5 stars; counts one more cook. done() after closing.
export function cookedSheet(rid, done) {
  let rating = cookedOf(rid)?.rating || 4;
  push((el, s) => {
    const paint = () => {
      el.innerHTML = sheet({ title: 'How was it?', body: `<div class="fd-rate">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" class="${n <= rating ? 'on' : ''}" aria-label="${n} stars">★</button>`).join('')}</div>
        <div class="sheet-actions"><button class="ghost" data-a="no">Cancel</button><button class="primary" data-a="ok">Save</button></div>` });
      $$('[data-n]', el).forEach((b) => { b.onclick = () => { rating = Number(b.dataset.n); paint(); }; });
      $('[data-a=no]', el).onclick = () => s.close();
      $('[data-a=ok]', el).onclick = async () => { await save(markCooked(favState(), favKey(rid), rating, today())); toast('Saved'); s.close(); };
    };
    paint();
  }, { sheet: true, onClose: done });
}
