// Simplified gameplay collision, authored separately from the visual meshes.
// Every solid is a rotated rectangle with a height function; stairs collide as
// smooth ramps; the bowl uses its analytic height field. A uniform grid does
// broad phase so we never test the whole park per frame.

import { SOLIDS, WALLS, PLANTERS, PERIMETER, BENCHES, LAMPS, BOWL } from './levelData.js'
import { bowlHeight, bowlNormal, isInsideBowl } from './bowlGeometry.js'

export const STEP_UP = 0.55 // how far the player can be pulled up onto a ledge
// A wall cap is landable (from the air) but never steppable (from below): the
// dividers flanking the stairs and the deck skirt caps top out at exactly
// deck + 0.55 = feetY + STEP_UP, so the plain limit test hoisted you up and
// over every wall beside a staircase (and let an air whose feet were within
// STEP_UP of the cap top pass straight through the wall). The allowance is
// only for bodies ABOVE the cap: a landing frame sinks ~0.12m below the top
// before stepAir's land check fires (14.8 m/s off a 5m air over a 1/120
// substep), and a solid cap would side-eject the clean landing. A body whose
// centre is OUTSIDE the footprint is pressing into the FACE — always a wall.
// A flat band there embeds you while "steppable" and ejects the accumulated
// depth in one frame when your feet cross the threshold (a 0.32m lurch
// skimming pad2's skirt, collision.check.js ramps/teleport).
const CAP_STEP = 0.3
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

function addAll() {
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
}
addAll()

