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

scene('carceri', 'The prison', 'A whole plate: a vaulted hall with an arcade down each side, cropped masses at the frame edges, and the timber, stairs and iron that cross the void.',
  (w) => {
    const pave = (x0, x1, y0, y1, z) => {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) w.place(x, y, z, 'paving');
    };
    const col = (x, y, z0, z1, id = 'ashlar') => { for (let z = z0; z <= z1; z++) w.place(x, y, z, id); };

    /* THE HALL is an ARCADE, not a corridor, and that is a lighting decision as
     * much as an architectural one.  Solid walls with small openings gave a
     * geometrically honest tunnel that was uniformly black; the light in a
     * Carceri comes through the structure, so the structure has to be mostly
     * hole.  Piers every three cells, two-cell arches between them, open ground
     * either side — so the sky rays get OUT and the key gets IN.
     *
     * Rhythm: pier (1 cell) + arch (2 cells) = 3.  Piers rise 3 cells (6 m) to
     * the springing; the arcade crowns at 8 m; the great vault springs at 12 m
     * and crowns at 18 m. */
    const FAR = 27;
    pave(-7, 12, -4, FAR + 4, -1);

    for (let y = -3; y <= FAR; y += 3) {
      for (const x of [0, 5]) {
        col(x, y, 0, 4, 'pier');            // the pier, through both storeys
        w.place(x, y, 5, 'cornice');
      }
    }
    for (let y = -2; y <= FAR - 1; y += 3) {
      w.place(0, y, 3, 'arch-2', 1);        // turned: the arch spans along y
      w.place(5, y, 3, 'arch-2', 1);
    }
    // The great vault over the whole hall.
    for (let y = -3; y <= FAR; y++) w.place(1, y, 6, 'vault-4');

    // OCULI.  Two cells of vault simply missing, twice down the run: the eye
    // needs somewhere for the light to be coming FROM, and a plate needs its
    // brightest passage in the middle distance and high.
    for (const y of [7, 8, 18, 19]) { w.remove(1, y, 6); }

    /* THE REPOUSSOIR.  A mass close to the eye and cropped by the frame, almost
     * solid black, which is what makes the depth behind it read.  Every plate
     * has one; without it a Carceri is just a corridor. */
    col(7, -3, 0, 11, 'pier'); col(8, -3, 0, 11, 'pier');
    col(7, -2, 0, 11, 'pier'); col(8, -2, 0, 11, 'pier');
    w.place(7, -3, 5, 'cornice'); w.place(8, -3, 5, 'cornice');
    w.place(7, -2, 3, 'ring', 3);
    // And a second mass off the other edge, so the frame is a frame and not a
    // foreground: Piranesi's repoussoir wraps the picture, it does not sit in
    // the bottom of it.
    col(-3, -3, 0, 11, 'pier'); col(-3, -2, 0, 11, 'pier');
    w.place(-3, -3, 6, 'cornice');

    /* WHAT CROSSES THE VOID. */
    // A flight climbing away from the eye, with its rail raked to match.
    for (let i = 0; i < 4; i++) {
      w.place(1, 3 + i * 2, i, 'stair');
      w.place(1, 3 + i * 2, i, 'stair-railing');
    }
    for (let y = 11; y <= 13; y++) { w.place(1, y, 4, 'landing'); w.place(1, y, 4, 'balustrade', 2); }

    // A plank bridge across the hall, and a second one higher and further off.
    // THE DECKS ARE THE POINT: the research is blunt that a single continuous
    // ground plane destroys the scale, and that four independent walkable
    // levels is the minimum for the space to stop being readable.
    for (let x = 1; x <= 4; x++) { w.place(x, 8, 3, 'catwalk'); w.place(x, 8, 3, 'railing'); }
    for (let x = 1; x <= 4; x++) w.place(x, 17, 5, 'catwalk');
    for (let x = 1; x <= 4; x++) { w.place(x, 22, 2, 'catwalk'); w.place(x, 22, 2, 'railing'); }

    // Baulks spanning the hall overhead, at three heights, deliberately not
    // aligned with anything: in the plates the timber obeys nothing.
    w.place(1, 5, 5, 'beam');
    w.place(2, 12, 4, 'beam');
    w.place(1, 20, 6, 'beam');
    w.place(2, 15, 7, 'beam');

    // Shores propping the arcade, and gantries standing in the hall.
    w.place(1, 6, 0, 'raking-shore', 2);
    w.place(1, 15, 0, 'raking-shore', 2);
    w.place(4, 10, 0, 'gantry');
    w.place(4, 10, 2, 'gantry');
    w.place(4, 24, 0, 'gantry');

    // Lamps hung under the vault: the only light the eye can find.
    w.place(3, 9, 5, 'lamp');
    w.place(2, 19, 5, 'lamp');

    // A round tower rising through the far end of the hall, and a column near.
    for (let z = 0; z < 6; z++) w.place(3, FAR - 2, z, 'drum');
    for (let z = 0; z < 3; z++) w.place(4, 2, z, 'column');

    // The galleries either side, seen THROUGH the arcade: a second, dimmer
    // architecture beyond the first, which is what gives a plate its depth
    // planes.  Six or more is the target; a corridor has two.
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -5 : 9;
      for (let y = 0; y <= FAR; y += 3) col(x0, y, 0, 3, 'brick');
      for (let y = 1; y <= FAR - 1; y += 3) w.place(x0, y, 4, 'arch-2', 1);
      for (let y = 0; y <= FAR; y++) w.place(x0, y, 6, 'ashlar');
    }
  });

scene('carceri-old', 'The prison (first attempt)', 'Kept because it is what the first plate was pulled from, and because it is a useful counter-example: a canyon, not a hall.',
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
