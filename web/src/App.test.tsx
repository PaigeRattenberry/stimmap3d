// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'

// happy-dom has no WebGL, so the R3F <Canvas> can't initialise here. Stub the 3D scene
// to a no-op — these tests guard the honesty layer (banner + Methods page), not the
// renderer, and that layer lives outside the scene. Scene rendering is verified in the
// browser (Playwright) instead.
vi.mock('./scene/Scene', () => ({ Scene: () => null }))

// The M5 AnalyticsPanel renders Recharts, whose ResponsiveContainer measures 0×0 in happy-dom.
// These tests guard the honesty layer (banner + Methods page), not the chart panel, so stub it
// (same precedent as Scene). The panel has its own coverage in AnalyticsPanel.test.tsx.
vi.mock('./panels/AnalyticsPanel', () => ({ AnalyticsPanel: () => null }))

import App from './App'
import { DISCLAIMER_LEAD } from './ui/DisclaimerBanner'

/** The persistent on-screen disclaimer banner (role="alert") that carries DISCLAIMER_LEAD, as opposed
 *  to the aria-hidden print-only mirror in <PrintSummary>. getAllByRole (never getByRole) so an
 *  unrelated future alert — e.g. an ErrorBoundary fallback, also role="alert" — can't turn gate (a)
 *  into a spurious multiple-match throw; we assert the banner copy is among the alerts. */
const disclaimerBanner = () =>
  screen.getAllByRole('alert').find((el) => el.textContent?.includes(DISCLAIMER_LEAD))

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function navigate(hash: string) {
  act(() => {
    window.location.hash = hash
    window.dispatchEvent(new Event('hashchange'))
  })
}

describe('App — honesty gates (DESIGN.md)', () => {
  it('gate (a): shows the non-clinical disclaimer banner on the default view', () => {
    render(<App />)
    expect(disclaimerBanner()).toBeDefined()
  })

  it('gate (b): the Methods & Limitations page is reachable and carries the §3.2 text', async () => {
    render(<App />)
    navigate('#/methods')

    expect(await screen.findByRole('heading', { level: 1, name: /Methods & Limitations/i }, { timeout: 4000 })).toBeTruthy()
    // Scope the §3.2 phrase guards to the routed Methods PAGE (<main>). Gate (b) is precisely "the
    // Methods page carries the §3.2 text"; the print-only <PrintSummary> (a sibling OUTSIDE <main>)
    // restates the method one-liner too, so scoping keeps each assertion unambiguous and on-target.
    const page = within(screen.getByRole('main'))
    // §3.2 one-liner + verbatim limitation clauses must render.
    expect(page.getByText(/tangential projection of/i)).toBeTruthy()
    expect(page.getByText(/ignores gyral\/sulcal folding/i)).toBeTruthy()
    // M6-2: the §3.2↔MethodsPage first-order-tangential caveat ships in lockstep.
    expect(page.getByText(/also perturbs the tangential part/i)).toBeTruthy()
    // V2-7b: the #23 spherical-derivation figure ships its own tangential caveat in lockstep
    // with DESIGN §3.1 (the derivation-figure phrase, distinct from the §3.2 limitations clause).
    // This asserts the PAGE renders it; the DESIGN.md side of the lockstep (the same phrase +
    // the METHOD_ONELINER verbatim) is enforced in MethodsPage.lockstep.test.ts.
    expect(page.getByText(/not the exact secondary-field solution/i)).toBeTruthy()
    // V1-1: the §3.2↔MethodsPage depth–dose (HVD/spread) caveat ships in lockstep too.
    expect(page.getByText(/surface-derived approximation/i)).toBeTruthy()
    // V1-3: the §3.2↔MethodsPage radial-removal self-error (residual) caveat ships in lockstep too.
    expect(page.getByText(/approximation residual, not a validated error/i)).toBeTruthy()
  })

  it('gate (a) holds on every view: banner persists on the Methods page', () => {
    render(<App />)
    navigate('#/methods')
    expect(disclaimerBanner()).toBeDefined()
  })
})
