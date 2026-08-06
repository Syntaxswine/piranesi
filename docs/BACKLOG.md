# Backlog

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

## 10 — Catalogue gaps from the census

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
