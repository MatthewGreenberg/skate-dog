// Level editor DOM panel. Lives OUTSIDE the Canvas (Game.jsx mounts it under
// ?edit); the 3D half — picking, placing and gizmos — is Editor.jsx.
//
// It is laid out as three questions in the order you actually ask them: WHAT
// do I want (the tool palette), WHERE does it go (one hint line, then you click
// the park), and IS IT RIGHT (a card of size / rotate / height steppers).
// Everything that is a number rather than a decision — raw fields, the
// outliner, JSON export — is folded into <details>, because a panel that opens
// on 20 labelled inputs teaches you it is a spreadsheet with a park attached.
//
// The steppers are the point: one click on Bigger is unambiguous, where
// `w: 4.25` is two decisions (which field, what number) before you learn
// anything. The raw fields are still there for when you know what you want.
// The tone is direct, not cute — this is a tool.
//
// Not leva, even though leva is already a dependency: a useControls schema is
// fixed at the hook call, and an inspector's fields change with whatever row is
// selected. Building one hook per table's union of fields is more code than
// this, and still wrong for RAILS (which has no x/z at all).

import { useEffect, useRef, useState } from 'react'
import {
  EDIT, keyOf, useLevelVersion, useEditor, TOOLS, TOOL, LOOKS, setBowl,
  begin, commit, undo, redo, canUndo, canRedo,
  editable, duplicateRow, deleteRow,
  clearAll, resetLevel, hasSaved, toggleBowl, BOWL, SPAWN, setField,
  railLength, extendRail, turnRail, liftRail,
  useSceneSettings, TIMES, GROUNDS, PATTERNS, setScene,
  setCharacterSize,
  tableJSON, allJSON, copy,
  saveLevelAs, thumbCapture,
} from '../level/levelEdits.js'
import { useCharacterSize, CHARACTER_LIMITS } from './dogFit.js'

// The palette itself lives in levelEdits (TOOLS): Editor.jsx binds 1..9 off the
// same list and needs each tool's ghost footprint, and two copies of a palette
// drift the moment one gains an entry.

// Enum fields, by the name levelData gives them. `null` is a real authored
// value on mural/banner ("no mural"), so it gets its own option rather than
// being spelled as the empty string in the row.
const ENUMS = {
  style: ['concrete', 'deck', 'ledge', 'solid'],
  mural: [null, 'flower', 'rainbow', 'skate', 'paws', 'sunshine'],
  plant: ['tree', 'flowers'],
  banner: [null, 'skate', 'flower'],
  color: ['railTeal', 'railPink', 'railYellow', 'railMint'],
  posts: ['flat', 'ledge', 'stair'],
  curve: ['linear', 'quarter'],
  kind: ['box', 'ramp', 'stairs'],
}

// __k is our own React key, `derived` marks a row the editor doesn't own, and
// pts is a nested array no scalar input can express — it's the gizmo's job.
const HIDDEN = new Set(['__k', 'derived', 'pts'])

// Field groups for the fine-tune drawer. A raw Object.keys dump interleaves
// "id, x, w, style, z" in whatever order levelData happened to author them.
// Anything unlisted falls through to the last group, so a new levelData field
// still shows up.
const GROUPS = [
  ['Place', ['x', 'y', 'z', 'rot']],
  ['Size', ['w', 'd', 'h', 'top', 'base', 'y0', 'y1']],
]

const STEP = {
  x: 0.5, z: 0.5, y: 0.1,
  w: 0.25, d: 0.25, h: 0.25, top: 0.25, base: 0.25, y0: 0.25, y1: 0.25,
  rot: Math.PI / 12, scale: 0.1,
}

const NICE = { w: 'width', d: 'depth', h: 'height', rot: 'yaw', ch: 'letter', scale: 'size' }

// Grid sizes, in metres. Objects also snap flush to each other's faces at any
// of these — see Editor.jsx's snapAxis — so 'off' still snaps to geometry.
const SNAPS = [['1m', 1], ['½m', 0.5], ['⅒', 0.1], ['off', 0]]

const KEYS = [
  ['1…9', 'pick a tool'],
  ['click', 'place it'],
  ['W / E', 'move / rotate'],
  ['Q', 'world / local'],
  ['F', 'frame selection'],
  ['⌘Z / ⇧⌘Z', 'undo / redo'],
  ['⌘D', 'duplicate'],
  ['Del', 'delete'],
  ['P', 'play'],
]

