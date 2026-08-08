// kit.js — CHOOSING A HUNDRED BLOCKS OUT OF TEN THOUSAND.
//
// The census ranks every block the grammar admits.  Taking its top hundred would
// be a mistake, and the census itself says why: high scores cluster, because the
// things that make a block viable are correlated.  The top forty are largely one
// idea forty times.
//
// A HUNDRED BLOCKS IS A VOCABULARY, NOT A LEADERBOARD.  Three things matter that
// no per-block score can see:
//
//   1. DIVERSITY.  Two blocks made of the same three plans in the same order are
//      the same idea however differently they score.  There are 4,096 distinct
//      plan sequences among the 10,826 blocks — the rest differ only in relative
//      turns — so the kit takes at most one block per sequence.
//
//   2. INTERLOCK WITH ITSELF.  `reach` counts how many of all 10,826 meet a
//      block's walls.  Inside a hundred-block kit that number is nearly
//      meaningless: what matters is how many of the OTHER NINETY-NINE meet it.
//      A block whose walls are rare is a dead end in a small kit even though it
//      reaches widely across the whole grammar.  This is the number the selector
//      actually maximises.
//
//   3. ROLES.  A kit needs pieces for jobs — mass, wall, corner, opening, vault,
//      floor plate, light well — and a purely numerical pick will quietly fail
//      to contain any of some of them.  Roles come in as a spec with quotas.
//
// The greedy pass uses a cheap incremental estimate of interlock; everything
// REPORTED is recomputed exactly with the census's own `joinery`.  A heuristic
// choosing is fine.  A heuristic marking its own homework is not.

import { measure, joinery, turnMask, keyOf, profile, SIDES, OPPOSITE } from './measure.js';
import { decode } from './recipe.js';
import { planOfLayer, encodeLayer } from './drawn.js';

/* ------------------------------------------------------------- features -- */

/**
 * What a role filter may ask about, derived once per block.
 *
 * THE DIVERSITY KEY MUST EXIST FOR EVERY FAMILY, and it has now been the same
 * bug twice. It was the plan sequence — so all 58 arches shared the empty key,
 * the kit could hold exactly one of them, and a role asking for ten barrel
 * vaults came back with one. `D:` arrived and did it again: a hand-drawn block
 * has no plans either, so an entire shelf of them collapsed to one entry
 * (BACKLOG 0r). An arch's identity is its axis, hand and pier; a drawing's is
 * its own three layer strings, which is exactly what its recipe is made of.
 */
export function featuresOf(sh) {
  const d = decode(sh.recipe);
  const arch = d.ok && d.family === 'arch';
  const drawn = d.ok && d.family === 'drawn';
  // A DRAWN STOREY'S PLAN IS MEASURED. `planOfLayer` compares the polygons the
  // mesher will get against every plan in every turn, so a layer that IS `full`
  // reports `full` and a layer that is nothing in the vocabulary reports
  // nothing. Mapping the drawn tokens onto plan names by hand — `*b` "is" a
  // bore — would be the substitution this project refuses, and would be a lie
  // the moment somebody paints a bore-shaped hole a yard off centre.
  const plans = drawn
    ? d.layers.map((L) => (planOfLayer(L) || {}).id || null)
    : (d.ok && !arch ? d.layers.map((L) => L.id) : []);
  const named = plans.filter(Boolean);
  const pier = arch ? d.pier.id : null;
  const bodies = drawn ? d.layers.map((L) => encodeLayer(L)) : null;
  const seq = arch ? `A:${d.axis}${d.hand}:${pier}`
    : drawn ? `D:${bodies.join(',')}` : plans.join(',');
  return {
    // Only the storeys that ARE a plan go in `plans`, so `usesPlans` keeps
    // meaning what it says; the nulls stay in `base`/`mid`/`top`, where the
    // position matters and "this storey is not in the vocabulary" is an answer.
    plans: named, pier, seq,
    // Coarser: the same idea regardless of storey order.  For an arch, every
    // hand of the same axis and pier.
    set: arch ? `A:${d.axis}:${pier}`
      : drawn ? `D:${[...bodies].sort().join('+')}` : [...plans].sort().join('+'),
    base: plans[0] || null,
    mid: plans[1] || null,
    top: plans[2] || null,
  };
}

