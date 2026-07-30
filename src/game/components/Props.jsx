// Decorative set dressing: trees, shrubs, planters, benches, lamp posts.
// Everything static — foliage is baked into InstancedMeshes once and never
// touched again; the hand-placed props share module-level geometry/materials.

import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { C, M } from '../palette.js'
import { PHOTO, PHOTO_TIME } from '../photo.js'
import { TREES, SHRUBS, PLANTERS, BENCHES, LAMPS } from '../level/levelData.js'
import { newBuckets, pushTree, pushBush, pushBed, pushBlooms } from '../level/foliage.js'

const TAU = Math.PI * 2
const prng = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)

// ---------------------------------------------------------------- materials
const foliage = (color) => windy(new THREE.MeshStandardMaterial({ color, ...M.foliage }))

// ---------------------------------------------------------------- wind
// Every plant shares one rooted sway: the bend pivots at the ground, so a trunk
// base never slides out from under its tree, and gust fronts travel along the
// wind instead of the whole park breathing in unison. No per-instance
// attributes — height comes from the vertex's own world Y and the gust phase
// from the instance origin, so this stays a pure vertex-shader effect on the
// existing InstancedMeshes.
const WIND = {
  uTime: { value: 0 },
  uStrength: { value: 1 }, // driven by <Wind strength> — 0 kills it, 2 is a gale
}
const WIND_DIR = new THREE.Vector2(0.82, 0.57).normalize()

const WIND_CHUNK = /* glsl */ `
  vec3 iOrigin = instanceMatrix[3].xyz;
  vec3 wPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  float wH = max(wPos.y, 0.0);
  float wSeed = fract(sin(dot(iOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);

  // gust front sweeping across the park along the wind direction
  float wAlong = dot(iOrigin.xz, WIND_DIR);
  float wGust = pow(sin(wAlong * 0.15 - uTime * 1.05 + wSeed * 6.283) * 0.5 + 0.5, 1.6);
  float wAmp = uStrength * (0.0025 + 0.007 * wGust) * (0.7 + wSeed * 0.6);

  // rooted arc: the point swings about the ground rather than shearing sideways,
  // and the drop keeps it the same distance from the root through the swing
  float wA = wAmp * pow(wH, 1.4);
  vec2 wSwing = WIND_DIR * wH * sin(wA);
  float wDrop = -wH * (1.0 - cos(wA));

  // leaf-scale flutter, deliberately independent of height so low shrubs still
  // shimmer when the canopies above them are barely moving
  float wF = sin(uTime * 5.0 + wPos.x * 2.3 + wPos.z * 1.9 + wSeed * 6.283)
    * 0.022 * uStrength;

  vec3 wOffset = vec3(wSwing.x + wF, wDrop, wSwing.y - wF * 0.6);

  // Take the world-space offset back into instance-local space. The instance
  // basis is a rotation times a per-axis scale, so its columns are orthogonal
  // and the inverse is each column dotted in and divided by its OWN length
  // squared. The previous version divided all three axes by column 0's length
  // squared, which is only correct when the scale is uniform.
  //
  // Leaf clumps are near-spherical so that held. Woody segments are not: a
  // branch scales (0.085, 0.9, 0.085), so column 0 is 0.0072 and every branch
  // got its wind displacement multiplied by about 139 — which is why branches
  // and trunks tore off their trees and floated across the park.
  vec3 wC0 = instanceMatrix[0].xyz;
  vec3 wC1 = instanceMatrix[1].xyz;
  vec3 wC2 = instanceMatrix[2].xyz;
  transformed += vec3(
    dot(wOffset, wC0) / max(dot(wC0, wC0), 1e-6),
    dot(wOffset, wC1) / max(dot(wC1, wC1), 1e-6),
    dot(wOffset, wC2) / max(dot(wC2, wC2), 1e-6)
  );
`

