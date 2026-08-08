// draw.js — THE DRAWING BOARD.  One block, three storeys, drawn by hand.
//
//   "can you make a block builder so i can design specific blocks?  something
//    with 3 layers, these slices, and a ramp tool.  something where i fill in
//    the grid with a bucket tool for each of the three layers.  each layer up is
//    3 yards, so it requires at least 3 yards of floorspace for the ramp up one
//    level.  scroll wheel or page up and down the layers like the main game.
//    there should be a mini screen in the upper right showing a preview what the
//    model looks like."
//
// FOUR THINGS IN HERE ARE LOAD-BEARING.
//
// 1. THE BOARD IS HIS CROSS-SECTION, TO SCALE.  The cells are the gaps between
//    slice planes, so they are 2, ½, ½, 1½, 1½, ½, ½ and 2 yards wide and the
//    board is deliberately NOT a uniform 8×8: making them equal would be a
//    prettier grid that lies about where the stone lands.  The arcs from the
//    drawing — the corner rounds, the centred circle, the inscribed one — are
//    ruled underneath as guides, because they are WHY the odd planes are there.
//
// 2. THE PREVIEW IS SYNCHRONOUS, NEVER SCHEDULED.  requestAnimationFrame does
//    not fire in a hidden tab and the browser preview runs hidden, so anything
//    that has to be verified must be CALLABLE.  Every edit redraws the model in
//    the same turn it happened.  Measured: 25 ms for a full rebuild — mesh,
//    solidity mask, plate and all — which is cheaper than being clever.
//
// 3. THE RECIPE IS THE DOCUMENT.  There is no drawing file: what is saved, what
//    is shown in the box, what goes on the shelf and what appears in the URL is
//    one `D:` string.  Paste one in and the board becomes it.
//
// 4. THE SHELF IS THE POINT.  A block you cannot build with is a doodle, so the
//    board writes its recipes to localStorage and the game deals them alongside
//    the generated hand.  See game.js `drawnShelf`.

import {
  SLICES, N, LAYERS, RISE, DIRS, DECKS, DISCS, CORNER_CELLS, idx,
  blank, blankLayer, rectsInYards, cellsFromRects, encodeDrawn, decodeDrawn,
  cornerPolys, discPolys, ownedCells, drumCells,
} from './drawn.js';
import { SUB, R, R_WHOLE } from './cube.js';
import { blockFromRecipe } from './stack.js';
import { World } from './world.js';
import { Camera, DEG, projectWith } from './math.js';
import { Engraver } from './engrave.js';

const $ = (s) => document.querySelector(s);
const S = SUB;

const DRAFT_KEY = 'piranesi/drawing';
const SHELF_KEY = 'piranesi/drawn';

/* ------------------------------------------------------------- the state -- */

const TOOLS = [
  { id: 'bucket', name: 'bucket', key: 'B', note: 'flood a region' },
  { id: 'paint', name: 'paint', key: 'P', note: 'one cell at a time' },
  { id: 'block', name: 'block', key: 'K', note: 'drag a rectangle' },
  { id: 'ramp', name: 'ramp', key: 'M', note: 'drag the way you walk up' },
  { id: 'round', name: 'round', key: 'O', note: 'a corner: column, then cove' },
];

/** The disc on the axis. `none` first, so the row reads as off-by-default. */
const DISC_ROW = [
  { id: '', name: 'none', note: 'no circle on the axis' },
  { id: 'd', name: 'drum', note: 'a free-standing column at R, standing in the room' },
  { id: 's', name: 'shaft', note: 'the whole storey, with the R circle bored out' },
  { id: 'b', name: 'bore', note: 'the whole storey, with the whole-block circle bored out' },
];

const state = {
  drawing: blank('stone'),
  layer: 0,
  tool: 'bucket',
  hover: null,                 // [i, j] cell under the pointer
  drag: null,                  // { from:[i,j], to:[i,j], erase }
  yaw: 52 * DEG,
  undo: [],
  shelf: [],
  message: '',
  warn: false,
};

const L = () => state.drawing.layers[state.layer];

/* ------------------------------------------------------------- the board -- */

const board = $('#board');
const bctx = board.getContext('2d');
const stage = $('#stage');

/** Yards → board pixels.  One scale, one origin, and +y is UP on the paper the
 *  way it is on his graph paper — the board is a plan, not a screen. */
let PAD = 34, SCALE = 56;
const px = (x) => PAD + x * SCALE;
const py = (y) => PAD + (S - y) * SCALE;
const unpx = (sx) => (sx - PAD) / SCALE;
const unpy = (sy) => S - (sy - PAD) / SCALE;

new ResizeObserver(() => fit()).observe(stage);
addEventListener('load', fit);

function fit() {
  const r = stage.getBoundingClientRect();
  const side = Math.max(300, Math.min(Math.floor(r.width) - 24, Math.floor(r.height) - 24));
  if (board.width === side) return;
  board.width = side; board.height = side;
  board.style.width = side + 'px'; board.style.height = side + 'px';
  PAD = Math.round(side * 0.06);
  SCALE = (side - PAD * 2) / S;
  paintBoard();
}

/** THE COLOUR OF A SLICE LINE, straight off his drawing: magenta boundary,
 *  black thirds, green tangents and axis, and the corner-arc ticks in cool
 *  grey.  Keyed by the yard value, so a plane the drawing never named falls back
 *  to the tick colour rather than pretending to be one of his. */
