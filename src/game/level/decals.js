import * as THREE from 'three'
import { BOWL, PERIMETER } from './levelData.js'
import { groundHeightAt } from './colliders.js'
import { DECAL_COLS } from './textures.js'

// Floor detail — the marks that break up the empty plaza. They are NOT in the
// plaza texture on purpose: that map tiles every 8 m, so a drain baked into it
// is ~120 drains laid out on a perfect grid. These are scattered in WORLD space
// instead, as quads reading cells out of the decal atlas.
//
// One merged BufferGeometry, one draw call, ~400 triangles for the whole park.
// Deliberately not an InstancedMesh: instancing an atlas needs a per-instance uv
// offset attribute and an onBeforeCompile to consume it, and at this triangle
// count a merge is the same cost with none of the shader.

// Deterministic — same park every load, and the shoot harness sees what you saw.
function prng(seed) {
  let s = seed | 0
  return () => {
    // Math.imul: `s * 1103515245` overflows 2^53 near 2^31 and the low bits go
    // to noise. Same bug the foliage LCG shipped with; see CLAUDE.md.
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

// How many of each mark the park gets, how big it is in metres, and how boldly
// it is painted. The character marks are the headliners; the practical details
// (drains, weeds and grit) are sparse punctuation that keeps the plaza feeling
// like a place instead of a sticker sheet.
const KINDS = [
  { cell: 0, weight: 5, size: [2.0, 3.2], fade: [0.86, 1.0] }, // skating-dog mural
  { cell: 1, weight: 4, size: [1.3, 2.2], fade: [0.8, 1.0] }, // launch arrow
  { cell: 2, weight: 9, size: [0.9, 1.5], fade: [0.72, 0.96] }, // candy-colour paw trail
  { cell: 3, weight: 5, size: [0.7, 1.15], fade: [0.76, 1.0] }, // party paw
  { cell: 4, weight: 5, size: [1.8, 3.0], fade: [0.7, 0.92] }, // rainbow skid arc
  { cell: 5, weight: 5, size: [1.0, 1.8], fade: [0.74, 0.98] }, // landing starburst
  { cell: 6, weight: 4, size: [1.6, 2.7], fade: [0.82, 1.0] }, // chalk wheel badge
  { cell: 7, weight: 1, size: [0.9, 1.1], fade: [0.58, 0.8] }, // round drain
  { cell: 8, weight: 1, size: [0.9, 1.2], fade: [0.58, 0.8] }, // gully grate
  { cell: 9, weight: 3, size: [0.55, 1.0], fade: [0.62, 0.88] }, // flower weeds
  { cell: 10, weight: 7, size: [0.8, 1.5], fade: [0.7, 0.96] }, // confetti drift
  { cell: 11, weight: 3, size: [1.7, 2.8], fade: [0.78, 1.0] }, // color hopscotch
  { cell: 12, weight: 5, size: [1.2, 2.0], fade: [0.8, 1.0] }, // party dog chalk
  { cell: 13, weight: 7, size: [0.7, 1.25], fade: [0.82, 1.0] }, // sticker bomb
  { cell: 14, weight: 4, size: [1.7, 2.8], fade: [0.74, 0.98] }, // chalk rainbow
  { cell: 15, weight: 2, size: [0.7, 1.2], fade: [0.55, 0.78] }, // grit
]
const TOTAL_W = KINDS.reduce((a, k) => a + k.weight, 0)

const CLUSTERS = 46
const PER_CLUSTER = [2, 7]
const MARGIN = 1.5 // keep decals off the kerb
// A decal only goes on FLAT PLAZA. groundHeightAt already knows about every
// deck, ramp, planter and the bowl, so all five corners landing at ~0 is the
// whole placement rule — no second footprint table to drift out of sync.
const FLAT_EPS = 0.02

// Sampled as a GRID, not at the four corners. Corners-only shipped broken: the
// park is full of things narrower than a decal — planter rims, ledges, rail
// posts — and a 0.95m planter fits neatly between two corner samples of a 2m
// quad, which puts a chalk drawing up the side of it. STEP is under the
// thinnest thing in the park.
const STEP = 0.35

function fits(x, z, half) {
  const P = PERIMETER
  // `half`, not just MARGIN: the test is on the CENTRE but the quad is what has
  // to stay in bounds, and a 3.4m dirt patch hung 0.5m out over the kerb.
  const e = MARGIN + half
  if (x < P.minX + e || x > P.maxX - e || z < P.minZ + e || z > P.maxZ - e) return false
  const n = Math.max(1, Math.ceil(half / STEP))
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (Math.abs(groundHeightAt(x + (i / n) * half, z + (j / n) * half)) > FLAT_EPS) return false
    }
  }
  return true
}

/**
 * Merged quads for every floor decal in the park. Vertex colour carries a
 * per-decal tint and fade so 16 atlas cells do not read as 16 rubber stamps —
 * the material is white and multiplies it in.
 */
