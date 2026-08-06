#!/usr/bin/env node
// tools/tonecheck.mjs — the transfer curve: what tone did we ASK for, and what
// tone did the plate actually come out?
//
// This tool exists because every tone claim in the hatching literature is an
// approximation that drifts.  "Two crossed families of duty d cover 2d − d²" is
// true of ideal zero-width geometry and false of an antialiased rasteriser,
// which adds most of a pixel to every stroke it draws; the first duty-cycle
// hatcher in this repo asked for 55% ink and delivered 66%, and the error was
// invisible in the picture — it just looked like a decision somebody had made.
//
// So: hatch one enormous flat wall at a known constant tone, measure the ink,
// and print target against achieved.  Run it after ANY change to the hatcher,
// the stroke rasteriser, or the register ladder.
//
//   node tools/tonecheck.mjs
//   node tools/tonecheck.mjs --steps 20 --ss 2
//
// A good curve is monotonic, passes near the diagonal, and does not saturate
// before the top.  A curve that flattens early means the darkest registers are
// wasting ink on strokes that are already covered.

import { buildCatalog } from '../js/blocks.js';
import { World } from '../js/world.js';
import { Camera, DEG } from '../js/math.js';
import { Engraver, DEFAULTS } from '../js/engrave.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const STEPS = Number(arg('--steps', '16'));
const W = 300, H = 300;
const ss = Number(arg('--ss', '2'));

const catalog = buildCatalog();

// A flat wall filling the frame, face-on, at a fixed distance.  Face-on so the
// projection is not foreshortened and the pitch measurement means what it says.
const world = new World(catalog);
for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) world.place(x, 6, z, 'ashlar');

const cam = new Camera({ eye: [0.5, 0, 0.5], yaw: 90 * DEG, shift: 0 });
cam.setFraming({ width: W, height: H, hfovDeg: 60 });

const eng = new Engraver({ width: W, height: H, ss });
const opts = { coursing: false, lines: false, sky: false };

console.log(`pitch ${DEFAULTS.pitchPx} px   ${W}x${H} @ ${ss}x   ink = 1 − mean transmittance`);
console.log('');
console.log('  target   achieved   error    families   bar');
const rows = [];
for (let i = 0; i <= STEPS; i++) {
  const t = i / STEPS;
  const r = eng.render(world, cam, catalog, { ...opts, forceTone: t });
  const ink = eng.plate.meanInk();
  rows.push([t, ink]);
  const fam = t >= 0.78 ? 3 : t >= 0.50 ? 2 : 1;
  const bar = '#'.repeat(Math.round(ink * 46));
  const err = ink - t;
  console.log(`   ${t.toFixed(3)}    ${ink.toFixed(3)}   ${(err >= 0 ? '+' : '')}${err.toFixed(3)}       ${fam}      ${bar}`);
  void r;
}

// The two numbers worth acting on.
let worst = 0, sum = 0, mono = true;
for (let i = 0; i < rows.length; i++) {
  const e = Math.abs(rows[i][1] - rows[i][0]);
  sum += e;
  if (e > worst) worst = e;
  if (i && rows[i][1] < rows[i - 1][1] - 1e-4) mono = false;
}
console.log('');
console.log(`  mean |error| ${(sum / rows.length).toFixed(3)}   worst ${worst.toFixed(3)}   monotonic ${mono ? 'yes' : 'NO — a darker request produced a lighter plate'}`);
console.log(`  saturates at ${rows.filter((r) => r[1] > 0.97).length ? rows.find((r) => r[1] > 0.97)[0].toFixed(2) : 'never'}`);
