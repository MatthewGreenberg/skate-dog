import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { C, M } from '../palette.js'
import { useGame } from '../store.js'
import { SOLIDS, WALLS, RAILS, PERIMETER, GRASS_Y, BOWL } from '../level/levelData.js'
import { groundHeightAt, AO_FOOTPRINTS } from '../level/colliders.js'
import { buildBowlGeometry, buildCopingGeometry } from '../level/bowlGeometry.js'
import { buildPlazaGeometry, buildGrassGeometry, buildRampGeometry } from '../level/parkGeometry.js'
import { buildDecalGeometry } from '../level/decals.js'
import {
  plazaMap,
  plazaNormal,
  plazaRough,
  masonryMap,
  masonryNormal,
  masonryRough,
  stoneMap,
  stoneNormal,
  woodMap,
  woodNormal,
  hpSurfMap,
  bowlMap,
  bowlNormal,
  bowlRough,
  grassMap,
  grassNormal,
  decalAtlas,
  parkAOMap,
  PLAZA_TILE,
  MASONRY_TILE_X,
  MASONRY_TILE_Y,
} from '../level/textures.js'
import { Trees, Shrubs, Planters, Benches, LampPosts, Wind, getMuralTexture } from './Props.jsx'

// ---------------------------------------------------------------- materials
// Every surface now carries a normal map AND a roughness map. That pairing is
// the whole reason the reference's concrete reads as concrete: a single
// roughness constant returns one uniform specular across a whole face, which is
// the exact signature of "flat colour with a pattern drawn on it" that four
// separate blind critiques put at the top of their list. The normal map breaks
// the highlight up spatially, the roughness map varies how tight it is, and
// only then does an env map have anything interesting to reflect.
let _mats = null
function mats() {
  if (_mats) return _mats
  const std = (o) => new THREE.MeshStandardMaterial(o)

  // shared instances: one upload per map no matter how many materials want it
  const plazaAlbedo = plazaMap()
  const plazaN = plazaNormal()
  const plazaR = plazaRough()
  const stoneAlbedo = stoneMap()
  const stoneN = stoneNormal()

  _mats = {
    plaza: std({
      map: plazaAlbedo,
      normalMap: plazaN,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughnessMap: plazaR,
      ...M.concrete,
      envMapIntensity: 0.75,
    }),
    plazaGround: std({
      map: plazaAlbedo,
      normalMap: plazaN,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughnessMap: plazaR,
      aoMap: parkAOMap(AO_FOOTPRINTS),
      aoMapIntensity: 1.35,
      ...M.concrete,
      envMapIntensity: 0.75,
    }),
    // Floor decals. transparent + depthWrite false, NOT alphaTest: these are
    // soft low-contrast marks and an alpha cutout puts a hard stencil edge on
    // every chalk line. depthWrite off also means the quads inside a cluster
    // blend in array order instead of z-fighting each other on a shared plane.
    decal: std({
      map: decalAtlas(),
      transparent: true,
      depthWrite: false,
      vertexColors: true, // vec4 — the alpha channel is the per-decal fade
      polygonOffset: true,
      polygonOffsetFactor: -2,
      roughness: 0.92,
      metalness: 0,
    }),
    // envMapIntensity 1.0, not 0.65. The bowl was the one surface in the park
    // discounting the cool ambient while taking the warm hemisphere at full
    // weight, which is why it measured 16 lightness points low and warmer than
    // the plaza (LIGHT.residuals flags this). Its own vertex-baked AO already
    // does the enclosure darkening that 0.65 was standing in for.
    bowl: std({
      map: bowlMap(),
      normalMap: bowlNormal(),
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: bowlRough(),
      ...M.bowl,
      vertexColors: true,
      envMapIntensity: 1.0,
    }),
    stone: std({
      map: stoneAlbedo,
      normalMap: stoneN,
      normalScale: new THREE.Vector2(0.4, 0.4),
      ...M.stone,
      envMapIntensity: 0.9,
    }),
    wood: std({
      map: woodMap(),
      normalMap: woodNormal(),
      normalScale: new THREE.Vector2(0.45, 0.45),
      ...M.wood,
      envMapIntensity: 0.6,
    }),
    hpSurf: std({
      map: hpSurfMap(),
      ...M.hpSurf,
      envMapIntensity: 0.9,
    }),
    coping: std({
      map: stoneAlbedo,
      normalMap: stoneN,
      normalScale: new THREE.Vector2(0.3, 0.3),
      color: C.coping,
      ...M.coping,
      envMapIntensity: 1.35,
    }),
    masonry: std({
      map: masonryMap(),
      normalMap: masonryNormal(),
      normalScale: new THREE.Vector2(0.62, 0.62),
      roughnessMap: masonryRough(),
      ...M.masonry,
      envMapIntensity: 0.8,
    }),
    grass: std({
      map: grassMap(),
      normalMap: grassNormal(),
      normalScale: new THREE.Vector2(0.7, 0.7),
      ...M.foliage,
      envMapIntensity: 0.5,
    }),
    railTeal: std({ color: C.railTeal, ...M.rail, envMapIntensity: 1.5 }),
    railPink: std({ color: C.railPink, ...M.rail, envMapIntensity: 1.5 }),
    railYellow: std({ color: C.railYellow, ...M.rail, envMapIntensity: 1.5 }),
  }
  return _mats
}

