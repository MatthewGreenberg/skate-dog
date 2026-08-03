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

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useControls } from 'leva'
import { KTX2Loader } from 'three-stdlib'
import * as THREE from 'three'
import { P } from '../store.js'
import { captureRest, setBone, eulerDelta } from '../player/boneRig.js'
import { SIZE, LEG, LEG_DROP, TARGET_LENGTH } from './dogFit.js'
import { dogNormal, dogRough } from '../level/textures.js'

const URL = '/dog_compressed.glb'
// Draco + KTX2 decoders are copied out of three/examples/jsm/libs into public/.
// drei's default draco path is a gstatic CDN; nothing else in this project
// fetches over the network and the shoot harness must not either.
const DRACO_PATH = '/draco/'
const BASIS_PATH = '/basis/'

const HEAD = 1.16 // oversized skull; the snout and ears hang off it and inherit
const EAR = 1.14 // ...and the ears take a little more on top
const COAT = 0xd9a06a // albedo multiplier — see the traverse below

// The GLB carries ONE map (baseColor), and it is KTX2 — transcoded straight to
// a GPU format, so its pixels never touch the CPU and the hue-rotate recolor.js
// plays on the rider's canvas is not available here. Surface detail comes from
// the procedural fur maps in textures.js (dogNormal / dogRough); the colour
// grade is done in the shader, live off one uniform so leva can drive it:
//
//   hue/sat/con  Tripo's bake is a flat tan wash. Pushed about a LINEAR-space
//                pivot (0.2 ~ mid grey; sRGB's 0.5 would crush the coat to
//                black), the ear and back markings and the baked crease
//                shading come back, and the dog stops reading as one solid
//                brown blob at chase distance.
//   rim          the silhouette edge, tinted with the violet sky ambient. This
//                is sky WRAP, not a second key — the palette contract holds,
//                key + ambient = white. It is what separates him from the warm
//                plaza when he is between the camera and the sun. Well under
//                the bloom threshold.
//
// The uniform objects are module scope so the compiled shader and the leva
// panel below hold the same reference — three re-reads uniform.value every
// frame, so a slider is live with no recompile and no needsUpdate.
const COAT_ADJ = { value: new THREE.Vector3(25 * THREE.MathUtils.DEG2RAD, 2.5, 1.19) } // hue rad, sat, contrast
const RIM = { value: new THREE.Color(0x8f96de).multiplyScalar(0.34) }
const FUR = 1.12 // normalScale — the fibre is fine, and a hard one reads as scales
const coatShader = (s) => {
  s.uniforms.coatAdj = COAT_ADJ
  s.uniforms.rimColor = RIM
  s.fragmentShader = s.fragmentShader
    .replace(
      'void main() {',
      `uniform vec3 coatAdj;
      uniform vec3 rimColor;
      // Rodrigues about the grey axis: rotates hue while leaving the luma axis
      // untouched, so the bake's shading survives the grade (same guarantee
      // recolor.js gives the rider, done per-pixel on the GPU instead).
      vec3 hueRot(vec3 c, float a) {
        const vec3 k = vec3(0.57735);
        float cs = cos(a);
        return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
      }
      void main() {`
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec3 cc = hueRot(diffuseColor.rgb, coatAdj.x);
        float l = dot(cc, vec3(0.2126, 0.7152, 0.0722));
        cc = mix(vec3(l), cc, coatAdj.y);
        diffuseColor.rgb = max(vec3(0.0), (cc - 0.2) * coatAdj.z + 0.2);
      }`
    )
    .replace(
      '#include <opaque_fragment>',
      `outgoingLight += rimColor * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
      #include <opaque_fragment>`
    )
}

