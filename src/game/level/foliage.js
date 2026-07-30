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
// can be aimed by (tilt, yaw, 0) and a clump can still take a free tumble.

import * as THREE from 'three'
import { C } from '../palette.js'

const TAU = Math.PI * 2

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
 * GRAIN. A mass is only as convincing as the ratio clumpR/mass. At the old
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
    mass: [0.72, 0.95], // leaf-mass radius at a branch tip
    massClumps: [16, 22],
    clumpR: [0.17, 0.26],
    fill: [5, 8],
    crownLift: 0.35, // masses ride this much above the branch tip
    leaf: [C.leafDark, C.leaf, C.leafLight],
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
    mass: [0.6, 0.8],
    massClumps: [14, 19],
    clumpR: [0.15, 0.23],
    fill: [4, 6],
    crownLift: 0.42,
    leaf: [C.leafDark, C.shrub, C.leafLight],
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
    mass: [0.68, 0.9],
    massClumps: [16, 21],
    clumpR: [0.16, 0.25],
    fill: [5, 8],
    crownLift: 0.28,
    leaf: [C.leafDark, C.leaf, '#b0ac5c'],
  },
}

const SPECIES_KEYS = Object.keys(SPECIES)

// Kept as the default species so existing importers (and foliage.check.js)
// keep working against the same field names.
export const TREE = SPECIES.broadleaf

export const BUSH = { rx: 0.62, ry: 0.34, y: 0.3, lobes: [3, 5] }

// Canopy ramp: shaded underside -> mid -> sunlit top, applied as an absolute
// per-instance colour so the gradient is continuous, not three discrete greens.
const LEAF_LOW = new THREE.Color(C.leafDark)
const LEAF_MID = new THREE.Color(C.leaf)
export const LEAF_TOP = new THREE.Color(C.leafLight)
export const SHRUB_LOW = new THREE.Color(C.leafDark)
export const SHRUB_TOP = new THREE.Color(C.shrub)
const BARK = new THREE.Color(C.trunk)
const _leaf = new THREE.Color()

const lerp = (a, b, t) => a + (b - a) * t
const pick = (rnd, [a, b]) => lerp(a, b, rnd())
const picki = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1))

/** hN 0 = underside, 1 = top of the crown. `deep` darkens interior clumps. */
function leafColor(hN, deep, rnd, low, mid, top) {
  if (hN < 0.5) _leaf.copy(low).lerp(mid, hN * 2)
  else _leaf.copy(mid).lerp(top, (hN - 0.5) * 2)
  // Saturation jitter is deliberately tight: the reference holds 38-43% from
  // core to crown, so a +/-0.09 swing was pushing a fifth of the canopy outside
  // the band the whole art direction is measured in.
  return _leaf.offsetHSL(
    (rnd() - 0.5) * 0.03,
    (rnd() - 0.5) * 0.05,
    (rnd() - 0.5) * 0.05 - deep * 0.11,
  )
}

export const newBuckets = () => ({
  trunk: [],
  branch: [],
  foliage: [],
  flowerWhite: [],
  flowerPink: [],
  flowerYellow: [],
})

