/**
 * Author-time generator for the social link-preview card (`web/public/og-image.png`, 1200×630).
 * NEVER on the live path — the committed PNG is the deliverable, referenced by the `og:image` /
 * `twitter:image` tags in `web/index.html`.
 *
 * Why a composed card and not the raw hero screenshot: a link preview is a share artifact, and the
 * persistent gate-(a) banner does not travel into it (the same C2 hazard the PNG export and print
 * one-pager solve by baking the disclaimer in). So the card bakes in the verbatim gate-(a) lead —
 * read straight from `DISCLAIMER_LEAD` in DisclaimerBanner.tsx so it cannot drift — alongside the
 * hero screenshot, whose legend already carries the gate-(e) "relative units · not V/m" label.
 *
 *   cd tooling ; npm run make-og-image
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HERO = resolve(ROOT, 'docs/screenshots/visualizer.png')
const OUT = process.env.STIMMAP_OG_OUTPUT ? resolve(process.env.STIMMAP_OG_OUTPUT) : resolve(ROOT, 'web/public/og-image.png')
const W = 1200
const H = 630

// Single source of the gate-(a) lead (same string the banner, PNG export and print header use).
const bannerSrc = readFileSync(resolve(ROOT, 'web/src/ui/DisclaimerBanner.tsx'), 'utf8')
const lead = bannerSrc.match(/export const DISCLAIMER_LEAD = '([^']+)'/)?.[1]
if (!lead) throw new Error('DISCLAIMER_LEAD not found in DisclaimerBanner.tsx — refusing to emit a card without it')

// App palette (web/src/index.css).
const C = { bg: '#0b1021', fg: '#e8ecf6', muted: '#aab3cc', accent: '#5b8cff', warnBg: '#3a2412', warnFg: '#ffd9a8', warnBorder: '#c9772b', border: '#2a3358' }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const FONT = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`

const HERO_W = 556
const heroMeta = await sharp(HERO).metadata()
const HERO_H = Math.round((heroMeta.height * HERO_W) / heroMeta.width)
const HERO_X = W - HERO_W - 40
const HERO_Y = Math.round((H - HERO_H) / 2)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <text x="56" y="150" font-family="${FONT}" font-size="64" font-weight="700" fill="${C.fg}">StimMap3D</text>
  <text font-family="${FONT}" font-size="30" fill="${C.muted}">
    <tspan x="56" y="210">Interactive 3D rTMS coil targeting</tspan>
    <tspan x="56" y="250">&amp; induced E-field visualizer</tspan>
  </text>
  <text font-family="${FONT}" font-size="22" fill="${C.muted}">
    <tspan x="56" y="316">Drag the coil · live heatmap in relative units</tspan>
    <tspan x="56" y="348">Dose–response panel · every figure cited</tspan>
  </text>
  <rect x="56" y="420" width="536" height="132" rx="12" fill="${C.warnBg}" stroke="${C.warnBorder}" stroke-width="2"/>
  <text x="80" y="468" font-family="${FONT}" font-size="23" font-weight="700" fill="${C.warnFg}">⚠ ${esc(lead)}</text>
  <text font-family="${FONT}" font-size="19" fill="${C.warnFg}">
    <tspan x="80" y="502">Analytical spherical-head approximation (not FEM),</tspan>
    <tspan x="80" y="530">relative units, synthetic outcome data.</tspan>
  </text>
  <rect x="${HERO_X - 1}" y="${HERO_Y - 1}" width="${HERO_W + 2}" height="${HERO_H + 2}" rx="10" fill="none" stroke="${C.border}" stroke-width="2"/>
</svg>`

const hero = await sharp(HERO).resize(HERO_W, HERO_H).png().toBuffer()
await sharp(Buffer.from(svg))
  .composite([{ input: hero, left: HERO_X, top: HERO_Y }])
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile(OUT)

console.log(`wrote ${OUT} (${W}×${H}) with disclaimer: "${lead}"`)
