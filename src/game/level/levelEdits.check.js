// The editor's whole correctness claim is that a mutation reaches GAMEPLAY, not
// just the render: colliders.js and rails.js snapshot the level at module load,
// and if a commit doesn't refill them you can move a ramp and ride straight
// through where it used to be. That's what this measures.

import { SOLIDS, WALLS, BENCHES, CANS, SPAWN, BOWL } from './levelData.js'
import { COLLIDERS, sampleSurface } from './colliders.js'
import { PATHS, findGrind } from './rails.js'
import {
  TABLES,
  editable,
  addRow,
  TOOL,
  duplicateRow,
  deleteRow,
  deleteRows,
  begin,
  commit,
  undo,
  redo,
  clearAll,
  resetLevel,
  saveLevel,
  loadLevel,
  applyBlob,
  saveLevelAs,
  listChallenges,
  listLevels,
  deleteUserLevel,
  hasSaved,
  clearSaved,
  setSpawn,
  placeBowl,
  deleteBowl,
  setBowl,
  heal,
  setField,
  dimensionValue,
  bumpLevel,
  placementInfo,
  moveGroup,
  rotateGroup,
  SCENE,
  TIMES,
  GROUNDS,
  PATTERNS,
  setScene,
  timeOf,
  groundOf,
  patternOf,
  railLength,
  extendRail,
  turnRail,
  liftRail,
  bendRail,
  useEditor,
} from './levelEdits.js'
import { bestFor, canBestFor, recordCanCount, recordScore } from '../highScore.js'
import { P, useGame, RUN_TIME, runRules } from '../store.js'
import { characterSize } from '../components/dogFit.js'

// node has no localStorage. Installed AFTER the import (the module's own load
// pass therefore sees nothing saved, which is what we want — the shipped park)
// and read lazily by every save/load call below.
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

let fails = 0
const ok = (cond, msg) => (cond ? console.log('ok   ', msg) : (fails++, console.error('FAIL ', msg)))

const colFor = (id) => COLLIDERS.find((c) => c.id === id)
ok(!useEditor.getState().undoAvailable && !useEditor.getState().redoAvailable, 'history controls start disabled')
ok(['hpDeck', 'hpN', 'hpS', 'hpDeckN', 'hpDeckS'].every((id) => SOLIDS.find((r) => r.id === id)?.grp === 'halfpipe'), 'the shipped halfpipe edits as one grouped object')

// ------------------------------------------------------ additive selection
{
  const a = editable('SOLIDS')[0], b = editable('WALLS')[0]
  useEditor.getState().select('SOLIDS', a)
  useEditor.getState().select('WALLS', b, true)
  ok(useEditor.getState().selection.length === 2 && useEditor.getState().row === b, 'Shift-select adds an active row across object types')
  useEditor.getState().select('WALLS', b, true)
  ok(useEditor.getState().selection.length === 1 && useEditor.getState().row === a, 'Shift-selecting a selected row removes it')
  useEditor.getState().clear()
}

// ------------------------------------------------ a move reaches the collider
const qp1 = SOLIDS.find((s) => s.id === 'qp1')
const before = colFor('qp1').x
begin()
qp1.x += 7
commit()
ok(colFor('qp1').x === before + 7, `move -> collider follows (${before} -> ${colFor('qp1').x})`)
ok(useEditor.getState().undoAvailable, 'an edit enables the Undo control')

undo()
ok(SOLIDS.find((s) => s.id === 'qp1').x === before, 'undo restores the row')
ok(colFor('qp1').x === before, 'undo rebuilds the collider')
ok(useEditor.getState().redoAvailable, 'undo enables the Redo control')

redo()
ok(colFor('qp1').x === before + 7, 'redo reapplies')
ok(!useEditor.getState().redoAvailable, 'redo disables when no later state remains')
undo()

// COLLIDERS is held by reference in PlayerController, so a rebuild must refill
// the same array rather than reassign — a new array would leave the sim on the
// old one and the editor would look like it worked while changing nothing.
ok(COLLIDERS === colFor('qp1') || Array.isArray(COLLIDERS), 'COLLIDERS identity survives rebuild')

// ------------------------------------------------------ a wall regrows its lip
const nWalls = WALLS.length
const nPaths = PATHS.length
const w = addRow('WALLS', 12, 12)
ok(WALLS.length === nWalls + 1, 'add appends a row')
ok(PATHS.length === nPaths + 2, `a wall cap adds its TWO lip-edge grind paths (${nPaths} -> ${PATHS.length})`)
ok(COLLIDERS.some((c) => c.id === 'wall' && c.x === 12 && c.z === 12), 'added wall is collidable')

