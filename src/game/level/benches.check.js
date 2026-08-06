// node src/game/level/benches.check.js
//
// A bench you can't sit on usefully is a bug you only see in a screenshot, and
// only if the shot happens to be framed on it. Two invariants, both cheap:
//
//   facing  — 1m in front of the seat is open ground, not the wall or planter
//             the bench is tucked against.
//   footing — a bench standing inside a raised deck's footprint has `base` set
//             to that deck's top. The pad1 bench was authored at base 0 and
//             rendered entirely inside the 1.2m pad.
//
// ponytail: footprints only, no mesh. The props are boxes; a rect test sees
// every overlap that matters here.

import { BENCHES, WALLS, PLANTERS, SOLIDS } from './levelData.js'

let fails = 0
const check = (ok, msg) => {
  if (!ok) {
    console.error('FAIL', msg)
    fails++
  }
}

// local +Z of a rot-yawed rect maps to world (sin rot, cos rot) — see the
// header of levelData.js.
const inRect = (px, pz, r) => {
  const c = Math.cos(r.rot || 0)
  const s = Math.sin(r.rot || 0)
  const dx = px - r.x
  const dz = pz - r.z
  // inverse yaw: world delta -> the rect's local frame
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= r.w / 2 && Math.abs(lz) <= r.d / 2
}

const label = (b) => `bench (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`

for (const b of BENCHES) {
  const rot = b.rot || 0
  const base = b.base || 0

  // ---- facing: 1m ahead of the seat front must be clear -------------------
  const fx = b.x + Math.sin(rot) * 1.0
  const fz = b.z + Math.cos(rot) * 1.0

  for (const w of WALLS) {
    if ((w.base || 0) !== base) continue
    check(!inRect(fx, fz, w), `${label(b)} faces a wall at (${w.x.toFixed(1)}, ${w.z.toFixed(1)})`)
  }
  for (const p of PLANTERS) {
    if ((p.base || 0) !== base) continue
    check(!inRect(fx, fz, p), `${label(b)} faces a planter at (${p.x}, ${p.z})`)
  }

  // ...and the bench itself must not be standing in one.
  for (const p of PLANTERS) {
    if ((p.base || 0) !== base) continue
    check(!inRect(b.x, b.z, p), `${label(b)} stands inside the planter at (${p.x}, ${p.z})`)
  }

  // ---- footing: base matches whatever deck it stands on -------------------
  for (const s of SOLIDS) {
    if (s.kind !== 'box' || s.style !== 'deck') continue
    if (!inRect(b.x, b.z, s)) continue
    check(base === s.top, `${label(b)} is on deck ${s.id} (top ${s.top}) but base is ${base}`)
  }
}

console.log(fails ? `${fails} failure(s)` : `benches ok (${BENCHES.length})`)
process.exit(fails ? 1 : 0)
