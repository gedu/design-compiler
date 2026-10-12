#!/usr/bin/env node
// T3 golden suite for the prompt assembler. The golden files are the product here, not a
// regression afterthought: DESIGN-PROMPT.md is what a human pastes into Claude Design, so every
// change to the document has to be a deliberate one that this suite makes visible.
//
//   node --test 'tests/*.test.mjs'   # compare against tests/golden
//   node tests/prompt.test.mjs --update    # rewrite goldens (explicit only, never on mismatch)
//
// Determinism is checked by running the tool twice and comparing bytes: "same input, byte-identical
// output" is invariant 1 of this repo and prose does not prove it.
//
// Why 'tests/*.test.mjs' and not 'tests/': node 24.18 treats a bare directory argument as a module
// to load (Cannot find module .../tests) instead of discovering the test files inside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'prompt.mjs');
const GOLDEN = join(ROOT, 'tests', 'golden');
const UPDATE = process.argv.includes('--update');

const rules = JSON.parse(readFileSync(join(ROOT, 'rules', 'contract-rules.json'), 'utf8'));
const baseBlocks = JSON.parse(readFileSync(join(ROOT, 'rules', 'target-blocks.json'), 'utf8'));
const askRows = rules.filter((r) => r.prompt === 'ask').sort((a, b) => a.id.localeCompare(b.id));
const silentAsks = rules
  .filter((r) => r.prompt === 'silent' && typeof r.ask === 'string' && r.ask)
  .map((r) => r.ask);

function golden(name, actual) {
  const path = join(GOLDEN, name);
  if (UPDATE) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  assert.ok(existsSync(path), `golden ${name} missing (run: node tests/prompt.test.mjs --update)`);
  assert.equal(actual, readFileSync(path, 'utf8'), `golden ${name} differs`);
}

// Generate into a throwaway directory: the tool writes one file plus a sidecar and must never
// depend on where it is run from, nor on the repository's own out/ directory.
function generate(targets, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dc-prompt-'));
  const out = join(dir, 'DESIGN-PROMPT.md');
  const proc = spawnSync(
    process.execPath,
    [TOOL, ...targets.flatMap((t) => ['--target', t]), '--out', out, ...extra],
    { cwd: ROOT, encoding: 'utf8' }
  );
  return {
    ...proc,
    out,
    body: existsSync(out) ? readFileSync(out, 'utf8') : null,
    sidecar: existsSync(out + '.json') ? readFileSync(out + '.json', 'utf8') : null,
  };
}

const nonAscii = (s) =>
  s
    .split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /[^\x00-\x7F]/.test(l));

// One line on stderr is the contract for a refusal: a stack trace or a wall of text would push the
// human to guess which of the two problems they have.
function assertOneLineFailure(r, status) {
  assert.equal(r.status, status, `expected exit ${status}, got ${r.status}: ${r.stderr}`);
  assert.equal(r.stderr.trim().split('\n').length, 1, `stderr was not one line: ${r.stderr}`);
  assert.equal(r.body, null, 'output was written despite the failure');
  assert.equal(r.sidecar, null, 'sidecar was written despite the failure');
}

// The collision cases run against temporary copies of the blocks file: an invented collision is the
// only way to test the refusal before two real blocks happen to disagree.
function withBlocks(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'dc-blocks-'));
  const path = join(dir, 'target-blocks.json');
  const doc = JSON.parse(JSON.stringify(baseBlocks));
  mutate(doc);
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  return path;
}

test('compose-only prompt matches the golden file', () => {
  const r = generate(['compose']);
  assert.equal(r.status, 0, r.stderr);
  golden('DESIGN-PROMPT.compose.md', r.body);
});

test('compose + react-native prompt matches the golden file', () => {
  const r = generate(['compose', 'react-native']);
  assert.equal(r.status, 0, r.stderr);
  golden('DESIGN-PROMPT.compose-react-native.md', r.body);
});

test('two runs are byte-identical, body and sidecar', () => {
  const a = generate(['compose', 'react-native']);
  const b = generate(['compose', 'react-native']);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.body, b.body, 'prompt body differs between runs');
  assert.equal(a.sidecar, b.sidecar, 'sidecar differs between runs');
});

