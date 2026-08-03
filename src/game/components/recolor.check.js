// node src/game/components/recolor.check.js
// hueShift is the whole reason the rider stops reading as part of the dog, and
// a hue bug is smooth, finite and plausible — the shirt just comes out a
// slightly different warm. So measure the hue, not the pixels.
import assert from 'node:assert'
import { hueShift } from './recolor.js'

const hue = (r, g, b) => {
  const max = Math.max(r, g, b)
  const c = max - Math.min(r, g, b)
  if (c < 1) return -1
  const h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4
  return h * 60
}
const px = (...rgb) => Uint8ClampedArray.from([...rgb, 255])

// The shirt's orange (h~24) has to land in the cyan/teal band.
const shirt = hueShift(px(240, 110, 40), 168)
assert(hue(...shirt) > 170 && hue(...shirt) < 205, `shirt hue ${hue(...shirt)}`)

// Chroma and lightness are the texture's baked shading — the rotation may not
// touch either, or the garment flattens out.
const before = px(240, 110, 40)
const lum = (a) => (Math.max(a[0], a[1], a[2]) + Math.min(a[0], a[1], a[2])) / 2
const chr = (a) => Math.max(a[0], a[1], a[2]) - Math.min(a[0], a[1], a[2])
assert(Math.abs(lum(shirt) - lum(before)) <= 2, 'lightness moved')
assert(Math.abs(chr(shirt) - chr(before)) <= 2, 'chroma moved')

// The shoes' orange (hue 25, measured off the map) has to land on red, not on
// a red-orange that still reads as part of the dog.
const shoe = hueShift(px(203, 101, 26), -28)
assert(hue(...shoe) > 350 || hue(...shoe) < 4, `shoe hue ${hue(...shoe)}`)

// Cream trim and near-white highlights stay neutral.
const cream = hueShift(px(246, 243, 238), 168)
assert.deepStrictEqual([...cream], [246, 243, 238, 255], 'grey rotated')

// A full turn is identity — catches a sector-index off-by-one that a single
// 168 degree sample can sit inside.
for (let r = 0; r < 256; r += 37) {
  for (let g = 0; g < 256; g += 41) {
    for (let b = 0; b < 256; b += 43) {
      const out = hueShift(px(r, g, b), 360)
      for (let i = 0; i < 3; i++) {
        assert(Math.abs(out[i] - [r, g, b][i]) <= 2, `360deg moved ${r},${g},${b} -> ${[...out]}`)
      }
    }
  }
}

// Alpha is untouched (the shirt map has none, but a future one might).
assert.strictEqual(hueShift(px(240, 110, 40), 90)[3], 255)

console.log('recolor: ok')
