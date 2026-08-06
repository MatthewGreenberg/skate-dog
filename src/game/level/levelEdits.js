// Level editor state. Its own module for the same reason foliageKnobs.js and
// dogFit.js are: a component file may not export shared mutable state under
// react-refresh, and both the in-Canvas editor and the DOM panel need this.
//
// The model is deliberately blunt: the editor MUTATES levelData's exported
// arrays in place, then bumps a version. Everything downstream is either a
// pure function of those arrays (Skatepark/Props geometry, refreshed by the
// version) or was snapshotted at module load and gets an explicit rebuild
// (colliders, rail paths). There is no separate document format to keep in
// sync with the level — the level IS the document.

import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { SOLIDS, WALLS, PLANTERS, RAILS, BENCHES, LAMPS, BONES, LETTERS, CANS, SPAWN, BOWL, rebuildBowlDerived } from './levelData.js'
import { rebuildColliders } from './colliders.js'
import { rebuildPaths } from './rails.js'
import { invalidateParkAO } from './textures.js'
import { P, useGame, runRules, setRunRules } from '../store.js'
import { resetPlayer } from '../player/PlayerController.js'
import { resetGoals } from '../goals.js'
import { setMusicDuck, sfxPlace, sfxDelete } from '../audio/AudioManager.js'
import { STEP_UP } from './colliders.js'
import { isInsideBowl } from './bowlGeometry.js'
import { characterSize, applyCharacterSizes } from '../components/dogFit.js'

// No import cycle: store/goals/PlayerController/colliders/rails all import
// levelData and each other, and none of them imports this file. Checked.

export const EDIT = typeof location !== 'undefined' &&
  (new URLSearchParams(location.search).has('edit') || /^\/edit\/?$/.test(location.pathname))

// ?edit opens IN the editor, and that first entry never goes through
// setEditing() — so the duck has to be armed here or the page loads building
// at full volume and only gets quiet after your first playtest.
if (EDIT) setMusicDuck(0.3)

/** Every table the editor can touch. TREES/SHRUBS are omitted on purpose —
 *  they are seeded IIFEs over PERIMETER, not authored rows. */
export const TABLES = { SOLIDS, WALLS, PLANTERS, RAILS, BENCHES, LAMPS, BONES, LETTERS, CANS }

/** The player's start pose. resetPlayer() reads it fresh every run, so the
 *  editor mutates it in place like any other row. */
export { SPAWN, BOWL }

// ------------------------------------------------------------------- scenery
// Level-wide look has its own reactive source of truth. Lighting, Plaza, and
// the editor subscribe directly, so a swatch click never needs the broad level
// rebuild signal used by geometry/colliders.
const SCENE_DEFAULTS = { time: 'sunset', ground: 'classic', pattern: 'slabs' }
export const useSceneSettings = create(() => ({ ...SCENE_DEFAULTS }))
export const sceneSettings = () => useSceneSettings.getState()

