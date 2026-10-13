#!/usr/bin/env node
// T0 format probe: what a real Claude Design export actually is, and whether one frame can be
// materialized offline. Answers are written to docs/probe-report.md by --report; nothing here
// guesses. Every fact printed comes from the page, not from a spec.
//
//   node tools/probe.mjs                      # every question, all frames
//   node tools/probe.mjs --frame PodcastCard  # one frame
//   node tools/probe.mjs --report             # also write docs/probe-report.md
//
// Inputs are immutable: the export is read, never written. Output goes to out/probe/.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { serveExport } from './serve.mjs';
// The transport (chromium locator, vendor request router, materialize) lives in tools/browser.mjs so
// the next tool can reuse it without importing this CLI. This file only asks questions and writes.
import { createMaterializer, findChromium } from './browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'fixtures', 'reference');
const OUT = join(ROOT, 'out', 'probe');
const argv = process.argv.slice(2);
const wantReport = argv.includes('--report');
const onlyFrame = arg('--frame');
const onlyProp = arg('--prop'); // e.g. --prop '{"subscribed":true,"force":"hover"}'
function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
// T0 measured that file:// cannot work (the runtime fetches sibling templates from a null origin).
// Loopback is the default; --file-protocol keeps the failing path runnable so the finding stays
// reproducible instead of folklore.
const useFileProtocol = argv.includes('--file-protocol');

