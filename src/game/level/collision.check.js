// Collision stress probe: broad-phase coverage, wall penetration, ramp seams,
// tunneling, drops, dt consistency. Run: node src/game/level/collision.check.js

import { SOLIDS, WALLS, PERIMETER } from './levelData.js'
import {
  COLLIDERS,
  resolveCollision,
  sampleSurface,
  groundHeightAt,
  STEP_UP,
} from './colliders.js'
import { P } from '../store.js'
import { input } from '../input.js'
import { updatePlayer, resetPlayer } from '../player/PlayerController.js'

const RADIUS = 0.5
const RAMP_OVER = 1.0
const CAP_STEP = 0.3 // mirror of colliders.js: caps are landable, not steppable

const fails = []
const notes = []
function fail(tag, msg) {
  fails.push(`${tag}: ${msg}`)
  console.log(`FAIL  ${tag}: ${msg}`)
}
function ok(tag, msg) {
  console.log(`ok    ${tag}${msg ? ' — ' + msg : ''}`)
}

// ---------------------------------------------------------------- geometry
// Mirror of colliders.js rampY (not exported).
function rampY(c, s) {
  const t = Math.min(Math.max(s, 0), c.run)
  const h = c.y1 - c.y0
  if (c.curve === 'quarter') {
    const R = (c.run * c.run + h * h) / (2 * h)
    return c.y0 + R - Math.sqrt(Math.max(0, R * R - t * t))
  }
  return c.y0 + (h * t) / c.run
}

function local(c, x, z) {
  const dx = x - c.x
  const dz = z - c.z
  return { lx: c.c * dx - c.s * dz, lz: c.s * dx + c.c * dz }
}

function rampTopAt(x, z, list) {
  let top = -Infinity
  for (const c of list) {
    if (c.shape === 'flat') continue
    const { lx, lz } = local(c, x, z)
    if (Math.abs(lx) <= c.hw && Math.abs(lz) <= c.hd) top = Math.max(top, c.y0, c.y1)
  }
  return top
}

/**
 * Brute-force (no broad phase) deepest penetration of a radius-r circle at
 * (x,z) into anything that should be blocking a player whose feet are at feetY.
 * Same predicate resolveCollision uses, minus the grid.
 */
function deepestOverlap(x, z, feetY, radius = RADIUS) {
  const limit = feetY + STEP_UP
  const rampTop = rampTopAt(x, z, COLLIDERS)
  let worst = { depth: 0, col: null }
  for (const c of COLLIDERS) {
    if (c.shape === 'flat' && c.top <= rampTop + 0.02) continue
    const { lx, lz } = local(c, x, z)
    const qx = Math.min(Math.max(lx, -c.hw), c.hw)
    const qz = Math.min(Math.max(lz, -c.hd), c.hd)
    const top = c.shape === 'flat' ? c.top : rampY(c, qz + c.hd - RAMP_OVER / 2)
    const inside = Math.abs(lx) < c.hw && Math.abs(lz) < c.hd
    if (top <= (c.type === 'cap' ? feetY + (inside ? CAP_STEP : 0.02) : limit)) continue
    const ox = lx - qx
    const oz = lz - qz
    const d = Math.hypot(ox, oz)
    const depth = d < 1e-8 ? radius + Math.min(c.hw - Math.abs(lx), c.hd - Math.abs(lz)) : radius - d
    if (depth > worst.depth) worst = { depth, col: c, top, d }
  }
  return worst
}

/**
 * resolveCollision's algorithm without the grid — used to tell a broad-phase
 * miss (brute force finds a free spot, the shipped solver doesn't) from a
 * genuine geometric wedge (no free spot exists for a radius-0.5 circle).
 */
function bruteResolve(x, z, feetY, passes = 8) {
  let px = x
  let pz = z
  const limit = feetY + STEP_UP
  for (let pass = 0; pass < passes; pass++) {
    let moved = false
    const rampTop = rampTopAt(px, pz, COLLIDERS)
    for (const c of COLLIDERS) {
      if (c.shape === 'flat' && c.top <= rampTop + 0.02) continue
      const { lx, lz } = local(c, px, pz)
      const qx = Math.min(Math.max(lx, -c.hw), c.hw)
      const qz = Math.min(Math.max(lz, -c.hd), c.hd)
      const top = c.shape === 'flat' ? c.top : rampY(c, qz + c.hd - RAMP_OVER / 2)
      const inside = Math.abs(lx) < c.hw && Math.abs(lz) < c.hd
      if (top <= (c.type === 'cap' ? feetY + (inside ? CAP_STEP : 0.02) : limit)) continue
      const ox = lx - qx
      const oz = lz - qz
      const d2 = ox * ox + oz * oz
      let nx, nz, depth
      if (d2 > 1e-8) {
        if (d2 >= RADIUS * RADIUS) continue
        const d = Math.sqrt(d2)
        nx = ox / d
        nz = oz / d
        depth = RADIUS - d
      } else {
        const ex = c.hw - Math.abs(lx)
        const ez = c.hd - Math.abs(lz)
        if (ex < ez) ((nx = Math.sign(lx) || 1), (nz = 0), (depth = ex + RADIUS))
        else ((nx = 0), (nz = Math.sign(lz) || 1), (depth = ez + RADIUS))
        // same per-pass unwedge cap as the shipped solver — without it the
        // reference "escapes" wedges via oversized ejects resolveCollision
        // deliberately forbids, and reports them as broad-phase misses
        depth = Math.min(depth, RADIUS)
      }
      px += (c.c * nx + c.s * nz) * depth
      pz += (-c.s * nx + c.c * nz) * depth
      moved = true
    }
    if (!moved) break
  }
  return { x: px, z: pz, depth: deepestOverlap(px, pz, feetY).depth }
}

