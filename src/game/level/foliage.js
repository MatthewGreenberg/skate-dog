// Plant generation: pure data, no rendering. Emits instance rows that
// Props.jsx bakes into InstancedMeshes.
//
// Row: [x, y, z, sx, sy, sz, ry, rx, rz, r, g, b] — a world placement plus the
// LINEAR colour that instance is tinted to. Linear because bake() divides this
// by the material's base colour (three stores that linear) to recover the
// instanceColor multiplier, and mixing spaces there is what turned every trunk
// in the park white: pushTree used to emit a 0.85-1.15 *multiplier* into slots
// the baker reads as an absolute colour, so a bark of 0.85 over C.trunk's
// linear red of 0.267 asked for an instanceColor of 3.2.
//
// Rotation slots are read by bake() in YXZ order — yaw, then tilt — so a branch
// is aimed by (tilt, yaw, 0). A foliage row is a LEAF BLADE now rather than a
// ball, so it is aimed the same way and by the same rule: the roll slot stays 0
// on every one of them, because YXZ applies Z first and a roll would swing the
// blade's own long axis off the direction it was aimed at.

import * as THREE from 'three'
import { C, LIGHT } from '../palette.js'
import { F } from '../foliageKnobs.js'

const TAU = Math.PI * 2

// The key's bearing on the ground plane. A canopy ramped by HEIGHT alone reads
// as noise from this game's 40-degree camera: every mass presents its equator,
// so the ramp resolves into concentric bands rather than into a light side and
// a dark side, and the eye reads the leftover per-clump jitter instead. Ramping
// along the sun's bearing as well is what turns a bag of green spheres into a
// lit crown — and it is free, because the colour is already per-instance and
// baked once. 0.24 is most of a ramp stop — enough that a mass has an unlit
// side, and low enough that the sunlit clumps do not all clamp to the top stop
// and read as bright blobs stamped onto a dark crown.
const SUN_H = Math.hypot(LIGHT.sunDir[0], LIGHT.sunDir[2])
const SUN_X = LIGHT.sunDir[0] / SUN_H
const SUN_Z = LIGHT.sunDir[2] / SUN_H
// 0.24 -> 0.18 with the leafMass hN rework below: the sum of the two terms is
// what was overshooting the top stop, and the height term is the one that has to
// keep its range (it is the crown's actual shading), so the directional term
// pays. Still most of a ramp stop, which is all it was ever for.
// ...and back to 0.22 with the range repaint in palette.js. The measured gap was
// that the game's lit 20% only got LIGHTER (L49 h85) where the reference's swings
// warm and saturated (L53 h71): the warm end of the ramp is the top stop, and
// the only term that can push a clump onto it is the one that knows which way
// the clump faces. leafMass's base drops 0.36 -> 0.32 to pay for it, so the sum
// still tops out at 0.996 rather than clamping (see the hN comment there).
// Live value: F.sunFace (default 0.22) — the knob owns it now, see foliageKnobs.js.

/**
 * Species tables.
 *
 * The old generator hung every clump on one Fibonacci shell around a point.
 * That gives an even, closed surface — which is exactly the problem: it is a
 * BOULDER. Real canopies are built from a handful of masses carried on
 * branches, each mass roughly spherical, with the gaps between them reading as
 * daylight. The silhouette detail then comes for free from where the masses
 * overlap, rather than having to be faked by jittering a sphere.
 *
 * So: a leaning tapered trunk, `branches` primaries aimed up and out, a leaf
 * mass at each tip, a couple of smaller masses part-way along, and only a thin
 * scatter of filler to close the middle.
 *
 * GRAIN. A clump is a LEAF BLADE (Props.jsx `leafBlade`), so a mass's outline
 * is a fan of points rather than a chain of arcs — most of what the ratio below
 * used to have to buy, the shape now carries for free. The ratio still matters
 * for a different reason: it sets how many leaves a rosette or a mass has, and
 * a mass of six blades reads as a thistle.
 *
 * A mass is only as convincing as the ratio clumpR/mass. At the old
 * 0.38/0.83 you get three clumps across a mass — the silhouette is then made of
 * half-a-dozen chords and it reads as a faceted boulder no matter how the
 * masses are arranged. The reference's clusters are nearer a SIXTH of the crown
 * they sit in, so the outline is carried by ~20 arcs. Halving clumpR costs
 * roughly 4x the count to hold the same solid angle, so massClumps goes up with
 * it; that is the price of the grain and there is no cheaper way to buy it.
 */
