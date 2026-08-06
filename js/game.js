// game.js — the shell: two modes, a stack of layers, and a drawing board.
//
// THREE THINGS IN HERE ARE LOAD-BEARING AND NONE OF THEM IS THE UI.
//
// 1. THE CANVAS IS SIZED BY A ResizeObserver, NEVER BY A BOOT-TIME MEASUREMENT.
//    The previous build measured `#stage` once at module load, got 28×320 out of
//    a layout that had not settled, and drew the whole game into a strip the
//    width of a finger.  The owner opened it and saw "a small beige square on a
//    black background", which is exactly what that is.  I had seen the same
//    symptom myself, resized the pane to make it go away, and shipped it.  An
//    observer cannot be early, and it also handles the window changing later.
//
// 2. THE PLATE IS BITTEN; THE BOARD IS DRAWN.  Everything the engraver makes
//    goes into an offscreen canvas and is only remade when the building or the
//    view changes.  The grid, the cursor and the layer marks are 2-D chrome
//    drawn over it on every mouse move.  So hovering costs a dozen lines instead
//    of a re-render — the owner flagged re-render time on the first build, and
//    hover was most of it.
//
// 3. TWO ENGRAVERS, NOT ONE.  A small one for while you are moving and a full
//    one for when you stop.  Same camera, same world; the draft just has fewer
//    pixels and no hatching.

import { World } from './world.js';
import { buildCatalog, SUB } from './compose.js';
import { Camera } from './math.js';
import { Engraver } from './engrave.js';
import {
  LAYER, BUILD, EXPLORE, bandFor, buildCamera, exploreCamera,
  standingOn, pickCell, boardLines, cellOutline,
} from './build.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#plate');
const ctx = canvas.getContext('2d');
const stage = $('#stage');

const DRAFT = 0.42;
const SLOT = new URLSearchParams(location.search).get('slot') || '';
const SAVE_KEY = 'piranesi/save' + (SLOT ? ':' + SLOT : '');

const catalog = buildCatalog(24, 1);
const ids = [...catalog.keys()];

const state = {
  mode: BUILD,
  world: new World(catalog),
  layer: 0,
  yaw: 48 * Math.PI / 180,
  zoom: 1,
  centre: [LAYER / 2, LAYER / 2],
  rot: 0,
  pick: ids[0],
  hover: null,                       // [gx, gy] on the working layer
  eye: [-LAYER * 1.2, -LAYER * 1.2, standingOn(0)],
  eyeYaw: 45 * Math.PI / 180,
  shift: 0.27,
  dirty: true,
  quality: 'proof',
  settleAt: 0,
  stats: null,
};

const camera = new Camera({});
const full = new Engraver({ width: 900, height: 640, ss: 2 });
const draft = new Engraver({ width: 380, height: 270, ss: 1 });

/** The developed plate, kept so the board can be redrawn over it for free. */
const sheet = document.createElement('canvas');
const sheetCtx = sheet.getContext('2d');

/* -------------------------------------------------------------- the size -- */

let sized = false;
new ResizeObserver(() => fit()).observe(stage);
addEventListener('load', fit);

function fit() {
  const r = stage.getBoundingClientRect();
  const w = Math.max(240, Math.floor(r.width) - 24);
  const h = Math.max(180, Math.floor(r.height) - 24);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  sheet.width = w; sheet.height = h;
  full.resize(w, h);
  draft.resize(Math.max(120, Math.round(w * DRAFT)), Math.max(90, Math.round(h * DRAFT)));
  sized = true;
  invalidate(0);
}

function invalidate(settle = 240) {
  state.dirty = true;
  state.quality = settle > 0 ? 'proof' : state.quality;
  state.settleAt = performance.now() + settle;
}

/* ------------------------------------------------------------ the camera -- */

function aim(width, height) {
  if (state.mode === BUILD) {
    return buildCamera(camera, {
      centre: state.centre, layer: state.layer, yaw: state.yaw,
      zoom: state.zoom, width, height,
    });
  }
  return exploreCamera(camera, {
    eye: state.eye, yaw: state.eyeYaw, shift: height * state.shift, width, height,
  });
}

