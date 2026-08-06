// tools/png.mjs — write an RGBA buffer to a PNG.  Node built-ins only.
//
// This file is the reason the renderer never touches a canvas.  The whole
// engraver runs on Float32Arrays, so the same code that draws in the browser can
// draw in a terminal, and an agent working on this repo can LOOK AT ITS OWN ART
// instead of guessing.  Two blind art passes is the going rate for not having
// this; see the sibling projects.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {Uint8ClampedArray|Buffer} rgba  width*height*4
 * Filter type 1 (Sub) on every scanline.  A flat sheet of paper with fine line
 * work compresses far better under Sub than under None, and picking per-line
 * adaptively is not worth the code here.
 */
export function encodePNG(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[row + x - 4] : 0;
      raw[o + 1 + x] = (rgba[row + x] - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writePNG(path, rgba, width, height) {
  const buf = encodePNG(rgba, width, height);
  writeFileSync(path, buf);
  return buf.length;
}