/**
 * A cube probe baked once from inside the bowl.
 *
 * The park never moves, so a local reflection costs exactly one render at load
 * and nothing per frame afterwards. This is what turns the bowl from a painted
 * gradient into a surface: at roughness ~0.3 it samples a narrow lobe, so it
 * picks up its own far wall, the coping ring and the sky, and the highlight
 * TRACKS THE CAMERA instead of sitting in the albedo where the old painted
 * sheen ellipses were. The coping and rails get it too — they are the other
 * surfaces glossy enough to show a reflection at all.
 *
 * Position is the bowl centre lifted to roughly deck height: a probe down on
 * the flat sees mostly its own walls and returns a muddy violet, while one at
 * the lip keeps the sky in the upper hemisphere where the transition needs it.
 */
function BowlProbe() {
  const { gl, scene } = useThree()
  useEffect(() => {
    useGame.getState().setWarmupReflectionReady(false)
    const target = new THREE.WebGLCubeRenderTarget(256, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    })
    const cam = new THREE.CubeCamera(0.4, 120, target)
    cam.position.set(BOWL.cx, 0.6, BOWL.cz)
    scene.add(cam)

    const m = mats()
    const users = [m.bowl, m.coping, m.railTeal, m.railPink, m.railYellow]
    // Render with the probe's consumers hidden: a surface must not reflect
    // itself, and the bowl is a closed dish, so leaving it in bakes a purple
    // fog into its own reflection.
    const prev = users.map((mat) => mat.envMap)
    for (const mat of users) mat.envMap = null

    cam.update(gl, scene)

    for (let i = 0; i < users.length; i++) {
      users[i].envMap = target.texture
      users[i].needsUpdate = true
      void prev[i]
    }
    scene.remove(cam)
    // Warmup waits for this exact signal before raising the render tier. The
    // expensive six-face capture therefore happens at low DPR/AO/shadow cost
    // and remains hidden behind the loading screen.
    useGame.getState().setWarmupReflectionReady(true)
    return () => {
      useGame.getState().setWarmupReflectionReady(false)
      target.dispose()
    }
    // once, after the park has mounted — deps intentionally empty
  }, [gl, scene])
  return null
}

// Per-face UV scaling so a shared tiling texture reads at a constant world size.
const FACE_DIMS = [
  [2, 1],
  [2, 1],
  [0, 2],
  [0, 2],
  [0, 1],
  [0, 1],
] // index into [w,h,d]

function texBox(w, h, d, sx = 1, sy = 1) {
  const g = new THREE.BoxGeometry(w, h, d)
  const dims = [w, h, d]
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4)
    const [a, b] = FACE_DIMS[face]
    uv.setXY(i, uv.getX(i) * dims[a] * sx, uv.getY(i) * dims[b] * sy)
  }
  uv.needsUpdate = true
  return g
}

