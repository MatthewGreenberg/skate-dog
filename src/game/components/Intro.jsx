import { useRef } from 'react'
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
const HEIGHT = 3.9 // above the dog; solved with CameraController's INTRO_* framing
const LIFT = 3.2 // metres the title climbs out of frame over the reveal

export default function Intro() {
  const ref = useRef(null)

  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const k = P.intro * P.intro * (3 - 2 * P.intro) // same smoothstep as the camera
    g.visible = k > 0.002
    if (!g.visible) return

    // billboard: the intro camera drifts, and a fixed-yaw title would slide off
    // its own face. Copying the camera's quaternion is the whole of it.
    g.quaternion.copy(state.camera.quaternion)
    const t = state.clock.elapsedTime
    g.rotateZ(Math.sin(t * 0.7) * 0.022) // lazy hang, applied after the billboard

    // The framing is solved on HEIGHT (half a frame is 3.3m tall at the intro
    // radius, title 2.1m + dog), so only width can run out: a portrait phone
    // sees 1.5m of half-width against the title's 1.8m. Scaling by the aspect
    // below 1 is exactly that ratio — no second authored pose.
    const fit = Math.min(1, state.viewport.aspect)
    // scale-to-zero exit (same fade the particle pools use — no per-instance
    // alpha anywhere in this codebase) plus a climb, so it leaves upward as the
    // camera drops into the chase.
    g.scale.setScalar(k * fit)
    g.position.set(
      P.pos.x,
      P.pos.y + HEIGHT + Math.sin(t * 1.1) * 0.09 + (1 - k) * LIFT,
      P.pos.z,
    )
  })

  if (PHOTO) return null
  return (
    <group ref={ref}>
      <Text
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
      </Text>
    </group>
  )
}