// Compatibility facade for the node editor check and console diagnostics.
// Product code uses the hook/getter above; even a legacy assignment still
// lands in the reactive store rather than mutating a disconnected mirror.
export const SCENE = new Proxy({}, {
  get: (_, key) => sceneSettings()[key],
  set: (_, key, value) => (useSceneSettings.setState({ [key]: value }), true),
  ownKeys: () => Reflect.ownKeys(sceneSettings()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
})

// Presets, hardcoded hexes like the swatches above — the module stays loadable
// by the node checks. 'sunset' carries no overrides on purpose: identity means
// Lighting falls through to its measured constants untouched.
export const TIMES = [
  { id: 'noon', label: 'Noon', swatch: '#cfeaf6', key: '#fff4c9', keyK: 1.22, amb: 1.12, envK: 1.12,
    sky: '#c9eafb', skyHigh: '#a9d8f7', fog: '#dcecf2', hemiSky: '#dff5ff', hemiGround: '#ffd7aa',
    fill: '#9fd4ff', envWarm: '#ffe0a6', envZenith: '#bde6ff', envFill: '#8bc9ff', bounce: '#ffd0a5' },
  { id: 'sunset', label: 'Sunset', swatch: '#f8dccb' },
  { id: 'dusk', label: 'Dusk', swatch: '#cf8fc4', key: '#ffad87', keyK: 0.72, amb: 0.92, envK: 0.92,
    sky: '#d88fb9', skyHigh: '#8f86d9', fog: '#d5a1bd', hemiSky: '#b8a7ee', hemiGround: '#ef9a87',
    fill: '#778bd8', envWarm: '#ff9d82', envZenith: '#aa9bea', envFill: '#7184d4', bounce: '#e98c82' },
  { id: 'night', label: 'Night', swatch: '#252b58', key: '#a9c5ff', keyK: 0.48, amb: 0.72, envK: 0.76,
    sky: '#20264e', skyHigh: '#171b3d', fog: '#303762', hemiSky: '#6979bd', hemiGround: '#6d496b',
    fill: '#536bd0', envWarm: '#bd78ac', envZenith: '#4f61a8', envFill: '#405ac5', bounce: '#8f5873' },
  // A stylised nightlife hour, but still only the lighting axis: choosing it
  // never changes the user's ground colour or floor pattern.
  { id: 'neon', label: 'Neon', swatch: '#ff5fd0', key: '#ff5fd0', keyK: 0.62, amb: 0.82, envK: 0.9,
    sky: '#161038', skyHigh: '#0a081f', fog: '#2c1548', hemiSky: '#5a4bd8', hemiGround: '#ff4fa0',
    fill: '#22d4e8', envWarm: '#ff5fb0', envZenith: '#3a2a80', envFill: '#1fb8d8', bounce: '#c04fd0' },
]

// Multiplies the plaza albedo (the map stays, so the pavers survive the tint).
export const GROUNDS = [
  { id: 'classic', label: 'Classic peach', tint: '#ffffff', swatch: '#e9d8cf', surface: {} },
  { id: 'rose', label: 'Rose candy', tint: '#ffb8d2', swatch: '#ffb8d2', air: '#ffd0e2', airK: 0.16,
    surface: { stone: '#fff0f6', masonry: '#f8d7eb', bowl: '#ffd4ef', hpSurf: '#f7c7e4', wood: '#ffe1d2', grass: '#e5f4d5' } },
  { id: 'mint', label: 'Mint garden', tint: '#a9efd0', swatch: '#a9efd0', air: '#c4f3dd', airK: 0.16,
    surface: { stone: '#e8fff5', masonry: '#d6f3e8', bowl: '#c8f2e6', hpSurf: '#b7eadf', wood: '#eef0d0', grass: '#d7f4bd' } },
  { id: 'ocean', label: 'Ocean blue', tint: '#a8d3ff', swatch: '#a8d3ff', air: '#add5ff', airK: 0.2,
    surface: { stone: '#e7f3ff', masonry: '#d6e5fa', bowl: '#c4d7ff', hpSurf: '#a8dbf7', wood: '#e4dfd4', grass: '#d5e8d5' } },
  { id: 'asphalt', label: 'Night asphalt', tint: '#747382', swatch: '#747382', air: '#727994', airK: 0.2,
    surface: { stone: '#d4ced5', masonry: '#bdb8cc', bowl: '#a8a1cf', hpSurf: '#abb7c8', wood: '#b8a99d', grass: '#aeb99a' } },
]

// Floor PATTERN — which plaza albedo/normal Skatepark mounts. 'slabs' is the
// shipped 1.6m cast-slab map untouched (plazaMapFor returns the same cached
// texture, so a plain visit and the shoot harness render byte-identical); the
// others are drawn on demand by textures.js and cached per id. `swatch` is a
// CSS background, and these are gradients on purpose — a pattern chip has to
// look like its pattern, not like a colour.
export const PATTERNS = [
  { id: 'slabs', label: 'Big slabs', swatch: 'repeating-linear-gradient(90deg, #ecdcd3 0 10px, #cbb8af 10px 12px)', bump: 0.22, rough: 0.74, env: 0.75 },
  { id: 'tiles', label: 'Playground tile', swatch: 'repeating-linear-gradient(45deg, #f1ded6 0 5px, #bda49e 5px 7px)', bump: 0.52, rough: 0.82, env: 0.55 },
  { id: 'checker', label: 'Polished checker', swatch: 'conic-gradient(#f2e0d8 0 25%, #997b82 0 50%, #f2e0d8 0 75%, #997b82 0)', bump: 0.16, rough: 0.56, env: 1.15 },
  { id: 'concrete', label: 'Poured concrete', swatch: 'linear-gradient(135deg, #e3d7d0, #b8aaa8)', bump: 0.06, rough: 0.96, env: 0.3 },
  { id: 'wood', label: 'Glossy boardwalk', swatch: 'repeating-linear-gradient(0deg, #d6ad78 0 5px, #76543c 5px 7px)', bump: 0.58, rough: 0.58, env: 1.1 },
]

export const timeOf = (id = sceneSettings().time) => TIMES.find((t) => t.id === id) ?? TIMES[1]
export const groundOf = (id = sceneSettings().ground) => GROUNDS.find((g) => g.id === id) ?? GROUNDS[0]
export const patternOf = (id = sceneSettings().pattern) => PATTERNS.find((p) => p.id === id) ?? PATTERNS[0]

export function setScene(patch) {
  begin()
  useSceneSettings.setState(patch)
  saveLevel()
}

/** Resize exactly one character. Attachment and pose code preserve the visual
 *  unit; the other character's authored size is never changed implicitly. */
export function setCharacterSize(who, value) {
  begin()
  const current = characterSize()
  applyCharacterSizes(
    who === 'dog' ? value : current.dog,
    who === 'boy' ? value : current.boy,
  )
  saveLevel()
}

// Stable editor keys. Several tables have no `id`; array indices break the
// outliner, selection proxies, and inspector identity after a delete or
// duplicate. One key per row sidesteps that without changing the saved schema.
let nextKey = 0
export const keyOf = (row) => (row.__k ??= ++nextKey)
for (const rows of Object.values(TABLES)) for (const r of rows) keyOf(r)

// ------------------------------------------------------------------ version
let version = 0
const subs = new Set()
export const subscribeLevel = (fn) => (subs.add(fn), () => subs.delete(fn))
export const levelVersion = () => version
/** Re-renders on every commit. Consumers content-key only the changed table. */
export const useLevelVersion = () => useSyncExternalStore(subscribeLevel, levelVersion, levelVersion)

// Selection + tool state, shared across the Canvas boundary (the proxy layer
// lives inside it, the panel outside). Not per-frame state, so zustand rather
// than P — but the gizmo drag itself must NOT set state per frame.
export const useEditor = create((set) => ({
  table: 'SOLIDS', // the panel opens on a populated table, not an empty list
  row: null,
  // Every selected editable row, including `row`. `row` remains the active
  // member so the existing inspector and gizmo have one unambiguous target;
  // Shift-click adds/removes members for batch actions.
  selection: [],
  mode: 'translate', // W/E/R
  undoAvailable: false,
  redoAvailable: false,
  // LIVE editing state, not the URL flag: `?edit` says the editor exists at
  // all, this says which half you are in. Toggling it must not need a reload —
  // build, play, come back.
  editing: EDIT,
  // An armed TOOL id for click-to-place, or null. Selecting a row disarms:
  // you are inspecting now, and a stray click should not drop a second box.
  add: null,
  // Yaw the armed ghost carries onto the row it places. Sticky across
  // placements on purpose — laying a row of angled ledges should not mean
  // re-rotating each one.
  addRot: 0,
  // The bowl is not a row (see BOWL below), so it needs its own selection slot.
  // Spawn and character use the adjacent named special-selection slot.
  bowlSel: false,
  // Non-row scene targets. Keeping these in the shared store lets the Canvas
  // selection and the DOM inspector agree about what was clicked.
  specialSel: null, // 'spawn' | 'character'
  // The armed ghost's live feedback for the panel's hint line: a warning or a
  // height-match note from placementInfo, or null. hintWarn styles it.
  hint: null,
  hintWarn: false,
  arm: (tool) => set((s) => ({ add: s.add === tool ? null : tool, row: null, selection: [], bowlSel: false, specialSel: null, hint: null, hintWarn: false })),
  select: (table, row, multiple = false) => set((s) => {
    if (!multiple) return { table, row, selection: [{ table, row }], add: null, bowlSel: false, specialSel: null, hint: null, hintWarn: false }
    const i = s.selection.findIndex((item) => item.table === table && item.row === row)
    if (i < 0) return { table, row, selection: [...s.selection, { table, row }], add: null, bowlSel: false, specialSel: null, hint: null, hintWarn: false }
    const selection = s.selection.filter((_, n) => n !== i)
    const active = selection.at(-1)
    return { table: active?.table ?? table, row: active?.row ?? null, selection, add: null, bowlSel: false, specialSel: null, hint: null, hintWarn: false }
  }),
  selectSpecial: (specialSel) => set({ row: null, selection: [], add: null, bowlSel: false, specialSel, hint: null, hintWarn: false }),
  // The neutral pointer tool: unlike clear(), this also drops an armed add
  // tool. V and the panel button both come through here so they cannot leave a
  // hidden selection or placement ghost behind.
  picker: () => set({ row: null, selection: [], add: null, bowlSel: false, specialSel: null, hint: null, hintWarn: false }),
  clear: () => set({ row: null, selection: [], bowlSel: false, specialSel: null }),
  set,
}))

/** `?edit` gates the editor's existence; this is the live half. */
export const useEditing = () => useEditor((s) => s.editing)

/** Rebuild everything that snapshotted the level, then notify React.
 *
 * Plaza AO is deliberately deferred while editing. Its 1024px blurred bake is
 * cosmetic and was the dominant commit hitch; playtest entry refreshes it once
 * after the final edit instead of once per stepper click or gizmo drag. */
export function bumpLevel({ refreshAO = !useEditor.getState().editing, persist = true } = {}) {
  rebuildColliders()
  rebuildPaths()
  // The plaza's baked contact shadows are a function of the rows too; without
  // this the park keeps the shadow of every prop you moved. Skatepark re-reads
  // it when this version bump refreshes its authored geometry.
  if (refreshAO) invalidateParkAO()
  // ponytail: autosave on every commit, undebounced on purpose. The level is a
  // few kB of JSON and a commit only fires on drag-end or a field blur, so this
  // is a handful of writes per minute — a debounce would be more moving parts
  // than the thing it protects.
  if (persist) saveLevel()
  version++
  for (const fn of subs) fn()
}

/** The whole play/edit transition, in one place so no caller can do half of it.
 *  Going to PLAY is a fresh run on the edited level; going back to EDIT just
 *  parks the game state — the sim is already frozen by Game.jsx. */
export function setEditing(on) {
  // Building is a quiet, heads-down job and the soundtrack is written for a
  // run. Duck rather than pause: silence reads as "the audio broke".
  setMusicDuck(on ? 0.3 : 1)
  if (on) {
    useGame.setState({ started: false, runOver: false })
    // The editor is an authored-state view, not a paused gameplay frame. Put
    // the character back at the authored spawn and let transient props remount
    // cleanly when Game.jsx switches modes.
    resetPlayer()
    P.paused = false
  } else {
    bumpLevel({ refreshAO: true }) // ride the level as edited, with one final AO bake
    resetPlayer()
    resetGoals()
    useGame.getState().restart()
    useGame.setState({ started: true, runOver: false })
    P.paused = false
    // No reveal swoop: you are testing a ramp you just placed, not being
    // introduced to the park.
    P.intro = 0
  }
  useEditor.setState({ editing: on, row: null, selection: [], add: null, bowlSel: false, specialSel: null })
}

export const toggleEditing = () => setEditing(!useEditor.getState().editing)

// ------------------------------------------------------------------ history
// Whole-level snapshots, not a command pattern: the level is a few KB of plain
// JSON and a command log here would be pure ceremony.
const past = []
const future = []
const LIMIT = 50

const characterSnapshot = () => {
  const { dog, boy } = characterSize()
  return { dog, boy }
}

const sceneSnapshot = () => {
  const { time, ground, pattern } = sceneSettings()
  return { time, ground, pattern }
}

// SPAWN and the whole BOWL ride along: they are level state the editor can
// change, so undo has to unwind them too. The bowl is copied WHOLE rather than
// just its `on` flag — it is movable and resizable now, and a snapshot that
// only carried the flag would undo a delete but not a drag.
const snap = () => ({
  tables: Object.fromEntries(
    Object.entries(TABLES).map(([k, rows]) => [k, rows.map((r) => ({ ...r, pts: r.pts?.map((p) => [...p]) }))]),
  ),
  spawn: { ...SPAWN },
  bowl: { ...BOWL },
  scene: sceneSnapshot(),
  characters: characterSnapshot(),
  rules: runRules(),
})

function restore(s) {
  for (const [k, rows] of Object.entries(s.tables)) {
    const arr = TABLES[k]
    arr.length = 0
    arr.push(...rows)
  }
  Object.assign(SPAWN, s.spawn)
  // No rebuildBowlDerived here: the snapshot's tables already carry the wall
  // and benches as they stood, and regenerating would fight them.
  Object.assign(BOWL, typeof s.bowl === 'boolean' ? { on: s.bowl } : s.bowl)
  if (s.scene) useSceneSettings.setState(s.scene)
  if (s.characters) applyCharacterSizes(s.characters.dog, s.characters.boy)
  setRunRules(s.rules)
  bumpLevel()
}

/** Call BEFORE a mutation. Pairs with commit(). */
export function begin() {
  past.push(snap())
  if (past.length > LIMIT) past.shift()
  future.length = 0
  useEditor.setState({ undoAvailable: true, redoAvailable: false })
}

/** Call AFTER a mutation. Rebuilds derived data and re-renders the park. */
export const commit = bumpLevel

export function undo() {
  if (!past.length) return
  future.push(snap())
  const state = past.pop()
  useEditor.setState({ undoAvailable: past.length > 0, redoAvailable: true })
  restore(state)
}

export function redo() {
  if (!future.length) return
  past.push(snap())
  const state = future.pop()
  useEditor.setState({ undoAvailable: true, redoAvailable: future.length > 0 })
  restore(state)
}

export const canUndo = () => past.length > 0
export const canRedo = () => future.length > 0

// ------------------------------------------------------------------ editing
/** Rows the editor may offer. `derived` rows are recomputed from another row
 *  (currently handrails from their stair), and an edit to one is silently
 *  thrown away on the next reload. */
export const editable = (table) => TABLES[table].filter((r) => !r.derived)

const DEFAULTS = {
  // No top/style here: heal()'s KIND table fills whatever the row's `kind`
  // requires, so a tool that patches kind to 'ramp' does not arrive carrying a
  // box's fields as well.
  SOLIDS: () => ({ kind: 'box', id: `box${nextKey + 1}`, x: 0, z: 0, w: 4, d: 4, rot: 0, base: 0 }),
  WALLS: () => ({ x: 0, z: 0, w: 4, d: 0.6, rot: 0, base: 0, h: 1.15, bend: 0, mural: null }),
  PLANTERS: () => ({ x: 0, z: 0, w: 3, d: 3, rot: 0, base: 0, h: 0.95, plant: 'flowers' }),
  RAILS: () => ({ id: `rail${nextKey + 1}`, color: 'railTeal', posts: 'flat', pts: [[-3, 0.55, 0], [3, 0.55, 0]] }),
  BENCHES: () => ({ x: 0, z: 0, rot: 0, base: 0 }),
  LAMPS: () => ({ x: 0, z: 0, base: 0, banner: null }),
  BONES: () => ({ id: `bone${nextKey + 1}`, x: 0, y: 1.6, z: 0 }),
  LETTERS: () => ({ id: `l${nextKey + 1}`, ch: 'S', x: 0, y: 1.6, z: 0 }),
  CANS: () => ({ id: `can${nextKey + 1}`, x: 0, z: 0, scale: 1 }),
}

// levelData's box()/wall() factories supply rot and base; a row built any other
// way (DEFAULTS above, an old saved level, a `kind` switched in the inspector)
// arrives without them, and NOTHING downstream defaults them — rails.js does
// `Math.cos(w.rot)` and colliders.js does `base + h`. undefined propagates as
// NaN, which is not a wonky wall: it is a rail segment whose tangent never wins
// `d2 < best.d2` (NaN loses every comparison), so findGrind dereferenced a null
// tangent and took the whole sim down on the first rideable frame.
const NEEDS = {
  SOLIDS: { rot: 0, base: 0 },
  WALLS: { rot: 0, base: 0, h: 1.15, bend: 0 },
  PLANTERS: { rot: 0, base: 0 },
  BENCHES: { rot: 0, base: 0 },
  LAMPS: { base: 0 },
  CANS: { scale: 1 },
}
// ...and a SOLIDS row means three different shapes. Switching `kind` in the
// inspector lands a box row in ramp code, which reads y0/y1/curve; `steps` has
// no default at all and renders NaN treads.
const KIND = {
  box: { top: 0.4, style: 'ledge' },
  ramp: { y0: 0, y1: 1.6, curve: 'linear' },
  stairs: { y0: 0, y1: 1.6, steps: 6 },
}

/** Fill the optional fields a row's consumers read but never default. */
export function heal(table, row) {
  for (const [k, v] of Object.entries(NEEDS[table] ?? {})) row[k] ??= v
  if (table === 'SOLIDS') for (const [k, v] of Object.entries(KIND[row.kind] ?? {})) row[k] ??= v
  // A quarter's arc can only rise as far as its run: past h = d the circle
  // R = (d²+h²)/2h puts the drawn surface's top at d²/h — BELOW y1 — while the
  // coping tube and the collider's lip stay at y1, so the ramp visibly comes
  // apart. Grow the run with the rise (d = h is a perfect quarter circle,
  // vertical at the lip) so any height the steppers reach still draws whole.
  if (table === 'SOLIDS' && row.kind === 'ramp' && row.curve === 'quarter' && row.y1 - row.y0 > row.d) {
    row.d = row.y1 - row.y0
  }
  return row
}

// -------------------------------------------------------------- grouped rows
// A group tool's rows (the halfpipe's five) carry a shared `grp` stamp and are
// ONE object to the editor: the same translation lands on every member, and a
// rotation swings the mates rigidly about the row being handled. Pure level
// maths, here rather than Editor.jsx, so the gizmo's writeBack and the panel's
// steppers share one implementation and the node check can measure it.
export const groupOf = (table, row) => (row.grp ? TABLES[table].filter((r) => r.grp === row.grp) : [row])

export function moveGroup(table, row, dx, dz) {
  for (const r of groupOf(table, row)) { r.x += dx; r.z += dz }
}

/** Set `row`'s yaw to `yaw`; its group mates orbit it by the same delta. */
export function rotateGroup(table, row, yaw) {
  const dr = yaw - (row.rot ?? 0)
  const c = Math.cos(dr), s = Math.sin(dr)
  for (const r of groupOf(table, row)) {
    const ox = r.x - row.x, oz = r.z - row.z
    // same matrix that yaws local +Z to world (sin rot, cos rot) everywhere else
    r.x = row.x + ox * c + oz * s
    r.z = row.z - ox * s + oz * c
    r.rot = (r.rot ?? 0) + dr
  }
}

const HP_QUARTER_RUN = 2.4
const HP_DECK_RUN = 1.4
const HP_MIN_FLAT = 0.25

/** Resolve the five authored rows into their structural roles. The low box is
 *  the platform; each remaining box is paired with the quarter whose outward
 *  axis it lies along. Projection pairing still works on a malformed save
 *  where one row's depth was edited by itself. */
function halfpipeParts(table, row) {
  if (table !== 'SOLIDS' || !row.grp) return null
  const members = groupOf(table, row)
  const quarters = members.filter((r) => r.kind === 'ramp' && r.curve === 'quarter')
  const boxes = members.filter((r) => r.kind === 'box')
  if (quarters.length !== 2 || boxes.length < 3) return null
  const base = Math.max(...quarters.map((r) => r.y0))
  const platform = boxes.find((r) => Math.abs(r.top - base) < 1e-6) ?? boxes.reduce((a, b) => (a.d > b.d ? a : b))
  const unused = new Set(boxes.filter((r) => r !== platform))
  const decks = quarters.map((q) => {
    const ux = Math.sin(q.rot || 0), uz = Math.cos(q.rot || 0)
    let best = null, bestAlong = -Infinity
    for (const box of unused) {
      const along = (box.x - platform.x) * ux + (box.z - platform.z) * uz
      if (along > bestAlong) { best = box; bestAlong = along }
    }
    unused.delete(best)
    return best
  })
  return { members, quarters, decks, platform }
}

/** Resize a grouped halfpipe without pulling its five authored pieces apart.
 *
 * A quarter whose rise passes its run is healed by growing `d`. That growth
 * has to happen behind the coping: keep each low edge (and therefore the flat)
 * fixed, push its coping and top deck outward, and grow the platform under the
 * new footprint. Both facing quarters share the requested top height even
 * when the user happened to select only one of them. */
function setHalfpipeHeight(table, row, name, value) {
  if (typeof value !== 'number' || (name !== 'y1' && name !== 'top')) return false
  const parts = halfpipeParts(table, row)
  if (!parts) return false
  const { quarters, decks, platform } = parts

  const oldTop = Math.max(...quarters.map((r) => r.y1))
  const base = Math.max(...quarters.map((r) => r.y0))
  // A click on the low platform still represents the whole grouped object.
  // Its own `top` is the base, so interpret that control as a height DELTA;
  // quarter/top-deck fields already carry the halfpipe's absolute top.
  const selectedIsBase = row.kind === 'box' && Math.abs(row.top - base) < 1e-6
  const targetTop = Math.max(base + 0.25, selectedIsBase ? oldTop + value - row.top : value)

  const old = quarters.map((q) => {
    const ux = Math.sin(q.rot || 0), uz = Math.cos(q.rot || 0)
    return { q, ux, uz, d: q.d, hx: q.x + ux * q.d / 2, hz: q.z + uz * q.d / 2 }
  })
  // A pre-fix save may already have one transition grown around its centre
  // while the base stayed unchanged (the screenshot failure). Normally the
  // remaining flat is encoded by the five current extents. If that value has
  // already collapsed, recover the authored halfpipe's 3.2m flat while the
  // coordinated layout below repairs the bad centres.
  const deckRun = decks.reduce((sum, deck) => sum + deck.d, 0)
  const encodedFlat = platform.d - deckRun - old.reduce((sum, a) => sum + a.d, 0)
  // If only one side was stretched by the old bug, the untouched (shorter)
  // run still lets us recover the original symmetric flat from the platform.
  const stableFlat = platform.d - deckRun - 2 * Math.min(...old.map((a) => a.d))
  const recoveredFlat = Math.max(encodedFlat, stableFlat)
  const flat = recoveredFlat >= 0.25 ? recoveredFlat : 3.2

  for (let i = 0; i < old.length; i++) {
    const a = old[i]
    a.q.y1 = targetTop
    heal(table, a.q)
    // Re-author from the stable platform centre, not incrementally from the
    // quarter's old centre. Besides keeping a clean pipe clean, this repairs a
    // legacy save that already contains the inward-growing broken geometry.
    a.q.x = platform.x + a.ux * (flat / 2 + a.q.d / 2)
    a.q.z = platform.z + a.uz * (flat / 2 + a.q.d / 2)
    decks[i].x = platform.x + a.ux * (flat / 2 + a.q.d + decks[i].d / 2)
    decks[i].z = platform.z + a.uz * (flat / 2 + a.q.d + decks[i].d / 2)
    decks[i].top = targetTop
  }

  // The base platform spans both outer deck edges.
  platform.d = flat + quarters.reduce((sum, q) => sum + q.d, 0) + decks.reduce((sum, deck) => sum + deck.d, 0)
  return true
}

/** Width is the halfpipe's shared cross-axis span, not a property of whichever
 *  of its five rows happened to receive the click. Keep every transition,
 *  deck and the platform on one width; assigning the requested value to all
 *  members also repairs saves made while only one piece was being resized. */
function setHalfpipeWidth(table, row, name, value) {
  if (name !== 'w' || typeof value !== 'number') return false
  const parts = halfpipeParts(table, row)
  if (!parts) return false
  for (const member of parts.members) member.w = value
  return true
}

/** Length is the complete deck-to-deck footprint. The curved runs and top
 *  decks keep their authored shape; changing the overall length changes the
 *  flat between them and moves both sides symmetrically. This also heals a
 *  legacy split where one transition/deck/platform had its `d` edited alone. */
function setHalfpipeLength(table, row, name, value) {
  if (name !== 'd' || typeof value !== 'number') return false
  const parts = halfpipeParts(table, row)
  if (!parts) return false
  const { quarters, decks, platform } = parts
  const quarterRun = Math.max(HP_QUARTER_RUN, ...quarters.map((q) => q.y1 - q.y0))
  const minLength = quarterRun * 2 + HP_DECK_RUN * 2 + HP_MIN_FLAT
  const length = Math.max(minLength, value)
  const flat = length - quarterRun * 2 - HP_DECK_RUN * 2

  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i], deck = decks[i]
    const ux = Math.sin(q.rot || 0), uz = Math.cos(q.rot || 0)
    q.d = quarterRun
    deck.d = HP_DECK_RUN
    q.x = platform.x + ux * (flat / 2 + quarterRun / 2)
    q.z = platform.z + uz * (flat / 2 + quarterRun / 2)
    deck.x = platform.x + ux * (flat / 2 + quarterRun + HP_DECK_RUN / 2)
    deck.z = platform.z + uz * (flat / 2 + quarterRun + HP_DECK_RUN / 2)
  }
  platform.d = length
  return true
}

