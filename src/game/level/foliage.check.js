// Self-check for the plant generator. The failures this exists to catch are all
// invisible in a build and obvious on screen:
//   - a crown that floats clear of its trunk on unlucky seeds
//   - a leaf mass that has drifted off the end of the branch carrying it
//   - a colour emitted in the wrong space, which is what turned every trunk in
//     the park white (bake() reads slots 9-11 as an absolute LINEAR colour and
//     divides the material base out; emitting a 0.85-1.15 multiplier there asks
//     for an instanceColor of 3.2)
// Run: node src/game/level/foliage.check.js

import assert from 'node:assert/strict'
import { SPECIES, newBuckets, pushTree, pushBush, pushBed, pushBlooms } from './foliage.js'

// A blade's plan footprint. This used to be ONE NUMBER — a disc of
// `LEAF_EFF * row radius` centred on the row point — and that model has now
// broken twice for the same reason: it cannot see WHERE a blade points. It was
// tuned to 0.9, then to 0.72 when the rosette splay was pulled upright, and this
// round pushBed moved BOTH the splay (30-55 -> 45-75 degrees off vertical, so a
// blade lays far more of its length into the plan) and OFF_R (0.4 -> 0.14, so
// every blade's row point now sits on the rosette centre rather than a third of
// a radius out along its own bearing). Under the disc model those two cancel
// into nonsense: ten concentric discs where the plant is actually a ten-armed
// star reaching 1.3 radii out.
//
// So the model is the blade itself. bake() aims a row with rotation
// (tilt, yaw, 0) in YXZ and the geometry runs along local +Y from -0.42L to
// +0.58L of its scaled length, so the plan footprint is a CAPSULE: project that
// segment onto the ground and give it the blade's own half-width. The invariant
// is unchanged — rasterise the bed's plan and demand it is covered — but it is
// now measured against the shape that is actually there.
//
// These two numbers are the BED's blade (Props.jsx LEAF), and they are only ever
// used by the bed raster below. A tree crown is a different mesh now — CROWN_LEAF,
// W 0.32 on a pointed CROWN_PROFILE — and lives in the `crown` bucket, which is
// why every tree assertion in this file reads b.crown and every bed one reads
// b.foliage. Do not merge the two: the bed shape is signed off and the crown is
// under active direction, so one shared constant here would silently re-tune the
// bed's coverage floor the next time the crown moves.
const BLADE_L = 2.55 // Props.jsx leafBlade L
const BLADE_W = 0.532 * 0.75 // max half-width x PROFILE's mean-to-max
/** Plan capsule of one foliage row: [x0, z0, x1, z1, halfWidth]. */
function bladePlan(e) {
  const [x, , z, r, sy, , yaw, tilt] = e
  const dx = Math.sin(tilt) * Math.sin(yaw)
  const dz = Math.sin(tilt) * Math.cos(yaw)
  const len = (sy || r) * BLADE_L
  return [x - dx * len * 0.42, z - dz * len * 0.42, x + dx * len * 0.58, z + dz * len * 0.58, r * BLADE_W]
}
function nearBlade(cap, px, pz) {
  const [x0, z0, x1, z1, hw] = cap
  const vx = x1 - x0
  const vz = z1 - z0
  const l2 = vx * vx + vz * vz
  let t = l2 > 1e-9 ? ((px - x0) * vx + (pz - z0) * vz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - x0 - vx * t, pz - z0 - vz * t) < hw
}
const prng = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)

// Rows carry the clump centre and its radius in sx; the visible bottom of the
// crown is the lowest centre minus that clump's own radius.
const crownFloor = (rows) => Math.min(...rows.map((e) => e[1] - e[3]))
const crownCeil = (rows) => Math.max(...rows.map((e) => e[1] + e[3]))
const spread = (rows) => Math.max(...rows.map((e) => Math.hypot(e[0], e[2]) + e[3]))

