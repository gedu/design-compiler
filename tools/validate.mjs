#!/usr/bin/env node
// T2 contract validator: static checks over a design export, one hand-written checker per code.
//
//   node tools/validate.mjs <input-dir> [--rules <path>] [--tokens <path>] [--manifest <path>]
//                           [--brief <path>] [--json] [--out <path>] [--baseline <path>]
//                           [--update-baseline] [--help]
//
// Why each rule here exists:
// 1. This is NOT an interpreter of rule predicates. rules/contract-rules.json carries prose in
//    ask/detect/fix and no machine predicate, so every check is hand-written and keyed by code. The
//    rule file supplies severity, fix text and ownership; the checker supplies the test. A checker
//    may name the row it serves (the `rule` argument to emit) when several rows share a code, so the
//    fix a human reads matches the evidence found. Default row: the author-owned one, else the first
//    row carrying that code. A code with no row is a defect in the table: exit 2.
// 2. Static analysis only: source text, never a browser, never tools/probe.mjs, never Playwright.
//    Every check that needs a rendered box is listed in the unimplemented array instead of faked --
//    spec/07: a check that has only ever complained has never been shown to pass, so faking one
//    makes a clean case look proven when it never ran.
// 3. Determinism (invariant 1): no timestamps, no durations, no absolute paths in the report, and
//    diagnostic paths are relative to <input-dir>. Diagnostics sort by severity, code, file, line,
//    node, rule -- never insertion order -- and no Map/Set iteration order reaches the output.
// 4. Refuse instead of invent (invariant 3): exit 3 is reserved for the one case where the input
//    needs a decision no rule can supply -- a data-overlay naming a box nothing declares.
//
// Exit codes (normative; spec/09 says exit code 0 only on zero errors, so warnings alone exit 0):
//   0  zero error-severity findings
//   1  at least one error-severity finding (or a baseline count changed)
//   2  bad invocation or malformed rule/config data (rules file, baseline file)
//   3  refusal: the input needs a decision no rule can supply
//   4  input unreadable or malformed: a template that cannot be read or parsed, invalid JSON in an
//      input .json that is present (tokens.json, MANIFEST.json, decisions.json)
// Precedence 2, then 4, then 3, then 1. A refusal is terminal and writes nothing: the report shape
// has no `refused` field, so a partial report would read as a clean run.
//
// Baseline: --baseline compares per-code counts and totals against a recorded file; drift goes to
// stderr and forces exit 1, because a count change is a spec/10 classification event (design-side,
// converter-side, mapping-side, or a real design gap) and not something to scroll past.
// --update-baseline records the current counts and NEVER writes anything under fixtures/.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXIT_USAGE = 2; // bad invocation or malformed rule/config data
const EXIT_REFUSE = 3; // the input needs a decision no rule can supply
const EXIT_INPUT = 4; // input unreadable or malformed
const CONTRACT = 'contract-rules/1'; // label for the row schema check-contract.mjs enforces
const BASELINE_KIND = 'validate-baseline/1';
const TEMPLATE_RE = /\.dc\.html$/;
const WIDTH_CLASSES = new Set(['compact', 'medium', 'expanded', 'desktop', 'dark']);
const SEV_RANK = { error: 0, warn: 1, info: 2 };
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ICON_FONT = /material symbols|symbols|icon/i;
const FONT_HOST = /fonts\.googleapis\.com|fonts\.gstatic\.com|typekit|font\.com|cdn\.jsdelivr|unpkg\.com/i;
const REMOTE = /^(?:https?:|\/\/)/i;
const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g;
// Placeholder filler the probe export never needed: the words the spec names, nothing invented.
const COPY_WORDS = ['lorem', 'ipsum', 'placeholder text', 'todo', 'fixme', 'tbd', 'x{4,}'];
// Build output and capture artifacts are not export frames; screens/ holds per-frame captures.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.vendor', 'out', 'screens']);

const USAGE =
  'usage: node tools/validate.mjs <input-dir> [--rules <path>] [--tokens <path>] ' +
  '[--manifest <path>] [--brief <path>] [--json] [--out <path>] [--baseline <path>] ' +
  '[--update-baseline]';

// One line on stderr: the reader is a human at a terminal, not a log pipeline.
function die(code, msg) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}
const usage = (m) => die(EXIT_USAGE, `validate: ${m}; ${USAGE}`);
const badData = (m) => die(EXIT_USAGE, `validate: bad data file, ${m}`);
const badInput = (m) => die(EXIT_INPUT, `validate: bad input, ${m}`);
const refuse = (m) => die(EXIT_REFUSE, `validate: refused, ${m}`);

// ---- arguments (the same manual loop as tools/prompt.mjs: no parser to pin) ----
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(USAGE + '\n');
  process.exit(0);
}
let input = null;
let rulesPath = join(ROOT, 'rules', 'contract-rules.json');
let tokensOpt = null;
let manifestOpt = null;
let briefOpt = null;
let asJson = false;
let outPath = null;
let baselinePath = null;
let updateBaseline = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const value = () => {
    if (i + 1 >= argv.length) usage(`${a} needs a value`);
    return argv[++i];
  };
  // An explicit relative --rules/--tokens/--manifest/--brief names an export file, so it resolves
  // against <input-dir> like every other input path; only the defaults (repo root) and --out /
  // --baseline (the working directory) are anchored elsewhere.
  const inInput = (v) => resolve(isAbsolute(v) ? v : join(input || '.', v));
  if (a === '--rules') rulesPath = inInput(value());
  else if (a === '--tokens') tokensOpt = value();
  else if (a === '--manifest') manifestOpt = value();
  else if (a === '--brief') briefOpt = value();
  else if (a === '--out') outPath = resolve(value());
  else if (a === '--baseline') baselinePath = resolve(value());
  else if (a === '--json') asJson = true;
  else if (a === '--update-baseline') updateBaseline = true;
  else if (a.startsWith('-')) usage(`unknown argument ${a}`);
  else if (input !== null) usage(`unexpected argument ${a}`);
  else input = a;
}
if (input === null) usage('missing <input-dir>');
const INPUT = resolve(input);
let inputStat;
try {
  inputStat = statSync(INPUT);
} catch {
  usage(`cannot read input directory ${input}`);
}
if (!inputStat.isDirectory()) usage(`${input} is not a directory`);

