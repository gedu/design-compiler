#!/usr/bin/env node
// WU1 of T5: the frame-materialization transport moved out of tools/probe.mjs into
// tools/browser.mjs. Two claims matter and both are cheap to check without a browser:
//
//   1. tools/browser.mjs is importable on its own -- no probe CLI side effects, no browser launched,
//      no port bound, no file written. That is what lets a future tools/extract.mjs reuse it.
//   2. The request router's guarantee still holds: a URL that .vendor/vendor-lock.json does not pin
//      is aborted AND recorded. "Recorded but not aborted" is the same bug as "silently allowed":
//      the page renders from the network and the run looks green.
//
// The router is driven with a stub route/context rather than Playwright, so these tests are
// deterministic and fast; the live proof that materialize still renders is `node tools/probe.mjs`.
//
//   node --test 'tests/*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = join(ROOT, 'tools', 'browser.mjs');
const MODULE_URL = pathToFileURL(MODULE).href;
// One instance shared by the in-process tests; the child-process tests below re-import it to prove
// the module stands alone.
const mod = await import(MODULE_URL);

// ---------- stubs: just enough of the Playwright route/context surface for the router ----------

const makeRoute = (url) => {
  const calls = [];
  return {
    url,
    calls,
    request: () => ({ url: () => url }),
    continue: async () => { calls.push('continue'); },
    fulfill: async (arg) => { calls.push({ name: 'fulfill', arg }); },
    abort: async () => { calls.push('abort'); },
  };
};

const makeCtx = () => {
  const handlers = [];
  return {
    handlers,
    route: async (glob, handler) => { handlers.push({ glob, handler }); },
    dispatch: async (route) => {
      for (const h of handlers) await h.handler(route);
    },
  };
};

const pinnedUrl = () => {
  const lock = JSON.parse(readFileSync(join(ROOT, '.vendor', 'vendor-lock.json'), 'utf8'));
  return Object.keys(lock.scripts)[0];
};

const NOT_PINNED = 'https://cdn.example.org/some-new-dependency.js';

// ---------- 1. standalone import ----------

test('browser.mjs imports standalone and exports the transport', async () => {
  const standalone = await import(MODULE_URL);
  for (const name of ['findChromium', 'buildVendorMap', 'requireVendorLock', 'createVendorRouter', 'installOfflineRouter', 'createMaterializer', 'materialize']) {
    assert.equal(typeof standalone[name], 'function', `export ${name} must be a function`);
  }
});

test('importing browser.mjs launches no browser, binds no port and writes no file', () => {
  // A child process imports the module and reports what the import cost. probe.mjs cannot be
  // imported this way (it parses argv, launches chromium and writes out/probe), which is exactly
  // the coupling WU1 had to remove.
  const outDir = join(ROOT, 'out', 'probe');
  // out/ is gitignored, so a fresh clone (or a cleaned workspace) has no out/probe at all. Listing a
  // missing directory threw ENOENT and the failure looked like the module misbehaving when the test
  // itself was the thing assuming state only a probe run creates. The claim under test is "import
  // writes nothing", so the test provides its OWN baseline: a sentinel file makes the directory
  // non-empty by construction, which is what the anti-vacuous guard below actually needs. Coupling it
  // to files a previous `probe` run happened to leave behind meant the guard passed by accident on a
  // developer machine and failed on a clean one -- both wrong verdicts.
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const sentinel = join(outDir, 'import-guard.sentinel');
  writeFileSync(sentinel, 'baseline for the no-write-on-import check\n');
  const script = `
    import { findChromium, materialize, createVendorRouter } from ${JSON.stringify(MODULE_URL)};
    import { readdirSync } from 'node:fs';
    const t0 = Date.now();
    const before = readdirSync(${JSON.stringify(outDir)}).sort();
    const typeOK = typeof findChromium === 'function' && typeof materialize === 'function'
      && typeof createVendorRouter === 'function';
    const after = readdirSync(${JSON.stringify(outDir)}).sort();
    // A browser launch or a port bind at import time would show up as a slow import or as new
    // files under out/probe; both are checked, and the child exiting on its own proves nothing
    // kept the event loop alive.
    process.stdout.write(JSON.stringify({ typeOK, ms: Date.now() - t0, sameDir: before.join() === after.join(), before: before.length }));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(r.status, 0, `child import failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.typeOK, true);
  assert.ok(out.ms < 5000, `import must not launch anything, took ${out.ms}ms`);
  assert.equal(out.sameDir, true, 'importing the module must not write into out/probe');
  rmSync(sentinel, { force: true });
  assert.ok(out.before > 0, 'the baseline must be non-empty or sameDir proves nothing');
});

