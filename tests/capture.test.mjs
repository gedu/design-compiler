#!/usr/bin/env node
// T5 WU4b: one materialized frame -> the spec/02 Node tree, in memory.
//
//   node --test 'tests/*.test.mjs'
//
// The numbers in this file are NOT read off tools/capture.mjs's output. Each one comes from a
// source outside the code under test, because two of the seven red tests written earlier in this
// task were wrong tests against correct code (docs/lessons.md:
// delegated-tests-can-ship-invented-inputs):
//
//   - the type roles are looked up in spec/03's own table, parsed here;
//   - the shape and elevation steps are parsed out of spec/03 too;
//   - the role enum is parsed out of spec/02's role row;
//   - the four capture hexes are converted from the rgb() triples recorded in docs/lessons.md by
//     arithmetic written next to them, so a wrong #hex in the tool fails here and not in Kotlin;
//   - the boxes are the values fixtures/annotated/decisions.json and docs/lessons.md already state.
//
// What the suite is for, in the order it hurts:
//   1. the ancestor rule (docs/lessons.md: text-lives-in-a-runtime-span) -- reading leaves instead
//      of the owner silently loses the clamp and misreads the box;
//   2. a glyph is not copy -- an icon name must never reach a text field;
//   3. roles only from spec/02's list, and an honest word when spec/04 wants a role not in it;
//   4. the health gates refuse BEFORE any style is read, and an unresolved color stays unresolved;
//   5. byte-identical output, with no screenshot and no wall clock anywhere in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixtures', 'annotated');
const FRAME = 'PodcastCard.compact';
const cap = await import(pathToFileURL(join(ROOT, 'tools', 'capture.mjs')).href);

// ---------- external authority ----------

const spec03 = readFileSync(join(ROOT, 'spec', '03-extraction.md'), 'utf8');
const spec02 = readFileSync(join(ROOT, 'spec', '02-ir.md'), 'utf8');

// spec/03's type table, read from the spec rather than retyped: | role | size | line | track | wt |
const typeRow = (role) => {
  const line = spec03.split('\n').find((l) => new RegExp('^\\|\\s*' + role + '\\s*\\|').test(l));
  assert.ok(line, `spec/03 has no ${role} row to check against`);
  const [, size, line2, tracking, weight] = line.split('|').map((c) => c.trim());
  return { role, size: Number(size), line: Number(line2), tracking: Number(tracking), weight: Number(weight) };
};

// spec/03's shape ladder sentence and elevation sentence, same reason.
const shapeStep = (px) => {
  const flat = spec03.replace(/\s+/g, ' ');
  const hit = [...flat.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s+(\d+)\b/g)].find((m) => Number(m[2]) === px);
  assert.ok(hit, `spec/03's shape ladder has no ${px} step`);
  return hit[1];
};
const elevationSteps = () => {
  const line = spec03.split('\n').find((l) => /^[\d,\s]+dp/.test(l.trim()));
  assert.ok(line, 'spec/03 has no elevation ladder to check against');
  return /^([\d,\s]+)dp/.exec(line.trim())[1].split(',').map((s) => Number(s.trim()));
};

// docs/lessons.md records these four as measured on this very frame. The hex is rgb->hex written
// out longhand here, so the conversion is checkable by eye and not re-derived by the tool's own
// helper: 243=F3 237=ED 247=F7 / 29=1D 27=1B 32=20 / 232=E8 222=DE 248=F8 / 73=49 69=45 79=4F.
const MEASURED = {
  card: { rgb: 'rgb(243, 237, 247)', hex: '#F3EDF7', role: 'surfaceContainer' },
  ink: { rgb: 'rgb(29, 27, 32)', hex: '#1D1B20', role: 'onSurface' },
  cover: { rgb: 'rgb(232, 222, 248)', hex: '#E8DEF8', role: 'secondaryContainer' },
  author: { rgb: 'rgb(73, 69, 79)', hex: '#49454F', role: 'onSurfaceVariant' },
};

const ROLE_ENUM = cap.readRoleEnum(spec02);

// spec/02's own Node shape block, parsed: the set of fields a Node may carry. Read from the spec and
// not retyped here -- the hand-written set this suite used to carry had already fallen behind the
// schema, so it failed over a field the spec does define. A guard that has to be hand-synced with the
// document it guards is not a guard.
const nodeShapeFields = (spec) => {
  const at = spec.indexOf('A Node is a DOM element');
  assert.ok(at >= 0, 'spec/02 has no "A Node is a DOM element" section to read the Node shape from');
  const block = /~~~json\n([\s\S]*?)\n~~~/.exec(spec.slice(at));
  assert.ok(block, 'spec/02 has no ~~~json Node shape block to check against');
  return new Set(Object.keys(JSON.parse(block[1])));
};

