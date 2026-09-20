/**
 * Production-artifact Chromium regressions. Requires npm ci --prefix tooling/video.
 *
 * By default this serves web/dist from a throwaway loopback server, which checks the ARTIFACT.
 * Set STIMMAP_SMOKE_BASE to an origin (e.g. https://stimmap3d.pages.dev) to run the same checks
 * against a real deployment instead, which additionally exercises what only a host can provide:
 * the _headers rules, the served MIME type of the module worker, and HTTP caching. The local
 * server is then never started, so no build is required. Checks that stub the worker or force
 * WebGL to fail use page-level interception and behave identically either way.
 *
 * STIMMAP_SMOKE_FILTER narrows the run to checks whose name contains it.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright'

const remote = process.env.STIMMAP_SMOKE_BASE?.replace(/\/$/, '')
const dist = resolve('web/dist')
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.glb': 'model/gltf-binary', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' }
const server = remote ? null : createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(dist + sep)) { res.writeHead(403).end(); return }
  try { res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)) }
  catch { res.writeHead(404).end() }
})
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = remote ?? `http://127.0.0.1:${server.address().port}`
console.log(remote ? `Checking deployment ${base}` : `Checking local artifact ${dist}`)
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let passed = 0
const failures = []
async function check(name, test) {
  if (process.env.STIMMAP_SMOKE_FILTER && !name.includes(process.env.STIMMAP_SMOKE_FILTER)) return
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  // Software WebGL and PNG readback on shared CI CPUs can take tens of seconds.
  page.setDefaultTimeout(process.env.CI ? 60000 : 20000)
  try { await test(page, context); console.log('PASS ' + name); passed++ }
  catch (error) {
    console.error('Browser check failed:', name)
    console.error(await page.locator('.share-bar').innerText().catch(() => 'No share toolbar'))
    console.error(error)
    failures.push(name)
  } finally { await context.close() }
}
const metrics = page => page.locator('.field-metrics-card .field-metric__value')
async function ready(page) { await page.waitForFunction(() => [...document.querySelectorAll('.field-metrics-card .field-metric__value')].every(el => /[0-9]/.test(el.textContent)) && document.querySelectorAll('.field-metrics-card .field-metric__value').length === 2) }
async function recordWorker(page, failure) {
  await page.addInitScript((failure) => {
    const Native = window.Worker
    window.__releaseRefs = []
    window.Worker = class extends Native {
      constructor(...args) {
        if (failure === 'startup') throw new Error('Injected startup failure')
        super(...args)
        this.solves = 0
        this.addEventListener('message', event => { if (event.data.type === 'ready') window.__releaseRefs.push(event.data.referencePeak) })
      }
      postMessage(message, ...rest) {
        if (failure === 'timeout' || (failure === 'solve-timeout' && message.type === 'solve')) return
        if (message.type === 'solve') {
          this.solves++
          if (failure === 'message' || (failure === 'later' && this.solves > 1)) {
            queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'Injected computation failure' } })))
            return
          }
        }
        super.postMessage(message, ...rest)
      }
    }
  }, failure)
}
try {
  await check('third-party notices are available without JavaScript', async page => {
    const response = await page.request.get(base + '/THIRD_PARTY_NOTICES.txt')
    assert.equal(response.status(), 200)
    const notice = await response.text()
    for (const expected of ['Niivue', 'Louis Collins', 'react@', 'three@', 'recharts@', 'victory-vendor@', 'Mike Bostock']) assert.ok(notice.includes(expected), expected)
    assert.equal(notice.includes('undefined'), false)
  })
  for (const route of ['methods', 'sources']) await check(route + ' loads without graphics or charts and supports route focus', async page => {
    const requests = []; page.on('request', request => requests.push(request.url()))
    await page.goto(base + '#/' + route)
    await page.locator('main h1').waitFor()
    assert.equal(requests.some(url => /Scene-|VisualizerView-|AnalyticsPanel-|\.glb|efield.worker/.test(url)), false)
    // Chunk NAMES alone can't prove the split: re-importing the scene statically would fold it back
    // into the shared entry and stop emitting a VisualizerView chunk at all. Measure the bytes too,
    // with headroom over the ~270 kB these routes fetch today but far under the 1.75 MB single bundle.
    const jsBytes = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.endsWith('.js')).reduce((n, r) => n + r.decodedBodySize, 0))
    console.log(route + ' initial JS bytes:', jsBytes)
    assert.ok(jsBytes > 0 && jsBytes < 600_000, route + ' fetched ' + jsBytes + ' JS bytes')
    assert.match(await page.title(), route === 'methods' ? /Methods/ : /Sources/)
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('main').evaluate(el => el === document.activeElement), true)
    assert.equal(new URL(page.url()).hash, '#/' + route)
    await page.getByRole('link', { name: 'Visualizer', exact: true }).click()
    await ready(page)
    assert.equal(await page.locator('main').evaluate(el => el === document.activeElement), true)
    assert.match(await page.title(), /Visualizer/)
    await page.goBack()
    await page.locator('main h1').waitFor()
    assert.equal(await page.locator('main').evaluate(el => el === document.activeElement), true)
  })
  await check('reduced-motion keyboard coil and protocol controls remain usable', async page => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(base); await ready(page)
    const control = page.locator('.coil-kbd')
    await control.focus()
    await page.keyboard.press('ArrowRight')
    await ready(page)
    assert.equal(await control.evaluate(el => el === document.activeElement), true)
    const protocol = page.getByRole('group', { name: 'rTMS protocol', exact: true }).getByRole('button').nth(1)
    await protocol.click()
    assert.equal(await protocol.getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: /Take the guided tour/ }).click()
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
  })
  await check('default GLBs, worker, routes, PNG and immediate copy', async page => {
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.goto(base); await ready(page)
    assert.ok((await metrics(page).allTextContents()).every(v => parseFloat(v) > 0))
    // Same JavaScript task: dispatch slider input and click before the 250ms URL debounce.
    await page.evaluate(() => {
      const slider = document.querySelector('input[type=range]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '2')
      slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true }))
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Copy link')).click()
    })
    await page.getByText(/Link copied/).waitFor()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    assert.equal(new URL(copied).searchParams.get('int'), '2')
    assert.match(await page.locator('.share-bar__status').innerText(), /camera view is not included/)
    const download = page.waitForEvent('download').catch(() => null)
    console.log('Clicking initial Export PNG')
    await page.getByRole('button', { name: /Export PNG/ }).click()
    console.log('Initial Export PNG clicked')
    await page.waitForFunction(() => /PNG saved|Scene not ready/.test(document.querySelector('.share-bar__status').textContent))
    console.log('Initial PNG status:', await page.locator('.share-bar__status').innerText())
    assert.equal((await download).suggestedFilename(), 'stimmap3d.png')
    await page.getByRole('link', { name: 'Methods & Limitations', exact: true }).click()
    await page.getByRole('heading', { name: /Methods/ }).first().waitFor()
    await page.getByRole('link', { name: 'Sources', exact: true }).click()
    await page.getByRole('heading', { name: /Sources/ }).first().waitFor()
    assert.deepEqual(errors, [])
  })
  await check('continuous tilt scrub keeps the painted field and metrics, then settles ready', async page => {
    await page.goto(base); await ready(page)
    const frames = await page.evaluate(async () => {
      const slider = [...document.querySelectorAll('input[type=range]')].find(el => el.max === '35')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const out = []
      for (let i = 0; i < 60; i++) {
        set.call(slider, String(5 + (i % 20)))
        slider.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => requestAnimationFrame(() => r()))
        out.push({
          dashed: [...document.querySelectorAll('.field-metrics-card .field-metric__value')].some(el => el.textContent.trim() === '—'),
          loadingOverlay: !!document.querySelector('.solver-status--loading'),
        })
      }
      return out
    })
    assert.equal(frames.filter(f => f.dashed).length, 0, 'metrics blanked during a scrub')
    assert.equal(frames.filter(f => f.loadingOverlay).length, 0, 'loading overlay flashed during a scrub')
    const box = await page.locator('.scene-stage').boundingBox()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export PNG/ }).click()
    await page.waitForFunction(() => /PNG saved|Scene not ready/.test(document.querySelector('.share-bar__status').textContent))
    if (/Scene not ready/.test(await page.locator('.share-bar__status').innerText())) {
      await page.waitForTimeout(3000)
      await page.getByRole('button', { name: /Export PNG/ }).click()
    }
    await download
    assert.ok(box && box.height > 0)
  })
  await check('solver error overlays the scene instead of the page bottom', async page => {
    await recordWorker(page, 'message')
    await page.goto(base); await page.locator('.solver-status[role=alert]').waitFor()
    const stage = await page.locator('.scene-stage').boundingBox()
    const status = await page.locator('.solver-status').boundingBox()
    assert.ok(status.y >= stage.y && status.y + status.height <= stage.y + stage.height, JSON.stringify({ stage, status }))
  })
  await check('malformed shared link recovers through Reset and intensity controls', async page => {
    await page.goto(base + '/?int=0&tilt=1e300&cp=,2,3,4,5,6,-100'); await ready(page)
    assert.equal(await page.locator('input[type=range]').first().inputValue(), '0.2')
    await page.getByRole('button', { name: /Reset/ }).click(); await ready(page)
    const before = await metrics(page).allTextContents()
    await page.locator('input[type=range]').first().fill('2'); await ready(page)
    assert.deepEqual(await metrics(page).allTextContents(), before)
  })
  for (const width of [320, 375, 390]) await check(`tooltips stay within ${width}px viewport, closed and keyboard-open`, async page => {
    await page.setViewportSize({ width, height: 812 }); await page.goto(base); await ready(page)
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(await overflow(), false, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].map(e => ({ tag: e.tagName, cls: e.className, right: e.getBoundingClientRect().right })).filter(e => e.right > innerWidth)), null, 2))
    const terms = page.locator('button.term')
    for (let i = 0; i < await terms.count(); i++) {
      await terms.nth(i).focus()
      const tip = page.locator('.term__tip--open')
      const box = await tip.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, JSON.stringify(box))
      assert.equal(await overflow(), false)
      await page.keyboard.press('Escape')
    }
  })
  await check('fixed reference survives fresh contexts, intensity, custom poses and route remount', async (page, context) => {
    await recordWorker(page)
    await page.goto(base + '/?fixed=1&int=2&preset=Cz'); await ready(page)
    const reference = await page.evaluate(() => window.__releaseRefs.at(-1))
    assert.ok(reference > 0)
    await page.getByRole('link', { name: 'Methods & Limitations', exact: true }).click()
    await page.getByRole('link', { name: 'Visualizer', exact: true }).click(); await ready(page)
    assert.equal(await page.evaluate(() => window.__releaseRefs.at(-1)), reference)
    // Stop the first scene while checking a separate context; software GPUs share CI CPU time.
    await page.getByRole('link', { name: 'Methods & Limitations', exact: true }).click()
    const fresh = await browser.newContext()
    fresh.setDefaultTimeout(process.env.CI ? 60000 : 20000)
    const other = await fresh.newPage()
    try {
      await recordWorker(other)
      await other.goto(base + '/?fixed=1&int=0.5&cp=0,0,100,0,0,0,12'); await ready(other)
      assert.equal(await other.evaluate(() => window.__releaseRefs.at(-1)), reference)
    } finally { await fresh.close() }
  })
  await check('unavailable WebGL has a readable fallback with Methods and Sources usable', async page => {
    await page.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.includes('webgl') ? null : get.call(this, type, ...args) } })
    await page.goto(base); await page.locator('.stage-error').waitFor()
    assert.match(await page.locator('.stage-error').innerText(), /WebGL2 is unavailable/)
    await page.getByRole('button', { name: /Export PNG/ }).click()
    await page.getByText(/Scene not ready yet/).waitFor()
    await page.getByRole('link', { name: 'Methods & Limitations', exact: true }).click()
    await page.getByRole('heading', { name: /Methods/ }).first().waitFor()
  })
  await check('WebGL context loss clears metrics and blocks PNG', async page => {
    await page.goto(base); await ready(page)
    await page.evaluate(() => document.querySelector('.scene-stage canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext())
    await page.locator('.stage-error').waitFor()
    assert.deepEqual(await metrics(page).allTextContents(), ['—', '—'])
  })
  for (const failure of ['startup', 'message', 'later', 'timeout', 'solve-timeout']) await check(`worker ${failure} failure is visible and invalidates output`, async page => {
    await recordWorker(page, failure)
    await page.goto(base)
    if (failure === 'later') { await ready(page); await page.getByRole('slider', { name: /tilt/i }).fill('20') }
    await page.locator('.solver-status[role=alert]').waitFor()
    assert.deepEqual(await metrics(page).allTextContents(), ['—', '—'])
    let downloads = 0; page.on('download', () => downloads++)
    await page.getByRole('button', { name: /Export PNG/ }).click()
    await page.getByText(/Scene not ready yet/).waitFor()
    assert.equal(downloads, 0)
  })
  await check('worker network failure is visible', async page => {
    await page.route('**/efield.worker-*.js', route => route.abort())
    await page.goto(base); await page.locator('.solver-status[role=alert]').waitFor()
    assert.match(await page.locator('.solver-status').innerText(), /failed to load|stopped unexpectedly/)
  })
  await check('all eight heatmap combinations export with truthful scalar/reference labels at 320px', async page => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.addInitScript(() => {
      window.__exportText = []
      const original = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
        if (!this.canvas.isConnected && this.canvas.width > 200) window.__exportText.push({ text, x, y, right: x + this.measureText(text).width, width: this.canvas.width, height: this.canvas.height })
        return original.call(this, text, x, y, ...rest)
      }
    })
    await page.goto(base); await ready(page)
    for (const residual of [false, true]) for (const contour of [false, true]) for (const fixed of [false, true]) {
      await page.getByRole('button', { name: residual ? 'Approx. residual' : 'Induced |E|', exact: true }).click()
      await page.getByRole('checkbox', { name: /iso-contour/ }).setChecked(contour)
      await page.getByRole('checkbox', { name: /fixed-scale/i }).setChecked(fixed)
      const legend = await page.locator('.color-scale').innerText()
      assert.match(legend, residual ? /residual/i : /Induced|Focality/)
      if (contour) assert.match(legend, /absolute maximum/)
      await page.evaluate(() => { window.__exportText = [] })
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: /Export PNG/ }).click(); await download
      const lines = await page.evaluate(() => window.__exportText)
      assert.ok(lines.length >= 2)
      assert.ok(lines.every(line => line.x >= 0 && line.right <= line.width && line.y >= 0 && line.y < line.height), JSON.stringify(lines))
      const caption = lines.map(line => line.text).join(' ')
      assert.match(caption, /not for clinical use/)
      assert.match(caption, residual ? /Radial-removal residual/ : /Induced/)
      assert.match(caption, contour ? /absolute field maximum/ : fixed ? /reference v1/ : /99.9th percentile/)
    }
  })
  await check('mesh load failure has a readable fallback', async page => {
    await page.route('**/models/brain.glb', route => route.abort())
    await page.goto(base); await page.locator('.stage-error').waitFor()
    assert.deepEqual(await metrics(page).allTextContents(), ['—', '—'])
  })
  await check('renderer initialization failure after a successful capability probe has a fallback', async page => {
    await page.addInitScript(() => {
      let count = 0
      const get = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (type.includes('webgl') && ++count > 1) return null
        return get.call(this, type, ...args)
      }
    })
    await page.goto(base); await page.locator('.stage-error').waitFor()
    assert.match(await page.locator('.stage-error').innerText(), /initialization failed/)
  })
  await check('tooltips shift within the visual viewport at 200% and 400% zoom', async (page, context) => {
    await page.goto(base); await ready(page)
    const session = await context.newCDPSession(page)
    for (const pageScaleFactor of [2, 4]) {
      await session.send('Emulation.setPageScaleFactor', { pageScaleFactor })
      await page.locator('button.term').first().focus()
      await page.waitForFunction(() => {
        const box = document.querySelector('.term__tip--open').getBoundingClientRect()
        const viewport = visualViewport
        return box.left >= viewport.offsetLeft && box.right <= viewport.offsetLeft + viewport.width
      })
      await page.keyboard.press('Escape')
      await page.locator('button.term').first().blur()
    }
  })
  console.log(`${passed} production-browser checks passed`)
  assert.equal(failures.length, 0, `Failed browser checks: ${failures.join("; ")}`)
} finally { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)) }
