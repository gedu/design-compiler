#!/usr/bin/env node
// T5 WU2: the hand-annotated single-card fixture, and the transport change that lets a small frame
// be captured at all.
//
//   node --test 'tests/*.test.mjs'
//
// Three claims, all of them properties the fixture exists to demonstrate:
//
//   1. ONE card. fixtures/reference cannot be a golden input because its PodcastCard section lays
//      out the design's six declared states side by side, so every annotated node comes back six
//      times. fixtures/annotated exists to render exactly one instance, so exactly one is asserted,
//      not "at least one".
//   2. Computed style is readable OFF this input. A card whose rounded corners and background
//      resolve to real values proves the materializer reached the values an emitter needs after the
//      runtime resolved every {{ }} hole; a zero radius or a transparent background would mean the
//      stylesheet never applied and any style read downstream would be a number off an empty node.
//   3. The two health gates from spec/03 (zero blocked requests, zero unresolved placeholders) are
//      asserted on the capture, not assumed from a probe report someone read once.
//
// The settle-gate tests at the bottom seed a board that never renders. That is the half that keeps
// the fix honest: the gate used to be a global node count (> 60), which is an artifact of the
// reference board's size, and a gate that only ever passes has never been shown to fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixtures', 'annotated');
const BROWSER_MODULE = pathToFileURL(join(ROOT, 'tools', 'browser.mjs')).href;
const SERVE_MODULE = pathToFileURL(join(ROOT, 'tools', 'serve.mjs')).href;
const FRAME = 'PodcastCard.compact';

const { createMaterializer, findChromium } = await import(BROWSER_MODULE);
const { serveExport } = await import(SERVE_MODULE);

