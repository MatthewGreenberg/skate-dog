// Bone collectible placement: every bone floats inside the play area, in the
// reachable air band above whatever it hangs over (a bone under 0.9 is grabbed
// by rolling, over 4.4 is above any measured launch + the 1.1 collect radius),
// and the five sit on distinct lines, not clustered.
import { BONES, PERIMETER } from './levelData.js'
import { groundHeightAt } from './colliders.js'

function assert(ok, msg) {
  if (!ok) throw new Error(msg)
}

assert(BONES.length === 5, `expected 5 bones, got ${BONES.length}`)

let minH = Infinity
let maxH = 0
for (const b of BONES) {
  assert(
    b.x > PERIMETER.minX && b.x < PERIMETER.maxX && b.z > PERIMETER.minZ && b.z < PERIMETER.maxZ,
    `${b.id}: outside play area at (${b.x}, ${b.z})`,
  )
  const gy = groundHeightAt(b.x, b.z)
  const h = b.y - gy
  minH = Math.min(minH, h)
  maxH = Math.max(maxH, h)
  assert(h >= 0.9 && h <= 4.4, `${b.id}: floats ${h.toFixed(2)}m over surface y=${gy.toFixed(2)} (want 0.9..4.4)`)
}

for (let i = 0; i < BONES.length; i++)
  for (let j = i + 1; j < BONES.length; j++) {
    const d = Math.hypot(BONES[i].x - BONES[j].x, BONES[i].z - BONES[j].z)
    assert(d > 6, `${BONES[i].id} and ${BONES[j].id} only ${d.toFixed(1)}m apart`)
  }

console.log(`bones ok — 5 placed, float band ${minH.toFixed(2)}..${maxH.toFixed(2)}m, all >6m apart`)
