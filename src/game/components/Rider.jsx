// The kid riding the dachshund: public/boy.glb, posed every frame by the same
// authored pose table the procedural rider used. Feet sit at Dog's BACK_Y
// (measured off the dachshund's fitted bind pose), forward is +Z. No clips ship
// in the file — every angle below is hand-authored and damped, so the rider
// still reacts to the sim rather than playing back a loop.
//
// The GLB's L_* bones are the +X side, which is the side the pose table calls
// L, so the pose numbers carry over unchanged. See boneRig.js for why the
// angles go on as world-space deltas instead of straight onto bone.rotation.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { P } from '../store.js'
import { buildRig, setBone, eulerDelta, armDelta, elbowDelta } from '../player/boneRig.js'
import { BACK_Y } from './Dog.jsx'

const URL = '/boy.glb'
useGLTF.preload(URL)

// The model is authored 1.0 units tall and the old procedural boy stood ~1.02
// in this same parent, so nothing rescales. Limb lengths come off the bind pose
// (buildRig) rather than being typed in here.
const PELVIS_FREE = 0.3 // pelvis height when the legs are not carrying weight

// hip/knee: positive swings the limb backward (-Z). a?r: outward raise (0 = arm
// down, 1.57 = level). a?s: forward/back swing. a?e: elbow, negative folds the
// forearm forward. plant: how much the feet carry weight. gait: how much the
// dog's run cycle shows in the arms.
const POSES = {
  ride:  { hipL: -0.36, kneeL: 0.30, hipR: 0.26, kneeR: 0.20, aLr: 1.42, aLs: -0.26, aLe: -0.30, aRr: 1.42, aRs: -0.26, aRe: -0.30, torso: 0.10, plant: 1, gait: 1 },
  tuck:  { hipL: -0.78, kneeL: 0.80, hipR: 0.62, kneeR: 0.58, aLr: 0.42, aLs: -0.55, aLe: -1.15, aRr: 0.42, aRs: -0.55, aRe: -1.15, torso: 0.34, plant: 1, gait: 0.3 },
  air:   { hipL: -1.15, kneeL: 1.25, hipR: -0.55, kneeR: 1.40, aLr: 2.45, aLs: -0.14, aLe: -0.18, aRr: 2.45, aRs: 0.08, aRe: -0.18, torso: -0.14, plant: 0, gait: 0 },
  grab:  { hipL: -1.25, kneeL: 1.55, hipR: -0.95, kneeR: 1.6, aLr: 2.6, aLs: 0.2, aLe: -0.3, aRr: -0.42, aRs: -0.7, aRe: -0.1, torso: 0.44, plant: 0, gait: 0 },
  grind: { hipL: -0.98, kneeL: 1.15, hipR: 0.82, kneeR: 0.92, aLr: 1.78, aLs: 0.0, aLe: -0.04, aRr: 1.78, aRs: 0.0, aRe: -0.04, torso: 0.3, plant: 1, gait: 0.2 },
  land:  { hipL: -1.05, kneeL: 1.25, hipR: 0.88, kneeR: 1.00, aLr: 0.75, aLs: -0.95, aLe: -0.55, aRr: 0.75, aRs: -0.95, aRe: -0.55, torso: 0.45, plant: 1, gait: 0 },
  bail:  { hipL: 0.25, kneeL: 0.55, hipR: -0.35, kneeR: 0.80, aLr: 2.40, aLs: 0.25, aLe: -0.85, aRr: 2.35, aRs: -0.20, aRe: -0.95, torso: -0.55, plant: 0.25, gait: 0 },
}
const KEYS = Object.keys(POSES.ride)

const _d = new THREE.Quaternion() // the only delta the frame loop allocates: none

