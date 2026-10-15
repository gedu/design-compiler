#!/usr/bin/env node
/**
 * emit-compose.test.mjs - spec/05 for the IR -> Kotlin emitter.
 *
 * Every asserted constant here is checked against an authority OUTSIDE the emitter: tokens.json, the
 * IR facts the runtime measured, the hand-written sources in the workshop, and the Kotlin compiler
 * (which is what proved the two API premises spec/04 carried to be false: CardDefaults.cardElevation
 * has no tonalElevation, and Shapes has no full parameter). The one class of assertion that cannot be
 * externally checked is the golden, so the goldens sit under the structural tests below them.
 *
 *   node tests/emit-compose.test.mjs              # compare against the goldens
 *   node tests/emit-compose.test.mjs --update     # rewrite them (deliberate, never on a mismatch)
 *
 * Refusals are produced by mutating a COPY of the fixture in a temp dir, so fixtures/annotated is
 * never written to. A mutation that does not apply fails the test loudly rather than passing as a
 * refusal-by-accident: an earlier draft of this file reported `true` for every mutation without
 * checking, and every "refusal" it proved was a fiction.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TOOL = join(ROOT, 'tools', 'emit-compose.mjs');
const FIXTURE = join(ROOT, 'fixtures', 'annotated');
const GOLDEN = join(HERE, 'golden');
const tokens = JSON.parse(readFileSync(join(FIXTURE, 'tokens.json'), 'utf8'));
const UPDATE = process.argv.includes('--update');
const PKG = 'com.callstack.minijetcaster.ui.generated';
const PKG_DIR = 'com/callstack/minijetcaster/ui/generated';
const NAMES = ['Color.kt', 'Theme.kt', 'PodcastCard.kt'];

/**
 * Run the CLI. `mutate` receives the fixture text and must return the patched text; returning it
 * unchanged fails. `to` names a directory to write into (--write); without it the tool writes to its
 * own --out, which is pointed at the temp dir either way so no test ever touches out/.
 */
