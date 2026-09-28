import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../docs/food-cats.js';

const lessons = JSON.parse(readFileSync(fileURLToPath(new URL('../docs/data/lessons.json', import.meta.url)), 'utf8'));
const techniqueIds = new Set(CATEGORIES.technique.items.map((i) => i.key));

const REQUIRED = ['id', 'module', 'title', 'minutes', 'summary', 'why', 'steps', 'mistakes', 'doneness', 'flavorTips', 'practice', 'techniques', 'videoQuery', 'levelUp'];

test('lessons.json has a sensible shape', () => {
  assert.ok(Array.isArray(lessons) && lessons.length >= 14, 'expected an array of lessons');
});

test('every lesson has all required fields with sane types', () => {
  for (const l of lessons) {
    for (const key of REQUIRED) assert.ok(key in l, `${l.id || '?'} is missing "${key}"`);
    assert.equal(typeof l.id, 'string');
    assert.ok(l.id.length > 0);
    assert.equal(typeof l.module, 'string');
    assert.equal(typeof l.title, 'string');
    assert.equal(typeof l.minutes, 'number');
    assert.ok(l.minutes > 0 && l.minutes < 60, `${l.id} minutes should be a realistic reading time`);
    assert.equal(typeof l.summary, 'string');
    assert.ok(l.summary.length > 0 && l.summary.length < 220);
    assert.equal(typeof l.why, 'string');
    assert.ok(l.why.length > 20);
    assert.ok(Array.isArray(l.steps) && l.steps.length >= 4 && l.steps.length <= 8, `${l.id} steps should have 4-8 items`);
    l.steps.forEach((s) => assert.equal(typeof s, 'string'));
    assert.ok(Array.isArray(l.mistakes) && l.mistakes.length >= 3 && l.mistakes.length <= 5, `${l.id} mistakes should have 3-5 items`);
    l.mistakes.forEach((m) => {
      assert.equal(typeof m.mistake, 'string');
      assert.equal(typeof m.fix, 'string');
    });
    assert.ok(Array.isArray(l.doneness), `${l.id} doneness should be an array`);
    l.doneness.forEach((d) => assert.equal(typeof d, 'string'));
    assert.ok(Array.isArray(l.flavorTips) && l.flavorTips.length >= 2 && l.flavorTips.length <= 4, `${l.id} flavorTips should have 2-4 items`);
    assert.equal(typeof l.practice, 'object');
    assert.equal(typeof l.practice.task, 'string');
    assert.equal(typeof l.practice.successCriteria, 'string');
    assert.ok(Array.isArray(l.techniques), `${l.id} techniques should be an array`);
    assert.equal(typeof l.videoQuery, 'string');
    assert.ok(l.videoQuery.length > 0);
    assert.equal(typeof l.levelUp, 'string');
    assert.ok(l.levelUp.length > 0);
  }
});

test('lesson ids are unique', () => {
  const ids = lessons.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every technique id used by a lesson exists in food-cats CATEGORIES.technique', () => {
  for (const l of lessons) {
    for (const t of l.techniques) {
      assert.ok(techniqueIds.has(t), `${l.id} references unknown technique id "${t}"`);
    }
  }
});

test('lessons are grouped into a small, sensible set of modules', () => {
  const modules = new Set(lessons.map((l) => l.module));
  assert.ok(modules.size >= 3 && modules.size <= 6);
});