const st = () => ({
  x: P.pos.x,
  y: P.pos.y,
  z: P.pos.z,
  vx: P.vel.x,
  vy: P.vel.y,
  vz: P.vel.z,
  state: P.state,
})
const spd = () => Math.hypot(P.vel.x, P.vel.y, P.vel.z)

/**
 * A one-frame overlap is a legitimate transient (the frame you touch down on a
 * ramp, before land() snaps you). Only PERSISTENT overlap — three consecutive
 * frames of a circle inside a solid that should be blocking it — is a bug.
 */
function penTracker(minFrames = 3) {
  let run = 0
  const t = {
    worst: { v: 0 },
    sample(depth, info) {
      if (depth > 0.03) run++
      else run = 0
      if (run >= minFrames && depth > t.worst.v) t.worst = { v: depth, frames: run, ...info }
    },
    reset() {
      run = 0
    },
  }
  return t
}

function clearInput() {
  input.steer = 0
  input.throttle = 0
  input.brake = false
  input.reverse = false
  input.jumpBuffer = 0
  input.jumpHeld = false
  input.grab = false
  input.spin = 0
}

// =================================================================
// 0. broad phase: does the uniform grid ever miss a collider that a
//    radius-0.5 circle overlaps? Colliders are bucketed by their raw AABB
//    with no radius dilation, so a solid just across a cell boundary can be
//    invisible to resolveCollision. Compare grid result against brute force.
// =================================================================
{
  let worstMiss = null
  let worstWedge = null
  let misses = 0
  let wedges = 0
  let samples = 0
  const step = 0.08
  let ringOf = null
  const probe = (x, z, feetY) => {
    samples++
    // only count points whose CENTRE is outside the rect, so the depth formula
    // is unambiguous (radius - distance)
    const brute = deepestOverlap(x, z, feetY)
    if (brute.depth <= 0.02 || brute.depth >= RADIUS) return
    const p = { x, z }
    resolveCollision(p, feetY, RADIUS)
    // residual overlap AFTER the shipped solver has had its say
    const after = deepestOverlap(p.x, p.z, feetY)
    if (after.depth > 0.03) {
      // is there a free spot at all? if brute force also fails, the geometry
      // is a wedge narrower than the player, not a solver bug
      const bf = bruteResolve(x, z, feetY)
      if (bf.depth > 0.03) {
        wedges++
        if (!worstWedge || bf.depth > worstWedge.depth)
          worstWedge = { x, z, feetY, depth: bf.depth, id: after.col.id }
        return
      }
      misses++
      if (!worstMiss || after.depth > worstMiss.after)
        worstMiss = {
          x,
          z,
          feetY,
          before: brute.depth,
          after: after.depth,
          id: after.col.id,
          cell: [Math.floor(x / 6), Math.floor(z / 6)],
          resolved: { x: p.x, z: p.z },
          free: { x: bf.x, z: bf.z },
          ring: ringOf,
        }
    }
  }
  // Probe at the PHYSICAL ground height of each point — a fixed collider-top
  // height seeds points embedded inside ramp solids (below their surface),
  // where being blocked and shoved uphill is correct, not a solver miss.
  for (const c of COLLIDERS) {
    ringOf = c.id
    for (let x = c.minX - 0.6; x <= c.maxX + 0.6; x += step)
      for (const z of [c.minZ - 0.45, c.minZ - 0.2, c.maxZ + 0.2, c.maxZ + 0.45]) probe(x, z, groundHeightAt(x, z))
    for (let z = c.minZ - 0.6; z <= c.maxZ + 0.6; z += step)
      for (const x of [c.minX - 0.45, c.minX - 0.2, c.maxX + 0.2, c.maxX + 0.45]) probe(x, z, groundHeightAt(x, z))
  }
  if (misses)
    fail(
      'broadphase',
      `${misses}/${samples} probe points still overlap a solid AFTER resolveCollision even though a free spot exists. ` +
        `worst: (${worstMiss.x.toFixed(2)}, ${worstMiss.z.toFixed(2)}) feetY ${worstMiss.feetY.toFixed(2)} ` +
        `overlaps '${worstMiss.id}' by ${worstMiss.before.toFixed(3)}m; solver left ${worstMiss.after.toFixed(3)}m at ` +
        `(${worstMiss.resolved.x.toFixed(2)}, ${worstMiss.resolved.z.toFixed(2)}), brute force reaches a clear ` +
        `(${worstMiss.free.x.toFixed(2)}, ${worstMiss.free.z.toFixed(2)}); grid cell ${worstMiss.cell}; probed around '${worstMiss.ring}'`,
    )
  else ok('broadphase', `${samples} probe points, resolveCollision leaves no residual overlap`)
  if (wedges)
    notes.push(
      `  note: ${wedges}/${samples} probe points sit in gaps narrower than the 1.0m player diameter ` +
        `(no free spot exists for ANY solver). worst ${worstWedge.depth.toFixed(3)}m at ` +
        `(${worstWedge.x.toFixed(2)}, ${worstWedge.z.toFixed(2)}) feetY ${worstWedge.feetY.toFixed(2)} near '${worstWedge.id}'`,
    )
}