/** Patches a material's vertex stage with the shared sway. */
function windy(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.uTime
    shader.uniforms.uStrength = WIND.uStrength
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uStrength;
         const vec2 WIND_DIR = vec2(${WIND_DIR.x.toFixed(4)}, ${WIND_DIR.y.toFixed(4)});`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_CHUNK}`)
  }
  // without this three would reuse an unpatched MeshStandardMaterial program
  material.customProgramCacheKey = () => 'foliage-wind'
  return material
}

const MAT = {
  trunk: windy(new THREE.MeshStandardMaterial({ color: C.trunk, ...M.bark })),
  branch: windy(new THREE.MeshStandardMaterial({ color: C.trunk, ...M.bark })),
  // white base: every clump carries its own colour, so the canopy ramp is
  // continuous rather than three discrete greens
  foliage: foliage('#ffffff'),
  flowerWhite: windy(new THREE.MeshStandardMaterial({ color: C.flowerWhite, roughness: 0.7 })),
  flowerPink: windy(new THREE.MeshStandardMaterial({ color: C.flowerPink, roughness: 0.7 })),
  flowerYellow: windy(new THREE.MeshStandardMaterial({ color: C.flowerYellow, roughness: 0.7 })),
  masonry: new THREE.MeshStandardMaterial({ color: C.wall, ...M.masonry }),
  cap: new THREE.MeshStandardMaterial({ color: C.cap, ...M.stone }),
  soil: new THREE.MeshStandardMaterial({ color: C.soil, roughness: 0.98 }),
  wood: new THREE.MeshStandardMaterial({ color: C.benchWood, roughness: 0.72 }),
  iron: new THREE.MeshStandardMaterial({ color: C.benchIron, ...M.paintedMetal }),
  lamp: new THREE.MeshStandardMaterial({ color: C.lamp, ...M.paintedMetal }),
  glass: new THREE.MeshStandardMaterial({
    color: C.lampGlass,
    emissive: new THREE.Color(C.lampGlass),
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0,
  }),
}

// ---------------------------------------------------------------- vegetation
/**
 * Perfect spheres are what make procedural foliage read as clip art. One lumpy
 * sphere, plus a random 3-axis rotation per blob, means no two clumps in the
 * park share a silhouette — for the price of a single extra geometry.
 */
function lumpy(geo, amp, freq, seed) {
  const g = geo.clone()
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const d =
      Math.sin(v.x * freq + seed) * Math.cos(v.y * freq * 1.3 - seed) +
      Math.sin(v.z * freq * 0.8 + seed * 1.7) * Math.cos(v.x * freq * 1.1 + seed)
    v.multiplyScalar(1 + amp * d * 0.5)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

// Clumps are small and numerous, so the dent only has to break the outline —
// the old 0.36 on a big sphere is what turned canopies into faceted boulders.
//
// 7x5, not 9x7. Halving the clump radius to buy canopy grain multiplied the
// instance count by ~3 (47k clumps, 5.2M tris — the park's whole triangle
// budget, and foliage draws twice because it casts). A clump is now 0.15 m
// across and covers a dozen pixels at the game camera's distance, so the ring
// count is spent on nothing; 7x5 gets the same silhouette for half the tris and
// puts the budget back where it was.
const SPHERE = lumpy(new THREE.SphereGeometry(1, 7, 5), 0.2, 3.4, 3.1)
const SPHERE_LO = new THREE.SphereGeometry(1, 7, 5) // flowers stay round, they are tiny

// Woody segments are UNIT cylinders anchored at their base, so a row's scale is
// (radius, length, radius) and its two rotation terms aim it. Anchoring at the
// base is what lets a branch grow from an arbitrary point on the trunk without
// the generator having to solve for a midpoint.
function woodyGeo(taper, seg) {
  return new THREE.CylinderGeometry(taper, 1, 1, seg).translate(0, 0.5, 0)
}
const TRUNK = woodyGeo(0.62, 10)
const BRANCH = woodyGeo(0.42, 6)

const BUCKET_GEO = {
  trunk: TRUNK,
  branch: BRANCH,
  flowerWhite: SPHERE_LO,
  flowerPink: SPHERE_LO,
  flowerYellow: SPHERE_LO,
}

const _o = new THREE.Object3D()
const _col = new THREE.Color()

function bake(key, rows, receive) {
  const mat = MAT[key]
  const mesh = new THREE.InstancedMesh(BUCKET_GEO[key] || SPHERE, mat, rows.length)
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i]
    _o.position.set(e[0], e[1], e[2])
    // YXZ: yaw first, then tilt off vertical. That is the order foliage.js aims
    // woody segments in — under the default XYZ a branch's yaw would be applied
    // after its tilt and every one of them would swing to the wrong bearing.
    _o.rotation.set(e[7] || 0, e[6], e[8] || 0, 'YXZ')
    _o.scale.set(e[3], e[4], e[5])
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
    // instanceColor multiplies the material colour, so divide the base back
    // out. Rows without a colour (flowers) fall through as a plain multiply-by-1.
    if (e.length > 9) {
      _col.setRGB(
        e[9] / Math.max(mat.color.r, 0.02),
        e[10] / Math.max(mat.color.g, 0.02),
        e[11] / Math.max(mat.color.b, 0.02),
      )
    } else {
      _col.setRGB(1, 1, 1)
    }
    mesh.setColorAt(i, _col)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor.needsUpdate = true
  mesh.castShadow = key === 'trunk' || key === 'branch' || key === 'foliage'
  mesh.receiveShadow = receive
  return mesh
}