/** Where a woody row's tip lands, re-deriving the YXZ aim bake() will apply. */
function tipOf(e) {
  const [x, y, z, , len, , yaw, tilt] = e
  return [
    x + Math.sin(tilt) * Math.sin(yaw) * len,
    y + Math.cos(tilt) * len,
    z + Math.sin(tilt) * Math.cos(yaw) * len,
  ]
}

let worstGap = -Infinity
let minClumps = Infinity
let minBranches = Infinity

for (const name of Object.keys(SPECIES)) {
  const sp = SPECIES[name]
  for (let i = 0; i < 300; i++) {
    const rnd = prng(1 + i * 7919)
    const s = 0.75 + (i / 300) * 0.85 // the scale range levelData actually emits
    const b = newBuckets()
    pushTree(b, 0, 0, 0, s, rnd() * 6.28, rnd, name)

    assert.equal(b.trunk.length, 1, `${name}: one trunk per tree`)
    assert(b.branch.length >= sp.branches[0], `${name}: too few branches`)
    minBranches = Math.min(minBranches, b.branch.length)
    minClumps = Math.min(minClumps, b.crown.length)

    const [, trunkTopY] = tipOf(b.trunk[0])
    const floor = crownFloor(b.crown)
    // positive gap = daylight between the trunk top and the underside of the crown
    worstGap = Math.max(worstGap, floor - trunkTopY)
    assert(crownCeil(b.crown) > trunkTopY, `${name}: crown must sit above the trunk top`)
    assert(floor > 0.2 * s, `${name}: crown dips to the ground at scale ${s.toFixed(2)}`)

    // Every branch must be COVERED ALONG ITS LENGTH, not merely have leaf near
    // its tip. Checking only the tip is what let the first version of this
    // generator ship a canopy with bare sticks radiating out of it: each tip
    // had its ball, and the inner half of every branch was naked.
    for (const br of b.branch) {
      const [x0, y0, z0, , len, , yaw, tilt] = br
      const dx = Math.sin(tilt) * Math.sin(yaw)
      const dy = Math.cos(tilt)
      const dz = Math.sin(tilt) * Math.cos(yaw)
      for (const t of [0.45, 0.75, 1]) {
        const px = x0 + dx * len * t
        const py = y0 + dy * len * t
        const pz = z0 + dz * len * t
        const inside = b.crown.some(
          (e) => Math.hypot(e[0] - px, e[1] - py, e[2] - pz) < e[3] + 0.32 * s,
        )
        assert(inside, `${name}: bare branch shaft at t=${t}, scale ${s.toFixed(2)}`)
      }
    }

    for (const e of [...b.crown, ...b.trunk, ...b.branch]) {
      assert(e.length === 12, `${name}: row must carry a placement and an rgb triple`)
      assert(e.every(Number.isFinite), `${name}: every row slot must be finite`)
      assert(e[3] > 0 && e[4] > 0 && e[5] > 0, `${name}: positive scale`)
      for (const c of [e[9], e[10], e[11]]) {
        assert(c >= 0 && c <= 1, `${name}: colour channel ${c} out of range`)
      }
    }
  }
}

assert(worstGap < 0, `crown floats clear of the trunk by ${worstGap.toFixed(3)} on some seeds`)
assert(minClumps >= 24, `crowns can come out as thin as ${minClumps} clumps`)

// GRAIN. A crown's silhouette is carried by its clumps' arcs. When a clump is a
// third of the mass it sits in you get half a dozen chords and the thing reads
// as a faceted boulder — which is exactly what shipped before this assertion
// existed, and it passed every check above while doing it.
for (const [name, sp] of Object.entries(SPECIES)) {
  const ratio = ((sp.clumpR[0] + sp.clumpR[1]) / 2) / ((sp.mass[0] + sp.mass[1]) / 2)
  assert(ratio < 0.32, `${name}: clumps are ${(ratio * 100) | 0}% of their mass — too coarse`)
  // ...and shrinking the clump without raising the count just opens holes.
  // Solid angle goes as n*r^2, so hold that product above what the old
  // 9 x 0.38 table delivered.
  const solid = ((sp.massClumps[0] + sp.massClumps[1]) / 2) * ratio * ratio
  assert(solid > 0.9, `${name}: mass covers ${solid.toFixed(2)} — canopy will read as lace`)
}