// =================================================================
// 0b. STRUCTURAL: the grid buckets each collider by its RAW aabb, undilated.
//     A circle of radius 0.5 standing in the neighbouring cell overlaps a
//     collider the bucket never returns. Enumerate exactly which cells are
//     missing which collider.
// =================================================================
{
  const CELL = 6
  const GRID_PAD = 0.6 // must mirror colliders.js bucketing dilation
  const cellsOf = (minX, maxX, minZ, maxZ) => {
    const out = []
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) out.push(`${ix},${iz}`)
    return out
  }
  let bad = 0
  const examples = []
  for (const c of COLLIDERS) {
    const have = new Set(cellsOf(c.minX - GRID_PAD, c.maxX + GRID_PAD, c.minZ - GRID_PAD, c.maxZ + GRID_PAD))
    const want = cellsOf(c.minX - RADIUS, c.maxX + RADIUS, c.minZ - RADIUS, c.maxZ + RADIUS)
    const missing = want.filter((k) => !have.has(k))
    if (missing.length) {
      bad++
      if (examples.length < 4)
        examples.push(`'${c.id}' (aabb x ${c.minX.toFixed(1)}..${c.maxX.toFixed(1)}, z ${c.minZ.toFixed(1)}..${c.maxZ.toFixed(1)}) missing from cells ${missing.slice(0, 4).join(' ')}`)
    }
  }
  if (bad)
    fail(
      'broadphase/dilation',
      `${bad}/${COLLIDERS.length} colliders are reachable by a radius-${RADIUS} circle from a grid cell they are not bucketed into. ` +
        examples.join(' | '),
    )
  else ok('broadphase/dilation', 'every collider is bucketed into every cell a radius-0.5 circle could touch it from')
}

// =================================================================
// 0c. Focused repro: roll south into the pad2 south skirt wall
//     (x 2, z 30.6, w 20, d 1.2) whose aabb starts at z = 30.0 — exactly a
//     grid-cell boundary (30/6 = 5). Approaching from z < 30 the player sits
//     in cell 4, where the wall is not bucketed.
// =================================================================
{
  const w = WALLS.find((q) => q.x === 2 && q.z === 30.6)
  const wc = COLLIDERS.find((c) => c.id === 'wall' && c.x === w.x && c.z === w.z)
  resetPlayer()
  clearInput()
  input.throttle = 1
  P.pos.set(2, 0.9, 28.5) // on pad2 (top 0.9), rolling south at the wall
  P.heading = 0
  P.vel.set(0, 0, 8)
  let deepest = 0
  let deepestAt = null
  let snapBack = 0
  let snapFrom = null
  let prev = st()
  for (let i = 0; i < 120; i++) {
    updatePlayer(1 / 60)
    // only while still in front of the wall's own span, so "went round the end"
    // is not counted as penetration
    if (P.pos.x > wc.minX + 0.6 && P.pos.x < wc.maxX - 0.6) {
      const into = P.pos.z - (wc.minZ - RADIUS)
      if (into > deepest) {
        deepest = into
        deepestAt = st()
      }
      const back = prev.z - P.pos.z
      if (back > snapBack) {
        snapBack = back
        snapFrom = { prev, to: st() }
      }
    }
    prev = st()
  }
  if (deepest > 0.05)
    fail(
      'repro/pad2-skirt',
      `rolling south at 8 m/s into the wall whose collider face is z ${wc.minZ.toFixed(2)}: the player centre reaches ` +
        `z ${deepestAt.z.toFixed(3)} — ${deepest.toFixed(3)}m past the z ${(wc.minZ - RADIUS).toFixed(2)} contact line, ` +
        `i.e. the 0.5m body is ${deepest.toFixed(2)}m into the wall with zero collision response. ` +
        `The correction then arrives as a single-frame snap-back of ${snapBack.toFixed(3)}m ` +
        `(z ${snapFrom.prev.z.toFixed(3)} vz ${snapFrom.prev.vz.toFixed(2)} -> z ${snapFrom.to.z.toFixed(3)} vz ${snapFrom.to.vz.toFixed(2)})`,
    )
  else ok('repro/pad2-skirt', `stopped at z ${deepestAt ? deepestAt.z.toFixed(3) : 'n/a'}, contact line ${(wc.minZ - RADIUS).toFixed(2)}`)
}