// ---------- one capture, many claims ----------

let capture = null;
async function theCapture() {
  if (!capture) capture = await cap.captureFrame({ dir: FIXTURE, frame: FRAME, theme: 'light' });
  return capture;
}
async function node(id) {
  const r = await theCapture();
  assert.ok(r.ok, `capture refused: ${r.refusals.join('; ')}`);
  const n = r.ir.nodes[id];
  assert.ok(n, `no ${id} in the tree; got ${Object.keys(r.ir.nodes).join(', ')}`);
  return n;
}

test('the frame captures clean: settled, no blocked requests, no page errors, no holes', async () => {
  const r = await theCapture();
  assert.equal(r.ok, true, `refusals: ${r.refusals.join('; ')}`);
  assert.deepEqual(r.refusals, []);
  assert.equal(r.ir.frame.box.w, 180, 'decisions.json states a 180x272 frame');
  assert.equal(r.ir.frame.box.h, 272);
  assert.equal(r.ir.schema, 'design-ir/1', 'spec/02 Versioning: emitters assert the major version');
  assert.equal(r.ir.theme, 'light');
  assert.equal(r.ir.widthClass, 'compact', 'the .compact segment of the frame id is the width class');
});

test('reduction keeps every node it decided to keep: no wrapper orphaned its subtree', async () => {
  const r = await theCapture();
  // The quiet defect this pins: a dropped runtime wrapper used to emit a 1-node IR with no refusal.
  assert.ok(Object.keys(r.ir.nodes).length >= 8, `expected the whole card, got ${Object.keys(r.ir.nodes).length} nodes`);
  const ids = new Set(Object.keys(r.ir.nodes));
  for (const [id, n] of Object.entries(r.ir.nodes)) {
    for (const c of n.children) assert.ok(ids.has(c), `${id} names a child ${c} that is not in the tree`);
  }
  assert.ok(!r.diagnostics.some((d) => /orphan/.test(d.message)), 'no node was lost on the way up');
});

test('exactly one instance of every annotated component', async () => {
  const r = await theCapture();
  const seen = {};
  for (const n of Object.values(r.ir.nodes)) if (n.component) seen[n.component] = (seen[n.component] || 0) + 1;
  for (const c of ['podcast-card', 'podcast-card-cover', 'podcast-card-title', 'podcast-card-subscribe-toggle']) {
    assert.equal(seen[c], 1, `${c} must appear exactly once; got ${seen[c]}`);
  }
});

// ---------- the ancestor rule, the lesion this unit exists to stop ----------

test('the clamp and the box come from the OWNER, not from the runtime text span', async () => {
  const title = await node('n:podcast-card-title');
  // docs/lessons.md: the div reports clamp 2 / min-height 40px / the div is 160x40, while its child
  // span reports clamp none and a 110x16 ink box. Reading leaves loses maxLines silently.
  // The clamp is a field now (spec/02 Node.type.lineClamp), not a note: a number parked in a
  // free-text array is a value no check can hold an emitter to. The ancestor rule itself is unchanged
  // -- same owner, same 2, same 160x40 -- only the place it is read from moved.
  assert.equal(title.type.lineClamp, 2, `title must carry clamp 2, type was ${JSON.stringify(title.type)}`);
  assert.equal(title.type.overflow, 'ellipsis', 'overflow hidden on the owner is the ellipsis signal');
  assert.equal(title.box.h, 40, 'the owner box is 40 tall, not the span ink height');
  assert.equal(title.box.w, 160, 'the owner box is 160 wide');
  assert.equal(title.text, 'Compiled Weekly', "the carrier's string moved to its owner");

  const author = await node('n:author');
  assert.equal(author.box.h, 32, 'docs/lessons.md: the author div clamps at 2 lines of 16px');
  assert.equal(author.type.lineClamp, 2, 'the clamp came up from the owner here too');
});

test('no runtime text carrier survives as a node', async () => {
  const r = await theCapture();
  for (const [id, n] of Object.entries(r.ir.nodes)) {
    assert.notEqual(n.tag, undefined);
    assert.ok(!(n.text === 'Compiled Weekly' && n.id !== 'n:podcast-card-title'), 'exactly one node owns the title string');
  }
  // Five runs of text, five carriers, in this frame. If a carrier survived, there would be a 6th.
  const texts = Object.values(r.ir.nodes).map((n) => n.text).filter((t) => t !== null);
  assert.deepEqual(texts.sort(), ['Ada Moreno', 'Compiled Weekly', 'Tech'].sort(),
    'only the three text owners carry copy; the two glyph runs do not');
});