/** Evaluate a role filter. Unknown keys are ignored rather than silently
 *  failing every block — a spec written by hand will contain some. */
export function matches(sh, f = {}) {
  const F = sh.f;
  const mass = sh.mass;
  if (f.family && f.family !== 'any' && sh.family !== f.family) return false;
  if (f.massMin != null && mass < f.massMin) return false;
  if (f.massMax != null && mass > f.massMax) return false;
  if (f.waysMin != null && sh.ways < f.waysMin) return false;
  if (f.waysMax != null && sh.ways > f.waysMax) return false;
  if (f.anchorsMin != null && sh.anchors < f.anchorsMin) return false;
  if (f.chambersMax != null && sh.chambers > f.chambersMax) return false;
  if (f.supportMin != null && sh.support < f.supportMin) return false;
  if (f.capMin != null && sh.cap < f.capMin) return false;
  if (f.baseMin != null && sh.base < f.baseMin) return false;
  if (f.reachMin != null && sh.reach < f.reachMin) return false;
  if (f.verticalShaft != null && sh.through.z !== f.verticalShaft) return false;
  if (f.horizontalPassage != null) {
    const h = sh.through.x || sh.through.y;
    if (h !== f.horizontalPassage) return false;
  }
  if (f.usesPlans && !f.usesPlans.some((p) => F.plans.includes(p) || F.pier === p)) return false;
  if (f.excludePlans && f.excludePlans.some((p) => F.plans.includes(p) || F.pier === p)) return false;
  if (f.topPlanIn && !f.topPlanIn.includes(F.top)) return false;
  if (f.basePlanIn && !f.basePlanIn.includes(F.base)) return false;
  return true;
}

/* ------------------------------------------------------- the wall index -- */

const WALLS = ['-x', '+x', '-y', '+y'];

/**
 * Every (side, pattern) a block can present, over all four turns — its
 * SOCKETS.  Two blocks can be set side by side flush exactly when one has
 * `s|p` and the other has `OPPOSITE(s)|p`.
 *
 * Computed once per block and cached; this is the only expensive part and the
 * greedy pass consults it thousands of times.
 */
export function socketsOf(sh) {
  if (sh._sockets) return sh._sockets;
  const set = new Set();
  const own = [];
  for (let r = 0; r < 4; r++) {
    const m = turnMask(sh.mask, r);
    for (const side of SIDES) {
      const k = `${side}|${keyOf(profile(m, side))}`;
      set.add(k);
      if (!r && WALLS.includes(side)) own.push(k);
    }
  }
  sh._sockets = { set, own };
  return sh._sockets;
}

/* --------------------------------------------------------- the selector -- */

/**
 * PICK A KIT.
 *
 * Quota-driven greedy.  Roles are filled in order of scarcity — the role with
 * fewest candidates per slot goes first, or a broad role eats the only blocks a
 * narrow one could have used.  Within a role, each step takes the candidate
 * with the best marginal value:
 *
 *     quality  its own census score
 *   + join     how much interlock it adds, to itself and to blocks already in
 *   + fresh    how unlike everything already chosen it is
 *
 * Diversity is a hard constraint rather than a term: one block per plan
 * sequence, and a soft cap per plan multiset so the kit is not forty
 * rearrangements of the same three plans.
 */