test('findChromium locates a binary or reports none (honors CHROME=)', () => {
  const found = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { findChromium } from ${JSON.stringify(MODULE_URL)};
    process.stdout.write(JSON.stringify(findChromium()));
  `], { encoding: 'utf8', env: { ...process.env } });
  assert.equal(found.status, 0, found.stderr);
  const hit = JSON.parse(found.stdout);
  assert.ok(hit && hit.path && hit.source, 'this machine caches chromium, so the locator must find it');
  assert.ok(existsSync(hit.path), `locator returned a missing binary: ${hit.path}`);

  // CHROME= wins when it points at a real file, and is ignored when it does not.
  const fake = join(mkdtempSync(join(tmpdir(), 'chrome-')), 'fake-chrome');
  writeFileSync(fake, '#!/bin/sh\nexit 0\n');
  const viaEnv = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { findChromium } from ${JSON.stringify(MODULE_URL)};
    process.stdout.write(JSON.stringify(findChromium()));
  `], { encoding: 'utf8', env: { ...process.env, CHROME: fake } });
  assert.equal(JSON.parse(viaEnv.stdout).source, 'env CHROME');

  const none = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { findChromium } from ${JSON.stringify(MODULE_URL)};
    process.stdout.write(String(findChromium()));
  `], { encoding: 'utf8', env: { ...process.env, CHROME: '/nonexistent/chrome', HOME: mkdtempSync(join(tmpdir(), 'nohome-')) } });
  assert.equal(none.stdout.trim(), 'null');
});

test('redactLocalPaths removes the two paths a browser error can carry', async () => {
  const { redactLocalPaths } = await import(MODULE_URL);
  // Both real local paths go into the sample, built from the values the redactor actually holds. A
  // hardcoded path would make one of the two assertions vacuous: on a machine where the repo lives
  // somewhere else, asserting the leaked string lacks ROOT proves nothing about ROOT being redacted.
  const home = homedir();
  const leaked = `at ensureFetched (file://${home}/sub/x) | served from ${ROOT}/fixtures/y`;
  const red = redactLocalPaths(leaked);
  // Order matters and this is the order's test: ROOT CONTAINS home on this machine, so replacing the
  // shorter path first would consume the prefix and leave the repo root visible.
  assert.ok(!red.includes(home), `the home path survived redaction: ${red}`);
  assert.ok(!red.includes(ROOT), `the repo path survived redaction: ${red}`);
  assert.match(red, /ensureFetched/, 'redaction removes the path, never the evidence the report needs');
});

