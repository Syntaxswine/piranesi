// scenes.js — buildings, shared by the game and by the instruments.
//
// A scene is a function that fills a World.  They exist so that `plateshot` and
// the browser are looking at the SAME building: a probe that draws its own
// private arrangement certifies its own private arrangement and nothing else.

import { World } from './world.js';

export const scenes = {};
const scene = (id, title, note, build) => { scenes[id] = { id, title, note, build }; };

/* -------------------------------------------------------------------------- */

scene('probe', 'One of each', 'Every block in the catalogue, spaced out and lit the same way. For looking at geometry, not at composition.',
  (w, cat) => {
    const ids = [...cat.keys()];
    let x = 0;
    for (const id of ids) {
      const def = cat.get(id);
      w.place(x, 0, 0, id, 0);
      x += def.size[0] + 1;
    }
    for (let i = -1; i < x + 1; i++) for (let j = -2; j < 3; j++) w.place(i, j, -1, 'paving');
  });

scene('bay', 'A single bay', 'Two piers, one arch, one vault behind it. The smallest thing that shows whether the joinery law holds.',
  (w) => {
    for (let z = 0; z < 2; z++) { w.place(0, 0, z, 'pier'); w.place(3, 0, z, 'pier'); }
    w.place(0, 0, 2, 'arch-4');
    for (let y = 1; y < 5; y++) {
      for (let z = 0; z < 2; z++) { w.place(0, y, z, 'pier'); w.place(3, y, z, 'pier'); }
      w.place(0, y, 2, 'vault-4');
    }
    for (let i = -2; i < 6; i++) for (let j = -3; j < 6; j++) w.place(i, j, -1, 'paving');
  });

/* -------------------------------------------------------------------------- */

scene('carceri', 'The prison', 'A first attempt at a whole plate: a vaulted hall, a gallery above it, stairs that cross the void, and the timber and iron that hold the impossible parts up.',
  (w) => {
    const pave = (x0, x1, y0, y1, z) => {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) w.place(x, y, z, 'paving');
    };

    // --- the floor of the hall ---------------------------------------------
    pave(-4, 10, -2, 22, -1);

    // --- the great vaulted arcade, running away from the eye ----------------
    // Piers to the springing at z=2, then a four-cell vault over the whole run.
    // Consecutive bays cancel their end walls: this is the tunnel.
    for (let y = 0; y <= 20; y++) {
      for (let z = 0; z < 2; z++) {
        w.place(0, y, z, 'pier');
        w.place(3, y, z, 'pier');
      }
      w.place(0, y, 2, 'vault-4');
      // A cornice at the impost, all the way down the run. Piranesi never lets
      // a shaft meet its arch without one.
      if (y % 1 === 0) { /* the cornice is on the pier heads below */ }
    }
    for (let y = 0; y <= 20; y += 1) { w.place(0, y, 1, 'cornice'); w.place(3, y, 1, 'cornice'); }

    // --- the gallery above, and its arcade ---------------------------------
    for (let y = 0; y <= 20; y++) {
      w.place(-2, y, 5, 'paving');
      w.place(-1, y, 5, 'paving');
    }
    for (let y = 0; y <= 18; y += 2) {
      w.place(-2, y, 6, 'arch-2', 1);          // turned to run along y
    }
    for (let y = 0; y <= 20; y += 1) w.place(-1, y, 6, 'balustrade', 1);

    // --- the near pier: the repoussoir --------------------------------------
    // A mass close to the eye, cropped by the frame, almost solid black. Every
    // Carceri has one and it is what makes the depth behind it read.
    for (let z = 0; z < 7; z++) { w.place(6, -1, z, 'pier'); w.place(7, -1, z, 'pier'); }
    w.place(6, -1, 2, 'cornice'); w.place(7, -1, 2, 'cornice');
    w.place(6, -1, 4, 'ring', 2);

    // --- the stair that crosses the void ------------------------------------
    for (let i = 0; i < 5; i++) {
      w.place(5, 2 + i * 2, i, 'stair');
      w.place(5, 2 + i * 2, i, 'railing');
    }
    w.place(5, 12, 5, 'landing');
    w.place(5, 13, 5, 'landing');
    w.place(5, 12, 6, 'balustrade');

    // --- timber: the beams and the gantry that hold it all up ---------------
    w.place(1, 6, 6, 'beam', 0);
    w.place(1, 13, 7, 'beam', 0);
    w.place(5, 4, 5, 'gantry');
    w.place(5, 4, 7, 'gantry');
    for (let y = 7; y <= 11; y++) w.place(4, y, 6, 'catwalk', 1);

    // --- the lamp: the only light the eye can find ---------------------------
    w.place(2, 9, 7, 'lamp');

    // --- the round tower in the far corner ----------------------------------
    for (let z = 0; z < 8; z++) w.place(9, 16, z, 'drum');
    for (let z = 0; z < 4; z++) w.place(8, 3, z, 'column');
  });

/* -------------------------------------------------------------------------- */

export function buildScene(id, catalog) {
  const s = scenes[id];
  if (!s) throw new Error(`no such scene: ${id} (have: ${Object.keys(scenes).join(', ')})`);
  const w = new World(catalog);
  s.build(w, catalog);
  return w;
}