const masonryBox = (w, h, d) => texBox(w, h, d, 1 / MASONRY_TILE_X, 1 / MASONRY_TILE_Y)

// ---------------------------------------------------------------- pieces
function Plaza() {
  const geo = useMemo(() => buildPlazaGeometry(), [])
  const grass = useMemo(() => buildGrassGeometry(), [])
  const m = mats()
  return (
    <>
      <mesh geometry={geo} receiveShadow material={m.plazaGround} />
      {/* landscaped band the trees stand in — a ring, never under the bowl */}
      <mesh geometry={grass} position-y={GRASS_Y} receiveShadow material={m.grass} />
      <Decals />
      <Kerb />
    </>
  )
}

// Scuff, weeds, chalk, drains — one merged mesh of quads lying on the plaza.
// 6mm up rather than coplanar: polygonOffset alone still z-fights at a grazing
// angle across 70m of floor, which is exactly the angle this floor is seen at.
function Decals() {
  const geo = useMemo(() => buildDecalGeometry(), [])
  const m = mats()
  // no castShadow — a flat quad on the ground casts an acne stripe, not a shadow
  return <mesh geometry={geo} position-y={0.006} receiveShadow material={m.decal} />
}

// Low masonry kerb ringing the play area — frames the park and stops the player.
function Kerb() {
  const m = mats()
  const bars = useMemo(() => {
    const P = PERIMETER
    const w = P.maxX - P.minX + 2.8
    const d = P.maxZ - P.minZ + 2.8
    const cx = (P.minX + P.maxX) / 2
    const cz = (P.minZ + P.maxZ) / 2
    return [
      [cx, P.minZ - 1.4, w, 1],
      [cx, P.maxZ + 1.4, w, 1],
      [P.minX - 1.4, cz, 1, d],
      [P.maxX + 1.4, cz, 1, d],
    ].map(([x, z, bw, bd]) => ({ x, z, bw, bd, geo: masonryBox(bw, 0.85, bd) }))
  }, [])
  return bars.map((b, i) => (
    <group key={i} position={[b.x, 0, b.z]}>
      <mesh geometry={b.geo} position-y={0.005} castShadow receiveShadow material={m.masonry} />
      <RoundedBox
        args={[b.bw + 0.14, 0.2, b.bd + 0.14]}
        radius={0.06}
        smoothness={2}
        bevelSegments={2}
        position-y={0.5}
        castShadow
        receiveShadow
        material={m.stone}
      />
    </group>
  ))
}

function Bowl() {
  const m = mats()
  const geo = useMemo(() => buildBowlGeometry(220, 24, 14), [])
  const coping = useMemo(() => buildCopingGeometry(220, 12), [])
  return (
    <group>
      <mesh geometry={geo} receiveShadow material={m.bowl} />
      <mesh geometry={coping} castShadow receiveShadow material={m.coping} />
    </group>
  )
}

// 'solid' = halfpipe structure: one flush plywood block, no masonry body
// and no oversized cap lip, so platform + quarters + top decks read as a
// single built wooden ramp rather than brick walls around a courtyard.
function SolidSlab({ s }) {
  const m = mats()
  const base = s.base || 0
  // texBox, not RoundedBox: box UVs are world-scaled per face, so the top
  // face's v runs along z and the flat's planks line up with the quarters'
  // riding direction (RoundedBox is an extruded shape — its top UVs come out
  // rotated 90 degrees and the flat read as cross-planked).
  const geo = useMemo(
    () => texBox(s.w, s.top - base, s.d, 1 / PLAZA_TILE, 1 / PLAZA_TILE),
    [s.w, s.top, base, s.d],
  )
  // The platform's top IS the halfpipe flat — it takes the blue sheet the
  // quarters ride (BoxGeometry group 2 = +Y). The top decks stay all wood.
  const mat =
    s.id === 'hpDeck' ? [m.wood, m.wood, m.hpSurf, m.wood, m.wood, m.wood] : m.wood
  return (
    <group position={[s.x, 0, s.z]} rotation-y={s.rot || 0}>
      <mesh
        geometry={geo}
        position-y={base + (s.top - base) / 2}
        castShadow
        receiveShadow
        material={mat}
      />
    </group>
  )
}

