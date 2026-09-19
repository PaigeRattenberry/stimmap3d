/**
 * tooling/video/record.mjs — author-time demo-video recorder (NEVER on the live path).
 *
 * Drives the *shipped* StimMap3D production preview with headed Playwright and screen-records the
 * guided walkthrough — the same 10-beat sequence the in-app Guided Tour dispatches (they are kept
 * in lockstep). The output is a local artifact: the `.webm`/`.mp4` are git-ignored (see
 * .gitignore) and never committed; the script prints their path.
 *
 * WHY HEADED: the hero is a live three.js / R3F WebGL scene. Headless Chromium frequently falls back
 * to software GL and captures a BLACK canvas, so we launch `headless: false` on a machine with a GPU.
 * (If a future headless run is unavoidable, add --enable-unsafe-swiftshader / --use-gl=angle /
 * --ignore-gpu-blocklist — but headed is the reliable path and the one this script takes.)
 *
 * CONTRACT (see README.md): the production preview must already be serving. Run, from the repo root:
 *     npm run build ; npm run preview        # → http://localhost:4173
 * then, from tooling/video:
 *     npm run record                          # → writes output/stimmap3d-demo.{webm,mp4}
 * Override the target with TARGET_URL=... if preview runs on another port.
 *
 * After the context closes (which flushes the .webm), the script transcodes to H.264 .mp4 via ffmpeg
 * when ffmpeg is on PATH — for broad playback — and leaves the .webm as the always-present fallback.
 */
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Resolve an ffmpeg binary. On Windows, ffmpeg is often installed user-scope (WinGet), which is on the
 * INTERACTIVE-shell PATH but not always on a spawned Node process's PATH — so fall back to the known
 * WinGet package location before giving up. Uses only `readdirSync`/`existsSync` (no `fs.globSync`,
 * which needs Node ≥ 22) so it runs on any Node the repo supports. Returns 'ffmpeg' | absolute | null.
 */
function resolveFfmpeg() {
  if (spawnSync('ffmpeg', ['-version'], { shell: true }).status === 0) return 'ffmpeg'
  const pkgRoot = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')
  try {
    for (const pkg of readdirSync(pkgRoot)) {
      if (!pkg.startsWith('Gyan.FFmpeg')) continue
      // …/Gyan.FFmpeg_*/ffmpeg-<ver>-full_build/bin/ffmpeg.exe
      for (const sub of readdirSync(join(pkgRoot, pkg))) {
        const exe = join(pkgRoot, pkg, sub, 'bin', 'ffmpeg.exe')
        if (existsSync(exe) && spawnSync(exe, ['-version']).status === 0) return exe
      }
    }
  } catch {
    /* Packages dir absent (non-WinGet box) — fall through to null. */
  }
  return null
}

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'output')
const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:4173'
const SIZE = { width: 1920, height: 1080 }