function emit({ mutate = null, to = null, base = null, dir: dirOverride = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'emit-'));
  try {
    let fixtureDir = dirOverride ?? FIXTURE;
    if (mutate) {
      fixtureDir = join(dir, 'fixture');
      cpSync(FIXTURE, fixtureDir, { recursive: true });
      const target = join(fixtureDir, 'PodcastCard.dc.html');
      const before = readFileSync(target, 'utf8');
      const after = mutate(before);
      assert.notEqual(after, before, 'the mutation did not apply -- a refusal from unmutated input proves nothing');
      writeFileSync(target, after);
    }
    const into = to ?? join(dir, 'out');
    if (to) mkdirSync(into, { recursive: true });
    const args = [TOOL, '--dir', fixtureDir];
    if (to) args.push('--write', into); else args.push('--out', into);
    if (base) args.push('--base', base);
    const proc = spawnSync(process.execPath, args, { encoding: 'utf8' });
    // The package directory follows --base, so reading a fixed path would report "no files written"
    // for any other base and turn a passing run into an undefined-text crash.
    const pkgDir = join(into, ...(base ?? 'com.callstack.minijetcaster').split('.'), 'ui', 'generated');
    const files = {};
    for (const n of NAMES) {
      const p = join(pkgDir, n);
      if (existsSync(p)) files[n] = readFileSync(p, 'utf8');
    }
    return { code: proc.status, out: proc.stdout + proc.stderr, files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The real emission, produced once, cached in module scope, and shared by the read-only assertions. */
let real = null;
function realEmission() {
  if (!real) real = emit({ to: mkdtempSync(join(tmpdir(), 'emit-real-')) });
  return real;
}

/** Strip comments: the file documents the very APIs it refuses to call, so prose is not code. */
const code = (text) => text
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

function golden(name, actual) {
  const path = join(GOLDEN, name);
  if (UPDATE) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  if (!existsSync(path)) {
    assert.fail(`no golden ${join('tests', 'golden', name)}; run node tests/emit-compose.test.mjs --update`);
  }
  assert.equal(actual, readFileSync(path, 'utf8'), `${name} differs from its golden; if the change is intended run --update`);
}

before(() => {
  const r = realEmission();
  assert.equal(r.code, 0, `the fixture should emit:\n${r.out}`);
});

// ---------- the three files, byte for byte ----------

test('the three emitted files match their goldens', () => {
  const { files } = realEmission();
  assert.deepEqual(Object.keys(files).sort(), [...NAMES].sort());
  for (const [name, text] of Object.entries(files)) golden(name, text);
});

test('determinism: two separate processes produce byte-identical files', () => {
  const a = emit({ to: mkdtempSync(join(tmpdir(), 'det-a-')) });
  const b = emit({ to: mkdtempSync(join(tmpdir(), 'det-b-')) });
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  for (const name of NAMES) {
    assert.equal(b.files[name], a.files[name], `${name} differs between processes`);
  }
});

// ---------- refuse before inventing ----------

test('the emitter writes nothing when it refuses, and says so', () => {
  const r = emit({ to: mkdtempSync(join(tmpdir(), 'ref-')), mutate: (s) => s.replace('color: var(--md-sys-color-on-surface);', 'color: rgb(1,2,3);') });
  assert.equal(r.code, 3);
  assert.match(r.out, /refused/);
  assert.deepEqual(Object.keys(r.files), [], 'a refusal must not leave a partially written package');
});

test('planWrite refuses a file it did not write and leaves it byte-identical', () => {
  const into = mkdtempSync(join(tmpdir(), 'plan-'));
  try {
    const pkgDir = join(into, PKG_DIR);
    mkdirSync(pkgDir, { recursive: true });
    const path = join(pkgDir, 'PodcastCard.kt');
    const foreign = `package ${PKG}\n\n// a human wrote this\nval Mine = 1\n`;
    writeFileSync(path, foreign);
    const r = emit({ to: into });
    assert.equal(r.code, 3);
    assert.match(r.out, /PodcastCard\.kt/);
    assert.match(r.out, /not generated by/, 'the refusal names the ownership rule it is enforcing');
    assert.equal(readFileSync(path, 'utf8'), foreign, 'a foreign file must not be touched');
  } finally {
    rmSync(into, { recursive: true, force: true });
  }
});

test('the first write creates, the second reports unchanged rather than rewriting', () => {
  const into = mkdtempSync(join(tmpdir(), 'plan2-'));
  try {
    const first = emit({ to: into });
    assert.equal(first.code, 0);
    assert.match(first.out, /create .*Color\.kt/);
    const second = emit({ to: into });
    assert.equal(second.code, 0);
    assert.match(second.out, /unchanged .*Color\.kt/);
  } finally {
    rmSync(into, { recursive: true, force: true });
  }
});

const refusals = [
  ['a color no role claims', (s) => s.replace('color: var(--md-sys-color-on-surface);', 'color: rgb(1,2,3);'), /unresolved foreground color .*refusing to emit a literal/],
  ['a callback the schema renames away from the render', (s) => s.replace('&quot;onSelect&quot;:{&quot;editor&quot;:null', '&quot;onCard&quot;:{&quot;editor&quot;:null'), /callback order disagrees/],
  ['a weight whose surviving parent is not a Row', (s) => s.replace('<div data-component="podcast-card-title" data-prop="title" style="', '<div data-component="podcast-card-title" data-prop="title" style="flex: 1; '), /flex-grow but its surviving parent is/],
];

for (const [name, mutate, expected] of refusals) {
  test(`refuses rather than guesses: ${name}`, () => {
    const r = emit({ mutate });
    assert.equal(r.code, 3, `${name} should refuse\n${r.out}`);
    assert.match(r.out, expected);
  });
}

// ---------- the parts of a green compile that could silently rot ----------

test('the code is in ui.generated and never in a hand-written package', () => {
  for (const [name, text] of Object.entries(realEmission().files)) {
    assert.match(code(text), new RegExp(`^package ${PKG}$`, 'm'));
    assert.doesNotMatch(code(text), /^package .*ui\.(theme|components)$/m, `${name} would collide with a hand-written file`);
  }
});

test('no state, no side effect, no ViewModel, no navigation in the CODE: spec/05 non-goals', () => {
  for (const [name, text] of Object.entries(realEmission().files)) {
    const src = code(text);
    for (const banned of ['remember {', 'mutableStateOf(', 'LaunchedEffect(', 'ViewModel(', 'navigate(', 'derivedStateOf(', 'collectAsState(']) {
      assert.ok(!src.includes(banned), `${name} contains ${banned}`);
    }
  }
});

test('no literal color outside DesignColors, and that block is tokens.json verbatim', () => {
  const { files } = realEmission();
  for (const [name, text] of Object.entries(files)) {
    if (name === 'Color.kt') continue;
    assert.doesNotMatch(code(text), /0xFF[0-9A-F]{8}/, `${name} hardcodes a color`);
  }
  const seen = new Map();
  for (const m of files['Color.kt'].matchAll(/val (light|dark)([A-Za-z0-9]+) = Color\(0xFF([0-9A-F]{6})\)/g)) {
    seen.set(`${m[1]}.${m[2].charAt(0).toLowerCase()}${m[2].slice(1)}`, m[3]);
  }
  const want = new Map();
  for (const scheme of ['light', 'dark']) {
    for (const [role, hex] of Object.entries(tokens.color[scheme])) want.set(`${scheme}.${role}`, hex.slice(1).toUpperCase());
  }
  assert.equal(seen.size, want.size, `the emitter added or dropped a role: ${seen.size} vs ${want.size}`);
  for (const [key, hex] of want) assert.equal(seen.get(key), hex, `${key} is not the hex tokens.json carries`);
});

test('every type role it uses is declared in tokens.json, and no copy() fakes the brand font', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  const used = [...new Set([...src.matchAll(/MaterialTheme\.typography\.(\w+)/g)].map((m) => m[1]))];
  assert.deepEqual(used.sort(), ['bodySmall', 'labelMedium', 'titleSmall'], 'the three roles this card declares, from the IR');
  for (const role of used) {
    assert.ok(tokens.typography[role], `${role} is not a typography role in tokens.json`);
  }
  assert.doesNotMatch(src, /typography\.\w+\.copy\(/, 'a copy() renames a style without providing the font');
});

test('icon: the set comes from the measured FILL axis; imports match the hand-written style', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  // Authorities: the FILL variation axis measured by the runtime (terminal 1, bookmark_add 0), and
  // the hand-written workshop card, whose imports are `androidx.compose.material.icons.filled.Terminal`
  // and `...outlined.BookmarkAdd` -- PascalCase member, lowercase package segment.
  assert.match(src, /Icons\.Filled\.Terminal\b/);
  assert.match(src, /Icons\.Outlined\.BookmarkAdd\b/);
  assert.match(src, /^import androidx\.compose\.material\.icons\.filled\.Terminal$/m);
  assert.match(src, /^import androidx\.compose\.material\.icons\.outlined\.BookmarkAdd$/m);
});

test('shape: Shapes gets the dp steps with one comma each and no full parameter', () => {
  const theme = code(realEmission().files['Theme.kt']);
  assert.doesNotMatch(theme, /,,/, 'the shape argument list must not carry a doubled comma');
  assert.doesNotMatch(theme, /^\s*full\s*=/m, 'Shapes has no `full` parameter in the pinned material3');
  assert.match(theme, /^import androidx\.compose\.ui\.unit\.dp$/m, 'the .dp extension must be imported');
  assert.match(theme, /extraLarge = RoundedCornerShape\(28\.dp\),\n\)/, 'the last step keeps one trailing comma and the call closes');
  for (const step of [4, 8, 12, 16, 28]) {
    assert.match(theme, new RegExp(`= RoundedCornerShape\\(${step}\\.dp\\)`), `the ${step}dp step from tokens.json is missing`);
  }
});