export function buildDecalGeometry() {
  const rnd = prng(90210)
  const pos = []
  const uv = []
  const col = []
  const idx = []
  const cw = 1 / DECAL_COLS
  const gut = cw * 0.06

  for (let c = 0; c < CLUSTERS; c++) {
    // Reroll the CENTRE until it lands on open floor. Without this a cluster
    // that opens on a deck loses every one of its members and the park ends up
    // with two thirds the decals for no visible reason — decks and the bowl are
    // most of the plaza's area.
    let cx = 0
    let cz = 0
    for (let t = 0; t < 12; t++) {
      cx = PERIMETER.minX + rnd() * (PERIMETER.maxX - PERIMETER.minX)
      cz = PERIMETER.minZ + rnd() * (PERIMETER.maxZ - PERIMETER.minZ)
      if (fits(cx, cz, 0.8)) break
    }
    const spread = 1.5 + rnd() * 3.5
    const n = PER_CLUSTER[0] + Math.floor(rnd() * (PER_CLUSTER[1] - PER_CLUSTER[0] + 1))

    for (let i = 0; i < n; i++) {
      // weighted draw over KINDS
      let r = rnd() * TOTAL_W
      let kind = KINDS[0]
      for (const k of KINDS) if ((r -= k.weight) <= 0) { kind = k; break }

      const size = kind.size[0] + rnd() * (kind.size[1] - kind.size[0])
      const a = rnd() * 6.283
      const d = Math.sqrt(rnd()) * spread
      const px = cx + Math.cos(a) * d
      const pz = cz + Math.sin(a) * d
      // the quad rotates, so the clearance test takes its half-DIAGONAL
      if (!fits(px, pz, size * 0.708)) continue

      const yaw = rnd() * 6.283
      const cs = Math.cos(yaw) * size * 0.5
      const sn = Math.sin(yaw) * size * 0.5
      // Character art is allowed to sing; utilitarian marks stay quieter. The
      // atlas still supplies soft/worn alpha, so even a fade of 1 is paint on
      // concrete rather than an opaque card.
      const f = kind.fade[0] + rnd() * (kind.fade[1] - kind.fade[0])
      const warm = 0.97 + rnd() * 0.06
      const base = pos.length / 3
      const cellX = (kind.cell % DECAL_COLS) * cw + gut
      const cellY = 1 - (Math.floor(kind.cell / DECAL_COLS) + 1) * cw + gut // v=1 is the TOP of the canvas
      const inner = cw - gut * 2

      for (const [sx, sz, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
        pos.push(px + sx * cs - sz * sn, 0, pz + sx * sn + sz * cs)
        uv.push(cellX + u * inner, cellY + v * inner)
        // ALPHA carries the fade, not RGB. Scaling RGB would make a faint chalk
        // mark a DARK chalk mark — the one thing a light decal must not do.
        col.push(warm, 1, 2 - warm, f)
      }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  // itemSize 4: three reads vColor as a vec4 and the material picks up vertex
  // ALPHA, which is what the per-decal fade rides on
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4))
  // every quad is flat on the floor, so the normal is a constant — cheaper than
  // computeVertexNormals and immune to a degenerate quad
  const nrm = new Float32Array(pos.length)
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setIndex(idx)
  return g
}

// The editor remounts pieces of the park as authored rows change. Decal
// placement still consults the level once, when the park first appears, so the
// shipped layout avoids decks and the pool; after that it must be scenery, not
// a live layout solver. Reusing this geometry keeps every doodle at the same
// world coordinate while pieces are placed, moved, or deleted.
let fixedGeometry = null
export function fixedDecalGeometry() {
  return (fixedGeometry ??= buildDecalGeometry())
}

// Return the fixed scatter with whole doodles hidden wherever the current pool
// could cover them. Bounding circles are deliberately conservative: clipping a
// chalk dog at the coping looks like it is floating over the water, while
// hiding the whole mark leaves an ordinary patch of bare concrete. The source
// geometry is never changed, so moving the pool can only hide/reveal a doodle;
// it cannot move one.
export function poolSafeDecalGeometry() {
  const source = fixedDecalGeometry()
  const g = source.clone()
  if (!BOWL.on) return g

  // Each harmonic is bounded by its absolute amplitude, so this is a strict
  // upper bound for every bearing rather than a sampled approximation.
  const poolRadius = BOWL.r0 * (1 + BOWL.harmonics.reduce((sum, [amplitude]) => sum + Math.abs(amplitude), 0))

  const pos = source.getAttribute('position')
  const kept = []
  const quads = pos.count / 4
  for (let q = 0; q < quads; q++) {
    const base = q * 4
    let cx = 0
    let cz = 0
    for (let i = 0; i < 4; i++) {
      cx += pos.getX(base + i)
      cz += pos.getZ(base + i)
    }
    cx /= 4
    cz /= 4
    const halfDiagonal = Math.hypot(pos.getX(base) - cx, pos.getZ(base) - cz)
    const clear = poolRadius + halfDiagonal
    if ((cx - BOWL.cx) ** 2 + (cz - BOWL.cz) ** 2 <= clear * clear) continue
    kept.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  g.setIndex(kept)
  return g
}

export { CLUSTERS } // for the check
