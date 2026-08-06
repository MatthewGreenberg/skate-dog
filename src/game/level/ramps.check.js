// Every ramp and stair has to be RIDEABLE: roll at its low end with speed and
// you end up on the deck it feeds. Two separate bugs made that false and both
// were invisible from a screenshot, so this drives the real controller.
//
//   1. resolveCollision tested a ramp by max(y0,y1), so the whole footprint was
//      a wall at plaza height — bank1 ejected a standing player 4.9m sideways
//      and nothing in the park could be climbed at all.
//   2. the lip snapped flat, reprojecting the climb away, so a quarter pipe
//      returned you to the deck at walking pace with no air.
//
// Run: node src/game/level/ramps.check.js

import assert from 'node:assert/strict'
import { SOLIDS } from './levelData.js'
import { resolveCollision, groundHeightAt } from './colliders.js'
import { P } from '../store.js'
import { input } from '../input.js'
import { updatePlayer, resetPlayer } from '../player/PlayerController.js'

const RAMPS = SOLIDS.filter((s) => s.kind !== 'box')
const ENTRY = 11 // m/s run-in; a 1.6m deck needs sqrt(2*22*1.6) = 8.4 to clear

/** How far a standing player at (x,z) gets ejected by the collision solver. */
function ejection(x, z, feetY) {
  const p = { x, z }
  resolveCollision(p, feetY, 0.5)
  return Math.hypot(p.x - x, p.z - z)
}

/**
 * The clearest lane onto a ramp: 0.6m short of its low edge, and low enough to
 * be the bottom rather than the deck. Ramps do not all use their full width —
 * bank4's west half is buried in pad1 — so this scans across and takes the lane
 * with the least obstruction rather than assuming the centreline is rideable.
 */
function entryPoint(s) {
  const ux = Math.sin(s.rot) // uphill
  const uz = Math.cos(s.rot)
  const lead = s.d / 2 + 0.6
  let best = null
  // centre lane first: a tie on clearance should not put the run-in half off
  // the side of the ramp, where the walls flanking the top are still in the way
  for (const i of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const off = (i / 9) * s.w
    const x = s.x - ux * lead + uz * off
    const z = s.z - uz * lead - ux * off
    if (groundHeightAt(x, z) > s.y0 + 0.3) continue
    const e = { x, z, ux, uz, push: ejection(x, z, s.y0) }
    if (!best || e.push < best.push) best = e
  }
  if (!best) throw new Error(`${s.id}: no approach lane starts at the bottom`)
  return best
}

for (const s of RAMPS) {
  const e = entryPoint(s)

  // 1. there has to be SOME way to stand at the bottom of it. Before the
  //    collider fix every lane on every ramp failed this by metres.
  assert(e.push < 0.05, `${s.id}: no lane at the low end is clear — best still ejects ${e.push.toFixed(2)}m`)

  // 2. ride it
  resetPlayer()
  input.steer = 0
  input.throttle = 1
  P.pos.set(e.x, groundHeightAt(e.x, e.z), e.z)
  P.heading = s.rot
  P.vel.set(e.ux * ENTRY, 0, e.uz * ENTRY)

  let peak = P.pos.y
  for (let i = 0; i < 150; i++) {
    updatePlayer(1 / 60)
    peak = Math.max(peak, P.pos.y)
  }
  assert(peak > s.y1 - 0.05, `${s.id}: rode in at ${ENTRY}m/s and only reached ${peak.toFixed(2)} of ${s.y1}`)
}

// A descent is not just geometry-following: with no throttle, gravity must
// leave the rider faster at the low edge. Use a quick entry speed so this also
// catches flat-strength rolling drag masking the gain on a steep transition.
{
  const s = SOLIDS.find((r) => r.id === 'hpN')
  const ux = Math.sin(s.rot), uz = Math.cos(s.rot)
  const entry = 10
  resetPlayer()
  input.steer = 0
  input.throttle = 0
  input.brake = false
  input.reverse = false
  P.pos.set(s.x + ux * (s.d / 2 - 0.08), 0, s.z + uz * (s.d / 2 - 0.08))
  P.pos.y = groundHeightAt(P.pos.x, P.pos.z)
  P.heading = s.rot + Math.PI
  P.vel.set(-ux * entry, 0, -uz * entry)

  let bottom = null
  for (let i = 0; i < 240 && bottom === null; i++) {
    updatePlayer(1 / 120)
    if (P.pos.y <= s.y0 + 0.03) bottom = P.speed
  }
  assert(bottom !== null, 'gravity coast never reached the halfpipe flat')
  assert(bottom > entry + 1, `halfpipe descent should gain speed from gravity (${entry.toFixed(2)} -> ${bottom.toFixed(2)})`)
}