export function pickKit(sheets, spec, opts = {}) {
  const W = { quality: 0.45, join: 0.40, fresh: 0.15, ...(opts.weights || {}) };
  const setCap = opts.setCap ?? 3;

  for (const sh of sheets) if (!sh.f) sh.f = featuresOf(sh);

  const kit = [];
  const takenSeq = new Set();
  const setCount = new Map();
  const present = new Map();          // socket key -> how many kit members offer it
  const unmet = [];                   // {sh, key} walls of kit members not yet met
  const usedPlan = new Map();         // plan id -> how many kit blocks use it

  const canTake = (sh) => {
    if (takenSeq.has(sh.f.seq)) return false;
    if (sh.f.set && (setCount.get(sh.f.set) || 0) >= setCap) return false;
    return true;
  };

  const add = (sh, role) => {
    sh.role = role;
    kit.push(sh);
    takenSeq.add(sh.f.seq);
    if (sh.f.set) setCount.set(sh.f.set, (setCount.get(sh.f.set) || 0) + 1);
    for (const p of sh.f.plans) usedPlan.set(p, (usedPlan.get(p) || 0) + 1);
    const S = socketsOf(sh);
    for (const k of S.set) present.set(k, (present.get(k) || 0) + 1);
    // Its own walls that nothing in the kit answers yet.
    for (const k of S.own) {
      const [side, pat] = split(k);
      if (!present.get(`${OPPOSITE[side]}|${pat}`)) unmet.push({ sh, key: `${OPPOSITE[side]}|${pat}` });
    }
    // And any wall this block has just answered.
    for (let i = unmet.length - 1; i >= 0; i--) if (S.set.has(unmet[i].key)) unmet.splice(i, 1);
  };

  /** Marginal interlock: walls of its own it can close, plus walls of others. */
  const joinGain = (sh) => {
    const S = socketsOf(sh);
    let mine = 0;
    for (const k of S.own) {
      const [side, pat] = split(k);
      if (present.get(`${OPPOSITE[side]}|${pat}`)) mine++;
    }
    let theirs = 0;
    for (const u of unmet) if (S.set.has(u.key)) theirs++;
    return (mine / 4) + Math.min(1, theirs / 4);
  };

  /** How unlike the kit so far.  Counts plans the kit is short of, so the
   *  selector reaches for the vocabulary it has not used rather than piling
   *  more of what it already has. */
  const freshness = (sh) => {
    if (!sh.f.plans.length) return 1;             // an arch is always fresh
    let f = 0;
    for (const p of sh.f.plans) f += 1 / (1 + (usedPlan.get(p) || 0));
    return f / sh.f.plans.length;
  };

  // PINS first: blocks the kit must contain whatever any score says.
  for (const r of opts.pin || []) {
    const sh = sheets.find((s) => s.recipe === r);
    if (sh && canTake(sh)) add(sh, 'pinned');
  }

  // Scarcity order.  A role with 60 candidates for 8 slots must be served
  // before one with 6,000 for 8, or the broad role takes blocks the narrow one
  // needed and the narrow one silently comes up short.
  const roles = spec.roles
    .map((role) => ({ role, pool: sheets.filter((sh) => matches(sh, role.filter)) }))
    .sort((a, b) => (a.pool.length / Math.max(1, a.role.count)) - (b.pool.length / Math.max(1, b.role.count)));

  const short = [];
  for (const { role, pool } of roles) {
    let want = role.count;
    // Anything already in for another reason counts toward this role's quota.
    for (const sh of kit) if (want > 0 && matches(sh, role.filter)) want--;
    let got = 0;
    while (got < want) {
      let best = null, bestV = -Infinity;
      for (const sh of pool) {
        if (!canTake(sh)) continue;
        const v = W.quality * sh.score + W.join * joinGain(sh) + W.fresh * freshness(sh);
        if (v > bestV) { bestV = v; best = sh; }
      }
      if (!best) break;                            // pool exhausted: report it
      add(best, role.name);
      got++;
    }
    if (got < want) short.push({ role: role.name, wanted: want, got, pool: pool.length });
  }

  // TOP UP if the roles under-filled, so the kit is the size asked for.  Never
  // silently: `short` says which role ran dry and by how much.
  const target = opts.size || spec.roles.reduce((n, r) => n + r.count, 0);
  while (kit.length < target) {
    let best = null, bestV = -Infinity;
    for (const sh of sheets) {
      if (!canTake(sh)) continue;
      const v = W.quality * sh.score + W.join * joinGain(sh) + W.fresh * freshness(sh);
      if (v > bestV) { bestV = v; best = sh; }
    }
    if (!best) break;
    add(best, 'topup');
  }

  return { kit, short };
}

