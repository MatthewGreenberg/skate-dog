// Authored grind paths. Each rail is a polyline with cumulative arc length, so
// grinding is just "advance s along the path" — no physics, no jitter.

import * as THREE from 'three'
import { RAILS, WALLS, PLANTERS } from './levelData.js'

// ---------------------------------------------------------------- lip edges
// Every wall cap and planter rim is grindable. These are derived, not authored:
// the lip you can already see IS the path, so nothing new is drawn and
// Skatepark still renders only RAILS. Ends are trimmed so a lock-on can't
// happen out past a corner, hanging the dog off the end of the lip.
const TRIM = 0.35
const EDGE_IN = 0.06 // how far in from the lip the path sits
// The drawn stone overhangs the masonry it caps — Skatepark's wall cap is
// w + 0.18, Props' planter rim spans p.w + 0.24. Offsetting off the raw box
// would put the grind line a hand's width inside the visible lip.
const CAP_OUT = 0.09
const RIM_OUT = 0.12

function lipEdges() {
  const out = []
  WALLS.forEach((w, i) => {
    // levelData yaws local +Z to (sin rot, cos rot), so local +X is
    // (cos rot, -sin rot). Both top EDGES, not the centreline: you grind the
    // lip with the dog's side hanging over the face, the way a board does.
    // A centreline path put the whole dog in the middle of the cap. They sit
    // ~1.1 apart, so each edge is comfortably the nearest one from its own
    // side and they never fight over a lock-on.
    const alongZ = w.d >= w.w
    const half = (alongZ ? w.d : w.w) / 2 - TRIM
    if (half < 0.5) return // a stub cap (the deck-front dividers) is not a line
    const c = Math.cos(w.rot)
    const s = Math.sin(w.rot)
    const ax = alongZ ? s : c
    const az = alongZ ? c : -s
    // sideways offset to the lip, pulled in EDGE_IN so the path is on the
    // stone rather than off the corner in mid-air
    const off = (alongZ ? w.w : w.d) / 2 + CAP_OUT - EDGE_IN
    const bx = alongZ ? c : s
    const bz = alongZ ? -s : c
    // Skatepark puts the cap's top at w.h absolutely (bodyH = h - base - capH),
    // so `base` does NOT add here.
    const y = w.h
    for (const side of [-1, 1]) {
      const ox = bx * off * side
      const oz = bz * off * side
      out.push({
        id: `wallcap${i}_${side > 0 ? 'a' : 'b'}`,
        pts: [
          [w.x + ox - ax * half, y, w.z + oz - az * half],
          [w.x + ox + ax * half, y, w.z + oz + az * half],
        ],
      })
    }
  })
  PLANTERS.forEach((p, i) => {
    const y = (p.base || 0) + p.h
    const hx = p.w / 2 + RIM_OUT - EDGE_IN
    const hz = p.d / 2 + RIM_OUT - EDGE_IN
    // Four separate runs, not one closed loop: a loop would snap the heading
    // 90 degrees at every corner. You grind a side and pop off the end.
    const corners = [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ]
    for (let k = 0; k < 4; k++) {
      const a = corners[k]
      const b = corners[(k + 1) % 4]
      const t = TRIM
      const ux = Math.sign(b[0] - a[0])
      const uz = Math.sign(b[1] - a[1])
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) - 2 * t
      if (len < 1) continue
      out.push({
        id: `planter${i}_${k}`,
        pts: [
          [p.x + a[0] + ux * t, y, p.z + a[1] + uz * t],
          [p.x + a[0] + ux * (t + len), y, p.z + a[1] + uz * (t + len)],
        ],
      })
    }
  })
  return out
}

export const PATHS = []

// Refilled IN PLACE by the level editor (PlayerController holds the array by
// reference). Called once here so module load is unchanged.
export function rebuildPaths() {
  PATHS.length = 0
  for (const r of [...RAILS, ...lipEdges()]) {
      const pts = r.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
      const segs = []
      let len = 0
      for (let i = 0; i < pts.length - 1; i++) {
        const dir = new THREE.Vector3().subVectors(pts[i + 1], pts[i])
        const l = dir.length()
        // NOT `l < 1e-4`: a row missing `rot` makes every coordinate NaN, and
        // NaN fails that test, so the degenerate segment was KEPT — with a NaN
        // tangent that then lost every `d2 < best.d2` in closestOn and left
        // findGrind holding a null tan. Written this way NaN is dropped here.
        if (!(l > 1e-4)) continue
        dir.divideScalar(l)
        segs.push({ a: pts[i], dir, len: l, start: len })
        len += l
      }
      const mid = new THREE.Vector3()
      for (const p of pts) mid.add(p)
      mid.divideScalar(pts.length)
      let radius = 0
      for (const p of pts) radius = Math.max(radius, p.distanceTo(mid))
    PATHS.push({ ...r, pts, segs, length: len, mid, radius })
  }
}
rebuildPaths()

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
    // No segment won, so there is nothing to grind and no tangent to align
    // against. Belt to the NaN brace above: the editor can author a row into
    // this array at any time, and a bad row must not be able to crash the sim.
    if (!hit.tan) continue
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