// =================================================================
// 0d. Focused repro: dismounting a deck edge. ADHERE (1.5) snaps you down to
//     the plaza the instant you leave the lip, WITHOUT entering 'air'. The
//     next frame your circle is still inside the deck's footprint but your
//     feet are now 1.2m below its top, so it becomes a wall and ejects you.
// =================================================================
{
  const cases = [
    ['pad1 west edge', -16, 1.2, 15, -1, 0], // pad1 x -16..-2, top 1.2
    ['pad1 east edge', -2, 1.2, 15, 1, 0],
    ['pad2 east edge', 12, 0.9, 26, 1, 0], // pad2 x -8..12, top 0.9
    ['deckA south edge', 20, 1.6, -12, 0, 1], // deckA z -32..-12, top 1.6
  ]
  let worst = null
  for (const [name, ex, top, other, dx, dz] of cases) {
    for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
      resetPlayer()
      clearInput()
      input.throttle = 1
      const sx = dx ? ex - dx * 3 : other
      const sz = dz ? ex - dz * 3 : other
      P.pos.set(sx, top, sz)
      P.heading = Math.atan2(dx, dz)
      P.vel.set(dx * 8, 0, dz * 8)
      let prev = st()
      let everAir = false
      for (let i = 0; i < 90; i++) {
        updatePlayer(dt)
        if (P.state === 'air') everAir = true
        const jump = Math.hypot(P.pos.x - prev.x, P.pos.y - prev.y, P.pos.z - prev.z)
        const bound = dt * 22
        if (jump > bound && (!worst || jump > worst.jump))
          worst = { jump, name, dt, prev, to: st(), everAir, bound }
        prev = st()
      }
    }
  }
  if (worst)
    fail(
      'repro/deck-dismount',
      `${worst.name} dt 1/${Math.round(1 / worst.dt)}: one frame moved ${worst.jump.toFixed(3)}m (bound ${worst.bound.toFixed(3)}) ` +
        `from (${worst.prev.x.toFixed(2)},${worst.prev.y.toFixed(2)},${worst.prev.z.toFixed(2)}) state ${worst.prev.state} ` +
        `to (${worst.to.x.toFixed(2)},${worst.to.y.toFixed(2)},${worst.to.z.toFixed(2)}) state ${worst.to.state} ` +
        `— entered 'air' at any point: ${worst.everAir}`,
    )
  else ok('repro/deck-dismount', 'no oversized frame at any deck edge')
}

// =================================================================
// 1. high-speed runs at every wall
// =================================================================
{
  let worst = null
  let tunnels = 0
  let runs = 0
  for (const w of WALLS) {
    const wc = COLLIDERS.find((c) => c.id === 'wall' && c.x === w.x && c.z === w.z)
    const c = Math.cos(w.rot || 0)
    const s = Math.sin(w.rot || 0)
    // approach along local +Z (across the thin axis) and local +X, both signs
    const dirs = [
      [s, c],
      [-s, -c],
      [c, -s],
      [-c, s],
    ]
    for (const [dx, dz] of dirs) {
      for (const speed of [13, 18, 26]) {
        for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
          runs++
          const start = 5
          const sx = w.x - dx * start
          const sz = w.z - dz * start
          const gy = groundHeightAt(sx, sz)
          if (Math.abs(gy - (w.base || 0)) > 0.3) continue // not standing at the wall's own level
          resetPlayer()
          clearInput()
          P.pos.set(sx, gy, sz)
          P.heading = Math.atan2(dx, dz)
          P.vel.set(dx * speed, 0, dz * speed)
          const pen = penTracker()
          let maxStep = 0
          let prev = st()
          let crossed = false
          for (let i = 0; i < 240; i++) {
            updatePlayer(dt)
            const d = Math.hypot(P.pos.x - prev.x, P.pos.z - prev.z, P.pos.y - prev.y)
            maxStep = Math.max(maxStep, d)
            const o = deepestOverlap(P.pos.x, P.pos.z, P.pos.y)
            pen.sample(o.depth, { id: o.col && o.col.id, at: st() })
            // crossed the wall's mid-plane while below its cap?
            if (wc) {
              const { lx, lz } = local(wc, P.pos.x, P.pos.z)
              const side = dz * c - dx * s // sign of the approach in local z
              if (
                Math.abs(lx) < wc.hw &&
                Math.abs(lz) < wc.hd &&
                P.pos.y + STEP_UP < wc.top &&
                Math.abs(side) > 0.5
              )
                crossed = true
            }
            prev = st()
          }
          if (crossed) tunnels++
          if (!worst || pen.worst.v > worst.pen)
            worst = { pen: pen.worst.v, info: pen.worst, step: maxStep, w, dx, dz, speed, dt }
        }
      }
    }
  }
  if (tunnels) fail('walls/tunnel', `${tunnels} of ${runs} high-speed wall runs ended INSIDE the wall footprint`)
  if (worst.pen > 0.06)
    fail(
      'walls/penetration',
      `persistent overlap ${worst.pen.toFixed(3)}m (${worst.info.frames} frames) into '${worst.info.id}' ` +
        `at (${worst.info.at.x.toFixed(2)},${worst.info.at.y.toFixed(2)},${worst.info.at.z.toFixed(2)}) ` +
        `approaching wall (${worst.w.x.toFixed(2)},${worst.w.z.toFixed(2)}) speed ${worst.speed} dt 1/${Math.round(1 / worst.dt)}`,
    )
  else ok('walls', `${runs} runs, deepest residual overlap ${worst.pen.toFixed(3)}m, max per-frame move ${worst.step.toFixed(3)}m`)
}

