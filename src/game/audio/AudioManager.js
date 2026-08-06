// Fully synthesised SFX (oscillators + noise buffers) plus a three-track
// soundtrack from public/songs. Nothing touches AudioContext at import time;
// the editor may prime a suspended context during its covered warm-up, while
// unlockAudio() still resumes it from a user gesture.

import { P, on } from '../store.js'

const MASTER = 0.55, VOICES = 8
const MUSIC_VOL = 0.15
const MUSIC = [
  '/songs/Skate Dog.mp3',
  '/songs/Skate Dog 1.mp3',
  '/songs/Skate Dog 2.mp3',
  '/songs/Skate Dog 3.mp3',
  '/songs/Skate Dog 4.mp3',
  '/songs/Skate Dog 5.mp3',
]

let ctx = null, master = null, started = false, muted = false, grinding = false
let whiteBuf = null, pinkBuf = null, loopEnd = 0
let breezeLP = null, breezeGain = null, rollBP = null, rollGain = null
let grindBP = null, grindLevel = null, grindGain = null
let music = null, musicIdx = 0, musicOrder = null
// Ducking factor, not a second volume: the mute path and the editor's duck are
// two independent reasons the music is quiet, and one variable for both means
// unmuting while editing comes back at full level.
let musicDuck = 1
const musicVol = () => (muted ? 0 : MUSIC_VOL * musicDuck)

/** Scale the soundtrack without touching mute. 1 = normal. */
export function setMusicDuck(k) {
  musicDuck = k
  if (music) music.volume = musicVol()
}
const loops = [], unsubs = []
let breezePhase = 0, birdTimer = 4, lastHalf = 0

function shuffleMusic() {
  // Random start, then the rest in authored order — one full pass with no
  // repeats before wrapping. Reshuffling on wrap keeps the first song of the
  // next pass from matching the last of the previous.
  const n = MUSIC.length
  const start = Math.floor(Math.random() * n)
  const order = []
  for (let i = 0; i < n; i++) order.push(MUSIC[(start + i) % n])
  if (musicOrder && order[0] === musicOrder[musicOrder.length - 1] && n > 1) {
    // rotate once more so the seam never double-plays the same track
    order.push(order.shift())
  }
  musicOrder = order
  musicIdx = 0
}

function playMusicTrack() {
  if (!music || !musicOrder) return
  music.src = musicOrder[musicIdx]
  music.volume = musicVol()
  music.play().catch(() => { /* gesture / autoplay policy */ })
}

function startMusic() {
  if (music) return
  music = new Audio()
  music.preload = 'auto'
  music.addEventListener('ended', () => {
    musicIdx++
    if (musicIdx >= musicOrder.length) shuffleMusic()
    playMusicTrack()
  })
  shuffleMusic()
  playMusicTrack()
}

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

// big-air shimmer: a glassy pentatonic run of detuned sine pairs over an airy
// high-passed sparkle bed — magic-dust twinkle, deliberately not the trick
// arpeggio so the moment reads as its own reward
function sfxShimmer() {
  if (!ctx) return
  const t = ctx.currentTime, v = voice(1.1)
  ;[1047, 1319, 1568, 2093, 2637].forEach((hz, i) => {
    const t0 = t + i * 0.05
    for (const det of [-7, 8]) {
      const o = osc('sine', hz, det), g = gn(0)
      env(g.gain, t0, 0.0325, 0.01, 0.5)
      o.connect(g); g.connect(v.g); o.start(t0); o.stop(t0 + 0.6); v.add(o, g)
    }
  })
  const s = noise(false, false), f = flt('highpass', 5200), ng = gn(0)
  env(ng.gain, t, 0.025, 0.06, 0.6)
  s.connect(f); f.connect(ng); ng.connect(v.g)
  s.start(t, Math.random() * 2); s.stop(t + 0.75); v.add(s, f, ng)
}

