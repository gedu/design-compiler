#!/usr/bin/env node
// Vendor the runtime the Claude Design export needs, so conversion never needs the network.
// The export's support.js hardcodes three unpkg URLs (React, ReactDOM, Babel) and the templates
// <link> two Google Fonts stylesheets. spec/01 forbids remote resources, so we fetch once, verify,
// and serve from .vendor/ through the extractor's request router.
//
//   node tools/vendor.mjs            # download whatever is missing
//   node tools/vendor.mjs --force    # refetch everything
//
// .vendor/ is gitignored on purpose: it is third-party content pinned by URL, not our artifact.
// The pin list below is the source of truth; a new export that references another URL must add a
// row here, not silently load it at runtime.

import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, '.vendor');
const FORCE = process.argv.includes('--force');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

// Pinned scripts, exactly as support.js requests them.
const SCRIPTS = [
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
];

// Pinned stylesheets. The Google CSS body is UA-dependent, so we store our own rewrite that
// points at the woff2 files we downloaded from the same response.
const STYLESHEETS = [
  {
    name: 'roboto.css',
    url: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap',
  },
  {
    name: 'material-symbols-outlined.css',
    url: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block',
  },
];

const local = (u) => u.split('/').pop().replace(/^@/, '').replace(/\//g, '_');

async function get(url, opts = {}) {
  const res = await fetch(url, { headers: opts.ua ? { 'user-agent': UA } : {}, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.arrayBuffer();
}

async function ensure(file, url, opts = {}) {
  if (existsSync(file) && !FORCE) return { file, skipped: true };
  const buf = Buffer.from(await get(url, opts));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return { file, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16) };
}

mkdirSync(join(VENDOR, 'fonts'), { recursive: true });

const lock = { generatedBy: 'tools/vendor.mjs', scripts: {}, fonts: {}, stylesheets: {} };

for (const url of SCRIPTS) {
  const file = join(VENDOR, local(url));
  const r = await ensure(file, url);
  lock.scripts[url] = { local: `.vendor/${local(url)}`, ...r };
  console.log(`script ${r.skipped ? 'cached' : `${r.bytes}B ${r.sha256}`}  ${url}`);
}

for (const { name, url } of STYLESHEETS) {
  const css = Buffer.from(await get(url, { ua: true })).toString('utf8');
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com[^)]*/g) || [])];
  for (const fu of urls) {
    const base = fu.split('/').pop();
    const file = join(VENDOR, 'fonts', base);
    const r = await ensure(file, fu);
    lock.fonts[fu] = { local: `.vendor/fonts/${base}`, ...r };
  }
  // Keep the CSS byte-identical to what Google served. The extractor serves each woff2 URL from disk
  // by the exact URL in vendor-lock.json; rewriting paths here would change which URL the browser
  // asks for, and a rewritten relative path resolves against the stylesheet URL, not the disk.
  const local = css;
  writeFileSync(join(VENDOR, name), local);
  lock.stylesheets[name] = { url, faces: (css.match(/@font-face/g) || []).length, files: urls.length };
  console.log(`css    ${(local.length + 'B').padEnd(7)} ${name}  (${urls.length} font files)`);
}

writeFileSync(join(VENDOR, 'vendor-lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log(`\nwrote .vendor/vendor-lock.json (${Object.keys(lock.scripts).length} scripts, ${Object.keys(lock.fonts).length} fonts)`);