function Slab({ s }) {
  const m = mats()
  const base = s.base || 0
  const capH = s.style === 'ledge' ? 0.09 : 0.13
  const bodyH = Math.max(0.02, s.top - base - capH)
  const body = useMemo(() => masonryBox(s.w, bodyH, s.d), [s.w, bodyH, s.d])
  const inset = useMemo(
    () => (s.style === 'deck' ? texBox(s.w - 0.8, 0.06, s.d - 0.8, 1 / PLAZA_TILE, 1 / PLAZA_TILE) : null),
    [s.style, s.w, s.d],
  )
  return (
    <group position={[s.x, 0, s.z]} rotation-y={s.rot || 0}>
      <mesh geometry={body} position-y={base + bodyH / 2} castShadow receiveShadow material={m.masonry} />
      <RoundedBox
        args={[s.w + 0.08, capH, s.d + 0.08]}
        radius={0.055}
        smoothness={2}
        bevelSegments={2}
        position-y={s.top - capH / 2}
        castShadow
        receiveShadow
        material={m.stone}
      />
      {inset && (
        <mesh geometry={inset} position-y={s.top - 0.02} receiveShadow material={m.plaza} />
      )}
    </group>
  )
}

function Ramp({ s }) {
  const m = mats()
  const geo = useMemo(
    () => buildRampGeometry(s.w, s.d, s.y0, s.y1, s.curve),
    [s.w, s.d, s.y0, s.y1, s.curve],
  )
  // Coping tube hugging the top corner. The old stone RoundedBox was 0.4 deep,
  // which juts ~0.3 out of a quarter's near-vertical face — the dog rode
  // straight through it at every lip and swept it again on the launch arc. A
  // 7cm tube embedded 2cm into the corner protrudes ~3.5cm, less than the
  // curvature lift (P.surfLift) keeps the body clear of.
  const lipW = s.w + 0.16
  return (
    <group position={[s.x, 0, s.z]} rotation-y={s.rot || 0}>
      {/* 'solid' = the halfpipe: blue sheet on the ridden surface (geometry
          group 0), birch plywood on the skirts and back (group 1), so it reads
          as a built wooden ramp rather than plaza concrete up a curve */}
      <mesh
        geometry={geo}
        castShadow
        receiveShadow
        material={s.style === 'solid' ? [m.hpSurf, m.wood] : m.plaza}
      />
      <mesh
        position={[0, s.y1 - 0.02, s.d / 2 - 0.02]}
        rotation-z={Math.PI / 2}
        castShadow
        receiveShadow
        material={m.coping}
      >
        <cylinderGeometry args={[0.07, 0.07, lipW, 12]} />
      </mesh>
    </group>
  )
}

function Stairs({ s }) {
  const m = mats()
  const rise = (s.y1 - s.y0) / s.steps
  const run = s.d / s.steps
  const steps = []
  for (let i = 0; i < s.steps; i++) {
    steps.push(
      <RoundedBox
        key={i}
        args={[s.w, rise + 0.04, run + 0.06]}
        radius={0.035}
        smoothness={2}
        bevelSegments={2}
        position={[0, s.y0 + rise * (i + 0.5), -s.d / 2 + run * (i + 0.5)]}
        castShadow
        receiveShadow
        material={m.stone}
      />,
    )
  }
  // stringer walls either side
  const sw = useMemo(() => masonryBox(0.5, s.y1 - s.y0 + 0.5, s.d + 0.3), [s.d, s.y0, s.y1])
  return (
    <group position={[s.x, 0, s.z]} rotation-y={s.rot || 0}>
      {steps}
      {[-1, 1].map((k) => (
        <group key={k} position={[k * (s.w / 2 + 0.25), 0, 0]}>
          <mesh
            geometry={sw}
            position-y={s.y0 + (s.y1 - s.y0) / 2 - 0.1}
            castShadow
            receiveShadow
            material={m.masonry}
          />
        </group>
      ))}
    </group>
  )
}

