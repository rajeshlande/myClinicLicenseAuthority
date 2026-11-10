import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  STATUS_BADGE_CLASSES,
  buildStandingPillStyle,
  buildSyncPillStyle,
} from '../src/lib/status-palette.mjs';

const indexCss = readFileSync('src/index.css', 'utf8');

/** Every `var(--token)` a palette object references, collected mechanically. */
function tokensUsed(...palettes) {
  const found = new Set();
  for (const palette of palettes) {
    for (const value of Object.values(palette)) {
      for (const match of String(value).matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        found.add(match[1]);
      }
    }
  }
  return [...found].sort();
}

test('buildSyncPillStyle maps each Client Sync tone to its Mapping Guide surface', () => {
  assert.deepEqual(buildSyncPillStyle({ tone: 'ok' }), {
    badgeClass: 'badge-success',
    dotColor: 'var(--ok-main)',
    textColor: 'var(--ok-text)',
  });
  assert.deepEqual(buildSyncPillStyle({ tone: 'warn' }), {
    badgeClass: 'badge-warning',
    dotColor: 'var(--warn-main)',
    textColor: 'var(--warn-text)',
  });
  // Schema v3: `error` is Refused — the client called Central and was turned away.
  assert.deepEqual(buildSyncPillStyle({ tone: 'error' }), {
    badgeClass: 'badge-error',
    dotColor: 'var(--danger-main)',
    textColor: 'var(--danger-text)',
  });
  assert.deepEqual(buildSyncPillStyle({ tone: 'neutral' }), {
    badgeClass: 'console-well',
    dotColor: 'var(--text-muted)',
    textColor: 'var(--text-secondary)',
  });
});

test('buildSyncPillStyle falls back to the neutral surface for any unrecognised tone', () => {
  const neutral = buildSyncPillStyle({ tone: 'neutral' });
  for (const tone of [undefined, null, '', 'OK', 'Error', 'danger', 'ok ', 0]) {
    assert.deepEqual(buildSyncPillStyle({ tone }), neutral, `tone=${String(tone)}`);
  }
  assert.deepEqual(buildSyncPillStyle({}), neutral);
});

test('the palette vocabulary is closed: no builder can invent a surface class', () => {
  const tones = ['ok', 'warn', 'error', 'neutral', undefined, 'weird'];
  const standings = [
    { isOperational: true },
    { isOperational: false, stateCode: 'KEY_KILLED' },
    { isOperational: false, stateCode: 'EXPIRED' },
    { isOperational: false, stateCode: 'SUSPENDED' },
    { isOperational: false, stateCode: 'ACTIVE' },
    {},
  ];

  for (const tone of tones) {
    const pill = buildSyncPillStyle({ tone });
    assert.ok(
      STATUS_BADGE_CLASSES.includes(pill.badgeClass),
      `${pill.badgeClass} is outside the Mapping Guide vocabulary`,
    );
  }
  for (const standing of standings) {
    const pill = buildStandingPillStyle(standing);
    for (const value of Object.values(pill)) {
      assert.match(value, /^var\(--[a-z0-9-]+\)$/, `unexpected token ${value}`);
    }
  }
  assert.deepEqual(STATUS_BADGE_CLASSES, [
    'badge-success',
    'badge-warning',
    'badge-error',
    'console-well',
  ]);
  assert.throws(() => {
    STATUS_BADGE_CLASSES.push('badge-brand');
  }, TypeError);
});

test('buildStandingPillStyle keeps operational green, killed red, everything else amber', () => {
  assert.deepEqual(buildStandingPillStyle({ isOperational: true }), {
    bg: 'var(--ok-soft)',
    border: 'var(--ok-border)',
    text: 'var(--ok-text)',
    dotColor: 'var(--ok-main)',
  });
  // A killed key outranks an otherwise operational row.
  assert.deepEqual(
    buildStandingPillStyle({ isOperational: false, stateCode: 'KEY_KILLED' }),
    {
      bg: 'var(--danger-soft)',
      border: 'var(--danger-border)',
      text: 'var(--danger-text)',
      dotColor: 'var(--danger-main)',
    },
  );
  for (const stateCode of ['EXPIRED', 'SUSPENDED', 'ACTIVE', undefined]) {
    assert.deepEqual(
      buildStandingPillStyle({ isOperational: false, stateCode }),
      {
        bg: 'var(--warn-soft)',
        border: 'var(--warn-border)',
        text: 'var(--warn-text)',
        dotColor: 'var(--warn-main)',
      },
      `stateCode=${String(stateCode)}`,
    );
  }
});

test('every surface class and colour token the palettes use is defined in src/index.css', () => {
  for (const badgeClass of STATUS_BADGE_CLASSES) {
    assert.ok(
      indexCss.includes(`.${badgeClass}`),
      `.${badgeClass} is used by the palette but missing from src/index.css`,
    );
  }

  const used = tokensUsed(
    ...['ok', 'warn', 'error', 'neutral'].map((tone) =>
      buildSyncPillStyle({ tone }),
    ),
    buildStandingPillStyle({ isOperational: true }),
    buildStandingPillStyle({ isOperational: false, stateCode: 'KEY_KILLED' }),
    buildStandingPillStyle({ isOperational: false, stateCode: 'EXPIRED' }),
  );

  assert.ok(used.length >= 8, `expected a real token set, got ${used.join(', ')}`);
  for (const token of used) {
    assert.ok(
      indexCss.includes(`${token}:`),
      `${token} is referenced by the palette but never declared in src/index.css`,
    );
  }
});