const RULE = { 0: 'edge', [S]: 'edge', 3: 'third', 6: 'third', 2: 'green', 4.5: 'green', 7: 'green' };
const INK = {
  edge: 'rgba(150, 52, 96, 0.70)',
  third: 'rgba(56, 50, 42, 0.55)',
  green: 'rgba(70, 110, 74, 0.55)',
  tick: 'rgba(91, 101, 112, 0.45)',
};

function paintBoard() {
  const w = board.width;
  bctx.clearRect(0, 0, w, w);
  bctx.fillStyle = '#ecebe0';
  bctx.fillRect(0, 0, w, w);

  guides();
  ghost(state.layer - 1, 'below');
  ghost(state.layer + 1, 'above');
  stone();
  ramps();
  lines();
  cursor();
  ticks();
}

/** The arcs from the cross-section, ruled faintly under everything.  They are
 *  not decoration: 2, 2.5, 4.5, 6.5 and 7 are all there BECAUSE of these
 *  circles, and a board that hides them makes the odd planes look arbitrary. */
function guides() {
  bctx.save();
  // CLIPPED TO THE BLOCK.  Three quarters of every corner circle lies outside
  // it, and drawn in full they read as a spirograph rather than as the reason
  // there is a plane at 2.5.
  bctx.beginPath();
  bctx.rect(px(0), py(S), S * SCALE, S * SCALE);
  bctx.clip();
  bctx.strokeStyle = 'rgba(70, 110, 74, 0.28)';
  bctx.lineWidth = 1;
  for (const [cx, cy] of [[0, 0], [S, 0], [S, S], [0, S]]) {
    bctx.beginPath();
    bctx.arc(px(cx), py(cy), R * SCALE, 0, Math.PI * 2);
    bctx.stroke();
  }
  bctx.beginPath();
  bctx.arc(px(S / 2), py(S / 2), R * SCALE, 0, Math.PI * 2);
  bctx.stroke();
  bctx.strokeStyle = 'rgba(52, 108, 148, 0.26)';
  bctx.beginPath();
  bctx.arc(px(S / 2), py(S / 2), R_WHOLE * SCALE, 0, Math.PI * 2);
  bctx.stroke();
  bctx.restore();
}

/**
 * THE PLAN OF ONE STOREY, AS POLYGONS.
 *
 * Not "rectangles for the squares and some arcs drawn on top for the curves":
 * these are literally the polygons `drawnMesh` will extrude, asked for from the
 * same functions. A corner round on the board is the corner round that gets
 * built, tessellation and all, so the board cannot show you a shape the block
 * does not have.
 */
function planPolys(lay) {
  const paint = ownedCells(lay.corners).reduce((c, [i, j]) => { c[idx(i, j)] = 0; return c; }, lay.cells.slice());
  return [
    ...rectsInYards(paint).map(([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]),
    ...cornerPolys(lay.corners),
    ...discPolys(lay.disc),
  ];
}

function fillPolys(polys, style) {
  if (!polys.length) return;
  bctx.fillStyle = style;
  bctx.beginPath();
  for (const poly of polys) {
    poly.forEach(([x, y], i) => (i ? bctx.lineTo(px(x), py(y)) : bctx.moveTo(px(x), py(y))));
    bctx.closePath();
  }
  bctx.fill();
}

function strokePolys(polys, style, dash = [3, 3]) {
  if (!polys.length) return;
  bctx.strokeStyle = style;
  bctx.lineWidth = 1;
  bctx.setLineDash(dash);
  bctx.beginPath();
  for (const poly of polys) {
    poly.forEach(([x, y], i) => (i ? bctx.lineTo(px(x), py(y)) : bctx.moveTo(px(x), py(y))));
    bctx.closePath();
  }
  bctx.stroke();
  bctx.setLineDash([]);
}

/** The storey below as a wash, the one above as an outline.  Below is what you
 *  are standing on, so it wants weight; above is what is coming, so it wants a
 *  line and nothing else. */
function ghost(li, which) {
  if (li < 0 || li >= LAYERS) return;
  const lay = state.drawing.layers[li];
  bctx.save();
  if (which === 'below') fillPolys(planPolys(lay), 'rgba(56, 50, 42, 0.15)');
  else strokePolys(planPolys(lay), 'rgba(91, 101, 112, 0.55)');
  for (const r of lay.ramps) {
    bctx.strokeStyle = which === 'below' ? 'rgba(150, 80, 46, 0.40)' : 'rgba(91, 101, 112, 0.40)';
    bctx.setLineDash([2, 3]);
    bctx.strokeRect(px(r.x0) + 0.5, py(r.y1) + 0.5, (r.x1 - r.x0) * SCALE - 1, (r.y1 - r.y0) * SCALE - 1);
    bctx.setLineDash([]);
  }
  bctx.restore();
}

/** The working storey's masonry, drawn as the partition the mesh will get —
 *  not a grid of squares that happens to look the same. */
function stone() {
  bctx.save();
  fillPolys(planPolys(L()), 'rgba(64, 58, 48, 0.86)');
  bctx.restore();
}

function ramps() {
  bctx.save();
  for (const r of L().ramps) {
    const x = px(r.x0), y = py(r.y1), w = (r.x1 - r.x0) * SCALE, h = (r.y1 - r.y0) * SCALE;
    const along = r.dir === 'e' || r.dir === 'w' ? r.x1 - r.x0 : r.y1 - r.y0;
    // A gradient from the toe to the head: the ramp's own section, seen from
    // above.  Dark is deep, which is the same convention as a contour map.
    const [gx0, gy0, gx1, gy1] = r.dir === 'e' ? [x, y, x + w, y]
      : r.dir === 'w' ? [x + w, y, x, y]
        : r.dir === 'n' ? [x, y + h, x, y] : [x, y, x, y + h];
    const g = bctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(150, 80, 46, 0.20)');
    g.addColorStop(1, 'rgba(64, 58, 48, 0.86)');
    bctx.fillStyle = g;
    bctx.fillRect(x, y, w, h);

    // Chevrons, pointing the way up.
    bctx.strokeStyle = 'rgba(236, 235, 224, 0.55)';
    bctx.lineWidth = 1.4;
    const n = Math.max(2, Math.round(along / 1.5));
    const ang = { e: 0, n: -Math.PI / 2, w: Math.PI, s: Math.PI / 2 }[r.dir];
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const cxp = r.dir === 'e' ? x + w * t : r.dir === 'w' ? x + w * (1 - t) : x + w / 2;
      const cyp = r.dir === 'n' ? y + h * (1 - t) : r.dir === 's' ? y + h * t : y + h / 2;
      chevron(cxp, cyp, Math.min(w, h) * 0.16, ang);
    }
    bctx.fillStyle = 'rgba(236, 235, 224, 0.85)';
    bctx.font = `${Math.max(9, SCALE * 0.17)}px ui-monospace, monospace`;
    bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
    bctx.fillText(`${RISE}:${along}  ${Math.round(Math.atan2(RISE, along) / DEG)}°`, x + w / 2, y + h / 2);
  }
  bctx.restore();
}