/** Value the editor should show for a physical dimension. A halfpipe member's
 *  local `d` is an implementation detail; its user-facing Length is the whole
 *  platform footprint regardless of which of the five rows was clicked. */
export function dimensionValue(table, row, name) {
  const parts = name === 'd' && halfpipeParts(table, row)
  return parts ? parts.platform.d : row[name]
}

/** Write one inspector field. Goes through heal() because `kind` and `style`
 *  change which OTHER fields the row is required to carry. */
export function setField(table, row, name, value) {
  // Position/yaw on a grouped row is a whole-group transform — the fine-tune
  // card and the gizmo must agree on what "move the halfpipe" means. Only for
  // real numbers: the raw inputs park a half-typed draft string in the field,
  // and a NaN delta would poison all five rows at once.
  if (row.grp && typeof value === 'number') {
    if (name === 'x' || name === 'z') return moveGroup(table, row, name === 'x' ? value - row.x : 0, name === 'z' ? value - row.z : 0), row
    if (name === 'rot') return rotateGroup(table, row, value), row
    if (setHalfpipeWidth(table, row, name, value)) return row
    if (setHalfpipeLength(table, row, name, value)) return row
    if (setHalfpipeHeight(table, row, name, value)) return row
  }
  row[name] = value
  return heal(table, row)
}

