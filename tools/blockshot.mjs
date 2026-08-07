#!/usr/bin/env node
// tools/blockshot.mjs - look at what the composer made.
//
// THE INSTRUMENT THIS PROJECT CANNOT PROCEED WITHOUT.  A procedural generator
// is only as good as your ability to see a lot of its output at once: one block
// tells you nothing about whether the generator is producing variety or the
// same block with the furniture moved.  So this draws a CONTACT SHEET - a grid
// of blocks, spaced apart, each from the same angle - and prints each one's
// recipe underneath in the console.
//
//   node tools/blockshot.mjs                     a sheet of 12
//   node tools/blockshot.mjs --n 24 --cols 6
//   node tools/blockshot.mjs --seed 500          a different draw
//   node tools/blockshot.mjs --one 3             one block, big
//   node tools/blockshot.mjs --run 3             three of the SAME block in a row
//
// `--run` is the one that matters for joinery: blocks that look fine alone can
// still refuse to meet.

import { writePNG } from './png.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildCatalog } from '../js/stack.js';
import { SUB, BLOCK_YARDS, BLOCK_METRES } from '../js/cube.js';
import { World } from '../js/world.js';
import { Camera, DEG } from '../js/math.js';
import { Engraver } from '../js/engrave.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const N = Number(arg('--n', '12'));
const COLS = Number(arg('--cols', '4'));
const SEED0 = Number(arg('--seed', '1'));
const cat = buildCatalog(Math.max(N, 1), SEED0);

const world = new World(cat);
const ids = [...cat.keys()];
let placed = [];

if (has('--one')) {
  const k = Number(arg('--one', '0'));
  world.place(0, 0, 0, ids[k % ids.length]);
  placed = [ids[k % ids.length]];
} else if (has('--run')) {
  const k = Number(arg('--runid', '0'));
  const n = Number(arg('--run', '3'));
  for (let i = 0; i < n; i++) world.place(0, i * SUB, 0, ids[k % ids.length]);
  placed = [ids[k % ids.length]];
} else {
  // The contact sheet: a gap of one block between each, so a silhouette is a
  // silhouette and not a collision.
  ids.slice(0, N).forEach((id, i) => {
    const cx = i % COLS, cy = Math.floor(i / COLS);
    world.place(cx * SUB * 2, -cy * SUB * 2, 0, id);
    placed.push(id);
  });
}

const b = world.bounds();
const [W, H] = arg('--size', has('--one') || has('--run') ? '900x800' : '1500x1100').split('x').map(Number);
const cx = (b.lo[0] + b.hi[0]) / 2, cy = (b.lo[1] + b.hi[1]) / 2;
const diag = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]);
const yaw = Number(arg('--yaw', '55')) * DEG;
const dist = Number(arg('--dist', String(diag * 0.85 + 16)));

// The BUILD camera: a three-quarter overhead, which is the only angle that
// shows you a block's plan and its elevation at once.  Pitched, therefore not
// the explore camera; see math.js.
const pitch = Number(arg('--pitch', '34')) * DEG;
const cam = new Camera({
  eye: [
    cx - Math.cos(yaw) * dist * Math.cos(pitch),
    cy - Math.sin(yaw) * dist * Math.cos(pitch),
    b.lo[2] + dist * Math.sin(pitch) + Number(arg('--eyez', '2')),
  ],
  yaw, pitch, shift: H * Number(arg('--shift', '0')),
});
cam.setFraming({ width: W, height: H, hfovDeg: Number(arg('--fov', '52')) });

const eng = new Engraver({ width: W, height: H, ss: Number(arg('--ss', '2')) });
const r = eng.render(world, cam, cat, { skin: arg('--skin', 'stone') });
const img = eng.plate.develop({ warmth: eng.warmth });

const out = resolve(arg('--out', 'docs/shots/blocks.png'));
mkdirSync(dirname(out), { recursive: true });
const bytes = writePNG(out, img.data, img.width, img.height);

console.log(`${out}  ${W}x${H}  ${(bytes / 1024).toFixed(0)} kB`);
console.log(`  block = ${SUB}x${SUB}x${SUB} sub-blocks = ${BLOCK_YARDS} yards = ${BLOCK_METRES.toFixed(3)} m   ${world.size} placed`);
console.log(`  faces ${r.faces} (${r.visible} visible)  cancelled ${r.cancelled}  strokes ${r.hatchLines}  ${r.ms.total.toFixed(0)} ms  ink ${(r.ink * 100).toFixed(0)}%`);
console.log('');
// THE RECIPES. Reading these beside the picture is how you tell a generator
// that is varied from one that keeps drawing the same block.
const seen = new Set();
for (const id of placed) {
  const d = cat.get(id);
  if (seen.has(d.id)) continue;
  seen.add(d.id);
  console.log(`  ${d.family.padEnd(6)}  ${d.recipe}`);
}
const tally = {};
for (const d of cat.values()) tally[d.family] = (tally[d.family] || 0) + 1;
console.log('\n  archetype spread: ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('  '));
