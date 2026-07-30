// node src/game/player/boneRig.check.js
//
// Rebuilds boy.glb's actual skeleton (rest transforms straight out of the glTF
// node tree, no loader needed) and drives it with the same calls Rider.jsx
// makes, then checks the result in world space.
//
// This is the check the integration lives or dies on: every pose angle was
// authored against a rig whose bones rested at identity, and every bone in the
// GLB rests somewhere else. An angle applied about the wrong axis still
// produces a smooth, finite, plausible-looking number — it just bends the knee
// sideways. Only world-space geometry catches that.
//
// It has already earned its keep once: it caught that the bind pose is a
// relaxed A-pose (right knee pre-flexed 0.31 rad, right shin splayed 0.18 rad
// out of plane, legs 17% different in length), which made the same knee angle
// mean two different things on the two legs. That is what alignBone exists for.

import fs from 'node:fs'
import { strict as assert } from 'node:assert'
import * as THREE from 'three'
import { buildRig, setBone, eulerDelta, armDelta, elbowDelta } from './boneRig.js'

const RIDE = { hipL: -0.36, kneeL: 0.30, hipR: 0.26, kneeR: 0.20, aLr: 1.42, aLs: -0.26, aLe: -0.30, aRr: 1.42, aRs: -0.26, aRe: -0.30, torso: 0.10 }
const TUCK = { hipL: -0.78, kneeL: 0.80, hipR: 0.62, kneeR: 0.58, aLr: 0.42, aLs: -0.55, aLe: -1.15, aRr: 0.42, aRs: -0.55, aRe: -1.15, torso: 0.34 }
const AIR = { hipL: -1.15, kneeL: 1.25, hipR: -0.55, kneeR: 1.40, aLr: 2.45, aLs: -0.14, aLe: -0.18, aRr: 2.45, aRs: 0.08, aRe: -0.18, torso: -0.14 }
const ZERO = { hipL: 0, kneeL: 0, hipR: 0, kneeR: 0, aLr: Math.PI / 2, aLs: 0, aLe: 0, aRr: Math.PI / 2, aRs: 0, aRe: 0, torso: 0 }

