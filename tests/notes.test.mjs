import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendBillingStamp,
  parseRichNotes,
  wrapTextSelection,
} from '../src/lib/notes.mjs';

test('parseRichNotes parses bold, italic, code, and bullet lists without HTML', () => {
  const ast = parseRichNotes(
    '**PO#:** `PO-2026-44`\n- Branch 1 *Mumbai*\n- Branch 2',
  );
  assert.equal(ast.length, 2);
  assert.equal(ast[0].type, 'paragraph');
  assert.deepEqual(ast[0].runs[0], { type: 'bold', value: 'PO#:' });
  assert.deepEqual(ast[0].runs[2], { type: 'code', value: 'PO-2026-44' });
  assert.equal(ast[1].type, 'list');
  assert.equal(ast[1].items.length, 2);
});

test('parseRichNotes strips arbitrary HTML/script tags safely', () => {
  const malicious =
    '<img src=x onerror=alert(1)><b>UTR:</b> <code>9981</code><script>evil()</script>';
  const ast = parseRichNotes(malicious);
  const serialized = JSON.stringify(ast);
  assert.doesNotMatch(serialized, /<img|onerror|<script/i);
  assert.match(serialized, /UTR:/);
  assert.match(serialized, /9981/);
});

test('wrapTextSelection and appendBillingStamp format notes predictably', () => {
  const wrapped = wrapTextSelection('Invoice 102 paid', 8, 11, '`');
  assert.equal(wrapped.text, 'Invoice `102` paid');

  const stamped = appendBillingStamp('', 'po');
  assert.match(stamped, /\*\*PO#:\*\*/);
});
