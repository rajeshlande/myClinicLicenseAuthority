import assert from 'node:assert/strict';
import test from 'node:test';
import {
  THEME_STORAGE_KEY,
  applyDocumentTheme,
  nextTheme,
  normalizeTheme,
  resolveInitialTheme,
} from '../src/lib/theme.mjs';

test('theme helpers default to dark security console and toggle cleanly', () => {
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

  assert.equal(resolveInitialTheme(storage), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(normalizeTheme('unexpected'), 'dark');

  applyDocumentTheme('light', fakeDoc, storage);
  assert.equal(attr, 'light');
  assert.equal(map.get(THEME_STORAGE_KEY), 'light');
  assert.equal(resolveInitialTheme(storage), 'light');
});
