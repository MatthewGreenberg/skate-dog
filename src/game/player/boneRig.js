// Posing an imported skeleton with angles that were authored against a
// procedural rig.
//
// Two problems, one fix each.
//
// 1. The procedural rider was a tree of groups whose rest orientation was
//    identity, so a pose was just `group.rotation.x = angle`. An imported
//    skeleton's bones carry arbitrary rest orientations (boy.glb's L_Thigh
//    rests at a quaternion near 180 degrees about Y), so writing the same Euler
//    onto the bone rotates about the wrong axis. So each pose angle becomes a
//    WORLD-space delta D from the bone's rest orientation, conjugated into the
//    bone's own rest frame:
//
//        local = restLocal * (restWorld^-1 * D * align * restWorld)
//
//    With the parents at rest this makes the bone's world orientation exactly
//    D * align * restWorld. With a parent posed by Dp it becomes Dp * D * align
//    * restWorld — the delta follows the parent, which is what a joint angle
//    means.
//
// 2. The bind pose is not the pose the angles were measured from. boy.glb rests
//    in a relaxed A-pose: the right knee is already flexed 0.31 rad and the
//    right shin splays 0.18 rad out of the sagittal plane, so "knee = 0.30"
//    lands somewhere different on each leg. `align` (see alignBone) is a fixed
//    per-bone correction that makes a zero pose angle mean straight-down, so
//    the numbers mean the same thing on both sides.

import * as THREE from 'three'

const HALF_PI = Math.PI / 2
const AX_X = new THREE.Vector3(1, 0, 0)
const AX_Y = new THREE.Vector3(0, 1, 0)
const AX_Z = new THREE.Vector3(0, 0, 1)
const IDENTITY = new THREE.Quaternion()

const _q = new THREE.Quaternion()
const _a = new THREE.Quaternion()
const _b = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _s = new THREE.Vector3()

/**
 * Finds `names` under `root` and records the rest pose each delta is measured
 * from, in root-local space. The transforms are accumulated from local matrices
 * rather than read off matrixWorld so the values do not depend on where in the
 * scene the model happens to be parented, or on whether a frame has run yet.
 *
 * Rest is captured once per bone: a remount after frames have run would
 * otherwise record a posed bone as the rest pose.
 */
export function captureRest(root, names) {
  const bones = {}
  for (const name of names) {
    const b = root.getObjectByName(name)
    if (!b) throw new Error(`boneRig: no bone named "${name}"`)
    if (!b.userData.restLocal) {
      _m.identity()
      for (let o = b; o && o !== root; o = o.parent) {
        o.updateMatrix()
        _m.premultiply(o.matrix)
      }
      const world = new THREE.Quaternion()
      const pos = new THREE.Vector3()
      _m.decompose(pos, world, _s)
      b.userData.restLocal = b.quaternion.clone()
      b.userData.restWorld = world
      b.userData.restWorldInv = world.clone().invert()
      b.userData.restPos = pos
      b.userData.align = IDENTITY
      b.userData.alignCum = IDENTITY
    }
    bones[name] = b
  }
  return bones
}

/**
 * Bakes a fixed correction into `bone` so that a zero pose angle points it at
 * `target` (a unit vector in root-local space) instead of wherever the artist
 * left it in the bind pose. Direction is measured bone -> `child`.
 *
 * `parent` is the nearest aligned bone above it in the chain, whose own
 * correction is already in effect on this bone and has to be divided back out.
 * Call parents before children.
 */
export function alignBone(bone, child, target, parent = null) {
  _v.copy(child.userData.restPos).sub(bone.userData.restPos).normalize()
  const cum = new THREE.Quaternion().setFromUnitVectors(_v, target)
  bone.userData.alignCum = cum
  bone.userData.align = parent
    ? parent.userData.alignCum.clone().invert().multiply(cum)
    : cum.clone()
}

/** Applies world-space delta `d` on top of the bone's rest orientation. */
export function setBone(bone, d) {
  _q.copy(bone.userData.restWorldInv)
    .multiply(d)
    .multiply(bone.userData.align)
    .multiply(bone.userData.restWorld)
  bone.quaternion.copy(bone.userData.restLocal).multiply(_q)
}