// =================================================================
// 1b. deck-side runs at the low caps flanking the staircases
// =================================================================
// Section 1 only approaches a wall from its own base level, so it never saw
// this: the stair dividers and skirt caps top out at exactly deck + STEP_UP,
// and from the deck the plain limit test stepped you up and OVER them. A cap
// must block from the ground — landable from the air, never steppable.
{
  const runs = [
    { name: 'stairB divider W', wx: 12.5, wz: -12.4, x: 12.4, z: -14.5, dx: 0, dz: 1 },
    { name: 'stairB divider E', wx: 23.6, wz: -12.4, x: 23.6, z: -14.5, dx: 0, dz: 1 },
    { name: 'stairC wall W', wx: 26.2, wz: 1.4, x: 26.2, z: -1.8, dx: 0, dz: 1 },
    { name: 'stairC wall E', wx: 31.8, wz: 1.4, x: 31.8, z: -1.8, dx: 0, dz: 1 },
    { name: 'pad1 south skirt', wx: -9, wz: 21.6, x: -9, z: 19, dx: 0, dz: 1 },
    { name: 'pad2 west skirt', wx: 2.5, wz: 21.6, x: 2.5, z: 24.5, dx: 0, dz: -1 },
  ]
  let bad = 0
  for (const r of runs) {
    const wc = COLLIDERS.find((c) => c.id === 'wall' && c.x === r.wx && c.z === r.wz)
    for (const speed of [8, 13]) {
      resetPlayer()
      clearInput()
      const gy = groundHeightAt(r.x, r.z)
      P.pos.set(r.x, gy, r.z)
      P.heading = Math.atan2(r.dx, r.dz)
      P.vel.set(r.dx * speed, 0, r.dz * speed)
      let entered = false
      let climbed = false
      for (let i = 0; i < 240; i++) {
        updatePlayer(1 / 120)
        const { lx, lz } = local(wc, P.pos.x, P.pos.z)
        if (Math.abs(lx) < wc.hw && Math.abs(lz) < wc.hd) entered = true
        if (P.pos.y > gy + 0.3) climbed = true
      }
      if (entered || climbed) {
        bad++
        fail(
          'walls/cap-step',
          `${r.name}: riding the deck at ${speed} m/s ${entered ? 'entered the wall footprint' : 'climbed onto the cap'} ` +
            `(cap top ${wc.top.toFixed(2)}, deck ${gy.toFixed(2)} — top is within STEP_UP of the deck)`,
        )
      }
    }
  }
  if (!bad) ok('walls/cap-step', `${runs.length * 2} deck-side runs at the stair-flanking caps, all blocked`)
}

// =================================================================
// 2. ramps / stairs end to end (uphill and downhill)
// =================================================================
const RAMPS = SOLIDS.filter((s) => s.kind !== 'box')

function entryPoint(s) {
  const ux = Math.sin(s.rot)
  const uz = Math.cos(s.rot)
  const lead = s.d / 2 + 0.6
  let best = null
  for (const i of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const off = (i / 9) * s.w
    const x = s.x - ux * lead + uz * off
    const z = s.z - uz * lead - ux * off
    if (groundHeightAt(x, z) > s.y0 + 0.3) continue
    const p = { x, z }
    resolveCollision(p, s.y0, 0.5)
    const push = Math.hypot(p.x - x, p.z - z)
    if (!best || push < best.push) best = { x, z, ux, uz, push }
  }
  return best
}

function ride(s, entry, speed, dt, downhill) {
  resetPlayer()
  clearInput()
  input.throttle = 1
  let x, z, hx, hz
  if (downhill) {
    // start on the deck 1m past the top, aimed back down
    const ux = Math.sin(s.rot)
    const uz = Math.cos(s.rot)
    x = s.x + ux * (s.d / 2 + 1.0)
    z = s.z + uz * (s.d / 2 + 1.0)
    hx = -ux
    hz = -uz
  } else {
    x = entry.x
    z = entry.z
    hx = entry.ux
    hz = entry.uz
  }
  const y = groundHeightAt(x, z)
  P.pos.set(x, y, z)
  P.heading = Math.atan2(hx, hz)
  P.vel.set(hx * speed, 0, hz * speed)

  let maxH = 0 // horizontal move per updatePlayer call
  let maxSnap = 0 // vertical jump per call while STAYING grounded
  let maxBelow = 0
  let maxSpeed = 0
  const pen = penTracker()
  let prev = st()
  let worstAt = null
  let snapAt = null
  for (let i = 0; i < 200; i++) {
    updatePlayer(dt)
    const h = Math.hypot(P.pos.x - prev.x, P.pos.z - prev.z)
    if (h > maxH) {
      maxH = h
      worstAt = { ...st(), prev }
    }
    if (P.state === 'ground' && prev.state === 'ground') {
      const dy = Math.abs(P.pos.y - prev.y)
      if (dy > maxSnap) {
        maxSnap = dy
        snapAt = { ...st(), prev }
      }
    }
    maxSpeed = Math.max(maxSpeed, spd())
    const o = deepestOverlap(P.pos.x, P.pos.z, P.pos.y)
    pen.sample(o.depth, { id: o.col && o.col.id, at: st() })
    // skip frames where the player is actively rising toward the surface —
    // the rate-capped step-up spends ~3 frames climbing a 0.42 ledge by design
    if (P.state === 'ground' && P.pos.y <= prev.y + 1e-6) {
      const g = groundHeightAt(P.pos.x, P.pos.z)
      maxBelow = Math.max(maxBelow, g - P.pos.y)
    }
    prev = st()
  }
  return { maxH, maxSnap, snapAt, maxPen: pen.worst.v, penInfo: pen.worst, maxBelow, maxSpeed, worstAt }
}

