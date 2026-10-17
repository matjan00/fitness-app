import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCode, findLocal, offProductToFood } from '../docs/food-barcode.js';
import { fromRows } from '../docs/food-products.js';

const products = fromRows({ rows: [
  ['5900512300108', 'Twaróg półtłusty', 'Piątnica', 132, 18, 3.7, 4, 0, 250, 40],
  ['012345678905', 'Peanut butter', 'Acme', 600, 25, 15, 50, 0, 0, 1],
] });

test('cleanCode keeps real barcode lengths only', () => {
  assert.equal(cleanCode(' 5900512300108 '), '5900512300108');
  assert.equal(cleanCode('5900-5123-0010-8'), '5900512300108');
  assert.equal(cleanCode('96385074'), '96385074');
  assert.equal(cleanCode('12345'), null);
  assert.equal(cleanCode(''), null);
});

test('own foods win, then bundled products; leading zeros ignored', () => {
  const mine = [{ id: 'x', src: 'custom', name: 'My twaróg', code: '5900512300108', k: 100 }];
  assert.equal(findLocal('5900512300108', mine, products).name, 'My twaróg');
  assert.equal(findLocal('5900512300108', [], products).name, 'Twaróg półtłusty');
  assert.equal(findLocal('0012345678905', [], products).name, 'Peanut butter'); // EAN-13 of a UPC-A
  assert.equal(findLocal('5901111111111', [], products), null);
});

test('online product becomes a food; no kcal → null', () => {
  const f = offProductToFood({ code: '590', product_name: 'Kefir', brands: 'Bieluch, Mlekpol', product_quantity: '400',
    nutriments: { 'energy-kcal_100g': 50, proteins_100g: 3.4, carbohydrates_100g: 4.66, fat_100g: 2 } });
  assert.deepEqual(f, { src: 'off', id: 'off:590', name: 'Kefir', brand: 'Bieluch', k: 50, p: 3.4, c: 4.7, f: 2, u: { pack: 400 } });
  assert.equal(offProductToFood({ code: '1', product_name: 'Water', nutriments: {} }), null);
  assert.equal(offProductToFood(null), null);
});

test('cleanCode rejects all-zero codes and wrong check digits', () => {
  assert.equal(cleanCode('0000000000000'), null);
  assert.equal(cleanCode('5900512300109'), null);
  assert.equal(cleanCode('5900512300108'), '5900512300108');
});
