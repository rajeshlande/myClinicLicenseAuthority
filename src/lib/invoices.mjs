// -----------------------------------------------------------------------------
// Billing helpers for schema v4 invoices (Enrolliq slices 6-7).
//
// Pure functions only: the wizard (slice 6) previews and mints the first draft,
// the invoice UI (slice 7) re-uses the same maths for edits and the PDF.
// Prices are Central's published INR rate card; GST is modelled as a single
// tax_rate on the subtotal (numeric(5,4) in the database, 0.18 = 18%).
// -----------------------------------------------------------------------------

/** Annual rate card per plan tier (INR, per subscription). */
export const TIER_ANNUAL_PRICE_INR = Object.freeze({
  solo: 6000,
  growth: 12000,
  chain: 30000,
});

/** Deployment seats included in each tier's base price. */
export const INCLUDED_SEATS = Object.freeze({
  solo: 1,
  growth: 2,
  chain: 5,
});

/** Annual price per deployment seat beyond the included ones (INR). */
export const EXTRA_SEAT_ANNUAL_INR = 1500;

/** Single GST-style rate applied to the subtotal. */
export const GST_RATE = 0.18;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Whole months between now and the expiry date (min 1) — the billed term.
 * @param {string|Date} expiresAt
 * @param {Date} [now]
 */
export function termMonths(expiresAt, now = new Date()) {
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return 12;
  const days = (end.getTime() - now.getTime()) / 86_400_000;
  return Math.max(1, Math.round(days / 30.44));
}

/**
 * Next invoice number: INV-<UTC year>-<zero-padded sequence>.
 * The sequence is derived from the existing invoice count for the year, so
 * two consoles minting concurrently can collide only if they read the same
 * count — acceptable for a single-operator control plane, and the database
 * UNIQUE constraint is the final arbiter.
 *
 * @param {number} existingCount invoices already stored for the year
 * @param {Date} [now]
 */
export function nextInvoiceNumber(existingCount, now = new Date()) {
  const year = now.getUTCFullYear();
  const seq = String(Math.max(0, Number(existingCount) || 0) + 1).padStart(4, '0');
  return `INV-${year}-${seq}`;
}

/**
 * Build a complete `invoices` row (status 'draft') for a new subscription.
 *
 * @param {object} args
 * @param {string} args.subscriptionId
 * @param {string|null} [args.licenseId]
 * @param {string} args.tier one of the priced tiers
 * @param {number} args.seats max_machines purchased
 * @param {number} [args.termMonths] billed months (default 12)
 * @param {number} [args.existingCount] invoices already stored
 * @param {Date} [args.now]
 * @returns {object} row ready for supabase.from('invoices').insert(...)
 */
export function buildInvoiceDraft({
  subscriptionId,
  licenseId = null,
  tier,
  seats,
  termMonths: months = 12,
  existingCount = 0,
  now = new Date(),
}) {
  const base = TIER_ANNUAL_PRICE_INR[tier] ?? TIER_ANNUAL_PRICE_INR.growth;
  const included = INCLUDED_SEATS[tier] ?? INCLUDED_SEATS.growth;
  const extraSeats = Math.max(0, Number(seats) - included);
  const years = months / 12;

  const lineItems = [
    {
      description: `${tier} plan — ${months} month term`,
      qty: 1,
      unit: round2(base * years),
    },
  ];
  if (extraSeats > 0) {
    lineItems.push({
      description: 'Additional deployment seats',
      qty: extraSeats,
      unit: round2(EXTRA_SEAT_ANNUAL_INR * years),
    });
  }

  const subtotal = round2(
    lineItems.reduce((sum, li) => sum + li.qty * li.unit, 0),
  );
  const taxAmount = round2(subtotal * GST_RATE);
  const total = round2(subtotal + taxAmount);

  const due = new Date(now.getTime() + 30 * 86_400_000);

  return {
    invoice_number: nextInvoiceNumber(existingCount, now),
    subscription_id: subscriptionId,
    license_id: licenseId,
    status: 'draft',
    currency: 'INR',
    line_items: lineItems,
    tax_rate: GST_RATE,
    subtotal,
    tax_amount: taxAmount,
    total,
    issued_at: null,
    due_at: due.toISOString(),
    paid_at: null,
    notes: '',
  };
}