const at = (p) => resolve(isAbsolute(p) ? p : join(INPUT, p));
const rel = (p) => relative(INPUT, p).split(sep).join('/');
const exists = (p) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};
// code distinguishes the two failure families: rules/baseline are config (exit 2), the export's own
// .json files are input (exit 4).
function readJson(path, code, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    die(code, `validate: cannot read ${label} ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    die(code, `validate: ${label} ${path} is not valid JSON: ${e.message}`);
  }
}

// ---- the rule table ----
const ruleRows = (() => {
  const doc = readJson(rulesPath, EXIT_USAGE, 'rules file');
  const rows = Array.isArray(doc) ? doc : doc.rules;
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.code !== 'string'))
    badData('rules file must be an array of rule rows with a code field');
  return rows;
})();
// Preferred row per code: the author-owned one, because that is the row a design tool can satisfy
// and therefore the fix worth showing; else the first row carrying the code.
const preferred = new Map();
const rowById = new Map(ruleRows.map((r) => [r.id, r]));
for (const r of ruleRows) {
  const cur = preferred.get(r.code);
  if (!cur || (cur.owner !== 'author' && r.owner === 'author')) preferred.set(r.code, r);
}
function rowFor(code, ruleId) {
  const row = ruleId ? rowById.get(ruleId) : preferred.get(code);
  if (!row) badData(`code ${code} has no rule row${ruleId ? ` (rule ${ruleId})` : ''}, so nothing makes it fire`);
  if (ruleId && row.code !== code) badData(`rule ${ruleId} is code ${row.code}, not ${code}`);
  if (!['error', 'warn', 'info'].includes(row.severity)) badData(`rule ${row.id} has severity ${row.severity}`);
  if (!row.fix) badData(`rule ${row.id} has no fix text`);
  return row;
}

// ---- the input ----
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .flatMap((e) =>
      // A name that looks like a frame is always offered as a frame, even when it is a directory:
      // reading it then fails and the failure is reported as bad input, which is the truth about a
      // frame the export wrote as something that is not a file. Silent skipping would hide it.
      TEMPLATE_RE.test(e.name) ? [join(dir, e.name)] : e.isDirectory() ? walk(join(dir, e.name)) : []
    )
    .sort();
}
// What makes a template unparsable here, stated so exit 4 is not a mood: no bytes, a script/style/
// head block that never closes, or a comment that never closes. Anything else in HTML is repairable
// by a parser and must not be reported as malformed.
function unparsable(text) {
  if (!text.trim()) return 'empty template';
  for (const tag of ['script', 'style', 'head']) {
    const open = (text.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (text.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) return `unbalanced <${tag}> block (opened ${open}, closed ${close})`;
  }
  const c = text.lastIndexOf('<!--');
  return c >= 0 && text.indexOf('-->', c) < 0 ? 'unterminated comment' : null;
}

const templates = walk(INPUT).map((abs) => {
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    badInput(`${rel(abs)} cannot be read: ${e.message}`);
  }
  const why = unparsable(text);
  if (why) badInput(`${rel(abs)} is not parsable: ${why}`);
  const blank = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' ')); // offsets and lines stay put
  // body: script bodies gone, so a component's own CSS-in-JS is never read as a source style.
  // markup: head and <style> bodies gone too, so the copy checks see component markup only.
  const body = blank(text, /<script[\s\S]*?<\/script>/g);
  const markup = blank(blank(body, /<head[\s\S]*?<\/head>/g), /<style[\s\S]*?<\/style>/g);
  return { rel: rel(abs), text, body, markup };
});

const tokensPath = at(tokensOpt || 'tokens.json');
const tokensExists = exists(tokensPath);
const tokens = tokensExists ? readJson(tokensPath, EXIT_INPUT, 'token file') : null;
const manifestPath = at(manifestOpt || 'MANIFEST.json');
const manifestExists = exists(manifestPath);
const manifest = manifestExists ? readJson(manifestPath, EXIT_INPUT, 'manifest file') : null;
// A brief has two accepted spellings; --brief overrides both and, naming one explicitly, still has
// to exist: an override pointing at nothing means no brief, which is the finding, not a silent pass.
const briefPath = briefOpt
  ? (exists(at(briefOpt)) ? at(briefOpt) : null)
  : [join(INPUT, 'decisions.json'), join(INPUT, 'DESIGN-BRIEF.md')].find((p) => exists(p)) || null;
const tokensCssPath = join(INPUT, 'tokens.css');
const tokensCss = exists(tokensCssPath) ? readFileSync(tokensCssPath, 'utf8') : null;
const allSource = templates.map((t) => t.text).join('\n') + '\n' + (tokensCss || '');

// ---- the report under construction ----
const diagnostics = [];
const unimplemented = [];
const refusals = [];
const ordinals = new Map();
// Ordinals are keyed by file, code and evidence string, assigned in scan order, so a node id is
// reproducible without exposing an object identity or a Map's insertion order. `node` on a scan hit
// is the evidence string; the ordinal makes two identical hits in one file distinguishable.
function emit(code, d, msg, rule) {
  const row = rowFor(code, rule);
  const evidence = d.node || 'file';
  const k = `${d.file}\u0000${code}\u0000${evidence}`;
  const n = (ordinals.get(k) || 0) + 1;
  ordinals.set(k, n);
  const diag = {
    code,
    severity: row.severity,
    rule: row.id,
    file: d.file,
    line: d.line == null ? 1 : d.line,
    node: `${evidence} #${n}`,
    message: msg,
    fix: row.fix,
  };
  diagnostics.push(diag);
  // Returned so one check can lower the severity of a sub-case it can only hint at (see
  // checkAnimationRequired and checkJsDependentPaint). A checker may only ever go DOWN from the row's
  // severity: the row states what a proven violation costs, and static evidence that falls short of
  // proof must not stop a run.
  return diag;
}

