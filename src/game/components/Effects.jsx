import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { P, useGame, on } from '../store.js'
import { PHOTO, PHOTO_TIME } from '../photo.js'
import { useSceneSettings } from '../level/levelEdits.js'

// CPU-simulated particle pools. One InstancedMesh per pool, buffers allocated
// once at module scope, no allocation inside the frame loop. Instances have no
// per-instance alpha, so every fade is done by scaling the instance to zero.
//
// Cartoon kit: confetti-coloured grind sparks (per-instance colour), 5-point
// star pops on tricks/bails/long grinds, expanding shockwave rings on
// jump/land/grind-start, and anime speed streaks past the player at speed.
// Star/ring/streak materials are MeshBasicMaterial with toneMapped:false so
// they stay flat, saturated cel colours and feed the Bloom pass directly.

const DUST_N = 90
const SPARK_N = 110
const TRAIL_N = 40
const STAR_N = 40 // grind sparkle stream + trick bursts share this pool
const RING_N = 12
const SMASH_RING_N = 8
const STREAK_N = 40
const TRASH_N = 44 // ~10 scraps per can, so two cans in quick succession fit
const TAU = Math.PI * 2

const dustGeo = new THREE.SphereGeometry(1, 8, 6)
const dustMat = new THREE.MeshStandardMaterial({
  color: '#fff2e4',
  roughness: 1,
  metalness: 0,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
})

const sparkGeo = new THREE.BoxGeometry(0.035, 0.035, 0.22)
const sparkMat = new THREE.MeshBasicMaterial({
  color: '#ffffff', // multiplied by per-instance confetti colour
  toneMapped: false,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
})

// flat disc lying in the XZ plane, normal along local +Y
const trailGeo = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2)
const trailMat = new THREE.MeshStandardMaterial({
  color: '#eaf1ff',
  roughness: 1,
  metalness: 0,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
  side: THREE.DoubleSide,
})

function starShape(outer, inner) {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (i / 10) * TAU - Math.PI / 2
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  return new THREE.ShapeGeometry(s)
}
const starGeo = starShape(1, 0.46)
const starMat = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  toneMapped: false,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  side: THREE.DoubleSide,
})

// flat ring in the XZ plane, expanded per-instance for the shockwave
const ringGeo = new THREE.RingGeometry(0.78, 1, 28).rotateX(-Math.PI / 2)
const ringMat = new THREE.MeshBasicMaterial({
  color: '#fffbe8',
  toneMapped: false,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  side: THREE.DoubleSide,
})
const smashRingMat = ringMat.clone()

// Litter: a flat crumpled scrap. LIT, not toneMapped-off like the sparks — a
// bit of rubbish is a real object in the park and has to sit in the same light
// as the can it came out of, or it reads as another particle effect.
const trashGeo = new THREE.BoxGeometry(1, 0.72, 0.12)
const trashMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true })

// Ambient air: dust motes. ponytail: no pool, no spawner, no lifetimes —
// position is analytic in (index, time) and the field WRAPS around the camera,
// so nothing is ever allocated, expired or respawned. Seeds are golden-ratio
// sequences rather than Math.random so photo captures stay comparable run to
// run (same reason the wind clock is pinned). Drifting leaves lived here too
// and were cut by request.
const MOTE_N = 220
const AMB_R = 13 // half-extent of the wrap box, horizontal
const AMB_RY = 5

const moteGeo = new THREE.CircleGeometry(1, 6)
const moteMat = new THREE.MeshBasicMaterial({
  color: '#fff4e0',
  toneMapped: false, // under the bloom threshold: a mote glints, it doesn't glow
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
})

// Hairline cross-section; view-plane orientation (streakAt) is what keeps it
// readable at chase distance — the old 0.03 end-on stick was ~2px. Length = Z.
const streakGeo = new THREE.BoxGeometry(0.05, 0.02, 1)
const streakMat = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  toneMapped: false,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
})

// confetti palettes, pre-converted so spawn writes are raw float copies
const asRGB = (hexes) => hexes.map((h) => new THREE.Color(h).convertSRGBToLinear())
const SPARK_COLS = asRGB(['#ffe14d', '#ff9d2e', '#ff5da2', '#4dd8ff', '#ffffff'])
const STAR_COLS = asRGB(['#ffd94d', '#ffb347', '#ff6fb5', '#7de8ff'])
const GOLD = asRGB(['#ffe14d', '#ffd94d', '#fff3b0', '#ffb347'])
// the can's own paint — enamel teal, galvanised rim, the warm band, plus a
// white hot flash so the burst still reads against the teal plaza shadows
const CAN_COLS = asRGB(['#4f7f79', '#a9c4bf', '#e8a253', '#ffffff'])
// what's actually in the bin: newspaper, cardboard, a squashed soda can, a
// banana skin, a green bottle, a pink wrapper. Read as ALBEDO (the material is
// lit), so these are the paints, not glow values.
const TRASH_COLS = asRGB(['#f2ece0', '#c99a63', '#e05a4d', '#f2d24b', '#6fae63', '#f08bbd'])
// full hue wheel for grind sparkles, kept light so every hue reads on concrete
const RAINBOW = Array.from({ length: 12 }, (_, i) =>
  new THREE.Color().setHSL(i / 12, 1, 0.62).convertSRGBToLinear())