/**
 * Bakes a repeated prop into one InstancedMesh per (geometry, material) part.
 * `parts` describe one copy in local space; `spots` are the world placements.
 * 13 benches of 19 pieces each go from 247 draw calls to 4.
 */
const _local = new THREE.Matrix4()
const _world = new THREE.Matrix4()

function instanceProp(parts, spots) {
  const groups = new Map()
  for (const p of parts) {
    const key = p.geo.uuid + p.mat.uuid
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { geo: p.geo, mat: p.mat, local: [], cast: false, receive: false }))
    _o.position.set(...(p.pos || [0, 0, 0]))
    _o.rotation.set(...(p.rot || [0, 0, 0]))
    _o.scale.set(...(p.scale || [1, 1, 1]))
    _o.updateMatrix()
    g.local.push(_o.matrix.clone())
    if (p.cast !== false) g.cast = true
    if (p.receive) g.receive = true
  }

  return [...groups.values()].map((g) => {
    const mesh = new THREE.InstancedMesh(g.geo, g.mat, g.local.length * spots.length)
    let i = 0
    for (const s of spots) {
      _o.position.set(s.x, s.base || 0, s.z)
      _o.rotation.set(0, s.rot || 0, 0)
      _o.scale.setScalar(1)
      _o.updateMatrix()
      _world.copy(_o.matrix)
      for (const l of g.local) mesh.setMatrixAt(i++, _local.multiplyMatrices(_world, l))
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = g.cast
    mesh.receiveShadow = g.receive
    return mesh
  })
}

const Instanced = ({ meshes }) =>
  meshes.map((m, i) => <primitive key={i} object={m} dispose={null} />)