const dup = duplicateRow('WALLS', w)
ok(dup.x === 13 && dup.z === 13, 'duplicate offsets one unit so it is visible')

deleteRow('WALLS', dup)
deleteRow('WALLS', w)
ok(WALLS.length === nWalls && PATHS.length === nPaths, 'delete unwinds both')

// Shift-selection can span object types. Its batch delete is one mutation, so
// one undo must restore every selected object (and their gameplay structures).
{
  const nSolids = SOLIDS.length, nBenches = BENCHES.length
  const solid = addRow('ledge', 18, 18)
  const bench = addRow('BENCHES', 20, 20)
  const solidKey = solid.__k, benchKey = bench.__k
  deleteRows([{ table: 'SOLIDS', row: solid }, { table: 'BENCHES', row: bench }])
  ok(SOLIDS.length === nSolids && BENCHES.length === nBenches, 'batch delete removes a cross-table selection')
  undo()
  const restoredSolid = SOLIDS.find((r) => r.__k === solidKey)
  const restoredBench = BENCHES.find((r) => r.__k === benchKey)
  ok(restoredSolid && restoredBench, 'one undo restores the full batch selection')
  deleteRows([{ table: 'SOLIDS', row: restoredSolid }, { table: 'BENCHES', row: restoredBench }])
}

// ------------------------------------------------------- a tool is not a table
// SOLIDS is four tools behind one `kind`, and the "Ramps" button used to drop a
// flat 0.4 ledge — the single most confusing thing the editor did.
for (const id of ['ramp', 'quarter', 'stairs', 'ledge']) {
  const r = addRow(id, 30, 30)
  const t = TOOL[id]
  ok(r.kind === t.patch.kind, `${id} places a ${t.patch.kind}`)
  // The collider has to agree, or it is a ramp you ride straight through.
  const c = COLLIDERS.find((k) => k.id === r.id)
  const want = r.kind === 'box' ? 'flat' : 'ramp'
  ok(c?.shape === want, `${id} builds a ${want} collider (${c?.shape})`)
  if (r.kind === 'ramp') ok(r.y1 > r.y0 && !!r.curve, `${id} carries a rise and a curve`)
  if (r.kind === 'stairs') ok(r.steps > 0, 'stairs carry a step count')
  deleteRow('SOLIDS', r)
}