// ------------------------------------------------------------------ rails
// A rail IS its points — no w/d/h, no `rot`, no `y` — so the card's DIMS,
// rotate and lift rows all skip it, and a selected rail offered material
// swatches and nothing else: the only way to make one longer was the raw
// `pts` array, which the fine-tune drawer hides (HIDDEN). These four are the
// rail's steppers. Extending pushes the LAST point along the FINAL segment,
// which is what "longer" means on a curved rail as well as a straight one.
export const railLength = (row) =>
  row.pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - row.pts[i - 1][0], p[1] - row.pts[i - 1][1], p[2] - row.pts[i - 1][2]) : 0), 0)

/** Lengthen (or shorten) by `by` metres off the far end. */
export function extendRail(row, by) {
  const p = row.pts, b = p[p.length - 1], a = p[p.length - 2]
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  const l = Math.hypot(dx, dy, dz)
  // A zero-length final segment has no direction left, so a rail shrunk to
  // nothing could never be grown again — and rebuildPaths drops it anyway.
  if (!(l > 1e-4)) return row
  const k = Math.max(by, 0.5 - l) / l
  b[0] += dx * k; b[1] += dy * k; b[2] += dz * k
  return row
}

/** Yaw every point about the rail's own centre — its stand-in for `rot`. */
export function turnRail(row, a) {
  const c = Math.cos(a), s = Math.sin(a), n = row.pts.length
  let cx = 0, cz = 0
  for (const p of row.pts) { cx += p[0] / n; cz += p[2] / n }
  for (const p of row.pts) {
    const x = p[0] - cx, z = p[2] - cz
    // same matrix that yaws local +Z to world (sin rot, cos rot) everywhere else
    p[0] = cx + x * c + z * s
    p[2] = cz - x * s + z * c
  }
  return row
}