// ---------- a glyph is not copy ----------

test('a glyph span is role Icon with the name and NO text', async () => {
  const cover = await node('n:icon-terminal');
  const toggle = await node('n:icon-bookmark_add');
  assert.equal(cover.role, 'Icon');
  assert.equal(cover.icon.name, 'terminal');
  assert.equal(cover.icon.source, 'glyph-font');
  assert.equal(cover.text, null, 'the literal "terminal" is the glyph, not user-visible copy');
  assert.equal(toggle.icon.name, 'bookmark_add');
  assert.equal(toggle.text, null);
});

test('no glyph name appears in any text field anywhere in the tree', async () => {
  const r = await theCapture();
  const glyphs = Object.values(r.ir.nodes).filter((n) => n.icon).map((n) => n.icon.name);
  assert.deepEqual(glyphs.sort(), ['bookmark_add', 'terminal']);
  for (const [id, n] of Object.entries(r.ir.nodes)) {
    const words = typeof n.text === 'string' ? n.text.split(/\s+/) : [];
    for (const g of glyphs) assert.ok(!words.includes(g), `${id} carries the glyph name "${g}" as copy`);
  }
});

// ---------- roles ----------

test('every emitted role is in spec/02\'s enum, parsed from spec/02', async () => {
  const r = await theCapture();
  assert.ok(ROLE_ENUM.includes('Card') && ROLE_ENUM.includes('Icon') && ROLE_ENUM.includes('Text'));
  // The honesty guard, MOVED rather than dropped. It used to name Column, and the absence it measured
  // is now closed (spec/02 lists Column, Button, IconButton and IconToggleButton). Badge, List and Grid
  // are the roles spec/04 maps that spec/02 still does not list -- measured on both documents here --
  // so the assertion still measures a real absence instead of asserting a comfort.
  assert.ok(!ROLE_ENUM.includes('Badge'), 'this test is only honest if Badge really is absent from spec/02');
  assert.ok(!ROLE_ENUM.includes('List') && !ROLE_ENUM.includes('Grid'), 'spec/04 maps List and Grid too, still outside the enum');
  for (const [id, n] of Object.entries(r.ir.nodes)) {
    assert.ok(ROLE_ENUM.includes(n.role), `${id} has role "${n.role}", which spec/02 does not list`);
  }
});

test('a declared surface outranks being clickable: the card is a Card, not a button', async () => {
  const card = await node('n:podcast-card');
  // spec/04 puts containerColor, shape and tonalElevation on Card. The template also puts
  // role="button" on the same element, so a button-first rule loses the surface.
  assert.equal(card.role, 'Card', 'data-elevation + data-token name a surface; spec/04 maps it to Card');
  assert.ok(card.notes.includes('control:clickable'), 'and the clickability is still said, not dropped');
});

test('a clickable SURFACE keeps its boolean: Node.states is where it lives', async () => {
  // spec/02: "A clickable surface is the exception and keeps its surface role... Its boolean is a
  // parameter, not a toggle component." The capture resolved that boolean and then dropped it, because
  // stateProp only travelled inside node.callback and a card with no aria-label, no title and no
  // data-action builds no callback (spec/02 forbids inventing a name). Measured before the fix: this
  // node came back with states: [] while the template drives its aria-pressed with {{ selected }}.
  const r = await theCapture();
  const card = r.ir.nodes['n:podcast-card'];
  assert.equal(card.role, 'Card', 'the surface role still outranks the click');
  assert.equal(card.callback, undefined, 'and it still has NO callback: the boolean never rides through one');
  assert.deepEqual(card.states, ['selected'],
    'the boolean the design declared reaches the IR, in the field spec/02 already defines');
  // A surface boolean is a STATE, not a control: the toggle widget rule must not fire here or the card
  // becomes an IconToggleButton again and loses containerColor, shape and elevation.
  assert.ok(!card.notes.some((x) => x.startsWith('role-intended:')), 'no toggle widget is proposed for a surface');
  assert.ok(!r.diagnostics.some((d) => d.code === 'toggle-widget-unresolved' && d.node === 'n:podcast-card'),
    'and the surface is not reported as an unresolved toggle widget');
  // The subscribe control keeps carrying ITS boolean the old way: this change must not move it.
  const toggle = r.ir.nodes['n:podcast-card-subscribe-toggle'];
  assert.equal(toggle.callback.stateProp, 'subscribed', 'a control boolean still rides callback.stateProp');
  assert.deepEqual(toggle.states, [], 'and a control state is not duplicated into states');
});

