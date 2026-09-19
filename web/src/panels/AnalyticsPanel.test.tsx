// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyticsPanel } from './AnalyticsPanel'
import { useStimStore } from '../store'

afterEach(() => {
  cleanup()
  // Reset the shared store slice so protocol-switch tests don't bleed into each other.
  useStimStore.getState().setProtocol('10hz-hf-l')
})

describe('AnalyticsPanel — M5 honesty gates (c)/(d)', () => {
  it('renders without throwing in happy-dom (Recharts measures 0×0, must not crash)', () => {
    expect(() => render(<AnalyticsPanel />)).not.toThrow()
  })

  it('badges the synthetic cohort (gate (d))', () => {
    render(<AnalyticsPanel />)
    expect(screen.getAllByText(/synthetic/i).length).toBeGreaterThan(0)
  })

  it('defines response and remission on screen', () => {
    render(<AnalyticsPanel />)
    expect(screen.getAllByText(/≥50% reduction/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/MADRS ≤ 10/i).length).toBeGreaterThan(0)
  })

  it('keeps absolute rates and odds ratios in separate, labeled sections (gate (c))', () => {
    render(<AnalyticsPanel />)
    // Two distinctly-titled sections — percentages vs odds ratios — never one axis.
    expect(screen.getByRole('heading', { name: /Absolute response & remission/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Odds ratio vs sham/i })).toBeTruthy()
  })

  it('shows the explicit, sourced sham baseline and the OR→probability conversion', () => {
    render(<AnalyticsPanel />)
    // Sham baseline p0 (Berlim 10.4%) surfaced for the conversion (≥1 occurrence — robust to
    // precision changes elsewhere).
    expect(screen.getAllByText(/10\.4%/).length).toBeGreaterThan(0)
    // The conversion formula is shown explicitly.
    expect(screen.getByText(/p = OR·p₀/i)).toBeTruthy()
  })

  it('exposes a protocol selector bound to the store, and switching re-keys the views', () => {
    render(<AnalyticsPanel />)
    const group = screen.getByRole('group', { name: /rTMS protocol/i })
    expect(within(group).getAllByRole('button')).toHaveLength(3)

    // Default protocol drives the trajectory title.
    expect(screen.getByRole('heading', { name: /trajectory — 10 Hz HF-L/i })).toBeTruthy()

    fireEvent.click(within(group).getByRole('button', { name: '1 Hz LF-R' }))

    expect(useStimStore.getState().protocol).toBe('1hz-lf-r')
    // The trajectory + conversion re-key to the newly selected protocol.
    expect(screen.getByRole('heading', { name: /trajectory — 1 Hz LF-R/i })).toBeTruthy()
    // 1 Hz LF-R is OR-derived — it must be labeled as such, not faked as a measured rate.
    expect(screen.getAllByText(/OR-derived/i).length).toBeGreaterThan(0)
  })

  it('marks the OR-derived protocol distinctly from measured ones', () => {
    render(<AnalyticsPanel />)
    // 10 Hz HF-L is directly measured (THREE-D) — its foot states "measured".
    expect(screen.getByText(/measured in the/i)).toBeTruthy()
  })

  it('confines the 95% CI to the OR axis — none of it leaks onto the percentage axis (gate (c), #16)', () => {
    const { container } = render(<AnalyticsPanel />)
    const odds = container.querySelector(
      'section[aria-label="Response odds ratio versus sham"]',
    ) as HTMLElement
    const abs = container.querySelector(
      'section[aria-label="Published absolute response and remission rates"]',
    ) as HTMLElement
    expect(odds).toBeTruthy()
    expect(abs).toBeTruthy()
    // CI language lives only on the OR side.
    expect(within(odds).getAllByText(/confidence interval|95% CI/i).length).toBeGreaterThan(0)
    expect(within(abs).queryByText(/confidence interval|95% CI/i)).toBeNull()
    // The firewall that matters: the absolute-percentage chart carries NO recharts error bars.
    expect(abs.querySelectorAll('.recharts-errorBar').length).toBe(0)
  })

  it('renders the numbered OR→probability walkthrough and the natural-frequency icon array (#17)', () => {
    const { container } = render(<AnalyticsPanel />)
    // Three auditable steps: sham odds → ×OR → back to probability.
    expect(container.querySelectorAll('.analytics-walkthrough > li')).toHaveLength(3)
    // Two "N of 100" waffles, each a full 100-dot pictograph (no layout measurement needed).
    const waffles = container.querySelectorAll('.natfreq')
    expect(waffles).toHaveLength(2)
    waffles.forEach((w) => expect(w.querySelectorAll('circle')).toHaveLength(100))
    // Default 10 Hz HF-L: sham p₀ = 10.4% → 10 of 100; the derived count is OR-derived, never measured.
    const labels = [...container.querySelectorAll('.natfreq svg')].map(
      (s) => s.getAttribute('aria-label') ?? '',
    )
    expect(labels.some((l) => /^10 of 100 respond on sham$/.test(l))).toBe(true)
    expect(labels.some((l) => /^\d+ of 100 respond, derived from the OR$/.test(l))).toBe(true)
  })

  it('re-keys the natural-frequency array when the protocol changes', () => {
    const { container } = render(<AnalyticsPanel />)
    const derivedLabel = () =>
      [...container.querySelectorAll('.natfreq svg')]
        .map((s) => s.getAttribute('aria-label') ?? '')
        .find((l) => /respond, derived from the OR$/.test(l)) ?? ''
    const before = derivedLabel()
    const group = screen.getByRole('group', { name: /rTMS protocol/i })
    fireEvent.click(within(group).getByRole('button', { name: '1 Hz LF-R' }))
    // 1 Hz LF-R has a higher OR (3.65) than 10 Hz HF-L (3.17), so the derived count rises.
    expect(derivedLabel()).not.toBe(before)
  })

  // V2-7a: population-scatter halos (C4) + ±1 SD confidence banding (#39).
  it('badges the population-scatter halos and ±1 SD band as synthetic (gate (d); C4/#39)', () => {
    const { container } = render(<AnalyticsPanel />)
    const traj = container.querySelector(
      'section[aria-label="Synthetic symptom trajectory"]',
    ) as HTMLElement
    expect(traj).toBeTruthy()
    // The overlay legend names the population scatter and the ±1 SD confidence band...
    expect(within(traj).getAllByText(/individual synthetic patients/i).length).toBeGreaterThan(0)
    expect(within(traj).getAllByText(/±1 SD/i).length).toBeGreaterThan(0)
    // ...and the trajectory card carries a "synthetic" badge over that overlay (gate (d)).
    expect(within(traj).getAllByText(/synthetic/i).length).toBeGreaterThan(0)
  })

  // V2-7a: the SAINT/SNT spatial story (C3) must NOT leak the accelerated rate onto the comparison
  // axes — the gate (c) firewall. The rate stays quarantined in the accelerated callout only.
  it('keeps the SAINT/SNT rate quarantined — never on the comparison axes (gate (c); C3)', () => {
    const { container } = render(<AnalyticsPanel />)
    const abs = container.querySelector(
      'section[aria-label="Published absolute response and remission rates"]',
    ) as HTMLElement
    const odds = container.querySelector(
      'section[aria-label="Response odds ratio versus sham"]',
    ) as HTMLElement
    const note = container.querySelector(
      'section[aria-label="Accelerated protocols context (SNT/SAINT)"]',
    ) as HTMLElement
    expect(abs).toBeTruthy()
    expect(odds).toBeTruthy()
    expect(note).toBeTruthy()
    // The SAINT/SNT figures live ONLY in the quarantined callout, never in either comparison card.
    for (const card of [abs, odds]) {
      expect(within(card).queryByText(/SAINT|SNT/i)).toBeNull()
      expect(within(card).queryByText(/78\.6/)).toBeNull()
      expect(within(card).queryByText(/90%/)).toBeNull()
    }
    // They DO appear in the callout — that is where the firewall keeps them.
    expect(within(note).getAllByText(/78\.6/).length).toBeGreaterThan(0)
    expect(within(note).getAllByText(/SAINT|SNT/i).length).toBeGreaterThan(0)
  })
})
