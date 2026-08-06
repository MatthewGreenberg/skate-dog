import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { P, useGame, emit } from '../store.js'
import { PHOTO, PHOTO_TIME } from '../photo.js'
import { LETTERS } from '../level/levelData.js'
import { R2, POP } from './Bones.jsx'
import { complete } from '../goals.js'

// D-O-G — the S-K-A-T-E letters. Same collect sphere, bob and pop as the bones
// (constants imported, not retyped: a letter that collected at a different
// radius than a bone would be a bug nobody could see).
//
// The glyphs are troika text, so this costs no new asset — the font is already
// served locally for the intro title, and troika lays it into an SDF atlas that
// holds its outline from the far side of the park. See Intro.jsx for why the
// URL is local.
const FONT = '/fonts/LuckiestGuy-Regular.ttf'

export default function Letters({ preview = false }) {
  const refs = useRef([])
  const st = useRef(LETTERS.map(() => ({ got: false, t: 0 })))
  const n = useRef(0)

  useFrame((state, delta) => {
    const time = PHOTO ? PHOTO_TIME : state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    const started = useGame.getState().started
    for (let i = 0; i < LETTERS.length; i++) {
      const g = refs.current[i]
      if (!g) continue
      const s = st.current[i]
      const b = LETTERS[i]
      if (!s.got) {
        // Hidden until the run starts on the title screen, but always visible
        // in the level editor: an authored collectible must remain visible
        // after its placement ghost becomes a real row. Toggled rather than
        // unmounted — troika builds its SDF geometry asynchronously on mount,
        // and deferring that work to PLAY would hitch the first run frame.
        g.visible = preview || started
        g.position.y = b.y + Math.sin(time * 1.5 + i * 2.3) * 0.13
        // Billboarded, not spun. A troika glyph is a flat single-sided quad, so
        // a bone's world-Y spin would show you the letter backwards half the
        // time — and the entire point of the objective is reading which one you
        // still need from across the park. Same trick as the intro title.
        g.quaternion.copy(state.camera.quaternion)
        g.rotateZ(Math.sin(time * 0.9 + i) * 0.09) // lazy hang, after the billboard
        if (started && !PHOTO) {
          const dx = P.pos.x - b.x
          const dy = P.pos.y + 0.45 - g.position.y
          const dz = P.pos.z - b.z
          if (dx * dx + dy * dy + dz * dz < R2) {
            s.got = true
            s.t = 0
            n.current++
            const all = n.current === LETTERS.length
            const game = useGame.getState()
            game.addScore(300)
            emit('bone', { pos: g.position, big: false })
            // the goal pays its own points, popup and burst — don't double up
            if (all) complete('spell')
            else game.showTrick(`${b.ch}!`, 300)
          }
        }
      } else if (s.t < POP) {
        s.t += dt
        const k = s.t / POP
        g.position.y += (3.2 - 2.8 * k) * dt
        g.quaternion.copy(state.camera.quaternion)
        g.rotateZ(s.t * 14) // victory spin, in the camera's plane
        g.scale.setScalar(k < 0.22 ? 1 + 2.2 * k : Math.max(0, 1.48 * (1 - (k - 0.22) / 0.78)))
      } else if (g.visible) {
        g.visible = false
      }
    }
  })

  // Same rule as Intro.jsx: floating billboarded type is gameplay furniture,
  // not park geometry, and the plaza/bowl captures are compared against the
  // reference stills. Cans stay visible — those ARE park furniture.
  if (PHOTO) return null
  return LETTERS.map((b, i) => (
    <group key={b.id} ref={(el) => (refs.current[i] = el)} position={[b.x, b.y, b.z]}>
      <Text
        font={FONT}
        fontSize={1.3}
        anchorX="center"
        anchorY="middle"
        color="#ffe14d"
        // the same purple ink the title uses — reads as one typographic family
        outlineWidth={0.085}
        outlineColor="#6a3fb0"
      >
        {b.ch}
      </Text>
    </group>
  ))
}
