# Carceri

An architectural block-building game, drawn as a copperplate etching, after
Giovanni Battista Piranesi's *Carceri d'Invenzione* (1st state c. 1749–50,
2nd state 1761).

You place architectural blocks — piers, arches, vaults, stairs, catwalks,
gantries, chains — on a 3-D lattice. The world is not shaded and then filtered;
it is **engraved**. Every tone on the sheet is made of line.

```bash
npm run serve      # http://localhost:8749
npm test           # 16 laws
npm run shot       # pull an impression, headless, to docs/shots/
```

---

## The cube

**The cube is the unit of authorship.** A cube is 6 cells on a side — twelve
metres — and it holds a whole detailed piece of architecture: piers with their
coursing, an arcade with its imposts, a vault with its intrados, the railings and
rings and lamps. The player assembles cubes. The fine block catalogue in
`blocks.js` does not go away; it is demoted to being the *material* a cube is
made of, which is where it belongs. Nobody builds a prison one voussoir at a
time.

A cube is exactly a very large block, so the lattice, the coincidence culling,
the light marching, the picking and the saves all work unchanged — `World` was
written against "anything with a size and a mesh".

There are two ways to author one, and the second is the interesting one:

**Compose.** Stamp catalogue blocks at local cell coordinates. Good for anything
built *of* pieces — an arcade, a scaffold, a stair.

**Slice.** Generate a form far larger than one cube and keep only the part inside
this cube. A forty-eight-metre barrel vault is not four small vaults in a row; it
is one arc struck about one centre, cut by the cube grid into a 4 × 3 sheet of
tiles. **The tiles fit by construction** — two neighbours evaluate the same arc at
the same boundary, so their cut faces coincide exactly and the coincidence rule
cancels them. The seam is not hidden, it is not there.

That second path is what lets the catalogue hold objects bigger than its own
unit: a great vault as a 4 × 3 sheet, a half vault as two columns of 1 × 3.
Cut the same arc a different way and you get a different kit from one generator.

```bash
node tools/moduleshot.mjs --list
node tools/moduleshot.mjs --module great-vault      # assembled
node tools/moduleshot.mjs --module great-vault --tiles   # laid out apart
node tools/moduleshot.mjs --module bay --run 3
```

`moduleshot` reports how many faces cancelled, because that number is the
difference between one big object and several small ones pretending.

## The one idea

**In an etching, tone *is* line.** There is no grey; there is bitten line at a
spacing and a width, and everything else is paper. So the renderer is not a 3-D
scene with an ink post-process — a Sobel filter over a shaded render is the
thing this project exists *not* to be. It is a software line engraver:

1. **collect** every face of every placed block, in world coordinates
2. **cancel** faces lying back-to-back with a neighbour's *(world.js)*
3. **rasterise** a depth + face-id buffer — a stencil, never a picture
4. **bite the lines** — silhouettes, creases and borders, clipped against it
5. **lay the tone** — hatching generated in each face's own plane
6. **course** — masonry joints, so the mass reads as built and not moulded

Nothing is composited. Every mark has a start, an end, a width profile and a
hand. The buffer only ever answers *yes* or *no*.

Because it is pure software — no canvas, no WebGL, `Float32Array` throughout —
the identical code runs in the browser and in `node tools/plateshot.mjs`. The
browser adds a `putImageData` and nothing else.

## The laws

These are load-bearing. Each cost a plate to learn; several are pinned in
`test/laws.test.mjs`.

**The camera never pitches. It shifts.** *(js/math.js)* Piranesi's piers are
dead vertical on the paper while his arches race to vanishing points left and
right. That is a vertical picture plane and a rising front, not a tilt. Four
lines of algebra prove verticals stay vertical iff the camera's forward and
right vectors have no z component. A pitch slider would end the project.

**Ink is transmittance, not coverage.** *(js/ink.js)* Two layers of ink pass
`T₁·T₂`, so strokes *multiply*. That single choice gives correct cross-hatching
for free: darker everywhere, much darker at the crossings, saturating toward
black instead of clipping. Additive coverage produces dark knots at every
crossing; `max` makes cross-hatching do nothing at all.

**Pitch is constant; the stroke thickens.** *(js/engrave.js)* Measured off
high-resolution museum scans of five plates across both editions: the hatch
pitch is ~0.80 mm and essentially flat across the whole tonal range, while duty
cycle — ink width over pitch — climbs from 0.25 to 0.86. **Spacing is not the
tone knob.** The first version of this renderer varied spacing and dropped
lines, and every wall came back reading as woven mesh.

