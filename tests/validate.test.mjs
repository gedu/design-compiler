#!/usr/bin/env node
// T2 suite for the contract validator. The tool's product is a report, so what is asserted here is
// the report: codes fired, severities from the rule table, exit codes, byte-identical determinism.
//
//   node --test 'tests/*.test.mjs'
//
// fixtures/reference is immutable input and is never written to; the temporary fixtures below build
// a broken export in a throwaway directory so exit 4 and the refusal path can be provoked without
// touching a committed fixture.
//
// Why 'tests/*.test.mjs' and not 'tests/': node 24.18 treats a bare directory argument as a module
// to load (Cannot find module .../tests) instead of discovering the test files inside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'validate.mjs');
// Fixture paths are passed to the tool as relative paths, the way a human at a terminal types them:
// run.input echoes the argument as given, so a relative call is what proves no absolute path reaches
// the report. Filesystem work below uses the joined absolute path.
const CLEAN = 'fixtures/synthetic/clean';
const DIRTY = 'fixtures/synthetic/dirty';
const REFERENCE = 'fixtures/reference';
const CLEAN_DIR = join(ROOT, CLEAN);
const BASELINE = join(ROOT, 'baselines', 'reference.json');

const rules = JSON.parse(readFileSync(join(ROOT, 'rules', 'contract-rules.json'), 'utf8'));
const CODES = [
  'absolute-layout', 'animation-required', 'brief-missing', 'callback-inferred', 'clip-missing',
  'color-alpha-of-role', 'color-literal', 'component-name-invalid', 'css-external',
  'dark-only-via-js', 'frame-width-unknown', 'grid-min-undeclared', 'icon-font', 'icon-unnamed',
  'js-dependent-paint', 'lorem-ipsum', 'manifest-incomplete', 'prop-undeclared', 'pseudo-content',
  'remote-resource', 'tokens-incomplete-scheme', 'tokens-missing', 'viewport-units',
  'webfont-remote',
];
const UNIMPLEMENTED = [
  'component-unlabeled', 'elevation-missing', 'reflow-detected', 'scroll-undeclared',
  'state-variation-unstable', 'style-off-scale',
];

function run(args, opts = {}) {
  const proc = spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8', ...opts });
  const outPath = args[args.indexOf('--out') + 1];
  return {
    ...proc,
    out: args.includes('--out') ? (exists(outPath) ? readFileSync(outPath, 'utf8') : null) : null,
  };
}
const exists = (p) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
};
const json = (r) => JSON.parse(r.stdout);
const dir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

// A copy of the clean export, so a test can break one thing at a time and still prove the other 23
// checks declined to fire.
function cleanCopy() {
  const d = join(dir('dc-clean-'), 'clean');
  mkdirSync(d, { recursive: true });
  cpSync(CLEAN_DIR, d, { recursive: true });
  return d;
}

const tally = (report) => Object.fromEntries(report.checks.map((c) => [c.code, c.findings]));
const nonAscii = (s) => s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /[^\x00-\x7F]/.test(l));
// One line on stderr is the contract for every failure path: a stack trace would let a human guess
// which of the two problems they have.
function assertOneLineFailure(r, status) {
  assert.equal(r.status, status, `expected exit ${status}, got ${r.status}: ${r.stderr}`);
  assert.equal(r.stderr.trim().split('\n').length, 1, `stderr was not one line: ${r.stderr}`);
  assert.equal(r.stdout, '', `output was written despite the failure: ${r.stdout}`);
  assert.equal(r.out, null, '--out file was written despite the failure');
}

// ---- the clean case: the one thing that makes the other 23 checks mean something ----

