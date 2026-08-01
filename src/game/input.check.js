// The touch stick is world-directional on the ground: applyTouchStick derives
// steer from heading error, so from ANY facing the heading must converge onto
// the stick's screen direction. A sign error here converges to the opposite
// direction or oscillates — both smooth, finite and wrong.
import { input, touch, applyTouchStick } from './input.js'

const YAW = -0.42 // CameraController's fixed chase yaw
touch.active = true

// stick straight up = "away from the camera": already facing that way, no steer
touch.x = 0
touch.y = -1
applyTouchStick(YAW + Math.PI, false)
if (Math.abs(input.steer) > 1e-9) throw new Error(`up-stick while facing screen-up should not steer (${input.steer})`)
if (input.throttle < 0.99) throw new Error(`full deflection should be full throttle (${input.throttle})`)

// from an arbitrary facing, iterating the steer rule at a carve-like turn rate
// must land the heading on the stick direction for every stick angle
for (const [sx, sy] of [[1, 0], [0, 1], [-1, 0], [-0.7, -0.7], [0.3, 0.9]]) {
  touch.x = sx
  touch.y = sy
  let h = 2.1
  for (let i = 0; i < 600; i++) {
    applyTouchStick(h, false)
    h -= input.steer * 4 * (1 / 120)
  }
  applyTouchStick(h, false)
  if (Math.abs(input.steer) > 0.05) throw new Error(`stick (${sx},${sy}) never converged, residual steer ${input.steer}`)
}

// dead-zone stick must not drive
touch.x = 0.05
touch.y = -0.05
applyTouchStick(0, false)
if (input.throttle !== 0 || input.steer !== 0) throw new Error('dead-zone stick should be inert')

console.log('touch stick ok')
