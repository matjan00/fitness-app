// "Might be wrong" checker: finds the few ingredients whose calories are probably counted badly AND matter
// (>= ~10 % of the recipe, or >= 80 kcal per serving). Pure logic (no DOM) - tests/food-check.test.js.
//
//   checkRecipe(ingredients, servings, foodsById, { max }) -> [warning]   (ranked by kcal impact, biggest first)
//   applyFix(ing, fix, foodsById)      -> new ingredient (mechanical fixes: switch food, scale grams)
//   ignoreWarning(ing, kind)           -> new ingredient that no longer raises that kind of warning
//
// Ingredients use the app's own recipe shape: { raw, qty, unit, name, grams, food:{id,k,name,...}|null, conf, guess, toTaste, head, checkOk:[kind] }.
// A warning: { i, kind, name, message, kcal (impact per serving, rounded), dir: 'over'|'under'|'unsure', fix: {label, patch}|null }
//   dir 'over'  = the recipe total is probably too HIGH; 'under' = too LOW; 'unsure' = could go either way.
import { fold } from './food-parse.js';
import { foodLabel } from './food-db.js';

export const MIN_SHARE = 0.10; // impact as a share of the recipe's total kcal ...
export const MIN_PER_SERVING = 80; // ... or kcal per serving
export const MAX_WARNINGS = 3;

// raw/dry food id -> cooked/canned counterpart (kcal roughly 2.5-3x lower per 100 g)
export const COOKED_OF = {
  rice: 'rice-cooked', 'rice-brown': 'rice-cooked', 'rice-arborio': 'rice-cooked', pasta: 'pasta-cooked', 'pasta-wholewheat': 'pasta-cooked',
  buckwheat: 'buckwheat-cooked', barley: 'barley-cooked', lentils: 'lentils-cooked', 'lentils-red': 'lentils-cooked',
  'chickpeas-dry': 'chickpeas', 'beans-white-dry': 'beans-white', potato: 'potato-boiled',
};
const RAW_OF = {};
for (const [raw, cooked] of Object.entries(COOKED_OF)) RAW_OF[cooked] ||= raw;
// grain / legume foods that have no exact cooked twin in the table (used for a note without a one-tap fix)
const DRY_FAMILY = /(^|-)(rice|pasta|noodles?|buckwheat|barley|bulgur|couscous|quinoa|lentils?|beans?|chickpeas?|oats?|millet|semolina)(-|$)/;

const COOKED_RE = /\b(cooked|boiled|steamed|leftover|canned|tinned|drained|ugotowan\w*|gotowan\w*|puszk\w*)\b/;
const RAW_RE = /\b(raw|uncooked|dry|dried|surow\w*|such\w*)\b/;
const BONE_RE = /\b(legs?|thighs?|drumsticks?|wings?|ribs?|spare ?ribs?|chops?|shanks?|oxtail|carcass|on the bone|bone-?in|whole (chicken|duck|turkey|fish|goose)|udk\w*|skrzyd\w*|zeberk\w*|zebra)\b/;
const NOBONE_RE = /\b(boneless|deboned|de-boned|fillets?|filets?|mince\w*|ground|edible|shredded|diced|cubed|strips?|bez kosci)\b/;
const MEAT_RE = /(chicken|kurcz|pork|wieprz|lamb|jagn|beef|wolow|duck|kacz|turkey|indyk|goose|rabbit|veal|ribs|meat|mieso)/;
const FRY_RE = /\b(fry|frying|deep|shallow|smaz\w*)\b/;
const OIL_ID = /(^|-)(oil|lard|ghee|dripping|shortening)(-|$)|-oil$|^oil/;
const VAGUE_RE = /\b(handful|to taste|dash|glug|knob|splash|can|tin|package|packet|pack|jar|bottle|szczypta|garsc\w*|puszk\w*|opakowan\w*)\b/;
const HAS_WEIGHT_RE = /\d\s*(g|kg|ml|l|oz|lb|dag)\b/;

