#!/usr/bin/env node
// tools/layershot.mjs — LOOK AT THE LAYER FEEDBACK.
//
// The one thing about this game that cannot be checked by reading code: whether
// a player, looking at the build view, can tell at a glance which layer is live.
// So this builds a three-layer stack and renders it from the build camera with
// the working layer set where you ask, and prints the achieved VALUES per band
// on the owner's 0–100 scale so the numbers can be held against the spec:
//
//     ghost layers   0–30
//     dark layers    base + 30…40
//
//   node tools/layershot.mjs                    working layer 1 of 0,1,2
//   node tools/layershot.mjs --layer 0          stand at the bottom
//   node tools/layershot.mjs --layers 4 --layer 2
//   node tools/layershot.mjs --flat             one layer only, no bands
//
// `--flat` is the control: it is the same picture with the banding switched off,
// and comparing the two is how you tell layer feedback from a change in the
// palette.

import { writePNG } from './png.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildCatalog, SUB } from '../js/compose.js';
import { World } from '../js/world.js';
import { Camera } from '../js/math.js';
import { Engraver } from '../js/engrave.js';
import { bandFor, buildCamera, LAYER } from '../js/build.js';
import { bandTone } from '../js/palette.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const LAYERS = Number(arg('--layers', '3'));
const WORK = has('--flat') ? 0 : Number(arg('--layer', String(Math.min(1, LAYERS - 1))));
const SPAN = Number(arg('--span', '2'));           // blocks per side, per layer
const [W, H] = arg('--size', '1100x760').split('x').map(Number);

const cat = buildCatalog(24, Number(arg('--seed', '1')));
const ids = [...cat.keys()];
const world = new World(cat);

// A stepped stack, so every layer has something of its own sticking out — a
// tower of identical footprints tells you nothing about layer feedback because
// the upper layers hide the lower ones exactly.
let k = 0;
const nL = has('--flat') ? 1 : LAYERS;
for (let L = 0; L < nL; L++) {
  const s = Math.max(1, SPAN - L);
  for (let gy = 0; gy < s; gy++) for (let gx = 0; gx < s; gx++) {
    world.place(gx * LAYER, gy * LAYER, L * LAYER, ids[(k++ * 5) % ids.length]);
  }
}

const cam = new Camera({});
buildCamera(cam, {
  centre: [SPAN * LAYER / 2, SPAN * LAYER / 2],
  layer: WORK, yaw: Number(arg('--yaw', '48')) * Math.PI / 180,
  zoom: Number(arg('--zoom', '1')), width: W, height: H,
});

const eng = new Engraver({ width: W, height: H, ss: Number(arg('--ss', '2')) });
const t0 = Date.now();
const r = eng.render(world, cam, cat, {
  skin: arg('--skin', 'stone'),
  bandOf: has('--flat') ? null : bandFor(WORK),
});
const img = eng.plate.develop({ warmth: eng.warmth });

const out = resolve(arg('--out', 'docs/shots/layers.png'));
mkdirSync(dirname(out), { recursive: true });
const bytes = writePNG(out, img.data, img.width, img.height);

console.log(`${out}  ${W}x${H}  ${(bytes / 1024).toFixed(0)} kB`);
console.log(`  ${nL} layers, working on ${WORK}${has('--flat') ? '  (FLAT — bands off)' : ''}`);
console.log(`  ${world.size} blocks · faces ${r.faces} (${r.visible} visible, ${r.ghosted} ghosted)`);
console.log(`  ${r.hatchLines} strokes · ${(Date.now() - t0)} ms · ink ${(r.ink * 100).toFixed(1)}%`);

// DID THE BANDS SEPARATE ON THE PAPER?
//
// The transfer table below says what bandTone() promises.  This says what the
// picture actually delivers, which is not the same question: a band whose faces
// all start pale lands in the same place as the band above it however correct
// the arithmetic is.  Attribute every pixel to the band of the block under it —
// the stencil already knows — and report the mean value each band achieved.
{
  const d = img.data;
  const acc = new Map();
  const add = (band, lum, want) => {
    const a = acc.get(band) || { n: 0, v: 0, want: 0 };
    a.n++; a.v += lum; a.want += want;
    acc.set(band, a);
  };
  const lumAt = (i) => (1 - (d[i * 4] * 0.30 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255) * 100;
  const solid = eng.depth.id, gh = eng.ghostDepth && eng.ghostDepth.id;
  for (let i = 0; i < solid.length; i++) {
    // A GHOST PIXEL IS ONLY HONEST OVER BARE GROUND.  The ghost pass draws over
    // the solid one, so a ghost sitting in front of a wall measures the wall.
    // Scoring those as ghost was the first version of this and it reported the
    // ghost band four times darker than it is.
    const g = gh ? gh[i] : -1;
    const k = g >= 0 && solid[i] < 0 ? g : solid[i];
    if (k < 0) continue;
    const b = eng.faceBlock[k];
    if (!b) continue;
    add(has('--flat') ? 0 : Math.floor(b.z / LAYER) - WORK, lumAt(i), (eng.faceTone[k] ?? 0) * 100);
  }
  console.log('\n  ACHIEVED, on the 0–100 scale        asked   got    px');
  for (const band of [...acc.keys()].sort((x, y) => y - x)) {
    const a = acc.get(band);
    const lbl = band > 0 ? `+${band} up` : band < 0 ? `${-band} down` : 'live';
    console.log(`   ${lbl.padStart(28)}  ${(a.want / a.n).toFixed(1).padStart(5)}` +
      ` ${(a.v / a.n).toFixed(1).padStart(5)}  ${String(a.n).padStart(7)}`);
  }
}

// IS THE TEMPERATURE ACTUALLY REACHING THE PAPER?  A warm/cool scheme that
// resolves to one grey is a silent no-op, and it would look exactly like a
// working one in a thumbnail.  So measure the spread of red-minus-blue over the
// inked pixels — if this is flat, the palette is decorative and nothing more.
{
  const d = img.data;
  let n = 0, lo = 999, hi = -999, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 1] > 200) continue;                    // skip bare ground
    const rb = d[i] - d[i + 2];
    sum += rb; n++;
    if (rb < lo) lo = rb;
    if (rb > hi) hi = rb;
  }
  const wf = eng.warmth;
  let wlo = 9, whi = -9;
  for (let i = 0; i < wf.length; i++) { if (wf[i] < wlo) wlo = wf[i]; if (wf[i] > whi) whi = wf[i]; }
  console.log(`\n  warmth field ${wlo.toFixed(2)} … ${whi.toFixed(2)}` +
    `   ink red−blue ${lo} … ${hi}, mean ${(sum / Math.max(1, n)).toFixed(1)}  over ${n} px`);
}

// THE TRANSFER TABLE.  What a mid-tone face becomes in each band, in the
// owner's units, so the spec can be checked without a colour picker.
console.log('\n  band   a face at base value…');
const bases = [20, 40, 60, 80];
console.log('         ' + bases.map((b) => String(b).padStart(6)).join(''));
for (const band of [3, 2, 1, 0, -1, -2, -3]) {
  const lbl = band > 0 ? `+${band} up` : band < 0 ? `${-band} down` : ' live';
  console.log(`  ${lbl.padStart(7)} ` +
    bases.map((b) => (bandTone(b / 100, band) * 100).toFixed(0).padStart(6)).join(''));
}
void SUB;