// A halfpipe is one click but FIVE rows (platform, two facing quarters, two
// top decks) — and ONE object: a shared `grp` stamp makes move, rotate,
// duplicate and delete fan out over all five, or dragging a quarter pulls it
// out of its own pipe.
{
  const n = SOLIDS.length
  const hp = addRow('halfpipe', 40, 40)
  const rows = SOLIDS.slice(n)
  ok(rows.length === 5, 'halfpipe places five rows')
  ok(rows.every((r) => r.grp && r.grp === hp.grp), 'all five share a group stamp')
  const qs = rows.filter((r) => r.curve === 'quarter')
  ok(qs.length === 2 && Math.abs(Math.abs(qs[0].rot - qs[1].rot) - Math.PI) < 1e-9, 'its two quarters face each other')
  ok(qs.every((r) => colFor(r.id)?.shape === 'ramp'), 'both quarters build ramp colliders')

  // Height is a property of the WHOLE pipe even though it is authored as five
  // rows. A tall quarter has to grow its run, but only outward: the low edges
  // stay on the flat while both decks and the base follow the new coping.
  const lowEdge = (q) => [q.x - Math.sin(q.rot || 0) * q.d / 2, q.z - Math.cos(q.rot || 0) * q.d / 2]
  const lows = qs.map(lowEdge)
  const base = rows.find((r) => r.kind === 'box' && r.top === qs[0].y0)
  const baseD = base.d
  const oldD = qs[0].d
  // Reproduce the old failure first: one quarter grows around its centre while
  // its mate, decks and platform stay put. The grouped height write must heal
  // this already-broken saved layout as well as prevent a new one.
  qs[0].y1 = 5
  heal('SOLIDS', qs[0])
  begin(); setField('SOLIDS', qs[0], 'y1', 6); commit()
  ok(qs.every((r) => r.y1 === 6 && r.d >= r.y1 - r.y0), 'raising one wall raises both and keeps both quarter arcs valid')
  ok(qs.every((r, i) => Math.hypot(lowEdge(r)[0] - lows[i][0], lowEdge(r)[1] - lows[i][1]) < 1e-9), 'taller transitions grow outward without eating the flat')
  ok(rows.filter((r) => r.kind === 'box' && r !== base).every((r) => r.top === 6), 'both top decks follow the coping height')
  ok(Math.abs(base.d - (baseD + 2 * (qs[0].d - oldD))) < 1e-9, 'the platform grows under the taller pipe footprint')

  // Width is shared too. Reproduce the old split-width save, then make sure a
  // width write through any member repairs and resizes the whole structure.
  qs[0].w = 24
  const centres = rows.map((r) => [r.x, r.z])
  begin(); setField('SOLIDS', base, 'w', 18); commit()
  ok(rows.every((r) => r.w === 18), 'widening the halfpipe widens all five pieces')
  ok(rows.every((r, i) => r.x === centres[i][0] && r.z === centres[i][1]), 'width grows across the pipe without pulling its layout apart')
  ok(rows.every((r) => colFor(r.id)?.w === 18), 'the widened halfpipe rebuilds matching colliders')

  // Length is the full deck-to-deck footprint, not one row's local depth.
  // Corrupt one transition and deck in opposite ways first: the grouped write
  // must restore their paired shapes while growing only the middle flat.
  const decks = rows.filter((r) => r.kind === 'box' && r !== base)
  qs[0].d += 5
  decks[1].d = 0.4
  const targetLength = base.d + 4
  begin(); setField('SOLIDS', qs[0], 'd', targetLength); commit()
  ok(base.d === targetLength && rows.every((r) => dimensionValue('SOLIDS', r, 'd') === targetLength), 'every halfpipe member reports one overall Length')
  ok(qs[0].d === qs[1].d && decks[0].d === decks[1].d, 'length repairs split transition and deck depths')
  const flat = targetLength - qs[0].d - qs[1].d - decks[0].d - decks[1].d
  ok(Math.abs(Math.hypot(lowEdge(qs[0])[0] - lowEdge(qs[1])[0], lowEdge(qs[0])[1] - lowEdge(qs[1])[1]) - flat) < 1e-9, 'making the halfpipe longer grows its middle flat symmetrically')
  ok(rows.every((r) => r.kind === 'box' ? colFor(r.id)?.d === r.d : colFor(r.id)?.run === r.d), 'the length repair reaches every collider')

  begin(); moveGroup('SOLIDS', qs[0], 3, -2); commit()
  ok(rows.every((r) => Math.abs(r.x - 43) < 1e-9), 'moving one quarter moves all five rows')
  ok(Math.abs(colFor(hp.id).x - 43) < 1e-9, 'and the colliders follow')

  const gap = Math.hypot(qs[0].x - qs[1].x, qs[0].z - qs[1].z)
  begin(); rotateGroup('SOLIDS', qs[0], qs[0].rot + Math.PI / 2); commit()
  ok(Math.abs(Math.hypot(qs[0].x - qs[1].x, qs[0].z - qs[1].z) - gap) < 1e-9, 'rotating one quarter keeps the pipe rigid')
  ok(Math.abs(Math.abs(qs[0].rot - qs[1].rot) - Math.PI) < 1e-9, 'the quarters still face each other')

  const dup = duplicateRow('SOLIDS', qs[0])
  ok(SOLIDS.length === n + 10 && dup.grp !== hp.grp, 'duplicate copies the whole pipe under a fresh stamp')

  deleteRow('SOLIDS', dup)
  ok(SOLIDS.length === n + 5, 'deleting one member deletes its whole pipe')
  deleteRow('SOLIDS', qs[1])
  ok(SOLIDS.length === n, 'the original goes the same way')
  undo()
  ok(SOLIDS.length === n + 5, 'one undo brings the whole pipe back')
  while (SOLIDS.length > n) undo()
}

// ------------------------------------------------------- the pool moves & grows
// Pool is one feature, not an implicit bundle of unrelated wall/bench rows.
const bowlWalls = () => WALLS.filter((w) => w.bowl)
const bowlBench = () => BENCHES.filter((b) => b.bowl)
ok(bowlWalls().length === 0 && bowlBench().length === 0, 'the pool starts without generated walls or benches')