function pool(n, quat, col) {
  const f = () => new Float32Array(n)
  return {
    n,
    cur: 0,
    x: f(), y: f(), z: f(),
    vx: f(), vy: f(), vz: f(),
    life: f(), max: f(), size: f(), rot: f(),
    q: quat ? new Float32Array(n * 4) : null,
    col: col ? new Float32Array(n * 3) : null,
  }
}

const dust = pool(DUST_N)
const spark = pool(SPARK_N, false, true)
const trail = pool(TRAIL_N, true)
const star = pool(STAR_N, false, true)
const ring = pool(RING_N, true)
const smashRing = pool(SMASH_RING_N, true)
const streak = pool(STREAK_N, true)
// q holds (axis.x, axis.y, axis.z, spin rate) and `rot` accumulates the phase —
// a scrap tumbles about one fixed random axis, which is what a flat thing
// thrown into the air does. A second quaternion per instance would be a second
// integration to keep stable for nothing.
const trash = pool(TRASH_N, true, true)

const _o = new THREE.Object3D()
const _v = new THREE.Vector3()
const _up = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const FWD = new THREE.Vector3(0, 0, 1)
const YUP = new THREE.Vector3(0, 1, 0)
const ZAXIS = new THREE.Vector3(0, 0, 1)
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

const rnd = (a) => (Math.random() * 2 - 1) * a
const isLow = () => useGame.getState().quality === 'low'

/** Round-robin write cursor: the oldest particle is the one overwritten. */
function alloc(p, x, y, z, vx, vy, vz, life, size) {
  const i = p.cur
  p.cur = (p.cur + 1) % p.n
  p.x[i] = x
  p.y[i] = y
  p.z[i] = z
  p.vx[i] = vx
  p.vy[i] = vy
  p.vz[i] = vz
  p.life[i] = p.max[i] = life
  p.size[i] = size
  p.rot[i] = Math.random() * TAU
  return i
}

// k pushes the written colour into HDR. The composer tone-maps as a post pass
// (material toneMapped:false is a no-op there) and Bloom's threshold sits at
// ~1.18 scene-linear luminance, so anything meant to glow must exceed it —
// the old sparks did this via emissiveIntensity 2.4.
function setCol(p, i, palette, k = 1) {
  const c = palette[(Math.random() * palette.length) | 0]
  p.col[i * 3] = c.r * k
  p.col[i * 3 + 1] = c.g * k
  p.col[i * 3 + 2] = c.b * k
}

function puff(x, y, z, vx, vy, vz, scale) {
  alloc(
    dust,
    x + rnd(0.08), y + rnd(0.04), z + rnd(0.08),
    vx + rnd(0.35), vy + Math.random() * 0.4, vz + rnd(0.35),
    0.5 + Math.random() * 0.35,
    (0.2 + Math.random() * 0.12) * scale,
  )
}

// hot: grind-fountain sparks fly harder and higher than scuffs
function sparkAt(x, y, z, dx, dz, hot = 0, palette = SPARK_COLS) {
  const s = 2.4 + Math.random() * 2 + hot * 1.5
  const i = alloc(
    spark,
    x + rnd(0.04), y + rnd(0.03), z + rnd(0.04),
    dx * s + rnd(1.5 + hot), 0.4 + Math.random() * (1.4 + hot * 1.6), dz * s + rnd(1.5 + hot),
    0.25 + Math.random() * 0.15,
    1,
  )
  setCol(spark, i, palette, 3.2) // well past the bloom threshold: sparks glow
}

// Grind fountain: two side-fans perpendicular to travel. Sparks spawned at the
// contact point itself sit under the dog's belly, and from the chase camera
// the body occludes them completely (verified by forcing state='grind' in
// photo mode) — while the backward world velocity leaves them behind a player
// moving at rail speed. Sideways + up clears the silhouette from any angle.
function grindSpark(bx, bz, heat) {
  const side = Math.random() < 0.5 ? 1 : -1
  const rx = -bz * side
  const rz = bx * side
  const s = 1.6 + Math.random() * 1.6 + heat * 1.8
  const i = alloc(
    spark,
    P.pos.x + rx * 0.1, P.pos.y - 0.04, P.pos.z + rz * 0.1,
    rx * s + bx * (0.8 + Math.random()), 1.4 + Math.random() * (1.6 + heat * 1.6), rz * s + bz * (0.8 + Math.random()),
    0.35 + Math.random() * 0.2,
    1,
  )
  setCol(spark, i, RAINBOW, 3.2)
}

