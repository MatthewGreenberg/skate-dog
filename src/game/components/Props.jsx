// Decorative set dressing: trees, shrubs, planters, benches, lamp posts.
// Everything static — foliage is baked into InstancedMeshes once and never
// touched again; the hand-placed props share module-level geometry/materials.

import { useMemo, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { C, M } from '../palette.js'
import { woodMap, woodNormal, woodRough } from '../level/textures.js'
import { PHOTO, PHOTO_TIME } from '../photo.js'
import { F, subscribeFoliage, foliageVersion } from '../foliageKnobs.js'
import { TREES, SHRUBS, PLANTERS, BENCHES, LAMPS } from '../level/levelData.js'
import { newBuckets, pushTree, pushBush, pushBed, pushBlooms } from '../level/foliage.js'

const TAU = Math.PI * 2
const prng = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)

// ---------------------------------------------------------------- materials
const foliage = (color) => windy(new THREE.MeshStandardMaterial({ color, ...M.foliage }))

// ---------------------------------------------------------------- wind
// Every plant shares one rooted sway: the bend pivots at the ground, so a trunk
// base never slides out from under its tree, and gust fronts travel along the
// wind instead of the whole park breathing in unison. No per-instance
// attributes — height comes from the vertex's own world Y and the gust phase
// from the instance origin, so this stays a pure vertex-shader effect on the
// existing InstancedMeshes.
const WIND = {
  uTime: { value: 0 },
  uStrength: { value: 1 }, // driven by <Wind strength> — 0 kills it, 2 is a gale
}
const WIND_DIR = new THREE.Vector2(0.82, 0.57).normalize()

const WIND_CHUNK = /* glsl */ `
  vec3 iOrigin = instanceMatrix[3].xyz;
  vec3 wPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  float wH = max(wPos.y, 0.0);
  float wSeed = fract(sin(dot(iOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);

  // gust front sweeping across the park along the wind direction
  float wAlong = dot(iOrigin.xz, WIND_DIR);
  float wGust = pow(sin(wAlong * 0.15 - uTime * 1.05 + wSeed * 6.283) * 0.5 + 0.5, 1.6);
  float wAmp = uStrength * (0.0025 + 0.007 * wGust) * (0.7 + wSeed * 0.6);

  // rooted arc: the point swings about the ground rather than shearing sideways,
  // and the drop keeps it the same distance from the root through the swing
  float wA = wAmp * pow(wH, 1.4);
  vec2 wSwing = WIND_DIR * wH * sin(wA);
  float wDrop = -wH * (1.0 - cos(wA));

  // leaf-scale flutter, deliberately independent of height so low shrubs still
  // shimmer when the canopies above them are barely moving
  float wF = sin(uTime * 5.0 + wPos.x * 2.3 + wPos.z * 1.9 + wSeed * 6.283)
    * 0.022 * uStrength;

  vec3 wOffset = vec3(wSwing.x + wF, wDrop, wSwing.y - wF * 0.6);

  // Take the world-space offset back into instance-local space. The instance
  // basis is a rotation times a per-axis scale, so its columns are orthogonal
  // and the inverse is each column dotted in and divided by its OWN length
  // squared. The previous version divided all three axes by column 0's length
  // squared, which is only correct when the scale is uniform.
  //
  // Leaf clumps are near-spherical so that held. Woody segments are not: a
  // branch scales (0.085, 0.9, 0.085), so column 0 is 0.0072 and every branch
  // got its wind displacement multiplied by about 139 — which is why branches
  // and trunks tore off their trees and floated across the park.
  vec3 wC0 = instanceMatrix[0].xyz;
  vec3 wC1 = instanceMatrix[1].xyz;
  vec3 wC2 = instanceMatrix[2].xyz;
  transformed += vec3(
    dot(wOffset, wC0) / max(dot(wC0, wC0), 1e-6),
    dot(wOffset, wC1) / max(dot(wC1, wC1), 1e-6),
    dot(wOffset, wC2) / max(dot(wC2, wC2), 1e-6)
  );
`

/** Patches a material's vertex stage with the shared sway. */
function windy(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.uTime
    shader.uniforms.uStrength = WIND.uStrength
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uStrength;
         const vec2 WIND_DIR = vec2(${WIND_DIR.x.toFixed(4)}, ${WIND_DIR.y.toFixed(4)});`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_CHUNK}`)
  }
  // without this three would reuse an unpatched MeshStandardMaterial program
  material.customProgramCacheKey = () => 'foliage-wind'
  return material
}

// white base: every clump carries its own colour, so the canopy ramp is
// continuous rather than three discrete greens. ONE material for both leaf
// buckets — the bed and the crown differ in GEOMETRY only, so sharing it keeps
// them one plant family in the light rig and costs one draw call, not a second
// shader program.
const LEAF_MAT = foliage('#ffffff')

const MAT = {
  trunk: windy(new THREE.MeshStandardMaterial({ color: C.trunk, ...M.bark })),
  branch: windy(new THREE.MeshStandardMaterial({ color: C.trunk, ...M.bark })),
  foliage: LEAF_MAT,
  crown: LEAF_MAT,
  // vertexColors: the daisy geometry carries its yellow eye as a per-vertex
  // multiplier (see daisy()). instanceColor still multiplies on top of it.
  flowerWhite: windy(
    new THREE.MeshStandardMaterial({ color: C.flowerWhite, roughness: 0.7, vertexColors: true }),
  ),
  flowerPink: windy(
    new THREE.MeshStandardMaterial({ color: C.flowerPink, roughness: 0.7, vertexColors: true }),
  ),
  flowerYellow: windy(new THREE.MeshStandardMaterial({ color: C.flowerYellow, roughness: 0.7 })),
  masonry: new THREE.MeshStandardMaterial({ color: C.wall, ...M.masonry }),
  cap: new THREE.MeshStandardMaterial({ color: C.cap, ...M.stone }),
  soil: new THREE.MeshStandardMaterial({ color: C.soil, roughness: 0.98 }),
  // Real grain, borrowed from the ramp ply (one upload — textures.js caches it)
  // rather than a second wood canvas. The tint is NOT benchWood: it multiplies a
  // map that already carries a mid-tan, so painting benchWood on top lands the
  // slat two stops under its measured reading. This value was SOLVED against a
  // capture, not derived — the map average, the grain passes and the tone curve
  // all move it — and a sunlit seat now measures (191,153,116) against
  // benchWood's (184,146,110). Re-measure it if the light rig moves.
  wood: new THREE.MeshStandardMaterial({
    color: '#9f9aa3',
    map: woodMap(),
    normalMap: woodNormal(),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: woodRough(),
    ...M.wood,
  }),
  iron: new THREE.MeshStandardMaterial({ color: C.benchIron, ...M.paintedMetal }),
  lamp: new THREE.MeshStandardMaterial({ color: C.lamp, ...M.paintedMetal }),
  glass: new THREE.MeshStandardMaterial({
    color: C.lampGlass,
    emissive: new THREE.Color(C.lampGlass),
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0,
  }),
}