setBowl({ cx: BOWL.cx + 11 })
ok(sampleSurface(BOWL.cx, BOWL.cz, 0.4).inBowl === true, 'the moved pool is a hole at its NEW centre')
ok(bowlWalls().length === 0 && bowlBench().length === 0, 'moving the pool does not generate furniture')

setBowl({ r0: BOWL.r0 * 1.4 })
ok(sampleSurface(BOWL.cx + BOWL.r0 * 0.8, BOWL.cz, 0.4).inBowl === true, 'the bigger pool is a bigger hole')
ok(bowlWalls().length === 0 && bowlBench().length === 0, 'resizing the pool still adds no wall or benches')

undo(); undo()
deleteBowl()
placeBowl(BOWL.cx, BOWL.cz)
ok(bowlWalls().length === 0 && bowlBench().length === 0, 'deleting and placing the pool never creates companion objects')

// -------------------------------------------------- derived rows stay hidden
// A handrail is recomputed from its stair; offering it for editing hands the
// user a change that vanishes on reload.
ok(editable('RAILS').length < TABLES.RAILS.length, 'derived handrails are not editable')
ok(editable('WALLS').length === TABLES.WALLS.length, 'the pool contributes no hidden wall rows')
ok(editable('BENCHES').length === TABLES.BENCHES.length, 'the pool contributes no hidden bench rows')

// ----------------------------------------------------------------- unchanged
ok(SOLIDS.find((s) => s.id === 'qp1').x === before && WALLS.length === nWalls, 'level left as authored')

// -------------------------------------------------- blank canvas, and back
// Row counts of the SHIPPED park, measured before anything clears them.
const shipped = Object.fromEntries(Object.entries(TABLES).map(([k, v]) => [k, v.length]))

clearAll()
ok(
  Object.values(TABLES).every((t) => t.length === 0),
  'clearAll empties every table',
)
ok(COLLIDERS.length === 0, `clearAll empties the colliders (${COLLIDERS.length})`)
ok(PATHS.length === 0, `clearAll empties the grind paths (${PATHS.length})`)
// An empty level must still be RIDEABLE: the plaza is the y=0 plane, not a row.
const s0 = sampleSurface(0, 6, 0.4)
ok(s0.y === 0 && s0.ny === 1, `empty level still samples the y=0 plaza (y ${s0.y})`)

undo()
ok(
  Object.entries(shipped).every(([k, n]) => TABLES[k].length === n),
  'undo unwinds clearAll',
)

// ------------------------------------------------------------- bowl + spawn
const bowlX = BOWL.cx, bowlZ = BOWL.cz
deleteBowl()
ok(BOWL.on === false, 'deleteBowl removes the pool entity')
// With the bowl gone the dish must stop existing for gameplay too, or you fall
// into a hole the plaza no longer draws.
const inBowl = sampleSurface(BOWL.cx, BOWL.cz, 0.4)
ok(inBowl.inBowl === false && inBowl.y === 0, 'bowl off -> sampleSurface reports flat plaza at its centre')
placeBowl(bowlX, bowlZ)
ok(BOWL.on === true && sampleSurface(BOWL.cx, BOWL.cz, 0.4).inBowl === true, 'placeBowl creates the pool entity at the requested point')

setSpawn(4, -9)
ok(SPAWN.x === 4 && SPAWN.z === -9, 'setSpawn writes through (resetPlayer reads SPAWN fresh)')

// ---------------------------------------------------------------- scenery
// The default SCENE must be identity: 'sunset' carries no overrides (Lighting
// falls through to its measured constants) and 'classic' tints white.
ok(SCENE.time === 'sunset' && SCENE.ground === 'classic' && SCENE.pattern === 'slabs', 'SCENE defaults to the shipped look')
ok(timeOf().key === undefined && timeOf().keyK === undefined, "shipped time preset carries no overrides")
ok(groundOf().tint === '#ffffff', 'shipped ground tint is white (identity multiply)')
ok(patternOf().id === 'slabs', 'shipped pattern is the slabs map (plazaMapFor falls through to the cached shipped texture)')
ok(TIMES.every((t) => TIMES.filter((o) => o.id === t.id).length === 1), 'time preset ids are unique')
ok(GROUNDS.every((g) => GROUNDS.filter((o) => o.id === g.id).length === 1), 'ground preset ids are unique')
ok(PATTERNS.every((p) => PATTERNS.filter((o) => o.id === p.id).length === 1), 'pattern preset ids are unique')
ok(TIMES.some((t) => t.id === 'neon') && !TIMES.some((t) => t.id === 'golden'), 'neon is a time option without restoring the removed golden look')
ok(!GROUNDS.some((g) => ['neoncity', 'dogtown'].includes(g.id)), 'removed scene-only colours stay out of the editor')
ok(!PATTERNS.some((p) => p.id === 'brick'), 'the brick floor pattern is removed')

