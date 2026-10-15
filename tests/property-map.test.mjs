#!/usr/bin/env node
// T2.5 suite for the bridge's property-ownership checker. The tool's product is a verdict about which
// CSS properties a target owns, so what is asserted here is that verdict and the harvest underneath
// it: coverage, evidence that really verifies, the severity classes, and the repair report.
//
//   node --test 'tests/*.test.mjs'
//
// Two things this suite is deliberate about:
//   - fixtures/reference is immutable input. Nothing here writes into fixtures/, and the one test that
//     proves that provokes the refusal instead of working around it.
//   - every guard is shown to bite. The seeded-defect tests edit a COPY of the table in a temp dir,
//     never the committed one, and assert the copy fails. A checker that has never failed is a checker
//     that has never been shown to pass (spec/07).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const TOOL = 'tools/property-map.mjs';

// Run the tool, capturing stdout/stderr and the exit code instead of letting a non-zero exit throw:
// most of what is under test IS the exit code.
function run(args, opts = {}) {
  try {
    const out = execFileSync('node', [TOOL, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? -1, out: e.stdout || '', err: e.stderr || '' };
  }
}
const json = (args) => JSON.parse(run(args).out);

const TMP = mkdtempSync(join(tmpdir(), 'propmap-'));
const tmpTable = (name, mutate) => {
  const table = JSON.parse(readFileSync(join(ROOT, 'rules/property-ownership.json'), 'utf8'));
  mutate(table);
  const p = join(TMP, name);
  writeFileSync(p, JSON.stringify(table, null, 2));
  return p;
};

// ---- the committed table is the regression lock ----

test('the reference table is clean and exits 0', () => {
  const r = run([]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /findings: 0/);
});

test('summary numbers come from the fixture, and are stable across runs', () => {
  const a = json(['--json']);
  const b = json(['--json']);
  assert.deepEqual(a.summary, b.summary, 'two runs must agree byte-for-byte on the summary');
  assert.equal(a.summary.properties_harvested, 53);
  assert.equal(a.summary.declarations, 887);
  assert.equal(a.summary.templates, 5);
  assert.equal(a.summary.findings, 0);
  // The measured gap. If this number moves, a spec grew a mapping row or the export changed: either
  // way the change belongs in the lesson log, not in a silent edit here.
  assert.equal(a.summary.unmapped, 16);
  assert.equal(a.summary.unmapped_declarations, 53);
  assert.deepEqual(a.summary.unmapped_by_disposition, {
    structural: 6,
    decorative: 4,
    'declared-alternative': 3,
    'ignored-or-gate': 2,
    'unknown-severity': 1,
  });
});

test('the old hand-written gap claim was wrong, and the tool says so', () => {
  // odd/tasks said "18 of 50". Measured with the canonical harvest it is 16 unmapped of 53 declared,
  // because two of those 18 were `-webkit-*` a naive property regex dropped and two more were
  // shorthands capture expands. Pinned so the corrected numbers cannot quietly drift back.
  const s = json(['--json']).summary;
  assert.equal(s.properties_harvested, 53, 'a prefix-less property regex loses -webkit-* rows');
  assert.equal(s.unmapped, 16);
});

// ---- the harvest: three bugs this canonical reader exists to prevent ----

test('a {{ }} hole inside a value does not truncate the declaration', async () => {
  // tools/css-harvest.mjs is a module, not a script: importing it runs nothing.
  const { declarations } = await import(join(ROOT, 'tools/css-harvest.mjs'));
  const got = declarations('flex: 1; overflow-y: {{ bodyScroll }}; scrollbar-width: thin', 'attr');
  assert.deepEqual(got.map((d) => d.prop), ['flex', 'overflow-y', 'scrollbar-width'],
    'a value pattern that stops at the hole brace silently loses every overflow-y in the export');
  assert.equal(got[1].value, '{{ }}', 'the hole stays opaque: never expanded, never guessed');
});

test('a selector is never read as a declaration', async () => {
  const { declarations } = await import(join(ROOT, 'tools/css-harvest.mjs'));
  const got = declarations('body{margin:0}a{color:var(--x)}a:hover{color:var(--y)}', 'block');
  // Three declarations, not four: body sets margin, a sets color, a:hover sets color. The fourth
  // candidate -- a property called `a` from the `a:hover` selector -- must not appear.
  assert.deepEqual(got.map((d) => d.prop).sort(), ['color', 'color', 'margin'], 'the `a:hover` selector must not create a property named `a`');
  assert.ok(!got.some((d) => d.prop === 'a' || d.prop === 'a:hover'));
});

test('overflow-y and the vendor prefixes are present in the reference harvest', () => {
  const gap = json(['--json']).gap.map((r) => r.prop);
  const table = JSON.parse(readFileSync(join(ROOT, 'rules/property-ownership.json'), 'utf8')).properties;
  const names = table.map((r) => r.prop);
  assert.ok(names.includes('overflow-y'), 'the property spec/03 uses to decide a scroll container');
  assert.ok(names.includes('-webkit-line-clamp'), 'the source of maxLines; dropped by a prefix-less regex');
  assert.ok(!names.includes('a'), 'the board stylesheet selector `a{color:...}` is not a CSS property');
  assert.ok(!gap.includes('overflow-y'), 'and it is owned, not a gap');
});

// ---- coverage: every declared property has one owner ----

test('dropping a row is a finding, and names whether any spec owns the property', () => {
  const t = tmpTable('drop.json', (d) => {
    d.properties = d.properties.filter((r) => r.prop !== 'box-sizing');
  });
  const r = run(['--table-file', t, '--json']);
  assert.equal(r.code, 1);
  const f = JSON.parse(r.out).findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'unowned');
  assert.equal(f[0].prop, 'box-sizing');
  assert.match(f[0].message, /no mapping spec names it either/, 'box-sizing is genuinely unnamed in every mapping spec');
});

