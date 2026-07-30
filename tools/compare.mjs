#!/usr/bin/env node
// Blind A/B sheet builder. Composites a reference frame and one of our captures
// into a single side-by-side PNG with neutral "A" / "B" labels, in an order the
// critic cannot infer, and writes the key to a sibling file the critic is not
// given. Rendering is done in the same headless Chrome the captures use, so
// there is no image dependency to install.
//
//   node tools/compare.mjs <refImage> <ourImage> <outDir> [keyFile]
//
// Writes <outDir>/sheet.png (show this to the critic) and the key
// ({"ours":"A"|"B"}) to `keyFile`, defaulting to <outDir>/key.json. Pass a path
// outside <outDir> when the critic must not be able to stumble onto it.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash, randomInt } from 'node:crypto'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { chromePath, CHROME_ARGS } from './chrome.mjs'

const [refPath, ourPath, outDir, keyArg] = process.argv.slice(2)
if (!refPath || !ourPath || !outDir) {
  console.error('usage: compare.mjs <refImage> <ourImage> <outDir> [keyFile]')
  process.exit(2)
}
for (const p of [refPath, ourPath]) {
  if (!existsSync(p)) {
    console.error(`missing image: ${p}`)
    process.exit(2)
  }
}


const dataUri = async (p) =>
  `data:image/png;base64,${(await readFile(p)).toString('base64')}`

const oursIsA = randomInt(2) === 0
const [left, right] = oursIsA ? [ourPath, refPath] : [refPath, ourPath]

const W = 2400
const H = 780

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:#15161a;width:${W}px;height:${H}px;
    font:600 22px/1 ui-sans-serif,system-ui,sans-serif;color:#e8e6e1}
  .row{display:flex;gap:14px;padding:14px;box-sizing:border-box;height:100%}
  .cell{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
  .tag{letter-spacing:.14em}
  .frame{flex:1;min-height:0;background:#000;border-radius:6px;overflow:hidden;
    display:flex;align-items:center;justify-content:center}
  img{max-width:100%;max-height:100%;object-fit:contain;display:block}
</style>
<div class="row">
  <div class="cell"><div class="tag">A</div>
    <div class="frame"><img src="${await dataUri(left)}"></div></div>
  <div class="cell"><div class="tag">B</div>
    <div class="frame"><img src="${await dataUri(right)}"></div></div>
</div>`

await mkdir(outDir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: await chromePath(),
  headless: 'shell',
  args: CHROME_ARGS,
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.screenshot({ path: path.join(outDir, 'sheet.png') })
} finally {
  await browser.close()
}

const keyFile = keyArg || path.join(outDir, 'key.json')
await mkdir(path.dirname(keyFile), { recursive: true })
await writeFile(
  keyFile,
  JSON.stringify({
    ours: oursIsA ? 'A' : 'B',
    reference: oursIsA ? 'B' : 'A',
    // so a stale sheet can never be scored against a fresh key
    sig: createHash('sha1').update(await readFile(ourPath)).digest('hex').slice(0, 12),
  }),
)

console.log(path.join(outDir, 'sheet.png'))