test('the clean fixture exits 0 with zero findings of any severity', () => {
  const r = run([CLEAN, '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rep = json(r);
  assert.deepEqual(rep.summary, { errors: 0, warnings: 0, infos: 0, checked: 24, unimplemented: 6 });
  assert.deepEqual(rep.diagnostics, [], 'a clean export must produce no diagnostics at all');
});

test('the clean fixture says so in the human format too', () => {
  const r = run([CLEAN]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'validate OK: 24 checks | errors 0 | warnings 0 | infos 0 | unimplemented 6\n');
});

// ---- one positive case per check, table-driven ----

// Codes whose severity may sit BELOW the rule row, with the reason. Going down is allowed because a
// row states what a proven violation costs and static evidence sometimes falls short of proof; going
// up or sideways would be the tool inventing a severity the table never stated, which is what the
// loop below forbids for every other code.
const SEVERITY_EXCEPTIONS = {
  // js-dependent-paint's row is error because the materializer's two renders would prove the frame
  // cannot paint; an unresolved placeholder cannot prove that.
  'js-dependent-paint': 'info',
  // animation-required splits: a state gate keeps the row's error, decorative motion is info.
  'animation-required': ['error', 'info'],
};

test('every one of the 24 checks fires on the dirty fixture with its table severity', () => {
  const r = run([DIRTY, '--json']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const rep = json(r);
  const counts = tally(rep);
  assert.equal(rep.checks.length, 24);
  const RANK = { error: 0, warn: 1, info: 2 };
  for (const code of CODES) {
    assert.ok(counts[code] >= 1, `check ${code} did not fire on the dirty fixture`);
    // Severity comes from the rule row, so the report must agree with the table, not with a literal.
    const row = rules.find((x) => x.code === code && x.owner === 'author') || rules.find((x) => x.code === code);
    const allowed = SEVERITY_EXCEPTIONS[code];
    for (const d of rep.diagnostics.filter((x) => x.code === code)) {
      if (allowed)
        assert.ok(
          (Array.isArray(allowed) ? allowed : [allowed]).includes(d.severity),
          `${code} severity ${d.severity} is not in the declared exception set`
        );
      else assert.equal(d.severity, row.severity, `${code} severity does not match rule ${row.id}`);
      // Even an exception may only ever sit at or below the row, never above it.
      assert.ok(RANK[d.severity] >= RANK[row.severity], `${code} reported above its row's severity`);
      assert.equal(typeof d.fix, 'string');
      assert.ok(d.fix.length > 0, `${code} has no fix text`);
      assert.ok(d.file && !d.file.startsWith('/'), `${code} reported a path outside the input dir`);
      assert.ok(d.line >= 1, `${code} reported no line`);
      assert.ok(/ #\d+$/.test(d.node), `${code} node is not a stable description: ${d.node}`);
    }
  }
});

// The two sub-case splits, asserted on their own so a future change that merges them is visible.
test('animation-required keeps the row severity for a state gate and drops to info for decoration', () => {
  const hits = json(run([DIRTY, '--json'])).diagnostics.filter((d) => d.code === 'animation-required');
  const gate = hits.filter((d) => d.severity === 'error').map((d) => d.message);
  const decor = hits.filter((d) => d.severity === 'info').map((d) => d.message);
  assert.ok(gate.some((m) => /style-hover attribute paints a state/.test(m)), JSON.stringify(gate));
  assert.ok(gate.some((m) => /^animation:/.test(m)), 'animation: must keep the row severity');
  assert.ok(decor.some((m) => /^transition:/.test(m) && /decorative motion that gates no state/.test(m)), JSON.stringify(decor));
  assert.ok(decor.some((m) => /^@keyframes/.test(m) && /decorative motion that gates no state/.test(m)), JSON.stringify(decor));
  assert.ok(!gate.some((m) => /^transition:|^@keyframes/.test(m)), 'a decorative signal was reported as an error');
});

test('css-external never reports the token file, and the same URL still reaches the other two codes', () => {
  const rep = json(run([REFERENCE, '--json']));
  const css = rep.diagnostics.filter((d) => d.code === 'css-external');
  assert.equal(css.length, 10, `expected only the remote font links, got ${css.length}`);
  assert.ok(!css.some((d) => /tokens\.css/.test(d.message)), 'the token file was reported as external CSS');
  // One remote URL, three codes, three fixes: all three must still be present or CI loses a fix.
  const url = 'https://fonts.googleapis.com/css2?family=Roboto';
  for (const code of ['css-external', 'remote-resource', 'webfont-remote'])
    assert.ok(
      rep.diagnostics.some((d) => d.code === code && d.message.includes(url)),
      `${code} no longer reports the Roboto font URL`
    );
});

test('js-dependent-paint reports one diagnostic per placeholder name, not per occurrence', () => {
  const rep = json(run([REFERENCE, '--json']));
  const hits = rep.diagnostics.filter((d) => d.code === 'js-dependent-paint');
  assert.equal(hits.length, 191, `expected 191 distinct placeholders, got ${hits.length}`);
  const keys = hits.map((d) => d.file + '\u0000' + d.node);
  assert.equal(new Set(keys).size, keys.length, 'a (file, placeholder) pair was emitted twice');
  // Counted from the source rather than remembered: the reference export carries 256 placeholder
  // occurrences outside script blocks, so 191 lines can only mean the dedupe ran.
  const perFile = { 'Mini Jetcaster.dc.html': 54, 'Home.dc.html': 80, 'PodcastCard.dc.html': 23, 'EpisodeRow.dc.html': 19, 'NowPlayingBar.dc.html': 15 };
  let occurrences = 0;
  for (const [name, distinct] of Object.entries(perFile)) {
    const text = readFileSync(join(ROOT, REFERENCE, name), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
    const all = (text.match(/\{\{[\s\S]*?\}\}/g) || []).length;
    occurrences += all;
    const reported = hits.filter((d) => d.file === name).length;
    assert.equal(reported, distinct, `${name}: reported ${reported}, source holds ${distinct} distinct names in ${all} occurrences`);
    assert.ok(all > distinct, `${name} has no repeated placeholder, so this file proves nothing`);
  }
  assert.equal(occurrences, 256, 'the reference export changed shape; recount the expected numbers');
});

test('prop-undeclared fires only on repeated literal copy, and never on a glyph name', () => {
  // The dirty fixture has an unmarked literal inside an <sc-for>: that is the case the rule means.
  const dirty = json(run([DIRTY, '--json'])).diagnostics.filter((d) => d.code === 'prop-undeclared');
  assert.equal(dirty.length, 1, JSON.stringify(dirty));
  assert.match(dirty[0].message, /Subscribed/);
  assert.match(dirty[0].message, /repeats with the instance/);
  // The reference export has one such candidate and it is a glyph name, so the honest count is zero
  // -- which is exactly what spec/07 says about this code (see the cross-check exemption below).
  const ref = json(run([REFERENCE, '--json'])).diagnostics.filter((d) => d.code === 'prop-undeclared');
  assert.deepEqual(ref, [], `prop-undeclared fired on ${ref.length} findings, glyph names included`);
});

test('the dirty fixture reports each code with the rule row that explains it', () => {
  const rep = json(run([DIRTY, '--json']));
  const ruleOf = (code) => [...new Set(rep.diagnostics.filter((d) => d.code === code).map((d) => d.rule))];
  // Codes with several rows are where naming the row matters: the fix text differs per row, and the
  // dirty fixture has a token file (so it is the missing-maps row that speaks, not the absent-file one).
  assert.deepEqual(ruleOf('tokens-missing'), ['token-file-type-scale']);
  assert.deepEqual(ruleOf('color-alpha-of-role').sort(), [
    'no-alpha-of-role-or-color-mix',
    'no-gradient-background',
  ]);
  for (const code of CODES)
    for (const id of ruleOf(code)) assert.ok(rules.some((r) => r.id === id), `${code} cites an unknown rule`);
});

// ---- determinism ----

test('--json is byte-identical across two runs, in every mode', () => {
  for (const target of [CLEAN, DIRTY, REFERENCE]) {
    const a = run([target, '--json']);
    const b = run([target, '--json']);
    assert.equal(a.stdout, b.stdout, `${target} json differs between runs`);
    const h1 = run([target]);
    const h2 = run([target]);
    assert.equal(h1.stdout, h2.stdout, `${target} human output differs between runs`);
  }
});

test('diagnostics are sorted by severity, code, file, line, node, rule, never insertion order', () => {
  const rep = json(run([DIRTY, '--json']));
  const rank = { error: 0, warn: 1, info: 2 };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const keys = rep.diagnostics.map((d) => [rank[d.severity], d.code, d.file, d.line, d.node, d.rule]);
  const sorted = [...keys].sort(
    (a, b) => a[0] - b[0] || cmp(a[1], b[1]) || cmp(a[2], b[2]) || a[3] - b[3] || cmp(a[4], b[4]) || cmp(a[5], b[5])
  );
  assert.deepEqual(keys, sorted, 'diagnostics are not in the declared sort order');
  assert.ok(
    rep.diagnostics.some((d, i) => i > 0 && rank[rep.diagnostics[i - 1].severity] < rank[d.severity]),
    'the dirty fixture never mixes severities, so the severity sort proves nothing'
  );
  // checks and unimplemented are code-sorted, not written in table order.
  assert.deepEqual(rep.checks.map((c) => c.code), [...CODES].sort());
  assert.deepEqual(rep.unimplemented.map((u) => u.code), [...UNIMPLEMENTED].sort());
});

test('--out holds the same bytes as stdout, in both modes', () => {
  for (const extra of [['--json'], []]) {
    const out = join(dir('dc-out-'), 'report.json');
    const r = run([DIRTY, ...extra, '--out', out]);
    assert.equal(r.out, r.stdout, '--out bytes differ from stdout');
  }
});

test('the report carries the declared keys in the declared order and nothing else', () => {
  const rep = json(run([DIRTY, '--json']));
  assert.deepEqual(Object.keys(rep), ['run', 'summary', 'diagnostics', 'unimplemented', 'checks']);
  assert.deepEqual(Object.keys(rep.run), ['input', 'rules', 'contract']);
  assert.deepEqual(Object.keys(rep.summary), ['errors', 'warnings', 'infos', 'checked', 'unimplemented']);
  assert.deepEqual(Object.keys(rep.diagnostics[0]), [
    'code', 'severity', 'rule', 'file', 'line', 'node', 'message', 'fix',
  ]);
  assert.deepEqual(Object.keys(rep.checks[0]), ['code', 'implemented', 'findings']);
  assert.deepEqual(rep.run, { input: DIRTY, rules: 'contract-rules.json', contract: 'contract-rules/1' });
});

test('the report carries no timestamp, no duration and no absolute path', () => {
  // A CSS custom property name quoted inside a message may contain the word "duration"; what may not
  // exist is a timing or path field. Keys are what a consumer reads, so keys are what is asserted.
  for (const rel of [CLEAN, DIRTY, REFERENCE]) {
    const text = run([rel, '--json']).stdout;
    assert.doesNotMatch(text, /20\d\d-\d\d-\d\d/, 'a date reached the report');
    assert.doesNotMatch(
      text,
      /"[a-z]*(?:duration|elapsed|timestamp|started|finished|took|mtime)[a-z]*"\s*:/i,
      'a timing field reached the report'
    );
    assert.ok(!text.includes(ROOT), 'an absolute path reached the report');
    for (const d of json(run([rel, '--json'])).diagnostics) {
      assert.ok(!d.file.startsWith('/'), d.file);
      assert.ok(!d.file.startsWith('.'), `path not relative to the input dir: ${d.file}`);
    }
  }
});

// ---- exit codes ----

test('missing argument, missing directory and a non-directory exit 2', () => {
  assertOneLineFailure(run([]), 2);
  assertOneLineFailure(run(['fixtures/nope']), 2);
  assertOneLineFailure(run(['tools/validate.mjs']), 2); // a file, not a directory
});

test('malformed rules JSON is a config error, exit 2', () => {
  const p = join(dir('dc-rules-'), 'rules.json');
  writeFileSync(p, '{ this is not json');
  assertOneLineFailure(run([DIRTY, '--rules', p]), 2);
});

test('a rules row that is not an array is a config error, exit 2', () => {
  const p = join(dir('dc-rules2-'), 'rules.json');
  writeFileSync(p, JSON.stringify({ hello: 'world' }));
  assertOneLineFailure(run([DIRTY, '--rules', p]), 2);
});

test('a check code with no rule row is a defect in the table, exit 2', () => {
  const d = dir('dc-norow-');
  const p = join(d, 'rules.json');
  writeFileSync(p, JSON.stringify(rules.filter((r) => r.code !== 'icon-font')));
  const r = run([DIRTY, '--rules', p]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /icon-font/);
});

test('an unparsable template is bad input, exit 4, and names the file', () => {
  const d = cleanCopy();
  writeFileSync(join(d, 'Broken.dc.html'), '<div style="color: red"><script>no closing tag\n');
  const r = run([d]);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /Broken\.dc\.html/);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
});

test('an empty template is bad input, exit 4', () => {
  const d = cleanCopy();
  writeFileSync(join(d, 'Empty.dc.html'), '   \n');
  assert.equal(run([d]).status, 4);
});

test('a frame the export wrote as a directory is bad input, exit 4, not skipped', () => {
  // Skipping it silently would let an unreadable frame vanish from the report, which is the one way
  // a validator can lie about a clean run.
  const d = cleanCopy();
  mkdirSync(join(d, 'Broken.dc.html'), { recursive: true });
  const r = run([d]);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /Broken\.dc\.html/);
});

test('a present-but-malformed tokens.json is bad input, exit 4, not a finding', () => {
  const d = cleanCopy();
  writeFileSync(join(d, 'tokens.json'), '{ "color": ');
  const r = run([d, '--json']);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /tokens\.json/);
  assert.equal(r.stdout, '', 'a malformed token file must not produce a report');
});

test('a malformed MANIFEST.json is bad input, exit 4', () => {
  const d = cleanCopy();
  writeFileSync(join(d, 'MANIFEST.json'), 'nope');
  assert.equal(run([d]).status, 4);
});

test('an absent token file is a finding and not malformed input', () => {
  // No token file at all: the contract was broken, which is a finding (exit 1), while a present but
  // unparsable one is exit 4 above. The two paths must not collapse into each other.
  const d = join(dir('dc-notok-'), 'in');
  mkdirSync(d, { recursive: true });
  copyFileSync(join(CLEAN_DIR, 'AlbumCard.dc.html'), join(d, 'AlbumCard.dc.html'));
  const r = run([d, '--json']);
  assert.equal(r.status, 1, 'a missing token file is an error, not bad input');
  const hits = json(r).diagnostics.filter((x) => x.code === 'tokens-missing');
  assert.ok(hits.some((x) => x.severity === 'error' && /no token file/.test(x.message)), JSON.stringify(hits));
  // And it cites the row that asks for the file, not the one that asks for its maps.
  assert.ok(hits.some((x) => x.rule === 'token-file-present'), JSON.stringify(hits.map((x) => x.rule)));
});

test('a token file missing a required map names the map it wants', () => {
  const d = cleanCopy();
  writeFileSync(join(d, 'tokens.json'), JSON.stringify({ color: { light: {}, dark: {} }, typography: {} }));
  const rep = json(run([d, '--json']));
  const msgs = rep.diagnostics.filter((x) => x.code === 'tokens-missing').map((x) => x.message).join(' | ');
  assert.match(msgs, /shape/);
  assert.match(msgs, /spacing/);
});

test('the input-path options are honoured against files outside their defaults', () => {
  // The clean export, but with its token file and manifest moved elsewhere: the contract still holds
  // only when the tool is told where they are, which is what --tokens and --manifest are for.
  const d = cleanCopy();
  const elsewhere = dir('dc-paths-');
  copyFileSync(join(d, 'tokens.json'), join(elsewhere, 'tokens.json'));
  copyFileSync(join(d, 'MANIFEST.json'), join(elsewhere, 'MANIFEST.json'));
  writeFileSync(join(d, 'tokens.json'), '{ "broken": true }');
  writeFileSync(join(d, 'MANIFEST.json'), 'nope');
  assert.equal(run([d, '--tokens', join(elsewhere, 'tokens.json'), '--manifest', join(elsewhere, 'MANIFEST.json')]).status, 0);
  // Left at their defaults, the same directory is malformed input, which proves the options resolved.
  assert.equal(run([d]).status, 4);
});

test('a --brief that names an existing file silences brief-missing, a dangling one does not', () => {
  const brief = join(dir('dc-brief-'), 'decisions.json');
  writeFileSync(brief, JSON.stringify({ decisions: [] }));
  const present = json(run([DIRTY, '--brief', brief, '--json']));
  assert.equal(present.checks.find((c) => c.code === 'brief-missing').findings, 0);
  const dangling = json(run([DIRTY, '--brief', brief + '.nope', '--json']));
  const hit = dangling.diagnostics.find((x) => x.code === 'brief-missing');
  assert.ok(hit, 'an override pointing at nothing must still report the missing brief');
  assert.equal(hit.severity, 'warn');
});

test('--help exits 0 and prints the usage line', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: node tools\/validate\.mjs <input-dir>/);
});

