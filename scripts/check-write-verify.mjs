#!/usr/bin/env node
/**
 * §14 operator-runbook ratchet — every privileged Central write must prove the
 * rows it asked for actually changed.
 *
 * WHY THIS EXISTS
 * Each table the console writes carries an admin-only RLS policy of the shape
 * `for all to authenticated using (is_license_admin())`. A USING clause filters
 * rows rather than denying permission, so a non-admin's UPDATE/DELETE/INSERT
 * SUCCEEDS and affects zero rows: supabase-js returns `{ data: null, error: null }`
 * and the UI shows a success toast for a change that never happened. Live proof:
 * supabase/schema-tests.sql §12f–§12i. The runtime half of the fix is
 * src/lib/write-verify.mjs; this script keeps it from being undone.
 *
 * WHAT COUNTS AS VERIFIED
 * A write chain on a privileged table must ask PostgREST for the rows it changed
 * and then look at the count. Either shape passes:
 *
 *   .update(patch).eq('id', id).select('id')      + verifyRowsLanded(res, …)
 *   .insert(row).select(selecting).single()       ← .single() errors on 0 rows
 *
 * Dropping the `.select()` read-back, or keeping it and never calling
 * verifyRowsLanded()/refusalOf(), fails here — which is the mutation this
 * ratchet exists to catch.
 *
 * SCOPE / LIMITATION
 * Analysis is per statement: the chain runs from `.from('<table>')` to the next
 * `;`. A builder stored in a variable and mutated later
 * (`let q = supabase.from(t); q = q.update(…)`) would not be attributed to that
 * table, so tests/write-verify.test.mjs also asserts a floor on how many chains
 * the real tree must yield — a refactor into that shape drops the count and
 * fails there instead of passing silently.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Tables whose only RLS policy is admin-gated, so a refusal is silent. */
export const PRIVILEGED_TABLES = Object.freeze([
  'licenses',
  'subscriptions',
  'activated_machines',
  'invoices',
  'clinic_activity_log',
  'workspaces',
  'workspace_members',
  'workspace_audit_log',
]);

/** Mutating PostgREST verbs. A chain without one is a read and is not audited. */
const WRITE_VERB_RE = /\.(update|insert|upsert|delete)\s*\(/;
/** `Prefer: return=representation` — asks PostgREST which rows it wrote. */
const READBACK_RE = /\.select\s*\(/;
/** Turns a 0-row read-back into an error on its own. */
const SINGLE_RE = /\.(single|maybeSingle)\s*\(/;
/** The src/lib/write-verify.mjs entry points that inspect the row count. */
const VERIFY_CALL_RE = /\b(verifyRowsLanded|refusalOf)\s*\(/;

/** Longest chain we will attempt to audit before calling it unauditable. */
const MAX_CHAIN = 1500;
/** How far past the `;` the row-count check may sit. */
const VERIFY_WINDOW = 700;

const SCAN_EXT = /\.(js|jsx|mjs)$/;
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * Blank out comments while preserving every offset and newline, so a documented
 * example (`@returns row ready for supabase.from('invoices').insert(…)`) is not
 * audited as a write. String and template states are tracked so a `//` inside a
 * URL literal is not mistaken for a comment start. Length is unchanged, which
 * keeps reported line numbers exact.
 */
export function blankComments(text) {
  const out = text.split('');
  let i = 0;
  let quote = null; // ', " or `
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < text.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function walk(dir, root, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, acc);
    else if (SCAN_EXT.test(entry.name)) acc.push(full.slice(root.length + 1));
  }
  return acc;
}

export function collectSourceFiles(root) {
  return walk(resolve(root, 'src'), root).sort();
}

/**
 * Audit `[{file, text}]` entries. Pure, so the mutation test can inject an
 * offender without touching the tree. Returns one record per privileged write
 * chain, each with `verified` plus the evidence that decided it.
 */
export function findWriteSites(entries, options = {}) {
  const tables = options.tables ?? PRIVILEGED_TABLES;
  const sites = [];

  for (const { file, text } of entries) {
    // Same length as `text`, so every index and line number still lines up.
    const code = blankComments(text);
    for (const table of tables) {
      const fromRe = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`, 'g');
      let match;
      while ((match = fromRe.exec(code)) !== null) {
        const start = match.index;
        const semi = code.indexOf(';', start);
        const reachable = semi !== -1 && semi - start <= MAX_CHAIN;
        const chainEnd = reachable ? semi + 1 : Math.min(code.length, start + MAX_CHAIN);
        const chain = code.slice(start, chainEnd);

        // A read (`.select()` only) is not a write, so it is out of scope here.
        if (reachable && !WRITE_VERB_RE.test(chain)) continue;

        const after = code.slice(chainEnd, chainEnd + VERIFY_WINDOW);
        // Stop at the next chain so a later statement's verify call cannot be
        // credited to this one.
        const nextChain = after.search(/\.from\(\s*['"]/);
        const scope = nextChain === -1 ? after : after.slice(0, nextChain);

        const readBack = READBACK_RE.test(chain);
        const selfVerifying = SINGLE_RE.test(chain);
        const verifyCall = VERIFY_CALL_RE.test(chain) || VERIFY_CALL_RE.test(scope);
        const verified = reachable && readBack && (selfVerifying || verifyCall);

        sites.push({
          file,
          line: lineOf(text, start),
          table,
          verified,
          readBack,
          selfVerifying,
          verifyCall,
          chain: flat(chain).slice(0, 150),
          reason: verified
            ? null
            : !reachable
              ? 'could not locate the end of the write chain — not auditable'
              : !readBack
                ? 'no .select() read-back: a silent RLS refusal returns { data: null, error: null }'
                : 'reads the rows back but never counts them — add verifyRowsLanded()/refusalOf()',
        });
      }
    }
  }

  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function main() {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..');
  const files = collectSourceFiles(root);
  const entries = files.map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') }));
  const sites = findWriteSites(entries);
  const bad = sites.filter((s) => !s.verified);

  console.log(`write-verify · §14 operator honesty · ${files.length} source files · ${sites.length} privileged write chains`);
  console.log(`  verified: ${sites.length - bad.length}/${sites.length}`);
  console.log(`  tables: ${PRIVILEGED_TABLES.join(', ')}`);

  if (!sites.length) {
    console.error('\nno privileged write chains found — the scan itself is broken (see tests/write-verify.test.mjs).');
    process.exit(1);
  }
  if (bad.length) {
    console.log('');
    for (const s of bad) console.log(`  ✗ ${s.file}:${s.line} [${s.table}] ${s.reason}\n      ${s.chain}`);
    console.error(`\n${bad.length} unverified write(s): "no error" is NOT proof the write landed.`);
    process.exit(1);
  }
  console.log('  ✓ every privileged write counts the rows it changed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