function starAt(x, y, z, vx, vy, vz, size, palette = STAR_COLS) {
  const i = alloc(star, x, y, z, vx, vy, vz, 0.55 + Math.random() * 0.25, size)
  setCol(star, i, palette, 1.8) // a soft glow — stars are big enough already
}

function ringAt(x, y, z, size) {
  // shockwave lies on the surface the player is riding, not world-flat
  _q.setFromUnitVectors(YUP, _up.copy(P.up).normalize())
  const i = alloc(ring, x, y, z, 0, 0, 0, 0.35, size)
  _q.toArray(ring.q, i * 4)
}

function smashRingAt(x, y, z, size) {
  _q.setFromUnitVectors(YUP, _up.copy(P.up).normalize())
  const i = alloc(smashRing, x, y, z, 0, 0, 0, 0.35, size)
  _q.toArray(smashRing.q, i * 4)
}

// All-gold celebration burst: star fountain + spark scatter + surface
// shockwave. Shared by 'bone' and 'goal' — a challenge should read like the
// last bone did, not invent a second reward language.
function goldBurst(pos, big) {
  const n = (big ? 18 : 11) >> (isLow() ? 1 : 0)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(0.3)
    const cx = Math.cos(a)
    const cz = Math.sin(a)
    starAt(pos.x + cx * 0.18, pos.y + rnd(0.15), pos.z + cz * 0.18,
      cx * (1.2 + Math.random()), 1.3 + Math.random() * 1.7, cz * (1.2 + Math.random()),
      0.08 + Math.random() * 0.06, GOLD)
    if (i % 2 === 0) sparkAt(pos.x, pos.y, pos.z, cx * 0.4, cz * 0.4, 0.6, GOLD)
  }
  ringAt(pos.x, pos.y, pos.z, big ? 0.8 : 0.5)
}

// Rubbish out of a smashed can: thrown UP out of the mouth first and only then
// carried along travel, because a can that sprays its contents flat looks like
// it exploded rather than like it was knocked over.
function trashAt(x, y, z, dx, dz, k) {
  const a = Math.random() * TAU
  const spread = 0.5 + Math.random() * 1.5
  const i = alloc(
    trash,
    x + Math.cos(a) * 0.2, y + 0.5 + Math.random() * 0.4, z + Math.sin(a) * 0.2,
    Math.cos(a) * spread + dx * k, 2.6 + Math.random() * 2.4, Math.sin(a) * spread + dz * k,
    0.9 + Math.random() * 0.7,
    0.1 + Math.random() * 0.1,
  )
  // tumble axis: any direction, biased off vertical so the scrap flashes its
  // face at the camera instead of spinning edge-on like a coin
  const ax = rnd(1), ay = rnd(0.5), az = rnd(1)
  const l = Math.hypot(ax, ay, az) || 1
  trash.q[i * 4] = ax / l
  trash.q[i * 4 + 1] = ay / l
  trash.q[i * 4 + 2] = az / l
  trash.q[i * 4 + 3] = 6 + Math.random() * 8
  setCol(trash, i, TRASH_COLS)
}

