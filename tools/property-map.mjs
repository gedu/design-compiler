#!/usr/bin/env node
// T2.5 bridge checker: does every CSS property the reference export declares have an owner, and can
// that owner be pointed at?
//
//   node tools/property-map.mjs                      # check the table, human output
//   node tools/property-map.mjs --json               # same verdict as data
//   node tools/property-map.mjs --table              # one JSON row per harvested property, to seed
//                                                    #   the table (the dispositions in the committed
//                                                    #   file are reviewed; this only saves a human
//                                                    #   from typing counts)
//   node tools/property-map.mjs --repair [--out f]   # paste-ready repair instruction for the source
//
// What this proves: (a) every property present in the fixture has a row in the table, (b) the counts
// and the value shapes recorded for an unmapped property match the fixture, (c) every `mapped` row
// carries evidence and each citation really names that property inside a code span on a table or list
// row of a mapping spec, and (d) every `unmapped` row declares a disposition the table defines. What
// it does NOT prove: that the mapping itself is right. That is the golden suite's job (spec/10).
//
// Evidence is re-derived from the files on disk every run, so an owner cannot be claimed by assertion
// and a stale citation is a failure rather than a rumour. Coverage counts are derived the same way and
// are deliberately never stored in the table.
//
// Exit codes are the repo's (see tools/validate.mjs): 0 clean, 1 drift or an ownerless property, 2 bad
// invocation or malformed table data (including a citation that does not verify), 4 the fixture or a
// spec is unreadable. 3 is unreachable here: this tool never needs an invention to finish, and a
// property with no owner is a finding, not a decision it has to make.
//
// Why this file parses styles instead of importing tools/validate.mjs: the harvest below is the
// bridge's canonical one -- a `{{ }}` hole is one opaque token and never a terminator, and
// declarations come from rule bodies -- while validate.mjs has its own reader whose behaviour the
// frozen baseline counts were measured against. Folding the two readers together is T6's work, not
// this task's; spec/13-bridge.md says so.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protectHoles, harvestSource } from './css-harvest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;
const EXIT_INPUT = 4;

const USAGE =
  'usage: node tools/property-map.mjs [--table-file <path>] [--fixture <dir>] ' +
  '[--json | --table | --relocate | --repair [--out <path>]]; ' +
  '--relocate fixes citations whose spec row merely moved; ' +
  'for a brand-new source tool, copy the table, empty its "properties" list, and run --table';

// One line on stderr, like the other tools: the reader is a human at a terminal.
function die(code, msg) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}
const usage = (m) => die(EXIT_USAGE, `property-map: ${m}; ${USAGE}`);
const badData = (m) => die(EXIT_USAGE, `property-map: bad data file, ${m}`);
const badInput = (m) => die(EXIT_INPUT, `property-map: bad input, ${m}`);

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(USAGE + '\n');
  process.exit(EXIT_OK);
}
const MODES = ['--json', '--table', '--repair', '--relocate'];
const chosen = MODES.filter((m) => argv.includes(m));
if (chosen.length > 1) usage(`${chosen.join(' and ')} are different modes; pick one`);
const mode = (chosen[0] || '--check').replace('--', '');
if (mode === 'relocate' && chosen.length !== 1) usage('--relocate runs alone');
function flagArg(name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) usage(`${name} needs a value`);
  return v;
}
const outPath = flagArg('--out');
if (outPath && mode !== 'repair') usage('--out only writes a report in --repair mode');
const tablePath = flagArg('--table-file') || 'rules/property-ownership.json';
const fixtureArg = flagArg('--fixture') || 'fixtures/reference';
const VALUE_FLAGS = ['--out', '--table-file', '--fixture'];
const OK_FLAGS = [...MODES, ...VALUE_FLAGS];
{
  // Skip a flag's own value, then reject anything unrecognized. An unknown flag that was silently
  // accepted (or a typo like --tabel) would report a verdict about a file nobody asked about.
  for (let i = 0; i < argv.length; i++) {
    if (VALUE_FLAGS.includes(argv[i])) {
      i++;
      continue;
    }
    if (!OK_FLAGS.includes(argv[i])) usage(`unknown argument "${argv[i]}"`);
  }
}