// ------------------------------------------------------------ broad phase
// Buckets are dilated by the largest query radius: bucket(x,z) returns one
// cell, and a 0.5m circle standing just inside a cell boundary overlaps
// colliders bucketed only in the next cell over. Undilated, 22 of 58 colliders
// were reachable from cells that never tested them — the pad2 skirt wall's
// face sits exactly ON a boundary (z=30, CELL 6) and let the whole body embed
// 0.5m before the next cell's pass ejected it in one frame.
const GRID_PAD = 0.6
const grid = new Map()
const key = (ix, iz) => ix * 8192 + iz
function addToGrid() {
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]
    for (let ix = Math.floor((c.minX - GRID_PAD) / CELL); ix <= Math.floor((c.maxX + GRID_PAD) / CELL); ix++) {
      for (let iz = Math.floor((c.minZ - GRID_PAD) / CELL); iz <= Math.floor((c.maxZ + GRID_PAD) / CELL); iz++) {
        const k = key(ix, iz)
        let a = grid.get(k)
        if (!a) grid.set(k, (a = []))
        a.push(c)
      }
    }
  }
}
addToGrid()

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
 * Top of the tallest ramp whose footprint contains (x,z), or -Infinity.
 *
 * A ramp's footprint is a HOLE in whatever deck it feeds — that deck must not
 * act on you while you are on the transition into it. Both failure modes were
 * the same bug wearing different hats: qp1's coping sits 0.5m inside deckA's
 * footprint, so the deck's face stopped you halfway up (collision), and the
 * moment STEP_UP could reach its 1.6 top the surface query teleported you onto
 * it and flattened the climb (height). Anything TALLER than the ramp's top —
 * walls, the dividers flanking the transitions — is unaffected.
 * (An earlier note here said qp1 was "only 0.83m up where the deck starts" —
 * that number was the arc-length origin bug being measured, not geometry. The
 * corrected ramp reads exactly 1.600 at deckA's edge.)
 */
function rampTopAt(x, z, b) {
  let top = -Infinity
  for (const c of b) {
    if (c.shape === 'flat') continue
    const { lx, lz } = localZ(c, x, z)
    if (Math.abs(lx) <= c.hw && Math.abs(lz) <= c.hd) top = Math.max(top, c.y0, c.y1)
  }
  return top
}

/**
 * Highest walkable surface at (x,z) reachable from feetY.
 * Writes into `out` (no allocation) and returns it.
 */
const _out = { y: 0, nx: 0, ny: 1, nz: 0, type: 'concrete', slope: 0, curv: 0, inBowl: false, id: null }
export function sampleSurface(x, z, feetY, out = _out) {
  out.y = 0
  out.nx = 0
  out.ny = 1
  out.nz = 0
  out.type = 'concrete'
  out.slope = 0
  out.curv = 0
  out.inBowl = false
  out.id = null

  // BOWL.on false = the editor deleted the bowl; the plaza is drawn without
  // its cutout, so the hole must stop existing here too or you fall into an
  // invisible one.
  if (BOWL.on && isInsideBowl(x, z)) {
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
  const b = bucket(x, z)
  const rampTop = rampTopAt(x, z, b)
  for (const c of b) {
    const { lx, lz } = localZ(c, x, z)
    if (Math.abs(lx) > c.hw || Math.abs(lz) > c.hd) continue

    if (c.shape === 'flat') {
      if (c.top <= rampTop + 0.02) continue
      if (c.top <= (c.type === 'cap' ? feetY + CAP_STEP : limit) && c.top > out.y) {
        out.y = c.top
        out.nx = 0
        out.ny = 1
        out.nz = 0
        out.slope = 0
        out.curv = 0 // a quarter evaluated earlier must not leak its lift onto a flat
        out.type = c.type
        out.inBowl = false
        out.id = c.id
      }
    } else {
      // Arc length from the ramp's LOW edge. addRect grew the footprint only
      // uphill (centre shifted +RAMP_OVER/2, d grew by RAMP_OVER), so the low
      // edge sits exactly at lz = -hd. Subtracting RAMP_OVER/2 here again
      // double-counted the shift and slid every ramp's collision 0.5m uphill
      // of its mesh — qp1 read 0.825 where the drawn coping is 1.6, and every
      // ramp-to-deck seam had a 0.1-0.78m trench STEP_UP had to jump.
      const s = lz + c.hd
      const y = rampY(c, s)
      if (y <= limit && y > out.y) {
        const k = rampSlope(c, s)
        const inv = 1 / Math.hypot(1, k)
        const h = c.y1 - c.y0
        out.y = y
        out.nx = -c.s * k * inv
        out.ny = inv
        out.nz = -c.c * k * inv
        out.slope = Math.atan(k)
        // analytic arc curvature (1/R) so the rig's clearance lift needs no
        // frame-late measurement; 0 on the flat overhang and on linear banks
        out.curv = c.curve === 'quarter' && s < c.run ? (2 * h) / (c.run * c.run + h * h) : 0
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

  // 8 passes: 2 converged everywhere except corner pockets where two solids
  // push in sequence (planter + wall cap on deckA) — the extra passes let the
  // point walk around the corner instead of oscillating in the wedge. 4 was
  // enough until the stair-flanking caps went solid-from-the-ground: the
  // divider-face + planter-corner pockets they added need up to 8 to escape
  // (collision.check.js broadphase measures parity against a no-grid 8-pass
  // reference). The loop breaks the first pass nothing moves, so the extra
  // passes cost nothing outside a pocket.
  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    const b = bucket(p.x, p.z)
    const rampTop = rampTopAt(p.x, p.z, b)

    for (const c of b) {
      if (c.shape === 'flat' && c.top <= rampTop + 0.02) continue
      const dx = p.x - c.x
      const dz = p.z - c.z
      const lx = c.c * dx - c.s * dz
      const lz = c.s * dx + c.c * dz
      const qx = Math.min(Math.max(lx, -c.hw), c.hw)
      const qz = Math.min(Math.max(lz, -c.hd), c.hd)
      // A ramp is only a wall where it is actually TALL. Testing it by
      // max(y0,y1) made every ramp and stair an impassable box: approach the
      // low end at plaza height and the whole footprint ejected you (bank1
      // threw you 4.9m sideways), so nothing in the park was rideable. Measure
      // the ramp at the nearest point of its footprint instead — the low end
      // reads ~0 and lets you roll on, the cheeks and the top still block.
      const top = c.shape === 'flat' ? c.top : rampY(c, qz + c.hd)
      const inside = Math.abs(lx) < c.hw && Math.abs(lz) < c.hd
      if (top <= (c.type === 'cap' ? feetY + (inside ? CAP_STEP : 0.02) : limit)) continue
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
        // full-depth ejection from a long collider is metres in one substep —
        // flying into the halfpipe's back face flung you 1.7m north in a frame.
        // Unwedge at most a radius per pass; the next substeps finish the job.
        depth = Math.min(depth, radius)
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

// Level-editor hook. cols/grid are built once at module load and PlayerController
// holds `COLLIDERS` by reference, so a rebuild refills both IN PLACE rather than
// reassigning. Without this the editor is visual-only — you'd move a ramp and
// ride straight through where it used to be. AO_FOOTPRINTS is refilled the same
// way (in place, same array) — it is the baked contact shadow under every prop,
// and left alone the plaza keeps the shadows of rows you already moved.
export function rebuildColliders() {
  cols.length = 0
  grid.clear()
  addAll()
  addToGrid()
  AO_FOOTPRINTS.length = 0
  AO_FOOTPRINTS.push(...aoFootprints())
}

// Footprints for the baked top-down occlusion map. Only things standing on the
// plaza contribute; anything already up on a deck would darken the wrong floor.
const aoFootprints = () => [
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

export const AO_FOOTPRINTS = aoFootprints()
