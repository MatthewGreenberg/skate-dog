import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { P } from '../store.js'
import Dog from './Dog.jsx'
import Rider from './Rider.jsx'
import { applyClearCoat } from './clearCoat.js'

// Dog and rider are separate rigs under one transform: the root carries world
// position + surface-aligned orientation, the dog rolls under the rider during
// tricks, and the rider keeps its own balance poses.
export default function Player() {
  const root = useRef()

  // The coat is driven from here rather than from Dog/Rider so one slider moves
  // both rigs — two useControls on the same leva path is a duplicate-key clash.
  // Safe in an effect: both children suspend on their GLB, so nothing under this
  // group commits (and this effect does not fire) until the meshes exist.
  const { clearcoat, roughness } = useControls('Clear coat', {
    clearcoat: { value: 0, min: 0, max: 1, step: 0.01 },
    roughness: { value: 0.23, min: 0, max: 1, step: 0.01, label: 'coat rough' },
  })
  useEffect(() => {
    if (root.current) applyClearCoat(root.current, clearcoat, roughness)
  }, [clearcoat, roughness])

  useFrame(() => {
    const g = root.current
    if (!g) return
    g.position.copy(P.pos)
    g.quaternion.copy(P.quat)
  })
  return (
    <group ref={root} scale={1.22}>
      <Dog />
      <Rider />
    </group>
  )
}