// ---------------------------------------------------------------- grounding
// A soft darkening where each plant meets the ground. Without it every tree and
// shrub reads as an object resting on a plane rather than growing out of one —
// the sun shadow alone only covers whatever is inside the shadow frustum.
const SHADE_GEO = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2)
let _shadeMat = null
function shadeMat() {
  if (_shadeMat) return _shadeMat
  const t = canvasTexture(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    grad.addColorStop(0, 'rgba(0,0,0,0.85)')
    grad.addColorStop(0.55, 'rgba(0,0,0,0.4)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, w, w)
  })
  _shadeMat = new THREE.MeshBasicMaterial({
    map: t,
    color: '#33411f',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  return _shadeMat
}

/** rows: [x, groundY, z, radius] */
function bakeShade(rows) {
  const mesh = new THREE.InstancedMesh(SHADE_GEO, shadeMat(), rows.length)
  for (let i = 0; i < rows.length; i++) {
    const [x, y, z, rad] = rows[i]
    _o.position.set(x, y + 0.012, z)
    _o.rotation.set(0, 0, 0)
    _o.scale.set(rad, 1, rad)
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.renderOrder = 1
  return mesh
}

function Clumps({ buckets, receive = false }) {
  const meshes = useMemo(
    () =>
      Object.entries(buckets)
        .filter(([, rows]) => rows.length > 0)
        .map(([key, rows]) => bake(key, rows, receive)),
    [buckets, receive],
  )
  return meshes.map((m, i) => <primitive key={i} object={m} dispose={null} />)
}

export function Trees() {
  const { buckets, shade } = useMemo(() => {
    const b = newBuckets()
    TREES.forEach((t, i) => pushTree(b, t.x, t.base || 0, t.z, t.s, t.r, prng(9001 + i * 977)))
    return {
      buckets: b,
      shade: bakeShade(TREES.map((t) => [t.x, t.base || 0, t.z, 1.7 * t.s])),
    }
  }, [])
  return (
    <>
      <Clumps buckets={buckets} />
      <primitive object={shade} dispose={null} />
    </>
  )
}

export function Shrubs() {
  const { buckets, shade } = useMemo(() => {
    const b = newBuckets()
    SHRUBS.forEach((s, i) => pushBush(b, s.x, s.base || 0, s.z, s.s, s.r, prng(4243 + i * 613)))
    return {
      buckets: b,
      shade: bakeShade(SHRUBS.map((s) => [s.x, s.base || 0, s.z, 0.85 * s.s])),
    }
  }, [])
  return (
    <>
      <Clumps buckets={buckets} receive />
      <primitive object={shade} dispose={null} />
    </>
  )
}

/** Advances the shared wind clock. One uniform, every plant in the park. */
export function Wind({ strength = 1 }) {
  useFrame((_, delta) => {
    WIND.uStrength.value = strength
    // photo mode pins the clock so every capture of a pose is identical
    WIND.uTime.value = PHOTO ? PHOTO_TIME : WIND.uTime.value + Math.min(delta, 0.1)
  })
  return null
}

// ---------------------------------------------------------------- planters
const LIP = 0.26 // width of the stone rail that frames the top edge
const LIP_H = 0.2

export function Planters() {
  const buckets = useMemo(() => {
    const b = newBuckets()
    PLANTERS.forEach((p, i) => {
      const rnd = prng(7331 + i * 613)
      const soil = (p.base || 0) + p.h + 0.01
      // inner rectangle: the bed the stone lip frames
      const iw = Math.max(0.6, p.w - LIP * 2)
      const id = Math.max(0.6, p.d - LIP * 2)
      if (p.plant === 'tree') {
        pushTree(b, p.x, soil, p.z, 0.92, rnd() * TAU, rnd)
        // Under-planting, not a ring of shrubs on bare earth. `hole` keeps the
        // trunk clear; without it the tree looks like it is growing out of a
        // hedge rather than standing in one.
        pushBed(b, p.x, soil, p.z, iw, id, rnd, 1, { fill: 0.9, rise: 0.3, hole: 0.42 })
        pushBlooms(b, p.x, soil, p.z, iw, id, rnd, 1, { per: 0.9, rise: 0.3 })
      } else {
        pushBed(b, p.x, soil, p.z, iw, id, rnd)
        pushBlooms(b, p.x, soil, p.z, iw, id, rnd)
      }
    })
    return b
  }, [])

  return (
    <group>
      {PLANTERS.map((p, i) => {
        const base = p.base || 0
        const top = base + p.h
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            <RoundedBox
              args={[p.w, p.h, p.d]}
              radius={0.1}
              smoothness={2}
              bevelSegments={3}
              position={[0, base + p.h / 2, 0]}
              material={MAT.masonry}
              castShadow
              receiveShadow
            />
            {/* four rails instead of a slab so the top stays open for planting */}
            {[
              [0, (p.d + 0.24) / 2 - LIP / 2, p.w + 0.24, LIP],
              [0, -(p.d + 0.24) / 2 + LIP / 2, p.w + 0.24, LIP],
              [(p.w + 0.24) / 2 - LIP / 2, 0, LIP, p.d + 0.24],
              [-(p.w + 0.24) / 2 + LIP / 2, 0, LIP, p.d + 0.24],
            ].map(([lx, lz, lw, ld], k) => (
              <RoundedBox
                key={k}
                args={[lw, LIP_H, ld]}
                radius={0.065}
                smoothness={2}
                bevelSegments={2}
                position={[lx, top - LIP_H / 2, lz]}
                material={MAT.cap}
                castShadow
                receiveShadow
              />
            ))}
            <RoundedBox
              args={[p.w - LIP * 2, 0.26, p.d - LIP * 2]}
              radius={0.05}
              smoothness={2}
              bevelSegments={1}
              position={[0, top - 0.12, 0]}
              material={MAT.soil}
              receiveShadow
            />
          </group>
        )
      })}
      <Clumps buckets={buckets} receive />
    </group>
  )
}

// ---------------------------------------------------------------- benches
const SEAT_SLAT = new RoundedBoxGeometry(1.72, 0.095, 0.17, 2, 0.042)
const BACK_SLAT = new RoundedBoxGeometry(1.72, 0.17, 0.09, 2, 0.042)
const BAR = new THREE.CylinderGeometry(0.044, 0.044, 1, 10)
const ARM_CURL = new THREE.TorusGeometry(0.11, 0.032, 6, 12, Math.PI / 2)

const SEAT_Z = [-0.26, -0.09, 0.08, 0.25]
const BACK_Y = [0.54, 0.68, 0.82]
const BACK_TILT = -0.16

// One side frame, mirrored onto both ends. The front leg runs unbroken from
// the ground into the armrest curl.
const benchFrame = (side) => {
  const x = side * 0.72
  const iron = (pos, rot, scale) => ({ geo: BAR, mat: MAT.iron, pos, rot, scale })
  return [
    iron([x, 0.275, 0.22], null, [1, 0.55, 1]),
    iron([x, 0.21, -0.26], null, [1, 0.42, 1]),
    iron([x, 0.38, -0.02], [Math.PI / 2, 0, 0], [1, 0.64, 1]),
    iron([x, 0.66, -0.32], [BACK_TILT, 0, 0], [1, 0.56, 1]),
    iron([x, 0.66, -0.05], [Math.PI / 2, 0, 0], [1, 0.5, 1]),
    { geo: ARM_CURL, mat: MAT.iron, pos: [x, 0.55, 0.11], rot: [0, -Math.PI / 2, 0] },
  ]
}

const BENCH_PARTS = [
  ...SEAT_Z.map((z) => ({ geo: SEAT_SLAT, mat: MAT.wood, pos: [0, 0.415, z], receive: true })),
  ...BACK_Y.map((y) => ({
    geo: BACK_SLAT,
    mat: MAT.wood,
    pos: [0, y, -0.3 + (y - 0.54) * BACK_TILT],
    rot: [BACK_TILT, 0, 0],
    receive: true,
  })),
  ...benchFrame(1),
  ...benchFrame(-1),
]

export function Benches() {
  const meshes = useMemo(() => instanceProp(BENCH_PARTS, BENCHES), [])
  return <Instanced meshes={meshes} />
}

// ---------------------------------------------------------------- textures
function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  draw(cv.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

const dot = (g, x, y, r) => {
  g.beginPath()
  g.arc(x, y, r, 0, TAU)
  g.fill()
}

function bannerTexture(kind) {
  return canvasTexture(128, 224, (g, w, h) => {
    g.fillStyle = C.bannerPink
    g.fillRect(0, 0, w, h)
    g.strokeStyle = C.bannerCream
    g.lineWidth = 7
    g.strokeRect(11, 11, w - 22, h - 22)
    g.fillStyle = C.bannerCream
    const cx = w / 2
    const cy = h / 2
    if (kind === 'skate') {
      g.save()
      g.translate(cx, cy - 6)
      g.rotate(-0.16)
      g.beginPath()
      g.roundRect(-38, -10, 76, 20, 10)
      g.fill()
      dot(g, -19, 22, 8)
      dot(g, 19, 22, 8)
      g.restore()
    } else {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU - Math.PI / 2
        dot(g, cx + Math.cos(a) * 25, cy + Math.sin(a) * 25, 17)
      }
      g.fillStyle = C.flowerYellow
      dot(g, cx, cy, 14)
    }
  })
}

const BANNER_MAT = {
  skate: new THREE.MeshStandardMaterial({ map: bannerTexture('skate'), side: THREE.DoubleSide, ...M.cloth }),
  flower: new THREE.MeshStandardMaterial({ map: bannerTexture('flower'), side: THREE.DoubleSide, ...M.cloth }),
}

// Flat plane pushed into a soft S so the cloth reads as hanging, not stamped on.
const BANNER_GEO = (() => {
  const g = new THREE.PlaneGeometry(0.55, 0.95, 6, 10)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const t = (p.getY(i) + 0.475) / 0.95 // 0 at the hem, 1 at the hanging edge
    p.setZ(i, 0.1 * Math.sin(t * Math.PI * 1.7 + 0.45) * (1 - t * 0.4) + 0.022 * Math.cos(x * 8))
  }
  g.computeVertexNormals()
  return g
})()

const CREAM = '#fdf5ea'
const MINT = '#9fd9c4'
const murals = new Map()

function drawMural(kind, g) {
  g.globalAlpha = 0.78
  if (kind === 'flower') {
    g.strokeStyle = MINT
    g.lineWidth = 11
    g.beginPath()
    g.moveTo(128, 130)
    g.quadraticCurveTo(136, 190, 128, 226)
    g.stroke()
    g.fillStyle = MINT
    for (const [lx, ly, rot] of [[92, 198, -0.55], [166, 206, 0.55]]) {
      g.save()
      g.translate(lx, ly)
      g.rotate(rot)
      g.beginPath()
      g.ellipse(0, 0, 30, 14, 0, 0, TAU)
      g.fill()
      g.restore()
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2
      const px = 128 + Math.cos(a) * 56
      const py = 108 + Math.sin(a) * 56
      g.fillStyle = C.flowerPink
      dot(g, px, py, 45)
      g.fillStyle = CREAM
      dot(g, px - Math.cos(a) * 5, py - Math.sin(a) * 5, 33)
    }
    g.fillStyle = C.flowerYellow
    dot(g, 128, 108, 30)
  } else if (kind === 'rainbow') {
    g.lineWidth = 15
    const bands = [C.flowerPink, '#f7c6a4', C.flowerYellow, MINT, '#cbb8f0']
    bands.forEach((col, i) => {
      g.strokeStyle = col
      g.beginPath()
      g.arc(128, 188, 100 - i * 16, Math.PI, TAU)
      g.stroke()
    })
    g.fillStyle = CREAM
    for (const cx of [40, 216]) {
      dot(g, cx - 20, 196, 17)
      dot(g, cx, 186, 24)
      dot(g, cx + 20, 196, 17)
    }
  } else {
    g.fillStyle = MINT
    g.beginPath()
    g.moveTo(24, 104)
    g.quadraticCurveTo(34, 132, 72, 136)
    g.lineTo(184, 136)
    g.quadraticCurveTo(222, 132, 232, 104)
    g.quadraticCurveTo(216, 120, 184, 120)
    g.lineTo(72, 120)
    g.quadraticCurveTo(40, 120, 24, 104)
    g.closePath()
    g.fill()
    g.fillStyle = CREAM
    g.beginPath()
    g.roundRect(72, 134, 16, 18, 5)
    g.roundRect(168, 134, 16, 18, 5)
    g.fill()
    dot(g, 80, 164, 14)
    dot(g, 176, 164, 14)
  }
}

/** Cached pastel decal for the lavender masonry walls. */
// eslint-disable-next-line react-refresh/only-export-components
export function getMuralTexture(kind) {
  let t = murals.get(kind)
  if (!t) murals.set(kind, (t = canvasTexture(256, 256, (g) => drawMural(kind, g))))
  return t
}

// ---------------------------------------------------------------- lamp posts
const L = {
  plinth: new THREE.CylinderGeometry(0.3, 0.4, 0.16, 14),
  swell: new THREE.CylinderGeometry(0.2, 0.3, 0.2, 14),
  foot: new THREE.CylinderGeometry(0.135, 0.2, 0.3, 14),
  column: new THREE.CylinderGeometry(0.072, 0.135, 4.2, 14),
  collar: new THREE.TorusGeometry(0.115, 0.034, 6, 16),
  neck: new THREE.CylinderGeometry(0.135, 0.085, 0.18, 12),
  shoulder: new THREE.CylinderGeometry(0.2, 0.135, 0.12, 8),
  glass: new THREE.CylinderGeometry(0.155, 0.205, 0.44, 8),
  crown: new THREE.CylinderGeometry(0.1, 0.235, 0.2, 8),
  finial: new THREE.SphereGeometry(0.075, 10, 8),
  tip: new THREE.CylinderGeometry(0, 0.05, 0.14, 8),
  arm: new THREE.CylinderGeometry(0.036, 0.036, 1, 9),
}

const LAMP_PARTS = [
  { geo: L.plinth, mat: MAT.lamp, pos: [0, 0.08, 0], receive: true },
  { geo: L.swell, mat: MAT.lamp, pos: [0, 0.26, 0] },
  { geo: L.foot, mat: MAT.lamp, pos: [0, 0.51, 0] },
  { geo: L.column, mat: MAT.lamp, pos: [0, 2.76, 0] },
  { geo: L.collar, mat: MAT.lamp, pos: [0, 2.5, 0], rot: [Math.PI / 2, 0, 0] },
  { geo: L.neck, mat: MAT.lamp, pos: [0, 4.95, 0] },
  { geo: L.shoulder, mat: MAT.lamp, pos: [0, 5.1, 0] },
  { geo: L.glass, mat: MAT.glass, pos: [0, 5.38, 0], cast: false },
  { geo: L.crown, mat: MAT.lamp, pos: [0, 5.7, 0] },
  { geo: L.finial, mat: MAT.lamp, pos: [0, 5.85, 0] },
  { geo: L.tip, mat: MAT.lamp, pos: [0, 5.96, 0] },
]

const bannerParts = (side, kind) => [
  { geo: L.arm, mat: MAT.lamp, pos: [side * 0.36, 3.56, 0], rot: [0, 0, Math.PI / 2], scale: [1, 0.72, 1] },
  { geo: L.finial, mat: MAT.lamp, pos: [side * 0.72, 3.56, 0], scale: [0.62, 0.62, 0.62] },
  { geo: BANNER_GEO, mat: BANNER_MAT[kind], pos: [side * 0.4, 3.045, 0], receive: true },
]

export function LampPosts() {
  const meshes = useMemo(() => {
    const out = instanceProp(LAMP_PARTS, LAMPS)
    // banners alternate sides and come in two prints, so each (kind, side)
    // pair bakes as its own small batch
    const groups = new Map()
    LAMPS.forEach((l, i) => {
      if (!l.banner) return
      const side = i % 2 ? -1 : 1
      const key = `${l.banner}${side}`
      const g = groups.get(key)
      if (g) g.spots.push(l)
      else groups.set(key, { side, kind: l.banner, spots: [l] })
    })
    for (const g of groups.values()) out.push(...instanceProp(bannerParts(g.side, g.kind), g.spots))
    return out
  }, [])
  return <Instanced meshes={meshes} />
}