test('--relocate applies a move the checker could prove, and refuses one it could not', () => {
  // Two stale citations with different shapes: `width` lives on exactly one spec/04 row, so the move
  // is mechanical. `gap` is named by two spec/03 rows (the resolution rule and the reduction rule),
  // so choosing between them is a decision and the tool must not make it.
  const t = tmpTable('reloc.json', (d) => {
    d.properties.find((r) => r.prop === 'width').evidence = ['spec/04-mapping-compose.md:999'];
    d.properties.find((r) => r.prop === 'gap').evidence = ['spec/03-extraction.md:999', 'spec/04-mapping-compose.md:19', 'spec/05-mapping-react-native.md:16'];
  });
  const before = run(['--table-file', t]);
  assert.equal(before.code, 1);
  assert.match(before.out, /width: evidence "spec\/04-mapping-compose\.md:999" is stale; the only row/);
  assert.match(before.out, /gap: evidence "spec\/03-extraction\.md:999" is stale and spec\/03-extraction\.md has 2 rows naming gap/);
  assert.equal(run(['--table-file', t, '--relocate']).code, 1, 'the ambiguous one keeps the run red');
  const after = run(['--table-file', t, '--json']);
  const j = JSON.parse(after.out);
  assert.ok(!j.findings.some((f) => f.prop === 'width'), 'the provable move was applied');
  assert.ok(j.findings.some((f) => f.prop === 'gap' && /decision, not a move/.test(f.message)), 'the ambiguous one is still reported');
});

