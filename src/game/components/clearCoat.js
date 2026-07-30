// Clear coat for the two GLB rigs (boy + dog). MeshStandardMaterial has no
// clearcoat lobe at all, so the first pass swaps each mesh's material for a
// MeshPhysicalMaterial carrying the same maps.
//
// The swap runs `copy` off the STANDARD prototype rather than physical's own:
// MeshPhysicalMaterial.copy reads clearcoat/sheen/iridescence off the source,
// and a standard material has none of them, so every physical parameter lands
// as undefined and the shader gets NaN uniforms. Borrowing the parent's copy
// leaves physical's constructor defaults intact — but it also rewrites
// `defines` to STANDARD-only, so PHYSICAL has to go back by hand or the
// clearcoat chunks never make it into the program.

import * as THREE from 'three'

export function applyClearCoat(root, clearcoat, clearcoatRoughness) {
  root.traverse((o) => {
    if (!o.isMesh) return
    if (!o.material.isMeshPhysicalMaterial) {
      const m = new THREE.MeshPhysicalMaterial()
      THREE.MeshStandardMaterial.prototype.copy.call(m, o.material)
      m.defines = { STANDARD: '', PHYSICAL: '' }
      o.material = m
    }
    // USE_CLEARCOAT is a compile-time define keyed on `clearcoat > 0`, and the
    // renderer only re-picks a program when the material's version moves — so
    // a 0 -> 0.4 drag would otherwise render exactly as it did at 0. Recompile
    // on the crossing only; every other value on the slider is a uniform, and
    // flagging needsUpdate per drag frame rebuilds both rigs' shaders.
    if ((o.material.clearcoat > 0) !== (clearcoat > 0)) o.material.needsUpdate = true
    o.material.clearcoat = clearcoat
    o.material.clearcoatRoughness = clearcoatRoughness
  })
}
