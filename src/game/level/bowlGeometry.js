import * as THREE from 'three'
import { BOWL, bowlRadius, bowlDepth } from './levelData.js'

// The bowl is an analytic height field. The visual mesh and the gameplay
// collision are generated from the same function, so the surface the player
// rides is exactly the surface that is drawn — no snapping between segments.
//
//   t  = inward distance from the coping
//   R  = transition radius at that bearing (= depth there)
//   y  = -sqrt(t * (2R - t))     for t < R      (circular quarter transition)
//   y  = floor blend             for t >= R

const TAU = Math.PI * 2
const FLOOR_BLEND = 3.2 // how far past the transition the floor keeps easing

// How many times the bowl texture wraps around the rim. At r0 = 5.85 this puts
// one repeat every ~3.7 m of coping, which is the scale the tile band in
// bowlMap() was painted for (26 tiles per repeat ~= a 140 mm tile).
const BOWL_U_REPEAT = 10

// Where the flat samples: inside the uniform strip bowlMap/bowlNormal/bowlRough
// all keep clear of detail (they fill below BOWL_FLAT = 0.76 with a flat
// value, and v is measured from the bottom, so anything under 0.24 is safe).
const BOWL_FLAT_V = 0.11

/** World (x,z) -> bowl-local polar. Returns null when outside the coping. */
export function bowlLocal(x, z) {
  const dx = x - BOWL.cx
  const dz = z - BOWL.cz
  const r = Math.hypot(dx, dz)
  const phi = Math.atan2(dz, dx)
  const r0 = bowlRadius(phi)
  return { r, phi, r0, t: r0 - r }
}

/** Height of the bowl surface at (x,z). Returns 0 outside the footprint. */
export function bowlHeight(x, z) {
  const { t, phi, r0 } = bowlLocal(x, z)
  if (t <= 0) return 0
  const R = bowlDepth(phi)
  if (t < R) return -Math.sqrt(Math.max(0, t * (2 * R - t)))
  // floor: ease from the transition lip toward the mean depth so shallow and
  // deep ends join with a gentle slope instead of a crease.
  const deepest = BOWL.depthMid + BOWL.depthAmp * 0.25
  const k = Math.min(1, (t - R) / Math.max(0.6, Math.min(FLOOR_BLEND, r0 - R)))
  return -(R + (deepest - R) * (k * k * (3 - 2 * k)))
}

export function isInsideBowl(x, z) {
  return bowlLocal(x, z).t > 0
}

const _n = new THREE.Vector3()
/** Analytic-ish surface normal via central differences. Cheap and stable. */
export function bowlNormal(x, z, out = _n) {
  const e = 0.12
  const dx = (bowlHeight(x + e, z) - bowlHeight(x - e, z)) / (2 * e)
  const dz = (bowlHeight(x, z + e) - bowlHeight(x, z - e)) / (2 * e)
  return out.set(-dx, 1, -dz).normalize()
}

/**
 * Radial mesh: RINGS_T rows through the transition, RINGS_F rows across the
 * floor, SEG columns around the perimeter. Enough subdivision to keep the
 * curvature clean at gameplay camera distance.
 */
