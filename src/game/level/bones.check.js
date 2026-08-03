// Collectible placement: bones and D-O-G letters float inside the play area, in
// the reachable air band above whatever they hang over (under 0.9 is grabbed by
// rolling, over 4.4 is above any measured launch + the 1.1 collect radius), and
// they sit on distinct lines rather than clustered. Trash cans are ground props
// and get a clearance test against the walls and planters instead — a can
// buried in masonry is invisible until someone rides at it.
import { BONES, LETTERS, CANS, PERIMETER, WALLS, PLANTERS } from './levelData.js'
import { groundHeightAt } from './colliders.js'

function assert(ok, msg) {
  if (!ok) throw new Error(msg)
}

assert(BONES.length === 5, `expected 5 bones, got ${BONES.length}`)
assert(LETTERS.length === 3, `expected 3 letters, got ${LETTERS.length}`)
assert(LETTERS.map((l) => l.ch).join('') === 'DOG', 'the letters must spell DOG')
assert(CANS.length === 5, `expected 5 cans, got ${CANS.length}`)

const inPlay = (p) =>
  p.x > PERIMETER.minX && p.x < PERIMETER.maxX && p.z > PERIMETER.minZ && p.z < PERIMETER.maxZ

// ---------------------------------------------------------------- floaters
// Bones and letters share the collect radius (Bones.jsx exports it to
// Letters.jsx), so they share the reachability band and the spacing rule — and
// they are checked TOGETHER, because a letter parked on a bone is the same
// mistake as two bones parked together.
const floats = [...BONES, ...LETTERS]
let minH = Infinity
let maxH = 0
for (const b of floats) {
  assert(inPlay(b), `${b.id}: outside play area at (${b.x}, ${b.z})`)
  const gy = groundHeightAt(b.x, b.z)
  const h = b.y - gy
  minH = Math.min(minH, h)
  maxH = Math.max(maxH, h)
  assert(h >= 0.9 && h <= 4.4, `${b.id}: floats ${h.toFixed(2)}m over surface y=${gy.toFixed(2)} (want 0.9..4.4)`)
}

for (let i = 0; i < floats.length; i++)
  for (let j = i + 1; j < floats.length; j++) {
    const d = Math.hypot(floats[i].x - floats[j].x, floats[i].z - floats[j].z)
    assert(d > 6, `${floats[i].id} and ${floats[j].id} only ${d.toFixed(1)}m apart`)
  }

// ---------------------------------------------------------------- cans
// A can is 0.36 radius and gets ridden through, so it needs standing room, not
// just a non-overlapping footprint: CLEAR is the can plus the player's own
// radius plus a margin.
const CLEAR = 1.4

function boxDist(px, pz, o) {
  // distance from a point to an axis-rotated box's footprint (0 if inside)
  const c = Math.cos(-(o.rot || 0))
  const s = Math.sin(-(o.rot || 0))
  const dx = px - o.x
  const dz = pz - o.z
  const lx = Math.abs(dx * c - dz * s) - o.w / 2
  const lz = Math.abs(dx * s + dz * c) - o.d / 2
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0))
}

for (const c of CANS) {
  assert(inPlay(c), `${c.id}: outside play area at (${c.x}, ${c.z})`)
  for (const w of WALLS) {
    const d = boxDist(c.x, c.z, w)
    assert(d > CLEAR, `${c.id}: ${d.toFixed(2)}m from a wall at (${w.x}, ${w.z}) — want >${CLEAR}`)
  }
  for (const p of PLANTERS) {
    const d = boxDist(c.x, c.z, p)
    assert(d > CLEAR, `${c.id}: ${d.toFixed(2)}m from the planter at (${p.x}, ${p.z}) — want >${CLEAR}`)
  }
  // and not stacked on each other
  for (const o of CANS)
    if (o !== c) {
      const d = Math.hypot(o.x - c.x, o.z - c.z)
      assert(d > 5, `${c.id} and ${o.id} only ${d.toFixed(1)}m apart`)
    }
}

console.log(
  `collectibles ok — ${BONES.length} bones + ${LETTERS.length} letters, ` +
    `float band ${minH.toFixed(2)}..${maxH.toFixed(2)}m, all >6m apart; ${CANS.length} cans clear`,
)