test('a declared circle with no background is reported, not welded onto an unpainted Box', () => {
  const { files } = realEmission();
  const src = code(files['PodcastCard.kt']);
  // The toggle's 40px span declares corner-full but paints `background: none` in the captured state,
  // so there is nothing for a shape to round. Emitting CircleShape there would draw nothing and look
  // like a circle had been handled.
  assert.doesNotMatch(src, /shape = CircleShape/);
  assert.match(files['PodcastCard.kt'], /declares CircleShape but paints no background in the captured state/);
});

test('elevation: data-elevation lands on the parameter the pinned library declares', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  // The compiler is the authority here, not the prose: material3 1.12.0-alpha03 declares
  // CardDefaults.cardElevation(defaultElevation, pressedElevation, focusedElevation, hoveredElevation,
  // draggedElevation, disabledElevation) and rejects tonalElevation with NAMED_PARAMETER_NOT_FOUND.
  assert.match(src, /CardDefaults\.cardElevation\(defaultElevation = 1\.dp\)/);
  assert.doesNotMatch(src, /tonalElevation/, 'the Card API in this version has no tonalElevation');
});

test('a Card carries its container in colors, never in a second background', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  assert.match(src, /colors = CardDefaults\.cardColors\(containerColor = MaterialTheme\.colorScheme\.surfaceContainer\)/);
  // Authority: the hand-written card passes colors= and no background(); Card paints its own
  // container, so a background() paints the same role twice and fights the Card's own clipping.
  assert.doesNotMatch(src, /Modifier[^\n]*background\(MaterialTheme\.colorScheme\.surfaceContainer/, 'the Card painted its container twice');
});