/** Raise/lower the whole rail, keeping its slope. Floor is the posts' minimum. */
export function liftRail(row, dy) {
  let lo = Infinity
  for (const p of row.pts) lo = Math.min(lo, p[1])
  const d = Math.max(dy, 0.2 - lo)
  for (const p of row.pts) p[1] += d
  return row
}

/** Resample a polyline to `n` evenly spaced points. A two-point rail has no
 *  interior points to move, so bending has to give it some first. */
function resamplePts(pts, n) {
  const L = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
    L.push(d)
    total += d
  }
  if (!(total > 1e-4)) return pts.map((p) => p.slice())
  const out = []
  for (let k = 0; k < n; k++) {
    let s = (total * k) / (n - 1)
    let i = 0
    while (i < L.length - 1 && s > L[i]) { s -= L[i]; i++ }
    const t = L[i] > 1e-6 ? s / L[i] : 0
    out.push([0, 1, 2].map((j) => pts[i][j] + (pts[i + 1][j] - pts[i][j]) * t))
  }
  return out
}

/** Bow the rail by `a` radians of TOTAL arc. Each segment is yawed by an equal
 *  share of it and the chain rebuilt end to end, so segment lengths — and
 *  therefore railLength — are untouched: Bend and Length stay independent
 *  steppers. The result is recentred on the old centroid, or bending would
 *  also walk the rail across the park. */
export function bendRail(row, a) {
  const p = row.pts.length >= 5 ? row.pts.map((q) => q.slice()) : resamplePts(row.pts, 5)
  const m = p.length - 1
  if (m < 1) return row
  let cx = 0, cz = 0
  for (const q of p) { cx += q[0] / p.length; cz += q[2] / p.length }
  const out = [[0, p[0][1], 0]]
  for (let i = 0; i < m; i++) {
    const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][2] - p[i][2]
    const th = (i - (m - 1) / 2) * (a / m)
    const c = Math.cos(th), s = Math.sin(th)
    const b = out[i]
    out.push([b[0] + dx * c - dz * s, p[i + 1][1], b[2] + dx * s + dz * c])
  }
  let nx = 0, nz = 0
  for (const q of out) { nx += q[0] / out.length; nz += q[2] / out.length }
  for (const q of out) { q[0] += cx - nx; q[2] += cz - nz }
  row.pts = out
  return row
}

// ponytail: still no per-POINT handle — bend/extend/turn/lift cover shaping a
// rail from the card. Add one in Editor.jsx if freeform kinks are ever wanted.

export const canAdd = (table) => table in DEFAULTS

/** The palette. ONE list, shared by the panel (label, glyph, tint) and
 *  Editor.jsx (the 1..9 bindings and the cursor ghost's size), so the two
 *  cannot drift — the ghost dimensions used to be hand-copied from DEFAULTS
 *  and went stale silently.
 *
 *  A tool is not a table: SOLIDS is three different shapes behind one `kind`
 *  field, and a "Ramps" button that dropped a flat 0.4 ledge was the single
 *  most confusing thing in the editor. `patch` is what the tool means. */
export const TOOLS = [
  { id: 'ramp', table: 'SOLIDS', label: 'Ramp', glyph: '🛝', tint: '#ffd9ac', ghost: [4, 1.6, 5, 0.8], patch: { kind: 'ramp', d: 5, y0: 0, y1: 1.6, curve: 'linear' } },
  { id: 'quarter', table: 'SOLIDS', label: 'Quarter', glyph: '🌊', tint: '#ffcfa0', ghost: [6, 2, 3.2, 1], patch: { kind: 'ramp', w: 6, d: 3.2, y0: 0, y1: 2, curve: 'quarter' } },
  { id: 'ledge', table: 'SOLIDS', label: 'Ledge', glyph: '📦', tint: '#ffe0c0', ghost: [4, 0.4, 4, 0.2], patch: { kind: 'box' } },
  { id: 'stairs', table: 'SOLIDS', label: 'Stairs', glyph: '🪜', tint: '#ffdfb2', ghost: [4, 1.6, 4, 0.8], patch: { kind: 'stairs', y0: 0, y1: 1.6, steps: 6 } },
  // One click, five rows — the shipped hpDeck/hpN/hpS/hpDeckN/hpDeckS recipe
  // (HP_FLAT 3.2, HP_H 2.0, base 0.35), hardcoded here the same way the swatch
  // hexes mirror C.*. `group` rows are offset along local +Z (dz) and yawed
  // relative to the placement (drot); the top decks exist because a
  // freestanding quarter is zero-thickness at its lip. `patch` is only the
  // placement footprint for placementInfo — the group is what actually lands.
  // Listed after ledge so the panel's patch-kind lookup still resolves a
  // selected box row to the Ledge tool, not this one.
  { id: 'halfpipe', table: 'SOLIDS', label: 'Halfpipe', glyph: '🛹', tint: '#b5ddf0', ghost: [12, 2.35, 10.8, 1.175],
    patch: { kind: 'box', w: 12, d: 10.8, top: 2.35, style: 'solid' },
    group: [
      { kind: 'box', w: 12, d: 10.8, top: 0.35, style: 'solid' },
      { kind: 'ramp', w: 12, d: HP_QUARTER_RUN, dz: -2.8, drot: Math.PI, y0: 0.35, y1: 2.35, curve: 'quarter', style: 'solid' },
      { kind: 'ramp', w: 12, d: HP_QUARTER_RUN, dz: 2.8, drot: 0, y0: 0.35, y1: 2.35, curve: 'quarter', style: 'solid' },
      { kind: 'box', w: 12, d: HP_DECK_RUN, dz: -4.7, top: 2.35, style: 'solid' },
      { kind: 'box', w: 12, d: HP_DECK_RUN, dz: 4.7, top: 2.35, style: 'solid' },
    ] },
  { id: 'wall', table: 'WALLS', label: 'Wall', glyph: '🧱', tint: '#ffcbcb', ghost: [4, 1.15, 0.6, 0.575] },
  { id: 'rail', table: 'RAILS', label: 'Rail', glyph: '🛤️', tint: '#c8e6ff', ghost: [6, 0.4, 0.4, 0.55] },
  { id: 'planter', table: 'PLANTERS', label: 'Planter', glyph: '🌷', tint: '#d7f3c2', ghost: [3, 0.95, 3, 0.475] },
  { id: 'bench', table: 'BENCHES', label: 'Bench', glyph: '🪑', tint: '#ffe7b6', ghost: [1.7, 0.5, 0.6, 0.25] },
  { id: 'lamp', table: 'LAMPS', label: 'Lamp', glyph: '💡', tint: '#fff2ad', ghost: [0.5, 3, 0.5, 1.5] },
  { id: 'can', table: 'CANS', label: 'Can', glyph: '🗑️', tint: '#cff0ea', ghost: [0.7, 1, 0.7, 0.5] },
  { id: 'bone', table: 'BONES', label: 'Bone', glyph: '🦴', tint: '#ece2ff', ghost: [0.9, 0.9, 0.9, 1.6] },
  { id: 'letter', table: 'LETTERS', label: 'Letter', glyph: '🔤', tint: '#ffd4ef', ghost: [0.9, 0.9, 0.9, 1.6] },
  // One analytic pool exists at most. Editor.jsx handles this special tool by
  // placing BOWL itself rather than adding a table row.
  { id: 'pool', table: null, special: 'pool', label: 'Pool', glyph: '🏊', tint: '#c8e6ff', ghost: [11.7, 0.08, 11.7, 0.04] },
]
export const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]))

/** Material-ish fields per table, as swatch options the panel renders on the
 *  selection card. A function of the row because SOLIDS' options change with
 *  `kind` (a staircase has no style at all). Swatch hexes mirror palette.js
 *  C.* the same way TOOLS' tints do — hardcoded, so this module stays loadable
 *  by the node checks without dragging the palette in. */