test('an info-only finding does not change the exit code', () => {
  // The clean export plus one unresolved placeholder: js-dependent-paint is the only finding, it is
  // reported as info, and spec/09 says exit 0 is about errors only.
  const d = cleanCopy();
  const p = join(d, 'AlbumCard.dc.html');
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace('>Compiled Weekly</h2>', '>{{ title }}</h2>')
  );
  const r = run([d, '--json']);
  const rep = json(r);
  assert.ok(rep.summary.infos > 0, 'the static proxy produced no info finding');
  assert.equal(rep.summary.errors, 0, JSON.stringify(rep.diagnostics));
  assert.equal(rep.summary.warnings, 0, JSON.stringify(rep.diagnostics));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(rep.diagnostics.every((x) => x.code === 'js-dependent-paint'));
});

test('at least one error-severity finding exits 1', () => {
  const r = run([REFERENCE, '--json']);
  assert.equal(r.status, 1);
  assert.ok(json(r).summary.errors > 0);
});

// ---- the refusal: exit 3, nothing written ----

test('an overlay naming a box nothing declares is a refusal, exit 3', () => {
  const d = cleanCopy();
  const p = join(d, 'AlbumCard.dc.html');
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace(
      'data-component="album-card"',
      'data-component="album-card" data-box="cover" data-overlay="artwork"'
    )
  );
  const r = run([d, '--json', '--out', join(dir('dc-refuse-'), 'report.json')]);
  assertOneLineFailure(r, 3);
  assert.match(r.stderr, /data-overlay="artwork"/);
});

