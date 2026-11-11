import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTRA_SEAT_ANNUAL_INR,
  GST_RATE,
  INCLUDED_SEATS,
  TIER_ANNUAL_PRICE_INR,
  buildInvoiceDraft,
  nextInvoiceNumber,
  termMonths,
} from '../src/lib/invoices.mjs';

const NOW = new Date('2026-11-06T00:00:00.000Z');

test('nextInvoiceNumber pads the sequence and uses the UTC year', () => {
  assert.equal(nextInvoiceNumber(0, NOW), 'INV-2026-0001');
  assert.equal(nextInvoiceNumber(8, NOW), 'INV-2026-0009');
  assert.equal(nextInvoiceNumber(1234, NOW), 'INV-2026-1235');
  assert.equal(nextInvoiceNumber(null, NOW), 'INV-2026-0001');
});

test('termMonths floors at one month and rounds calendar spans', () => {
  assert.equal(termMonths('2026-11-20T00:00:00Z', NOW), 1);
  assert.equal(termMonths('2027-11-06T00:00:00Z', NOW), 12);
  assert.equal(termMonths('2028-11-05T00:00:00Z', NOW), 24);
  assert.equal(termMonths('nonsense', NOW), 12);
});

test('buildInvoiceDraft prices the base tier with GST maths', () => {
  const draft = buildInvoiceDraft({
    subscriptionId: 'sub_1',
    licenseId: 'lic_1',
    tier: 'growth',
    seats: 2,
    termMonths: 12,
    existingCount: 0,
    now: NOW,
  });
  assert.equal(draft.invoice_number, 'INV-2026-0001');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.currency, 'INR');
  assert.equal(draft.line_items.length, 1, 'included seats add no line');
  assert.equal(draft.line_items[0].unit, TIER_ANNUAL_PRICE_INR.growth);
  assert.equal(draft.subtotal, 12000);
  assert.equal(draft.tax_rate, GST_RATE);
  assert.equal(draft.tax_amount, 2160);
  assert.equal(draft.total, 14160);
  assert.equal(draft.issued_at, null);
  assert.equal(draft.paid_at, null);
});

test('extra seats beyond the included count bill pro-rata per year', () => {
  const draft = buildInvoiceDraft({
    subscriptionId: 'sub_2',
    tier: 'growth',
    seats: 5,
    termMonths: 6,
    existingCount: 3,
    now: NOW,
  });
  assert.equal(draft.invoice_number, 'INV-2026-0004');
  assert.equal(draft.line_items.length, 2);
  const seatLine = draft.line_items[1];
  assert.equal(seatLine.qty, 5 - INCLUDED_SEATS.growth);
  assert.equal(seatLine.unit, (EXTRA_SEAT_ANNUAL_INR * 6) / 12);
  const expectedSub = (TIER_ANNUAL_PRICE_INR.growth * 6) / 12 + seatLine.qty * seatLine.unit;
  assert.equal(draft.subtotal, expectedSub);
  assert.equal(draft.total, Math.round((expectedSub * (1 + GST_RATE) + Number.EPSILON) * 100) / 100);
});

test('draft rows carry the exact column shape the v4 table expects', () => {
  const draft = buildInvoiceDraft({
    subscriptionId: 'sub_3',
    tier: 'solo',
    seats: 1,
    now: NOW,
  });
  for (const key of [
    'invoice_number',
    'subscription_id',
    'license_id',
    'status',
    'currency',
    'line_items',
    'tax_rate',
    'subtotal',
    'tax_amount',
    'total',
    'issued_at',
    'due_at',
    'paid_at',
    'notes',
  ]) {
    assert.ok(key in draft, `draft must carry ${key}`);
  }
  assert.ok(draft.due_at > NOW.toISOString());
});
