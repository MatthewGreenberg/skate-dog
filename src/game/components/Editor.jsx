// In-Canvas level editor: pickable proxies + a gizmo, mounted only under ?edit.
//
// Why a proxy layer at all: Skatepark bakes every world matrix once and sets
// matrixWorldAutoUpdate = false, so a gizmo attached to real park geometry
// would move an object whose matrix is never recomputed — the mesh would sit
// still while the gizmo slid away from it. The proxies are a sibling <group>
// with normal matrix updates; they carry the transform, and the row is the
// thing that actually changes on drag end.
//
// Adding an object is CLICK-TO-PLACE, not "+ Add then go find it": a table is
// armed (1..9, or the panel's palette) and the next click on the ground plane
// drops a row at the hit point, snapped, with a ghost following the cursor.
// While a table is armed nothing else raycasts and the gizmo is unmounted —
// every pickable thing in the park is otherwise a click the placement never
// receives, and an invisible proxy eating it is indistinguishable from a bug.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Edges, GizmoHelper, GizmoViewport, Grid, OrbitControls, TransformControls, useCursor } from '@react-three/drei'
import {
  TABLES,
  SPAWN,
  BOWL,
  setBowl,
  editable,
  keyOf,
  useEditor,
  useLevelVersion,
  begin,
  commit,
  undo,
  redo,
  addRow,
  duplicateRow,
  deleteRow,
  placementInfo,
  moveGroup,
  rotateGroup,
  TOOLS,
  TOOL,
  thumbCapture,
} from '../level/levelEdits.js'
import { buildRampGeometry } from '../level/parkGeometry.js'

// Only these carry a `rot` field the renderer reads back. Everything else has
// no yaw to write to, so rotate mode falls back to translate rather than
// silently spinning a proxy that snaps back on the next commit.
const ROTATABLE = new Set(['SOLIDS', 'WALLS', 'PLANTERS', 'BENCHES'])
// Tables whose rows carry a y. The rest are placed on the ground by their own
// `base`, so the gizmo's Y drag is discarded on write-back — and the Y HANDLE
// is hidden for them (SHOW_Y), because a drag that silently does nothing reads
// as a broken gizmo. RAILS has no `y` field but writeBack translates its pts,
// so it gets the handle without being in HAS_Y.
const HAS_Y = new Set(['BONES', 'LETTERS'])
const SHOW_Y = new Set(['BONES', 'LETTERS', 'RAILS'])

// 1..9 arm a TOOL for click-to-place, in the panel's own palette order — one
// list in levelEdits, so the two can't drift apart. Only the first nine get a
// digit; the rest are click-only.
const TOOL_KEYS = TOOLS.slice(0, 9).map((t) => t.id)

// A proxy that eats the placement click is a proxy you cannot place next to, so
// while a table is armed everything pickable stops raycasting and the ground
// plane gets every click. The ghost never raycasts at all.
// Explicit both ways rather than `raycast={armed ? noRaycast : undefined}`:
// r3f restores a REMOVED prop from the instance it constructed, and relying on
// that to hand three's own Mesh.raycast back is a bet on internals.
const noRaycast = () => null
const meshRaycast = THREE.Mesh.prototype.raycast

const MIN_H = 0.2 // a 0.42 ledge is still grabbable; a zero-height box is not

