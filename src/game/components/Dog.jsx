// The dachshund: public/dog_compressed.glb, posed every frame. He *is* the
// board — the rider stands on his back.
//
// Parent frame (what the sim expects): paws at y=0, nose at +Z, length ~1.28.
// The GLB is authored nose at +X, up +Y, paws already at y~0.006, so the model
// hangs inside a wrapper that yaws it -90 degrees about Y (+X -> +Z) and scales
// it to that length. The fit is measured off the bind-pose bounds at load, not
// typed in, so a re-export moves with it.
//
// The file ships no animation clips and no A-pose weirdness — the rest pose is
// a neutral stand — so the gait below is authored, same as the rider's, and
// goes on through boneRig's world-space deltas (see boneRig.js for why a bone
// rotation cannot just be assigned).

import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { KTX2Loader } from 'three-stdlib'
import * as THREE from 'three'
import { P } from '../store.js'
import { captureRest, setBone, eulerDelta } from '../player/boneRig.js'

const URL = '/dog_compressed.glb'
// Draco + KTX2 decoders are copied out of three/examples/jsm/libs into public/.
// drei's default draco path is a gstatic CDN; nothing else in this project
// fetches over the network and the shoot harness must not either.
const DRACO_PATH = '/draco/'
const BASIS_PATH = '/basis/'

const TARGET_LENGTH = 1.12 // nose to tail tip in parent units

// Where the rider's feet go. The model is authored exactly 1.0 long and its
// skinned rest bounds top out at 0.293 between the shoulders and the hips, so
// the back scales with the fit; the feet then sink 0.02 into the coat rather
// than hovering on it.
export const BACK_Y = 0.293 * TARGET_LENGTH - 0.02

// Tripo's names. 0_ limbs are the front pair, 1_ the rear; Head_0 is really the
// chest (the front legs hang off it), Head_2 the skull. Head_3 / bone_7 are the
// two ears, bone_5 the snout.
const B = {
  neck: 'tripoHead_1',
  skull: 'tripoHead_2',
  earL: 'tripoHead_3',
  earR: 'bone_7',
  tail0: 'bone_24',
  tail1: 'bone_25',
  tail2: 'tripoTail_0',
}
// front-left, front-right, back-left, back-right — the diagonal pairs the trot
// runs on are (FL, BR) and (FR, BL).
const LEGS = [
  ['tripo0_Left_Limb_0', 'tripo0_Left_Limb_1', 'tripo0_Left_Limb_2'],
  ['tripo0_Right_Limb_0', 'tripo0_Right_Limb_1', 'tripo0_Right_Limb_2'],
  ['tripo1_Left_Limb_0', 'tripo1_Left_Limb_1', 'tripo1_Left_Limb_2'],
  ['tripo1_Right_Limb_0', 'tripo1_Right_Limb_1', 'tripo1_Right_Limb_2'],
]
const BONES = [...Object.values(B), ...LEGS.flat()]

const _d = new THREE.Quaternion()
const _box = new THREE.Box3()
const _size = new THREE.Vector3()

const damp = (cur, to, lambda, dt) => cur + (to - cur) * (1 - Math.exp(-lambda * dt))

// In model space forward is +X and up is +Y, so a limb swings fore/aft about Z,
// an ear flaps about X and the tail wags about Y.
const swingZ = (bone, a) => setBone(bone, eulerDelta(_d, 0, 0, a))