export const SPECIES = {
  // the reference's workhorse: broad, dense, rounded
  broadleaf: {
    trunkH: 2.5,
    trunkR: 0.17,
    lean: 0.06,
    branches: [4, 6],
    branchFrom: [0.5, 0.92], // fraction of trunk height the primaries leave at
    branchLen: [0.62, 0.98],
    branchTilt: [0.62, 1.02], // radians off vertical
    branchR: 0.085,
    mass: [0.72, 0.94], // leaf-mass radius at a branch tip
    massClumps: [78, 99], // x1.61 then x0.72, see clumpR below
    // COUNT and SIZE both moved once the crown aim went tangential (leafMass),
    // and the direction is the opposite of what it looks like. A radially-aimed
    // blade presents its TIP to the silhouette, so a handful of them fills a
    // mass; a tangential one lies ACROSS the surface and only covers its own
    // footprint, so the same 30-odd blades left the dome as lace with daylight
    // between every leaf — measured on the first capture of the tangential aim,
    // where the lawn crowns went from closed to see-through in one change. So the
    // count goes up half again and the blade comes down 0.84x with it: 48 leaves
    // at 0.23 is the reference's dense dome of mid-sized pads, where 31 at 0.275
    // is a dozen big leaves you can count. Grain ratio 0.253, solid 3.07.
    //
    // ...and that 1.28x scale-up was the regression. The last capture's crowns
    // were see-through — lawn read straight through the middle tree — with
    // single oversized cards floating clear of the silhouette, because a card's
    // LENGTH (2.47 x its row radius) had reached ~1/3 of the crown radius where
    // the reference's is ~1/6: a dome made of 40 big paddles stuck on a stick.
    //
    // The fix is both levers at once, and the direction of each matters. Card
    // radius x0.79 (length 0.56 -> 0.44) fixes the grain and the detached
    // leaves; count x1.6 and mass x0.92 buy the OPACITY back, because coverage
    // goes as n*r^2 / mass^2 and the radius cut alone would have taken it down
    // 38%. Net: n*r^2 held at 2.46 (was 2.48) over a cross-section 15% smaller,
    // so the dome is ~18% denser at a fifth the card size. The 60% more
    // instances are paid for by PROFILE dropping a station in Props.jsx
    // (72 tris a blade, was 84). Grain ratio 0.216, solid 3.6.
    //
    // ...and both levers move again with CROWN_LEAF (Props.jsx). The crown blade
    // is no longer the bed's pad: W 0.532 -> 0.32 and the profile's mean-to-max
    // 0.752 -> 0.665, so a crown blade lays 0.53x the plan area of the one these
    // counts were solved against. "Trees really bad, make the tree leaves
    // thinner" is the whole brief, and thinner must not open the dome, so the
    // area comes back on the two levers that do not undo it:
    //   clumpR x1.08 — LONGER, not wider. A longer narrow blade is more
    //     leaf-like, not less, so this one is free in the read (area x1.166).
    //   massClumps x1.61 — the rest.
    // Net n*w*l per mass: 1.61 * 1.166 * 0.532 = 0.999, i.e. coverage held to
    // within a percent while every blade is 40% narrower. Grain ratio 0.234
    // (limit 0.32), solid 6.7.
    //
    // ...and then a straight PERFORMANCE trim, the one move in this history
    // that is not about the read. The park was drawing 122k crown rows at 60
    // tris = 7.3M triangles, ~80% of all foliage. Two levers, applied to all
    // three species: massClumps x0.72 and clumpR x1.18, which holds coverage
    // (n*r^2: 0.72 * 1.392 = 1.002) because the blade is a fixed shape scaled by
    // r — the SAME trade the x1.61/x1.08 pass above made, run backwards. Crown
    // rows 122k -> 88k; with CROWN_LEAF down to 32 tris (Props.jsx) that is
    // 2.8M, a 2.6x cut. The cost is a coarser dome: clumpR is now 1.27x its
    // pre-thinning value, so if the crowns start reading as faceted boulders
    // again this is the number that did it — take it back and pay in count.
    clumpR: [0.186, 0.271],
    fill: [5, 8],
    core: 1.15, // see pushTree: the mass that closes the dome over the fork
    crownLift: 0.35, // masses ride this much above the branch tip
    leaf: [C.leafDark, C.leaf, C.leafLight],
    // Every species blossoms now. The reference's tree crown is speckled with
    // pink five-petal daisies, and both lawn trees and the planter tree draw
    // their species at random — so pinning bloom to `blossom` alone meant a
    // planter tree carried none about two thirds of the time, which is what the
    // last capture showed.
    // `per` is blooms per LEAF ROW and the row count went up 1.6x with the
    // density rebalance above, so every species' `per` is divided back out —
    // otherwise a crown wears 60% more blossom for a change that was about
    // opacity. 0.03 -> 0.019 holds the speckle where the last capture had it.
    // /1.45 with the x1.61 count above — a slight NET rise in absolute speckle
    // (+11%), because a 40% narrower leaf hides less of the head it sits on and
    // the reference's crown speckle is meant to be countable.
    bloom: { tint: 'flowerPink', per: 0.0182 }, // /0.72 with the perf trim
  },
  // taller, narrower, fewer masses — breaks up a row of identical crowns
  slim: {
    trunkH: 3.4,
    trunkR: 0.13,
    lean: 0.09,
    branches: [3, 5],
    branchFrom: [0.58, 0.95],
    branchLen: [0.5, 0.8],
    branchTilt: [0.45, 0.82],
    branchR: 0.07,
    // same rebalance as broadleaf: card x0.79, count x1.6, mass x0.92
    // ...then the CROWN_LEAF thinning: clumpR x1.08, massClumps x1.61
    mass: [0.61, 0.81],
    massClumps: [67, 84],
    clumpR: [0.160, 0.242],
    fill: [4, 6],
    core: 0.98,
    crownLift: 0.42,
    leaf: [C.leafDark, C.shrub, C.leafLight],
    bloom: { tint: 'flowerPink', per: 0.0172 }, // /1.45 then /0.72, see broadleaf
  },
  // low and wide with a warmer crown, for the plaza planters
  blossom: {
    trunkH: 2.0,
    trunkR: 0.15,
    lean: 0.1,
    branches: [4, 6],
    branchFrom: [0.45, 0.9],
    branchLen: [0.58, 0.92],
    branchTilt: [0.75, 1.15],
    branchR: 0.08,
    // same rebalance as broadleaf: card x0.79, count x1.6, mass x0.92
    // ...then the CROWN_LEAF thinning: clumpR x1.08, massClumps x1.61
    mass: [0.68, 0.89],
    massClumps: [78, 96],
    clumpR: [0.181, 0.261],
    fill: [6, 9],
    // The biggest core of the three, and it is the planter tree's whole fix:
    // the last capture's bed tree was a loose CONE with the trunk visible
    // straight up the middle and paving showing between the masses. The
    // reference crown is a closed oblate dome, wider than tall — leafMass
    // squashes its own y by 0.82, so one core of this radius over the fork
    // renders 1.22 wide for 1 tall on its own.
    core: 1.3,
    crownLift: 0.28,
    // A warmer cap than the other two species, but only by hue: the old
    // '#b0ac5c' was L52 against the canopy's L36 top stop, so a blossom tree in
    // a grove of broadleaf read as sun-bleached — one dead-looking tree in
    // every line of healthy ones.
    // Moved with the chroma repaint in palette.js: at s45 this stop was the one
    // desaturated green left in the park and a blossom tree read as dusty next
    // to a broadleaf. h68 s70 L61 — still the warmest cap of the three species,
    // now by hue alone as intended.
    leaf: [C.leafDark, C.leaf, '#dee949'],
    // the reference's flowering tree. `per` is blooms per LEAF ROW, so it
    // scales with the crown a seed happens to grow rather than with a count.
    // Both numbers up (was 0.035 / 0.05-0.08): the reference's crown speckle is
    // a flower you can count the petals on, and at 0.05-0.08 radius one of these
    // covered ~3px at chase distance and vanished into the leaf entirely.
    bloom: { tint: 'flowerPink', per: 0.0325 }, // /1.45 then /0.72, see broadleaf
  },
}

const SPECIES_KEYS = Object.keys(SPECIES)

// Kept as the default species so existing importers (and foliage.check.js)
// keep working against the same field names.
export const TREE = SPECIES.broadleaf

export const BUSH = { rx: 0.62, ry: 0.34, y: 0.3, lobes: [3, 5] }

// Canopy ramp: shaded underside -> mid -> sunlit top, applied as an absolute
// per-instance colour so the gradient is continuous, not three discrete greens.
//
// The shaded end is leafDark LIFTED a third of the way to the mid. Raw leafDark
// is L18, and an interior clump then took another -0.11 from `deep` and landed
// near L07 — near-black grit scattered through every crown, and the one thing
// in the grove capture that read as procedural rather than painted. The
// reference's darkest canopy pixel is a dark GREEN; it never reaches black,
// because a leaf in shadow is still lit by the violet sky (SHADOW_TRANSFER
// bottoms out at 0.62, not 0). Same lift on the shrub ramp for the beds.
// 0.16 -> 0.10 -> 0.04. The argument above is unchanged and still binding — but it was
// written when leafDark was L18, and the chroma repaint took it to L25, so the
// lift no longer has to do as much work to stay off black. What it costs is
// range: the bed's rendered green spans L0.27-0.47 for 93% of its pixels where
// the reference spans 0.12-0.62, and the reference's own darkest bed pixels are
// 4% at L0.12 — a real dark green, which is what a valley between two rosettes
// looks like. Do not take this to 0; leafDark plus `deep` still bottoms out.
// The last capture still measured its dark 20% at L0.25 against the reference's
// L0.18, so the lift pays again: C.leafDark itself went L25 -> L20 in the same
// pass, which is 5 of the 7 points, and 0.10 -> 0.04 of lift is the other 2. The
// floor is now leafDark(L20) lifted 4% toward L45, i.e. L21 before `deep` — a
// real dark green, still nowhere near black.
// Live value: F.shadeLift (default 0.04) — the knob owns it now, see foliageKnobs.js.
// ...and the BED's floor is now a SEPARATE number, because the two ends were
// measured separately and disagreed. The crown's shaded end is on target (game
// L34 median, dark tail matching the reference), but the bed's dark 10% sits at
// L24 against a reference bed that never drops below a real mid-green — and
// with the rosette splay opened to 45-75 degrees below, the wedges BETWEEN
// neighbouring plants are the bed's dominant dark signal rather than an
// interior-clump artefact. At 0.04 those wedges render as near-black and the
// bed reads as a spiky black-and-lime pattern at chase distance instead of as
// plants with shadow between them. 0.24 lifts leafDark's L20 a quarter of the
// way to shrub's L45, i.e. ~L26 before `deep` — +5, which is the measured gap.
// Live value: F.bedLift (default 0.24) — the knob owns it now, see foliageKnobs.js.
// Derived stops, recomputed from the live knobs by refreshStops() at the top of
// every push* entry point rather than frozen at module load. A generation is
// ~5 Color writes per plant against thousands of rows, and it is the only way a
// leva colour can reach art that is baked once into an InstancedMesh.
const LEAF_MID = new THREE.Color()
const LEAF_LOW = new THREE.Color()
export const LEAF_TOP = new THREE.Color()
export const SHRUB_TOP = new THREE.Color()
export const SHRUB_LOW = new THREE.Color()
const BARK = new THREE.Color(C.trunk)