function stepTrash(mesh, dt) {
  const drag = Math.exp(-0.9 * dt)
  for (let i = 0; i < TRASH_N; i++) {
    const a = trash.life[i] - dt
    if (a <= 0) {
      trash.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    trash.life[i] = a
    trash.vy[i] -= 9 * dt // paper falls slower than the 22 the player gets
    trash.vx[i] *= drag
    trash.vz[i] *= drag
    trash.x[i] += trash.vx[i] * dt
    trash.y[i] += trash.vy[i] * dt
    trash.z[i] += trash.vz[i] * dt
    trash.rot[i] += trash.q[i * 4 + 3] * dt

    const f = a / trash.max[i]
    _v.set(trash.q[i * 4], trash.q[i * 4 + 1], trash.q[i * 4 + 2])
    _q.setFromAxisAngle(_v, trash.rot[i])
    _o.quaternion.copy(_q)
    _o.position.set(trash.x[i], trash.y[i], trash.z[i])
    // no ground test — the park is uneven and a scrap that asks the level
    // where the floor is costs a raycast per piece per frame. It shrinks out
    // in the last third instead, which lands about when it would have.
    _o.scale.setScalar(trash.size[i] * Math.min(1, f / 0.33))
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  pushColors(mesh, trash)
}

function streakAt(camera) {
  if (P.vel.lengthSq() < 1e-6) return
  // Length lives in the VIEW PLANE, not along world travel. Aligning with
  // velocity alone aimed the stick at the chase lens whenever you ran down the
  // look axis — end-on, invisible. The intro orbit showed them because it
  // spent half its time looking from the side.
  camera.getWorldDirection(_up)
  _fwd.copy(P.vel).normalize()
  _fwd.addScaledVector(_up, -_fwd.dot(_up))
  if (_fwd.lengthSq() < 1e-6) {
    _fwd.crossVectors(_up, YUP)
    if (_fwd.lengthSq() < 1e-6) _fwd.set(1, 0, 0)
  }
  _fwd.normalize()
  _right.crossVectors(_up, _fwd).normalize()
  _v.crossVectors(_fwd, _right).normalize()
  _m.makeBasis(_right, _v, _fwd)
  _q.setFromRotationMatrix(_m)
  // Tube around the dog, biased toward the lens so the whip-past crosses the
  // frame instead of sitting on a silhouette 32m away.
  const a = Math.random() * TAU
  const r = 0.5 + Math.random() * 0.85
  _v.set(camera.position.x - P.pos.x, 0, camera.position.z - P.pos.z)
  if (_v.lengthSq() > 1e-6) _v.normalize()
  else _v.set(0, 0, 1)
  const toward = 0.4 + Math.random() * 1.4
  const i = alloc(
    streak,
    P.pos.x + Math.cos(a) * r + _v.x * toward,
    P.pos.y + 0.25 + Math.random() * 1.1,
    P.pos.z + Math.sin(a) * r + _v.z * toward,
    0, 0, 0,
    0.28 + Math.random() * 0.12,
    1.2 + P.speed * 0.18,
  )
  _q.toArray(streak.q, i * 4)
}

function spawnTrail() {
  _up.copy(P.up).normalize()
  _fwd.copy(P.vel)
  _fwd.addScaledVector(_up, -_fwd.dot(_up)) // travel direction flattened onto the surface
  if (_fwd.lengthSq() < 1e-6) return
  _fwd.normalize()
  _right.crossVectors(_up, _fwd).normalize()
  _m.makeBasis(_right, _up, _fwd)
  _q.setFromRotationMatrix(_m)
  const i = alloc(
    trail,
    P.pos.x + _up.x * 0.04, P.pos.y + _up.y * 0.04, P.pos.z + _up.z * 0.04,
    0, 0, 0,
    1.1,
    0.12 + Math.random() * 0.03,
  )
  _q.toArray(trail.q, i * 4)
}

function starBurst(pos, n, up) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(0.4)
    starAt(
      pos.x + Math.cos(a) * 0.15, pos.y + 0.25 + rnd(0.1), pos.z + Math.sin(a) * 0.15,
      Math.cos(a) * (1 + Math.random()), up + Math.random() * 1.2, Math.sin(a) * (1 + Math.random()),
      0.09 + Math.random() * 0.05,
    )
  }
}

/** Copy pool colours into the instanceColor buffer (tiny — n*3 floats). */
function pushColors(mesh, p) {
  mesh.instanceColor.array.set(p.col)
  mesh.instanceColor.needsUpdate = true
}

const fract = (v) => v - Math.floor(v)
// low-discrepancy: irrational strides spread N samples evenly with no prng
// state to carry and no seed order to accidentally couple to another stream
const AMB_K = [0.7548776662, 0.5698402910, 0.8191725134, 0.3819660113]
const ambSeed = (i, k) => fract(0.5 + (i + 1) * AMB_K[k])

/** Wrap v into [-r, r]. The offset field is infinite because it is periodic. */
function wrapTo(v, r) {
  const d = 2 * r
  return (((v + r) % d) + d) % d - r
}

// Shrink to nothing at the box faces and at the ground, or particles pop in
// and out at the wrap seam and clip through the paving.
function ambFade(dx, dy, dz, y) {
  const k = Math.max(Math.abs(dx), Math.abs(dz)) / AMB_R
  const ky = Math.abs(dy) / AMB_RY
  return Math.min(1, (1 - Math.max(k, ky)) / 0.22, y / 0.7)
}

// The field CARRIES with the camera, at a lag. Anchored to the world instead,
// every particle is a fixed lattice point and the chase camera does 13 m/s
// through it — the leaves streamed past sideways and crossed the whole 26m box
// in 2s, which reads as debris in a gale, not as drift. Following the camera
// exactly is the other failure (leaves pinned to your speed, no parallax at
// all), so the centre is damped: it settles to the camera's velocity on a
// straight line and falls behind on every turn, pop and stop, which is where
// the parallax comes from.
const _ambC = new THREE.Vector3()
let ambInit = false

