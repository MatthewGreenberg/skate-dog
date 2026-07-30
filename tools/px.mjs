#!/usr/bin/env node
// Sample average colour in small patches of a PNG, by fractional coordinate.
//
//   node tools/px.mjs shots/t3-bowl.png open,0.62,0.88,14 wallbase,0.11,0.40,5
//
// Prints rgb + HSL per named patch. Exists because "does the frame have contact
// shading" is a measurement, not an opinion — and because every acceptance
// target in palette.js's LIGHT.target is written in these units.

import { readFile } from 'node:fs/promises'
import zlib from 'node:zlib'

const [file, ...patches] = process.argv.slice(2)
if (!file || !patches.length) {
  console.error('usage: px.mjs <png> <name,u,v,radiusPx>...')
  process.exit(2)
}

// Minimal PNG reader: 8-bit RGB/RGBA, non-interlaced — which is what Chrome
// screenshots are. No dependency for something this small.
function decodePNG(buf) {
  let p = 8
  const idat = []
  let w = 0
  let h = 0
  let colorType = 6
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8) throw new Error('only 8-bit PNGs')
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNGs unsupported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : null
  if (!ch) throw new Error(`unsupported colour type ${colorType}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(w * h * ch)
  const stride = w * ch
  let q = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[q++]
    const line = raw.subarray(q, q + stride)
    q += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 255
    }
  }
  return { w, h, ch, data: out }
}

const hsl = (r, g, b) => {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const mx = Math.max(R, G, B)
  const mn = Math.min(R, G, B)
  const l = (mx + mn) / 2
  const d = mx - mn
  if (!d) return [0, 0, Math.round(l * 100)]
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  let hh
  if (mx === R) hh = ((G - B) / d + (G < B ? 6 : 0)) / 6
  else if (mx === G) hh = ((B - R) / d + 2) / 6
  else hh = ((R - G) / d + 4) / 6
  return [Math.round(hh * 360), Math.round(s * 100), Math.round(l * 100)]
}

const img = decodePNG(await readFile(file))
console.log(`${file}  ${img.w}x${img.h}`)
for (const spec of patches) {
  const [name, u, v, rad = 6] = spec.split(',')
  const cx = Math.round(Number(u) * img.w)
  const cy = Math.round(Number(v) * img.h)
  const r = Number(rad)
  let R = 0
  let G = 0
  let B = 0
  let n = 0
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue
      const i = (y * img.w + x) * img.ch
      R += img.data[i]
      G += img.data[i + 1]
      B += img.data[i + 2]
      n++
    }
  }
  const [r8, g8, b8] = [R / n, G / n, B / n].map(Math.round)
  const [hh, ss, ll] = hsl(r8, g8, b8)
  console.log(
    `  ${name.padEnd(16)} rgb(${String(r8).padStart(3)},${String(g8).padStart(3)},${String(b8).padStart(3)})` +
      `  hsl ${String(hh).padStart(3)} ${String(ss).padStart(3)}% ${String(ll).padStart(3)}%`,
  )
}
