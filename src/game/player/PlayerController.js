// Arcade movement controller. Deterministic, fixed-timestep, tunable.
// Velocity-based: the surface normal does the work, so bowl momentum, slope
// following and ramp launches all fall out of the same integration.

import * as THREE from 'three'
import { P, useGame, emit } from '../store.js'
import { input, consumeJump } from '../input.js'
import { sampleSurface, resolveCollision } from '../level/colliders.js'
import { findGrind, railAt, PATHS } from '../level/rails.js'
import { SPAWN } from '../level/levelData.js'

// ------------------------------------------------------------------ tuning
const STEP = 1 / 120
const MAX_STEPS = 10

const G = 22
const MAX_SPEED = 13
const ACCEL = 13
const REVERSE_ACCEL = 5
const BRAKE = 18
const ROLL_DRAG = 0.32
const OVERSPEED_DRAG = 0.55
const GRIP = 10
const TURN_LOW = 3.5
const TURN_HIGH = 1.45
const AIR_ACCEL = 4.5

const JUMP_V = 7.6
const COYOTE = 0.13
const SNAP = 0.07 // how far below the surface counts as contact
const ADHERE = 1.5 // ground stickiness over convex lips
const RADIUS = 0.5

const SPIN_RATE = 7.4 // rad/s of aerial yaw
const DOG_SPIN_TIME = 0.42
const GRIND_HEIGHT = 0.06
const GRIND_DRAG = 0.22

// ------------------------------------------------------------------ scratch
const UP = new THREE.Vector3(0, 1, 0)
const n = new THREE.Vector3()
const f = new THREE.Vector3()
const tmp = new THREE.Vector3()
const railPos = new THREE.Vector3()
const railTan = new THREE.Vector3()
const surf = { y: 0, nx: 0, ny: 1, nz: 0, type: 'concrete', slope: 0, inBowl: false, id: null }
const push = { x: 0, z: 0 }
const basis = new THREE.Matrix4()
const vRight = new THREE.Vector3()
const vFwd = new THREE.Vector3()

// ------------------------------------------------------------------ trick tape
const trick = {
  spinTotal: 0,
  dogSpins: 0,
  dogTarget: 0,
  dogT: 0,
  grabTime: 0,
  air: 0,
  combo: 0,
  comboTimer: 0,
  grindTime: 0,
  grindBank: 0,
}

let acc = 0
let coyote = 0
let grindLock = 0
let spinResidual = 0
const lastSafe = { x: SPAWN.x, z: SPAWN.z, y: 0, heading: SPAWN.heading }

export function resetPlayer() {
  P.pos.set(SPAWN.x, 0, SPAWN.z)
  P.vel.set(0, 0, 0)
  P.heading = SPAWN.heading
  P.state = 'ground'
  P.spinYaw = 0
  P.dogRoll = 0
  P.dogPitch = 0
  P.riderLift = 0
  P.grindRail = null
}

const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt))

// ------------------------------------------------------------------ update
export function updatePlayer(dt) {
  acc += Math.min(dt, 0.1)
  let steps = 0
  while (acc >= STEP && steps < MAX_STEPS) {
    step(STEP)
    acc -= STEP
    steps++
  }
  if (steps === MAX_STEPS) acc = 0
  updateAnim(Math.min(dt, 0.1))
}

function step(dt) {
  if (grindLock > 0) grindLock -= dt
  P.throttle = input.throttle
  P.steer = input.steer
  P.braking = input.brake

  if (P.state === 'bail') return stepBail(dt)
  if (P.state === 'grind') return stepGrind(dt)
  if (P.state === 'air') return stepAir(dt)
  stepGround(dt)
}

