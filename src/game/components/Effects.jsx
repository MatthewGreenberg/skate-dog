import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { P, useGame, on } from '../store.js'

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
const STREAK_N = 40
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

const streakGeo = new THREE.BoxGeometry(0.03, 0.03, 1)
const streakMat = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  toneMapped: false,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
})

// confetti palettes, pre-converted so spawn writes are raw float copies
const asRGB = (hexes) => hexes.map((h) => new THREE.Color(h).convertSRGBToLinear())
const SPARK_COLS = asRGB(['#ffe14d', '#ff9d2e', '#ff5da2', '#4dd8ff', '#ffffff'])
const STAR_COLS = asRGB(['#ffd94d', '#ffb347', '#ff6fb5', '#7de8ff'])
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
const streak = pool(STREAK_N, true)

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

function streakAt() {
  _fwd.copy(P.vel)
  if (_fwd.lengthSq() < 1e-6) return
  _fwd.normalize()
  _q.setFromUnitVectors(FWD, _fwd)
  // scatter in a loose tube around the player so lines whip past the camera
  const a = Math.random() * TAU
  const r = 0.45 + Math.random() * 0.7
  const i = alloc(
    streak,
    P.pos.x + Math.cos(a) * r - _fwd.x * 0.5,
    P.pos.y + 0.3 + Math.random() * 0.9,
    P.pos.z + Math.sin(a) * r - _fwd.z * 0.5,
    0, 0, 0,
    0.22 + Math.random() * 0.1,
    0.8 + P.speed * 0.14, // length stretches with speed
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

function stepRings(mesh, dt) {
  for (let i = 0; i < RING_N; i++) {
    const a = ring.life[i] - dt
    if (a <= 0) {
      ring.life[i] = 0
      mesh.setMatrixAt(i, ZERO)
      continue
    }
    ring.life[i] = a
    const f = a / ring.max[i]
    const age = 1 - f
    // expands fast then pops out over the last 15% (no per-instance alpha)
    const r = ring.size[i] * (0.25 + 2.4 * age) * Math.min(1, f / 0.15)
    _o.position.set(ring.x[i], ring.y[i], ring.z[i])
    _o.quaternion.fromArray(ring.q, i * 4)
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
  const streakRef = useRef()
  const t = useRef({ dust: 0, spark: 0, trail: 0, streak: 0, grindT: 0, grindStar: 0 })

  // Must be a layout effect: useFrame subscribes in a layout effect too, so a
  // frame can render (and upload instanceMatrix) before passive effects flush.
  // three only reads `usage` when it first creates the buffer, so setting it
  // late would silently leave these buffers as STATIC_DRAW forever.
  useLayoutEffect(() => {
    for (const m of [dustRef.current, sparkRef.current, trailRef.current, starRef.current, ringRef.current, streakRef.current]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }
    // instanceColor is created lazily by setColorAt, but we write the whole
    // buffer ourselves — so create it up front with dynamic usage.
    for (const [m, p] of [[sparkRef.current, spark], [starRef.current, star]]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(p.n * 3).fill(1), 3)
      m.instanceColor.setUsage(THREE.DynamicDrawUsage)
    }
  }, [])

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

    // rail contact sparks — the fountain escalates the longer the grind holds,
    // matching the audio's escalating yips
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

    // anime speed streaks once the player is really moving (ground, air, grind)
    if (!low && P.speed > 7 && P.state !== 'bail') {
      const iv = 0.05 / Math.min(2, P.speed / 8)
      t.current.streak += dt
      while (t.current.streak >= iv) {
        t.current.streak -= iv
        streakAt()
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
    stepStreaks(streakRef.current, dt)
  })

  return (
    <>
      <instancedMesh ref={trailRef} args={[trailGeo, trailMat, TRAIL_N]} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={dustRef} args={[dustGeo, dustMat, DUST_N]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={ringRef} args={[ringGeo, ringMat, RING_N]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={streakRef} args={[streakGeo, streakMat, STREAK_N]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={sparkRef} args={[sparkGeo, sparkMat, SPARK_N]} frustumCulled={false} renderOrder={4} />
      <instancedMesh ref={starRef} args={[starGeo, starMat, STAR_N]} frustumCulled={false} renderOrder={5} />
    </>
  )
}
