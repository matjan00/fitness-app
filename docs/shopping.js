// Shopping list: aggregate ingredients of chosen recipes and diary days. Pure logic (no DOM) — tests/shopping.test.js.
// UI lives in shopping-ui.js.
import { fold } from './food-parse.js';

// Store aisles, in shopping order. Keyword rules run on folded (lower-case, no diacritics) Polish + English names.
export const AISLES = [
  { key: 'produce', label: 'Fruit & veg' },
  { key: 'meat', label: 'Meat & fish' },
  { key: 'dairy', label: 'Dairy & eggs' },
  { key: 'grains', label: 'Bread & grains' },
  { key: 'pantry', label: 'Pantry' },
  { key: 'other', label: 'Other' },
];
const RULES = [
  ['pantry', /\b(peanut\w*|almond\w*|orzech\w*|migda\w*|oil|olej\w*|oliw\w*|sugar|cukier|honey|miod|salt|sol|sos\w*|sauce|vinegar|ocet|spice\w*|przypraw\w*|paste|koncentrat\w*|canned|konserw\w*|bean\w*|fasol\w*|lentil\w*|soczewic\w*|chickpea\w*|ciecierzyc\w*|protein|bialko|cocoa|kakao|chocolate|czekolad\w*|seed\w*|nasion\w*|pestk\w*|stock|bulion\w*|mustard|musztard\w*|ketchup)\b/],
  ['meat', /\b(chicken|kurczak\w*|turkey|indyk\w*|beef|wolow\w*|pork|wieprzow\w*|schab\w*|bacon|boczek|ham|szynk\w*|sausage|kielbas\w*|fish|ryb\w*|salmon|losos\w*|tuna|tunczyk\w*|cod|dorsz\w*|shrimp|prawn\w*|krewet\w*|meat|mies\w*|steak|mince\w*|mielon\w*|drob\w*)\b/],
  ['dairy', /\b(milk|mlek\w*|cheese|ser|sery|serek|serka|yogh?urt|jogurt\w*|egg\w*|jaj\w*|butter|maslo|cream|smietan\w*|twarog\w*|skyr|kefir|maslank\w*|mozzarell\w*|feta|quark|cottage|parmesan\w*|ricott\w*|tofu|tempeh)\b/],
  ['grains', /\b(bread|chleb\w*|bulk\w*|rice|ryz\w*|pasta|makaron\w*|oat\w*|owsian\w*|platki|flour|maka|make|kasza|kaszy|kasze|couscous|kuskus|tortilla\w*|noodle\w*|cereal\w*|musli|muesli|granola|bulgur|quinoa|bagiet\w*|wrap\w*)\b/],
  ['produce', /\b(vegetabl\w*|warzyw\w*|fruit\w*|owoc\w*|lettuce|salat\w*|tomato\w*|pomidor\w*|onion\w*|cebul\w*|garlic|czosnek|czosnk\w*|pepper\w*|papryk\w*|carrot\w*|marchew\w*|potato\w*|ziemniak\w*|apple\w*|jablk\w*|banana\w*|banan\w*|lemon\w*|cytryn\w*|lime|broccoli|brokul\w*|spinach|szpinak\w*|cucumber\w*|ogorek|ogorki|ogorka|mushroom\w*|pieczark\w*|avocado\w*|awokado|zucchini|cukini\w*|herb\w*|parsley|pietruszk\w*|cabbage|kapust\w*|berry|berries|jagod\w*|malin\w*|truskaw\w*|orange\w*|pomarancz\w*|kale|celery|seler\w*|beet\w*|burak\w*|pumpkin|dyni\w*|ginger|imbir\w*|leek|por|pory|cauliflower|kalafior\w*|basil|bazyli\w*|dill|koper|kopru|coriander|kolendr\w*|cilantro|mint|mieta|rocket|rukol\w*|corn|kukurydz\w*|pea|peas|groszek)\b/],
];
export function aisleOf(name) {
  const t = fold(name);
  for (const [k, re] of RULES) if (re.test(t)) return k;
  return 'other';
}
export const aisleLabel = (k) => AISLES.find((a) => a.key === k)?.label || 'Other';