// ---- the harvest ----
// The reader itself is tools/css-harvest.mjs, shared with whatever walks a SourceModel next, because the
// two bugs it exists to prevent (a {{ }} hole truncating a declaration, a selector read as a
// declaration) are properties of the format, not of this checker.

function harvestFixture(relDir) {
  const dir = resolve(ROOT, relDir);
  if (!existsSync(dir)) badInput(`fixture directory not found: ${relDir}`);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.dc.html')).sort();
  } catch (e) {
    badInput(`fixture directory unreadable: ${relDir} (${e.message})`);
  }
  if (!files.length) badInput(`fixture directory holds no .dc.html templates: ${relDir}`);
  const props = new Map();
  let holes = 0;
  let total = 0;
  for (const f of files) {
    let src;
    try {
      src = readFileSync(join(dir, f), 'utf8');
    } catch (e) {
      badInput(`template unreadable: ${relDir}/${f} (${e.message})`);
    }
    holes += protectHoles(src).holes;
    for (const d of harvestSource(src).decls) {
      total++;
      let p = props.get(d.prop);
      if (!p) props.set(d.prop, (p = { prop: d.prop, count: 0, values: new Map() }));
      p.count++;
      p.values.set(d.value, (p.values.get(d.value) || 0) + 1);
    }
  }
  const rows = [...props.values()].sort((a, b) => a.prop.localeCompare(b.prop));
  return { relDir, files, rows, holes, total };
}
// The value shapes worth freezing for a property: the most frequent first, ties alphabetical, capped
// so a property with 65 distinct values does not turn the table into a value dump.
function shapes(prop, cap = 8) {
  const p = prop.values;
  return Object.fromEntries(
    [...p.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, cap),
  );
}

// ---- evidence: a `mapped` row has to be pointable at ----
//
// This repo escapes backticks in markdown as \`, so spans are read after unescaping. A code span
// names a property when the token starts the span or follows a `;` or a space inside it (so
// `display: flex; flex-direction: row` names both) and is not glued to further word characters or a
// hyphen (so `colorScheme.primary`, `--md-sys-color-primary` and `border-bottom` name neither `color`
// nor `border`). Only table and list rows count: the same word loose in a paragraph is a mention, not
// a decision, which is why spec/01 warning about `transform` does not make transform mapped.
function specRows(relPath) {
  let raw;
  try {
    raw = readFileSync(resolve(ROOT, relPath), 'utf8');
  } catch (e) {
    badInput(`mapping spec unreadable: ${relPath} (${e.message})`);
  }
  const rows = [];
  raw.replace(/\\`/g, '`').split('\n').forEach((line, i) => {
    if (!/^\s*(\||-|\d+\.\s)/.test(line)) return;
    const spans = [...line.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
    if (spans.length) rows.push({ line: i + 1, spans });
  });
  return rows;
}
function spanNames(span, prop) {
  // A span names the properties on the LEFT of a colon, never a value: `display: flex` names display
  // and nothing else, while `display: flex; flex-direction: row` names both properties. Reading the
  // value side as a property is how `flex` looked mapped through a row about display.
  for (const part of span.split(';')) {
    const i = part.indexOf(':');
    const lhs = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
    if (lhs && lhs === prop) return true;
    if (i < 0 && part.trim().toLowerCase() === prop) return true;
  }
  return false;
}
// A span may be a family glob (`padding-*`, `border-*-radius`, `font-*`). Globs are never applied
// automatically: a row that claims coverage through one says so in `wildcard`, and the checker
// verifies both that the span exists on the cited row and that the property really fits the glob.
function globMatches(glob, prop) {
  if (!glob.includes('*')) return glob === prop;
  const re = new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[\\w-]*') + '$');
  return re.test(prop);
}

