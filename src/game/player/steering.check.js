// Self-check for the one thing about steering that is easy to get backwards.
// Run: node src/game/player/steering.check.js

import assert from 'node:assert/strict'
import { P } from '../store.js'
import { input } from '../input.js'
import { updatePlayer, resetPlayer } from './PlayerController.js'

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

// the visual lean has to agree with the turn or the dog leans out of its carve
resetPlayer()
input.steer = 1
P.vel.set(0, 0, 5)
for (let i = 0; i < 12; i++) updatePlayer(1 / 60)
assert(P.lean > 0, 'steering right must lean right (Dog rolls +z for +lean)')

input.steer = 0
console.log('steering ok')