test('a surface with an undeclared boolean state names nothing and says so', async () => {
  // refuse-before-inventing, in the direction that matters here: aria-pressed alone is not a prop. The
  // hole must resolve to a data-props tsType boolean, or states stays empty -- otherwise a literal
  // aria-pressed="true" would materialize a parameter nobody declared.
  const d = mkdtempSync(join(tmpdir(), 'surface-'));
  cpSync(FIXTURE, d, { recursive: true });
  const target = join(d, 'PodcastCard.dc.html');
  const before = readFileSync(target, 'utf8');
  const after = before.replace('aria-pressed="{{ selected }}"', 'aria-pressed="true"');
  assert.notEqual(after, before, 'the mutation did not apply -- an empty states from unmutated input proves nothing');
  writeFileSync(target, after);
  const r = await cap.captureFrame({ dir: d, frame: 'PodcastCard.compact', settleTimeoutMs: 8000 });
  rm(d);
  assert.equal(r.ok, true, `refusals: ${r.refusals?.join('; ')}`);
  const card = r.ir.nodes['n:podcast-card'];
  assert.deepEqual(card.states, [], 'a hardcoded aria-pressed names no prop, so it becomes no state');
  assert.ok(card.notes.some((x) => x.startsWith('toggle-literal:')),
    'and the reason is written down: the design has a hardcoded toggle, not a boolean parameter');
});

test('where spec/04 wants a role spec/02 does not list, the IR says so instead of inventing one', async () => {
  const r = await theCapture();
  const toggle = r.ir.nodes['n:podcast-card-subscribe-toggle'];
  // The gap this test pinned is CLOSED, and the closing is what it measures now: the toggle is the
  // component spec/04 names, carrying the boolean the design itself drew, with nothing left to hide.
  assert.equal(toggle.role, 'IconToggleButton', 'spec/02 lists the role spec/04 maps for an icon-shaped toggle');
  assert.equal(toggle.callback.state, 'aria-pressed', 'read off the live element, so it is a fact and not an inference');
  assert.equal(toggle.callback.stateProp, 'subscribed', 'the name comes from the template hole, never from the model');
  assert.ok(!r.diagnostics.some((d) => d.code === 'role-enum-conflict'),
    'a complete enum leaves nothing to conflict about; one appearing here means a role went missing from spec/02');

  // The guard itself, anchored on the MECHANISM rather than on an absence in the fixture. With the real
  // enum there is no role left for pickRole to want and not find -- measured: this frame carries no
  // role-intended note at all -- so pinning it to Badge would assert a path the extractor cannot reach
  // (nothing in capture.mjs ever proposes Badge; the comment naming it is aspirational, not a branch).
  // So take the real enum, drop the ONE role spec/04 wants for this control, and require the old honest
  // behaviour back: emit the closest allowed role, keep the intent in notes, raise the diagnostic, and
  // invent nothing.
  const doctored = ROLE_ENUM.filter((role) => role !== 'IconToggleButton');
  assert.ok(!doctored.includes('IconToggleButton') && doctored.includes('IconButton'),
    'the doctored enum must lack exactly the one role spec/04 wants, not the whole control family');
  const gapped = await cap.captureFrame({
    dir: FIXTURE, frame: FRAME, theme: 'light', roleEnum: doctored, settleTimeoutMs: 8000,
  });
  assert.equal(gapped.ok, true, `refusals: ${gapped.refusals.join('; ')}`);
  const fallback = gapped.ir.nodes['n:podcast-card-subscribe-toggle'];
  assert.equal(fallback.role, 'IconButton', 'the closest role the schema allows, never a name out of thin air');
  assert.ok(fallback.notes.includes('role-intended:IconToggleButton'), 'the intent survives in notes');
  assert.ok(gapped.diagnostics.some((d) => d.code === 'role-enum-conflict' && d.node === fallback.id),
    'the conflict is a diagnostic, not a silent substitution');
  assert.equal(fallback.callback.stateProp, 'subscribed', 'losing the widget name must not lose the boolean');
});

test('a flex box with more than one surviving child is a Row; a lone one is a container', async () => {
  const row = await node('n:node-0-0-0-2');
  assert.equal(row.role, 'Row', 'the author/subscribe row lays out two children');
  assert.equal(row.children.length, 2);
});

// ---------- resolved values, checked against spec/03 ----------