export const LOOKS = {
  SOLIDS: (r) =>
    r.kind === 'stairs'
      ? null
      : {
          name: 'style',
          options:
            r.kind === 'ramp'
              ? [
                  { v: 'concrete', label: 'Concrete', swatch: '#b8b2c6' },
                  { v: 'solid', label: 'Blue on plywood', swatch: '#9fd4e8' },
                ]
              : [
                  { v: 'concrete', label: 'Concrete', swatch: '#b8b2c6' },
                  { v: 'ledge', label: 'Stone ledge', swatch: '#d8d2e2' },
                  { v: 'deck', label: 'Deck inset', swatch: '#a49dba' },
                  { v: 'solid', label: 'Blue slab', swatch: '#9fd4e8' },
                ],
        },
  WALLS: () => ({
    name: 'mural',
    options: [
      { v: null, label: 'Plain', swatch: '#cfc4e6' },
      { v: 'flower', label: 'Flower', swatch: '#f2a3b8' },
      { v: 'rainbow', label: 'Rainbow', swatch: 'linear-gradient(180deg,#f2a3b8,#f0d47f,#9fd9c4)' },
      { v: 'skate', label: 'Skateboard', swatch: '#9fd9c4' },
      { v: 'paws', label: 'Paw trail', swatch: '#f7c6a4' },
      { v: 'sunshine', label: 'Sunshine', swatch: '#f0d47f' },
    ],
  }),
  RAILS: () => ({
    name: 'color',
    options: [
      { v: 'railTeal', label: 'Teal', swatch: '#3ab4b8' },
      { v: 'railPink', label: 'Pink', swatch: '#f2a3b8' },
      { v: 'railYellow', label: 'Yellow', swatch: '#f0d47f' },
      { v: 'railMint', label: 'Mint', swatch: '#8ad8c4' },
    ],
  }),
  PLANTERS: () => ({
    name: 'plant',
    options: [
      { v: 'flowers', label: 'Flower bed', swatch: '#f2a3b8' },
      { v: 'tree', label: 'Blossom tree', swatch: '#8db56a' },
    ],
  }),
  LAMPS: () => ({
    name: 'banner',
    options: [
      { v: null, label: 'No banner', swatch: '#3f9083' },
      { v: 'skate', label: 'Skate banner', swatch: '#9fd9c4' },
      { v: 'flower', label: 'Flower banner', swatch: '#f2a3b8' },
    ],
  }),
}

// ------------------------------------------------------ placement validation
// Pure level queries shared by the cursor ghost and the placement click. A red
// warning is authoritative: the same result that colours the ghost also sets
// `block`, so preview and behavior cannot disagree.
const BLOCK_TABLES = ['SOLIDS', 'WALLS', 'PLANTERS', 'BENCHES']

/** [hx, hz, top] of a row's world AABB (conservative under yaw), or null for
 *  tables that don't block (rails, floaters). A wall's cap top is absolute
 *  `h` — `base` does not add (rails.js reads it the same way). */
function extents(table, r) {
  let w, d, top
  if (table === 'SOLIDS') { w = r.w; d = r.d; top = r.kind === 'box' ? r.top : r.y1 }
  else if (table === 'WALLS') { w = r.w; d = r.d; top = r.h }
  else if (table === 'PLANTERS') { w = r.w; d = r.d; top = (r.base || 0) + r.h }
  else if (table === 'BENCHES') { w = 1.7; d = 0.6; top = 0.5 }
  else if (table === 'LAMPS') { w = 0.5; d = 0.5; top = 3 }
  else if (table === 'CANS') { w = 0.7 * (r.scale ?? 1); d = 0.7 * (r.scale ?? 1); top = 1 * (r.scale ?? 1) }
  else return null
  const c = Math.abs(Math.cos(r.rot || 0)), s = Math.abs(Math.sin(r.rot || 0))
  return [(w * c + d * s) / 2, (w * s + d * c) / 2, top]
}

const inside = (px, pz, r, e) => Math.abs(px - r.x) < e[0] && Math.abs(pz - r.z) < e[1]
const nameOf = (table, r) => r.id ?? `the ${table.toLowerCase().replace(/s$/, '')}`

/** What placing `toolId` at (x, z, rot) would run into. `warn` supplies the
 *  hint/red preview and also implies `block`; matchTop is a deck top the ramp's
 *  rise should meet (the vertical twin of the flush-face snap). */
export function placementInfo(toolId, x, z, rot = 0) {
  const tool = TOOL[toolId]
  if (!tool) return { warn: null, matchTop: null, block: false }
  if (tool.special === 'pool') return { warn: null, matchTop: null, block: false }
  const cand = heal(tool.table, { ...DEFAULTS[tool.table](), ...tool.patch, x, z, rot })
  return rowInfo(tool.table, cand, tool.label)
}

function rowInfo(table, cand, label = 'It') {
  const me = extents(table, cand)
  if (!me) return { warn: null, matchTop: null, block: false }
  // The pool is a HOLE — a grounded row footed inside it floats on air the
  // plaza no longer draws. Floaters (bones, letters) never reach here because
  // extents() has no case for them, so an air line over the bowl still works.
  if (BOWL.on) {
    for (const [px, pz] of [
      [cand.x, cand.z],
      [cand.x - me[0], cand.z - me[1]], [cand.x + me[0], cand.z - me[1]],
      [cand.x - me[0], cand.z + me[1]], [cand.x + me[0], cand.z + me[1]],
    ]) {
      if (isInsideBowl(px, pz)) return { warn: `${label} can't stand in the pool`, matchTop: null, block: true }
    }
  }
  const rampish = table === 'SOLIDS' && cand.kind !== 'box'
  // local +Z is a ramp's HIGH edge (Skatepark draws the coping at +d/2);
  // rot yaws it to world (sin rot, cos rot).
  const dx = Math.sin(cand.rot || 0), dz = Math.cos(cand.rot || 0)
  const hd = rampish ? cand.d / 2 : 0

  // matchTop FIRST: the overlap test judges legality against the rise the
  // placement will actually land with, or a quarter dropped against a taller
  // deck warns about the very bury the height-match is about to prevent.
  let matchTop = null
  if (rampish) {
    const hx = cand.x + dx * (hd + 0.4), hz = cand.z + dz * (hd + 0.4)
    for (const r of TABLES.SOLIDS) {
      if (r === cand || r.kind !== 'box') continue
      const e = extents('SOLIDS', r)
      if (inside(hx, hz, r, e) && r.top > (cand.y0 ?? 0) + 0.3 && r.top > (matchTop ?? 0)) matchTop = r.top
    }
  }
  const effY1 = rampish ? Math.max(cand.y1, matchTop ?? 0) : 0
  if (matchTop !== null && Math.abs(matchTop - cand.y1) < 0.01) matchTop = null

  let warn = null
  for (const t of BLOCK_TABLES) {
    for (const r of TABLES[t]) {
      if (r === cand) continue
      const e = extents(t, r)
      if (!e) continue
      // small margin so an exactly-flush neighbour (the snap's whole job)
      // never reads as an overlap
      if (Math.abs(cand.x - r.x) >= me[0] + e[0] - 0.05 || Math.abs(cand.z - r.z) >= me[1] + e[1] - 0.05) continue
      const otherFlat = t === 'SOLIDS' && r.kind === 'box'
      // A ramp overlapping a FLAT no taller than its own top is the designed
      // deck hole (colliders' rampTopAt) — legal in either direction.
      const legal =
        (rampish && otherFlat && e[2] <= effY1 + 0.01) ||
        (table === 'SOLIDS' && cand.kind === 'box' && t === 'SOLIDS' && r.kind !== 'box' && me[2] <= r.y1 + 0.01)
      if (!legal && !warn) warn = `Overlaps ${nameOf(t, r)} — it would be buried`
    }
  }

  if (rampish) {
    // The bank1 mistake: a transition whose approach lane is solid. Probe a
    // couple of metres off the LOW edge; anything unsteppable there means the
    // only way onto this ramp is through a wall.
    const lx = cand.x - dx * (hd + 2.2), lz = cand.z - dz * (hd + 2.2)
    for (const t of BLOCK_TABLES) {
      for (const r of TABLES[t]) {
        if (r === cand) continue
        const e = extents(t, r)
        if (e && e[2] > STEP_UP + 0.01 && inside(lx, lz, r, e)) {
          warn = `${label}'s low end has no run-up — R turns it`
        }
      }
    }
  }

  return { warn, matchTop, block: !!warn }
}

/** Add a fresh row at (x, z), yawed by `rot`. `what` is a TOOL id or a bare
 *  table name. Returns it. */