function stepAmbient(moteMesh, T, cam, low, dt) {
  if (PHOTO || !ambInit) {
    _ambC.copy(cam.position) // captures must not depend on how we got here
    ambInit = true
  } else {
    _ambC.lerp(cam.position, 1 - Math.exp(-1.1 * dt))
  }
  const cx = _ambC.x
  const cy = _ambC.y
  const cz = _ambC.z
  const nM = low ? MOTE_N >> 1 : MOTE_N
  for (let i = 0; i < MOTE_N; i++) {
    const a = ambSeed(i, 0)
    const b = ambSeed(i, 1)
    const c = ambSeed(i, 2)
    const ph = a * TAU + i
    // motes RISE — this is sunlit dust hanging in the air, not falling debris
    const ox = wrapTo((a * 2 - 1) * AMB_R + Math.sin(T * 0.06 + ph) * 1.3, AMB_R)
    const oy = wrapTo((b * 2 - 1) * AMB_RY + T * 0.025 + Math.sin(T * 0.14 + ph) * 0.35, AMB_RY)
    const oz = wrapTo((c * 2 - 1) * AMB_R + Math.cos(T * 0.045 + ph * 1.7) * 1.3, AMB_R)
    const y = cy + oy
    const f = i < nM ? ambFade(ox, oy, oz, y) : 0
    if (f <= 0) {
      moteMesh.setMatrixAt(i, ZERO)
      continue
    }
    _o.position.set(cx + ox, y, cz + oz)
    _o.quaternion.copy(cam.quaternion)
    _o.scale.setScalar((0.012 + c * 0.02) * f)
    _o.updateMatrix()
    moteMesh.setMatrixAt(i, _o.matrix)
  }
  moteMesh.instanceMatrix.needsUpdate = true
}