setScene({ time: 'night', ground: 'mint', pattern: 'checker' })
ok(SCENE.time === 'night' && SCENE.ground === 'mint' && SCENE.pattern === 'checker', 'setScene writes through')
ok(timeOf().id === 'night' && groundOf().id === 'mint' && patternOf().id === 'checker', 'timeOf/groundOf/patternOf resolve the remaining options')
undo()
ok(SCENE.time === 'sunset' && SCENE.ground === 'classic' && SCENE.pattern === 'slabs', 'undo unwinds a scene change')
redo()
ok(SCENE.time === 'night', 'redo replays it')
const lookBeforeNeon = { ground: SCENE.ground, pattern: SCENE.pattern }
setScene({ time: 'neon' })
ok(SCENE.time === 'neon' && SCENE.ground === lookBeforeNeon.ground && SCENE.pattern === lookBeforeNeon.pattern, 'Neon changes only Time, not Colour or Pattern')
undo()

// ------------------------------------------------------------- persistence
// save -> mutate -> load must round-trip a moved row, the spawn and the bowl.
const led = SOLIDS.find((s) => s.id === 'ledge1')
begin()
led.x = 41.5
commit()
BOWL.on = false
saveLevel()
ok(hasSaved(), 'saveLevel writes the key')

// Scrambled WITHOUT a commit on purpose: commit autosaves, so committing here
// would overwrite the blob we are about to load and the round-trip would pass
// for the wrong reason.
led.x = 0
SPAWN.x = 0
SPAWN.z = 0
BOWL.on = true
SCENE.time = 'sunset'
SCENE.ground = 'classic'
SCENE.pattern = 'slabs'

ok(loadLevel(), 'loadLevel applies the blob')
ok(SOLIDS.find((s) => s.id === 'ledge1').x === 41.5, 'load round-trips a moved row')
ok(SPAWN.x === 4 && SPAWN.z === -9, 'load round-trips SPAWN')
ok(BOWL.on === false, 'load round-trips BOWL.on')
ok(SCENE.time === 'night' && SCENE.ground === 'mint' && SCENE.pattern === 'checker', 'load round-trips SCENE')
ok(SOLIDS.every((s) => s.__k), 'restored rows are re-keyed')
ok(COLLIDERS.some((c) => c.id === 'ledge1' && c.x === 41.5), 'a loaded move reaches the colliders')

// ------------------------------------------------------------------- reset
resetLevel()
ok(
  Object.entries(shipped).every(([k, n]) => TABLES[k].length === n),
  'resetLevel restores the shipped row counts',
)
ok(SOLIDS.find((s) => s.id === 'ledge1').x !== 41.5, 'resetLevel undoes the saved move')
ok(BOWL.on === true && SPAWN.x === 0, 'resetLevel restores BOWL.on and SPAWN')
ok(SCENE.time === 'sunset' && SCENE.ground === 'classic' && SCENE.pattern === 'slabs', 'resetLevel restores the shipped scene')
ok(!hasSaved(), 'resetLevel drops the saved level')

// Saves from before the editor cleanup retain the restored Neon time, while
// removed colour/pattern choices still migrate to visible defaults.
Object.assign(SCENE, { time: 'neon', ground: 'dogtown', pattern: 'brick' })
saveLevel()
ok(loadLevel(), 'a legacy scenery save still loads')
ok(SCENE.time === 'neon' && SCENE.ground === 'classic' && SCENE.pattern === 'slabs', 'Neon survives while removed scenery choices migrate to visible defaults')
resetLevel()
clearSaved()

// ------------------------------------------- NaN rows cannot crash the sim
// A row built without `rot` (DEFAULTS used to omit it) makes Math.cos(undefined)
// NaN, which made lipEdges emit a NaN rail; NaN loses every comparison in
// closestOn, so findGrind was left dereferencing a null tangent and took the
// whole sim down the first time the dog rolled anywhere near it.
clearAll()
const bad = addRow('WALLS', 0, 0)
ok(bad.rot === 0 && bad.base === 0, 'a new wall carries the fields its consumers read')
ok(PATHS.every((r) => Number.isFinite(r.mid.x)), 'no NaN grind path from a fresh wall')

