// The goal card pays out exactly once per challenge, and every payout is worth
// its points AND its seconds. Both halves have bitten before in other codebases
// for the same reason: the handlers are subscribed to events that legitimately
// repeat (a second Pool Gap is still a Pool Gap), so the idempotence guard is
// the only thing between one challenge and an infinite time machine.
import { useGame, emit, P, TIME_BONUS, RUN_TIME } from './store.js'
import { GOALS, initGoals, tickGoals, resetGoals, complete, goalDone } from './goals.js'

function assert(ok, msg) {
  if (!ok) throw new Error(msg)
}

const state = () => useGame.getState()
const fresh = () => {
  resetGoals()
  P.timeLeft = RUN_TIME
  useGame.setState({ score: 0, timeLeft: RUN_TIME, goalsDone: [], trickText: '', trickPoints: 0 })
}

initGoals()

// ---------------------------------------------------- 1. every goal is payable
fresh()
for (const g of GOALS) {
  const score0 = state().score
  const time0 = P.timeLeft
  assert(complete(g.id), `${g.id}: complete() refused a fresh goal`)
  assert(goalDone(g.id), `${g.id}: not marked done`)
  assert(state().score === score0 + g.pts, `${g.id}: paid ${state().score - score0}, want ${g.pts}`)
  assert(P.timeLeft === time0 + TIME_BONUS, `${g.id}: added ${P.timeLeft - time0}s, want ${TIME_BONUS}`)
  // a second call is free
  assert(!complete(g.id), `${g.id}: paid out TWICE`)
  assert(state().score === score0 + g.pts, `${g.id}: a repeat call moved the score`)
}
assert(state().goalsDone.length === GOALS.length, 'goalsDone did not collect every id')

// ---------------------------------------------------- 2. reset re-arms them all
fresh()
for (const g of GOALS) assert(!goalDone(g.id), `${g.id}: still done after resetGoals()`)

// ---------------------------------------------------- 3. the event predicates
// Each event-driven goal must fire on its own payload and stay quiet on the
// others' — 'trick' carries three different goals and they discriminate on a
// substring, which is exactly the kind of thing that silently over-matches.
const EVENTS = [
  ['bone', { pos: P.pos, big: true }, 'fetch'],
  ['bone', { pos: P.pos, big: false }, null],
  ['trick', { name: 'Pool Gap', points: 400 }, 'pool'],
  ['trick', { name: 'Long Grind', points: 300 }, 'rail'],
  ['trick', { name: '2x Dogflip + 360', points: 500 }, null],
  ['bigair', { pos: P.pos }, 'air'],
  ['trick', { name: 'Grind', points: 90 }, null],
  ['trick', { name: 'Ollie', points: 45 }, null],
]
for (const [ev, payload, want] of EVENTS) {
  fresh()
  emit(ev, payload)
  const got = state().goalsDone
  if (want) assert(got.length === 1 && got[0] === want, `${ev} ${JSON.stringify(payload)}: fired ${got} want [${want}]`)
  else assert(got.length === 0, `${ev} ${JSON.stringify(payload)}: fired ${got}, want nothing`)
}

// ---------------------------------------------------- 4. score tiers
// They poll, so they need a tick — and they must not fire below the threshold
// no matter how many ticks go by.
fresh()
useGame.setState({ score: 9999 })
for (let i = 0; i < 20; i++) tickGoals(0.1)
assert(!goalDone('good'), 'Good Dog fired at 9,999')
useGame.setState({ score: 10000 })
tickGoals(0.3)
assert(goalDone('good'), 'Good Dog did not fire at 10,000')
assert(!goalDone('best'), 'Best in Show fired at 10,000')
// crossing both at once still pays both, once each
fresh()
useGame.setState({ score: 40000 })
tickGoals(0.3)
assert(goalDone('good') && goalDone('best'), 'a 40,000 jump skipped a tier')
assert(state().score === 40000 + 500 + 1000, `both tiers paid ${state().score - 40000}, want 1500`)

console.log(`goals ok — ${GOALS.length} challenges, each pays once for +${TIME_BONUS}s, predicates discriminate`)
