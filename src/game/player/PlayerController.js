// Arcade movement controller. Deterministic, fixed-timestep, tunable.
// Velocity-based: the surface normal does the work, so bowl momentum, slope
// following and ramp launches all fall out of the same integration.

import * as THREE from 'three'
import { P, useGame, emit } from '../store.js'
import { input, consumeJump, applyTouchStick, TOUCH } from '../input.js'
import { sampleSurface, resolveCollision } from '../level/colliders.js'
import { findGrind, railAt, PATHS } from '../level/rails.js'
import { SPAWN, BOWL, bowlRadius } from '../level/levelData.js'

// ------------------------------------------------------------------ tuning
const STEP = 1 / 120
const MAX_STEPS = 10

const G = 22
// Mobile rides ~30% slower: the same speed reads much faster on a small screen
// with a thumb stick, and overspeed drag above the lower cap curbs the
// gravity-built bowl speed too. CLEAN_CAP and the turn-rate blend are both
// relative to MAX_SPEED, so they scale with it for free. Desktop untouched.
const SPEED_K = TOUCH ? 0.7 : 1
const MAX_SPEED = 13 * SPEED_K
const ACCEL = 13 * SPEED_K
const REVERSE_ACCEL = 5
const BRAKE = 18
const ROLL_DRAG = 0.32
const OVERSPEED_DRAG = 0.55
// Carve. TURN_* is the heading rate (rad/s) at rest and at MAX_SPEED; GRIP is
// how fast the tangential velocity chases the heading. Raising the heading rate
// alone only points the dog — the velocity keeps going the old way and it reads
// as understeer, so the two move together.
const GRIP = 19
const TURN_LOW = 4.7
const TURN_HIGH = 3.1
// Weight shift. Steering against the lean you are already holding is a skater
// unweighting and whipping the board across, so it turns and bites harder than
// a carve started from flat. The size of it IS the lean being unloaded, which
// makes it free: P.lean already scales with speed (no snap at a standstill) and
// already decays as you cross, so the boost fades on its own with no timer.
const SHIFT_TURN = 1.6
const SHIFT_GRIP = 1.2

const JUMP_V = 7.6
// Clean-landing reward: land square with the flip ridden out and you keep MORE
// than you brought — the skate-game pump loop. Gated on real air so ollie spam
// can't build speed from nothing, capped so overspeed drag wins eventually.
const CLEAN_BOOST = 0.1 // base momentum bonus
const CLEAN_BOOST_AIR = 0.04 // extra per second of air, up to +0.08
const CLEAN_CAP = 1.25 // of MAX_SPEED
const COYOTE = 0.13
// A flatground ollie is airborne ~0.69s (2*JUMP_V/G), so 1.0 needs a properly
// pumped ramp/bowl air — the rainbow-sparkle "big air" celebration moment,
// which also pays a Big Air bonus through scoreAir at landing.
const BIG_AIR = 1.0
const SNAP = 0.07 // how far below the surface counts as contact
// Ground stickiness over convex lips is GEOMETRIC, not a constant: a real lip
// drops ~speed*dt per substep (0.11m at 13 m/s), but a constant big enough for
// bowl entry (1.5) also swallowed every deck edge in the park — pad1 (1.2) and
// pad2 (0.9) snapped you straight down to the plaza without one airborne frame,
// then side-ejected you when the deck reclassified from floor to wall.
const ADHERE_MIN = 0.12
const ADHERE_K = 2 // of speed * dt
const LAUNCH = 2.0 // m/s of separation from the surface that pops you off a lip
const RADIUS = 0.5

const SPIN_RATE = 7.4 // rad/s of aerial yaw
const DOG_SPIN_TIME = 0.55 // retrigger gate, tracks the 9-lambda roll ease
const GRIND_HEIGHT = 0.06
const GRIND_DRAG = 0.22

