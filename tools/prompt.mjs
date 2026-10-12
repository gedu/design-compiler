#!/usr/bin/env node
// T3 prompt assembler: build the document a human pastes into Claude Design, from data only.
//
//   node tools/prompt.mjs --target compose --target react-native --out out/DESIGN-PROMPT.md
//   node tools/prompt.mjs --help
//
// Why each rule here exists:
// 1. The document is the product of T4, the human round trip. Nothing may enter it by prose that no
//    check reads: target text comes from rules/target-blocks.json and every contract requirement
//    comes from a row in rules/contract-rules.json, the same table the validator will read.
// 2. Determinism (invariant 1): the body is a pure function of the two data files, so a rerun is
//    byte-identical. Provenance goes to the sidecar next to the file, never inside it, and holds no
//    timestamp and no path so nothing in it depends on the machine.
// 3. Refuse instead of invent (invariant 3). Exit 3 means "assembling this would produce a prompt
//    that lies to the design tool"; exit 2 means the call or the data file is malformed. One line on
//    stderr either way: the reader is a human at a terminal, not a log pipeline.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXIT_USAGE = 2; // bad invocation or malformed data file
const EXIT_REFUSE = 3; // assembling this would put a contradiction in front of the design tool

const USAGE =
  'usage: node tools/prompt.mjs --target <id> [--target <id> ...] --out <file> ' +
  '[--rules <file>] [--blocks <file>]';

// The failure paths speak in one line each, usage included: the reader is a human at a terminal and
// a multi-line error makes it hard to see which of the two failures they have.
function die(code, msg) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}
const usage = (m) => die(EXIT_USAGE, `prompt: ${m}; ${USAGE}`);
const refuse = (m) => die(EXIT_REFUSE, `prompt: refused, ${m}`);
const badData = (m) => die(EXIT_USAGE, `prompt: bad data file, ${m}`);

// ---- arguments ----
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(USAGE + '\n');
  process.exit(0);
}
const targets = [];
let out = null;
let rulesPath = join(ROOT, 'rules', 'contract-rules.json');
let blocksPath = join(ROOT, 'rules', 'target-blocks.json');
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const value = () => {
    if (i + 1 >= argv.length) usage(`${a} needs a value`);
    return argv[++i];
  };
  if (a === '--target') targets.push(value());
  else if (a === '--out') out = value();
  else if (a === '--rules') rulesPath = resolve(value());
  else if (a === '--blocks') blocksPath = resolve(value());
  else usage(`unknown argument ${a}`);
}
if (!out) usage('missing --out');

