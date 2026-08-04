import { create } from 'zustand'
import * as THREE from 'three'
import { SPAWN } from './level/levelData.js'

/**
 * UI-facing state only. Anything that changes every frame lives on `P` below
 * so it never triggers a React render.
 */
// Seconds on the clock at the start of a run. Short on purpose: the run is
// EXTENDED by playing (see TIME_BONUS / TIME_BAIL), so a long base clock would
// make every challenge urgency-free.
export const RUN_TIME = 120
export const TIME_BONUS = 15 // per bone and per challenge
export const TIME_BAIL = -5 // time is the only resource — there are no lives

export const useGame = create((set, get) => ({
  score: 0,
  combo: 0,
  bones: 0, // floating bones collected (of levelData BONES)
  // Whole seconds only. The live clock is P.timeLeft; GameLoop mirrors it here
  // when the displayed second changes, so the HUD renders ~1Hz, not 120Hz.
  timeLeft: RUN_TIME,
  runOver: false,
  goalsDone: [], // ids from goals.js GOALS
  // Bumped by restart(). Keys the collectible components, whose collected flags
  // live in useRefs with no reset path — a remount IS the reset.
  runId: 0,
  trickText: '',
  trickPoints: 0,
  trickLive: false, // trick still in progress — the popup holds instead of fading
  started: false,
  paused: false,
  // Every device starts low while shaders, reflections and render targets are
  // warmed behind the loader. Desktop moves to high before the start card is
  // revealed; phones stay low.
  quality: 'low',
  warmupReflectionReady: false,
  warmedUp: false,

  start: () => set({ started: true }),
  setPaused: (paused) => set({ paused }),
  setQuality: (quality) => set({ quality }),
  setWarmupReflectionReady: (warmupReflectionReady) => set({ warmupReflectionReady }),
  finishWarmup: () => set({ warmedUp: true }),
  addScore: (n) => set({ score: Math.round(get().score + n) }),
  showTrick: (trickText, trickPoints, trickLive = false) => set({ trickText, trickPoints, trickLive }),
  settleTrick: () => set({ trickLive: false }), // trick over, let the popup fade
  clearTrick: () => set({ trickText: '', trickPoints: 0, trickLive: false }),
  setCombo: (combo) => set({ combo }),
  collectBone: () => set({ bones: get().bones + 1 }),

  // ---------------------------------------------------------------- the run
  setTimeLeft: (timeLeft) => set({ timeLeft }),
  // Writes through to P as well as the store: P is the clock the loop ticks,
  // and a bonus that only landed in the store would be erased next frame.
  addTime: (s) => {
    P.timeLeft = Math.max(0, P.timeLeft + s)
    set({ timeLeft: Math.ceil(P.timeLeft) })
  },
  markGoal: (id) => set({ goalsDone: [...get().goalsDone, id] }),
  endRun: () => set({ runOver: true }),
  restart: () => {
    P.timeLeft = RUN_TIME
    set((s) => ({
      score: 0,
      combo: 0,
      bones: 0,
      timeLeft: RUN_TIME,
      runOver: false,
      goalsDone: [],
      runId: s.runId + 1,
      trickText: '',
      trickPoints: 0,
      trickLive: false,
    }))
  },
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
  // 1 = title framing, 0 = chase rig. Ticked down over the reveal by GameLoop;
  // CameraController blends the two poses with it and Intro.jsx flies the
  // troika title out on the same clock, so there is one timeline, not three.
  intro: 1,
  // the live run clock. useGame.timeLeft is a whole-second mirror of this.
  timeLeft: RUN_TIME,
  // the challenge sheet is open. GameLoop skips the clock AND the sim, so it is
  // a real pause; it lives on P (not the store) because the frame loop is the
  // only reader and a store flag would re-render the HUD to say so.
  paused: false,
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
//   'goal'   { pos:Vector3, id:string }    challenge completed (goals.js)
