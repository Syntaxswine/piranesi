#!/usr/bin/env node
// tools/formshot.mjs — LOOK AT THE PRIMARY FORMS.
//
// A contact sheet of the whole vocabulary from cube.js/forms.js, with a figure
// standing beside each one.  The figure is not decoration: a cube in isolation
// has no size, and the owner's spec puts a block at 27 feet — 8.23 m, four and
// three quarter men.  There is no way to see that in a picture of a cube.  Put
// a man in the frame and the question answers itself.
//
//   node tools/formshot.mjs                    the whole shelf
//   node tools/formshot.mjs --one vault-y      one form, big
//   node tools/formshot.mjs --run vault-y      four in a row — DOES IT CANCEL?
//   node tools/formshot.mjs --explore          from inside, at eye height
//
// `--run` is the one that matters, and it prints the cancellation count.  Two
// blocks that line up cancel the faces between them and read as one mass; two
// that do not read as a stack of boxes.  That number is the entire point of the
// cube law.

import { writePNG } from './png.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { World } from '../js/world.js';
import { Camera, DEG } from '../js/math.js';
import { Engraver } from '../js/engrave.js';
import { Mesh, box } from '../js/mesh.js';
import { FORMS } from '../js/forms.js';
import { SUB, BLOCK_METRES, METRES_PER_SUB, BLOCK_FEET } from '../js/cube.js';
import { buildCamera, exploreCamera, BUILD_RADIUS } from '../js/build.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

/* ------------------------------------------------------------- the figure -- */

/** A crude mannequin, 1.75 m, in lattice units.  Five boxes; he is a ruler, not
 *  staffage — the real figures are a separate job with real rules (handoff and
 *  BACKLOG item 2: they must ignore each other absolutely). */
function man() {
  const m = new Mesh();
  const u = 1 / METRES_PER_SUB;                 // lattice units per metre
  const b = (x0, y0, z0, x1, y1, z1) =>
    box(m, [x0 * u, y0 * u, z0 * u], [x1 * u, y1 * u, z1 * u], { mat: 'timber' });
  b(-0.09, -0.06, 0.00, -0.02, 0.06, 0.86);     // legs
  b(0.02, -0.06, 0.00, 0.09, 0.06, 0.86);
  b(-0.16, -0.10, 0.86, 0.16, 0.10, 1.46);      // trunk
  b(-0.24, -0.07, 0.88, -0.16, 0.07, 1.40);     // arms
  b(0.16, -0.07, 0.88, 0.24, 0.07, 1.40);
  b(-0.09, -0.08, 1.46, 0.09, 0.08, 1.75);      // head
  m.finish();
  return m;
}

/* ------------------------------------------------------------- the world -- */

const names = Object.keys(FORMS);
const cat = new Map();
for (const id of names) {
  const mesh = FORMS[id]();
  mesh.finish();
  cat.set(id, { id, name: id, family: 'primary', size: [SUB, SUB, SUB], mesh, layer: 'structure' });
}
const fig = man();
cat.set('man', { id: 'man', name: 'man', family: 'scale', size: [1, 1, 1], mesh: fig, layer: 'fitting' });

const world = new World(cat);
const GAP = SUB * 2;                            // one empty block between
let title = '';

if (has('--run')) {
  const id = arg('--run', 'vault-y');
  const n = Number(arg('--n', '4'));
  for (let i = 0; i < n; i++) world.place(0, i * SUB, 0, id);
  world.place(-2, -SUB, 0, 'man');
  title = `${n} x ${id} in a row`;
} else if (has('--one')) {
  const id = arg('--one', 'vault-y');
  world.place(0, 0, 0, id);
  world.place(-2, 1, 0, 'man');
  title = id;
} else {
  const COLS = Number(arg('--cols', '4'));
  names.forEach((id, i) => {
    const cx = (i % COLS) * GAP, cy = -Math.floor(i / COLS) * GAP;
    world.place(cx, cy, 0, id);
    world.place(cx - 2, cy + 1, 0, 'man');
  });
  title = `${names.length} primary forms`;
}