{
  let worstStep = null
  let worstBelow = null
  let worstSpeed = null
  let worstPen = null
  let worstSnap = null
  for (const s of RAMPS) {
    const e = entryPoint(s)
    if (!e) {
      fail('ramps', `${s.id}: no approach lane`)
      continue
    }
    for (const dir of [false, true]) {
      for (const speed of [4, 11, 18]) {
        for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
          const r = ride(s, e, speed, dt, dir)
          const tag = `${s.id} ${dir ? 'down' : 'up'} @${speed} dt 1/${Math.round(1 / dt)}`
          // horizontal bound: dt * top speed (13 * 1.35 grind cap) + slack
          const bound = Math.max(0.2, dt * 22)
          if (!worstStep || r.maxH / bound > worstStep.ratio) worstStep = { ratio: r.maxH / bound, tag, r, bound }
          if (!worstSnap || r.maxSnap > worstSnap.v) worstSnap = { v: r.maxSnap, tag, r }
          if (!worstBelow || r.maxBelow > worstBelow.v) worstBelow = { v: r.maxBelow, tag, r }
          if (!worstSpeed || r.maxSpeed > worstSpeed.v) worstSpeed = { v: r.maxSpeed, tag }
          if (!worstPen || r.maxPen > worstPen.v) worstPen = { v: r.maxPen, tag, r }
        }
      }
    }
  }
  if (worstStep.ratio > 1)
    fail(
      'ramps/teleport',
      `${worstStep.tag}: single-frame HORIZONTAL move ${worstStep.r.maxH.toFixed(3)}m (bound ${worstStep.bound.toFixed(3)}) ` +
        `from (${worstStep.r.worstAt.prev.x.toFixed(2)},${worstStep.r.worstAt.prev.y.toFixed(2)},${worstStep.r.worstAt.prev.z.toFixed(2)}) ` +
        `to (${worstStep.r.worstAt.x.toFixed(2)},${worstStep.r.worstAt.y.toFixed(2)},${worstStep.r.worstAt.z.toFixed(2)}) state ${worstStep.r.worstAt.state}`,
    )
  else ok('ramps/teleport', `worst horizontal frame move ${(worstStep.ratio * worstStep.bound).toFixed(3)}m vs bound ${worstStep.bound.toFixed(3)}`)

  // A vertical jump while never leaving 'ground' is the ADHERE snap-down.
  if (worstSnap.v > 0.6)
    fail(
      'ramps/snap-down',
      `${worstSnap.tag}: dropped ${worstSnap.v.toFixed(2)}m vertically in ONE frame without ever entering 'air' ` +
        `— (${worstSnap.r.snapAt.prev.x.toFixed(2)},${worstSnap.r.snapAt.prev.y.toFixed(2)},${worstSnap.r.snapAt.prev.z.toFixed(2)}) ` +
        `to (${worstSnap.r.snapAt.x.toFixed(2)},${worstSnap.r.snapAt.y.toFixed(2)},${worstSnap.r.snapAt.z.toFixed(2)})`,
    )
  else ok('ramps/snap-down', `max single-frame grounded drop ${worstSnap.v.toFixed(3)}m`)

  if (worstBelow.v > 0.08) fail('ramps/sink', `${worstBelow.tag}: grounded ${worstBelow.v.toFixed(3)}m BELOW the sampled surface`)
  else ok('ramps/sink', `max sink below surface while grounded ${worstBelow.v.toFixed(3)}m`)

  if (worstSpeed.v > 34) fail('ramps/speed', `${worstSpeed.tag}: speed spiked to ${worstSpeed.v.toFixed(2)} m/s`)
  else ok('ramps/speed', `max speed ${worstSpeed.v.toFixed(2)} m/s (${worstSpeed.tag})`)

  if (worstPen.v > 0.08)
    fail(
      'ramps/penetration',
      `${worstPen.tag}: persistently ${worstPen.v.toFixed(3)}m inside '${worstPen.r.penInfo.id}' for ${worstPen.r.penInfo.frames} frames ` +
        `at (${worstPen.r.penInfo.at.x.toFixed(2)},${worstPen.r.penInfo.at.y.toFixed(2)},${worstPen.r.penInfo.at.z.toFixed(2)})`,
    )
  else ok('ramps/penetration', `max persistent overlap ${worstPen.v.toFixed(3)}m`)
}

// =================================================================
// 3. grazing angles, corners, seams
// =================================================================
{
  let worstPen = { v: 0 }
  let stuck = []
  let runs = 0
  for (const w of WALLS) {
    const c = Math.cos(w.rot || 0)
    const s = Math.sin(w.rot || 0)
    for (const ang of [5, 15, 30, 80]) {
      for (const sign of [1, -1]) {
        // aim at a CORNER of the wall at a grazing angle
        const cx = w.x + (c * (w.w / 2) - s * (w.d / 2)) * sign
        const cz = w.z + (-s * (w.w / 2) - c * (w.d / 2)) * sign
        const a = Math.atan2(s, c) + (ang * Math.PI) / 180
        const dx = Math.sin(a)
        const dz = Math.cos(a)
        const sx = cx - dx * 6
        const sz = cz - dz * 6
        const gy = groundHeightAt(sx, sz)
        if (Math.abs(gy - (w.base || 0)) > 0.3) continue
        runs++
        resetPlayer()
        clearInput()
        input.throttle = 1
        P.pos.set(sx, gy, sz)
        P.heading = a
        P.vel.set(dx * 13, 0, dz * 13)
        const pen = penTracker()
        let travelled = 0
        let prev = st()
        for (let i = 0; i < 200; i++) {
          updatePlayer(1 / 60)
          travelled += Math.hypot(P.pos.x - prev.x, P.pos.z - prev.z)
          const o = deepestOverlap(P.pos.x, P.pos.z, P.pos.y)
          pen.sample(o.depth, { id: o.col && o.col.id, at: st() })
          prev = st()
        }
        if (pen.worst.v > worstPen.v) worstPen = { v: pen.worst.v, info: pen.worst, w, ang, sign }
        // with throttle held for 3.3s a player should not be pinned in place
        if (travelled < 1.5) stuck.push(`(${w.x},${w.z}) @${ang}deg moved ${travelled.toFixed(2)}m in 3.3s`)
      }
    }
  }
  if (worstPen.v > 0.08)
    fail(
      'graze/penetration',
      `wall (${worstPen.w.x.toFixed(2)},${worstPen.w.z.toFixed(2)}) corner at ${worstPen.ang}deg: ` +
        `${worstPen.v.toFixed(3)}m inside '${worstPen.info.id}' for ${worstPen.info.frames} frames at ` +
        `(${worstPen.info.at.x.toFixed(2)},${worstPen.info.at.y.toFixed(2)},${worstPen.info.at.z.toFixed(2)})`,
    )
  else ok('graze', `${runs} corner/grazing runs, max persistent overlap ${worstPen.v.toFixed(3)}m`)
  if (stuck.length) fail('graze/stuck', `${stuck.length} runs pinned: ${stuck.slice(0, 3).join('; ')}`)
}

