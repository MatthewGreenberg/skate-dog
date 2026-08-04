import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { P } from '../store.js'
import { TOUCH } from '../input.js'
import { applyPhotoCamera } from '../photo.js'

// Elevated three-quarter chase rig. The camera keeps a fixed world orientation
// and only translates, so tricks, bowl carving and hard turns never swing it.
// Framing comes from where the follow point drifts, not from rotation.

const YAW = -0.42 // ~24 deg off the park grid, matching the reference framing
// input.js mirrors this as CAM_YAW for the world-directional touch stick —
// change one, change both (input.js can't import a .jsx under plain node)
const HEIGHT = 20.9
const BACK = 24.9 // -> ~40 deg downward pitch

const OFFSET = new THREE.Vector3(Math.sin(YAW) * BACK, HEIGHT, Math.cos(YAW) * BACK)

// Title framing: a slow orbit around the parked dog, low and close enough that
// the troika title and the dog share the frame. The lens is a 20.5 deg
// telephoto, so half a frame is only R*tan(10.25deg) tall — 2.5m here. The
// title no longer stacks straight above the dog (Intro.jsx offsets it into the
// upper-left of the frame instead), which is what buys the tighter radius:
// only the DOG has to fit under the aim point now, not dog + 2.1m of type.
const INTRO_R = 13
const INTRO_H = 8.6 // ~27 deg down onto the dog (was ~10 deg, near eye level)
// The aim is deliberately NOT on the dog: it sits above and to his right, which
// puts him middle-LEFT of frame, clear of the PLAY button and under the title.
// AIM 0.9 is roughly his own body height, so he lands just under the frame's
// horizontal midline instead of the half-frame below it that AIM 1.9 gave.
const INTRO_AIM = 0.9
// Metres the aim slides along the camera's own right, AT ASPECT 1, and it is
// multiplied by the live aspect below. Half-width IS half-height x aspect, so a
// fixed slice of the frame scales linearly with aspect — the offset has to as
// well, or the same number is a third of the way out on a monitor and off the
// edge on a portrait phone. 1.64 against the ~2.64m half-height is 0.62 of
// half-width, which is what clears the centred title (Intro.jsx MAX_W 0.42
// -> +-0.42 of half-width) rather than parking the dog behind the letters.
const INTRO_SIDE = 1.64
const INTRO_SPIN = 0.05 // rad/s of drift, just enough to not read as a still
const camPos = new THREE.Vector3()
const camAim = new THREE.Vector3()
const introV = new THREE.Vector3()

const LOOK_AHEAD = 0.3
const LOOK_AHEAD_MAX = 3.6
const SMOOTH_XZ = 0.24
const SMOOTH_Y = 0.55
const PULLBACK = 0.12 // extra distance at top speed
const BOWL_LIFT = 0.55 // how much of a descent below deck level the rig ignores
const BIG_AIR = 2.0 // rise above the follow point before the camera starts chasing

/** Unity-style critically damped spring. Frame-rate independent. */
function smoothDamp(cur, target, vel, i, smoothTime, dt) {
  const omega = 2 / smoothTime
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = cur - target
  const temp = (vel[i] + omega * change) * dt
  vel[i] = (vel[i] - omega * temp) * exp
  return target + (change + temp) * exp
}

