# Backlog

> **Reconciled 2026-08-06 against the redirect.** Read
> `HANDOFF-2026-08-06.md` first — the game changed shape and some items below
> changed meaning with it.
>
> **Updated again 2026-08-06, after the layer view landed.**
>
> ~~0a. The layer view~~ — **DONE.** The owner answered the open question and it
> is a *value range*, not a drawing mode: ghosts 0–30, layers below base +30…40.
> Built as a tone transform ahead of the hatcher (`js/palette.js`), not a
> composite. Handoff §8 and §10.
> ~~0b. `ResizeObserver`~~ — **DONE.** `js/game.js`, at the top, with the story
> beside it.
> ~~0c. Mode switch~~ — **DONE.** `js/build.js` holds both cameras.
> 0d. **Delete the dead files.** `main.js` is gone. `blocks.js`, `modules.js`
> and `scenes.js` are still load-bearing for `plateshot`, `moduleshot` and two
> tests; they go when those instruments are ported to composed blocks.
>
> ### ⛔ HOLD — new cube rules are coming from the owner
>
> 2026-08-06, verbatim: *"i like the aesthetics you have done, but i have some
> other rules for cubes that should be better for modular building. let me
> update a graph. i will post it in just a moment."*
>
> **Do not design block joinery, the socket ladder, or the boundary-face
> question until that diagram arrives.** 0e below is the right problem and its
> analysis is sound, but the owner has a specification for the answer and
> anything built first will be built twice. The rest of the list — the drawing,
> staffage, ornament — is unaffected and safe to work on.
>
> ### ✅ Updated 2026-08-07 — THE WALL FAMILY, and the owner's 41 archetypes
>
> He coded the block set himself: four sides clockwise from twelve, each in
> three segments, X solid and O open. **14 archetypes, 41 counting rotations.**
> Measured against the grammar: only **6 of 13** existed.
>
> **The gap was the simplest piece in architecture.** The vocabulary had plans
> with 0, 2, 3 and 4 complete walls and NOTHING with exactly one — `twin` is
> literally two walls side by side and nobody ever wrote the single. Every
> configuration starting from one wall was unreachable in consequence.
>
> Six plans added — `wall`, `wall-ell`, `wall-tee`, `wall-curve`,
> `corners-two`, `stub` — taking it to **12 of 14**. Free by the grammar's own
> contract: no existing recipe names them, so nothing already built changed.
>
> **Every piece of a plan must be DISJOINT.** Two overlapping rectangles are
> crossed twice by the solidity ray, so parity reads the overlap as VOID: an L
> built from two full-length walls came back with a hole where they meet. That
> is why `bored` is cut into four and `frame` into four — the mesh has no notion
> of a union.
>
> Effects: 10,826 → **45,276 blocks**; word-triples 1,030 → **1,764 of 2,197**;
> two new edge words, both the owner's G/H (the 3 yd handed bar), each with
> THREE makers so no new isolation; the 100-kit went from 92 to **96 of 100
> fully flush**, still one component.
>
> **0j (NEW). Archetypes 24 and 28 are not cuttable.** Both need a corner
> segment to read X while the adjacent side reads O — masonry filling 2 of the 3
> cells nearest a corner but stopping before the block edge. That wants a plane
> at **8** (and symmetrically **1**), and the ladder has neither.
>
> ### ✅ Updated 2026-08-07 (later still) — THE OPENINGS ARE INVENTORIED
>
> `docs/APERTURES.md`. The owner's reframe — *"think about it in terms of
> intersections, where are the openings, how big are they"* — and it makes the
> system small.
>
> **The vertical has no design freedom.** Every opening in the grammar is 3, 6
> or 9 yards tall with its sill at 0, 3 or 6, because a block is three plans
> extruded. Only the arches break it.
>
> **So a wall is three storeys, each one of TEN WORDS** — out of 512 possible
> nine-bit words the whole grammar uses thirteen, and three of those occur only
> in arches. 1,030 of 2,197 triples exist. That is the whole interface language.
>
> **0i (NEW). Three plans are the sole source of their word**, and it is
> expensive: a block showing `chamfer` reaches 29 blocks against a baseline of
> 239 — **8.1× worse**. `rounded`→`chamfer`, `bar-wide`→`island`,
> `ell-deep`→`jamb`. A second plan emitting `chamfer` multiplies the reach of
> 992 blocks by eight, and it need not resemble `rounded` — it only has to leave
> stone in the same nine yards.
>
> **0f and 0i are the same problem in the same language: a word with too few
> makers.** An arch cap is a word only arches make. The fix in both cases is a
> new PLAN emitting an existing word from a different shape — not a new block,
> and not a kit slot.
>
> ### ✅ Updated 2026-08-07 (later) — a HUNDRED-BLOCK KIT is chosen
>
> `docs/KIT.md` + `docs/kit.txt`, from the role spec in `docs/kit-spec.json`
> (data, so argue with it and re-run). Not the top 100 by score — that would be
> one idea a hundred times. One joinery component · 0 vertical orphans · 0
> sealed chambers · 5 barrel vaults · 15 of 16 plans · 199 anchor sites.
>
> **`tools/assemble.mjs` is the terminal test** and it passes: a 6×6×4 fill with
> **210 seams of 210 exact and 608 faces cancelled**. Handoff §14.
>
> Two properties no per-block score can see, each now its own repair pass:
> **the kit must be one component** (a first pick was 99/100 flush and was
> secretly *two kits*), and **every block must have something it can stand on**
> (17 of 100 had nothing — which is what stopped a third storey).
>
> **0f is now doubly confirmed and is the top of the list.** No selection of 100
> can make a vault die into masonry, because no block presents a spandrel on one
> face and a wall on the other. It is a new PLAN — a springer — not a kit slot.
>
> ### ✅ Updated 2026-08-07 — the grammar has now been WALKED
>
> `docs/CENSUS.md` enumerates every block the grammar admits, measures all of
> them and ranks them: **79,016 recipes → 39,508 distinct solids → 10,826
> distinct blocks** once rotation is taken as free at placement. Three quarters
> of any "every combination" catalogue is the same block relabelled.
>
> **0e below is CLOSED, and the census is how we know.** 10,806 of 10,826 blocks
> have all four walls met exactly by some other block. It works so completely
> that "does it join" can no longer tell two blocks apart — see `js/measure.js`,
> where a first scoring attempt tied 82 blocks at a perfect 1.000 and was really
> sorting alphabetically.
>
> **Three new items came out of the walk, and they are ranked at 0f–0h below.**
> Everything the census found is in `docs/CENSUS.md`; `docs/shelf.txt` is the
> eighteen blocks it recommends, and `blockshot --recipes @docs/shelf.txt`
> draws them.
>
> **0f. A vault runs, but it cannot land.** THE most actionable finding. An
> arch's cap is met by 4 blocks out of 10,826 and every one is another arch — so
> a row of them cancels 6 faces per junction and reads as one continuous barrel
> (verified: 5 in a row cancel 24), but **there is no ending**. Nothing in the
> grammar presents a spandrel on one face and a wall on the other, so a vault
> can run forever or stop in mid-air. `halfVault` was written to be "the piece
> that lets a vault die into a wall" but its hand picks which *spandrel*
> survives — it solves the problem along the wrong axis. **What is missing is a
> springer.** Related and from the same gap: 20 of the 24 half-arches have
> nothing that can stand on them.
>
> **0g. `rounded` can only ever meet itself.** The single dead end in the whole
> grammar is `S:rounded,rounded,rounded` — its wall is a curved band only
> `rounded` produces, and since `rounded` is four-fold symmetric there is
> exactly one such block. A fully rounded pier is a thing you want and at
> present it can only stand alone. Wants a companion plan: rounded band on one
> side, slice-plane wall on the other.
>
> **0h. 88 blocks contain a sealed chamber** — a void with no way out,
> unreachable and unlightable. Always the same shape: a `drum` plugs the bore of
> a `shaft` from below and anything solid closes it from above. Cheap to detect
> (`measure().chambers`); the question is whether to refuse them, or to keep
> them as the game's only genuinely secret space.
>
> **0e (below) — ~~top of the list~~ CLOSED by the cube law, 2026-08-06.**
> Kept for the record because the analysis is what the cube law answered:
>
> **Composed blocks never cancel a face against each other.** `cancelled` is 0
> for any run of composed blocks, where a sliced module reports 428. The tagging
> is fine — 5107 of 16648 catalogue faces carry a `side` — but two neighbours
> only cancel where their boundary faces occupy the *same place*, and
> procedurally different masses never do. So a row of blocks is a row of
> separate boxes rather than one continuous interior, and coincidence culling —
> the thing that turns a colonnade into a tunnel — never fires at all. **This is
> the biggest single obstacle to "one vast interior", and it is a block-design
> problem, not a renderer one.** The socket ladder says where things may *cross*
> a boundary; nothing yet makes the boundary a shared surface. Options worth
> weighing: a mandatory full-face wall option per side; snapping mass extents to
> a coarse boundary grid; or a declared "edge profile" per side, chosen from a
> small set, that neighbours match.
>
> **The engraver is a keeper, not a leftover.** `skin: 'hatch'` is no longer the
> game's look, but the owner wants it for another project — "a fun *Take On Me*
> aesthetic", which is exactly right for it. It stays whole, stays under test
> and stays in CI. Anything that breaks it fails `the stone skin draws no
> hatching at all, and the engraver still can`. Everything below about hatching,
> the two states, reserved white and the register ladder belongs to THAT
> project now, not to this one.
>
> Then the rest of 0e as before: the masses are plain boxes wanting relief, wear
> and ornament, and six archetypes want to be ten. Also — the build view has no
> enclosure, so every face sees the whole sky and the tonal range starts low. An
> interior wants a shell.
>
> **Changed meaning:** items about hand-authored cubes and the sliced-vault tile
> system (`modules.js`) are superseded — main blocks are *composed* now, not
> authored. The slicing technique is still correct and worth reviving if a form
> ever needs to be bigger than one block again; the code is in git history at
> `5922993`.
>
> **Unchanged and still ranked below:** everything about the *drawing* — cast
> shadows, staffage, the halo, the two states, ornament, irregularity, the
> renderer refinements. Those were about the medium, and the medium did not
> change.
>
> ### ✅ Updated 2026-08-07 (later still) — THE DRAWING BOARD, and `D:`
>
> `draw.html` / `js/drawn.js` / `js/draw.js`. Three storeys painted cell by cell
> on the slice grid, a bucket, a rectangle, and **the ramp** — one storey of
> rise over at least one storey of run, which the grammar checks. A third recipe
> family, `D:`, in half-yards base 36; a partition into disjoint maximal
> rectangles, so the overlap-reads-as-void trap is unreachable from the board.
> Blocks go to a shelf in `localStorage` and the game deals them.
>
> `extrudePlan` moved to `plan.js` and `DECKS` to `cube.js` so the two composers
> raise stone by the same act. Every archive tool byte-identical afterwards.
>
> **0k (NEW). The board cannot draw a curve.** Seven plans of twenty-four are
> unreachable on it — `rounded`, `drum`, `quarters`, `shaft`, `bore`, and
> (less obviously, so it is worth knowing) `wall-tee` and `wall-curve`, whose
> far corners are quarter-columns struck at R. The legal centres are enumerable
> — the four block corners, the four arc centres and the axis — so a *round this
> corner at R* modifier on a painted cell is a small, bounded addition. It is
> the largest gap in the board.
>
> **0l (NEW). The board cannot draw an arch.** `A:` springs at 4.5 and crowns on
> the boundary, which is a vertical freedom the three-storey extrusion does not
> have. A drawn block and a vault are still separate acts; the springer (0f)
> would be the piece that lets them meet.
>
> **0m (NEW). A ramp has nothing to say about what holds it up.** The toe is a
> knife edge and the layer below is the designer's business. That is right for a
> drawing board and wrong for a building — a *soffit* option (fill the wedge
> down to the deck) is one flag on the recipe and one more face on the wedge.
>
> **0n (NEW). Retire `tools/snap.mjs`** if nothing has called it by the next
> pass. `serve.mjs --shots` does the same job from the server the page is
> already on: no second process, no CORS, `fetch('/__shot', …)`. Grep the tree
> before you build — this one was found *after* the duplicate was written.