// The size steppers, per axis, in the order [label, candidate fields, step].
// Per-AXIS and not one uniform Bigger/Smaller, because "make the ramp bigger"
// is three different wishes — wider, longer, or steeper — and a uniform scale
// is the one thing that grants none of them: it grows the run and the rise
// together and the ramp's angle never changes.
//
// A row carries exactly one field per axis: a box's height is `top`, a wall's
// and planter's is `h`, and a ramp's or staircase's is `y1` (which is measured
// ABOVE `y0`, so it is floored against y0 rather than against zero).
const DIMS = [
  ['Width', ['w'], 0.5],
  ['Length', ['d'], 0.5],
  ['Height', ['top', 'h', 'y1'], 0.25],
]
const dimOf = (row, names) => names.find((n) => typeof row[n] === 'number')

const hintOf = (r) => r.kind ?? r.style ?? r.ch ?? r.plant ?? r.color ?? null

const posOf = (r) => {
  const p = r.pts ? { x: r.pts[0][0], z: r.pts[0][2] } : r
  return `${(p.x ?? 0).toFixed(1)}, ${(p.z ?? 0).toFixed(1)}`
}

/** One scalar/text row of the fine-tune drawer.
 *
 *  Draft-then-flush, NOT write-on-change: commit() rebuilds every collider and
 *  remounts the park, so committing per keystroke rebuilds it five times to
 *  type "-12.5" — and the intermediate "-" parses as NaN, which would land in
 *  the level. begin() fires on the first edit rather than on focus so that
 *  tabbing through fields doesn't fill the 50-deep undo stack with no-ops. */
function Field({ table, row, name, value }) {
  const [draft, setDraft] = useState(value ?? '')
  const dirty = useRef(false)
  const num = typeof value === 'number'

  const change = (e) => {
    if (!dirty.current) { dirty.current = true; begin() }
    setDraft(e.target.value)
  }

  const flush = () => {
    if (!dirty.current) return
    dirty.current = false
    if (num) {
      const n = parseFloat(draft)
      if (!Number.isFinite(n)) { setDraft(value); commit(); return } // NaN never reaches the row
      setField(table, row, name, n)
    } else {
      setField(table, row, name, draft)
    }
    commit()
  }

  return (
    <label className="ed-field">
      <span title={name}>{NICE[name] ?? name}</span>
      <input
        type={num ? 'number' : 'text'}
        step={num ? (STEP[name] ?? 0.1) : undefined}
        value={draft}
        onChange={change}
        onBlur={flush}
        // Editor.jsx binds 1..9/W/E/Delete/Ctrl+Z on window; without this,
        // typing a "w" into an id flips the gizmo to translate and Backspace
        // deletes the row you are naming.
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    </label>
  )
}

function EnumField({ table, row, name, value }) {
  const change = (e) => {
    begin()
    setField(table, row, name, e.target.value === '' ? null : e.target.value)
    commit()
  }
  return (
    <label className="ed-field">
      <span title={name}>{NICE[name] ?? name}</span>
      <select value={value ?? ''} onChange={change} onKeyDown={(e) => e.stopPropagation()}>
        {ENUMS[name].map((v) => (
          <option key={v ?? ''} value={v ?? ''}>{v ?? '(none)'}</option>
        ))}
      </select>
    </label>
  )
}

