// One-off: does clicking the Night chip in ?edit change state + pixels?
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = '/Users/mattgreenberg/dev/demos/skate-dog-2'
const { chromePath, CHROME_ARGS } = await import(path.join(ROOT, 'tools/chrome.mjs'))
const PORT = 3210
const HOST = '127.0.0.1'
const OUT = '/Users/mattgreenberg/.claude/jobs/981303a9/tmp'

const listening = (port) =>
  new Promise((res) => {
    const s = net.connect(port, HOST)
    s.on('connect', () => (s.destroy(), res(true)))
    s.on('error', () => res(false))
  })

let server = null
if (!(await listening(PORT))) {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', HOST], {
    cwd: ROOT, stdio: 'ignore', detached: true,
  })
  const t0 = Date.now()
  while (Date.now() - t0 < 90_000 && !(await listening(PORT))) await new Promise((r) => setTimeout(r, 200))
}

const browser = await puppeteer.launch({
  executablePath: await chromePath(),
  headless: 'shell',
  args: [...CHROME_ARGS, '--window-size=1400,900'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  const logs = []
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text()))
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e)))
  await page.goto(`http://${HOST}:${PORT}/?edit`, { waitUntil: 'networkidle0', timeout: 60_000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.ed-panel', { timeout: 30_000 })
  await new Promise((r) => setTimeout(r, 2500)) // let the park finish mounting
  await page.screenshot({ path: path.join(OUT, 'tod-before.png') })

  const found = await page.evaluate(() => {
    const b = document.querySelector('button[title="Night"]')
    if (!b) return { found: false, chips: [...document.querySelectorAll('.ed-swatches button')].map((x) => x.title) }
    b.click()
    return { found: true }
  })
  await new Promise((r) => setTimeout(r, 2000))
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('skatedog.level')
    return raw ? JSON.parse(raw).scene : null
  })
  await page.screenshot({ path: path.join(OUT, 'tod-after.png') })
  console.log(JSON.stringify({ found, saved, logs: logs.slice(0, 15) }, null, 2))
} finally {
  await browser.close()
  if (server) { try { process.kill(-server.pid) } catch { /* gone */ } }
}