function chevron(cx, cy, r, ang) {
  const p = (d, s) => [cx + Math.cos(ang + s) * d, cy + Math.sin(ang + s) * d];
  const a = p(r, 2.4), b = p(r, 0), c = p(r, -2.4);
  bctx.beginPath();
  bctx.moveTo(a[0], a[1]); bctx.lineTo(b[0], b[1]); bctx.lineTo(c[0], c[1]);
  bctx.stroke();
}

/** The slice lines themselves, over the stone: they are the setting-out and
 *  they have to stay legible on top of a filled cell. */
function lines() {
  bctx.save();
  bctx.globalCompositeOperation = 'multiply';
  for (const v of SLICES) {
    const kind = RULE[v] || 'tick';
    bctx.strokeStyle = INK[kind];
    bctx.lineWidth = kind === 'edge' ? 1.6 : 1;
    bctx.beginPath();
    bctx.moveTo(Math.round(px(v)) + 0.5, py(0));
    bctx.lineTo(Math.round(px(v)) + 0.5, py(S));
    bctx.moveTo(px(0), Math.round(py(v)) + 0.5);
    bctx.lineTo(px(S), Math.round(py(v)) + 0.5);
    bctx.stroke();
  }
  bctx.restore();
}

/** The yard marks down the two outer edges. */
function ticks() {
  bctx.save();
  bctx.fillStyle = 'rgba(56, 50, 42, 0.55)';
  bctx.font = `${Math.max(8, PAD * 0.30)}px ui-monospace, monospace`;
  bctx.textAlign = 'center'; bctx.textBaseline = 'top';
  for (const v of SLICES) bctx.fillText(String(v), px(v), py(0) + 4);
  bctx.textAlign = 'right'; bctx.textBaseline = 'middle';
  for (const v of SLICES) bctx.fillText(String(v), px(0) - 4, py(v));
  bctx.restore();
}

function cursor() {
  const d = state.drag;
  if (d) {
    const box = boxOf(d.from, d.to);
    if (state.tool === 'ramp') return rampGhost(d);
    if (state.tool === 'block') {
      bctx.save();
      bctx.fillStyle = d.erase ? 'rgba(150, 58, 38, 0.16)' : 'rgba(64, 58, 48, 0.34)';
      bctx.strokeStyle = 'rgba(150, 58, 38, 0.85)';
      bctx.lineWidth = 1.4;
      const [x0, y0, x1, y1] = yardBox(box);
      bctx.fillRect(px(x0), py(y1), (x1 - x0) * SCALE, (y1 - y0) * SCALE);
      bctx.strokeRect(px(x0) + 0.5, py(y1) + 0.5, (x1 - x0) * SCALE - 1, (y1 - y0) * SCALE - 1);
      bctx.restore();
      return;
    }
  }
  if (!state.hover) return;
  const [i, j] = state.hover;
  bctx.save();
  bctx.strokeStyle = 'rgba(150, 58, 38, 0.85)';
  bctx.lineWidth = 1.4;
  bctx.strokeRect(px(SLICES[i]) + 0.5, py(SLICES[j + 1]) + 0.5,
    (SLICES[i + 1] - SLICES[i]) * SCALE - 1, (SLICES[j + 1] - SLICES[j]) * SCALE - 1);
  bctx.restore();
}

/** The ramp being dragged, with its pitch — and in the refusing colour if the
 *  run is short, so "3 yards of floorspace" is something you SEE rather than
 *  something you are told after you let go. */
