// Grocery list → Listonic. Plain JavaScript with no Deno / Node APIs, so it runs inside the edge
// function (index.ts) and in the node tests (tests/listonic.test.js).
//
// Listonic has no public API; this follows the private one its web app uses (reverse-engineered by
// github.com/omelhus/ha-listonic and github.com/ArturLys/listonic-mcp). Items come back PascalCase:
// { Id, Name, Amount, Unit, Checked: 1|0 }.

export const MAX_ITEMS = 200;
const clean = (x, max) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim().slice(0, max) : '');
const nameKey = (s) => clean(s, 200).toLocaleLowerCase('pl');

// The items the app sent, checked: [{ name, amount, unit }], names required, max MAX_ITEMS. Null when unusable.
export function parseItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return null;
  const out = [];
  for (const it of items) {
    const name = clean(it?.name, 120);
    if (!name) return null;
    out.push({ name, amount: clean(it?.amount, 20), unit: clean(it?.unit, 20) });
  }
  return out;
}

// What to do on the list: a product already on it and not crossed off gets its amount replaced
// (sending the list again after changing the plan must not double it); anything else is added.
// existing: the list's items as Listonic returns them.
export function planSend(existing, items) {
  const open = new Map();
  for (const e of Array.isArray(existing) ? existing : []) {
    if (!e || e.Id == null || String(e.Checked) === '1' || e.Checked === true) continue;
    const k = nameKey(e.Name);
    if (k && !open.has(k)) open.set(k, e);
  }
  const add = [], update = [];
  for (const it of items) {
    const e = open.get(nameKey(it.name));
    if (!e) { add.push({ Name: it.name, Amount: it.amount, Unit: it.unit }); continue; }
    open.delete(nameKey(it.name));
    if (clean(e.Amount, 20) !== it.amount || clean(e.Unit, 20) !== it.unit) update.push({ id: e.Id, Amount: it.amount, Unit: it.unit });
  }
  return { add, update };
}

// Lists for the picker: [{ id, name }], archived ones left out.
export function listChoices(lists) {
  return (Array.isArray(lists) ? lists : [])
    .filter((l) => l && l.Id != null && !l.Archive && !l.Archived && !l.IsArchived)
    .map((l) => ({ id: String(l.Id), name: clean(l.Name, 80) || 'Lista' }));
}
