// The kid riding the dachshund: public/boy.glb, posed every frame by the same
// authored pose table the procedural rider used. Feet sit at Dog's backY()
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
import { backY } from './dogFit.js'
import { hueShift } from './recolor.js'

const URL = '/boy.glb'
// Draco-compressed (34MB -> 4.1MB), decoder served locally like the dog's.
const DRACO_PATH = '/draco/'
useGLTF.preload(URL, DRACO_PATH)

// The model is authored 1.0 units tall and the old procedural boy stood ~1.02
// in this same parent, so nothing rescales. Limb lengths come off the bind pose
// (buildRig) rather than being typed in here.
const PELVIS_FREE = 0.3 // pelvis height when the legs are not carrying weight
// The soles bite into the coat rather than resting on top of it — standing at
// backY() exactly reads as standing *beside* the dog at this size.
const SINK = 0.035

// hip/knee: positive swings the limb backward (-Z). a?r: outward raise (0 = arm
// down, 1.57 = level). a?s: forward/back swing. a?e: elbow, negative folds the
// forearm forward. plant: how much the feet carry weight. gait: how much the
// dog's run cycle shows in the arms.
const POSES = {
  // Knees carry a permanent bend: at this dog size a straight-legged stance
  // reads as standing next to it. The two legs must DROP the same amount —
  // body.position.y takes the mean of the two, so any difference floats one
  // foot and buries the other. Cos is what does the dropping, so the angles are
  // mirrored across the pair (front: thigh 0.68 fwd / shin 0.42 back, rear the
  // other way round) rather than the pose being mirrored: ~0.85 of the leg's
  // length, a 4cm crouch on a 1.0-tall boy, with the drops within 5mm.
  ride:  { hipL: -0.68, kneeL: 1.10, hipR: 0.42, kneeR: 0.26, aLr: 1.42, aLs: -0.26, aLe: -0.30, aRr: 1.42, aRs: -0.26, aRe: -0.30, torso: 0.24, plant: 1, gait: 1, duck: 0 },
  tuck:  { hipL: -0.78, kneeL: 0.80, hipR: 0.62, kneeR: 0.58, aLr: 0.42, aLs: -0.55, aLe: -1.15, aRr: 0.42, aRs: -0.55, aRe: -1.15, torso: 0.34, plant: 1, gait: 0.3, duck: 0 },
  air:   { hipL: -1.15, kneeL: 1.25, hipR: -0.55, kneeR: 1.40, aLr: 2.45, aLs: -0.14, aLe: -0.18, aRr: 2.45, aRs: 0.08, aRe: -0.18, torso: -0.14, plant: 0, gait: 0, duck: 0 },
  // grab_* poses pair with Dog.jsx's GRABS table (same style keys); a fresh
  // grab press in PlayerController rolls one at random.
  // nose grab (ref: Nosegrab.webp): knees fully compressed over the pulled-up
  // dog, right arm straight down-and-forward to the nose, left arm thrown out
  // level for balance. duck sinks the pelvis so hand and dog actually meet.
  grab_nose: { hipL: -1.35, kneeL: 1.7, hipR: -1.1, kneeR: 1.7, aLr: 1.6, aLs: 0.1, aLe: -0.15, aRr: -0.15, aRs: -1.05, aRe: -0.05, torso: 0.5, plant: 0, gait: 0, duck: 0.16 },
  // tail grab: reach BACK with the LEFT hand to the raised tail while the dog's
  // nose drops away — the mirror of the nose grab in hand, direction and shape.
  // Front (left) leg bones out nearly straight after the dropping nose; rear
  // (right) knee folds hard under the lifted rump; free right arm is thrown
  // forward-and-up. Body extended, not compressed: duck is half the nose grab's.
  grab_tail: { hipL: -0.58, kneeL: 0.20, hipR: -1.35, kneeR: 1.40, aLr: 0.22, aLs: 0.72, aLe: -0.22, aRr: 2.60, aRs: -0.45, aRe: -0.30, torso: 0.24, plant: 0, gait: 0, duck: 0.13 },
  // indy: right hand punched straight DOWN and OUT to the dog's flank between
  // the feet (positive aRr abducts outward — the lateral reach the tweak
  // needs), front leg folded forward, trailing leg cranked back and up, left
  // arm thrown high and wide. Nothing is centred — the whole silhouette leans
  // out over the grab side while the dog pokes sideways under it.
  grab_indy: { hipL: -1.45, kneeL: 1.95, hipR: 0.30, kneeR: 2.00, aLr: 2.25, aLs: 0.30, aLe: -0.45, aRr: 0.42, aRs: -0.15, aRe: -0.12, torso: 0.08, plant: 0, gait: 0, duck: 0.18 },
  // method air: the opposite silhouette to the nose grab — spine arched BACK
  // (torso negative), chest open to the sky, both legs kicked back and folded
  // so the dog rides up behind the hips, front leg boned out long and the rear
  // knee snapped to the butt. Leading (left) hand reaches down-and-behind to the
  // near edge; free arm thrown high and forward. duck matches the nose grab's
  // 0.16 — not to compress the pose, but because the arm is only 0.20 long.
  grab_method: { hipL: 1.05, kneeL: 1.05, hipR: 0.68, kneeR: 1.62, aLr: 0.18, aLs: 1.15, aLe: -0.45, aRr: 2.55, aRs: -0.22, aRe: -0.20, torso: -0.38, plant: 0, gait: 0, duck: 0.16 },
  // kickflip: crouch hard over the dog and reach the right hand down at it —
  // the flick that "flips the board". Left arm high for counterbalance. duck
  // drops the pelvis below PELVIS_FREE so the reach reads as a real crouch.
  flip:  { hipL: -1.35, kneeL: 1.6, hipR: -1.05, kneeR: 1.65, aLr: 2.35, aLs: 0.25, aLe: -0.35, aRr: -0.12, aRs: -0.95, aRe: -0.15, torso: 0.78, plant: 0, gait: 0, duck: 0.13 },
  grind: { hipL: -0.98, kneeL: 1.15, hipR: 0.82, kneeR: 0.92, aLr: 1.78, aLs: 0.0, aLe: -0.04, aRr: 1.78, aRs: 0.0, aRe: -0.04, torso: 0.3, plant: 1, gait: 0.2, duck: 0 },
  land:  { hipL: -1.05, kneeL: 1.25, hipR: 0.88, kneeR: 1.00, aLr: 0.75, aLs: -0.95, aLe: -0.55, aRr: 0.75, aRs: -0.95, aRe: -0.55, torso: 0.45, plant: 1, gait: 0, duck: 0 },
  bail:  { hipL: 0.25, kneeL: 0.55, hipR: -0.35, kneeR: 0.80, aLr: 2.40, aLs: 0.25, aLe: -0.85, aRr: 2.35, aRs: -0.20, aRe: -0.95, torso: -0.55, plant: 0.25, gait: 0, duck: 0 },
}
const KEYS = Object.keys(POSES.ride)