function rampGhost(d) {
  const r = rampFromDrag(d);
  if (!r) return;
  const ok = r.run >= RISE;
  bctx.save();
  bctx.fillStyle = ok ? 'rgba(64, 58, 48, 0.30)' : 'rgba(176, 46, 26, 0.22)';
  bctx.strokeStyle = ok ? 'rgba(150, 58, 38, 0.85)' : 'rgba(176, 46, 26, 0.95)';
  bctx.lineWidth = 1.6;
  const w = (r.x1 - r.x0) * SCALE, h = (r.y1 - r.y0) * SCALE;
  bctx.fillRect(px(r.x0), py(r.y1), w, h);
  bctx.strokeRect(px(r.x0) + 0.5, py(r.y1) + 0.5, w - 1, h - 1);
  bctx.fillStyle = ok ? 'rgba(56, 50, 42, 0.9)' : 'rgba(176, 46, 26, 1)';
  bctx.font = `${Math.max(9, SCALE * 0.18)}px ui-monospace, monospace`;
  bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
  bctx.fillText(ok ? `${RISE}:${r.run}  ${Math.round(Math.atan2(RISE, r.run) / DEG)}°` : `run ${r.run} < ${RISE}`,
    px(r.x0) + w / 2, py(r.y1) + h / 2);
  bctx.restore();
}

/* -------------------------------------------------------------- the tools */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Screen point → cell, or null off the block.  `SLICES` is not uniform, so
 *  this is a search and cannot be a division. */
function cellAt(sx, sy) {
  const x = unpx(sx), y = unpy(sy);
  if (x < 0 || y < 0 || x > S || y > S) return null;
  let i = -1, j = -1;
  for (let k = 0; k < N; k++) {
    if (x >= SLICES[k] && x < SLICES[k + 1]) i = k;
    if (y >= SLICES[k] && y < SLICES[k + 1]) j = k;
  }
  return i < 0 || j < 0 ? null : [i, j];
}

const boxOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const yardBox = ([i0, j0, i1, j1]) => [SLICES[i0], SLICES[j0], SLICES[i1 + 1], SLICES[j1 + 1]];

/** Is this cell taken by a ramp?  A ramp and fill in the same place read as
 *  VOID, so the board treats a ramp cell as occupied for everything. */
function rampAt(lay, i, j) {
  const x = (SLICES[i] + SLICES[i + 1]) / 2, y = (SLICES[j] + SLICES[j + 1]) / 2;
  return lay.ramps.find((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) || null;
}

/** Which corner of the block is this cell, if any?  The four that can carry an
 *  arc, in `plan.js` CORNERS order. */
const cornerOf = (i, j) => CORNER_CELLS.findIndex(([a, b]) => a === i && b === j);

/**
 * WHAT ALREADY OWNS THIS CELL — a ramp, a corner round, the drum, or nothing.
 *
 * One question for every tool, because in the end they all mean the same
 * refusal: two solids in one place come back VOID from the parity test, so
 * there is exactly one occupant per cell and it does not matter which kind.
 */
function occupant(lay, i, j) {
  if (lay.disc === 's' || lay.disc === 'b') return 'the bore';
  const k = cornerOf(i, j);
  if (k >= 0 && lay.corners[k] !== '.') return 'a corner round';
  if (rampAt(lay, i, j)) return 'a ramp';
  if (lay.disc === 'd' && drumCells().some(([a, b]) => a === i && b === j)) return 'the drum';
  return null;
}

function setCell(i, j, v) {
  const lay = L();
  if (v) {
    // Painting over a ramp takes the ramp out.  Refusing instead would mean
    // erasing a ramp before you could draw where it was, which is a rule you
    // fight rather than one that helps.  A round and a drum are deliberate
    // enough to be worth defending; a stroke of paint should not eat one.
    const held = occupant(lay, i, j);
    if (held === 'a ramp') {
      const r = rampAt(lay, i, j);
      lay.ramps.splice(lay.ramps.indexOf(r), 1);
      say('the ramp came out to make room');
    } else if (held) return;
  }
  lay.cells[idx(i, j)] = v;
}

/** THE BUCKET.  Flood the 4-connected region of cells in the same state as the
 *  one clicked; anything that owns a cell is a wall to it, for the same reason
 *  it is a wall to the paint. */
function bucket(i, j, v) {
  const lay = L();
  const from = lay.cells[idx(i, j)];
  if (from === v || occupant(lay, i, j)) return 0;
  const stack = [[i, j]];
  const seen = new Uint8Array(N * N);
  let n = 0;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (a < 0 || b < 0 || a >= N || b >= N || seen[idx(a, b)]) continue;
    if (lay.cells[idx(a, b)] !== from || occupant(lay, a, b)) continue;
    seen[idx(a, b)] = 1;
    lay.cells[idx(a, b)] = v;
    n++;
    stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
  }
  return n;
}

/**
 * THE ROUND.  Click a corner of the block and it cycles: nothing → COLUMN, the
 * quarter-disc struck about the block's own corner, which is the engaged shaft
 * four blocks meeting at an arris grow between them → COVE, the same cell with
 * its outer arris rounded off instead → nothing.
 *
 * Only the four corner cells, and that is geometry rather than policy: the arcs
 * are struck at R about the block's corners or the points R inside them, and
 * since R = 2 the R-by-R corner cell is the only cell either arc fits in.
 */
