// @vitest-environment node
// This file reads a repo file at run time, so it needs Node globals; tsconfig.app.json (which
// type-checks src/) declares no `types`, so pull them in here rather than widening the app config.
/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The pinned-disclaimer layer contract (honesty gate (a), DESIGN.md) — V2-8.
 *
 * Gate (a) says the "not for clinical use" banner is visible on EVERY screen, and a later release pass strengthened that
 * from "rendered outside the routed view" to "pinned to the viewport top" (`.app-disclaimer` is
 * `position: sticky`). Pinning buys the guarantee but creates two ways to break it that no rendering
 * test can see, because they are pure stacking/hit-testing properties of the stylesheet:
 *
 *   1. an opaque, hit-testable bar floating over the scrolled page SWALLOWS pointer input aimed at
 *      whatever is beneath it — for this app, the top strip of the WebGL scene, so a coil drag or an
 *      orbit started there silently does nothing; and
 *   2. anything with a HIGHER z-index can paint over the banner, leaving gate (a)'s text on screen but
 *      not visible — the glossary tooltip (`.term__tip`) opens upward and is the live example.
 *
 * So this reads the committed stylesheet from disk (this file is `node`-env; Vite’s `?raw` inlining is
 * a no-op for CSS under Vitest, which stubs CSS out) and asserts both invariants directly.
 * App.test.tsx guards that the banner RENDERS; this guards that pinning it can't quietly undo the
 * very thing rendering it was for.
 */

const appCss = readFileSync(new URL('../App.css', import.meta.url), 'utf8')

/** The value of one declaration inside the first `<selector> { … }` block, or null. */
function declaration(css: string, selector: string, property: string): string | null {
  const block = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))
  if (!block) return null
  const decl = block[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))
  return decl ? decl[1].trim() : null
}

describe('pinned disclaimer layer — gate (a) stacking + hit-testing invariants', () => {
  it('pins the banner wrapper to the viewport top', () => {
    expect(declaration(appCss, '.app-disclaimer', 'position')).toBe('sticky')
    expect(declaration(appCss, '.app-disclaimer', 'top')).toBe('0')
  })

  it('keeps the pinned banner pointer-transparent so it cannot swallow scene input', () => {
    // The banner holds no interactive content, so it has no business intercepting a pointerdown aimed
    // at the 3-D scene it floats over. If this goes red, a coil drag / orbit in the top strip of the
    // canvas is dead input with no visible cause.
    expect(declaration(appCss, '.app-disclaimer', 'pointer-events')).toBe('none')
  })

  it('keeps the glossary tooltip UNDER the banner, so nothing paints over gate (a)', () => {
    const banner = Number(declaration(appCss, '.app-disclaimer', 'z-index'))
    const tooltip = Number(declaration(appCss, '.term__tip', 'z-index'))
    expect(Number.isFinite(banner)).toBe(true)
    expect(Number.isFinite(tooltip)).toBe(true)
    expect(tooltip).toBeLessThan(banner)
  })

  it('reserves the banner’s MEASURED height for browser reveal-scrolls, not a constant', () => {
    // The gate-(a) prose reflows from one line to ~7 on a phone, so a hard-coded reserve leaves
    // keyboard-focused controls hidden behind the banner (WCAG 2.4.11). App.tsx publishes the measured
    // height as `--disclaimer-h`; the literal may survive only as the var() fallback.
    const pad = declaration(appCss, 'html', 'scroll-padding-top')
    expect(pad).toBeTruthy()
    expect(pad).toContain('var(--disclaimer-h')
  })
})
