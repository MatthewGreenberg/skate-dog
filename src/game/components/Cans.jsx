import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { P, useGame, emit, activeGoalIds } from '../store.js'
import { PHOTO } from '../photo.js'
import { CANS } from '../level/levelData.js'
import { groundHeightAt } from '../level/colliders.js'
import { complete } from '../goals.js'
import { characterSize } from './dogFit.js'

// Smashable trash cans — five in the shipped park, many in challenge levels.
//
// ponytail: a can is still NOT a collider, and the wreck is NOT physics. You
// ride straight through; the body and lid then fly on a hand-integrated
// ballistic arc that never asks the ground a question after the first frame.
// Skatepark bakes every world matrix once and turns off matrixWorldAutoUpdate,
// so a can that queries the level while moving is a whole second class of
// object in a park that has exactly zero of them. Upgrade path if it ever
// matters: one kinematic body with a ground snap, not a physics engine.

const H = 0.82 // body height — under the dog's body centre, so you hit it rolling
const RAD = 0.36
const BURST = 1.15 // seconds of wreck animation (was 0.55 — a shrink, not a launch)
const G = 9.5

// Reference: a galvanised perforated municipal bin — teal-grey powder coat, a
// solid flared collar with a rolled lip, a punched dot field over the barrel, a
// stepped foot ring, and a white litter badge on the front.
//
// The dot field is an alphaMap, not geometry: 600-odd holes per can x5 cans is
// a CSG bill nobody is paying for a prop you ride through. alphaTest (not
// transparent) so the holes are real to the shadow map and there is no sort
// order to get wrong. The BackSide liner behind it is what you see THROUGH the
// holes — it was already there to make the mouth read as a hole.
function perfMap() {
  const N = 256, K = 12, p = N / K, r = p * 0.3
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, N, N)
  g.fillStyle = '#000'
  for (let y = 0; y < K; y++) {
    for (let x = 0; x < K; x++) {
      const cx = (x + (y % 2 ? 0.5 : 0)) * p + p / 2
      // redraw wrapped in x: the staggered rows push half the odd row's dots
      // past the tile edge, and a clipped dot is a visible seam up the can
      for (const ox of [-N, 0, N]) {
        g.beginPath()
        g.arc(cx + ox, y * p + p / 2, r, 0, 7)
        g.fill()
      }
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  // 4 tiles round a 2.26m circumference = 4.7cm pitch, matching the reference;
  // 1.5 in v keeps the dots round instead of stretching them into ovals
  t.repeat.set(4, 1.5)
  return t
}

// The litter pictogram, drawn rather than imported — the park ships no image
// files and this is a 40px disc at play distance.
function badgeMap() {
  const N = 128
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  g.strokeStyle = g.fillStyle = '#eef4f2'
  g.lineWidth = 7
  g.beginPath(); g.arc(64, 64, 56, 0, 7); g.stroke()
  g.beginPath(); g.arc(78, 40, 11, 0, 7); g.fill() // head
  g.beginPath(); g.moveTo(70, 54); g.lineTo(88, 54); g.lineTo(84, 100); g.lineTo(72, 100); g.fill() // body
  g.lineWidth = 6
  g.beginPath(); g.moveTo(72, 60); g.lineTo(54, 52); g.stroke() // arm
  g.beginPath(); g.moveTo(30, 62); g.lineTo(52, 62); g.lineTo(48, 100); g.lineTo(34, 100); g.fill() // bin
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(44 + i * 4, 46 - i * 6, 3, 0, 7); g.fill() } // litter
  return new THREE.CanvasTexture(c)
}

const bodyMat = new THREE.MeshStandardMaterial({
  color: '#5c7d78', roughness: 0.42, metalness: 0.42,
  alphaMap: perfMap(), alphaTest: 0.5, side: THREE.DoubleSide,
})
// the collar and foot are the same coat, unpunched — one material, no alphaMap
const shellMat = new THREE.MeshStandardMaterial({ color: '#5c7d78', roughness: 0.42, metalness: 0.42 })
const rimMat = new THREE.MeshStandardMaterial({ color: '#a3b8b4', roughness: 0.26, metalness: 0.62 })
const badgeMat = new THREE.MeshBasicMaterial({
  map: badgeMap(), transparent: true, toneMapped: false, side: THREE.DoubleSide,
})
const linerMat = new THREE.MeshStandardMaterial({ color: '#1b2827', roughness: 0.95, side: THREE.BackSide })
const lidMat = new THREE.MeshStandardMaterial({ color: '#7f9a96', roughness: 0.3, metalness: 0.5 })

// Smooth now, not the old 12-sided flatShaded drum: the reference barrel is a
// rolled sheet, and faceting a surface whose whole read is a regular dot field
// fights it — the facet edges beat against the hole grid.
const SEG = 20
const FOOT_H = 0.11 // stepped foot ring: spans 0..FOOT_H, the only geometry on the floor
const FOOT_IN = 0.025 // how far the drum's bottom cap hides up inside it
const COLLAR_H = 0.17 // solid band under the lip, where the punching stops
const LID_Y = H + 0.06 + FOOT_IN