test('sidecar carries provenance and nothing environment-dependent', () => {
  const r = generate(['react-native', 'compose']);
  assert.equal(r.status, 0, r.stderr);
  const meta = JSON.parse(r.sidecar);
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  assert.deepEqual(meta.targets, ['compose', 'react-native'], 'targets must be sorted');
  assert.equal(meta.contractRulesSha256, sha(join(ROOT, 'rules', 'contract-rules.json')));
  assert.equal(meta.blocksSha256, sha(join(ROOT, 'rules', 'target-blocks.json')));
  assert.equal(
    meta.toolVersion,
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  );
  assert.deepEqual(Object.keys(meta).sort(), [
    'blocksSha256',
    'contractRulesSha256',
    'targets',
    'toolVersion',
  ]);
  // A date or a home path in the provenance would break the byte-identical rerun claim.
  assert.doesNotMatch(r.sidecar, /20\d\d-\d\d-\d\d/);
  assert.doesNotMatch(r.sidecar, new RegExp(process.env.HOME || '/nonexistent-home'));
});

test('every asked rule appears verbatim, every silent one stays out', () => {
  const r = generate(['compose']);
  assert.equal(r.status, 0, r.stderr);
  // Counted from the data, not hardcoded: the number a human remembers is the number that rots.
  assert.equal(askRows.length, rules.filter((x) => x.prompt === 'ask').length);
  assert.ok(askRows.length > 30, 'the prompt should carry most of the contract');
  for (const row of askRows)
    assert.ok(r.body.includes(row.ask), `asked rule ${row.id} is missing from the prompt`);
  for (const ask of silentAsks)
    assert.ok(!r.body.includes(ask), `silent rule text leaked: ${ask.slice(0, 40)}`);
});

test('requirements are grouped by topic in the declared order, ids ascending within a topic', () => {
  const r = generate(['compose']);
  assert.equal(r.status, 0, r.stderr);
  const rank = new Map(baseBlocks.topicOrder.map(([id], i) => [id, i]));
  const at = new Map(askRows.map((row) => [row.id, r.body.indexOf('- ' + row.ask)]));
  assert.ok(
    [...at.values()].every((p) => p >= 0),
    'a requirement is not an emitted line'
  );

  // The emitted order is exactly (declared topic order, then id). Comparing the whole sequence is
  // stronger than checking pairs: any drift in either key shows up.
  const expected = [...askRows].sort(
    (a, b) => rank.get(a.topic) - rank.get(b.topic) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const emitted = [...askRows].sort((a, b) => at.get(a.id) - at.get(b.id)).map((x) => x.id);
  assert.deepEqual(emitted, expected.map((x) => x.id), 'requirements are not in the grouped order');

  // Both keys are load-bearing and neither may be an accident of the data.
  const topics = [...new Set(askRows.map((x) => x.topic))];
  assert.notDeepEqual(topics, [...topics].sort(), 'topic order looks alphabetical, order was ignored');
  const idSorted = [...askRows].sort((a, b) => (a.id < b.id ? -1 : 1)).map((x) => x.id);
  assert.notDeepEqual(
    emitted,
    idSorted,
    'output is id-sorted across topics, so grouping did not run'
  );
  const jsonOrder = rules.filter((x) => x.prompt === 'ask').map((x) => x.id);
  assert.notDeepEqual(jsonOrder, idSorted, 'JSON was already id-sorted: the id sort proves nothing');
});

// Grouping is only safe if a row cannot speak without a place to stand. Both holes are usage errors:
// a missing topic, and a topic the reading order never placed.
test('an asked rule missing its topic is a usage error', () => {
  const broken = rules.map((x, i) => (i === 0 ? { ...x, topic: undefined } : x));
  const dir = mkdtempSync(join(tmpdir(), 'dc-notopic-'));
  const rulesPath = join(dir, 'rules.json');
  writeFileSync(rulesPath, JSON.stringify(broken));
  const r = generate(['compose'], ['--rules', rulesPath]);
  assertOneLineFailure(r, 2);
  assert.match(r.stderr, /topic/);
});

test('an asked rule whose topic the reading order does not place is a usage error', () => {
  const broken = rules.map((x, i) => (i === 0 ? { ...x, topic: 'unplaced-topic' } : x));
  const dir = mkdtempSync(join(tmpdir(), 'dc-badtopic-'));
  const rulesPath = join(dir, 'rules.json');
  writeFileSync(rulesPath, JSON.stringify(broken));
  const r = generate(['compose'], ['--rules', rulesPath]);
  assertOneLineFailure(r, 2);
  assert.match(r.stderr, /unplaced-topic/);
});

test('generated text never references this repository', () => {
  const r = generate(['compose', 'react-native']);
  assert.equal(r.status, 0, r.stderr);
  for (const forbidden of ['spec/', 'contract-rules.json', 'tools/', 'rules/', 'target-blocks'])
    assert.ok(!r.body.includes(forbidden), `prompt leaks an internal locator: ${forbidden}`);
  for (const row of rules)
    assert.ok(!r.body.includes(row.id), `prompt leaks a rule id: ${row.id}`);
});

test('the whole document is ASCII', () => {
  for (const targets of [['compose'], ['compose', 'react-native']]) {
    const r = generate(targets);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(nonAscii(r.body), [], `non-ASCII in ${targets.join('+')} body`);
    assert.deepEqual(nonAscii(r.sidecar), [], `non-ASCII in ${targets.join('+')} sidecar`);
  }
  for (const name of ['DESIGN-PROMPT.compose.md', 'DESIGN-PROMPT.compose-react-native.md']) {
    const path = join(GOLDEN, name);
    if (existsSync(path)) assert.deepEqual(nonAscii(readFileSync(path, 'utf8')), [], name);
  }
});

test('unknown target id exits 3 with a one-line reason and writes nothing', () => {
  assertOneLineFailure(generate(['flutter']), 3);
  const r = generate(['compose', 'flutter']);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /flutter/);
});

