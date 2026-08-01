// Keyboard sampling. Reads into a plain object; nothing here touches React.

export const input = {
  steer: 0, // -1 left .. 1 right
  throttle: 0, // 0..1
  brake: false,
  jump: false, // edge-triggered, cleared by the controller
  jumpHeld: false,
  jumpBuffer: 0, // seconds remaining on a buffered jump press
  spin: 0, // -1 / +1 while Q or E held
  dogSpin: false, // edge-triggered
  grab: false,
  reverse: false,
}

// Coarse pointer = phone/tablet. Shared: GameUI shows the touch controls,
// store drops the default quality, Game caps dpr, CameraController pulls back.
export const TOUCH =
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches

// Mobile layer, written by GameUI's joystick/jump button. On the GROUND the
// stick is world-directional: it points where you want to GO on screen and
// steering is derived from the heading error — so PlayerController calls
// applyTouchStick with the live heading every substep, because holding the
// stick still while the dog turns must keep steering toward it (a pointermove
// handler alone goes stale). In the AIR the raw axes are the trick pad:
// x is spin, up is grab, down is kickflip — same as the arrow keys.
export const touch = { x: 0, y: 0, active: false, jumpHeld: false }

export function touchJumpDown() {
  jumpEdge = true
  touch.jumpHeld = true
}
export function touchJumpUp() {
  touch.jumpHeld = false
}

// tight response: dead zone 0.12, full strength at `sat` deflection
const shape = (v, sat) => Math.sign(v) * Math.min(1, Math.max(0, (Math.abs(v) - 0.12) / (sat - 0.12)))
const clamp1 = (v) => Math.max(-1, Math.min(1, v))

// The chase camera keeps a fixed world yaw (it only translates), so screen
// axes map to ONE constant world basis. Mirrored rather than imported:
// input.js must stay JSX-free or the plain-node check scripts can't load
// PlayerController.
const CAM_YAW = -0.42 // must match CameraController's YAW
const SUX = -Math.sin(CAM_YAW) // world direction of "up on the screen"
const SUZ = -Math.cos(CAM_YAW)
const SRX = Math.cos(CAM_YAW) // world direction of "right on the screen"
const SRZ = -Math.sin(CAM_YAW)

export function applyTouchStick(heading, airborne) {
  if (!touch.active) return
  const dx = touch.x
  const sy = -touch.y // stick up is positive
  if (airborne) {
    input.steer = shape(dx, 0.55)
    input.throttle = Math.max(0, shape(sy, 0.5))
    input.reverse = -sy > 0.35
    return
  }
  const drive = shape(Math.hypot(dx, sy), 0.5)
  if (drive <= 0) {
    input.steer = 0
    input.throttle = 0
    input.reverse = false
    return
  }
  const want = Math.atan2(SRX * dx + SUX * sy, SRZ * dx + SUZ * sy)
  const err = Math.atan2(Math.sin(want - heading), Math.cos(want - heading))
  // rising heading is a LEFT turn, so steering toward a positive error is
  // negative steer. Full lock by 30 degrees of error keeps it snappy; pulling
  // the stick opposite your travel just steers the long way round, which the
  // shift boost and transition auto-turn already make feel like a whip.
  input.steer = clamp1(-err * 1.9)
  input.throttle = drive
  input.reverse = false
}

const down = new Set()

const KEYS = {
  ArrowUp: 'fwd',
  KeyW: 'fwd',
  ArrowDown: 'back',
  KeyS: 'back',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'brake',
  ShiftRight: 'brake',
  KeyQ: 'spinL',
  KeyE: 'spinR',
  KeyJ: 'dogSpin',
  KeyK: 'grab',
}

let jumpEdge = false
let dogSpinEdge = false

function onKeyDown(e) {
  const k = KEYS[e.code]
  if (!k) return
  if (e.code === 'Space') e.preventDefault()
  if (!down.has(k)) {
    if (k === 'jump') jumpEdge = true
    if (k === 'dogSpin') dogSpinEdge = true
  }
  down.add(k)
}

function onKeyUp(e) {
  const k = KEYS[e.code]
  if (k) down.delete(k)
}

function onBlur() {
  down.clear()
}

export function initInput() {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}

const BUFFER = 0.14

export function sampleInput(dt) {
  input.steer = (down.has('right') ? 1 : 0) - (down.has('left') ? 1 : 0)
  input.throttle = down.has('fwd') ? 1 : 0
  input.reverse = down.has('back')
  input.brake = down.has('brake')
  input.jumpHeld = down.has('jump') || touch.jumpHeld
  input.spin = (down.has('spinR') ? 1 : 0) - (down.has('spinL') ? 1 : 0)
  input.grab = down.has('grab')

  input.jumpBuffer = jumpEdge ? BUFFER : Math.max(0, input.jumpBuffer - dt)
  input.jump = jumpEdge
  input.dogSpin = dogSpinEdge
  jumpEdge = false
  dogSpinEdge = false
  return input
}

export function consumeJump() {
  input.jumpBuffer = 0
}