export function buildBowlGeometry(SEG = 200, RINGS_T = 22, RINGS_F = 12) {
  const rows = RINGS_T + RINGS_F + 1
  const pos = new Float32Array(SEG * rows * 3)
  const nor = new Float32Array(SEG * rows * 3)
  const col = new Float32Array(SEG * rows * 3)
  const uv = new Float32Array(SEG * rows * 2)
  const n = new THREE.Vector3()

  let p = 0
  let q = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < SEG; i++) {
      const phi = (i / SEG) * TAU
      const r0 = bowlRadius(phi)
      const R = bowlDepth(phi)

      let t
      if (j <= RINGS_T) {
        // sample the transition by arc angle so the curve stays evenly tessellated
        const u = j / RINGS_T
        t = R * (1 - Math.cos((u * Math.PI) / 2))
      } else {
        const u = (j - RINGS_T) / RINGS_F
        // shrink the remaining interior toward the centroid
        t = R + (r0 - R) * (u * u * (3 - 2 * u)) * 0.999
      }
      const r = Math.max(0.0001, r0 - t)
      const x = BOWL.cx + Math.cos(phi) * r
      const z = BOWL.cz + Math.sin(phi) * r
      const y = bowlHeight(x, z)

      // baked occlusion: deeper is more enclosed, plus a contact line under
      // the coping lip where the transition meets the deck
      const openness = Math.min(1, Math.max(0, 1 + y / (R * 1.25)))
      let ao = 0.5 + 0.5 * Math.pow(openness, 0.6)
      ao *= 1 - 0.34 * Math.exp((-t * t) / 0.09)
      col[p] = col[p + 1] = col[p + 2] = ao

      pos[p] = x
      pos[p + 1] = y
      pos[p + 2] = z
      bowlNormal(x, z, n)
      nor[p] = n.x
      nor[p + 1] = n.y
      nor[p + 2] = n.z
      p += 3
      // Cylindrical, not planar. A top-down x/z projection stretches the
      // texture arbitrarily around the dish and smears it to nothing on the
      // near-vertical transition, and it gives the painter no way to say
      // "at the lip" or "on the flat" — which is exactly what a pool surface
      // needs, because the tile band, the polished ride line and the dirt that
      // settles in the deep end are all defined by depth, not by world
      // position. U runs around the rim (scaled by the local radius so tiles
      // stay square as the kidney narrows), V runs from lip to flat.
      // V is 1 at the coping and falls to 0 by the end of the transition.
      // three's default flipY means v=1 samples the TOP of the canvas, so the
      // tile band is painted there.
      //
      // The flat gets a PLANAR mapping instead, confined to the uniform band at
      // the bottom of the texture. Carrying the cylindrical mapping across the
      // flat looks correct on paper — the whole flat sits at v=0, which is a
      // uniform row — but every u collapses onto the bowl's centre, and the
      // material has no tangent attribute, so three derives the tangent frame
      // from screen-space UV derivatives. Those go singular at the pole and the
      // frame degenerates into a starburst radiating from the middle of the
      // bowl, visible even though the texture there is a single colour. Two
      // linearly-varying world-space UVs keep the frame well conditioned.
      if (j <= RINGS_T) {
        uv[q] = (phi / TAU) * (r0 / BOWL.r0) * BOWL_U_REPEAT
        uv[q + 1] = 1 - t / Math.max(0.0001, R)
      } else {
        uv[q] = (x - BOWL.cx) * 0.06
        uv[q + 1] = BOWL_FLAT_V + (z - BOWL.cz) * 0.004
      }
      q += 2
    }
  }

  const idx = []
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * SEG + i
      const b = j * SEG + ((i + 1) % SEG)
      const c = (j + 1) * SEG + i
      const d = (j + 1) * SEG + ((i + 1) % SEG)
      idx.push(a, c, b, b, c, d)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** Flat deck with the kidney punched out, so the plaza meets the coping cleanly. */
export function buildBowlApron(SEG = 200, out = 3.4) {
  const pos = new Float32Array(SEG * 2 * 3)
  const nor = new Float32Array(SEG * 2 * 3)
  const uv = new Float32Array(SEG * 2 * 2)
  for (let i = 0; i < SEG; i++) {
    const phi = (i / SEG) * TAU
    const r0 = bowlRadius(phi)
    for (let j = 0; j < 2; j++) {
      const r = r0 + j * out
      const x = BOWL.cx + Math.cos(phi) * r
      const z = BOWL.cz + Math.sin(phi) * r
      const k = (j * SEG + i) * 3
      pos[k] = x
      pos[k + 1] = 0
      pos[k + 2] = z
      nor[k + 1] = 1
      uv[(j * SEG + i) * 2] = x * 0.11
      uv[(j * SEG + i) * 2 + 1] = z * 0.11
    }
  }
  const idx = []
  for (let i = 0; i < SEG; i++) {
    const a = i
    const b = (i + 1) % SEG
    const c = SEG + i
    const d = SEG + ((i + 1) % SEG)
    idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** Rounded coping lip that rides the kidney outline. */
export function buildCopingGeometry(SEG = 200, TUBE = 10) {
  const w = BOWL.copingWidth
  const pos = []
  const nor = []
  const uv = []
  for (let i = 0; i < SEG; i++) {
    const phi = (i / SEG) * TAU
    const r0 = bowlRadius(phi)
    const cx = Math.cos(phi)
    const cz = Math.sin(phi)
    // approximate outward normal of the outline (radial is close enough here)
    for (let j = 0; j <= TUBE; j++) {
      // half-round profile: from the deck outside, over the lip, into the bowl
      const a = (j / TUBE) * Math.PI
      const off = Math.cos(a) * w * 0.5
      const up = Math.sin(a) * 0.13
      const r = r0 + off
      pos.push(BOWL.cx + cx * r, up, BOWL.cz + cz * r)
      const nx = cx * Math.cos(a)
      const nz = cz * Math.cos(a)
      const ny = Math.sin(a) * 2.4
      const l = Math.hypot(nx, ny, nz) || 1
      nor.push(nx / l, ny / l, nz / l)
      uv.push((i / SEG) * 26, j / TUBE)
    }
  }
  const idx = []
  const stride = TUBE + 1
  for (let i = 0; i < SEG; i++) {
    const i2 = (i + 1) % SEG
    for (let j = 0; j < TUBE; j++) {
      const a = i * stride + j
      const b = i2 * stride + j
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}