// The authored triples, snapshotted before any knob can touch them. A species
// stop that is NOT one of the four palette greens is deliberate (see `tall`'s
// hot '#dee949' top) and must survive a colour knob; matching against this
// snapshot is what tells the two cases apart without a second flag to keep in
// sync.
const SPECIES_LEAF0 = Object.fromEntries(SPECIES_KEYS.map((k) => [k, [...SPECIES[k].leaf]]))
const PALETTE_KEY = { [C.leafDark]: 'leafDark', [C.leaf]: 'leaf', [C.leafLight]: 'leafLight', [C.shrub]: 'shrub' }

/**
 * Pull the leaf ramp out of the live knobs. SPECIES' own `leaf` triples are
 * rewritten too, because pushTree reads them as strings per call.
 */
function refreshStops() {
  LEAF_MID.set(F.leaf)
  LEAF_LOW.set(F.leafDark).lerp(LEAF_MID, F.shadeLift)
  LEAF_TOP.set(F.leafLight)
  SHRUB_TOP.set(F.shrub)
  SHRUB_LOW.set(F.leafDark).lerp(SHRUB_TOP, F.bedLift)
  for (const k of SPECIES_KEYS) {
    const orig = SPECIES_LEAF0[k]
    for (let i = 0; i < 3; i++) {
      const slot = PALETTE_KEY[orig[i]]
      SPECIES[k].leaf[i] = slot ? F[slot] : orig[i]
    }
  }
}
const _leaf = new THREE.Color()

const lerp = (a, b, t) => a + (b - a) * t
const pick = (rnd, [a, b]) => lerp(a, b, rnd())
const picki = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1))

/** hN 0 = underside, 1 = top of the crown. `deep` darkens interior clumps. */
function leafColor(hN, deep, rnd, low, mid, top) {
  const h = hN < 0 ? 0 : hN > 1 ? 1 : hN // the directional term overshoots both ends
  if (h < 0.5) _leaf.copy(low).lerp(mid, h * 2)
  else _leaf.copy(mid).lerp(top, (h - 0.5) * 2)
  // Saturation jitter is deliberately tight: the reference holds 38-43% from
  // core to crown, so a +/-0.09 swing was pushing a fifth of the canopy outside
  // the band the whole art direction is measured in.
  //
  // The lightness jitter is tight for the same reason one step down: it is
  // per-CLUMP, so it is the highest frequency signal in the canopy and reads as
  // grain, not as shading. The ramp is what should carry the value — jitter
  // only has to stop neighbouring clumps from looking stamped. `deep` likewise
  // came down from 0.11: the light side of a mass now comes from the sun term
  // below, so darkening the interior no longer has to do that job alone.
  return _leaf.offsetHSL(
    (rnd() - 0.5) * 0.03,
    (rnd() - 0.5) * 0.05,
    (rnd() - 0.5) * 0.032 - deep * 0.05,
  )
}

// `crown` is a SECOND leaf bucket, and the split is the whole point of it: a
// tree leaf and a bed leaf are no longer the same blade. Props.jsx bakes
// `foliage` with LEAF (the bed's fleshy succulent pad, blunt at the tip) and
// `crown` with CROWN_LEAF (narrow, tapering to a real point). Same material, so
// it costs one extra draw call and nothing else.
//
// The bed was signed off as-is and the tree crowns were not — "bushes look good,
// trees really bad, make the tree leaves thinner" — so unifying the two shapes
// is the one thing that cannot happen here. A shared W is a shared verdict.
export const newBuckets = () => ({
  trunk: [],
  branch: [],
  foliage: [],
  crown: [],
  flowerWhite: [],
  flowerPink: [],
  flowerYellow: [],
})

/**
 * A foliage instance is a LEAF BLADE (Props.jsx `leafBlade`), so it has a
 * direction: `aim` is the outward vector of the rosette or mass it belongs to,
 * jittered by `spray` radians so no two neighbours are stamped from the same
 * die. With no aim it splays up and out at random, which is what a filler clump
 * buried inside a crown wants.
 *
 * Only slots 6/7 carry the aim. bake() reads the rotation in YXZ, which applies
 * the Z term FIRST — a roll there would swing the blade's own long axis off the
 * direction we just solved for, exactly as it would a branch.
 */
export function clump(
  b, x, y, z, rad, hN, deep, rnd,
  low = LEAF_LOW, mid = LEAF_MID, top = LEAF_TOP,
  aim = null, spray = 0.5, key = 'foliage',
) {
  const col = leafColor(hN, deep, rnd, low, mid, top)
  let ax, ay, az
  if (aim) {
    ;[ax, ay, az] = aim
  } else {
    const a = rnd() * TAU
    ax = Math.cos(a)
    ay = 0.9
    az = Math.sin(a)
  }
  const m = Math.hypot(ax, ay, az) || 1
  // jitter in the plane, then renormalise — a cone about the aim
  const j = rnd() * TAU
  const s = spray * rnd()
  ax = ax / m + Math.cos(j) * s
  ay = ay / m + (rnd() - 0.4) * s
  az = az / m + Math.sin(j) * s
  const n = Math.hypot(ax, ay, az) || 1
  b[key].push([
    x,
    y,
    z,
    rad,
    rad * (0.82 + rnd() * 0.3),
    rad,
    Math.atan2(ax, az),
    Math.acos(Math.min(1, Math.max(-1, ay / n))),
    0,
    col.r,
    col.g,
    col.b,
  ])
}

/**
 * A woody segment from `p` toward `dir` (unit) of length `len`.
 * The geometry is a unit cylinder anchored at its base, so scale is
 * (radius, length, radius) and the aim is two Euler terms in YXZ.
 */
function woody(bucket, px, py, pz, dx, dy, dz, len, rad, rnd) {
  const tilt = Math.acos(Math.min(1, Math.max(-1, dy)))
  const yaw = Math.atan2(dx, dz)
  // bark varies per segment but stays a plausible member of one tree
  const v = 0.86 + rnd() * 0.28
  bucket.push([
    px, py, pz,
    rad, len, rad,
    yaw, tilt, 0,
    BARK.r * v, BARK.g * v * 0.99, BARK.b * v * 0.96,
  ])
}

