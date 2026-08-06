// node src/game/level/decals.check.js
//
// The one thing that can silently break here is PLACEMENT: a decal on a deck
// face, in the bowl, or out on the grass reads as a texture bug, and the geometry
// is merged so nothing in the renderer will complain. Everything else about a
// decal (which cell, what tint) is cosmetic and does not need a test.
import assert from 'node:assert'
import { buildDecalGeometry, fixedDecalGeometry, poolSafeDecalGeometry, CLUSTERS } from './decals.js'
import { groundHeightAt } from './colliders.js'
import { BOWL, PERIMETER } from './levelData.js'

const g = buildDecalGeometry()
const pos = g.getAttribute('position').array
const uv = g.getAttribute('uv').array
const col = g.getAttribute('color')
const n = pos.length / 3

// Editor remounts must reuse one scatter. A fresh collision-aware build can
// legitimately differ after a level edit; the rendered geometry cannot.
assert.strictEqual(fixedDecalGeometry(), fixedDecalGeometry(), 'rendered decal geometry must be session-stable')

// Put the pool over the first fixed doodle. Pool safety removes that whole
// quad; it never relocates the source scatter to compensate.
const fixed = fixedDecalGeometry()
const fixedPos = fixed.getAttribute('position')
const oldBowl = { on: BOWL.on, cx: BOWL.cx, cz: BOWL.cz, r0: BOWL.r0 }
BOWL.on = true
BOWL.cx = (fixedPos.getX(0) + fixedPos.getX(1) + fixedPos.getX(2) + fixedPos.getX(3)) / 4
BOWL.cz = (fixedPos.getZ(0) + fixedPos.getZ(1) + fixedPos.getZ(2) + fixedPos.getZ(3)) / 4
BOWL.r0 = 0.01
const safe = poolSafeDecalGeometry()
assert(safe.getIndex().count <= fixed.getIndex().count - 6, 'pool overlap must hide the whole doodle')
Object.assign(BOWL, oldBowl)

// The scatter rejects candidates that don't fit, so a bad `fits` shows up as a
// near-empty park rather than as an error. Floor: enough to break up the plaza.
assert(n / 4 > CLUSTERS, `too few decals placed: ${n / 4} quads from ${CLUSTERS} clusters`)
assert(col.itemSize === 4, 'colour must be vec4 — the fade rides on vertex ALPHA')

let minY = 1
let maxY = -1
for (let i = 0; i < n; i++) {
  const x = pos[i * 3]
  const z = pos[i * 3 + 2]
  assert.equal(pos[i * 3 + 1], 0, 'decals are flat; the mesh carries the y offset')
  const h = groundHeightAt(x, z)
  assert(Math.abs(h) < 0.02, `decal corner at ${x.toFixed(1)},${z.toFixed(1)} is on geometry at y=${h.toFixed(2)}`)
  assert(
    x > PERIMETER.minX && x < PERIMETER.maxX && z > PERIMETER.minZ && z < PERIMETER.maxZ,
    `decal corner at ${x.toFixed(1)},${z.toFixed(1)} is outside the play area`,
  )
  const a = col.array[i * 4 + 3]
  minY = Math.min(minY, a)
  maxY = Math.max(maxY, a)
}

// Low contrast is a requirement, not a preference: full-strength marks read as
// stickers pasted over the render.
assert(maxY <= 1.001 && minY >= 0.4, `decal alpha out of the low-contrast band: ${minY.toFixed(2)}..${maxY.toFixed(2)}`)

// UVs must stay inside the atlas gutter or mipping bleeds the neighbouring cell.
for (let i = 0; i < uv.length; i++) assert(uv[i] > 0.014 && uv[i] < 0.986, `decal uv ${uv[i]} escapes the atlas gutter`)

console.log(`decals ok — ${n / 4} quads over ${CLUSTERS} clusters, alpha ${minY.toFixed(2)}..${maxY.toFixed(2)}`)