const NEXT_ROUND = { '.': 'o', o: 'c', c: '.' };
const ROUND_NAME = { o: 'a column at the corner', c: 'the arris rounded off', '.': 'square again' };

function setRound(k, ch) {
  const lay = L();
  const s = lay.corners.split('');
  s[k] = ch;
  lay.corners = s.join('');
  // The token owns the cell, so the paint under it goes. Otherwise the encoder
  // would drop it silently and the board would be showing a lie.
  const [i, j] = CORNER_CELLS[k];
  if (ch !== '.') lay.cells[idx(i, j)] = 0;
  say(ROUND_NAME[ch]);
}

/** A drag → the ramp it describes.  The direction is the way you dragged, so
 *  you draw a ramp by walking up it. */
function rampFromDrag(d) {
  const [i0, j0, i1, j1] = boxOf(d.from, d.to);
  const [x0, y0, x1, y1] = yardBox([i0, j0, i1, j1]);
  const di = d.to[0] - d.from[0], dj = d.to[1] - d.from[1];
  const dir = Math.abs(di) >= Math.abs(dj) ? (di < 0 ? 'w' : 'e') : (dj < 0 ? 's' : 'n');
  const run = dir === 'e' || dir === 'w' ? x1 - x0 : y1 - y0;
  return { x0, y0, x1, y1, dir, run };
}

function dropRamp(d) {
  const r = rampFromDrag(d);
  if (!r) return;
  if (r.run < RISE) {
    return say(`a ramp climbs ${RISE} yards, so it needs ${RISE} of floorspace; this has ${r.run}`, true);
  }
  const lay = L();
  // Clear whatever is under it, in both senses — the fill and any ramp it
  // crosses.  Two solids in one place come back VOID; see drawn.js §OVERLAP.
  let cleared = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (SLICES[i] + SLICES[i + 1]) / 2, y = (SLICES[j] + SLICES[j + 1]) / 2;
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && lay.cells[idx(i, j)]) {
        lay.cells[idx(i, j)] = 0; cleared++;
      }
    }
  }
  lay.ramps = lay.ramps.filter((o) => !(o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0));
  lay.ramps.push(r);
  say(`ramp ${RISE}:${r.run}, ${Math.round(Math.atan2(RISE, r.run) / DEG)}°` +
    (cleared ? ` · ${cleared} cell${cleared > 1 ? 's' : ''} cleared under it` : ''));
}

/* -------------------------------------------------------------- the input */

board.addEventListener('contextmenu', (e) => e.preventDefault());

board.addEventListener('pointermove', (e) => {
  const r = board.getBoundingClientRect();
  const c = cellAt(e.clientX - r.left, e.clientY - r.top);
  const same = c && state.hover && c[0] === state.hover[0] && c[1] === state.hover[1];
  state.hover = c;
  if (state.drag && c) {
    state.drag.to = c;
    if (!same && (state.tool === 'paint' || state.tool === 'bucket')) {
      // A drag with the paint or the bucket is a stroke: every cell it crosses.
      setCell(c[0], c[1], state.drag.erase ? 0 : 1);
      changed(false);
    }
  }
  if (!same || state.drag) paintBoard();
});

board.addEventListener('pointerleave', () => { state.hover = null; paintBoard(); });

board.addEventListener('pointerdown', (e) => {
  const r = board.getBoundingClientRect();
  const c = cellAt(e.clientX - r.left, e.clientY - r.top);
  if (!c) return;
  e.preventDefault();
  board.setPointerCapture(e.pointerId);
  push();
  state.drag = { from: c, to: c, erase: e.button === 2 };
  const erase = e.button === 2;

  if (state.tool === 'round') {
    state.drag = null;
    const k = cornerOf(c[0], c[1]);
    if (k < 0) return say('a round only fits a corner of the block — that is where the arcs are struck', true);
    setRound(k, erase ? '.' : NEXT_ROUND[L().corners[k]]);
    changed();
  } else if (state.tool === 'bucket') {
    const n = bucket(c[0], c[1], erase ? 0 : 1);
    const held = occupant(L(), c[0], c[1]);
    say(n ? `${n} cell${n > 1 ? 's' : ''} ${erase ? 'cleared' : 'filled'}`
      : held ? `${held} is there already` : 'nothing to flood there');
    changed(false);
  } else if (state.tool === 'paint') {
    setCell(c[0], c[1], erase ? 0 : 1);
    changed(false);
  } else if (state.tool === 'ramp' && erase) {
    const rr = rampAt(L(), c[0], c[1]);
    if (rr) { L().ramps.splice(L().ramps.indexOf(rr), 1); say('ramp taken back'); changed(false); }
    state.drag = null;
  }
  paintBoard();
});

addEventListener('pointerup', () => {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  if (state.tool === 'block') {
    const [i0, j0, i1, j1] = boxOf(d.from, d.to);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) setCell(i, j, d.erase ? 0 : 1);
    say(`${(i1 - i0 + 1) * (j1 - j0 + 1)} cells ${d.erase ? 'cleared' : 'filled'}`);
  } else if (state.tool === 'ramp' && !d.erase) {
    dropRamp(d);
  }
  changed();
  paintBoard();
});

