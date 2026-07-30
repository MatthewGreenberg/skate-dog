// Deterministic photo mode. `?shot=<pose>` freezes the simulation, parks the
// camera on an authored pose and signals readiness on window.__shotReady, so a
// headless screenshot of the same commit is byte-comparable frame to frame.
//
// Everything here is inert unless the query param is present.

import * as THREE from 'three'

// pos/look are world-space; `player` is where the rig is parked for the shot.
export const POSES = {
  // ref b4f9…: high three-quarter over the bowl, rider carving the transition
  bowl: {
    pos: [-2.6, 16.4, 12.2],
    look: [-14.6, -1.1, -3.4],
    fov: 30,
    player: { x: -14.2, y: -1.55, z: -3.0, heading: -1.15 },
  },
  // ref 98f4…: wide plaza establishing shot, stairs + rails + bowl in frame
  plaza: {
    pos: [-1.5, 26.5, 34.5],
    look: [2.5, 0.4, 1.0],
    fov: 32,
    player: { x: 3.2, y: 0, z: 3.4, heading: -0.45 },
  },
  // character read: close on the dog + rider
  hero: {
    pos: [4.2, 3.1, 9.4],
    look: [1.6, 0.85, 4.6],
    fov: 26,
    player: { x: 1.4, y: 0, z: 4.4, heading: -0.55 },
  },
  // set dressing: planter, benches, lamp post, mural wall
  props: {
    pos: [-20.0, 7.2, 18.6],
    look: [-26.0, 1.2, 8.0],
    fov: 30,
    player: { x: -23.0, y: 0, z: 12.0, heading: 1.2 },
  },
  // foliage + perimeter framing, the shot that currently reads worst
  grove: {
    pos: [-22.0, 12.0, -2.0],
    look: [-33.0, 1.0, -16.0],
    fov: 34,
    player: { x: -29.0, y: 0, z: -12.0, heading: -0.8 },
  },
  // deck / stairs / rail architecture
  deck: {
    pos: [10.5, 15.0, 6.0],
    look: [20.0, 1.2, -14.0],
    fov: 30,
    player: { x: 17.0, y: 1.6, z: -10.0, heading: 0.3 },
  },
}

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
const name = params?.get('shot')

export const PHOTO = name && POSES[name] ? { name, ...POSES[name] } : null

// Frozen clock so wind, particles and any time-driven shader land identically.
export const PHOTO_TIME = Number(params?.get('t') ?? 8.0)

const _look = new THREE.Vector3()

/** Parks `camera` on the pose. Called every frame — the rig is bypassed. */
export function applyPhotoCamera(camera) {
  if (!PHOTO) return false
  camera.position.set(...PHOTO.pos)
  _look.set(...PHOTO.look)
  camera.lookAt(_look)
  if (camera.fov !== PHOTO.fov) {
    camera.fov = PHOTO.fov
    camera.updateProjectionMatrix()
  }
  return true
}

/** Flips window.__shotReady once enough frames have settled. */
let settled = 0
export function tickPhotoReady() {
  if (!PHOTO || settled > 30) return
  if (++settled > 30) window.__shotReady = true
}