export default function CameraController() {
  const follow = useRef(new THREE.Vector3(P.pos.x, P.pos.y, P.pos.z))
  const vel = useRef(new Float32Array(3))
  // smoothed copy of P.vel for aiming only — a wall hit deletes the into-wall
  // velocity in one substep (physically necessary), and aiming with the raw
  // value stepped the look-ahead point up to 3.6m and the speed-zoom in a
  // single frame. ~0.2s time constant; the sim never reads this.
  const aimVel = useRef(new Float32Array(2))
  const ready = useRef(false)
  // zoom > 1 pulls closer; fov is the Canvas default (26).
  const cam = useControls('camera', {
    // phones sit farther out: the thumb controls cover the bottom corners and
    // a tight frame leaves no room to read the park around the player
    zoom: { value: TOUCH ? 0.9 : 1.2, min: 0.4, max: 4, step: 0.05 },
    fov: { value: 20.5, min: 10, max: 70, step: 0.5 },
  })

  // FOV / near / far are set on the Canvas camera prop; this rig only moves it
  // (and overrides fov when the leva panel is open).
  useFrame((state, delta) => {
    const camera = state.camera
    if (applyPhotoCamera(camera)) return
    const dt = Math.min(delta, 0.05)
    const f = follow.current
    const v = vel.current

    // look slightly ahead of travel — this is the only "aim" the rig does
    const av = aimVel.current
    const ke = 1 - Math.exp(-5 * dt)
    av[0] += (P.vel.x - av[0]) * ke
    av[1] += (P.vel.z - av[1]) * ke
    const sp = Math.hypot(av[0], av[1])
    const k = sp > 0.001 ? Math.min(LOOK_AHEAD_MAX, sp * LOOK_AHEAD) / sp : 0
    const tx = P.pos.x + av[0] * k
    const tz = P.pos.z + av[1] * k
    // vertical follow ignores hops so the frame stays calm over jumps — but past
    // BIG_AIR of rise the cap grows 1:1, so a coping air (3.9m+) stays framed
    // while a flat ollie (1.28m) still doesn't move the frame. Continuous, so
    // no snap at the threshold; SMOOTH_Y eases the ride up and back down.
    const rise = P.pos.y - f.y
    const airCap = 1.2 + Math.max(0, rise - BIG_AIR)
    let ty = P.state === 'air' ? Math.min(P.pos.y, f.y + airCap) : P.pos.y
    // riding a bowl: keep most of the altitude so the transitions stay readable
    if (ty < 0) ty *= 1 - BOWL_LIFT

    if (!ready.current) {
      f.set(tx, ty, tz)
      ready.current = true
    } else {
      f.x = smoothDamp(f.x, tx, v, 0, SMOOTH_XZ, dt)
      f.y = smoothDamp(f.y, ty, v, 1, SMOOTH_Y, dt)
      f.z = smoothDamp(f.z, tz, v, 2, SMOOTH_XZ, dt)
    }

    const zoom = (1 + Math.min(1, sp / 13) * PULLBACK) / cam.zoom
    camPos.set(f.x + OFFSET.x * zoom, f.y + OFFSET.y * zoom, f.z + OFFSET.z * zoom)
    camAim.set(f.x, f.y + 0.7, f.z)

    // Reveal: lerp the two POSES, not the angles — the chase rig never rotates,
    // so both share an up vector and a straight-line dolly is all it needs.
    // Smoothstepped, so the swoop has no kick at either end.
    if (P.intro > 0) {
      const a = YAW + 0.6 + state.clock.elapsedTime * INTRO_SPIN
      const k = P.intro * P.intro * (3 - 2 * P.intro)
      camPos.lerp(
        introV.set(P.pos.x + Math.sin(a) * INTRO_R, P.pos.y + INTRO_H, P.pos.z + Math.cos(a) * INTRO_R),
        k,
      )
      // camera-right in the horizontal plane at orbit angle `a` (at a = 0 the
      // eye is on +Z looking back down -Z, so right is +X). Shifting the AIM
      // right is what pushes the DOG left — the eye stays at INTRO_R, so his
      // size and the title's scale are untouched.
      const side = INTRO_SIDE * state.viewport.aspect
      camAim.lerp(
        introV.set(
          P.pos.x + Math.cos(a) * side,
          P.pos.y + INTRO_AIM,
          P.pos.z - Math.sin(a) * side,
        ),
        k,
      )
    }

    camera.position.copy(camPos)
    camera.lookAt(camAim)
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov
      camera.updateProjectionMatrix()
    }
  })

  // ponytail: no occlusion raycast — at a 40 deg pitch from 19 units nothing in
  // this park can get between the camera and the player. Add one if that changes.
  return null
}