// name family -> what the matched food should look like, and a typical kcal per 100 g (for "suspicious match" checks)
const FAMILIES = [
  { re: /\b(brandy|cognac|whisk(e)?y|vodka|rum|gin|liqueur|sherry|port wine|armagnac|calvados)\b/, ok: /brandy|spirit|liquor|liqueur|vodka|whisk|rum|gin|sherry|port|wine|alcohol/, kcal: 230, what: 'a spirit' },
  { re: /\b(olive oil|vegetable oil|sunflower oil|rapeseed oil|cooking oil|oil|lard|ghee|margarine|butter|olej\w*|oliwa|maslo)\b(?! (packed|in ))/, ok: /oil|lard|ghee|margarine|butter|olive|fat/, kcal: 800, what: 'an oil or butter' },
  { re: /\b(cheese|parmesan|cheddar|mozzarella|feta|ricotta|gouda|brie|halloumi|mascarpone|ser)\b/, ok: /cheese|parmesan|cheddar|mozz|feta|ricotta|gouda|brie|halloumi|mascarpone|cottage|cream|quark|paneer|ser/, kcal: 330, what: 'a cheese' },
  { re: /\b(almonds?|walnuts?|cashews?|pistachios?|pecans?|hazelnuts?|peanuts?|pine nuts?|nuts)\b/, ok: /nut|almond|walnut|cashew|pistach|pecan|hazel|peanut|seed/, kcal: 600, what: 'nuts' },
  { re: /\b(sugar|honey|maple syrup|syrup|molasses|cukier|miod)\b(?! snap)/, ok: /sugar|honey|syrup|molasses|maple|sweet/, kcal: 380, what: 'sugar or honey' },
  { re: /\b(flour|mak\w)\b/, ok: /flour|starch|meal|bran|mix/, kcal: 360, what: 'flour' },
  { re: /\b(bacon|pancetta|sausages?|chorizo|salami|ham|prosciutto|kielbas\w*|boczek)\b/, ok: /bacon|pancetta|sausage|chorizo|salami|ham|prosciutto|pork|kielbas|boczek/, kcal: 300, what: 'cured meat' },
  { re: /\b(beef|steak|lamb|pork|mince\w*|veal)\b/, ok: /beef|steak|lamb|pork|veal|meat|ribs|ground|mince/, kcal: 220, what: 'red meat' },
];

// calorie-dense words for "not counted at all" (typical kcal/100 g, default grams when the amount is unknown)
const DENSE = [
  { re: /\b(oil|olej\w*|oliwa|lard|ghee|margarine)\b/, kcal: 884, g: 30 }, { re: /\b(butter|maslo)\b/, kcal: 717, g: 25 },
  { re: /\b(cheese|parmesan|cheddar|mozzarella|feta|ricotta|gouda|brie|halloumi|mascarpone|ser)\b/, kcal: 330, g: 60 },
  { re: /\b(cream|smietan\w*)\b/, kcal: 300, g: 60 }, { re: /\b(almonds?|walnuts?|cashews?|pistachios?|pecans?|hazelnuts?|peanuts?|nuts|orzech\w*)\b/, kcal: 600, g: 30 },
  { re: /\b(sugar|honey|cukier|miod)\b/, kcal: 385, g: 30 }, { re: /\b(flour|mak\w)\b/, kcal: 360, g: 60 },
  { re: /\b(bacon|sausages?|chorizo|salami|ham|boczek|kielbas\w*)\b/, kcal: 350, g: 80 }, { re: /\b(chocolate|czekolad\w*)\b/, kcal: 540, g: 40 },
  { re: /\b(mayonnaise|majonez)\b/, kcal: 690, g: 30 }, { re: /\b(rice|pasta|noodles?|ryz|makaron)\b/, kcal: 360, g: 80 },
  { re: /\b(beef|pork|lamb|chicken|turkey|duck|meat|mince\w*|steak|kurczak|wieprzow\w*|wolow\w*|mieso)\b/, kcal: 210, g: 150 },
  { re: /\b(bread|chleb|bulk\w)\b/, kcal: 265, g: 60 },
];

const r0 = (x) => Math.round(x);
const kOf = (ing) => (ing.food && Number.isFinite(Number(ing.food.k)) ? Number(ing.food.k) : null);
const gramsOf = (ing) => (ing.grams == null || ing.grams === '' || Number.isNaN(Number(ing.grams)) ? null : Number(ing.grams));
export const rowKcal = (ing) => (kOf(ing) != null && gramsOf(ing) != null ? (kOf(ing) * gramsOf(ing)) / 100 : 0);
const textOf = (ing) => fold(`${ing.raw || ''} ${ing.name || ''}`);
const nameOf = (ing) => (ing.name || ing.raw || '').trim();
const idOf = (ing) => ing.food?.id || '';

