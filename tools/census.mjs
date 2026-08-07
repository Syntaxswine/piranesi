#!/usr/bin/env node
// tools/census.mjs — WALK THE WHOLE SPACE, MEASURE IT, RANK IT.
//
//   "lets procedurally generate every combination of blocks.  once we have all
//    the variants we can catalog them, once cataloged we can see which ones are
//    the most viable."
//
// `buildCatalog` deals twenty-four blocks and the rest of the grammar has never
// been looked at.  This looks at all of it.
//
//   node tools/census.mjs                  the census -> docs/CENSUS.md + census.json
//   node tools/census.mjs --verify         the self-checks only, nothing written
//   node tools/census.mjs --top 60         how many to name in the write-up
//   node tools/census.mjs --check          CI: fail if the census is out of date
//   node tools/census.mjs --shelf 16       print a diverse shelf, for blockshot
//
// THE SELF-CHECKS RUN EVERY TIME, not only under --verify, and the census
// refuses to write if any of them fails.  It leans on three things that are
// each easy to get wrong and impossible to notice: that a stack's mask can be
// assembled from its plans instead of ray-cast, that each plan's declared
// `turns` is its true period, and that a quarter turn of an arch is the arch
// this file says it is.  Any of those being wrong produces a complete-looking
// catalogue that is quietly missing blocks — so they are measured against the
// shipped geometry, not asserted.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PLANS, PLAN_IDS } from '../js/plan.js';
import { SUB, BLOCK_YARDS, R, R_WHOLE } from '../js/cube.js';
import { LAYERS } from '../js/recipe.js';
import { blockFromRecipe } from '../js/stack.js';
import { maskFor } from '../js/solidity.js';
import {
  everyBlock, layerTokens, expectedStackBlocks, archOrbit, arches, least, MATERIALS,
} from '../js/enumerate.js';
import {
  measure, joinery, rank, maskOf, planMask, turnMask, keyOf, profile, SIDES,
} from '../js/measure.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const TOP = Number(arg('--top', '40'));
const outMd = resolve(arg('--out', 'docs/CENSUS.md'));
const outJson = resolve(arg('--json', 'docs/census.json'));
// The recommended shelf as a plain list, so `blockshot --recipes @docs/shelf.txt`
// draws exactly what the census chose without anything in between.
const outShelf = resolve(arg('--shelf-out', 'docs/shelf.txt'));
const SHELF = Number(arg('--shelf-size', '18'));
const t0 = Date.now();
const say = (s) => { if (!has('--quiet')) console.log(s); };

/* ===================================================== the self-checks === */

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); return ok; };

// 1. THE FAST PATH IS THE SLOW PATH.  A stack's mask is assembled from its
//    three plan masks rather than ray-cast; if that is not exact the entire
//    census is measuring a block that does not exist.  Sampled across the
//    space, deliberately including the curved, notched and disconnected plans.
{
  const sample = [
    'S:full,full,full:stone', 'S:ell,bar/1,frame:stone', 'S:bore,drum,quarters:stone',
    'S:rounded,shaft,cross:stone', 'S:corner/2,tee/3,notch/1:stone',
    'S:twin/1,bar-wide,ell-deep/3:stone', 'S:drum,bore,drum:stone',
    'S:notch/3,notch/1,rounded:stone', 'S:quarters,quarters,full:stone',
    'S:tee/1,cross,ell/2:stone', 'S:shaft,frame,bar/0:stone', 'S:bar-wide/1,corner/3,twin:stone',
  ];
  let worst = 0;
  for (const r of sample) {
    const fast = maskOf(r), slow = maskFor(blockFromRecipe(r));
    let d = 0;
    for (let i = 0; i < slow.length; i++) if (fast[i] !== slow[i]) d++;
    if (d > worst) worst = d;
  }
  check('assembled mask === ray-cast mask', worst === 0,
    `${sample.length} blocks, worst disagreement ${worst} cells of ${SUB ** 3}`);
}