// Identity of an ingredient: matched food (src:id) wins, else the normalised name.
const foodKey = (food) => (food?.id != null ? `${food.src || 'db'}:${food.id}` : null);
const nameKey = (name) => `n:${fold(name)}`;
const foodName = (food) => (food ? (food.src === 'db' || !food.src ? food.en || food.name : food.name) : '') || '';

// Lines { key, name, grams|null } for ONE recipe, scaled by `factor` (= servings wanted / recipe servings).
// Works for own recipes (ingredient.food {src,id,...}, grams) and library recipes (food_id, grams = whole recipe).
export function recipeLines(rec, factor = 1) {
  const out = [];
  for (const ing of rec?.ingredients || []) {
    if (!ing || ing.head) continue;
    const food = ing.food || null;
    const fk = foodKey(food) || (ing.food_id ? `db:${ing.food_id}` : null);
    const label = String(ing.name || ing.raw || ing.text || foodName(food) || '').trim();
    if (!fk && !label) continue;
    const g = ing.grams === '' || ing.grams == null ? NaN : Number(ing.grams);
    out.push({ key: fk || nameKey(label), name: foodName(food) || label, grams: Number.isFinite(g) && g > 0 ? g * factor : null, ...shopUnit(food) });
  }
  return out;
}

// How the food is bought: by the piece (piece weight in g) or as a liquid (ml); {} for anything weighed.
function shopUnit(food) {
  if (!food) return {};
  if (food.liquid || food.u?.floz) return { liquid: true }; // drinks have a fl oz size in the food table
  const pc = Number(food.u?.piece);
  return pc > 0 && pc <= 500 ? { piece: pc } : {};
}

// Servings of a recipe eaten in a diary entry (servings, else grams / grams-per-serving), or null.
// Entries logged from a scaled recipe carry `scale`: one of their servings is `scale` servings of the saved recipe.
export function eatenServings(e) {
  const k = Number(e.scale) > 0 ? Number(e.scale) : 1;
  if (Number(e.servings) > 0) return Number(e.servings) * k;
  const per = Number(e.per?.grams);
  if (Number(e.grams) > 0 && per > 0) return (Number(e.grams) / per) * k;
  return null;
}

// Lines for one diary entry. lookup({type,id}) → recipe | null. Returns { lines, skipped: reason|null }.
export function entryLines(e, lookup = () => null) {
  const type = e.source?.type;
  if (type === 'recipe' || type === 'library') {
    const rec = lookup(e.source);
    if (!rec) return { lines: [], skipped: 'recipe not available' };
    const eaten = eatenServings(e);
    if (!eaten) return { lines: [], skipped: 'no amount' };
    return { lines: recipeLines(rec, eaten / Math.max(1, Number(rec.servings) || 1)), skipped: null };
  }
  if (type === 'quick' || !(Number(e.grams) > 0)) return { lines: [], skipped: type === 'quick' ? 'quick calories, no food' : 'no weight' };
  const name = foodName(e.food) || e.label || '';
  const key = foodKey(e.food) || nameKey(name);
  return { lines: [{ key, name, grams: Number(e.grams), ...shopUnit(e.food) }], skipped: null };
}