/** A roughly spherical mass of leaf clumps — one "puff" of canopy. */
function leafMass(b, cx, cy, cz, rad, n, sp, rnd, low, mid, top) {
  for (let i = 0; i < n; i++) {
    // random point in a slightly oblate ball, denser toward the middle
    const u = rnd() * TAU
    const v = Math.acos(2 * rnd() - 1)
    const q = Math.cbrt(rnd()) * 0.85 + 0.15
    const ox = Math.sin(v) * Math.cos(u) * rad * q
    const oy = Math.cos(v) * rad * q * 0.82
    const oz = Math.sin(v) * Math.sin(u) * rad * q
    // outer clumps are smaller: the silhouette is read at the edge, and big
    // clumps out there are what made the old crowns read as faceted rock
    const edge = q
    const r = pick(rnd, sp.clumpR) * (1.25 - edge * 0.55)
    // Centre the height ramp at 0.42, not 0.5. Only the cap of a mass sees open
    // sky; the equator is already half-buried in its neighbours. A symmetric
    // ramp put the canopy's MODE on the midtone, which is 8 lightness points
    // above where the reference's mode actually sits.
    // ...plus which way the clump faces relative to the key (SUN_FACE above).
    const face = (ox * SUN_X + oz * SUN_Z) / rad

    // AIM. A blade aimed along the mass's own outward radial is a QUILL, and a
    // dome of them is a pin-cushion: the last capture's crowns ended in a ring
    // of blunt ends pointing radially out of the silhouette, which is the
    // bottlebrush read. A real leaf lies ACROSS the surface it grows on — the
    // reference's dome edge is a scallop of overlapping leaf TIPS lying
    // tangentially with a slight downward hang, not a bristle field.
    //
    // So: build a tangent frame on the radial, swing the aim 55-70 degrees off
    // the normal into it (mostly tangential, still enough radial that the blade
    // clears its neighbours), and hang the tip ~15 degrees down.
    const nl = Math.hypot(ox, oy, oz) || 1
    const nx = ox / nl
    const ny = oy / nl
    const nz = oz / nl
    // first tangent: the radial crossed with world up, so it is horizontal.
    // Degenerate only when the radial IS up, where any horizontal will do.
    let ux = -nz
    let uz = nx
    const ul = Math.hypot(ux, uz) || 1
    ux /= ul
    uz /= ul
    // second tangent = n x u (u is horizontal, so this is the up-slope one)
    const vx = -ny * uz
    const vy = nz * ux - nx * uz
    const vz = ny * ux
    const phi = rnd() * TAU
    const cp = Math.cos(phi)
    const sp2 = Math.sin(phi)
    const th = 0.96 + rnd() * 0.26 // 55-70 degrees off the surface normal
    const ct = Math.cos(th)
    const st = Math.sin(th)
    // ...and the hang RAMPS WITH `edge`, which is the "make them look like
    // leaves that hang down" pass. A flat 0.26 is ~15 degrees, and 15 degrees
    // off tangential is a tuft: at chase distance the dome's rim read as a
    // horizontal fringe with no drop, because the only blades whose tips clear
    // the silhouette are the outer ones and those were the ones lying flattest.
    // Interior blades keep the shallow hang (they are fill — droop them and
    // they just point at the trunk), the rim gets 0.26 + 0.62 = 0.88 against a
    // roughly unit horizontal, i.e. ~41 degrees of pendulous droop, which is
    // what puts a visible leaf TIP under every crown edge.
    const hang = 0.26 + edge * 0.62
    let ax = nx * ct + (ux * cp + vx * sp2) * st
    let ay = ny * ct + (vy * sp2) * st - hang
    let az = nz * ct + (uz * cp + vz * sp2) * st
    // ...but a blade on the crown's UNDERSIDE hangs its tip a full length below
    // the row foliage.check measures the crown floor from (that check reads the
    // row's centre and radius — it cannot see an aim), and at the tree scales
    // levelData emits that is the crown touching the ground. Ease the aim back
    // toward level past the knee rather than clamping it flat, so the outer
    // skirt still droops and the interior does not. The knee moved -0.2 -> -0.75
    // with the ramp above: at -0.2 it caught nearly every rim blade and squashed
    // the droop straight back out, which is the change undoing itself.
    if (ay < -0.75) ay = -0.75 + (ay + 0.75) * 0.3

    clump(
      b,
      cx + ox,
      cy + oy,
      cz + oz,
      r,
      // hN must not be able to CLAMP. 0.38 + oy/(rad*1.5) + face*0.24 peaked at
      // 1.17, and everything over 1 piles onto the top stop: a crown measured a
      // 17%-of-all-green spike at L0.57 with a median of 0.41, i.e. bimodal,
      // where the reference's crown is smooth with its MODE (0.38) below its
      // median. A clamped population reads as bright blobs stamped on the dome —
      // the exact failure SUN_FACE's own comment warns about, arrived at from
      // the height term instead. 0.32 + 0.456 + 0.22 tops out at 0.996.
      0.32 + oy / (rad * 1.8) + face * F.sunFace,
      1 - edge,
      rnd,
      low, mid, top,
      [ax, ay, az],
      // A tangential blade already carries its bearing from the tangent frame
      // above, so the cone only has to break the regularity. At the old 0.5 it
      // was wide enough to put a third of them back on the radial, which is the
      // bristle the aim exists to remove.
      //
      // RAMPED DOWN at the rim (0.34 in the middle, 0.24 at edge 1). The cone is
      // a jitter about the aim, so at the silhouette it is also the only thing
      // that can throw a blade PAST the crown envelope — and the last capture of
      // the thin blade had 4-5 single leaves floating clear off the big lawn
      // tree's upper right, against the lawn. A fat pad out there still read as
      // foliage; a 40%-narrower one reads as debris, so the same jitter that was
      // tolerable before is not now. Only the outer third moves: the interior
      // keeps the full cone, where a stray cannot escape anything.
      0.34 - edge * 0.1,
      'crown',
    )
  }
}