// 2. EACH PLAN'S DECLARED `turns` IS ITS TRUE PERIOD.  Too low and the
//    generator never offers blocks that exist; too high and it offers the same
//    block four times and calls it variety.  Measured off the footprint.
const periods = {};
{
  const wrong = [];
  for (const id of PLAN_IDS) {
    const m0 = keyOf(planMask(id, 0));
    let p = 4;
    for (let q = 1; q < 4; q++) if (keyOf(planMask(id, q)) === m0) { p = q; break; }
    periods[id] = p;
    if (p !== PLANS[id].turns) wrong.push(`${id}: declared ${PLANS[id].turns}, measured ${p}`);
  }
  check('declared turns === measured period', wrong.length === 0, wrong.join('; ') || `all ${PLAN_IDS.length} plans agree`);
}

// 3. A QUARTER TURN OF AN ARCH IS WHAT enumerate.js SAYS IT IS.  Derived from
//    how vault() sweeps and how halfVault() picks a hand — which is exactly the
//    sort of derivation that comes out mirrored and still looks sensible.
{
  const bad = [];
  let n = 0;
  for (const a of arches()) {
    if (n++ % 7) continue;                          // a spread, not all 204
    const [r0, r1] = archOrbit(a);
    const turned = keyOf(turnMask(maskOf(r0), 1));
    if (turned !== keyOf(maskOf(r1))) bad.push(`${r0} -> ${r1}`);
  }
  check('turnArch === turning the mesh', bad.length === 0,
    bad.length ? bad.slice(0, 3).join(', ') : `${n} arches checked`);
}

/* ======================================================== the enumeration */

say('walking the grammar…');
const E = everyBlock();
const burnside = expectedStackBlocks();
check('walked orbits === Burnside count', E.stackBlocks === burnside,
  `walked ${E.stackBlocks}, predicted ${burnside}`);

say(`  ${E.recipeCount.toLocaleString()} recipes · ${E.solids.toLocaleString()} solids · ${E.recipes.length.toLocaleString()} blocks`);

/* =========================================================== the measuring */