/** Row -> proxy box. [x, y, z, w, h, d, yaw] in world space. */
function proxyOf(table, r) {
  switch (table) {
    case 'SOLIDS': {
      if (r.kind === 'box') {
        const h = Math.max(MIN_H, r.top - (r.base || 0))
        return [r.x, (r.base || 0) + h / 2, r.z, r.w, h, r.d, r.rot || 0]
      }
      // ramp / stairs: y0 is the low edge, y1 the top
      const h = Math.max(MIN_H, r.y1 - r.y0)
      return [r.x, r.y0 + h / 2, r.z, r.w, h, r.d, r.rot || 0]
    }
    // NB `h` on a WALL is height ABOVE `base` for the collider (rails.js reads
    // the cap top as absolute `h` instead — see CLAUDE.md). The proxy uses the
    // collider reading; it only has to sit on the drawn masonry.
    case 'WALLS':
      return [r.x, (r.base || 0) + r.h / 2, r.z, r.w, r.h, r.d, r.rot || 0]
    case 'PLANTERS':
      return [r.x, (r.base || 0) + r.h / 2, r.z, r.w, r.h, r.d, r.rot || 0]
    case 'BENCHES':
      return [r.x, (r.base || 0) + 0.25, r.z, 1.7, 0.5, 0.6, r.rot || 0]
    case 'LAMPS':
      return [r.x, (r.base || 0) + 1.5, r.z, 0.5, 3, 0.5, 0]
    case 'BONES':
    case 'LETTERS':
      return [r.x, r.y, r.z, 0.9, 0.9, 0.9, 0]
    case 'CANS':
      return [r.x, 0.5 * (r.scale ?? 1), r.z, 0.7 * (r.scale ?? 1), 1 * (r.scale ?? 1), 0.7 * (r.scale ?? 1), 0]
    case 'RAILS': {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity
      let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
      for (const [x, y, z] of r.pts) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z)
        x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z)
      }
      // A rail is a line, so two of its three extents are 0 — 0.4 is about a
      // dog's width and makes the tube pickable from any angle.
      return [
        (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2,
        Math.max(0.4, x1 - x0), Math.max(0.4, y1 - y0), Math.max(0.4, z1 - z0),
        0,
      ]
    }
    default:
      return null
  }
}

// ------------------------------------------------------------ ghost shapes
// The cursor ghost shows a SILHOUETTE of the tool, not its bounding box: a
// wedge tells you what a ramp IS before you commit; the box only told you how
// much floor it ate. Boxes stay boxes where they are honest (ledges, walls,
// pickups). Amber = placementInfo has a warning about this spot.
const WARN_TINT = '#ff8a66'
function ghostShapes(toolId) {
  const t = TOOL[toolId]
  const [w, h, d, y] = t.ghost
  const p = t.patch
  // A group tool (the halfpipe) previews every row it will place, each on its
  // own local +Z offset — the patch is only its footprint for placementInfo.
  if (t.group) {
    return t.group.map((g) =>
      g.kind === 'ramp'
        ? { geo: buildRampGeometry(g.w, g.d, g.y0, g.y1, g.curve), y: 0, z: g.dz ?? 0, ry: g.drot ?? 0 }
        : { geo: new THREE.BoxGeometry(g.w, g.top, g.d), y: g.top / 2, z: g.dz ?? 0 },
    )
  }
  if (p?.kind === 'ramp') return [{ geo: buildRampGeometry(p.w ?? w, p.d ?? d, p.y0, p.y1, p.curve), y: 0 }]
  if (p?.kind === 'stairs') {
    const rise = (p.y1 - p.y0) / p.steps, run = d / p.steps
    return Array.from({ length: p.steps }, (_, i) => ({
      geo: new THREE.BoxGeometry(w, rise, run),
      y: p.y0 + rise * (i + 0.5),
      z: -d / 2 + run * (i + 0.5),
    }))
  }
  if (toolId === 'rail') return [{ geo: new THREE.CylinderGeometry(0.07, 0.07, w, 10), y: 0.55, rz: Math.PI / 2 }]
  if (toolId === 'lamp') return [{ geo: new THREE.CylinderGeometry(0.09, 0.2, 3, 10), y: 1.5 }]
  if (toolId === 'can') return [{ geo: new THREE.CylinderGeometry(0.35, 0.29, 1, 12), y: 0.5 }]
  return [{ geo: new THREE.BoxGeometry(w, h, d), y }]
}

// ------------------------------------------------------------------ snapping
// The grid alone is not enough and never was: a 4m ledge butted against a 3m
// planter lands its face at a coordinate the grid cannot express, so "snapped"
// objects still left millimetre gaps you only found by riding into them. So
// every placement and every drag also snaps to the OTHER rows — centre lines
// and, more usefully, FLUSH faces (their edge plus our own half-width).
//
// Object snaps BEAT the grid whenever they are in range rather than competing
// on distance: the grid is always within half a cell, so a distance contest
// means the flush snap you actually want almost never wins.
const SNAP_TOL = 0.4