test('padding never mixes the two overload families in one call', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  const calls = [...src.matchAll(/\.padding\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 3, 'this card has padding to check');
  for (const args of calls) {
    const named = /\b(horizontal|vertical)\s*=/.test(args);
    const edges = /\b(start|top|end|bottom)\s*=/.test(args);
    assert.ok(!(named && edges), `mixed padding overloads: ${args}`);
  }
});

test('layout: fill for a responsive width, dp only for an authored px, weight only in a Row', () => {
  const raw = realEmission().files['PodcastCard.kt'];
  const src = code(raw);
  assert.match(src, /Modifier\.fillMaxWidth\(\)/, 'the card declares width:100%');
  assert.match(src, /\.size\(40\.dp\)/, 'the toggle circle is authored 40px');
  // The 48dp target is authored in the design AND implied by the widget: the pinned IconButton/
  // IconToggleButton KDoc states "overall minimum touch target size of 48 x 48dp", which is the
  // authority for spec/04's "do not add a size". Emitting it again would fight the widget's own
  // minimum for no visual gain. The 40px circle INSIDE it is not implied by anything, so it stays.
  assert.doesNotMatch(src, /\.size\(48\.dp\)/, 'IconToggleButton implies the 48dp target; spec/04 says do not add a size');
  // The decision is recorded in the file's own note block, which code() strips -- read the raw text
  // for it, or the check passes on the very file that forgot to say what it did.
  assert.match(raw, /IconToggleButton already implies the authored 48dp target/, 'and the decision is said in the file, not silently taken');
  assert.doesNotMatch(src, /\.height\(160\.dp\)|\.width\(160\.dp\)/, 'a computed 160 must not be welded in (spec/04 trap 5/7)');
  assert.match(src, /aspectRatio\(1f\)/);
  assert.match(src, /Modifier\.weight\(1f\)/);
  assert.match(src, /\.align\(Alignment\.BottomStart\)/, 'the category badge places itself end/start');
  assert.match(src, /contentAlignment = Alignment\.Center/, 'the cover grid and the centered flex box both center their content');
});

test('text: a clamping node gets maxLines and an ellipsis, never a captured height', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  assert.match(src, /maxLines = 2/);
  assert.match(src, /overflow = TextOverflow\.Ellipsis/);
});

