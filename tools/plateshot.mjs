#!/usr/bin/env node
// tools/plateshot.mjs — pull an impression, headless.
//
// THE ONLY INSTRUMENT THAT PHOTOGRAPHS THE GAME.  It runs the real catalogue,
// the real world, the real camera and the real engraver; the browser adds a
// `putImageData` and nothing else.  So a plate pulled here is the plate a player
// sees, and an agent editing the hatcher can look at what it did.
//
//   node tools/plateshot.mjs --scene carceri --out docs/shots/carceri.png
//   node tools/plateshot.mjs --scene probe --size 1400x700 --yaw 60 --eye 4,-14,2
//   node tools/plateshot.mjs --scene bay --passes lines        (line pass only)
//
// `--stats` prints the value histogram, which is the number that matters most:
// a Carceri is a dark, bimodal object.  If the plate is a fat hump of mid-grey
// the renderer has drawn a technical illustration.

import { writePNG } from './png.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildCatalog } from '../js/blocks.js';
import { buildScene, scenes, catalogFor } from '../js/scenes.js';
import { World } from '../js/world.js';
import { Camera, DEG } from '../js/math.js';
import { Engraver } from '../js/engrave.js';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

if (has('--list')) {
  for (const s of Object.values(scenes)) console.log(`${s.id.padEnd(10)} ${s.title} — ${s.note}`);
  process.exit(0);
}

const [W, H] = arg('--size', '900x1200').split('x').map(Number);
const sceneId = arg('--scene', 'carceri');
const out = resolve(arg('--out', `docs/shots/${sceneId}.png`));
const ss = Number(arg('--ss', '2'));

// A cube scene's world is expressed in the MODULE registry, not the block one.
const catalog = catalogFor(sceneId, buildCatalog());
const world = has('--load')
  ? World.fromJSON(catalog, JSON.parse(readFileSync(arg('--load'), 'utf8')))
  : buildScene(sceneId, catalog);

const eye = arg('--eye', null);
const cam = new Camera({
  eye: eye ? eye.split(',').map(Number) : defaultEye(world),
  yaw: Number(arg('--yaw', '90')) * DEG,
  shift: Number(arg('--shift', String(H * 0.22))),
});
cam.setFraming({ width: W, height: H, hfovDeg: Number(arg('--fov', '76')) });

function defaultEye(w) {
  const b = w.bounds();
  if (!b) return [0, -12, 2];
  return [(b.lo[0] + b.hi[0]) / 2, b.lo[1] - (b.hi[1] - b.lo[1]) * 0.42 - 5, b.lo[2] + 2.2];
}

const passes = arg('--passes', 'all');
const opts = {
  lines: passes === 'all' || passes.includes('lines'),
  hatching: passes === 'all' || passes.includes('hatch'),
  coursing: passes === 'all' || passes.includes('course'),
};
if (arg('--target', null)) opts.hatchTarget = Number(arg('--target'));

const eng = new Engraver({ width: W, height: H, ss });
const r = eng.render(world, cam, catalog, opts);
const img = eng.plate.develop({ grain: Number(arg('--grain', '1')), warmth: eng.warmth });

/** `--crop x,y,w,h` — cut a window out of the developed impression, so a fault
 *  can be looked at at its own scale instead of guessed at from a thumbnail. */
let final = img;
const crop = arg('--crop', null);
if (crop) {
  const [cx, cy, cw, ch] = crop.split(',').map(Number);
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((cy + y) * img.width + cx) * 4;
    data.set(img.data.subarray(src, src + cw * 4), y * cw * 4);
  }
  final = { data, width: cw, height: ch };
}

mkdirSync(dirname(out), { recursive: true });
const bytes = writePNG(out, final.data, final.width, final.height);

console.log(`${out}  ${W}x${H}@${ss}x  ${(bytes / 1024).toFixed(0)} kB`);
console.log(`  blocks ${world.size}  faces ${r.faces}  cancelled ${r.cancelled}  hatch strokes ${r.hatchLines}`);
console.log(`  mean ink ${(r.ink * 100).toFixed(1)}%   ` +
  `solid ${r.ms.solid.toFixed(0)}ms  ghost ${r.ms.ghost.toFixed(0)}ms  total ${r.ms.total.toFixed(0)}ms`);

if (has('--stats')) {
  const h = eng.plate.histogram(10);
  console.log('  value histogram, black → paper:');
  for (let i = 0; i < h.length; i++) {
    const bar = '#'.repeat(Math.round(h[i] * 160));
    console.log(`   ${(i / h.length).toFixed(1)}-${((i + 1) / h.length).toFixed(1)} ${(h[i] * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }
  const dark = h.slice(0, 3).reduce((a, b) => a + b, 0);
  const light = h.slice(7).reduce((a, b) => a + b, 0);
  const mid = 1 - dark - light;
  console.log(`  darks ${(dark * 100).toFixed(0)}%  mid ${(mid * 100).toFixed(0)}%  paper ${(light * 100).toFixed(0)}%`);
}