const split = (k) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };

/** Can these two be set side by side with their facing walls coincident? */
export function meets(a, b) {
  const A = socketsOf(a), B = socketsOf(b);
  for (const k of A.own) {
    const [side, pat] = split(k);
    if (B.set.has(`${OPPOSITE[side]}|${pat}`)) return true;
  }
  return false;
}

/** The kit's blocks grouped into islands that cannot reach each other. */
export function componentsOf(kit) {
  const n = kit.length, seen = new Array(n).fill(-1), groups = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] >= 0) continue;
    const id = groups.length, stack = [i], mem = [];
    seen[i] = id;
    while (stack.length) {
      const a = stack.pop(); mem.push(kit[a]);
      for (let b = 0; b < n; b++) if (seen[b] < 0 && meets(kit[a], kit[b])) { seen[b] = id; stack.push(b); }
    }
    groups.push(mem);
  }
  groups.sort((a, b) => b.length - a.length);
  return { count: groups.length, groups, biggest: groups[0] ? groups[0].length : 0 };
}

/**
 * Every block that can be set beside this one, taken from the census's own
 * `serve` index rather than by testing pairs.  The full grammar graph is
 * 10,826² pairs and unusable; the index makes a neighbour lookup proportional
 * to how many blocks share a wall pattern, which is what makes the path search
 * below possible at all.
 */
export function neighboursOf(sh, serve) {
  const out = new Set();
  for (const k of socketsOf(sh).own) {
    const [side, pat] = split(k);
    const bag = serve.get(OPPOSITE[side]);
    const set = bag && bag.get(pat);
    if (set) for (const r of set) if (r !== sh.recipe) out.add(r);
  }
  return out;
}

/**
 * THE SHORTEST CHAIN OF BLOCKS joining a stranded island to the main body.
 *
 * A single bridging block often does not exist — measured, for the arches: 403
 * blocks in the grammar touch the arch island, 1,287 touch the body, and the
 * intersection is EMPTY.  That does not mean the two cannot be joined; it means
 * they cannot be joined in one step.  Breadth-first over the grammar graph
 * finds the shortest chain, and the blocks along it are what the kit is
 * missing.
 */
