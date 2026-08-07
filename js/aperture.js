// aperture.js — THE INTERFACE, DESCRIBED AS OPENINGS RATHER THAN AS A HASH.
//
// The owner: "i think i need to think about it in terms of intersections, where
// are the openings, how big are they, etc."
//
// He is right, and the machinery had been hiding it.  `measure.js` reads each
// wall as an 81-bit pattern and compares patterns for equality, which is all
// joinery needs — but it means every wall in the game was an opaque key, and
// nobody could say what any of them actually WAS.  Characterise them instead
// and the whole thing collapses into something you can hold in your head.
//
// THE VERTICAL IS ALREADY SOLVED, and this is the finding that makes the rest
// simple.  A block is three plans extruded, so every opening in the entire
// grammar is a rectangle whose height is 3, 6 or 9 yards and whose sill sits at
// 0, 3 or 6.  Measured across all 35,585 wall presentations: heights 3 (62%),
// 6 (23%), 9 (14%); sills 0 (51%), 6 (25%), 3 (24%).  Nothing else occurs
// except in the arches.  There is no design freedom in the vertical at all —
// an opening occupies one storey, two, or all three.
//
// SO THE ONLY REAL VARIABLE IS THE WORD: what one storey of one wall looks like
// across its nine yards.  Of the 512 possible nine-bit words, THE WHOLE GRAMMAR
// USES THIRTEEN, and three of those are vestigial — they occur only in arches
// and account for 400 presentations out of 427,000.
//
//     a wall = three storeys, each one of TEN words.
//
// That is the design language.  1,030 of the 2,197 possible word-triples occur,
// so in practice you may pick a word per storey and the block usually exists.

/** The ten words the grammar actually builds with, commonest first.
 *
 *  `bits` reads left to right across the nine yards of the face; `1` is stone.
 *  Two blocks meet flush when their facing walls are IDENTICAL word for word —
 *  not mirrored — but rotation is free at placement, so a block offering
 *  `return-l` can be turned to offer `return-r`. That is why the mirror pairs
 *  below carry exactly equal counts. */
export const WORDS = [
  { bits: '111111111', name: 'wall', gloss: 'solid, nine yards of masonry' },
  { bits: '000000000', name: 'open', gloss: 'no masonry at all' },
  { bits: '000111000', name: 'pier', gloss: 'a free-standing pier 3 yd wide, open both sides' },
  { bits: '111000111', name: 'door', gloss: 'a 3 yd opening, centred' },
  { bits: '111110000', name: 'return-l', gloss: 'masonry stops after 5 yd; 4 yd open' },
  { bits: '000011111', name: 'return-r', gloss: 'the same, handed' },
  { bits: '111111000', name: 'jamb-l', gloss: 'masonry stops after 6 yd; 3 yd open' },
  { bits: '000111111', name: 'jamb-r', gloss: 'the same, handed' },
  { bits: '001111100', name: 'island', gloss: '5 yd of masonry clear of both corners' },
  { bits: '011111110', name: 'chamfer', gloss: 'both arrises cut back one yard' },
];

/** Words that occur only in arches — the grammar's only irregular apertures. */
export const ODD_WORDS = ['100000000', '000000001', '100000001'];

const BY_BITS = new Map(WORDS.map((w) => [w.bits, w]));
export const wordOf = (bits) => BY_BITS.get(bits) || { bits, name: '?', gloss: 'irregular; only arches make these' };

/** The three storeys of one wall, bottom first. A wall is 9 across by 9 up. */
export function wordsOfWall(key, sub = 9) {
  const out = [];
  for (const band of [0, 3, 6]) {
    let s = '';
    for (let u = 0; u < sub; u++) s += key[u + sub * band];
    out.push(s);
  }
  return out;
}

/**
 * The openings in a wall, as rectangles: where they are and how big.
 *
 * Four-connectivity, because a diagonal pinch is not a way through. Returns
 * yards, measured from the left-hand arris and from the floor.
 */
export function openings(key, sub = 9) {
  const solid = [...key].map((c) => (c === '1' ? 1 : 0));
  const lab = new Int32Array(sub * sub).fill(-1);
  const out = [];
  for (let start = 0; start < solid.length; start++) {
    if (solid[start] || lab[start] >= 0) continue;
    const id = out.length;
    const stack = [start];
    lab[start] = id;
    let u0 = sub, u1 = -1, z0 = sub, z1 = -1, area = 0;
    while (stack.length) {
      const c = stack.pop();
      const u = c % sub, z = (c / sub) | 0;
      area++;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
      const nb = [u > 0 ? c - 1 : -1, u < sub - 1 ? c + 1 : -1, z > 0 ? c - sub : -1, z < sub - 1 ? c + sub : -1];
      for (const t of nb) if (t >= 0 && !solid[t] && lab[t] < 0) { lab[t] = id; stack.push(t); }
    }
    out.push({
      at: u0, sill: z0, width: u1 - u0 + 1, height: z1 - z0 + 1, area,
      // What a builder would call it. The sill is what decides: an opening on
      // the floor is something you walk through.
      kind: z0 === 0 && z1 === sub - 1 ? 'slot' : z0 === 0 ? 'door' : z1 === sub - 1 ? 'loggia' : 'window',
    });
  }
  return out;
}

