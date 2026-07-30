// Simplified gameplay collision, authored separately from the visual meshes.
// Every solid is a rotated rectangle with a height function; stairs collide as
// smooth ramps; the bowl uses its analytic height field. A uniform grid does
// broad phase so we never test the whole park per frame.

import { SOLIDS, WALLS, PLANTERS, PERIMETER, BENCHES, LAMPS } from './levelData.js'
import { bowlHeight, bowlNormal, isInsideBowl } from './bowlGeometry.js'

export const STEP_UP = 0.55 // how far the player can be pulled up onto a ledge
const RAMP_OVER = 1.0 // ramp footprint overhang into the deck it feeds
const CELL = 6

const cols = []

function addRect(o) {
  const c = Math.cos(o.rot || 0)
  const s = Math.sin(o.rot || 0)
  const col = { ...o, c, s, hw: o.w / 2, hd: o.d / 2 }
  const ex = Math.abs(c) * col.hw + Math.abs(s) * col.hd
  const ez = Math.abs(s) * col.hw + Math.abs(c) * col.hd
  col.minX = o.x - ex
  col.maxX = o.x + ex
  col.minZ = o.z - ez
  col.maxZ = o.z + ez
  cols.push(col)
  return col
}

for (const s of SOLIDS) {
  if (s.kind === 'box') {
    addRect({ ...s, type: s.style === 'ledge' ? 'ledge' : 'concrete', shape: 'flat', top: s.top })
  } else {
    // shift + grow the footprint so the ramp overlaps the deck it feeds into
    const rot = s.rot
    addRect({
      ...s,
      x: s.x + Math.sin(rot) * (RAMP_OVER / 2),
      z: s.z + Math.cos(rot) * (RAMP_OVER / 2),
      d: s.d + RAMP_OVER,
      shape: 'ramp',
      run: s.d,
      type: s.kind === 'stairs' ? 'stairs' : 'ramp',
    })
  }
}

for (const w of WALLS) {
  addRect({ ...w, id: 'wall', shape: 'flat', type: 'cap', top: (w.base || 0) + w.h })
}
for (const p of PLANTERS) {
  addRect({ ...p, rot: p.rot || 0, id: 'planter', shape: 'flat', type: 'planter', top: (p.base || 0) + p.h })
}

// ------------------------------------------------------------ broad phase
const grid = new Map()
const key = (ix, iz) => ix * 8192 + iz
for (let i = 0; i < cols.length; i++) {
  const c = cols[i]
  for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
    for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
      const k = key(ix, iz)
      let a = grid.get(k)
      if (!a) grid.set(k, (a = []))
      a.push(c)
    }
  }
}
const EMPTY = []
function bucket(x, z) {
  return grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY
}

// ------------------------------------------------------------ height query
function localZ(c, x, z) {
  const dx = x - c.x
  const dz = z - c.z
  return { lx: c.c * dx - c.s * dz, lz: c.s * dx + c.c * dz }
}

function rampY(c, s) {
  const t = Math.min(Math.max(s, 0), c.run)
  const h = c.y1 - c.y0
  if (c.curve === 'quarter') {
    const R = (c.run * c.run + h * h) / (2 * h)
    return c.y0 + R - Math.sqrt(Math.max(0, R * R - t * t))
  }
  return c.y0 + (h * t) / c.run
}

function rampSlope(c, s) {
  const t = Math.min(Math.max(s, 0), c.run)
  const h = c.y1 - c.y0
  if (t >= c.run) return 0 // flat overhang on top
  if (c.curve === 'quarter') {
    const R = (c.run * c.run + h * h) / (2 * h)
    return t / Math.sqrt(Math.max(0.0001, R * R - t * t))
  }
  return h / c.run
}

/**
 * Highest walkable surface at (x,z) reachable from feetY.
 * Writes into `out` (no allocation) and returns it.
 */