function stepDust(mesh, dt) {
  const drag = Math.exp(-3.4 * dt)
  for (let i = 0; i < DUST_N; i++) {
    const a = dust.life[i] - dt
    if (a <= 0) {
      dust.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    dust.life[i] = a
    dust.vy[i] = (dust.vy[i] + 0.6 * dt) * drag
    dust.vx[i] *= drag
    dust.vz[i] *= drag
    dust.x[i] += dust.vx[i] * dt
    dust.y[i] += dust.vy[i] * dt
    dust.z[i] += dust.vz[i] * dt

    const f = a / dust.max[i]
    // grows from a tight core to full radius, then collapses over the last 40%
    const r = dust.size[i] * (0.2 + 0.8 * (1 - f)) * Math.min(1, f * 2.5)
    const w = dust.rot[i]
    _o.position.set(dust.x[i], dust.y[i], dust.z[i])
    _o.rotation.set(w, w * 1.7, w * 0.6)
    _o.scale.setScalar(r)
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

function stepSparks(mesh, dt) {
  const drag = Math.exp(-4.5 * dt)
  for (let i = 0; i < SPARK_N; i++) {
    const a = spark.life[i] - dt
    if (a <= 0) {
      spark.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    spark.life[i] = a
    spark.vy[i] -= 11 * dt
    spark.vx[i] *= drag
    spark.vy[i] *= drag
    spark.vz[i] *= drag
    spark.x[i] += spark.vx[i] * dt
    spark.y[i] += spark.vy[i] * dt
    spark.z[i] += spark.vz[i] * dt

    const f = a / spark.max[i]
    _v.set(spark.vx[i], spark.vy[i], spark.vz[i])
    const len = _v.length()
    if (len > 1e-3) {
      _v.multiplyScalar(1 / len)
      _o.quaternion.setFromUnitVectors(FWD, _v)
    } else {
      _o.quaternion.identity()
    }
    _o.position.set(spark.x[i], spark.y[i], spark.z[i])
    _o.scale.set(f, f, f * (0.8 + Math.min(1.6, len * 0.15)))
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  pushColors(mesh, spark)
}

function stepTrail(mesh, dt) {
  for (let i = 0; i < TRAIL_N; i++) {
    const a = trail.life[i] - dt
    if (a <= 0) {
      trail.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    trail.life[i] = a
    const f = a / trail.max[i]
    const s = trail.size[i]
    _o.position.set(trail.x[i], trail.y[i], trail.z[i])
    _o.quaternion.fromArray(trail.q, i * 4)
    _o.scale.set(s * f, 1, s * 4.2) // fades by narrowing, keeps its length
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

function stepStars(mesh, dt, camQuat) {
  const drag = Math.exp(-2.2 * dt)
  for (let i = 0; i < STAR_N; i++) {
    const a = star.life[i] - dt
    if (a <= 0) {
      star.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    star.life[i] = a
    star.vy[i] -= 2.5 * dt
    star.vx[i] *= drag
    star.vy[i] *= drag
    star.vz[i] *= drag
    star.x[i] += star.vx[i] * dt
    star.y[i] += star.vy[i] * dt
    star.z[i] += star.vz[i] * dt

    const f = a / star.max[i]
    const age = 1 - f
    // overshoot pop: snaps to 130% in the first 12% of life, settles, shrinks out
    const up = Math.min(1, age / 0.12)
    const s = star.size[i] * up * (1.3 - 0.3 * up) * Math.min(1, f / 0.3)
    // billboard to camera, spinning about the view axis
    _q2.setFromAxisAngle(ZAXIS, star.rot[i] + age * 7)
    _o.quaternion.copy(camQuat).multiply(_q2)
    _o.position.set(star.x[i], star.y[i], star.z[i])
    _o.scale.setScalar(s)
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  pushColors(mesh, star)
}

function stepRings(mesh, dt, source = ring) {
  for (let i = 0; i < source.n; i++) {
    const a = source.life[i] - dt
    if (a <= 0) {
      source.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    source.life[i] = a
    const f = a / source.max[i]
    const age = 1 - f
    // expands fast then pops out over the last 15% (no per-instance alpha)
    const r = source.size[i] * (0.25 + 2.4 * age) * Math.min(1, f / 0.15)
    _o.position.set(source.x[i], source.y[i], source.z[i])
    _o.quaternion.fromArray(source.q, i * 4)
    _o.scale.set(r, 1, r)
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

function stepStreaks(mesh, dt) {
  for (let i = 0; i < STREAK_N; i++) {
    const a = streak.life[i] - dt
    if (a <= 0) {
      streak.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    streak.life[i] = a
    const f = a / streak.max[i]
    _o.position.set(streak.x[i], streak.y[i], streak.z[i])
    _o.quaternion.fromArray(streak.q, i * 4)
    _o.scale.set(f, f, streak.size[i] * (0.6 + 0.4 * f)) // fades by thinning
    _o.updateMatrix()
    mesh.setMatrixAt(i, _o.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

export default function Effects() {
  const dustRef = useRef()
  const sparkRef = useRef()
  const trailRef = useRef()
  const starRef = useRef()
  const ringRef = useRef()
  const smashRingRef = useRef()
  const streakRef = useRef()
  const trashRef = useRef()
  const moteRef = useRef()
  const time = useSceneSettings((s) => s.time)
  const darkTime = time === 'night' || time === 'neon'
  const t = useRef({ dust: 0, spark: 0, trail: 0, streak: 0, grindT: 0, grindStar: 0, airStar: 0, bigAir: false })

  // Must be a layout effect: useFrame subscribes in a layout effect too, so a
  // frame can render (and upload instanceMatrix) before passive effects flush.
  // three only reads `usage` when it first creates the buffer, so setting it
  // late would silently leave these buffers as STATIC_DRAW forever.
  useLayoutEffect(() => {
    for (const m of [dustRef.current, sparkRef.current, trailRef.current, starRef.current, ringRef.current, smashRingRef.current, streakRef.current, trashRef.current, moteRef.current]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }
    // instanceColor is created lazily by setColorAt, but we write the whole
    // buffer ourselves — so create it up front with dynamic usage.
    for (const [m, p] of [[sparkRef.current, spark], [starRef.current, star], [trashRef.current, trash]]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(p.n * 3).fill(1), 3)
      m.instanceColor.setUsage(THREE.DynamicDrawUsage)
    }
  }, [])

  useEffect(() => {
    streakMat.opacity = darkTime ? 0.3 : 0.5
    smashRingMat.opacity = darkTime ? 0.1 : 0.5
  }, [darkTime])

  useEffect(() => {
    const off = [
      on('dust', ({ pos, amount = 6 }) => {
        const n = isLow() ? Math.ceil(amount / 2) : amount
        const bx = -Math.sin(P.heading)
        const bz = -Math.cos(P.heading)
        for (let i = 0; i < n; i++) puff(pos.x, pos.y + 0.05, pos.z, bx * 1.3, 0.45, bz * 1.3, 1)
      }),
      on('jump', ({ pos }) => {
        ringAt(pos.x, pos.y + 0.03, pos.z, 0.5)
      }),
      on('land', ({ pos, impact = 1 }) => {
        const k = Math.min(1.6, 0.6 + impact * 0.5)
        let n = Math.round(5 + Math.min(5, impact * 4))
        if (isLow()) n = Math.ceil(n / 2)
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rnd(0.35)
          const cx = Math.cos(a)
          const cz = Math.sin(a)
          puff(pos.x + cx * 0.12, pos.y + 0.04, pos.z + cz * 0.12, cx * 1.7 * k, 0.4 * k, cz * 1.7 * k, k)
        }
      }),
      on('spark', ({ pos, dir }) => {
        const dx = dir ? dir.x : -Math.sin(P.heading)
        const dz = dir ? dir.z : -Math.cos(P.heading)
        const n = isLow() ? 6 : 12
        for (let i = 0; i < n; i++) sparkAt(pos.x, pos.y, pos.z, dx, dz)
      }),
      on('grind', ({ on: onRail, pos }) => {
        // lock-on burst: fountain + shockwave so the grab reads instantly
        const n = onRail ? (isLow() ? 8 : 16) : (isLow() ? 4 : 8)
        const bx = -Math.sin(P.heading)
        const bz = -Math.cos(P.heading)
        for (let i = 0; i < n; i++) grindSpark(bx, bz, 1)
        if (onRail) ringAt(pos.x, pos.y - 0.04, pos.z, 0.45)
      }),
      on('trick', ({ points = 100 }) => {
        const n = Math.min(8, 3 + Math.round(points / 150))
        starBurst(P.pos, isLow() ? Math.ceil(n / 2) : n, 1.6)
      }),
      on('bone', ({ pos, big }) => goldBurst(pos, big)),
      // Smashing a can is an IMPACT, not a pickup: grit and paint chips thrown
      // along travel, a ground shockwave, and only a couple of stars so it
      // doesn't borrow the gold reward language a bone owns.
      on('smash', ({ pos, dir, speed = 8 }) => {
        const k = Math.min(1.5, 0.6 + speed / 12)
        const dx = dir ? dir.x : -Math.sin(P.heading)
        const dz = dir ? dir.z : -Math.cos(P.heading)
        const l = Math.hypot(dx, dz) || 1
        const n = isLow() ? 7 : 16
        for (let i = 0; i < n; i++) {
          // chips fan forward around the travel direction, not a full sphere
          const a = Math.atan2(dz / l, dx / l) + rnd(1.1)
          sparkAt(pos.x, pos.y + 0.4 + Math.random() * 0.5, pos.z, Math.cos(a) * 0.55 * k, Math.sin(a) * 0.55 * k, 0.8, CAN_COLS)
          if (i % 2 === 0) puff(pos.x + rnd(0.3), pos.y + 0.15, pos.z + rnd(0.3), Math.cos(a) * 1.6, 0.7, Math.sin(a) * 1.6, 1.15)
        }
        for (let i = 0; i < (isLow() ? 2 : 4); i++) {
          const a = (i / 4) * TAU
          starAt(pos.x + Math.cos(a) * 0.25, pos.y + 0.7, pos.z + Math.sin(a) * 0.25,
            Math.cos(a) * 1.4, 1.6 + Math.random(), Math.sin(a) * 1.4, 0.09, CAN_COLS)
        }
        for (let i = 0; i < (isLow() ? 5 : 10); i++) trashAt(pos.x, pos.y, pos.z, dx / l, dz / l, 1.6 * k)
        smashRingAt(pos.x, pos.y + 0.03, pos.z, 0.65 * k)
      }),
      // a completed challenge reads like the last bone: same gold, biggest ring
      on('goal', ({ pos }) => goldBurst(pos, true)),
      on('bigair', ({ pos }) => {
        // rainbow halo burst, then the frame loop streams sparkles until landing
        t.current.bigAir = true
        const n = isLow() ? 7 : 14
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rnd(0.3)
          const cx = Math.cos(a)
          const cz = Math.sin(a)
          starAt(pos.x + cx * 0.3, pos.y + 0.3 + rnd(0.2), pos.z + cz * 0.3,
            cx * (1.4 + Math.random()), 0.8 + Math.random() * 1.4, cz * (1.4 + Math.random()),
            0.08 + Math.random() * 0.05, RAINBOW)
        }
      }),
      on('bail', ({ pos }) => {
        // classic dizzy-stars halo over the crash
        const n = isLow() ? 3 : 5
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU
          starAt(pos.x + Math.cos(a) * 0.3, pos.y + 0.9, pos.z + Math.sin(a) * 0.3,
            Math.cos(a) * 0.6, 1.4 + Math.random() * 0.6, Math.sin(a) * 0.6,
            0.1 + Math.random() * 0.04)
        }
      }),
    ]
    return () => off.forEach((f) => f())
  }, [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const low = isLow()
    const slow = low ? 2 : 1
    const bx = -Math.sin(P.heading)
    const bz = -Math.cos(P.heading)

    // rolling dust while driving
    if (P.state === 'ground' && P.speed > 3 && P.throttle > 0.3) {
      const iv = 0.07 * slow
      t.current.dust += dt
      while (t.current.dust >= iv) {
        t.current.dust -= iv
        const s = P.inBowl ? 0.7 : 1
        puff(P.pos.x + bx * 0.38, P.pos.y + 0.06, P.pos.z + bz * 0.38, bx * 1.1 * s, 0.3, bz * 1.1 * s, s)
      }
    } else {
      t.current.dust = 0
    }

    // rail contact sparks — the fountain escalates the longer the grind holds
    // (it used to be matched by escalating yips; the dog voice is gone)
    if (P.state === 'grind') {
      t.current.grindT += dt
      const heat = Math.min(1, t.current.grindT / 1.6)
      const iv = (0.05 - 0.028 * heat) * slow
      t.current.spark += dt
      while (t.current.spark >= iv) {
        t.current.spark -= iv
        const n = 2 + (Math.random() < 0.5 ? 1 : 0)
        for (let k = 0; k < n; k++) grindSpark(bx, bz, heat)
      }
      // rainbow sparkle glitter: tiny stars streaming off the contact point,
      // denser as the grind heats up
      t.current.grindStar += dt
      const siv = (0.14 - 0.07 * heat) * slow
      if (t.current.grindStar > siv) {
        t.current.grindStar = 0
        // same occlusion problem as the sparks: spawn beside the dog, not in it
        const side = Math.random() < 0.5 ? 1 : -1
        const rx = -bz * side
        const rz = bx * side
        starAt(
          P.pos.x + rx * 0.22, P.pos.y + 0.1 + rnd(0.1), P.pos.z + rz * 0.22,
          rx * (1 + Math.random()), 1.2 + Math.random() * 1.5, rz * (1 + Math.random()),
          0.05 + Math.random() * 0.03, RAINBOW,
        )
      }
    } else {
      t.current.spark = 0
      t.current.grindT = 0
      t.current.grindStar = 0
    }

    // big-air rainbow sparkle trail: streams off the dog from the 'bigair'
    // moment until the wheels touch back down
    if (t.current.bigAir && P.state === 'air') {
      t.current.airStar += dt
      const siv = (isLow() ? 0.12 : 0.06)
      while (t.current.airStar >= siv) {
        t.current.airStar -= siv
        starAt(
          P.pos.x + rnd(0.35), P.pos.y + 0.2 + rnd(0.25), P.pos.z + rnd(0.35),
          rnd(0.8), -0.4 + rnd(0.5), rnd(0.8),
          0.05 + Math.random() * 0.04, RAINBOW,
        )
      }
    } else {
      t.current.bigAir = false
      t.current.airStar = 0
    }

    // anime speed streaks at a hard push only (~85% of MAX_SPEED / bowl cook).
    // Kept on low quality at a slower rate — gating on !low meant any
    // PerformanceMonitor dip erased them for the rest of the run.
    if (P.speed > 11 && P.state !== 'bail') {
      const iv = (0.05 * slow) / Math.min(2, P.speed / 11)
      t.current.streak += dt
      while (t.current.streak >= iv) {
        t.current.streak -= iv
        streakAt(state.camera)
      }
    } else {
      t.current.streak = 0
    }

    // carve marks in the bowl — emission is high-quality only, but the pool
    // keeps ticking so anything already alive still fades out.
    // P.inBowl is only refreshed while grounded (it goes stale through the whole
    // air phase), so the ground test is what keeps marks off mid-air launches.
    if (!low && P.state === 'ground' && P.inBowl && P.speed > 5) {
      t.current.trail += dt
      if (t.current.trail >= 0.05) {
        t.current.trail = 0
        spawnTrail()
      }
    } else {
      t.current.trail = 0
    }

    stepDust(dustRef.current, dt)
    stepSparks(sparkRef.current, dt)
    stepTrail(trailRef.current, dt)
    stepStars(starRef.current, dt, state.camera.quaternion)
    stepRings(ringRef.current, dt)
    stepRings(smashRingRef.current, dt, smashRing)
    stepStreaks(streakRef.current, dt)
    stepTrash(trashRef.current, dt)
    stepAmbient(moteRef.current, PHOTO ? PHOTO_TIME : state.clock.elapsedTime, state.camera, low, dt)
  })

  return (
    <>
      {/* ambient air, always on — wraps around the camera, so no culling */}
      <instancedMesh ref={moteRef} args={[moteGeo, moteMat, MOTE_N]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={trailRef} args={[trailGeo, trailMat, TRAIL_N]} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={dustRef} args={[dustGeo, dustMat, DUST_N]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={ringRef} args={[ringGeo, ringMat, RING_N]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={smashRingRef} args={[ringGeo, smashRingMat, SMASH_RING_N]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={streakRef} args={[streakGeo, streakMat, STREAK_N]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={sparkRef} args={[sparkGeo, sparkMat, SPARK_N]} frustumCulled={false} renderOrder={4} />
      <instancedMesh ref={starRef} args={[starGeo, starMat, STAR_N]} frustumCulled={false} renderOrder={5} />
      {/* litter casts — it is lit park furniture for a second, not a sparkle */}
      <instancedMesh ref={trashRef} args={[trashGeo, trashMat, TRASH_N]} frustumCulled={false} castShadow />
    </>
  )
}