/** Candidate coordinates on each axis, as [centre, halfExtent] pairs.
 *  Rotated rows are skipped as SOURCES — their faces aren't axis-aligned, so
 *  "flush" is meaningless against them and the AABB would snap you to a corner
 *  of empty air. A 90-degree row is fine, with w/d swapped. */
function snapLines(skipRow) {
  const xs = [], zs = []
  for (const t of Object.keys(TABLES)) {
    for (const r of editable(t)) {
      // A group mate moves WITH the drag — offering its faces as snap targets
      // means snapping the halfpipe to a line that is about to move.
      if (r === skipRow || (skipRow?.grp && r.grp === skipRow.grp)) continue
      const p = proxyOf(t, r)
      if (!p) continue
      const quarter = ((p[6] % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
      if (Math.min(quarter, Math.PI / 2 - quarter) > 0.02) continue
      const sideways = Math.abs(Math.abs(((p[6] % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2) < 0.02
      xs.push([p[0], (sideways ? p[5] : p[3]) / 2])
      zs.push([p[2], (sideways ? p[3] : p[5]) / 2])
    }
  }
  return { xs, zs }
}

/** Snap one axis. `half` is the moving object's own half-extent on it. */
function snapAxis(v, half, lines, grid) {
  let best = null, bd = SNAP_TOL
  for (const [c, h] of lines) {
    // centre-align, flush outside either face, and outer-edge align (which is
    // what lines two boxes' backs up)
    for (const cand of [c, c + h + half, c - h - half, c + h - half, c - h + half]) {
      const d = Math.abs(v - cand)
      if (d < bd) { bd = d; best = cand }
    }
  }
  if (best !== null) return best
  return grid ? Math.round(v / grid) * grid : v
}

/** Apply a finished gizmo transform back onto the row. moveGroup/rotateGroup
 *  are group-aware (the halfpipe's five rows transform as one object) and fall
 *  through to plain single-row writes for everything else. Deltas rather than
 *  absolutes on translate: same result for the dragged row, and the only form
 *  a group mate can consume. */
function writeBack(table, row, obj, start, mode) {
  if (mode === 'rotate') {
    rotateGroup(table, row, obj.rotation.y)
    return
  }
  if (table === 'RAILS') {
    const dx = obj.position.x - start.x
    const dy = obj.position.y - start.y
    const dz = obj.position.z - start.z
    for (const p of row.pts) { p[0] += dx; p[1] += dy; p[2] += dz }
    return
  }
  moveGroup(table, row, obj.position.x - start.x, obj.position.z - start.z)
  if (HAS_Y.has(table)) row.y = obj.position.y
}

function RowProxy({ table, row, selected, onTarget, gizmo, armed }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(false)
  useCursor(hover && !armed)

  const p = proxyOf(table, row)

  useLayoutEffect(() => {
    if (!selected) return
    onTarget(ref.current)
    return () => onTarget(null)
  }, [selected, onTarget])

  const pick = (e) => {
    // The gizmo's handles sit in front of the proxies and three-stdlib's
    // TransformControls does not stop r3f's pointer events, so a click on an
    // axis arrow also lands here. `axis` is non-null whenever a handle is
    // hovered, which is exactly the case we must ignore.
    if (gizmo.current?.axis) return
    e.stopPropagation()
    useEditor.getState().select(table, row)
  }

  return (
    <mesh
      ref={ref}
      position={[p[0], p[1], p[2]]}
      rotation={[0, p[6], 0]}
      raycast={armed ? noRaycast : meshRaycast}
      onPointerDown={pick}
      onPointerOver={(e) => (e.stopPropagation(), setHover(true))}
      onPointerOut={() => setHover(false)}
    >
      <boxGeometry args={[p[3], p[4], p[5]]} />
      <meshBasicMaterial
        // opacity=0 still submits a transparent draw call. Keep the MESH live
        // for raycasting but skip its material in the renderer until feedback
        // is actually visible; most levels have dozens of idle proxies.
        visible={selected || hover}
        transparent
        // Idle proxies are INVISIBLE, not faint. At 0.06 each they still
        // raycast the same, but ~90 of them overlap across the park and the
        // stacked alpha washed the whole frame out white — you could not see
        // the level you were editing. A raycast needs a hit, not a pixel.
        opacity={selected ? 0.14 : hover ? 0.1 : 0}
        depthWrite={false}
        color={selected ? '#ffe066' : '#66e0ff'}
      />
      {(selected || hover) && <Edges color={selected ? '#ffe066' : '#66e0ff'} />}
    </mesh>
  )
}

/** The dog's start point. NOT a row — SPAWN is a bare object in levelData and
 *  putting it in TABLES would hand the panel a table with no schema (editable()
 *  would throw on the first render) — so it uses the store's special selection
 *  slot and is written straight onto SPAWN under the drag's begin().
 *  A level with no visible spawn is a level you cannot tell where you start in,
 *  which is why it is worth the one special case. Lime; nothing else uses it. */
function SpawnProxy({ selected, armed, version, onTarget, onPick, gizmo }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(false)
  useCursor(hover && !armed)

  // Re-sync after a commit: setSpawn and undo both write SPAWN behind the
  // gizmo's back, and the marker is the only thing that shows it.
  useLayoutEffect(() => {
    ref.current.position.set(SPAWN.x, 0, SPAWN.z)
    ref.current.rotation.y = SPAWN.heading
  }, [version])

  useLayoutEffect(() => {
    if (!selected) return
    onTarget(ref.current)
    return () => onTarget(null)
  }, [selected, onTarget])

  const pick = (e) => {
    if (gizmo.current?.axis) return
    e.stopPropagation()
    onPick()
  }

  const rc = armed ? noRaycast : meshRaycast
  const lit = selected ? '#eaffb0' : '#7cff9e'

  return (
    <group
      ref={ref}
      onPointerDown={pick}
      onPointerOver={(e) => (e.stopPropagation(), setHover(true))}
      onPointerOut={() => setHover(false)}
    >
      {/* Flat pad, 8mm up — on the plaza plane it z-fights the paving. */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={rc}>
        <ringGeometry args={[0.5, 0.95, 24]} />
        <meshBasicMaterial color={lit} transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Heading arrow. P.heading yaws forward to (sin h, cos h), which is
          exactly local +Z under rotation.y = h — so a cone laid down +Z reads
          the heading with no conversion. */}
      <mesh position={[0, 0.4, 1.1]} rotation={[Math.PI / 2, 0, 0]} raycast={rc}>
        <coneGeometry args={[0.34, 1.1, 4]} />
        <meshBasicMaterial color={lit} transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** The pool. Like SPAWN it is not a row — an analytic field three systems read
 *  — and the panel shows a card for it (size, depth), so its selection lives
 *  in the shared store.
 *
 *  The handle is a flat ring on the rim's mean radius, not the kidney outline:
 *  it only has to be grabbable, and bowlRadius() varies with bearing. */
function BowlProxy({ selected, armed, version, onTarget, gizmo }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(false)
  useCursor(hover && !armed)

  // Both effects have to tolerate a NULL ref: the early return below renders
  // nothing while the pool is removed, but hooks still run — removing the pool
  // threw `Cannot read properties of null (reading 'position')` here.
  useLayoutEffect(() => {
    ref.current?.position.set(BOWL.cx, 0, BOWL.cz)
  }, [version])

  useLayoutEffect(() => {
    if (!selected || !ref.current) return
    onTarget(ref.current)
    return () => onTarget(null)
    // `version` so a pool that comes BACK re-attaches the gizmo it was holding
    // when it was removed — the effect above ran with a null ref on the way in.
  }, [selected, onTarget, version])

  if (!BOWL.on) return null

  const lit = selected ? '#ffe066' : '#8fd8ff'
  return (
    <group
      ref={ref}
      onPointerDown={(e) => {
        if (gizmo.current?.axis) return
        e.stopPropagation()
        useEditor.getState().set({ row: null, bowlSel: true, specialSel: null, add: null })
      }}
      onPointerOver={(e) => (e.stopPropagation(), setHover(true))}
      onPointerOut={() => setHover(false)}
    >
      {/* 8mm up, or it z-fights the coping it traces. */}
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={armed ? noRaycast : meshRaycast}>
        <ringGeometry args={[BOWL.r0 * 0.9, BOWL.r0 * 1.16, 48]} />
        <meshBasicMaterial
          color={lit}
          transparent
          opacity={selected ? 0.32 : hover ? 0.22 : 0.16}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

export default function Editor() {
  const version = useLevelVersion()
  const table = useEditor((s) => s.table)
  const row = useEditor((s) => s.row)
  const mode = useEditor((s) => s.mode)
  const snap = useEditor((s) => s.snap)
  const add = useEditor((s) => s.add)
  const addRot = useEditor((s) => s.addRot)
  const bowlSel = useEditor((s) => s.bowlSel)
  const specialSel = useEditor((s) => s.specialSel)
  const spawnSel = specialSel === 'spawn'

  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const orbit = useRef(null)
  const gizmo = useRef(null)
  const ghost = useRef(null)
  const [target, setTarget] = useState(null)
  const [space, setSpace] = useState('world')
  const [panning, setPanning] = useState(false)
  const dragStart = useRef(new THREE.Vector3())

  // Crosshair for the whole viewport while a table is armed. useCursor is
  // drei's, so it unwinds itself — but the belt-and-braces reset below covers
  // an unmount mid-arm (Game.jsx drops <Editor/> the moment `editing` flips).
  useCursor(!!add && !panning, 'crosshair')

  // Thumbnail grab for "Save level": render a fresh frame so the drawing
  // buffer is populated (preserveDrawingBuffer is off), then downscale through
  // a 2d canvas in the same task. The panel (DOM side) calls this at save.
  useEffect(() => {
    thumbCapture.fn = () => {
      gl.render(scene, camera)
      const src = gl.domElement
      const c = document.createElement('canvas')
      c.width = 320
      c.height = Math.max(1, Math.round((320 * src.height) / src.width))
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
      return c.toDataURL('image/jpeg', 0.7)
    }
    return () => { thumbCapture.fn = null }
  }, [gl, scene, camera])

  // Held space = hand pan, the one gesture every 3D/design tool shares. It
  // swaps the orbit's LEFT button rather than adding a camera path of its own,
  // so momentum, damping and the gizmo's makeDefault handover are untouched.
  // keyup is a separate listener; the main onKey below is keydown-only.
  useEffect(() => {
    const down = (e) => {
      if (e.code !== 'Space' || e.repeat) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      e.preventDefault() // space scrolls the page otherwise
      setPanning(true)
    }
    const up = (e) => { if (e.code === 'Space') setPanning(false) }
    // A blur mid-hold (alt-tab) never delivers the keyup, so the pan sticks.
    const off = () => setPanning(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [])

  useEffect(() => {
    const c = orbit.current
    if (c) c.mouseButtons = { ...c.mouseButtons, LEFT: panning ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE }
    if (panning) document.body.style.cursor = 'grab'
    else if (!useEditor.getState().add) document.body.style.cursor = 'auto'
  }, [panning])

  useEffect(() => () => {
    document.body.style.cursor = 'auto'
    useEditor.getState().arm(null)
  }, [])

  // Rows are mutated in place, so the version is the only signal that anything
  // changed — it is the dependency, not the arrays.
  const rows = useMemo(
    // Flat, not grouped: a nested map returns an ARRAY per table, and React
    // keys those arrays by their own index — every table's inner list restarts
    // at 0 and collides with its siblings' ("two children with the same key").
    () => Object.keys(TABLES).flatMap((t) => editable(t).map((r) => [t, r])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  )

  const onTarget = useCallback((o) => setTarget(o), [])

  // One shared ghost material: groundMove mutates its color (tool tint or
  // amber) at pointer rate, so it cannot be per-mesh JSX props.
  const ghostMat = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false, color: '#ffe066' }),
    [],
  )
  const shapes = useMemo(() => (add ? ghostShapes(add) : []), [add])
  // A slider-less tool switch still builds fresh geometry every time — dispose
  // the old set or every armed tool leaks its silhouette to the GPU.
  useEffect(() => () => { for (const s of shapes) s.geo.dispose() }, [shapes])
  useEffect(() => { if (add) ghostMat.color.set(TOOL[add].tint) }, [add, ghostMat])

  // Overview framing. The game camera is a chase rig parked behind the dog;
  // from there you cannot see a park you are meant to be laying out.
  useLayoutEffect(() => {
    camera.position.set(0, 45, 60)
    camera.lookAt(0, 0, 0)
  }, [camera])

  // The bowl is a radial field — there is no yaw to write, so rotate mode falls
  // back to translate on it as it does for a lamp.
  const rotatable = (spawnSel || ROTATABLE.has(table)) && !bowlSel
  const gizmoMode = mode === 'rotate' && rotatable ? 'rotate' : 'translate'
  // Spawn and the bowl have no y at all; the rest is SHOW_Y.
  const showY = !spawnSel && !bowlSel && SHOW_Y.has(table)

  // Half-extents of whatever is being dragged, on world x and z. Arbitrary
  // yaw falls back to 0 — a flush snap against a 30-degree box is a lie, but
  // centre-alignment is still true.
  const movingHalf = useCallback(() => {
    if (spawnSel || bowlSel || !row) return [0, 0]
    const p = proxyOf(table, row)
    if (!p) return [0, 0]
    const q = ((p[6] % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
    if (Math.min(q, Math.PI / 2 - q) > 0.02) return [0, 0]
    const sideways = Math.abs(Math.abs(((p[6] % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2) < 0.02
    return [(sideways ? p[5] : p[3]) / 2, (sideways ? p[3] : p[5]) / 2]
  }, [spawnSel, bowlSel, row, table])

  // begin() on drag start / write-back + commit() on drag end. Deliberately NOT
  // onObjectChange for the COMMIT: that fires per pointer move, and committing
  // there rebuilds the colliders and rail paths on every frame of a drag. The
  // snap does ride on objectChange, because that is the only hook that runs
  // while the pointer is down — and it is pure mutation of the proxy, no state.
  useEffect(() => {
    const tc = gizmo.current
    if (!tc || !target) return

    // Snap sources are the OTHER rows, which don't move during a drag — so the
    // lines are built once per drag, not per pointer move.
    let lines = null, half = [0, 0]
    const onMove = () => {
      if (!tc.dragging || gizmoMode === 'rotate' || !lines) return
      // Only the axes the handle actually moves: a single-axis drag leaves the
      // others exactly at the drag start, and snapping those too would jog the
      // object sideways onto whatever line it happened to be sitting near.
      const s = dragStart.current
      const p = target.position
      if (p.x !== s.x) p.x = snapAxis(p.x, half[0], lines.xs, snap)
      if (p.z !== s.z) p.z = snapAxis(p.z, half[1], lines.zs, snap)
      if (snap && p.y !== s.y) p.y = Math.round(p.y / snap) * snap
    }

    const onDrag = (e) => {
      if (e.value) {
        lines = snapLines(spawnSel || bowlSel ? null : row)
        half = movingHalf()
        dragStart.current.copy(target.position)
        begin()
      } else if (bowlSel) {
        // underDrag: the drag start already pushed an undo snapshot, and two
        // is two undos for one drag. Unlike spawn this cannot be a bare field
        // write — the retaining wall and benches have to be re-derived.
        setBowl({ cx: target.position.x, cz: target.position.z }, true)
      } else if (spawnSel) {
        // NOT setSpawn(): it opens with its own begin(), and the drag start
        // above already pushed one — a single drag would then cost two undos.
        // begin()'s snapshot carries SPAWN, so writing the fields under it is
        // undoable, and it is the only way heading rides along.
        if (gizmoMode === 'rotate') SPAWN.heading = target.rotation.y
        else { SPAWN.x = target.position.x; SPAWN.z = target.position.z }
        commit()
      } else {
        writeBack(table, row, target, dragStart.current, gizmoMode)
        commit()
      }
    }
    tc.addEventListener('dragging-changed', onDrag)
    tc.addEventListener('objectChange', onMove)
    return () => {
      tc.removeEventListener('dragging-changed', onDrag)
      tc.removeEventListener('objectChange', onMove)
    }
  }, [target, table, row, gizmoMode, spawnSel, bowlSel, snap, movingHalf])

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const st = useEditor.getState()
      const meta = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()

      if (meta && k === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        // The undone row object is gone from the table — a stale selection
        // would keep a gizmo attached to a proxy that no longer exists.
        st.clear()
        return
      }
      if (meta && k === 'd') {
        e.preventDefault()
        if (st.table && st.row) st.select(st.table, duplicateRow(st.table, st.row))
        return
      }
      if (meta) return

      // 1..9 arm a tool for click-to-place. arm() is itself a toggle, so
      // pressing the armed one again disarms — never a dead press.
      if (k >= '1' && k <= '9') {
        const t = TOOL_KEYS[+k - 1]
        if (t) st.arm(t)
        return
      }

      // R turns whatever you are HOLDING — the armed ghost — in 45s, so a ramp
      // can be aimed before it lands instead of placed and then re-selected.
      // With nothing armed it falls through to the gizmo's rotate mode, which
      // is what R means everywhere else.
      if (k === 'r') {
        if (st.add) st.set({ addRot: st.addRot + (e.shiftKey ? -1 : 1) * (Math.PI / 4) })
        else st.set({ mode: 'rotate' })
        return
      }

      if (k === 'w') st.set({ mode: 'translate' })
      else if (k === 'e') st.set({ mode: 'rotate' })
      else if (k === 'q') setSpace((s) => (s === 'world' ? 'local' : 'world'))
      // Esc disarms FIRST and returns — placing several objects then hitting
      // Esc must not also throw away the selection you were about to nudge.
      // Not preventDefault'd: Game.jsx owns Esc for the play/edit toggle.
      else if (k === 'escape') {
        if (st.add) st.arm(null)
        else st.clear()
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault() // Backspace is browser-back on some setups
        if (st.table && st.row) {
          deleteRow(st.table, st.row)
          st.clear()
        }
      } else if (k === 'f') {
        const o = target
        const c = orbit.current
        if (!o || !c) return
        c.target.copy(o.position)
        // Pull the eye in along the direction it already looks from, so framing
        // does not also swing the view round to a new bearing.
        const dir = camera.position.clone().sub(o.position)
        const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
        dir.setLength(Math.max(8, size.length() * 1.6))
        camera.position.copy(o.position).add(dir)
        c.update()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, target])

  // The ground plane is both the deselect target and the placement surface.
  const groundDown = (e) => {
    if (gizmo.current?.axis) return // clicking a gizmo handle is not a miss
    if (panning) return // space-drag is a camera move, not a placement
    e.stopPropagation()
    const st = useEditor.getState()
    if (!st.add) {
      st.clear()
      return
    }
    // Stay armed: laying down a row of cans should not need nine trips to the
    // panel. Esc (or the number key again) is the way out. NOT select(), which
    // clears `add` by design (a click on an existing proxy should disarm) —
    // this is the one selection that must survive it.
    const t = st.add
    const [x, z] = placeAt(e.point.x, e.point.z)
    // The one refusal: a grounded row in the pool stands on air. The ghost is
    // already amber and the hint line already says why.
    if (placementInfo(t, x, z, st.addRot).block) return
    st.set({ table: TOOL[t].table, row: addRow(t, x, z, st.addRot), add: t, bowlSel: false, specialSel: null })
  }

  // Where an armed tool would land: the same grid + flush-face snap the gizmo
  // drag uses, so the ghost is never a preview of a different position than the
  // click produces.
  const placeAt = (px, pz) => {
    const g = TOOL[add].ghost
    const lines = snapLines(null)
    return [snapAxis(px, g[0] / 2, lines.xs, snap), snapAxis(pz, g[2] / 2, lines.zs, snap)]
  }

  // Ghost follows the pointer by direct mutation — this fires at pointer rate
  // and a setState per move would re-render the whole proxy layer. The store
  // hint is the one exception, written only when the STRING changes.
  const groundMove = (e) => {
    const g = ghost.current
    if (!g || !add) return
    const [x, z] = placeAt(e.point.x, e.point.z)
    g.position.set(x, 0, z)
    g.visible = true
    const info = placementInfo(add, x, z, addRot)
    ghostMat.color.set(info.warn ? WARN_TINT : TOOL[add].tint)
    const hint = info.warn ?? (info.matchTop ? `Rise will match the ${info.matchTop.toFixed(1)}m deck` : null)
    const st = useEditor.getState()
    if (hint !== st.hint) st.set({ hint, hintWarn: !!info.warn })
  }

  return (
    <group>
      {/* makeDefault is mandatory: drei's TransformControls disables
          state.controls while dragging, and without it the orbit rotates the
          camera under the gizmo you are dragging. */}
      <OrbitControls ref={orbit} makeDefault target={[0, 0, 0]} />
      <Grid
        infiniteGrid
        // UNDER the plaza (y=0), over the grass (y=-0.3). Sat 4mm above the
        // floor it was a 200m sheet of lines seen at the chase camera's
        // grazing angle — they converge past ~30m and hazed the entire park
        // white, which is the one thing an editor viewport must not do. Below
        // the slab it does its job (snap reference out on the open ground) and
        // is occluded everywhere the level already gives you a reference.
        position={[0, -0.02, 0]}
        cellSize={snap || 1}
        sectionSize={(snap || 1) * 10}
        fadeDistance={55}
        cellColor="#8a86a8"
        sectionColor="#c8b4ff"
      />
      <GizmoHelper alignment="bottom-right">
        <GizmoViewport />
      </GizmoHelper>

      {/* Deselect plane. Opacity 0 rather than visible={false}, because three
          skips invisible objects in the raycast and it would never be hit. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        onPointerDown={groundDown}
        onPointerMove={groundMove}
        onPointerOut={() => {
          if (ghost.current) ghost.current.visible = false
          const st = useEditor.getState()
          if (st.hint) st.set({ hint: null, hintWarn: false })
        }}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Cursor preview. Hidden until the first pointer move so it never sits
          parked at the origin — which is exactly the "buried in the middle of
          the park" placement click-to-place exists to replace. A group, not a
          mesh: shaped ghosts (stairs) are several children, each carrying its
          own local offset while the group sits on the ground at the hit. */}
      {add && (
        <group ref={ghost} visible={false} rotation={[0, addRot, 0]}>
          {shapes.map((s, i) => (
            <mesh
              key={i}
              geometry={s.geo}
              material={ghostMat}
              raycast={noRaycast}
              position={[0, s.y, s.z ?? 0]}
              rotation={[0, s.ry ?? 0, s.rz ?? 0]}
            />
          ))}
        </group>
      )}

      {rows.map(([t, r]) => (
        <RowProxy key={keyOf(r)} table={t} row={r} selected={r === row} onTarget={onTarget} gizmo={gizmo} armed={!!add} />
      ))}

      <BowlProxy selected={bowlSel} armed={!!add} version={version} onTarget={onTarget} gizmo={gizmo} />

      <SpawnProxy
        selected={spawnSel}
        armed={!!add}
        version={version}
        onTarget={onTarget}
        onPick={() => useEditor.getState().selectSpecial('spawn')}
        gizmo={gizmo}
      />

      {/* No gizmo while armed: its handles sit in front of the ground plane and
          would eat the next placement click, and the guard that stops that
          (`gizmo.current?.axis`) would silently swallow the press instead. */}
      {target && !add && (
        <TransformControls
          ref={gizmo}
          object={target}
          mode={gizmoMode}
          space={space}
          showY={showY || gizmoMode === 'rotate'}
          showX={gizmoMode !== 'rotate'}
          showZ={gizmoMode !== 'rotate'}
          // No translationSnap: the objectChange handler above owns the snap
          // (grid AND flush faces), and TC's own rounding is relative to the
          // drag start, so the two disagree by whatever sub-cell offset the
          // object already had.
          rotationSnap={Math.PI / 12}
        />
      )}
    </group>
  )
}