export default function Rider() {
  const root = useRef()
  const body = useRef()
  const { scene } = useGLTF(URL)

  const rig = useMemo(() => {
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      // skinned bounds are the bind pose; posing pushes verts outside it
      o.frustumCulled = false
      // Tripo bakes its own light into the albedo, so the maps stay as authored
      // — but 0.5 roughness reads as vinyl next to the park's matte surfaces.
      o.material.roughness = 0.85
      o.material.metalness = 0
    })
    return buildRig(scene)
  }, [scene])
  const bones = rig.bones

  const curRef = useRef({ ...POSES.ride })
  const secRef = useRef({ sway: 0, flail: 0 })

  useFrame((st, delta) => {
    const cur = curRef.current
    const sec = secRef.current
    const dt = Math.min(delta, 0.05)
    const pose = POSES[P.riderPose] || POSES.ride

    const k = 1 - Math.exp(-11 * dt)
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i]
      cur[key] += (pose[key] - cur[key]) * k
    }
    const ks = 1 - Math.exp(-7 * dt)
    sec.sway += (Math.max(-1, Math.min(1, P.steer)) - sec.sway) * ks
    sec.flail += ((P.riderPose === 'bail' ? 1 : 0) - sec.flail) * ks

    // ---- root: lifts clear of the dog, leans into turns, folds on impact
    const rootPitch = P.stretch * 0.16 - P.crouch * 0.18
    root.current.position.y = BACK_Y + P.riderLift * 0.3
    root.current.rotation.z = -P.lean * 0.24
    root.current.rotation.x = rootPitch

    // ---- pelvis height: two-link leg drop while the feet carry weight
    const plant = cur.plant * (1 - 0.6 * P.riderLift)
    const dropL = rig.thigh * Math.cos(cur.hipL) + rig.shin * Math.cos(cur.hipL + cur.kneeL)
    const dropR = rig.thigh * Math.cos(cur.hipR) + rig.shin * Math.cos(cur.hipR + cur.kneeR)
    const gait = cur.gait * P.runBlend * (P.grounded ? 1 : 0.25)
    const bob = Math.sin(P.run * 2) * 0.013 * gait
    body.current.position.y =
      plant * (rig.ankle + 0.5 * (dropL + dropR)) + (1 - plant) * PELVIS_FREE + bob
    body.current.rotation.z = sec.sway * 0.09

    setBone(bones.L_Thigh, eulerDelta(_d, cur.hipL))
    setBone(bones.R_Thigh, eulerDelta(_d, cur.hipR))
    setBone(bones.L_Calf, eulerDelta(_d, cur.kneeL))
    setBone(bones.R_Calf, eulerDelta(_d, cur.kneeR))
    // level the soles while planted, let the toes drop in the air
    setBone(bones.L_Foot, eulerDelta(_d, -(cur.hipL + cur.kneeL) * plant + (1 - plant) * 0.3))
    setBone(bones.R_Foot, eulerDelta(_d, -(cur.hipR + cur.kneeR) * plant + (1 - plant) * 0.3))

    // ---- spine: pose pitch + speed lean, shoulders counter the turn. Split
    // over both spine joints so the bend curves instead of hinging at the waist.
    const chestPitch = cur.torso + Math.min(P.speed, 18) * 0.006
    eulerDelta(_d, chestPitch * 0.5, -sec.sway * 0.14, -sec.sway * 0.03)
    setBone(bones.Spine01, _d)
    setBone(bones.Spine02, _d)

    const t = st.clock.elapsedTime
    const swing = Math.sin(P.run) * 0.11 * gait
    const lift = Math.cos(P.run) * 0.05 * gait
    const flailA = Math.sin(t * 19) * 0.32 * sec.flail
    const flailB = Math.sin(t * 17 + 1.9) * 0.32 * sec.flail
    setBone(bones.L_Upperarm, armDelta(_d, cur.aLr + lift + flailA, cur.aLs + swing + flailA * 0.5, 1))
    setBone(bones.R_Upperarm, armDelta(_d, cur.aRr - lift + flailB, cur.aRs - swing + flailB * 0.5, -1))
    setBone(bones.L_Forearm, elbowDelta(_d, cur.aLe - swing * 0.4, 1))
    setBone(bones.R_Forearm, elbowDelta(_d, cur.aRe + swing * 0.4, -1))

    // ---- head rides steadier than the body it sits on. The spine already
    // carries half the pitch, so only the remainder is cancelled here.
    setBone(bones.Head, eulerDelta(
      _d,
      -(chestPitch * 0.5 + rootPitch * 0.45),
      sec.sway * 0.55,
      P.lean * 0.11 - sec.sway * 0.05,
    ))
  })

  return (
    <group ref={root} position={[0, BACK_Y, 0]}>
      {/* body is the pelvis: the model hangs off it with its hip on the origin */}
      <group ref={body}>
        <primitive object={scene} position={rig.hip.clone().negate()} />
      </group>
    </group>
  )
}