board.addEventListener('wheel', (e) => {
  e.preventDefault();
  setLayer(state.layer + (e.deltaY > 0 ? -1 : 1));
}, { passive: false });

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  let hit = true;
  switch (e.key) {
    case 'PageUp': setLayer(state.layer + 1); break;
    case 'PageDown': setLayer(state.layer - 1); break;
    case 'z': case 'Z': pop(); break;
    case 'q': case 'Q': state.yaw -= Math.PI / 12; repaintModel(); break;
    case 'e': case 'E': state.yaw += Math.PI / 12; repaintModel(); break;
    default: hit = false;
  }
  if (e.key >= '1' && e.key <= String(LAYERS)) { setLayer(+e.key - 1); hit = true; }
  for (const t of TOOLS) if (e.key.toUpperCase() === t.key) { setTool(t.id); hit = true; }
  if (hit) e.preventDefault();
});

/* ---------------------------------------------------------------- the undo */

/** Snapshots, not commands.  A drawing is 3 × 64 bytes plus a handful of ramps;
 *  an undo stack of a hundred of those is smaller than one of these comments,
 *  and a snapshot cannot get out of step with what it is undoing. */
function snap() {
  return {
    mat: state.drawing.mat,
    layers: state.drawing.layers.map((l) => ({
      cells: l.cells.slice(), ramps: l.ramps.map((r) => ({ ...r })), corners: l.corners, disc: l.disc,
    })),
  };
}
function push() { state.undo.push(snap()); if (state.undo.length > 100) state.undo.shift(); }
function pop() {
  if (!state.undo.length) return say('nothing to undo');
  state.drawing = state.undo.pop();
  say('undone');
  changed();
  paintBoard();
}

/* ------------------------------------------------------------ the model -- */

const glass = $('#glass');
const preview = $('#preview');
const pctx = preview.getContext('2d');
const eng = new Engraver({ width: preview.width, height: preview.height, ss: 2 });
const cam = new Camera({});
const sheet = document.createElement('canvas');
sheet.width = preview.width; sheet.height = preview.height;
const sctx = sheet.getContext('2d');

const PITCH = 34 * DEG;

function camAt(dist) {
  cam.yaw = state.yaw;
  cam.pitch = PITCH;
  cam.shift = 0;
  cam.eye = [
    S / 2 - Math.cos(state.yaw) * dist * Math.cos(PITCH),
    S / 2 - Math.sin(state.yaw) * dist * Math.cos(PITCH),
    dist * Math.sin(PITCH),
  ];
  cam.setFraming({ width: preview.width, height: preview.height, hfovDeg: 46 });
  return cam;
}

/** Frame the block by projecting its eight corners and bisecting on distance —
 *  the same fix `blockshot` needed.  A guessed distance is right for one yaw
 *  and crops at the next. */
function fitDistance() {
  const corners = [];
  for (const x of [0, S]) for (const y of [0, S]) for (const z of [0, S]) corners.push([x, y, z]);
  const m = 0.06;
  const fits = (d) => {
    const c = camAt(d).snapshot();
    for (const [x, y, z] of corners) {
      const [qx, qy, iz] = projectWith(c, x, y, z);
      if (iz < 0) return false;
      if (qx < preview.width * m || qx > preview.width * (1 - m)) return false;
      if (qy < preview.height * m || qy > preview.height * (1 - m)) return false;
    }
    return true;
  };
  let lo = 4, hi = 400;
  if (!fits(hi)) return hi;
  for (let k = 0; k < 32; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return hi;
}

let pbuf = null;

/**
 * REDRAW THE MODEL, NOW.  Synchronous on purpose — see the header.  25 ms for
 * the whole chain: recipe, mesh, solidity mask, plate, develop.
 */
function repaintModel() {
  const rec = encodeDrawn(state.drawing);
  pctx.fillStyle = '#232220';
  pctx.fillRect(0, 0, preview.width, preview.height);

  const def = blockFromRecipe(rec);
  if (def) {
    const cat = new Map([[rec, def]]);
    const w = new World(cat);
    w.place(0, 0, 0, rec);
    camAt(fitDistance());
    eng.render(w, cam, cat, { hatching: true, coursing: true, lines: true });
    const img = eng.plate.develop({ warmth: eng.warmth });
    if (!pbuf || pbuf.width !== img.width) pbuf = sctx.createImageData(img.width, img.height);
    pbuf.data.set(img.data);
    sctx.putImageData(pbuf, 0, 0);
    pctx.drawImage(sheet, 0, 0);
  } else {
    pctx.fillStyle = '#6a655c';
    pctx.font = '11px ui-monospace, monospace';
    pctx.textAlign = 'center';
    pctx.fillText('nothing drawn yet', preview.width / 2, preview.height / 2);
  }
  activeBand();
  $('#glasslayer').textContent = `layer ${state.layer}`;
}

/**
 * THE RED BOX ON THE WORKING STOREY — his second picture, "the model moving
 * through 3 layers to show what the active layer is."  Chrome over the plate,
 * not geometry: it must be crisp, it must not cost a re-bite, and it must not
 * become part of the block.
 */
function activeBand() {
  const c = cam.snapshot();
  const z0 = DECKS[state.layer], z1 = DECKS[state.layer + 1];
  const P = [];
  for (const z of [z0, z1]) for (const [x, y] of [[0, 0], [S, 0], [S, S], [0, S]]) P.push(projectWith(c, x, y, z));
  if (P.some((p) => p[2] <= 0)) return;
  pctx.save();
  pctx.strokeStyle = 'rgba(176, 46, 26, 0.92)';
  pctx.lineWidth = 1.2;
  pctx.beginPath();
  for (const off of [0, 4]) {
    for (let i = 0; i < 4; i++) {
      const a = P[off + i], b = P[off + (i + 1) % 4];
      pctx.moveTo(a[0], a[1]); pctx.lineTo(b[0], b[1]);
    }
  }
  for (let i = 0; i < 4; i++) { pctx.moveTo(P[i][0], P[i][1]); pctx.lineTo(P[4 + i][0], P[4 + i][1]); }
  pctx.stroke();
  pctx.restore();
}

let turning = null;
preview.addEventListener('pointerdown', (e) => {
  turning = e.clientX;
  glass.classList.add('turning');
  preview.setPointerCapture(e.pointerId);
});
preview.addEventListener('pointermove', (e) => {
  if (turning == null) return;
  state.yaw += (e.clientX - turning) * 0.012;
  turning = e.clientX;
  repaintModel();
});
addEventListener('pointerup', () => { turning = null; glass.classList.remove('turning'); });

/* --------------------------------------------------------------- the panel */

function tools() {
  const box = $('#tools');
  box.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool' + (state.tool === t.id ? ' on' : '');
    b.dataset.id = t.id;
    b.title = t.note;
    b.innerHTML = `<span>${t.name}</span><span class="k">${t.key}</span>`;
    b.onclick = () => setTool(t.id);
    box.append(b);
  }
}

