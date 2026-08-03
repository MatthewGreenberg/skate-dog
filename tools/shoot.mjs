#!/usr/bin/env node
// Deterministic headless captures of the game's authored photo poses.
//
//   node tools/shoot.mjs                    -> every pose into shots/
//   node tools/shoot.mjs bowl plaza         -> just those poses
//   node tools/shoot.mjs --tag before bowl  -> shots/before-bowl.png
//
// Reuses a dev server on PORT if one is already listening, otherwise starts
// (and stops) its own. Exits non-zero and prints the page's console errors if a
// pose fails to render, so a failed build never passes as "looks fine".

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath, CHROME_ARGS } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Its own port on purpose: a dev server the user is driving must never be
// competed for, and vite binds ::1 only by default so the host is pinned too.
const PORT = Number(process.env.SHOT_PORT || 3210)
const HOST = '127.0.0.1'
const OUT = path.join(ROOT, 'shots')
const W = 1600
const H = 1000
const ALL = ['plaza', 'bowl', 'hero', 'props', 'grove', 'deck', 'pipe', 'bench']

const argv = process.argv.slice(2)
let tag = ''
const poses = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--tag') tag = argv[++i]
  else poses.push(argv[i])
}
const shots = poses.length ? poses : ALL
const bad = shots.filter((s) => !ALL.includes(s))
if (bad.length) {
  console.error(`unknown pose(s): ${bad.join(', ')} — known: ${ALL.join(', ')}`)
  process.exit(2)
}


const listening = (port) =>
  new Promise((res) => {
    const s = net.connect(port, HOST)
    s.on('connect', () => (s.destroy(), res(true)))
    s.on('error', () => res(false))
  })

async function waitForPort(port, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await listening(port)) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

async function main() {
  await mkdir(OUT, { recursive: true })

  let server = null
  if (!(await listening(PORT))) {
    server = spawn(
      'npx',
      ['vite', '--port', String(PORT), '--strictPort', '--host', HOST],
      { cwd: ROOT, stdio: 'ignore', detached: true },
    )
    if (!(await waitForPort(PORT, 90_000))) {
      try { process.kill(-server.pid) } catch { /* already gone */ }
      throw new Error('dev server never came up')
    }
  }

  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: 'shell',
    args: [...CHROME_ARGS, `--window-size=${W},${H}`],
  })

  const written = []
  const failures = []
  try {
    for (const pose of shots) {
      const page = await browser.newPage()
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 })
      const logs = []
      page.on('console', (m) => m.type() === 'error' && logs.push(m.text()))
      page.on('pageerror', (e) => logs.push(String(e)))
      try {
        await page.goto(`http://${HOST}:${PORT}/?shot=${pose}${process.env.SHOT_EXTRA || ''}`, {
          waitUntil: 'networkidle0',
          timeout: 60_000,
        })
        await page.waitForFunction('window.__shotReady === true', { timeout: 60_000 })
        // a few more frames so post-processing history settles
        await new Promise((r) => setTimeout(r, 600))
        const file = path.join(OUT, `${tag ? `${tag}-` : ''}${pose}.png`)
        await page.screenshot({ path: file })
        written.push(file)
      } catch (e) {
        failures.push({ pose, error: String(e), logs: logs.slice(0, 12) })
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
    if (server) { try { process.kill(-server.pid) } catch { /* already gone */ } }
  }

  await writeFile(
    path.join(OUT, 'last-run.json'),
    JSON.stringify({ tag, written, failures }, null, 2),
  )
  for (const f of written) console.log(`ok   ${path.relative(ROOT, f)}`)
  for (const f of failures) {
    console.error(`FAIL ${f.pose}: ${f.error}`)
    for (const l of f.logs) console.error(`     ${l}`)
  }
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