/** A wall in one line: `wall / door / open`, bottom storey first. */
export const describeWall = (key) => wordsOfWall(key).map((b) => wordOf(b).name).join(' / ');

/**
 * WHICH PLANS EMIT WHICH WORD — the table to design against, because a plan's
 * word is what decides who its blocks can ever meet.
 *
 * Three plans are the sole source of their word, which makes them structurally
 * fragile: a storey built from one can only ever meet a storey built from the
 * same one.
 *
 *   rounded   the only maker of `chamfer`
 *   bar-wide  the only maker of `island`
 *   ell-deep  the only maker of `jamb-l` and `jamb-r`
 *
 * That is the mechanism behind the census's dead end: `S:rounded,rounded,
 * rounded` presents `chamfer` on all three storeys of all four walls, and
 * `rounded` is four-fold symmetric so there is exactly one such block. It can
 * only ever meet itself, and there is no second one.
 */
export function wordsByPlan(planMask, planIds, plans, sub = 9) {
  const table = new Map();
  for (const id of planIds) {
    for (let q = 0; q < plans[id].turns; q++) {
      const m = planMask(id, q);
      for (const side of ['-x', '+x', '-y', '+y']) {
        let s = '';
        for (let a = 0; a < sub; a++) {
          const i = side === '-x' ? a * sub : side === '+x' ? (sub - 1) + a * sub
            : side === '-y' ? a : a + sub * (sub - 1);
          s += m[i] ? '1' : '0';
        }
        if (!table.has(s)) table.set(s, new Set());
        table.get(s).add(id);
      }
    }
  }
  return table;
}

/* ================================================== THE OWNER'S NOTATION == */

/**
 * A BLOCK'S INTERFACE IN ONE LINE, and it turns out to be a query language.
 *
 * The owner: "the count starts at the 12 o clock position, the letter would be
 * the opening type, and the number is the floor that opening is on. so in this
 * case its a T intersection with the south and west entrances on the first
 * floor, and the east entrance on the second floor."
 *
 * The rule that makes it work is his: *for walkable space you are likely only
 * going to have one opening per level.* Two on one side at different levels is
 * legal and joined by stairs, but it is the exception. Measured against the
 * grammar: 2,371 of the 10,826 blocks have at most one opening a side, and
 * those are the ones this describes.
 *
 * Sides run clockwise from twelve o'clock — N, E, S, W — which on a plan seen
 * from above is +y, +x, -y, -x. Floors are 1, 2, 3 from the ground.
 *
 * THE LETTERS ARE PROVISIONAL. They are assigned here in a stated order so the
 * machinery works; the owner has his own catalogue of eighteen and it is his to
 * name. Only `TYPES` below needs changing.
 */
export const TYPES = [
  { bits: '111111111', letter: '-', gloss: 'solid; no way through' },
  { bits: '111000111', letter: 'B', gloss: 'a 3 yd door, centred' },
  { bits: '111111000', letter: 'C', gloss: 'a 3 yd door against the far jamb' },
  { bits: '000111111', letter: 'c', gloss: 'the same, handed' },
  { bits: '111110000', letter: 'D', gloss: 'a 4 yd opening at one end' },
  { bits: '000011111', letter: 'd', gloss: 'the same, handed' },
  { bits: '110000011', letter: 'E', gloss: 'a 5 yd opening, centred' },
  { bits: '000000000', letter: 'O', gloss: 'wholly open, the full 9 yd' },
];
const LETTER = new Map(TYPES.map((t) => [t.bits, t.letter]));

/** N, E, S, W — clockwise from twelve, on a plan seen from above. */
export const COMPASS = [['N', '+y'], ['E', '+x'], ['S', '-y'], ['W', '-x']];

/**
 * One side's entrance: which floor it is on and what type, or null for solid.
 * Returns `{ floor, letter }`, or `{ exception: n }` when a side carries more
 * than one — legal, joined by stairs, and deliberately marked as unusual.
 */
export function entranceOf(wallKey) {
  const words = wordsOfWall(wallKey);
  const found = [];
  words.forEach((w, i) => { if (w.includes('0')) found.push({ floor: i + 1, bits: w }); });
  if (!found.length) return null;
  if (found.length > 1) return { exception: found.length, floors: found.map((f) => f.floor) };
  return { floor: found[0].floor, letter: LETTER.get(found[0].bits) || '?', bits: found[0].bits };
}

/** The whole block: four sides clockwise from twelve. `B1, C2, D1, O1`. */
export function signature(profileFor) {
  return COMPASS.map(([, side]) => {
    const e = entranceOf(profileFor(side));
    if (!e) return '-';
    if (e.exception) return `*${e.floors.join('')}`;
    return `${e.letter}${e.floor}`;
  }).join(', ');
}

/** How many sides can be walked into — the junction class, in his terms. */
export function junctionOf(profileFor) {
  const open = COMPASS.filter(([, side]) => entranceOf(profileFor(side)));
  const k = open.length;
  if (k === 0) return 'sealed';
  if (k === 1) return 'dead-end';
  if (k === 3) return 'T';
  if (k === 4) return '+';
  const [a, b] = open.map(([n]) => n);
  return (a === 'N' && b === 'S') || (a === 'E' && b === 'W') ? 'I' : 'L';
}