// seams: ride along the join between two adjacent surfaces
{
  const seams = [
    ['hp flat/quarter N', -26, 22.5, 0, -1],
    ['hp flat/quarter S', -26, 26.5, 0, 1],
    ['deckA / qp1 coping', 18, -9.6, 0, -1],
    ['pad2 / bank4', -3.5, 22.2, 1, 0],
    ['deckA edge', 20, -12.2, 1, 0],
    ['hpDeck edge', -26, 19.4, 1, 0],
  ]
  let worst = { pen: 0 }
  let worstStep = { v: 0 }
  for (const [name, x, z, dx, dz] of seams) {
    for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
      resetPlayer()
      clearInput()
      input.throttle = 1
      P.pos.set(x, groundHeightAt(x, z), z)
      P.heading = Math.atan2(dx, dz)
      P.vel.set(dx * 10, 0, dz * 10)
      const pen = penTracker()
      let prev = st()
      for (let i = 0; i < 200; i++) {
        updatePlayer(dt)
        const d = Math.hypot(P.pos.x - prev.x, P.pos.z - prev.z)
        if (d > worstStep.v) worstStep = { v: d, name, dt, from: prev, to: st() }
        const o = deepestOverlap(P.pos.x, P.pos.z, P.pos.y)
        pen.sample(o.depth, { id: o.col && o.col.id, at: st() })
        prev = st()
      }
      if (pen.worst.v > worst.pen) worst = { pen: pen.worst.v, name, dt, info: pen.worst }
    }
  }
  if (worst.pen > 0.08)
    fail(
      'seam/penetration',
      `${worst.name} dt 1/${Math.round(1 / worst.dt)}: ${worst.pen.toFixed(3)}m into '${worst.info.id}' ` +
        `for ${worst.info.frames} frames at (${worst.info.at.x.toFixed(2)},${worst.info.at.y.toFixed(2)},${worst.info.at.z.toFixed(2)})`,
    )
  else ok('seam', `max persistent overlap ${worst.pen.toFixed(3)}m`)
  const bound = worstStep.dt ? worstStep.dt * 22 : 0.4 // legit motion scales with frame dt
  if (worstStep.v > bound)
    fail(
      'seam/teleport',
      `${worstStep.name} dt 1/${Math.round(1 / worstStep.dt)}: horizontal frame move ${worstStep.v.toFixed(3)}m ` +
        `from (${worstStep.from.x.toFixed(2)},${worstStep.from.y.toFixed(2)},${worstStep.from.z.toFixed(2)}) ` +
        `to (${worstStep.to.x.toFixed(2)},${worstStep.to.y.toFixed(2)},${worstStep.to.z.toFixed(2)}) state ${worstStep.to.state}`,
    )
  else ok('seam/teleport', `max frame move ${worstStep.v.toFixed(3)}m`)
}