const _out = { y: 0, nx: 0, ny: 1, nz: 0, type: 'concrete', slope: 0, inBowl: false, id: null }
export function sampleSurface(x, z, feetY, out = _out) {
  out.y = 0
  out.nx = 0
  out.ny = 1
  out.nz = 0
  out.type = 'concrete'
  out.slope = 0
  out.inBowl = false
  out.id = null

  if (isInsideBowl(x, z)) {
    out.y = bowlHeight(x, z)
    const n = bowlNormal(x, z)
    out.nx = n.x
    out.ny = n.y
    out.nz = n.z
    out.type = 'bowl'
    out.inBowl = true
    out.slope = Math.acos(Math.min(1, n.y))
    out.id = 'bowl'
  }

  const limit = feetY + STEP_UP
  for (const c of bucket(x, z)) {
    const { lx, lz } = localZ(c, x, z)
    if (Math.abs(lx) > c.hw || Math.abs(lz) > c.hd) continue

    if (c.shape === 'flat') {
      if (c.top <= limit && c.top > out.y) {
        out.y = c.top
        out.nx = 0
        out.ny = 1
        out.nz = 0
        out.slope = 0
        out.type = c.type
        out.inBowl = false
        out.id = c.id
      }
    } else {
      const s = lz + c.hd - RAMP_OVER / 2
      const y = rampY(c, s)
      if (y <= limit && y > out.y) {
        const k = rampSlope(c, s)
        const inv = 1 / Math.hypot(1, k)
        out.y = y
        out.nx = -c.s * k * inv
        out.ny = inv
        out.nz = -c.c * k * inv
        out.slope = Math.atan(k)
        out.type = c.type
        out.inBowl = false
        out.id = c.id
      }
    }
  }
  return out
}

/** Convenience for prop placement / spawn — ignores the step limit. */
export function groundHeightAt(x, z) {
  return sampleSurface(x, z, 1e6).y
}

// ------------------------------------------------------------ side collision
const _push = { x: 0, z: 0 }
/**
 * Push a circle out of anything whose top is too high to step onto.
 * Mutates `p` ({x,z}) and accumulates the correction into `push` so the caller
 * can kill the velocity into the wall and slide along it instead of sticking.
 */
export function resolveCollision(p, feetY, radius, push = _push) {
  let hit = false
  push.x = 0
  push.z = 0
  const limit = feetY + STEP_UP

  for (let pass = 0; pass < 2; pass++) {
    let moved = false
    for (const c of bucket(p.x, p.z)) {
      const top = c.shape === 'flat' ? c.top : Math.max(c.y0, c.y1)
      if (top <= limit) continue
      const dx = p.x - c.x
      const dz = p.z - c.z
      const lx = c.c * dx - c.s * dz
      const lz = c.s * dx + c.c * dz
      const qx = Math.min(Math.max(lx, -c.hw), c.hw)
      const qz = Math.min(Math.max(lz, -c.hd), c.hd)
      const ox = lx - qx
      const oz = lz - qz
      const d2 = ox * ox + oz * oz

      let nx, nz, depth
      if (d2 > 1e-8) {
        if (d2 >= radius * radius) continue
        const d = Math.sqrt(d2)
        nx = ox / d
        nz = oz / d
        depth = radius - d
      } else {
        // centre is inside the rect — eject along the shallowest axis
        const ex = c.hw - Math.abs(lx)
        const ez = c.hd - Math.abs(lz)
        if (ex < ez) {
          nx = Math.sign(lx) || 1
          nz = 0
          depth = ex + radius
        } else {
          nx = 0
          nz = Math.sign(lz) || 1
          depth = ez + radius
        }
      }
      const wx = (c.c * nx + c.s * nz) * depth
      const wz = (-c.s * nx + c.c * nz) * depth
      p.x += wx
      p.z += wz
      push.x += wx
      push.z += wz
      moved = hit = true
    }
    if (!moved) break
  }

  // park boundary
  const B = PERIMETER
  if (p.x < B.minX) (push.x += B.minX - p.x), (p.x = B.minX), (hit = true)
  else if (p.x > B.maxX) (push.x += B.maxX - p.x), (p.x = B.maxX), (hit = true)
  if (p.z < B.minZ) (push.z += B.minZ - p.z), (p.z = B.minZ), (hit = true)
  else if (p.z > B.maxZ) (push.z += B.maxZ - p.z), (p.z = B.maxZ), (hit = true)

  return hit
}

export const COLLIDERS = cols

// Footprints for the baked top-down occlusion map. Only things standing on the
// plaza contribute; anything already up on a deck would darken the wrong floor.
export const AO_FOOTPRINTS = [
  ...cols
    .filter((c) => (c.base || 0) < 0.2)
    .map((c) => ({
      x: c.x,
      z: c.z,
      hw: c.hw,
      hd: c.hd,
      rot: c.rot || 0,
      height: c.shape === 'flat' ? c.top : Math.max(c.y0, c.y1),
    })),
  ...BENCHES.filter((b) => !b.base).map((b) => ({ x: b.x, z: b.z, hw: 0.85, hd: 0.3, rot: b.rot || 0, height: 0.5 })),
  ...LAMPS.filter((l) => !l.base).map((l) => ({ x: l.x, z: l.z, hw: 0.28, hd: 0.28, rot: 0, height: 0.9 })),
]
