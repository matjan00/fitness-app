// Barcode → food. Order: the user's own foods (saved with a barcode) → bundled Polish products
// (data/products.json) → Open Food Facts product API (online). Pure logic except fetchOFFProduct.
//
//   cleanCode(text)                     → digits of an EAN-8/UPC-A/EAN-13/EAN-14, or null
//   findLocal(code, custom, products)   → food | null
//   offProductToFood(product)           → food | null (same shape as a bundled product)
//   fetchOFFProduct(code)               → food | null (throws on network trouble)

export function cleanCode(text) {
  const d = String(text ?? '').replace(/\D/g, '');
  return [8, 12, 13, 14].includes(d.length) && /[1-9]/.test(d) && checkDigitOk(d) ? d : null;
}

// GS1 check digit (EAN-8/UPC-A/EAN-13/EAN-14): weights 3,1,3,1... from the right, skipping the check digit itself.
function checkDigitOk(d) {
  let sum = 0;
  for (let i = d.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(d[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}

// EAN-13 "0" + UPC-A are the same product; compare without leading zeros.
const norm = (c) => String(c ?? '').replace(/^0+/, '');

export function findLocal(code, custom = [], products = []) {
  const n = norm(code);
  if (!n) return null;
  return custom.find((f) => f.code && norm(f.code) === n)
    || products.find((f) => norm(f.id.replace(/^off:/, '')) === n)
    || null;
}

const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const r1 = (x) => Math.round(x * 10) / 10;

export function offProductToFood(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let k = num(n['energy-kcal_100g']);
  if (k == null && num(n.energy_100g) != null) k = num(n.energy_100g) / 4.184;
  const name = String(p.product_name_pl || p.product_name || p.product_name_en || '').trim();
  if (k == null || !name) return null;
  const food = { src: 'off', id: `off:${p.code}`, name, brand: String(p.brands || '').split(',')[0].trim() || null,
    k: Math.round(k), p: r1(num(n.proteins_100g) || 0), c: r1(num(n.carbohydrates_100g) || 0), f: r1(num(n.fat_100g) || 0) };
  const u = {};
  if (num(p.serving_quantity) > 0) u.serving = r1(num(p.serving_quantity));
  if (num(p.product_quantity) > 0) u.pack = Math.round(num(p.product_quantity));
  if (u.serving || u.pack) food.u = u;
  return food;
}

export async function fetchOFFProduct(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,product_name_pl,product_name_en,brands,nutriments,serving_quantity,product_quantity`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Open Food Facts answered ${r.status}`);
    const j = await r.json();
    return j.status === 1 || j.product ? offProductToFood({ code, ...j.product }) : null;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Open Food Facts is not answering.' : 'Could not reach Open Food Facts.');
  } finally { clearTimeout(t); }
}