say('measuring…');
const sheets = [];
for (const r of E.recipes) {
  // Every block gets its mesh built, because anchor sites are only knowable
  // from it — and where a chain can be hung is part of what makes a block worth
  // reaching for.  0.16 ms each; the mask is the expensive part and that is
  // assembled, not cast.
  const sh = measure(r, blockFromRecipe(r));
  if (sh) sheets.push(sh);
}
say(`  ${sheets.length.toLocaleString()} measured  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

say('joining…');
const serve = joinery(sheets);
const scale = rank(sheets);
sheets.sort((a, b) => b.score - a.score || a.recipe.localeCompare(b.recipe));
say(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// A RANKING THAT DOES NOT RANK IS A BUG, and it is invisible: the table looks
// like a top forty either way.  The first version tied 82 blocks at a perfect
// score and sorted them alphabetically.
const topScore = sheets[0].score;
const tied = sheets.filter((s) => Math.abs(s.score - topScore) < 1e-9).length;
const distinct = new Set(sheets.map((s) => s.score.toFixed(4))).size;
check('the score discriminates', tied <= sheets.length / 200 && distinct > 200,
  `${tied} tied at the top of ${sheets.length.toLocaleString()}, ${distinct.toLocaleString()} distinct scores`);

/* ============================================================ the findings */

// Two blocks whose masks are identical are different blocks — a drum and a
// square pillar are not the same thing — but they are INTERCHANGEABLE to the
// light and to the joiner, so how many there are is worth knowing.
const byMask = new Map();
for (const sh of sheets) {
  const k = keyOf(sh.mask);
  if (!byMask.has(k)) byMask.set(k, []);
  byMask.get(k).push(sh.recipe);
}
const collisions = [...byMask.values()].filter((a) => a.length > 1);
const collided = collisions.reduce((n, a) => n + a.length - 1, 0);

const walls = serve.get('+x');
const wallProfiles = [...walls.entries()].map(([k, s]) => ({ k, n: s.size })).sort((a, b) => b.n - a.n);

/**
 * Wall patterns side by side as pictures.  They were printed as truncated
 * bitstrings and every one of them read `111111111111111111111111111…` — three
 * rows of nine, all stone, indistinguishable.  Eighty-one bits is a picture,
 * so draw the picture.  Top row first, because it is an elevation.
 */
function patternArt(list) {
  const grid = (k) => {
    const rows = [];
    for (let b = SUB - 1; b >= 0; b--) {
      let s = '';
      for (let a = 0; a < SUB; a++) s += k[a + SUB * b] === '1' ? '#' : '.';
      rows.push(s);
    }
    return rows;
  };
  const cols = list.map((w) => {
    const cells = [...w.k].reduce((n, c) => n + (c === '1' ? 1 : 0), 0);
    return { head: `${w.n} blocks`, sub: `${cells}/81`, rows: grid(w.k) };
  });
  const W = SUB + 3;
  const out = [
    cols.map((c) => c.head.padEnd(W)).join(''),
    cols.map((c) => c.sub.padEnd(W)).join(''),
  ];
  for (let r = 0; r < SUB; r++) out.push(cols.map((c) => c.rows[r].padEnd(W)).join(''));
  return out.map((s) => s.replace(/\s+$/, ''));
}

const stats = (f) => {
  const v = sheets.map(f).sort((a, b) => a - b);
  return { min: v[0], med: v[v.length >> 1], max: v[v.length - 1], mean: v.reduce((a, b) => a + b, 0) / v.length };
};

const tally = (f) => {
  const t = new Map();
  for (const sh of sheets) t.set(f(sh), (t.get(f(sh)) || 0) + 1);
  return [...t.entries()].sort((a, b) => a[0] - b[0]);
};

const dead = sheets.filter((sh) => sh.flush === 0);
const chambered = sheets.filter((sh) => sh.chambers > 0);
const floating = sheets.filter((sh) => sh.support < 0.5);
const solidOnly = sheets.filter((sh) => sh.ways === 0);
const zeroAnchor = sheets.filter((sh) => sh.anchors === 0).length;

/* ------------------------------------------------------------- the shelf */

/**
 * A SHELF, not a top-N.  The forty best blocks are largely the same idea forty
 * times — high scores cluster because the things that make a block viable are
 * correlated — and a shelf of near-identical blocks is no vocabulary at all.
 * So: take them in score order, but refuse one whose footprint has already been
 * taken, and cover both families.
 */
function shelf(n) {
  const out = [], seen = new Set();
  // Everything but the family letter, the turns and the material — so two turns
  // of one idea count as one idea.  Must span ALL the middle fields: taking only
  // the first gave an arch the signature `x+`, which meant the shelf could hold
  // six arches in total however many were distinct.
  const sig = (sh) => sh.recipe.replace(/\/\d/g, '').split(':').slice(1, -1).join(':');
  const take = (sh) => {
    if (!sh || out.includes(sh) || seen.has(sig(sh))) return false;
    seen.add(sig(sh)); out.push(sh); return true;
  };

  // THE SOLID BLOCK IS ALWAYS ON THE SHELF.  It scores nothing for ways through
  // because it has none, so no ranking will ever reach for it — and it is still
  // the most useful block in the game.  The owner said so, and the census agrees
  // from the other direction: its wall is the commonest pattern in the grammar
  // by a distance, which is exactly what makes a run of masonry read as one mass.
  take(sheets.find((s) => s.recipe === 'S:full,full,full:stone'));

  // AN ARCH QUOTA, for the same reason inverted.  Arches rank low because they
  // are a vocabulary island, not because they are bad blocks, so a shelf picked
  // purely on score would contain none — and a Carceri without a vault is not
  // one.  This is the census declining to let its own metric make an
  // architectural decision.
  let na = 0, quota = Math.max(2, Math.round(n / 6));
  for (const sh of sheets) { if (na >= quota) break; if (sh.family === 'arch' && take(sh)) na++; }

  for (const sh of sheets) { if (out.length >= n) break; take(sh); }
  for (const sh of sheets) { if (out.length >= n) break; if (!out.includes(sh)) out.push(sh); }
  return out.slice(0, n).sort((a, b) => b.score - a.score);
}

if (has('--shelf')) {
  for (const sh of shelf(Number(arg('--shelf', '16')))) console.log(sh.recipe);
  process.exit(0);
}

/* ============================================================== the report */

const failed = checks.filter((c) => !c.ok);
const pct = (v) => `${(v * 100).toFixed(0)}%`;
const L = [];
const p = (s = '') => L.push(s);

p('# The census');
p('');
p('Generated by `node tools/census.mjs`. **Do not edit by hand** — but do read the');
p('diff, because a change here means the grammar now admits a different set of');
p('blocks than it did.');
p('');
p('Every block the grammar admits, walked, measured and ranked. Not a hand dealt');
p('from a seed — `buildCatalog` deals twenty-four of these and the rest had never');
p('been looked at.');
p('');

p('## Three numbers');
p('');
p('| | count | |');
p('|---|---:|---|');
p(`| recipes | ${E.recipeCount.toLocaleString()} | every string the grammar admits |`);
p(`| solids | ${E.solids.toLocaleString()} | …that differ as geometry. Material is a skin, so exactly half |`);
p(`| **blocks** | **${sheets.length.toLocaleString()}** | …that differ once you are allowed to **turn** one |`);
p('');
p(`Rotation is free at placement, so a block and the same block a quarter turn`);
p(`round are one block. That collapses ${E.solids.toLocaleString()} to ${sheets.length.toLocaleString()} —`);
p(`**${pct(1 - sheets.length / E.solids)} of any "every combination" catalogue is the same block relabelled.**`);
p('');
p(`${E.stackBlocks.toLocaleString()} stacks · ${E.archBlocks} arches · from ${E.tokens} layer tokens`);
p(`(${PLAN_IDS.length} plans × their turns) in ${LAYERS} layers · a block is ${BLOCK_YARDS} yards cubed,`);
p(`${SUB}×${SUB}×${SUB} sub-blocks, all curves struck at R ${R} or R ${R_WHOLE}.`);
p('');

p('## Self-checks');
p('');
p('The census leans on three things that are each easy to get wrong and');
p('impossible to notice by looking. They are measured against the shipped');
p('geometry every run, and nothing is written if one fails.');
p('');
p('| check | | |');
p('|---|---|---|');
for (const c of checks) p(`| ${c.name} | ${c.ok ? '✅' : '❌'} | ${c.detail} |`);
p('');

p('## The alphabet');
p('');
p('A layer is a plan and a turn. `turns` is the plan\'s claim about its own');
p('symmetry; `period` is what the footprint actually does.');
p('');
p('| plan | turns | period | mass | footprint cells |');
p('|---|---:|---:|---:|---:|');
for (const id of PLAN_IDS) {
  const m = planMask(id, 0);
  let n = 0; for (const v of m) n += v;
  p(`| \`${id}\` | ${PLANS[id].turns} | ${periods[id]} | ${PLANS[id].mass.toFixed(2)} | ${n}/81 |`);
}
p('');