// A quarter pipe is a launcher, not a staircase. Hitting the lip must throw you
// above the coping and drop you BACK INTO the transition — riding the tangent
// out put you on the deck at walking pace, every time. Popping at the lip does
// the same thing, higher; the press used to be swallowed entirely.
const qp = RAMPS.find((s) => s.curve === 'quarter' && s.y1 > 1)

function hitTheLip(s, speed, ollie) {
  const e = entryPoint(s)
  resetPlayer()
  input.steer = 0
  input.throttle = 1
  input.jumpBuffer = 0
  P.pos.set(e.x, groundHeightAt(e.x, e.z), e.z)
  P.heading = s.rot
  P.vel.set(e.ux * speed, 0, e.uz * speed)

  const r = { peak: P.pos.y, air: 0, landY: null }
  let flew = false
  for (let i = 0; i < 200; i++) {
    // a player mashing space as the coping comes up
    if (ollie && P.state === 'ground' && P.pos.y > s.y1 - 0.25) input.jumpBuffer = 0.14
    updatePlayer(1 / 60)
    r.peak = Math.max(r.peak, P.pos.y)
    if (P.state === 'air') {
      r.air += 1 / 60
      flew = true
    } else if (flew && r.landY === null) r.landY = P.pos.y
  }
  input.jumpBuffer = 0
  return r
}

for (const speed of [8, 12]) {
  const roll = hitTheLip(qp, speed, false)
  const pop = hitTheLip(qp, speed, true)

  for (const [what, r] of [['rolled', roll], ['popped', pop]]) {
    assert(r.air > 0.3, `${qp.id} @${speed}: ${what} the lip and got ${r.air.toFixed(2)}s of air`)
    assert(r.peak > qp.y1 + 0.3, `${qp.id} @${speed}: ${what} to ${r.peak.toFixed(2)}, barely over the ${qp.y1} coping`)
    assert(r.landY !== null, `${qp.id} @${speed}: ${what} and never came back down`)
    // the whole point: straight up and straight back in, not out onto the deck
    assert(
      r.landY < qp.y1 - 0.05,
      `${qp.id} @${speed}: ${what} and came down on the deck at ${r.landY.toFixed(2)}, not in the transition`,
    )
  }
  assert(
    pop.peak > roll.peak + 1,
    `${qp.id} @${speed}: popping got ${pop.peak.toFixed(2)} vs ${roll.peak.toFixed(2)} just rolling — the ollie is being eaten`,
  )
}

// An EARLY pop, low on the transition, is the deliberate deck transfer: the
// local slope is shallow there, so launchOffLip's redirect barely touches the
// forward carry. Late pops and rolled lips go straight up and back in (above).
// This is a gradient, not a mode switch — guard both ends of it.
{
  const e = entryPoint(qp)
  resetPlayer()
  input.steer = 0
  input.throttle = 1
  P.pos.set(e.x, groundHeightAt(e.x, e.z), e.z)
  P.heading = qp.rot
  P.vel.set(e.ux * 8, 0, e.uz * 8)

  let jumped = null
  let landed = null
  for (let i = 0; i < 300 && !landed; i++) {
    if (!jumped && P.state === 'ground' && P.pos.y > 0.2) {
      input.jumpBuffer = 0.14
      jumped = { x: P.pos.x, z: P.pos.z }
    }
    updatePlayer(1 / 60)
    if (jumped && P.state === 'ground' && P.airTime === 0 && P.groundTime > 0.05) landed = { y: P.pos.y }
  }
  input.jumpBuffer = 0
  assert(landed, `${qp.id}: early pop never landed`)
  const fwd = (P.pos.x - jumped.x) * e.ux + (P.pos.z - jumped.z) * e.uz
  assert(
    landed.y > qp.y1 - 0.05,
    `${qp.id}: early pop landed at ${landed.y.toFixed(2)}, not on the ${qp.y1} deck`,
  )
  assert(fwd > 1.5, `${qp.id}: early pop only carried ${fwd.toFixed(2)}m forward — the deck transfer is gone`)
}