function setTool(id) {
  state.tool = id;
  for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.id === id);
  const t = TOOLS.find((x) => x.id === id);
  say(`${t.name} — ${t.note}`);
}

/** The disc row: the circle on the axis, which cannot be a cell because 4.5 is
 *  not a cell boundary at any radius. */
function discs() {
  const box = $('#discs');
  box.innerHTML = '';
  for (const d of DISC_ROW) {
    const b = document.createElement('button');
    b.className = 'tool' + (L().disc === d.id ? ' on' : '');
    b.dataset.disc = d.id;
    b.title = d.note;
    b.innerHTML = `<span>${d.name}</span>`;
    b.onclick = () => setDisc(d.id);
    box.append(b);
  }
}

function setDisc(id) {
  push();
  const lay = L();
  if (id === 's' || id === 'b') {
    // A bore is the whole storey — that is what boring through something means.
    const had = lay.cells.some((v) => v) || lay.ramps.length || lay.corners !== '....';
    Object.assign(lay, blankLayer(), { disc: id });
    say(`${DISCS[id]} — the whole storey${had ? ', so what was drawn here went' : ''}`);
  } else if (id === 'd') {
    let cleared = 0;
    for (const [i, j] of drumCells()) if (lay.cells[idx(i, j)]) { lay.cells[idx(i, j)] = 0; cleared++; }
    lay.ramps = lay.ramps.filter((r) => !(r.x0 < 6.5 && r.x1 > 2.5 && r.y0 < 6.5 && r.y1 > 2.5));
    lay.disc = 'd';
    say(`a drum on the axis${cleared ? ` · ${cleared} cells cleared under it` : ''}`);
  } else {
    lay.disc = '';
    say('no circle on the axis');
  }
  changed();
  paintBoard();
}

/** The three storeys as three little plans.  Top of the list is the top of the
 *  block, which is why the column is reversed in the stylesheet: a stack drawn
 *  bottom-up on screen is a stack you have to translate. */
function storeys() {
  const box = $('#storeys');
  box.innerHTML = '';
  state.drawing.layers.forEach((lay, i) => {
    const b = document.createElement('button');
    b.className = 'storey' + (i === state.layer ? ' on' : '');
    b.dataset.i = String(i);
    const cv = document.createElement('canvas');
    cv.width = 34; cv.height = 34;
    thumb(cv, lay);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `layer ${i}`;
    const c = document.createElement('span');
    c.className = 'c';
    const fill = lay.cells.reduce((a, v) => a + v, 0);
    const notes = [];
    if (lay.ramps.length) notes.push('ramp');
    if (lay.corners !== '....') notes.push('round');
    if (lay.disc) notes.push(DISCS[lay.disc]);
    c.textContent = (lay.disc === 's' || lay.disc === 'b')
      ? `${DECKS[i]}–${DECKS[i + 1]} yd · ${DISCS[lay.disc]}`
      : `${DECKS[i]}–${DECKS[i + 1]} yd · ${fill}/${N * N}${notes.length ? ' · ' + notes.join(' ') : ''}`;
    b.append(cv, n, c);
    b.onclick = () => setLayer(i);
    box.append(b);
  });
}

function thumb(cv, lay) {
  const g = cv.getContext('2d');
  const k = cv.width / S;
  g.fillStyle = '#ecebe0';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = 'rgba(64, 58, 48, 0.86)';
  g.beginPath();
  for (const poly of planPolys(lay)) {
    poly.forEach(([x, y], i) => (i ? g.lineTo(x * k, (S - y) * k) : g.moveTo(x * k, (S - y) * k)));
    g.closePath();
  }
  g.fill();
  g.fillStyle = 'rgba(150, 80, 46, 0.75)';
  for (const r of lay.ramps) g.fillRect(r.x0 * k, (S - r.y1) * k, (r.x1 - r.x0) * k, (r.y1 - r.y0) * k);
}

