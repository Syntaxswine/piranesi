#!/usr/bin/env node
/**
 * tools/serve.mjs — a zero-dependency static server for the project root.
 *
 * It exists for one reason: ES modules will not load over file://, so the
 * game needs *a* server, and SPEC §0 forbids dependencies. Node's own http and
 * fs, nothing else.
 *
 * The MIME table is the load-bearing part. A .js or .mjs served as text/plain
 * is refused by every browser's module loader, and the failure looks like a
 * broken game rather than a broken server.
 *
 * Usage:  node tools/serve.mjs [--port 8756] [--root .]
 */

import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const PORT = Number(arg('--port', process.env.PORT || 8749));
const ROOT = resolve(arg('--root', ROOT_DEFAULT));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  // The three that decide whether the game loads at all.
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  // The score. `decodeAudioData` ignores content-type, so the game works
  // without this line — but we send `nosniff`, so without it the mp3 is
  // `application/octet-stream` and an <audio> element (or just opening the
  // file in a tab to listen to it) would be refused. docs/AUDIO.md.
  '.mp3': 'audio/mpeg',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'bad request');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'method not allowed', { allow: 'GET, HEAD' });
  }

  // Resolve inside ROOT, and refuse anything that climbs out of it.
  let file = resolve(join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, 'forbidden');

  try {
    let st = await fs.stat(file);
    if (st.isDirectory()) {
      file = join(file, 'index.html');
      st = await fs.stat(file);
    }
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': st.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.end()).pipe(res);
  } catch {
    send(res, 404, `not found: ${pathname}`);
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use — something else is serving there`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`carceri: serving ${ROOT}`);
  console.log(`  http://localhost:${PORT}/`);
});