export function addRow(what, x = 0, z = 0, rot = 0) {
  const tool = TOOL[what]
  const table = tool?.table ?? what
  begin()
  // A multi-row tool (the halfpipe): N rows in ONE snapshot, so a misplaced
  // pipe is one undo, not five. Offsets ride the same local-+Z convention as
  // everything else: world = (x + dz·sin rot, z + dz·cos rot).
  if (tool?.group) {
    const c = Math.cos(rot), s = Math.sin(rot)
    // The shared stamp that makes five rows ONE object to the editor: moveGroup/
    // rotateGroup/duplicateRow/deleteRow all fan out over it.
    const grp = `${tool.id}${nextKey + 1}`
    let first = null
    for (const { dz = 0, drot = 0, ...spec } of tool.group) {
      const row = heal(table, { ...DEFAULTS[table](), ...spec, x: x + dz * s, z: z + dz * c, rot: rot + drot })
      row.id = `${tool.id}${nextKey + 1}`
      row.grp = grp
      keyOf(row)
      TABLES[table].push(row)
      first ??= row
    }
    commit()
    sfxPlace(tool.ghost[1])
    return first
  }
  const row = heal(table, { ...DEFAULTS[table](), ...tool?.patch, x, z })
  // Only tables whose renderer READS rot; everything else would carry a field
  // nothing draws and the placed object would silently ignore the ghost.
  if (rot && 'rot' in row) row.rot = rot
  // Name it after the TOOL, not the table: DEFAULTS.SOLIDS spells `box7`, and a
  // quarterpipe called box7 is a row you can't find in the outliner.
  if (tool && row.id) row.id = `${tool.id}${nextKey + 1}`
  // A rail has no rot — it IS its points, so the ghost's yaw turns them about
  // the placement point.
  if (table === 'RAILS') {
    const c = Math.cos(rot), s = Math.sin(rot)
    row.pts = row.pts.map(([px, py, pz]) => [x + px * c + pz * s, py, z - px * s + pz * c])
  }
  // The vertical twin of the flush-face snap: a transition dropped against a
  // taller deck meets that deck's top instead of arriving at its default rise.
  if (row.kind === 'ramp' || row.kind === 'stairs') {
    const { matchTop } = rowInfo(table, row, tool?.label ?? 'It')
    // heal again: a matched rise can outgrow a quarter's run
    if (matchTop) heal(table, ((row.y1 = matchTop), row))
  }
  keyOf(row)
  TABLES[table].push(row)
  commit()
  sfxPlace(row.y1 ?? row.top ?? row.h ?? tool?.ghost[1] ?? 1)
  return row
}

export function duplicateRow(table, row) {
  begin()
  // Duplicating any member of a grouped object copies the WHOLE group under a
  // fresh stamp — a lone copy still carrying the old grp would drag the
  // original pipe around with it.
  const src = groupOf(table, row)
  const grp = row.grp && `${row.grp}_copy${nextKey + 1}`
  let picked = null
  for (const r of src) {
    const copy = { ...r }
    delete copy.__k
    if (grp) copy.grp = grp
    if (copy.id) copy.id = `${copy.id}_copy${nextKey + 1}`
    if (r.pts) copy.pts = r.pts.map((p) => [p[0] + 1, p[1], p[2] + 1])
    else (copy.x += 1), (copy.z += 1)
    keyOf(copy)
    TABLES[table].push(copy)
    if (r === row) picked = copy
  }
  commit()
  return picked
}

export function deleteRow(table, row) {
  deleteRows([{ table, row }])
}

/** Delete an additive selection as one edit/undo step. Grouped rows are
 * expanded and de-duplicated first, so selecting two pieces of one halfpipe
 * still removes that halfpipe exactly once. */
export function deleteRows(selection) {
  const goneByTable = new Map()
  for (const { table, row } of selection) {
    if (!TABLES[table]?.includes(row)) continue
    let gone = goneByTable.get(table)
    if (!gone) goneByTable.set(table, (gone = new Set()))
    for (const member of groupOf(table, row)) gone.add(member)
  }
  if (!goneByTable.size) return 0
  begin()
  let count = 0
  for (const [table, gone] of goneByTable) {
    const keep = TABLES[table].filter((r) => !gone.has(r))
    count += TABLES[table].length - keep.length
    TABLES[table].length = 0
    TABLES[table].push(...keep)
  }
  commit()
  sfxDelete()
  return count
}

// ------------------------------------------------------------------- export
// Clipboard, not codegen. levelData.js is ~60% load-bearing commentary and its
// rows carry derived expressions (`h: DECK + 0.7`, `rot: Math.PI`); a
// round-tripper would flatten both. You paste the table and read the diff.
const clean = (r) => {
  const o = { ...r }
  delete o.__k
  return o
}

export const tableJSON = (table) =>
  '[\n' + editable(table).map((r) => '  ' + JSON.stringify(clean(r))).join(',\n') + ',\n]'

export const allJSON = () =>
  `// CHARACTERS\n${JSON.stringify(characterSnapshot(), null, 2)}\n\n` +
  Object.keys(TABLES).map((t) => `// ${t}\n${tableJSON(t)}`).join('\n\n')

export function copy(text) {
  navigator.clipboard?.writeText(text)
}

// -------------------------------------------------------------- blank / reset
/** Empty every table. Safe with respect to `derived` rows: the handrail IIFE
 *  and arcWall() ran at module load and pushed plain rows, so there is no
 *  generator left to disagree with an empty table — a cleared level stays
 *  cleared until resetLevel() puts the shipped snapshot back. */
export function clearAll() {
  begin()
  for (const arr of Object.values(TABLES)) arr.length = 0
  BOWL.on = false
  commit()
}

/** Put the shipped park back and forget the save. JSON round-trip rather than
 *  handing the snapshot's own row objects out: SHIPPED is restored more than
 *  once, and the next edit would mutate it. */
export function resetLevel() {
  begin()
  restore(JSON.parse(SHIPPED))
  clearSaved()
}

export function setSpawn(x, z) {
  begin()
  SPAWN.x = x
  SPAWN.z = z
  commit()
}

/** Place the one pool entity. Reusing the tool relocates it rather than
 * creating an impossible second analytic bowl. */
export function placeBowl(x, z) {
  begin()
  Object.assign(BOWL, { on: true, cx: x, cz: z })
  rekeyBowl()
  commit()
  sfxPlace(BOWL.depthMid)
}

export function deleteBowl() {
  if (!BOWL.on) return
  begin()
  BOWL.on = false
  rekeyBowl()
  commit()
  sfxDelete()
}

/** Move / resize / deepen the pool.
 *  `underDrag` skips the snapshot: a gizmo drag already pushed one on
 *  dragging-changed, and two snapshots is two undos for one drag. */
export function setBowl(patch, underDrag = false) {
  if (!underDrag) begin()
  Object.assign(BOWL, patch)
  rekeyBowl()
  commit()
}

// Also strips pool furniture from pre-change saves; the loops remain harmless
// for current levels, where the pool owns no WALLS or BENCHES rows.
function rekeyBowl() {
  rebuildBowlDerived()
  for (const r of WALLS) keyOf(r)
  for (const r of BENCHES) keyOf(r)
}

// -------------------------------------------------------------- persistence
const KEY = 'skatedog.level'
const store = () => (typeof localStorage === 'undefined' ? null : localStorage)

const levelBlob = () => ({
  tables: Object.fromEntries(Object.entries(TABLES).map(([k, rows]) => [k, rows.map(clean)])),
  spawn: { ...SPAWN },
  bowl: { ...BOWL },
  scene: sceneSnapshot(),
  characters: characterSnapshot(),
  rules: runRules(),
})

export function saveLevel() {
  const ls = store()
  if (!ls) return
  try {
    ls.setItem(KEY, JSON.stringify(levelBlob()))
  } catch {
    // quota, private mode — the level still works, it just won't survive F5
  }
}

export const hasSaved = () => !!store()?.getItem(KEY)
export const clearSaved = () => store()?.removeItem(KEY)

// The shipped park, taken BEFORE any save is applied — this is what resetLevel
// restores to, so it must not see the user's edits.
const SHIPPED = JSON.stringify(snap())

/** Start the editor as a genuinely new document. This intentionally bypasses
 * history and autosave: opening Build a Park should not offer the shipped park
 * (or the last named mode) as an undo step, and the header should read NEW
 * until the first authored edit is committed. */