// ...and force the pathological row anyway: a hand-edited save, or any future
// table whose factory forgets a field, must degrade to "not grindable".
delete bad.rot
bumpLevel()
let threw = null
try { findGrind(0, 1.15, 0, 8, 0) } catch (e) { threw = e }
ok(!threw, `findGrind survives a NaN rail (${threw?.message ?? 'no throw'})`)

// heal() puts it back, which is what a reload of an old save relies on.
heal('WALLS', bad)
bumpLevel()
ok(bad.rot === 0, 'heal refills a stripped field')

// kind-switching a SOLID must bring the fields the new kind requires
const sol = addRow('SOLIDS', 5, 5)
setField('SOLIDS', sol, 'kind', 'stairs')
ok(Number.isFinite(sol.y1) && Number.isFinite(sol.steps), 'kind -> stairs fills y0/y1/steps')

// ------------------------------------------- placement guidance is honest
// placementInfo steers the ghost: it must offer a deck's top to the ramp that
// feeds it, flag a bury and a blocked run-up, and stay quiet about the two
// overlaps that are DESIGNED — ramp-into-deck and exactly-flush neighbours.
clearAll()
const deck = addRow('ledge', 0, 0)
begin()
Object.assign(deck, { top: 1.6, w: 8, d: 8 })
commit()

// quarter (d 3.2, default y1 2) overlapping the deck's south face: the ramp
// hole is legal, and the rise should be offered the deck's top
let info = placementInfo('quarter', 0, -4.5, 0)
ok(info.warn === null, 'ramp-into-deck overlap is the designed hole, not a bury')
ok(info.matchTop === 1.6, `ramp against a deck offers its top (${info.matchTop})`)
const q = addRow('quarter', 0, -4.5, 0)
ok(q.y1 === 1.6, `placed quarter rises to meet the deck (${q.y1})`)
deleteRow('SOLIDS', q)

info = placementInfo('ledge', 0, 0, 0)
ok(!!info.warn, `box dropped inside a box warns (${info.warn})`)
ok(info.block === true, 'a red overlap preview cannot be placed')

info = placementInfo('ledge', 6, 0, 0) // spans 4..8; the deck ends at 4
ok(info.warn === null, 'exactly flush is not an overlap')
ok(info.block === false, 'a valid flush preview remains placeable')

// the bank1 mistake: a wall across the only approach lane
const blocker = addRow('WALLS', 0, -9.4)
info = placementInfo('quarter', 0, -5.6, 0)
ok(/run-up/.test(info.warn ?? ''), `blocked run-up warns (${info.warn})`)
ok(info.block === true, 'a red blocked-run-up preview cannot be placed')
deleteRow('WALLS', blocker)
info = placementInfo('quarter', 0, -5.6, 0)
ok(info.warn === null, 'clearing the lane clears the warning')
ok(info.block === false, 'clearing the warning makes the preview placeable')

// tall quarters keep their arc: past h = d the drawn surface tops out at d²/h
// while the coping stays at y1 — heal grows the run with the rise instead
const tall = addRow('quarter', 20, 20)
begin()
setField('SOLIDS', tall, 'y1', 6)
commit()
ok(tall.d >= 6, `a 6m quarter grows its run to match (d ${tall.d})`)
deleteRow('SOLIDS', tall)

// ...including a rise it inherited from the height-match
begin()
Object.assign(deck, { top: 4 })
commit()
info = placementInfo('quarter', 0, -4.5, 0)
ok(info.warn === null, 'a taller deck is not a bury when the rise will match it')
const q4 = addRow('quarter', 0, -4.5, 0)
ok(q4.y1 === 4 && q4.d >= 4, `a matched rise re-heals the run (y1 ${q4.y1}, d ${q4.d})`)

// nothing grounded stands in the pool — but an air line over it is fine
placeBowl(BOWL.cx, BOWL.cz)
ok(placementInfo('can', BOWL.cx, BOWL.cz).block === true, 'a can cannot stand in the pool')
ok(placementInfo('quarter', BOWL.cx, BOWL.cz).block === true, 'nor can a ramp')
ok(placementInfo('bone', BOWL.cx, BOWL.cz).block === false, 'a bone over the pool is a line, not a mistake')

