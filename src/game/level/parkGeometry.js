import * as THREE from 'three'
import { PERIMETER, bowlRadius, BOWL } from './levelData.js'
import { PLAZA_TILE, AO_BOUNDS } from './textures.js'

// Geometry builders for the authored park. All world-space where it makes
// sense so the renderer can drop them straight into the scene.

/** The plaza slab with the kidney bowl punched out of it. */
export function buildPlazaGeometry() {
  const P = PERIMETER
  const pad = 1.4
  // shape lives in XY; after rotateX(-90) the shape's +Y becomes world -Z
  const s = new THREE.Shape()
  s.moveTo(P.minX - pad, -(P.minZ - pad))
  s.lineTo(P.maxX + pad, -(P.minZ - pad))
  s.lineTo(P.maxX + pad, -(P.maxZ + pad))
  s.lineTo(P.minX - pad, -(P.maxZ + pad))
  s.closePath()

  const hole = new THREE.Path()
  const N = 180
  for (let i = 0; i <= N; i++) {
    const phi = (i / N) * Math.PI * 2
    const r = bowlRadius(phi)
    const x = BOWL.cx + Math.cos(phi) * r
    const z = BOWL.cz + Math.sin(phi) * r
    if (i === 0) hole.moveTo(x, -z)
    else hole.lineTo(x, -z)
  }
  s.holes.push(hole)

  const g = new THREE.ShapeGeometry(s, 12)
  g.rotateX(-Math.PI / 2)
  // world-space UVs so the slab pattern is continuous across the whole plaza
  const pos = g.attributes.position
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / PLAZA_TILE
    uv[i * 2 + 1] = pos.getZ(i) / PLAZA_TILE
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  // uv1 drives the baked top-down occlusion map
  const B = AO_BOUNDS
  const uv1 = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv1[i * 2] = (pos.getX(i) - B.minX) / (B.maxX - B.minX)
    uv1[i * 2 + 1] = (pos.getZ(i) - B.minZ) / (B.maxZ - B.minZ)
  }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  g.computeVertexNormals()
  return g
}

/** Landscaped band around the plaza. A ring, so it never slices the bowl. */
export function buildGrassGeometry() {
  const P = PERIMETER
  const pad = 1.4
  const s = new THREE.Shape()
  s.moveTo(-190, -190)
  s.lineTo(190, -190)
  s.lineTo(190, 190)
  s.lineTo(-190, 190)
  s.closePath()
  const hole = new THREE.Path()
  hole.moveTo(P.minX - pad, -(P.minZ - pad))
  hole.lineTo(P.minX - pad, -(P.maxZ + pad))
  hole.lineTo(P.maxX + pad, -(P.maxZ + pad))
  hole.lineTo(P.maxX + pad, -(P.minZ - pad))
  hole.closePath()
  s.holes.push(hole)
  const g = new THREE.ShapeGeometry(s)
  g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    // one repeat per ~11 world units. At the old 0.35 the tile was 2.9 units
    // across and the grass read as television static from the game camera.
    uv[i * 2] = pos.getX(i) * 0.09
    uv[i * 2 + 1] = pos.getZ(i) * 0.09
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

/** Ramp / bank / quarter-pipe solid. Local: uphill along +Z, y0 at -d/2. */
export function buildRampGeometry(w, d, y0, y1, curve, base = 0) {
  const N = curve === 'quarter' ? 20 : 6
  const h = y1 - y0
  const R = (d * d + h * h) / (2 * h)
  const prof = []
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * d
    const y = curve === 'quarter' ? y0 + R - Math.sqrt(Math.max(0, R * R - s * s)) : y0 + (h * s) / d
    prof.push([s - d / 2, y])
  }

  const pos = []
  const uv = []
  const idx = []
  const hw = w / 2

  // top surface — UVs in world units so the slab pattern matches the plaza
  const U = 1 / PLAZA_TILE
  let arc = 0
  for (let i = 0; i <= N; i++) {
    const [z, y] = prof[i]
    if (i > 0) arc += Math.hypot(z - prof[i - 1][0], y - prof[i - 1][1])
    pos.push(-hw, y, z, hw, y, z)
    uv.push(-hw * U, arc * U, hw * U, arc * U)
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }

  // side skirts (two quads per profile segment) + back face
  for (const sx of [-hw, hw]) {
    const o = pos.length / 3
    for (let i = 0; i <= N; i++) {
      const [z, y] = prof[i]
      pos.push(sx, y, z, sx, base, z)
      uv.push(z * U, y * U, z * U, base * U)
    }
    for (let i = 0; i < N; i++) {
      const a = o + i * 2
      if (sx < 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  // back wall at the high end
  const b = pos.length / 3
  const [bz, by] = prof[N]
  pos.push(-hw, by, bz, hw, by, bz, -hw, base, bz, hw, base, bz)
  uv.push(-hw * U, by * U, hw * U, by * U, -hw * U, base * U, hw * U, base * U)
  idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  // group 0 = the ridden top surface, group 1 = skirts + back wall, so the
  // halfpipe can lay a different sheet material on the surface than on the
  // structure. A single (non-array) material renders both groups identically.
  g.addGroup(0, N * 6, 0)
  g.addGroup(N * 6, idx.length - N * 6, 1)
  g.computeVertexNormals()
  return g
}

