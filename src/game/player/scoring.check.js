// Self-check for the scoring rework: a grind pays the score LIVE while it
// runs, joins the combo when it locks on, and a chained grind pays at the
// chain's multiplier. Run: node src/game/player/scoring.check.js

import assert from 'node:assert/strict'
import { P, useGame } from '../store.js'
import { input } from '../input.js'
import { updatePlayer, resetPlayer } from './PlayerController.js'

const DT = 1 / 60

// Drop onto r1 (flat, y 0.58, runs +X at z=-4) and ride it for `hold` seconds.
// Returns the score gained during the hold — NOT counting the exit settle.
function grindFor(hold) {
  P.pos.set(3, 0.9, -4)
  P.vel.set(6, -1, 0)
  P.heading = Math.PI / 2
  P.state = 'ground'
  P.grounded = false
  P.state = 'air'
  for (let i = 0; i < 60 && P.state !== 'grind'; i++) updatePlayer(DT)
  assert.equal(P.state, 'grind', 'never locked onto r1')
  const s0 = useGame.getState().score
  for (let t = 0; t < hold && P.state === 'grind'; t += DT) updatePlayer(DT)
  assert.equal(P.state, 'grind', 'fell off r1 before the hold ended')
  return useGame.getState().score - s0
}

input.steer = 0
input.throttle = 0
resetPlayer()
useGame.setState({ score: 0, combo: 0 })

// 1. the score counts up DURING the grind, at ~42 pts/s on a fresh combo
const solo = grindFor(1.0)
assert(solo > 0, 'grinding must tick the score up while still on the rail')
assert(
  solo > 30 && solo < 55,
  `fresh grind should pay ~42/s live, paid ${solo} in 1s`,
)
assert.equal(useGame.getState().combo, 1, 'locking a grind must open the combo')

// 2. ride off the end, land, and LINK straight into another grind: the second
// link is combo x2 and must pay ~1.5x the fresh rate per second
for (let i = 0; i < 300 && P.state !== 'ground'; i++) updatePlayer(DT)
assert.equal(P.state, 'ground', 'never landed after the first grind')
for (let i = 0; i < 20; i++) updatePlayer(DT) // 0.33s: clears grindLock, inside CHAIN_GRACE
assert.equal(useGame.getState().combo, 1, 'chain dropped during an immediate link')
const chained = grindFor(1.0)
assert(
  chained > solo * 1.3,
  `chained grind must pay the multiplier: ${solo}/s fresh vs ${chained}/s at x2`,
)
assert.equal(useGame.getState().combo, 2, 'second grind must extend the chain')

// 3. grind -> hop -> re-grind without touching ground is the canonical chain:
// the combo must step again and never drop mid-hop
input.jumpBuffer = 0.14
let sawAir = false
for (let i = 0; i < 120 && !(sawAir && P.state === 'grind'); i++) {
  updatePlayer(DT)
  if (P.state === 'air') sawAir = true
  assert(P.state !== 'ground', 'the hop between grinds must not touch ground')
}
input.jumpBuffer = 0
assert(sawAir && P.state === 'grind', 'never re-locked the rail after the hop')
assert.equal(useGame.getState().combo, 3, 'grind-hop-grind must step the multiplier')

// 4. the multiplier is for CHAINS, not landed tricks in a row: cruising on the
// ground past CHAIN_GRACE must drop the combo, so the next trick starts at x1
for (let i = 0; i < 300 && P.state !== 'ground'; i++) updatePlayer(DT)
for (let i = 0; i < 72; i++) updatePlayer(DT) // 1.2s of plain rolling
assert.equal(useGame.getState().combo, 0, 'rolling between tricks must end the chain')

// 5. pool gap: fly across the bowl and land clear of the rim, vs the same air
// dropped INTO the bowl — only the first pays. Bowl is r~5.85 at (-15, -4).
function flyAcross(vx, vy, from = [-9, 0.3, -1]) {
  resetPlayer()
  useGame.setState({ score: 0, combo: 0 })
  P.pos.set(...from)
  P.vel.set(vx, vy, 0)
  P.heading = -Math.PI / 2
  P.state = 'air'
  P.grounded = false
  let banner = ''
  const un = useGame.subscribe((s) => {
    if (s.trickText) banner = s.trickText
  })
  for (let i = 0; i < 400 && P.state === 'air'; i++) updatePlayer(DT)
  un()
  assert.notEqual(P.state, 'air', 'never came down')
  return banner
}

assert.match(flyAcross(-14, 8.5), /Pool Gap/, 'clearing the bowl must pay a gap bonus')
assert.doesNotMatch(flyAcross(-6, 3), /Pool Gap/, 'dropping INTO the bowl is not a gap')
// ...and neither is popping out of the bowl you were already in: the air starts
// at k<0.7, so without the leftPool arming an ollie off the flat bottom paid it.
assert.doesNotMatch(
  flyAcross(15, 11, [-15, -1.5, -4]), // out of the deep end, lands k~1.9 clear
  /Pool Gap/,
  'jumping out of the bowl is not a gap — the line has to cross the hole',
)

console.log('scoring ok')