function Wall({ w }) {
  const m = mats()
  const base = w.base || 0
  const capH = 0.2
  const bodyH = Math.max(0.05, w.h - base - capH)
  const body = useMemo(() => masonryBox(w.w, bodyH, w.d), [w.w, bodyH, w.d])
  const mural = w.mural ? getMuralTexture(w.mural) : null
  const long = w.d >= w.w
  const mw = Math.min(long ? w.d : w.w, 3.2) * 0.62
  const mh = Math.min(mw, bodyH * 0.78)
  return (
    <group position={[w.x, 0, w.z]} rotation-y={w.rot || 0}>
      <mesh geometry={body} position-y={base + bodyH / 2} castShadow receiveShadow material={m.masonry} />
      <RoundedBox
        args={[w.w + 0.18, capH, w.d + 0.18]}
        radius={0.07}
        smoothness={2}
        bevelSegments={2}
        position-y={w.h - capH / 2}
        castShadow
        receiveShadow
        material={m.stone}
      />
      {mural &&
        [1, -1].map((k) => (
          <mesh
            key={k}
            position={long ? [k * (w.w / 2 + 0.012), base + bodyH * 0.55, 0] : [0, base + bodyH * 0.55, k * (w.d / 2 + 0.012)]}
            rotation-y={long ? k * (Math.PI / 2) : k > 0 ? 0 : Math.PI}
          >
            <planeGeometry args={[mw, mh]} />
            <meshStandardMaterial map={mural} transparent depthWrite={false} roughness={0.9} />
          </mesh>
        ))}
    </group>
  )
}

// ---------------------------------------------------------------- rails
const RAIL_R = 0.055
// unit height, scaled per post — one geometry for every post in the park
const POST_GEO = new THREE.CylinderGeometry(0.042, 0.05, 1, 8)
const _o = new THREE.Object3D()

function Rail({ r }) {
  const m = mats()
  const material = m[r.color]
  const { tube, posts } = useMemo(() => {
    const pts = r.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2)
    const tube = new THREE.TubeGeometry(curve, Math.max(12, pts.length * 12), RAIL_R, 10, false)
    const total = curve.getLength()
    const n = Math.max(2, Math.round(total / 1.9))
    const posts = new THREE.InstancedMesh(POST_GEO, material, n + 1)
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(i / n)
      const g = groundHeightAt(p.x, p.z)
      const h = Math.max(0.06, p.y - g)
      _o.position.set(p.x, g + h / 2, p.z)
      _o.scale.set(1, h, 1)
      _o.updateMatrix()
      posts.setMatrixAt(i, _o.matrix)
    }
    posts.castShadow = true
    return { tube, posts }
  }, [r, material])

  return (
    <group>
      <mesh geometry={tube} castShadow receiveShadow material={material} />
      <primitive object={posts} dispose={null} />
    </group>
  )
}

// ---------------------------------------------------------------- park
export default function Skatepark() {
  const root = useRef()
  const boxes = SOLIDS.filter((s) => s.kind === 'box')
  const ramps = SOLIDS.filter((s) => s.kind === 'ramp')
  const stairs = SOLIDS.filter((s) => s.kind === 'stairs')

  // Nothing in here ever moves. Bake the world matrices once and opt the whole
  // subtree out of the per-frame matrix walk — that is a few hundred objects.
  useLayoutEffect(() => {
    root.current.updateMatrixWorld(true)
    root.current.matrixWorldAutoUpdate = false
  }, [])

  return (
    <group ref={root}>
      <Plaza />
      <Bowl />
      {boxes.map((s) =>
        s.style === 'solid' ? <SolidSlab key={s.id} s={s} /> : <Slab key={s.id} s={s} />,
      )}
      {ramps.map((s) => (
        <Ramp key={s.id} s={s} />
      ))}
      {stairs.map((s) => (
        <Stairs key={s.id} s={s} />
      ))}
      {WALLS.map((w, i) => (
        <Wall key={i} w={w} />
      ))}
      {RAILS.map((r) => (
        <Rail key={r.id} r={r} />
      ))}
      <Planters />
      <Benches />
      <LampPosts />
      <Trees />
      <Shrubs />
      <Wind />
      {/* last: the probe bakes what everything above it put in the scene */}
      <BowlProbe />
    </group>
  )
}
