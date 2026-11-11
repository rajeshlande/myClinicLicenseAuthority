import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInvoicePdfBytes,
  pdfString,
} from '../src/lib/invoice-pdf.mjs';
import { buildInvoiceDraft } from '../src/lib/invoices.mjs';

const latin1 = (bytes) =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('');

const SAMPLE = {
  ...buildInvoiceDraft({
    subscriptionId: 'sub_00000000-0000-4000-8000-000000000001',
    licenseId: 'lic_1',
    tier: 'growth',
    seats: 3,
    termMonths: 12,
    existingCount: 0,
    now: new Date('2026-11-06T00:00:00Z'),
  }),
  issued_at: '2026-11-06T00:00:00Z',
  notes: 'Annual term (parens) and \\ backslash safety.',
};

test('pdfString escapes delimiters and folds non-Latin-1 glyphs', () => {
  assert.equal(pdfString('a(b)c\\d'), '(a\\(b\\)c\\\\d)');
  assert.equal(pdfString('₹100'), '(?100)', 'rupee sign is not in Latin-1');
  assert.equal(pdfString(null), '()');
});

test('the file is PDF 1.4 with a binary comment and a clean EOF', () => {
  const text = latin1(buildInvoicePdfBytes(SAMPLE));
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.includes('%\xE2\xE3\xCF\xD3'), 'binary comment line present');
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});

test('every xref offset lands exactly on its object header', () => {
  const bytes = buildInvoicePdfBytes(SAMPLE);
  const text = latin1(bytes);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
  assert.ok(Number.isInteger(startxref) && startxref > 0);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');

  const xrefBody = text.slice(startxref);
  const countLine = /xref\n0 (\d+)\n/.exec(xrefBody)?.[1];
  const size = Number(countLine);
  assert.ok(size >= 7, 'catalog + pages + page + content + 2 fonts');

  const entries = [...xrefBody.matchAll(/^(\d{10}) 00000 n /gm)];
  assert.equal(entries.length, size - 1);
  entries.forEach((m, i) => {
    const off = Number(m[1]);
    const expect = `${i + 1} 0 obj`;
    assert.equal(
      text.slice(off, off + expect.length),
      expect,
      `object ${i + 1} xref offset must point at its header`,
    );
  });
});

test('content stream /Length equals the exact stream byte length', () => {
  const text = latin1(buildInvoicePdfBytes(SAMPLE));
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const len = Number(m[1]);
    const start = m.index + m[0].length;
    assert.equal(text.slice(start + len, start + len + 10), '\nendstream');
  }
});

test('page tree count matches the page objects', () => {
  const text = latin1(buildInvoicePdfBytes(SAMPLE));
  const count = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)?.[1]);
  const pages = (text.match(/\/Type \/Page /g) ?? []).length;
  assert.equal(count, 1);
  assert.equal(pages, 1);
  assert.match(text, /Page 1 of 1/);
});

test('long invoices paginate with continued headers', () => {
  const many = {
    ...SAMPLE,
    line_items: Array.from({ length: 60 }, (_, i) => ({
      description: `Seat licence ${i + 1}`,
      qty: 1,
      unit: 100,
    })),
  };
  const text = latin1(buildInvoicePdfBytes(many));
  const pages = (text.match(/\/Type \/Page /g) ?? []).length;
  assert.equal(pages, 3, '60 items at 26 rows per page');
  assert.match(text, /continued/);
  assert.match(text, /Page 3 of 3/);
});

test('amounts render as INR text, never as a missing glyph', () => {
  const text = latin1(buildInvoicePdfBytes(SAMPLE));
  assert.ok(text.includes('INR 13,500.00'), 'subtotal with extra seat line');
  assert.ok(!text.includes('₹'), 'no rupee glyph in a Latin-1 font');
  assert.match(text, /TAX INVOICE/);
  assert.match(text, /INV-2026-0001/);
  assert.match(text, /GST @ 18%/);
});
