import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { P } from '../store.js'
import Dog from './Dog.jsx'
import Rider from './Rider.jsx'
import { applyClearCoat } from './clearCoat.js'
import { SIZE } from './dogFit.js'

const UP_Y = new THREE.Vector3(0, 1, 0)
const faceQ = new THREE.Quaternion()

// Dog and rider are separate rigs under one transform: the root carries world
// position + surface-aligned orientation, the dog rolls under the rider during
// tricks, and the rider keeps its own balance poses.
export default function Player() {
  const root = useRef()
  const riderRoot = useRef()

  // The coat is the RIDER's only — a coated dog reads as wet plastic, not fur.
  // Driven from here rather than from Rider so the leva folder sits with the
  // other player controls. Safe in an effect: Rider suspends on its GLB, so the
  // wrapper does not commit (and this effect does not fire) until meshes exist.
  const { clearcoat, roughness } = useControls('Clear coat', {
    clearcoat: { value: 0.33, min: 0, max: 1, step: 0.01 },
    roughness: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'coat rough' },
  })
  useEffect(() => {
    if (riderRoot.current) applyClearCoat(riderRoot.current, clearcoat, roughness)
  }, [clearcoat, roughness])

  // Dog size. `size` is this group's scale, so it carries the rider with it —
  // the two are one unit and a dog that grows out from under its rider is not a
  // size control. long/tall skew the dog's own fit; they go into Dog's mutable
  // SIZE rather than down as props because Dog and Rider both consume them in
  // the frame loop (the rider's feet ride backY(), which tall moves).
  const { size, long, tall } = useControls('Dog size', {
    size: { value: 1.58, min: 0.6, max: 3, step: 0.01 },
    long: { value: SIZE.long, min: 0.8, max: 2.4, step: 0.01 },
    tall: { value: SIZE.tall, min: 0.5, max: 1.6, step: 0.01 },
  })
  useEffect(() => {
    SIZE.long = long
    SIZE.tall = tall
  }, [long, tall])

  useFrame((state) => {
    const g = root.current
    if (!g) return
    g.position.copy(P.pos)
    // curvature lift: keeps the long dog's nose/tail out of tight transitions
    g.position.addScaledVector(P.up, P.surfLift)
    g.quaternion.copy(P.quat)
    // Title screen: the intro camera ORBITS (CameraController INTRO_SPIN), and a
    // parked dog holding its spawn heading turns its back on it half the way
    // round. So both rigs (the rider is a child of this group) face the lens
    // while P.intro is up, blended out on the same smoothstep everything else in
    // the reveal uses — the sim runs through the swoop, so this has to hand the
    // real heading back rather than release it. Flat facing quat on purpose: the
    // slerp levels any surface tilt only in proportion to a weight that is
    // already decaying, and the spawn is flat plaza. PHOTO pins P.intro to 0, so
    // captures never see this.
    if (P.intro > 0) {
      const k = P.intro * P.intro * (3 - 2 * P.intro)
      const cam = state.camera.position
      faceQ.setFromAxisAngle(UP_Y, Math.atan2(cam.x - P.pos.x, cam.z - P.pos.z))
      g.quaternion.slerp(faceQ, k)
    }
  })
  return (
    <group ref={root} scale={size}>
      <Dog />
      <group ref={riderRoot}>
        <Rider />
      </group>
    </group>
  )
}