// half-diagonal of the drum: the lowest a tumbling can's corner can reach
// below its own centre
const HALF = Math.hypot(H / 2, RAD * 1.12)

const _ax = new THREE.Vector3()
const _pos = new THREE.Vector3()

export default function Cans() {
  const refs = useRef([])
  const lids = useRef([])
  const st = useRef(CANS.map(() => ({ hit: false, t: 0, vx: 0, vz: 0, sx: 0, sz: 0 })))
  const n = useRef(0)
  // ground sampled once at mount — nothing under a can ever moves
  const ys = useMemo(() => CANS.map((c) => groundHeightAt(c.x, c.z)), [])
  // a yaw per can so five identical drums don't line their facets up
  const spin = useMemo(() => CANS.map((_, i) => (i * 2.399) % Math.PI), [])
  // Character sizing is authored per level and cannot change during a run.
  // Let a giant dog behave like a giant wrecking ball too: Dog Bowling's
  // tightly packed bundles should burst together, not require pixel-perfect
  // passes through nine overlapping visual bodies.
  const dogHitRadius = 0.85 * Math.max(0.5, characterSize().dog)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    if (PHOTO || !useGame.getState().started) return
    for (let i = 0; i < CANS.length; i++) {
      const g = refs.current[i]
      if (!g) continue
      const s = st.current[i]
      const c = CANS[i]
      const size = Math.max(0.25, c.scale ?? 1)
      const lid = lids.current[i]
      if (!s.hit) {
        // Horizontal test only, gated on the feet being near the can's band —
        // a full sphere would let a big air over the top count as a smash.
        const dy = P.pos.y - ys[i]
        if (dy > -0.4 && dy < H * size + 0.5) {
          const dx = P.pos.x - c.x
          const dz = P.pos.z - c.z
          const hit2 = (RAD * size + dogHitRadius) * (RAD * size + dogHitRadius)
          if (dx * dx + dz * dz < hit2) {
            s.hit = true
            s.t = 0
            // Launch along TRAVEL, not along the hit normal: the dog is a
            // 13 m/s wrecking ball and the can has to look like it was hit by
            // one. Speed-scaled so a slow nudge tips it and a bomb-drop
            // punts it across the plaza.
            const sp = Math.max(2.5, P.speed)
            const l = Math.hypot(P.vel.x, P.vel.z) || 1
            s.vx = (P.vel.x / l) * sp * 0.75
            s.vz = (P.vel.z / l) * sp * 0.75
            s.sx = -P.vel.z / l // tumble axis: perpendicular to travel
            s.sz = P.vel.x / l
            n.current++
            useGame.getState().smashCan()
            // particles go at the can's FOOT — g.position is the tumble pivot,
            // half a can up, and a burst there floats off the top of the drum
            _pos.set(c.x, ys[i], c.z)
            emit('smash', { pos: _pos, dir: { x: s.vx, z: s.vz }, speed: sp })
            emit('dust', { pos: _pos, amount: 5 })
            useGame.getState().addScore(150)
            // the goal pays its own points and popup — don't write over it
            if (n.current === CANS.length) {
              complete('cans')
              // A cans-only level has no reason to run down the remaining
              // clock after its sole objective lands. Finish on the impact so
              // the destruction burst cuts straight to the victory card.
              const ids = activeGoalIds()
              if (ids?.length === 1 && ids[0] === 'cans') useGame.getState().endRun()
            } else useGame.getState().showTrick(`Trash! ${n.current}/${CANS.length}`, 150)
          }
        }
      } else if (s.t < BURST) {
        s.t += dt
        const k = s.t / BURST
        // squash on the frame of impact, spring back, then just fly and tumble
        const sq = Math.max(0, 1 - s.t / 0.18)
        g.scale.set(size * (1 + 0.55 * sq), size * (1 - 0.45 * sq), size * (1 + 0.55 * sq))
        g.position.x += s.vx * dt
        g.position.z += s.vz * dt
        // The pivot is the can's CENTRE (see the -H/2 inner group), so the
        // floor for it is the tumbled body's half-DIAGONAL, not H/2 — clamped
        // at H/2 the drum's corner swept a third of every roll through the
        // paving. Eased in over the pop so it doesn't jump on the hit frame.
        const floor = size * (H / 2 + (HALF - H / 2) * Math.min(1, s.t / 0.12))
        g.position.y = ys[i] + Math.max(floor, size * H / 2 + 2.4 * s.t - G * 0.5 * s.t * s.t)
        // tumble about the axis across travel — a can knocked forward rolls
        // end over end, it does not spin about its own y
        g.rotateOnWorldAxis(_ax.set(s.sx, 0, s.sz), 7 * dt)
        s.vx *= 0.985
        s.vz *= 0.985
        if (lid) { // lid pops higher, spins faster, and gets there first
          lid.position.y = LID_Y + Math.max(0, 5.2 * s.t - G * 0.5 * s.t * s.t)
          lid.rotation.x = s.t * 11
          lid.rotation.z = s.t * 6
        }
        if (k > 0.75) { // shrink out over the last quarter rather than blinking
          const f = 1 - (k - 0.75) / 0.25
          g.scale.multiplyScalar(f)
        }
      } else if (g.visible) {
        g.visible = false
      }
    }
  })

  return CANS.map((c, i) => (
    // Outer group sits at the can's CENTRE and is what tumbles; the inner one
    // pushes the parts back down so a resting can still stands on the ground.
    // Rotating the base group end-over-end swung the drum under the paving.
    <group
      key={c.id}
      ref={(el) => (refs.current[i] = el)}
      position={[c.x, ys[i] + H * Math.max(0.25, c.scale ?? 1) / 2, c.z]}
      rotation-y={spin[i]}
      scale={Math.max(0.25, c.scale ?? 1)}
    >
      {/* LIFT: the drum's bottom cap and the foot ring both sat exactly ON the
          paving plane, and two coplanar surfaces z-fight — it read as crawling
          aliasing round the base. 8mm is under the contact shadow, so the can
          still looks planted. */}
      <group position-y={-H / 2 + 0.008}>
      {/* FOOT_IN: the drum's bottom cap is RECESSED into the foot ring rather
          than sharing its plane. Two coplanar discs z-fight into a pinwheel —
          invisible while the can stands up, and the first thing you see when
          it rolls over. Recessed, the foot's own cap is the only face down
          there and nothing competes. */}
      <mesh position-y={H / 2 + FOOT_IN} castShadow receiveShadow>
        {/* punched barrel: near-straight, as the reference is a rolled sheet
            and not a bucket. Its bottom cap still closes the drum. */}
        <cylinderGeometry args={[RAD, RAD * 0.96, H, SEG, 1]} />
        <primitive object={bodyMat} attach="material" />
      </mesh>
      {/* liner: backside-only inner wall, so the mouth AND every punched hole
          read as a hole rather than showing the far wall of the drum */}
      <mesh position-y={H / 2 + FOOT_IN}>
        <cylinderGeometry args={[RAD * 0.93, RAD * 0.9, H * 0.96, SEG, 1, true]} />
        <primitive object={linerMat} attach="material" />
      </mesh>
      {/* solid collar: the reference stops punching well below the lip, and
          that unbroken band is most of what says "made of sheet metal" */}
      <mesh position-y={H - COLLAR_H / 2 + FOOT_IN} castShadow receiveShadow>
        <cylinderGeometry args={[RAD * 1.04, RAD * 1.01, COLLAR_H, SEG, 1, true]} />
        <primitive object={shellMat} attach="material" />
      </mesh>
      <mesh position-y={H - 0.01 + FOOT_IN} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[RAD * 1.04, 0.05, 6, SEG]} />
        <primitive object={rimMat} attach="material" />
      </mesh>
      {/* stepped foot: the wider ring is what sits on the paving, the narrower
          one is the reveal above it */}
      <mesh position-y={FOOT_H / 2} castShadow>
        <cylinderGeometry args={[RAD * 1.0, RAD * 1.03, FOOT_H, SEG, 1]} />
        <primitive object={shellMat} attach="material" />
      </mesh>
      <mesh position-y={FOOT_H + 0.02} rotation-x={Math.PI / 2}>
        <torusGeometry args={[RAD * 0.99, 0.022, 6, SEG]} />
        <primitive object={rimMat} attach="material" />
      </mesh>
      {/* badge: a flat disc standing 1cm proud of the barrel, same as the real
          thing — riveted on OVER the punching, so it needs no hole in the map */}
      <mesh position={[0, H * 0.52 + FOOT_IN, RAD + 0.016]}>
        {/* 0.1 radius on a 0.36 barrel sags 14mm across the chord, so the disc
            stands off 16mm — any less and its edges sink into the drum */}
        <circleGeometry args={[0.1, 20]} />
        <primitive object={badgeMat} attach="material" />
      </mesh>
      <mesh ref={(el) => (lids.current[i] = el)} position-y={LID_Y} castShadow>
        <cylinderGeometry args={[RAD * 1.12, RAD * 1.02, 0.1, SEG, 1]} />
        <primitive object={lidMat} attach="material" />
        {/* handle rides the lid, not the group — it has to leave with it */}
        <mesh position-y={0.08}>
          <sphereGeometry args={[0.055, 8, 6]} />
          <primitive object={rimMat} attach="material" />
        </mesh>
      </mesh>
      </group>
    </group>
  ))
}
