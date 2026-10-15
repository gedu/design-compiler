// Read-only loopback static server for a Claude Design export.
//
// Why this exists: the export's runtime loads sibling templates with fetch() to resolve
// <dc-import> ("[dc-runtime] sibling fetch for "PodcastCard" threw: ./PodcastCard.dc.html"), and a
// file:// page has a null origin, so the browser refuses that fetch. Measured in T0, not assumed.
// The answer is a loopback server, which keeps the offline guarantee because it is bound to
// 127.0.0.1 and serves one directory: there is no route from here to the internet.
//
// Confined by construction: every path is resolved inside the served root, and anything outside it
// is a 404. The export stays immutable; this module only ever opens files for reading.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
  '.kt': 'text/plain; charset=utf-8',
};

// Extra request paths mapped to files outside the root (the .vendor/ tree), so a page can load
// pinned third-party runtime without any network. Keys are URL prefixes.
export function serveExport(root, { extra = {}, quiet = true } = {}) {
  const rootReal = realpathSync(resolve(root));
  const extraMap = Object.entries(extra).map(([prefix, dir]) => [prefix, realpathSync(resolve(dir))]);

  const resolvePath = (urlPath) => {
    const clean = decodeURIComponent(urlPath.split('?')[0].replace(/#.*$/, ''));
    for (const [prefix, dir] of extraMap) {
      if (clean === prefix || clean.startsWith(prefix + '/')) {
        const target = resolve(dir, '.' + clean.slice(prefix.length));
        return target.startsWith(dir + sep) || target === dir ? target : null;
      }
    }
    const target = resolve(rootReal, '.' + (clean.startsWith('/') ? clean : '/' + clean));
    return target === rootReal || target.startsWith(rootReal + sep) ? target : null;
  };

  const server = createServer(async (req, res) => {
    const file = resolvePath(req.url || '/');
    if (!file) {
      res.writeHead(404).end('out of scope');
      return;
    }
    try {
      const info = await stat(file);
      const body = info.isDirectory() ? await readFile(join(file, 'index.html')) : await readFile(file);
      const headers = { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' };
      // The design runtime re-reads the same templates; caching off keeps runs honest.
      if (!quiet) console.log(`  200 ${req.url}`);
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  return new Promise((done, fail) => {
    server.once('error', fail);
    // port 0 = an OS-picked free port, so concurrent runs never collide.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      done({
        port,
        origin: `http://127.0.0.1:${port}`,
        url: (p) => `http://127.0.0.1:${port}${p.startsWith('/') ? p : '/' + p}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
