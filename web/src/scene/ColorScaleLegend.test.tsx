// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ColorScaleLegend } from './ColorScaleLegend'
import { useStimStore } from '../store'

/**
 * Honesty gate (e) is enforced by hand-written JSX prose, not
 * just by math/store flags: the legend's "relative units / not V/m / not activation / % of this-pose
 * peak" labels are the words that make the heatmap honest. The arithmetic and store toggles already
 * have coverage; these RTL guards pin the PROSE, so a regression that deletes a relative-units label
 * turns CI red instead of shipping green.
 *
 * `ColorScaleLegend` renders ONE note per mode via a mutually-exclusive chain
 * (`contours ? … : fixedScale ? … : default`) plus independent residual/glyph notes, so each case
 * is asserted against the phrase that mode actually renders — not all phrases in every mode. The
 * store is driven exactly like the other RTL suites (App/SourcesPage) and `reset()` between cases.
 */

beforeEach(() => act(() => useStimStore.getState().reset()))
afterEach(cleanup)

describe('ColorScaleLegend honesty prose (gate (e), per mode)', () => {
  it('default normalized: relative units, explicitly not V/m', () => {
    render(<ColorScaleLegend />)
    // "Arbitrary / relative units, normalised per pose — not clinical, not V/m."
    // ("relative units" rides both the title and the note, so assert ≥1 rather than uniqueness.)
    expect(screen.getAllByText(/relative units/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/not .*V\/m/i)).toBeTruthy()
    expect(screen.getByText(/Induced \|E\| · relative units/i)).toBeTruthy() // the title
  })

  it("colorSource 'residual': the approximation-residual / not-a-validated-error wording", () => {
    act(() => useStimStore.getState().setColorSource('residual'))
    render(<ColorScaleLegend />)
    expect(screen.getByText(/approximation residual, not a validated error/i)).toBeTruthy()
    expect(screen.getByText(/Approx\. residual · relative units/i)).toBeTruthy() // the title
  })

  it('showFocalityContours: "% of this-pose peak" bands, explicitly not V/m', () => {
    act(() => useStimStore.getState().setShowFocalityContours(true))
    render(<ColorScaleLegend />)
    expect(screen.getByText(/% of .*peak/i)).toBeTruthy() // "Focality · % of this-pose peak"
    expect(screen.getByText(/not .*V\/m/i)).toBeTruthy() // "…relative units, not V/m."
  })

  it('fixedScaleExplainer: a labeled teaching aid — not per-pose normalised, not V/m', () => {
    act(() => useStimStore.getState().setFixedScaleExplainer(true))
    render(<ColorScaleLegend />)
    expect(screen.getByText(/teaching aid/i)).toBeTruthy()
    expect(screen.getByText(/not per-pose normalised, not V\/m/i)).toBeTruthy()
    expect(screen.getAllByText(/relative units/i).length).toBeGreaterThan(0)
  })

  it('showGlyphs: arrows are direction in relative units — not activation', () => {
    act(() => useStimStore.getState().setShowGlyphs(true))
    render(<ColorScaleLegend />)
    expect(screen.getByText(/not activation/i)).toBeTruthy()
    expect(screen.getByText(/direction/i)).toBeTruthy()
  })
})

describe('ColorScaleLegend desync — contour label always holds against the per-pose peak', () => {
  it('with fixed-scale AND contours both on, the legend still reads "% of this-pose peak"', () => {
    act(() => {
      useStimStore.getState().setFixedScaleExplainer(true)
      useStimStore.getState().setShowFocalityContours(true)
    })
    render(<ColorScaleLegend />)
    // The contour branch wins the chain; contour bands are ALWAYS computed against the true per-pose
    // peak (store.ts/useEFieldHeatmap comment), so the "% of this-pose peak" label stays honest…
    expect(screen.getByText(/% of .*peak/i)).toBeTruthy()
    expect(screen.getByText(/not .*V\/m/i)).toBeTruthy()
    // …and the fixed-scale note is NOT shown (the desync the test guards: the two never co-display).
    expect(screen.queryByText(/teaching aid/i)).toBeNull()
  })
})