/* ----------------------------------------------------------------- drawing */

/**
 * Bite the plate, now, synchronously.
 *
 * SEPARATE FROM THE FRAME LOOP ON PURPOSE.  requestAnimationFrame does not fire
 * in a hidden tab, and the browser preview runs hidden — so a test that changes
 * the layer, waits, and reads the stats gets the STALE numbers from whenever the
 * tab was last in front, identical for every layer, and reads exactly like a
 * broken layer switch.  I lost a round to that.  Anything that has to be
 * verified must be callable, not only schedulable.
 */
function bite(quality = state.quality) {
  if (!sized) return null;
  const eng = quality === 'plate' ? full : draft;
  aim(eng.width, eng.height);
  state.stats = eng.render(state.world, camera, catalog, {
    hatching: eng === full,
    coursing: eng === full,
    lines: true,
    // In explore mode you are INSIDE the building and every layer is real
    // stone.  Banding is a property of the drawing board, not of the world.
    bandOf: state.mode === BUILD ? bandFor(state.layer) : null,
  });
  paste(eng.plate.develop({ warmth: eng.warmth, grain: eng === full ? 1 : 0.4 }));
  state.dirty = false;
  hud();
  // The camera the board draws against must be the one the plate was drawn
  // with, or the grid slides off the blocks while a proof is up.
  aim(canvas.width, canvas.height);
  present();
  return state.stats;
}

function frame() {
  const t = performance.now();
  if (state.dirty) bite();
  if (state.quality === 'proof' && t >= state.settleAt) {
    state.quality = 'plate';
    state.dirty = true;
  } else if (!state.dirty) present();
  requestAnimationFrame(frame);
}

let buf = null;
function paste(img) {
  if (img.width === sheet.width && img.height === sheet.height) {
    if (!buf || buf.width !== img.width || buf.height !== img.height) {
      buf = sheetCtx.createImageData(img.width, img.height);
    }
    buf.data.set(img.data);
    sheetCtx.putImageData(buf, 0, 0);
  } else {
    const tmp = document.createElement('canvas');
    tmp.width = img.width; tmp.height = img.height;
    const t2 = tmp.getContext('2d');
    const d = t2.createImageData(img.width, img.height);
    d.data.set(img.data);
    t2.putImageData(d, 0, 0);
    sheetCtx.imageSmoothingEnabled = true;               // a soft proof reads as
    sheetCtx.drawImage(tmp, 0, 0, sheet.width, sheet.height);  // a proof
  }
}

function present() {
  ctx.drawImage(sheet, 0, 0);
  if (state.mode === BUILD) board();
}

/**
 * The drawing board: the working layer's grid, and the cell under the pointer.
 * Deliberately thin, cool and unassertive — this is the pencil under the
 * drawing, and the moment it competes with the plate the game stops being about
 * the building.
 */
