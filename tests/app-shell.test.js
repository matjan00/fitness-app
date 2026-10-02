import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// app.js touches the DOM, so this is a source-level guard for the fix: background sync status
// events must not trigger a full redraw of the current tab.
test('app shell ignores sync-only store events', () => {
  const src = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  assert.match(src, /kinds\.size === 1 && kinds\.has\('__sync'\)\) return/);
});
