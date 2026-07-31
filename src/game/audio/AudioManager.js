// Fully synthesised audio: oscillators + procedurally filled noise buffers, no
// files. Inert until unlockAudio() runs from a user gesture — nothing here
// touches AudioContext at import time.

import { P, on } from '../store.js'

const MASTER = 0.55, VOICES = 8

let ctx = null, master = null, started = false, muted = false, grinding = false
let whiteBuf = null, pinkBuf = null, loopEnd = 0
let breezeLP = null, breezeGain = null, rollBP = null, rollGain = null
let grindBP = null, grindLevel = null, grindGain = null
const loops = [], unsubs = []
let breezePhase = 0, birdTimer = 4, lastHalf = 0

// per-surface paw tick { freq, Q, gain, decay } and rolling-noise { freq×, gain× }
const PAW = {
  concrete: [2200, 1.4, 0.1, 0.055], ledge: [2500, 1.8, 0.1, 0.05],
  ramp: [1900, 1.3, 0.09, 0.06], bowl: [820, 0.9, 0.062, 0.085],
  stairs: [3200, 7, 0.13, 0.045],
}
const ROLL = {
  concrete: [1, 1], ledge: [1.05, 0.85], ramp: [0.95, 1],
  bowl: [0.72, 1.15], stairs: [1.3, 1.25],
}

function ensureNoise() {
  const sr = ctx.sampleRate, n = Math.floor(sr * 3), xf = 2048
  whiteBuf = ctx.createBuffer(1, n, sr); pinkBuf = ctx.createBuffer(1, n, sr)
  const w = whiteBuf.getChannelData(0), p = pinkBuf.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 2 - 1
    w[i] = v
    b0 = 0.99886 * b0 + v * 0.0555179; b1 = 0.99332 * b1 + v * 0.0750759
    b2 = 0.969 * b2 + v * 0.153852; b3 = 0.8665 * b3 + v * 0.3104856
    b4 = 0.55 * b4 + v * 0.5329522; b5 = -0.7616 * b5 - v * 0.016898
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362) * 0.11
    b6 = v * 0.115926
  }
  // crossfade the head over the tail so looping the buffer never clicks
  for (let i = 0; i < xf; i++) {
    const a = i / xf
    p[i] = p[i] * a + p[n - xf + i] * (1 - a)
    w[i] = w[i] * a + w[n - xf + i] * (1 - a)
  }
  loopEnd = (n - xf) / sr
}

function noise(pink, looped) {
  const s = ctx.createBufferSource()
  s.buffer = pink ? pinkBuf : whiteBuf
  if (looped) { s.loop = true; s.loopEnd = loopEnd }
  return s
}
function flt(type, freq, q) {
  const f = ctx.createBiquadFilter()
  f.type = type; f.frequency.value = freq
  if (q !== undefined) f.Q.value = q
  return f
}
function gn(value) {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}
function osc(type, freq, detune) {
  const o = ctx.createOscillator()
  o.type = type; o.frequency.value = freq
  if (detune) o.detune.value = detune
  return o
}
function stopNode(n) { try { if (n.stop) n.stop() } catch { /* already stopped */ } }
function env(param, t, peak, attack, decay) {
  param.setValueAtTime(0.0001, t)
  param.exponentialRampToValueAtTime(peak, t + attack)
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

const pool = new Array(VOICES).fill(null)
let vi = 0

/** Round-robin one-shot bus; `dur` seconds until it frees itself. */
function voice(dur) {
  const g = gn(1)
  g.connect(master)
  const v = { g, n: [], dead: false, timer: 0 }
  v.add = (...nodes) => v.n.push(...nodes)
  v.free = () => {
    if (v.dead) return
    v.dead = true; clearTimeout(v.timer)
    for (const node of v.n) { stopNode(node); node.disconnect() }
    g.disconnect()
  }
  v.recycle = () => { // steal the slot without clicking
    const t = ctx.currentTime
    g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.006)
    clearTimeout(v.timer); v.timer = setTimeout(v.free, 60)
  }
  const slot = vi++ % VOICES
  if (pool[slot] && !pool[slot].dead) pool[slot].recycle()
  pool[slot] = v
  v.timer = setTimeout(v.free, (dur + 0.15) * 1000)
  return v
}

// ---------------------------------------------------------------- one-shots
// No dog voice. The kit used to bark on takeoff, bark on a trick, whimper on a
// bail and yip faster and faster through a grind; it is all gone by request.
// The paw patter below stays — that is the gait, not the dog talking.
function pawTick(sp) {
  const [hz, q, lvl, dec] = PAW[P.surfaceType] || PAW.concrete
  const t = ctx.currentTime, v = voice(0.2)
  const s = noise(false, false), f = flt('bandpass', hz * (0.9 + Math.random() * 0.2), q)
  s.playbackRate.value = 0.9 + Math.random() * 0.3
  s.connect(f); f.connect(v.g)
  env(v.g.gain, t, lvl * Math.min(1, 0.45 + sp / 8), 0.004, dec)
  s.start(t, Math.random() * 2); s.stop(t + 0.14); v.add(s, f)
}