function setLayer(l) {
  state.layer = clamp(l, 0, LAYERS - 1);
  $('#layer').textContent = `layer ${state.layer}`;
  $('#height').textContent = `${DECKS[state.layer]} – ${DECKS[state.layer + 1]} yd`;
  for (const b of document.querySelectorAll('.storey')) b.classList.toggle('on', +b.dataset.i === state.layer);
  discs();
  paintBoard();
  repaintModel();
}

function say(msg, warn = false) {
  state.message = msg; state.warn = warn;
  const el = $('#hud');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
}

/* --------------------------------------------------------------- the shelf */

function loadShelf() {
  try { state.shelf = JSON.parse(localStorage.getItem(SHELF_KEY) || '[]'); } catch { state.shelf = []; }
  if (!Array.isArray(state.shelf)) state.shelf = [];
  shelf();
}

function saveShelf() {
  try { localStorage.setItem(SHELF_KEY, JSON.stringify(state.shelf)); } catch { say('the shelf is full', true); }
  shelf();
}

function shelf() {
  const box = $('#shelf');
  box.innerHTML = '';
  if (!state.shelf.length) {
    box.innerHTML = '<div class="none">Nothing on it yet. Draw a block and press <b>to the shelf</b>; the game deals it beside the generated hand.</div>';
    return;
  }
  state.shelf.forEach((rec, i) => {
    const row = document.createElement('div');
    row.className = 'row2';
    const b = document.createElement('button');
    b.className = 'pick';
    b.textContent = rec.slice(2, -6);
    b.title = rec;
    b.onclick = () => { push(); adopt(rec); };
    const x = document.createElement('button');
    x.className = 'drop';
    x.textContent = '×';
    x.title = 'take it off the shelf';
    x.onclick = () => { state.shelf.splice(i, 1); saveShelf(); };
    row.append(b, x);
    box.append(row);
  });
}

/* ------------------------------------------------------------ the recipe -- */

/** Every edit ends here: the recipe box, the thumbnails, the draft, the URL and
 *  the model, all from the one string. */
function changed(model = true) {
  const rec = encodeDrawn(state.drawing);
  $('#recipe').value = rec;
  storeys();
  discs();
  try { localStorage.setItem(DRAFT_KEY, rec); } catch { /* full */ }
  history.replaceState(null, '', '#' + rec);
  if (model) repaintModel();
}

/** Take a recipe and become it.  `allowEmpty`, because a blank board is a legal
 *  thing to be looking at and an illegal thing to place in a building. */
function adopt(rec, quiet = false) {
  const d = decodeDrawn(rec.trim(), { allowEmpty: true });
  if (!d.ok) { if (!quiet) say(d.why, true); return false; }
  state.drawing = {
    mat: d.mat === 'rustic' ? 'rustic' : 'stone',
    layers: d.layers.map((l) => ({
      cells: cellsFromRects(l.rects),
      ramps: l.ramps.map((r) => ({ ...r })),
      corners: l.corners,
      disc: l.disc,
    })),
  };
  $('#mat').textContent = state.drawing.mat;
  changed();
  paintBoard();
  return true;
}

$('#recipe').addEventListener('change', (e) => {
  push();
  if (adopt(e.target.value)) say('read back from the recipe');
});

$('#tostack').onclick = () => {
  const rec = encodeDrawn(state.drawing);
  const d = decodeDrawn(rec);
  if (!d.ok) return say(d.why, true);
  if (state.shelf.includes(rec)) return say('already on the shelf — a recipe IS the block');
  state.shelf.push(rec);
  saveShelf();
  say(`on the shelf · ${state.shelf.length} drawn block${state.shelf.length > 1 ? 's' : ''} waiting in the game`);
};

$('#mat').onclick = () => {
  push();
  state.drawing.mat = state.drawing.mat === 'stone' ? 'rustic' : 'stone';
  $('#mat').textContent = state.drawing.mat;
  changed();
};

$('#undo').onclick = () => pop();

$('#clearlayer').onclick = () => {
  push();
  state.drawing.layers[state.layer] = blankLayer();
  say(`layer ${state.layer} cleared`);
  changed();
  paintBoard();
};

$('#clearall').onclick = () => {
  push();
  state.drawing = blank(state.drawing.mat);
  say('board cleared');
  changed();
  paintBoard();
};

/* ------------------------------------------------------------------- go --- */

tools();
setTool(state.tool);
if (!adopt(decodeURIComponent(location.hash.slice(1)), true)) {
  if (!adopt(localStorage.getItem(DRAFT_KEY) || '', true)) {
    // A first block, so the board is never an empty promise — and it is the one
    // the whole family exists for: a solid ground floor with its arrises
    // rounded, a wall to lean on, a ramp climbing north across the first storey
    // and a landing at the head of it.  Three in a row make a stair that runs.
    adopt('D:40ei044ee4ie~cccc,004i!609in,6eii:stone', true);
  }
}
loadShelf();
setLayer(0);
fit();
say('bucket — flood a region');

// Handy from the console and from the browser instruments.
window.piranesiDraw = {
  state, adopt, repaintModel, paintBoard, setLayer, setTool,
  recipe: () => encodeDrawn(state.drawing),
  DIRS, SLICES,
};
