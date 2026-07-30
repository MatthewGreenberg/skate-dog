// Which cached Chrome for Testing the capture tools drive.
//
// NOT simply "the newest build". 148.0.7778.97's headless shell never fires
// ResizeObserver: zero callbacks for any element, on any page, headed or
// headless. react-use-measure therefore never reports a size, and
// @react-three/fiber's Canvas only builds its renderer once
// `containerRect.width > 0 && containerRect.height > 0` — so the canvas stays
// at its 300x150 default, useFrame never runs, and the page sits there
// rendering nothing with no error on the console. A ten-line R3F scene
// reproduces it, so nothing about the game is involved.
//
// Measured over the cached builds, frames rendered in 7s on a bare R3F scene:
//   131.0.6778.204   412
//   141.0.7390.78    813
//   143.0.7499.40    822
//   143.0.7499.192   794
//   148.0.7778.97      0   <- broken
//
// So: prefer the newest build that is not known-bad, and fail loudly rather
// than silently timing out if only bad builds are present.

import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const BROKEN = [/^mac_arm-148\./]

const REL = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

export async function chromePath() {
  const dir = path.join(process.env.HOME, '.cache/puppeteer/chrome')
  if (!existsSync(dir)) {
    throw new Error('no cached Chrome for Testing in ~/.cache/puppeteer/chrome')
  }
  const all = (await readdir(dir)).filter((d) => d.startsWith('mac'))
  // numeric sort on the version so 143.0.7499.192 beats 143.0.7499.40
  const ver = (d) => (d.match(/[\d.]+$/)?.[0] ?? '0').split('.').map(Number)
  const usable = all
    .filter((d) => !BROKEN.some((re) => re.test(d)))
    .filter((d) => existsSync(path.join(dir, d, REL)))
    .sort((a, b) => {
      const [x, y] = [ver(a), ver(b)]
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
      }
      return 0
    })
  if (!usable.length) {
    throw new Error(
      `every cached Chrome build is known-broken for ResizeObserver (${all.join(', ')}). ` +
        'Install another with: npx @puppeteer/browsers install chrome@143',
    )
  }
  return path.join(dir, usable.at(-1), REL)
}

/** Launch flags shared by every capture tool. */
export const CHROME_ARGS = [
  '--no-sandbox',
  // headless needs an explicit GL backend or WebGL falls back to SwiftShader
  '--use-angle=metal',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
]