// ------------------------------------------------------------------ ground
function stepGround(dt) {
  sampleSurface(P.pos.x, P.pos.z, P.pos.y, surf)
  n.set(surf.nx, surf.ny, surf.nz)
  P.surfUp.copy(n)
  P.surfaceType = surf.type
  P.inBowl = surf.inBowl

  // steering. forward is (sin h, 0, cos h), so a rising heading yaws
  // counter-clockwise about +Y — a *left* turn. Steer right (+1) subtracts.
  const sp = Math.hypot(P.vel.x, P.vel.z)
  const turn = TURN_LOW + (TURN_HIGH - TURN_LOW) * Math.min(1, sp / MAX_SPEED)
  P.heading -= input.steer * turn * dt

  // forward, projected onto the surface
  f.set(Math.sin(P.heading), 0, Math.cos(P.heading))
  f.addScaledVector(n, -f.dot(n))
  if (f.lengthSq() < 1e-6) f.set(Math.sin(P.heading), 0, Math.cos(P.heading))
  f.normalize()

  // drive
  if (input.throttle > 0) P.vel.addScaledVector(f, ACCEL * input.throttle * dt)
  else if (input.reverse) P.vel.addScaledVector(f, -REVERSE_ACCEL * dt)

  // gravity along the surface — this is what builds speed in the bowl
  tmp.copy(n).multiplyScalar(G * n.y)
  tmp.y -= G
  P.vel.addScaledVector(tmp, dt)

  // tangential velocity handling
  tmp.copy(P.vel).addScaledVector(n, -P.vel.dot(n))
  let tSpeed = tmp.length()

  if (input.brake && tSpeed > 0.05) {
    const drop = Math.min(tSpeed, BRAKE * dt)
    tmp.multiplyScalar((tSpeed - drop) / tSpeed)
    tSpeed -= drop
  }

  // carve: rotate the tangential velocity toward the facing direction
  if (tSpeed > 0.05) {
    const sgn = tmp.dot(f) >= 0 ? 1 : -1
    const k = 1 - Math.exp(-GRIP * dt)
    tmp.x += (f.x * tSpeed * sgn - tmp.x) * k
    tmp.y += (f.y * tSpeed * sgn - tmp.y) * k
    tmp.z += (f.z * tSpeed * sgn - tmp.z) * k
    const l = tmp.length()
    if (l > 1e-5) tmp.multiplyScalar(tSpeed / l)
  }

  // drag + soft speed cap (gravity may still push past it in the bowl)
  let drag = ROLL_DRAG
  if (tSpeed > MAX_SPEED) drag += OVERSPEED_DRAG * (tSpeed - MAX_SPEED)
  tmp.multiplyScalar(1 / (1 + drag * dt))

  P.vel.copy(tmp)

  // integrate + resolve
  const prevY = P.pos.y
  P.pos.addScaledVector(P.vel, dt)
  if (resolveCollision(P.pos, prevY, RADIUS, push)) slideAlongWall()

  sampleSurface(P.pos.x, P.pos.z, prevY, surf)
  const gap = P.pos.y - surf.y

  if (gap <= SNAP) {
    P.pos.y = surf.y
    reproject(surf)
    ground(true)
  } else if (gap < ADHERE && P.vel.y <= 1.0) {
    // ground adhesion over a convex lip: snap down and re-aim the velocity
    // along the new surface, preserving speed so bowl entry stays smooth.
    const speed = P.vel.length()
    P.pos.y = surf.y
    reproject(surf)
    const l = P.vel.length()
    if (l > 1e-4) P.vel.multiplyScalar(speed / l)
    ground(true)
  } else {
    takeoff(false)
  }

  // jump
  if (input.jumpBuffer > 0 && P.state === 'ground') doJump()

  if (P.state === 'ground' && P.groundTime > 0.1) {
    lastSafe.x = P.pos.x
    lastSafe.z = P.pos.z
    lastSafe.y = P.pos.y
    lastSafe.heading = P.heading
  }
  P.groundTime += dt
  coyote = COYOTE

  tryGrind()
}

/**
 * Wall response: drop the velocity into the wall, bleed speed by how head-on the
 * hit was, and steer the heading toward the wall tangent. Without the heading
 * nudge the carve model would just aim straight back into the wall every frame.
 */
function slideAlongWall() {
  const l = Math.hypot(push.x, push.z)
  if (l < 1e-6) return
  const nx = push.x / l
  const nz = push.z / l
  const speed = Math.hypot(P.vel.x, P.vel.z)
  const into = P.vel.x * nx + P.vel.z * nz
  if (into >= 0 || speed < 0.05) return

  P.vel.x -= nx * into
  P.vel.z -= nz * into

  const headOn = Math.min(1, -into / speed)
  P.vel.x *= 1 - 0.55 * headOn
  P.vel.z *= 1 - 0.55 * headOn

  // tangent that best matches where we were already going
  let tx = -nz
  let tz = nx
  if (tx * P.vel.x + tz * P.vel.z < 0) {
    tx = -tx
    tz = -tz
  }
  const want = Math.atan2(tx, tz)
  P.heading += wrapPi(want - P.heading) * (0.35 + 0.45 * headOn)
}

function reproject(s) {
  n.set(s.nx, s.ny, s.nz)
  P.vel.addScaledVector(n, -P.vel.dot(n))
  P.surfUp.copy(n)
  P.surfaceType = s.type
  P.inBowl = s.inBowl
  P.slope = s.slope
}

