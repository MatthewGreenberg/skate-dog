// node src/game/level/rails.check.js
//
// A rail is a tube plus a column of posts dropped to the ground under it, so a
// rail that reads fine as a polyline can still have a post buried in a wall or
// a planter kerb. Nothing draws attention to it — the tube is thin, the prop is
// opaque, and from any distance it just looks like set dressing.
//
// Three invariants:
//   clearance — no sample of the rail (tube OR the post beneath it) lands
//               inside a wall, planter, bench or lamp footprint.
//   footing   — a rail is never buried inside a solid: it sits ABOVE whatever
//               box/ramp/stairs it crosses, not inside it.
//   spacing   — two rails never share space.
//
// The stairC handrail shipped running straight down the middle of the stair's
// own east side wall (x 31.2..32.4) — the generated handrail offset is
// w/2 + 0.5 = 2.7 from centre and the wall sits at 2.8, so the 0.055 tube plus
// the 0.05 post overlapped it for its whole length.
//
// ponytail: footprints and samples, no mesh. Everything here is a box, a
// cylinder or a line; a 10cm sample walk sees every overlap that matters.

import { RAILS, WALLS, PLANTERS, BENCHES, LAMPS, SOLIDS } from './levelData.js'

let fails = 0
const check = (ok, msg) => {
  if (!ok) {
    console.error('FAIL', msg)
    fails++
  }
}

const RAIL_R = 0.055 // tube radius        (Skatepark.jsx)
const POST_R = 0.05 // widest post radius  (Skatepark.jsx)
const R = Math.max(RAIL_R, POST_R)

const BENCH = { w: 1.72, d: 0.7, h: 0.9 } // slats + frame (Props.jsx)
const LAMP_R = 0.4 // plinth radius
const LAMP_H = 6.0

// local +Z of a rot-yawed rect maps to world (sin rot, cos rot) — see the
// header of levelData.js.
const local = (px, pz, r) => {
  const c = Math.cos(r.rot || 0)
  const s = Math.sin(r.rot || 0)
  const dx = px - r.x
  const dz = pz - r.z
  return [dx * c - dz * s, dx * s + dz * c]
}

// rect test with the rail's radius added, so a tube grazing a face still trips.
const inRect = (px, pz, r, w, d, pad = R) => {
  const [lx, lz] = local(px, pz, r)
  return Math.abs(lx) <= w / 2 + pad && Math.abs(lz) <= d / 2 + pad
}

// Height of the ramp/stairs surface at a world point, or null if outside it.
// Both collide as a smooth ramp climbing along local +Z (levelData.js header).
const rampTop = (s, px, pz) => {
  const [lx, lz] = local(px, pz, s)
  if (Math.abs(lx) > s.w / 2 || Math.abs(lz) > s.d / 2) return null
  return s.y0 + (s.y1 - s.y0) * (lz / s.d + 0.5)
}

// ---- walk every rail at 10cm ----------------------------------------------
function* samples(rail) {
  for (let i = 0; i < rail.pts.length - 1; i++) {
    const [a, b] = [rail.pts[i], rail.pts[i + 1]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const n = Math.max(1, Math.ceil(len / 0.1))
    for (let k = 0; k <= n; k++) {
      const t = k / n
      yield [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    }
  }
}

const seen = new Set()
const once = (key, msg) => {
  if (seen.has(key)) return
  seen.add(key)
  check(false, msg)
}

for (const rail of RAILS) {
  for (const [x, y, z] of samples(rail)) {
    // The post hangs from the tube down to the ground it stands on, so the
    // occupied column is [ground, y]. Ground is unknown here; use the lowest
    // base of anything under the point, which is what groundHeightAt returns.
    const lo = -0.1
    const hi = y + RAIL_R

    for (const w of WALLS) {
      const wb = w.base || 0
      if (hi < wb || lo > wb + w.h) continue
      if (inRect(x, z, w, w.w, w.d)) once(`${rail.id}|w${w.x},${w.z}`, `${rail.id} runs through the wall at (${w.x.toFixed(1)}, ${w.z.toFixed(1)})`)
    }

    for (const p of PLANTERS) {
      const pb = p.base || 0
      if (hi < pb || lo > pb + p.h) continue
      if (inRect(x, z, p, p.w, p.d)) once(`${rail.id}|p${p.x},${p.z}`, `${rail.id} runs through the planter at (${p.x}, ${p.z})`)
    }

    for (const b of BENCHES) {
      const bb = b.base || 0
      if (hi < bb || lo > bb + BENCH.h) continue
      if (inRect(x, z, b, BENCH.w, BENCH.d)) once(`${rail.id}|b${b.x},${b.z}`, `${rail.id} runs through the bench at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`)
    }

    for (const l of LAMPS) {
      const lb = l.base || 0
      if (hi < lb || lo > lb + LAMP_H) continue
      if (Math.hypot(x - l.x, z - l.z) <= LAMP_R + R) once(`${rail.id}|l${l.x},${l.z}`, `${rail.id} runs through the lamp at (${l.x}, ${l.z})`)
    }

    // ---- footing: above the solid, never inside it -------------------------
    for (const s of SOLIDS) {
      if (s.kind === 'box') {
        if (!inRect(x, z, s, s.w, s.d, 0)) continue
        if (y - RAIL_R < s.top - 1e-6 && y + RAIL_R > (s.base || 0) + 1e-6) {
          once(`${rail.id}|s${s.id}`, `${rail.id} is buried in ${s.id} (top ${s.top}, rail y ${y.toFixed(2)})`)
        }
      } else {
        const top = rampTop(s, x, z)
        if (top === null) continue
        // its own handrail starts at the bottom step by design
        if (rail.id.startsWith(`${s.id}-hr`)) continue
        if (y - RAIL_R < top - 1e-6) {
          once(`${rail.id}|s${s.id}`, `${rail.id} is buried in ${s.id} (surface ${top.toFixed(2)}, rail y ${y.toFixed(2)})`)
        }
      }
    }
  }
}

// ---- spacing: rail vs rail -------------------------------------------------
const pts = RAILS.map((r) => [...samples(r)])
for (let i = 0; i < RAILS.length; i++) {
  for (let j = i + 1; j < RAILS.length; j++) {
    let hit = false
    for (const a of pts[i]) {
      for (const b of pts[j]) {
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 2 * RAIL_R) hit = true
      }
    }
    check(!hit, `${RAILS[i].id} intersects ${RAILS[j].id}`)
  }
}

console.log(fails ? `${fails} failure(s)` : `rails ok (${RAILS.length})`)
process.exit(fails ? 1 : 0)