// Clearing a SET (all five bones, all five cans) — the two moments a run has
// that are the last of a series rather than one more of one. Every goal already
// gets shimmer + chime, so this has to be bigger than that or it isn't a
// celebration: a rising major arpeggio that ARRIVES on a held triad, over a
// filtered-noise swell that reads as a cheer. One voice for the whole thing —
// the pool is 8 and a ten-note fanfare taken one voice per note would evict
// itself halfway through.
function sfxFanfare() {
  if (!ctx) return
  const t = ctx.currentTime, v = voice(2.2)
  const NOTES = [523, 659, 784, 1047]
  NOTES.forEach((hz, i) => {
    const t0 = t + i * 0.11
    const dec = i === NOTES.length - 1 ? 1.4 : 0.28 // stabs, then the top rings
    const g = gn(0)
    env(g.gain, t0, 0.15, 0.02, dec)
    g.connect(v.g); v.add(g)
    for (const [type, det, lvl] of [['triangle', -6, 1], ['square', 7, 0.3]]) {
      const o = osc(type, hz, det), og = gn(lvl)
      o.connect(og); og.connect(g)
      o.start(t0); o.stop(t0 + 0.05 + dec); v.add(o, og)
    }
  })
  // the triad lands under the last note, not with the first: an arpeggio that
  // is already a chord has nowhere to go
  for (const hz of [523, 659, 784]) {
    const t0 = t + 0.33, o = osc('sine', hz, 4), g = gn(0)
    env(g.gain, t0, 0.07, 0.06, 1.2)
    o.connect(g); g.connect(v.g); o.start(t0); o.stop(t0 + 1.4); v.add(o, g)
  }
  const s = noise(false, false), f = flt('bandpass', 1700, 0.7), ng = gn(0)
  env(ng.gain, t, 0.085, 0.25, 0.85) // slow attack — a cheer swells, it doesn't hit
  s.connect(f); f.connect(ng); ng.connect(v.g)
  s.start(t, Math.random() * 2); s.stop(t + 1.2); v.add(s, f, ng)
}

// Bin clang: an empty steel drum is INHARMONIC — equal-tempered partials read
// as a bell and a bell reads as a reward, which is exactly what a smash is
// not. Ratios below are stretched off any interval, over a bright noise crash
// and a low body thunk, then a short clatter tail so the wreck keeps rolling
// while the debris is still in the air.
function sfxSmash(e) {
  if (!ctx) return
  const k = Math.min(1, ((e && e.speed) || 8) / 13)
  const t = ctx.currentTime, v = voice(1.0)
  ;[1, 1.51, 2.13, 2.77, 3.61].forEach((r, i) => {
    const o = osc(i > 2 ? 'square' : 'triangle', 190 * r), g = gn(0)
    env(g.gain, t, (0.13 - i * 0.018) * (0.6 + k * 0.6), 0.003, 0.24 + i * 0.06)
    o.connect(g); g.connect(v.g); o.start(t); o.stop(t + 0.6); v.add(o, g)
  })
  const s = noise(false, false), f = flt('bandpass', 3200, 0.8), ng = gn(0)
  env(ng.gain, t, 0.16 * (0.5 + k), 0.002, 0.16)
  s.connect(f); f.connect(ng); ng.connect(v.g); s.start(t, Math.random() * 2); s.stop(t + 0.3)
  const o = osc('sine', 150), og = gn(0)
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.14)
  env(og.gain, t, 0.22 * (0.5 + k), 0.004, 0.16)
  o.connect(og); og.connect(v.g); o.start(t); o.stop(t + 0.35)
  v.add(s, f, ng, o, og)
  for (let i = 0; i < 3; i++) { // clatter: the drum bouncing away
    const t0 = t + 0.22 + i * (0.11 + Math.random() * 0.07)
    const o2 = osc('triangle', 260 * (1 + Math.random() * 0.9)), g2 = gn(0)
    env(g2.gain, t0, 0.07 / (i + 1), 0.003, 0.09)
    o2.connect(g2); g2.connect(v.g); o2.start(t0); o2.stop(t0 + 0.14); v.add(o2, g2)
  }
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

// ------------------------------------------------------------------ editor
// Placement pop / delete thunk for ?edit build mode. They self-unlock: the
// editor never runs the game's start gesture, and a placement IS a click, so
// creating the context here is the gesture. Guarded for node — the level
// checks import levelEdits, which imports this module.
export function sfxPlace(h = 1) {
  if (typeof window === 'undefined') return
  unlockAudio()
  if (!ctx) return
  const t = ctx.currentTime, v = voice(0.3)
  // taller object -> deeper pop, so a quarter lands heavier than a bone
  const hz = 640 / Math.pow(Math.max(0.4, h), 0.35)
  const o = osc('sine', hz)
  o.frequency.setValueAtTime(hz, t)
  o.frequency.exponentialRampToValueAtTime(hz * 0.45, t + 0.11)
  env(v.g.gain, t, 0.3, 0.008, 0.16)
  o.connect(v.g); o.start(t); o.stop(t + 0.2)
  // The long noise buffers are built when play-test starts, under its mode
  // cover. Building them on the first placement gesture blocks the editor for
  // ~160ms just to add this tiny click layer; the oscillator pop stands alone
  // until those buffers already exist.
  if (whiteBuf) {
    const s = noise(false, false), f = flt('highpass', 2400), ng = gn(0)
    env(ng.gain, t, 0.05, 0.004, 0.05)
    s.connect(f); f.connect(ng); ng.connect(v.g)
    s.start(t, Math.random() * 2); s.stop(t + 0.08)
    v.add(o, s, f, ng)
  } else {
    v.add(o)
  }
}

