// Frame-materialization transport, extracted verbatim from tools/probe.mjs so a second tool can
// render one frame of one export directory without copying it (spec/03-extraction.md, Capture).
//
// What this module owns:
//   - locating the cached chromium binary (or honoring CHROME=),
//   - the request router that serves ONLY what .vendor/vendor-lock.json pins,
//   - materialize(): load one frame over the loopback server, settle, wait for fonts, read the page.
//
// What it deliberately does NOT own: CLI parsing, output files, and the loopback server itself.
// `serveExport` from tools/serve.mjs stays the single implementation of that server; importing this
// module starts no browser, binds no port, and writes no file. probe.mjs is a thin caller.
//
// The offline guarantee lives in the router, not in the URL: a request that is not loopback, not
// file/data/blob, and not pinned in the lock is aborted AND recorded. Counting it is what turns a
// new remote dependency into a loud failure instead of a subtly different render.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

// The probe is a dev tool, so Playwright is resolved the ordinary way through package.json.
export function findChromium() {
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

// Fail before launching a browser: with no lock every third-party request would be reported as
// blocked, which looks exactly like "this export depends on something new" and would send someone
// hunting a dependency change that does not exist. Every consumer gets this same hard exit.
export function requireVendorLock(root = HERE) {
  const lockPath = join(root, '.vendor', 'vendor-lock.json');
  if (!existsSync(lockPath)) {
    console.error('no .vendor/vendor-lock.json: run `node tools/vendor.mjs` first (it needs network once).');
    process.exit(1);
  }
  return { lockPath, lock: JSON.parse(readFileSync(lockPath, 'utf8')) };
}

// Map every URL the export reaches for onto .vendor/. Anything unmatched is aborted and recorded,
// which is how a new export with a new dependency gets noticed instead of silently rendered wrong.
// What is vendored comes from .vendor/vendor-lock.json, written by tools/vendor.mjs. One source of
// truth: a new remote dependency means a new row there, and a run that reports it as blocked until
// it exists. Nothing is ever fetched during a conversion.
export function buildVendorMap(root = HERE) {
  const { lock } = requireVendorLock(root);
  const VENDOR = join(root, '.vendor');
  const VENDORED = new Map();
  for (const [u, v] of Object.entries(lock.scripts || {})) VENDORED.set(u, join(root, v.local));
  for (const [u, v] of Object.entries(lock.fonts || {})) VENDORED.set(u, join(root, v.local));
  for (const [name, v] of Object.entries(lock.stylesheets || {})) {
    if (v.url) VENDORED.set(v.url, join(VENDOR, name));
    // Google serves different CSS per user agent, so also match any css2 request for the same family.
    const fam = /family=([^&:]+)/.exec(v.url || '');
    if (fam) VENDORED.set('family=' + fam[1], join(VENDOR, name));
  }
  return VENDORED;
}

// A remote request is served from disk by fulfill, not by rewriting the URL: the protocol may not
// change across continue, and fulfill makes the offline guarantee testable (no vendor file, no
// render). Returning false records the request as blocked, which is how a new dependency surfaces.
export function createVendorRouter({ root = HERE, vendored = buildVendorMap(root) } = {}) {
  function vendorFile(u) {
    const exact = vendored.get(u);
    if (exact) return exact;
    for (const [k, file] of vendored) if (!k.startsWith('http') && u.includes(k)) return file;
    return null;
  }

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

  return { vendored, vendorFile, serveVendored };
}

// Installs the router on a context and returns the blocked-request list, which grows as the page
// runs. The two health gates in spec/03 (blocked requests, unresolved {{ }}) start here.
export async function installOfflineRouter(ctx, { router = createVendorRouter() } = {}) {
  const blocked = [];
  await ctx.route('**/*', async (route) => {
    const served = await router.serveVendored(route);
    if (!served) { blocked.push(route.request().url()); await route.abort(); }
  });
  return blocked;
}

// Open the transport for one board URL: one chromium instance, one vendor router, and materialize()
// bound to that board. The returned frame record ({ url, loadMs, settled, fontsReady, info,
// styleProbe, blocked, errors, shot }) is the shape probe.mjs was written against.
export async function createMaterializer({ boardUrl, root = HERE, executablePath, viewport = { width: 1600, height: 2000 } } = {}) {
  if (!boardUrl) throw new Error('createMaterializer needs boardUrl (from serveExport().url or a file:// URL)');
  const path = executablePath ?? findChromium()?.path;
  if (!path) {
    console.error('no chromium executable found; set CHROME=/path/to/binary');
    process.exit(1);
  }
  const router = createVendorRouter({ root });
  const browser = await chromium.launch({ executablePath: path });
  return {
    browser,
    router,
    close: () => browser.close(),
    materialize: (opts) => materialize({ browser, boardUrl, viewport, router, ...opts }),
  };
}

// What makes a render SETTLED, in the page's own words: the frame the caller asked for exists, has
// been laid out with a non-zero box, has descendants (so its template expanded rather than leaving an
// empty host), and no unresolved {{ }} hole is left anywhere in the document. Each half is needed.
// Existence alone would accept a frame that rendered at zero size or never expanded; the placeholder
// half is health gate 2 of spec/03 and stays exactly as it was.
//
// This replaced `document.querySelectorAll('*').length > 60`, a proxy for "something rendered"
// measured on the reference board and nothing else. A single annotated card renders 21 nodes and
// rendered perfectly (0 blocked, 0 unresolved, a correct 180x272 box) while that count reported it as
// not settled, so the number was an artifact of one fixture's size, not a property of a good render.
// frameId is null when no frame was requested; settling then falls back to "the document has content
// and no holes", the only frame-independent claim available, and it still fails loudly on a board
// that renders nothing.
function settleTest(frameId) {
  return (id) => {
    if (/\{\{[^}]{1,40}\}\}/.test(document.body.innerHTML)) return false;
    if (id === null || id === undefined) return document.querySelectorAll('body *').length > 1;
    const el = document.getElementById(id);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && el.childElementCount > 0;
  };
}

export async function materialize({ browser, boardUrl, frame, theme, offline = true, props, settleTimeoutMs = 20000, viewport = { width: 1600, height: 2000 }, root = HERE, router = createVendorRouter({ root }) } = {}) {
  const ctx = await browser.newContext({ viewport });
  const blocked = offline ? await installOfflineRouter(ctx, { router }) : [];
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
  // delay would make the probe flaky. Wait for the requested frame to have a real box, and keep the
  // timeout: a frame that never renders must still come back settled false and say so, which is why
  // this catches to false instead of throwing.
  const settled = await page
    .waitForFunction(settleTest(frame ?? null), frame ?? null, { timeout: settleTimeoutMs })
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
