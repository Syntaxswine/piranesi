#!/usr/bin/env node
// tools/assemble.mjs — BUILD SOMETHING OUT OF THE KIT, AND SEE IF IT HOLDS.
//
// A contact sheet shows a hundred blocks side by side and tells you almost
// nothing about whether they are a vocabulary.  The real question is whether
// they TILE: can you fill a region with them so that every seam between two
// blocks is a pair of coincident faces that cancel, leaving one continuous
// interior rather than a heap of boxes?
//
//   node tools/assemble.mjs                          5x5x2 from docs/kit.txt
//   node tools/assemble.mjs --w 7 --d 7 --h 3
//   node tools/assemble.mjs --recipes @docs/shelf.txt
//   node tools/assemble.mjs --seed 9
//
// This is a small constraint solver, not a renderer trick.  A block may go in a
// cell only if the wall it presents to each already-placed neighbour is
// IDENTICAL to the wall that neighbour presents back.  So the number it reports
// — seams matched out of seams possible — is the kit's own claim about itself,
// tested rather than asserted.  If the kit is a vocabulary this fills; if it is
// a hundred strangers it comes back full of holes.

import { writePNG } from './png.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { World } from '../js/world.js';
import { Camera, DEG, projectWith } from '../js/math.js';
import { Engraver } from '../js/engrave.js';
import { blockFromRecipe, add as addBlock, rng } from '../js/stack.js';
import { maskOf, turnMask, keyOf, profile } from '../js/measure.js';
import { SUB, BLOCK_YARDS } from '../js/cube.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const W = Number(arg('--w', '5'));
const D = Number(arg('--d', '5'));
const H = Number(arg('--h', '2'));
const SEED = Number(arg('--seed', '1'));

const spec = arg('--recipes', '@docs/kit.txt');
const src = spec[0] === '@' ? readFileSync(resolve(spec.slice(1)), 'utf8') : spec;
const recipes = src.split(/[\s;]+/).map((s) => s.trim()).filter(Boolean);

/* ------------------------------------------------------------- the parts */

// Every (block, turn) is a separate piece as far as the solver is concerned,
// because a block that will not fit may fit a quarter round.
const parts = [];
for (const recipe of recipes) {
  const mask = maskOf(recipe);
  if (!mask) continue;
  for (let r = 0; r < 4; r++) {
    const m = turnMask(mask, r);
    parts.push({
      recipe, rot: r,
      px: keyOf(profile(m, '+x')), nx: keyOf(profile(m, '-x')),
      py: keyOf(profile(m, '+y')), ny: keyOf(profile(m, '-y')),
      pz: keyOf(profile(m, '+z')), nz: keyOf(profile(m, '-z')),
    });
  }
}
const EMPTY = '0'.repeat(SUB * SUB);

/** How much stone a block holds, 0..1 — used to lean the fill toward rooms. */
const massCache = new Map();
function massOf(recipe) {
  if (massCache.has(recipe)) return massCache.get(recipe);
  const m = maskOf(recipe);
  let n = 0; for (const v of m) n += v;
  const f = n / (SUB * SUB * SUB);
  massCache.set(recipe, f);
  return f;
}
/** How hard to lean. 0 takes the easiest join every time and builds a bunker. */
const AIR = Number(arg('--air', '2.5'));

/* ------------------------------------------------------------ the solver */

/**
 * Fill the grid a cell at a time, in the order the light and gravity care
 * about: bottom layer first, then row by row.  Only the three neighbours
 * already placed constrain a cell, so no backtracking is needed to keep every
 * placed seam exact — a cell with no candidate is left VOID rather than filled
 * with something that does not fit.
 *
 * Leaving it void is the honest failure.  Forcing a block in would produce a
 * picture where the kit appears to work and the seams are quietly wrong, which
 * is precisely the thing this tool exists to detect.
 */
const r = rng(SEED);
const grid = new Map();                       // "x,y,z" -> part
const key = (x, y, z) => `${x},${y},${z}`;
let holes = 0, seams = 0, matched = 0;
const used = new Map();