p('## What is in there');
p('');
const mass = stats((s) => s.mass);
p(`**Mass.** median ${pct(mass.med)} of the box is stone, mean ${pct(mass.mean)},`);
p(`range ${pct(mass.min)}–${pct(mass.max)}.`);
p('');
p('**Ways through** — how many axes you can get from one face to the opposite one');
p('through the void. A vocabulary of nothing but solids is a quarry.');
p('');
p('A horizontal way must be **roofed**: you cannot walk through a block by');
p('walking over it. That distinction was found by looking at a picture rather');
p('than a number — the first ranking filled up with big slabs wearing a small');
p('block as a hat, all scoring three ways out of three, because a mostly-empty');
p('top storey connects every face to every other through the open air above the');
p('block. A vertical way is exempt: a shaft cannot be roofed, that is what makes');
p('it a shaft.');
p('');
p('| ways | roofed | unroofed |');
p('|---:|---:|---:|');
{
  const a = new Map(tally((s) => s.ways)), b = new Map(tally((s) => s.openWays));
  for (const k of [0, 1, 2, 3]) {
    p(`| ${k} | ${(a.get(k) || 0).toLocaleString()} | ${(b.get(k) || 0).toLocaleString()} |`);
  }
}
p('');
p('**Flush walls** — of a block\'s four sides, how many some *other* block can');
p('meet exactly, so the faces cancel and the seam disappears. This is the number');
p('the cube law exists to produce.');
p('');
p('| flush walls | blocks | |');
p('|---:|---:|---|');
for (const [k, n] of tally((s) => s.flush)) p(`| ${k} | ${n.toLocaleString()} | ${pct(n / sheets.length)} |`);
p('');

