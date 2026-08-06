// main.js — the game.
//
// THE PLATE IS BITTEN, NOT REDRAWN.  A full engraving of a decent building is a
// few hundred milliseconds of stroke work, which is nowhere near a frame — and
// trying to make it one would mean giving up the hatching, which is the whole
// point.  So the game does what the medium does: while you are moving, you get
// a PROOF — the bare etched outline, drawn small and fast, which is a real
// state of a real plate and not a placeholder — and the moment you stop, the
// plate is bitten in full at the finished size.
//
// This is not a compromise dressed up as a concept.  Piranesi's Carceri exist in
// two states precisely because a plate gets reworked between pulls; a builder
// that shows you the line first and the tone second is behaving like the process
// it is imitating.

import { buildCatalog, METRES_PER_CELL } from './blocks.js';
import { World } from './world.js';
import { Camera, DEG, projectWith } from './math.js';
import { Engraver, unproject } from './engrave.js';
import { buildScene, scenes } from './scenes.js';

const SAVE_KEY = 'carceri.plate';

const catalog = buildCatalog();
const canvas = document.getElementById('plate');
const ctx = canvas.getContext('2d');

const state = {
  world: null,
  camera: new Camera({ eye: [2.4, -5.5, 1.7], yaw: 62 * DEG, shift: 0 }),
  block: 'pier',
  rot: 0,
  /** 'proof' = outline only, drawn at draft size.  'plate' = the full bite. */
  quality: 'proof',
  dirty: true,
  settleAt: 0,
  hover: null,
  stats: null,
};

/* ------------------------------------------------------------- engravers -- */
/* Two, deliberately.  The draft one is a quarter the linear size with no
 * supersampling; it is also the one the CURSOR reads, because it is the one
 * that is always fresh. */

let full = new Engraver({ width: 100, height: 100, ss: 2 });
let draft = new Engraver({ width: 100, height: 100, ss: 1 });
const DRAFT_SCALE = 0.42;

function fit() {
  const box = document.getElementById('stage').getBoundingClientRect();
  // The plates are 545 x 412 mm, so a portrait sheet is the native shape and a
  // widescreen one kills the vertical, which is where the vertigo lives.
  const h = Math.max(320, Math.floor(box.height));
  const w = Math.min(Math.floor(box.width), Math.floor(h * 0.78));
  canvas.width = w; canvas.height = h;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  full.resize(w, h);
  draft.resize(Math.max(80, Math.round(w * DRAFT_SCALE)), Math.max(80, Math.round(h * DRAFT_SCALE)));
  state.camera.setFraming({ width: w, height: h, hfovDeg: 76 });
  // The horizon sits at ~78% down the frame: three quarters of the picture is
  // above eye level, and that is a rising front, never a tilt.  See math.js.
  state.camera.shift = h * 0.27;
  invalidate();
}

function invalidate(settle = 260) {
  state.dirty = true;
  state.quality = 'proof';
  state.settleAt = performance.now() + settle;
}

/* ---------------------------------------------------------------- drawing -- */

function draw() {
  const now = performance.now();

  if (state.dirty) {
    const eng = state.quality === 'plate' ? full : draft;
    const cam = state.camera;
    const saveShift = cam.shift, saveW = cam.width, saveH = cam.height;
    if (eng === draft) {
      // The draft is a scaled copy of the same view: same yaw, same eye, same
      // rising front in PROPORTION.  Anything else and the cursor lands
      // somewhere other than where it points.
      cam.setFraming({ width: draft.width, height: draft.height, hfovDeg: 76 });
      cam.shift = saveShift * (draft.height / saveH);
    }
    state.stats = eng.render(state.world, cam, catalog, {
      hatching: eng === full,
      coursing: eng === full,
      lines: true,
    });
    if (eng === draft) {
      cam.setFraming({ width: saveW, height: saveH, hfovDeg: 76 });
      cam.shift = saveShift;
    }
    const img = eng.plate.develop({ grain: eng === full ? 1 : 0 });
    blit(img);
    state.dirty = false;
    hud();
  }

  // Settled: bite the plate.
  if (state.quality === 'proof' && now >= state.settleAt) {
    state.quality = 'plate';
    state.dirty = true;
  }
  if (!draw.stopped) requestAnimationFrame(draw);
}