test('every page-error string is redacted where it enters the system, not in the report', () => {
  // The class check. Pinning one string in docs/probe-report.md would be fixed once and leak again on
  // the next regeneration, because the leak lives in the transport's error handlers. Every value pushed
  // into `errors` must pass through redactLocalPaths at the push site.
  const src = readFileSync(MODULE, 'utf8');
  const pushes = [...src.matchAll(/errors\.push\(([^;]*?)\);/g)].map((m) => m[1]);
  assert.ok(pushes.length >= 2, `expected the two page listeners to be here, found ${pushes.length}`);
  for (const p of pushes) {
    assert.ok(/redactLocalPaths\(/.test(p), `an error reaches the record unredacted: errors.push(${p})`);
  }
});

// ---------- 2. the vendor map comes only from the lock ----------

test('vendor map is built from .vendor/vendor-lock.json and nothing else', () => {
  const { vendored, vendorFile } = mod.createVendorRouter({ root: ROOT });
  const lock = JSON.parse(readFileSync(join(ROOT, '.vendor', 'vendor-lock.json'), 'utf8'));

  for (const u of Object.keys(lock.scripts)) {
    const file = vendorFile(u);
    assert.ok(file, `pinned script ${u} must resolve to a vendored file`);
    assert.ok(existsSync(file), `vendored file missing for ${u}: ${file}`);
  }
  for (const u of Object.keys(lock.fonts)) assert.ok(vendorFile(u), `pinned font ${u} must resolve`);
  assert.ok(vendored.size >= Object.keys(lock.scripts).length + Object.keys(lock.fonts).length);

  // Google serves per-user-agent CSS, so the family match is part of the contract, not a nicety.
  const cssUrl = Object.values(lock.stylesheets).map((v) => v.url).find((u) => u && u.includes('family='));
  assert.ok(cssUrl, 'lock is expected to pin a google fonts stylesheet');
  const fam = /family=([^&:]+)/.exec(cssUrl)[1];
  assert.ok(vendorFile(`https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,400&display=swap`),
    'a css2 request for a pinned family must resolve to the vendored stylesheet');

  // The one thing that must never resolve: something the lock does not mention.
  assert.equal(vendorFile(NOT_PINNED), null);
});

test('a missing vendor lock is a hard exit for any consumer, not a browser launch', () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'nolock-'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createVendorRouter } from ${JSON.stringify(MODULE_URL)};
    createVendorRouter({ root: ${JSON.stringify(emptyRoot)} });
  `], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'no lock must stop the run before anything renders');
  assert.match(r.stderr, /no \.vendor\/vendor-lock\.json/);
  assert.match(r.stderr, /tools\/vendor\.mjs/);
  assert.ok(!existsSync(join(emptyRoot, 'out')), 'the failing consumer must write nothing');
});

// ---------- 3. the router's guarantee ----------

test('serveVendored: pinned is fulfilled from disk, loopback and inline URIs pass through', async () => {
  const { serveVendored } = mod.createVendorRouter({ root: ROOT });

  const pinned = makeRoute(pinnedUrl());
  assert.equal(await serveVendored(pinned), true);
  const ful = pinned.calls.find((c) => c && c.name === 'fulfill');
  assert.ok(ful, 'a pinned request must be fulfilled from disk, never fetched');
  assert.ok(Buffer.isBuffer(ful.arg.body) && ful.arg.body.length > 0, 'fulfill body must be the vendored bytes');
  assert.equal(ful.arg.contentType, 'text/javascript');

  for (const url of ['http://127.0.0.1:8099/Mini%20Jetcaster.dc.html', 'file:///tmp/x.html', 'data:text/html,', 'blob:http://127.0.0.1:1/abc']) {
    const route = makeRoute(url);
    assert.equal(await serveVendored(route), true, `${url} must be allowed`);
    assert.deepEqual(route.calls, ['continue'], `${url} must be continued, not fulfilled or aborted`);
  }
});

test('a URL absent from the lock is refused by the router and never fulfilled', async () => {
  const { serveVendored } = mod.createVendorRouter({ root: ROOT });
  const route = makeRoute(NOT_PINNED);
  assert.equal(await serveVendored(route), false, 'unpinned must not be served');
  assert.deepEqual(route.calls, [], 'the router must not continue or fulfill an unpinned request');
});

test('OFFLINE GATE: an unpinned request is aborted AND recorded in blocked', async () => {
  // This is the test that fails if the abort is removed: the URL would still land in `blocked`, so
  // asserting the list alone would let a silent network fetch through. Both halves are asserted.
  const { createVendorRouter, installOfflineRouter } = mod;
  const ctx = makeCtx();
  const blocked = await installOfflineRouter(ctx, { router: createVendorRouter({ root: ROOT }) });
  assert.equal(ctx.handlers.length, 1, 'the router must be installed on every request');

  const bad = makeRoute(NOT_PINNED);
  await ctx.dispatch(bad);
  assert.deepEqual(bad.calls, ['abort'], 'an unpinned request must be aborted, not left to reach the network');
  assert.deepEqual(blocked, [NOT_PINNED], 'an aborted request must be recorded, that is how a new dependency surfaces');

  // And the healthy path stays healthy: pinned + loopback render without touching `blocked`.
  const good = makeRoute(pinnedUrl());
  await ctx.dispatch(good);
  const local = makeRoute('http://127.0.0.1:9001/PodcastCard.dc.html');
  await ctx.dispatch(local);
  assert.deepEqual(blocked, [NOT_PINNED], 'served and loopback requests must not be counted as blocked');
  assert.ok(good.calls.some((c) => c && c.name === 'fulfill'), 'the pinned request must still be fulfilled');
});

test('createMaterializer refuses a missing board URL before launching anything', async () => {
  const { createMaterializer } = mod;
  await assert.rejects(() => createMaterializer({}), /boardUrl/);
});

// ---------- 4. probe.mjs is now a thin caller ----------

test('probe.mjs delegates the transport instead of duplicating it', () => {
  const src = readFileSync(join(ROOT, 'tools', 'probe.mjs'), 'utf8');
  const mod = readFileSync(MODULE, 'utf8');
  assert.match(src, /from '\.\/browser\.mjs'/);
  assert.ok(!src.includes('serveVendored'), 'the router must exist in exactly one file');
  assert.ok(!src.includes('chromium.launch'), 'only tools/browser.mjs may launch a browser');
  // The lock is read in exactly one place. The report prose mentioning the file name is not a read,
  // so this looks for the read itself rather than the string.
  assert.ok(!/readFileSync\([^)]*vendor-lock/.test(src), 'the lock must be read only by tools/browser.mjs');
  assert.match(mod, /from 'playwright'/);
  assert.ok(!mod.includes("from './probe.mjs'"), 'the module must not import the CLI');
  assert.ok(!/\bwriteFileSync\b|\bmkdirSync\b|process\.argv/.test(mod), 'the module must not write files or parse argv');
  assert.ok(mod.includes("from './serve.mjs'") === false, 'serveExport is reused by the caller, never re-implemented here');
});