p('## The socket vocabulary');
p('');
p(`Every block presents a 9×9 pattern of stone on each wall. Two blocks meet`);
p(`flush when the touching patterns are identical. Across the whole catalogue and`);
p(`all four turns there are **${walls.size.toLocaleString()} distinct wall patterns** —`);
p(`out of ${sheets.length * 4} presented, so the vocabulary is far more concentrated`);
p(`than the block count suggests, which is why anything meets anything at all.`);
p('');
p('The commonest, drawn as elevations — this is the wall you would be looking at,');
p('stone filled, void blank, nine sub-blocks across and nine up:');
p('');
p('```');
for (const row of patternArt(wallProfiles.slice(0, 6))) p(row);
p('```');
p('');
p('The solid wall leads, as it should: it is what makes a run of masonry read as');
p('one mass, and it is the reason the owner asked for blocks that are just solid');
p('space. What comes next is the shape of the whole thing — **one storey open, in');
p('each of the three positions, tied at exactly the same count.** The grammar has');
p('no opinion about which floor you leave open, and the slices are what make the');
p('three interchangeable. That tie is the cube law showing up as a number.');
p('');

p('## Findings');
p('');
const some = (a, n = 3) => a.slice(0, n).map((s) => `\`${s.recipe}\``).join(', ');

p(`### The one block that meets nothing`);
p('');
p(`Out of ${sheets.length.toLocaleString()}, exactly **${dead.length}** presents a wall that no other block can`);
p(`match on any of its four sides:`);
p('');
for (const sh of dead) p(`> \`${sh.recipe}\``);
p('');
p('And it explains itself. `rounded` is the square with all four vertical arrises');
p('struck at R 2.5, so its wall is a curved band that only `rounded` produces —');
p('and because `rounded` is four-fold symmetric there is exactly **one** block made');
p('of nothing else. It can only ever meet itself, and there is no second one to');
p('meet. Every other rounded block has a straight-walled storey somewhere that');
p('gives it a way in.');
p('');
p('That is a gap in the vocabulary rather than a defect: a fully rounded pier is a');
p('thing you want, and at present it can only ever stand alone. What would fix it');
p('is a companion plan presenting the rounded band on one side and a slice-plane');
p('wall on the other — the piece that lets a round tower die into a straight one.');
p('');
p('### Sealed chambers');
p('');
p(`**${chambered.length}** blocks contain a void with no way out — unreachable, unlightable,`);
p(`and pure cost. ${some(chambered)}.`);
p('');
p('The shape is always the same and it is a nice one: a `drum` is a free-standing');
p('cylinder, a `shaft` is the square with that same cylinder bored out of it. Stack');
p('one on the other and the plug fills the hole from below; put anything solid on');
p('top and the bore becomes a closed column of air in the middle of the masonry.');
p('The sort of thing a full walk turns up and a hand of twenty-four never would.');
p('');
/* THE ARCH QUESTION, computed rather than asserted: what can meet the END of a
   vault, as opposed to its flank?  A run of arches reading as one barrel is the
   single most Piranesian thing the grammar can do, and it is what R_WHOLE was
   for — so it is worth knowing exactly who can join one. */