function candidates(ings, servings, foods) {
  const out = [];
  const add = (i, kind, impact, dir, message, fix = null) => {
    if (impact > 0) out.push({ i, kind, name: nameOf(ings[i]), impact, dir, message, fix });
  };
  ings.forEach((ing, i) => {
    if (ing.head) return;
    const ok = ing.checkOk || [];
    const t = textOf(ing);
    const id = idOf(ing);
    const k = kOf(ing);
    const g = gramsOf(ing);
    const row = rowKcal(ing);
    const user = ing.conf === 'user';
    const name = nameOf(ing);

    // ---- unmatched (or no weight) but likely calorie-dense: total too LOW ----
    if (!ok.includes('unmatched') && !ing.toTaste && (!ing.food || g == null)) {
      const d = DENSE.find((x) => x.re.test(t));
      if (d) {
        let est = g;
        if (est == null) {
          const m = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/.exec(fold(ing.raw || ''));
          if (m) est = Number(m[1].replace(',', '.')) * (m[2] === 'kg' || m[2] === 'l' ? 1000 : 1);
        }
        if (est == null || est <= 0) est = d.g;
        const kc = k != null ? k : d.kcal;
        const impact = (kc * est) / 100;
        add(i, 'unmatched', impact, 'under', ing.food
          ? `"${name}" has no weight, so it is not counted. It is usually calorie-heavy (about ${r0(impact / servings)} kcal per serving).`
          : `"${name}" is not matched to a food, so its calories are missing (about ${r0(impact / servings)} kcal per serving if it is a normal amount).`);
        return;
      }
    }
    if (!ing.food || g == null || !(g > 0)) return;

    // ---- raw vs cooked (rice, pasta, groats, legumes, potatoes): ~2.5-3x ----
    if (!ok.includes('cooked') && !user) {
      const saysCooked = COOKED_RE.test(t);
      const saysRaw = RAW_RE.test(t);
      const cookedId = COOKED_OF[id];
      const rawId = RAW_OF[id];
      if (saysCooked && !saysRaw && cookedId && foods[cookedId]) {
        const alt = foods[cookedId];
        add(i, 'cooked', row - (alt.k * g) / 100, 'over',
          `"${name}" is described as cooked, but it is counted as dry (${r0(k)} kcal per 100 g). Cooked weighs about 2.5-3 times more per gram, so calories here are much too high.`,
          { label: `Switch to ${alt.en.toLowerCase()}`, patch: { foodId: cookedId } });
      } else if (saysCooked && !saysRaw && !cookedId && !rawId && DRY_FAMILY.test(id) && k >= 300) {
        add(i, 'cooked', row * 0.6, 'over', `"${name}" is described as cooked, but it is counted as dry (${r0(k)} kcal per 100 g). Cooked is about 2.5 times lighter in calories per gram - pick the cooked food.`);
      } else if (!saysCooked && rawId && /rice|pasta|buckwheat|barley/.test(rawId) && foods[rawId] && !/\b(sauce|stock|broth|soup)\b/.test(t)) {
        const alt = foods[rawId];
        add(i, 'cooked', (alt.k * g) / 100 - row, 'under',
          `"${name}" is counted as cooked, but the recipe does not say cooked. If ${g} g is the dry weight, calories are about ${r0(((alt.k * g) / 100 - row) / servings)} kcal per serving too low.`,
          { label: `Switch to dry ${alt.en.toLowerCase()}`, patch: { foodId: rawId } });
      }
    }

    // ---- chicken cut matched to breast (legs / thighs / wings are fattier) ----
    if (!ok.includes('cut') && !user && id === 'chicken-breast' && /\b(legs?|thighs?|drumsticks?|wings?|udk\w*|skrzyd\w*)\b/.test(t)) {
      const altId = /wing|skrzyd/.test(t) ? 'chicken-wing' : /drumstick/.test(t) ? 'chicken-drumstick' : 'chicken-thigh-skin';
      const alt = foods[altId];
      if (alt) {
        add(i, 'cut', ((alt.k - k) * g) / 100, 'under',
          `"${name}" is counted as chicken breast (${r0(k)} kcal per 100 g), but this cut is fattier (${r0(alt.k)} kcal per 100 g).`,
          { label: `Switch to ${alt.en.toLowerCase()}`, patch: { foodId: altId } });
      }
    }

    // ---- other suspicious matches: food does not look like what the name says ----
    if (!ok.includes('match') && !user) {
      const fam = FAMILIES.find((f) => f.re.test(t) && !/\b(in|packed in|w)\s+(olive |vegetable |sunflower )?(oil|olej\w*|syrup)\b/.test(t));
      if (fam && !fam.ok.test(id) && !fam.ok.test(fold(ing.food.name || ''))) {
        const impact = (Math.abs(fam.kcal - k) * g) / 100;
        add(i, 'match', impact, k > fam.kcal ? 'over' : 'under',
          `"${name}" is matched to "${foodLabel(ing.food) || id}" (${r0(k)} kcal per 100 g), which does not look like ${fam.what} (about ${fam.kcal}). Choose the right food.`);
      } else if (ing.conf === 'low') {
        add(i, 'match', row * 0.5, 'unsure', `The match for "${name}" is unsure ("${foodLabel(ing.food) || id}", ${r0(row / servings)} kcal per serving). Check it.`);
      }
    }

    // ---- bone-in / whole-bird weights counted as edible meat ----
    if (!ok.includes('bone') && (BONE_RE.test(t) || id === 'chicken-whole') && !NOBONE_RE.test(t) && (MEAT_RE.test(id) || MEAT_RE.test(t))) {
      add(i, 'bone', row * 0.3, 'over',
        `"${name}" (${r0(g)} g) is probably weighed with the bone. Only about 70 % is meat you eat.`,
        { label: 'Count 70 % as meat', patch: { gramsMul: 0.7, markOk: 'bone' } });
    }

    // ---- amount estimated from a vague unit on a calorie-dense item ----
    const dense = k >= 300 || (MEAT_RE.test(id) && k >= 120);
    if (!ok.includes('vague') && dense && (ing.guess === true || (VAGUE_RE.test(t) && !HAS_WEIGHT_RE.test(fold(ing.raw || ''))))) {
      add(i, 'vague', row * 0.5, 'unsure', `The amount of "${name}" is a rough guess (${r0(g)} g, about ${r0(row / servings)} kcal per serving). Weigh it if you can.`);
    }

    // ---- frying oil counted fully ----
    if (!ok.includes('frying') && OIL_ID.test(id) && g >= 50 && (g >= 80 || FRY_RE.test(t))) {
      add(i, 'frying', row * 0.6, 'over', `${r0(g)} g of "${name}" (${r0(row / servings)} kcal per serving). If this is for frying, most of it stays in the pan - count only what you eat.`);
    }
  });
  return out;
}