// a named user level round-trips: save → list → clear → apply → delete.
// node has no localStorage; store() reads it lazily, so a shim installed here
// is soon enough.
globalThis.localStorage ??= (() => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
})()
const nSolids = SOLIDS.length
ok(saveLevelAs('check park', null) === true, 'saveLevelAs writes a named level')
const userLevels = listLevels()
ok(userLevels.length >= 1 && userLevels[0].name === 'check park', 'listLevels returns it')
clearAll()
ok(SOLIDS.length !== nSolids, 'clearAll emptied the park first')
ok(applyBlob(userLevels[0].data) === true, 'applyBlob restores the named level')
ok(SOLIDS.length === nSolids, 'its tables came back whole')
deleteUserLevel(userLevels[0].id)
ok(!listLevels().some((l) => l.id === userLevels[0].id), 'deleteUserLevel removes it')

// The shipped Dog Bowling mode lives in Challenges, not My Levels, and cannot
// be deleted with user storage.
const bowlingLevel = listChallenges().find((l) => l.id === 'dog-bowling')
ok(!listLevels().some((l) => l.id === 'dog-bowling'), 'My Levels contains only user-created parks')
ok(bowlingLevel?.builtIn && bowlingLevel.name === 'Dog Bowling' && bowlingLevel.description.includes('30 sec'), 'Challenges includes the built-in Dog Bowling mode')
deleteUserLevel(bowlingLevel.id)
ok(listChallenges().some((l) => l.id === bowlingLevel.id), 'the built-in challenge cannot be deleted')
ok(applyBlob(bowlingLevel.data), 'Dog Bowling level applies')
ok(CANS.length === 151 && CANS.filter((c) => c.scale >= 2).length === 7, 'Dog Bowling has 151 tightly packed cans including seven huge ones')
ok(Object.entries(TABLES).every(([table, rows]) => table === 'CANS' || rows.length === 0), 'Dog Bowling contains cans and no unrelated level objects')
ok(runRules().time === 30 && runRules().timeBonus === 0 && runRules().goalIds?.join() === 'cans', 'Dog Bowling has a 30-second, cans-only run')
ok(P.timeLeft === 30 && useGame.getState().timeLeft === 30, 'applying Dog Bowling synchronizes both clocks')
ok(P.pos.x === -30 && P.pos.z === 18 && P.heading === Math.PI / 2, 'Dog Bowling starts at the first can row')
ok(characterSize().dog === 2.4 && characterSize().boy === 1.58, 'Dog Bowling keeps a giant dog and normal-sized boy')
useGame.getState().smashCan()
useGame.getState().smashCan()
ok(useGame.getState().cansSmashed === 2, 'Dog Bowling exposes live smashed-can progress to the HUD')
useGame.getState().restart()
ok(useGame.getState().cansSmashed === 0, 'restarting Dog Bowling resets the smashed-can counter')
resetLevel()
ok(runRules().time === RUN_TIME && runRules().goalIds === null, 'resetting the level restores the normal run rules')

// personal best: only a HIGHER score writes, and each level keeps its own
ok(bestFor('park') === 0, 'no best until a run ends')
ok(recordScore(1200, 'park') === true && bestFor('park') === 1200, 'a first score is the best')
ok(recordScore(900, 'park') === false && bestFor('park') === 1200, 'a worse run leaves it alone')
ok(recordScore(1800, 'park') === true && bestFor('park') === 1800, 'a better run replaces it')
ok(bestFor('abc') === 0, "a user level does not inherit the park's best")
ok(canBestFor('dog-bowling') === 0, 'Dog Bowling has no can best before a run')
ok(recordCanCount(80, 'dog-bowling') === true && canBestFor('dog-bowling') === 80, 'Dog Bowling records its best can count')
ok(recordCanCount(60, 'dog-bowling') === false && canBestFor('dog-bowling') === 80, 'a worse can run leaves the best count alone')
ok(recordCanCount(151, 'dog-bowling') === true && canBestFor('dog-bowling') === 151, 'a full clear persists completion progress')