// ------------------------------------------------------------------ scratch
const UP = new THREE.Vector3(0, 1, 0)
const n = new THREE.Vector3()
const f = new THREE.Vector3()
const tmp = new THREE.Vector3()
const railPos = new THREE.Vector3()
const railTan = new THREE.Vector3()
const surf = { y: 0, nx: 0, ny: 1, nz: 0, type: 'concrete', slope: 0, curv: 0, inBowl: false, id: null }
const push = { x: 0, z: 0 }
const basis = new THREE.Matrix4()
const vRight = new THREE.Vector3()
const vFwd = new THREE.Vector3()

// ------------------------------------------------------------------ trick tape
// the grab pool — each style pairs a Rider POSES entry (grab_<style>) with a
// dog reaction in Dog.jsx's GRABS table. A fresh grab press rolls one at random.
const GRAB_STYLES = ['nose', 'tail', 'indy', 'method']
const GRAB_NAMES = { nose: 'Nose Grab', tail: 'Tail Grab', indy: 'Indy', method: 'Method' }

const trick = {
  spinTotal: 0,
  dogSpins: 0,
  dogTarget: 0,
  dogT: 0,
  grabTime: 0,
  grabbing: false,
  fwdLatch: false, // W/Up was already held at takeoff — not a grab press
  air: 0,
  combo: 0,
  comboTimer: 0,
  grindTime: 0,
  grindBank: 0,
  bigAir: false, // 'bigair' already emitted this air
  overPool: false, // crossed the bowl's interior during this air

  grindShown: 0, // multiplied points already added to the score this grind
  grindFlush: 0,
  airFlush: 0, // countdown to the next live trick-tape push
}

// A multiplier is for a CHAIN, not for landing tricks back to back: this is
// only how long the wheels may touch ground between links before the chain
// drops. Long enough to land-and-pop or roll onto the next rail, too short to
// cruise between two unrelated tricks.
const CHAIN_GRACE = 0.6

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
  // Consume the sub-STEP remainder instead of banking it: whole steps alone
  // advance the rendered pose by 1-3 steps per display frame depending on how
  // rAF beats against the 8.33ms grid — an 11cm-per-step stutter at speed with
  // a perfect frame rate. Safe as a variable-size step because every response
  // in step() is rate-based and dt-scaled.
  else if (acc > 0) {
    step(acc)
    acc = 0
  }
  updateAnim(Math.min(dt, 0.1))
}