test('callbacks: exactly the two the design wires, in the order the schema declares', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  const sig = src.match(/fun PodcastCard\(\n([\s\S]*?)\n\)/)[1];
  assert.deepEqual(sig.split('\n').map((l) => l.trim().replace(/,$/, '')), [
    'category: String',
    'title: String',
    'author: String',
    // spec/02: on every target the boolean stateProp becomes a parameter of the component. It sits
    // with the data it reflects, not with the callbacks -- the position authority is the hand-written
    // card this one is compared against: (podcast, subscribed, onSubscribeClick, modifier).
    // Both booleans follow the DOM order the spec/04 rule states, so the card's own `selected` (the
    // root is visited first) precedes the toggle's `subscribed`.
    'selected: Boolean',
    'subscribed: Boolean',
    'onSelect: () -> Unit',
    'onToggle: () -> Unit',
    'modifier: Modifier = Modifier',
  ]);
  assert.doesNotMatch(src, /clickable\(onClick = onSelect\)/, 'a selectable surface does not also carry a plain click: one click path per node');
  // The toggle's click belongs to the WIDGET now. IconToggleButton takes onCheckedChange, so emitting
  // clickable(onClick = onToggle) as well would compile and fire the callback twice.
  assert.match(src, /onCheckedChange = \{ onToggle\(\) \}/, 'the widget owns the click');
  assert.match(src, /checked = subscribed/, 'the boolean the design declared is bound, not hardcoded');
  assert.doesNotMatch(src, /clickable\(onClick = onToggle\)/, 'one click path per control, never two');
});

test('a clickable SURFACE gets selection semantics, and the boolean that drives it is a parameter', () => {
  // The gap this pins: spec/02 says a clickable surface "keeps its surface role... its boolean is a
  // parameter, not a toggle component", and the boolean was resolved by the capture and then DROPPED,
  // because stateProp travelled only inside node.callback and this card has no accessible name to build
  // one from. Carrier is spec/02's existing Node.states (no new field), and the target chose
  // Modifier.selectable: measured in the sources jar of the pinned foundation 1.12.1, its KDoc is the
  // mutually exclusive set, and the reference board keeps exactly one card selected at a time
  // (fixtures/reference/Home.dc.html: `selected: x.i === st.selected`). spec/04's Card row carries the
  // pressed-vs-selected tension this emits, because the design wrote aria-pressed on the same element.
  const raw = realEmission().files['PodcastCard.kt'];
  const src = code(raw);
  assert.match(src, /selectable\(selected = selected, onClick = onSelect\)/, 'the surface boolean rides the modifier, since Card has no selected parameter');
  assert.doesNotMatch(src, /clickable\(onClick = onSelect\)/, 'one click path per node, never selectable plus clickable');
  assert.doesNotMatch(src, /toggleable/, 'the reference runtime keeps ONE selection, so toggleable would be the wrong semantics');
  // The import is derived from the body like every other, and this one lives in foundation.selection,
  // not in material3 -- an import the emitter forgets is an unresolved-reference error, not a warning.
  assert.match(raw, /^import androidx\.compose\.foundation\.selection\.selectable$/m, 'the selectable import is collected');
  // And the file says where the boolean came from, so a reader can check the carrier instead of trusting
  // the emitter: naming Node.states is what makes the IR-to-Kotlin step auditable.
  assert.match(raw, /Node\.states "selected"/, 'the file names the carrier it read, not only what it emitted');
  assert.match(raw, /spec\/04/, 'and points at the row that decided selectable over toggleable');
});