test('an overlay naming a declared box is not a refusal', () => {
  const d = cleanCopy();
  const p = join(d, 'AlbumCard.dc.html');
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace(
      'data-component="album-card"',
      'data-component="album-card" data-box="cover" data-overlay="cover"'
    )
  );
  const r = run([d, '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---- unimplemented ----

test('unimplemented is exactly the six codes spec/07 refuses to fake', () => {
  const rep = json(run([DIRTY, '--json']));
  assert.equal(rep.summary.unimplemented, 6);
  assert.deepEqual(rep.unimplemented.map((u) => u.code), [...UNIMPLEMENTED].sort());
  for (const u of rep.unimplemented) {
    assert.deepEqual(Object.keys(u), ['code', 'rule', 'owner', 'reason']);
    assert.equal(u.owner, rules.find((r) => r.code === u.code).owner, `${u.code} owner is not the row's`);
    assert.ok(u.reason.length > 10, `${u.code} has no reason`);
  }
  // reflow-detected is the row the cross-check below exempts, so it must sit in this set and nowhere
  // else: an unimplemented code can never be reported as a check that stopped firing.
  assert.ok(UNIMPLEMENTED.includes('reflow-detected') && !CODES.includes('reflow-detected'));
});

// ---- baseline ----

test('the committed baseline matches a fresh run over the reference fixture', () => {
  const rep = json(run([REFERENCE, '--json']));
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  assert.equal(base.input, 'reference');
  assert.deepEqual(base.codes, Object.fromEntries(rep.checks.map((c) => [c.code, c.findings])));
  for (const k of ['errors', 'warnings', 'infos', 'findings', 'unimplemented'])
    assert.ok(typeof base.totals[k] === 'number', `baseline totals carry no ${k}`);
  assert.equal(JSON.stringify(base).match(/20\d\d-\d\d-\d\d/g), null, 'baseline holds a timestamp');
});

test('--baseline clean reports no drift and keeps the run exit code', () => {
  const r = run([REFERENCE, '--json', '--baseline', BASELINE]);
  assert.equal(r.status, 1, 'the reference fixture has errors, so the exit code is still 1');
  assert.equal(r.stderr, '', `unexpected drift on an unchanged fixture: ${r.stderr}`);
  assert.deepEqual(json(r).summary.errors, json(run([REFERENCE, '--json'])).summary.errors);
});

test('--baseline reports a changed count as drift and forces exit 1', () => {
  const d = cleanCopy();
  const base = join(dir('dc-base-'), 'clean.json');
  writeFileSync(
    base,
    JSON.stringify(
      {
        baseline: 'validate-baseline/1',
        input: 'clean',
        codes: { 'tokens-missing': 3, 'webfont-remote': 1 },
        totals: { errors: 3, warnings: 0, infos: 0 },
      },
      null,
      2
    )
  );
  const r = run([d, '--baseline', base]);
  assert.equal(r.status, 1, 'a clean export with drift must still exit 1');
  assert.match(r.stderr, /tokens-missing: baseline 3, now 0/);
  assert.match(r.stderr, /spec\/10/);
});

test('--baseline against a baseline from another input is a config error, exit 2', () => {
  const r = run([CLEAN, '--baseline', BASELINE]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /reference/);
});

test('--update-baseline records counts and never writes under fixtures', () => {
  const out = join(dir('dc-baseline-'), 'dirty.json');
  const r = run([DIRTY, '--update-baseline', '--baseline', out]);
  assert.match(r.stdout, /FAILED|OK/);
  const written = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(written.codes, tally(json(run([DIRTY, '--json']))));
  // The guard is about the path, so the refused one is the one that matters.
  const inside = join(ROOT, 'fixtures', 'synthetic', 'written-by-baseline.json');
  const refused = run([DIRTY, '--update-baseline', '--baseline', inside]);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /never writes under fixtures/);
  assert.equal(exists(inside), false, 'a baseline was written inside fixtures/');
});

// ---- the cross-check that ties T1's measurement to T2's checks ----

// Rows exempt from the cross-check, each with the reason stated in full. An exemption here is a
// written discrepancy, never a quiet deletion of an assertion.
const CROSS_CHECK_EXEMPT = {
  // 'reflow-detected' is unimplemented (it needs two renders), so it cannot be expected to fire.
  'reflow-detected': 'unimplemented: needs a materializer run at two widths',
  // DISCREPANCY (T1 row vs spec/07), reported to the human rather than fixed by weakening the check:
  // rule varying-text-marked-as-prop measures "violated" on the reference export because it is read as
  // "no data-prop attribute exists anywhere in the export" -- true, the export has 0 occurrences. The
  // CODE prop-undeclared detects something narrower: literal text that varies between instances of one
  // component and carries no data-prop. That is not observable here, because every piece of text that
  // varies between instances does so through a {{ }} placeholder the prop schema already names, and the
  // only literal run inside an <sc-for> block (the "check" glyph in Home.dc.html near line 42) is a
  // glyph name on an element that sets font-family: 'Material Symbols Outlined', not copy. spec/07 says
  // the same thing from the other side: "the unmarked-literal case it targets has not been seen yet".
  // So the row's measurement and the check's predicate are measuring different claims. Fixing this is a
  // T1 decision (narrow the row's measured claim, or annotate a fixture that really varies), not a T2
  // one; the check stays honest at 0 and this exemption is the paper trail.
  'prop-undeclared': 'row measures "no data-prop anywhere"; the code measures varying unmarked copy, which this export does not contain',
};

test('every implemented code measured violated has a finding on the reference fixture', () => {
  const rep = json(run([REFERENCE, '--json']));
  const fired = new Set(rep.diagnostics.map((d) => d.code));
  const implemented = new Set(rep.checks.map((c) => c.code));
  const rows = rules.filter(
    (r) => r.measured === 'violated' && !CROSS_CHECK_EXEMPT[r.code] && implemented.has(r.code)
  );
  assert.ok(rows.length >= 13, `only ${rows.length} violated rows are in play, the table changed shape`);
  for (const row of rows)
    assert.ok(fired.has(row.code), `rule ${row.id} (code ${row.code}) is measured violated yet the check fired nothing`);
  // The exemptions are counted, not hidden: an exemption list that silently grows is how this check
  // stops meaning anything, so the number of exempt codes is asserted, and each one is a written
  // discrepancy above.
  assert.equal(Object.keys(CROSS_CHECK_EXEMPT).length, 2, 'the exemption list changed without a written discrepancy');
  for (const code of Object.keys(CROSS_CHECK_EXEMPT))
    assert.ok(implemented.has(code) || UNIMPLEMENTED.includes(code), `${code} is exempt but is not a known code`);
});

// ---- house style ----

test('ASCII only in the tool, the test, the synthetic fixtures and the baseline', () => {
  const paths = [
    'tools/validate.mjs',
    'tests/validate.test.mjs',
    'baselines/reference.json',
    'fixtures/synthetic/clean/AlbumCard.dc.html',
    'fixtures/synthetic/clean/MANIFEST.json',
    'fixtures/synthetic/clean/tokens.json',
    'fixtures/synthetic/clean/decisions.json',
    'fixtures/synthetic/dirty/PlayerCard.dc.html',
    'fixtures/synthetic/dirty/Ghost.dc.html',
    'fixtures/synthetic/dirty/MANIFEST.json',
    'fixtures/synthetic/dirty/tokens.json',
  ];
  for (const p of paths) assert.deepEqual(nonAscii(readFileSync(join(ROOT, p), 'utf8')), [], p);
});

test('the tool stays a single file and the fixtures stay small', () => {
  // The task budget was "about 600 lines"; the file is at 989 (737 code, 197 comment-only) and is
  // NOT split, because splitting was not authorized. The bound below is the point where continuing to
  // grow would be worse than asking: a hard 600 assertion here would only teach the next run to delete
  // the comments that explain why each check exists. See the T2 handoff.
  const lines = readFileSync(TOOL, 'utf8').split('\n').length;
  assert.ok(lines < 1100, `tools/validate.mjs grew to ${lines} lines and now has to be split`);
  for (const p of [
    'fixtures/synthetic/clean/AlbumCard.dc.html',
    'fixtures/synthetic/dirty/PlayerCard.dc.html',
    'fixtures/synthetic/dirty/Ghost.dc.html',
  ])
    assert.ok(readFileSync(join(ROOT, p), 'utf8').split('\n').length < 40, `${p} is over 40 lines`);
});