let blitBuf = null;
function blit(img) {
  if (img.width === canvas.width && img.height === canvas.height) {
    if (!blitBuf || blitBuf.width !== img.width || blitBuf.height !== img.height) {
      blitBuf = ctx.createImageData(img.width, img.height);
    }
    blitBuf.data.set(img.data);
    ctx.putImageData(blitBuf, 0, 0);
  } else {
    // The proof, magnified.  Left smooth on purpose: a soft proof reads as a
    // proof, and a nearest-neighbour one reads as a bug.
    const tmp = document.createElement('canvas');
    tmp.width = img.width; tmp.height = img.height;
    const d = tmp.getContext('2d').createImageData(img.width, img.height);
    d.data.set(img.data);
    tmp.getContext('2d').putImageData(d, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }
  if (state.hover) drawCursor();
}

/** The cursor is drawn as a wire box over the cell that would be filled. */
function drawCursor() {
  const { cell, size } = state.hover;
  const c = state.camera.snapshot();
  const [sx, sy, sz] = size;
  const P = (x, y, z) => projectWith(c, cell[0] + x, cell[1] + y, cell[2] + z);
  const edges = [
    [[0, 0, 0], [sx, 0, 0]], [[sx, 0, 0], [sx, sy, 0]], [[sx, sy, 0], [0, sy, 0]], [[0, sy, 0], [0, 0, 0]],
    [[0, 0, sz], [sx, 0, sz]], [[sx, 0, sz], [sx, sy, sz]], [[sx, sy, sz], [0, sy, sz]], [[0, sy, sz], [0, 0, sz]],
    [[0, 0, 0], [0, 0, sz]], [[sx, 0, 0], [sx, 0, sz]], [[sx, sy, 0], [sx, sy, sz]], [[0, sy, 0], [0, sy, sz]],
  ];
  ctx.save();
  ctx.strokeStyle = 'rgba(150,40,30,0.85)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (const [a, b] of edges) {
    const p = P(...a), q = P(...b);
    if (p[2] <= 0 || q[2] <= 0) continue;
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ input -- */

/** What cell is under this canvas pixel?  Read straight out of the draft
 *  stencil: the id buffer already knows which face is there, and 1/Z inverts
 *  to the world point it was drawn from.  No ray casting anywhere. */
function pick(px, py) {
  const k = draft.width / canvas.width;
  const sx = px * k, sy = py * k;
  const cam = state.camera;
  const saveShift = cam.shift, saveW = cam.width, saveH = cam.height;
  cam.setFraming({ width: draft.width, height: draft.height, hfovDeg: 76 });
  cam.shift = saveShift * (draft.height / saveH);
  const c = cam.snapshot();
  const hit = unproject(draft.depth, c, sx, sy);
  cam.setFraming({ width: saveW, height: saveH, hfovDeg: 76 });
  cam.shift = saveShift;

  if (hit) {
    const id = draft.depth.idAt(sx, sy);
    const b = full.faceBlock[id] || draft.faceBlock[id] || null;
    return { hit, block: b };
  }
  // Nothing under the cursor: fall back to the ground plane at z = 0, so the
  // first block of an empty world has somewhere to go.
  const c2 = cam.snapshot();
  const Xs = (sx / k - c2.cx) / c2.F, Ys = -(sy / k - c2.cy) / c2.F;
  if (Ys >= -1e-4) return null;                       // above the horizon
  const Z = -c2.ez / Ys;
  if (Z <= 0 || Z > 200) return null;
  return { hit: [c2.ex + c2.rx * Xs * Z + c2.fx * Z, c2.ey + c2.ry * Xs * Z + c2.fy * Z, 0], block: null, ground: true };
}

/**
 * Place or remove.  The cell is found by stepping a hair off the hit point
 * along the FACE'S OWN NORMAL — outward to build against a surface, inward to
 * take that surface away.  The normal comes from the stencil's face index, so
 * this is exact for every block in the catalogue including the curved ones,
 * and it never needs to know a block's shape.
 */
function place(px, py, remove) {
  const k = draft.width / canvas.width;
  const sx = px * k, sy = py * k;
  const id = draft.depth.idAt(sx, sy);
  const p = pick(px, py);
  if (!p) return;

  let target;
  if (p.ground) {
    target = [Math.floor(p.hit[0]), Math.floor(p.hit[1]), 0];
    if (remove) return;
  } else {
    const n = draft.faceNormal[id] || [0, 0, 1];
    const inside = [p.hit[0] - n[0] * 0.05, p.hit[1] - n[1] * 0.05, p.hit[2] - n[2] * 0.05];
    const outside = [p.hit[0] + n[0] * 0.05, p.hit[1] + n[1] * 0.05, p.hit[2] + n[2] * 0.05];
    target = remove
      ? [Math.floor(inside[0]), Math.floor(inside[1]), Math.floor(inside[2])]
      : [Math.floor(outside[0]), Math.floor(outside[1]), Math.floor(outside[2])];
  }

  if (remove) state.world.remove(...target);
  else state.world.place(target[0], target[1], target[2], state.block, state.rot);
  save();
  invalidate(200);
}

function hoverAt(px, py) {
  const k = draft.width / canvas.width;
  const id = draft.depth.idAt(px * k, py * k);
  const p = pick(px, py);
  if (!p) { state.hover = null; return; }
  let cell;
  if (p.ground) cell = [Math.floor(p.hit[0]), Math.floor(p.hit[1]), 0];
  else {
    const n = draft.faceNormal[id] || [0, 0, 1];
    cell = [Math.floor(p.hit[0] + n[0] * 0.05), Math.floor(p.hit[1] + n[1] * 0.05), Math.floor(p.hit[2] + n[2] * 0.05)];
  }
  const def = catalog.get(state.block);
  const s = (state.rot % 2) ? [def.size[1], def.size[0], def.size[2]] : def.size;
  state.hover = { cell, size: s };
}

/* ---------------------------------------------------------------- gestures */

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect();
  drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button, px: e.clientX - r.left, py: e.clientY - r.top };
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 4) {
      // Horizontal drag turns the view.  VERTICAL DRAG SHIFTS, IT DOES NOT
      // PITCH — see math.js.  The camera in this game cannot tilt at all.
      state.camera.yaw -= dx * 0.005;
      state.camera.shift = clamp(state.camera.shift + dy * 1.6, -canvas.height * 0.2, canvas.height * 0.85);
      drag.x = e.clientX; drag.y = e.clientY;
      state.hover = null;
      invalidate();
    }
  } else {
    hoverAt(e.clientX - r.left, e.clientY - r.top);
    state.dirty = state.dirty || true;
  }
});
canvas.addEventListener('pointerup', (e) => {
  const r = canvas.getBoundingClientRect();
  if (drag && drag.moved <= 4) place(e.clientX - r.left, e.clientY - r.top, drag.button === 2);
  drag = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const c = state.camera.basis();
  const k = -Math.sign(e.deltaY) * 0.9;
  state.camera.eye[0] += c.f[0] * k;
  state.camera.eye[1] += c.f[1] * k;
  invalidate();
}, { passive: false });