// Per-beat dwell (ms): long enough to read the card at demo pace. Rather than hard-code the beat
// COUNT (which would silently drift from TOUR_STEPS), the tour loop below walks beats until the
// tour ends and applies a DEFAULT dwell, with a few title-matched overrides — so adding or removing a
// beat needs no change here. Keep these matchers loose (substring, case-insensitive).
const DEFAULT_DWELL_MS = 7200
const DWELL_OVERRIDES = [
  [/not for clinical use/i, 6000], // the opening frame just sets the honest stage — a touch shorter
  [/what it gets wrong/i, 8000], // the Methods closer earns an extra beat to read
]
const MAX_BEATS = 40 // runaway guard: the tour is ~10 beats; this only stops an unexpected loop

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fail early with a clear message if the preview server isn't up (the #1 setup mistake). */
async function assertPreviewUp() {
  try {
    const res = await fetch(TARGET_URL, { method: 'GET' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    console.error(
      `\n✗ Could not reach the production preview at ${TARGET_URL}.\n` +
        `  Start it first (from the repo root):\n` +
        `      npm run build ; npm run preview\n` +
        `  or set TARGET_URL to the right port.\n  (${err.message})\n`,
    )
    process.exit(1)
  }
}

/**
 * Delete Playwright's randomly-named leftovers from `output/`.
 *
 * `recordVideo.dir` writes one random-named .webm per run and only the final rename turns the CURRENT
 * one into `stimmap3d-demo.webm`; any run that dies before that rename orphans its file. `output/` is
 * git-ignored, so nothing else ever prunes it and failed 1920x1080 captures silently pile up. Sweeping
 * on START (rather than on exit) bounds the directory to one orphan — the run in flight — without
 * touching the file this run is about to produce. The STABLE name is deliberately spared, so a failed
 * re-record never destroys the last good recording.
 */
function pruneOrphanRecordings() {
  try {
    for (const f of readdirSync(OUT_DIR)) {
      if (f.endsWith('.webm') && f !== 'stimmap3d-demo.webm') rmSync(join(OUT_DIR, f), { force: true })
    }
  } catch {
    /* Best-effort housekeeping — a locked or vanished orphan must never fail the capture. */
  }
}

async function main() {
  await assertPreviewUp()
  mkdirSync(OUT_DIR, { recursive: true })
  pruneOrphanRecordings()

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: SIZE },
    // A steady default so `prefers-reduced-motion`-independent transitions read the same each run.
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  /** Non-fatal problems (a missed quiz option, a skipped step) — surfaced together at the end. */
  const warnings = []

  // EVERYTHING scripted runs inside this try. Playwright only finalises the screencast when the
  // CONTEXT closes, so an uncaught locator timeout mid-narration (a slow first GLB decode, a renamed
  // button) would otherwise abort with the ~100 s recording still unwritten — leaving a truncated,
  // unplayable GUID-named .webm and forcing a full re-run. The finally always closes the context, so a
  // partial capture is on disk and still gets named/transcoded below; the error is re-thrown at the
  // end so a short video is never silently passed off as the finished deliverable.
  let captureError = null
  try {
    console.log(`→ navigating to ${TARGET_URL}`)
    await page.goto(TARGET_URL, { waitUntil: 'networkidle' })

    // Wait for the WebGL scene: the <canvas> must exist AND the GLB mesh + first solve must settle so
    // the cortex heatmap is actually painted (not a blank canvas) before we start narrating. Anchor on
    // the visible tour CTA (the app has mounted) — NOT the disclaimer text, whose first DOM match is the
    // print-only <PrintSummary> copy (display:none on screen), which never becomes "visible".
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByRole('button', { name: /take the guided tour/i }).waitFor({ state: 'visible', timeout: 15_000 })
    await sleep(3500) // let the heatmap decode + the first field solve land

    // Dismiss the first-run "Getting started" card so it doesn't cover the scene during the tour.
    const dismiss = page.getByRole('button', { name: /dismiss the getting-started card/i })
    if (await dismiss.count()) {
      await dismiss.click()
      await sleep(600)
    }

    // ── Pre-tour: prove the scene is LIVE (not a static frame) before the guided narration ──
    // (a) Cycle presets so the cortex heatmap visibly relocates between targets — live recompute.
    await sleep(1500)
    for (const name of ['F4', 'Cz', 'F3']) {
      const radio = page.getByRole('radio', { name: new RegExp(`^${name}$`, 'i') })
      if (await radio.count()) {
        await radio.first().check().catch(() => {})
        await sleep(2200)
      }
    }
    // (b) A short orbit drag across the canvas — unmistakably a live 3-D WebGL scene, not an image.
    const box = await page.locator('canvas').first().boundingBox()
    if (box) {
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(cx - i * 9, cy + Math.sin(i / 2) * 6)
        await sleep(45)
      }
      await page.mouse.up()
      await sleep(1500)
    }

    // ── The guided tour: the beat spine ──
    console.log('→ opening the guided tour')
    await page.getByRole('button', { name: /take the guided tour/i }).click()
    await page.getByRole('dialog').waitFor({ timeout: 10_000 })

    // Walk the tour to its end, deriving the beat count from the live UI (Next present → more beats;
    // only the last beat shows Done). This stays correct if the TOUR_STEPS beat list changes length.
    for (let i = 0; i < MAX_BEATS; i++) {
      const progress = (await page.locator('.guided-tour__progress').textContent().catch(() => '')) ?? ''
      const title = (await page.locator('.guided-tour__title').textContent().catch(() => '')) ?? ''
      console.log(`   ${progress.trim()} — ${title.trim()}`)
      const dwell = DWELL_OVERRIDES.find(([rx]) => rx.test(title))?.[1] ?? DEFAULT_DWELL_MS
      await sleep(dwell)
      const next = page.getByRole('button', { name: /^Next$/ })
      if (await next.count()) {
        await next.click()
      } else {
        // Last beat: end the tour. Guarded like the Next branch — if the closer's label ever changes,
        // the coda below still records instead of the whole capture dying on the final click.
        const done = page.getByRole('button', { name: /^Done$/ })
        if (await done.count()) await done.click()
        else warnings.push('tour closer ("Done") not found — the tour was left open on its last beat')
        break
      }
    }
    await sleep(800)

    // ── Coda: show the actual Methods self-check quiz the closer points at (a shipped surface the tour
    // only references). Answer all four correctly and check, so the "did the honest bits land?" score
    // renders — reinforcing the honesty-gate framing on-camera. (We do NOT click Print handout: it
    // opens a blocking OS print dialog; the tour copy covers the one-pager instead.)
    console.log('→ visiting Methods & Limitations (self-check quiz)')
    await page.goto(`${TARGET_URL}#/methods`, { waitUntil: 'networkidle' })
    const quiz = page.locator('.self-check')
    if (await quiz.count()) {
      await quiz.scrollIntoViewIfNeeded()
      await sleep(2000)
      // Select the CORRECT option in each question by matching its label text (the cited gate answer in
      // SelfCheckQuiz.tsx) — NOT by option index, so a future reorder of the options can't silently make
      // the closing shot show a wrong score. Each matcher is scoped to its `.self-check__q` fieldset, so
      // it can't match the hidden print-only <PrintSummary> copy (which would stall on actionability).
      // Matchers are dash-agnostic (`.*` spans the em-dash) and paired to the questions in file order.
      const CORRECT = [
        /relative units.*not calibrated/i, // Units
        /induced-field magnitude.*not neural activation/i, // Magnitude
        /synthetic, generated from published summary statistics/i, // Data
        /relative to sham.*must be converted/i, // OR vs %
      ]
      const fieldsets = quiz.locator('.self-check__q')
      const qCount = await fieldsets.count()
      // A miss here is REPORTED, not swallowed: these matchers duplicate SelfCheckQuiz.tsx's literal
      // option text, so a copy edit there silently unpicks an answer. With Playwright's 30 s default each
      // miss would also burn half a minute of tape on a frozen, unanswered quiz — and since
      // `Check answers` is `disabled={!allAnswered}`, the closing shot would read "Answer all 4
      // questions, then check." instead of the score while the script still printed its ✓ line. A short
      // timeout keeps the dead air to seconds, and the warning tells the author to re-sync the matchers.
      for (let i = 0; i < qCount && i < CORRECT.length; i++) {
        // Clicking the <label> toggles its associated radio (htmlFor). Scoped to this fieldset only.
        try {
          await fieldsets.nth(i).getByText(CORRECT[i]).first().click({ timeout: 5000 })
        } catch {
          warnings.push(
            `quiz Q${i + 1}: no option matched ${CORRECT[i]} — re-sync these matchers with SelfCheckQuiz.tsx`,
          )
        }
        await sleep(550)
      }
      const check = quiz.getByRole('button', { name: /check answers/i })
      if ((await check.count()) && (await check.first().isEnabled())) {
        await check
          .first()
          .click({ timeout: 5000 })
          .catch(() => warnings.push('quiz: "Check answers" did not accept the click'))
        await sleep(3800) // hold on the "You answered N of 4 correctly" score line
      } else {
        warnings.push('quiz: "Check answers" stayed disabled — the closing score frame was NOT recorded')
      }
    }
    await sleep(1200)
  } catch (err) {
    captureError = err
    console.error('\n✗ capture aborted mid-script — salvaging the partial recording:\n', err)
  } finally {
    // Closing the context is what flushes the .webm to disk, so it must happen on BOTH paths.
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  const rawPath = await page.video()?.path()
  if (!rawPath) {
    console.error('✗ no screencast was produced (the context recorded nothing).')
    throw captureError ?? new Error('no video file was written')
  }
  let webmPath = join(OUT_DIR, 'stimmap3d-demo.webm')
  // Give the capture its stable name. Windows `rename` onto an existing target throws, so the prior
  // recording is cleared first — but that clear can ITSELF throw EBUSY/EPERM when the old file is
  // still open in a media player, which is exactly the record → review → re-record loop README.md
  // documents. Neither step is worth losing a good capture over: on failure keep the raw random-named
  // file and report THAT path, so the author still ends up with a playable video.
  try {
    if (webmPath !== rawPath) rmSync(webmPath, { force: true })
    renameSync(rawPath, webmPath)
  } catch (err) {
    webmPath = rawPath
    console.warn(
      `⚠ could not rename to stimmap3d-demo.webm (${err.code ?? err.message}) — is the previous\n` +
        `  recording still open in a player? Keeping the raw capture instead.`,
    )
  }
  console.log(`\n✓ recorded ${webmPath}`)

  if (consoleErrors.length) {
    console.warn(`⚠ ${consoleErrors.length} console error(s) during capture:`)
    for (const e of consoleErrors) console.warn(`   ${e}`)
  } else {
    console.log('✓ no console errors during capture')
  }

  if (warnings.length) {
    console.warn(`⚠ ${warnings.length} scripted step(s) did not land — WATCH THE VIDEO before shipping:`)
    for (const w of warnings) console.warn(`   ${w}`)
  }

  // Transcode to H.264 .mp4 for broad playback when ffmpeg is available; keep the .webm regardless.
  const ffmpeg = resolveFfmpeg()
  if (ffmpeg) {
    const mp4Path = join(OUT_DIR, 'stimmap3d-demo.mp4')
    console.log(`→ transcoding to .mp4 (H.264) via ${ffmpeg} …`)
    const r = spawnSync(
      ffmpeg,
      ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', mp4Path],
      { stdio: 'inherit' },
    )
    if (r.status === 0) console.log(`✓ wrote ${mp4Path}`)
    else console.warn('⚠ ffmpeg transcode failed; the .webm is still available.')
  } else {
    console.log('ℹ ffmpeg not found — keeping the .webm only.')
  }

  // The partial capture is on disk and named, but the run did NOT complete the script: fail loudly, so
  // a truncated video is never mistaken for the finished deliverable.
  if (captureError) throw captureError
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
