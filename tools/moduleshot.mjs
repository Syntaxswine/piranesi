#!/usr/bin/env node
// tools/moduleshot.mjs — photograph a cube, or a whole assembly of them.
//
// A module is twelve metres of architecture and there is no way to author one
// blind.  This renders a single cube from a three-quarter view, or a compound's
// whole tile sheet ASSEMBLED, which is the only way to see whether the cut
// faces actually cancel.
//
//   node tools/moduleshot.mjs --list
//   node tools/moduleshot.mjs --module bay
//   node tools/moduleshot.mjs --module great-vault            (assembled)
//   node tools/moduleshot.mjs --module great-vault --tiles    (laid out apart)
//   node tools/moduleshot.mjs --module bay --run 3            (three in a row)
//
// `--seam` is the one that matters for sliced forms: it renders the compound
// assembled AND reports how many faces cancelled.  A tile sheet whose faces do
// not cancel has visible membranes between its tiles, and it will look like
// four small vaults rather than one big one.

import { writePNG } from './png.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildModules, stampCompound, MODULE, MODULE_METRES } from '../js/modules.js';
import { World } from '../js/world.js';
import { Camera, DEG } from '../js/math.js';
import { Engraver } from '../js/engrave.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const cat = buildModules();

if (has('--list')) {
  console.log(`cube = ${MODULE} cells = ${MODULE_METRES} m\n`);
  for (const c of cat.compounds.values()) {
    const t = c.tiles.join('x');
    console.log(`${c.id.padEnd(14)} ${t.padEnd(6)} ${c.name}`);
    console.log(`${''.padEnd(14)}        ${c.note}\n`);
  }
  process.exit(0);
}

const id = arg('--module', 'bay');
const run = Number(arg('--run', '1'));
const spread = has('--tiles');
const compound = cat.compounds.get(id);
if (!compound) { console.error(`no such module: ${id} (try --list)`); process.exit(1); }

const world = new World(cat);
if (spread) {
  // Lay the tiles out with a cube of air between them, so each can be seen
  // whole.  Deliberately NOT the default: apart, they always look fine.
  for (const p of compound.parts) {
    world.place(
      Math.round(p.at[0] / MODULE) * MODULE * 2,
      Math.round(p.at[1] / MODULE) * MODULE * 2,
      Math.round(p.at[2] / MODULE) * MODULE * 2,
      p.id, 0,
    );
  }
} else {
  for (let n = 0; n < run; n++) stampCompound(world, cat, 0, n * compound.tiles[1], 0, id, 0);
}

const b = world.bounds();
const [W, H] = arg('--size', '900x760').split('x').map(Number);
const cx = (b.lo[0] + b.hi[0]) / 2, cy = (b.lo[1] + b.hi[1]) / 2;
const diag = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]);
const yawDeg = Number(arg('--yaw', '58'));
const dist = Number(arg('--dist', String(diag * 0.95 + 14)));
const yaw = yawDeg * DEG;

const cam = new Camera({
  eye: [cx - Math.cos(yaw) * dist, cy - Math.sin(yaw) * dist, b.lo[2] + Number(arg('--eyez', '3'))],
  yaw,
  shift: H * Number(arg('--shift', '0.22')),
});
cam.setFraming({ width: W, height: H, hfovDeg: Number(arg('--fov', '58')) });

const eng = new Engraver({ width: W, height: H, ss: Number(arg('--ss', '2')) });
const r = eng.render(world, cam, cat, {});
const img = eng.plate.develop({});

const out = resolve(arg('--out', `docs/shots/mod-${id.replace(/[^a-z0-9-]/gi, '-')}${spread ? '-tiles' : ''}.png`));
mkdirSync(dirname(out), { recursive: true });
const bytes = writePNG(out, img.data, img.width, img.height);

console.log(`${out}  ${W}x${H}  ${(bytes / 1024).toFixed(0)} kB`);
console.log(`  ${compound.name} — ${compound.tiles.join('x')} cubes, ${world.size} tiles placed, ${world.cellCount} cells`);
console.log(`  faces ${r.faces} (${r.visible} visible)  CANCELLED ${r.cancelled}  strokes ${r.hatchLines}  ${r.ms.total.toFixed(0)} ms  ink ${(r.ink * 100).toFixed(0)}%`);
if (!spread && compound.parts.length > 1) {
  // The number that says whether a sliced form is one object or several.
  console.log(`  ${r.cancelled === 0 ? '!! NO FACES CANCELLED — the tiles are not meeting; expect membranes between them' : 'tiles are meeting'}`);
}
