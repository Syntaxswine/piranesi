# Piranesi

A peaceful block-building game after Giovanni Battista Piranesi's *Carceri
d'Invenzione*. Muted neutral greys and browns, stone-textured masses, outlines
that outline and nothing more.

You build one vast interior, a layer at a time, out of blocks that are over the
top, imposing, and not remotely practical — a single cube may carry a tower and
a staircase and an archway that do not agree with each other. Stack enough of
them and you get the thing the Carceri are actually about: unsupported stairways
snaking through a labyrinth.

> ### ⚠ Mid-rewrite
>
> The game was redirected on 2026-08-06 from a free-flight 3-D builder to this
> layer-by-layer one. It **runs** — build mode, explore mode, the layer stack —
> but three files in `js/` are dead and the published site may still be serving
> the old game. Blocks are still plain masses wanting relief and ornament.
>
> **Start at [`docs/HANDOFF-2026-08-07.md`](docs/HANDOFF-2026-08-07.md)** — the
> current keystone: the grammar walked and measured, the hundred-block kit, the
> openings, the owner's archetype spec, and every trap keyed by what you will
> SEE when you hit it. [`HANDOFF-2026-08-06.md`](docs/HANDOFF-2026-08-06.md) is
> still the reference for what the game IS, the renderer and the cube law.

**Two modes.** *Build* is a rotatable three-quarter overhead view of the model —
you place on one flat layer, the layer above is ghosted and the one below is
shadowed. *Explore* puts you inside the space, where the camera never pitches
and the picture is a plate.

**The layer bands are a tone transform, not a composite.** A ghosted face asks
the hatcher for a third of its tone and the hatcher draws a third of the line,
so the layer above costs a fraction of a real one. Range, on a 0–100 scale where
0 is white: ghosts live in **0–30**, the layers below sit at **base +30…40**.
`js/palette.js` owns all of it, and `tools/layershot.mjs` reports what each band
asked for beside what it actually delivered.

**Warm and cool neutrals define space.** Not one ink but two near-blacks — a warm
brown and a cool grey — mixed per pixel from the orientation of the surface
underneath. A face turned to the light takes the warm one and a face turned away
takes the cool, so a block has a near side and a far side before any tone is laid
at all. There is no colour anywhere in the palette.

## Two skins

`DEFAULTS.skin` chooses between two different pictures, not two settings on one.

**`'stone'` is the game.** A printed middle grey with a **solid 3-D stone
texture** through it, and the line work doing nothing but outline — no hatching
anywhere. The texture is evaluated at the world point under each pixel, so the
mottling runs round an arris without a seam and two neighbouring blocks are two
pieces of one quarry. It is band-limited by hand, because the build camera is
near-orthographic from 420 cells back and the explore camera is inside the room,
and an octave finer than a pixel adds crawling noise rather than detail.

**`'hatch'` is a software line engraver**, kept whole and kept under test: no
fills anywhere, every value on the sheet made of bitten line, calibrated against
measured museum scans of the Carceri plates. It is not this game's look — it is
wanted for another project, and it is the more interesting renderer of the two.
`node tools/plateshot.mjs --skin hatch`. Do not let it rot.

**Blocks are composed, not drawn.** A block is a **stack of plans**: three
storeys, each a plan cut on the slice lines and extruded. You cannot hand-author
enough Piranesi cubes to keep a builder interesting; you can compose them from
twenty-four plans forever.

**The one rule that makes it assemble is the cube law.** A block is nine yards
cubed — nine sub-blocks of one yard each — every cut falls on a slice plane, and
every curve is struck at R 2.5 or R 4.5. The whole-block circle is *inscribed*,
so `R_WHOLE === SUB/2` and an arch springs and crowns exactly on the boundary
planes. Neighbours therefore agree at the seam by construction, their coincident
faces cancel, and a run of blocks reads as one continuous interior rather than a
row of boxes. *(This supersedes the socket ladder described further down.)*

```bash
npm run serve      # http://localhost:8749
npm test           # 70 laws
npm run shot       # pull an impression, headless, to docs/shots/
```

## The whole grammar, walked

```bash
node tools/census.mjs                       # docs/CENSUS.md + census.json + shelf.txt
node tools/census.mjs --verify              # the self-checks only
node tools/blockshot.mjs --recipes @docs/shelf.txt --cols 5
```

The grammar admits **525,056 recipes → 262,528 distinct solids → 66,920
distinct blocks** once you take rotation as free at placement. `tools/census.mjs`
walks all of it in under twenty seconds, measures every block, ranks them and writes
[`docs/CENSUS.md`](docs/CENSUS.md). Read that file: it is the map of what this
game can actually build.

It also measures whether the cube law works, and it does — **66,900 of 66,920
blocks have all four walls met exactly by some other block**, and there are only
1,786 distinct wall patterns across the whole catalogue, which is why anything
meets anything.

