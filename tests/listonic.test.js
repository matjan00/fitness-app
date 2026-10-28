import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItems, planSend, listChoices, MAX_ITEMS } from '../supabase/functions/listonic/logic.js';
import { groceryList, listonicItems } from '../docs/grocery-calc.js';

test('grocery rows become Listonic items with amount and unit apart', () => {
  const rows = groceryList([{ day: 'd', lines: [
    { key: 'p1:1', name: 'Banan', unit: 'g', qty: 100, g: 100 },
    { key: 'p1:5', name: 'Banan', unit: 'sztuka', qty: 0.5, g: 60 },
    { key: 'p2:2', name: 'Jajko', unit: 'sztuka', qty: 3, g: null },
    { key: 'p3:1', name: 'Mleko', unit: 'ml', qty: 300, g: 300 },
    { key: 'p4:1', name: 'Ryż', unit: 'g', qty: 1250, g: 1250 },
    { key: 'p5:3', name: 'Kebab', unit: 'porcja', qty: 1, g: null },
    { key: 'p6:2', name: 'Cytryna', unit: 'sztuka', qty: 1, g: null },
    { key: 'p6:3', name: 'Cytryna', unit: 'plaster', qty: 2, g: null },
  ] }], ['d']);
  assert.deepEqual(listonicItems(rows, { p5: false, p3: true }), [
    { name: 'Banan', amount: '160', unit: 'g' },
    { name: 'Cytryna', amount: '1 + 2 plaster', unit: '' },
    { name: 'Jajko', amount: '3', unit: 'szt.' },
    { name: 'Kebab', amount: '1', unit: 'porcja' },
    { name: 'Ryż', amount: '1,25', unit: 'kg' },
  ]);
});

test('items from the app are checked', () => {
  assert.deepEqual(parseItems([{ name: ' Ryż ', amount: 200, unit: 'g' }]), [{ name: 'Ryż', amount: '200', unit: 'g' }]);
  assert.equal(parseItems([]), null);
  assert.equal(parseItems([{ amount: '1' }]), null);
  assert.equal(parseItems('x'), null);
  assert.equal(parseItems(Array.from({ length: MAX_ITEMS + 1 }, () => ({ name: 'a' }))), null);
});

test('a product already open on the list gets its amount replaced, not a second copy', () => {
  const existing = [
    { Id: 1, Name: 'ryż', Amount: '100', Unit: 'g', Checked: 0 },
    { Id: 2, Name: 'Jajko', Amount: '3', Unit: 'szt.', Checked: 0 },
    { Id: 3, Name: 'Mleko', Amount: '1', Unit: 'l', Checked: 1 },
  ];
  const items = [
    { name: 'Ryż', amount: '200', unit: 'g' },
    { name: 'Jajko', amount: '3', unit: 'szt.' },
    { name: 'Mleko', amount: '300', unit: 'ml' },
    { name: 'Banan', amount: '160', unit: 'g' },
  ];
  assert.deepEqual(planSend(existing, items), {
    add: [{ Name: 'Mleko', Amount: '300', Unit: 'ml' }, { Name: 'Banan', Amount: '160', Unit: 'g' }],
    update: [{ id: 1, Amount: '200', Unit: 'g' }],
  });
  assert.deepEqual(planSend(null, [{ name: 'A', amount: '', unit: '' }]).add, [{ Name: 'A', Amount: '', Unit: '' }]);
});

test('list picker leaves out archived lists', () => {
  assert.deepEqual(listChoices([{ Id: 5, Name: 'Zakupy' }, { Id: 6, Name: 'Stara', Archive: true }, { Id: 7 }, null]),
    [{ id: '5', name: 'Zakupy' }, { id: '7', name: 'Lista' }]);
});