// ---------------------------------------------------------------- vegetation
/**
 * A foliage instance is a LEAF BLADE, not a ball.
 *
 * Every plant in the reference is a rosette of pointed lanceolate leaves, and
 * no amount of lumping makes a sphere read as one — the long-running "canopy
 * reads as a faceted boulder" fight was a sphere problem, fixed by shrinking
 * clumps until the arcs were too small to see. A blade carries the read
 * directly: the silhouette is a fan of points, so the grain comes from the
 * shape rather than from the instance count.
 *
 * CENTRED on the origin and running along +Y, so a foliage row keeps meaning
 * exactly what it meant before — (centre, radius) — and the aim rides the same
 * two YXZ Euler slots a branch uses. It must be slots 6/7 only: YXZ applies the
 * Z term FIRST, so a roll would swing the blade's own axis off the aim (that is
 * why woody() has always written 0 there). Per-leaf variety comes from
 * jittering the aim in foliage.js instead.
 *
 * 6 stations x a 6-point ring = 60 tris. It was a 4-point ring (40 tris), and
 * the extra 20 buy the whole difference between a succulent pad and a QUARTZ
 * SHARD: a 4-gon section is a rhombus, so the blade carries a hard crease down
 * its spine where two faces meet at ~50 degrees, and smooth vertex normals only
 * turn that into a hard specular LINE instead of a hard edge. A 6-gon section
 * meets at 120 degrees and the highlight rolls across it. Both ends still pinch
 * to a point, so the blade still needs no caps.
 *
 * PROFILE is an explicit table because the shape is the whole read and a smooth
 * function cannot hold it. `sin(sqrt(t) * PI)` — the old one — peaks a quarter
 * of the way up and then falls away for the entire rest of the leaf, so the
 * average width is a third of W and every blade rendered as a THORN. The
 * reference's plants are obovate: pinched at the stalk, widest PAST the middle,
 * and rounded off rather than pointed. The round-off is the last 10% of the
 * length, which is what makes a blunt tip out of a station that still ends at
 * zero width and still needs no cap.
 */
// PADDLE. The previous table ([0,0],[0.06,0.35],[0.26,0.82],[0.45,1],
// [0.66,0.9],[0.84,0.6],[0.94,0.18],[1,0]) was measured on the last capture as a
// straight-sided SPEAR: it climbs to 82% of max width by a quarter of the
// length, so both edges read as straight lines converging on a needle, and the
// last two stations (18% then 0) put a sharp point on it. That is an
// agave/yucca/holly blade, and at bed scale the points spike the silhouette
// against the pale paving. The reference's blade is a fleshy succulent PAD:
// convex on both edges, widest at HALF its length rather than at a fifth, and
// blunt — the tip is a rounded cap, not a spike.
//
// So: a symmetric lens with a broad crest held over 0.28-0.72, and the last
// station at 0.9 still carrying 62% of max width so the final segment closes as
// a 52-degree cone — which at this scale renders as a rounded cap about 30% of
// max width across, the reference's blunt tip.
//
// Trapezoid area 0.752 of the bounding rectangle (was 0.664), so the mean width
// went UP 13% at a max width that came down 9% (W below) — a pad, not a spear.
// It is also one station SHORTER (7, was 8): 72 tris a blade rather than 84, and
// the 14% saved is what pays for the 1.6x leaf count the crowns needed.
const PROFILE = [
  [0, 0], [0.09, 0.55], [0.28, 0.9], [0.5, 1],
  [0.72, 0.92], [0.9, 0.62], [1, 0],
]

// A 6-point elliptical ring per station, semi-axes (W*p) across the face and
// (T*p) through the thickness — see the crease argument in the doc comment.
// ...for the BED pad, which is the one you stand next to. The tree crown takes
// 4 (`ringOf` below): the rhombus-section crease argument is a close-up
// argument, and a crown blade is 0.32 wide seen from 15m+ — at that size its
// triangles are already sub-pixel and the specular line the 6-gon exists to
// kill cannot resolve. It is 80% of the park's foliage triangles, so the two
// vertices matter more than the crease does.
const RING = 6
// ...offset by half a step. At phase 0 two vertices land on the width axis and
// NONE lands on the crest, so the top of the lens is a flat facet running the
// whole length of the blade — the single hard longitudinal crease every blade
// was showing, which smooth vertex normals turn into a hard specular LINE. At
// phase 30 degrees a vertex sits on the crest (and on the back) and the pair
// that used to sit on the width axis straddles the margin instead, which also
// gives the leaf edge a fleshy roll rather than a knife. The cost is that the
// face-on silhouette is now cos(30) = 0.866 of the ring's semi-axis, so W is
// divided back out below — otherwise rotating the ring quietly narrows the blade.
function ringOf(n) {
  const phase = Math.PI / n
  const k = 1 / Math.cos(phase) // put the silhouette back where W says
  const c = []
  const s = []
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU
    c.push(Math.cos(a) * k)
    s.push(Math.sin(a))
  }
  return { c, s }
}
const RINGS = { 4: ringOf(4), 6: ringOf(6) }

