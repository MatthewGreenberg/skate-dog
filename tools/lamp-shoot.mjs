#!/usr/bin/env node
// Captures tools/lamp-preview.html at each sculpt stage for the img2threejs
// pass reviews. Usage: node tools/lamp-shoot.mjs <outDir> [stage ...]
// Assumes a static server on :4321 serving the repo root.
import { mkdir } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
import { chromePath, CHROME_ARGS } from './chrome.mjs'

const [outDir, ...stageArgs] = process.argv.slice(2)
const stages = stageArgs.length ? stageArgs : ['0', '1', '2', '3', '4']
await mkdir(outDir, { recursive: true })

const browser = await puppeteer.launch({ executablePath: await chromePath(), args: CHROME_ARGS, headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 512, height: 768 })
for (const s of stages) {
  await page.goto(`http://localhost:4321/tools/lamp-preview.html?stage=${s}&cb=${Date.now()}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction('window.__previewReady === true', { timeout: 10000 })
  await page.screenshot({ path: `${outDir}/lamp-stage${s}.png` })
  console.log(`${outDir}/lamp-stage${s}.png`)
}
await browser.close()