// ------------------------------------------------- rail steppers reach PATHS
// A rail is its `pts`, so the card's Length/Rotate/Height steppers mutate the
// array directly rather than a field — the claim worth asserting is the same
// one the whole editor makes: the change reaches the GRIND PATHS, not just the
// tube. The shipped rail spans x -3..3 at (40, 40), so 40+3+2 is past its end.
clearAll()
let rl = addRow('rail', 40, 40)
const grindAt = (x) => findGrind(x, rl.pts[0][1] + 0.6, 40, 8, 0)
ok(Math.abs(railLength(rl) - 6) < 1e-6, `a fresh rail measures its own length (${railLength(rl)})`)
ok(grindAt(45) === null, 'nothing to grind 2m past the end')
begin(); extendRail(rl, 4); commit()
ok(Math.abs(railLength(rl) - 10) < 1e-6, `extend adds exactly its metres (${railLength(rl)})`)
ok(grindAt(45) !== null, 'the extension is grindable — the commit refilled PATHS')
undo()
// restore() replaces the row OBJECTS, so `rl` is stale after an undo — the
// panel re-resolves its selection by __k for exactly this reason.
ok(Math.abs(railLength(TABLES.RAILS.at(-1)) - 6) < 1e-6, 'one undo takes the extension back')
rl = TABLES.RAILS.at(-1)
// Can't shrink to nothing: the final segment keeps a direction to grow along.
begin(); extendRail(rl, -99); commit()
ok(railLength(rl) >= 0.5, `shrink floors at a usable segment (${railLength(rl).toFixed(2)})`)
begin(); liftRail(rl, -99); commit()
ok(Math.min(...rl.pts.map((p) => p[1])) === 0.2, 'lower floors at 0.2 rather than sinking into the plaza')
const preTurn = rl.pts.map((p) => [...p])
begin(); turnRail(rl, Math.PI / 2); commit()
ok(Math.abs(railLength(rl) - railLength({ pts: preTurn })) < 1e-9, 'turn preserves length')
ok(rl.pts.some((p, i) => Math.abs(p[0] - preTurn[i][0]) > 1e-6), 'turn actually moved it')
ok(rl.pts.every((p, i) => Math.abs(p[1] - preTurn[i][1]) < 1e-9), 'turn is a yaw — it leaves height alone')

// ------------------------------------------------------------------ bending
// A rail bends by curving its own polyline; length is preserved so Bend and
// Length stay independent steppers, and the curve has to reach PATHS.
clearAll()
rl = addRow('rail', 40, 40)
const straight = railLength(rl)
begin(); bendRail(rl, Math.PI / 2); commit()
ok(rl.pts.length >= 5, `bend resamples a 2-point rail so it has something to curve (${rl.pts.length} pts)`)
ok(Math.abs(railLength(rl) - straight) < 1e-6, `bend preserves length (${railLength(rl).toFixed(3)})`)
const head = Math.atan2(rl.pts[1][2] - rl.pts[0][2], rl.pts[1][0] - rl.pts[0][0])
const tail = Math.atan2(rl.pts.at(-1)[2] - rl.pts.at(-2)[2], rl.pts.at(-1)[0] - rl.pts.at(-2)[0])
ok(Math.abs(Math.abs(tail - head) - Math.PI / 2 * 0.8) < 0.2, `total turn is ~the arc asked for (${(tail - head).toFixed(2)} rad)`)
ok(findGrind(rl.pts[2][0], rl.pts[2][1] + 0.6, rl.pts[2][2], 8, 0) !== null, 'a bent rail is still grindable')
undo()
ok(TABLES.RAILS.at(-1).pts.length === 2, 'one undo takes the whole bend back')

// A wall bends as ONE row expanded into chords — the sim only understands
// boxes, so the claim is that the chain reaches colliders AND the lip edges.
clearAll()
const bw = addRow('wall', 20, 20)
const nCap = () => COLLIDERS.filter((c) => c.id === 'wall').length
const nLip = () => PATHS.filter((p) => p.id.startsWith('wallcap')).length
ok(nCap() === 1 && nLip() === 2, 'a straight wall is one box and two lip edges')
begin(); setField('WALLS', bw, 'bend', 1.2); commit()
ok(WALLS.length === 1, 'a bent wall is still ONE editable row')
ok(nCap() >= 3, `bend collides as a chain of chords (${nCap()} boxes)`)
ok(nLip() === nCap() * 2, 'every chord keeps both of its lip edges')
const ends = COLLIDERS.filter((c) => c.id === 'wall').map((c) => c.rot)
ok(Math.abs(Math.max(...ends) - Math.min(...ends)) > 0.6, 'the chords actually fan through the arc')
begin(); setField('WALLS', bw, 'bend', 0); commit()
ok(nCap() === 1, 'straightening returns it to a single box')

resetLevel()
clearSaved()

console.log(fails ? `\n${fails} FAILED` : '\nlevel editor ok')
process.exit(fails ? 1 : 0)
