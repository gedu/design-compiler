#!/usr/bin/env node
// Contract consistency checks. spec/10: a lesson becomes a check, not a paragraph.
//
//   node tools/check-contract.mjs        # exit 0 clean, exit 1 with findings
//
// Why each check exists:
// 1. rules/contract-rules.json is the normative contract list; spec/01 and spec/08 are prose over
//    it. A rule with no row is a rule nobody can enforce.
// 2. severity lives in both the JSON and spec/07's tables on purpose (the prompt builder needs it
//    locally, the human reads the catalog). Two places drift unless something compares them, which
//    is exactly how the prose version of this contract rotted before T1.
// 3. the ask/detect/fix fields feed the generated prompt and the diagnostics; an empty one ships an
//    unusable message.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const doc = JSON.parse(read('rules/contract-rules.json'));
const rules = Array.isArray(doc) ? doc : doc.rules;
const problems = [];
const fail = (m) => problems.push(m);

// The repo escapes backticks inside markdown as `\``, so normalize before matching codes.
const unesc = (s) => s.split('\\`').join('`');

const spec07 = unesc(read('spec/07-validator.md'));
function tableUnder(heading) {
  const i = spec07.indexOf(heading);
  if (i < 0) return fail(`spec/07 has no heading "${heading}"`) , '';
  const j = spec07.indexOf('\n## ', i + 5);
  return spec07.slice(i, j < 0 ? spec07.length : j);
}
const errorTable = tableUnder('## Contract violations (errors)');
const warnTable = tableUnder('## Degradations (warnings)');
// Catalog cells are plain text in the first column, prose refers to codes with backticks; accept both.
const tableHas = (table, code) =>
  new RegExp('^\\|\\s*\\`?' + code + '\\`?\\s*\\|', 'm').test(table);

// ---- 1. schema of every row ----
const OWNERS = ['author', 'runtime', 'tool-behavior'];
const SEVERITIES = ['error', 'warn', 'info'];
const MEASURED = ['present', 'absent', 'violated', 'unknown'];
const seen = new Set();
const ruleById = new Map(rules.map((r) => [r.id, r]));
for (const r of rules) {
  for (const f of ['id', 'code', 'severity', 'owner', 'detect', 'fix', 'measured'])
    if (!r[f]) fail(`${r.id || '?'}: missing field ${f}`);
  if (seen.has(r.id)) fail(`duplicate id ${r.id}`);
  seen.add(r.id);
  if (!OWNERS.includes(r.owner)) fail(`${r.id}: owner "${r.owner}" not in ${OWNERS.join('|')}`);
  if (!SEVERITIES.includes(r.severity)) fail(`${r.id}: severity "${r.severity}" invalid`);
  if (!MEASURED.includes(r.measured)) fail(`${r.id}: measured "${r.measured}" invalid`);
  // Only author-owned markup can be asked for in a prompt. Asking for runtime output is the mistake
  // T1 exists to prevent, so a non-null ask on those rows is a defect, not a nicety.
  // An ask is text a prompt shows to the design tool. For an author-owned rule it is a requirement,
  // so it must exist. For a tool-behavior rule it is a request the tool may refuse (T4 proves which
  // ones move), so it may exist. For a runtime-owned rule it is a lie about a capability: the bytes
  // live in a generated bundle, so no ask is ever allowed there.
  if (r.owner === 'author' && !r.ask) fail(`${r.id}: owner author requires an ask string`);
  if (r.owner === 'runtime' && r.ask) fail(`${r.id}: owner runtime must not carry an ask`);
  // ---- prompt participation ----
  if (!['ask', 'silent'].includes(r.prompt)) fail(`${r.id}: prompt must be ask|silent, got ${r.prompt}`);
  if (r.topic && !/^[a-z][a-z0-9-]*$/.test(r.topic)) fail(`${r.id}: topic "${r.topic}" must be lowercase kebab`);
  if (r.prompt === 'ask' && !r.ask) fail(`${r.id}: prompt ask requires ask text`);
  if (r.prompt === 'ask' && r.owner === 'runtime')
    fail(`${r.id}: a runtime-owned rule cannot be asked for; it is the mistake T1 exists to prevent`);
  if (r.owner === 'runtime' && r.prompt !== 'silent')
    fail(`${r.id}: runtime-owned rules are always silent`);
  // Grouping is how the prompt stays readable, so a row that speaks must have a place to land.
  if (r.prompt === 'ask' && !r.topic) fail(`${r.id}: prompt ask requires a topic for grouping`);
  // A silent row may be silent because another row carries the ask. That pointer has to resolve,
  // otherwise the ask exists nowhere and the requirement quietly vanished from the prompt.
  if (r.promptCarriedBy) {
    const carrier = ruleById.get(r.promptCarriedBy);
    // One fail per defect and no crash: a dangling pointer is reported, and the carrier-dependent
    // checks are skipped because there is nothing to compare against.
    if (!carrier) fail(`${r.id}: promptCarriedBy points at ${r.promptCarriedBy}, which is not a rule`);
    else {
      if (carrier.prompt !== 'ask')
        fail(`${r.id}: carried by ${r.promptCarriedBy}, which does not carry an ask either`);
      if (carrier.topic !== r.topic)
        fail(`${r.id} (topic ${r.topic}) carried by ${carrier.id} (topic ${carrier.topic}): carriers must share the topic`);
    }
  }
  // A silent row is silent for a reason: either nobody can write it, or a human deferred it.
  if (r.prompt === 'silent' && r.owner !== 'runtime' && !r.promptNote)
    fail(`${r.id}: silent but not runtime-owned, so it needs a promptNote saying who deferred it and why`);
}

// ---- 2. severity agrees with the spec/07 catalog ----
for (const r of rules) {
  if (r.severity === 'info') continue; // report-only codes live outside the two tables
  const [table, label] = r.severity === 'error' ? [errorTable, 'errors'] : [warnTable, 'warnings'];
  if (!tableHas(table, r.code))
    fail(`${r.id}: code ${r.code} (severity ${r.severity}) is not in spec/07 "${label}" table`);
}

// ---- 3. the reverse direction: a catalog code no row owns is unenforceable ----
const tableRows = (errorTable + '\n' + warnTable).split('\n');
const codeCell = /^\|\s*`?([a-z][a-z0-9-]+)`?\s*\|/;
const codesInTables = [...new Set(tableRows.map((l) => codeCell.exec(l)?.[1]).filter((c) => c && c !== 'Code'))];
const rowCodes = new Set(rules.map((r) => r.code));
for (const code of codesInTables) {
  if (rowCodes.has(code)) continue;
  // Emission-side codes are named in spec/07 as outside the contract table; only flag a code that
  // appears in a table and is not mentioned in the explanatory prose either.
  const mentions = (spec07.match(new RegExp('`?' + code + '`?', 'g')) || []).length;
  // once in its own table row, plus at least one prose mention to explain why no rule owns it
  if (mentions <= 1) fail(`spec/07 code ${code} has no rule row and no explanation in the prose`);
}

// ---- 4. prompt text is generated from rows, so an unsatisfiable ask must be marked ----
for (const r of rules) {
  if (!r.ask) continue;
  if (/\bTBD\b|\bTODO\b/.test(r.ask)) fail(`${r.id}: ask contains an unresolved placeholder`);
}

if (problems.length) {
  console.error(`contract check FAILED (${problems.length}):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

const by = (k) => rules.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log(
  `contract OK: ${rules.length} rules | owner ${JSON.stringify(by('owner'))} | ` +
    `severity ${JSON.stringify(by('severity'))} | measured ${JSON.stringify(by('measured'))}`
);