// ---- shared source reads ----
const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;
const hitAt = (tpl, idx, text, node) => ({ file: tpl.rel, line: lineAt(text, idx), node });
// A hit inside a style chunk: the chunk knows its own start line, so the file line is the offset of
// the match inside the chunk added to that start.
const hitLine = (tpl, c, idx, node) => ({ file: tpl.rel, line: c.line + lineAt(c.text, idx) - 1, node });
const attrValue = (attrs, name) => {
  const m = new RegExp(`(?<![-\\w])${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return m ? m[1] : null;
};
const hasAttr = (attrs, ...names) => names.some((n) => attrValue(attrs, n) !== null);
const TRIM = (s) => s.trim().slice(0, 60);

// Opening tags, for checks that care about one element's own attributes.
function tags(tpl) {
  const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  const out = [];
  while ((m = re.exec(tpl.body))) out.push({ tag: m[1], attrs: m[2], ...hitAt(tpl, m.index, tpl.body, m[1]) });
  return out;
}
// Source styles: every style="..." attribute and every <style> block body, each tagged with the
// element it belongs to so a node description names one.
function chunks(tpl) {
  const out = [];
  let m;
  const open = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  while ((m = open.exec(tpl.body))) {
    // Match the whole opening tag first, then pull its style out: an element may carry data-icon on
    // either side of style=, and a check has to see both.
    const style = /(?<![-\w])style\s*=\s*"([^"]*)"/.exec(m[2]);
    if (!style) continue;
    out.push({ tag: m[1], kind: 'style-attr', attrs: m[2], text: style[1], ...hitAt(tpl, m.index, tpl.body, m[1]) });
  }
  const block = /<style[^>]*>([\s\S]*?)<\/style>/g;
  while ((m = block.exec(tpl.text)))
    out.push({ tag: 'style', kind: 'style-block', attrs: '', text: m[1], ...hitAt(tpl, m.index, tpl.text, 'style') });
  return out.sort((a, b) => a.line - b.line);
}
// Text runs with their element's attributes: the copy two checks need in context. `idx` is kept so a
// caller can ask which construct the run sits inside.
function runs(tpl) {
  const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)>([^<]*)/g;
  let m;
  const out = [];
  while ((m = re.exec(tpl.markup))) {
    const text = m[3].trim();
    if (text)
      out.push({ tag: m[1], attrs: m[2], text, idx: m.index, ...hitAt(tpl, m.index, tpl.markup, m[1]) });
  }
  return out;
}
// Every declaration of one property across both style kinds, with the file, the line and the element
// it sits on, so a check can report without knowing which kind of style carried it.
function decls(tpl, prop) {
  const re = new RegExp(`(?<![-\\w])(${prop})\\s*:\\s*([^;{}]*)`, 'gi');
  const out = [];
  for (const c of chunks(tpl)) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(c.text)))
      out.push({
        prop: m[1].toLowerCase(),
        value: m[2].trim(),
        tag: c.tag,
        ...hitLine(tpl, c, m.index, `${c.tag}[style*="${m[1].toLowerCase()}"]`),
      });
  }
  return out;
}
// Repetition blocks: the only thing in source that states "this markup exists more than once".
// Text outside one belongs to a single instance, so it cannot be shown to vary between instances.
function repetitions(tpl) {
  const spans = [];
  const re = /<sc-for\b[^>]*>[\s\S]*?<\/sc-for>/g;
  let m;
  while ((m = re.exec(tpl.markup))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}
// Each {{ }} placeholder in a template body, as a scan hit. LOUD CAVEAT for the check that uses it:
// the real check needs the materializer (T2.5/T6) to render with scripts disabled and compare trees.
// A placeholder is a static PROXY for that and is not a substitute -- a frame with no placeholder can
// still need script to paint, and one with a placeholder may paint fine.
function placeholders(tpl) {
  const re = new RegExp(PLACEHOLDER.source, 'g');
  let m;
  const out = [];
  while ((m = re.exec(tpl.body))) {
    const hit = hitAt(tpl, m.index, tpl.body, `*["{{ ${m[1]} }}"]`);
    out.push({ ...hit, text: `{{ ${m[1]} }}` });
  }
  return out;
}
// Parenthesized argument list from its open paren; null when unbalanced, so a malformed value is
// skipped rather than guessed at.
function balanced(text, openAt) {
  let depth = 0;
  for (let i = openAt; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(openAt + 1, i);
    else if (depth < 0) return null;
  }
  return null;
}

// ---- the 24 checks ----

// Serves token-file-present and token-file-type-scale (both code tokens-missing). An absent file is
// this code; a present-but-unparsable one is exit 4, because that is broken input, not a broken
// contract. The map half names the row that asks for the maps.
function checkTokensMissing() {
  const file = rel(tokensPath);
  if (!tokensExists)
    return emit('tokens-missing', { file, node: 'tokens file' }, `no token file at ${tokensOpt || 'tokens.json'}, so the frames reference properties nothing defines`);
  for (const map of ['typography', 'shape', 'spacing']) {
    const v = tokens[map];
    if (v && typeof v === 'object' && Object.keys(v).length) continue;
    emit('tokens-missing', { file, node: `tokens.json ${map}` }, `token file has no ${map} map, so ${map} has no scale to compile against`, 'token-file-type-scale');
  }
}

// Serves token-file-both-schemes: the role-key sets of color.light and color.dark, one finding per
// role present on one side only. No schemes at all is tokens-missing's story, not this one.
function checkTokensIncompleteScheme() {
  if (!tokensExists) return;
  const schemes = ['light', 'dark'];
  const roles = schemes.map((s) => Object.keys(tokens.color?.[s] || {}));
  if (!roles[0].length && !roles[1].length) return;
  const file = rel(tokensPath);
  schemes.forEach((s, side) => {
    for (const role of roles[side])
      if (!roles[1 - side].includes(role))
        emit('tokens-incomplete-scheme', { file, node: `color.${s}.${role}` }, `role ${role} is in color.${s} and absent from color.${schemes[1 - side]}`);
  });
}

// Serves manifest-declares-design-system: the design system, the seed the palette came from, and the
// states of every screen. A missing manifest is reported here too -- a contract file nobody exported
// still breaks the contract, and skipping it silently would hide exactly that.
function checkManifestIncomplete() {
  const file = rel(manifestPath);
  const screens = Array.isArray(manifest?.screens) ? manifest.screens : [];
  if (!manifestExists)
    return emit('manifest-incomplete', { file, node: 'manifest' }, `no ${manifestOpt || 'MANIFEST.json'} to read the design system, the seed or the screen states from`);
  if (typeof manifest.designSystem !== 'string' || !manifest.designSystem.trim())
    emit('manifest-incomplete', { file, node: 'manifest.designSystem' }, 'manifest states no design system, so the palette has no source to check against');
  const hex = manifest.seedColor?.hex;
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex))
    emit('manifest-incomplete', { file, node: 'manifest.seedColor.hex' }, `seed color is ${hex === undefined ? 'absent' : JSON.stringify(hex)}, not a #RRGGBB literal`);
  if (!screens.length) emit('manifest-incomplete', { file, node: 'manifest.screens' }, 'manifest names no screens');
  screens.forEach((s, i) => {
    if (Array.isArray(s?.states) && s.states.length) return;
    emit('manifest-incomplete', { file, node: `manifest.screens[${i}] ${s?.id || 'entry ' + i}` }, `screen ${s?.id || 'entry ' + i} declares no states`);
  });
}

// Serves manifest-frames-declared. The real manifest carries no width field, so the only width
// declaration available in source is the id's last dot-segment; that is accepted as declared and
// anything else is reported rather than assumed. Frames on disk the manifest never names are the
// other half of the same row: a frame nobody asked for.
function checkFrameWidthUnknown() {
  // Which on-disk frame a manifest string names: files and html fields carry the real name, a screen
  // id carries no extension at all. Only the three spellings below are considered, so an unrelated
  // manifest string (or a capture .png) cannot make an unnamed frame look declared.
  const frameName = (s) => {
    const base = basename(s);
    if (base.endsWith('.dc.html')) return base;
    if (base.endsWith('.html')) return base.slice(0, -'.html'.length) + '.dc.html';
    return base + '.dc.html';
  };
  const named = new Set();
  const screens = Array.isArray(manifest?.screens) ? manifest.screens : [];
  for (const s of screens) for (const k of ['html', 'id']) if (typeof s?.[k] === 'string') named.add(frameName(s[k]));
  for (const f of manifest?.files || []) if (TEMPLATE_RE.test(f?.path || '')) named.add(frameName(f.path));
  const file = rel(manifestPath);
  for (const s of screens) {
    const id = typeof s?.id === 'string' ? s.id : null;
    if (id && !WIDTH_CLASSES.has(id.split('.').pop().toLowerCase()))
      emit('frame-width-unknown', { file, node: `manifest.screens ${id}` }, `screen ${id} carries no width class in its id and the manifest states no width field`);
  }
  for (const tpl of templates)
    if (!named.has(basename(tpl.rel)))
      emit('frame-width-unknown', { file: tpl.rel, node: 'frame on disk' }, `${tpl.rel} is on disk but no manifest entry names it`);
}

// Serves brief-decisions-file: without a brief the invented values stay invisible. A warn, not an
// error, because the export is still compilable without it.
function checkBriefMissing() {
  if (briefPath) return;
  emit('brief-missing', { file: briefOpt || 'decisions.json', node: 'brief file' }, 'no decisions.json and no DESIGN-BRIEF.md, so invented values are recorded nowhere');
}

// The token files, by basename. The manifest ships them as their own files and token-file-present is
// measured present on the reference export, so a link that resolves to one of them is the contract
// working as designed, not a violation. color-literal excludes the same set for the same reason.
const TOKEN_BASENAMES = new Set([basename(tokensPath), 'tokens.css', 'Color.kt']);
const isTokenFile = (href) => TOKEN_BASENAMES.has(basename(href.split('?')[0]));

// Serves css-inline-no-external: a stylesheet the export fetches is a stylesheet the compiler never
// sees. The token file is excluded (see TOKEN_BASENAMES): this code is about layout CSS living
// somewhere other than the file that uses it, not about the token file existing at all. A remote font
// link is reported here AND by remote-resource AND by webfont-remote on purpose -- one URL, three
// different fixes (inline it / ship it locally / drop the webfont), and CI reads all three.
function checkCssExternal() {
  for (const tpl of templates) {
    let m;
    const link = /<link\b((?:"[^"]*"|'[^']*'|[^>"'])*?)>/g;
    while ((m = link.exec(tpl.body))) {
      if (!/rel\s*=\s*["']?stylesheet/i.test(m[1])) continue;
      const href = attrValue(m[1], 'href') || 'no href';
      if (isTokenFile(href)) continue;
      emit('css-external', hitAt(tpl, m.index, tpl.body, `link[rel=stylesheet][href="${TRIM(href)}"]`), `links an external stylesheet: ${href}`);
    }
    for (const c of chunks(tpl)) {
      const imp = /@import\s+[^;}]*/g;
      while ((m = imp.exec(c.text))) {
        const target = /url\(['"]?([^'")]+)|["']([^"']+)|\s*([^\s;]+)/.exec(m[0].slice(7));
        const path = target ? (target[1] || target[2] || target[3]).trim() : '';
        if (isTokenFile(path)) continue;
        emit('css-external', hitLine(tpl, c, m.index, `${c.tag}[style*="@import"]`), `imports a stylesheet: ${TRIM(m[0])}`);
      }
    }
  }
}

// Serves no-remote-image and no-remote-links-emitted. Every occurrence counts: the probe measured 10
// remote URLs across 5 templates, and a per-file count is what makes a regression visible.
function checkRemoteResource() {
  for (const tpl of templates) {
    const hits = [];
    let m;
    const attr = /\b(href|src)\s*=\s*"([^"]*)"/g;
    while ((m = attr.exec(tpl.body))) if (REMOTE.test(m[2])) hits.push([m.index, m[2]]);
    const url = /url\(\s*['"]?([^'")\s]*)/g;
    while ((m = url.exec(tpl.body))) if (REMOTE.test(m[1])) hits.push([m.index, m[1]]);
    for (const [idx, target] of hits)
      emit('remote-resource', hitAt(tpl, idx, tpl.body, `*[href|src*="${TRIM(target)}"]`), `references a remote resource: ${target}`);
  }
}

// Serves font-stack-platform-default (the author-owned row of webfont-remote): a font arriving from a
// CDN cannot be expressed as the platform stack the targets start from.
function checkWebfontRemote() {
  for (const tpl of templates) {
    let m;
    const link = /<link\b((?:"[^"]*"|'[^']*'|[^>"'])*?)>/g;
    while ((m = link.exec(tpl.body))) {
      const href = attrValue(m[1], 'href') || '';
      if (!FONT_HOST.test(href)) continue;
      emit('webfont-remote', hitAt(tpl, m.index, tpl.body, `link[href="${TRIM(href)}"]`), `loads a font stylesheet from a font host: ${href}`);
    }
    for (const c of chunks(tpl)) {
      const face = /@font-face\s*\{([^{}]*)\}/g;
      while ((m = face.exec(c.text))) {
        const src = /src\s*:\s*([^;]*)/.exec(m[1]);
        if (!src || !/url\(\s*["']?(?:https?:|\/\/)/i.test(src[1])) continue;
        emit('webfont-remote', hitLine(tpl, c, m.index, '@font-face'), `@font-face loads a remote font: ${TRIM(src[1])}`);
      }
    }
  }
}

// Serves no-transform-spacing-no-viewport-units. A percentage inside transform: is a legal translate
// and not a viewport unit, so that property is skipped; the property and value are named because the
// fix depends on which box property carried the unit.
function checkViewportUnits() {
  for (const tpl of templates)
    for (const d of decls(tpl, '[-a-z]+')) {
      if (d.prop === 'transform') continue;
      const unit = /(d?vh|d?vw|vmin|vmax)\b/.exec(d.value);
      if (!unit || !/[\d.]\s*$/.test(d.value.slice(0, unit.index))) continue;
      emit('viewport-units', d, `${d.prop}: ${d.value} uses a viewport unit`, 'no-transform-spacing-no-viewport-units');
    }
}

// Serves layout-flex-grid-only, whose own ask permits absolute for "an overlay that sits on top of a
// box you also declare, and mark the box it overlays". That declaration is the pair data-box plus
// data-overlay. spec/01's contract list does not carry them yet (spec/02:62 already plans a
// data-overlay, and spec/01 has its own rule that "when inference fails, add a contract field"), so
// the pair is honored here and called a proposal in the message rather than settled fact: an
// unproven allowance is not a silent pass, and a bare absolute is still reported. The one genuine
// human decision stays a refusal (exit 3): a data-overlay naming a box no element declares with
// data-box cannot be resolved by any rule.
function checkAbsoluteLayout() {
  const boxes = new Set();
  const overlays = [];
  for (const tpl of templates)
    for (const t of tags(tpl)) {
      const box = attrValue(t.attrs, 'data-box');
      if (box !== null) boxes.add(box.trim());
      const ov = attrValue(t.attrs, 'data-overlay');
      if (ov !== null) overlays.push([tpl, t, ov.trim()]);
    }
  for (const [tpl, t, ov] of overlays)
    if (!boxes.has(ov))
      refusals.push(`${tpl.rel}:${t.line} data-overlay="${ov}" names a box no element declares with data-box; which element it overlays is a decision no rule can supply`);

  for (const tpl of templates)
    for (const d of decls(tpl, 'position')) {
      if (!/^(absolute|fixed)$/.test(d.value)) continue;
      emit('absolute-layout', d, `position: ${d.value} on a ${d.tag}; no data-overlay names it, so it is bare absolute and not a declared overlay (the data-box plus data-overlay pair is a proposed contract field, not yet in spec/01)`);
    }
}

// Serves no-overflow-clip-blur-gradient: no target has one property for a blur, a clip or a
// gradient, so emitting one would be an invention.
function checkClipMissing() {
  for (const tpl of templates) {
    for (const prop of ['clip-path', 'filter', 'backdrop-filter'])
      for (const d of decls(tpl, prop)) {
        if (d.value === 'none') continue;
        emit('clip-missing', d, `${prop}: ${d.value} has no single equivalent in any target`);
      }
    for (const c of chunks(tpl)) {
      const grad = /(linear|radial|conic)-gradient\(/g;
      let m;
      while ((m = grad.exec(c.text)))
        emit('clip-missing', hitLine(tpl, c, m.index, `${c.tag}[style*="${m[1]}-gradient"]`), `a ${m[1]}-gradient is used as an effect; no target maps it to one property`);
    }
  }
}

// Serves names-kebab-ascii (not component-name-stable-across-instances, which diffs instances and is
// bridge-stage). A class token inside a {{ }} expression is not a name the design tool wrote but one
// the bridge has not resolved, so it is classified by placeholder syntax rather than by any literal
// string, and stays a warn because nothing is broken yet.
function checkComponentNameInvalid() {
  for (const tpl of templates)
    for (const t of tags(tpl)) {
      const cls = attrValue(t.attrs, 'class');
      if (cls !== null) {
        const spans = [];
        let p;
        const ph = new RegExp(PLACEHOLDER.source, 'g');
        while ((p = ph.exec(cls))) spans.push([p.index, p.index + p[0].length]);
        let off = 0;
        const bad = [];
        for (const token of cls.split(/\s+/).filter(Boolean)) {
          const i = cls.indexOf(token, off);
          off = i + token.length;
          if (!KEBAB.test(token)) bad.push({ token, ph: spans.some(([a, b]) => i >= a && i < b) });
        }
        if (bad.length)
          emit('component-name-invalid', { ...t, node: `${t.tag}[class="${TRIM(cls)}"]` }, bad.some((b) => b.ph)
            ? `class name is unresolved: ${TRIM(cls)} is a placeholder expression, the bridge must resolve it`
            : `class token ${JSON.stringify(bad[0].token)} is not ASCII kebab-case`, 'names-kebab-ascii');
      }
      const comp = attrValue(t.attrs, 'data-component');
      if (comp !== null && !KEBAB.test(comp.trim()))
        emit('component-name-invalid', { ...t, node: `${t.tag}[data-component="${TRIM(comp)}"]` }, `data-component ${JSON.stringify(comp)} is not ASCII kebab-case`, 'names-kebab-ascii');
    }
}

// Serves real-copy-no-lorem. Text content only: tags stripped, script and style bodies and the head
// removed, so a CSS comment or a component's own logic never trips a copy check.
function checkLoremIpsum() {
  for (const tpl of templates)
    for (const r of runs(tpl)) {
      const hit = COPY_WORDS.find((w) => new RegExp(w === 'x{4,}' ? w : `\\b${w}\\b`, 'i').test(r.text));
      if (hit) emit('lorem-ipsum', { ...r, node: `${r.tag}[text*="${hit}"]` }, `copy contains placeholder filler (${hit}): ${TRIM(r.text)}`);
    }
}

// Serves no-pseudo-element-content. A decorative rule (empty, none, normal, or one character such as
// a bullet) is allowed: the violation is text or an icon no extractor can reach as a node.
function checkPseudoContent() {
  for (const tpl of templates)
    for (const c of chunks(tpl)) {
      const re = /([^{};]*)::?(before|after)\s*\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(c.text))) {
        const content = /\bcontent\s*:\s*([^;]*)/.exec(m[3]);
        if (!content) continue;
        const v = content[1].trim();
        const bare = v.replace(/^["']|["']$/g, '');
        if (v === 'none' || v === 'normal' || bare.length <= 1) continue;
        emit('pseudo-content', hitLine(tpl, c, m.index, `${TRIM(m[1] || '*')}::${m[2]}`), `::${m[2]} carries content: ${v}, which no extractor can read as a node`);
      }
    }
}

const HEX_RE = /(^|[^0-9a-zA-Z#-])#([0-9a-fA-F]{3,8})(?![0-9a-zA-Z])/g;
const COLOR_FN_RE = /\b(rgba?|hsla?|color)\s*\(/g;

// Serves no-literal-hex-outside-tokens. The token files are excluded by scope, not suppressed: this
// check reads template styles only, and tokens.css, tokens.json and Color.kt are where a literal is
// supposed to live -- the reference manifest itself calls tokens.css "the only file with literal
// colors besides tokens.json and Color.kt".
function checkColorLiteral() {
  for (const tpl of templates)
    for (const c of chunks(tpl)) {
      let m;
      HEX_RE.lastIndex = 0;
      while ((m = HEX_RE.exec(c.text)))
        emit('color-literal', hitLine(tpl, c, m.index, `${c.tag}[style*="#${m[2]}"]`), `literal color #${m[2]} in a template style instead of a token property`, 'no-literal-hex-outside-tokens');
      COLOR_FN_RE.lastIndex = 0;
      while ((m = COLOR_FN_RE.exec(c.text)))
        emit('color-literal', hitLine(tpl, c, m.index, `${c.tag}[style*="${m[1]}("]`), `color function ${m[1]}() writes a color value instead of referencing a role`, 'no-literal-hex-outside-tokens');
    }
}

// Serves no-alpha-of-role-or-color-mix and, for the background case, no-gradient-background: alpha on
// a role color is a second color the system never defined, and a gradient background is a surface it
// never had.
function checkColorAlphaOfRole() {
  for (const tpl of templates)
    for (const c of chunks(tpl)) {
      const found = [];
      let m;
      const mix = /color-mix\s*\(/g;
      while ((m = mix.exec(c.text))) found.push([m.index, 'color-mix() blends two colors into one no role names', 'no-alpha-of-role-or-color-mix']);
      COLOR_FN_RE.lastIndex = 0;
      while ((m = COLOR_FN_RE.exec(c.text))) {
        const inner = balanced(c.text, m.index + m[0].length - 1);
        if (inner === null) continue;
        const commas = (inner.match(/,/g) || []).length;
        const alpha = /\/\s*[\d.]/.test(inner) || (/a\)?$/.test(m[1]) ? commas >= 3 : commas >= 4);
        if (alpha) found.push([m.index, `${m[1]}(${TRIM(inner)}) puts alpha on a color value`, 'no-alpha-of-role-or-color-mix']);
      }
      const bg = /background(?:-image)?\s*:\s*[^;{}]*((?:linear|radial|conic)-gradient)\(/g;
      while ((m = bg.exec(c.text))) found.push([m.index, `background uses ${m[1]}() instead of a surface or container tier`, 'no-gradient-background']);
      for (const [idx, msg, rule] of found)
        emit('color-alpha-of-role', hitLine(tpl, c, idx, `${c.tag}[style*="${TRIM(msg.split(' ')[0])}"]`), msg, rule);
    }
}

// Shared signal for icon-unnamed and icon-font, which stay two diagnostics because they carry
// different fixes: one asks for a name, the other for inline SVG. An inline style attribute pairs
// with its own element, so data-icon is read exactly. A <style> block rule names no element, so its
// rule body is all there is to look for a name on -- authors do not put data-icon in a rule, so a
// block hit is unnamed, and that is as far as a static pass can honestly go.
// The one icon-font signal, shared by the two icon codes and by the copy check that has to tell a
// glyph name from copy. A style attribute can be read against its own element; a <style> block rule
// cannot be paired with one at all, so its rule body is the only place a name could sit, and no
// author writes data-icon there. Reporting such a hit as unnamed is as far as a static pass goes.
const ICON_FAMILY_DECL = /(?<![-\w])font-family\s*:\s*([^;{}]+)/;
const iconFamily = (styleText) =>
  (ICON_FAMILY_DECL.exec(styleText) || /(?<![-\w])font\s*:\s*([^;{}]+)/.exec(styleText))?.[1]?.trim().replace(/;+$/, '') || null;
function iconFontNodes(tpl) {
  const out = [];
  for (const c of chunks(tpl)) {
    const family = iconFamily(c.text);
    if (!family || !ICON_FONT.test(family)) continue;
    const named = c.kind === 'style-attr' && hasAttr(c.attrs, 'data-icon');
    out.push({ file: tpl.rel, line: c.line, node: `${c.tag}[style*="font-family"]`, tag: c.tag, family, named });
  }
  return out;
}

// Serves icon-named: with no name there is nothing to look the asset up by, so the placeholder box a
// converter emits is a guess at a size.
function checkIconUnnamed() {
  for (const tpl of templates)
    for (const n of iconFontNodes(tpl)) {
      if (n.named) continue;
      emit('icon-unnamed', n, `${n.tag} draws a glyph from icon font ${JSON.stringify(n.family.slice(0, 40))} with no data-icon name`);
    }
}

// Serves icon-inline-svg: a glyph font cannot be converted, only referenced, so every glyph is a debt
// the target project inherits.
function checkIconFont() {
  for (const tpl of templates)
    for (const n of iconFontNodes(tpl))
      emit('icon-font', n, `${n.tag} draws an icon from icon font ${JSON.stringify(n.family.slice(0, 40))} instead of inline SVG`);
}

// Serves dark-reachable-prefers-color-scheme. That a dark scheme exists is proven from the token
// file's color.dark or from a .md-dark / .dark class selector in source; the media query is looked
// for in every template and in the token CSS. Reported once per file that should carry it.
function checkDarkOnlyViaJs() {
  if (/@media[^{]*prefers-color-scheme\s*:\s*dark/.test(allSource)) return;
  const darkDeclared =
    Object.keys(tokens?.color?.dark || {}).length > 0 || /\.md-dark|\.dark(?![\w-])/.test(allSource);
  if (!darkDeclared) return;
  const carriers = templates.length ? templates.map((t) => t.rel) : tokensCss ? [rel(tokensCssPath)] : [];
  for (const file of carriers)
    emit('dark-only-via-js', { file }, 'a dark scheme exists but this file never reaches it through a media query');
}

// Serves states-as-markup (severity from that row, never hardcoded): a state that only a transition,
// a keyframe or a style-<state> attribute paints is a state no converter can reach.
// Serves states-as-markup (severity from that row, never hardcoded). Two sub-cases with two different
// truths, so they are split inside this one checker:
//   - a style-<state> attribute or an `animation:` paints a state no markup block reaches: that is
//     the violation the row means, and it keeps the row's severity.
//   - a bare `transition:` or an `@keyframes` block is decorative motion. It gates no state: the end
//     state of a transition is the same markup, and a keyframe that nothing reads as a state is a
//     visual detail. Reported as info (never above the row) so a human sees it without a run stopping
//     on a blur of pixels.
function checkAnimationRequired() {
  for (const tpl of templates) {
    for (const d of decls(tpl, 'animation'))
      emit('animation-required', d, `animation: ${d.value} is how this state is reached, and states must be markup`);
    for (const d of decls(tpl, 'transition'))
      emit('animation-required', d, `transition: ${d.value} is decorative motion that gates no state; noted, not a violation`).severity = 'info';
    for (const c of chunks(tpl)) {
      const kf = /@keyframes\s+([\w-]+)/g;
      let m;
      while ((m = kf.exec(c.text)))
        emit('animation-required', hitLine(tpl, c, m.index, `@keyframes ${m[1]}`), `@keyframes ${m[1]} is decorative motion that gates no state; noted, not a violation`).severity = 'info';
    }
    let m;
    const st = /(?<![-\w])(style-(?:hover|pressed|focus|focus-visible|active|disabled))\s*=\s*"([^"]*)"/g;
    while ((m = st.exec(tpl.body)))
      emit('animation-required', hitAt(tpl, m.index, tpl.body, `*[${m[1]}]`), `the ${m[1]} attribute paints a state no markup block reaches`);
  }
}

// Serves grid-min-declared: the minimum cell width is a decision, and deriving it from the captured
// track width is measuring an accident.
function checkGridMinUndeclared() {
  for (const tpl of templates) {
    if (/(?<![-\w])data-grid-min\s*=/.test(tpl.text)) continue;
    for (const d of decls(tpl, 'display'))
      if (d.value === 'grid') emit('grid-min-undeclared', d, 'display: grid with no data-grid-min anywhere in this file');
  }
}

// Serves prop-schema-declared (the only row for this code): a clickable with nothing to name its
// callback from gets a TODO instead of an API.
function checkCallbackInferred() {
  const HANDLERS = ['onClick', 'onTap', 'onChange', 'onInput'];
  const NAMES = ['aria-label', 'aria-labelledby', 'title', 'data-action'];
  for (const tpl of templates)
    for (const t of tags(tpl)) {
      const handler = HANDLERS.find((h) => attrValue(t.attrs, h) !== null);
      if (!handler || hasAttr(t.attrs, ...NAMES)) continue;
      emit('callback-inferred', { ...t, node: `${t.tag}[${handler}]` }, `${t.tag} carries ${handler} with no label, title or data-action to name the callback from`);
    }
}

// Serves varying-text-marked-as-prop. Conservative on purpose: only a file that already declares a
// data-props schema is held to it, and only a bare literal run that carries no data-prop itself is
// reported, so copy the frame resolves through {{ }} stays out of it.
// Serves varying-text-marked-as-prop. The rule is about text that varies BETWEEN INSTANCES of one
// component, and the only thing in source that states instance repetition is an <sc-for> block: text
// outside one belongs to a single element, so claiming it is welded-in varying copy would be a guess.
// The data-props schema gate stays: a file that declares no schema has never claimed to be a
// parameterised component. A run whose element sets an icon font family is excluded because a glyph
// name (check_circle, wifi) is a codepoint selector, not copy -- and the exclusion is that font test
// ONLY, never a pattern match against the text itself, which would be guessing at a wordlist.
function checkPropUndeclared() {
  for (const tpl of templates) {
    if (!/(?<![-\w])data-props\s*=/.test(tpl.text)) continue;
    const repeated = repetitions(tpl);
    if (!repeated.length) continue;
    for (const r of runs(tpl)) {
      if (!/[A-Za-z]/.test(r.text) || r.text.includes('{{') || hasAttr(r.attrs, 'data-prop')) continue;
      if (!repeated.some(([a, b]) => r.idx >= a && r.idx < b)) continue;
      const family = iconFamily(r.attrs);
      if (family && ICON_FONT.test(family)) continue;
      emit('prop-undeclared', { ...r, node: `${r.tag}[text="${TRIM(r.text)}"]` }, `literal copy ${JSON.stringify(TRIM(r.text))} repeats with the instance and carries no data-prop, so it is welded into the component`);
    }
  }
}

// The static proxy: see the caveat on placeholders(). Reported as info, below the row's error
// severity, because a placeholder cannot support an error -- claiming one would stop a run for a
// symptom that may not exist. Info never affects the exit code. When the materializer exists this
// check is replaced, not upgraded.
// Serves js-dependent-paint. The proxy deduplicates by (file, placeholder name): the unit of work in
// the repair loop is a name that must be materialized, not a string occurrence, so 256 occurrences of
// 191 names would be 65 lines of noise in front of the list T4 has to act on.
function checkJsDependentPaint() {
  for (const tpl of templates) {
    const seen = new Set();
    for (const p of placeholders(tpl)) {
      if (seen.has(p.text)) continue;
      seen.add(p.text);
      emit('js-dependent-paint', p, `unresolved placeholder ${p.text}: static proxy for a first paint that needs script`).severity = 'info';
    }
  }
}

const CHECKS = [
  ['absolute-layout', checkAbsoluteLayout],
  ['animation-required', checkAnimationRequired],
  ['brief-missing', checkBriefMissing],
  ['callback-inferred', checkCallbackInferred],
  ['clip-missing', checkClipMissing],
  ['color-alpha-of-role', checkColorAlphaOfRole],
  ['color-literal', checkColorLiteral],
  ['component-name-invalid', checkComponentNameInvalid],
  ['css-external', checkCssExternal],
  ['dark-only-via-js', checkDarkOnlyViaJs],
  ['frame-width-unknown', checkFrameWidthUnknown],
  ['grid-min-undeclared', checkGridMinUndeclared],
  ['icon-font', checkIconFont],
  ['icon-unnamed', checkIconUnnamed],
  ['js-dependent-paint', checkJsDependentPaint],
  ['lorem-ipsum', checkLoremIpsum],
  ['manifest-incomplete', checkManifestIncomplete],
  ['prop-undeclared', checkPropUndeclared],
  ['pseudo-content', checkPseudoContent],
  ['remote-resource', checkRemoteResource],
  ['tokens-incomplete-scheme', checkTokensIncompleteScheme],
  ['tokens-missing', checkTokensMissing],
  ['viewport-units', checkViewportUnits],
  ['webfont-remote', checkWebfontRemote],
];

// Six codes stay unimplemented on purpose: each needs a rendered box or an instance diff that no
// source text states, and owner comes from the rule row so the report says who owes it.
const UNIMPLEMENTED = [
  ['elevation-missing', 'a visible shadow is a computed box, no source style proves one'],
  ['reflow-detected', 'needs two renders at two widths, which is a materializer run'],
  ['scroll-undeclared', 'needs scrollHeight against clientHeight, which is a materializer run'],
  ['state-variation-unstable', 'needs materialized instances of one component to diff'],
  ['style-off-scale', 'needs computed size, line height and weight against the type roles'],
  ['component-unlabeled', 'needs a subtree similarity group, which is IR-stage analysis'],
];

for (const [code] of CHECKS) rowFor(code); // a code with no row is a defect in the table, not a skip
for (const [, fn] of CHECKS) fn();
for (const [code, reason] of UNIMPLEMENTED) {
  const row = rowFor(code);
  unimplemented.push({ code, rule: row.id, owner: row.owner, reason });
}

// A refusal is terminal and nothing was written: a half report would read as a clean run.
if (refusals.length) refuse(refusals.join('; '));

// ---- assembly: nothing below may depend on the order the checks ran in ----
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
diagnostics.sort(
  (a, b) =>
    SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
    cmp(a.code, b.code) ||
    cmp(a.file, b.file) ||
    a.line - b.line ||
    cmp(a.node, b.node) ||
    cmp(a.rule, b.rule)
);
unimplemented.sort((a, b) => cmp(a.code, b.code));
const perCode = Object.fromEntries(
  CHECKS.map(([code]) => [code, diagnostics.filter((d) => d.code === code).length]).sort((a, b) => cmp(a[0], b[0]))
);
const count = (sev) => diagnostics.filter((d) => d.severity === sev).length;

const report = {
  run: { input, rules: basename(rulesPath), contract: CONTRACT },
  summary: {
    errors: count('error'),
    warnings: count('warn'),
    infos: count('info'),
    checked: CHECKS.length,
    unimplemented: unimplemented.length,
  },
  diagnostics,
  unimplemented,
  checks: CHECKS.map(([code]) => ({ code, implemented: true, findings: perCode[code] })).sort((a, b) =>
    cmp(a.code, b.code)
  ),
};

// Human output: one line per finding, then the tally, in the style of tools/check-contract.mjs.
const bytes = asJson
  ? JSON.stringify(report, null, 2) + '\n'
  : diagnostics.map((d) => `${d.code}  ${d.file}:${d.line}  ${d.message}`).join('\n') +
    (diagnostics.length ? '\n' : '') +
    `validate ${report.summary.errors ? 'FAILED' : 'OK'}: ${report.summary.checked} checks | ` +
    `errors ${report.summary.errors} | warnings ${report.summary.warnings} | ` +
    `infos ${report.summary.infos} | unimplemented ${report.summary.unimplemented}\n`;

// ---- baseline: per-code counts plus totals, no timestamps, never anything under fixtures/ ----
const baselineBytes =
  JSON.stringify(
    {
      baseline: BASELINE_KIND,
      contract: CONTRACT,
      input: basename(INPUT), // a name, not a path: no absolute path may reach a committed file
      rules: basename(rulesPath),
      codes: perCode,
      totals: {
        errors: report.summary.errors,
        findings: diagnostics.length,
        infos: report.summary.infos,
        unimplemented: unimplemented.length,
        warnings: report.summary.warnings,
      },
    },
    null,
    2
  ) + '\n';

if (updateBaseline) {
  const target = baselinePath || join(ROOT, 'baselines', `${basename(INPUT)}.json`);
  if (target.split(sep).includes('fixtures'))
    usage('--update-baseline never writes under fixtures/, the reference export is immutable input');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, baselineBytes);
}

const drift = [];
if (baselinePath) {
  const base = readJson(baselinePath, EXIT_USAGE, 'baseline file');
  if (!base || typeof base !== 'object' || !base.codes || !base.totals)
    badData(`baseline file ${baselinePath} has no codes or totals object`);
  if (base.input !== undefined && base.input !== basename(INPUT))
    badData(`baseline is for ${base.input}, not for ${basename(INPUT)}`);
  for (const [code, n] of Object.entries(perCode)) {
    const had = base.codes[code];
    if (had !== n) drift.push(`${code}: baseline ${had === undefined ? 'absent' : had}, now ${n}`);
  }
  for (const code of Object.keys(base.codes))
    if (!(code in perCode)) drift.push(`${code}: in the baseline, no longer a check here`);
  for (const k of ['errors', 'warnings', 'infos'])
    if (base.totals[k] !== report.summary[k]) drift.push(`${k}: baseline ${base.totals[k]}, now ${report.summary[k]}`);
  drift.sort();
}

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, bytes);
}
process.stdout.write(bytes);

for (const d of drift) process.stderr.write(`validate: baseline drift, ${d}\n`);
if (drift.length)
  process.stderr.write(
    'validate: a baseline count changed, so this run needs a spec/10 classification ' +
      '(design-side, converter-side, mapping-side, or a real design gap)\n'
  );

// process.exitCode and not process.exit(): a report over the pipe buffer would otherwise be cut off
// mid-string, and a consumer that cannot parse the JSON cannot act on the run.
process.exitCode = report.summary.errors > 0 || drift.length ? 1 : 0;
