// @vitest-environment jsdom
/**
 * Structural accessibility gate (V2-5, improvement #26).
 *
 * Runs axe-core over the app's panels and asserts ZERO WCAG 2.0 A & AA structural violations,
 * so a regression that breaks a role, an accessible name, or an ARIA relationship turns CI red.
 *
 * SCOPE — STRUCTURAL ONLY (deliberately not "fully accessible"). Two reasons, both from
 * the accessibility contract:
 *  1. This file MUST run under `jsdom`, not the project-default happy-dom: vitest-axe/axe-core hit a
 *     `Node.prototype.isConnected` bug under happy-dom. Hence the per-file `@vitest-environment jsdom`
 *     docblock above (the only jsdom file in the suite).
 *  2. JSDOM has no layout engine, so axe's COLOR-CONTRAST rule can't run here — this is a structural
 *     check (roles / names / ARIA validity / required parent-child), not a contrast audit.
 *
 * The three axe deps (`vitest-axe`, `axe-core`, `jsdom`) are author-time devDeps — never in `web/dist`.
 * We assert on `axe().violations` directly rather than via vitest-axe's matcher, whose package ships an
 * empty `extend-expect` and type-only matcher re-exports (so the matcher neither registers nor typechecks).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { AxeResults, RunOptions } from 'axe-core'

// JSDOM has no WebGL, so the R3F <Canvas> can't initialise — stub the scene (same precedent as
// App.test.tsx). The honesty layer + every panel this gate checks live OUTSIDE the WebGL canvas.
vi.mock('./scene/Scene', () => ({ Scene: () => null }))

// JSDOM (unlike happy-dom) ships no ResizeObserver and a no-op <canvas> getContext that warns. Recharts'
// ResponsiveContainer needs the former and uses the latter for text measurement, so stub both — this lets
// the REAL AnalyticsPanel render (size 0, as under happy-dom) for the structural axe pass instead of
// crashing on a missing global.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof globalThis.ResizeObserver
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

import App from './App'
import { AnalyticsPanel } from './panels/AnalyticsPanel'
import { ControlPanel } from './panels/ControlPanel'
import { MethodExplainers } from './panels/MethodExplainers'
import { MethodsPage } from './panels/MethodsPage'
import { SourcesPage } from './ui/SourcesPage'
import { useStimStore } from './store'

/** WCAG 2.0 A & AA rule tags only — color-contrast (a best-practice/AA rule needing layout) can't
 *  run under JSDOM, so scoping to these tags keeps the gate honest about what it actually verifies. */
const AXE_OPTS: RunOptions = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }

/** Compact, readable violation list so a failure names the rule + element instead of dumping objects. */
const violations = (r: AxeResults): string[] =>
  r.violations.map((v) => `${v.id} — ${v.help} [${v.nodes.length} node(s)]`)

afterEach(() => {
  cleanup()
  useStimStore.getState().reset()
})

describe('axe structural a11y gate (#26 — WCAG A/AA, no contrast under JSDOM)', () => {
  it('App — the full visualizer view (live region, glossary, keyboard coil, radiogroup)', async () => {
    const { container } = render(<App />)
    await screen.findByRole('button', { name: /Take the guided tour/ }, { timeout: 4000 })
    expect(violations(await axe(container, AXE_OPTS))).toEqual([])
  })

  it('ControlPanel — incl. the #32 preset radiogroup + colormap/segmented controls', async () => {
    const { container } = render(<ControlPanel />)
    expect(violations(await axe(container, AXE_OPTS))).toEqual([])
  })

  it('AnalyticsPanel — the dose–response panel', async () => {
    const { container } = render(<AnalyticsPanel />)
    expect(violations(await axe(container, AXE_OPTS))).toEqual([])
  })

  it('MethodExplainers — incl. the #22 glossary <Term> tooltips', async () => {
    const { container } = render(<MethodExplainers />)
    expect(violations(await axe(container, AXE_OPTS))).toEqual([])
  })

  it('MethodsPage — incl. the #33 colour-scale / CVD section', async () => {
    const { container } = render(<MethodsPage />)
    expect(violations(await axe(container, AXE_OPTS))).toEqual([])
  })

  it('SourcesPage — the provenance ledger browser', async () => {
    const { container } = render(<SourcesPage />)
    expect(violations(await axe(container, AXE_OPTS))).toEqual([])
  })
})
