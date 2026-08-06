// palette.js — the tonal system, and the one place layer feedback is decided.
//
// THE OWNER'S SPEC, VERBATIM, BECAUSE IT IS THE SPEC AND NOT MY IDEA:
//
//   "i dont expect the finished work output to look like an etching.  i figure
//    the game will be fairly muted and neutral in its pallet.  mostly browns and
//    greys using warm and cool neutrals to define space.  if the full tonal
//    range went from 0-100 with 0 being pure white and 100 being black, the
//    values of the ghost layers would be from 0-30 and the dark layers would be
//    base value +30 to 40."
//
// Two things follow from that, and they are the whole file.
//
// 1. THE LAYER BANDS ARE A TONE TRANSFORM, NOT A COMPOSITE.
//
// The obvious way to ghost a layer is to draw it and then fade it — alpha, a
// second buffer, a composite.  That is the wrong end of the pipe.  Every mark on
// the plate is generated to hit a requested tone, so the cheapest and truest
// place to ghost a layer is BEFORE the hatcher: ask a ghosted face for tone×0.30
// and the hatcher draws fewer, thinner strokes all by itself.  The layer above
// is not a faded picture of a block; it is a block drawn faintly.
//
// It is also the fast answer.  A ghosted layer costs a fraction of a normal one
// because there is a fraction of the line to bite, and the owner flagged
// re-render time as a real cost on the first build.  A composite would have paid
// full price and then thrown most of it away.
//
// 2. TEMPERATURE, NOT COLOUR, DEFINES SPACE.
//
// The palette is two near-blacks — one warm brown, one cool grey — and a light
// neutral ground.  Nothing is saturated.  What separates a wall from a floor
// from a soffit is which of the two inks it leans toward, and that lean is taken
// from the LIGHT, not picked per material: a surface open to the sky takes the
// cool ink, a surface lit by bounce inside the mass takes the warm one.  That is
// both what actually happens to light in a stone interior and what a
// chromolithograph does with three stones and no ability to be garish.
//
// Everything here is in the ENGINE's convention: tone/value 0 = paper, 1 = black.
// The owner's 0–100 scale is the same numbers with the point moved.

/* ------------------------------------------------------------------ inks -- */

/** The ground.  A light neutral, barely warm — not the cream of a laid sheet.
 *  This is a printed toy block, not an impression. */
export const PAPER = [236, 231, 221];

/** The warm near-black: brown-grey, the ink of a face turned to the light and of
 *  anything lit by bounce off warm stone. */
export const INK_WARM = [60, 46, 33];
/** The cool near-black: blue-grey, the ink of a face turned away and of anything
 *  open to the sky. */
export const INK_COOL = [44, 50, 60];

/** Ink warms slightly as the film thins — kept from the etching work because it
 *  is true of any printed ink, and it is the difference between a palette that
 *  reads as printed and one that reads as filled. */
export const THIN_WARMTH = 10;

/** A whisper of overall film, so the ground is never quite the page. */
export const PLATE_TONE = 0.022;

/* ------------------------------------------------------- the stone band ---- */

/**
 * MIDDLE GREY, and the range it is allowed to move in.
 *
 * The owner asked for "a middle grey with a stone texture", and the engraved
 * renderer's own tone curve does not give you that: it was built for an etching,
 * where the point is bare paper against near-solid black and the middle is used
 * sparingly.  Handed straight to a fill, that curve puts lit faces at nearly
 * white and shaded ones at nearly black, and the model reads as painted card.
 *
 * So the stone skin remaps the whole range into a band that never reaches either
 * end.  A lit face is a light grey, a soffit is a dark grey, and NOTHING is
 * paper and nothing is black — which is what a printed stone block looks like,
 * and what leaves room for the layer bands to be the loudest signal on screen.
 */
export const STONE_LOW = 0.24;
export const STONE_HIGH = 0.74;

export const stoneRange = (t) => STONE_LOW + t * (STONE_HIGH - STONE_LOW);

/* ---------------------------------------------------------- the bands ------ */

/**
 * THE OWNER'S NUMBERS.  `band` is signed layer distance from the working layer:
 * 0 is the layer you are building on, +n is n layers above, −n is n below.
 *
 *   above  →  tone × 0.30, tapering with distance   (his 0–30)
 *   below  →  tone + 0.30 … 0.40, deepening with distance   (his "+30 to 40")
 *
 * The below-layer ramp is the one place I read past the letter of the spec: he
 * gave "+30 to 40" as a range, and spending it on DEPTH rather than picking a
 * number in the middle means the shadow itself tells you how far down you are
 * looking.  It costs nothing and it is free information.
 */