export default function Dog() {
  const root = useRef()
  const gl = useThree((s) => s.gl)

  const { scene } = useGLTF(URL, DRACO_PATH, true, (loader) => {
    loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(gl))
  })

  const bones = useMemo(() => {
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      // skinned bounds are the bind pose; posing pushes verts outside it
      o.frustumCulled = false
      // Tripo bakes its own light into the albedo, so the map stays as authored
      // — but its 0.5 roughness reads as vinyl next to the park's matte paint.
      o.material.roughness = 0.85
      o.material.metalness = 0
    })
    return captureRest(scene, BONES)
  }, [scene])

  // Bind-pose bounds -> uniform scale and the drop that puts the paws on y=0.
  const { scale, lift } = useMemo(() => {
    _box.setFromObject(scene)
    _box.getSize(_size)
    const s = TARGET_LENGTH / _size.x
    return { scale: s, lift: -_box.min.y * s }
  }, [scene])

  const a = useRef({ tuck: 0, splay: 0, tilt: 0, wag: 0, ez: [0, 0], ezv: [0, 0] })

  useFrame((_, delta) => {
    if (!root.current) return
    const dt = Math.min(delta, 1 / 30)
    const s = a.current
    const spd = Math.min(P.speed / 12, 1)
    const air = P.state === 'air'

    s.tuck = damp(s.tuck, air ? 1 : 0, 11, dt)
    s.splay = damp(s.splay, P.state === 'grind' ? 1 : 0, 9, dt)

    // how much of the trot survives after tucking / grinding
    const cycle = P.runBlend * (1 - s.tuck) * (1 - s.splay)
    const bob = Math.sin(P.run * 2) * 0.016 * cycle

    const r = root.current
    r.rotation.x = P.dogPitch
    r.rotation.y = Math.sin(P.run) * 0.05 * cycle
    r.rotation.z = P.dogRoll + P.lean * 0.22 + Math.sin(P.run) * 0.035 * cycle
    r.position.y = bob - P.crouch * 0.06
    r.scale.set(
      1 + P.crouch * 0.08,
      1 - P.crouch * 0.2 - P.stretch * 0.02,
      1 + P.stretch * 0.07,
    )

    // legs: diagonal trot, folding under the belly in the air and splaying out
    // sideways on a grind. The knee counter-rotates so the paw stays under the
    // hip instead of scything forward with the whole limb.
    const amp = (0.3 + spd * 0.42) * cycle
    for (let i = 0; i < 4; i++) {
      const front = i < 2 ? 1 : -1
      const side = i % 2 ? -1 : 1
      const diagonal = i === 0 || i === 3 ? 0 : Math.PI
      const swing = Math.sin(P.run + diagonal) * amp
      const [hip, knee, ankle] = LEGS[i]
      setBone(bones[hip], eulerDelta(_d, side * (0.06 + 0.34 * s.splay), 0, swing - front * 0.8 * s.tuck))
      swingZ(bones[knee], -swing * 0.55 + front * 1.1 * s.tuck)
      swingZ(bones[ankle], swing * 0.25)
    }

    // ears: damped springs kicked by the gait. They hang down the sides of the
    // skull at rest and only swing out a little, so they read as ears not fins.
    const kick = Math.cos(P.run * 2) * cycle * 8
    const flare = 0.08 + spd * 0.2 + Math.min(Math.abs(P.dogRoll), 3) * 0.1 + P.riderLift * 0.08
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1
      s.ezv[i] += ((side * flare - P.lean * 0.18 - s.ez[i]) * 120 - s.ezv[i] * 13 + side * kick * 0.4) * dt
      s.ez[i] += s.ezv[i] * dt
      setBone(bones[i ? B.earR : B.earL], eulerDelta(_d, s.ez[i], 0, 0))
    }

    // tail: lifts with speed, drops in the air, wags across the whole chain so
    // the tip travels further than the root.
    s.wag += (5 + spd * 9) * dt
    s.tilt = damp(s.tilt, air ? -0.1 : 0.35 + spd * 0.25, 6, dt)
    const wag = Math.sin(s.wag) * (0.18 + 0.34 * P.runBlend + 0.2 * s.tuck)
    setBone(bones[B.tail0], eulerDelta(_d, 0, wag, s.tilt))
    setBone(bones[B.tail1], eulerDelta(_d, 0, wag * 1.6, s.tilt * 0.6))
    setBone(bones[B.tail2], eulerDelta(_d, 0, wag * 2.2, s.tilt * 0.3))

    // head rides steadier than the body: the neck takes the pitch, the skull
    // takes the turn, so a carve reads as the dog looking where it is going.
    const pitch = -(0.04 + spd * 0.1 - s.tuck * 0.25)
    setBone(bones[B.neck], eulerDelta(_d, 0, 0, pitch * 0.5))
    setBone(bones[B.skull], eulerDelta(_d, -P.lean * 0.16, -P.lean * 0.28, pitch * 0.5))
  })

  return (
    <group ref={root}>
      <group rotation={[0, -Math.PI / 2, 0]} scale={scale} position={[0, lift, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  )
}