export function checkRecipe(ings = [], servings = 1, foodsById = {}, { max = MAX_WARNINGS } = {}) {
  const s = Math.max(1, Number(servings) || 1);
  const foods = foodsById instanceof Map ? Object.fromEntries(foodsById) : foodsById;
  const total = ings.reduce((a, ing) => a + rowKcal(ing), 0);
  let cand = candidates(ings, s, foods);
  const big = (impact) => impact >= MIN_SHARE * total || impact / s >= MIN_PER_SERVING;
  // Bone-in rows are judged together: several small ones can add up to a big one.
  const boneSum = cand.filter((c) => c.kind === 'bone').reduce((a, c) => a + c.impact, 0);
  cand = cand.filter((c) => (c.kind === 'bone' ? big(boneSum) : big(c.impact)));
  // one warning per ingredient (the biggest), biggest first
  const best = new Map();
  for (const c of cand) if (!best.has(c.i) || best.get(c.i).impact < c.impact) best.set(c.i, c);
  return [...best.values()].sort((a, b) => b.impact - a.impact).slice(0, max)
    .map((c) => ({ i: c.i, kind: c.kind, name: c.name, message: c.message, kcal: r0(c.impact / s), dir: c.dir, fix: c.fix }));
}

// ---------- fixes ----------
export function dbSnap(food) {
  const s = { src: 'db', id: food.id, name: foodLabel({ ...food, src: 'db' }), k: food.k, p: food.p, c: food.c, f: food.f };
  if (food.en) s.en = food.en;
  if (food.pl) s.pl = food.pl;
  if (food.u) s.u = food.u;
  return s;
}
export function ignoreWarning(ing, kind) {
  return { ...ing, checkOk: [...new Set([...(ing.checkOk || []), kind])] };
}
export function applyFix(ing, fix, foodsById = {}, kind = null) {
  if (!fix?.patch) return ing;
  const { foodId, gramsMul, markOk } = fix.patch;
  const out = { ...ing };
  if (foodId) {
    const food = foodsById[foodId];
    if (!food) return ing;
    out.food = dbSnap(food);
    out.conf = 'user';
    if (out.grams != null) out.hint = out.grams; // keep the weight when the food changes
  }
  if (gramsMul) {
    out.grams = Math.round((Number(out.grams) || 0) * gramsMul * 10) / 10;
    out.hint = out.grams; out.guess = false; out.qty = out.grams; out.unit = 'g';
    out.raw = `${out.grams} g ${out.name || ''}`.trim();
  }
  return markOk || kind ? ignoreWarning(out, markOk || kind) : out;
}
