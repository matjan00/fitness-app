import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLine, ago } from '../docs/sync-line.js';

const NOW = Date.parse('2026-05-01T12:00:00Z');
const at = (min) => new Date(NOW - min * 60000).toISOString();

test('ago', () => {
  assert.equal(ago(at(0), NOW), 'just now');
  assert.equal(ago(at(2), NOW), '2 min ago');
  assert.equal(ago(at(125), NOW), '2 h ago');
  assert.equal(ago(at(3000), NOW), '2 d ago');
  assert.equal(ago('bad', NOW), '');
});

test('syncLine states', () => {
  assert.equal(syncLine({ status: 'local', pending: 0 }, NOW), null);
  assert.equal(syncLine({ status: 'signed-out' }, NOW), null);
  assert.equal(syncLine(null, NOW), null);
  assert.equal(syncLine({ status: 'idle', at: null, pending: 0 }, NOW), null);
  assert.equal(syncLine({ status: 'idle', at: at(2), pending: 0 }, NOW).text, 'Synced 2 min ago ✓');
  assert.equal(syncLine({ status: 'syncing', at: at(2), pending: 1 }, NOW).text, 'Syncing…');
  assert.equal(syncLine({ status: 'offline', pending: 3 }, NOW).text, 'Offline — 3 changes waiting');
  assert.equal(syncLine({ status: 'offline', pending: 1 }, NOW).text, 'Offline — 1 change waiting');
  assert.equal(syncLine({ status: 'offline', pending: 0 }, NOW).text, 'Offline');
  const e = syncLine({ status: 'error', error: 'x', pending: 0 }, NOW);
  assert.deepEqual([e.text, e.retry], ['Sync problem — tap to retry', true]);
  assert.equal(syncLine({ status: 'idle', at: at(1), pending: 2 }, NOW).text, '2 changes waiting');
});