// Tripo's names. 0_ limbs are the front pair, 1_ the rear; Head_0 is really the
// chest (the front legs hang off it), Head_2 the skull. Head_3 / bone_7 are the
// two ears, bone_5 the snout.
const B = {
  // the only two segments between the hips and the neck — the carve bend
  spine: 'tripoSpine_0',
  chest: 'tripoHead_0',
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
const _acc = new THREE.Vector3()
const _prevVel = new THREE.Vector3()

const damp = (cur, to, lambda, dt) => cur + (to - cur) * (1 - Math.exp(-lambda * dt))
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// Per-grab dog reaction, keyed by P.grabStyle (paired with Rider's grab_*
// poses). Each channel multiplies P.grab (0..1): pitch on rotation.x (negative
// = nose up), roll on rotation.z (the sideways tweak), x/y position offsets
// toward the grabbing hand. nose = the original Nosegrab.webp numbers.
const GRABS = {
  nose: { pitch: -0.4, roll: 0.25, x: -0.08, y: 0.08 },
  // nose drops, tail base swings up-and-forward to meet the left hand reaching
  // back — hand lands 0.107 from the tail base, measured on the fitted rig.
  tail: { pitch: 0.5, roll: -0.22, x: 0.06, y: 0.1 },
  // the signature sideways poke: max roll, token pitch (an indy must not read
  // as a pitch trick), lifted into the straight-down right hand — gap 0.064.
  indy: { pitch: -0.12, roll: 0.35, x: -0.05, y: 0.1 },
  // pulled up-and-behind the arched-back rider into the left hand reaching
  // down-behind — y at cap puts the deck under the folded-up feet, gap 0.075.
  method: { pitch: -0.12, roll: 0.3, x: 0.11, y: 0.12 },
}

// In model space forward is +X and up is +Y, so a limb swings fore/aft about Z,
// an ear flaps about X and the tail wags about Y.
const swingZ = (bone, a) => setBone(bone, eulerDelta(_d, 0, 0, a))

export default function Dog() {
  const root = useRef()
  const gl = useThree((s) => s.gl)

  const { scene } = useGLTF(URL, DRACO_PATH, true, (loader) => {
    loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(gl))
  })

  // the material comes back out of the memo rather than through a ref: leva's
  // onChange closures below need it, and a ref written inside the traverse is a
  // ref read during render.
  const [bones, mat] = useMemo(() => {
    let material = null
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      // skinned bounds are the bind pose; posing pushes verts outside it
      o.frustumCulled = false
      // Tripo bakes its own light into the albedo, so the map stays as authored
      // — but its 0.5 roughness reads as vinyl next to the park's matte paint.
      o.material.roughness = 0.85
      o.material.metalness = 0
      // Tripo's coat is a pale tan barely a stop off the warm plaza it rides
      // over, so the dog's silhouette went missing against the pavement. The
      // map is multiplied down into a richer brown rather than replaced —
      // colour multiplies in linear space, so an sRGB tint reads as an sRGB
      // value scale: 0.92,0.71,0.46 -> ~0.78,0.45,0.19.
      o.material.color.setHex(COAT)
      // one material shared by every mesh in the file — patch it once
      material = o.material
      if (!o.material.userData.coat) {
        o.material.userData.coat = true
        o.material.normalMap = dogNormal()
        o.material.normalScale.setScalar(FUR)
        o.material.roughnessMap = dogRough()
        o.material.onBeforeCompile = coatShader
        o.material.needsUpdate = true
      }
    })
    const b = captureRest(scene, BONES)
    // Cartoon proportions, set once: setBone only ever writes quaternions, so a
    // bone scale survives the frame loop. Scaling the skull carries the snout
    // and both ears with it.
    b[B.skull].scale.setScalar(HEAD)
    b[B.earL].scale.setScalar(EAR)
    b[B.earR].scale.setScalar(EAR)
    for (const [hip] of LEGS) b[hip].scale.setScalar(LEG)
    return [b, material]
  }, [scene])

  // Its own folder, not Player's: the clash CLAUDE.md warns about is two
  // useControls on the SAME path. Everything here writes straight into the
  // live uniform / material, so nothing is returned and nothing re-renders —
  // and the initial onChange fires with the defaults already in place above.
  useControls('Dog coat', {
    hue: { value: 25, min: -180, max: 180, step: 1, onChange: (v) => (COAT_ADJ.value.x = v * THREE.MathUtils.DEG2RAD) },
    sat: { value: COAT_ADJ.value.y, min: 0, max: 2.5, onChange: (v) => (COAT_ADJ.value.y = v) },
    contrast: { value: COAT_ADJ.value.z, min: 0.5, max: 2, onChange: (v) => (COAT_ADJ.value.z = v) },
    // no roughness slider: assigning `mat.roughness` is a write to a memo
    // return value and react-hooks/immutability rejects it (same rule that
    // shaped ToonFX). normalScale is mutated in place, which is fine.
    fur: { value: FUR, min: 0, max: 3, onChange: (v) => mat?.normalScale.setScalar(v) },
  })

  // Bind-pose bounds -> the fit scale, and the floor the drop is measured from.
  // Height is squashed and length stretched about that fit; the shortened legs
  // lift the paws off the bind-pose floor, so the model drops by LEG_DROP too.
  // The drop itself scales with SIZE.tall, so it is applied in the frame loop.
  const { scale, minY } = useMemo(() => {
    _box.setFromObject(scene)
    _box.getSize(_size)
    return { scale: TARGET_LENGTH / _size.x, minY: _box.min.y }
  }, [scene])

  const a = useRef({ tuck: 0, splay: 0, tilt: 0, wag: 0, lag: 0, fore: 0, ez: [0, 0], ezv: [0, 0] })
  const tongue = useRef()
  const mouth = useRef()
  const fit = useRef()

  // The tongue used to sit at a fixed point in model space, on the grounds that
  // the skull only moved by a few hundredths. The carve bend broke that: the
  // head now swings ~30 degrees into a turn and the tongue stayed behind in mid
  // air. So it hangs off the skull bone instead. `attach` rather than `add`,
  // because it preserves the world transform — which means the authored mouth
  // offset and the mesh's lay-forward rotation carry over untouched, and the
  // bone's non-identity rest orientation and its HEAD scale are compensated for
  // rather than having to be typed in (see boneRig.js for why a bone's rest
  // frame is never identity). Everything above `fit` cancels out of that
  // relative transform, so the live SIZE scale does not need to be applied
  // first — but the local matrices do have to be current.
  useLayoutEffect(() => {
    const m = mouth.current
    const home = fit.current
    root.current.updateMatrixWorld(true)
    bones[B.skull].attach(m)
    return () => home.attach(m) // hand it back so React can unmount it cleanly
  }, [bones])

  useFrame((_, delta) => {
    if (!root.current) return

    // Live fit: the sliders in Player.jsx move SIZE, and the paws have to stay
    // on y=0 through it, so the drop is re-derived rather than baked.
    fit.current.scale.set(scale * SIZE.long, scale * SIZE.tall, scale)
    fit.current.position.y = -(minY + LEG_DROP) * scale * SIZE.tall
    const dt = Math.min(delta, 1 / 30)
    const s = a.current
    const spd = Math.min(P.speed / 12, 1)
    const air = P.state === 'air'

    s.tuck = damp(s.tuck, air ? 1 : 0, 11, dt)
    s.splay = damp(s.splay, P.state === 'grind' ? 1 : 0, 9, dt)

    // Turn lag: ears, tail and tongue are hung off the body, so they arrive at
    // a carve late. The signal is how far the lean has run ahead of a damped
    // copy of itself — zero while holding a steady arc, biggest on a reversal.
    s.lag = damp(s.lag, P.lean, 8, dt)
    const lag = Math.max(-0.55, Math.min(0.55, (P.lean - s.lag) * 2.4))

    // Rig acceleration, the input the lean proxy above cannot see: pops,
    // landings, ramp creases, wall hits. Differenced over the RENDER frame, so
    // a landing (9 m/s killed inside one 1/120 substep) reads in the hundreds
    // — the clamp is what makes it an impulse instead of a spike, and it also
    // swallows a respawn's teleport. up = ears slapped down, forward = ears and
    // tongue thrown ahead.
    _acc.subVectors(P.vel, _prevVel).divideScalar(Math.max(dt, 1e-4))
    _prevVel.copy(P.vel)
    const upA = clamp(_acc.y, -60, 60)
    const fwdA = clamp(_acc.x * Math.sin(P.heading) + _acc.z * Math.cos(P.heading), -60, 60)
    // fore/aft is shared by both ears and needs no spring of its own — the
    // clamped impulse damped back to zero already reads as a whip.
    s.fore = damp(s.fore, clamp(-fwdA * 0.014, -0.5, 0.5), 14, dt)

    // how much of the trot survives after tucking / grinding
    const cycle = P.runBlend * (1 - s.tuck) * (1 - s.splay)
    const bob = Math.sin(P.run * 2) * 0.016 * cycle

    const r = root.current
    // grab: the dog is pulled toward the reaching hand — connection over
    // separation, one unit in the air. Which way depends on the rolled style.
    const gb = GRABS[P.grabStyle] || GRABS.nose
    r.rotation.x = P.dogPitch + P.grab * gb.pitch
    r.rotation.y = Math.sin(P.run) * 0.05 * cycle
    r.rotation.z = P.dogRoll + P.lean * 0.22 + Math.sin(P.run) * 0.035 * cycle + P.grab * gb.roll
    r.position.x = P.grab * gb.x
    r.position.y = bob - P.crouch * 0.06 + P.grab * gb.y
    // squash and stretch, volume-ish: the gait pumps it too, so the body is
    // never rigid while it is moving.
    const pump = Math.sin(P.run * 2) * 0.055 * cycle
    r.scale.set(
      1 + P.crouch * 0.16 + pump * 0.5,
      1 - P.crouch * 0.3 - P.stretch * 0.1 - pump,
      1 + P.stretch * 0.18 + pump * 0.6,
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

    // ears: damped springs kicked by the gait and by the rig's own
    // acceleration. They hang down the sides of the skull at rest and only
    // swing out a little, so they read as ears not fins.
    const kick = Math.cos(P.run * 2) * cycle * 8
    const flare = 0.08 + spd * 0.2 + Math.min(Math.abs(P.dogRoll), 3) * 0.1 + P.riderLift * 0.08
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1
      s.ezv[i] +=
        ((side * flare - P.lean * 0.18 - s.ez[i]) * 120 - s.ezv[i] * 13
          + side * (kick * 0.4 - upA * 0.05)) * dt
      s.ez[i] += s.ezv[i] * dt
      setBone(bones[i ? B.earR : B.earL], eulerDelta(_d, s.ez[i], lag * 0.7, s.fore))
    }

    // tail: lifts with speed, drops in the air, wags across the whole chain so
    // the tip travels further than the root.
    s.wag += (5 + spd * 9) * dt
    s.tilt = damp(s.tilt, air ? -0.1 : 0.35 + spd * 0.25, 6, dt)
    const wag = Math.sin(s.wag) * (0.18 + 0.34 * P.runBlend + 0.2 * s.tuck)
    setBone(bones[B.tail0], eulerDelta(_d, 0, wag + lag * 0.5, s.tilt))
    setBone(bones[B.tail1], eulerDelta(_d, 0, wag * 1.6 + lag * 0.7, s.tilt * 0.6))
    setBone(bones[B.tail2], eulerDelta(_d, 0, wag * 2.2 + lag * 0.9, s.tilt * 0.3))

    // tongue: rides the skull (see the attach above), so this is only the trail
    // — the head's own turn comes in through the parent bone.
    tongue.current.rotation.set(
      0,
      lag * 1.1,
      Math.sin(s.wag * 1.7) * 0.12 * spd + s.fore * 0.8,
    )

    // A dachshund carves with its whole body. The rear legs and the tail hang
    // off tripoRoot and the front half off tripoSpine_0, so yawing the spine
    // swings shoulders, front legs and head into the turn while the hips stay
    // with the heading — the banana, for free, from the two segments the rig
    // actually has. Split across both (chest takes the larger share) so the
    // bend reads as a curve through the shoulders and not one hinge at the
    // hips, and `lag` whips it on a reversal, the same signal the ears and
    // tail trail on. Up is +Y in model space, so a turn is a yaw; the sign
    // matches the skull's below, which already leads the carve.
    // SIZE.long stretches x OUTSIDE these bones, which flattens the apparent
    // angle of a yaw (nose lands at (long*cos, sin)) — so a longer dog needs a
    // bigger number for the same read: 0.34 raw is ~35deg on screen at 1.16.
    const bend = -(P.lean * 0.34 + lag * 0.2)
    setBone(bones[B.spine], eulerDelta(_d, 0, bend * 0.8, 0))
    setBone(bones[B.chest], eulerDelta(_d, 0, bend * 1.2, 0))

    // head rides steadier than the body: the neck takes the pitch, the skull
    // takes the turn, so a carve reads as the dog looking where it is going.
    // Its yaw is on top of the spine bend it now inherits, hence the smaller
    // share than the 0.28 it carried when it was the only thing turning.
    const pitch = -(0.04 + spd * 0.1 - s.tuck * 0.25)
    setBone(bones[B.neck], eulerDelta(_d, 0, 0, pitch * 0.5))
    setBone(bones[B.skull], eulerDelta(_d, -P.lean * 0.16, -P.lean * 0.14, pitch * 0.5))
  })

  return (
    <group ref={root}>
      <group ref={fit} rotation={[0, -Math.PI / 2, 0]}>
        <primitive object={scene} />
        {/* Mouth corner, model space: the snout bone rests at (0.376, 0.376).
            Authored here at the bind pose, then attached to the skull bone —
            two groups because the outer one is the mount the attach rewrites
            and the inner one is free for the frame loop to spin. */}
        <group ref={mouth} position={[0.4, 0.35, 0]}>
          <group ref={tongue}>
            {/* capsule rests along +Y; -2.2 rad lays it forward-and-down */}
            <mesh position={[0.035, -0.05, 0]} rotation={[0, 0, -2.2]} castShadow>
              <capsuleGeometry args={[0.032, 0.075, 3, 8]} />
              <meshStandardMaterial color="#e2748a" roughness={0.55} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}