/** Delta for a joint whose rest already points where the pose measures from. */
export function eulerDelta(out, x, y = 0, z = 0) {
  return out.setFromEuler(_e.set(x, y, z, 'XYZ'))
}

/**
 * Shoulder. `raise` is outward abduction (0 = arm down, PI/2 = level) and
 * `swing` is fore/aft, exactly as the pose table authored them against an
 * arm-down rest. The trailing -PI/2 undoes the T-pose the arm is aligned to,
 * so raise = PI/2 is a no-op. `side` is +1 for the +X arm.
 */
export function armDelta(out, raise, swing, side) {
  out.setFromAxisAngle(AX_Z, raise * side)
  _a.setFromAxisAngle(AX_X, swing)
  _b.setFromAxisAngle(AX_Z, -HALF_PI * side)
  return out.multiply(_a).multiply(_b)
}

/**
 * Elbow. The aligned forearm runs along the arm's own axis, so the fold is a
 * rotation about Y (negative `fold` bends forward on either side).
 */
export function elbowDelta(out, fold, side) {
  return out.setFromAxisAngle(AX_Y, fold * side)
}

// ---- boy.glb ---------------------------------------------------------------

export const RIG_BONES = [
  'L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf', 'L_Foot', 'R_Foot', 'L_ToeBase', 'R_ToeBase',
  'L_Upperarm', 'R_Upperarm', 'L_Forearm', 'R_Forearm', 'L_Hand', 'R_Hand',
  'Spine01', 'Spine02', 'Head',
]

const DOWN = new THREE.Vector3(0, -1, 0)
const OUT_L = new THREE.Vector3(1, 0, 0)
const OUT_R = new THREE.Vector3(-1, 0, 0)
const _sole = new THREE.Vector3()

/**
 * Captures the rest pose, straightens the A-pose out of the limbs, and measures
 * the limb lengths the pelvis-height math needs. Everything the rider knows
 * about the model's proportions comes from here, so a re-export of the GLB
 * moves the numbers with it.
 */
export function buildRig(root) {
  const b = captureRest(root, RIG_BONES)
  const len = (x, y) => b[x].userData.restPos.distanceTo(b[y].userData.restPos)

  // The left leg rests nearly straight, so its ankle -> toe vector is what a
  // level sole looks like on this model. Mirrored to x = 0 so both feet get the
  // same one and the stance comes out symmetric.
  _sole.copy(b.L_ToeBase.userData.restPos).sub(b.L_Foot.userData.restPos)
  _sole.x = 0
  _sole.normalize()

  for (const [s, out] of [['L', OUT_L], ['R', OUT_R]]) {
    alignBone(b[`${s}_Thigh`], b[`${s}_Calf`], DOWN)
    alignBone(b[`${s}_Calf`], b[`${s}_Foot`], DOWN, b[`${s}_Thigh`])
    alignBone(b[`${s}_Foot`], b[`${s}_ToeBase`], _sole, b[`${s}_Calf`])
    alignBone(b[`${s}_Upperarm`], b[`${s}_Forearm`], out)
    alignBone(b[`${s}_Forearm`], b[`${s}_Hand`], out, b[`${s}_Upperarm`])
  }

  // Tripo's two legs differ by 17% in length; the mean splits the error so one
  // foot floats ~1.5cm above the dog and the other sinks the same amount,
  // rather than one leg being right and the other visibly wrong.
  return {
    bones: b,
    thigh: (len('L_Thigh', 'L_Calf') + len('R_Thigh', 'R_Calf')) / 2,
    shin: (len('L_Calf', 'L_Foot') + len('R_Calf', 'R_Foot')) / 2,
    // foot pivot above the sole, taken from the straight (left) leg
    ankle: Math.min(b.L_Foot.userData.restPos.y, b.R_Foot.userData.restPos.y),
    hip: b.L_Thigh.userData.restPos.clone().add(b.R_Thigh.userData.restPos).multiplyScalar(0.5),
  }
}