function sfxJump() {
  if (!ctx) return
  const t = ctx.currentTime, v = voice(0.35)
  const o = osc('triangle', 260), og = gn(0)
  o.frequency.setValueAtTime(260, t)
  o.frequency.exponentialRampToValueAtTime(1250, t + 0.16) // cartoon slide-whistle up
  env(og.gain, t, 0.4, 0.012, 0.22)
  o.connect(og); og.connect(v.g); o.start(t); o.stop(t + 0.3)
  const s = noise(false, false), f = flt('highpass', 1100), ng = gn(0)
  env(ng.gain, t, 0.09, 0.006, 0.09)
  s.connect(f); f.connect(ng); ng.connect(v.g)
  s.start(t, Math.random() * 2); s.stop(t + 0.14); v.add(o, og, s, f, ng)
}

function sfxLand(e) {
  if (!ctx) return
  // impact arrives as a rough landing speed; curve it so soft taps stay soft
  const k = Math.min(1, Math.pow(Math.max(0, (e && e.impact) || 1) / 10, 0.6))
  const t = ctx.currentTime, v = voice(0.55)
  const s = noise(true, false), f = flt('lowpass', 220 + k * 900, 0.9), ng = gn(0)
  f.frequency.setValueAtTime(220 + k * 900, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.22)
  env(ng.gain, t, 0.12 + k * 0.34, 0.008, 0.16 + k * 0.14)
  s.connect(f); f.connect(ng); ng.connect(v.g); s.start(t, Math.random() * 2); s.stop(t + 0.45)
  const o = osc('sine', 120), og = gn(0)
  o.frequency.setValueAtTime(120, t)
  o.frequency.exponentialRampToValueAtTime(52, t + 0.18)
  env(og.gain, t, 0.1 + k * 0.22, 0.01, 0.2)
  o.connect(og); og.connect(v.g); o.start(t); o.stop(t + 0.45)
  v.add(s, f, ng, o, og)
  if (k > 0.35) { // cartoon boing: pitch wobble decaying with the bounce
    const o2 = osc('triangle', 180), lfo = osc('sine', 11), lg = gn(0), og2 = gn(0)
    lg.gain.setValueAtTime(240, t); lg.gain.linearRampToValueAtTime(0, t + 0.4)
    lfo.connect(lg); lg.connect(o2.detune)
    o2.frequency.setValueAtTime(180, t)
    o2.frequency.exponentialRampToValueAtTime(85, t + 0.35)
    env(og2.gain, t, 0.2 * k, 0.01, 0.32)
    o2.connect(og2); og2.connect(v.g)
    o2.start(t); o2.stop(t + 0.45); lfo.start(t); lfo.stop(t + 0.45)
    v.add(o2, lfo, lg, og2)
  }
}

function sfxTrick(e) {
  if (!ctx) return
  const pts = (e && e.points) || 100
  const k = 0.6 + Math.min(0.4, pts / 2500)
  const t = ctx.currentTime, v = voice(0.9)
  ;[523, 659, 784].forEach((hz, i) => { // rising major arpeggio, game-show happy
    const t0 = t + i * 0.06, o = osc('sine', hz), g = gn(0)
    env(g.gain, t0, 0.17 * k, 0.008, 0.42)
    o.connect(g); g.connect(v.g); o.start(t0); o.stop(t0 + 0.5); v.add(o, g)
  })
}

function sfxBail() {
  if (!ctx) return
  const t = ctx.currentTime, v = voice(0.9)
  const o = osc('triangle', 620), lfo = osc('sine', 7.5), lg = gn(90)
  o.frequency.setValueAtTime(620, t) // full slide-whistle down, wah-wah wobble
  o.frequency.exponentialRampToValueAtTime(70, t + 0.6)
  lfo.connect(lg); lg.connect(o.detune)
  env(v.g.gain, t, 0.26, 0.03, 0.58)
  o.connect(v.g); o.start(t); o.stop(t + 0.68); lfo.start(t); lfo.stop(t + 0.68)
  v.add(o, lfo, lg)
}

function chirp() {
  const t = ctx.currentTime, base = 1500 + Math.random() * 1300
  const n = Math.random() < 0.4 ? 3 : 2
  for (let i = 0; i < n; i++) {
    const t0 = t + i * (0.1 + Math.random() * 0.06), hz = base * (1 + i * 0.07)
    const v = voice(0.25 + i * 0.16)
    for (const det of [-5, 6]) {
      const o = osc('sine', hz, det)
      o.frequency.setValueAtTime(hz * 0.8, t0)
      o.frequency.exponentialRampToValueAtTime(hz, t0 + 0.045)
      o.connect(v.g); o.start(t0); o.stop(t0 + 0.15); v.add(o)
    }
    env(v.g.gain, t0, 0.05, 0.014, 0.11)
  }
}

