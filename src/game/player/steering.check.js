// Self-check for the one thing about steering that is easy to get backwards.
// Run: node src/game/player/steering.check.js

import assert from 'node:assert/strict'
import { P } from '../store.js'
import { input } from '../input.js'
import { updatePlayer, resetPlayer } from './PlayerController.js'
import { applyCharacterSizes, characterSize } from '../components/dogFit.js'

// Travel direction for a heading, and the dog's own right-hand direction:
// in a Y-up right-handed frame, right = forward x up.
const fwd = (h) => [Math.sin(h), Math.cos(h)]
const right = (h) => [-Math.cos(h), Math.sin(h)]

/** Signed amount the heading turned toward the dog's right over the run. */
function turn(steer) {
  resetPlayer()
  input.steer = steer
  input.throttle = 0
  const h0 = P.heading
  for (let i = 0; i < 12; i++) updatePlayer(1 / 60)
  const [fx, fz] = fwd(P.heading)
  const [rx, rz] = right(h0)
  return fx * rx + fz * rz
}

assert(turn(1) > 0.01, 'steering right must turn the dog toward its right')
assert(turn(-1) < -0.01, 'steering left must turn the dog toward its left')

// Tightness floor. TURN_LOW 4.7 over these 0.2s is 0.94 rad of heading, which
// projects to sin(0.94) = 0.81 on the right axis — assert well below that so
// only a real regression toward mush (sub ~3.2 rad/s) fails, not a retune.
assert(turn(1) > 0.6, `low-speed carve went soft: ${turn(1).toFixed(2)} on the right axis, want > 0.6`)

// Pace is measured in dog-lengths per second: resizing the dog must scale its
// world-space acceleration instead of making the larger character feel slow.
const originalSize = characterSize()
function speedAtSize(dog) {
  applyCharacterSizes(dog, originalSize.boy)
  resetPlayer()
  input.steer = 0
  input.throttle = 1
  input.brake = false
  input.reverse = false
  for (let i = 0; i < 30; i++) updatePlayer(1 / 60)
  return P.speed
}
const smallDogSpeed = speedAtSize(0.95)
const bigDogSpeed = speedAtSize(2.2)
applyCharacterSizes(originalSize.dog, originalSize.boy)
input.throttle = 0
assert(
  bigDogSpeed > smallDogSpeed * 2,
  `large dog must move proportionally faster (${smallDogSpeed.toFixed(2)} vs ${bigDogSpeed.toFixed(2)})`,
)

// the visual lean has to agree with the turn or the dog leans out of its carve
resetPlayer()
input.steer = 1
P.vel.set(0, 0, 5)
for (let i = 0; i < 12; i++) updatePlayer(1 / 60)
assert(P.lean > 0, 'steering right must lean right (Dog rolls +z for +lean)')

// Weight shift: flipping out of a carve has to turn harder than starting the
// same carve from flat, or the reversal is just an ordinary turn with a name.
// Both runs steer left at the same speed; only the lean being unloaded differs.
function leftTurnAfter(setupSteer) {
  resetPlayer()
  input.throttle = 0
  input.steer = setupSteer
  P.vel.set(0, 0, 8)
  for (let i = 0; i < 12; i++) updatePlayer(1 / 60) // build (or don't build) lean
  input.steer = -1
  const h0 = P.heading
  for (let i = 0; i < 6; i++) updatePlayer(1 / 60)
  return P.heading - h0
}

const flipped = leftTurnAfter(1)
const flat = leftTurnAfter(0)
assert(flipped > flat * 1.15, `reversing out of a carve must whip (${flipped} vs ${flat})`)

// Clean landing pays momentum forward: a straight flat-ground ollie, landed
// square, must come down FASTER than it took off. This is the pump loop — if
// it fails, the CLEAN_BOOST branch in land() is gone or gated wrong.
resetPlayer()
input.steer = 0
input.throttle = 0
P.vel.set(0, 0, 8)
updatePlayer(1 / 60)
const spBefore = Math.hypot(P.vel.x, P.vel.z)
input.jumpBuffer = 0.14
let airborne = false
for (let i = 0; i < 200 && !(airborne && P.state === 'ground'); i++) {
  updatePlayer(1 / 60)
  if (P.state === 'air') airborne = true
}
input.jumpBuffer = 0
assert(airborne, 'the ollie never left the ground')
const spAfter = Math.hypot(P.vel.x, P.vel.z)
assert(
  spAfter > spBefore * 1.04,
  `clean landing must pay momentum: ${spBefore.toFixed(2)} in, ${spAfter.toFixed(2)} out`,
)

input.steer = 0
console.log('steering ok')
