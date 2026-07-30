// Self-check for clearCoat.js: the standard -> physical swap has to keep the
// maps, keep the PHYSICAL define, and leave physical's own defaults finite.
// A NaN clearcoatRoughness renders a plausible-looking matte rig, not an error.
// Run: node src/game/components/clearCoat.check.js

import assert from 'node:assert/strict'
import * as THREE from 'three'
import { applyClearCoat } from './clearCoat.js'

const map = new THREE.Texture()
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0, name: 'coat' }),
)
const root = new THREE.Group().add(mesh)

applyClearCoat(root, 0.35, 0.23)
const m = mesh.material
assert.ok(m.isMeshPhysicalMaterial, 'material must become physical')
assert.ok(m.defines.PHYSICAL !== undefined, 'PHYSICAL define stomped by copy()')
assert.equal(m.map, map, 'albedo lost in the swap')
assert.equal(m.roughness, 0.85, 'base roughness lost in the swap')
assert.equal(m.clearcoat, 0.35)
assert.equal(m.clearcoatRoughness, 0.23)
// physical's own params must be its constructor defaults, not undefined
for (const k of ['sheen', 'iridescence', 'transmission', 'clearcoatNormalScale'])
  assert.notEqual(m[k], undefined, `${k} came through undefined`)
assert.ok(Number.isFinite(m.sheen) && Number.isFinite(m.transmission))

// second pass: reuse the same material, and only recompile across the 0 boundary
m.version = 0
applyClearCoat(root, 0.6, 0.1)
assert.equal(mesh.material, m, 'material re-created on a plain slider move')
assert.equal(m.version, 0, 'needsUpdate flagged without crossing zero')
applyClearCoat(root, 0, 0.1)
assert.ok(m.version > 0, 'no recompile when clearcoat drops to 0')

console.log('clearCoat.check: ok')