export function clump(b, x, y, z, rad, hN, deep, rnd, low = LEAF_LOW, mid = LEAF_MID, top = LEAF_TOP) {
  const col = leafColor(hN, deep, rnd, low, mid, top)
  b.foliage.push([
    x,
    y,
    z,
    rad,
    rad * (0.82 + rnd() * 0.3),
    rad,
    rnd() * TAU,
    rnd() * TAU,
    rnd() * TAU,
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
    clump(b, cx + ox, cy + oy, cz + oz, r, 0.42 + oy / (rad * 1.5), 1 - edge, rnd, low, mid, top)
  }
}

/** `rnd` is the plant's own stream, so the table is a species, not a stamp. */
export function pushTree(b, x, y, z, s, r, rnd, speciesName) {
  const sp = SPECIES[speciesName] || SPECIES[SPECIES_KEYS[Math.floor(rnd() * SPECIES_KEYS.length)]]
  const low = new THREE.Color(sp.leaf[0])
  const mid = new THREE.Color(sp.leaf[1])
  const top = new THREE.Color(sp.leaf[2])

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

    // leaf mass at the tip, lifted a little so it sits ON the branch
    const tipX = bx + dx * len
    const tipY = by + dy * len + sp.crownLift * s
    const tipZ = bz + dz * len
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
    )
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
  const { fill = 1, rise = 0.34, dome = 0.4, over = 0.16, hole = 0, bodyF = 3.4, fineF = 1.3 } = opt
  const hw = w / 2 + over
  const hd = d / 2 + over
  const area = hw * hd * 4

  // TWO layers, and the split is not decoration. A uniform scatter leaves
  // exp(-f) of the plan bare, so closing a bed with 0.1 m clumps alone wants
  // f ~ 4.6 — thousands of instances per planter, and 15 planters of that is
  // several times the whole canopy. Coarse clumps buy area ~5x cheaper per
  // instance, fine clumps buy grain; the residual bare fraction is the PRODUCT
  // of the two layers' holes, so a heavy body under a light grain closes to
  // ~2% at a third of the cost, and what is left is leaf-sized speckle rather
  // than a visible patch of soil.
  const layer = (rad, f, hOff) => {
    const rm = (rad[0] + rad[1]) / 2
    const n = Math.max(8, Math.round((area * f) / (Math.PI * rm * rm)))
    for (let i = 0; i < n; i++) {
      const px = (rnd() - 0.5) * 2 * hw
      const pz = (rnd() - 0.5) * 2 * hd
      // a tree planted in the middle wants its trunk clear
      if (hole && px * px + pz * pz < hole * hole) continue
      // normalised distance to the nearest edge, 1 at the centre of the bed
      const q = Math.max(0, Math.min(1 - Math.abs(px) / hw, 1 - Math.abs(pz) / hd))
      const r = pick(rnd, rad)
      const dh = rise * s * (dome + (1 - dome) * q) * (0.65 + rnd() * 0.7)
      clump(
        b,
        x + px,
        y + r * 0.45 + dh * hOff,
        z + pz,
        r,
        // crest of the mound catches the light, the skirt sits in its own shadow
        0.28 + q * 0.4 + rnd() * 0.15 + hOff * 0.12,
        1 - Math.min(1, dh / (rise * s)),
        rnd,
        SHRUB_LOW,
        SHRUB_TOP,
        LEAF_TOP,
      )
    }
  }
  // 3.4 / 1.3 measures 97-99% closed across the bed sizes levelData emits, and
  // is the cheapest point on the sweep: shifting a unit of fill from the fine
  // layer to the body buys the same coverage for ~9x fewer instances, until the
  // fine layer thins enough to stop reading as grain. The theoretical exp(-f)
  // product said 2.0/1.5 would do; it measured 7% bare. Trust the raster.
  layer([0.17 * s, 0.27 * s], bodyF * fill, 0.55) // body
  layer([0.075 * s, 0.13 * s], fineF * fill, 1.0) // grain, riding the crest
}

/**
 * Flower heads over a bed that pushBed has already filled. Scattered, not
 * bouquets: the old 3-5 clusters of 0.095-0.14 spheres read as gumballs dropped
 * on a hedge. The reference's blooms are small enough that you register them as
 * a speckle of colour over the leaf, which means many and tiny.
 */
export function pushBlooms(b, x, y, z, w, d, rnd, s = 1, opt = {}) {
  const { per = 1.9, rise = 0.34, dome = 0.4 } = opt
  const clusters = Math.max(3, Math.round(w * d * per))
  const hw = w / 2
  const hd = d / 2
  for (let c = 0; c < clusters; c++) {
    const px = (rnd() - 0.5) * 2 * hw
    const pz = (rnd() - 0.5) * 2 * hd
    const q = Math.min(1 - Math.abs(px) / hw, 1 - Math.abs(pz) / hd)
    const t = rnd()
    const tint = t < 0.42 ? 'flowerWhite' : t < 0.76 ? 'flowerPink' : 'flowerYellow'
    // ride the same dome the leaf does, so blooms sit ON the mound
    const top = y + rise * s * (dome + (1 - dome) * Math.max(0, q)) + 0.14 * s
    const nf = 3 + Math.floor(rnd() * 4)
    for (let k = 0; k < nf; k++) {
      const r = (0.045 + rnd() * 0.032) * s
      b[tint].push([
        x + px + (rnd() - 0.5) * 0.34 * s,
        top + rnd() * 0.1 * s,
        z + pz + (rnd() - 0.5) * 0.34 * s,
        r,
        r,
        r,
        0,
      ])
    }
  }
}

export function pushBush(b, x, y, z, s, r, rnd) {
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
      )
    }
  }
}
