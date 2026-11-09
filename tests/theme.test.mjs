import assert from 'node:assert/strict';
import test from 'node:test';
import {
  THEME_STORAGE_KEY,
  applyDocumentTheme,
  nextTheme,
  normalizeTheme,
  resolveInitialTheme,
} from '../src/lib/theme.mjs';

test('theme helpers default to Vanilla Cream light editorial theme and toggle cleanly', () => {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
  let attr = '';
  const fakeDoc = {
    documentElement: {
      setAttribute: (_name, value) => {
        attr = value;
      },
    },
  };

  assert.equal(resolveInitialTheme(storage), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(normalizeTheme('unexpected'), 'light');

  applyDocumentTheme('dark', fakeDoc, storage);
  assert.equal(attr, 'dark');
  assert.equal(map.get(THEME_STORAGE_KEY), 'dark');
  assert.equal(resolveInitialTheme(storage), 'dark');
});
