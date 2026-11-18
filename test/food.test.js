import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOOD, foodId, dishesFor, shuffle } from '../src/food.js';
import { DISHES } from '../src/dishes.js';

test('dish list is built, complete and uses safe ids', () => {
  assert.equal(FOOD.length, DISHES.length, 'run npm run food after editing dishes.js');
  assert.equal(new Set(FOOD.map((d) => d.id)).size, FOOD.length);
  for (const d of FOOD) {
    assert.ok(d.id >= 3e9 && d.id < 4e9, d.title);
    assert.equal(d.id, foodId(d.title));
    assert.ok(['breakfast', 'main'].includes(d.meal), d.title);
    assert.ok(d.image, `${d.title} needs a photo`);
    if (d.imageCredit) assert.ok(d.imageCredit.url && d.imageCredit.license, `${d.title} credit is incomplete`);
  }
  assert.ok(dishesFor('breakfast').length > 20 && dishesFor('main').length > 20);
});

test('dishes are pure veg by name', () => {
  const nonVeg = /\b(egg|anda|chicken|mutton|fish|prawn|keema|meat|machh)/i;
  for (const d of DISHES) assert.ok(!nonVeg.test(`${d.name} ${d.desc}`), d.name);
});

test('shuffle keeps every dish exactly once', () => {
  const ids = dishesFor('main').map((d) => d.id);
  const out = shuffle(ids);
  assert.deepEqual([...out].sort(), [...ids].sort());
});
