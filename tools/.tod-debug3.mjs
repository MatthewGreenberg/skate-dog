import { spawn } from 'node:child_process'
import net from 'node:net'
import puppeteer from 'puppeteer-core'
import { chromePath, CHROME_ARGS } from './chrome.mjs'
const PORT = 3210, HOST = '127.0.0.1'
const listening = (p) => new Promise((res) => { const s = net.connect(p, HOST); s.on('connect', () => (s.destroy(), res(true))); s.on('error', () => res(false)) })
let server = null
if (!(await listening(PORT))) {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', HOST], { cwd: process.cwd(), stdio: 'ignore', detached: true })
  const t0 = Date.now(); while (Date.now() - t0 < 90000 && !(await listening(PORT))) await new Promise((r) => setTimeout(r, 200))
}
const browser = await puppeteer.launch({ executablePath: await chromePath(), headless: 'shell', args: [...CHROME_ARGS, '--window-size=1400,900'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  const logs = []
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e)))
  await page.goto(`http://${HOST}:${PORT}/?edit`, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.ed-panel', { timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2000))
  const out = await page.evaluate(async () => {
    const m = await import('/src/game/level/levelEdits.js')
    const v0 = m.levelVersion()
    let notified = 0
    const un = m.subscribeLevel(() => notified++)
    let err = null
    try { m.setScene({ time: 'night' }) } catch (e) { err = String(e && e.stack || e) }
    un()
    return { v0, v1: m.levelVersion(), notified, err, scene: { ...m.SCENE }, canUndo: m.canUndo() }
  })
  await new Promise((r) => setTimeout(r, 1000))
  const dom = await page.evaluate(() => {
    const time = [...document.querySelectorAll('.ed-look')].find((r) => r.textContent.startsWith('Time'))
    return { timeOnIndex: time && [...time.querySelectorAll('button')].findIndex((b) => b.className.includes('on')) }
  })
  console.log(JSON.stringify({ out, dom, logs }, null, 2))
} finally {
  await browser.close()
  if (server) { try { process.kill(-server.pid) } catch { /* gone */ } }
}