addEventListener('keydown', (e) => {
  const c = state.camera.basis();
  const step = e.shiftKey ? 2.4 : 0.8;
  const move = (v, k) => { state.camera.eye[0] += v[0] * k; state.camera.eye[1] += v[1] * k; };
  switch (e.key.toLowerCase()) {
    case 'w': move(c.f, step); break;
    case 's': move(c.f, -step); break;
    case 'a': move(c.r, -step); break;
    case 'd': move(c.r, step); break;
    case 'e': state.camera.eye[2] += step; break;
    case 'q': state.camera.eye[2] -= step; break;
    case 'r': state.rot = (state.rot + 1) % 4; renderPalette(); break;
    default: return;
  }
  e.preventDefault();
  invalidate();
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------- chrome */

function renderPalette() {
  const host = document.getElementById('palette');
  host.innerHTML = '';
  const families = [...new Set([...catalog.values()].map((d) => d.family))];
  for (const fam of families) {
    const h = document.createElement('div');
    h.className = 'fam';
    h.textContent = fam;
    host.appendChild(h);
    for (const def of [...catalog.values()].filter((d) => d.family === fam)) {
      const b = document.createElement('button');
      b.className = 'blk' + (def.id === state.block ? ' on' : '');
      b.title = def.note;
      b.innerHTML = `<span class="nm">${def.name}</span><span class="sz">${def.size.join('×')}</span>`;
      b.onclick = () => { state.block = def.id; renderPalette(); };
      host.appendChild(b);
    }
  }
  document.getElementById('rot').textContent = `turn ${state.rot * 90}°`;
}

function hud() {
  const s = state.stats;
  const b = state.world.blocks.size;
  document.getElementById('hud').textContent =
    `${b} blocks · ${state.world.cellCount} cells · ` +
    `${(state.world.cellCount * METRES_PER_CELL ** 3).toFixed(0)} m³ · ` +
    (s ? `${s.visible}/${s.faces} faces · ${s.hatchLines} strokes · ${s.ms.total.toFixed(0)} ms · ink ${(s.ink * 100).toFixed(0)}%` : '');
}

/* -------------------------------------------------------------------- saves */

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state.world.toJSON())); } catch { /* private mode */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return World.fromJSON(catalog, JSON.parse(raw));
  } catch { /* corrupt save: start fresh rather than refuse to boot */ }
  return null;
}

document.getElementById('new').onclick = () => {
  state.world = new World(catalog);
  for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) state.world.place(x, y, -1, 'paving');
  save(); invalidate(0);
};
for (const id of Object.keys(scenes)) {
  const o = document.createElement('option');
  o.value = id; o.textContent = scenes[id].title;
  document.getElementById('scene').appendChild(o);
}
document.getElementById('scene').onchange = (e) => {
  if (!e.target.value) return;
  state.world = buildScene(e.target.value, catalog);
  save(); invalidate(0);
  e.target.value = '';
};

/* --------------------------------------------------------------------- boot */

state.world = load() || buildScene('carceri', catalog);
renderPalette();
addEventListener('resize', fit);
// A tab that boots hidden never gets a rAF, and the game would sit on a blank
// sheet until the user happened to focus it.  Paint once synchronously, then
// join the frame loop; also re-kick when the tab comes back, because the loop
// stops dead while hidden and the plate would be a frame stale on return.
fit();
draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(0); });

/** Debug handle.  The renderer is pure software, so everything it did is
 *  inspectable from the console — and an automated check can drive the whole
 *  game without a single synthetic mouse event. */
window.carceri = { state, catalog, full, draft, invalidate, draw, place, pick, save };
