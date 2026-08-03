// The boy's shirt and sleeves ship in the SAME orange family as the dog's coat
// and the warm plaza — the rider dissolves into the unit he is riding. A
// `material.color` tint cannot fix that: colour multiplies, and orange times
// blue is dark grey, not teal. So the albedo is hue-rotated once at load.
//
// Pure pixel maths, no DOM, so recolor.check.js can measure it in plain node.

// Below this chroma a pixel has no meaningful hue — rotating the cream trim and
// the near-white highlights just tints them at random.
const GREY = 0.06

// Rotate every chromatic pixel of an RGBA byte buffer by `deg`, in place.
// Chroma and lightness are preserved exactly, so the texture's baked shading
// survives; only the hue moves.
export function hueShift(data, deg) {
  const turn = (((deg / 360) % 1) + 1) % 1
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const c = max - min
    if (c < GREY) continue
    let h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4
    h = ((h / 6 + turn) % 1) * 6
    const x = c * (1 - Math.abs((h % 2) - 1))
    const m = (max + min) / 2 - c / 2
    const k = Math.floor(h)
    const nr = k === 0 || k === 5 ? c : k === 1 || k === 4 ? x : 0
    const ng = k === 0 || k === 3 ? x : k === 1 || k === 2 ? c : 0
    const nb = k === 2 || k === 5 ? x : k === 3 || k === 4 ? c : 0
    data[i] = (nr + m) * 255
    data[i + 1] = (ng + m) * 255
    data[i + 2] = (nb + m) * 255
  }
  return data
}