Ranked by how much Carceri each buys. Sources are five research briefs
(etching craft, a census of the sixteen plates, the spatial scholarship, the NPR
line-rendering literature, and precedents) plus an adversarial critic whose job
was to explain exactly how this project ends up looking like Minecraft with an
ink filter. Its verdict is worth keeping in view:

> the real risk is not Minecraft-with-a-filter. It is something more seductive:
> a beautiful, competent architectural line drawing that is not a Carceri.

## 1 — Cast shadows with real occlusion

The key light now marches the lattice, so a surface knows whether it is lit.
What does **not** yet happen: a pier throwing a shadow *shape* across the wall
behind it. Piranesi's blacks are hard-edged shadow shapes on lit walls, not
corner darkening. Currently the key is sampled at three points per face and
blended, which gives soft gradients and no cast form.

Needs: more sample points per face, or a proper per-hatch-line key ray. The
hatcher already asks for local tone per stroke, so the hook exists.

## 2 — Staffage

`MAN` is declared in blocks.js and referenced nowhere. **Without a figure there
is no absolute scale, so a 6 m hall and a 60 m hall are pixel-identical** — and
vastness is the entire subject. Rules from the census and the space brief:

- Two size classes with **nothing between**: ~5–6% of frame height near, ~1.7%
  at the far legible plane. Cull below 1.5%.
