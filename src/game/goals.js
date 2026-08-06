import { P, useGame, on, emit, activeGoalIds, goalTimeBonus } from './store.js'
import { CANS } from './level/levelData.js'

/**
 * The run's challenge list — the THPS goal card.
 *
 * Every goal here is detected from an event the controller ALREADY emits. That
 * is the whole design constraint: no goal owns a timer, a collider or a probe
 * of its own, because a second measurement of "was that a long grind" would
 * drift from the one the scorer uses and the card would disagree with the tape.
 * The two score tiers are the only exception and they poll, cheaply.
 *
 * `test(payload)` runs on the named event and returns truthy to complete.
 * A goal with no `on` is completed imperatively via complete(id) — that is the
 * three collectible objectives, which own their own proximity tests.
 */
export const GOALS = [
  {
    id: 'fetch',
    label: 'Fetch!',
    hint: 'collect all 5 bones',
    pts: 1000,
    on: 'bone',
    test: (p) => p.big,
  },
  {
    id: 'pool',
    label: 'Pool Party',
    hint: 'fly the bowl',
    pts: 750,
    on: 'trick',
    // the trick NAME, not P.inBowl — inBowl is a surface flag and reads false
    // the entire time you are airborne over the hole
    test: (p) => /Pool Gap/.test(p.name),
  },
  {
    id: 'rail',
    label: 'Rail Hound',
    hint: 'hold a long grind',
    pts: 500,
    on: 'trick',
    // PlayerController names a grind past 1.6s 'Long Grind' — reuse its clock
    test: (p) => p.name === 'Long Grind',
  },
  {
    id: 'air',
    label: 'Off the Leash',
    hint: 'a full second of air',
    pts: 500,
    on: 'bigair',
    test: () => true,
  },
  { id: 'good', label: 'Good Dog', hint: '10,000 points', pts: 500, score: 10000 },
  { id: 'best', label: 'Best in Show', hint: '25,000 points', pts: 1000, score: 25000 },
  { id: 'spell', label: 'D–O–G', hint: 'collect the three letters', pts: 1000 },
  { id: 'cans', label: 'Trash Panda', hint: 'smash all five cans', pts: 750 },
]

const done = new Set()

/** The level may narrow the shipped goal card. Return display-ready copies so
 * the can objective always names the actual number present in this level. */
export function activeGoals() {
  const ids = activeGoalIds()
  return GOALS
    .filter((g) => !ids || ids.includes(g.id))
    .map((g) => g.id === 'cans' ? { ...g, hint: `smash all ${CANS.length} cans` } : g)
}

/**
 * Pay out a challenge. Idempotent — every caller is an event handler that can
 * legitimately fire again (a second Pool Gap is still a Pool Gap), so the guard
 * lives here rather than in ten call sites.
 */
export function complete(id) {
  if (done.has(id)) return false
  const g = activeGoals().find((goal) => goal.id === id)
  if (!g) return false
  done.add(id)
  const s = useGame.getState()
  s.addScore(g.pts)
  s.addTime(goalTimeBonus())
  s.markGoal(id)
  s.showTrick(g.label.toUpperCase(), g.pts)
  emit('goal', { pos: P.pos, id })
  return true
}

export function goalDone(id) {
  return done.has(id)
}

let offs = []
/** Subscribe the event-driven goals. Safe to call twice — it unsubscribes first. */
export function initGoals() {
  for (const off of offs) off()
  offs = activeGoals().filter((g) => g.on).map((g) => on(g.on, (p) => g.test(p) && complete(g.id)))
  return () => {
    for (const off of offs) off()
    offs = []
  }
}

// The score tiers are the only goals that aren't edge-triggered, so they poll.
// 4Hz: the smallest trick is 30 points and the clock is 120s, so nothing can
// cross a 10k threshold and be un-crossed inside a quarter second.
const POLL = 0.25
let pollT = 0

export function tickGoals(dt) {
  pollT -= dt
  if (pollT > 0) return
  pollT = POLL
  const score = useGame.getState().score
  for (const g of activeGoals()) if (g.score && score >= g.score) complete(g.id)
}

export function resetGoals() {
  done.clear()
  pollT = 0
}