/** `rnd` is the plant's own stream, so the table is a species, not a stamp. */
export function pushTree(b, x, y, z, s, r, rnd, speciesName) {
  refreshStops()
  const sp = SPECIES[speciesName] || SPECIES[SPECIES_KEYS[Math.floor(rnd() * SPECIES_KEYS.length)]]
  const low = new THREE.Color(sp.leaf[0])
  const mid = new THREE.Color(sp.leaf[1])
  const top = new THREE.Color(sp.leaf[2])

  const f0 = b.crown.length // where this tree's own leaf rows start (blossom, below)
  const th = sp.trunkH * s * (0.88 + rnd() * 0.3)
  // a lean, so a row of trees never reads as a row of posts
  const leanA = rnd() * TAU
  const lean = sp.lean * (0.4 + rnd())
  const lx = Math.sin(leanA) * lean
  const lz = Math.cos(leanA) * lean
  const dyT = Math.sqrt(Math.max(0.01, 1 - lx * lx - lz * lz))

  woody(b.trunk, x, y, z, lx, dyT, lz, th, sp.trunkR * s, rnd)

  // where the trunk actually ends up, so branches leave from the wood
  const topX = x + lx * th
  const topZ = z + lz * th
  const topY = y + dyT * th

  const nB = picki(rnd, sp.branches)
  const spin = r
  let lowestMass = Infinity
  let highestMass = -Infinity
  let lowestFork = Infinity // where the lowest primary leaves the trunk

  for (let i = 0; i < nB; i++) {
    // spread the primaries around, with enough jitter that opposite branches
    // never pair up into a Y
    const yaw = spin + (i / nB) * TAU + (rnd() - 0.5) * 0.9
    const tilt = pick(rnd, sp.branchTilt)
    const f = pick(rnd, sp.branchFrom)
    const bx = x + lx * th * f
    const bz = z + lz * th * f
    const by = y + dyT * th * f
    const len = pick(rnd, sp.branchLen) * s
    lowestFork = Math.min(lowestFork, by)

    const dx = Math.sin(tilt) * Math.sin(yaw)
    const dy = Math.cos(tilt)
    const dz = Math.sin(tilt) * Math.cos(yaw)
    woody(b.branch, bx, by, bz, dx, dy, dz, len, sp.branchR * s, rnd)

    // Leaf mass at the tip, lifted a little so it sits ON the branch — and
    // pulled 12% back DOWN the shaft. Centred on the tip, a mass puts its outer
    // clumps a full radius beyond any wood, and at this game's camera the ones
    // that clear the crown's silhouette read as detached specks floating off the
    // side of the tree (the last capture had several, all on the same side of
    // each lawn tree — the side facing the key, so they were the lit ones).
    // At 0.88 the branch END is buried in the mass instead of poking out of it.
    const TIP_IN = 0.88
    const tipX = bx + dx * len * TIP_IN
    const tipY = by + dy * len * TIP_IN + sp.crownLift * s
    const tipZ = bz + dz * len * TIP_IN
    const mr = pick(rnd, sp.mass) * s
    leafMass(b, tipX, tipY, tipZ, mr, picki(rnd, sp.massClumps), sp, rnd, low, mid, top)
    lowestMass = Math.min(lowestMass, tipY - mr)
    highestMass = Math.max(highestMass, tipY + mr)

    // A SECOND mass half way along the shaft. Hanging one ball on each tip
    // leaves the inner half of every branch bare, and a canopy with bare sticks
    // radiating out of it is worse than the boulder it replaced — the first
    // render of this generator was a hedgehog. The check now samples along the
    // shaft rather than only at the tip, which is the invariant that was
    // actually wanted.
    const midT = 0.42 + rnd() * 0.18
    const midR = mr * (0.66 + rnd() * 0.2)
    leafMass(
      b,
      bx + dx * len * midT,
      by + dy * len * midT + sp.crownLift * s * 0.5,
      bz + dz * len * midT,
      midR,
      Math.max(4, picki(rnd, sp.massClumps) - 3),
      sp, rnd, low, mid, top,
    )
    lowestMass = Math.min(lowestMass, by + dy * len * midT - midR)

    // a shorter secondary on about half the primaries, carrying a small mass —
    // this is most of what stops the crown reading as N discrete balls
    if (rnd() < 0.55) {
      const g = 0.45 + rnd() * 0.3
      const sx2 = bx + dx * len * g
      const sy2 = by + dy * len * g
      const sz2 = bz + dz * len * g
      const yaw2 = yaw + (rnd() - 0.5) * 1.8
      const tilt2 = Math.max(0.15, tilt - 0.3 - rnd() * 0.25)
      const l2 = len * (0.45 + rnd() * 0.3)
      const d2x = Math.sin(tilt2) * Math.sin(yaw2)
      const d2y = Math.cos(tilt2)
      const d2z = Math.sin(tilt2) * Math.cos(yaw2)
      woody(b.branch, sx2, sy2, sz2, d2x, d2y, d2z, l2, sp.branchR * s * 0.72, rnd)
      const mr2 = mr * (0.6 + rnd() * 0.25)
      leafMass(
        b,
        sx2 + d2x * l2, sy2 + d2y * l2 + sp.crownLift * s * 0.7, sz2 + d2z * l2,
        mr2, Math.max(4, picki(rnd, sp.massClumps) - 3), sp, rnd, low, mid, top,
      )
      lowestMass = Math.min(lowestMass, sy2 + d2y * l2 - mr2)
      highestMass = Math.max(highestMass, sy2 + d2y * l2 + mr2)
    }
  }

  // Filler over the crown's own centre: without it you can see the sky straight
  // through the middle of the tree from directly above, which this game's
  // camera angle does constantly.
  const cy = (lowestMass + highestMass) / 2

  // CORE. A crown is a DOME, not N balls on sticks. Every mass here hangs off a
  // branch, so the middle of the tree — the cone of air directly over the fork —
  // was only ever closed by `fill`, a handful of stray clumps, and from this
  // game's 40-degree camera you could see paving and trunk straight up through
  // it. That is the "loose cone, trunk visible through the crown" read. One mass
  // centred on the crown's own centre closes it, and it costs about what raising
  // every branch mass by a quarter would have cost while also filling the one
  // place a branch mass cannot reach. leafMass squashes y by 0.82 on its own, so
  // the core renders 1.22 wide for 1 tall — the reference's oblate dome.
  if (sp.core) {
    const cr = sp.core * s
    leafMass(
      b, topX, cy + cr * 0.12, topZ, cr,
      Math.round(picki(rnd, sp.massClumps) * 1.4),
      sp, rnd, low, mid, top,
    )
  }

  const nF = picki(rnd, sp.fill)
  for (let i = 0; i < nF; i++) {
    const a = rnd() * TAU
    const rr = rnd() * sp.mass[0] * s * 0.8
    clump(
      b,
      topX + Math.cos(a) * rr,
      cy + (rnd() - 0.35) * 0.5 * s,
      topZ + Math.sin(a) * rr,
      pick(rnd, sp.clumpR) * s * 1.15,
      0.4 + rnd() * 0.3,
      1,
      rnd,
      low, mid, top,
      [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], // filler caps the crown: face up
      0.8,
      'crown',
    )
  }

  // Collar around the fork. Every mass hangs off a branch tip, so on a seed
  // where all the primaries leave steeply the whole crown can end up ABOVE the
  // trunk top and the tree renders as a canopy floating over a bare pole —
  // foliage.check.js catches exactly this. The collar also matches the
  // reference, where leaf gathers where the branches part rather than leaving
  // the fork bare.
  const nC = 3 + Math.floor(rnd() * 3)
  const collarY = lerp(lowestFork, topY, 0.35)
  for (let i = 0; i < nC; i++) {
    const a = spin + (i / nC) * TAU + rnd() * 0.7
    const rr = (0.15 + rnd() * 0.5) * sp.mass[0] * s
    clump(
      b,
      topX + Math.cos(a) * rr,
      collarY + (rnd() - 0.3) * 0.35 * s,
      topZ + Math.sin(a) * rr,
      pick(rnd, sp.clumpR) * s * (0.9 + rnd() * 0.35),
      0.18 + rnd() * 0.2, // low in the crown: the shaded underside colour
      0.85,
      rnd,
      low, mid, top,
      [Math.cos(a), 0.35, Math.sin(a)], // the collar skirts out of the fork
      0.5,
      'crown',
    )
  }

  // The reference's flowering tree wears its blossom as a speckle over the
  // canopy rather than as clusters in it. Sampling the rows this tree just
  // emitted is what guarantees a bloom sits ON a leaf — solving a crown radius
  // and scattering over the sphere puts a third of them in mid-air, because a
  // crown built from masses is not a sphere.
  if (sp.bloom) {
    const n = b.crown.length - f0
    const count = Math.round(n * sp.bloom.per)
    for (let i = 0; i < count; i++) {
      const e = b.crown[f0 + Math.floor(rnd() * n)]
      // follows the card down (x0.79): a blossom is measured against the leaf
      // it sits on, and holding it fixed while the leaf shrank would have made
      // the crown speckle read as fruit
      const r = (0.062 + rnd() * 0.033) * s
      b[sp.bloom.tint].push([e[0], e[1] + e[3] * 0.7, e[2], r, r, r, 0])
    }
  }
}