export default function EditorPanel({ onPlay }) {
  const version = useLevelVersion()
  const dogSize = useCharacterSize((s) => s.dog)
  const boySize = useCharacterSize((s) => s.boy)
  const sceneTime = useSceneSettings((s) => s.time)
  const sceneGround = useSceneSettings((s) => s.ground)
  const scenePattern = useSceneSettings((s) => s.pattern)
  const brickHue = useSceneSettings((s) => s.brickHue)
  const { table, row, snap, add, addRot, bowlSel, specialSel, editing, select, clear, set, arm, hint: ghostHint, hintWarn } = useEditor()
  const [copied, setCopied] = useState('')
  const [saved, setSaved] = useState(false)
  const flash = useRef(0)

  const list = table ? editable(table) : []
  // Undo/redo REPLACE the row objects (restore() refills the arrays from a
  // snapshot), so the selected row goes stale and every inspector write would
  // land on an orphan that nothing renders. Re-resolve by the stable __k.
  const live = row && list.includes(row) ? row : row ? list.find((r) => r.__k === row.__k) : null
  useEffect(() => {
    if (row && !live) clear()
    else if (row && live !== row) select(table, live)
  }, [row, live, table, select, clear])

  useEffect(() => () => clearTimeout(flash.current), [])

  // The panel must vanish while you are play-testing — it is fixed over the
  // viewport, and half of it is a hazard with the sim running.
  if (!EDIT || !editing) return null

  const say = (what, text) => {
    copy(text)
    setCopied(what)
    clearTimeout(flash.current)
    flash.current = setTimeout(() => setCopied(''), 1200)
  }

  const shiftBrickHue = (by) => {
    const next = ((brickHue + by + 180) % 360 + 360) % 360 - 180
    setScene({ brickHue: next })
  }

  // One control, not two: a palette entry arms placement AND scopes the
  // outliner. arm() is self-toggling and deliberately does NOT move `table`
  // (Editor.jsx's 1..9 shares it), so the scope is set here — clicking the
  // armed tool again disarms but leaves you browsing that table.
  const pick = (tool) => { arm(tool.id); set({ table: tool.table }) }

  // Every stepper is one undo step: begin, write, commit.
  const write = (changes) => {
    begin()
    for (const [k, v] of Object.entries(changes)) setField(table, live, k, v)
    commit()
  }

  // The floor is per-field: y1 is an absolute height whose zero is y0, so a
  // ramp shrunk to "0.25" means 0.25 of RISE, not 0.25 above the plaza.
  // Rails edit their `pts` in place rather than a field, so they can't go
  // through write()/setField — same one-click-one-undo shape though.
  const railWrite = (fn, by) => { begin(); fn(live, by); commit() }

  const nudge = (name, by) => {
    const floor = name === 'y1' ? (live.y0 ?? 0) + 0.25 : 0.25
    write({ [name]: Math.min(60, Math.max(floor, live[name] + by)) })
  }

  const canTurn = live && typeof live.rot === 'number'
  const canLift = live && typeof live.y === 'number'

  const fields = live ? Object.keys(live).filter((k) => !HIDDEN.has(k)) : []
  const used = new Set(GROUPS.flatMap(([, names]) => names))
  const groups = [
    ...GROUPS.map(([title, names]) => [title, names.filter((n) => fields.includes(n))]),
    ['Details', fields.filter((n) => !used.has(n))],
  ].filter(([, names]) => names.length)

  const field = (name) =>
    ENUMS[name]
      ? <EnumField key={`${keyOf(live)}:${name}:${version}`} table={table} row={live} name={name} value={live[name]} />
      // Remount on version so a gizmo drag (which writes x/z straight onto the
      // row and bumps) shows up here instead of leaving the input holding the
      // pre-drag draft — and on the ROW's key, or selecting a different row
      // reuses the same input instances and shows the previous row's drafts (a
      // LETTER rendered as `id: pad2, x: 2, z: 26` the first time this was
      // measured).
      : <Field key={`${keyOf(live)}:${name}:${version}`} table={table} row={live} name={name} value={live[name]} />

  // ONE line, and it always says the next ACTION rather than the current state
  // — a static "Pick a tool" is a line you stop reading after a minute. While
  // armed, the ghost's live placementInfo feedback wins over the generic line.
  const hint = add
    ? (ghostHint ?? `Click the ground to place a ${TOOL[add].label.toLowerCase()}. R turns it, Esc stops.`)
    : live
      ? 'Drag the gizmo, or use the steppers. Objects snap flush to each other.'
      : specialSel === 'spawn'
        ? 'Spawn point selected. Drag it to move the start, or rotate its arrow.'
        : specialSel === 'character'
          ? 'Dog and rider selected. Adjust their sizes below.'
      : 'Pick a tool, then click the ground — or click something in the park.'

  // The selected row's tool is only knowable by table, and SOLIDS is four
  // tools. `kind` is the closest thing the row itself carries.
  const tool = TOOLS.find((t) => t.table === table && (!t.patch?.kind || t.patch.kind === live?.kind))

  // Material swatches for the card. A function of the row (SOLIDS' options
  // hang off `kind`); null means this row has no look to pick.
  const look = live ? LOOKS[table]?.(live) : null

  return (
    <div className="ed-panel">
      <div className="ed-head">
        <div className="ed-head-copy">
          <h1>Level editor</h1>
          <p>Build your skatepark</p>
        </div>
        <span className={hasSaved() ? 'ed-dot on' : 'ed-dot'} title={hasSaved() ? 'Saved in this browser' : 'Nothing saved yet'}>
          {hasSaved() ? 'saved' : 'new'}
        </span>
        {/* full navigation on purpose: leaving ?edit means a fresh module load */}
        <button className="ed-home" title="Back to the home screen" onClick={() => { location.href = '/' }}>
          Home
        </button>
      </div>

      <div className="ed-scroll">
        <section className="ed-section ed-add-section">
          <div className="ed-section-head">
            <span className="ed-step">1</span>
            <div>
              <h2>Add to the park</h2>
              <p>Choose a piece, then click the ground.</p>
            </div>
          </div>

          <div className="ed-toys">
            {TOOLS.map((t, i) => (
              <button
                key={t.id}
                className={`ed-toy${add === t.id ? ' on' : add ? '' : table === t.table ? ' scoped' : ''}`}
                style={{ '--tint': t.tint }}
                title={`${t.label} — click the ground to place${i < 9 ? ` (${i + 1})` : ''}`}
                aria-pressed={add === t.id}
                onClick={() => pick(t)}
              >
                <i>{t.glyph}</i>
                <span>{t.label}</span>
                {i < 9 && <u>{i + 1}</u>}
              </button>
            ))}
          </div>

        {/* The pool is the one thing in the park you cannot place, only edit —
            so it is not in the palette, and until this existed the only way to
            reach it was to know its rim ring was clickable. */}
        <button
          className={`ed-pick${bowlSel ? ' on' : ''}`}
          title="Select the pool — then drag its ring in the park, or use the card"
          aria-pressed={bowlSel}
          onClick={() => (bowlSel ? clear() : set({ row: null, add: null, bowlSel: true, specialSel: null }))}
        >
          <span>🏊 Pool</span><small>{BOWL.on ? 'Select & edit' : 'Removed'}</small>
        </button>

          <div className={`ed-coach${add ? ' armed' : ''}${add && ghostHint && hintWarn ? ' warn' : ''}`}>
            <span>{hint}</span>
            {add && (
              // Rotate what you are HOLDING. It is here rather than on the
              // selection card because it applies before the object exists.
              <span className="ed-spin">
                <button title="Turn the held object 45° left (Shift+R)" onClick={() => set({ addRot: addRot - Math.PI / 4 })}>↺</button>
                <b>{Math.round((((addRot * 180) / Math.PI) % 360 + 360) % 360)}°</b>
                <button title="Turn the held object 45° right (R)" onClick={() => set({ addRot: addRot + Math.PI / 4 })}>↻</button>
              </span>
            )}
          </div>
        </section>

        <section className="ed-section ed-selection-section">
          <div className="ed-section-head">
            <span className="ed-step">2</span>
            <div>
              <h2>Edit a piece</h2>
              <p>Select a park piece, the spawn marker, or the dog and rider.</p>
            </div>
          </div>

        {!live && !bowlSel && !specialSel && (
          <div className="ed-empty">
            <span>↖</span>
            <p><b>Nothing selected</b>Click any park piece to move, resize, duplicate, or delete it.</p>
          </div>
        )}

        {specialSel === 'spawn' && (
          <div className="ed-card ed-special-card" style={{ '--tint': '#dff5b5' }}>
            <div className="ed-card-head"><i>🚩</i><b>Spawn point</b><em>selected</em></div>
            <p className="ed-note">Every play-test starts here, facing the arrow.</p>
            <div className="ed-readouts">
              <span><small>X</small><b>{SPAWN.x.toFixed(1)}</b></span>
              <span><small>Z</small><b>{SPAWN.z.toFixed(1)}</b></span>
              <span><small>Facing</small><b>{Math.round((((SPAWN.heading * 180) / Math.PI) % 360 + 360) % 360)}°</b></span>
            </div>
            <p className="ed-note">Drag the arrows to move it. Press E, then drag the ring to turn it.</p>
          </div>
        )}

        {specialSel === 'character' && (
          <div className="ed-card ed-characters" style={{ '--tint': '#ffe2c5' }}>
            <div className="ed-card-head"><i>🐾</i><b>Dog &amp; rider</b><em>selected</em></div>
            <div className="ed-row">
              <span>Dog</span>
              <button
                title="Make the dog smaller"
                disabled={dogSize <= CHARACTER_LIMITS.dog[0]}
                onClick={() => setCharacterSize('dog', dogSize - 0.1)}
              >−</button>
              <b>{dogSize.toFixed(2)}×</b>
              <button
                title="Make the dog bigger"
                disabled={dogSize >= CHARACTER_LIMITS.dog[1]}
                onClick={() => setCharacterSize('dog', dogSize + 0.1)}
              >+</button>
            </div>
            <div className="ed-row">
              <span>Rider</span>
              <button
                title="Make the rider smaller"
                disabled={boySize <= CHARACTER_LIMITS.boy[0]}
                onClick={() => setCharacterSize('boy', boySize - 0.1)}
              >−</button>
              <b>{boySize.toFixed(2)}×</b>
              <button
                title="Make the rider bigger"
                disabled={boySize >= CHARACTER_LIMITS.boy[1]}
                onClick={() => setCharacterSize('boy', boySize + 0.1)}
              >+</button>
            </div>
            <p className="ed-note">Their sizes are independent; the rider stays planted on the dog.</p>
          </div>
        )}

        {bowlSel && !BOWL.on && (
          <div className="ed-card" style={{ '--tint': '#c8e6ff' }}>
            <div className="ed-card-head"><i>🏊</i><b>Pool</b><em>removed</em></div>
            <div className="ed-row ed-row-wide"><button onClick={toggleBowl}>Put the pool back</button></div>
          </div>
        )}

        {bowlSel && BOWL.on && (
          // The pool is not a row — it is an analytic field colliders,
          // parkGeometry and Skatepark each read — so it gets its own card.
          // Drag it in the park like anything else; these are the two numbers
          // a gizmo can't express.
          <div className="ed-card" style={{ '--tint': '#c8e6ff' }}>
            <div className="ed-card-head"><i>🏊</i><b>Pool</b><em>{BOWL.cx.toFixed(1)}, {BOWL.cz.toFixed(1)}</em></div>
            <div className="ed-row">
              <span>Size</span>
              <button title="Smaller" onClick={() => setBowl({ r0: Math.max(3, BOWL.r0 - 0.5) })}>−</button>
              <b>{BOWL.r0.toFixed(2)}</b>
              <button title="Bigger" onClick={() => setBowl({ r0: Math.min(16, BOWL.r0 + 0.5) })}>+</button>
            </div>
            <div className="ed-row">
              <span>Depth</span>
              {/* Under ~1.2 the transition has no room to stand up and the
                  dish flattens into a saucer; over ~3.4 the wall goes past
                  vertical and the arc self-intersects. */}
              <button title="Shallower" onClick={() => setBowl({ depthMid: Math.max(1.2, BOWL.depthMid - 0.15) })}>−</button>
              <b>{BOWL.depthMid.toFixed(2)}</b>
              <button title="Deeper" onClick={() => setBowl({ depthMid: Math.min(3.4, BOWL.depthMid + 0.15) })}>+</button>
            </div>
            <div className="ed-row ed-row-wide">
              {/* Selection is KEPT: the card flips to "put it back", which is
                  the only undo-free way to change your mind. */}
              <button className="ed-bin" onClick={toggleBowl}>Remove pool</button>
            </div>
          </div>
        )}

        {live && (
          <div className="ed-card" style={{ '--tint': tool?.tint ?? '#eee' }}>
            <div className="ed-card-head">
              <i>{tool?.glyph}</i>
              <b>{live.id ?? tool?.label ?? table}</b>
              {hintOf(live) && <em>{hintOf(live)}</em>}
            </div>

            {look && (
              // One tap per material, shown as the colour it paints — the same
              // fields still live in Fine tune as dropdowns for completeness.
              <div className="ed-row ed-look">
                <span>Look</span>
                <div className="ed-swatches">
                  {look.options.map((o) => (
                    <button
                      key={o.v ?? 'none'}
                      className={(live[look.name] ?? null) === o.v ? 'on' : ''}
                      title={o.label}
                      style={{ '--sw': o.swatch }}
                      onClick={() => write({ [look.name]: o.v })}
                    />
                  ))}
                </div>
              </div>
            )}

            {table === 'CANS' && (
              <div className="ed-row">
                <span>Size</span>
                <button
                  title="Make the bin smaller"
                  disabled={(live.scale ?? 1) <= 0.4}
                  onClick={() => write({ scale: Math.max(0.4, (live.scale ?? 1) - 0.1) })}
                >−</button>
                <b>{(live.scale ?? 1).toFixed(1)}×</b>
                <button
                  title="Make the bin bigger"
                  disabled={(live.scale ?? 1) >= 3}
                  onClick={() => write({ scale: Math.min(3, (live.scale ?? 1) + 0.1) })}
                >+</button>
              </div>
            )}

            {table === 'RAILS' && (
              // A rail carries no w/h/rot/y, so DIMS and the rotate/lift rows
              // below all miss it — these mutate its `pts` instead. Same three
              // questions every other row's card answers.
              <>
                <div className="ed-row">
                  <span>Length</span>
                  <button title="Shorten by 1m" onClick={() => railWrite(extendRail, -1)}>−</button>
                  <b>{railLength(live).toFixed(2)}</b>
                  <button title="Extend by 1m" onClick={() => railWrite(extendRail, 1)}>+</button>
                </div>
                <div className="ed-row">
                  <span>Rotate</span>
                  <button title="15° left" onClick={() => railWrite(turnRail, -Math.PI / 12)}>↺</button>
                  <button title="15° right" onClick={() => railWrite(turnRail, Math.PI / 12)}>↻</button>
                </div>
                <div className="ed-row">
                  <span>Height</span>
                  <button title="Lower" onClick={() => railWrite(liftRail, -0.1)}>▼</button>
                  <b>{live.pts[0][1].toFixed(2)}</b>
                  <button title="Raise" onClick={() => railWrite(liftRail, 0.1)}>▲</button>
                </div>
              </>
            )}

            {DIMS.map(([label, names, step]) => {
              const name = dimOf(live, names)
              return name && (
                <div key={label} className="ed-row">
                  <span>{label}</span>
                  <button title={`${label} −${step}m`} onClick={() => nudge(name, -step)}>−</button>
                  <b>{(name === 'y1' ? live.y1 - (live.y0 ?? 0) : live[name]).toFixed(2)}</b>
                  <button title={`${label} +${step}m`} onClick={() => nudge(name, step)}>+</button>
                </div>
              )
            })}
            {canTurn && (
              <div className="ed-row">
                <span>Rotate</span>
                <button title="15° left" onClick={() => write({ rot: live.rot - Math.PI / 12 })}>↺</button>
                <button title="15° right" onClick={() => write({ rot: live.rot + Math.PI / 12 })}>↻</button>
                <button title="Square to the grid" onClick={() => write({ rot: Math.round(live.rot / (Math.PI / 2)) * (Math.PI / 2) })}>⊹</button>
              </div>
            )}
            {canLift && (
              <div className="ed-row">
                <span>Height</span>
                <button title="Lower" onClick={() => write({ y: Math.max(0.2, live.y - 0.25) })}>▼</button>
                <button title="Raise" onClick={() => write({ y: live.y + 0.25 })}>▲</button>
              </div>
            )}

            <div className="ed-row ed-row-wide">
              <button title="Duplicate (⌘D)" onClick={() => select(table, duplicateRow(table, live))}>Duplicate</button>
              <button className="ed-bin" title="Delete (Del)" onClick={() => { deleteRow(table, live); clear() }}>Delete</button>
            </div>

            <details className="ed-more">
              <summary>Fine tune</summary>
              {groups.map(([title, names]) => (
                <div key={title} className="ed-group">
                  <h4>{title}</h4>
                  {names.map(field)}
                </div>
              ))}
              {live.pts && <p className="ed-note">pts: {live.pts.length} points (drag in 3D)</p>}
            </details>
          </div>
        )}

        <details className="ed-more ed-outliner">
          <summary>All objects{table ? ` · ${table.toLowerCase()} (${list.length})` : ''}</summary>
          <div className="ed-list">
            {list.map((r, i) => (
              <button
                key={keyOf(r)}
                className={r === live ? 'on' : ''}
                onClick={() => select(table, r)}
              >
                <b>{r.id ?? `${table.toLowerCase()}[${i}]`}</b>
                {hintOf(r) && <i>{hintOf(r)}</i>}
                <em>{posOf(r)}</em>
              </button>
            ))}
            {table && !list.length && <p className="ed-note">Empty — pick that tool and click the ground.</p>}
          </div>
        </details>
        </section>

        {/* Level-wide controls are grouped after the core add/edit workflow so
            they stay easy to find without competing with the current task. */}
        <details className="ed-section ed-settings">
          <summary>
            <span className="ed-section-icon">✦</span>
            <span><b>Park settings</b><small>Ground, colour, and time of day</small></span>
          </summary>
          <div className="ed-settings-body">
            <div className="ed-card" style={{ '--tint': '#e8d9ff' }}>
              <div className="ed-card-head"><i>🎨</i><b>Scenery</b></div>
              <div className="ed-row ed-look ed-patterns">
                <span>Pattern</span>
                <div className="ed-swatches">
                  {PATTERNS.map((p) => (
                    <button
                      key={p.id}
                      className={scenePattern === p.id ? 'on' : ''}
                      title={p.label}
                      style={{ '--sw': p.swatch }}
                      onClick={() => setScene({ pattern: p.id })}
                    />
                  ))}
                </div>
              </div>
              <div className="ed-row ed-look">
                <span>Colour</span>
                <div className="ed-swatches">
                  {GROUNDS.map((g) => (
                    <button
                      key={g.id}
                      className={sceneGround === g.id ? 'on' : ''}
                      title={g.label}
                      style={{ '--sw': g.swatch }}
                      onClick={() => setScene({ ground: g.id })}
                    />
                  ))}
                </div>
              </div>
              <div className="ed-row ed-look">
                <span>Time</span>
                <div className="ed-swatches">
                  {TIMES.map((t) => (
                    <button
                      key={t.id}
                      className={sceneTime === t.id ? 'on' : ''}
                      title={t.label}
                      style={{ '--sw': t.swatch }}
                      onClick={() => setScene({ time: t.id })}
                    />
                  ))}
                </div>
              </div>
              <div className="ed-row">
                <span>Bricks</span>
                <button
                  title="Rotate the brick hue 15° toward pink and warm tones"
                  onClick={() => shiftBrickHue(-15)}
                >←</button>
                <b title="Brick hue shift; 0° is the original purple">{brickHue}°</b>
                <button
                  title="Rotate the brick hue 15° toward blue and cool tones"
                  onClick={() => shiftBrickHue(15)}
                >→</button>
              </div>
            </div>

          </div>
        </details>

        <details className="ed-more ed-manage">
          <summary>Manage level &amp; export</summary>
          <div className="ed-bar">
            <button title="Start from an empty park" onClick={() => { if (window.confirm('Clear the whole level? (⌘Z undoes it)')) clearAll() }}>Clear all</button>
            <button title="Restore the shipped park" onClick={resetLevel}>Reset to shipped</button>
            <button className={BOWL.on ? 'on' : ''} title={BOWL.on ? 'Fill the pool in' : 'Put the pool back'} onClick={toggleBowl}>Pool {BOWL.on ? 'on' : 'off'}</button>
          </div>
          <div className="ed-bar">
            <button disabled={!table} onClick={() => say('table', tableJSON(table))}>Copy table</button>
            <button onClick={() => say('all', allJSON())}>Copy all</button>
            {copied && <span className="ed-note">Copied {copied}</span>}
          </div>
          <div className="ed-keys">
            {KEYS.map(([k, what]) => <p key={k}><kbd>{k}</kbd>{what}</p>)}
          </div>
        </details>
      </div>

      <div className="ed-foot">
        <div className="ed-chips">
          <button title="Undo (⌘Z)" disabled={!canUndo()} onClick={undo}>↶ Undo</button>
          <button title="Redo (⇧⌘Z)" disabled={!canRedo()} onClick={redo}>↷</button>
          <span className="ed-snaps" title="Grid snap, in metres — objects snap flush to each other regardless">
            {SNAPS.map(([label, v]) => (
              <button key={label} className={snap === v ? 'on' : ''} onClick={() => set({ snap: v })}>{label}</button>
            ))}
          </span>
        </div>
        <button
          className="ed-save"
          title="Save to My Levels — playable from the home screen"
          onClick={() => {
            // native prompt over a modal: one question, and the editor's
            // keyboard handlers can't eat keystrokes while it's up
            const name = window.prompt('Name this level:', 'My park')?.trim()
            if (!name) return
            if (saveLevelAs(name, thumbCapture.fn?.() ?? null)) {
              setSaved(true)
              setTimeout(() => setSaved(false), 1600)
            }
          }}
        >
          {saved ? '✓ Saved' : '💾 Save'}
        </button>
        <button className="ed-play" title="Play-test the level (Esc to return)" onClick={onPlay}>
          ▶ Play <em>Esc to return</em>
        </button>
      </div>
    </div>
  )
}
