import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { P, useGame, emit } from '../store.js'
import { PHOTO, PHOTO_TIME } from '../photo.js'
import { BONES } from '../level/levelData.js'

// Floating collectible bones. Idle: bob + slow spin + a warm emissive pulse.
// Collected: overshoot pop, fast spin, rises and shrinks to zero while Effects
// throws a gold star burst + shockwave ('bone' event) and AudioManager chimes.

// Classic cartoon dog bone, one merged geometry: a waisted lathe shaft along Y
// with four sphere lobes splayed in the shaft's plane, then laid along X. The
// lobes splay VERTICALLY after the rotate, so the spinning silhouette reads
// as a bone from every bearing instead of collapsing to a capsule edge-on.
function buildBoneGeo() {
  const half = 0.29
  const pts = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    // waist 0.072 flaring to ~0.127 at the ends, quartic so the middle stays slim
    pts.push(new THREE.Vector2(0.072 + 0.055 * Math.pow(Math.abs(t - 0.5) * 2, 2.4), (t - 0.5) * 2 * half))
  }
  const parts = [new THREE.LatheGeometry(pts, 24)]
  const knob = new THREE.SphereGeometry(0.135, 20, 16)
  for (const ey of [1, -1])
    for (const ex of [1, -1]) {
      const k = knob.clone()
      k.translate(ex * 0.088, ey * (half + 0.05), 0)
      parts.push(k)
    }
  const g = mergeGeometries(parts)
  g.rotateZ(Math.PI / 2)
  return g
}
const boneGeo = buildBoneGeo()

// Aged ivory under clearcoat — the polished-trophy read. Emissive is the
// "collect me" pulse; it stays under the 1.18 bloom threshold on purpose so
// the bone glows warm without hazing when bloom is on.
const boneMat = new THREE.MeshPhysicalMaterial({
  color: '#f3ecdb',
  roughness: 0.38,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.22,
  emissive: '#ffb64f',
  emissiveIntensity: 0.18,
})

const R2 = 1.1 * 1.1 // collect radius on the body centre (P.pos + 0.45 up)
const POP = 0.6 // seconds of collect animation

function collect(g) {
  const game = useGame.getState()
  const n = game.bones + 1
  const all = n === BONES.length
  const pts = all ? 2500 : 500
  game.collectBone()
  game.addScore(pts)
  game.showTrick(all ? 'ALL BONES!' : `Bone ${n}/${BONES.length}`, pts)
  emit('bone', { pos: g.position, big: all })
}

export default function Bones() {
  const refs = useRef([])
  const st = useRef(BONES.map(() => ({ got: false, t: 0 })))

  useFrame((state, delta) => {
    // photo mode pins the clock so captures stay byte-comparable
    const time = PHOTO ? PHOTO_TIME : state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    const started = useGame.getState().started
    for (let i = 0; i < BONES.length; i++) {
      const g = refs.current[i]
      if (!g) continue
      const s = st.current[i]
      const b = BONES[i]
      if (!s.got) {
        g.position.y = b.y + Math.sin(time * 1.7 + i * 1.9) * 0.11
        g.rotation.y = time * 1.5 + i * 1.3
        if (started && !PHOTO) {
          const dx = P.pos.x - b.x
          const dy = P.pos.y + 0.45 - g.position.y
          const dz = P.pos.z - b.z
          if (dx * dx + dy * dy + dz * dz < R2) {
            s.got = true
            s.t = 0
            collect(g)
          }
        }
      } else if (s.t < POP) {
        s.t += dt
        const k = s.t / POP
        g.position.y += (3.2 - 2.8 * k) * dt // leaps up, decelerating
        g.rotation.y += 22 * dt // victory spin
        // overshoots to ~1.5x in the first 22%, then shrinks out
        g.scale.setScalar(k < 0.22 ? 1 + 2.2 * k : Math.max(0, 1.48 * (1 - (k - 0.22) / 0.78)))
      } else if (g.visible) {
        g.visible = false
      }
    }
    boneMat.emissiveIntensity = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(time * 2.6))
  })

  return BONES.map((b, i) => (
    <group key={b.id} ref={(el) => (refs.current[i] = el)} position={[b.x, b.y, b.z]}>
      {/* jaunty fixed tilt; the group carries the world-Y spin */}
      <mesh geometry={boneGeo} material={boneMat} rotation-z={0.42} castShadow />
    </group>
  ))
}