test('an emission decision is said once per node, never twice', () => {
  // spec/10: this bug became a check, not a paragraph. Building the modifier once per node at the top
  // of emitNode AND again inside the cases that emit their own (Card, IconButton, IconToggleButton)
  // made modifierOf run twice for one node -- and every note it emits as a side effect landed in the
  // file TWICE. It compiled, it looked right, and the goldens certified it: the duplicate was only
  // visible because one of the two runs was on the toggle, where a doubled "negative margin" line
  // stands out. A file that describes its own decisions must describe each one exactly once, or a
  // reader cannot tell a taken decision from an artifact of the emitter's plumbing.
  const raw = realEmission().files['PodcastCard.kt'];
  const counts = new Map();
  for (const line of raw.split('\n')) {
    if (!/^\/\/ {2,}n:/.test(line)) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const doubled = [...counts].filter(([, n]) => n > 1);
  assert.deepEqual(doubled, [], 'a decision note appears more than once; two code paths emitted for one node');
  // The guard must not be vacuous: if the note block ever stopped carrying decisions, this test would
  // pass while checking nothing. The fixture is measured to produce these, so pin that it still does.
  assert.ok(counts.size >= 5, `expected the emission to explain itself (${counts.size} distinct decision notes)`);
  // Anchored on the FACT (the node and its px value are named), not on the wording: the sentence
  // around it is prose and gets reworded, and a check that breaks on punctuation is a check people
  // switch off. Measured on this fixture, the author row is the node the duplicate rode on.
  assert.match(raw, /^\/\/ {2,}n:node-0-0-0-2: CSS margin -4px top/m, 'the negative-margin note the duplicate rode on is still emitted');
});

test('no negative padding reaches the emitted code: Compose would throw at runtime', () => {
  // spec/10: this one became a check, and it is the check a compile could never be. The emitter used
  // to translate a CSS negative margin straight into Modifier.padding(top = -4.dp). That COMPILES --
  // and the app then dies on launch with IllegalArgumentException "Padding must be non-negative"
  // thrown from PaddingElement (measured on the emulator, first render of the card ever). A golden
  // diff and a compiler both bless it, because the failure is a runtime one in code that is perfectly
  // well-formed. So the assertion is made on the emitted text, comment-stripped: the file documents
  // the very value it must not emit, and code() is what keeps those two apart.
  const src = code(realEmission().files['PodcastCard.kt']);
  const neg = src.match(/padding\([^)]*-\s*[\d.]+\.dp/g) || [];
  assert.deepEqual(neg, [], `emitted padding must never be negative (Compose throws): ${neg.join(' | ')}`);
  // Non-vacuous: this fixture authors negative margins, so the honest omission MUST be reported.
  // A file that quietly dropped the whole note would pass the assertion above while hiding the loss.
  const raw = realEmission().files['PodcastCard.kt'];
  // Both nodes the fixture authors with a negative margin must be reported BY NAME, with their px
  // values. Counting sentences would tie this to prose; naming the node and the value is the part
  // that must survive any rewording. Measured on fixtures/annotated: the author row carries -4px top,
  // the toggle carries -4px on top/right/bottom (source: margin: -4px -4px -4px 0 on the button).
  assert.match(raw, /^\/\/ {2,}n:node-0-0-0-2: CSS margin -4px top/m, 'the author row names the edge it dropped');
  assert.match(raw, /^\/\/ {2,}n:podcast-card-subscribe-toggle: CSS margin -4px top, -4px right, -4px bottom/m,
    'the toggle names all three edges it dropped, not just a count');
  // And the note must say WHY, or a bare "margin dropped" would pass while hiding an illegal value.
  // Loose on purpose: the phrase, not the sentence.
  assert.match(raw, /negative padding/i, 'the omission states the Compose reason, not just the omission');
});

test('the @Preview and FakeData the design can answer exist; the screen it cannot is absent', () => {
  const src = code(realEmission().files['PodcastCard.kt']);
  assert.match(src, /@Preview\n@Composable\nprivate fun PodcastCardPreview\(\)/);
  assert.match(src, /private object FakeData/);
  assert.match(src, /GeneratedTheme \{/, 'the preview wraps in the generated theme, not the app\'s');
  // The sample values are the schema's own defaults, not invented strings.
  assert.match(src, /const val Title = "Compiled Weekly"/);
  assert.match(src, /const val Author = "Ada Moreno"/);
  assert.doesNotMatch(src, /Scaffold|NavigationRail/, 'spec/05 puts the screen shell out of scope');
});

test('the base package is configurable, so the emitter is not welded to one app', () => {
  const r = emit({ to: mkdtempSync(join(tmpdir(), 'base-')), base: 'com.example.other' });
  assert.equal(r.code, 0, r.out);
  assert.match(code(r.files['PodcastCard.kt']), /^package com\.example\.other\.ui\.generated$/m);
});

test('every emitted file is ASCII and carries the ownership marker planWrite depends on', () => {
  for (const [name, text] of Object.entries(realEmission().files)) {
    assert.ok([...text].every((c) => c.codePointAt(0) <= 0x7f), `${name} has a non-ASCII byte`);
    assert.ok(text.slice(0, 4000).includes('Generated from frame'), `${name} has no ownership marker in its first 4000 chars`);
    assert.match(text, /emit-compose\.mjs/, `${name} does not name its generator`);
  }
});

if (UPDATE) console.log('goldens rewritten under tests/golden/');