/**
 * Shrubs as a few overlapping lobes rather than one shell — same reasoning as
 * the canopy, at a tenth the size. A single shell of clumps reads as a ball;
 * three lobes read as a plant.
 */
/**
 * Fills a rectangular planter bed edge to edge.
 *
 * The old fill scattered `area * 3.4` clumps of radius 0.26-0.46 at a fixed
 * half-buried height, and every capture showed dark soil between them: at that
 * radius a clump covers ~0.35 m2, so 3.4/m2 only ever closed about half the
 * plan area even before the gaps between rows. The reference never shows soil —
 * a bed is a continuous MOUND that crests in the middle and spills over the
 * inner lip.
 *
 * So: cover to a target fraction of the bed area (`fill`), size the clumps to
 * the same grain as a canopy cluster rather than to the bed, and put the height
 * on a radial falloff so the profile is domed. `over` lets clumps sit slightly
 * outside the inner rectangle so the stone rail is what hides the last of the
 * soil, not luck.
 */
export function pushBed(b, x, y, z, w, d, rnd, s = 1, opt = {}) {
  refreshStops()
  // `bodyF` is gone: the body is no longer a density, it is a GRID PITCH (below),
  // which is the whole point of the rosette rework — a count cannot express
  // "leave a gap between neighbours".
  const { fill: fill0 = 1, rise = 0.34, dome = 0.4, over = 0.16, hole = 0, fineF = 1.35, gap = 2.9 } = opt
  // bare fraction goes as exp(-fill), so the knob is a multiplier on the
  // authored per-bed value rather than a replacement for it
  const fill = fill0 * F.bedFill
  const hw = w / 2 + over
  const hd = d / 2 + over
  const area = hw * hd * 4
  // Rosette centres, returned so pushBlooms can seat a flower ON a plant rather
  // than in the gap between two. The reference's yellow knots ring the middle of
  // a rosette and sit in its axils; a uniform scatter over the bed rectangle put
  // most of them in exactly the shadow valleys the grid exists to open, where
  // they read as litter dropped on the soil.
  const sites = []

  // TWO layers, and the split is not decoration. A uniform scatter leaves
  // exp(-f) of the plan bare, so closing a bed with 0.1 m clumps alone wants
  // f ~ 4.6 — thousands of instances per planter, and 15 planters of that is
  // several times the whole canopy. Coarse clumps buy area ~5x cheaper per
  // instance, fine clumps buy grain; the residual bare fraction is the PRODUCT
  // of the two layers' holes, so a heavy body under a light grain closes to
  // ~2% at a third of the cost, and what is left is leaf-sized speckle rather
  // than a visible patch of soil.
  // A bed's body is a field of ROSETTES, not of loose blades. The reference's
  // ground cover is made of countable little stars — you can find the centre of
  // each plant, and there is a dark valley between it and the next one — and a
  // scatter of independently-aimed blades at the same density reads as a bristle
  // mat instead, which is what made the beds look like AstroTurf.
  //
  // The rosettes were already here and the bed still read as chopped foliage,
  // because the CENTRES were a Poisson scatter: at the density that closes the
  // plan, two centres land 0.2 radii apart about as often as 1.5, so a third of
  // the stars fuse into their neighbours and no gap survives anywhere. The
  // readability in the reference comes from the GAPS, not from the blades.
  //
  // So the body is a JITTERED GRID, pitch `gap` x a rosette's plan reach. A
  // square grid of discs of radius R closes on its own at pitch 1.41R; `gap` is
  // PAST that on purpose, and it went 1.66 -> 2.9 this round. The bed is not
  // supposed to close. The reference's own bed shows soil-dark wedges between
  // neighbouring plants — that is what lets you count them — so the plan target
  // came down from "solid" to ~92% mean / 87% worst, measured across the 60 bed
  // sizes foliage.check emits (2.0 -> 99.9/99.5, 2.3 -> 97.9/94.6, 2.6 ->
  // 95.9/92.7, 2.9 -> 91.6/86.7, 3.2 -> 89.2/83.5 and the soil starts showing as
  // patches rather than wedges). That is 40% fewer plants than the closed bed,
  // and each one is 0.69m across on a 0.77m pitch, so there is a real gap
  // between neighbouring rosettes rather than a shingle.
  // Jitter is deliberately small (+/-9% of pitch): more of it
  // and the grid stops being a spacing rule and becomes a scatter again, which
  // is the thing being fixed.
  // ROSETTE, OFF_R and the splay below all moved together and they are ONE
  // change: make a plant countable. The last capture measured the bed's blades
  // at 20-35 degrees off vertical, uniformly packed — a continuous upright
  // thicket with no visible rosette centre anywhere and no shadow gap between
  // neighbours, so you cannot count a single plant at any zoom. The reference is
  // unmistakably a field of discrete STARS: 8-12 blades radiating from one small
  // VISIBLE centre, many of them splayed near horizontal, with dark soil-shadow
  // wedges between plants.
  //
  // The 2024 pull the other way (60-80 degrees -> 30-55) was right about its
  // symptom and wrong about its cause: the blades were bridging the gaps because
  // the PLANTS were twice the reference's size relative to the bed, not because
  // they were splayed. So the splay goes back out wide and the size comes down
  // instead — RB x0.79 on top of the earlier 0.75x, which is the same 0.79 the
  // canopy card took, so a bed leaf and a tree leaf stay one plant family.
  //
  // OFF_R 0.4 -> 0.14: the blades leave ONE shared origin. At 0.4 each blade's
  // base was pushed a third of a radius out along its own bearing, so a rosette
  // had a hole where its centre should be and read as a ring of leaves. The
  // blade geometry is centred on the row point and runs -0.42L to +0.58L, so a
  // near-zero offset tucks every base under the centre — which is what makes the
  // centre a point you can see.
  const ROSETTE = 10 // 8-12 in the reference; 13 packed the star solid
  const OFF_R = 0.14 // blade centre offset off the rosette's own centre, in r
  // 0.72 -> 0.92. LEAF_EFF in foliage.check is the same number and moves with
  // it: a blade at 45-75 degrees off vertical lays sin(60)=0.87 of its length
  // into the plan where one at 30-55 laid sin(43)=0.68.
  const BLADE_EFF = 0.92
  const RB = [0.21 * s, 0.29 * s] // 0.79x again: a plant you can point at
  const rmB = (RB[0] + RB[1]) / 2
  const pitch = (rmB * (OFF_R + BLADE_EFF) * gap) / Math.sqrt(fill)
  const nx = Math.max(1, Math.round((2 * hw) / pitch))
  const nz = Math.max(1, Math.round((2 * hd) / pitch))
  const jx = ((2 * hw) / nx) * 0.09
  const jz = ((2 * hd) / nz) * 0.09
  for (let gi = 0; gi < nx; gi++) {
    for (let gj = 0; gj < nz; gj++) {
      const px = ((gi + 0.5) / nx - 0.5) * 2 * hw + (rnd() - 0.5) * 2 * jx
      const pz = ((gj + 0.5) / nz - 0.5) * 2 * hd + (rnd() - 0.5) * 2 * jz
      // a tree planted in the middle wants its trunk clear
      if (hole && px * px + pz * pz < hole * hole) continue
      // normalised distance to the nearest edge, 1 at the centre of the bed
      const q = Math.max(0, Math.min(1 - Math.abs(px) / hw, 1 - Math.abs(pz) / hd))
      const r = pick(rnd, RB)
      // +/-25% per rosette on top of the mound's own profile. A grid of equal
      // plants at equal heights reads as a TEXTURE, not as plants: the shadow
      // valley between two neighbours only opens when one of them stands over
      // the other, which a shared dome height cannot produce.
      const dh = rise * s * (dome + (1 - dome) * q) * (0.65 + rnd() * 0.7) * (0.75 + rnd() * 0.5)
      const a0 = rnd() * TAU
      // The seat is the plant's AXIL, not its crown. A blade splayed 45-75
      // degrees reaches ~0.74r above the rosette centre where one at 30-55
      // reached ~1.15r, and the reference's yellow knots nestle down IN the
      // whorl — the last capture's sat proud on top of the canopy like fruit.
      sites.push([x + px, y + dh * 0.6 + r * 0.8, z + pz])
      for (let j = 0; j < ROSETTE; j++) {
        // even bearings round the centre, lightly jittered: a rosette is
        // regular, and randomising the bearing outright loses the star
        const ra = a0 + (j / ROSETTE) * TAU + (rnd() - 0.5) * 0.4
        // Pitch RAMP across the whorl, not a uniform tuft: the outer third lies
        // lower and the centre stands up. This is what makes the plan silhouette
        // a star — at 0.45-1.35 every blade pointed within 50 degrees of vertical
        // and the bed read as one continuous leaf pile from the game camera.
        //
        // `splay` is tan(angle off vertical). 1.0 + t^2*2.55 is 45 to 74
        // degrees, mean 63 — the reference's star, where 0.58 + t^2*0.85
        // (30-56) was the upright thicket described at the top of this block.
        // The ramp across the whorl is what domes the plant: the first blades
        // stand at 45 and the last lie at 74, so the star has a crown and a
        // skirt rather than being a flat pinwheel.
        const t = j / ROSETTE
        const splay = 1.0 + t * t * 2.55 + rnd() * 0.25
        clump(
          b,
          x + px + Math.cos(ra) * r * OFF_R,
          y + r * 0.45 + dh * 0.55,
          z + pz + Math.sin(ra) * r * OFF_R,
          r,
          // Crest of the mound catches the light, the skirt sits in its own
          // shadow; within a rosette the outer blades ride lower.
          // The COEFFICIENTS moved, the mean did not: 0.28 + 0.4q + ... has a
          // mean of 0.45 over a rectangle's q (mean 0.33) and a range of 0.55,
          // so the whole bed sat within half a ramp stop of C.shrub and rendered
          // as one flat emerald mass — the reference's bed spans a real
          // mid-green in the valleys up to lime at the crest. 0.20 + 0.58q has
          // the SAME mean of 0.45 and a range of 0.79, which reaches both ends
          // of the ramp. Do not fix this by lifting the base instead: the
          // medians already match the reference and a lift moves them.
          // Widened once more (0.20+0.58q -> 0.13+0.70q, range 0.79 -> 0.90) with
          // the stop repaint in palette.js: the top stop only warms the pixels
          // that actually REACH it, and the measured lit 20% was sitting at h85,
          // i.e. still on the mid stop. Mean drops 0.45 -> 0.41, which is the
          // right direction on its own — the bed measured Lmed 38 against the
          // reference's 34. Max is 1.036, so a sliver at the exact bed centre
          // clamps; anything past ~1.05 and the clamped population starts to read
          // as bright blobs, which is the failure SUN_FACE's comment describes.
          0.13 + q * 0.7 + rnd() * 0.14 + 0.066 - t * 0.18,
          1 - Math.min(1, dh / (rise * s)),
          rnd,
          SHRUB_LOW,
          SHRUB_TOP,
          LEAF_TOP,
          [Math.cos(ra) * splay, 1, Math.sin(ra) * splay],
          0.22, // tighter than the old 0.35: a sprayed rosette is a bush again
        )
      }
    }
  }

  // GRAIN, and it now sits LOW (hOff 0.3, was 1.0) and THIN (fineF 1.6, was
  // 3.2). Its job changed with the grid twice over. It used to ride the crest,
  // which is exactly what filled the valleys the grid exists to open; and at
  // 3.2 it was emitting 56 loose blades per square metre against the rosettes'
  // 20, so the bed's dominant read was still a bristle mat with some stars
  // buried in it. Down at the bases and at a third the density it closes the
  // last of the soil — the invariant foliage.check rasterises — while the
  // plant-to-plant gaps stay dark, because what makes a valley read as a valley
  // is that nothing lit is standing in it. Rosettes carry the plan on their own
  // to 98.2%; this layer is what takes it past 0.96 with margin.
  //
  // 2.6 -> 1.35, and it is the same argument in reverse. This layer exists to
  // stop the soil showing THROUGH a plant, not to fill the space BETWEEN two of
  // them — and with the rosettes reopened to 45-75 degrees and spaced 25% wider
  // it was the thing standing in every valley the grid now opens. A valley only
  // reads as a valley if nothing lit is standing in it. What is left is a thin
  // litter of fingernail-sized blades at the bases, deep in the plants' own
  // shade, which is what the reference's bed floor looks like where you can see
  // it at all.
  {
    const rad = [0.1 * s, 0.17 * s]
    const rm = (rad[0] + rad[1]) / 2
    const n = Math.max(8, Math.round((area * fineF * fill) / (Math.PI * rm * rm)))
    for (let i = 0; i < n; i++) {
      const px = (rnd() - 0.5) * 2 * hw
      const pz = (rnd() - 0.5) * 2 * hd
      if (hole && px * px + pz * pz < hole * hole) continue
      const q = Math.max(0, Math.min(1 - Math.abs(px) / hw, 1 - Math.abs(pz) / hd))
      const r = pick(rnd, rad)
      const dh = rise * s * (dome + (1 - dome) * q) * (0.65 + rnd() * 0.7)
      const ra = rnd() * TAU
      const t = rnd()
      const splay = 0.3 + t * t * 2.4 + rnd() * 0.3
      clump(
        b,
        x + px, y + r * 0.45 + dh * 0.3, z + pz,
        r,
        0.08 + q * 0.62 + rnd() * 0.14 - t * 0.18, // same widening as the body
        1 - Math.min(1, dh / (rise * s)),
        rnd,
        SHRUB_LOW, SHRUB_TOP, LEAF_TOP,
        [Math.cos(ra) * splay, 1, Math.sin(ra) * splay],
        0.22,
      )
    }
  }

  return sites
}

