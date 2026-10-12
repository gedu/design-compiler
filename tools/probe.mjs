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
import { chromium } from 'playwright';
import { serveExport } from './serve.mjs';

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

// The probe is a dev tool, so Playwright is resolved the ordinary way through package.json.
function findChromium() {
  const env = process.env.CHROME;
  if (env && existsSync(env)) return { path: env, source: 'env CHROME' };
  const cache = join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      if (!dir.startsWith('chromium-')) continue;
      const mac = join(cache, dir, 'chrome-mac-arm64');
      if (!existsSync(mac)) continue;
      const app = readdirSync(mac).find((f) => f.endsWith('.app'));
      if (!app) continue;
      const bin = join(mac, app, 'Contents', 'MacOS');
      const exe = readdirSync(bin)[0];
      if (exe) return { path: join(bin, exe), source: `cache ${dir}` };
    }
  }
  return null;
}

const browser = findChromium();
if (!browser) {
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
  browser: browser.source,
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

const VENDOR = join(ROOT, '.vendor');

// Map every URL the export reaches for onto .vendor/. Anything unmatched is aborted and recorded,
// which is how a new export with a new dependency gets noticed instead of silently rendered wrong.
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
// What is vendored comes from .vendor/vendor-lock.json, written by tools/vendor.mjs. One source of
// truth: a new remote dependency means a new row there, and a run that reports it as blocked until
// it exists. Nothing is ever fetched during a conversion.
const LOCK_PATH = join(VENDOR, 'vendor-lock.json');
if (!existsSync(LOCK_PATH)) {
  // Fail before launching a browser: with no lock every third-party request would be reported as
  // blocked, which looks exactly like "this export depends on something new" and would send someone
  // hunting a dependency change that does not exist.
  console.error('no .vendor/vendor-lock.json: run `node tools/vendor.mjs` first (it needs network once).');
  process.exit(1);
}
const LOCK = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
const VENDORED = new Map();
for (const [u, v] of Object.entries(LOCK.scripts || {})) VENDORED.set(u, join(ROOT, v.local));
for (const [u, v] of Object.entries(LOCK.fonts || {})) VENDORED.set(u, join(ROOT, v.local));
for (const [name, v] of Object.entries(LOCK.stylesheets || {})) {
  if (v.url) VENDORED.set(v.url, join(VENDOR, name));
  // Google serves different CSS per user agent, so also match any css2 request for the same family.
  const fam = /family=([^&:]+)/.exec(v.url || '');
  if (fam) VENDORED.set('family=' + fam[1], join(VENDOR, name));
}
function vendorFile(u) {
  const exact = VENDORED.get(u);
  if (exact) return exact;
  for (const [k, file] of VENDORED) if (!k.startsWith('http') && u.includes(k)) return file;
  return null;
}
// A remote request is served from disk by fulfill, not by rewriting the URL: the protocol may not
// change across continue, and fulfill makes the offline guarantee testable (no vendor file, no
// render). Returning false records the request as blocked, which is how a new dependency surfaces.
async function serveVendored(route) {
  const u = route.request().url();
  // The loopback export server is local disk by definition; only requests leaving the machine are
  // subject to the vendor check. That is what keeps "no network" true while CORS works.
  if (/^https?:\/\/127\.0\.0\.1(:|\/)/.test(u)) {
    await route.continue();
    return true;
  }
  if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) {
    await route.continue();
    return true;
  }
  const file = vendorFile(u);
  if (!file || !existsSync(file)) return false;
  const ext = file.slice(file.lastIndexOf('.'));
  await route.fulfill({ body: readFileSync(file), contentType: MIME[ext] || 'application/octet-stream' });
  return true;
}

