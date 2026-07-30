import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { P } from '../store.js'
import { applyPhotoCamera } from '../photo.js'

// Elevated three-quarter chase rig. The camera keeps a fixed world orientation
// and only translates, so tricks, bowl carving and hard turns never swing it.
// Framing comes from where the follow point drifts, not from rotation.

const YAW = -0.42 // ~24 deg off the park grid, matching the reference framing
const HEIGHT = 20.9
const BACK = 24.9 // -> ~40 deg downward pitch

const OFFSET = new THREE.Vector3(Math.sin(YAW) * BACK, HEIGHT, Math.cos(YAW) * BACK)

const LOOK_AHEAD = 0.3
const LOOK_AHEAD_MAX = 3.6
const SMOOTH_XZ = 0.24
const SMOOTH_Y = 0.55
const PULLBACK = 0.12 // extra distance at top speed
const BOWL_LIFT = 0.55 // how much of a descent below deck level the rig ignores

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
  const ready = useRef(false)
  // zoom > 1 pulls closer; fov is the Canvas default (26).
  const cam = useControls('camera', {
    zoom: { value: 1.2, min: 0.4, max: 4, step: 0.05 },
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
    const sp = Math.hypot(P.vel.x, P.vel.z)
    const k = sp > 0.001 ? Math.min(LOOK_AHEAD_MAX, sp * LOOK_AHEAD) / sp : 0
    const tx = P.pos.x + P.vel.x * k
    const tz = P.pos.z + P.vel.z * k
    // vertical follow ignores hops so the frame stays calm over jumps
    let ty = P.state === 'air' ? Math.min(P.pos.y, f.y + 1.2) : P.pos.y
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
    camera.position.set(f.x + OFFSET.x * zoom, f.y + OFFSET.y * zoom, f.z + OFFSET.z * zoom)
    camera.lookAt(f.x, f.y + 0.7, f.z)
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov
      camera.updateProjectionMatrix()
    }
  })

  // ponytail: no occlusion raycast — at a 40 deg pitch from 19 units nothing in
  // this park can get between the camera and the player. Add one if that changes.
  return null
}