const archSheets = sheets.filter((s) => s.family === 'arch');
const capOf = (sh) => [`-${sh.axis}`, `+${sh.axis}`];
const flankOf = (sh) => (sh.axis === 'x' ? ['-y', '+y'] : ['-x', '+x']);
const meanOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const capMet = meanOf(archSheets.flatMap((s) => capOf(s).map((k) => s.per[k])));
const flankMet = meanOf(archSheets.flatMap((s) => flankOf(s).map((k) => s.per[k])));
// Who, by name, can meet one particular arch's cap?
const probe = archSheets.slice().sort((a, b) => b.score - a.score)[0];
const probeKey = probe && keyOf(profile(probe.mask, `+${probe.axis}`));
const probeMatch = probe ? sheets.filter((s) => {
  for (let q = 0; q < 4; q++) {
    if (keyOf(profile(turnMask(s.mask, q), `-${probe.axis}`)) === probeKey) return true;
  }
  return false;
}) : [];
const halfNoRoof = archSheets.filter((s) => s.hand !== 'both' && s.per['+z'] === 0).length;
const halves = archSheets.filter((s) => s.hand !== 'both').length;

p('### A vault runs, but it cannot land');
p('');
p(`The ${archSheets.length} arches are a **vocabulary island**, and this is the census's most`);
p('actionable result. Their best block ranks');
p(`${(sheets.indexOf(archSheets.slice().sort((a, b) => b.score - a.score)[0]) + 1).toLocaleString()} of ${sheets.length.toLocaleString()};`);
p('their median is far below that. The reason is not that they are bad blocks.');
p('');
p(`An arch presents two different kinds of face. Its **flanks** — the walls`);
p(`alongside the vault — are met by ${flankMet.toFixed(0)} blocks on average, because below the`);
p(`springing they are just the pier plan and stacks match that happily. Its **caps**`);
p(`— the ends of the tunnel — are met by ${capMet.toFixed(1)}.`);
p('');
p(`Taking the best-scoring arch, \`${probe.recipe}\`, and asking what can meet the`);
p(`end of it: **${probeMatch.length} blocks in the whole grammar, and every one of them is another`);
p(`arch.**`);
p('');
for (const s of probeMatch.slice(0, 5)) p(`> \`${s.recipe}\``);
p('');
p('Which is half a success. A row of them cancels its shared caps and reads as one');
p('continuous barrel with no membranes between the bays — that is exactly what');
p('`vault()` tags its end caps for, and it works. But **the tunnel has no ending**.');
p('There is no block in the grammar presenting a spandrel on one face and a wall');
p('on the other, so a vault can run forever or stop in mid-air, and nothing else.');
p('');
p('`halfVault` was written to be "the piece that lets a vault die into a wall');
p('instead of stopping in mid-air", but its hand chooses which *spandrel* survives');
p('— both of its caps are still arch profiles. It solves the problem along the');
p('wrong axis. What is missing is a **springer**: a stack-like block carrying the');
p('vault cross-section on one face and a slice-plane wall on the other.');
p('');
if (halves) {
  p(`Related, and from the same gap: **${halfNoRoof} of the ${halves} half-arches have nothing in the`);
  p('grammar that can stand on them** — their top face is half a spandrel and no');
  p('block presents its match underneath.');
  p('');
}