/**
 * Flower heads over a bed that pushBed has already filled. Scattered, not
 * bouquets: the old 3-5 clusters of 0.095-0.14 spheres read as gumballs dropped
 * on a hedge. The reference's blooms are small enough that you register them as
 * a speckle of colour over the leaf, which means many and tiny.
 */
export function pushBlooms(b, x, y, z, w, d, rnd, s = 1, opt = {}) {
  refreshStops()
  // 2.6 -> 4.4 -> 9.2 -> 4.6, and the round trip is the useful record. Yellow
  // measured 1.07% of frame against the reference's 2.9-4.5%, so `per` doubled —
  // and the capture came back a CARPET: yellow was most of the bed's plan and the
  // green rosettes it is supposed to punctuate were not visible at all. The count
  // was never the whole deficit. Seating each cluster on a rosette crest (`sites`
  // below) put every knot where it is SEEN instead of down in a shadow valley,
  // and the knot itself got fatter and rounder (Props.jsx budCluster: 4
  // half-overlapped beads on a 0.34 ring, not 6 on a 0.44 one). Those two are
  // worth more than 2x of density between them, so the density gives it back.
  // `per` is clusters per square metre; the yellow share below is 0.82.
  // 4.6 -> 8.0. The knot itself is 0.76x linear and ONE head instead of 2-3
  // (below), which is 0.32x the yellow area per cluster — the last capture's
  // knots measured ~0.85 blade-widths across against the reference's ~0.54 and
  // read as raspberries sitting on the foliage. Raising the density 1.4x gives a
  // little of that back so the bed still reads yellow-dominant, which is the one
  // thing about the flowers the last round got right.
  const { per = 8.0, rise = 0.34, dome = 0.4, sites = null } = opt
  // floor of 6, not 3: a yellow cluster is ONE head now, so the smallest bed
  // levelData emits (1.2x1.2) would otherwise fall under foliage.check.js's
  // "a scatter, not a token few" floor of 8.
  const clusters = Math.max(6, Math.round(w * d * per))
  const hw = w / 2
  const hd = d / 2
  for (let c = 0; c < clusters; c++) {
    // Seat the cluster ON a rosette when pushBed handed its centres over. The
    // reference's knots ring a plant's middle and sit in its axils; the uniform
    // scatter this used to do put most of them in the shadow valleys BETWEEN
    // plants, where a flower reads as something dropped on the soil rather than
    // as something growing. The 0.34-radius ring is roughly a rosette's axils.
    let px
    let pz
    let seat = 0
    if (sites && sites.length) {
      const st = sites[Math.floor(rnd() * sites.length)]
      const a = rnd() * TAU
      const rr = 0.34 * s * Math.sqrt(rnd())
      px = st[0] - x + Math.cos(a) * rr
      pz = st[2] - z + Math.sin(a) * rr
      seat = st[1] - y // this plant's own crown height, not the bed's mean dome
    } else {
      px = (rnd() - 0.5) * 2 * hw
      pz = (rnd() - 0.5) * 2 * hd
    }
    const q = Math.min(1 - Math.abs(px) / hw, 1 - Math.abs(pz) / hd)
    const t = rnd()
    // yellow-dominant: the reference's ground cover carries yellow bud clusters
    // between the leaves, with white and pink daisies as the accent, not the
    // other way round. 0.62, up from 0.52 — isolating the reference's own flower
    // pixels puts yellow at 1.3% of the plant body and white+pink together under
    // half of that, and a grove capture was reading NO yellow at all.
    // 0.68/0.86 -> 0.82/0.96. The pale pink heads were reading as LILAC popcorn
    // against the lavender planter rim they sit inside — a colour that is not in
    // the reference at all, and at 14% of every bed's blooms they outnumbered the
    // yellow the reference leads with. Pink belongs on the TREE (pushTree's
    // bloom table), where it sits against green and reads as blossom.
    // 0.82/0.96 -> 0.88/0.975. The share was never the whole story: a WHITE
    // cluster is 3-5 separate daisy heads and a yellow one is a single knot, so
    // at an 82/14 split the bed rendered four white heads for every five yellow
    // ones — and white on green is the highest-contrast thing in the frame. The
    // capture came back reading as a white-flowered bed with yellow specks,
    // which is the reference's hierarchy upside down. Share, head count and head
    // size all move together below.
    const tint = t < 0.88 ? 'flowerYellow' : t < 0.975 ? 'flowerWhite' : 'flowerPink'
    // ride the same dome the leaf does, so blooms sit ON the mound
    // A blade of a bed rosette reaches ~1.5 radii above its own centre, so a
    // bloom seated AT the mound crest is inside the plant. It has to clear it.
    const top = seat
      ? y + seat + 0.04 * s
      : y + rise * s * (dome + (1 - dome) * Math.max(0, q)) + 0.42 * s
    // The yellow bucket is a bud KNOT now (Props.jsx budCluster), so the knot is
    // baked into the geometry and the scatter must NOT re-spray it: two or three
    // big heads within 0.06 of each other, where a daisy accent stays 4-6 small
    // heads over 0.15. Spraying seven 0.11 heads over 0.17 — which is what this
    // did for both — is a dusting, and a dusting of anything reads as noise on a
    // bed whose leaves are the same size as the flowers were.
    const knot = tint === 'flowerYellow'
    // ONE knot per yellow cluster, not 2-3. budCluster is already a knot, and
    // stacking two or three of them 0.055 apart is what produced the measured
    // 10-14 lumpy beads in an elongated string — the corn-cob read. The
    // reference's knot is 3-6 smooth beads about one leaf-tip across, i.e.
    // exactly one budCluster. Daisies stay a small spray of separate heads,
    // because a daisy accent IS several flowers.
    // Daisies 3-5 -> 2-3 heads over 0.18: an accent is a couple of flowers, and
    // a daisy's geometry is 1.1 bounding radii against the knot's 0.80, so head
    // for head white already renders 40% bigger than yellow does.
    const nf = knot ? 1 : 2 + Math.floor(rnd() * 2)
    const spread = knot ? 0.03 : 0.18
    for (let k = 0; k < nf; k++) {
      // 0.76x on the knot (was 0.68 — the first capture of it read as specks).
      // budCluster's bounding radius is 0.80, so a row radius of 0.072-0.102
      // renders 0.115-0.163 across against a bed blade's 0.24 max width, i.e.
      // 0.48-0.68 blade-widths against the reference's ~0.54. It was 0.85.
      const r = knot ? (0.072 + rnd() * 0.03) * s : (0.05 + rnd() * 0.028) * s
      b[tint].push([
        x + px + (rnd() - 0.5) * spread * s,
        top + rnd() * 0.1 * s,
        z + pz + (rnd() - 0.5) * spread * s,
        r,
        r,
        r,
        0,
      ])
    }
  }
}