test('duplicate target exits 3 rather than repeating a block', () => {
  const r = generate(['compose', 'compose']);
  assertOneLineFailure(r, 3);
  assert.match(r.stderr, /compose/);
});

test('zero targets exits 3 rather than emitting a target-less prompt', () => {
  assertOneLineFailure(generate([]), 3);
});

// Exit 3 is the refusal code (invariant 3). A bad invocation or a broken data file is a different
// failure and gets its own code, so a caller can tell "this prompt would lie" from "you typed it
// wrong or the table is malformed".
test('missing --out is a usage error, exit 2', () => {
  const proc = spawnSync(process.execPath, [TOOL, '--target', 'compose'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(proc.status, 2, proc.stderr);
  assert.equal(proc.stderr.trim().split('\n').length, 1, proc.stderr);
});

test('two blocks claiming one topic with different texts exit 3', () => {
  const blocks = withBlocks((doc) => {
    const c = doc.targets.find((t) => t.id === 'compose');
    c.topics.push('invented-topic');
    c.claims['invented-topic'] = 'Elevation is a tonal surface step.';
    c.block += '\n- Elevation is a tonal surface step.';
    const rn = doc.targets.find((t) => t.id === 'react-native');
    rn.topics.push('invented-topic');
    rn.claims['invented-topic'] = 'Elevation is impossible; use a border instead.';
    rn.block += '\n- Elevation is impossible; use a border instead.';
  });
  const r = generate(['compose', 'react-native'], ['--blocks', blocks]);
  assertOneLineFailure(r, 3);
  assert.match(r.stderr, /invented-topic/);
  assert.match(r.stderr, /compose/);
  assert.match(r.stderr, /react-native/);
});

test('a topic two blocks state identically is deduplicated, not refused', () => {
  const sentence = 'Icons never rely on a hover state to be understood.';
  const blocks = withBlocks((doc) => {
    for (const id of ['compose', 'react-native']) {
      const t = doc.targets.find((x) => x.id === id);
      t.topics.push('invented-shared');
      t.claims['invented-shared'] = sentence;
      t.block += '\n- ' + sentence;
    }
  });
  const r = generate(['compose', 'react-native'], ['--blocks', blocks]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.body.split(sentence).length - 1, 1, 'identical statement emitted twice');
  assert.match(r.stderr, /invented-shared/);
  assert.match(r.stderr, /dedup/i);
});

test('a topic claimed without text is a data error, exit 2', () => {
  const blocks = withBlocks((doc) => {
    doc.targets.find((t) => t.id === 'compose').topics.push('unknown-topic');
  });
  assertOneLineFailure(generate(['compose'], ['--blocks', blocks]), 2);
});

test('a topic whose text is not in its own block is a data error, exit 2', () => {
  const blocks = withBlocks((doc) => {
    doc.targets.find((t) => t.id === 'compose').claims.elevation = 'Elevation is free here.';
  });
  assertOneLineFailure(generate(['compose'], ['--blocks', blocks]), 2);
});

// Statements are bullets, one per line: that is what makes a claim map back to exactly one emitted
// line, so prose in a block is a data error and not a silently emitted paragraph.
test('a block line that is not a bullet is a data error, exit 2', () => {
  const blocks = withBlocks((doc) => {
    doc.targets.find((t) => t.id === 'compose').block += '\nA paragraph that is not a bullet.';
  });
  assertOneLineFailure(generate(['compose'], ['--blocks', blocks]), 2);
});

test('a malformed topics field is a data error, exit 2', () => {
  const blocks = withBlocks((doc) => {
    doc.targets.find((t) => t.id === 'compose').topics = 'elevation';
  });
  assertOneLineFailure(generate(['compose'], ['--blocks', blocks]), 2);
});
