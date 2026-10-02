import test from 'node:test';
import assert from 'node:assert/strict';
import { startSince, nextCursor, afterFilter } from '../docs/sync-cursor.js';

test('startSince subtracts the overlap and tolerates junk', () => {
  assert.equal(startSince('2026-01-01T00:01:00.000Z'), '2026-01-01T00:00:00.000Z');
  assert.equal(startSince(null), null);
  assert.equal(startSince('nope'), null);
});

test('nextCursor takes the last row', () => {
  assert.deepEqual(nextCursor([{ synced_at: 'a', id: '1' }, { synced_at: 'b', id: '2' }]), { at: 'b', id: '2' });
  assert.equal(nextCursor([]), null);
  assert.equal(nextCursor(null), null);
  assert.equal(nextCursor([{ id: 'x' }]), null);
});

test('afterFilter: first page is a plain gt, later pages tie-break on id', () => {
  assert.equal(afterFilter(null), null);
  assert.equal(afterFilter({ at: '2026-01-01T00:00:00+00:00', id: null }), 'synced_at.gt."2026-01-01T00:00:00+00:00"');
  assert.equal(
    afterFilter({ at: 'T', id: 'abc' }),
    'synced_at.gt."T",and(synced_at.eq."T",id.gt."abc")',
  );
  assert.equal(afterFilter({ at: 'T', id: 'a"b' }).includes('id.gt."a\\"b"'), true);
});