// ------------------------------------------------------------------- public
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    ensureNoise()
    master = gn(muted ? 0 : MASTER)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18; comp.knee.value = 26; comp.ratio.value = 3
    comp.attack.value = 0.006; comp.release.value = 0.22
    master.connect(comp)
    comp.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* gesture not accepted */ })
}

export function startAudio() {
  if (started) return
  if (!ctx) unlockAudio()
  if (!ctx) return
  started = true
  const t = ctx.currentTime

  const breeze = noise(true, true)
  breezeLP = flt('lowpass', 400, 0.6); breezeGain = gn(0.0001)
  breezeGain.gain.setTargetAtTime(0.035, t, 1.2)
  breeze.connect(breezeLP); breezeLP.connect(breezeGain); breezeGain.connect(master)
  breeze.start(); loops.push(breeze)

  const roll = noise(false, true)
  rollBP = flt('bandpass', 300, 1.1); rollGain = gn(0)
  roll.connect(rollBP); rollBP.connect(rollGain); rollGain.connect(master)
  roll.start(); loops.push(roll)

  grindGain = gn(0); grindGain.connect(master)
  grindLevel = gn(1); grindLevel.connect(grindGain)
  const gnoise = noise(false, true)
  grindBP = flt('bandpass', 2600, 2.4)
  gnoise.connect(grindBP); grindBP.connect(grindLevel)
  gnoise.start(); loops.push(gnoise)
  for (const det of [-11, 9]) {
    const saw = osc('sawtooth', 320, det), sg = gn(0.055)
    saw.connect(sg); sg.connect(grindLevel)
    saw.start(); loops.push(saw)
  }

  lastHalf = Math.floor((P.run || 0) / Math.PI)
  unsubs.push(
    on('jump', sfxJump), on('land', sfxLand), on('trick', sfxTrick), on('bail', sfxBail),
    on('grind', (e) => {
      const active = !!(e && e.on)
      if (active === grinding || !ctx) return
      grinding = active
      const now = ctx.currentTime
      // read the live value BEFORE cancelling: cancelScheduledValues() drops the
      // in-flight ramp and reverts the param to its last anchor, so reading after
      // would snap a mid-fade grind back to 0/0.16 and click
      const cur = grindGain.gain.value
      grindGain.gain.cancelScheduledValues(now)
      grindGain.gain.setValueAtTime(cur, now)
      grindGain.gain.linearRampToValueAtTime(active ? 0.16 : 0, now + (active ? 0.08 : 0.12))
    }),
  )
}

export function updateAudio(dt) {
  if (!ctx || !started) return
  const t = ctx.currentTime, d = Math.min(Math.max(dt || 0, 0), 0.1)

  breezePhase += d * 0.14
  const cut = 380 + Math.sin(breezePhase) * 150 + Math.sin(breezePhase * 0.37) * 70
  breezeLP.frequency.setTargetAtTime(cut, t, 0.5)
  breezeGain.gain.setTargetAtTime(0.035 * (0.72 + 0.28 * Math.sin(breezePhase * 0.61)), t, 0.6)

  birdTimer -= d
  if (birdTimer <= 0) { birdTimer = 6 + Math.random() * 8; chirp() }

  const sp = P.speed || 0, quiet = P.state === 'air' || P.state === 'bail'
  // index rather than destructure: this runs every frame and must not allocate
  const r = ROLL[P.surfaceType] || ROLL.concrete
  const amt = quiet ? 0 : Math.min(1, sp / 9) * r[1] * (grinding ? 0.3 : 1)
  rollGain.gain.setTargetAtTime(0.08 * amt, t, 0.07)
  rollBP.frequency.setTargetAtTime(Math.min(5200, (260 + sp * 46) * r[0]), t, 0.09)

  if (grinding) {
    grindBP.frequency.setTargetAtTime(Math.min(6500, 1700 + sp * 200), t, 0.12)
    grindLevel.gain.setTargetAtTime(0.5 + Math.min(0.6, sp / 14), t, 0.15)
  }

  // paw patter: one tick per half-cycle of the gait phase
  const half = Math.floor((P.run || 0) / Math.PI)
  if (half !== lastHalf) {
    const step = Math.abs(half - lastHalf) // ignore respawn/teleport jumps
    lastHalf = half
    if (step < 3 && !quiet && P.grounded && P.state !== 'grind' && (P.runBlend || 0) > 0.2 && sp > 0.7) pawTick(sp)
  }
}

export function setMuted(m) {
  muted = !!m
  if (ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.03)
}

export function isMuted() { return muted }

export function disposeAudio() {
  for (const u of unsubs) u()
  unsubs.length = 0
  for (let i = 0; i < pool.length; i++) { if (pool[i]) pool[i].free(); pool[i] = null }
  for (const l of loops) { stopNode(l); l.disconnect() }
  loops.length = 0
  if (ctx) ctx.close().catch(() => { /* already closed */ })
  ctx = null
  master = breezeLP = breezeGain = rollBP = rollGain = grindBP = grindLevel = grindGain = null
  whiteBuf = pinkBuf = null
  started = grinding = false
  birdTimer = 4 // otherwise a remount chirps on frame one with a stale timer
  vi = 0
}
