#!/usr/bin/env node
// The repo invariant: everything this project AUTHORS is ASCII, because generated Kotlin, Swift and
// TypeScript identifiers come from authored strings, and because a diff with an invisible byte in it
// is a review hazard.
//
// This check exists because the invariant had no guard. docs/lessons.md carried 60 non-ASCII bytes
// (U+00B7 separators copied into a file that was itself written to look like a table) and nothing in
// the suite noticed until a new line copied the same separator. An invariant stated in HANDOFF.md and
// enforced nowhere is a preference.
//
// Third-party bytes are excluded, and the exclusion is asserted rather than trusted: fixtures/reference
// is immutable and legitimately carries em dashes, and fixtures/annotated's support.js, tokens.css,
// tokens.json and fonts/ are byte-for-byte copies of it (tests/annotated-fixture.test.mjs proves they
// are copies, which is the real requirement for a copy -- being edited to be ASCII would break it).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Directories that are not source: tooling state, build output, vendored bytes.
// .atl is a skill-registry file a gentle-pi extension writes for itself: not tracked (its own
// .gitignore ignores all of .atl), regenerated on every skill change, and it carries an em dash the
// generator chose. Sweeping it would make this check depend on a tool's output bytes.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', '.vendor', '.ir', '.baseline', '.codegraph', 'dist', '.atl']);

// Third-party files and trees: copied, not authored, and held to being copies instead.
const THIRD_PARTY = [
  'fixtures/reference',
  'fixtures/annotated/support.js',
  'fixtures/annotated/tokens.css',
  'fixtures/annotated/tokens.json',
  'fixtures/annotated/fonts',
];

const isThirdParty = (rel) => THIRD_PARTY.some((p) => rel === p || rel.startsWith(p + '/'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (SKIP_DIRS.has(name) && !rel.includes('/')) continue;
    let st = null;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walk(abs, out);
    else if (st.isFile() && !isThirdParty(rel)) out.push(rel);
  }
  return out;
}

const nonAscii = (buf) => {
  const bad = [];
  for (let i = 0; i < buf.length; i += 1) {
    const b = buf[i];
    if (b > 0x7e || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) bad.push({ i, byte: b });
  }
  return bad;
};

test('every file this project authors is ASCII', () => {
  const files = walk(ROOT);
  // Non-vacuous: the walk has to actually see the source it claims to cover.
  for (const must of ['tools/capture.mjs', 'docs/lessons.md', 'README.md', 'spec/02-ir.md', 'odd/tasks/design-compiler.md']) {
    assert.ok(files.includes(must), `the sweep never looked at ${must}`);
  }
  assert.ok(files.length > 40, `the sweep saw only ${files.length} files`);

  const offenders = [];
  for (const rel of files) {
    const bad = nonAscii(readFileSync(join(ROOT, rel)));
    if (bad.length) offenders.push(`${rel}: ${bad.length} byte(s), first U+${bad[0].byte.toString(16).toUpperCase()} at offset ${bad[0].i}`);
  }
  assert.deepEqual(offenders, [], `invariant: authored artifacts are ASCII only\n${offenders.join('\n')}`);
});

test('the third-party exclusion really is third-party, and the sweep is not quietly empty', () => {
  for (const p of THIRD_PARTY) {
    assert.ok(statSync(join(ROOT, p)), `${p} is on the exclusion list but does not exist`);
  }
  // fixtures/reference must stay immutable: if it ever becomes ASCII-clean, this exclusion is doing
  // nothing and someone has edited the reference export.
  const ref = readFileSync(join(ROOT, 'fixtures', 'reference', 'SCREENS.md'));
  assert.ok(nonAscii(ref).length > 0, 'the reference export is expected to carry non-ASCII, which is why it is excluded');
  // And the exclusion list must not have swallowed a real source directory.
  assert.ok(!THIRD_PARTY.includes('tools'), 'tools is authored here and must be swept');
});