Four separate measurements in it were wrong at first, all the same way: they
agreed with everything. `flush` scored 4/4 for 99.8% of blocks, `support`
returned 100% for every block alive, the composite tied 82 blocks at a perfect
1.000 while appearing to rank them, and "you can get through this block" was
satisfied by walking over its roof. **A number that agrees with everything is
not a measurement.** The census now runs five self-checks each time — including
Burnside's lemma as an independent derivation of the orbit count — and refuses
to write if one fails.

## The openings

```bash
node tools/apertures.mjs        # docs/APERTURES.md
```

The interface is smaller than it looks. **Every opening in the grammar is a
rectangle 3, 6 or 9 yards tall with its sill at 0, 3 or 6**, because a block is
three plans extruded — there is no design freedom in the vertical at all. So the
only real variable is the WORD: one storey of one wall, nine yards across. Of
512 possible nine-bit words the whole grammar uses **fifteen**, and three of
those occur only in arches.

```
a wall  =  three storeys, each one of twelve words
```

[`docs/APERTURES.md`](docs/APERTURES.md) has the table, which plan emits which
word, and the cost of a word only one plan can make: a block showing `chamfer`
reaches 29 blocks against a baseline of 239 — **8× worse**.

## The hundred

```bash
node tools/kit.mjs                                   # docs/KIT.md + docs/kit.txt
node tools/blockshot.mjs --recipes @docs/kit.txt --cols 10
node tools/assemble.mjs --w 6 --d 6 --h 4            # build something out of them
```

[`docs/KIT.md`](docs/KIT.md) is a **hundred-block kit** chosen from the 66,920 —
and deliberately *not* the top hundred by score, because high scores cluster and
the top hundred is one idea a hundred times. It is picked from a role spec in
[`docs/kit-spec.json`](docs/kit-spec.json) so the shape of the kit is data you
can argue with, and then repaired for two properties **no per-block score can
see**:

- **It must be one thing.** Blocks are nodes, an edge is "these two can be set
  side by side flush". A first pick came back 99 of 100 blocks flush on all four
  walls — and it was *two kits*: an 87-block body and a 13-block island of
  arches. No single block in the entire grammar touched both — measured at the
  time: 403 touched the island, 1,287 the body, intersection empty — so the fix
  is a two-block chain found by breadth-first search over the grammar graph.
- **Every block must be something you can set down.** Deck joinery is far
  stricter than wall joinery — B stands on A only if B's whole floor equals A's
  whole ceiling. A hundred chosen for their walls left **17 with nothing in the
  kit to stand on**, which is what stops a building having a third storey.

Both are facts about the *other ninety-nine*, so both get their own pass.

**The terminal test is `tools/assemble.mjs`**, which is a small constraint
solver rather than a renderer trick: it fills a region with kit blocks where a
block may go in a cell only if the wall it shows each already-placed neighbour
is *identical* to the wall shown back. On a 6×6×4 it reports **210 seams of 210
exact and 608 faces cancelled** — the seams do not get hidden, they stop
existing.

```bash
node tools/layershot.mjs --layers 3 --layer 1
```

---

## Composing a block

```bash
node tools/blockshot.mjs                          # a contact sheet of 12, with recipes
node tools/blockshot.mjs --recipes @docs/shelf.txt   # the blocks the census chose
node tools/blockshot.mjs --one 3                  # one block, big
node tools/blockshot.mjs --run 5                  # five of the SAME block in a row
```

`--run` is the one that matters: blocks that look fine alone can still refuse to
meet. Five arches in a row cancel 24 faces — 6 at each junction — so the row
reads as one barrel vault with no membranes between the bays.

**A block's identity is its recipe**, a short readable string that fully rebuilds
it, and a save carries the recipes it uses in its own palette. So the generator
can be changed freely without touching anything already built. `S:ell,bar/1,frame:stone`
is a stack of three plans; `A:y+:twin:stone` is an arch along y on twin piers.
Adding a plan is free — no existing recipe mentions it. Renaming or removing one
breaks every recipe that names it, and `decode` reports those rather than quietly
substituting something.

---

## The cube system (superseded, kept for the technique)

> Below describes the previous build's hand-authored 12 m cubes and its
> slicing of forms larger than one cube. Main blocks are **composed** now, not
> authored — but the slicing technique is correct and worth reviving if a form
> ever needs to be bigger than one block again.

### The cube

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

## The one idea behind the engraver

> This section describes `skin: 'hatch'`, which is no longer the game's look.
> It is kept because the renderer is kept — see **Two skins** above.

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
| `tools/census.mjs` | **Walks the entire grammar**, measures all 10,826 blocks and ranks them. Five self-checks; refuses to write if one fails. `--verify --check --shelf N` |
| `tools/blockshot.mjs` | Contact sheets of blocks, by seed or **by name** (`--recipes @file`). `--run N` is the joinery test. |
| `tools/blockdump.mjs` | Archives the dealt hand as text, so a re-deal is something you *see* in a diff. |
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
