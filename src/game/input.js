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

// Mobile layer, written by GameUI's joystick/jump button and merged with the
// keys in sampleInput. The joystick reuses the same axes on purpose: in the
// air steer IS spin, up IS grab and down IS kickflip, so one stick does every
// trick without a second control.
export const touch = { steer: 0, throttle: 0, reverse: false, jumpHeld: false }

export function touchJumpDown() {
  jumpEdge = true
  touch.jumpHeld = true
}
export function touchJumpUp() {
  touch.jumpHeld = false
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
  const keySteer = (down.has('right') ? 1 : 0) - (down.has('left') ? 1 : 0)
  input.steer = Math.max(-1, Math.min(1, keySteer + touch.steer))
  input.throttle = Math.max(down.has('fwd') ? 1 : 0, touch.throttle)
  input.reverse = down.has('back') || touch.reverse
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