test('colors resolve to the roles docs/lessons.md measured, with the hex arithmetic checked here', async () => {
  const card = await node('n:podcast-card');
  assert.equal(card.paint.background.hex, MEASURED.card.hex);
  assert.equal(card.paint.background.role, MEASURED.card.role);
  assert.equal(card.paint.background.source, 'data-token', 'the card names its role, so the name is the authority (spec/03 step 4)');

  const cover = await node('n:podcast-card-cover');
  assert.equal(cover.paint.background.hex, MEASURED.cover.hex);
  assert.equal(cover.paint.background.role, MEASURED.cover.role, 'category Tech paints secondaryContainer');

  const title = await node('n:podcast-card-title');
  assert.equal(title.paint.foreground.hex, MEASURED.ink.hex);
  assert.equal(title.paint.foreground.role, MEASURED.ink.role);

  const author = await node('n:author');
  assert.equal(author.paint.foreground.hex, MEASURED.author.hex);
  assert.equal(author.paint.foreground.role, MEASURED.author.role);
});

test('an ambiguous hex is settled by the custom property the element itself declares, and says how', async () => {
  const cover = await node('n:podcast-card-cover');
  // #E8DEF8 is light secondaryContainer AND dark onSecondaryContainer. The declaration reads
  // `background: var(--md-sys-color-secondary-container)`, which decides without guessing.
  assert.equal(cover.paint.background.role, MEASURED.cover.role);
  const info = (await theCapture()).diagnostics.find((d) => d.code === 'color-ambiguous' && d.node === cover.id);
  assert.ok(info, 'the collision is reported, not swallowed');
  assert.equal(info.severity, 'info', 'it is settled, so it is no longer a warning');
});

test('type roles match spec\'03\'s table read from spec/03', async () => {
  // spec/02 gives the resolved type role a field of its own (Node.type), so this reads the field. It
  // used to scrape notes, which is exactly the schema gap this closed.
  const expect = (n, role) => {
    typeRow(role);                                   // fails the test if spec/03 has no such role
    assert.ok(n.type, `${n.id} carries no type role`);
    assert.equal(n.type.role, role, `expected ${role}, got ${JSON.stringify(n.type)}`);
    assert.ok(['scale', 'closest'].includes(n.type.source), `spec/02 allows source scale or closest, got "${n.type.source}"`);
  };
  expect((await node('n:podcast-card-title')), 'titleSmall');
  expect((await node('n:author')), 'bodySmall');
  expect((await node('n:category')), 'labelMedium');
  // The collision spec/03 itself warns about: titleSmall and labelLarge share 14/20 and 0.1/500.
  const title = await node('n:podcast-card-title');
  assert.ok(title.notes.some((x) => x.startsWith('type-candidates:')), 'the tie is reported, not silently broken');
  // spec/02: null on a node that holds no text. A surface has no copy to type.
  assert.equal((await node('n:podcast-card')).type, null, 'a node with no text resolves no type role');
});

test('shape and elevation resolve on the ladders spec/03 states', async () => {
  const card = await node('n:podcast-card');
  assert.equal(card.paint.radius.px, 12);
  assert.equal(card.paint.radius.shape, shapeStep(12), 'spec/03 names the step for 12');
  assert.equal(card.paint.elevation, 1);
  assert.ok(elevationSteps().includes(1), 'and 1 really is on that ladder');

  const cover = await node('n:podcast-card-cover');
  assert.equal(cover.paint.radius.shape, shapeStep(8));
  assert.equal(cover.size.aspect, 1, 'aspect-ratio 1 / 1');
  assert.ok(cover.notes.some((x) => x.startsWith('aspect-and-height:')), 'spec/04 trap 7: the conflict is named, the ratio wins');

  // The 9999px radius sits on the span INSIDE the <button>, not on the button: the template styles
  // the circle as its own element. Asserting the circle on the button was a wrong test of mine
  // against correct code (measured: the button's radius is null). Check the child, and pin the
  // button's own absence too so the two cannot be swapped again.
  const toggle = await node('n:podcast-card-subscribe-toggle');
  assert.equal(toggle.paint.radius, null, 'the button paints no shape of its own');
  const shot = await theCapture();
  const circle = toggle.children.map((c) => shot.ir.nodes[c]).find((n) => n.paint.radius?.shape === 'circle');
  assert.ok(circle, 'the inner 9999px span is CircleShape, spec/03');
  assert.equal(circle.paint.radius.px, 9999);
});

