import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { P } from '../store.js'
import { PHOTO } from '../photo.js'

// The title is real geometry in the park, not a DOM heading: troika lays the
// glyphs out into an SDF atlas, so it sits in the scene's light, holds its
// outline at any distance, and can be flown out of frame on the same reveal
// clock as the camera (P.intro, 1 -> 0).
//
// The font is served locally on purpose. troika's default fontURL is a gstatic
// CDN and NOTHING here fetches over the network — same rule as the draco and
// basis decoders in public/.
const FONT = '/fonts/LuckiestGuy-Regular.ttf'
const LIFT = 0.75 // a small rise under the fragment gust; the old exit flew 3.2m away
// Title placement is in CAMERA space, as fractions of the frame, off the frame's
// own CENTRE — not off the dog. Anchoring it to the dog coupled the two: the
// moment CameraController offset its aim to slide the dog out from under the
// PLAY button, the title slid the same distance and left the frame. It sits
// DEAD CENTRE now, which is why the dog is pushed middle-left (INTRO_SIDE) and
// the challenges card top-right: the title is the thing that gets the middle,
// and both of the others were moved out of it rather than the other way round.
// MAX_W 0.42 keeps it clear of that card, which spans the outer ~0.22 of width.
const UP = 0.06 // fraction of the frame HEIGHT above dead centre — optical, not
// geometric: the PLAY button and the key legend weight the bottom of the frame,
// so a title on the true midline reads as sitting low.
const TITLE_W = 3.7 // measured width of the SKATE line at fontSize 1.15
const MAX_W = 0.42 // fraction of the frame the title may span before it scales down

const anchor = new THREE.Vector3()
const fwd = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3()
const shardDummy = new THREE.Object3D()
const shardColor = new THREE.Color()

// One instanced draw call turns the title into a loose cloud of paper/paint
// flecks. The source points fill the two line boxes rather than attempting to
// trace the SDF on the CPU; they are hidden until the solid glyphs start to
// vanish, so the eye reads them as pieces coming off the letter faces.
const SHARD_COLORS = ['#fff6ea', '#fff6ea', '#ffe7b5', '#a97cdb', '#6a3fb0']
const SHARDS = (() => {
  let seed = 0x5ca7ed09
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  return Array.from({ length: 84 }, (_, i) => {
    const top = i < 54
    const width = top ? 3.7 : 2.35
    const x = (random() - 0.5) * width
    return {
      x,
      y: (top ? 0.5 : -0.55) + (random() - 0.5) * 0.74,
      z: (random() - 0.5) * 0.035,
      delay: 0.06 + random() * 0.25 + (x / width + 0.5) * 0.09,
      duration: 0.42 + random() * 0.2,
      vx: 0.75 + random() * 1.3 + x * 0.18,
      vy: 0.45 + random() * 1.55,
      vz: (random() - 0.5) * 0.8,
      spin: (random() - 0.5) * 13,
      size: 0.035 + random() * 0.075,
      color: SHARD_COLORS[Math.floor(random() * SHARD_COLORS.length)],
    }
  })
})()

const clamp01 = (n) => Math.max(0, Math.min(1, n))
const smooth = (n) => n * n * (3 - 2 * n)

export default function Intro() {
  const ref = useRef(null)
  const textRef = useRef(null)
  const shardsRef = useRef(null)

  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const k = smooth(P.intro) // same smoothstep as the camera
    const exit = 1 - P.intro
    g.visible = k > 0.002
    if (!g.visible) return

    const cam = state.camera
    // billboard: the intro camera drifts, and a fixed-yaw title would slide off
    // its own face. Copying the camera's quaternion is the whole of it.
    g.quaternion.copy(cam.quaternion)
    const t = state.clock.elapsedTime
    g.rotateZ(Math.sin(t * 0.7) * 0.022) // lazy hang, applied after the billboard

    // Frame centre at the dog's depth: walk out along the camera's own forward
    // by the distance to the dog, so the title keeps the dog's scale without
    // inheriting the dog's screen position.
    right.set(1, 0, 0).applyQuaternion(cam.quaternion)
    up.set(0, 1, 0).applyQuaternion(cam.quaternion)
    fwd.crossVectors(right, up).negate() // camera looks down its own -Z
    anchor.copy(cam.position).addScaledVector(fwd, cam.position.distanceTo(P.pos))
    // World size of the frame at that depth — one call replaces the old aspect
    // fudge and holds on a portrait phone, where the frame is narrow in metres
    // and the title has to come down with it.
    const vp = state.viewport.getCurrentViewport(cam, anchor)
    const fit = Math.min(1, (vp.width * MAX_W) / TITLE_W)
    // Keep the fragment field at the title's real size. The solid letters do a
    // tiny squash-and-release of their own while the flecks carry the exit.
    g.scale.setScalar(fit)

    g.position
      .copy(anchor)
      .addScaledVector(up, vp.height * UP + Math.sin(t * 1.1) * 0.09 + smooth(exit) * LIFT)

    const title = textRef.current
    if (title) {
      const dissolve = smooth(clamp01((exit - 0.04) / 0.52))
      const opacity = 1 - dissolve
      title.fillOpacity = opacity
      title.outlineOpacity = opacity * 0.95
      title.position.set(dissolve * 0.28, dissolve * 0.22, 0)
      title.rotation.z = -dissolve * 0.055
      // A quick 4% pop makes the breakup feel kicked by the PLAY press, then
      // the type contracts into the cloud instead of uniformly shrinking away.
      const pop = Math.sin(Math.min(1, exit / 0.18) * Math.PI) * 0.04
      title.scale.setScalar(1 + pop - dissolve * 0.3)
    }

    const shards = shardsRef.current
    if (shards) {
      if (!shards.userData.colorsReady) {
        SHARDS.forEach((p, i) => shards.setColorAt(i, shardColor.set(p.color)))
        shards.instanceColor.needsUpdate = true
        shards.userData.colorsReady = true
      }
      SHARDS.forEach((p, i) => {
        const life = clamp01((exit - p.delay) / p.duration)
        const travel = smooth(life)
        // Scale is the alpha: instances are born at zero, flash into view, and
        // taper to nothing without paying for 84 individually transparent meshes.
        const visible = Math.sin(life * Math.PI) * (1 - life * 0.35)
        shardDummy.position.set(
          p.x + p.vx * travel,
          p.y + p.vy * travel + Math.sin(life * Math.PI) * 0.18,
          p.z + p.vz * travel,
        )
        shardDummy.rotation.set(life * p.spin * 0.35, life * p.spin * 0.22, life * p.spin)
        shardDummy.scale.set(p.size * 1.7 * visible, p.size * 0.8 * visible, p.size * visible)
        shardDummy.updateMatrix()
        shards.setMatrixAt(i, shardDummy.matrix)
      })
      shards.instanceMatrix.needsUpdate = true
    }
  })

  if (PHOTO) return null
  return (
    <group ref={ref}>
      <Text
        ref={textRef}
        renderOrder={100}
        font={FONT}
        fontSize={1.15}
        lineHeight={0.92}
        letterSpacing={0.02}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        color="#fff6ea"
        outlineWidth={0.075}
        outlineColor="#6a3fb0"
        outlineOpacity={0.95}
      >
        {'SKATE\nDOG'}
        {/* The title is graphic UI staged in the world, so floor decals must
            never punch through it as the intro camera moves. */}
        <meshBasicMaterial transparent depthTest={false} depthWrite={false} />
      </Text>
      <instancedMesh
        ref={shardsRef}
        args={[null, null, SHARDS.length]}
        frustumCulled={false}
        renderOrder={101}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.92}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