const readJson = (path, label) => {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    usage(`cannot read ${label} file ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    usage(`${label} file ${path} is not valid JSON: ${e.message}`);
  }
};

const rulesDoc = readJson(rulesPath, 'rules');
const rules = Array.isArray(rulesDoc) ? rulesDoc : rulesDoc.rules;
if (!Array.isArray(rules)) usage('rules file must be an array of rule rows');

const blocks = readJson(blocksPath, 'blocks');
if (!blocks || typeof blocks !== 'object' || !Array.isArray(blocks.targets))
  badData('blocks file has no targets array');

// ---- what the caller asked for (exit 3: a design prompt with no target, a repeated target, or an
// unknown target is a document that either says nothing or lies about a capability) ----
if (targets.length === 0) refuse('no --target given, a prompt without a target has no rules');
const dupes = targets.filter((t, i) => targets.indexOf(t) !== i);
if (dupes.length) refuse(`target ${dupes[0]} given twice, its block would be emitted twice`);

const byId = new Map();
for (const t of blocks.targets) {
  if (!t || typeof t.id !== 'string') badData('a target entry has no id');
  if (byId.has(t.id)) badData(`blocks file repeats target ${t.id}`);
  byId.set(t.id, t);
}
for (const id of targets)
  if (!byId.has(id))
    refuse(`unknown target ${id}, known targets: ${blocks.targets.map((t) => t.id).join(', ')}`);

// ---- validate each selected block against its own topic claims (exit 2: the data file is wrong,
// and a statement that is not in the block would escape the cross-check below) ----
const selected = targets.map((id) => byId.get(id));
for (const t of selected) {
  for (const f of ['label', 'block'])
    if (typeof t[f] !== 'string' || !t[f]) badData(`target ${t.id} has no ${f}`);
  if (!Array.isArray(t.topics)) badData(`target ${t.id} topics must be an array of ids`);
  if (!t.claims || typeof t.claims !== 'object') badData(`target ${t.id} has no claims map`);
  // One bullet per statement, so a claim always maps back to exactly one emitted line.
  const lines = t.block.split('\n');
  for (const l of lines)
    if (!l.startsWith('- ')) badData(`target ${t.id} has a block line that is not a bullet`);
  const statements = lines.map((l) => l.slice(2));
  for (const topic of t.topics) {
    if (typeof topic !== 'string') badData(`target ${t.id} topics must hold strings`);
    const claim = t.claims[topic];
    if (typeof claim !== 'string' || !claim)
      badData(`target ${t.id} speaks about ${topic} but states no text for it`);
    if (!statements.includes(claim))
      badData(`target ${t.id} claims ${topic} in text its block does not contain`);
  }
  for (const topic of Object.keys(t.claims))
    if (!t.topics.includes(topic))
      badData(`target ${t.id} states something about ${topic} without declaring the topic`);
}

// Reading order for the contract section: declared in the data, never derived from a sort, because
// an export is read top-to-bottom by someone who has to act on it.
const TOPIC_ORDER = new Map((blocks.topicOrder || []).map(([id, heading]) => [id, heading]));
if (TOPIC_ORDER.size === 0) badData('blocks file has no topicOrder, so requirements have no reading order');

// ---- cross-check shared topics (exit 3, the rule spec/08 asked for: two blocks that disagree must
// never be concatenated) ----
const claimCount = new Map();
for (const t of selected) for (const topic of t.topics)
  claimCount.set(topic, (claimCount.get(topic) || 0) + 1);
const shared = [...claimCount.entries()]
  .filter(([, n]) => n > 1)
  .map(([topic]) => topic)
  .sort();
for (const topic of shared) {
  const speakers = selected.filter((t) => t.topics.includes(topic));
  const text = speakers[0].claims[topic];
  for (const t of speakers)
    if (t.claims[topic] !== text)
      refuse(
        `targets ${speakers.map((s) => s.id).join(' and ')} both speak about ${topic} ` +
          `and disagree, not concatenating them`
      );
}
// A shared statement belongs to the document once, not once per block that mentioned it.
const sharedSet = new Set(shared);
const speakersOf = (topic) => selected.filter((t) => t.topics.includes(topic));

// ---- contract requirements, generated from the rows the validator will read ----
const asked = rules.filter((r) => r.prompt === 'ask');
for (const r of asked) {
  if (typeof r.ask !== 'string' || !r.ask) badData(`rule ${r.id} says prompt ask with no ask text`);
  // A row that speaks in the prompt must declare its topic and that topic must have a place in the
  // reading order, or the row would silently disappear from the document someone pastes.
  if (!r.topic) badData(`rule ${r.id} is asked in the prompt but declares no topic`);
  if (!TOPIC_ORDER.has(r.topic))
    badData(`rule ${r.id} has topic "${r.topic}", which topicOrder does not place`);
}
if (asked.length === 0) refuse('the rules file asks for nothing, so the prompt would be all advice');

// ---- assembly: body first line is prompt text, no header and no metadata ----
const parts = [];
const emit = (s) => parts.push(s);

const labels = selected.map((t) => t.label).join(' + ');
emit(blocks.targetAwareness.replace('{targets}', labels));

for (const t of selected) {
  const own = t.block.split('\n').filter((l) => !sharedSet.has(topicOf(t, l.slice(2))));
  emit(`TARGET RULES: ${t.label}\n${own.join('\n')}`);
}
if (shared.length)
  emit(
    blocks.sharedHeading + '\n' + shared.map((topic) => '- ' + speakersOf(topic)[0].claims[topic]).join('\n')
  );

// Group by topic in the declared order, rows within a topic by rule id: stable across runs and
// across appends, while related asks stay together for the reader.
const rank = new Map([...TOPIC_ORDER.keys()].map((id, i) => [id, i]));
const byTopic = new Map();
for (const r of asked) {
  if (!byTopic.has(r.topic)) byTopic.set(r.topic, []);
  byTopic.get(r.topic).push(r);
}
const contractBody = [...byTopic.entries()]
  .sort((a, b) => rank.get(a[0]) - rank.get(b[0]))
  .map(([topic, rows]) => {
    const asks = [...rows]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => '- ' + r.ask);
    return `${TOPIC_ORDER.get(topic)}\n${asks.join('\n')}`;
  })
  .join('\n\n');
emit(`${blocks.contractHeading}\n\n${contractBody}`);
emit(`${blocks.adviceHeading}\n${blocks.advice}`);
emit(
  `${blocks.decisionsHeading}\n${blocks.decisionsBody}\n` +
    '~~~json\n' +
    JSON.stringify(blocks.decisionsExample, null, 2) +
    '\n~~~'
);

const body = parts.join('\n\n') + '\n';

// ---- write: one file the human pastes, one sidecar for whoever audits it ----
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body);
// Keys in sorted order so the sidecar is byte-identical without depending on insertion luck.
const sidecar = {
  blocksSha256: sha(blocksPath),
  contractRulesSha256: sha(rulesPath),
  targets: [...targets].sort(),
  toolVersion: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
};
writeFileSync(outPath + '.json', JSON.stringify(sidecar, null, 2) + '\n');

// Deduplication is reported and not silently dropped: a statement leaving a target's own block is a
// fact about the assembled document, and the human pasting it should see that the blocks agreed.
for (const topic of shared)
  process.stderr.write(
    `prompt: deduplicated ${topic}, stated identically by ` +
      speakersOf(topic).map((t) => t.id).join(' and ') +
      '\n'
  );
process.stderr.write(
  `prompt: wrote ${out} (${targets.length} targets, ${asked.length} requirements)\n`
);

// Which declared topic a block line is the statement for. Blocks are validated to contain their
// claims verbatim above, so a shared line always resolves here.
function topicOf(target, line) {
  return target.topics.find((topic) => target.claims[topic] === line);
}