// Aspect is quoted at MAX width: 2.55 / (2*0.532) = 2.40:1 at the crest, which
// with PROFILE's 0.752 area is 3.19:1 as a MEAN — the number the eye actually
// integrates at play distance, in the top half of the reference's 2.5-3.5:1
// band. W came down 0.585 -> 0.532 with the paddle reprofile above and the two
// cancel: the last capture measured the visible blade at 2.3:1 against the
// reference's 2.7:1, i.e. marginally too wide, and the paddle holds near max
// width over far more of the length than the spear did — so leaving W alone
// would have widened the READ while narrowing the shape. Do not fix a
// fat-looking bed by narrowing W further — that gives you the rosemary the
// crest width exists to prevent.
//
// T is the lever that stopped the edge-on read being a needle, and it is worth
// more here than width is. bake() reads the aim in YXZ with the roll slot at 0,
// so a blade's width axis is ALWAYS horizontal and perpendicular to its own
// bearing (Ry(yaw)*Rx(tilt) leaves local +X in the ground plane) — which means
// the ~half of a rosette aimed toward or away from the camera presents its
// SECTION, not its face. At the old T 0.3 that section was 2.6/0.31 = 8.4:1 and
// those blades read as spikes stuck through the plant. At 0.42 against W 0.532
// the lens is 1.06 wide by 0.84 deep (ratio 1.27, was 1.33 — T deliberately did
// NOT follow W down, because a succulent pad is FLESHY and the edge-on read is
// the half of a rosette that faces the camera) and the edge-on aspect is 3.0:1.
// `prof` defaults to the bed's pad. The tree crown passes CROWN_PROFILE — see
// CROWN_LEAF below for why the two shapes are not allowed to converge.
function leafBlade(W = 0.532, L = 2.55, T = 0.42, prof = PROFILE, ring = RING) {
  const { c: RING_C, s: RING_S } = RINGS[ring]
  const pos = []
  const idx = []
  for (let i = 0; i < prof.length; i++) {
    const [t, p] = prof[i]
    const w = p * W
    // thickness tracks WIDTH, not height: a fleshy leaf is a lens in section,
    // and the old linear taper left the widest part of the blade the flattest
    const th = T * p
    const y = (t - 0.42) * L // base sits behind the row point, tip reaches past it
    const bend = t * t * 0.22 // a slight curl, so it is a leaf and not a spike
    for (let k = 0; k < ring; k++) pos.push(RING_C[k] * w, y, bend + RING_S[k] * th)
    if (i) {
      const a = (i - 1) * ring
      const b = i * ring
      for (let k = 0; k < ring; k++) {
        const k2 = (k + 1) % ring
        idx.push(a + k, b + k, b + k2, a + k, b + k2, a + k2)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Five rounded petals round a raised pip. The blooms used to be plain spheres,
 * which read as berries; the reference's are daisies, and five lobes is the
 * whole difference at the four or five pixels one of these covers.
 *
 * The pip is a YELLOW EYE now, and it is a vertex colour rather than a second
 * bucket: every daisy in the reference — white and pink alike — has one, and it
 * is most of what separates a daisy from a blob of cream at chase distance. One
 * material per bloom colour is what made this hard, but instanceColor and
 * vertexColor BOTH multiply the material base, so the eye can ride the geometry:
 * bake the ratio flowerYellow/flowerWhite into the pip's vertices and leave the
 * petals at 1. Ratio taken against WHITE deliberately — the white daisy then
 * lands on the exact yellow, and the pink one gets the same eye a stop warmer,
 * which is what a pink daisy's centre looks like anyway.
 */
const _eyeA = new THREE.Color()
const _eyeB = new THREE.Color()
function tinted(geo, r, g, b) {
  const n = geo.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    col[i * 3] = r
    col[i * 3 + 1] = g
    col[i * 3 + 2] = b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

function daisy() {
  // both are LINEAR here (three converts on set), which is the space
  // instanceColor/vertexColor multiply in
  _eyeA.set(C.flowerYellow)
  _eyeB.set(C.flowerWhite)
  const er = Math.min(1, _eyeA.r / Math.max(_eyeB.r, 0.02))
  const eg = Math.min(1, _eyeA.g / Math.max(_eyeB.g, 0.02))
  const eb = Math.min(1, _eyeA.b / Math.max(_eyeB.b, 0.02))
  const petal = new THREE.SphereGeometry(0.5, 6, 4).scale(1, 0.4, 1)
  const parts = []
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU
    parts.push(tinted(petal.clone().translate(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6), 1, 1, 1))
  }
  // the eye is proud of the petals, or from a 40-degree camera it is hidden by
  // whichever petal is nearest
  parts.push(
    tinted(new THREE.SphereGeometry(0.4, 6, 4).scale(1, 0.62, 1).translate(0, 0.2, 0), er, eg, eb),
  )
  return mergeGeometries(parts)
}

/**
 * A tight KNOT of beads, for the yellow.
 *
 * The reference's dominant flower is not a daisy at all — the white and pink
 * five-petal heads are the accent, and what actually reads from across the bed
 * is a cluster of small yellow buds sitting on top of a rosette, like a head of
 * broccoli. Baking that as one geometry rather than scattering N daisies is what
 * keeps the knot tight: pushBlooms' own scatter is 0.2m wide, which at this
 * scale is a spray, not a knot.
 *
 * THREE beads on a tight ring plus one crown bead, not four plus one. The last
 * capture measured a finished knot at ~0.85 blade-widths across against the
 * reference's ~0.54, and 10-14 beads in an elongated string — raspberries and
 * corn cobs sitting ON TOP of the foliage. Two thirds of that was pushBlooms
 * stacking 2-3 of these per cluster (it emits ONE now); the rest is here. Three
 * ring beads at 0.30 against a 0.5 bead overlap by four fifths, so the knot is a
 * single lumpy BALL with three countable lobes rather than a ring of pellets,
 * and its bounding radius is 0.80 where the four-bead ring was 0.84.
 * 4 beads at 36 tris is 144, under the daisy's 216.
 */
function budCluster() {
  const bead = (r) => new THREE.SphereGeometry(r, 6, 4)
  const parts = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5
    parts.push(bead(0.5).translate(Math.cos(a) * 0.3, (i % 2) * 0.1, Math.sin(a) * 0.3))
  }
  parts.push(bead(0.52).translate(0, 0.26, 0))
  return mergeGeometries(parts)
}

/**
 * The TREE crown's blade, and it is deliberately NOT the bed's.
 *
 * The bed (pushBed / pushBush -> the `foliage` bucket) was signed off as it
 * stands: a fleshy succulent PAD, blunt-tipped, W 0.532. The crowns were not —
 * "bushes look good, trees really bad, make the tree leaves thinner" — because
 * at chase distance a 0.532-wide pad rounded at BOTH ends reads as a green
 * jellybean stuck on a stick, and forty of them read as forty jellybeans. A tree
 * leaf is a different organ from a succulent rosette leaf and it has to be a
 * different mesh; the temptation to unify the two shapes is what produced the
 * jellybean crown in the first place.
 *
 * Two changes, and both are needed — narrowing alone leaves a stubby tic-tac:
 *
 * WIDTH 0.532 -> 0.32 (0.60x). Aspect at the crest goes 2.40:1 -> 4.0:1, and
 * with CROWN_PROFILE's 0.665 mean-to-max the MEAN aspect — the number the eye
 * integrates at play distance — goes 3.19:1 -> 5.4:1.
 *
 * TIP. The bed's PROFILE carries 62% of max width at t=0.9 and closes over the
 * last 10% of the length, which is a 52-degree cone, i.e. a rounded CAP. That is
 * the blunt end the brief is about. CROWN_PROFILE holds 72% at t=0.75 and
 * closes over the last QUARTER — a 20-degree cone, a real point — and it is
 * lanceolate rather than symmetric (widest at 0.46, not 0.50) so the leaf has a
 * shoulder and a taper instead of two identical ends.
 *
 * T 0.42 -> 0.26 tracks W down at very nearly the same ratio (0.81 vs 0.79): the
 * roll slot is 0, so a blade's width axis is always horizontal and about half of
 * any mass presents its SECTION rather than its face. Holding T at the bed's
 * value while W came down 40% would have made the crown read FATTER edge-on than
 * the pad it replaced, on half the leaves.
 *
 * 6 stations, not 7 (60 tris a blade against the bed pad's 72). Coverage is held
 * by count (foliage.js massClumps x1.61) and the 17% saved per blade is most of
 * what pays for it: the park's crown rows go 75k -> ~121k for 5.4M -> 7.3M tris
 * in the same two draw calls.
 */
//
// 5 stations and a 4-ring, not 6 and 6: 32 tris a blade against the pad's 72.
// The dropped station is the 0.1/0.5 base flare, which sits INSIDE the clump it
// belongs to and never reaches a silhouette. Crown rows are ~80% of the park's
// foliage triangles, so this is where the budget is — 7.3M -> 2.6M with the
// count trim in foliage.js. Shape stations (the 0.46 shoulder, the 0.75 taper)
// are untouched, because the lanceolate point IS the read.
const CROWN_PROFILE = [
  [0, 0], [0.28, 0.92], [0.46, 1], [0.75, 0.72], [1, 0],
]
const CROWN_RING = 4

// `let`, not const, because the "Foliage" leva folder rebuilds them. A knob
// cannot be a uniform write here: the park bakes its InstancedMeshes once and
// sets matrixWorldAutoUpdate = false, so a blade dimension only reaches the
// screen by regenerating the geometry AND re-baking every row that uses it.
let LEAF = leafBlade(F.bladeW, F.bladeL, F.bladeT)
let CROWN_LEAF = leafBlade(F.crownW, F.crownL, F.crownT, CROWN_PROFILE, CROWN_RING)
const BLOOM = daisy()
const BUDS = budCluster()

/** Rebuild the two knob-driven blades. Disposes the old ones — a slider drag
 *  is a rebuild per tick and leaking a BufferGeometry per tick is a GPU leak. */
function rebuildFoliageGeo() {
  LEAF.dispose()
  CROWN_LEAF.dispose()
  LEAF = leafBlade(F.bladeW, F.bladeL, F.bladeT)
  CROWN_LEAF = leafBlade(F.crownW, F.crownL, F.crownT, CROWN_PROFILE, CROWN_RING)
  BUCKET_GEO.crown = CROWN_LEAF
}

// Woody segments are UNIT cylinders anchored at their base, so a row's scale is
// (radius, length, radius) and its two rotation terms aim it. Anchoring at the
// base is what lets a branch grow from an arbitrary point on the trunk without
// the generator having to solve for a midpoint.
function woodyGeo(taper, seg) {
  return new THREE.CylinderGeometry(taper, 1, 1, seg).translate(0, 0.5, 0)
}
const TRUNK = woodyGeo(0.62, 10)
const BRANCH = woodyGeo(0.42, 6)

const BUCKET_GEO = {
  trunk: TRUNK,
  branch: BRANCH,
  // bed and bush stay on LEAF (bake's fallback); a tree crown is CROWN_LEAF
  crown: CROWN_LEAF,
  flowerWhite: BLOOM,
  flowerPink: BLOOM,
  // yellow is the bud knot, not a daisy — see budCluster
  flowerYellow: BUDS,
}

const _o = new THREE.Object3D()
const _col = new THREE.Color()

function bake(key, rows, receive) {
  const mat = MAT[key]
  const mesh = new THREE.InstancedMesh(BUCKET_GEO[key] || LEAF, mat, rows.length)
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i]
    _o.position.set(e[0], e[1], e[2])
    // YXZ: yaw first, then tilt off vertical. That is the order foliage.js aims
    // woody segments in — under the default XYZ a branch's yaw would be applied
    // after its tilt and every one of them would swing to the wrong bearing.
    _o.rotation.set(e[7] || 0, e[6], e[8] || 0, 'YXZ')
    _o.scale.set(e[3], e[4], e[5])
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
    // instanceColor multiplies the material colour, so divide the base back
    // out. Rows without a colour (flowers) fall through as a plain multiply-by-1.
    if (e.length > 9) {
      _col.setRGB(
        e[9] / Math.max(mat.color.r, 0.02),
        e[10] / Math.max(mat.color.g, 0.02),
        e[11] / Math.max(mat.color.b, 0.02),
      )
    } else {
      _col.setRGB(1, 1, 1)
    }
    mesh.setColorAt(i, _col)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor.needsUpdate = true
  mesh.castShadow = key === 'trunk' || key === 'branch' || key === 'foliage' || key === 'crown'
  mesh.receiveShadow = receive
  return mesh
}

/**
 * Bakes a repeated prop into one InstancedMesh per (geometry, material) part.
 * `parts` describe one copy in local space; `spots` are the world placements.
 * 13 benches of 19 pieces each go from 247 draw calls to 4.
 */
const _local = new THREE.Matrix4()
const _world = new THREE.Matrix4()

function instanceProp(parts, spots) {
  const groups = new Map()
  for (const p of parts) {
    const key = p.geo.uuid + p.mat.uuid
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { geo: p.geo, mat: p.mat, local: [], cast: false, receive: false }))
    _o.position.set(...(p.pos || [0, 0, 0]))
    _o.rotation.set(...(p.rot || [0, 0, 0]))
    _o.scale.set(...(p.scale || [1, 1, 1]))
    _o.updateMatrix()
    g.local.push(_o.matrix.clone())
    if (p.cast !== false) g.cast = true
    if (p.receive) g.receive = true
  }

  return [...groups.values()].map((g) => {
    const mesh = new THREE.InstancedMesh(g.geo, g.mat, g.local.length * spots.length)
    let i = 0
    for (const s of spots) {
      _o.position.set(s.x, s.base || 0, s.z)
      _o.rotation.set(0, s.rot || 0, 0)
      _o.scale.setScalar(1)
      _o.updateMatrix()
      _world.copy(_o.matrix)
      for (const l of g.local) mesh.setMatrixAt(i++, _local.multiplyMatrices(_world, l))
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = g.cast
    mesh.receiveShadow = g.receive
    return mesh
  })
}

const Instanced = ({ meshes }) =>
  meshes.map((m, i) => <primitive key={i} object={m} dispose={null} />)

// ---------------------------------------------------------------- grounding
// A soft darkening where each plant meets the ground. Without it every tree and
// shrub reads as an object resting on a plane rather than growing out of one —
// the sun shadow alone only covers whatever is inside the shadow frustum.
const SHADE_GEO = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2)
let _shadeMat = null
function shadeMat() {
  if (_shadeMat) return _shadeMat
  const t = canvasTexture(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    grad.addColorStop(0, 'rgba(0,0,0,0.85)')
    grad.addColorStop(0.55, 'rgba(0,0,0,0.4)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, w, w)
  })
  _shadeMat = new THREE.MeshBasicMaterial({
    map: t,
    color: '#33411f',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  return _shadeMat
}

/** rows: [x, groundY, z, radius] */
function bakeShade(rows) {
  const mesh = new THREE.InstancedMesh(SHADE_GEO, shadeMat(), rows.length)
  for (let i = 0; i < rows.length; i++) {
    const [x, y, z, rad] = rows[i]
    _o.position.set(x, y + 0.012, z)
    _o.rotation.set(0, 0, 0)
    _o.scale.set(rad, 1, rad)
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.renderOrder = 1
  return mesh
}

/**
 * Subscribes to the foliage knobs and returns a version that invalidates every
 * foliage useMemo below. Geometry is rebuilt here rather than inside each memo
 * so the three components share one rebuild per change, not three.
 */
function useFoliageBuild() {
  const v = useSyncExternalStore(subscribeFoliage, foliageVersion, foliageVersion)
  return useMemo(() => {
    if (v > 0) {
      rebuildFoliageGeo()
      // NOT MAT.foliage/MAT.crown — LEAF_MAT is deliberately white and every
      // clump carries its own linear colour, which bake() divides the base out
      // of. Tinting it would apply the leaf ramp twice. The green knobs reach
      // the screen through foliage.js's refreshStops() instead.
      MAT.flowerWhite.color.set(F.flowerWhite)
      MAT.flowerPink.color.set(F.flowerPink)
      MAT.flowerYellow.color.set(F.flowerYellow)
    }
    return v
  }, [v])
}

/**
 * Split a plant list into spatial cells, ONE InstancedMesh set per cell.
 *
 * This is the whole frustum-culling fix and it needs no culling code. three
 * culls an InstancedMesh by its own boundingSphere (computed lazily off the
 * instance matrices), so the park's 80 trees baked into one mesh had a sphere
 * covering the entire park — never outside the frustum, so every crown
 * triangle was submitted every frame, main pass AND shadow pass. The chase
 * lens is 20.5 degrees; it sees a small wedge of a ~90m park.
 *
 * The trade is draw calls: ~12 occupied cells x 3-4 buckets instead of 4. Draw
 * calls are not the bottleneck here — 2.8M crown triangles are — and the cells
 * outside the wedge cost nothing at all.
 *
 * The item's ORIGINAL index rides along, because every seed in this file is
 * `base + i * stride` and regrouping the list must not renumber it. Byte
 * identical rows, different meshes.
 */
const CELL = 24
function byCell(items) {
  const m = new Map()
  items.forEach((it, i) => {
    const k = `${Math.floor(it.x / CELL)},${Math.floor(it.z / CELL)}`
    const g = m.get(k)
    if (g) g.push([it, i])
    else m.set(k, [[it, i]])
  })
  return [...m.values()]
}

function Clumps({ buckets, receive = false }) {
  const meshes = useMemo(
    () =>
      Object.entries(buckets)
        .filter(([, rows]) => rows.length > 0)
        .map(([key, rows]) => bake(key, rows, receive)),
    [buckets, receive],
  )
  return meshes.map((m, i) => <primitive key={i} object={m} dispose={null} />)
}

export function Trees() {
  const v = useFoliageBuild()
  const { cells, shade } = useMemo(() => {
    const cells = byCell(TREES).map((group) => {
      const b = newBuckets()
      group.forEach(([t, i]) => pushTree(b, t.x, t.base || 0, t.z, t.s, t.r, prng(9001 + i * 977)))
      return b
    })
    return {
      cells,
      shade: bakeShade(TREES.map((t) => [t.x, t.base || 0, t.z, 1.7 * t.s])),
    }
    // v is the rebuild key from the foliage knobs — nothing inside the memo
    // references it, so eslint cannot see that it is load-bearing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  return (
    <>
      {cells.map((b, i) => (
        <Clumps key={i} buckets={b} />
      ))}
      <primitive object={shade} dispose={null} />
    </>
  )
}

export function Shrubs() {
  const v = useFoliageBuild()
  const { cells, shade } = useMemo(() => {
    const cells = byCell(SHRUBS).map((group) => {
      const b = newBuckets()
      group.forEach(([s, i]) => pushBush(b, s.x, s.base || 0, s.z, s.s, s.r, prng(4243 + i * 613)))
      return b
    })
    return {
      cells,
      shade: bakeShade(SHRUBS.map((s) => [s.x, s.base || 0, s.z, 0.85 * s.s])),
    }
    // v is the rebuild key from the foliage knobs — nothing inside the memo
    // references it, so eslint cannot see that it is load-bearing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  return (
    <>
      {cells.map((b, i) => (
        <Clumps key={i} buckets={b} receive />
      ))}
      <primitive object={shade} dispose={null} />
    </>
  )
}

/** Advances the shared wind clock. One uniform, every plant in the park. */
export function Wind({ strength = 1 }) {
  useFrame((_, delta) => {
    WIND.uStrength.value = strength
    // photo mode pins the clock so every capture of a pose is identical
    WIND.uTime.value = PHOTO ? PHOTO_TIME : WIND.uTime.value + Math.min(delta, 0.1)
  })
  return null
}

// ---------------------------------------------------------------- planters
const LIP = 0.26 // width of the stone rail that frames the top edge
const LIP_H = 0.2

export function Planters() {
  const v = useFoliageBuild()
  const cells = useMemo(() => byCell(PLANTERS).map((group) => {
    const b = newBuckets()
    group.forEach(([p, i]) => {
      // TWO streams per planter, and the split is a bug fix, not tidying. There
      // used to be one `rnd` handed to pushTree FIRST and pushBed second, so the
      // bed's draw started at whatever offset the tree happened to leave the
      // sequence at — and a tree edit is always a change to how many values the
      // tree consumes. Raising the crown clump counts therefore RE-RANDOMISED
      // every rosette, berry knot and daisy in every planted bed: a pixel diff
      // of that round measured the static planter frame at 1.5% changed and the
      // bed interior at 50-69%, on tables that were byte-identical. The lawn
      // trees and lawn shrubs were never exposed to this — they already take a
      // per-instance stream — so only the planters could be hit, and they were.
      //
      // Same seed base for the bed as the old shared stream, now dedicated: the
      // bed is drawn from offset 0 and no tree change can reach it again.
      const bedRnd = prng(7331 + i * 613)
      const treeRnd = prng(8101 + i * 613)
      const soil = (p.base || 0) + p.h + 0.01
      // inner rectangle: the bed the stone lip frames
      const iw = Math.max(0.6, p.w - LIP * 2)
      const id = Math.max(0.6, p.d - LIP * 2)
      if (p.plant === 'tree') {
        // 'blossom' by NAME, not by draw. A planter tree used to take a random
        // species, and two thirds of the time that is broadleaf or slim — both
        // of which are LAWN trees, with a 2.5-3.4m trunk. In a 1.4m planter that
        // renders as a tall narrow cone on a pole, which is what the last
        // capture showed and the opposite of the reference's low wide flowering
        // tree standing in its own bed. blossom is the species that shape was
        // authored for (trunkH 2.0, the widest branch tilt and the biggest core)
        // and it is the one that carries the pink crown speckle densest.
        pushTree(b, p.x, soil, p.z, 0.92, treeRnd() * TAU, treeRnd, 'blossom')
        // Under-planting, not a ring of shrubs on bare earth. `hole` keeps the
        // trunk clear; without it the tree looks like it is growing out of a
        // hedge rather than standing in one.
        const sites = pushBed(b, p.x, soil, p.z, iw, id, bedRnd, 1, {
          fill: 0.9, rise: 0.3, hole: 0.42,
        })
        // 0.9 -> 2.6 -> 11 -> 5.8. This was set when the bed under a tree was thought
        // of as quiet ground cover; in the reference the tree's own bed carries
        // the DENSEST yellow in the frame (4.5% of those pixels against the
        // plain bed's 2.9%), and at 0.9 a 3m planter was rendering about four
        // knots total. `sites` seats every one of them on a rosette.
        // 5.8 -> 10.1, the same 1.74x the plain bed's default took when the knot
        // came down to a third of its area — see pushBlooms.
        pushBlooms(b, p.x, soil, p.z, iw, id, bedRnd, 1, { per: 10.1, rise: 0.3, sites })
      } else {
        const sites = pushBed(b, p.x, soil, p.z, iw, id, bedRnd)
        pushBlooms(b, p.x, soil, p.z, iw, id, bedRnd, 1, { sites })
      }
    })
    return b
    // v is the rebuild key from the foliage knobs — nothing inside the memo
    // references it, so eslint cannot see that it is load-bearing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [v])

  return (
    <group>
      {PLANTERS.map((p, i) => {
        const base = p.base || 0
        const top = base + p.h
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <RoundedBox
              args={[p.w, p.h, p.d]}
              radius={0.1}
              smoothness={2}
              bevelSegments={3}
              position={[0, base + p.h / 2, 0]}
              material={MAT.masonry}
              castShadow
              receiveShadow
            />
            {/* four rails instead of a slab so the top stays open for planting */}
            {[
              [0, (p.d + 0.24) / 2 - LIP / 2, p.w + 0.24, LIP],
              [0, -(p.d + 0.24) / 2 + LIP / 2, p.w + 0.24, LIP],
              [(p.w + 0.24) / 2 - LIP / 2, 0, LIP, p.d + 0.24],
              [-(p.w + 0.24) / 2 + LIP / 2, 0, LIP, p.d + 0.24],
            ].map(([lx, lz, lw, ld], k) => (
              <RoundedBox
                key={k}
                args={[lw, LIP_H, ld]}
                radius={0.065}
                smoothness={2}
                bevelSegments={2}
                position={[lx, top - LIP_H / 2, lz]}
                material={MAT.cap}
                castShadow
                receiveShadow
              />
            ))}
            <RoundedBox
              args={[p.w - LIP * 2, 0.26, p.d - LIP * 2]}
              radius={0.05}
              smoothness={2}
              bevelSegments={1}
              position={[0, top - 0.12, 0]}
              material={MAT.soil}
              receiveShadow
            />
          </group>
        )
      })}
      {cells.map((b, i) => (
        <Clumps key={i} buckets={b} receive />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- benches
// A slat is one board, so its grain must run along its LENGTH — woodMap paints
// planks along canvas v, so v = local x and u = the short axis.
//
// It rides ONE plank of the seven, and which one is measured, not picked: 6 is
// the darkest tone in the tile (RAMP.wood at 0.20), and a slat is parked on its
// CENTRE with only ±0.04 canvas of span, or the black plank-edge line would run
// as a groove down the middle of every slat. v starts just past that plank's
// butt seam (0.459) so the seam falls off the end: the slat spans 0.83 canvas,
// leaves 0.17 of slack, and one seam per slat lands in the SAME place on all
// seven — a straight crack across the whole bench.
const WOOD_K = 0.12
const WOOD_U = 0.9286 / 4 // canvas u 0.929 = the centre of plank 6
const WOOD_V = 0.539 / 4 // canvas v 0.539 = clear of plank 6's butt seam (0.459)
const slatGeo = (len, h, d, across) => {
  const g = new RoundedBoxGeometry(len, h, d, 3, 0.042)
  const pos = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    const a = across === 1 ? pos.getY(i) : pos.getZ(i)
    uv.setXY(i, WOOD_U + a * WOOD_K, WOOD_V + (pos.getX(i) + len / 2) * WOOD_K)
  }
  uv.needsUpdate = true
  return g
}
const SEAT_SLAT = slatGeo(1.72, 0.095, 0.17, 2)
const BACK_SLAT = slatGeo(1.72, 0.17, 0.09, 1)
const BAR = new THREE.CylinderGeometry(0.044, 0.044, 1, 16)
const ARM_CURL = new THREE.TorusGeometry(0.11, 0.032, 10, 18, Math.PI / 2)
// bolt heads where each slat meets the frame, and pads under the legs
const BOLT = new THREE.CylinderGeometry(0.019, 0.023, 0.013, 10)
const FOOT = new THREE.CylinderGeometry(0.062, 0.07, 0.022, 12)

const SEAT_Z = [-0.26, -0.09, 0.08, 0.25]
const BACK_Y = [0.54, 0.68, 0.82]
const BACK_TILT = -0.16

// One side frame, mirrored onto both ends. The front leg runs unbroken from
// the ground into the armrest curl.
const benchFrame = (side) => {
  const x = side * 0.72
  const iron = (pos, rot, scale) => ({ geo: BAR, mat: MAT.iron, pos, rot, scale })
  return [
    iron([x, 0.275, 0.22], null, [1, 0.55, 1]),
    iron([x, 0.21, -0.26], null, [1, 0.42, 1]),
    iron([x, 0.38, -0.02], [Math.PI / 2, 0, 0], [1, 0.64, 1]),
    iron([x, 0.66, -0.32], [BACK_TILT, 0, 0], [1, 0.56, 1]),
    iron([x, 0.66, -0.05], [Math.PI / 2, 0, 0], [1, 0.5, 1]),
    { geo: ARM_CURL, mat: MAT.iron, pos: [x, 0.55, 0.11], rot: [0, -Math.PI / 2, 0] },
    { geo: FOOT, mat: MAT.iron, pos: [x, 0.011, 0.22] },
    { geo: FOOT, mat: MAT.iron, pos: [x, 0.011, -0.26] },
    // one bolt per slat end, sitting just proud of the wood
    ...SEAT_Z.map((z) => ({ geo: BOLT, mat: MAT.iron, pos: [x, 0.466, z] })),
    ...BACK_Y.map((y) => ({
      geo: BOLT,
      mat: MAT.iron,
      pos: [x, y, -0.253 + (y - 0.54) * BACK_TILT],
      rot: [Math.PI / 2 + BACK_TILT, 0, 0],
    })),
  ]
}

const BENCH_PARTS = [
  ...SEAT_Z.map((z) => ({ geo: SEAT_SLAT, mat: MAT.wood, pos: [0, 0.415, z], receive: true })),
  ...BACK_Y.map((y) => ({
    geo: BACK_SLAT,
    mat: MAT.wood,
    pos: [0, y, -0.3 + (y - 0.54) * BACK_TILT],
    rot: [BACK_TILT, 0, 0],
    receive: true,
  })),
  ...benchFrame(1),
  ...benchFrame(-1),
]

export function Benches() {
  const meshes = useMemo(() => instanceProp(BENCH_PARTS, BENCHES), [])
  return <Instanced meshes={meshes} />
}

// ---------------------------------------------------------------- textures
function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  draw(cv.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

const dot = (g, x, y, r) => {
  g.beginPath()
  g.arc(x, y, r, 0, TAU)
  g.fill()
}

function bannerTexture(kind) {
  return canvasTexture(128, 224, (g, w, h) => {
    g.fillStyle = C.bannerPink
    g.fillRect(0, 0, w, h)
    g.strokeStyle = C.bannerCream
    g.lineWidth = 7
    g.strokeRect(11, 11, w - 22, h - 22)
    g.fillStyle = C.bannerCream
    const cx = w / 2
    const cy = h / 2
    if (kind === 'skate') {
      g.save()
      g.translate(cx, cy - 6)
      g.rotate(-0.16)
      g.beginPath()
      g.roundRect(-38, -10, 76, 20, 10)
      g.fill()
      dot(g, -19, 22, 8)
      dot(g, 19, 22, 8)
      g.restore()
    } else {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU - Math.PI / 2
        dot(g, cx + Math.cos(a) * 25, cy + Math.sin(a) * 25, 17)
      }
      g.fillStyle = C.flowerYellow
      dot(g, cx, cy, 14)
    }
  })
}

const BANNER_MAT = {
  skate: new THREE.MeshStandardMaterial({ map: bannerTexture('skate'), side: THREE.DoubleSide, ...M.cloth }),
  flower: new THREE.MeshStandardMaterial({ map: bannerTexture('flower'), side: THREE.DoubleSide, ...M.cloth }),
}

// Flat plane pushed into a soft S so the cloth reads as hanging, not stamped on.
const BANNER_GEO = (() => {
  const g = new THREE.PlaneGeometry(0.55, 0.95, 6, 10)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const t = (p.getY(i) + 0.475) / 0.95 // 0 at the hem, 1 at the hanging edge
    p.setZ(i, 0.1 * Math.sin(t * Math.PI * 1.7 + 0.45) * (1 - t * 0.4) + 0.022 * Math.cos(x * 8))
  }
  g.computeVertexNormals()
  return g
})()

const CREAM = '#fdf5ea'
const MINT = '#9fd9c4'
const murals = new Map()

function drawMural(kind, g) {
  g.globalAlpha = 0.78
  if (kind === 'flower') {
    g.strokeStyle = MINT
    g.lineWidth = 11
    g.beginPath()
    g.moveTo(128, 130)
    g.quadraticCurveTo(136, 190, 128, 226)
    g.stroke()
    g.fillStyle = MINT
    for (const [lx, ly, rot] of [[92, 198, -0.55], [166, 206, 0.55]]) {
      g.save()
      g.translate(lx, ly)
      g.rotate(rot)
      g.beginPath()
      g.ellipse(0, 0, 30, 14, 0, 0, TAU)
      g.fill()
      g.restore()
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2
      const px = 128 + Math.cos(a) * 56
      const py = 108 + Math.sin(a) * 56
      g.fillStyle = C.flowerPink
      dot(g, px, py, 45)
      g.fillStyle = CREAM
      dot(g, px - Math.cos(a) * 5, py - Math.sin(a) * 5, 33)
    }
    g.fillStyle = C.flowerYellow
    dot(g, 128, 108, 30)
  } else if (kind === 'rainbow') {
    g.lineWidth = 15
    const bands = [C.flowerPink, '#f7c6a4', C.flowerYellow, MINT, '#cbb8f0']
    bands.forEach((col, i) => {
      g.strokeStyle = col
      g.beginPath()
      g.arc(128, 188, 100 - i * 16, Math.PI, TAU)
      g.stroke()
    })
    g.fillStyle = CREAM
    for (const cx of [40, 216]) {
      dot(g, cx - 20, 196, 17)
      dot(g, cx, 186, 24)
      dot(g, cx + 20, 196, 17)
    }
  } else {
    g.fillStyle = MINT
    g.beginPath()
    g.moveTo(24, 104)
    g.quadraticCurveTo(34, 132, 72, 136)
    g.lineTo(184, 136)
    g.quadraticCurveTo(222, 132, 232, 104)
    g.quadraticCurveTo(216, 120, 184, 120)
    g.lineTo(72, 120)
    g.quadraticCurveTo(40, 120, 24, 104)
    g.closePath()
    g.fill()
    g.fillStyle = CREAM
    g.beginPath()
    g.roundRect(72, 134, 16, 18, 5)
    g.roundRect(168, 134, 16, 18, 5)
    g.fill()
    dot(g, 80, 164, 14)
    dot(g, 176, 164, 14)
  }
}

/** Cached pastel decal for the lavender masonry walls. */
// eslint-disable-next-line react-refresh/only-export-components
export function getMuralTexture(kind) {
  let t = murals.get(kind)
  if (!t) murals.set(kind, (t = canvasTexture(256, 256, (g) => drawMural(kind, g))))
  return t
}

// ---------------------------------------------------------------- lamp posts
const L = {
  plinth: new THREE.CylinderGeometry(0.3, 0.4, 0.16, 14),
  swell: new THREE.CylinderGeometry(0.2, 0.3, 0.2, 14),
  foot: new THREE.CylinderGeometry(0.135, 0.2, 0.3, 14),
  column: new THREE.CylinderGeometry(0.072, 0.135, 4.2, 14),
  collar: new THREE.TorusGeometry(0.115, 0.034, 6, 16),
  neck: new THREE.CylinderGeometry(0.135, 0.085, 0.18, 12),
  shoulder: new THREE.CylinderGeometry(0.2, 0.135, 0.12, 8),
  glass: new THREE.CylinderGeometry(0.155, 0.205, 0.44, 8),
  crown: new THREE.CylinderGeometry(0.1, 0.235, 0.2, 8),
  finial: new THREE.SphereGeometry(0.075, 10, 8),
  tip: new THREE.CylinderGeometry(0, 0.05, 0.14, 8),
  arm: new THREE.CylinderGeometry(0.036, 0.036, 1, 9),
}

const LAMP_PARTS = [
  { geo: L.plinth, mat: MAT.lamp, pos: [0, 0.08, 0], receive: true },
  { geo: L.swell, mat: MAT.lamp, pos: [0, 0.26, 0] },
  { geo: L.foot, mat: MAT.lamp, pos: [0, 0.51, 0] },
  { geo: L.column, mat: MAT.lamp, pos: [0, 2.76, 0] },
  { geo: L.collar, mat: MAT.lamp, pos: [0, 2.5, 0], rot: [Math.PI / 2, 0, 0] },
  { geo: L.neck, mat: MAT.lamp, pos: [0, 4.95, 0] },
  { geo: L.shoulder, mat: MAT.lamp, pos: [0, 5.1, 0] },
  { geo: L.glass, mat: MAT.glass, pos: [0, 5.38, 0], cast: false },
  { geo: L.crown, mat: MAT.lamp, pos: [0, 5.7, 0] },
  { geo: L.finial, mat: MAT.lamp, pos: [0, 5.85, 0] },
  { geo: L.tip, mat: MAT.lamp, pos: [0, 5.96, 0] },
]

const bannerParts = (side, kind) => [
  { geo: L.arm, mat: MAT.lamp, pos: [side * 0.36, 3.56, 0], rot: [0, 0, Math.PI / 2], scale: [1, 0.72, 1] },
  { geo: L.finial, mat: MAT.lamp, pos: [side * 0.72, 3.56, 0], scale: [0.62, 0.62, 0.62] },
  { geo: BANNER_GEO, mat: BANNER_MAT[kind], pos: [side * 0.4, 3.045, 0], receive: true },
]

export function LampPosts() {
  const meshes = useMemo(() => {
    const out = instanceProp(LAMP_PARTS, LAMPS)
    // banners alternate sides and come in two prints, so each (kind, side)
    // pair bakes as its own small batch
    const groups = new Map()
    LAMPS.forEach((l, i) => {
      if (!l.banner) return
      const side = i % 2 ? -1 : 1
      const key = `${l.banner}${side}`
      const g = groups.get(key)
      if (g) g.spots.push(l)
      else groups.set(key, { side, kind: l.banner, spots: [l] })
    })
    for (const g of groups.values()) out.push(...instanceProp(bannerParts(g.side, g.kind), g.spots))
    return out
  }, [])
  return <Instanced meshes={meshes} />
}