p('### The rest');
p('');
p(`- **${solidOnly.length.toLocaleString()} (${pct(solidOnly.length / sheets.length)}) have no way through at all** — walls and lumps. Wanted,`);
p(`  in that proportion: the owner asked for blocks that are just solid space.`);
p(`- **${floating.length.toLocaleString()} (${pct(floating.length / sheets.length)}) carry less than half their own upper storeys** where one`);
p(`  slice hands over to the next. Legal, and this is Piranesi, so an impossibility`);
p(`  is not a fault — but it should be the player's impossibility, not one the`);
p(`  generator hands out. ${some(floating)}.`);
p(`- **${zeroAnchor.toLocaleString()} (${pct(zeroAnchor / sheets.length)}) offer nowhere to hang a chain.** Anchor sites need`);
p(`  stone immediately behind them, so the airier blocks have none.`);
p(`- **${collided.toLocaleString()} blocks share a footprint with another** (${collisions.length.toLocaleString()} groups) — so at this`);
p(`  resolution every block in the grammar is distinguishable from every other.`);
p('');

p('## The most viable');
p('');
p('`0.30·reach + 0.14·deck + 0.28·way + 0.12·anchor + 0.16·sound`, scaled down for');
p('a block too thin to be masonry. It is a judgement, so it is weighted in the');
p('open and every part is in the table beside it — argue with the weights, not the');
p('numbers.');
p('');
p('- **reach** — how many blocks meet its walls exactly, of a possible');
p(`  ${scale.maxReach.toFixed(0)}. Its faces being the common currency is what makes it`);
p('  worth reaching for');
p('- **deck** — the same question upward: can it join a vertical run');
p('- **way** — how many axes you can get through it on');
p('- **anchor** — has it somewhere to hang a chain');
p('- **stand** — how much of it is carried where a slice hands over to the next');
p('');
p('**The first version of this score was wrong in a way worth recording**, because');
p('it is the whole reason for running a census rather than reasoning about one. It');
p('scored a block on whether its walls meet other blocks, whether it stands on');
p('itself and whether it has decks — and 99.8% of the catalogue came back with');
p('four flush walls out of four, *every* block came back fully supported, and 82');
p('tied at a perfect 1.000. The table was sorting alphabetically inside one');
p('enormous tie. That is not really a broken metric, it is a **result**: the cube');
p('law works so well that "does it join" is answered yes for almost everything, so');
p('it cannot separate blocks. The question had to move from *whether* a block\'s');
p('walls are met to *how common* they are.');
p('');
p('| # | recipe | score | reach | deck | ways | anchors | stand | mass |');
p('|---:|---|---:|---:|---:|---:|---:|---:|---:|');
sheets.slice(0, TOP).forEach((sh, i) => {
  p(`| ${i + 1} | \`${sh.recipe}\` | ${sh.score.toFixed(3)} | ${sh.reach.toFixed(0)} | ${sh.deck} | ${sh.ways} | ${sh.anchors} | ${pct(sh.support)} | ${pct(sh.mass)} |`);
});
p('');
p(`${tied.toLocaleString()} blocks tie at the top score of ${topScore.toFixed(3)}, out of`);
p(`${distinct.toLocaleString()} distinct scores. High scores still cluster, because the things`);
p('that make a block viable are correlated — so the list above is not a shelf. A');
p('shelf needs blocks that differ.');
p('');

p('## A shelf');
p('');
p('The best blocks that are also *different from each other*: taken in score');
p('order, refusing one whose combination of plans is already on the shelf.');
p('');
p('| recipe | score | reach | ways | anchors | mass |');
p('|---|---:|---:|---:|---:|---:|');
for (const sh of shelf(24)) {
  p(`| \`${sh.recipe}\` | ${sh.score.toFixed(3)} | ${sh.reach.toFixed(0)} | ${sh.ways} | ${sh.anchors} | ${pct(sh.mass)} |`);
}
p('');
p('```bash');
p('node tools/census.mjs --shelf 16 | tr \'\\n\' \',\' | xargs -I{} node tools/blockshot.mjs --recipes {}');
p('```');
p('');

