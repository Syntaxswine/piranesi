#!/usr/bin/env node
// tools/kit.mjs — CHOOSE THE HUNDRED.
//
//   node tools/kit.mjs                     -> docs/KIT.md + docs/kit.txt
//   node tools/kit.mjs --size 60
//   node tools/kit.mjs --spec docs/kit-spec.json
//   node tools/kit.mjs --check             CI: fail if the kit is out of date
//   node tools/kit.mjs --list              just the recipes, for blockshot
//
// The census ranks all 10,826 blocks; this picks a hundred that work TOGETHER.
// Why that is a different question, and why the top hundred by score would be a
// poor kit, is written at length in js/kit.js.
//
// The role spec is data, in `docs/kit-spec.json`, so the shape of the kit can
// be argued with and re-run without touching code.  The spec baked in below is
// the fallback and the baseline.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { everyBlock } from '../js/enumerate.js';
import { measure, joinery, rank } from '../js/measure.js';
import { blockFromRecipe } from '../js/stack.js';
import { pickKit, auditKit, featuresOf, matches, repairConnectivity, repairVertical } from '../js/kit.js';
import { SUB, BLOCK_YARDS } from '../js/cube.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const SIZE = Number(arg('--size', '100'));
const outMd = resolve(arg('--out', 'docs/KIT.md'));
const outTxt = resolve(arg('--txt', 'docs/kit.txt'));
const specPath = resolve(arg('--spec', 'docs/kit-spec.json'));

/**
 * THE FALLBACK SPEC.  Deliberately simple and stated in the open so it can be
 * beaten: eleven roles covering mass, wall, corner, opening, vault, deck and
 * light.  Counts are for a hundred and scale with --size.
 */
const FALLBACK = {
  headline: 'Cover the structural jobs first, then let interlock and freshness choose within each.',
  roles: [
    { name: 'solid-mass', count: 8, why: 'a run of these reads as one mass; the owner asked for blocks that are just solid space', filter: { family: 'stack', massMin: 0.9, waysMax: 0 } },
    { name: 'wall', count: 12, why: 'the ordinary piece: heavy, no way through, something to stand on', filter: { family: 'stack', massMin: 0.7, massMax: 0.95, waysMax: 0 } },
    { name: 'corner-turn', count: 10, why: 'an L is a corner of a wall, and four make a courtyard', filter: { family: 'stack', usesPlans: ['ell', 'ell-deep', 'corner', 'notch'] } },
    { name: 'covered-passage', count: 14, why: 'a roofed way through — the piece that makes an interior rather than a maze of yards', filter: { family: 'stack', horizontalPassage: true } },
    { name: 'barrel-vault', count: 10, why: 'the most Piranesian object there is, and the reason R_WHOLE exists', filter: { family: 'arch' } },
    { name: 'light-well', count: 8, why: 'a vertical shaft: how daylight gets into a vast interior', filter: { family: 'stack', verticalShaft: true, massMin: 0.4 } },
    { name: 'colonnade', count: 8, why: 'drums and quarter-columns; a row of them is an arcade', filter: { family: 'stack', usesPlans: ['drum', 'quarters', 'shaft'] } },
    { name: 'gallery-floor', count: 8, why: 'a deck top and bottom, so storeys can be built on each other', filter: { family: 'stack', capMin: 0.75, baseMin: 0.75, supportMin: 0.6 } },
    { name: 'anchor-bearing', count: 10, why: 'chains and rings hang off these; a kit short of them cannot make the plates hanging tackle', filter: { family: 'stack', anchorsMin: 3 } },
    { name: 'court', count: 6, why: 'a frame or ring: a void with masonry all round it', filter: { family: 'stack', usesPlans: ['frame', 'twin', 'bore'] } },
    { name: 'free', count: 6, why: 'left to interlock and freshness, so the kit is not entirely my opinion', filter: {} },
  ],
  rejects: [
    'sealed chambers — a void with no way out is unreachable and unlightable',
    'the all-rounded block, which is the one block in the grammar that meets nothing',
    'more than three blocks made of the same three plans in any order',
  ],
  buildTests: [],
};

