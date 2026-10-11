// Scale a recipe up or down (to hit a calorie goal). Pure functions, no DOM. Tests: tests/food-scale.test.js.
import { UNIT_LABEL } from './food-parse.js';

export const MIN_FACTOR = 0.1;
export const MAX_FACTOR = 10;
export const QUICK_FACTORS = [0.5, 1, 1.5, 2];

// Keep a multiplier in a sane range (garbage -> 1).
export const clampFactor = (x) => {
  const n = Number(x);
  if (!(n > 0) || !Number.isFinite(n)) return 1;
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, n));
};

// Multiplier that makes `kcal` become `target` (null when either is missing/zero). Rounded to 2 decimals.
export function factorForKcal(target, kcal) {
  const t = Number(target);
  const k = Number(kcal);
  if (!(t > 0) || !(k > 0)) return null;
  return clampFactor(Math.round((t / k) * 100) / 100);
}

// Kitchen-friendly grams: <10 g to 0.5, <100 g to 1, otherwise to 5.
export function roundGrams(g) {
  const x = Number(g);
  if (!(x > 0)) return 0;
  if (x < 10) return Math.max(0.5, Math.round(x * 2) / 2);
  if (x < 100) return Math.round(x);
  return Math.round(x / 5) * 5;
}

const roundQty = (q) => Math.round(q * 4) / 4; // quarters: 1.5 pc, 0.75 tbsp

// Ingredient list x factor. Rows without grams (headings, "to taste", unmatched) are kept as they are.
// Unit-based rows (2 pc) keep their unit, so the displayed line stays readable.
export function scaleIngredients(ings, factor) {
  const f = clampFactor(factor);
  if (f === 1) return (ings || []).map((i) => ({ ...i }));
  return (ings || []).map((ing) => {
    if (ing.head || ing.grams == null || ing.grams === '' || !(Number(ing.grams) > 0)) return { ...ing };
    const grams = roundGrams(Number(ing.grams) * f);
    const inGrams = !ing.unit || ing.unit === 'g' || ing.qty == null;
    const qty = inGrams ? grams : (roundQty(Number(ing.qty) * f) || 0.25);
    const unit = inGrams ? 'g' : ing.unit;
    return { ...ing, grams, hint: grams, qty, unit, raw: `${qty} ${UNIT_LABEL[unit] || unit} ${ing.name || ''}`.trim() };
  });
}

// "×1.5", "×0.33"
export const factorLabel = (f) => `×${String(Math.round(clampFactor(f) * 100) / 100)}`;