function step(dt) {
  if (grindLock > 0) grindLock -= dt
  // per-substep, with the live heading: the touch stick is world-directional
  // on the ground, so its steer must track the heading as it turns
  applyTouchStick(P.heading, P.state === 'air')
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
  // 0 when steering into the lean you already hold, 1 at a full reversal
  const shift = Math.max(0, -input.steer * P.lean)
  const turn = TURN_LOW + (TURN_HIGH - TURN_LOW) * Math.min(1, sp / MAX_SPEED)
  P.heading -= input.steer * turn * (1 + SHIFT_TURN * shift) * dt

  // forward, projected onto the surface
  f.set(Math.sin(P.heading), 0, Math.cos(P.heading))
  f.addScaledVector(n, -f.dot(n))
  if (f.lengthSq() < 1e-6) f.set(Math.sin(P.heading), 0, Math.cos(P.heading))
  f.normalize()

  // drive. Push scales with how much of your weight is over the surface: you
  // cannot pump a 65-degree wall the way you pump flatground, and at full ACCEL
  // qp1 returned MORE energy than it took to climb — a 1.6m quarter threw you
  // 3m over the coping just for holding W.
  const pushK = Math.max(0.15, n.y) // NB: `push` is the module-scope wall-normal scratch
  if (input.throttle > 0) P.vel.addScaledVector(f, ACCEL * pushK * input.throttle * dt)
  else if (input.reverse) P.vel.addScaledVector(f, -REVERSE_ACCEL * pushK * dt)

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
    const k = 1 - Math.exp(-GRIP * (1 + SHIFT_GRIP * shift) * dt)
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
  if (resolveCollision(P.pos, prevY, RADIUS, push)) slideAlongWall(dt)

  sampleSurface(P.pos.x, P.pos.z, prevY, surf)
  const gap = P.pos.y - surf.y

  // Leaving a transition. At a ramp's lip the surface flattens under a velocity
  // that is still climbing, so the velocity separates from the new normal. The
  // gap across a lip is ~0, so the snap branch below used to catch it and
  // reproject the whole climb away — a quarter pipe gave literally no air. On
  // the ramp itself the velocity is tangent (sep 0) or curving in (sep < 0), so
  // this only ever fires at the top.
  const sep = P.vel.x * surf.nx + P.vel.y * surf.ny + P.vel.z * surf.nz

  if (gap > -SNAP && sep > LAUNCH) {
    if (P.pos.y < surf.y) P.pos.y = surf.y
    // Ollie off the lip. The jump has to be spent HERE — this branch sets state
    // to 'air', so by the time the usual `doJump()` check at the bottom of the
    // step runs, the press has already been swallowed and popping at the coping
    // did nothing at all. doJump does its own redirect, so don't double it.
    if (input.jumpBuffer > 0) doJump()
    else {
      launchOffLip()
      takeoff(false)
    }
  } else if (gap <= SNAP) {
    // Cap the upward snap rate: a ledge under STEP_UP (0.42 ledges, the 0.55
    // wall cap off pad1) otherwise teleports you up in ONE substep — a visible
    // pop. 8 m/s spreads a 0.55m step over ~0.08s. Scaled by 1/ny because the
    // cap is for flat-top STEPS only: on a near-vertical quarter a centimetre
    // of horizontal drift is 0.3m of surface height, and a flat 8 m/s cap left
    // the player riding 0.35m inside qp1's face.
    P.pos.y = Math.min(surf.y, P.pos.y + (8 * dt) / Math.max(0.15, surf.ny))
    // Concave crease (flat -> ramp base, ramp foot -> flat): a bare projection
    // eats 1 - cos(slope) of your speed in one frame — 14% at a 30-degree bank,
    // both entering AND leaving, which is what made ramps feel mushy. A skater
    // pumps through the crease, so keep the magnitude. The 0.3 floor skips
    // near-perpendicular hits (> ~72 degrees) where the tangential remainder is
    // too small to trust with the full speed.
    const speed = P.vel.length()
    reproject(surf)
    const l = P.vel.length()
    if (l > 0.3 * speed) P.vel.multiplyScalar(speed / l)
    ground(true)
  } else if (gap < Math.max(ADHERE_MIN, P.vel.length() * dt * ADHERE_K) && P.vel.y <= 1.0) {
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
  // only while still grounded — the launch/jump branches above may have set
  // 'air' this substep, and leaving with a charged window let a second tap
  // within 0.13s stack a full extra JUMP_V (a ~5.2m double ollie)
  if (P.state === 'ground') coyote = COYOTE

  tryGrind()
}

/**
 * Coming off a transition, a skater leaves the coping going UP, not out over
 * the deck: the lip is vertical-ish and the arc drops back into the same
 * tranny. Riding the tangent out instead throws you 1.5m past a 67-degree lip
 * and you land flat on the deck every single time — which is what made every
 * ramp in the park feel like a staircase with extra steps.
 *
 * So rotate the exit toward vertical in proportion to the lip angle, keeping
 * the speed. The overshoot past 1.0 is deliberate: at a full vert lip the
 * horizontal ends up slightly NEGATIVE, so the arc re-enters the transition it
 * left rather than clipping the flat overhang at the top of it.
 *
 * A bank sits below VERT_LO and is untouched — it still launches you forward,
 * which is what a bank is for.
 */
const VERT_LO = 0.55 // rad, 31deg — every bank/stair sits at <= 0.42, untouched
const VERT_HI = 0.9 // rad, 52deg — full straight-up arrives well below qp1's 1.18
// lip, so the up-and-back window covers the top half of the transition instead
// of just the coping. Deck transfers still live below VERT_LO (pop early).
function launchOffLip() {
  const b = Math.min(1, Math.max(0, (P.slope - VERT_LO) / (VERT_HI - VERT_LO)))
  if (b <= 0) return
  const h = Math.hypot(P.vel.x, P.vel.z)
  if (h < 1e-4) return
  const speed = Math.hypot(h, P.vel.y)
  const k = 1 - 1.25 * b
  P.vel.x *= k
  P.vel.z *= k
  P.vel.y = Math.sqrt(Math.max(0, speed * speed - h * h * k * k))
}

/**
 * Wall response: drop the velocity into the wall, bleed speed by how head-on the
 * hit was, and steer the heading toward the wall tangent. Without the heading
 * nudge the carve model would just aim straight back into the wall every frame.
 */
function slideAlongWall(dt) {
  const l = Math.hypot(push.x, push.z)
  if (l < 1e-6) return
  const nx = push.x / l
  const nz = push.z / l
  const speed = Math.hypot(P.vel.x, P.vel.z)
  const into = P.vel.x * nx + P.vel.z * nz
  if (into >= 0 && speed >= 0.05) return
  if (speed < 0.05) {
    // stalled nose-first: a near-head-on hit projects the speed to ~0 before
    // the eased turn below finishes, and then throttle refills velocity into
    // the wall while collision ejects it — pinned forever with the heading
    // frozen into the face. Keep turning toward the tangent using the FACING
    // (the velocity is dead and carries no direction to read).
    if (P.state !== 'ground') return
    const fx = Math.sin(P.heading)
    const fz = Math.cos(P.heading)
    if (fx * nx + fz * nz >= 0) return
    let tx = -nz
    let tz = nx
    if (tx * fx + tz * fz < 0) {
      tx = -tx
      tz = -tz
    }
    // aim 45deg OFF the wall, not along it: in an inside corner the two faces'
    // tangents each point into the other wall and a pure-tangent target just
    // oscillates between them (measured pinned at pad1's SW corner). The
    // outward-normal half of the target is what backs the dog out.
    P.heading += wrapPi(Math.atan2(tx + nx, tz + nz) - P.heading) * (1 - Math.exp(-14 * dt))
    return
  }

  P.vel.x -= nx * into
  P.vel.z -= nz * into

  const headOn = Math.min(1, -into / speed)
  // bleed the remaining tangential speed over ~0.25s, not per substep — the old
  // flat 0.55 cut compounded to ~96% loss in ONE rendered frame on a head-on
  // hit, and the camera's look-ahead point (pos + vel*k) lurched with it
  const bleed = Math.exp(-4.5 * headOn * dt)
  P.vel.x *= bleed
  P.vel.z *= bleed

  // tangent that best matches where we were already going. Grounded only:
  // there is deliberately no air steering, and a mid-air wall brush rotating
  // the heading corrupted the spin bookkeeping in land() — the clean-landing
  // gate failed off a graze you never steered into.
  if (P.state !== 'ground') return
  let tx = -nz
  let tz = nx
  if (tx * P.vel.x + tz * P.vel.z < 0) {
    tx = -tx
    tz = -tz
  }
  // ease toward the tangent at a rate, not a per-substep fraction: 0.35-0.8 per
  // substep converged inside a frame, so the rendered dog (yaw = P.heading)
  // whipped instantly on contact. 6-14 rad-equivalents/s turns it over
  // ~0.1-0.2s; the normal-projection above already stops re-penetration while
  // the heading catches up. The target blends OUTWARD by headOn: a near-dead
  // head-on hit leaves ~no tangential velocity to pick a tangent from, and in
  // an inside corner (pad1 SW, measured) the two faces' pure tangents each
  // point into the other wall and the heading just oscillated in place.
  const want = Math.atan2(tx + headOn * nx, tz + headOn * nz)
  P.heading += wrapPi(want - P.heading) * (1 - Math.exp(-(6 + 8 * headOn) * dt))
}

function reproject(s) {
  n.set(s.nx, s.ny, s.nz)
  P.vel.addScaledVector(n, -P.vel.dot(n))
  P.surfUp.copy(n)
  P.surfaceType = s.type
  P.inBowl = s.inBowl
  P.slope = s.slope
  P.surfCurv = s.curv || 0
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
  trick.fwdLatch = input.throttle > 0
  trick.grabbing = false // each air rolls a fresh grab style
  trick.bigAir = false
  trick.overPool = false
  if (!fromJump) {
    trick.spinTotal = 0
    trick.dogSpins = 0
    trick.grabTime = 0
  }
}

function doJump() {
  consumeJump()
  coyote = 0 // the jump spends the coyote window too, or it doubles
  const s = P.surfUp
  tmp.set(s.x * 0.4, s.y * 0.4 + 0.6, s.z * 0.4).normalize()
  P.vel.addScaledVector(tmp, JUMP_V)
  // Same redirect as rolling off the lip, so an ollie anywhere on a steep face
  // goes straight up and comes back down into it. Popping a hair BELOW the
  // coping otherwise took the untouched tangent and sailed onto the deck, which
  // is the one thing this whole change exists to stop.
  launchOffLip()
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
// How far inside the bowl's rim (x,z) is: <1 is over the hole. The gap bonus
// wants the deep middle (k 0.7) but must LAND clear of the rim (k 1), or an
// ordinary air out of the deep end and back in would pay it.
function poolK(x, z) {
  const dx = x - BOWL.cx
  const dz = z - BOWL.cz
  return Math.hypot(dx, dz) / bowlRadius(Math.atan2(dz, dx))
}

function stepAir(dt) {
  P.airTime += dt
  trick.air += dt
  if (!trick.overPool && poolK(P.pos.x, P.pos.z) < 0.7) trick.overPool = true
  if (!trick.bigAir && trick.air > BIG_AIR) {
    trick.bigAir = true
    emit('bigair', { pos: P.pos })
  }

  // No air throttle. It was 4.5 m/s^2 of free forward thrust with nothing
  // paying for it, and over a one-second vert air that is 4.8 m/s — more than
  // enough to cancel the drift back into the transition and put you on the deck
  // instead. The same reason there is no air steering: in the air the direction
  // keys are the trick, not the controls.

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

  // up-arrow grab: W/Up is throttle on the ground, so it only reads as a grab
  // on a FRESH press in the air — held through the pop it stays throttle.
  if (!input.throttle) trick.fwdLatch = false
  const wasGrabbing = trick.grabbing
  trick.grabbing = input.grab || (input.throttle > 0 && !trick.fwdLatch)
  // each FRESH grab rolls a new style, never the same one twice in a row
  if (trick.grabbing && !wasGrabbing) {
    const pool = GRAB_STYLES.filter((s) => s !== P.grabStyle)
    P.grabStyle = pool[(Math.random() * pool.length) | 0]
  }
  if (trick.grabbing) trick.grabTime += dt

  // Live trick tape. The name and its value used to appear only at landing, so
  // a 1.5s vert air read as nothing happening. Flushed every 0.1s (never
  // per-frame — that's a zustand set at 120fps) at the multiplier the landing
  // would pay. The points still BANK at landing: bail and you lose them, which
  // is the whole tension of a long air.
  trick.airFlush -= dt
  if (trick.airFlush <= 0) {
    trick.airFlush = 0.1
    const { name, pts } = airTrick()
    if (pts > 0) {
      const chain = trick.combo + 1 // award() increments before it multiplies
      const total = Math.round(pts * (1 + trick.combo * 0.5))
      useGame.getState().showTrick(chain > 1 ? `${name}  x${chain}` : name, total, true)
    }
  }

  P.vel.y -= G * dt

  const prevY = P.pos.y
  P.pos.addScaledVector(P.vel, dt)
  if (resolveCollision(P.pos, P.pos.y, RADIUS, push)) slideAlongWall(dt)

  // late jump off a ledge
  coyote -= dt
  if (coyote > 0 && input.jumpBuffer > 0) {
    P.surfUp.set(0, 1, 0)
    P.slope = 0 // jumping off nothing — don't let a stale lip angle redirect it
    doJump()
    return
  }

  if (tryGrind()) return

  // Same feetY as the resolveCollision above. A higher reference (prevY + 0.4)
  // opened a band where a solid was "not a wall" to the resolver but "a floor"
  // to the sampler — you passed through a planter's side face and got snapped
  // 0.38m up onto its top.
  sampleSurface(P.pos.x, P.pos.z, P.pos.y, surf)
  if (P.pos.y <= surf.y + 0.02 && P.vel.y <= 0) land(surf)
}

function land(s) {
  const impact = Math.max(0, -P.vel.y)
  P.pos.y = s.y
  reproject(s)
  // snap the rig upright-to-surface NOW: rotating 60deg over the next 0.1s
  // while pressed against a transition wall printed the body through it every
  // landing. The pop reads as the landing pose; crouch and dust mask it. The
  // clearance lift snaps with it — the analytic curvature is already known.
  P.up.copy(P.surfUp)
  P.surfLift = Math.min(0.16, P.surfCurv * 0.3)

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

  // Vert auto-turn: coming back down a transition still FACING the wall you
  // just aired off leaves the throttle fighting the roll-out, and the session
  // dies against one wall. Face the way you are actually moving; the offset
  // goes into spinResidual so the dog visibly swings through the 180 instead
  // of snapping. Flat ground is untouched — fakie stays a thing there.
  const vdotf = P.vel.x * Math.sin(P.heading) + P.vel.z * Math.cos(P.heading)
  if (s.slope > 0.35 && vdotf < -0.5) {
    const want = Math.atan2(P.vel.x, P.vel.z)
    spinResidual += wrapPi(P.heading - want)
    P.heading = want
  }

  // clean landing: square to your line (within ~20deg of a whole spin) and the
  // flip finished. P.vel is tangent after reproject, so scaling the whole
  // vector keeps it on the surface.
  if (trick.air > 0.3 && roll < 0.5 && Math.abs(spinResidual) < 0.35) {
    const sp = P.vel.length()
    const cap = MAX_SPEED * CLEAN_CAP
    if (sp > 0.5 && sp < cap) {
      const k = Math.min(cap / sp, 1 + CLEAN_BOOST + Math.min(0.08, trick.air * CLEAN_BOOST_AIR))
      P.vel.multiplyScalar(k)
    }
  }

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
  trick.grindShown = 0
  trick.grindFlush = 0
  // a grind is a trick: it joins the combo the moment you lock on, so its
  // points tick up at the multiplier the chain has already earned
  trick.comboTimer = CHAIN_GRACE
  trick.combo++
  useGame.getState().setCombo(trick.combo)
  emit('grind', { on: true, pos: P.pos })
  return true
}

function stepGrind(dt) {
  const rail = PATHS[P.grindRail]
  railAt(rail, P.grindS, railPos, railTan)

  // Along-rail component only. The full 3D magnitude turned a fall INTO rail
  // speed — dropping onto r6 at -9 m/s vertical shot you down the rail at 9.5.
  // Frames after entry agree with the old hypot, since P.vel is rewritten to
  // tangent * speed below.
  let speed = Math.abs(P.vel.dot(railTan))
  // gravity along the rail + drag
  speed += -G * railTan.y * P.grindDir * dt
  if (input.brake) speed -= BRAKE * 0.5 * dt
  speed /= 1 + GRIND_DRAG * dt
  speed = Math.min(speed, MAX_SPEED * 1.35)

  P.grindS += speed * P.grindDir * dt
  trick.grindTime += dt
  trick.grindBank += 42 * dt

  // live payout: flush whole multiplied points into the score every 0.15s.
  // Per-frame set() on the zustand store at 120fps is the thing to avoid;
  // GameUI's 1.1s clear timer stays ahead of this cadence so the popup holds.
  trick.grindFlush += dt
  if (trick.grindFlush >= 0.15) {
    trick.grindFlush = 0
    const mult = 1 + (trick.combo - 1) * 0.5
    const total = Math.round(trick.grindBank * mult)
    if (total > trick.grindShown) {
      const g = useGame.getState()
      g.addScore(total - trick.grindShown)
      trick.grindShown = total
      g.showTrick(trick.combo > 1 ? `Grind  x${trick.combo}` : 'Grind', total, true)
    }
  }

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

  // settle the live payout — the combo slot was claimed in tryGrind, so this
  // must NOT go through award() or the grind counts twice in the chain
  {
    const mult = 1 + (trick.combo - 1) * 0.5
    const total = Math.round(trick.grindBank * mult)
    const g = useGame.getState()
    if (total > trick.grindShown) g.addScore(total - trick.grindShown)
    if (total > 0) {
      const name = trick.grindTime > 1.6 ? 'Long Grind' : 'Grind'
      g.showTrick(trick.combo > 1 ? `${name}  x${trick.combo}` : name, total)
      emit('trick', { name, points: total })
    }
    trick.comboTimer = CHAIN_GRACE
  }
  trick.grindBank = 0
  trick.grindShown = 0

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
  // the live tape is showing points that just stopped being real — say so
  useGame.getState().showTrick('Bail!', 0)
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
// What the current air is worth SO FAR. Read live by stepAir for the trick tape
// and again by scoreAir at landing — one table, so the popup can never name a
// trick the landing doesn't pay for. Every term is monotonic in the air except
// Pool Gap, which is tested against the live position both times (over the hole
// it isn't earned yet, so it correctly doesn't show).
function airTrick() {
  const halves = Math.floor(trick.spinTotal / Math.PI + 0.15)
  let pts = 0
  let name = ''

  if (trick.dogSpins > 0) {
    pts += trick.dogSpins * 160
    name = trick.dogSpins > 1 ? `${trick.dogSpins}x Dogflip` : 'Dogflip'
  }
  if (halves > 0) {
    pts += halves * 110
    const deg = halves * 180
    name = name ? `${name} + ${deg}` : `${deg}`
  }
  if (trick.grabTime > 0.22) {
    pts += 80
    const g = GRAB_NAMES[P.grabStyle] || 'Grab'
    name = name ? `${name} + ${g}` : g
  }
  if (trick.bigAir) {
    // scales with hang time so a huge air pays more than a threshold graze
    pts += 100 + Math.round(trick.air * 60)
    name = name ? `${name} + Big Air` : 'Big Air'
  }
  // Pool gap: flew over the middle of the bowl and landed clear of the rim.
  // Pays like a Big Air because that's what it costs to clear a 12m hole.
  if (trick.overPool && poolK(P.pos.x, P.pos.z) > 1) {
    pts += 400
    name = name ? `${name} + Pool Gap` : 'Pool Gap'
  }
  if (!name && trick.air > 0.55) {
    name = 'Ollie'
    pts = 30 + Math.round(trick.air * 40)
  }
  return { name, pts }
}

function scoreAir() {
  const { name, pts } = airTrick()
  // A corner-cut can clear the pool without 1s hang time, so fire the shimmer
  // here if bigair never crossed the mid-air threshold.
  if (trick.overPool && !trick.bigAir && poolK(P.pos.x, P.pos.z) > 1) emit('bigair', { pos: P.pos })

  trick.spinTotal = 0
  trick.dogSpins = 0
  trick.grabTime = 0
  trick.air = 0
  trick.bigAir = false
  trick.overPool = false
  // pts can only be 0 here if the live tape never showed anything either —
  // except a Pool Gap flown and then landed back IN the bowl, which is why the
  // settle is unconditional.
  if (pts > 0) award(name, pts)
  else useGame.getState().settleTrick()
}

function award(name, pts) {
  trick.comboTimer = CHAIN_GRACE
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
const prevUp = new THREE.Vector3(0, 1, 0)

function updateAnim(dt) {
  // combo window — the clock only runs on the ground. Mid-air and mid-grind
  // you are still in a trick, so a long air or rail can't time the chain out
  // under you; you get 2.4s of rolling between links, however long each link is.
  if (trick.comboTimer > 0 && P.state === 'ground') {
    trick.comboTimer -= dt
    if (trick.comboTimer <= 0 && trick.combo !== 0) {
      trick.combo = 0
      useGame.getState().setCombo(0)
    }
  }

  P.speed = Math.hypot(P.vel.x, P.vel.z)

  // dog barrel roll eases toward its target
  P.dogRoll = damp(P.dogRoll, trick.dogTarget, 9, dt)
  const rolling = Math.abs(trick.dogTarget - P.dogRoll) > 0.12
  P.riderLift = damp(P.riderLift, rolling ? 1 : 0, 11, dt)
  P.grab = damp(P.grab, P.state === 'air' && trick.grabbing ? 1 : 0, 10, dt)
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
  // kickflip: while the dog is still rolling toward its target, the rider
  // reaches down at it (Rider's 'flip' pose) instead of the neutral air tuck
  else if (P.state === 'air') P.riderPose = trick.grabbing ? `grab_${P.grabStyle}` : rolling ? 'flip' : 'air'
  else if (P.crouch > 0.45) P.riderPose = 'land'
  else if (input.jumpHeld) P.riderPose = 'tuck'
  else P.riderPose = 'ride'

  // channels
  const speedN = Math.min(1, P.speed / MAX_SPEED)
  // lean tracks the carve rate, not the other way round — at GRIP 15 a damp of
  // 7 lagged a side-to-side reversal enough to read as the dog leaning out of
  // its own carve; 11 matched. GRIP is 19 now, so the lean keeps pace at 13.
  P.lean = damp(P.lean, P.state === 'ground' ? input.steer * speedN : 0, 13, dt)
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

  // The rendered dog is ~1.6m nose to tail (fitted length x the 1.22 group
  // scale): its straight body chord on the 2.6m quarter sags ~12cm below the
  // arc. Lift the rig along the normal by measured path curvature (turn of
  // surfUp per metre); flats and banks measure 0 and get none. Decay slowly
  // in the air so the launch off a lip keeps its clearance for a beat.
  // Gain/cap carry MARGIN over the geometric 12.3cm chord requirement: the
  // rise damp and the up damp below both lag a little, and at the top of the
  // quarter the wall is thin enough that "exactly flush" still prints through.
  // The analytic curvature from the sampler (quarters) is exact and instant;
  // the measured turn of surfUp per metre still covers the bowl, whose arcs
  // the colliders don't parameterise. Max of both, geometric 12.3cm + margin.
  let lift = 0
  if (P.state === 'ground') {
    let curv = P.surfCurv
    if (P.speed > 0.5) {
      const dot = THREE.MathUtils.clamp(P.surfUp.dot(prevUp), -1, 1)
      curv = Math.max(curv, Math.acos(dot) / Math.max(P.speed * dt, 1e-4))
    }
    lift = Math.min(0.16, curv * 0.3)
  }
  prevUp.copy(P.surfUp)
  P.surfLift = damp(P.surfLift, lift, lift > P.surfLift ? 25 : 4, dt)

  // Up tracking. A quarter turns the normal ~200deg/s at riding speed, and a
  // DAMP's steady-state lag scales with that rate — any lambda low enough to
  // hide crease pops left the tail lagged into the wall, printing out the
  // BACK face of the lip where a quarter is nearly zero thickness. So on the
  // ground the up tracks at a capped RATE instead: 12 rad/s follows the arc
  // losslessly (zero lag below ~690deg/s) and still spreads a crease's 60deg
  // one-frame jump over ~0.1s. Airborne keeps a slow damp so leaving a vert
  // lip doesn't sweep the tail through the wall on the way up.
  if (P.state === 'ground') {
    const ang = P.up.angleTo(P.surfUp)
    if (ang > 1e-4) P.up.lerp(P.surfUp, Math.min(1, (12 * dt) / ang))
  } else {
    // ramps in with airtime: stalling just under a lip flickers ground/air,
    // and easing toward world-up during a sub-0.1s flicker swung the body
    // straight through the wall it was still pressed against.
    const aLam = Math.min(7, P.airTime * 28)
    P.up.x = damp(P.up.x, UP.x, aLam, dt)
    P.up.y = damp(P.up.y, UP.y, aLam, dt)
    P.up.z = damp(P.up.z, UP.z, aLam, dt)
  }
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
