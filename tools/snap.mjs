// snap.mjs — receive a rasterised PNG from the running page and write it to disk.
//
// The Browser pane does not always composite frames, so screenshots time out.
// This lets the page render its own SVG to a canvas and POST the bytes here,
// which is both more reliable and higher-fidelity than a viewport capture.
//
//   node tools/snap.mjs [--port 8794] [--out docs/shots]
//
// Then, from the page:
//   fetch('http://localhost:8794/snap?name=warmth-0', {method:'POST', body: pngBlob})

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};

const port = Number(arg('--port', 8794));
const outDir = resolve(process.cwd(), arg('--out', 'docs/shots'));
mkdirSync(outDir, { recursive: true });

const safe = (s) => String(s || 'snap').replace(/[^a-z0-9._-]/gi, '-').slice(0, 80);

createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...cors, 'content-type': 'text/plain' });
    return res.end('POST a PNG body to /snap?name=whatever\n');
  }

  const url = new URL(req.url, `http://localhost:${port}`);
  const name = safe(url.searchParams.get('name'));
  const chunks = [];

  req.on('data', (c) => chunks.push(c));
  req.on('error', () => {
    res.writeHead(400, cors);
    res.end('read error');
  });
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    const file = join(outDir, `${name}.png`);
    try {
      writeFileSync(file, buf);
      console.log(`${file}  ${buf.length} bytes`);
      res.writeHead(200, { ...cors, 'content-type': 'text/plain' });
      res.end(`${file} ${buf.length}\n`);
    } catch (err) {
      console.error(err);
      res.writeHead(500, cors);
      res.end(String(err));
    }
  });
}).listen(port, () => {
  console.log(`snap: POST /snap?name=... -> ${outDir}  (port ${port})`);
});