export function pushBush(b, x, y, z, s, r, rnd) {
  refreshStops()
  const lobes = picki(rnd, BUSH.lobes)
  for (let i = 0; i < lobes; i++) {
    const a = r + (i / lobes) * TAU + (rnd() - 0.5) * 0.8
    const off = (0.1 + rnd() * 0.42) * BUSH.rx * s * 1.5
    const cx = x + Math.cos(a) * off
    const cz = z + Math.sin(a) * off
    const lr = BUSH.rx * s * (0.42 + rnd() * 0.3)
    const ly = y + BUSH.y * s * (0.6 + rnd() * 0.55)
    // same grain argument as the canopy: 3-5 clumps per lobe left each lobe
    // readable as a single blob, which is what made a shrub read as a handful
    // of green pebbles rather than one plant
    const n = 9 + Math.floor(rnd() * 6)
    for (let k = 0; k < n; k++) {
      const u = rnd() * TAU
      const v = Math.acos(2 * rnd() - 1)
      const q = Math.cbrt(rnd())
      const ox = Math.sin(v) * Math.cos(u) * lr * q
      const oy = Math.cos(v) * lr * q * 0.7
      const oz = Math.sin(v) * Math.sin(u) * lr * q
      clump(
        b,
        cx + ox,
        Math.max(y + 0.04 * s, ly + oy),
        cz + oz,
        (0.115 + rnd() * 0.08) * s * (1.25 - q * 0.4),
        0.38 + oy / (lr * 1.8),
        1 - q,
        rnd,
        SHRUB_LOW,
        SHRUB_TOP,
        LEAF_TOP,
        // A lobe is a ROSETTE: every blade splays up and out of its centre.
        // The lift is what keeps blades off the paving — an outward-only aim on
        // the lower half of a lobe drives tips straight into the ground.
        [ox, Math.abs(oy) + lr * 0.75, oz],
      )
    }
  }
}