/* ------------------------------------------------------------- the camera -- */

const [W, H] = arg('--size', has('--one') || has('--run') ? '900x700' : '1500x1000').split('x').map(Number);
const b = world.bounds();
const cam = new Camera({});

if (has('--explore')) {
  exploreCamera(cam, {
    eye: [(b.lo[0] + b.hi[0]) / 2, b.lo[1] - SUB * 1.2, 1.75 / METRES_PER_SUB],
    yaw: Number(arg('--yaw', '90')) * DEG, shift: H * 0.26, width: W, height: H, fov: 76,
  });
} else {
  // Frame the model, not the layer.  buildCamera takes a zoom rather than a
  // target size because the GAME wants a stable view that does not jump when a
  // block is placed; an instrument wants the opposite, so it solves for zoom.
  const span = Math.max(b.hi[0] - b.lo[0], (b.hi[1] - b.lo[1]) * 1.25, 1);
  buildCamera(cam, {
    centre: [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2],
    layer: 0, yaw: Number(arg('--yaw', '48')) * DEG,
    zoom: Number(arg('--zoom', String(BUILD_RADIUS / (span * 0.60)))),
    width: W, height: H,
  });
}

const eng = new Engraver({ width: W, height: H, ss: Number(arg('--ss', '2')) });
const r = eng.render(world, cam, cat, { skin: arg('--skin', 'stone') });
const img = eng.plate.develop({ warmth: eng.warmth });

const out = resolve(arg('--out', 'docs/shots/forms.png'));
mkdirSync(dirname(out), { recursive: true });
const bytes = writePNG(out, img.data, img.width, img.height);

console.log(`${out}  ${W}x${H}  ${(bytes / 1024).toFixed(0)} kB   ${title}`);
console.log(`  block ${SUB} sub-blocks = ${BLOCK_FEET} ft = ${BLOCK_METRES.toFixed(3)} m` +
  `   a man is ${(1.75 / BLOCK_METRES).toFixed(2)} of a block tall`);
console.log(`  faces ${r.faces} (${r.visible} visible)  CANCELLED ${r.cancelled}  ${r.ms.total.toFixed(0)} ms`);

// THE NUMBER THE CUBE LAW EXISTS TO MOVE.
//
// Zero cancellations is only a fault if the form actually PRESENTS something on
// the joint.  A free-standing column stands clear of its own boundary and has
// nothing to cancel; reporting that as "the law is not being obeyed" is an
// instrument crying wolf, and an instrument that cries wolf gets ignored.  So
// count what the form offers on the run axis first, and only then judge.
if (has('--run')) {
  const id = arg('--run', 'vault-y');
  const m = cat.get(id).mesh;
  // Slide the form's +y faces one block along and see whether any lands exactly
  // on a -y face, using the renderer's own ring hash.  Counting faces alone is
  // not enough: `niche` bites a half-round out of ONE face, so its two ends
  // genuinely differ, its neighbour's flat wall correctly closes the recess
  // instead of dissolving into it, and nothing should cancel.
  const ring = (f, dy = 0) => f.v.map((i) => m.verts[i])
    .map((p) => `${Math.round(p[0] * 8192)}:${Math.round((p[1] + dy) * 8192)}:${Math.round(p[2] * 8192)}`)
    .sort().join('|');
  const minus = new Set(m.faces.filter((f) => f.side === '-y').map((f) => ring(f, SUB)));
  const offered = m.faces.filter((f) => f.side === '+y' && minus.has(ring(f))).length;
  if (!offered) {
    console.log(`  nothing cancelled, and nothing should: ${id} presents no MATCHING pair ` +
      `on the joint — its two ends differ, or it stands clear of its own boundary`);
  } else if (r.cancelled > 0) {
    console.log(`  the run cancelled ${r.cancelled} faces of the ${offered} ${id} offers — ` +
      `the blocks met and read as one mass`);
  } else {
    console.log(`  ** NOTHING CANCELLED, but ${id} offers ${offered} MATCHING faces ** — ` +
      `they are not landing in the same place; the cube law is being broken somewhere`);
  }
}