function ground(on) {
  P.grounded = on
  P.state = 'ground'
}

function takeoff(fromJump) {
  if (P.state === 'air') return
  P.state = 'air'
  P.grounded = false
  P.airTime = 0
  P.groundTime = 0
  if (!fromJump) {
    trick.spinTotal = 0
    trick.dogSpins = 0
    trick.grabTime = 0
  }
}

function doJump() {
  consumeJump()
  const s = P.surfUp
  tmp.set(s.x * 0.4, s.y * 0.4 + 0.6, s.z * 0.4).normalize()
  P.vel.addScaledVector(tmp, JUMP_V)
  takeoff(true)
  trick.spinTotal = 0
  trick.dogSpins = 0
  trick.grabTime = 0
  trick.air = 0
  P.crouch = 0.55
  emit('jump', { pos: P.pos })
  emit('dust', { pos: P.pos, amount: 3 })
}

// ------------------------------------------------------------------ air
function stepAir(dt) {
  P.airTime += dt
  trick.air += dt

  // a little push
  if (input.throttle > 0) {
    f.set(Math.sin(P.heading), 0, Math.cos(P.heading))
    P.vel.x += f.x * AIR_ACCEL * dt
    P.vel.z += f.z * AIR_ACCEL * dt
  }

  // aerial spin. Left/right IS the spin in the air — no separate spin key and
  // no air steering, since a slow AIR_TURN on the same stick just fights it.
  const spin = input.spin || input.steer
  if (spin !== 0) {
    const d = -spin * SPIN_RATE * dt // same sign convention as steering
    P.spinYaw += d
    trick.spinTotal += Math.abs(d)
  }

  // kickflip — the dog IS the board, so its barrel roll is the flip.
  // Held back re-triggers once the previous roll has run out.
  if ((input.dogSpin || input.reverse) && trick.dogT <= 0) {
    trick.dogTarget += Math.PI * 2
    trick.dogT = DOG_SPIN_TIME
    trick.dogSpins++
  }
  if (trick.dogT > 0) trick.dogT -= dt

  if (input.grab) trick.grabTime += dt

  P.vel.y -= G * dt

  const prevY = P.pos.y
  P.pos.addScaledVector(P.vel, dt)
  if (resolveCollision(P.pos, P.pos.y, RADIUS, push)) slideAlongWall()

  // late jump off a ledge
  coyote -= dt
  if (coyote > 0 && input.jumpBuffer > 0) {
    P.surfUp.set(0, 1, 0)
    doJump()
    return
  }

  if (tryGrind()) return

  sampleSurface(P.pos.x, P.pos.z, prevY + 0.4, surf)
  if (P.pos.y <= surf.y + 0.02 && P.vel.y <= 0) land(surf)
}