export const GHOST_SCALE = [0.30, 0.21, 0.15];   // 1, 2, 3+ layers above
export const SHADOW_LIFT = [0.30, 0.35, 0.40];   // 1, 2, 3+ layers below

/** Ghosted faces get a floor as well as a ceiling: a block drawn at tone 0.02
 *  is not drawn at all, and a layer you cannot see is not feedback. */
export const GHOST_FLOOR = 0.055;

/**
 * HEADROOM FOR THE WORKING LAYER, and this one is mine rather than the owner's.
 *
 * "Base value + 30" only means something if base value has thirty to give.
 * Measured on a real three-layer stack, the live band was already asking for 42
 * and delivering 56, so the layer below it asked for 72, clipped at 100, and
 * landed 7 points away from the layer it was supposed to be distinguishable
 * from.  The ladder existed in the arithmetic and not on the paper.
 *
 * So the working layer is drawn into the top of its range rather than all of
 * it, which costs a little contrast on the layer you are looking at and buys
 * the whole rest of the spec.  Build mode only — in explore mode you are inside
 * the building and the stone is as dark as the stone is.
 */
export const LIVE_HEAD = 0.62;

/**
 * The whole layer-feedback rule.
 * @param {number} t     the tone the face would have had, 0..1
 * @param {?number} band signed layer distance from the working layer, or NULL
 *   for "there are no layers here" — which is what explore mode passes, and the
 *   difference between a drawing board and a building.
 */
export function bandTone(t, band) {
  if (band == null) return t;
  if (!band) return t * LIVE_HEAD;
  const d = Math.min(Math.abs(band), 3) - 1;
  // The ghost band SPANS [floor, ceiling] — it is not the tone scaled and then
  // lifted, which is what it was, and which put a face at base 90 out at 31 and
  // one point outside the spec.  Caught by the test, not by looking.
  if (band > 0) return GHOST_FLOOR + t * (GHOST_SCALE[d] - GHOST_FLOOR);
  const v = t * LIVE_HEAD + SHADOW_LIFT[d];
  return v > 1 ? 1 : v;
}

/**
 * Line work follows the same law, but a line has no tone — it has a strength.
 *
 * A ghosted contour at full strength would out-shout the hatching it belongs to
 * and the layer above would read as a wireframe laid over the game.  And the
 * layers BELOW need their lines bitten deeper, not merely their tone lifted:
 * measured, the two bands' hatching separated by 27 points and the finished
 * picture by 13, because the line work under both was identical and set a floor
 * the tone difference had to climb out of.  Ink from lines is still ink.
 */
export const SHADOW_LINE = [1.25, 1.35, 1.45];

export function bandLine(band) {
  if (band == null || !band) return 1;
  const d = Math.min(Math.abs(band), 3) - 1;
  return band > 0 ? GHOST_SCALE[d] * 1.35 : SHADOW_LINE[d];
}

/* ------------------------------------------------------- temperature ------- */

/**
 * Where on the warm↔cool axis this surface sits.  −1 is fully cool, +1 fully
 * warm.
 *
 * ORIENTATION FIRST, LIGHTING SECOND, and that ordering was a correction.  The
 * first version took warmth purely from the light — wide sky cool, buried in the
 * mass warm — which is what actually happens to light in a stone interior and
 * which produced, on an open model on a table, one uniform cool grey.  Every
 * face saw the whole sky, so every face got the same answer.
 *
 * Leading with the normal fixes it and is also the older idea: a face turned
 * toward the light takes the warm ink and a face turned away takes the cool one,
 * so the two wall directions of a block are never the same neutral and the block
 * has a near side and a far side before any tone is laid at all.  Skylight then
 * cools whatever is open to it, which is what makes a courtyard read cool
 * against a warm vault.
 *
 * That is the whole of "warm and cool neutrals to define space", and it needed
 * no colour.
 */
/** The key's direction in PLAN, unit length.  Only the azimuth is used: a top
 *  face must go cool because it sees the sky, and letting the key's own upward
 *  tilt vote on that pulled every roof back to neutral. */
const KEY_PLAN = [-0.54, -0.84];

export function faceWarmth(n, sky) {
  const up = n[2];
  const w = 0.18 + (n[0] * KEY_PLAN[0] + n[1] * KEY_PLAN[1]) * 0.75 - up * 0.45 - sky * 0.30;
  return w < -1 ? -1 : w > 1 ? 1 : w;
}

/** Mix the two inks by warmth. */
export function inkAt(warmth, out = [0, 0, 0]) {
  const t = (warmth + 1) * 0.5;
  for (let i = 0; i < 3; i++) out[i] = INK_COOL[i] + (INK_WARM[i] - INK_COOL[i]) * t;
  return out;
}