function initializeBlankEditor() {
  for (const arr of Object.values(TABLES)) arr.length = 0
  BOWL.on = false
  setRunRules()
  clearSaved()
  past.length = 0
  future.length = 0
  useEditor.setState({
    table: 'SOLIDS',
    row: null,
    selection: [],
    add: null,
    bowlSel: false,
    specialSel: null,
    undoAvailable: false,
    redoAvailable: false,
  })
  resetPlayer()
  bumpLevel({ persist: false })
}

/** Apply the saved level, if there is one. Returns whether it did.
 *  A corrupt or stale blob (a table renamed, a hand-edited value) falls back to
 *  the shipped park silently — a throw at import takes the whole game down
 *  before the canvas mounts, over a debug feature. */
export function loadLevel() {
  try {
    const raw = store()?.getItem(KEY)
    return applyBlob(raw && JSON.parse(raw))
  } catch {
    return false
  }
}

/** Apply a level blob (the workbench autosave or a named user level). Same
 *  fallback contract as loadLevel — a bad blob restores the shipped park. */
export function applyBlob(data) {
  try {
    if (!data?.tables) return false
    for (const [k, rows] of Object.entries(data.tables)) {
      if (!TABLES[k] || !Array.isArray(rows)) continue
      TABLES[k].length = 0
      // Restored rows carry no __k (clean() strips it) — stamp a fresh one or
      // every React key in the panel and the proxy layer is undefined.
      // heal() as well as key: a level saved before NEEDS existed is missing
      // rot/base and would reload straight back into the NaN crash.
      for (const r of rows) TABLES[k].push((keyOf(r), heal(k, r)))
    }
    rebuildBowlDerived()
    // The shipped halfpipe existed before grouped editing. Preserve old local
    // and named saves, but migrate its five stable ids so resizing a legacy
    // copy cannot pull one transition out of the structure again.
    const oldHalfpipe = ['hpDeck', 'hpN', 'hpS', 'hpDeckN', 'hpDeckS'].map((id) => SOLIDS.find((r) => r.id === id))
    if (oldHalfpipe.every(Boolean) && oldHalfpipe.some((r) => !r.grp)) {
      for (const r of oldHalfpipe) r.grp = 'halfpipe'
      const wall = oldHalfpipe.find((r) => r.kind === 'ramp')
      setHalfpipeHeight('SOLIDS', wall, 'y1', Math.max(...oldHalfpipe.filter((r) => r.kind === 'ramp').map((r) => r.y1)))
    }
    // Width/length used to edit only the clicked member. Normalize every
    // grouped halfpipe on load so an already-saved split structure repairs
    // without requiring the user to find and touch each broken piece again.
    const normalizedGroups = new Set()
    for (const r of SOLIDS) {
      if (!r.grp || normalizedGroups.has(r.grp) || !halfpipeParts('SOLIDS', r)) continue
      normalizedGroups.add(r.grp)
      setHalfpipeWidth('SOLIDS', r, 'w', Math.max(...groupOf('SOLIDS', r).map((member) => member.w)))
      setHalfpipeLength('SOLIDS', r, 'd', dimensionValue('SOLIDS', r, 'd'))
    }
    if (data.spawn) Object.assign(SPAWN, data.spawn)
    // Older blobs stored just the on/off flag.
    if (typeof data.bowl === 'boolean') BOWL.on = data.bowl
    else if (data.bowl) Object.assign(BOWL, data.bowl)
    if (data.scene) {
      // Removed editor looks (including the brick pattern) fall back through
      // the live option tables instead of leaving an invisible stale choice.
      useSceneSettings.setState({
        time: timeOf(data.scene.time).id,
        ground: groundOf(data.scene.ground).id,
        pattern: patternOf(data.scene.pattern).id,
      })
    }
    if (data.characters) applyCharacterSizes(data.characters.dog, data.characters.boy)
    setRunRules(data.rules)
    // Named levels are applied after P was created from the shipped spawn.
    // Re-read the newly applied SPAWN before the start card releases the sim.
    resetPlayer()
    bumpLevel()
    return true
  } catch {
    restore(JSON.parse(SHIPPED))
    return false
  }
}

// --------------------------------------------------------------- user levels
// Named saves, separate from the workbench autosave above: `saveLevelAs` in
// the editor appends here, the home screen lists them, and `?level=<id>` plays
// one. Each entry carries its own blob + a small jpeg thumbnail data-URL.
const LEVELS_KEY = 'skatedog.levels'

// Four lanes of tightly packed 3x3 can bundles, with oversized turn markers.
// A giant dog running through the middle of a bundle catches the whole pack at
// once, so the course reads as repeated bursts of destruction instead of a
// sparse slalom. The serpentine line still fits comfortably inside 30 seconds.
const trashCans = (() => {
  const cans = []
  const xs = [-21, -7, 7, 21]
  const zs = [18, 8, -2, -12]
  const packed = [-0.72, 0, 0.72]
  for (let row = 0; row < zs.length; row++) {
    const line = row % 2 ? xs.slice().reverse() : xs
    for (const cx of line) {
      for (const dx of packed) {
        for (const dz of packed) {
          const n = cans.length + 1
          cans.push({ id: `trash${n}`, x: cx + dx, z: zs[row] + dz, scale: 1 })
        }
      }
    }
    if (row < zs.length - 1) {
      const turnX = row % 2 ? -27 : 27
      cans.push(
        { id: `trashTurn${row + 1}a`, x: turnX, z: zs[row] - 3, scale: 2.8 },
        { id: `trashTurn${row + 1}b`, x: turnX, z: zs[row] - 7, scale: 2.8 },
      )
    }
  }
  cans.push({ id: 'trashFinish', x: -28, z: -12, scale: 3.2 })
  return cans
})()

const dogBowlingLevel = {
  id: 'dog-bowling',
  name: 'Dog Bowling',
  builtIn: true,
  icon: '🎳',
  description: `30 sec · Bowl over ${trashCans.length} cans`,
  data: {
    tables: Object.fromEntries(Object.keys(TABLES).map((table) => [table, table === 'CANS' ? trashCans : []])),
    spawn: { x: -30, z: 18, heading: Math.PI / 2 },
    bowl: { ...BOWL, on: false },
    scene: { time: 'sunset', ground: 'classic', pattern: 'slabs' },
    // The dog is the bowling ball; the rider stays at the shipped 1.58 size.
    // Both still go through the size-aware mount and animation paths.
    characters: { dog: 2.4, boy: 1.58 },
    rules: { time: 30, goalIds: ['cans'], timeBonus: 0, subtitle: 'Smash every trash can before time runs out' },
  },
}

function storedLevels() {
  try {
    return JSON.parse(store()?.getItem(LEVELS_KEY) || '[]')
  } catch {
    return []
  }
}

export function listLevels() {
  return storedLevels()
}

/** Shipped special modes live beside, never inside, the user's saved parks. */
export function listChallenges() {
  return [dogBowlingLevel]
}

export function saveLevelAs(name, thumb) {
  const entry = { id: Date.now().toString(36), name, at: Date.now(), thumb, data: levelBlob() }
  const write = (list) => store()?.setItem(LEVELS_KEY, JSON.stringify(list))
  try {
    write([entry, ...storedLevels()])
    return true
  } catch {
    // quota — the thumbnail is the heavy part, retry without it
    try {
      write([{ ...entry, thumb: null }, ...storedLevels()])
      return true
    } catch {
      return false
    }
  }
}

export function deleteUserLevel(id) {
  try {
    store()?.setItem(LEVELS_KEY, JSON.stringify(storedLevels().filter((l) => l.id !== id)))
  } catch {
    // private mode — nothing was saved to delete
  }
}

/** Editor.jsx installs a live canvas grab here (it needs gl/scene/camera);
 *  the DOM panel calls it at save time. Null outside the editor. */
export const thumbCapture = { fn: null }

// A plain editor visit is always a new blank document. An explicit
// `/edit?level=<id>` remains available for opening a named park on purpose;
// ordinary gameplay at `?level=<id>` never leaks into the next editor visit.
if (EDIT) {
  const id = typeof location !== 'undefined' && new URLSearchParams(location.search).get('level')
  const named = id && [...listLevels(), ...listChallenges()].find((level) => level.id === id)
  if (named) applyBlob(named.data)
  else initializeBlankEditor()
} else if (typeof location !== 'undefined') {
  const id = new URLSearchParams(location.search).get('level')
  if (id) applyBlob([...listLevels(), ...listChallenges()].find((l) => l.id === id)?.data)
}