export function sfxDelete() {
  if (typeof window === 'undefined') return
  unlockAudio()
  if (!ctx) return
  const t = ctx.currentTime, v = voice(0.35)
  const o = osc('triangle', 180)
  o.frequency.setValueAtTime(180, t)
  o.frequency.exponentialRampToValueAtTime(70, t + 0.16)
  env(v.g.gain, t, 0.24, 0.006, 0.2)
  o.connect(v.g); o.start(t); o.stop(t + 0.26)
  if (pinkBuf) {
    const s = noise(true, false), f = flt('lowpass', 700), ng = gn(0)
    env(ng.gain, t, 0.1, 0.005, 0.1)
    s.connect(f); f.connect(ng); ng.connect(v.g)
    s.start(t, Math.random() * 2); s.stop(t + 0.16)
    v.add(o, s, f, ng)
  } else {
    v.add(o)
  }
}

// ------------------------------------------------------------------- public
export function primeAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    master = gn(muted ? 0 : MASTER)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18; comp.knee.value = 26; comp.ratio.value = 3
    comp.attack.value = 0.006; comp.release.value = 0.22
    master.connect(comp)
    comp.connect(ctx.destination)
  }
}

export function unlockAudio() {
  primeAudio()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* gesture not accepted */ })
}

export function startAudio() {
  if (started) return
  if (!ctx) unlockAudio()
  if (!ctx) return
  // This is the expensive part of audio startup. In editor play-test it runs
  // behind the mode transition instead of inside the first placement click.
  if (!whiteBuf || !pinkBuf) ensureNoise()
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
  startMusic()
  unsubs.push(
    on('jump', sfxJump), on('land', sfxLand), on('trick', sfxTrick), on('bail', sfxBail),
    on('bone', ({ big }) => sfxTrick({ points: big ? 2500 : 700 })),
    // clang first, then the score chime under it — the impact has to land
    // before the reward or it reads as a pickup
    on('smash', (e) => { sfxSmash(e); sfxTrick({ points: 300 }) }),
    // a challenge gets the shimmer AND the fanfare — it's the biggest single
    // thing that happens in a run and it has to sound like it
    on('goal', ({ id }) => {
      sfxShimmer()
      sfxTrick({ points: 2500 })
      // 'fetch' = all 5 bones, 'cans' = all 5 smashed — the two set-clears
      if (id === 'fetch' || id === 'cans') sfxFanfare()
    }),
    on('bigair', sfxShimmer),
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

  // Pause freezes P (speed, grind state) but leaves the continuous loops running
  // off those latched values — hush roll/grind so a mid-rail Esc isn't a held
  // spark whoosh. Breeze stays: park atmosphere under the ducked soundtrack.
  // grindGain is event-edged, so restoring it on unpause has to live here.
  if (P.paused) {
    rollGain.gain.setTargetAtTime(0, t, 0.05)
    grindGain.gain.setTargetAtTime(0, t, 0.05)
    return
  }

  birdTimer -= d
  if (birdTimer <= 0) { birdTimer = 6 + Math.random() * 8; chirp() }

  const sp = P.speed || 0, quiet = P.state === 'air' || P.state === 'bail'
  // index rather than destructure: this runs every frame and must not allocate
  const r = ROLL[P.surfaceType] || ROLL.concrete
  const amt = quiet ? 0 : Math.min(1, sp / 9) * r[1] * (grinding ? 0.3 : 1)
  rollGain.gain.setTargetAtTime(0.08 * amt, t, 0.07)
  rollBP.frequency.setTargetAtTime(Math.min(5200, (260 + sp * 46) * r[0]), t, 0.09)

  if (grinding) {
    grindGain.gain.setTargetAtTime(0.16, t, 0.05)
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
  if (music) music.volume = musicVol()
}

export function isMuted() { return muted }

export function disposeAudio() {
  for (const u of unsubs) u()
  unsubs.length = 0
  for (let i = 0; i < pool.length; i++) { if (pool[i]) pool[i].free(); pool[i] = null }
  for (const l of loops) { stopNode(l); l.disconnect() }
  loops.length = 0
  if (music) { music.pause(); music.src = ''; music = null }
  musicIdx = 0
  musicOrder = null
  if (ctx) ctx.close().catch(() => { /* already closed */ })
  ctx = null
  master = breezeLP = breezeGain = rollBP = rollGain = grindBP = grindLevel = grindGain = null
  whiteBuf = pinkBuf = null
  started = grinding = false
  birdTimer = 4 // otherwise a remount chirps on frame one with a stale timer
  vi = 0
}