// Bushes: low, wide, and rooted at the plane they are planted on.
for (let i = 0; i < 200; i++) {
  const rnd = prng(31 + i * 6577)
  const s = 0.7 + (i / 200) * 0.7
  const b = newBuckets()
  pushBush(b, 0, 0, 0, s, rnd() * 6.28, rnd)
  assert(b.foliage.length > 0, 'bush must emit clumps')
  assert(crownFloor(b.foliage) < 0.12 * s, 'bush must touch the ground it sits on')
  assert(crownCeil(b.foliage) < 1.1 * s, 'bush must stay low')
  // `spread` is a radius and the bush is rooted at 0, so compare full width to
  // full height — a shrub that reads as a ball is a shrub that reads as an asset
  assert(2 * spread(b.foliage) > crownCeil(b.foliage), 'bush must read wider than it is tall')
}

// Beds: the invariant is COVERAGE. Every capture before pushBed existed showed
// dark soil between the clumps, and no assertion here would have caught it —
// the rows were all finite, in range and above the soil plane. So measure what
// actually failed: rasterise the bed's plan and demand it comes out solid.
let worstCover = 1
for (let i = 0; i < 60; i++) {
  const rnd = prng(101 + i * 4703)
  const w = 1.2 + (i % 7) * 0.9
  const d = 1.2 + (i % 5) * 1.1
  const b = newBuckets()
  pushBed(b, 0, 0, 0, w, d, rnd)
  pushBlooms(b, 0, 0, 0, w, d, rnd)

  const N = 24
  const caps = b.foliage.map(bladePlan)
  let hit = 0
  for (let a = 0; a < N; a++) {
    for (let c = 0; c < N; c++) {
      const px = ((a + 0.5) / N - 0.5) * w
      const pz = ((c + 0.5) / N - 0.5) * d
      // Plan-view coverage against the blade capsule, not a disc — see
      // bladePlan. Do not put this back to a radius test because it is simpler:
      // the disc model has now passed a bed that had opened up and failed one
      // that had not.
      if (caps.some((cp) => nearBlade(cp, px, pz))) hit++
    }
  }
  const cover = hit / (N * N)
  worstCover = Math.min(worstCover, cover)
  // THRESHOLD RELAXED, 0.96 -> 0.82, and this is deliberate rather than a
  // measurement moving. 96% was written in the sphere era, when the invariant
  // being protected was "the beds are showing bare soil between the clumps" —
  // and it still is, which is why there is a floor here at all. But the
  // reference itself shows dark soil-shadow wedges BETWEEN neighbouring
  // rosettes: that is what makes its plants countable, and a bed rasterising
  // solid is a bed you cannot count a plant in. pushBed's grid pitch now targets
  // ~92% mean / 87% worst. The floor keeps the failure this caught (a bed that
  // is a quarter bare soil, on the prng bug) firmly out of range.
  assert(cover > 0.82, `bed ${w.toFixed(1)}x${d.toFixed(1)} leaves ${((1 - cover) * 100) | 0}% soil bare`)

  const blooms = b.flowerWhite.length + b.flowerPink.length + b.flowerYellow.length
  assert(blooms > 8, 'bed must carry a scatter of blooms, not a token few')
  for (const e of [...b.flowerWhite, ...b.flowerPink, ...b.flowerYellow]) {
    // gumball guard: a bloom bigger than a leaf clump reads as a dropped ball
    assert(e[3] < 0.16, `bloom radius ${e[3].toFixed(3)} is bigger than the leaf it sits on`)
    assert(e[1] > 0, 'bloom must sit above the soil')
  }
}

console.log(
  `foliage ok — trunk/crown overlap ${(-worstGap).toFixed(2)} at worst, ` +
    `${minClumps}+ clumps and ${minBranches}+ branches per crown, ` +
    `beds ${(worstCover * 100).toFixed(1)}% covered at worst`,
)