test('elevation never comes from a shadow, and a shadow without data-elevation is reported', async () => {
  // spec/03 Resolution rules: "Shadow | never". The fixture paints none, so assert the refusal path
  // on a seeded board rather than trusting an absence.
  const d = seed('Shad', '<div data-component="shad" style="width:180px;height:80px;background:var(--md-sys-color-surface-container);box-shadow:0 2px 4px #000;"></div>');
  const r = await cap.captureFrame({ dir: d, frame: 'Shad.compact', board: 'Shad.dc.html', settleTimeoutMs: 8000 });
  assert.equal(r.ir.nodes['n:shad'].paint.elevation, null, 'a painted shadow yields no elevation');
  assert.ok(r.diagnostics.some((x) => x.code === 'elevation-missing'));
  rm(d);
});

// ---------- inherited values are not painted values ----------

test('an inherited color is not emitted as this node\'s paint', async () => {
  // `color` inherits in CSS. The frame wrapper declares only a width yet computes the board's ink,
  // and emitting that would ship a value the design never put there.
  const region = await node('n:region-content');
  assert.equal(region.paint.foreground, null, 'no declaration on this element means no paint');
  assert.ok(region.notes.some((x) => x.startsWith('foreground-inherited:')));
  const category = await node('n:category');
  assert.equal(category.paint.foreground, null, 'the label inherits the cover content color');
});

test('an inherited cursor does not make every descendant a control', async () => {
  const r = await theCapture();
  const withCallback = Object.entries(r.ir.nodes).filter(([, n]) => n.callback).map(([id]) => id).sort();
  assert.deepEqual(withCallback, ['n:podcast-card-subscribe-toggle'],
    'the card is clickable but names no callback; text and glyphs are not controls at all');
  const cb = r.ir.nodes['n:podcast-card-subscribe-toggle'].callback;
  assert.equal(cb.evidence, 'aria-label', 'spec/02: a callback needs evidence');
  assert.equal(cb.state, 'aria-pressed');
  // The card is a control with nothing to name it from: a diagnostic, never an invented name.
  assert.ok(r.diagnostics.some((d) => d.code === 'callback-inferred' && d.node === 'n:podcast-card'));
});

// ---------- refusal, not invention ----------

test('a color that is no role stays unresolved with an error, never a literal', async () => {
  const d = seed('Lit', '<div data-component="lit" style="width:180px;height:80px;background:#7A5AF8;"></div>');
  const r = await cap.captureFrame({ dir: d, frame: 'Lit.compact', board: 'Lit.dc.html', settleTimeoutMs: 8000 });
  const bg = r.ir.nodes['n:lit'].paint.background;
  assert.equal(bg.role, null, 'spec/02: unresolved means it must be visible, never silently emitted');
  assert.equal(bg.source, 'unresolved');
  assert.ok(r.diagnostics.some((x) => x.code === 'color-unresolved' && x.severity === 'error'));
  rm(d);
});

test('a data-token that disagrees with the element\'s own declaration is an error, not a pick', async () => {
  const d = seed('Tok', '<div data-component="tokmis" data-token="colorScheme.primary" style="width:180px;height:80px;background:var(--md-sys-color-surface-container);"></div>');
  const r = await cap.captureFrame({ dir: d, frame: 'Tok.compact', board: 'Tok.dc.html', settleTimeoutMs: 8000 });
  const hit = r.diagnostics.filter((x) => x.code === 'color-token-mismatch');
  assert.equal(hit.length, 1, `expected exactly one mismatch, got ${JSON.stringify(hit)}`);
  assert.equal(hit[0].severity, 'error');
  rm(d);
});

test('a component that materializes twice is refused, not narrowed to the first', async () => {
  const two = '<div data-component="dup-card" style="width:180px;height:60px;background:var(--md-sys-color-surface-container);"></div>'
    + '<div data-component="dup-card" style="width:180px;height:60px;background:var(--md-sys-color-surface-container);"></div>';
  const d = seed('Dup', two);
  const r = await cap.captureFrame({ dir: d, frame: 'Dup.compact', board: 'Dup.dc.html', settleTimeoutMs: 8000 });
  assert.equal(r.ok, false);
  assert.match(r.refusals.join(' '), /dup-card.*2 times/s);
  assert.equal(r.ir, null, 'a refusal emits no partial tree');
  rm(d);
});

test('a request the vendor lock does not pin is refused before any style is read', async () => {
  const d = mkdtempSync(join(tmpdir(), 'remote-'));
  cpSync(FIXTURE, d, { recursive: true });
  writeFileSync(join(d, 'Remote.dc.html'), board('Remote.compact',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unpinned">'
    + '<div data-component="rem" style="width:180px;height:60px;background:var(--md-sys-color-surface-container);"></div>'));
  const r = await cap.captureFrame({ dir: d, frame: 'Remote.compact', board: 'Remote.dc.html', settleTimeoutMs: 8000 });
  assert.equal(r.ok, false);
  assert.match(r.refusals.join(' '), /blocked request/);
  assert.match(r.refusals.join(' '), /Unpinned/);
  rm(d);
});