export function pathToBody(island, body, sheets, serve, limit = 4) {
  const byR = new Map(sheets.map((s) => [s.recipe, s]));
  const target = new Set(body.map((s) => s.recipe));
  const from = new Map();
  let frontier = [];
  for (const s of island) { from.set(s.recipe, null); frontier.push(s.recipe); }

  for (let depth = 0; depth < limit && frontier.length; depth++) {
    const next = [];
    for (const r of frontier) {
      const sh = byR.get(r);
      if (!sh) continue;
      for (const n of neighboursOf(sh, serve)) {
        if (from.has(n)) continue;
        from.set(n, r);
        if (target.has(n)) {
          // Walk back, dropping the endpoints — they are already in the kit.
          const chain = [];
          let cur = from.get(n);
          while (cur && from.get(cur) !== null) { chain.push(byR.get(cur)); cur = from.get(cur); }
          return { ok: true, chain: chain.reverse(), hops: chain.length + 1 };
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return { ok: false };
}

/**
 * MAKE THE KIT ONE THING.
 *
 * WHY THE GREEDY PASS CANNOT DO THIS ITSELF, which is the interesting part.
 * The selector rewards a candidate for answering walls that nothing in the kit
 * answers yet.  But the eleven arches were added consecutively and **they
 * answer each other** — every arch wall was met the moment the second arch went
 * in, so no arch wall ever entered the unmet list, and the selector had no
 * incentive to choose anything that could reach them.  The kit came out as an
 * 87-block body and a 13-block island of arches that could not be attached to
 * it, and every local measurement said the kit was excellent: 99 of 100 blocks
 * flush on all four walls.
 *
 * Connectivity is a GLOBAL property and no local wall-matching objective can
 * see it.  So it gets its own pass: find a block that touches both the main
 * body and a stranded island, and trade it for the least valuable block the
 * quotas can spare.
 */
export function repairConnectivity(kit, sheets, opts = {}) {
  const swaps = [];
  const pinned = new Set(opts.pin || []);
  const inKit = new Set(kit.map((s) => s.recipe));
  const seqs = new Set(kit.map((s) => s.f.seq));

  for (let pass = 0; pass < (opts.maxBridges || 12); pass++) {
    const { count, groups } = componentsOf(kit);
    if (count <= 1) break;
    const body = groups[0], island = groups[1];

    // ONE BRIDGING BLOCK IS OFTEN NOT ENOUGH, so ask for the shortest chain.
    // For the arches there is no single bridge at all — 403 blocks touch the
    // island, 1,287 touch the body, intersection empty — and a two-hop chain is
    // the real answer.
    const path = pathToBody(island, body, sheets, opts.serve, opts.maxHops || 4);
    if (!path.ok) {
      swaps.push({ stranded: island.map((s) => s.recipe), why: `nothing within ${opts.maxHops || 4} hops joins it to the body` });
      break;
    }
    const wanted = path.chain.filter((s) => s && !inKit.has(s.recipe) && !seqs.has(s.f.seq));
    if (!wanted.length) break;

    for (const add of wanted) {
      // Trade out the least valuable block the quotas can spare: never a pinned
      // one, never a member of the island, and never one whose removal strands
      // something else.
      const spare = kit
        .filter((s) => !pinned.has(s.recipe) && !island.includes(s))
        .sort(bySpareness(kit, opts.spec))
        .find((s) => componentsOf(kit.filter((x) => x !== s)).count <= count);
      if (!spare) break;
      kit.splice(kit.indexOf(spare), 1);
      inKit.delete(spare.recipe); seqs.delete(spare.f.seq);
      add.role = 'bridge';
      kit.push(add);
      inKit.add(add.recipe); seqs.add(add.f.seq);
      swaps.push({ added: add.recipe, dropped: spare.recipe, attached: island.length, hops: path.hops });
    }
  }
  return swaps;
}

/**
 * MAKE EVERY BLOCK SOMETHING YOU CAN SET DOWN.
 *
 * The horizontal pass leaves the vertical unexamined, and the vertical is the
 * binding constraint on building UPWARD. Deck joinery is far stricter than wall
 * joinery: B stands on A only if B's whole floor pattern equals A's whole
 * ceiling pattern — for stacks that means B's base plan and A's top plan must
 * be the same plan AT THE SAME TURN, with no partial credit.
 *
 * Measured on a hundred chosen for their walls: **17 of them had nothing in the
 * kit they could stand on**, and five base plans in use — bar-wide, tee,
 * quarters, bore, cross — had no matching top plan anywhere in the set, so any
 * block beginning with one could only ever sit on the ground. A 6x6x3 fill left
 * 33 cells empty, and not one of them for want of a wall.
 *
 * No per-block filter can fix this: whether a block can be set down is a fact
 * about the OTHER ninety-nine. So it gets its own pass, like connectivity.
 */
export function repairVertical(kit, sheets, opts = {}) {
  const swaps = [];
  const pinned = new Set(opts.pin || []);
  const inKit = new Set(kit.map((s) => s.recipe));
  const seqs = new Set(kit.map((s) => s.f.seq));
  const floorOf = (s) => keyOf(profile(s.mask, '-z'));
  const carries = (a, b) => socketsOf(a).set.has(`+z|${floorOf(b)}`);

  for (let pass = 0; pass < (opts.maxLifts || 14); pass++) {
    const orphans = kit.filter((s) => !kit.some((a) => a !== s && carries(a, s)));
    if (!orphans.length) break;

    // Serve the commonest orphan floor first — one added ceiling may ground
    // several blocks at once.
    const tally = new Map();
    for (const s of orphans) tally.set(floorOf(s), (tally.get(floorOf(s)) || 0) + 1);
    const want = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];

    let best = null, bestV = -Infinity;
    for (const sh of sheets) {
      if (inKit.has(sh.recipe) || seqs.has(sh.f.seq)) continue;
      if (!socketsOf(sh).set.has(`+z|${want}`)) continue;
      // IT MUST ALSO MEET THE KIT ON A WALL.  Chosen for its ceiling alone, a
      // lift block joins the kit vertically and nothing horizontally — it
      // becomes its own island and the connectivity won back a moment ago is
      // lost again. Measured: this took the kit from 1 component to 2.
      if (!kit.some((m) => meets(sh, m))) continue;
      // Prefer one that also grounds ITSELF, or the fix moves the problem up.
      const grounded = kit.some((a) => carries(a, sh)) ? 0.3 : 0;
      if (sh.score + grounded > bestV) { bestV = sh.score + grounded; best = sh; }
    }
    if (!best) { swaps.push({ stranded: tally.get(want), why: 'no block in the grammar offers that ceiling and also meets the kit' }); break; }

    const drop = kit
      .filter((s) => !pinned.has(s.recipe))
      .filter((s) => !orphans.includes(s) && s.role !== 'lift' && s.role !== 'bridge')
      .sort(bySpareness(kit, opts.spec))
      .find((s) => componentsOf(kit.filter((x) => x !== s)).count === 1);
    if (!drop) break;

    kit.splice(kit.indexOf(drop), 1);
    inKit.delete(drop.recipe); seqs.delete(drop.f.seq);
    best.role = 'lift';
    kit.push(best);
    inKit.add(best.recipe); seqs.add(best.f.seq);
    swaps.push({ added: best.recipe, dropped: drop.recipe, grounds: tally.get(want) });
  }
  return swaps;
}

/** Lower is more expendable: fillers first, then by score. */
const rankSpare = (s) => (s.role === 'topup' || s.role === 'free' ? 0 : 1) * 10 + s.score;

/**
 * How many blocks this one's role could lose and still meet its quota.
 *
 * WITHOUT THIS THE BRIDGE PASS EATS THE SCARCE ROLES.  It dropped an arch to
 * make room for a bridge — and there are only 58 arches in the grammar against
 * 10,768 stacks, the quota was five, and the kit came out with four. The most
 * expendable block by score is very often the rarest by role.
 */
function surplus(kit, spec, sh) {
  if (!spec) return 1;
  const role = spec.roles.find((r) => r.name === sh.role);
  if (!role) return 1;                       // a topup or a bridge: always spare
  return kit.filter((s) => s.role === sh.role).length - role.count;
}

/**
 * Order for giving a block up: roles with slack first, then the cheapest.
 *
 * A HARD "SURPLUS ONLY" RULE DEADLOCKS.  With one role holding the whole kit,
 * every block is exactly on quota, nothing is spare, and the repair silently
 * gives up — one block was left with nothing in the kit to stand on and the
 * pass reported success. The quota is a PREFERENCE; a kit that cannot be built
 * is worse than a kit one short of a role.
 */
const bySpareness = (kit, spec) => (a, b) => {
  const sa = surplus(kit, spec, a) > 0 ? 0 : 1;
  const sb = surplus(kit, spec, b) > 0 ? 0 : 1;
  return sa - sb || rankSpare(a) - rankSpare(b);
};

/* ------------------------------------------------------------- the audit */

/**
 * MARK THE KIT'S HOMEWORK, exactly and from scratch.
 *
 * `joinery` is the census's own function, re-run over the kit alone — so
 * `flush` here means "met by another block IN THIS KIT", which is the number
 * that decides whether a hundred blocks are a set or a shelf of strangers.
 */
export function auditKit(kit) {
  // joinery mutates, and these sheets carry their whole-grammar numbers, so
  // keep those before overwriting.
  const wide = kit.map((s) => ({ reach: s.reach, flush: s.flush, deck: s.deck, per: s.per }));
  const serve = joinery(kit);
  kit.forEach((s, i) => {
    s.kitFlush = s.flush; s.kitReach = s.reach; s.kitDeck = s.deck;
    s.reach = wide[i].reach; s.flush = wide[i].flush; s.deck = wide[i].deck; s.per = wide[i].per;
  });

  const orphans = kit.filter((s) => s.kitFlush === 0);
  const walls = serve.get('+x');

  return {
    size: kit.length,
    orphans,
    meanKitFlush: kit.reduce((n, s) => n + s.kitFlush, 0) / kit.length,
    fullyFlush: kit.filter((s) => s.kitFlush === 4).length,
    wallPatterns: walls.size,
    plans: planSpread(kit),
    families: kit.reduce((t, s) => ((t[s.family] = (t[s.family] || 0) + 1), t), {}),
    roles: kit.reduce((t, s) => ((t[s.role] = (t[s.role] || 0) + 1), t), {}),
    anchors: kit.reduce((n, s) => n + s.anchors, 0),
    chambers: kit.filter((s) => s.chambers > 0).length,
    components: connectivity(kit),
    tests: buildTests(kit),
  };
}

function planSpread(kit) {
  const t = new Map();
  for (const s of kit) for (const p of (s.f || featuresOf(s)).plans) t.set(p, (t.get(p) || 0) + 1);
  return [...t.entries()].sort((a, b) => b[1] - a[1]);
}

/** IS THE KIT ONE THING?  Blocks are nodes; an edge is "these two can be set
 *  side by side flush".  Two components is a kit that looks excellent block by
 *  block and cannot build one building. */
const connectivity = (kit) => {
  const c = componentsOf(kit);
  return { count: c.count, biggest: c.biggest, groups: c.groups.map((g) => g.length) };
};

/**
 * CAN THE KIT ACTUALLY BUILD THINGS?  Each test is a concrete structure, and
 * each is decided by the joinery data rather than by an opinion.
 */
function buildTests(kit) {
  const socket = new Map(kit.map((s) => [s.recipe, socketsOf(s)]));
  const canRun = (pred) => {
    // Two blocks passing `pred` that meet each other wall to wall — enough to
    // extend a row indefinitely.
    const pool = kit.filter(pred);
    for (const a of pool) {
      for (const b of pool) {
        for (const k of socket.get(a.recipe).own) {
          const [side, pat] = split(k);
          if (socket.get(b.recipe).set.has(`${OPPOSITE[side]}|${pat}`)) return { ok: true, a: a.recipe, b: b.recipe };
        }
      }
    }
    return { ok: false, n: pool.length };
  };
  const vertical = () => {
    for (const a of kit) {
      for (const b of kit) {
        for (let r = 0; r < 4; r++) {
          if (keyOf(profile(turnMask(b.mask, r), '-z')) === keyOf(profile(a.mask, '+z'))) {
            return { ok: true, a: a.recipe, b: b.recipe };
          }
        }
      }
    }
    return { ok: false };
  };
  return {
    'solid masonry run': canRun((s) => s.ways === 0 && s.mass > 0.85),
    'covered corridor': canRun((s) => s.through.x || s.through.y),
    'barrel vault': canRun((s) => s.family === 'arch'),
    'light wells in a row': canRun((s) => s.through.z),
    'stack one on another': vertical(),
    'a wall with anchors': canRun((s) => s.anchors > 0),
  };
}