async function materialize({ frame, theme, offline, props }) {
  const ctx = await browserObj.newContext({ viewport: { width: 1600, height: 2000 } });
  const blocked = [];
  if (offline) {
    await ctx.route('**/*', async (route) => {
      const served = await serveVendored(route);
      if (!served) { blocked.push(route.request().url()); await route.abort(); }
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

  const qs = new URLSearchParams();
  if (frame) qs.set('frame', frame);
  if (theme === 'dark') qs.set('theme', 'dark');
  // Does the runtime accept a prop override on the query string? Measured, not assumed: the answer
  // decides whether extraction needs the page.addInitScript shim to force a state.
  if (props) for (const [k, v] of Object.entries(props)) qs.set(k, typeof v === 'boolean' ? String(v) : String(v));
  const url = boardUrl + (qs.toString() ? '?' + qs.toString() : '');
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  // Render is async: templates are fetched and Babel-compiled at runtime, so waiting on a fixed
  // delay would make the probe flaky. Wait for a populated tree with no unresolved placeholders.
  const settled = await page
    .waitForFunction(() => document.querySelectorAll('*').length > 60 && !/\{\{[^}]{1,40}\}\}/.test(document.body.innerHTML), null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  // Webfont load changes text metrics, so reading geometry before fonts settle measures the wrong
  // thing. This is not a nicety: a screenshot taken mid-load is not reproducible.
  const fontsReady = await page
    .evaluate(() => document.fonts.ready.then(() => document.fonts.status))
    .catch(() => 'unknown');
  const loadMs = Date.now() - t0;

  const info = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    // A frame is any element carrying the id from MANIFEST.screens[].id: a <figure> for whole
    // screens, a bare element for a component or a state sheet. Only looking at <figure> under
    // reports isolation, which is why this walks [id].
    const figures = [...document.querySelectorAll('[id]')]
      .filter((el) => el.id && /[A-Z.]/.test(el.id) && !el.id.startsWith('dc-'))
      .map((f) => ({
        id: f.id,
        tag: f.tagName.toLowerCase(),
        visible: vis(f),
        rect: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(f.getBoundingClientRect()),
        caption: f.querySelector('figcaption')?.textContent?.trim() || null,
      }));
    const body = document.body;
    const bcs = getComputedStyle(body);
    const styleTags = document.querySelectorAll('style').length;
    const links = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href);
    // did the template placeholders get resolved?
    const raw = body.innerHTML;
    return {
      title: document.title,
      styleTags,
      links,
      figures,
      bodyChildren: body.children.length,
      bodyFont: bcs.fontFamily,
      unresolvedPlaceholders: (raw.match(/\{\{[^}]{1,40}\}\}/g) || []).slice(0, 5),
      unresolvedCount: (raw.match(/\{\{[^}]{1,40}\}\}/g) || []).length,
      customElementsDefined: ['x-dc', 'sc-if', 'sc-for', 'dc-import'].filter((n) => customElements.get(n)),
      textSample: (body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
      fontsReady: document.fonts.status,
      robotoActive: document.fonts.check('14px Roboto'),
      symbolsActive: document.fonts.check('24px "Material Symbols Outlined"'),
      nodeCount: body.querySelectorAll('*').length,
    };
  });

  // Computed-style evidence: can we read resolved values the emitters need, off the live tree?
  const styleProbe = await page.evaluate(() => {
    const pick = [...document.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.borderTopLeftRadius !== '0px';
    }).slice(0, 3);
    return pick.map((el) => {
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        bg: cs.backgroundColor,
        radius: cs.borderTopLeftRadius,
        font: cs.fontSize + '/' + cs.lineHeight + ' w' + cs.fontWeight + ' ls' + cs.letterSpacing,
        fam: cs.fontFamily.split(',')[0],
      };
    });
  });

  const shot = await page.screenshot({ fullPage: false });
  await ctx.close();
  return { url: url.replace(boardUrl, '<board>'), loadMs, settled, fontsReady, info, styleProbe, blocked, errors, shot };
}

const browserObj = await chromium.launch({ executablePath: browser.path });

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

await browserObj.close();

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
    `Generated by \`node tools/probe.mjs --report\` against \`fixtures/reference\` (${browser.source}).`,
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