**The cross is square.** The second hatch family sits 88–96° off the first, not
the shallow 30–60° of reproductive engraving. At 90° the moiré beat is 0.71 of
the pitch — finer than the hatching, therefore invisible; at 20° it beats at 2.9
pitches, which *is* the visible mesh.

**There is a dominant plate-wide angle: 40°, descending to the right,** holding
53–66% of all oriented line energy. The hand has a stroke direction and uses it
nearly everywhere. So a face with a *form* to describe — a vault's intrados, a
drum's flank, a baulk's grain — keeps its own surface frame for its **first**
family only; every other face and every darkening family takes the hand's angle.
Cross a vault square to its own wrap and it reads as basketwork.

**An arch spans an even number of cells.** *(js/blocks.js)* A semicircular arch
of span S rises S/2, so only an even span crowns on the lattice. Odd spans put
every course above them off-grid forever. One cell is 2.0 m; a man is 0.87 of a
cell.

**An arch and a barrel vault are the same object at different depths.** One
builder, `voidedBay`, asked for depth 0.3 or depth 1.0.

**Faces cancel by coincidence, not by a solidity mask.** *(js/world.js)* Two
faces in the same place facing opposite ways are both invisible; hash the
rounded vertex ring. A voxel-style "which sides are full" declaration cannot
express a wall with an arch through it, and a colonnade would read as a row of
separate hoops rather than a tunnel. Face culling here is an *aesthetic*
feature.

**A cell holds one structure and one fitting.** A railing must be able to stand
on the stair it guards. One-block-per-cell deleted the stair and returned a
plate with handrails floating over nothing.

**Every wobble is a hash of a face's ADDRESS**, never of its index. Face ids are
an incrementing counter over the block map, so inserting one block renumbers
everything after it — and if the hand were keyed to that, laying a single paving
slab would redraw the handwriting of the entire building.

**The light travels.** Sky visibility and the key are both marched through the
lattice with an exact voxel DDA. A fixed-stride march aliases at cell corners
and produces broad pale bands radiating down the walls that read entirely
plausibly as shafts of light. They were sampling artefacts.

## Instruments

Build tools to see with; two blind art passes is the going rate for not having
them.

| | |
|---|---|
| `tools/plateshot.mjs` | Pulls an impression headless — the real catalogue, world, camera and engraver. `--scene --eye --yaw --fov --shift --crop --passes --stats` |
| `tools/tonecheck.mjs` | **The transfer curve.** Hatches a flat wall at known tones and measures the ink. Run it after *any* change to the hatcher, the stroke rasteriser or the register ladder. |
| `tools/png.mjs` | Zero-dependency PNG writer. The reason the renderer never touches a canvas. |
| `tools/snap.mjs` | Receives a PNG POSTed from the running page. |

`tonecheck` earned its place immediately: it found that the hatcher was
**non-monotonic** — asking for tone 0.50 produced a *lighter* plate than 0.44,
right in the middle of the range where every wall lives. Nothing in any picture
said so. It just looked like a decision somebody had made.

## Layout

```
index.html          the game
js/math.js          axes, the shift projection, deterministic hashes
js/ink.js           the plate: transmittance, strokes, paper, develop
js/mesh.js          geometry + the per-face (u,v) frame that makes it an engraving
js/blocks.js        the catalogue — 23 blocks, six families
js/world.js         the lattice: multi-cell footprints, two tiers, coincidence culling
js/engrave.js       the engine
js/scenes.js        buildings, shared by the game and the instruments
js/main.js          camera, input, palette, the proof/plate loop
```

## Open work

`docs/BACKLOG.md`, ranked. The largest items are cast shadows with real
occlusion, staffage (there is no absolute scale in the picture without figures),
free-placement diagonal members that ignore the lattice, and ornament.

## Sources

The craft numbers here are measured, not recalled: structure-tensor orientation
histograms and rotate-then-autocorrelate pitch measurements taken off
high-resolution scans from the Rijksmuseum, the Metropolitan Museum of Art, the
Art Institute of Chicago and LACMA. Where a number could not be verified it is
marked as an inference in `docs/BACKLOG.md`. One negative result is worth
repeating: **web-resolution scans cannot resolve hatch pitch** — three of them
produced three different confident answers that were purely their own pixel
floors.

No dependencies, and there will not be any.