// Build the list.
//   recipes: [{ rec, servings }]  chosen recipes with the number of servings to shop for
//   entries: diary entries (any days)
//   lookup:  ({type,id}) → recipe | null, used to expand recipe entries
// → { items: [{ key, name, grams, partial, aisle, n, done:false }], skipped: [{ label, reason }] }
export function buildList({ recipes = [], entries = [], lookup } = {}) {
  const map = new Map();
  const skipped = [];
  const add = (l) => {
    let it = map.get(l.key);
    if (!it) { it = { key: l.key, name: l.name, grams: 0, partial: false, n: 0 }; map.set(l.key, it); }
    if (l.piece) it.piece = l.piece;
    if (l.liquid) it.liquid = true;
    if (l.grams == null) it.partial = true; else it.grams += l.grams;
    it.n++;
  };
  for (const { rec, servings } of recipes) {
    const k = (Number(servings) > 0 ? Number(servings) : Number(rec.servings) || 1) / Math.max(1, Number(rec.servings) || 1);
    recipeLines(rec, k).forEach(add);
  }
  for (const e of entries) {
    const r = entryLines(e, lookup);
    r.lines.forEach(add);
    if (r.skipped) skipped.push({ label: e.label || 'Entry', reason: r.skipped });
  }
  // The same thing under two keys (matched in one recipe, typed as plain text in another) becomes one row.
  const byName = new Map();
  for (const it of map.values()) {
    const nk = fold(it.name).replace(/s$/, '');
    const other = byName.get(nk);
    if (!other) { byName.set(nk, it); continue; }
    const [keep, drop] = other.key.startsWith('n:') ? [it, other] : [other, it];
    keep.grams += drop.grams; keep.partial = keep.partial || drop.partial; keep.n += drop.n;
    keep.piece ||= drop.piece; keep.liquid ||= drop.liquid;
    byName.set(nk, keep);
    map.delete(drop.key);
  }
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const order = (k) => AISLES.findIndex((a) => a.key === k);
  const items = [...map.values()].map((it) => ({ ...it, name: cap(it.name) })).map((it) => ({ ...it, grams: Math.round(it.grams * 10) / 10, aisle: aisleOf(it.name), done: false }))
    .sort((a, b) => order(a.aisle) - order(b.aisle) || a.name.localeCompare(b.name));
  return { items, skipped };
}

// 1250 → "1.25 kg", 80 → "80 g"; unknown amounts → "".
export function gramsText(g) {
  if (!(g > 0)) return '';
  if (g >= 1000) return `${Math.round(g / 10) / 100} kg`;
  return `${Math.round(g)} g`;
}
// The amount the way it is bought: "2 (≈ 240 g)" for pieces, "250 ml" / "1.5 l" for liquids, else grams.
export function amountText(it) {
  if (!(it.grams > 0)) return '';
  let t;
  if (it.liquid) t = it.grams >= 1000 ? `${Math.round(it.grams / 100) / 10} l` : `${Math.round(it.grams / 10) * 10} ml`;
  else if (it.piece && it.grams >= it.piece * 0.6) t = `${Math.max(1, Math.round((it.grams / it.piece) * 2) / 2)} (≈ ${gramsText(it.grams)})`;
  else t = gramsText(it.grams);
  return `${t}${it.partial ? ' +' : ''}`;
}
export const itemText = (it) => `${it.name}${it.grams > 0 ? ` — ${amountText(it)}` : ''}`;
// Within an aisle: still to buy first, ticked ones sink to the bottom.
export const listOrder = (items) => [...items].sort((a, b) => Number(a.done) - Number(b.done));

// Group items by aisle (aisle order); empty aisles dropped.
export function grouped(items) {
  return AISLES.map((a) => ({ ...a, items: items.filter((i) => i.aisle === a.key) })).filter((g) => g.items.length);
}

// Plain text for copy / share. Ticked items are left out unless all = true.
export function listText(items, { title = 'Shopping list', all = false } = {}) {
  const lines = [title];
  for (const g of grouped(items.filter((i) => all || !i.done))) {
    lines.push('', g.label);
    for (const it of listOrder(g.items)) lines.push(`${it.done ? '[x]' : '[ ]'} ${itemText(it)}`);
  }
  return lines.join('\n');
}

// n consecutive days from `from` (addDays is util.addDays).
export const dayRange = (from, n, addDays) => Array.from({ length: n }, (_, i) => addDays(from, i));

// Keep ticks when a list is rebuilt (by item key).
export function keepTicks(items, old = []) {
  const done = new Set(old.filter((i) => i.done).map((i) => i.key));
  return items.map((i) => ({ ...i, done: done.has(i.key) }));
}