test('a frame that never renders is refused', async () => {
  const d = mkdtempSync(join(tmpdir(), 'dead-'));
  cpSync(FIXTURE, d, { recursive: true });
  writeFileSync(join(d, 'Dead.dc.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="Dead.compact"></div></body></html>');
  const r = await cap.captureFrame({ dir: d, frame: 'Dead.compact', board: 'Dead.dc.html', settleTimeoutMs: 4000 });
  assert.equal(r.ok, false);
  assert.match(r.refusals.join(' '), /did not settle/);
  rm(d);
});

test('an unknown frame id is refused, not answered with an empty tree', async () => {
  const r = await cap.captureFrame({ dir: FIXTURE, frame: 'NoSuchFrame.compact', settleTimeoutMs: 4000 });
  assert.equal(r.ok, false);
  assert.match(r.refusals.join(' '), /did not settle/);
});

test('the CLI exits 3 on a refusal and 0 on the clean fixture', async () => {
  const clean = spawnSync(process.execPath, [join(ROOT, 'tools', 'capture.mjs')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /frame PodcastCard\.compact: \d+ nodes/);

  const bad = spawnSync(process.execPath, [join(ROOT, 'tools', 'capture.mjs'), '--frame', 'NoSuchFrame.compact'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(bad.status, 3, `expected the refusal exit code, got ${bad.status}\n${bad.stdout}\n${bad.stderr}`);
  assert.match(bad.stderr, /capture refused \(exit 3\)/);
});

// ---------- determinism, and what must never be in it ----------

test('two processes capture byte-identical IR', () => {
  const run = () => spawnSync(process.execPath, [join(ROOT, 'tools', 'capture.mjs'), '--json'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const a = run();
  const b = run();
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout, 'invariant 1: same input plus config yields byte-identical output');
  assert.ok(a.stdout.length > 2000, 'and it is a real document, not two empty strings');
});

test('nothing unstable is read: no screenshot, no wall clock, in the IR or the code', async () => {
  const r = await theCapture();
  const text = cap.canonicalJson(r.ir);
  // docs/lessons.md: probe.json drifts because loadMs and pngSha live in the hashed artifact.
  for (const banned of ['loadMs', 'pngSha', 'screenshot', 'duration_ms']) {
    assert.ok(!text.includes(banned), `${banned} must not reach a hashed artifact`);
  }
  // Comments are where these excluded facts are EXPLAINED, so the check runs on code only. Same
  // rule tests/annotated-fixture.test.mjs applies to the retired 60 constant. A version of this
  // test that scanned comments failed on the line that documents the exclusion.
  const code = readFileSync(join(ROOT, 'tools', 'capture.mjs'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/\.shot\b/.test(code), 'the capture never touches the transport screenshot');
  assert.ok(!/loadMs/.test(code), 'nor its timing');
  assert.ok(!/Date\.now\(\)/.test(code), 'and takes no wall clock of its own');
  // And the exclusion is deliberate, not an accident of nobody having added them yet.
  const src = readFileSync(join(ROOT, 'tools', 'capture.mjs'), 'utf8');
  assert.match(src, /loadMs/, 'the reason these are excluded is written down');
});

// ---------- the two things that make the page pass trustworthy ----------

test('the page pass closes over nothing: its literals match the module\'s constants', () => {
  // pageDump is serialized into the browser, so it cannot read CONTRACT_ATTRS or INTERP_CLASS. That
  // duplication is only safe if something checks it, which is this test.
  const src = readFileSync(join(ROOT, 'tools', 'capture.mjs'), 'utf8');
  const body = src.slice(src.indexOf('function pageDump'), src.indexOf('// ---------------------------\n// small value helpers'));
  assert.match(body, /new Set\(contractList\)/, 'the contract list arrives as an argument');
  assert.match(body, /classList\.contains\(carrierClass\)/, 'and the carrier class arrives as an argument');
  assert.deepEqual([...cap.CONTRACT_ATTRS].sort(), [...cap.CONTRACT_ATTRS].sort().slice(), 'list is stable');
  for (const a of ['data-component', 'data-prop', 'data-icon', 'data-token', 'data-elevation', 'data-region']) {
    assert.ok(cap.CONTRACT_ATTRS.includes(a), `${a} is a contract attribute (spec/01)`);
  }
  for (const stamped of ['data-dc-tpl', 'data-sc-name']) {
    assert.ok(cap.RUNTIME_ATTR.test(stamped), `${stamped} is stamped by dc-runtime, measured in the DOM`);
    assert.ok(!cap.CONTRACT_ATTRS.includes(stamped), 'and is never author intent');
  }
  assert.equal(cap.INTERP_CLASS, 'sc-interp', 'the carrier class measured in the rendered DOM');
});

test('the runtime scaffold is reduced, so data-* does not protect dc-runtime\'s own nodes', async () => {
  // spec/03's "never reduce anything with a data-* attribute" read literally keeps every
  // data-dc-tpl wrapper the runtime stamps. The frame's first two elements are exactly that.
  const r = await theCapture();
  const ids = Object.keys(r.ir.nodes);
  assert.equal(ids[0], 'n:region-content', 'the frame element survives; the template host under it does not');
  assert.equal(r.ir.nodes['n:region-content'].children.length, 1, 'one surviving child, not a chain of runtime wrappers');
  const card = r.ir.nodes['n:podcast-card'];
  assert.ok(card.notes.some((x) => x.startsWith('runtime-carries:')), 'and what it dropped is recorded, not invisible');
});

// ---------- source-side intent, which the live DOM no longer holds ----------

test('the prop schema is read from the template text, because the render consumed it', () => {
  const facts = cap.readSourceFacts(FIXTURE);
  const card = facts.props.find((p) => p.file === 'PodcastCard.dc.html');
  assert.ok(card, 'the card template declares a data-props schema');
  assert.equal(card.ok, true, card.parseError);
  assert.deepEqual(Object.keys(card.props).filter((k) => !k.startsWith('$')).sort(),
    ['author', 'category', 'force', 'onSelect', 'onToggle', 'selected', 'subscribed', 'title']);
  assert.equal(card.props.title.default, 'Compiled Weekly', "the sample the preview will hardcode (spec/04)");
  assert.equal(card.props.onToggle.tsType, '() => void', 'a callback is input, not inference');
  assert.deepEqual(facts.hintSize, [{ file: 'Annotated.dc.html', hintSize: '180px,272px' }],
    'the authored size is the dc-import hint, never the window');
  assert.deepEqual(facts.callbacks, ['blur', 'click', 'focus']);
});

test('the IR carries no field spec/02 does not define', async () => {
  const r = await theCapture();
  const SHAPE = nodeShapeFields(spec02);
  const extra = new Set();
  for (const n of Object.values(r.ir.nodes)) for (const k of Object.keys(n)) if (!SHAPE.has(k)) extra.add(k);
  assert.deepEqual([...extra], [],
    'every field the IR emits is declared in spec/02\'s Node shape block; a smuggled field belongs in an amendment, not in an emitter');
  // type and callback are the two fields this spike needed. They are IN the schema now, which is the
  // whole point -- assert their presence in the spec so deleting either cannot quietly restore the
  // old "callback is the one exception" state this test used to certify.
  for (const field of ['type', 'callback']) {
    assert.ok(SHAPE.has(field), `spec/02's shape block no longer declares ${field}`);
  }
  // spec/02: the callback belongs to the ONE node a control is. More than one means a control was
  // invented; zero means the toggle lost the boolean this whole unit exists to carry.
  const named = Object.values(r.ir.nodes).filter((n) => n.callback).map((n) => n.id);
  assert.deepEqual(named, ['n:podcast-card-subscribe-toggle'], 'one control, one callback');
});

test('everything this unit authors is ASCII', () => {
  for (const rel of [join('tools', 'capture.mjs'), join('tests', 'capture.test.mjs')]) {
    const bytes = readFileSync(join(ROOT, rel));
    const bad = [...bytes].filter((b) => b > 0x7e || (b < 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09));
    assert.deepEqual(bad, [], `${rel} carries ${bad.length} non-ASCII byte(s)`);
  }
});

// ---------- helpers ----------

// A seeded board has to link tokens.css or every var() computes transparent, which once made a seed
// refuse for the wrong reason: the seed was broken, not the tool.
function board(id, inner) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc>
<helmet><link rel="stylesheet" href="tokens.css"></helmet>
<div class="md-light" style="box-sizing: border-box;"><div id="${id}" data-region="content" style="width: 180px;">${inner}</div></div>
</x-dc></body></html>`;
}

function seed(name, inner) {
  const d = mkdtempSync(join(tmpdir(), `cap-${name}-`));
  cpSync(FIXTURE, d, { recursive: true });
  writeFileSync(join(d, `${name}.dc.html`), board(`${name}.compact`, inner));
  return d;
}

function rm(d) {
  rmSync(d, { recursive: true, force: true });
}