// ---- the ownership table ----
function readTable(relPath) {
  let raw;
  try {
    raw = readFileSync(resolve(ROOT, relPath), 'utf8');
  } catch (e) {
    badInput(`ownership table unreadable: ${relPath} (${e.message})`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    badData(`${relPath} is not valid JSON (${e.message})`);
  }
  for (const k of ['schema', 'fixture', 'mapping_specs', 'dispositions', 'properties'])
    if (!(k in data)) badData(`${relPath} is missing the "${k}" field`);
  if (data.schema !== 'property-ownership/1') badData(`${relPath} has schema "${data.schema}", expected "property-ownership/1"`);
  if (!Array.isArray(data.mapping_specs) || !data.mapping_specs.length) badData(`${relPath} declares no mapping_specs`);
  for (const s of data.mapping_specs) {
    if (!/^spec\/[^:]+\.md$/.test(s)) badData(`${relPath} names mapping spec "${s}", expected spec/<file>.md`);
    if (/bridge/.test(s))
      badData(`${relPath} must not consult ${s}: the bridge spec describes ownership without granting it, and citing it would let the gap own itself`);
  }
  if (!data.dispositions || typeof data.dispositions !== 'object' || !Object.keys(data.dispositions).length)
    badData(`${relPath} defines no dispositions`);
  // An unknown's severity is data, not a judgment call at emission time (spec/13). Reusing spec/02's
  // three words keeps the bridge from inventing a fourth vocabulary for the same three behaviors.
  const SEVERITIES = ['error', 'warn', 'info'];
  for (const [name, d] of Object.entries(data.dispositions)) {
    if (!d || typeof d !== 'object') badData(`disposition ${name} must be an object with "severity" and "why"`);
    if (!SEVERITIES.includes(d.severity)) badData(`disposition ${name} has severity "${d.severity}", expected one of ${SEVERITIES.join(', ')}`);
    if (typeof d.why !== 'string' || !d.why.trim()) badData(`disposition ${name} has no "why"`);
  }
  if (!Array.isArray(data.properties)) badData(`${relPath}.properties is not a list`);
  const seen = new Set();
  const rowNames = new Set(data.properties.map((r) => r && r.prop));
  for (const r of data.properties) {
    if (!r || typeof r.prop !== 'string' || !/^-?[a-z][-\w]*$/.test(r.prop))
      badData(`${relPath} has a property row with no usable "prop"`);
    if (seen.has(r.prop)) badData(`${relPath} names ${r.prop} twice`);
    seen.add(r.prop);
    if (typeof r.count !== 'number' || r.count < 0) badData(`${r.prop} has no non-negative count`);
    if (r.count === 0 && !r.arrives_via)
      badData(`${r.prop} declares count 0 with no "arrives_via": a row the source never declares has to say which shorthand delivers it, or it is a row to delete, not to keep`);
    if (r.count === 0 && r.arrives_via && r.owner === 'expanded')
      badData(`${r.prop} arrives via ${r.arrives_via} and cannot itself be the shorthand that expands`);
    if (r.longhands) {
      if (!Array.isArray(r.longhands) || !r.longhands.length) badData(`${r.prop} declares longhands as an empty list`);
      for (const lh of r.longhands) if (!rowNames.has(lh)) badData(`${r.prop} names longhand ${lh}, which has no row in this table`);
    }
    if (r.owner === 'mapped') {
      if (!Array.isArray(r.evidence) || !r.evidence.length) badData(`${r.prop} is mapped with no evidence to point at`);
      if (r.disposition) badData(`${r.prop} is mapped and so must not declare a disposition`);
    } else if (r.owner === 'expanded') {
      // A shorthand the browser resolves: it has no mapping row of its own and needs none, because no
      // reader ever sees it. Its longhands are the contract, and they have to be real rows.
      if (!Array.isArray(r.longhands) || !r.longhands.length) badData(`${r.prop} is a shorthand with no longhands declared`);
      if (r.evidence && r.evidence.length) badData(`${r.prop} is expanded, not mapped, so it must not carry evidence`);
      if (r.disposition) badData(`${r.prop} is expanded and so must not declare a disposition`);
      for (const lh of r.longhands) if (!rowNames.has(lh)) badData(`${r.prop} names longhand ${lh}, which has no row in this table`);
    } else if (r.owner === 'unmapped') {
      if (!data.dispositions[r.disposition])
        badData(`${r.prop} is unmapped with disposition "${r.disposition}", which the table does not define`);
      // A longhand this source never declares has no value shapes to freeze; one it does declare has
      // exactly the shapes the checker measured, and those are the regression lock.
      if (r.count > 0 && (typeof r.values !== 'object' || !Object.keys(r.values).length))
        badData(`${r.prop} is unmapped and declares ${r.count} occurrences, so it must record the value shapes it was measured with`);
      if (!Array.isArray(r.evidence) || r.evidence.length) badData(`${r.prop} is unmapped and so must carry an empty evidence list`);
      for (const k of ['note', 'fix']) if (typeof r[k] !== 'string' || !r[k].trim()) badData(`${r.prop} is unmapped and must carry a "${k}"`);
    } else {
      badData(`${r.prop} has owner "${r.owner}", which is neither "mapped" nor "unmapped"`);
    }
  }
  return data;
}
// Where a property's owning row lives in one spec file, as lines. A spec edit moves a row; the
// citation is then stale, and the honest fix is mechanical when exactly one row names the property.
function rowsNaming(prop, spec, cache, wildcard) {
  return cache
    .get(spec)
    .filter((r) => r.spans.some((x) => spanNames(x, prop)) || (wildcard && r.spans.some((x) => x.trim().toLowerCase() === wildcard && globMatches(wildcard, prop))))
    .map((r) => r.line);
}

function verifyEvidence(prop, evidence, cache, wildcard, allowed, relocatable) {
  const problems = [];
  for (const cit of evidence) {
    const m = /^(spec\/[^:]+):(\d+)$/.exec(cit);
    if (!m) {
      problems.push(`${prop}: evidence "${cit}" is not a spec/<file>.md:<line> citation`);
      continue;
    }
    // Evidence may only come from a spec the table declared as a mapping spec. Without this, a row
    // could earn "mapped" by citing any markdown file in the repo that happens to mention the token,
    // which is how a contract warning about a property would silently become its owner.
    if (!allowed.has(m[1])) {
      problems.push(`${prop}: evidence "${cit}" is not a mapping spec this table consults (${[...allowed].join(', ')})`);
      continue;
    }
    if (!cache.has(m[1])) cache.set(m[1], specRows(m[1]));
    const row = cache.get(m[1]).find((r) => r.line === Number(m[2]));
    const owns = (r) => r.spans.some((x) => spanNames(x, prop)) || (wildcard && r.spans.some((x) => x.trim().toLowerCase() === wildcard && globMatches(wildcard, prop)));
    if (row && owns(row)) continue;
    // Either the cited line is no longer a row at all, or it is a row that stopped naming this
    // property. Both mean a spec was edited above it. When exactly one row in the file could own the
    // property, the fix is a move and can be applied; when several could, which one owns it is a
    // human decision and saying so is the whole value of the check.
    const candidates = cache.get(m[1]).filter(owns).map((r) => r.line);
    if (candidates.length === 1 && candidates[0] !== Number(m[2])) {
      if (relocatable) relocatable.set(cit, `${m[1]}:${candidates[0]}`);
      problems.push(`${prop}: evidence "${cit}" is stale; the only row in ${m[1]} that names ${prop} is now line ${candidates[0]} (--relocate applies it)`);
    } else if (candidates.length > 1) {
      problems.push(`${prop}: evidence "${cit}" is stale and ${m[1]} has ${candidates.length} rows naming ${prop} (${candidates.join(', ')}); which one owns it is a decision, not a move`);
    } else if (row) {
      problems.push(`${prop}: evidence "${cit}" carries code spans but none names ${prop}${wildcard ? ` nor the claimed family \`${wildcard}\`` : ''}`);
    } else {
      problems.push(`${prop}: evidence "${cit}" is not a table or list row carrying code spans, and ${m[1]} has no row naming ${prop}`);
    }
  }
  return problems;
}
// Where the specs do name a property, derived from disk. Used to seed --table and to tell a human
// whether an ownerless property is unnamed everywhere or simply never cited. Longhand names that only
// ever appear on the right of a colon (a value) are deliberately not offered as evidence.
function derivedEvidence(prop, cache) {
  const out = [];
  for (const [spec, rows] of cache)
    for (const row of rows) if (row.spans.some((s) => spanNames(s, prop))) out.push(`${spec}:${row.line}`);
  return out;
}

const table = readTable(tablePath);
const cache = new Map();
for (const s of table.mapping_specs) cache.set(s, specRows(s));
const fixture = harvestFixture(fixtureArg);
// The table freezes counts measured on one fixture. Pointing the checker at a DIFFERENT export is not
// an error, it is the whole point of the repair loop (spec/10 step 1: a fresh export arrives and
// someone has to say what it declares that nothing owns). Counts drift there by definition, so drift
// is reported only when the export being checked is the one the counts were measured on. Coverage and
// evidence are always checked: a property nobody owns is a finding in any export.
const driftChecked = table.fixture === fixtureArg;



// ---- the check (the repair report and the human report both need this harvest) ----
//
// --table is how the table gets written in the first place, so it cannot fail because that table is
// empty: in that mode the findings are collected and never raised. Everything else is identical, so a
// seeded row and a checked row come from one code path and cannot disagree about a count.
const byName = new Map(table.properties.map((r) => [r.prop, r]));
const findings = [];
// --table suppresses findings rather than skipping the check, so a seeded row and a checked row come
// from one code path and can never disagree about a count.
const note = mode === 'table' ? () => {} : (kind, prop, message) => findings.push({ kind, prop, message });
for (const r of fixture.rows) {
  const row = byName.get(r.prop);
  if (!row) {
    const ev = derivedEvidence(r.prop, cache);
    note(
      'unowned',
      r.prop,
      `${r.prop} appears ${r.count}x in the fixture with no row; ${ev.length ? `a mapping spec does name it (${ev.join(', ')}) so it needs an owner and a citation` : 'no mapping spec names it either'}`,
    );
    continue;
  }
  if (driftChecked && row.count !== r.count) note('count-drift', r.prop, `${r.prop} is recorded as ${row.count}, the fixture says ${r.count}`);
  if (driftChecked && row.owner === 'unmapped' && JSON.stringify(row.values || null) !== JSON.stringify(shapes(r)))
    note(
      'value-drift',
      r.prop,
      `${r.prop} value shapes drift: table ${JSON.stringify(row.values)} vs fixture ${JSON.stringify(shapes(r))}`,
    );
}
// A count-0 row is a longhand capture always produces and this source never declares: it cannot
// drift into being a phantom, because it is defined by never appearing in the source text.
if (driftChecked)
  for (const row of table.properties)
    if (row.count !== 0 && !fixture.rows.some((r) => r.prop === row.prop))
    note(
      'phantom',
      row.prop,
      `${row.prop} has a row of count ${row.count} but the fixture declares it ${fixture.rows.find((r) => r.prop === row.prop)?.count ?? 0} times`,
    );
const citations = [];
const moves = new Map();
for (const row of table.properties.filter((r) => r.owner === 'mapped')) {
  for (const p of verifyEvidence(row.prop, row.evidence, cache, row.wildcard, new Set(table.mapping_specs), mode === 'relocate' ? moves : null))
    note('evidence', row.prop, p);
  citations.push(...row.evidence);
}
if (mode === 'relocate') {
  // Rewrite only citations with exactly one candidate row: a move is mechanical, an ambiguous choice
  // belongs to a human. The file is rewritten in place so the diff shows only line numbers.
  const raw = readFileSync(resolve(ROOT, tablePath), 'utf8');
  let text = raw;
  for (const [from, to] of moves) text = text.split(JSON.stringify(from)).join(JSON.stringify(to));
  writeFileSync(resolve(ROOT, tablePath), text);
  process.stdout.write(`property-map: relocated ${moves.size} citation${moves.size === 1 ? '' : 's'} in ${tablePath}\n`);
  const unresolved = findings.filter((f) => f.kind === 'evidence');
  if (unresolved.length) {
    for (const f of unresolved) process.stdout.write(`  still open: ${f.message}\n`);
    process.exitCode = EXIT_FINDINGS;
  } else process.exitCode = EXIT_OK;
}
// One citation inside one property row is the only duplicate worth naming: the same spec row backing
// two different properties is normal (spec/03:56 owns padding-* and margin-* together).
const dups = table.properties
  .filter((r) => r.evidence && new Set(r.evidence).size !== r.evidence.length)
  .map((r) => `${r.prop} cites the same spec row twice`);

const gap = fixture.rows.filter((r) => byName.get(r.prop)?.owner === 'unmapped');
const unmappedDecls = gap.reduce((s, r) => s + r.count, 0);
const byDisposition = {};
for (const r of gap) {
  const d = byName.get(r.prop).disposition;
  byDisposition[d] = (byDisposition[d] || 0) + 1;
}
const mapped = fixture.rows.filter((r) => byName.get(r.prop)?.owner === 'mapped');
const summary = {
  table: tablePath,
  fixture: fixtureArg,
  counts_measured_on: table.fixture,
  counts_comparable: driftChecked,
  templates: fixture.files.length,
  declarations: fixture.total,
  template_holes: fixture.holes,
  properties_harvested: fixture.rows.length,
  mapped: mapped.length,
  mapped_declarations: mapped.reduce((s, r) => s + r.count, 0),
  unmapped: gap.length,
  unmapped_declarations: unmappedDecls,
  unmapped_by_disposition: byDisposition,
  unmapped_by_severity: fixture.rows.reduce((acc, r) => {
    const row = byName.get(r.prop);
    if (row?.owner !== 'unmapped') return acc;
    const sev = table.dispositions[row.disposition].severity;
    acc[sev] = (acc[sev] || 0) + 1;
    acc[`${sev}_declarations`] = (acc[`${sev}_declarations`] || 0) + r.count;
    return acc;
  }, {}),
  rows_with_no_fixture_match: table.properties.filter((r) => !fixture.rows.some((f) => f.prop === r.prop)).length,
  evidence_citations: citations.length,
  wildcards_claimed: table.properties.filter((r) => r.wildcard).length,
  shorthands_declaring_longhands: table.properties.filter((r) => r.longhands).length,
  findings: findings.length + dups.length,
};

const SPEC02_SEMANTICS = {
  error: 'the target does not emit that node; the number is not guessed at',
  warn: 'the target emits the node and an inline comment naming the property',
  info: 'report only: nothing in the emitted code changes',
};

// Every branch only writes and sets process.exitCode: process.exit() after a big write truncates piped
// stdout, which is the bug tools/validate.mjs documents. The table is 51 rows and a repair report is
// about a screen of text, and neither is worth betting the pipe buffer on.
if (mode === 'table') {
  console.error(
    `property-map: ${fixture.rows.length} properties, ${fixture.total} declarations, ${fixture.holes} template holes ` +
      `over ${fixture.files.length} templates of ${fixtureArg}; rows follow, dispositions are yours`,
  );
  process.stdout.write(tableSeed().map((r) => JSON.stringify(r)).join('\n') + '\n');
  process.exitCode = EXIT_OK;
} else if (mode === 'repair') {
  const body = renderRepair(gap);
  if (outPath) {
    const abs = resolve(ROOT, outPath);
    if (relative(ROOT, abs).startsWith('fixtures/')) usage('refusing to write inside fixtures/: inputs are immutable');
    writeFileSync(abs, body);
  }
  // The report goes to stdout, and to --out only when asked (the T2 convention).
  process.stdout.write(body);
  process.exitCode = findings.length || dups.length ? EXIT_FINDINGS : EXIT_OK;
} else if (mode === 'json') {
  process.stdout.write(JSON.stringify({ summary, gap, findings }, null, 2) + '\n');
  process.exitCode = findings.length || dups.length ? EXIT_FINDINGS : EXIT_OK;
} else {
  for (const f of findings) console.log(`${f.kind.padEnd(12)} ${f.message}`);
  for (const d of dups) console.log(`duplicate    ${d}`);
  console.log(
    `\n${summary.properties_harvested} properties / ${summary.declarations} declarations over ${summary.templates} templates of ${fixtureArg}: ` +
      `${summary.mapped} mapped (${summary.mapped_declarations} declarations), ${summary.unmapped} unmapped ` +
      `(${unmappedDecls} declarations) [${Object.entries(byDisposition).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}] ` +
    `by severity: ${Object.entries(summary.unmapped_by_severity).filter(([k]) => !k.endsWith('_declarations')).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  if (!driftChecked)
    console.log(`counts are not compared: this export is not the one ${tablePath} was measured on (${table.fixture}); coverage and evidence are checked, drift is not`);
  console.log(`${summary.evidence_citations} evidence citations verified against the specs on disk (${summary.wildcards_claimed} through a declared property family); findings: ${summary.findings}`);
  process.exitCode = summary.findings ? EXIT_FINDINGS : EXIT_OK;
}

// --table output: one reviewed row per harvested property, dispositions left as TODO for a human.
function tableSeed() {
  return fixture.rows.map((r) => {
    const ev = derivedEvidence(r.prop, cache);
    return ev.length
      ? { prop: r.prop, count: r.count, owner: 'mapped', evidence: ev }
      : {
          prop: r.prop,
          count: r.count,
          owner: 'unmapped',
          disposition: 'TODO',
          evidence: [],
          values: shapes(r),
          note: 'TODO what the export means by it',
          fix: 'TODO the contract field or mapping row that retires this unknown',
        };
  });
}

// ---- the paste-ready repair instruction (spec/13, spec/10 sink 3 made mechanical) ----
//
// One property per bullet, its value shapes counted, and a fix that asks the source tool to declare
// intent instead of emitting a value no target can own. Generated from the table, so it cannot drift
// from the check that produced it, and it names nothing the table does not already hold.
function renderRepair(gapRows) {
  if (!gapRows.length)
    return `No unmapped CSS property: every property \`${tablePath}\` harvested from \`${table.fixture}\` is named by a mapping spec.\n`;
  const short = table.mapping_specs.map((s) => s.replace(/^spec\//, '').replace(/\.md$/, '')).join(', ');
  const L = [];
  L.push('# This export declares things no target owns yet');
  L.push('');
  L.push(`Source: \`${table.fixture}\` (${fixture.files.length} templates, ${fixture.total} CSS declarations).`);
  L.push(
    `${gapRows.length} properties, ${unmappedDecls} declarations, are written by the design and named by none of ` +
      `the mapping specs this compiler reads (${short}).`,
  );
  L.push('');
  L.push('None of these is a rendering bug: each one painted correctly in the browser. Each is a decision');
  L.push('the browser made that no target can reproduce, so the compiler has to stop on it or emit it as a');
  L.push('comment. For each one below, either stop declaring it, or give us the intent that stands in for');
  L.push('it -- the intent is worth more to a compiler than the value.');
  L.push('');
  for (const r of [...gapRows].sort((a, b) => b.count - a.count || a.prop.localeCompare(b.prop))) {
    const row = byName.get(r.prop);
    const d = table.dispositions[row.disposition];
    L.push(`- \`${r.prop}\`, ${r.count}x (class: ${row.disposition} -- ${d.why})`);
    L.push(`    this reaches the target as \`${d.severity}\`: ${SPEC02_SEMANTICS[d.severity]}`);
    for (const [v, n] of Object.entries(shapes(r, 4))) L.push(`    ${n}x ${v.length > 74 ? v.slice(0, 71) + '...' : v}`);
    L.push(`    why it matters: ${row.note}`);
    L.push(`    please: ${row.fix}`);
  }
  L.push('');
  L.push(`Generated by \`node tools/property-map.mjs --repair\` from \`${tablePath}\`. Re-running the checker`);
  L.push('after a new export is the measurement of whether this list shrank.');
  L.push('');
  return L.join('\n');
}
