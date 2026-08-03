import * as THREE from 'three'
import { C, RAMP, mix } from '../palette.js'

// Procedurally generated surface textures. Nothing is loaded from disk or the
// network. Each returns a cached, tiling texture sized in world units so the
// renderer can just set repeat = worldSize / TILE.

const cache = new Map()
function cached(key, make) {
  let t = cache.get(key)
  if (!t) cache.set(key, (t = make()))
  return t
}

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')]
}

function tex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.repeat.set(repeat, repeat)
  return t
}

// deterministic value noise ------------------------------------------------
function rnd(x, y, s) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453
  return n - Math.floor(n)
}
function noise(x, y, s) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = rnd(xi, yi, s)
  const b = rnd(xi + 1, yi, s)
  const c2 = rnd(xi, yi + 1, s)
  const d = rnd(xi + 1, yi + 1, s)
  return (a + (b - a) * u) * (1 - v) + (c2 + (d - c2) * u) * v
}

/** Soft mottling overlay — the "painterly surface variation". */
function mottle(ctx, w, h, seed, amount, scale) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0
      let amp = 1
      let f = scale
      for (let o = 0; o < 3; o++) {
        n += noise((x / w) * f, (y / h) * f, seed + o) * amp
        amp *= 0.5
        f *= 2.1
      }
      n = (n / 1.75 - 0.5) * amount
      const i = (y * w + x) * 4
      d[i] = Math.min(255, Math.max(0, d[i] + n * 255))
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n * 250))
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n * 240))
    }
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Fine-grain aggregate speckle. This is the cheapest thing in the file and the
 * one that does the most work: a concrete slab with no grain returns exactly the
 * same specular across its whole face, which is what reads as plastic. The dots
 * are sub-millimetre at the tile scales we use, so they never resolve as dots —
 * they just stop the surface from being uniform.
 */
