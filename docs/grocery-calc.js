// Grocery list from the meals planned in Fitatu ('fitatu-plan' records, scripts/fitatu_sync.py). Pure
// functions — tests/grocery-calc.test.js.

const GRAM_UNITS = new Set(['g', 'gram', 'gramy', 'gramów', 'grams']);
const ML_UNITS = new Set(['ml', 'mililitr', 'mililitry', 'mililitrów']);
const isGram = (u) => GRAM_UNITS.has(String(u || '').toLowerCase());
const isMl = (u) => ML_UNITS.has(String(u || '').toLowerCase());
const productOf = (key) => String(key || '').split(':')[0];

// One row per product for the chosen days: the same product in different measures (e.g. 100 g one
// day, 1 piece another) is one row. Each row: { key, name, parts: [{unit, qty}], g (null when a part
// has no weight), recipes: [names], days: [YYYY-MM-DD] }, sorted by name.
export function groceryList(plans = [], days = []) {
  const chosen = new Set(days);
  const rows = new Map();
  for (const plan of plans) {
    if (!plan || !chosen.has(plan.day)) continue;
    for (const l of Array.isArray(plan.lines) ? plan.lines : []) {
      if (!l || !l.key) continue;
      const key = productOf(l.key);
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { key, name: String(l.name || '?'), units: new Map(), g: 0, recipes: new Set(), days: new Set() }));
      const unit = isGram(l.unit) ? 'g' : isMl(l.unit) ? 'ml' : String(l.unit || '');
      r.units.set(unit, (r.units.get(unit) || 0) + (+l.qty || 0));
      const g = unit === 'g' || unit === 'ml' ? +l.qty || 0 : l.g;
      r.g = r.g == null || g == null || !Number.isFinite(+g) ? null : r.g + +g;
      if (l.recipe) r.recipes.add(String(l.recipe));
      r.days.add(plan.day);
    }
  }
  return [...rows.values()]
    .map((r) => ({ key: r.key, name: r.name, parts: [...r.units].map(([unit, qty]) => ({ unit, qty })), g: r.g, recipes: [...r.recipes], days: [...r.days].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' }));
}

const num = (x) => {
  const v = Math.round(x * 100) / 100;
  return Number.isInteger(v) ? String(v) : String(v).replace(/(\.\d)0$/, '$1');
};
const grams = (g) => (g >= 1000 ? `${num(Math.round(g / 10) / 100)} kg` : `${Math.round(g)} g`);

// How much to buy, e.g. "450 g", "2 sztuka", "1 opakowanie + 200 g (≈ 600 g)".
export function amountText(row) {
  const parts = row.parts.filter((p) => p.qty > 0);
  const onlyMetric = parts.length === 1 && (parts[0].unit === 'g' || parts[0].unit === 'ml');
  if (onlyMetric) return parts[0].unit === 'ml' ? `${Math.round(parts[0].qty)} ml` : grams(parts[0].qty);
  const txt = parts.map((p) => (p.unit === 'g' ? grams(p.qty) : p.unit === 'ml' ? `${Math.round(p.qty)} ml` : `${num(p.qty)} ${p.unit}`.trim())).join(' + ');
  return row.g > 0 && !parts.every((p) => p.unit === 'ml') ? `${txt} (≈ ${grams(row.g)})` : txt;
}

const PIECES = new Set(['sztuka', 'sztuki', 'sztuk', 'szt', 'szt.', 'piece', 'pieces']);
const plNum = (x) => num(x).replace('.', ',');
const plGrams = (g) => (g >= 1000 ? `${plNum(Math.round(g / 10) / 100)} kg` : `${Math.round(g)} g`);

// Amount the way Listonic reads it in front of a name: one weight when every part has one
// ("160 g", "1,25 kg", "500 ml"), else the counts ("2", "1 kubek").
function listonicAmount(row) {
  const parts = row.parts.filter((p) => p.qty > 0);
  if (parts.length && parts.every((p) => p.unit === 'ml')) return `${Math.round(parts.reduce((a, p) => a + p.qty, 0))} ml`;
  if (row.g > 0) return plGrams(row.g);
  return parts.map((p) => (p.unit === 'g' ? plGrams(p.qty) : p.unit === 'ml' ? `${Math.round(p.qty)} ml`
    : PIECES.has(p.unit.toLowerCase()) || !p.unit ? plNum(p.qty) : `${plNum(p.qty)} ${p.unit}`)).join(' + ');
}

// Rows as Listonic items { name, amount, unit } (the edge function supabase/functions/listonic):
// one weight when every part has one ("160" g, "1,25" kg, "300" ml), pieces as "szt.", other counts in
// their own unit, and mixed counts without a weight as text in amount. Ticked rows are left out.
export function listonicItems(rows, ticked = {}) {
  return rows.filter((r) => !ticked[r.key]).map((r) => {
    const parts = r.parts.filter((p) => p.qty > 0);
    let amount = '', unit = '';
    if (parts.length && parts.every((p) => p.unit === 'ml')) { amount = String(Math.round(parts.reduce((a, p) => a + p.qty, 0))); unit = 'ml'; }
    else if (r.g > 0) [amount, unit] = r.g >= 1000 ? [plNum(Math.round(r.g / 10) / 100), 'kg'] : [String(Math.round(r.g)), 'g'];
    else if (parts.length === 1) { amount = plNum(parts[0].qty); unit = PIECES.has(parts[0].unit.toLowerCase()) ? 'szt.' : parts[0].unit; }
    else amount = listonicAmount(r);
    return { name: r.name, amount, unit };
  });
}

// The list as plain text for copying or sharing, one product a line with the amount first
// ("160 g Płatki owsiane"), which Listonic turns into an item with its quantity. Ticked rows are left out.
export function listText(rows, ticked = {}) {
  return rows.filter((r) => !ticked[r.key]).map((r) => `${listonicAmount(r)} ${r.name}`.trim()).join('\n');
}