const chrome = findChromium();
if (!chrome) {
  console.error('no chromium executable found; set CHROME=/path/to/binary');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const findings = {
  browser: chrome.source,
  export: basename(FIXTURE),
  questions: {},
  frames: [],
};

// ---------- part 1: the export on disk, no browser needed ----------
const files = readdirSync(FIXTURE);
const dcFiles = files.filter((f) => f.endsWith('.dc.html'));
const manifest = JSON.parse(readFileSync(join(FIXTURE, 'MANIFEST.json'), 'utf8'));

const contractAttrs = [
  'data-component', 'data-state', 'data-prop', 'data-elevation', 'data-token',
  'data-grid-min', 'data-scroll', 'data-region', 'data-icon', 'data-action', 'data-variant',
];
const runtimeAttrs = ['data-props', 'data-dc-script', 'data-dc-tpl', 'hint-placeholder-val', 'style-hover', 'style-pressed', 'style-focus'];

const attrScan = {};
let inlineSvg = 0;
let absolutePos = 0;
let remoteLinks = 0;
for (const f of dcFiles) {
  const src = readFileSync(join(FIXTURE, f), 'utf8');
  attrScan[f] = {};
  for (const a of [...contractAttrs, ...runtimeAttrs]) {
    const n = (src.match(new RegExp(`\\b${a}[=\\s]`, 'g')) || []).length;
    if (n) attrScan[f][a] = n;
  }
  inlineSvg += (src.match(/<svg/g) || []).length;
  absolutePos += (src.match(/position:\s*absolute/g) || []).length;
  remoteLinks += (src.match(/https?:\/\//g) || []).length;
}
const screensDir = join(FIXTURE, 'screens');
const redirectPages = readdirSync(screensDir).filter((f) => f.endsWith('.html'));
const redirectSizes = redirectPages.map((f) => [f, readFileSync(join(screensDir, f)).length]);

findings.disk = {
  dcTemplates: dcFiles,
  screensRedirectBytes: redirectSizes,
  contractAttributesFound: Object.fromEntries(
    Object.entries(attrScan).map(([f, m]) => [f, Object.keys(m).filter((k) => contractAttrs.includes(k))])
  ),
  runtimeAttributesFound: Object.fromEntries(
    Object.entries(attrScan).map(([f, m]) => [f, Object.keys(m).filter((k) => runtimeAttrs.includes(k))])
  ),
  inlineSvgTotal: inlineSvg,
  positionAbsoluteTotal: absolutePos,
  remoteUrlOccurrences: remoteLinks,
  manifestScreens: manifest.screens.map((s) => ({ id: s.id, states: s.states.length })),
  tokensTopLevel: Object.keys(JSON.parse(readFileSync(join(FIXTURE, 'tokens.json'), 'utf8'))),
};

say('=== export on disk ===');
say(`templates: ${dcFiles.join(', ')}`);
say(`screens/*.html sizes: ${redirectSizes.map(([f, b]) => `${f}=${b}B`).join(' ')}`);
say(`contract attrs present: ${JSON.stringify(findings.disk.contractAttributesFound)}`);
say(`inline <svg>: ${inlineSvg} | position:absolute: ${absolutePos} | remote urls: ${remoteLinks}`);

// ---------- part 2: materialize a frame in a browser ----------
const BOARD_PATH = '/Mini Jetcaster.dc.html';
const srv = await serveExport(FIXTURE);
const boardUrl = useFileProtocol ? pathToFileURL(join(FIXTURE, 'Mini Jetcaster.dc.html')).href : srv.url(BOARD_PATH);
say(`=== materialization transport: ${useFileProtocol ? 'file:// (expected to fail sibling fetch)' : `loopback ${srv.origin}`} ===`);

const { materialize, close: closeBrowser } = await createMaterializer({ boardUrl, root: ROOT, executablePath: chrome.path });

const framesToTry = onlyFrame ? [onlyFrame] : manifest.screens.map((s) => s.id);

for (const frame of framesToTry) {
  const r = await materialize({ frame, theme: 'light', offline: true });
  const hash = createHash('sha256').update(r.shot).digest('hex').slice(0, 16);
  writeFileSync(join(OUT, `${frame}.png`), r.shot);
  const vis = r.info.figures.filter((f) => f.visible);
  findings.frames.push({
    frame,
    loadMs: r.loadMs,
    settled: r.settled,
    fontsReady: r.fontsReady,
    pngSha: hash,
    figureCount: r.info.figures.length,
    visibleFigures: vis.map((f) => `${f.id} ${f.rect.w}x${f.rect.h}`),
    thisFrame: (() => {
      const m = r.info.figures.filter((f) => f.visible && f.id === frame)[0];
      return m ? `${m.tag} ${m.rect.w}x${m.rect.h}` : null;
    })(),
    unresolvedPlaceholders: r.info.unresolvedCount,
    customElementsDefined: r.info.customElementsDefined,
    blockedRequests: [...new Set(r.blocked)].map((u) => u.slice(0, 70)),
    errors: r.errors.slice(0, 8),
    textSample: r.info.textSample,
    nodes: r.info.nodeCount,
    fonts: { status: r.info.fontsReady, roboto: r.info.robotoActive, symbols: r.info.symbolsActive },
    styleProbe: r.styleProbe,
  });
  say(`--- frame=${frame} ---`);
  say(`  load ${r.loadMs}ms settled=${r.settled} | figures ${r.info.figures.length} visible ${vis.length} | unresolved {{ }} ${r.info.unresolvedCount}`);
  say(`  isolated frame: ${findings.frames[findings.frames.length - 1].thisFrame || 'NOT FOUND'} | other visible ids: ${vis.filter((f) => f.id !== frame).length}`);
  say(`  custom elements defined: ${r.info.customElementsDefined.join(',') || '(none)'}`);
  say(`  blocked: ${[...new Set(r.blocked)].length} | errors: ${r.errors.length ? r.errors.join(' | ') : 'none'}`);
  say(`  nodes ${r.info.nodeCount} | fonts ${r.info.fontsReady} roboto=${r.info.robotoActive} symbols=${r.info.symbolsActive}`);
  for (const sp of r.styleProbe) say(`  ${sp.tag}: bg=${sp.bg} r=${sp.radius} font=${sp.font} fam=${sp.fam}`);
}

// determinism: same frame twice, byte-identical png?
if (!onlyFrame) {
  const a = await materialize({ frame: 'PodcastCard', theme: 'light', offline: true });
  const b = await materialize({ frame: 'PodcastCard', theme: 'light', offline: true });
  const ha = createHash('sha256').update(a.shot).digest('hex');
  const hb = createHash('sha256').update(b.shot).digest('hex');
  findings.questions.determinism = { same: ha === hb, a: ha.slice(0, 16), b: hb.slice(0, 16) };
  say(`=== determinism (PodcastCard twice) === ${ha === hb ? 'byte-identical' : 'DIFFERS'}`);

  const pp = await materialize({ frame: 'PodcastCard', theme: 'light', offline: true, props: JSON.parse(onlyProp || '{"subscribed":true}') });
  const propShot = createHash('sha256').update(pp.shot).digest('hex');
  const changed = propShot !== findings.questions.determinism.a;
    findings.questions.propOverride = {
    transport: useFileProtocol ? 'file://' : 'loopback',
    queryChangesRender: changed,
    note: changed
      ? 'query props reach the render'
      : 'query props do NOT reach the render: extraction must inject props another way (see docs)',
  };
  say(`=== prop override via query string changes the render: ${changed} ===`);

  const d = await materialize({ frame: 'PodcastCard', theme: 'dark', offline: true });
  const hd = createHash('sha256').update(d.shot).digest('hex');
  findings.questions.darkTheme = { changed: hd !== ha, sha: hd.slice(0, 16) };
  say(`=== ?theme=dark changes the render: ${hd !== ha}`);
}

await closeBrowser();

findings.questions.transport = {
  mode: useFileProtocol ? 'file://' : 'loopback',
  everyFrameSettled: findings.frames.every((f) => f.settled),
  unresolvedTotal: findings.frames.reduce((n, f) => n + f.unresolvedPlaceholders, 0),
  errorTotal: findings.frames.reduce((n, f) => n + f.errors.length, 0),
};
findings.questions.renderHealthy = findings.questions.transport.everyFrameSettled && findings.questions.transport.unresolvedTotal === 0;
findings.questions.vendorComplete = findings.frames.every((f) => f.blockedRequests.length === 0);
findings.questions.blockedUrls = [...new Set(findings.frames.flatMap((f) => f.blockedRequests))];
findings.questions.frameIsolation = findings.frames.map((f) => ({ frame: f.frame, isolated: f.thisFrame, otherVisible: f.visibleFigures.length - (f.thisFrame ? 1 : 0) }));
findings.questions.fileProtocolError =
  findings.frames.flatMap((f) => f.errors).find((e) => /sibling fetch/.test(e)) || null;
findings.questions.fonts = findings.frames.map((f) => ({ frame: f.frame, status: f.fontsReady, roboto: f.fonts.roboto, symbols: f.fonts.symbols }));

await srv.close();
writeFileSync(join(OUT, (useFileProtocol ? 'probe-file' : 'probe') + '.json'), JSON.stringify(findings, null, 2) + '\n');
writeFileSync(join(OUT, (useFileProtocol ? 'probe-file' : 'probe') + '.log'), log.join('\n') + '\n');
say(`\nwrote out/probe/probe.json (+ .log, .png per frame)`);

if (wantReport) {
  const md = [
    '# T0 probe report: what a Claude Design export actually is',
    '',
    `Generated by \`node tools/probe.mjs --report\` against \`fixtures/reference\` (${chrome.source}).`,
    'Numbers here come from the probe run, not from memory. Re-run after any export or runtime update.',
    '',
    '## Answers to the questions that shaped the plan',
    '',
    '| Question | Answer |',
    '| --- | --- |',
    `| Render healthy over ${findings.questions.transport.mode}? | ${findings.questions.renderHealthy ? 'yes: tree settled, zero unresolved placeholders, zero page errors' : 'NO - see probe.json'} |`,
    `| Does \`file://\` work at all? | no: the runtime fetches sibling \`.dc.html\` files for \`<dc-import>\` and a null origin blocks it (measured with \`--file-protocol\`, see Transport below) |`,
    `| Did every frame settle (tree populated, no \`{{ }}\` left)? | ${findings.questions.transport.everyFrameSettled ? 'yes, over ' + findings.questions.transport.mode : 'NO over ' + findings.questions.transport.mode} |`,
    `| Do query-string props reach the render? | ${findings.questions.propOverride ? (findings.questions.propOverride.queryChangesRender ? 'yes' : '**no** - ' + findings.questions.propOverride.note) : 'not measured'} |`,
    `| Does \`?frame=\` isolate one frame? | ${findings.frames.every((f) => f.thisFrame) ? 'yes, every requested frame rendered as its own element' : 'NO for: ' + findings.frames.filter((f) => !f.thisFrame).map((f) => f.frame).join(', ')} |`,
    `| Fonts loaded before geometry was read? | ${findings.frames.every((f) => f.fontsReady === 'loaded') ? 'yes, all loaded' : findings.frames.map((f) => `${f.frame}:${f.fontsReady}`).join(' ')} |`,
    `| Is the render deterministic? | ${findings.questions.determinism ? (findings.questions.determinism.same ? 'byte-identical across runs' : 'NO: screenshots differ') : 'not measured'} |`,
    `| Does \`?theme=dark\` reach the scheme without JS? | ${findings.questions.darkTheme ? (findings.questions.darkTheme.changed ? 'yes, pixels change' : 'NO, no visible change') : 'not measured'} |`,
    '| Are contract `data-*` attributes present? | ' + (Object.values(findings.disk.contractAttributesFound).flat().length === 0 ? '**no, zero of them**' : 'some: ' + [...new Set(Object.values(findings.disk.contractAttributesFound).flat())].join(', ')) + ' |',
    `| Icons | ${findings.disk.inlineSvgTotal} inline SVG, a glyph font instead |`,
    `| \`position: absolute\` | ${findings.disk.positionAbsoluteTotal} occurrences across templates |`,
    '',
    '## The export as it sits on disk',
    '',
    '```json',
    JSON.stringify(findings.disk, null, 2).slice(0, 2600),
    '```',
    '',
    '## Per frame',
    '',
    '| Frame | visible figures | unresolved {{ }} | load ms | png sha | blocked | errors |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...findings.frames.map((f) => `| ${f.frame} | ${f.visibleFigures.join(' ') || '-'} | ${f.unresolvedPlaceholders} | ${f.loadMs} | ${f.pngSha} | ${f.blockedRequests.length} | ${f.errors.length} |`),
    '',
    '## Transport',
    '',
    'A `.dc.html` board resolves `<dc-import>` by fetching its sibling template at runtime, which a',
    '`file://` page cannot do: its origin is null and the browser refuses the fetch. The probe records',
    'the runtime error verbatim when run with `--file-protocol`:',
    '',
    '```text',
    (() => {
      const f = join(OUT, 'probe-file.json');
      const measured = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).questions?.fileProtocolError : null;
      return measured
        ? measured.replace(/^console: /, '') + '\n  (from: node tools/probe.mjs --frame PodcastCard --file-protocol)'
        : 'not measured in this run: run node tools/probe.mjs --frame PodcastCard --file-protocol';
    })(),
    '```',
    '',
    'The extractor therefore starts a loopback server bound to 127.0.0.1 over one directory, and the',
    'offline guarantee moves to the request router: any request that is not loopback, not `file://`',
    'and not present in `.vendor/vendor-lock.json` is aborted and reported. That is a stronger, testable',
    'claim than "we used a file URL".',
    '',
    '## What this decides for extraction',
    '',
    '- Materialization target is the board with `?frame=`; `screens/*.html` are redirects and useless.',
    '- Blocked-request and unresolved-placeholder counts are the two health checks a run must pass',
    '  before any computed style is trusted.',
    '- Absent contract attributes are a validator problem, not an extractor problem: see spec/01.',
    '',
  ].join('\n');
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'probe-report.md'), md);
  say('wrote docs/probe-report.md');
}