function grain(ctx, w, h, n, alpha, seed) {
  for (let k = 0; k < n; k++) {
    const v = rnd(k, 0, seed)
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`
    const px = rnd(k, 1, seed + 1) * w
    const py = rnd(k, 2, seed + 2) * h
    ctx.fillRect(px, py, 1 + (v > 0.85 ? 1 : 0), 1)
  }
}

/** A wandering polyline — cracks, joint chips, scuff paths. */
function crack(ctx, x0, y0, steps, len, seed) {
  let px = x0
  let py = y0
  let a = rnd(0, 0, seed) * 6.28
  ctx.beginPath()
  ctx.moveTo(px, py)
  for (let s = 0; s < steps; s++) {
    a += (rnd(s, 1, seed) - 0.5) * 1.1
    px += Math.cos(a) * len
    py += Math.sin(a) * len
    ctx.lineTo(px, py)
  }
  ctx.stroke()
}

/** Sobel a grayscale height canvas into a tangent-space normal map. */
function normalFrom(heightCanvas, strength = 2.0) {
  const w = heightCanvas.width
  const h = heightCanvas.height
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data
  const [c, ctx] = canvas(w, h)
  const out = ctx.createImageData(w, h)
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
      let nx = dx * strength
      let ny = dy * strength
      const nz = 1
      const l = Math.hypot(nx, ny, nz)
      const i = (y * w + x) * 4
      out.data[i] = ((nx / l) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255
      out.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

/** Sample an ordered dark->light ramp of hex stops at t in 0..1. */
function rampAt(stops, t) {
  const k = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1)
  const i = Math.floor(k)
  return mix(stops[i], stops[i + 1], k - i)
}

// -------------------------------------------------------------- plaza slabs
// Two blind critiques called the old plaza a blocker, for two different reasons
// that pull in opposite directions: the field was "functionally a solid colour"
// (luminance sigma 0.9 over a 60x36 patch) AND it was "a mechanical
// checkerboard of two flat values with perfectly straight unbroken joints".
//
// The fix is not smaller pavers. A first pass at half-metre pavers on a running
// bond fixed the flatness and produced herringbone brickwork — the reference
// plaza is plainly LARGE cast slabs, about 1.6 m, laid square, with joints you
// can barely find. So: keep the reference's slab size and square bond, and put
// all the variation inside the slab instead of into the grid. Sigma comes from
// per-slab ramp colour, metre-scale weathering, aggregate grain and wear —
// none of which draw a line.
export const PLAZA_TILE = 8
const PLAZA_N = 5 // 1.6 m slabs

/** Shared slab walk, so albedo / height / roughness agree cell for cell. */
function pavers(S, fn) {
  const cell = S / PLAZA_N
  for (let j = 0; j < PLAZA_N; j++) {
    for (let i = 0; i < PLAZA_N; i++) fn(i * cell, j * cell, cell, i, j)
  }
}

export function plazaMap() {
  return cached('plaza', () => {
    const S = 1024
    const [c, x] = canvas(S, S)
    // grout only a half-stop off the slab: in the reference you have to look
    // for the joint, and a saturated dark line is what drew the grid before
    x.fillStyle = mix(C.plaza, C.plazaGrout, 0.55)
    x.fillRect(0, 0, S, S)

    const gap = S / PLAZA_N / 42
    pavers(S, (px, py, cell, i, j) => {
      // Per-paver colour off the palette ramp rather than an HSL jitter. HSL
      // jitter moves value and hue together, which the eye reads as noise; a
      // ramp keeps every paver a plausible member of the same batch of
      // concrete while still giving neighbours a visible step.
      const t = rnd(i, j, 3) * 0.85 + rnd(i, j, 17) * 0.15
      x.fillStyle = rampAt(RAMP.plaza, 0.5 + t * 0.5)
      x.fillRect(px + gap, py + gap, cell - gap * 2, cell - gap * 2)

      // Chipped edge: a hair of the paler stop along two sides, so the arris
      // catches light the way a cast edge does instead of ending in a hard line.
      x.fillStyle = `rgba(255,255,255,${0.05 + rnd(i, j, 19) * 0.06})`
      x.fillRect(px + gap, py + gap, cell - gap * 2, Math.max(1, cell * 0.045))
      x.fillRect(px + gap, py + gap, Math.max(1, cell * 0.045), cell - gap * 2)
    })

    // Broad tonal patches across many pavers: sun-bleaching and damp. Concrete
    // weathers at a scale much larger than its own joints, and without this the
    // only structure in the field is the grid itself.
    for (let k = 0; k < 22; k++) {
      x.save()
      x.globalAlpha = 0.05 + rnd(k, 4, 31) * 0.06
      x.fillStyle = rnd(k, 5, 32) > 0.5 ? C.plazaWarm : C.plazaCool
      x.beginPath()
      x.ellipse(
        rnd(k, 6, 33) * S, rnd(k, 7, 34) * S,
        S * (0.06 + rnd(k, 8, 35) * 0.16), S * (0.05 + rnd(k, 9, 36) * 0.14),
        rnd(k, 10, 37) * 3, 0, 6.3,
      )
      x.fill()
      x.restore()
    }

    mottle(x, S, S, 11, 0.05, 7)
    grain(x, S, S, 26000, 0.05, 41)

    // Hairline cracks that wander across joints, plus a few short ones that do
    // not — real cracking mostly follows the joint but does not respect it.
    x.strokeStyle = 'rgba(150,96,80,0.20)'
    x.lineWidth = 1.1
    for (let k = 0; k < 9; k++) crack(x, rnd(k, 1, 21) * S, rnd(k, 2, 22) * S, 9, 34, 23 + k)
    return tex(c)
  })
}

/**
 * Paver relief. Only the joints and the chamfer carry any height — the face is
 * left flat so the normal map does not fight the roughness map for the same
 * specular break-up.
 */
export function plazaNormal() {
  return cached('plazaN', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    x.fillStyle = '#000'
    x.fillRect(0, 0, S, S)
    const gap = S / PLAZA_N / 16
    pavers(S, (px, py, cell) => {
      // a soft-shouldered pad: bright core falling off to the joint
      const g = x.createLinearGradient(px, py, px, py + cell)
      g.addColorStop(0, '#e6e6e6')
      g.addColorStop(0.06, '#ffffff')
      g.addColorStop(0.94, '#ffffff')
      g.addColorStop(1, '#e6e6e6')
      x.fillStyle = g
      roundRect(x, px + gap, py + gap, cell - gap * 2, cell - gap * 2, cell * 0.02)
      x.fill()
    })
    grain(x, S, S, 9000, 0.10, 43)
    return normalFrom(c, 0.55)
  })
}

/**
 * Where the floor is polished and where it is not. three reads roughness out of
 * the GREEN channel, so this is painted as greyscale. Traffic polishes concrete
 * — the open plaza is smoother than the joints and the sheltered corners — and
 * that variation is most of what makes a specular sweep look like a surface
 * rather than a gradient.
 */
export function plazaRough() {
  return cached('plazaR', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    x.fillStyle = '#b4b4b4' // base: fairly rough sealed slab
    x.fillRect(0, 0, S, S)
    // polished wear pools
    for (let k = 0; k < 16; k++) {
      x.save()
      x.globalAlpha = 0.5
      x.filter = 'blur(14px)'
      x.fillStyle = '#6e6e6e'
      x.beginPath()
      x.ellipse(
        rnd(k, 0, 51) * S, rnd(k, 1, 52) * S,
        S * (0.05 + rnd(k, 2, 53) * 0.13), S * (0.04 + rnd(k, 3, 54) * 0.11),
        rnd(k, 4, 55) * 3, 0, 6.3,
      )
      x.fill()
      x.restore()
    }
    // joints stay rough — grout never polishes
    const gap = S / PLAZA_N / 16
    x.fillStyle = '#dcdcdc'
    pavers(S, (px, py, cell) => {
      x.fillRect(px, py, cell, gap * 2)
      x.fillRect(px, py, gap * 2, cell)
    })
    grain(x, S, S, 14000, 0.16, 57)
    const t = tex(c)
    t.colorSpace = THREE.NoColorSpace // data, not colour
    return t
  })
}

// -------------------------------------------------------------- masonry
export const MASONRY_TILE_X = 1.25
export const MASONRY_TILE_Y = 0.6

function masonryHeight() {
  const S = 512
  const H = 256
  const [c, x] = canvas(S, H)
  x.fillStyle = '#000'
  x.fillRect(0, 0, S, H)
  const rows = 8
  const cols = 8
  const bh = H / rows
  const bw = S / cols
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * (bw / 2)
    for (let i = -1; i <= cols; i++) {
      const bx = i * bw + off + 2.5
      const by = j * bh + 2.5
      // The face falls off toward its own edges rather than sitting flat, so
      // the block reads as a slightly pillowed cast unit and the mortar joint
      // gets a real shoulder instead of a cliff.
      const g = Math.round(200 + rnd(i, j, 5) * 42)
      const grd = x.createRadialGradient(
        bx + bw / 2, by + bh / 2, bh * 0.1,
        bx + bw / 2, by + bh / 2, bh * 0.75,
      )
      grd.addColorStop(0, `rgb(${g},${g},${g})`)
      grd.addColorStop(1, `rgb(${Math.round(g * 0.72)},${Math.round(g * 0.72)},${Math.round(g * 0.72)})`)
      x.fillStyle = grd
      roundRect(x, bx, by, bw - 5, bh - 5, 3.5)
      x.fill()
    }
  }
  grain(x, S, H, 6000, 0.10, 109)
  return c
}

function roundRect(x, px, py, w, h, r) {
  x.beginPath()
  x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r)
  x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r)
  x.arcTo(px, py, px + w, py, r)
  x.closePath()
}

export function masonryMap() {
  return cached('masonry', () => {
    const S = 512
    const H = 256
    const [c, x] = canvas(S, H)
    x.fillStyle = C.wallDark
    x.fillRect(0, 0, S, H)
    const rows = 8
    const cols = 8
    const bh = H / rows
    const bw = S / cols
    for (let j = 0; j < rows; j++) {
      const off = (j % 2) * (bw / 2)
      for (let i = -1; i <= cols; i++) {
        // Five discrete stops, chosen per block, rather than a two-colour lerp:
        // the reference's wall is visibly built from a MIX of bricks — a few
        // pink, a few cold, the odd near-neutral — and it is that per-block hue
        // spread, not value noise, that stops it reading as one dyed surface.
        const pick = rnd(i, j, 7)
        const stops = RAMP.masonryBlocks
        let col = stops[Math.min(stops.length - 1, Math.floor(pick * stops.length))]
        col = mix(col, rnd(i, j, 8) > 0.5 ? C.wallPink : C.wallCool, rnd(i, j, 9) * 0.3)
        x.fillStyle = col
        roundRect(x, i * bw + off + 2.5, j * bh + 2.5, bw - 5, bh - 5, 3.5)
        x.fill()

        // worn top arris — the face a passer-by brushes and the sun hits square
        x.fillStyle = `rgba(255,255,255,${0.06 + rnd(i, j, 11) * 0.07})`
        x.fillRect(i * bw + off + 3.5, j * bh + 3.5, bw - 7, 2)
        // damp shadow line where the block sits on its mortar bed
        x.fillStyle = 'rgba(70,52,110,0.16)'
        x.fillRect(i * bw + off + 3.5, j * bh + bh - 5.5, bw - 7, 2)

        // the occasional chipped corner, so the coursing is not machine-perfect
        if (rnd(i, j, 13) > 0.86) {
          x.fillStyle = 'rgba(240,228,250,0.5)'
          x.beginPath()
          x.arc(i * bw + off + bw - 5, j * bh + bh - 5, 2.4 + rnd(i, j, 14) * 2, 0, 6.3)
          x.fill()
        }
      }
    }
    mottle(x, S, H, 31, 0.045, 5)
    grain(x, S, H, 7000, 0.045, 101)
    return tex(c)
  })
}

/** Mortar depth + per-block roughness. Glazed brick, chalky mortar. */
export function masonryRough() {
  return cached('masonryR', () => {
    const S = 256
    const H = 128
    const [c, x] = canvas(S, H)
    x.fillStyle = '#e0e0e0' // mortar: chalky
    x.fillRect(0, 0, S, H)
    const rows = 8
    const cols = 8
    const bh = H / rows
    const bw = S / cols
    for (let j = 0; j < rows; j++) {
      const off = (j % 2) * (bw / 2)
      for (let i = -1; i <= cols; i++) {
        const g = Math.round(120 + rnd(i, j, 103) * 70)
        x.fillStyle = `rgb(${g},${g},${g})`
        roundRect(x, i * bw + off + 1.5, j * bh + 1.5, bw - 3, bh - 3, 2)
        x.fill()
      }
    }
    grain(x, S, H, 4000, 0.14, 107)
    const t = tex(c)
    t.colorSpace = THREE.NoColorSpace
    return t
  })
}

export function masonryNormal() {
  return cached('masonryN', () => normalFrom(masonryHeight(), 1.6))
}

// -------------------------------------------------------------- pale stone
export const STONE_TILE = 3

export function stoneMap() {
  return cached('stone', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    x.fillStyle = C.stoneDark
    x.fillRect(0, 0, S, S)
    const N = 4
    const cell = S / N
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        x.fillStyle = rampAt(RAMP.stone, 0.4 + rnd(i, j, 13) * 0.6)
        roundRect(x, i * cell + 2, j * cell + 2, cell - 4, cell - 4, 5)
        x.fill()
        // limestone caps take a polish on the nose and stay matte in the joint
        x.fillStyle = `rgba(255,255,255,${0.05 + rnd(i, j, 14) * 0.05})`
        x.fillRect(i * cell + 4, j * cell + 4, cell - 8, 2.5)
      }
    }
    mottle(x, S, S, 47, 0.04, 7)
    // fine fossil/shell speckle — the thing that says "cut stone" at 2 m
    for (let k = 0; k < 900; k++) {
      const v = rnd(k, 0, 111)
      x.fillStyle = v > 0.55 ? 'rgba(255,250,244,0.5)' : 'rgba(150,120,110,0.28)'
      const px = rnd(k, 1, 112) * S
      const py = rnd(k, 2, 113) * S
      x.beginPath()
      x.ellipse(px, py, 1 + v * 2.2, 1 + v * 1.4, v * 3, 0, 6.3)
      x.fill()
    }
    grain(x, S, S, 12000, 0.04, 114)
    return tex(c)
  })
}

/** Cut-stone relief: joints, a rounded nose, and the speckle. */
export function stoneNormal() {
  return cached('stoneN', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    x.fillStyle = '#000'
    x.fillRect(0, 0, S, S)
    const N = 4
    const cell = S / N
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const grd = x.createLinearGradient(0, j * cell, 0, j * cell + cell)
        grd.addColorStop(0, '#d0d0d0')
        grd.addColorStop(0.15, '#ffffff')
        grd.addColorStop(0.85, '#ffffff')
        grd.addColorStop(1, '#d0d0d0')
        x.fillStyle = grd
        roundRect(x, i * cell + 2, j * cell + 2, cell - 4, cell - 4, 6)
        x.fill()
      }
    }
    grain(x, S, S, 16000, 0.13, 117)
    return normalFrom(c, 1.0)
  })
}

// -------------------------------------------------------------- ramp plywood
// The halfpipe is a built wooden ramp, not park stone. Ramp UVs are authored
// in plaza units (1 repeat = 8m), so a repeat of 4 is baked into the texture:
// one canvas spans 2m of world and its 7 planks land at ~0.29m — sheet-ply
// scale. Planks run along canvas y, which is v = the riding direction.
export function woodMap() {
  return cached('wood', () => {
    const S = 1024
    const [c, x] = canvas(S, S)
    x.fillStyle = C.plyDark
    x.fillRect(0, 0, S, S)
    const N = 7
    const pw = S / N
    for (let i = 0; i < N; i++) {
      // sample the low-mid band: the full ramp let half the planks land on
      // plyPale and the sunlit surface washed out to near-white
      x.fillStyle = rampAt(RAMP.wood, 0.12 + rnd(i, 0, 21) * 0.5)
      x.fillRect(i * pw + 1.5, 0, pw - 3, S)
      // long grain: wavy near-vertical strokes, dark and pale passes
      for (let k = 0; k < 26; k++) {
        const v = rnd(i, k, 22)
        x.strokeStyle =
          v > 0.6 ? `rgba(130,92,58,${0.05 + v * 0.07})` : `rgba(255,242,218,${0.04 + v * 0.05})`
        x.lineWidth = 0.8 + v * 1.4
        let gx = i * pw + 3 + rnd(i, k, 23) * (pw - 6)
        x.beginPath()
        x.moveTo(gx, -8)
        for (let yy = 0; yy <= S; yy += 32) {
          gx += (noise(i * 9 + k, yy / 90, 24) - 0.5) * 7
          gx = Math.max(i * pw + 2.5, Math.min((i + 1) * pw - 2.5, gx))
          x.lineTo(gx, yy)
        }
        x.stroke()
      }
      // the odd knot, drawn as nested rings so the grain reads as real wood
      if (rnd(i, 9, 25) > 0.45) {
        const kx = i * pw + pw * (0.25 + rnd(i, 10, 26) * 0.5)
        const ky = rnd(i, 11, 27) * S
        for (let r = 5; r > 0; r--) {
          x.strokeStyle = `rgba(112,76,46,${0.1 + r * 0.035})`
          x.lineWidth = 1.1
          x.beginPath()
          x.ellipse(kx, ky, r * 2.1, r * 3.4, 0, 0, 6.3)
          x.stroke()
        }
      }
      // staggered butt seams where sheets meet end to end
      const sy = ((i * 0.37 + rnd(i, 12, 28) * 0.3) % 1) * S
      x.fillStyle = 'rgba(105,72,45,0.45)'
      x.fillRect(i * pw + 1.5, sy, pw - 3, 2)
    }
    // seam shadows between planks (i=0 and i=N clip at the edges, so the tile
    // carries half a seam on each side and wraps clean)
    x.fillStyle = 'rgba(105,72,45,0.5)'
    for (let i = 0; i <= N; i++) x.fillRect(i * pw - 1, 0, 2, S)
    mottle(x, S, S, 31, 0.045, 5)
    grain(x, S, S, 9000, 0.03, 33)
    return tex(c, 4)
  })
}

// The riding surface: pale blue pressed sheet laid over the ply. 1m panels
// (2 seams per 2m repeat), faint mottle and grain so the specular never sits
// uniform across the face — a flat colour here reads as plastic.
export function hpSurfMap() {
  return cached('hpSurf', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    x.fillStyle = C.hpSurf
    x.fillRect(0, 0, S, S)
    // per-panel tone shift, quartered like the sheets themselves
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        x.fillStyle = rnd(i, j, 51) > 0.5 ? C.hpSurf : C.hpSurfDark
        x.globalAlpha = 0.25 + rnd(i, j, 52) * 0.2
        x.fillRect((i * S) / 2, (j * S) / 2, S / 2, S / 2)
      }
    x.globalAlpha = 1
    mottle(x, S, S, 61, 0.035, 6)
    // panel seams both ways — sheet edges, drawn soft
    x.fillStyle = 'rgba(90,120,140,0.3)'
    for (const p of [0, S / 2]) {
      x.fillRect(p, 0, 1.5, S)
      x.fillRect(0, p, S, 1.5)
    }
    grain(x, S, S, 6000, 0.025, 63)
    return tex(c, 4)
  })
}

/** Plank relief: seams read as grooves, grain as faint long ridges. */
function plyHeight() {
  return cached('plyH', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    const N = 7
    const pw = S / N
    for (let i = 0; i < N; i++) {
      // slight per-plank height offset so adjacent sheets never sit dead flush
      const g = 190 + Math.floor(rnd(i, 0, 41) * 40)
      x.fillStyle = `rgb(${g},${g},${g})`
      x.fillRect(i * pw, 0, pw, S)
      for (let k = 0; k < 18; k++) {
        const v = rnd(i, k, 42)
        x.strokeStyle = `rgba(${v > 0.5 ? 255 : 90},${v > 0.5 ? 255 : 90},${v > 0.5 ? 255 : 90},0.10)`
        x.lineWidth = 1
        let gx = i * pw + 2 + rnd(i, k, 43) * (pw - 4)
        x.beginPath()
        x.moveTo(gx, 0)
        for (let yy = 0; yy <= S; yy += 24) {
          gx += (noise(i * 7 + k, yy / 70, 44) - 0.5) * 4
          x.lineTo(gx, yy)
        }
        x.stroke()
      }
    }
    x.fillStyle = '#000'
    for (let i = 0; i <= N; i++) x.fillRect(i * pw - 1, 0, 2, S)
    grain(x, S, S, 8000, 0.08, 45)
    return c
  })
}

export function woodNormal() {
  return cached('woodN', () => {
    const t = normalFrom(plyHeight(), 1.3)
    t.repeat.set(4, 4)
    return t
  })
}

/**
 * Varnished-board gloss, off the same height field the normal uses — so the
 * ridge the normal bumps up is the ridge the roughness makes glossier, and a
 * seam groove is the dullest thing on the board (dirt collects in it).
 * roughnessMap MULTIPLIES material.roughness, so 255 is "as authored".
 */
export function woodRough() {
  return cached('woodR', () => {
    const src = plyHeight()
    const S = src.width
    const [c, ctx] = canvas(S, S)
    const img = src.getContext('2d').getImageData(0, 0, S, S)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      // 190 is the height field's plank floor: a board sits a touch glossier
      // than authored (235), a grain crest glossier again, and a seam — which
      // is black in the height — clamps back to full authored roughness.
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, 235 - (d[i] - 190) * 0.5))
    }
    ctx.putImageData(img, 0, 0)
    const t = tex(c, 4)
    t.colorSpace = THREE.NoColorSpace
    return t
  })
}

// -------------------------------------------------------------- bowl
// The bowl is the hero surface of an entire camera framing, and it was the one
// place the painted "sheen" ellipses actively hurt: a broad highlight baked into
// the ALBEDO cannot move when the camera does, so it reads as a smear on the
// paint rather than as a reflection. Every highlight in here is gone; the sheen
// is now the material's own specular against a baked local probe (see
// BowlProbe in Skatepark.jsx). What stays in the albedo is only what is really
// painted on a pool: plaster, tile, wear and dirt.
export const BOWL_TILE = 5

// The bottom quarter of every bowl map is the flat, and the whole flat samples
// its single bottom row — so nothing in this band may vary along x, or the UV
// convergence at the bowl's centre smears it into a starburst.
const BOWL_FLAT = 0.76

export function bowlMap() {
  return cached('bowl', () => {
    const S = 1024
    const [c, x] = canvas(S, S)
    x.fillStyle = C.bowl
    x.fillRect(0, 0, S, S)

    // Troweled plaster: broad soft swirls at a much larger scale than the
    // grain, which is what a steel trowel actually leaves behind. Confined to
    // the transition for the reason above.
    for (let k = 0; k < 26; k++) {
      x.save()
      x.beginPath()
      x.rect(0, 0, S, S * BOWL_FLAT)
      x.clip()
      x.globalAlpha = 0.05 + rnd(k, 0, 61) * 0.05
      x.strokeStyle = rnd(k, 5, 66) > 0.45 ? C.bowlSheen : C.bowlShade
      x.lineWidth = 10 + rnd(k, 6, 67) * 26
      x.lineCap = 'round'
      x.filter = 'blur(7px)'
      crack(x, rnd(k, 1, 62) * S, rnd(k, 2, 63) * S * BOWL_FLAT, 5, 60 + rnd(k, 3, 64) * 70, 68 + k)
      x.restore()
    }

    // Waterline band at the coping (v = 1 -> top of the canvas): the tile
    // course every pool carries, and the one piece of hard detail that says
    // this is a pool and not a dish.
    const band = S * 0.075
    for (let i = 0; i < 26; i++) {
      const w = S / 26
      x.fillStyle = rampAt(RAMP.bowl, 0.62 + rnd(i, 0, 71) * 0.24)
      x.fillRect(i * w + 1, 3, w - 2, band - 6)
    }
    x.fillStyle = 'rgba(255,255,255,0.12)'
    x.fillRect(0, 3, S, 3)
    x.fillStyle = 'rgba(60,40,110,0.18)'
    x.fillRect(0, band - 3, S, 3)

    // Urethane skid marks: dark, and running AROUND the bowl rather than in
    // random directions, because that is the line wheels actually take.
    x.save()
    x.beginPath()
    x.rect(0, band, S, S * BOWL_FLAT - band)
    x.clip()
    x.globalAlpha = 0.15
    x.strokeStyle = '#4a3570'
    x.lineCap = 'round'
    for (let k = 0; k < 14; k++) {
      x.lineWidth = 2 + rnd(k, 7, 74) * 5
      const y0 = band + rnd(k, 9, 76) * (S * BOWL_FLAT - band)
      x.beginPath()
      x.moveTo(rnd(k, 8, 75) * S, y0)
      let py = y0
      for (let s = 0; s < 6; s++) {
        py += (rnd(k + s, 3, 78) - 0.5) * 14
        x.lineTo(rnd(k, 8, 75) * S + (s + 1) * 62, py)
      }
      x.stroke()
    }
    x.restore()

    // Dirt settling into the deep end, easing to a flat uniform value by the
    // time it reaches the flat's row.
    const dirt = x.createLinearGradient(0, S * 0.42, 0, S * BOWL_FLAT)
    dirt.addColorStop(0, 'rgba(58,44,96,0)')
    dirt.addColorStop(1, 'rgba(58,44,96,0.24)')
    x.fillStyle = dirt
    x.fillRect(0, S * 0.42, S, S * BOWL_FLAT - S * 0.42)

    mottle(x, S, S * BOWL_FLAT, 71, 0.04, 4)
    grain(x, S, S * BOWL_FLAT, 14000, 0.04, 79)

    // The flat itself: one uniform value, isotropic only.
    x.fillStyle = mix(C.bowl, '#3a2c60', 0.24)
    x.fillRect(0, S * BOWL_FLAT, S, S * (1 - BOWL_FLAT))
    return tex(c)
  })
}

/** Plaster relief: the swirl, the tile joints in the band, nothing else. */
export function bowlNormal() {
  return cached('bowlN', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    x.fillStyle = '#808080'
    x.fillRect(0, 0, S, S)
    x.save()
    x.beginPath()
    x.rect(0, 0, S, S * BOWL_FLAT)
    x.clip()
    x.filter = 'blur(5px)'
    x.lineCap = 'round'
    for (let k = 0; k < 26; k++) {
      x.strokeStyle = rnd(k, 5, 81) > 0.5 ? '#a4a4a4' : '#5c5c5c'
      x.lineWidth = 8 + rnd(k, 6, 82) * 20
      crack(x, rnd(k, 1, 83) * S, rnd(k, 2, 84) * S * BOWL_FLAT, 5, 50 + rnd(k, 3, 85) * 60, 86 + k)
    }
    x.restore()
    // tile joints in the waterline band
    const band = S * 0.075
    x.strokeStyle = '#303030'
    x.lineWidth = 2
    for (let i = 0; i <= 26; i++) {
      const px = (i * S) / 26
      x.beginPath()
      x.moveTo(px, 2)
      x.lineTo(px, band - 2)
      x.stroke()
    }
    grain(x, S, S * BOWL_FLAT, 11000, 0.08, 89)
    x.fillStyle = '#808080'
    x.fillRect(0, S * BOWL_FLAT, S, S * (1 - BOWL_FLAT))
    return normalFrom(c, 0.9)
  })
}

/**
 * The bowl's whole look lives here. Plaster polished by decades of wheels is
 * genuinely glossy in the transition and duller on the flat and up in the tile
 * band, and that CONTRAST is what makes a reflection read as a curved surface.
 * A uniform roughness gives you a gradient; a varying one gives you a bowl.
 */
export function bowlRough() {
  return cached('bowlR', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    // mid-glossy plaster
    x.fillStyle = '#5a5a5a'
    x.fillRect(0, 0, S, S)
    // tile band is the glossiest thing in the park
    x.fillStyle = '#2e2e2e'
    x.fillRect(0, 0, S, S * 0.075)
    // the flat collects dust and is duller
    const g = x.createLinearGradient(0, S * 0.45, 0, S * BOWL_FLAT)
    g.addColorStop(0, 'rgba(150,150,150,0)')
    g.addColorStop(1, 'rgba(150,150,150,0.75)')
    x.fillStyle = g
    x.fillRect(0, S * 0.45, S, S * BOWL_FLAT - S * 0.45)
    // polished ride lines through the transition
    x.save()
    x.beginPath()
    x.rect(0, 0, S, S * BOWL_FLAT)
    x.clip()
    x.globalAlpha = 0.55
    x.filter = 'blur(10px)'
    x.strokeStyle = '#343434'
    x.lineWidth = 26
    x.lineCap = 'round'
    for (let k = 0; k < 10; k++) {
      crack(x, rnd(k, 0, 91) * S, S * (0.12 + rnd(k, 1, 92) * 0.45), 4, 80, 93 + k)
    }
    x.restore()
    grain(x, S, S * BOWL_FLAT, 12000, 0.13, 97)
    x.fillStyle = '#8c8c8c'
    x.fillRect(0, S * BOWL_FLAT, S, S * (1 - BOWL_FLAT))
    const t = tex(c)
    t.colorSpace = THREE.NoColorSpace
    return t
  })
}

// -------------------------------------------------------------- soil / grass
// One repeat per ~11 world units (parkGeometry sets the UVs), so at 256 px the
// old map had 23 px to the metre and its "tonal patches" were 1-3 m dark
// blotches — a smear with holes in it, which is exactly how it read. At 1024
// there are 93 px to the metre, which is enough to draw actual blades.
export function grassMap() {
  return cached('grass', () => {
    const S = 1024
    const [c, x] = canvas(S, S)
    x.fillStyle = mix(C.leafDark, C.shrub, 0.45)
    x.fillRect(0, 0, S, S)

    // Very broad, very low-contrast drift: mown grass does vary across a lawn,
    // but by a few percent, not by the near-black patches this used to draw.
    for (let k = 0; k < 18; k++) {
      x.save()
      x.globalAlpha = 0.05 + rnd(k, 6, 71) * 0.05
      x.filter = 'blur(40px)'
      x.fillStyle = rnd(k, 7, 72) > 0.5 ? C.shrub : C.leafDark
      x.beginPath()
      x.ellipse(
        rnd(k, 9, 74) * S, rnd(k, 10, 75) * S,
        S * (0.09 + rnd(k, 11, 76) * 0.18), S * (0.07 + rnd(k, 12, 77) * 0.15),
        rnd(k, 13, 78) * 3, 0, 6.3,
      )
      x.fill()
      x.restore()
    }

    // Blades. Short directional strokes at roughly 40 mm — small enough that
    // they never resolve individually from the game camera, dense enough that
    // the field has a texture instead of a blur. This is the whole difference
    // between "green plane" and "grass".
    for (let k = 0; k < 26000; k++) {
      const v = rnd(k, 0, 81)
      const col = mix(
        rnd(k, 6, 88) > 0.72 ? C.leafLight : C.shrub,
        C.leafDark,
        rnd(k, 7, 89) * 0.8,
      )
      x.strokeStyle = col
      x.lineWidth = 1 + (v > 0.8 ? 1 : 0)
      const px = rnd(k, 1, 82) * S
      const py = rnd(k, 2, 83) * S
      // blades lean with a shared prevailing direction plus scatter
      const a = -1.2 + (rnd(k, 5, 86) - 0.5) * 1.5
      const len = 3 + rnd(k, 3, 84) * 5
      x.beginPath()
      x.moveTo(px, py)
      x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len)
      x.stroke()
    }

    // a scatter of tiny wildflowers, as the reference's landscaping has
    for (let k = 0; k < 220; k++) {
      x.fillStyle = rnd(k, 0, 121) > 0.5 ? C.flowerWhite : C.flowerYellow
      x.beginPath()
      x.arc(rnd(k, 1, 122) * S, rnd(k, 2, 123) * S, 1.4 + rnd(k, 3, 124) * 1.6, 0, 6.3)
      x.fill()
    }

    mottle(x, S, S, 91, 0.04, 9)
    return tex(c)
  })
}

/** Blade-scale relief, so the lawn catches the key light unevenly. */
export function grassNormal() {
  return cached('grassN', () => {
    const S = 512
    const [c, x] = canvas(S, S)
    x.fillStyle = '#808080'
    x.fillRect(0, 0, S, S)
    for (let k = 0; k < 9000; k++) {
      const v = rnd(k, 0, 131)
      x.strokeStyle = v > 0.5 ? '#c8c8c8' : '#404040'
      x.lineWidth = 1
      const px = rnd(k, 1, 132) * S
      const py = rnd(k, 2, 133) * S
      const a = -1.2 + (rnd(k, 5, 136) - 0.5) * 1.5
      const len = 2 + rnd(k, 3, 134) * 4
      x.beginPath()
      x.moveTo(px, py)
      x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len)
      x.stroke()
    }
    return normalFrom(c, 0.8)
  })
}

// -------------------------------------------------------------- baked AO
// A single top-down occlusion map for the plaza. Every solid that stands on the
// ground stamps a soft dark footprint, so walls, ledges and planters read as
// genuinely bedded into the concrete instead of floating on it. Applied as an
// aoMap (channel 1), so it only attenuates ambient/environment light.
export const AO_BOUNDS = { minX: -46, maxX: 46, minZ: -46, maxZ: 44 }

// the dog's coat ------------------------------------------------------------
// dog_compressed.glb ships ONE map (baseColor) and no normal or roughness, so
// the coat is a flat wash of Tripo's baked light and the surface returns the
// same specular everywhere — the same "reads as plastic" failure the concrete
// grain above exists to fix, on the thing the camera is always pointed at.
// Both maps are generated from a single fibre height field so the crest a
// normal bumps up is also the crest the roughness makes glossier.
//
// They ride the ALBEDO's uv channel, which is Tripo's atlas — arbitrary islands
// with no relation to the coat's real flow. That is fine and it is why the
// fibre is drawn as a noise-curled field rather than a combed direction: at
// FUR_TILE across an atlas the strands are sub-millimetre and read as surface,
// not as a hairstyle. An island seam is a direction change, not a visible line.
const FUR_TILE = 7

function furHeight() {
  const S = 256
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, S, S)
  ctx.lineCap = 'round'
  for (let k = 0; k < 3000; k++) {
    const x = rnd(k, 0, 91) * S
    const y = rnd(k, 1, 91) * S
    // curled by a low-frequency field so the coat gets partings and cowlicks
    // instead of a combed grid, which resolves into moire at chase distance
    const a = Math.PI / 2 + (noise((x / S) * 3, (y / S) * 3, 7) - 0.5) * 1.7
    const len = 5 + rnd(k, 2, 91) * 9
    const v = rnd(k, 3, 91)
    ctx.strokeStyle = v > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1 + (v > 0.82 ? 1 : 0)
    // a stroke crossing an edge has to continue on the far side or the tile
    // seams show as a band of bald coat. Only the wraps that can actually
    // reach are drawn — drawing all nine unconditionally doubles the alpha of
    // every interior stroke and costs 9x.
    const dx = x < len ? S : x > S - len ? -S : 0
    const dy = y < len ? S : y > S - len ? -S : 0
    for (let i = 0; i < 4; i++) {
      if (i & 1 && !dx) continue
      if (i & 2 && !dy) continue
      const ox = i & 1 ? dx : 0
      const oy = i & 2 ? dy : 0
      ctx.beginPath()
      ctx.moveTo(x + ox, y + oy)
      ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len)
      ctx.stroke()
    }
  }
  return c
}

export function dogNormal() {
  return cached('dogNormal', () => {
    const t = normalFrom(furHeight(), 1.3)
    t.repeat.set(FUR_TILE, FUR_TILE)
    return t
  })
}

export function dogRough() {
  return cached('dogRough', () => {
    const src = furHeight()
    const S = src.width
    const [c, ctx] = canvas(S, S)
    const img = src.getContext('2d').getImageData(0, 0, S, S)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      // roughnessMap MULTIPLIES material.roughness, so 255 is "as authored".
      // Fibre crests come down to ~0.86 of it — a lit strand is glossier than
      // the undercoat between them, and that difference is the whole point.
      d[i] = d[i + 1] = d[i + 2] = 255 - (d[i] - 128) * 0.55
    }
    ctx.putImageData(img, 0, 0)
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(FUR_TILE, FUR_TILE)
    t.anisotropy = 4
    return t
  })
}

export function parkAOMap(rects) {
  return cached('parkAO', () => {
    const S = 1024
    const B = AO_BOUNDS
    const [c, x] = canvas(S, S)
    x.fillStyle = '#ffffff'
    x.fillRect(0, 0, S, S)
    const sx = S / (B.maxX - B.minX)
    const sz = S / (B.maxZ - B.minZ)

    x.fillStyle = '#000000'
    for (const r of rects) {
      const h = Math.min(2.4, r.height)
      if (h < 0.16) continue
      for (const [spread, alpha] of [
        [0.55 + h * 0.85, 0.2 + h * 0.13],
        [0.16 + h * 0.16, 0.24 + h * 0.14],
      ]) {
        x.save()
        x.filter = `blur(${(spread * sx).toFixed(2)}px)`
        x.globalAlpha = Math.min(0.6, alpha)
        x.translate((r.x - B.minX) * sx, (r.z - B.minZ) * sz)
        x.rotate(-r.rot)
        const w = (r.hw * 2 + 0.22) * sx
        const d = (r.hd * 2 + 0.22) * sz
        x.fillRect(-w / 2, -d / 2, w, d)
        x.restore()
      }
    }

    const t = new THREE.CanvasTexture(c)
    t.flipY = false
    t.channel = 1
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    t.anisotropy = 4
    return t
  })
}