- Distribute across four or more decks so head heights spread across 40–85% of
  the frame. Never let them share one head-height line.
- **Figures must ignore each other absolutely.** No conversation, no mutual
  acknowledgement, no reaction to anything — including to a figure being
  tortured. Yourcenar identifies this indifference as the true horror. Hard
  rule, not polish.
- No legible task. "Never clear what exactly the figures are doing" is a spec.
- Only on horizontal circulation surfaces, biased toward balustrades.

## 3 — Free-placement members that ignore the lattice

Baulks, ropes, chains, ladders, raking shores, winch cables — 12–30 m long, at
arbitrary angles, crossing 70–85% of the plate at 30–65°. Eisenstein lists the
ropes as compositional elements alongside the masonry. `mesh.js strut()` already
builds an off-axis member correctly; what is missing is a placement mode that is
not cell-anchored.

Chain wants a **catenary primitive**, not segments — chains swag.

## 4 — The composition pass

Nothing currently knows what a good plate looks like. Ship it as a debug overlay
that reports, for the current camera:

- horizon position as a % of frame height (target ~78%)
- count of distinguishable depth planes (**target 8, minimum 6**; a corridor has 2)
- whether any single structure is fully contained in frame (it must not be —
  architecture runs off all four edges)
- edge-vignette coverage: darken the outer ~20% on **all four** sides, lit core
  in the central 60%. Piranesi's repoussoir is a frame, not a foreground.