const ok = (cond, msg) => assert(cond, msg)
const near = (a, b, tol, msg) =>
  assert(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(4)} vs ${b.toFixed(4)} (tol ${tol})`)

// ---- rebuild the scene graph -------------------------------------------------
const glb = fs.readFileSync(new URL('../../../public/boy.glb', import.meta.url))
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'))

const root = new THREE.Group()
function build(index, parent) {
  const n = gltf.nodes[index]
  const o = new THREE.Object3D()
  o.name = n.name
  if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale)
  else {
    if (n.translation) o.position.fromArray(n.translation)
    if (n.rotation) o.quaternion.fromArray(n.rotation)
    if (n.scale) o.scale.fromArray(n.scale)
  }
  parent.add(o)
  for (const c of n.children || []) build(c, o)
}
for (const i of gltf.scenes[0].nodes) build(i, root)

const rig = buildRig(root)
const B = rig.bones

const _d = new THREE.Quaternion()
const at = (name) => root.getObjectByName(name).getWorldPosition(new THREE.Vector3())
const dir = (a, b) => at(b).sub(at(a)).normalize()
// pitch of a limb in the sagittal plane, signed the way the pose table signs it
// (positive swings the limb backward), and how far it leaves that plane
const pitch = (v) => Math.atan2(-v.z, -v.y)
const splay = (v) => Math.atan2(v.x, -v.y)

/** The same call sequence Rider.jsx runs each frame, minus the sim inputs. */
function pose(p, plant = 1) {
  setBone(B.L_Thigh, eulerDelta(_d, p.hipL))
  setBone(B.R_Thigh, eulerDelta(_d, p.hipR))
  setBone(B.L_Calf, eulerDelta(_d, p.kneeL))
  setBone(B.R_Calf, eulerDelta(_d, p.kneeR))
  setBone(B.L_Foot, eulerDelta(_d, -(p.hipL + p.kneeL) * plant + (1 - plant) * 0.3))
  setBone(B.R_Foot, eulerDelta(_d, -(p.hipR + p.kneeR) * plant + (1 - plant) * 0.3))
  eulerDelta(_d, p.torso * 0.5)
  setBone(B.Spine01, _d)
  setBone(B.Spine02, _d)
  setBone(B.L_Upperarm, armDelta(_d, p.aLr, p.aLs, 1))
  setBone(B.R_Upperarm, armDelta(_d, p.aRr, p.aRs, -1))
  setBone(B.L_Forearm, elbowDelta(_d, p.aLe, 1))
  setBone(B.R_Forearm, elbowDelta(_d, p.aRe, -1))
  root.updateMatrixWorld(true)
}

// ---- what the rig read off the bind pose -------------------------------------
root.updateMatrixWorld(true)
ok(dir('L_Foot', 'L_ToeBase').z > 0.9, 'model faces +Z')
ok(at('L_Upperarm').x > 0.05 && at('R_Upperarm').x < -0.05, 'L_* bones are the +X side')
ok(rig.thigh > 0.1 && rig.thigh < 0.25, `thigh length is sane (${rig.thigh.toFixed(3)})`)
ok(rig.shin > 0.08 && rig.shin < 0.2, `shin length is sane (${rig.shin.toFixed(3)})`)
near(rig.hip.y, 0.353, 0.02, 'hip pivot height')
// a 1.0-tall model standing on its own legs: pelvis must land near the bind hip
near(rig.ankle + rig.thigh + rig.shin, rig.hip.y, 0.03, 'straight legs reach the bind hip height')

// ---- alignment: a zero pose is a straight, symmetric stance -------------------
pose(ZERO)
for (const s of ['L', 'R']) {
  const thigh = dir(`${s}_Thigh`, `${s}_Calf`)
  const shin = dir(`${s}_Calf`, `${s}_Foot`)
  near(pitch(thigh), 0, 0.01, `${s} thigh hangs straight down at zero`)
  near(pitch(shin), 0, 0.01, `${s} shin hangs straight down at zero`)
  near(splay(thigh), 0, 0.01, `${s} thigh does not splay at zero`)
  near(splay(shin), 0, 0.01, `${s} shin does not splay at zero`)
  near(dir(`${s}_Upperarm`, `${s}_Hand`).x, s === 'L' ? 1 : -1, 0.01, `${s} arm is level at raise PI/2`)
}
near(at('L_Foot').y, at('R_Foot').y, 0.02, 'both ankles land at the same height')
// the sole the foot alignment targets is the same one on both feet
const LEVEL = pitch(dir('L_Foot', 'L_ToeBase'))
near(pitch(dir('R_Foot', 'R_ToeBase')), LEVEL, 0.01, 'both soles level together')

// ---- legs --------------------------------------------------------------------
pose(RIDE)
for (const [s, hip, knee] of [['L', RIDE.hipL, RIDE.kneeL], ['R', RIDE.hipR, RIDE.kneeR]]) {
  const thigh = dir(`${s}_Thigh`, `${s}_Calf`)
  const shin = dir(`${s}_Calf`, `${s}_Foot`)
  near(pitch(thigh), hip, 0.02, `${s} hip angle lands where it was authored`)
  near(pitch(shin), hip + knee, 0.03, `${s} knee angle lands where it was authored`)
  near(splay(thigh), 0, 0.03, `${s} leg stays in the sagittal plane`)
  // hip, knee and ankle deltas are all about world X, so a planted foot's sole
  // must come back to the neutral one. It only does if each landed on its axis.
  near(pitch(dir(`${s}_Foot`, `${s}_ToeBase`)), LEVEL, 0.03, `${s} planted sole stays level`)
}
// the drop the pelvis-height math in Rider.jsx assumes, measured on the rig
for (const [s, hip, knee] of [['L', RIDE.hipL, RIDE.kneeL], ['R', RIDE.hipR, RIDE.kneeR]]) {
  const drop = rig.thigh * Math.cos(hip) + rig.shin * Math.cos(hip + knee)
  near(at(`${s}_Thigh`).y - at(`${s}_Foot`).y, drop, 0.02, `${s} leg drop matches the two-link formula`)
}

// ---- arms --------------------------------------------------------------------
pose(RIDE)
const shoulderY = at('L_Upperarm').y
for (const s of ['L', 'R']) {
  ok(at(`${s}_Hand`).y < shoulderY, `ride: ${s} hand sits under the shoulder`)
  ok(shoulderY - at(`${s}_Hand`).y < 0.12, `ride: ${s} arm is out for balance, not hanging`)
  ok(Math.abs(at(`${s}_Hand`).x) > 0.2, `ride: ${s} hand stays out to the side`)
}
ok(at('L_Hand').x > 0 && at('R_Hand').x < 0, 'ride: arms do not cross the body')

pose(AIR)
for (const s of ['L', 'R']) ok(at(`${s}_Hand`).y > shoulderY + 0.05, `air: ${s} hand comes up over the shoulder`)

pose(TUCK)
for (const s of ['L', 'R']) {
  ok(at(`${s}_Hand`).z > at(`${s}_Forearm`).z + 0.02,
    `tuck: ${s} elbow folds the hand forward (+Z), not back or sideways`)
  ok(at(`${s}_Hand`).y < at(`${s}_Forearm`).y + 0.02,
    `tuck: ${s} forearm does not swing up over the elbow`)
}

console.log(
  `boneRig ok — thigh ${rig.thigh.toFixed(3)}, shin ${rig.shin.toFixed(3)}, ` +
    `ankle ${rig.ankle.toFixed(3)}, hip ${rig.hip.y.toFixed(3)}, ` +
    `sole levelled at ${LEVEL.toFixed(3)} rad`,
)