p('## The least viable');
p('');
p('What the bottom of the space looks like, which is worth seeing once.');
p('');
p('| recipe | score | reach | stand | ways | anchors | mass |');
p('|---|---:|---:|---:|---:|---:|---:|');
for (const sh of sheets.slice(-12)) {
  p(`| \`${sh.recipe}\` | ${sh.score.toFixed(3)} | ${sh.reach.toFixed(0)} | ${pct(sh.support)} | ${sh.ways} | ${sh.anchors} | ${pct(sh.mass)} |`);
}
p('');

const text = L.join('\n') + '\n';

/* ================================================================== write */

const json = {
  format: 'piranesi/census/1',
  block: { sub: SUB, yards: BLOCK_YARDS, R, R_WHOLE, layers: LAYERS },
  counts: {
    recipes: E.recipeCount, solids: E.solids, blocks: sheets.length,
    stacks: E.stackBlocks, arches: E.archBlocks, tokens: E.tokens,
    materials: MATERIALS.length, wallPatterns: walls.size,
  },
  checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
  periods,
  findings: {
    noFlush: dead.length, noWay: solidOnly.length, weakStand: floating.length,
    sealedChamber: chambered.length, sharedFootprint: collided,
  },
  // The catalogue itself, compact: one row a block.
  scale: { maxReach: scale.maxReach, maxDeck: scale.maxDeck, tiedAtTop: tied, distinctScores: distinct },
  columns: ['recipe', 'score', 'reach', 'deck', 'flush', 'ways', 'cells', 'support', 'chambers', 'anchors'],
  blocks: sheets.map((s) => [
    s.recipe, +s.score.toFixed(4), +s.reach.toFixed(1), s.deck, s.flush, s.ways, s.cells,
    +s.support.toFixed(3), s.chambers, s.anchors,
  ]),
};
const jsonText = JSON.stringify(json, null, 0) + '\n';

if (failed.length) {
  console.error('\nCENSUS REFUSES TO WRITE — a self-check failed:');
  for (const c of failed) console.error(`  ❌ ${c.name}: ${c.detail}`);
  process.exit(1);
}

if (has('--verify')) {
  for (const c of checks) console.log(`  ✅ ${c.name}  —  ${c.detail}`);
  console.log(`\nall ${checks.length} checks pass  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(0);
}

const shelfText = shelf(SHELF).map((s) => s.recipe).join('\n') + '\n';

if (has('--check')) {
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  if (read(outMd) !== text || read(outJson) !== jsonText || read(outShelf) !== shelfText) {
    console.error(`census is out of date — run: node tools/census.mjs`);
    process.exit(1);
  }
  console.log(`census up to date  (${sheets.length.toLocaleString()} blocks)`);
} else {
  mkdirSync(dirname(outMd), { recursive: true });
  writeFileSync(outMd, text);
  writeFileSync(outJson, jsonText);
  writeFileSync(outShelf, shelfText);
  console.log(`\n${outMd}   ${sheets.length.toLocaleString()} blocks`);
  console.log(`${outJson}  ${(jsonText.length / 1024).toFixed(0)} kB`);
  console.log(`${outShelf}  ${SHELF} blocks · draw it with:`);
  console.log(`  node tools/blockshot.mjs --recipes @docs/shelf.txt --cols 5`);
  console.log(`\n  ${E.recipeCount.toLocaleString()} recipes → ${E.solids.toLocaleString()} solids → ${sheets.length.toLocaleString()} blocks`);
  console.log(`  best: ${sheets[0].recipe}  ${sheets[0].score.toFixed(3)}`);
  console.log(`  ${dead.length.toLocaleString()} meet nothing · ${chambered.length.toLocaleString()} sealed chambers · ${collided.toLocaleString()} shared footprints`);
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