function land(s) {
  const impact = Math.max(0, -P.vel.y)
  P.pos.y = s.y
  reproject(s)

  // landing mid-flip only bails if the dog is properly inverted AND it hurt.
  // Below that the flip snaps to the nearest whole turn — a one-key trick you
  // can tap late is only fun if a late tap isn't a death sentence.
  const roll = Math.abs(wrapPi(P.dogRoll))
  if (roll > 2.4 && impact > 4) return bail()
  trick.dogTarget = Math.round(P.dogRoll / (Math.PI * 2)) * Math.PI * 2

  ground(true)
  P.crouch = Math.min(1, 0.25 + impact * 0.075)
  P.landImpact = impact
  P.airTime = 0
  emit('land', { pos: P.pos, impact, surface: s.type })
  if (impact > 3) emit('dust', { pos: P.pos, amount: Math.min(8, 2 + impact * 0.5) })

  // fold the visual spin back into the heading
  const turns = Math.round(P.spinYaw / (Math.PI * 2))
  P.heading += turns * Math.PI * 2
  spinResidual = P.spinYaw - turns * Math.PI * 2
  P.spinYaw = 0

  scoreAir()
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// ------------------------------------------------------------------ grind
function tryGrind() {
  if (P.state === 'grind' || grindLock > 0) return false
  if (input.jumpHeld && P.state === 'ground') return false
  const hit = findGrind(P.pos.x, P.pos.y, P.pos.z, P.vel.x, P.vel.z)
  if (!hit) return false

  P.state = 'grind'
  P.grounded = false
  P.grindRail = PATHS.indexOf(hit.rail)
  P.grindS = hit.s
  P.grindDir = hit.dir
  P.riderPose = 'grind'
  trick.grindTime = 0
  trick.grindBank = 0
  emit('grind', { on: true, pos: P.pos })
  return true
}

function stepGrind(dt) {
  const rail = PATHS[P.grindRail]
  railAt(rail, P.grindS, railPos, railTan)

  let speed = Math.hypot(P.vel.x, P.vel.y, P.vel.z)
  // gravity along the rail + drag
  speed += -G * railTan.y * P.grindDir * dt
  if (input.brake) speed -= BRAKE * 0.5 * dt
  speed /= 1 + GRIND_DRAG * dt
  speed = Math.min(speed, MAX_SPEED * 1.35)

  P.grindS += speed * P.grindDir * dt
  trick.grindTime += dt
  trick.grindBank += 42 * dt

  if (P.grindS <= 0 || P.grindS >= rail.length || speed < 1.2) return exitGrind(speed, true)
  if (input.jumpBuffer > 0) return exitGrind(speed, false)

  railAt(rail, P.grindS, railPos, railTan)
  P.pos.set(railPos.x, railPos.y + GRIND_HEIGHT, railPos.z)
  P.vel.copy(railTan).multiplyScalar(speed * P.grindDir)
  P.heading = Math.atan2(railTan.x * P.grindDir, railTan.z * P.grindDir)
  P.surfUp.set(0, 1, 0)
  P.surfaceType = 'rail'
  P.inBowl = false
}

function exitGrind(speed, natural) {
  const rail = PATHS[P.grindRail]
  railAt(rail, Math.min(Math.max(P.grindS, 0), rail.length), railPos, railTan)
  P.vel.copy(railTan).multiplyScalar(speed * P.grindDir)
  emit('grind', { on: false, pos: P.pos })

  if (trick.grindBank > 20) {
    const pts = Math.round(trick.grindBank)
    award(trick.grindTime > 1.6 ? 'Long Grind' : 'Grind', pts)
  }
  trick.grindBank = 0

  P.grindRail = null
  grindLock = 0.3 // stops the rail ends re-acquiring the grind we just left
  P.state = 'air'
  P.grounded = false
  P.airTime = 0
  P.riderPose = 'air'
  trick.spinTotal = 0
  trick.dogSpins = 0
  trick.grabTime = 0
  if (!natural) {
    P.vel.y += JUMP_V * 0.85
    consumeJump()
    emit('jump', { pos: P.pos })
  }
}

// ------------------------------------------------------------------ bail
function bail() {
  P.state = 'bail'
  P.grounded = false
  P.riderPose = 'bail'
  P.respawnTimer = 1.25
  P.vel.set(P.vel.x * 0.3, 2.5, P.vel.z * 0.3)
  useGame.getState().loseLife()
  if (useGame.getState().lives <= 0) useGame.setState({ lives: 3 })
  trick.combo = 0
  useGame.getState().setCombo(0)
  emit('bail', { pos: P.pos })
}

function stepBail(dt) {
  P.respawnTimer -= dt
  P.vel.y -= G * dt
  P.pos.addScaledVector(P.vel, dt)
  P.dogRoll += 5 * dt
  P.dogPitch += 3 * dt
  sampleSurface(P.pos.x, P.pos.z, 1e6, surf)
  if (P.pos.y < surf.y) {
    P.pos.y = surf.y
    P.vel.set(0, 0, 0)
  }
  if (P.respawnTimer <= 0) {
    P.pos.set(lastSafe.x, lastSafe.y, lastSafe.z)
    P.heading = lastSafe.heading
    P.vel.set(0, 0, 0)
    P.dogRoll = 0
    P.dogPitch = 0
    P.spinYaw = 0
    P.riderPose = 'ride'
    trick.dogTarget = 0
    P.state = 'ground'
    P.grounded = true
  }
}

// ------------------------------------------------------------------ scoring
function scoreAir() {
  const halves = Math.floor(trick.spinTotal / Math.PI + 0.15)
  let pts = 0
  let name = ''

  if (trick.dogSpins > 0) {
    pts += trick.dogSpins * 160
    name = trick.dogSpins > 1 ? `${trick.dogSpins}x Kickflip` : 'Kickflip'
  }
  if (halves > 0) {
    pts += halves * 110
    const deg = halves * 180
    name = name ? `${name} + ${deg}` : `${deg}`
  }
  if (trick.grabTime > 0.22) {
    pts += 80
    name = name ? `${name} Grab` : 'Grab'
  }
  if (!name && trick.air > 0.55) {
    name = 'Ollie'
    pts = 30 + Math.round(trick.air * 40)
  }

  trick.spinTotal = 0
  trick.dogSpins = 0
  trick.grabTime = 0
  trick.air = 0
  if (pts > 0) award(name, pts)
}

function award(name, pts) {
  trick.comboTimer = 2.4
  trick.combo++
  const mult = 1 + (trick.combo - 1) * 0.5
  const total = Math.round(pts * mult)
  const g = useGame.getState()
  g.addScore(total)
  g.setCombo(trick.combo)
  g.showTrick(trick.combo > 1 ? `${name}  x${trick.combo}` : name, total)
  emit('trick', { name, points: total })
}

// ------------------------------------------------------------------ anim
function updateAnim(dt) {
  // combo window
  if (trick.comboTimer > 0) {
    trick.comboTimer -= dt
    if (trick.comboTimer <= 0 && trick.combo !== 0) {
      trick.combo = 0
      useGame.getState().setCombo(0)
    }
  }

  P.speed = Math.hypot(P.vel.x, P.vel.z)

  // dog barrel roll eases toward its target
  P.dogRoll = damp(P.dogRoll, trick.dogTarget, 12, dt)
  const rolling = Math.abs(trick.dogTarget - P.dogRoll) > 0.12
  P.riderLift = damp(P.riderLift, rolling ? 1 : 0, 11, dt)
  if (!rolling && P.state === 'ground') {
    // keep the numbers small so the eased angle never drifts
    const k = Math.round(trick.dogTarget / (Math.PI * 2))
    trick.dogTarget -= k * Math.PI * 2
    P.dogRoll -= k * Math.PI * 2
  }

  // residual spin unwind after landing
  if (spinResidual !== 0) {
    spinResidual = damp(spinResidual, 0, 14, dt)
    if (Math.abs(spinResidual) < 0.002) spinResidual = 0
  }

  // pose
  if (P.state === 'grind') P.riderPose = 'grind'
  else if (P.state === 'bail') P.riderPose = 'bail'
  else if (P.state === 'air') P.riderPose = input.grab ? 'grab' : 'air'
  else if (P.crouch > 0.45) P.riderPose = 'land'
  else if (input.jumpHeld) P.riderPose = 'tuck'
  else P.riderPose = 'ride'

  // channels
  const speedN = Math.min(1, P.speed / MAX_SPEED)
  P.lean = damp(P.lean, P.state === 'ground' ? input.steer * speedN : 0, 7, dt)
  const stretchTarget = P.state === 'ground' ? (input.throttle > 0 ? 1 : 0) - (input.brake ? 1 : 0) : 0
  P.stretch = damp(P.stretch, stretchTarget, 6, dt)
  P.crouch = damp(P.crouch, 0, 7, dt)

  const cycling = P.state === 'ground' || P.state === 'grind'
  P.runBlend = damp(P.runBlend, cycling && P.speed > 0.4 ? 1 : 0, 9, dt)
  P.run += (3.2 + P.speed * 1.9) * P.runBlend * dt
  if (P.run > 1e5) P.run -= 1e5

  // pitch from vertical velocity while airborne, from slope while grounded
  const pitchTarget = P.state === 'air' ? THREE.MathUtils.clamp(-P.vel.y * 0.035, -0.3, 0.3) : 0
  P.dogPitch = damp(P.dogPitch, P.state === 'bail' ? P.dogPitch : pitchTarget, 8, dt)

  // smoothed up vector
  const targetUp = P.state === 'ground' ? P.surfUp : UP
  P.up.x = damp(P.up.x, targetUp.x, 11, dt)
  P.up.y = damp(P.up.y, targetUp.y, 11, dt)
  P.up.z = damp(P.up.z, targetUp.z, 11, dt)
  if (P.up.lengthSq() < 1e-6) P.up.set(0, 1, 0)
  P.up.normalize()

  // orientation
  const yaw = P.heading + P.spinYaw + spinResidual
  vFwd.set(Math.sin(yaw), 0, Math.cos(yaw))
  vFwd.addScaledVector(P.up, -vFwd.dot(P.up))
  if (vFwd.lengthSq() < 1e-6) vFwd.set(Math.sin(yaw), 0, Math.cos(yaw))
  vFwd.normalize()
  vRight.crossVectors(P.up, vFwd).normalize()
  basis.makeBasis(vRight, P.up, vFwd)
  P.quat.setFromRotationMatrix(basis)
}