// =================================================================
// 4. drops from air onto surfaces, including lips and deck edges
// =================================================================
{
  const targets = []
  for (const s of SOLIDS) {
    if (s.kind === 'box') {
      targets.push([`${s.id} centre`, s.x, s.z])
      targets.push([`${s.id} edge`, s.x + s.w / 2 - 0.35, s.z])
      targets.push([`${s.id} corner`, s.x + s.w / 2 - 0.3, s.z + s.d / 2 - 0.3])
    } else {
      const ux = Math.sin(s.rot)
      const uz = Math.cos(s.rot)
      targets.push([`${s.id} lip`, s.x + ux * (s.d / 2 - 0.1), s.z + uz * (s.d / 2 - 0.1)])
      targets.push([`${s.id} mid`, s.x, s.z])
      targets.push([`${s.id} foot`, s.x - ux * (s.d / 2 - 0.1), s.z - uz * (s.d / 2 - 0.1)])
    }
  }
  let worstPen = { v: 0 }
  let worstBelow = { v: 0 }
  let neverLanded = []
  for (const [name, x, z] of targets) {
    for (const drop of [1.5, 6, 14]) {
      for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
        resetPlayer()
        clearInput()
        const gy = groundHeightAt(x, z)
        P.pos.set(x, gy + drop, z)
        P.vel.set(0, -2, 0)
        P.state = 'air'
        P.grounded = false
        let landed = false
        let below = 0
        let prevY = -Infinity
        const pen = penTracker()
        for (let i = 0; i < 400; i++) {
          updatePlayer(dt)
          if (P.state === 'ground' || P.state === 'grind') landed = true
          // skip actively-rising frames: the rate-capped step-up climbs a
          // sub-STEP_UP ledge over ~3 frames by design
          if (landed && P.state === 'ground' && P.pos.y <= prevY + 1e-6) {
            const g = groundHeightAt(P.pos.x, P.pos.z)
            below = Math.max(below, g - P.pos.y)
          }
          prevY = P.pos.y
          const o = deepestOverlap(P.pos.x, P.pos.z, P.pos.y)
          pen.sample(o.depth, { id: o.col && o.col.id, at: st() })
        }
        if (!landed) neverLanded.push(`${name} from ${drop}m dt 1/${Math.round(1 / dt)}`)
        if (below > worstBelow.v) worstBelow = { v: below, name, drop, dt }
        if (pen.worst.v > worstPen.v) worstPen = { v: pen.worst.v, name, drop, dt, info: pen.worst }
      }
    }
  }
  if (neverLanded.length) fail('drop/never-landed', `${neverLanded.length}: ${neverLanded.slice(0, 4).join('; ')}`)
  if (worstBelow.v > 0.05)
    fail('drop/penetration', `${worstBelow.name} from ${worstBelow.drop}m dt 1/${Math.round(1 / worstBelow.dt)}: settled ${worstBelow.v.toFixed(3)}m BELOW the sampled surface`)
  else ok('drop', `${targets.length * 9} drops, max sink ${worstBelow.v.toFixed(3)}m, max persistent overlap ${worstPen.v.toFixed(3)}m`)
  if (worstPen.v > 0.08)
    fail(
      'drop/overlap',
      `${worstPen.name} from ${worstPen.drop}m dt 1/${Math.round(1 / worstPen.dt)}: ${worstPen.v.toFixed(3)}m inside ` +
        `'${worstPen.info.id}' for ${worstPen.info.frames} frames at ` +
        `(${worstPen.info.at.x.toFixed(2)},${worstPen.info.at.y.toFixed(2)},${worstPen.info.at.z.toFixed(2)}) state ${worstPen.info.at.state}`,
    )
}

// =================================================================
// 5. dt consistency — same scenario at three rates should end up close
// =================================================================
{
  const scen = [
    ['plaza straight', 0, 6, 0, 1, 13],
    ['into qp1', 18, -6, 0, -1, 11],
    ['into bank4', -3.5, 24, 0, -1, 11],
    ['into halfpipe N', -26, 25, 0, -1, 9],
    ['at deckA wall', 0, -22, 1, 0, 13],
    ['at bowl', -15, 4, 0, -1, 12],
    ['stairA down', 4, 13, -1, 0, 8],
  ]
  let worst = { v: 0 }
  for (const [name, x, z, dx, dz, speed] of scen) {
    const runs = []
    for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
      resetPlayer()
      clearInput()
      input.throttle = 1
      P.pos.set(x, groundHeightAt(x, z), z)
      P.heading = Math.atan2(dx, dz)
      P.vel.set(dx * speed, 0, dz * speed)
      const n = Math.round(3 / dt)
      for (let i = 0; i < n; i++) updatePlayer(dt)
      runs.push({ dt, ...st() })
    }
    for (let i = 1; i < runs.length; i++) {
      const d = Math.hypot(runs[i].x - runs[0].x, runs[i].y - runs[0].y, runs[i].z - runs[0].z)
      if (d > worst.v) worst = { v: d, name, a: runs[0], b: runs[i] }
    }
    notes.push(
      `  ${name.padEnd(18)} ` +
        runs.map((r) => `1/${Math.round(1 / r.dt)}:(${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)})`).join('  '),
    )
  }
  console.log(notes.join('\n'))
  if (worst.v > 1.0)
    fail(
      'dt/divergence',
      `${worst.name}: 3s run ends ${worst.v.toFixed(2)}m apart between 1/120 and 1/${Math.round(1 / worst.b.dt)} ` +
        `(${worst.a.x.toFixed(2)},${worst.a.y.toFixed(2)},${worst.a.z.toFixed(2)}) vs (${worst.b.x.toFixed(2)},${worst.b.y.toFixed(2)},${worst.b.z.toFixed(2)})`,
    )
  else ok('dt', `max divergence over 3s ${worst.v.toFixed(3)}m (${worst.name})`)
}

// =================================================================
// 6. perimeter / out-of-bounds
// =================================================================
{
  let escapes = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) {
    for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
      resetPlayer()
      clearInput()
      input.throttle = 1
      P.pos.set(0, 0, 0)
      P.heading = Math.atan2(dx, dz)
      P.vel.set(dx * 30, 0, dz * 30)
      for (let i = 0; i < 400; i++) {
        updatePlayer(dt)
        if (
          P.pos.x < PERIMETER.minX - 0.01 ||
          P.pos.x > PERIMETER.maxX + 0.01 ||
          P.pos.z < PERIMETER.minZ - 0.01 ||
          P.pos.z > PERIMETER.maxZ + 0.01
        ) {
          escapes++
          break
        }
      }
    }
  }
  if (escapes) fail('perimeter', `${escapes} runs left the play area`)
  else ok('perimeter', 'never escapes at 30 m/s')
}

clearInput()
console.log('\n' + (fails.length ? `${fails.length} FAILURE(S)` : 'all probes passed'))
