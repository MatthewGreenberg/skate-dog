// Authored grind paths. Each rail is a polyline with cumulative arc length, so
// grinding is just "advance s along the path" — no physics, no jitter.

import * as THREE from 'three'
import { RAILS } from './levelData.js'

export const PATHS = RAILS.map((r) => {
  const pts = r.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  const segs = []
  let len = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const dir = new THREE.Vector3().subVectors(pts[i + 1], pts[i])
    const l = dir.length()
    if (l < 1e-4) continue
    dir.divideScalar(l)
    segs.push({ a: pts[i], dir, len: l, start: len })
    len += l
  }
  const mid = new THREE.Vector3()
  for (const p of pts) mid.add(p)
  mid.divideScalar(pts.length)
  let radius = 0
  for (const p of pts) radius = Math.max(radius, p.distanceTo(mid))
  return { ...r, pts, segs, length: len, mid, radius }
})

const _a = new THREE.Vector3()

/** Position + tangent at arc length s. Writes into outPos / outTan. */
export function railAt(rail, s, outPos, outTan) {
  const t = Math.min(Math.max(s, 0), rail.length)
  let seg = rail.segs[rail.segs.length - 1]
  for (let i = 0; i < rail.segs.length; i++) {
    const g = rail.segs[i]
    if (t <= g.start + g.len) {
      seg = g
      break
    }
  }
  outPos.copy(seg.a).addScaledVector(seg.dir, t - seg.start)
  if (outTan) outTan.copy(seg.dir)
  return outPos
}

/** Closest arc length on a rail to a world point, plus the distance to it. */
function closestOn(rail, x, y, z) {
  let best = { s: 0, d2: Infinity, tan: null }
  for (const g of rail.segs) {
    const px = x - g.a.x
    const py = y - g.a.y
    const pz = z - g.a.z
    let t = px * g.dir.x + py * g.dir.y + pz * g.dir.z
    t = Math.min(Math.max(t, 0), g.len)
    const cx = g.a.x + g.dir.x * t - x
    const cy = g.a.y + g.dir.y * t - y
    const cz = g.a.z + g.dir.z * t - z
    const d2 = cx * cx + cy * cy + cz * cz
    if (d2 < best.d2) best = { s: g.start + t, d2, tan: g.dir }
  }
  return best
}

const SNAP_XZ = 0.85 // how far sideways a grind will reach for you
const SNAP_UP = 0.75 // how far above the rail the dog can be
const SNAP_DOWN = 0.45
const ALIGN = 0.55 // |cos| between travel and the rail

/**
 * Find a grindable rail for the player. `feetY` is the bottom of the dog.
 * Returns { rail, s, dir } or null.
 */
export function findGrind(x, feetY, z, vx, vz) {
  const sp = Math.hypot(vx, vz)
  if (sp < 2.2) return null
  const fx = vx / sp
  const fz = vz / sp

  let best = null
  for (const rail of PATHS) {
    if (Math.abs(x - rail.mid.x) > rail.radius + 3) continue
    if (Math.abs(z - rail.mid.z) > rail.radius + 3) continue

    const hit = closestOn(rail, x, feetY, z)
    const p = railAt(rail, hit.s, _a)
    const dxz = Math.hypot(p.x - x, p.z - z)
    const dy = feetY - p.y
    if (dxz > SNAP_XZ || dy > SNAP_UP || dy < -SNAP_DOWN) continue

    const align = fx * hit.tan.x + fz * hit.tan.z
    if (Math.abs(align) < ALIGN) continue

    const score = dxz + Math.abs(dy) * 0.5
    if (!best || score < best.score) {
      best = { rail, s: hit.s, dir: align >= 0 ? 1 : -1, score }
    }
  }
  return best
}
