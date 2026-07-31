import { create } from 'zustand'
import * as THREE from 'three'
import { SPAWN } from './level/levelData.js'

/**
 * UI-facing state only. Anything that changes every frame lives on `P` below
 * so it never triggers a React render.
 */
export const useGame = create((set, get) => ({
  score: 0,
  lives: 3,
  combo: 0,
  bones: 0, // floating bones collected (of levelData BONES)
  trickText: '',
  trickPoints: 0,
  started: false,
  paused: false,
  quality: 'high',

  start: () => set({ started: true }),
  setPaused: (paused) => set({ paused }),
  setQuality: (quality) => set({ quality }),
  addScore: (n) => set({ score: Math.round(get().score + n) }),
  showTrick: (trickText, trickPoints) => set({ trickText, trickPoints }),
  clearTrick: () => set({ trickText: '', trickPoints: 0 }),
  setCombo: (combo) => set({ combo }),
  collectBone: () => set({ bones: get().bones + 1 }),
  loseLife: () => set({ lives: Math.max(0, get().lives - 1) }),
}))

/**
 * High-frequency game state. Plain mutable object shared by the systems and
 * read by the view components inside useFrame. Never put this in React state.
 */
export const P = {
  pos: new THREE.Vector3(SPAWN.x, 0, SPAWN.z),
  vel: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0), // smoothed surface normal
  surfUp: new THREE.Vector3(0, 1, 0), // raw surface normal
  quat: new THREE.Quaternion(), // dog body orientation
  heading: SPAWN.heading,
  speed: 0,
  state: 'ground', // ground | air | grind | bail
  grounded: true,
  slope: 0,
  surfaceType: 'concrete',
  inBowl: false,
  airTime: 0,
  groundTime: 0,

  // visual / animation channels driven by the controller
  spinYaw: 0, // extra yaw from aerial spins
  dogRoll: 0, // barrel roll of the dog under the rider
  dogPitch: 0,
  riderLift: 0, // 0..1 separation from the dog
  grab: 0, // 0..1 mid-air grab — the dog tweaks sideways like a grabbed board
  grabStyle: 'nose', // which grab: nose | tail | indy | method — rolled per grab
  surfLift: 0, // metres of rig lift on curved surfaces (long dog vs tight arc)
  surfCurv: 0, // analytic curvature (1/R) of the ridden surface, from colliders
  riderPose: 'ride', // ride | tuck | grab | grind | land | air | bail
  crouch: 0, // 0..1 landing compression
  lean: 0, // -1..1 turn lean
  stretch: 0, // -1..1 accel stretch / brake squash
  run: 0, // dog leg cycle phase
  runBlend: 0, // 0..1 how much the legs are cycling

  grindRail: null,
  grindS: 0,
  grindDir: 1,
  landImpact: 0,
  throttle: 0,
  steer: 0,
  braking: false,
  respawnTimer: 0,
}

// ------------------------------------------------------------ event bus
// One-shot gameplay events consumed by Effects and AudioManager.
const listeners = new Map()
export function on(name, fn) {
  let a = listeners.get(name)
  if (!a) listeners.set(name, (a = []))
  a.push(fn)
  return () => {
    const i = a.indexOf(fn)
    if (i >= 0) a.splice(i, 1)
  }
}
export function emit(name, payload) {
  const a = listeners.get(name)
  if (a) for (let i = 0; i < a.length; i++) a[i](payload)
}

// Event names:
//   'land'   { pos:Vector3, impact:number, surface:string }
//   'jump'   { pos:Vector3 }
//   'dust'   { pos:Vector3, amount:number }
//   'grind'  { on:boolean, pos:Vector3 }
//   'spark'  { pos:Vector3, dir:Vector3 }
//   'trick'  { name:string, points:number }
//   'bail'   { pos:Vector3 }
//   'bone'   { pos:Vector3, big:boolean }  collectible grabbed (big = last one)