for (let z = 0; z < H; z++) {
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < W; x++) {
      const west = grid.get(key(x - 1, y, z));
      const south = grid.get(key(x, y - 1, z));
      const below = grid.get(key(x, y, z - 1));
      // A neighbour outside the grid is open air and constrains nothing; a
      // neighbour that came back VOID must be met with a blank wall, or the
      // building grows a face hanging over nothing.
      const wantNx = west ? west.px : (x > 0 ? EMPTY : null);
      const wantNy = south ? south.py : (y > 0 ? EMPTY : null);
      const wantNz = below ? below.pz : (z > 0 ? EMPTY : null);

      const fits = parts.filter((p) =>
        (wantNx === null || p.nx === wantNx)
        && (wantNy === null || p.ny === wantNy)
        && (wantNz === null || p.nz === wantNz));

      if (!fits.length) { holes++; continue; }
      // PREFER OPENNESS, and the reason is a finding rather than a taste.
      //
      // Taking the best-connecting block at each step fills the region
      // perfectly — 105 seams of 105 exact — and produces a BUNKER. Exact-seam
      // matching is biased toward the commonest wall pattern, and the commonest
      // wall pattern in the grammar is the solid wall (976 blocks present it,
      // against 614 for the next). So the easiest join is always "another solid
      // face", the solver takes it every time, and the building comes out as a
      // lump of cheese with a few holes bored in it.
      //
      // A player does not build that way; they build rooms. So: prefer blocks
      // the building has not used yet, and among those prefer the airy ones.
      let best = fits[0], bestV = Infinity;
      for (const p of fits) {
        const v = (used.get(p.recipe) || 0) + massOf(p.recipe) * AIR + r() * 0.6;
        if (v < bestV) { bestV = v; best = p; }
      }
      grid.set(key(x, y, z), best);
      used.set(best.recipe, (used.get(best.recipe) || 0) + 1);
    }
  }
}

// Count the seams AFTER the fact, over the finished building, so the number
// describes what was built rather than what the solver believed.
for (let z = 0; z < H; z++) {
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < W; x++) {
      const a = grid.get(key(x, y, z));
      if (!a) continue;
      const pairs = [[grid.get(key(x + 1, y, z)), 'px', 'nx'], [grid.get(key(x, y + 1, z)), 'py', 'ny'], [grid.get(key(x, y, z + 1)), 'pz', 'nz']];
      for (const [b, mine, theirs] of pairs) {
        if (!b) continue;
        seams++;
        if (a[mine] === b[theirs]) matched++;
      }
    }
  }
}

/* ------------------------------------------------------------ the plate */

const cat = new Map();
for (const recipe of new Set([...grid.values()].map((p) => p.recipe))) addBlock(cat, recipe);
cat.families = [...new Set([...cat.values()].map((d) => d.family))];

const world = new World(cat);
for (const [k, p] of grid) {
  const [x, y, z] = k.split(',').map(Number);
  world.place(x * SUB, y * SUB, z * SUB, p.recipe, p.rot);
}

const b = world.bounds();
const [PW, PH] = arg('--size', '1700x1200').split('x').map(Number);
const cx = (b.lo[0] + b.hi[0]) / 2, cy = (b.lo[1] + b.hi[1]) / 2;
const diag = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
const yaw = Number(arg('--yaw', '52')) * DEG;
const pitch = Number(arg('--pitch', '26')) * DEG;
const FOV = Number(arg('--fov', '54'));

const camAt = (d) => {
  const c = new Camera({
    eye: [cx - Math.cos(yaw) * d * Math.cos(pitch), cy - Math.sin(yaw) * d * Math.cos(pitch), b.lo[2] + d * Math.sin(pitch) + 2],
    yaw, pitch, shift: PH * Number(arg('--shift', '0.04')),
  });
  c.setFraming({ width: PW, height: PH, hfovDeg: FOV });
  return c;
};
const corners = [];
for (const x of [b.lo[0], b.hi[0]]) for (const y of [b.lo[1], b.hi[1]]) for (const z of [b.lo[2], b.hi[2]]) corners.push([x, y, z]);
const fits = (d) => {
  const c = camAt(d).snapshot();
  for (const [x, y, z] of corners) {
    const [px, py, iz] = projectWith(c, x, y, z);
    if (iz < 0 || px < PW * 0.04 || px > PW * 0.96 || py < PH * 0.04 || py > PH * 0.96) return false;
  }
  return true;
};
let lo = 1, hi = Math.max(64, diag * 5);
if (fits(hi)) for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
const cam = camAt(argv.includes('--dist') ? Number(arg('--dist', '0')) : hi);

const eng = new Engraver({ width: PW, height: PH, ss: Number(arg('--ss', '2')) });
const res = eng.render(world, cam, cat, { skin: arg('--skin', 'stone') });
const img = eng.plate.develop({ warmth: eng.warmth });

const out = resolve(arg('--out', 'docs/shots/assembled.png'));
mkdirSync(dirname(out), { recursive: true });
writePNG(out, img.data, img.width, img.height);

const cells = W * D * H;
console.log(`${out}  ${PW}x${PH}`);
console.log(`  ${W}x${D}x${H} = ${cells} cells · ${grid.size} filled · ${holes} left void (no block fits)`);
console.log(`  seams ${matched}/${seams} exact  (${seams ? (100 * matched / seams).toFixed(1) : '0'}%)`);
console.log(`  faces ${res.faces} (${res.visible} visible)  CANCELLED ${res.cancelled}  ${res.ms.total.toFixed(0)} ms`);
console.log(`  ${used.size} of ${recipes.length} kit blocks used · a block is ${BLOCK_YARDS} yards cubed`);
if (has('--parts')) {
  for (const [k, n] of [...used.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${k}`);
}
