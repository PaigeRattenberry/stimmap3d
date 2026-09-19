// @vitest-environment node
// Reads committed repo files at run time, so it needs Node globals (see disclaimerLayer.test.ts).
/// <reference types="node" />
/**
 * Pre-deploy artifact guards: the link-preview tags in index.html and the Cloudflare
 * Pages `_headers` file. Neither is exercised by any render test, and both fail silently in
 * production — a relative og:image yields a blank preview, and an `immutable` rule on an unhashed
 * path pins stale files in visitors' caches.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DISCLAIMER_LEAD } from './ui/DisclaimerBanner'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const indexHtml = read('../index.html')

/** content="…" of the first <meta property|name="key">, or undefined. */
function meta(key: string): string | undefined {
  const re = new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`, 's')
  return indexHtml.match(re)?.[1]
}

describe('index.html link-preview tags', () => {
  it('declares the Open Graph + Twitter card tags', () => {
    for (const key of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt', 'twitter:card']) {
      expect(meta(key), key).toBeTruthy()
    }
    expect(meta('twitter:card')).toBe('summary_large_image')
  })

  it('uses absolute https URLs on one origin (crawlers do not resolve relative og:image)', () => {
    const url = new URL(meta('og:url')!)
    const image = new URL(meta('og:image')!)
    expect(url.protocol).toBe('https:')
    expect(image.origin).toBe(url.origin)
    expect(indexHtml).toContain(`<link rel="canonical" href="${url.href}" />`)
  })

  it('keeps the non-clinical disclaimer in the preview text (gate (a) travels with the share)', () => {
    expect(meta('og:description')).toMatch(/not for clinical use/i)
    expect(meta('og:image:alt')).toContain(DISCLAIMER_LEAD)
  })

  it('points og:image at a committed 1200×630 PNG matching the declared size', () => {
    const path = new URL(meta('og:image')!).pathname
    const file = new URL(`../public${path}`, import.meta.url)
    expect(existsSync(file)).toBe(true)
    const png = readFileSync(file)
    // PNG signature, then the IHDR chunk: width/height are big-endian uint32 at bytes 16 and 20.
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(Number(meta('og:image:width')))
    expect(png.readUInt32BE(20)).toBe(Number(meta('og:image:height')))
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
  })
})

describe('public/_headers (Cloudflare Pages)', () => {
  const headers = read('../public/_headers')
  /** path pattern → header lines, parsed per the Pages format (unindented path, indented headers). */
  const rules = new Map<string, string[]>()
  let current: string | null = null
  for (const line of headers.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) rules.set((current = line.trim()), [])
    else if (current) rules.get(current)!.push(line.trim())
  }

  it('sets baseline security headers site-wide', () => {
    const all = rules.get('/*') ?? []
    expect(all).toContain('X-Content-Type-Options: nosniff')
    expect(all.some((h) => h.startsWith('Referrer-Policy:'))).toBe(true)
  })

  it('caches the content-hashed /assets/* bundle immutably', () => {
    expect(rules.get('/assets/*')?.join('\n')).toMatch(/Cache-Control:.*immutable/)
  })

  it('never marks an unhashed path immutable (only /assets/* is content-hashed)', () => {
    for (const [path, lines] of rules) {
      if (path === '/assets/*') continue
      expect(lines.join('\n'), path).not.toMatch(/immutable/)
    }
  })
})
