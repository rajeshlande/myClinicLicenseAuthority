// -----------------------------------------------------------------------------
// Zero-dependency PDF 1.4 writer for Central invoices (Enrolliq slice 7).
//
// WHY HAND-ROLLED: the safe-list in CONTRIBUTING.md is closed, and a whole PDF
// library for one document shape is exactly the dependency bloat it forbids.
// This module emits a spec-shaped file: header, numbered indirect objects, a
// content stream per page using only classic text/rect operators, a byte-accurate
// xref table and trailer. tests/invoice-pdf.test.mjs parses the output and
// verifies every xref offset lands on its object — a broken xref is the classic
// hand-rolled-PDF failure, so it is a gate, not a hope.
//
// FONT/LATIN-1 RULE: standard PDF fonts address WinAnsi/Latin-1 only. The rupee
// sign is NOT in Latin-1, so amounts render as "INR 14,160.00" — never a glyph
// the font cannot show. Any character outside Latin-1 is replaced with '?'.
// -----------------------------------------------------------------------------

const PDF_HEADER = '%PDF-1.4';

/** Replace anything outside Latin-1 and escape PDF string delimiters. */
export function pdfString(raw) {
  const clean = String(raw ?? '')
    .replace(/[^\x20-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  return `(${clean})`;
}

const latin1 = (str) => {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
};

const money = (n) => `INR ${Number(n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const shortDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const ROWS_PER_PAGE = 26;

/** One page's drawing operators as a single content-stream string. */
function renderPageContent(ops) {
  return ops.join('\n');
}

function textOp(ops, { x, y, size, bold = false, str, align = 'left', gray = 0 }) {
  const font = bold ? '/F2' : '/F1';
  const widthEstimate = String(str).length * size * (bold ? 0.58 : 0.5);
  const tx = align === 'right' ? x - widthEstimate : align === 'center' ? x - widthEstimate / 2 : x;
  ops.push(
    `BT ${font} ${size} Tf ${gray} ${gray} ${gray} rg 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm ${pdfString(str)} Tj ET`,
  );
}

function rectOp(ops, { x, y, w, h, rgb, fill = true }) {
  const [r, g, b] = rgb;
  ops.push(`${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re ${fill ? 'f' : 'S'}`);
}

function lineOp(ops, { x1, y1, x2, y2, gray = 0.85 }) {
  ops.push(
    `${gray} ${gray} ${gray} RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S`,
  );
}

/**
 * Build a complete PDF 1.4 file for one invoice.
 *
 * @param {object} invoice row from public.invoices (line_items array, totals)
 * @param {object} [clinic] { email, origin } for the bill-to block
 * @returns {Uint8Array} bytes of the .pdf file
 */
export function buildInvoicePdfBytes(invoice, clinic = {}) {
  const items = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const pageCount = Math.max(1, Math.ceil(items.length / ROWS_PER_PAGE));
  const pages = [];

  for (let p = 0; p < pageCount; p += 1) {
    const ops = [];
    const slice = items.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    const isFirst = p === 0;
    let y = PAGE_H - MARGIN;

    if (isFirst) {
      // Logo block: brand-blue tile + white mark, Enrolliq language.
      rectOp(ops, { x: MARGIN, y: y - 34, w: 34, h: 34, rgb: [0, 0.475, 0.878] });
      textOp(ops, { x: MARGIN + 8, y: y - 22, size: 13, bold: true, str: 'mC', gray: 1 });
      textOp(ops, { x: MARGIN + 44, y: y - 14, size: 13, bold: true, str: 'myClinic Central' });
      textOp(ops, {
        x: MARGIN + 44,
        y: y - 28,
        size: 8,
        str: 'Subscription Control Plane - License Authority',
        gray: 0.4,
      });

      textOp(ops, { x: PAGE_W - MARGIN, y: y - 12, size: 16, bold: true, str: 'TAX INVOICE', align: 'right' });
      textOp(ops, {
        x: PAGE_W - MARGIN,
        y: y - 26,
        size: 9,
        str: `${invoice.invoice_number}  -  ${String(invoice.status ?? '').toUpperCase()}`,
        align: 'right',
        gray: 0.35,
      });
      y -= 64;

      // Bill-to + meta band.
      rectOp(ops, { x: MARGIN, y: y - 58, w: PAGE_W - MARGIN * 2, h: 58, rgb: [0.969, 0.969, 0.976] });
      textOp(ops, { x: MARGIN + 10, y: y - 14, size: 8, bold: true, str: 'BILLED TO', gray: 0.4 });
      textOp(ops, {
        x: MARGIN + 10,
        y: y - 27,
        size: 9.5,
        bold: true,
        str: clinic.email || clinic.origin || 'Clinic on record',
      });
      textOp(ops, {
        x: MARGIN + 10,
        y: y - 40,
        size: 8,
        str: clinic.email && clinic.origin ? clinic.origin : `Subscription ${String(invoice.subscription_id ?? '').slice(0, 8)}`,
        gray: 0.4,
      });
      textOp(ops, { x: PAGE_W - MARGIN - 10, y: y - 14, size: 8, bold: true, str: 'ISSUED / DUE / PAID', align: 'right', gray: 0.4 });
      textOp(ops, {
        x: PAGE_W - MARGIN - 10,
        y: y - 27,
        size: 8.5,
        str: `${shortDate(invoice.issued_at)} / ${shortDate(invoice.due_at)} / ${shortDate(invoice.paid_at)}`,
        align: 'right',
      });
      textOp(ops, {
        x: PAGE_W - MARGIN - 10,
        y: y - 40,
        size: 8,
        str: `Currency ${invoice.currency ?? 'INR'} - GST rate ${(Number(invoice.tax_rate ?? 0) * 100).toFixed(0)}%`,
        align: 'right',
        gray: 0.4,
      });
      y -= 82;
    } else {
      textOp(ops, { x: MARGIN, y, size: 10, bold: true, str: `${invoice.invoice_number} - continued` });
      y -= 24;
    }

    // Line-item table header.
    rectOp(ops, { x: MARGIN, y: y - 16, w: PAGE_W - MARGIN * 2, h: 16, rgb: [0.918, 0.918, 0.941] });
    textOp(ops, { x: MARGIN + 6, y: y - 11, size: 8, bold: true, str: 'DESCRIPTION', gray: 0.25 });
    textOp(ops, { x: 392, y: y - 11, size: 8, bold: true, str: 'QTY', align: 'right', gray: 0.25 });
    textOp(ops, { x: 462, y: y - 11, size: 8, bold: true, str: 'UNIT', align: 'right', gray: 0.25 });
    textOp(ops, { x: PAGE_W - MARGIN - 6, y: y - 11, size: 8, bold: true, str: 'AMOUNT', align: 'right', gray: 0.25 });
    y -= 22;

    for (const li of slice) {
      textOp(ops, { x: MARGIN + 6, y, size: 9, str: li.description ?? '' });
      textOp(ops, { x: 392, y, size: 9, str: String(li.qty ?? 1), align: 'right' });
      textOp(ops, { x: 462, y, size: 9, str: Number(li.unit ?? 0).toFixed(2), align: 'right' });
      textOp(ops, {
        x: PAGE_W - MARGIN - 6,
        y,
        size: 9,
        str: Number((li.qty ?? 1) * (li.unit ?? 0)).toFixed(2),
        align: 'right',
      });
      y -= 7;
      lineOp(ops, { x1: MARGIN, y1: y, x2: PAGE_W - MARGIN, y2: y });
      y -= 11;
    }

    if (p === pageCount - 1) {
      // Totals block, right-aligned, with a filled total band.
      y -= 6;
      const totalsX = PAGE_W - MARGIN - 200;
      textOp(ops, { x: totalsX, y, size: 9, str: 'Subtotal', gray: 0.4 });
      textOp(ops, { x: PAGE_W - MARGIN - 6, y, size: 9, str: money(invoice.subtotal), align: 'right' });
      y -= 15;
      textOp(ops, {
        x: totalsX,
        y,
        size: 9,
        str: `GST @ ${(Number(invoice.tax_rate ?? 0) * 100).toFixed(0)}%`,
        gray: 0.4,
      });
      textOp(ops, { x: PAGE_W - MARGIN - 6, y, size: 9, str: money(invoice.tax_amount), align: 'right' });
      y -= 8;
      rectOp(ops, { x: totalsX - 8, y: y - 12, w: 208, h: 20, rgb: [0, 0.475, 0.878] });
      textOp(ops, { x: totalsX, y: y - 6, size: 10, bold: true, str: 'TOTAL', gray: 1 });
      textOp(ops, {
        x: PAGE_W - MARGIN - 6,
        y: y - 6,
        size: 10,
        bold: true,
        str: money(invoice.total),
        align: 'right',
        gray: 1,
      });
      y -= 34;

      if (invoice.notes) {
        textOp(ops, { x: MARGIN, y, size: 8, bold: true, str: 'NOTES', gray: 0.4 });
        y -= 12;
        textOp(ops, { x: MARGIN, y, size: 8, str: String(invoice.notes).slice(0, 160), gray: 0.3 });
        y -= 16;
      }
    }

    // Footer on every page.
    lineOp(ops, { x1: MARGIN, y1: MARGIN - 8, x2: PAGE_W - MARGIN, y2: MARGIN - 8 });
    textOp(ops, {
      x: MARGIN,
      y: MARGIN - 20,
      size: 7.5,
      str: 'Generated by myClinic Central - append-only audit trail (schema v4)',
      gray: 0.45,
    });
    textOp(ops, {
      x: PAGE_W - MARGIN,
      y: MARGIN - 20,
      size: 7.5,
      str: `Page ${p + 1} of ${pageCount}`,
      align: 'right',
      gray: 0.45,
    });

    pages.push(renderPageContent(ops));
  }

  // ── Object graph: 1 catalog, 2 pages tree, then per page: page + content,
  //    then the two standard fonts. Offsets are tracked in BYTES.
  const objects = [];
  const pageObjNumbers = pages.map((_, i) => 3 + i * 2);
  const fontRegular = 3 + pages.length * 2;
  const fontBold = fontRegular + 1;

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjNumbers
    .map((n) => `${n} 0 R`)
    .join(' ')}] /Count ${pages.length} >>\nendobj\n`;

  pages.forEach((content, i) => {
    const pageNum = 3 + i * 2;
    const contentNum = pageNum + 1;
    objects[pageNum] =
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
      `/Contents ${contentNum} 0 R >>\nendobj\n`;
    objects[contentNum] =
      `${contentNum} 0 obj\n<< /Length ${latin1(content).length} >>\nstream\n${content}\nendstream\nendobj\n`;
  });

  objects[fontRegular] =
    `${fontRegular} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`;
  objects[fontBold] =
    `${fontBold} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`;

  // ── Assemble with byte-accurate offsets.
  const chunks = [latin1(`${PDF_HEADER}\n%\xE2\xE3\xCF\xD3\n`)];
  let offset = chunks[0].length;
  const offsets = [];
  for (let n = 1; n < objects.length; n += 1) {
    offsets[n] = offset;
    const bytes = latin1(objects[n]);
    chunks.push(bytes);
    offset += bytes.length;
  }
  const xrefStart = offset;
  const maxObj = objects.length - 1;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n += 1) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(latin1(xref));

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