function board() {
  ctx.save();
  // MULTIPLY, so the grid is ink and not paint.  Drawn normally it rules lines
  // straight across the building and the model reads as a photograph with graph
  // paper taped over it; multiplied, it shows on bare ground, fades on the
  // hatching and disappears entirely in the darks — which is exactly where a
  // draughtsman's setting-out lines go.
  ctx.globalCompositeOperation = 'multiply';
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(96, 102, 112, 0.34)';
  ctx.beginPath();
  for (const [ax, ay, bx, by] of boardLines(camera, state.layer, 7, state.centre)) {
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  }
  ctx.stroke();

  if (state.hover) {
    const [gx, gy] = state.hover;
    const base = cellOutline(camera, gx, gy, state.layer);
    const top = cellOutline(camera, gx, gy, state.layer, LAYER);
    if (base) {
      // The cursor is the one thing allowed to sit ON TOP of the drawing.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(150, 58, 38, 0.13)';
      ctx.strokeStyle = 'rgba(150, 58, 38, 0.85)';
      ctx.lineWidth = 1.4;
      ring(base, true);
      // The footprint is where it lands; the box is how tall it will be.  A
      // footprint alone reads as a floor tile and you place blindly.
      if (top) {
        ctx.globalAlpha = 0.45;
        ring(top, false);
        ctx.beginPath();
        for (let i = 0; i < 4; i++) { ctx.moveTo(base[i][0], base[i][1]); ctx.lineTo(top[i][0], top[i][1]); }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}

function ring(p, fill) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

/* ------------------------------------------------------------------ input -- */

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (drag) {
    const dx = sx - drag.x, dy = sy - drag.y;
    drag.x = sx; drag.y = sy;
    if (state.mode === BUILD) {
      state.yaw += dx * 0.008;
      state.zoom = clamp(state.zoom * (1 - dy * 0.004), 0.25, 4);
    } else {
      state.eyeYaw += dx * 0.005;
      state.shift = clamp(state.shift - dy * 0.0012, -0.15, 0.55);
    }
    invalidate();
    return;
  }
  if (state.mode !== BUILD) return;
  const c = pickCell(camera, sx, sy, state.layer);
  const same = c && state.hover && c[0] === state.hover[0] && c[1] === state.hover[1];
  state.hover = c;
  if (!same) hud();                    // the plate is untouched — chrome only
});

canvas.addEventListener('pointerleave', () => { state.hover = null; });

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  // Middle button, or any drag in explore mode, turns the view.  The left
  // button in build mode must stay a pure "place here" or building becomes a
  // negotiation with the camera.
  if (e.button === 1 || state.mode === EXPLORE) {
    drag = { x: sx, y: sy };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (state.mode !== BUILD) return;
  const c = pickCell(camera, sx, sy, state.layer);
  if (!c) return;
  const [gx, gy] = c;
  if (e.button === 2) state.world.remove(gx * LAYER, gy * LAYER, state.layer * LAYER);
  else state.world.place(gx * LAYER, gy * LAYER, state.layer * LAYER, state.pick, state.rot);
  save();
  invalidate();
});

addEventListener('pointerup', (e) => {
  if (drag) { drag = null; try { canvas.releasePointerCapture(e.pointerId); } catch { /* gone */ } }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey || state.mode === EXPLORE) {
    state.zoom = clamp(state.zoom * (e.deltaY > 0 ? 0.9 : 1.11), 0.25, 4);
  } else {
    // THE SCROLL WHEEL CHANGES THE LAYER.  Asked for by name, and it is the
    // right default: in a layer builder the thing you change most is which
    // layer you are on, and zoom is the thing you set once.
    setLayer(state.layer + (e.deltaY > 0 ? -1 : 1));
  }
  invalidate();
}, { passive: false });

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key;
  const step = LAYER * (e.shiftKey ? 2 : 1);
  let hit = true;
  switch (k) {
    case 'PageUp': setLayer(state.layer + 1); break;
    case 'PageDown': setLayer(state.layer - 1); break;
    case 'Tab': setMode(state.mode === BUILD ? EXPLORE : BUILD); break;
    case 'r': case 'R': state.rot = (state.rot + 1) % 4; hud(); break;
    case 'q': case 'Q': if (state.mode === BUILD) state.yaw -= Math.PI / 12; else state.eye[2] += 1.5; break;
    case 'e': case 'E': if (state.mode === BUILD) state.yaw += Math.PI / 12; else state.eye[2] -= 1.5; break;
    case 'w': case 'W': case 'ArrowUp': move(0, step); break;
    case 's': case 'S': case 'ArrowDown': move(0, -step); break;
    case 'a': case 'A': case 'ArrowLeft': move(-step, 0); break;
    case 'd': case 'D': case 'ArrowRight': move(step, 0); break;
    default: hit = false;
  }
  if (k >= '1' && k <= '9') { choose(ids[(+k - 1) % ids.length]); hit = true; }
  if (hit) { e.preventDefault(); invalidate(); }
});