/* ------------------------------------------------------------- the walk */

const t0 = Date.now();
const say = (s) => { if (!has('--quiet')) console.error(s); };

say('walking the grammar…');
const sheets = everyBlock().recipes
  .map((r) => measure(r, blockFromRecipe(r)))
  .filter(Boolean);
const serve = joinery(sheets);          // the wall-pattern index, reused for path search
rank(sheets);
for (const sh of sheets) sh.f = featuresOf(sh);
say(`  ${sheets.length.toLocaleString()} blocks  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

let spec = FALLBACK;
if (existsSync(specPath)) {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
  say(`  spec: ${specPath}`);
} else {
  say('  spec: built-in fallback');
}

// Scale the quotas to --size, keeping the proportions the spec asked for.
const declared = spec.roles.reduce((n, r) => n + r.count, 0);
if (declared !== SIZE) {
  const k = SIZE / declared;
  spec = { ...spec, roles: spec.roles.map((r) => ({ ...r, count: Math.max(1, Math.round(r.count * k)) })) };
}

/* ------------------------------------------------------------- the pick */

say('picking…');
const PIN = ['S:full,full,full:stone'];
const { kit, short } = pickKit(sheets, spec, {
  size: SIZE,
  // THE SOLID BLOCK IS PINNED.  It scores nothing for ways through because it
  // has none, so no ranking reaches for it — and a run of masonry does not read
  // as one mass without it.
  pin: PIN,
  setCap: Number(arg('--set-cap', '3')),
});

// CONNECTIVITY IS A SEPARATE PASS because no local objective can see it — the
// arches answer each other's walls, so the greedy is never told they are
// stranded.  js/kit.js explains at length.
const swaps = repairConnectivity(kit, sheets, { pin: PIN, serve, spec });
for (const s of swaps) {
  say(s.added ? `  bridge: +${s.added}  −${s.dropped}  (attaches ${s.attached}, ${s.hops} hops)`
    : `  STRANDED: ${s.stranded.length} blocks — ${s.why}`);
}

// And the vertical, which the wall pass never looks at and which is what stops
// a building having a third storey.
const lifts = repairVertical(kit, sheets, { pin: PIN, spec });
for (const s of lifts) {
  say(s.added ? `  lift:   +${s.added}  −${s.dropped}  (grounds ${s.grounds})`
    : `  UNGROUNDED: ${s.stranded} blocks — ${s.why}`);
}

const audit = auditKit(kit);
say(`  ${kit.length} blocks  ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* ----------------------------------------------------------- the report */

const pct = (v) => `${(v * 100).toFixed(0)}%`;
const L = [];
const p = (s = '') => L.push(s);

p('# The kit');
p('');
p('Generated by `node tools/kit.mjs`. **Do not edit by hand** — edit');
p('`docs/kit-spec.json`, which is the role spec this is built from, and re-run.');
p('');
p(`**${kit.length} blocks chosen from ${sheets.length.toLocaleString()}.** Not the top ${kit.length} by score: the census`);
p('says high scores cluster, so the top hundred would be one idea a hundred');
p('times. These are picked to work **together** — see `js/kit.js`.');
p('');
if (spec.headline) { p(`> ${spec.headline}`); p(''); }

p('## Does it hold together');
p('');
p('| | |');
p('|---|---|');
p(`| meets another block in the kit on all 4 walls | **${audit.fullyFlush} of ${kit.length}** |`);
p(`| mean walls met, of 4 | **${audit.meanKitFlush.toFixed(2)}** |`);
p(`| blocks meeting nothing else in the kit | **${audit.orphans.length}** |`);
p(`| joinery graph components | **${audit.components.count}** (largest ${audit.components.biggest}) |`);
p(`| distinct wall patterns in the kit | ${audit.wallPatterns} |`);
p(`| anchor sites for chains and rings | ${audit.anchors} |`);
p(`| blocks with a sealed chamber | ${audit.chambers} |`);
p('');
p('One component means every block can be reached from every other by setting');
p('blocks side by side. **Two would mean two cliques that cannot meet** — a kit');
p('that looks fine block by block and cannot build one building.');
p('');

p('### Can it build things');
p('');
p('| structure | | with |');
p('|---|---|---|');
for (const [name, r] of Object.entries(audit.tests)) {
  p(`| ${name} | ${r.ok ? '✅' : '❌'} | ${r.ok ? `\`${r.a}\` + \`${r.b}\`` : `only ${r.n ?? 0} candidates`} |`);
}
p('');

if (short.length) {
  p('### Roles that ran short');
  p('');
  p('Reported rather than quietly topped up, because a role coming up empty is a');
  p('gap in the **grammar**, not in the pick.');
  p('');
  p('| role | wanted | got | candidates in the whole grammar |');
  p('|---|---:|---:|---:|');
  for (const s of short) p(`| ${s.role} | ${s.wanted} | ${s.got} | ${s.pool} |`);
  p('');
}

p('## What is in it');
p('');
p('| role | blocks |');
p('|---|---:|');
for (const [k, v] of Object.entries(audit.roles).sort((a, b) => b[1] - a[1])) p(`| ${k} | ${v} |`);
p('');
p('**Plans used**, of the 16 in the vocabulary — a plan appearing nowhere means');
p('the kit cannot make anything that shape.');
p('');
p('| plan | blocks using it |');
p('|---|---:|');
for (const [k, v] of audit.plans) p(`| \`${k}\` | ${v} |`);
p('');

p('## The hundred');
p('');
p('`kit` is walls met by another block **in this kit**; `all` is walls met');
p('anywhere in the grammar. `ways` counts roofed passages.');
p('');
p('| # | recipe | role | score | kit | all | ways | anchors | mass |');
p('|---:|---|---|---:|---:|---:|---:|---:|---:|');
kit.slice().sort((a, b) => b.score - a.score).forEach((s, i) => {
  p(`| ${i + 1} | \`${s.recipe}\` | ${s.role} | ${s.score.toFixed(3)} | ${s.kitFlush}/4 | ${s.flush}/4 | ${s.ways} | ${s.anchors} | ${pct(s.mass)} |`);
});
p('');
p('```bash');
p('node tools/blockshot.mjs --recipes @docs/kit.txt --cols 10 --size 2400x1500');
p('```');
p('');
p(`A block is ${BLOCK_YARDS} yards cubed, ${SUB}×${SUB}×${SUB} sub-blocks.`);
p('');

const text = L.join('\n') + '\n';
const txt = kit.map((s) => s.recipe).join('\n') + '\n';

if (has('--list')) { process.stdout.write(txt); process.exit(0); }

if (has('--check')) {
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  if (read(outMd) !== text || read(outTxt) !== txt) {
    console.error('the kit is out of date — run: node tools/kit.mjs');
    process.exit(1);
  }
  console.log(`kit up to date  (${kit.length} blocks)`);
} else {
  mkdirSync(dirname(outMd), { recursive: true });
  writeFileSync(outMd, text);
  writeFileSync(outTxt, txt);
  console.log(`${outMd}   ${kit.length} blocks`);
  console.log(`${outTxt}`);
  console.log(`  interlock: ${audit.fullyFlush}/${kit.length} fully flush, mean ${audit.meanKitFlush.toFixed(2)}/4, ${audit.components.count} component(s)`);
  console.log(`  ${Object.entries(audit.tests).filter(([, r]) => r.ok).length}/${Object.keys(audit.tests).length} build tests pass`);
  if (short.length) console.log(`  SHORT: ${short.map((s) => `${s.role} ${s.got}/${s.wanted}`).join(', ')}`);
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