- brightest region should be at 20–50% of frame height, offset from centre —
  middle distance and high, never at the horizon
- count of long diagonals over 70% of frame extent
- yaw distance from the nearest lattice axis (**enforce 25–65° off**; add a soft
  repulsion from the 0/90/180/270 snap points so the one-point corridor is
  something a player has to fight for)

## 5 — The halo / Mach band

An unhatched strip on the **near** side of every silhouette where it overlaps a
farther surface, and densified cross-hatch on the far side (the undercut).
Hertzmann & Zorin. The literature calls this the cheapest single change that
makes a line render read as depth. Needs a distance-to-occlusion-boundary field
over the stencil — two chamfer passes.

## 6 — The two states

Implement as a **global tone remap plus one extra layer**, not a second
renderer. Measured targets:

| | 1st state (1750) | 2nd state (1761) |
|---|---|---|
| mean reflectance | 0.46 | 0.28 |
| median | 0.43 | **0.11** |
| ink coverage | 55% | 77% |
| solid black | 0% | 20% |
| bare paper | 1% | ~0% |

The median is the tell: a second state is more than half black. Going 1st → 2nd
means pushing median 0.43 → 0.11, unlocking a **solid / open-bite register**
(there must be a fill path, not just a fifth crossing layer), enabling the
near-vertical third family, and eliminating bare paper except at the light.
Ship 2nd state as the default — it is the one that achieved European influence.

Historically the 1750 edition is bare architecture and 1761 adds the penal
ironmongery, so the ornament tier and the state switch are the same toggle.

## 7 — Reserved white as an explicit override

The etcher stops out a spot with resistant ground and it prints white
regardless of what is etched underneath. A lit face is not "no hatching" — it is
a *decision*. Budget it at 1–2% of the image and **place** it.

## 8 — Ornament and irregularity