test('an unmapped row with an undeclared disposition is bad data, not a finding', () => {
  const t = tmpTable('baddisp.json', (d) => {
    d.properties.find((r) => r.prop === 'box-sizing').disposition = 'we-will-get-to-it';
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 2, 'a disposition the table never defined is malformed data');
  assert.match(r.err, /box-sizing is unmapped with disposition "we-will-get-to-it"/);
});

test('a row nobody can point at is refused before the check runs', () => {
  const t = tmpTable('noev.json', (d) => {
    d.properties.find((r) => r.prop === 'box-sizing').owner = 'mapped';
    d.properties.find((r) => r.prop === 'box-sizing').evidence = [];
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 2);
  assert.match(r.err, /box-sizing is mapped with no evidence/);
});

// ---- evidence: an owner must be pointable at, on the line claimed ----

test('a citation to a line that does not name the property fails', () => {
  const t = tmpTable('badev.json', (d) => {
    d.properties.find((r) => r.prop === 'width').evidence = ['spec/03-extraction.md:16'];
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 1);
  assert.match(
    r.out,
    /evidence\s+width: evidence "spec\/03-extraction\.md:16" is not a table or list row carrying code spans, and spec\/03-extraction\.md has no row naming width/,
    'the message has to say the file never names the property, not just that the line is wrong',
  );
});

test('a citation to a prose line is not evidence, and the real row is named', () => {
  const t = tmpTable('proseev.json', (d) => {
    // spec/04's box-model discussion mentions `width` in a code span from a paragraph. A paragraph
    // states reasoning; a table row makes a decision. Citing the paragraph must not earn coverage.
    d.properties.find((r) => r.prop === 'width').evidence = ['spec/04-mapping-compose.md:121'];
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 1);
  assert.match(r.out, /is stale; the only row in spec\/04-mapping-compose\.md that names width is now line 26/);
});

test('a citation to a row that once existed reports where it moved to', () => {
  // This is the everyday case, and the reason the citations are machine-checked: editing any spec
  // above a mapping row shifts every line number that points into it. Editing spec/03's Capture
  // section during T2.5 broke 20 citations exactly like this, and --relocate fixed them.
  const t = tmpTable('movedev.json', (d) => {
    d.properties.find((r) => r.prop === 'line-height').evidence = ['spec/03-extraction.md:58'];
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 1);
  assert.match(r.out, /is stale; the only row in spec\/03-extraction\.md that names line-height is now line \d+/);
});

test('evidence outside mapping_specs does not count, so no stray doc can own a property', () => {
  // min-width's only owner is spec/04:27. Drop that spec from the consulted list and the row loses its
  // owner: a citation to a file the table does not consult must never read as coverage, or any
  // markdown that mentions a token could claim to map it.
  const t = tmpTable('outsidev.json', (d) => {
    d.mapping_specs = d.mapping_specs.filter((s) => !s.includes('04-mapping'));
  });
  const r = run(['--table-file', t, '--json']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.ok(j.findings.some((f) => f.kind === 'evidence' && f.prop === 'min-width'), 'the stale citation must be reported');
  assert.match(JSON.stringify(j.findings), /is not a mapping spec this table consults/);
});

test('a wildcard claim only counts when the property really fits the family', () => {
  // The cited line is taken from the committed table rather than hardcoded, because every spec edit
  // shifts it and this test is about the wildcard mechanism, not about a line number.
  const committed = JSON.parse(readFileSync(join(ROOT, 'rules/property-ownership.json'), 'utf8'));
  const spacingRow = committed.properties.find((r) => r.prop === 'margin-top').evidence[0];
  const good = tmpTable('wildgood.json', (d) => {
    const row = d.properties.find((r) => r.prop === 'margin-top');
    row.evidence = [spacingRow];
    row.wildcard = 'margin-*';
  });
  assert.equal(run(['--table-file', good]).code, 0, 'the Spacing row owns the margin-* family, so the claim is honest');
  const bad = tmpTable('wildbad.json', (d) => {
    const row = d.properties.find((r) => r.prop === 'margin-top');
    row.evidence = [spacingRow];
    row.wildcard = 'padding-*';
  });
  const r = run(['--table-file', bad]);
  assert.equal(r.code, 1, 'claiming the wrong family is exactly as wrong as claiming a row that never mentions it');
  assert.match(r.out, /nor the claimed family `padding-\*`/);
});

test('a mapped shorthand has to name longhands that exist as rows', () => {
  const t = tmpTable('badlh.json', (d) => {
    d.properties.find((r) => r.prop === 'font').longhands = ['font-weight', 'font-telepathy'];
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 2);
  assert.match(r.err, /names longhand font-telepathy, which has no row/);
});

// ---- the counts drift when the export or the table changes ----

test('count drift on the measured fixture is a finding', () => {
  const t = tmpTable('drift.json', (d) => {
    d.properties.find((r) => r.prop === 'box-sizing').count = 99;
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 1);
  assert.match(r.out, /count-drift\s+box-sizing is recorded as 99, the fixture says 7/);
});

test('value-shape drift on an unmapped row is a finding', () => {
  const t = tmpTable('vd.json', (d) => {
    d.properties.find((r) => r.prop === 'box-sizing').values = { 'content-box': 7 };
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 1);
  assert.match(r.out, /value-drift\s+box-sizing value shapes drift/);
});

test('checking a different export reports coverage without false drift', () => {
  // The T4 loop points this tool at a FRESH export. Counts were measured on fixtures/reference, so
  // they cannot match anywhere else, and claiming they did would bury the real finding.
  const r = run(['--fixture', 'fixtures/synthetic/dirty', '--json']);
  assert.equal(r.code, 1, 'the dirty fixture really does declare properties no row owns');
  const j = JSON.parse(r.out);
  assert.equal(j.summary.counts_comparable, false);
  assert.equal(j.summary.counts_measured_on, 'fixtures/reference');
  assert.ok(j.findings.length && j.findings.every((f) => f.kind === 'unowned'), 'only coverage findings, never phantom drift');
});

// ---- malformed input, matching the rest of the repo ----

test('exit 2 for a bad invocation, 4 for an unreadable input', () => {
  assert.equal(run(['--json', '--repair']).code, 2, 'two modes at once');
  assert.equal(run(['--out', 'x']).code, 2, '--out only belongs to --repair');
  assert.equal(run(['--surprise']).code, 2, 'an unexpected positional argument');
  assert.match(run(['--json', '--repair']).err, /different modes; pick one/);
  const unknown = run(['--tabel', 'x']); // a typo must not be silently accepted
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown argument "--tabel"/);
  assert.equal((unknown.err.match(/usage: node tools\/property-map\.mjs/g) || []).length, 1, 'the usage line appears once');
  assert.equal(run(['--table-file', 'rules/nope.json']).code, 4, 'a missing table is bad input');
  assert.equal(run(['--fixture', 'fixtures/nope']).code, 4, 'a missing fixture is bad input');
});

test('the table is rejected when it is not the shape this tool reads', () => {
  const p = join(TMP, 'malformed.json');
  writeFileSync(p, '{ not json');
  assert.equal(run(['--table-file', p]).code, 2);
  writeFileSync(p, JSON.stringify({ schema: 'property-ownership/2', fixture: 'fixtures/reference', mapping_specs: ['spec/02-ir.md'], dispositions: { a: 'b' }, properties: [] }));
  const r = run(['--table-file', p]);
  assert.equal(r.code, 2);
  assert.match(r.err, /expected "property-ownership\/1"/);
});

test('--repair refuses to write inside fixtures/', () => {
  const r = run(['--repair', '--out', 'fixtures/reference/repair.md']);
  assert.equal(r.code, 2);
  assert.match(r.err, /inputs are immutable/);
});

// ---- the repair report: what goes back to the source tool ----

test('the repair report lists exactly the gap, with a ask per property', () => {
  const r = run(['--repair']);
  assert.equal(r.code, 0);
  const gap = json(['--json']).gap.map((g) => g.prop).sort();
  for (const p of gap) assert.match(r.out, new RegExp(`- \\\`${p}\\\`, \\d+x`), `${p} is in the gap and must appear`);
  assert.equal((r.out.match(/- `[a-z-]+`, \d+x/g) || []).length, gap.length, 'no extra property and none missing');
  assert.equal((r.out.match(/please: /g) || []).length, gap.length, 'every listed property carries something to ask for');
  // The class distinction is the point: an expanded shorthand is NOT a gap, and must not be sent back
  // to the design tool as if the author had done something wrong.
  for (const expanded of ['background', 'font', 'flex'])
    assert.ok(!new RegExp(`- \\\`${expanded}\\\`, \\d+x`).test(r.out), `${expanded} is expanded by capture, not a repair request`);
});

test('the repair report is deterministic, ASCII, and carries no local paths', () => {
  const a = run(['--repair']).out;
  const b = run(['--repair']).out;
  assert.equal(a, b);
  assert.ok(!/[^\x09\x0a\x20-\x7e]/.test(a), `non-ASCII: ${/^\S*[^\x09\x0a\x20-\x7e]\S*/m.exec(a)?.[0]}`);
  assert.ok(!a.includes('/Users/'), 'a report pasted into a design tool must not leak a local path');
  assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(a), 'no date: a dated report is not reproducible');
  assert.match(a, /Generated by `node tools\/property-map\.mjs --repair`/);
});

test('--out writes the same bytes as stdout', () => {
  const p = join(TMP, 'repair.md');
  const r = run(['--repair', '--out', p]);
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(p, 'utf8'), r.out);
});

// ---- table hygiene: the file a human reads ----

test('every unmapped row explains itself and asks for something', () => {
  const table = JSON.parse(readFileSync(join(ROOT, 'rules/property-ownership.json'), 'utf8'));
  for (const r of table.properties.filter((p) => p.owner === 'unmapped')) {
    assert.ok(r.note && r.note.length > 30, `${r.prop} needs a note a stranger can act on`);
    assert.ok(r.fix && r.fix.length > 30, `${r.prop} needs a concrete ask, not "TODO"`);
    assert.ok(!/TODO/i.test(r.note + r.fix), `${r.prop} still carries a TODO`);
  }
});

test('the file is one property per line, so the decisions are scannable', () => {
  const raw = readFileSync(join(ROOT, 'rules/property-ownership.json'), 'utf8');
  const table = JSON.parse(raw);
  assert.ok(raw.split('\n').length < table.properties.length + 60,
    'indenting 76 data rows buries the 16 that carry a decision');
});

test('a shorthand classified as expanded explains what the browser does to it', () => {
  const table = JSON.parse(readFileSync(join(ROOT, 'rules/property-ownership.json'), 'utf8'));
  const expanded = table.properties.filter((r) => r.owner === 'expanded');
  assert.deepEqual(expanded.map((r) => r.prop).sort(), ['background', 'flex', 'font']);
  for (const r of expanded) {
    assert.match(r.note, /measured/, `${r.prop}: whether a shorthand resets a longhand is a browser fact, so it is cited as measured`);
    assert.ok(r.longhands.length >= 2);
    assert.deepEqual(r.evidence, undefined, 'expanded rows own nothing, so they cite nothing');
  }
});

test('an unknown\'s severity is data, in spec/02\'s vocabulary, never a judgment at emission time', () => {
  const table = JSON.parse(readFileSync(join(ROOT, 'rules/property-ownership.json'), 'utf8'));
  for (const [name, d] of Object.entries(table.dispositions)) {
    assert.ok(['error', 'warn', 'info'].includes(d.severity), `${name} must use spec/02's severity words`);
    assert.ok(d.why && d.why.length > 20, `${name} must say why it costs what it costs`);
  }
  // The severity tally is what the bridge spec cites. If a disposition is reclassified, the spec text
  // and this number move together or the test says so.
  const s = json(['--json']).summary.unmapped_by_severity;
  assert.equal(s.error, 9, 'structural and declared-alternative stop the node');
  assert.equal(s.warn, 5, 'unknown-severity and decorative emit with a comment');
  assert.equal(s.info, 2, 'ignored-or-gate reports and emits nothing');
  assert.equal(s.error + s.warn + s.info, 16);
});

test('a disposition with a severity the IR cannot express is bad data', () => {
  const t = tmpTable('badsev.json', (d) => {
    d.dispositions.structural = { severity: 'fatal', why: d.dispositions.structural.why };
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 2);
  assert.match(r.err, /disposition structural has severity "fatal", expected one of error, warn, info/);
});

test('spec/13 may never be a mapping spec: describing ownership is not granting it', () => {
  const t = tmpTable('selfown.json', (d) => {
    d.mapping_specs = [...d.mapping_specs, 'spec/13-bridge.md'];
  });
  const r = run(['--table-file', t]);
  assert.equal(r.code, 2, 'the bridge spec discusses every property; citing it would let the gap own itself');
  assert.match(r.err, /the gap own itself/);
});

test('the repair report tells the reader what each unknown will cost downstream', () => {
  const out = run(['--repair']).out;
  assert.equal((out.match(/this reaches the target as `(error|warn|info)`/g) || []).length, 16);
});

process.on('exit', () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});