const validate = (args) =>
  spawnSync(process.execPath, [join(ROOT, 'tools', 'validate.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });

// ---------- the fixture as an input ----------

test('the annotated fixture is a clean contract input: validate exits 0 with zero errors', () => {
  const plain = validate(['fixtures/annotated']);
  assert.equal(plain.status, 0, `exit ${plain.status}\n${plain.stdout}\n${plain.stderr}`);
  assert.match(plain.stdout, /^validate OK: 24 checks \| errors 0 \|/m);

  const json = validate(['fixtures/annotated', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.summary.errors, 0, JSON.stringify(report.diagnostics.filter((d) => d.severity === 'error')));
  // An empty export would also be clean. This one has to be a real input with real findings.
  assert.ok(report.summary.warnings > 0, 'the fixture must still carry the warnings a glyph font owes');
  assert.ok(report.diagnostics.some((d) => d.code === 'icon-font'), 'the two glyphs are still a font debt');
});

test('the fixture renders exactly ONE card, which is why it exists instead of the reference board', async () => {
  const capture = await captureFixture();
  assert.equal(capture.settled, true, `a 21-node frame must settle; errors ${JSON.stringify(capture.errors)}`);
  assert.equal(capture.cardCount, 1, `exactly one podcast-card root, found ${capture.cardCount}`);
  assert.equal(capture.rootCount, 0, 'the frame wrapper carries a region, not a second card identity');
  assert.ok(capture.nodes['data-region=content'], 'the board declares its one region');
  assert.equal(capture.nodes['data-region=content'].w, 180, 'the region is the 180px frame, not the card inside it');
  // The reference board's failure mode, stated as a number: six instances of everything.
  assert.equal(capture.coverCount, 1, 'the cover must not be a state sheet');
  assert.equal(capture.toggleCount, 1);
  assert.equal(capture.iconCount, 2, 'the card draws exactly two glyphs: the cover glyph and the toggle');
  assert.deepEqual(capture.glyphs, ['terminal', 'bookmark_add'], 'data-icon must survive the render with a real name');
  assert.deepEqual(capture.props, { title: 'Compiled Weekly', author: 'Ada Moreno', category: 'Tech' },
    'data-prop must survive on the copy the data-props schema declares');
});

test('computed style resolves off this input: a real box, real corners, a real background', async () => {
  const capture = await captureFixture();
  const card = capture.nodes['data-component=podcast-card'];
  assert.ok(card, 'the card root must be in the capture');
  assert.ok(card.w > 0 && card.h > 0, `the card box must be non-zero, got ${card.w}x${card.h}`);
  assert.equal(card.w, 180, 'the card fills the 180px frame the data-props $preview declares');
  assert.equal(card.radius, '12px', 'shape corner medium must resolve through the var(), not stay 0px');
  assert.equal(card.bg, 'rgb(243, 237, 247)', 'surfaceContainer must resolve to a real color, not transparent');
  assert.equal(capture.nodes['data-token=colorScheme.surfaceContainer'], card, 'the named role sits on the card root');
  assert.equal(capture.nodes['data-elevation=1'], card, 'the declared level sits on the card root');
  assert.equal(card.shadow, 'none', 'elevation is declared, not painted as a shadow the fix asks to drop');
  assert.equal(capture.nodes['data-token=colorScheme.surfaceContainer'], card, 'the named role sits on the card root');
  assert.equal(capture.nodes['data-elevation=1'], card, 'the declared level sits on the card root');
  const cover = capture.nodes['data-component=podcast-card-cover'];
  assert.equal(cover.radius, '8px', 'shape corner small on the cover');
  assert.equal(cover.bg, 'rgb(232, 222, 248)', 'categoryCover Tech = secondaryContainer');
  assert.equal(cover.w, cover.h, 'the cover keeps its 1:1 aspect ratio');

  // The cover's label was moved off position: absolute onto a grid area to satisfy
  // layout-flex-grid-only; that is a real layout change, so its box is pinned here rather than
  // trusted. space8 inset, bottom-start of a 160px cover.
  const label = capture.nodes['data-prop=category'];
  assert.equal(label.text, 'Tech');  // Cover-relative: space8 inset from the cover's bottom-start, which is what the reference
  // template's position:absolute + left/bottom space8 produced.
  assert.equal(capture.label.bottom, 8, 'bottom-start with the same space8 inset as before the change');
  assert.equal(capture.label.left, 8);
  assert.equal(label.position, 'static', 'the label is no longer absolutely positioned');
  assert.deepEqual(capture.absolute, [], 'no absolute or fixed node anywhere in this fixture');

  const title = capture.nodes['data-prop=title'];
  assert.equal(title.font, '14px/20px w500', 'titleSmall must be the resolved role, not an unstyled run');
  const author = capture.nodes['data-prop=author'];
  assert.equal(author.font, '12px/16px w400', 'bodySmall');

  // The board's own contribution: the reference card ships no font stack of its own, so the frame
  // carries the body role. Without it the computed family below is the browser default and the
  // font-stack rule has nothing to check.
  assert.equal(card.family, 'Roboto', 'the platform stack must be the family actually applied');
});

test('spec/03 health gates: zero blocked requests and zero unresolved placeholders', async () => {
  const capture = await captureFixture();
  assert.deepEqual(capture.blocked, [], 'any blocked request means something the vendor lock does not pin');
  assert.equal(capture.unresolved, 0, 'an unresolved {{ }} means the read would describe an unresolved template');
  assert.deepEqual(capture.errors, [], 'the render must be free of page errors');
});

test('every file this fixture authors is ASCII', () => {
  const authored = [
    'Annotated.dc.html',
    'PodcastCard.dc.html',
    'MANIFEST.json',
    'decisions.json',
    join('fonts', 'README.md'),
  ];
  for (const rel of authored) {
    const bytes = readFileSync(join(FIXTURE, rel));
    const bad = [...bytes].filter((b) => b > 0x7e || (b < 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09));
    assert.deepEqual(bad, [], `${rel} carries ${bad.length} non-ASCII byte(s)`);
  }
});

test('the token files are the reference export byte for byte, and the card differs only by data-*', () => {
  // The fixture must be the real export plus annotations, not a rewrite of it. tokens.css is the one
  // exception and it is asserted to be an append only, so a dark scheme can reach a media query.
  // support.js and tokens.json are third-party bytes: copied verbatim, not authored here, and
  // support.js carries em dashes in its own header comment. Only files this fixture authors are held
  // to ASCII (the test above); a copy is held to being a copy.
  for (const name of ['support.js', 'tokens.json']) {
    assert.deepEqual(
      [...readFileSync(join(FIXTURE, name))],
      [...readFileSync(join(ROOT, 'fixtures', 'reference', name))],
      `${name} must be copied from the reference export unchanged`
    );
  }
  const refCss = readFileSync(join(ROOT, 'fixtures', 'reference', 'tokens.css'), 'utf8');
  const fixCss = readFileSync(join(FIXTURE, 'tokens.css'), 'utf8');
  assert.ok(fixCss.startsWith(refCss), 'tokens.css may only be appended to');
  assert.match(fixCss, /@media \(prefers-color-scheme: dark\)/);

  const strip = (p) => {
    const text = readFileSync(p, 'utf8');
    // Compare the template proper only: head, markup and the data-dc-script block. Note lastIndexOf:
    // the FIRST </script> is the head's support.js tag, and slicing there would compare six lines of
    // <head> and call the two files identical.
    const end = text.lastIndexOf('</script>') + '</script>'.length;
    return text
      .slice(0, end)
      .replace(/<link rel="stylesheet" href="https:[^"]*">/g, '')
      .replace(/ data-(component|icon|prop|token|elevation|region)="[^"]*"/g, '')
      .split('\n');
  };

  const ref = strip(join(ROOT, 'fixtures', 'reference', 'PodcastCard.dc.html'));
  const mine = strip(join(FIXTURE, 'PodcastCard.dc.html'));
  assert.equal(mine.length, ref.length, 'same number of lines, so nothing was added or removed');
  const changed = ref.filter((line, i) => line !== mine[i]);
  assert.ok(changed.length > 0, 'the fixture must differ from the reference somewhere');
  // The comparison above strips the data-* annotations to prove nothing else moved, so it must also
  // prove the annotations are there: reference has none, this fixture carries the contract set.
  const annotated = readFileSync(join(FIXTURE, 'PodcastCard.dc.html'), 'utf8');
  for (const attr of ['data-component="podcast-card"', 'data-elevation="1"', 'data-token="colorScheme.surfaceContainer"', 'data-icon="{{ glyph }}"', 'data-icon="{{ subIcon }}"', 'data-prop="title"', 'data-prop="author"', 'data-prop="category"']) {
    assert.ok(annotated.includes(attr), `the card must carry ${attr}`);
  }
  for (const line of changed) {
    // Every changed line is the runtime's helmet, or a style attribute the contract asked to
    // rewrite (documented in decisions.json). None may touch a placeholder name's spelling.
    assert.ok(
      /style=|<helmet>/.test(line),
      `unexpectedly changed a line the contract does not ask about: ${line.slice(0, 80)}`
    );
  }
  const script = (p) => readFileSync(p, 'utf8').split('data-dc-script')[1].split('</script>')[0];
  assert.equal(
    script(join(FIXTURE, 'PodcastCard.dc.html')),
    script(join(ROOT, 'fixtures', 'reference', 'PodcastCard.dc.html')),
    "the data-props schema and renderVals() must be the reference template's, untouched"
  );
  // Every hole the runtime resolves is still spelled the same. Annotated elements reuse a hole
  // (data-icon="{{ glyph }}" sits next to the glyph run), so this compares names, not a count.
  const holes = (p) => [...new Set((readFileSync(p, 'utf8').match(/\{\{\s*[\w.]+/g) || []).map((h) => h.replace(/\{\{\s*/, '')))].sort();
  assert.deepEqual(
    holes(join(FIXTURE, 'PodcastCard.dc.html')),
    holes(join(ROOT, 'fixtures', 'reference', 'PodcastCard.dc.html')),
    'the template keeps exactly the holes the runtime resolves, plus none of its own'
  );
});

// ---------- the settle gate ----------

test('THE SETTLE GATE: a 21-node frame settles, so settling is about the frame and not a node count', async () => {
  const capture = await captureFixture();
  assert.ok(capture.nodeCount < 60, `this frame is small on purpose; it measured ${capture.nodeCount} nodes`);
  assert.equal(capture.settled, true);
  assert.equal(capture.frame.w, 180);
  assert.equal(capture.frame.h, 272);
});

test('THE SETTLE GATE: a board whose runtime never runs still reports settled false', async () => {
  const broken = seedBoard({ script: 'broken' });
  const r = await materializeBoard(broken.dir, 'BrokenBoard', SEED_SETTLE_MS);
  assert.equal(r.settled, false, 'a frame that never renders must still come back not-settled');
  assert.equal(r.frameFound, false, 'and there must be no visible frame box to report');
  assert.ok(r.errors.length > 0, 'the page error is what a human reads next');
  rmSync(broken.dir, { recursive: true, force: true });
});

test('THE SETTLE GATE: a frame id that does not exist on the board reports settled false', async () => {
  // The other way a capture goes wrong: a healthy render of a different board, asked for a frame
  // nothing declares. A count-based gate would have called this settled.
  const r = await materializeFixture('NoSuchFrame.compact', SEED_SETTLE_MS);
  assert.equal(r.settled, false, 'asking for a frame that is not there is not a settled render');
  assert.equal(r.frameFound, false);
});

test('THE SETTLE GATE: a frame that renders at zero size is not settled', async () => {
  // display: none on the wrapper is the silent failure: the node exists and has descendants, so a
  // pure existence check would pass it and a capture of nothing would look like a capture.
  const zero = seedBoard({ script: 'hidden' });
  const r = await materializeBoard(zero.dir, 'ZeroBoard', SEED_SETTLE_MS);
  assert.equal(r.settled, false, 'a zero-size frame must not settle');
  rmSync(zero.dir, { recursive: true, force: true });
});

test('THE SETTLE GATE: a rendered frame with an unresolved {{ }} left is still not settled', async () => {
  // The other half of the gate, and the half most likely to rot into dead code: the frame here has a
  // real box and real children, so ONLY the placeholder test can refuse it. The hole sits outside
  // <x-dc>, where the runtime does not rewrite it, which is exactly the shape a capture must refuse:
  // a page whose text an extractor would read as an unresolved template.
  const holed = seedBoard({ script: 'holed' });
  const r = await materializeBoard(holed.dir, 'HoledBoard', SEED_SETTLE_MS);
  assert.equal(r.frameFound, true, 'the frame itself does render, so this isolates the placeholder half');
  assert.equal(r.settled, false, 'an unresolved {{ }} must never settle, however good the box looks');
  rmSync(holed.dir, { recursive: true, force: true });
});

test('the 60-node magic constant does not survive in the transport', () => {
  const src = readFileSync(join(ROOT, 'tools', 'browser.mjs'), 'utf8');
  // Comments are where the old number is *explained*, so the check runs on code only.
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(code, /querySelectorAll\('\*'\)\.length\s*[<>]=?\s*\d+/, 'a global node count must not decide settling');
  assert.doesNotMatch(code, /\b60\b/, 'no leftover 60 in any executable line');
  // The failure path must still be reachable and loud: a timeout that returns false, not a throw.
  assert.match(code, /waitForFunction/, 'settling still waits in the page');
  assert.match(code, /settleTimeoutMs/, 'the wait is a named timeout, not a magic number');
  assert.match(code, /getBoundingClientRect\(\)/, 'settling asks the frame for its box');
  assert.match(code, /childElementCount/, 'settling asks the frame whether it expanded');
  assert.match(code, /catch\(\(\) => false\)/, 'settled stays a reported boolean, reachable as false');
});

// ---------- helpers ----------

// The transport is reused exactly as tools/probe.mjs uses it: one materializer over one board URL.
// For the per-node computed-style reads the test opens its own page on the same browser, because
// tools/browser.mjs owns the transport and nothing else; a fixture-specific dump does not belong in
// it.
async function withMaterializer(boardUrl, run) {
  const chrome = findChromium();
  assert.ok(chrome, 'this machine caches chromium via .vendor/vendor-lock.json');
  const m = await createMaterializer({ boardUrl, root: ROOT, executablePath: chrome.path });
  try {
    return await run({ materialize: (opts) => m.materialize(opts), browser: m.browser, boardUrl });
  } finally {
    await m.close();
  }
}

async function withBoard(dir, boardPath, run) {
  const srv = await serveExport(dir);
  try {
    return await withMaterializer(srv.url(boardPath), run);
  } finally {
    await srv.close();
  }
}

// A capture of a board that cannot render has to wait out the settle timeout, which is the point.
// 20s x three seeds would make the suite crawl, so the negative seeds use a short one; the fixture
// itself always uses the production default.
const SEED_SETTLE_MS = 4000;

function materializeFixture(frame, settleTimeoutMs) {
  return withBoard(FIXTURE, '/Annotated.dc.html', ({ materialize }) =>
    materialize({ frame, theme: 'light', offline: true, settleTimeoutMs }).then(readFrame));
}

function materializeBoard(dir, frame, settleTimeoutMs) {
  return withBoard(dir, '/Board.dc.html', ({ materialize }) =>
    materialize({ frame, theme: 'light', offline: true, settleTimeoutMs }).then(readFrame));
}

const readFrame = (r) => ({
  settled: r.settled,
  nodeCount: r.info.nodeCount,
  blocked: r.blocked,
  unresolved: r.info.unresolvedCount,
  errors: r.errors,
  frameFound: r.info.figures.some((f) => f.visible),  frame: r.info.figures.find((f) => f.visible)?.rect ?? { w: 0, h: 0 },
});

// One capture, read once, shared by the fixture assertions: it launches a browser, and every
// assertion below is about the same render.
let sharedCapture = null;
async function captureFixture() {
  if (sharedCapture) return sharedCapture;
  sharedCapture = await withBoard(FIXTURE, '/Annotated.dc.html', async ({ materialize, browser, boardUrl }) => {
    const r = await materialize({ frame: FRAME, theme: 'light', offline: true });
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 2000 } });
    const page = await ctx.newPage();
    await page.goto(boardUrl + '?frame=' + FRAME, { waitUntil: 'load' });
    // The same three conditions materialize() waits for, then a font wait, because a text box
    // measured before the webfont lands is a different box.
    await page.waitForFunction(
      (id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && el.childElementCount > 0 && !/\{\{[^}]{1,40}\}\}/.test(document.body.innerHTML);
      },
      FRAME,
      { timeout: 20000 }
    );
    await page.evaluate(() => document.fonts.ready);
    const dump = await page.evaluate(() => {
      const nodes = {};
      const absolute = [];
      for (const el of document.querySelectorAll('[data-component],[data-icon],[data-prop],[data-region],[data-elevation],[data-token]')) {
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        const attrs = [...el.attributes].filter((a) => /^data-(component|icon|prop|region|elevation|token)$/.test(a.name));
        const keys = attrs.map((a) => `${a.name}=${a.value}`);
        const rec = {
          w: Math.round(b.width),
          h: Math.round(b.height),
          left: Math.round(b.left),
          top: Math.round(b.top),
          radius: cs.borderTopLeftRadius,
          bg: cs.backgroundColor,
          shadow: cs.boxShadow,
          position: cs.position,
          font: `${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight}`,
          family: cs.fontFamily.split(',')[0],
          text: (el.textContent || '').trim().slice(0, 24),
        };
        // Indexed by every single data attribute, so a test asks for one attribute and gets exactly
        // one element (the counts above are what prove uniqueness).
        for (const k of keys) nodes[k] = rec;
        nodes[keys.join(' ')] = rec;
        if (cs.position === 'absolute' || cs.position === 'fixed') absolute.push(keys.join(' '));
        if (cs.position === 'absolute' || cs.position === 'fixed') absolute.push(key);
      }
      const count = (sel) => document.querySelectorAll(sel).length;
      // Absolute positions are page-relative; the label assertion wants cover-relative.
      const cover = document.querySelector('[data-component="podcast-card-cover"]');
      const label = document.querySelector('[data-prop="category"]');
      const cb = cover.getBoundingClientRect();
      const lb = label.getBoundingClientRect();
      return {
        nodes,
        absolute,
        label: { bottom: Math.round(cb.bottom - lb.bottom), left: Math.round(lb.left - cb.left) },
        cardCount: count('[data-component="podcast-card"]'),
        rootCount: count('[data-region="content"][data-component]'),
        coverCount: count('[data-component="podcast-card-cover"]'),
        toggleCount: count('[data-component="podcast-card-subscribe-toggle"]'),
        iconCount: count('[data-icon]'),
        glyphs: [...document.querySelectorAll('[data-icon]')].map((e) => e.getAttribute('data-icon')),
        props: Object.fromEntries(
          [...document.querySelectorAll('[data-prop]')].map((e) => [e.getAttribute('data-prop'), e.textContent.trim()])
        ),
      };
    });
    await ctx.close();
    return { ...readFrame(r), ...dump };
  });
  return sharedCapture;
}

// A board seeded to NOT render, and to say so. support.js is left out, so the runtime never starts
// and the frame's dc-import never resolves; an executable inline script throws so the run carries a
// page error a human would read next.
//
// What this seed is NOT: a broken `data-dc-script`. Measured here, the runtime catches that
// ("[dc-runtime] logic class eval FAILED ... the template renders with props only") and still paints
// the card at 180x272, so a test built on that would assert settled:false against a render that
// legitimately succeeded. The failure that matters to a capture is the runtime never running at all.
function seedBoard({ script }) {
  const dir = mkdtempSync(join(tmpdir(), 'annotated-seed-'));
  writeFileSync(join(dir, 'tokens.css'), readFileSync(join(FIXTURE, 'tokens.css')));
  writeFileSync(join(dir, 'PodcastCard.dc.html'), readFileSync(join(FIXTURE, 'PodcastCard.dc.html')));
  const id = script === 'hidden' ? 'ZeroBoard' : script === 'holed' ? 'HoledBoard' : 'BrokenBoard';
  // support.js is loaded for every seed except the broken one, where the runtime must not run.
  const head =
    script === 'broken'
      ? '<script>throw new Error("seeded: the runtime never loaded");</script>'
      : '<script src="./support.js"></script>';
  if (script !== 'broken') writeFileSync(join(dir, 'support.js'), readFileSync(join(FIXTURE, 'support.js')));
  const style = script === 'hidden' ? 'width: 180px; display: none;' : 'width: 180px;';
  const body = `<div id="${id}" style="${style}"><dc-import name="PodcastCard" hint-size="180px,272px"></dc-import></div>`;
  // Outside <x-dc>, so the runtime never compiles it away: this is a hole a capture would really read.
  const hole = script === 'holed' ? '\n<p>leftover {{ weldedInText }}</p>' : '';
  writeFileSync(
    join(dir, 'Board.dc.html'),
    `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n${head}\n</head>\n<body>\n<x-dc>\n<helmet><link rel="stylesheet" href="tokens.css"></helmet>\n${body}\n</x-dc>${hole}\n<script type="text/x-dc" data-dc-script data-props="{&quot;unused&quot;:{&quot;editor&quot;:&quot;text&quot;,&quot;default&quot;:&quot;&quot;,&quot;tsType&quot;:&quot;string&quot;}}">\nclass Component extends DCLogic {\n  renderVals() {\n    return {};\n  }\n}\n</script>\n</body>\n</html>\n`
  );
  return { dir };
}