Six kinds from the census: continuous relief frieze, framed relief panel,
portrait tondo, mask corbel, bust in niche, free-standing colossal statue. Plus
inscriptions in Roman capitals, 3–4 short lines, **20–40% of characters broken
or illegible** (Piranesi's own second-state inscriptions are).

Irregularity, all currently missing and all named by the critic:

- masonry courses are a perfectly regular half-lap on every block in the world —
  break courses by half a block, jitter ~1 in 8 to 1.5× or 0.5× its neighbours
- add a **cyclopean** grade (4×2×2 m) restricted to foundations, the lowest two
  courses of piers, and anything within two cells of the camera. Piranesi always
  puts the biggest stones lowest and nearest
- `MATERIALS.rough` exists and is read by nothing
- wear as per-block state: chipped arrises, dropped blocks, spalled corners,
  vegetation in joints, worn treads
- **perfect arithmetic rhythm in depth** — scenes build 20 identical bays at
  identical spacing. Piranesi never repeats a bay at a constant interval

## 9 — Voussoirs

Arch rings should be **explicit wedges**, not smooth curves: 11–15 on a cell
arch, 25–35 on a great arch, each one block deep and ~0.15 m proud of the wall
face.

## 10 — Catalogue gaps from the *plate* census

*(The survey of the sixteen Carceri plates — not `docs/CENSUS.md`, which walks
the block grammar. Two different censuses; the name arrived here first.)*


- round guard-turret: 2×2 cylinder, 2–3 cells, overhanging cornice cap, exactly
  one small grated window. Three in a row on a bridge deck *is* plate XI
- four grating variants (7×9, 4×4, 2×3, oval) plus a hoisted grating on a
  rope-and-sheave — that is the plate II portcullis
- chain-swag balustrade: stone bollards at 2 m centres, chain sagging ~0.4 m
- masonry corbels cantilevering up to 1.5 cells unsupported. If a structural
  rule ever forbids this, the set's most characteristic silhouettes become
  unbuildable
- curved ramp-gallery wrapping a drum **instead of a spiral stair** — there is
  no true spiral in the sixteen plates
- the pointed "gothic" arch, gated as rare: it occurs in one plate of sixteen
- smoke and drapery as the only reserved-white soft-mass elements, with a
  dedicated non-hatch path

## 11 — Renderer refinements

- **Test edge visibility against the face-id buffer, not depth.** Identity
  comparison needs no epsilon, which deletes the whole bias-tuning problem. The
  id buffer is already rasterised.
- Perturb every vertex by a tiny deterministic offset at mesh-build time. An
  axis-aligned lattice violates the generic-position assumption constantly, and
  a single bad visibility test causes a topological catastrophe, not a small
  error.
- Cull concave contour edges before any visibility work — always invisible, and
  a large fraction of a block lattice's interior edges.
- Draw a boundary outline **only** when the tones either side are too close to
  read apart, and omit outlines that face the light. Take the stroke style from
  the nearer face. Subtractive outlining is much of why Winkenbach & Salesin's
  output reads as a drawing rather than a wireframe.
- Paper as 3–5 octaves of turbulence that scale with the camera dolly, or the
  paper alone produces the shower-door effect even with perfectly anchored
  strokes.
- Exact hatch spacing by homography rather than a measured step; exact line
  placement by inverting a 3-sample Möbius fit. Both are closed-form.

## 12 — Structural honesty

Eisenstein is explicit that each link in a Carceri is "in itself quite
naturalistic" and that the concrete reality of perspective is never destroyed.
**Do not implement Escher geometry.** Endlessness comes from *accumulation*
rules — arches ejecting further arches, staircases branching into new flights,
vaults leaping to the next — with a depth limit around 8.

The one exception with a museum source behind it (NGV, plate XIII): a beam or
walkway that visually connects two structures on different depth planes, valid
only from the authored camera. Cap at 1–2 per scene, mark non-walkable, never
let it close a loop.

## Recorded negative results

- **Web-resolution scans cannot resolve hatch pitch.** Three separate scans
  produced three different confident answers (0.30, 0.37, 0.52 mm) that were
  purely their own pixel floors. Require ≥ 4 pixels per hatch period.
- **Fixed-stride ray marching through a lattice aliases**, and the artefact
  looks like art: broad pale bands radiating from the vanishing point that read
  as shafts of light through an arcade. Use an exact voxel DDA.
- **A percentage-based ragged stroke end draws the lattice.** 7% of a stroke is
  two pixels on a one-cell face and a finger's width on a four-cell wall, so
  every block boundary came back as a pale gutter. Raggedness is absolute.
- **`sulphur tint` could not be verified** beyond a terminology record; the
  CAMEO definition page refused fetch. Treated as a low-amplitude ungraded grey
  veil, which is consistent but unconfirmed.