const _d = new THREE.Quaternion() // the only delta the frame loop allocates: none

// The boy ships orange-on-orange with the dog he rides and the warm plaza he
// rides it on, so the whole player unit read as one blob. Every garment is its
// own texture, named by the GLB, so the fix is per-map hue rotation. His shorts
// are already blue and left alone. Measured off the maps: the orange sits at
// hue 25, the trim and laces are below the chroma floor and never move.
const SHIFTS = [
  // +168 lands the shirt and both sleeves in teal, the plaza's complement, and
  // flips the shirt's blue trim to a warm cream.
  [/shirt|sleeve/, 168],
  // -28 is 25 -> 357: a saturated red at the same lightness, not a red-orange.
  [/shoe/, -28],
]
const shiftFor = (name) => SHIFTS.find(([re]) => re.test(name))?.[1] || 0

function recolorMap(mat, deg) {
  const img = mat.map?.image
  if (!img || mat.userData.recolored) return
  mat.userData.recolored = true
  const cv = document.createElement('canvas')
  cv.width = img.width
  cv.height = img.height
  const ctx = cv.getContext('2d', { willReadFrequently: false })
  ctx.drawImage(img, 0, 0)
  const buf = ctx.getImageData(0, 0, cv.width, cv.height)
  hueShift(buf.data, deg)
  ctx.putImageData(buf, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  // CanvasTexture defaults flipY true; a glTF texture is false, and the pixels
  // came straight off the source, so every sampler setting is inherited.
  tex.flipY = mat.map.flipY
  tex.colorSpace = mat.map.colorSpace
  tex.wrapS = mat.map.wrapS
  tex.wrapT = mat.map.wrapT
  tex.anisotropy = mat.map.anisotropy
  mat.map = tex
}

export default function Rider() {
  const root = useRef()
  const body = useRef()
  const { scene } = useGLTF(URL, DRACO_PATH)

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
      const deg = shiftFor(o.material.map?.name || '')
      if (deg) recolorMap(o.material, deg)
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
    root.current.position.y = backY() - SINK + P.riderLift * 0.3
    root.current.rotation.z = -P.lean * 0.24
    root.current.rotation.x = rootPitch

    // ---- pelvis height: two-link leg drop while the feet carry weight
    const plant = cur.plant * (1 - 0.6 * P.riderLift)
    const dropL = rig.thigh * Math.cos(cur.hipL) + rig.shin * Math.cos(cur.hipL + cur.kneeL)
    const dropR = rig.thigh * Math.cos(cur.hipR) + rig.shin * Math.cos(cur.hipR + cur.kneeR)
    const gait = cur.gait * P.runBlend * (P.grounded ? 1 : 0.25)
    const bob = Math.sin(P.run * 2) * 0.013 * gait
    body.current.position.y =
      plant * (rig.ankle + 0.5 * (dropL + dropR)) + (1 - plant) * (PELVIS_FREE - cur.duck) + bob
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
    <group ref={root} position={[0, backY(), 0]}>
      {/* body is the pelvis: the model hangs off it with its hip on the origin */}
      <group ref={body}>
        <primitive object={scene} position={rig.hip.clone().negate()} />
      </group>
    </group>
  )
}