// ...and a MID-transition pop is inside the forgiving up-and-back window
// (VERT_HI 0.9): straight up, straight back into the tranny, no deck transfer.
{
  const e = entryPoint(qp)
  resetPlayer()
  input.steer = 0
  input.throttle = 1
  P.pos.set(e.x, groundHeightAt(e.x, e.z), e.z)
  P.heading = qp.rot
  P.vel.set(e.ux * 8, 0, e.uz * 8)

  let jumped = null
  let landed = null
  for (let i = 0; i < 300 && !landed; i++) {
    // 0.8: with the arc-length origin fixed the quarter is steeper at a given
    // height, so the deck-transfer / up-and-back boundary moved up from ~0.65
    if (!jumped && P.state === 'ground' && P.pos.y > 0.8) {
      input.jumpBuffer = 0.14
      jumped = { x: P.pos.x, z: P.pos.z }
    }
    updatePlayer(1 / 60)
    if (jumped && P.state === 'ground' && P.airTime === 0 && P.groundTime > 0.05) landed = { y: P.pos.y }
  }
  input.jumpBuffer = 0
  assert(landed, `${qp.id}: mid pop never landed`)
  assert(
    landed.y < qp.y1 - 0.05,
    `${qp.id}: mid pop landed at ${landed.y.toFixed(2)} — on the deck, not back in the transition`,
  )
}

// The halfpipe must PUMP: hold throttle and the vert auto-turn (land facing
// your roll-out, not the wall you just left) plus the clean-landing boost keep
// the session alive wall-to-wall. Before the auto-turn this died against one
// wall — the throttle fought the backward roll every landing.
{
  const hpN = SOLIDS.find((s) => s.id === 'hpN')
  const hpS = SOLIDS.find((s) => s.id === 'hpS')
  resetPlayer()
  input.steer = 0
  input.throttle = 1
  P.pos.set(hpN.x, hpN.y0, (hpN.z + hpS.z) / 2)
  P.heading = Math.PI
  P.vel.set(0, 0, -6)
  let airs = 0
  let wasAir = false
  let minZ = 99
  let maxZ = -99
  let bailed = false
  for (let i = 0; i < 720; i++) {
    updatePlayer(1 / 60)
    if (P.state === 'bail') bailed = true
    if (P.state === 'air' && !wasAir) airs++
    wasAir = P.state === 'air'
    minZ = Math.min(minZ, P.pos.z)
    maxZ = Math.max(maxZ, P.pos.z)
  }
  assert(!bailed, 'halfpipe session bailed')
  assert(airs >= 4, `halfpipe only aired ${airs} times in 12s — the pump loop is dead`)
  assert(
    minZ < hpN.z + hpN.d / 2 && maxZ > hpS.z - hpS.d / 2,
    `halfpipe session stuck at one wall (z ${minZ.toFixed(1)}..${maxZ.toFixed(1)}) — vert auto-turn is gone`,
  )
}

// Enter the pipe crooked and hands-off, and it must keep you IN it: a few
// degrees of heading error is metres of sideways drift by the lip, and you left
// out the side instead of over the coping. The assist (fall line + PIPE_HOLD
// across the flat) bounds it.
{
  const hpN = SOLIDS.find((s) => s.id === 'hpN')
  const hpS = SOLIDS.find((s) => s.id === 'hpS')
  resetPlayer()
  input.steer = 0
  input.throttle = 1
  const a = Math.PI + (40 * Math.PI) / 180 // 40deg off square
  P.pos.set(hpN.x, hpN.y0, (hpN.z + hpS.z) / 2)
  P.heading = a
  P.vel.set(Math.sin(a) * 6, 0, Math.cos(a) * 6)
  let drift = 0
  let airs = 0
  let wasAir = false
  for (let i = 0; i < 720; i++) {
    updatePlayer(1 / 60)
    drift = Math.max(drift, Math.abs(P.pos.x - hpN.x))
    if (P.state === 'air' && !wasAir) airs++
    wasAir = P.state === 'air'
  }
  assert(drift < hpN.w / 2 - 1, `a 40deg entry drifted ${drift.toFixed(1)}m sideways of the ${hpN.w / 2}m half-width`)
  assert(airs >= 4, `crooked entry only aired ${airs} times in 12s`)
}

// The vert auto-turn must not undo a 180 you MEANT. Land on the north wall
// already facing the roll-out (downhill, +z) while the velocity is still
// carrying up the wall: the old velocity-only test read that as fakie and spun
// you back into the wall.
{
  const hpN = SOLIDS.find((s) => s.id === 'hpN')
  const z = hpN.z - 0.6 // partway up the transition
  resetPlayer()
  input.throttle = 0
  input.steer = 0
  P.pos.set(hpN.x, groundHeightAt(hpN.x, z) + 0.05, z)
  P.state = 'air'
  P.heading = 0 // +z, out of the wall — the correct roll-out facing
  P.vel.set(0, -3, -4) // still travelling up the wall as it touches down
  updatePlayer(1 / 60)
  const off = Math.abs(Math.atan2(Math.sin(P.heading), Math.cos(P.heading)))
  assert(off < 0.6, `landing a deliberate 180 got auto-turned ${((off * 180) / Math.PI).toFixed(0)}deg back into the wall`)
}

input.throttle = 0
console.log(`ramps ok (${RAMPS.length} rideable)`)
