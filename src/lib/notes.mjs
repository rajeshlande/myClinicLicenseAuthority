/**
 * Zero-HTML Rich Notes Parser & Formatter (`src/lib/notes.mjs`).
 *
 * Converts lightweight rich-formatting tokens (`**bold**`, `*italic*`, `` `code` ``,
 * and `- bullet` lines — plus legacy `<b>`/`<i>`/`<code>`/`<br>` tags if imported)
 * into plain AST objects rendered directly as React elements.
 *
 * Pure React element rendering — zero raw DOM markup sinks and zero XSS surface.
 */

function normalizeLegacyMarkup(raw) {
  return String(raw ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:b|strong)>/gi, '**')
    .replace(/<\/?(?:i|em)>/gi, '*')
    .replace(/<\/?code>/gi, '`')
    .replace(/<li>/gi, '\n- ')
    .replace(/<[^>]+>/g, '');
}

/**
 * Parses a single line into inline runs:
 *   `{ type: 'text' | 'bold' | 'italic' | 'code', value: string }`
 */
export function parseInlineRuns(line) {
  const runs = [];
  const tokenPattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) {
      runs.push({ type: 'text', value: line.slice(cursor, match.index) });
    }
    if (match[2] !== undefined) {
      runs.push({ type: 'bold', value: match[2] });
    } else if (match[3] !== undefined) {
      runs.push({ type: 'code', value: match[3] });
    } else if (match[4] !== undefined) {
      runs.push({ type: 'italic', value: match[4] });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < line.length) {
    runs.push({ type: 'text', value: line.slice(cursor) });
  }

  return runs.length ? runs : [{ type: 'text', value: '' }];
}

/**
 * Parses rich notes text into block AST nodes:
 *   - `{ type: 'paragraph', runs: InlineRun[] }`
 *   - `{ type: 'list', items: InlineRun[][] }`
 */
export function parseRichNotes(rawText) {
  const normalized = normalizeLegacyMarkup(rawText).trim();
  if (!normalized) return [];

  const lines = normalized.split(/\r?\n/);
  const blocks = [];
  let pendingList = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (pendingList) {
        blocks.push(pendingList);
        pendingList = null;
      }
      continue;
    }

    const bulletMatch = /^[-•]\s+(.*)$/.exec(trimmed);
    if (bulletMatch) {
      if (!pendingList) {
        pendingList = { type: 'list', items: [] };
      }
      pendingList.items.push(parseInlineRuns(bulletMatch[1]));
    } else {
      if (pendingList) {
        blocks.push(pendingList);
        pendingList = null;
      }
      blocks.push({
        type: 'paragraph',
        runs: parseInlineRuns(trimmed),
      });
    }
  }

  if (pendingList) {
    blocks.push(pendingList);
  }

  return blocks;
}

/**
 * Wraps the active textarea selection with formatting markers (`**`, `*`, `` ` ``).
 */
export function wrapTextSelection(
  sourceText,
  selectionStart,
  selectionEnd,
  marker,
  placeholder = 'text',
) {
  const text = String(sourceText ?? '');
  const start = Math.max(0, Math.min(text.length, Number(selectionStart) || 0));
  const end = Math.max(start, Math.min(text.length, Number(selectionEnd) || 0));
  const selected = text.slice(start, end) || placeholder;
  const nextValue = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
  const nextCursorStart = start + marker.length;
  const nextCursorEnd = nextCursorStart + selected.length;

  return {
    text: nextValue,
    selectionStart: nextCursorStart,
    selectionEnd: nextCursorEnd,
  };
}

export const BILLING_STAMPS = Object.freeze({
  po: '**PO#:** `PO-2026-` ',
  utr: '**UPI/UTR:** `UTR-` ',
  gstin: '**GSTIN:** `27` ',
  bullet: '- ',
});

export function appendBillingStamp(sourceText, kind) {
  const stamp = BILLING_STAMPS[kind] ?? '';
  if (!stamp) return String(sourceText ?? '');
  const current = String(sourceText ?? '');
  if (!current.trim()) return stamp;
  const separator = current.endsWith('\n') ? '' : '\n';
  return `${current}${separator}${stamp}`;
}