function move(right, fwd) {
  const { f, r } = camera.basis();
  if (state.mode === BUILD) {
    // Panning the board moves the WORKING PLANE under a fixed view, so the
    // three-quarter angle never changes while you travel.
    state.centre[0] += f[0] * fwd + r[0] * right;
    state.centre[1] += f[1] * fwd + r[1] * right;
  } else {
    const s = 0.55;
    state.eye[0] += (f[0] * fwd + r[0] * right) * s;
    state.eye[1] += (f[1] * fwd + r[1] * right) * s;
  }
}

function setLayer(L) {
  state.layer = Math.max(-4, Math.min(24, L));
  hud();
  invalidate();
}

function setMode(m) {
  state.mode = m;
  if (m === EXPLORE) {
    // Step into the space at the layer you were drawing, looking at the middle
    // of the board — so the mode switch answers "what does this look like from
    // inside?" and never dumps you in the dark somewhere else.
    state.eye = [state.centre[0] - LAYER * 1.6, state.centre[1] - LAYER * 1.6, standingOn(state.layer)];
    state.eyeYaw = Math.atan2(LAYER * 1.6, LAYER * 1.6);
    state.hover = null;
  }
  document.body.dataset.mode = m;
  $('#mode').textContent = m === BUILD ? 'build' : 'explore';
  hud();
  invalidate();
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* --------------------------------------------------------------- the shelf */

function shelf() {
  const box = $('#shelf');
  box.innerHTML = '';
  const byFamily = new Map();
  for (const d of catalog.values()) {
    if (!byFamily.has(d.family)) byFamily.set(d.family, []);
    byFamily.get(d.family).push(d);
  }
  for (const [fam, list] of byFamily) {
    const h = document.createElement('div');
    h.className = 'fam'; h.textContent = fam;
    box.append(h);
    for (const d of list) {
      const b = document.createElement('button');
      b.className = 'blk'; b.dataset.id = d.id;
      b.innerHTML = `<span>${d.id}</span><span class="sz">${d.recipe.length} parts</span>`;
      b.title = d.recipe.join(' + ');
      b.onclick = () => choose(d.id);
      box.append(b);
    }
  }
  choose(state.pick);
}

function choose(id) {
  state.pick = id;
  for (const b of document.querySelectorAll('.blk')) b.classList.toggle('on', b.dataset.id === id);
  hud();
}

function hud() {
  const s = state.stats;
  const d = catalog.get(state.pick);
  $('#layer').textContent = `layer ${state.layer}`;
  $('#rot').textContent = `turn ${state.rot * 90}°`;
  $('#recipe').textContent = d ? d.recipe.join(' + ') : '';
  $('#hud').textContent =
    `${state.world.size} block${state.world.size === 1 ? '' : 's'}` +
    (state.hover ? ` · at ${state.hover[0]},${state.hover[1]}` : '') +
    (s ? ` · ${s.visible} faces${s.ghosted ? ` (${s.ghosted} ghosted)` : ''}` +
      ` · ${s.hatchLines} strokes · ${s.ms.total.toFixed(0)} ms` : '');
}

/* ---------------------------------------------------------------- the save */

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state.world.toJSON())); } catch { /* full */ }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const w = World.fromJSON(catalog, JSON.parse(raw));
    if (!w.size) return false;
    state.world = w;
    return true;
  } catch { return false; }
}

/* ----------------------------------------------------------------- go ----- */

$('#mode').onclick = () => setMode(state.mode === BUILD ? EXPLORE : BUILD);
$('#clear').onclick = () => {
  if (!confirm('Clear the whole building?')) return;
  state.world = new World(catalog);
  save(); invalidate();
};

shelf();
if (!load()) {
  // A first block, so the board is never an empty promise.
  state.world.place(0, 0, 0, ids[0]);
}
setMode(BUILD);
setLayer(0);
fit();
requestAnimationFrame(frame);

// Handy from the console and from the browser instruments.
window.piranesi = { state, catalog, camera, full, draft, save, load, setLayer, setMode, bite, invalidate };
void SUB;
