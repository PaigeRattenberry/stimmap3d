// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { HeatmapLiveRegion, describeHeatmapResult } from './HeatmapLiveRegion'
import type { HeatmapNarrationContext } from './HeatmapLiveRegion'
import { useStimStore } from '../store'

const BASE: HeatmapNarrationContext = {
  preset: 'F3',
  colorSource: 'field',
  showFocalityContours: false,
  fixedScaleExplainer: false,
}

afterEach(() => {
  cleanup()
  useStimStore.getState().reset()
})

describe('describeHeatmapResult (#34 narration — gate (e))', () => {
  it('prompts to place the coil when no field has solved yet', () => {
    const msg = describeHeatmapResult(null, BASE)
    expect(msg).toMatch(/no field yet/i)
    expect(msg).toMatch(/place the coil/i)
  })

  it('NEVER says V/m or "activation", and DOES say "relative units" (gate (e))', () => {
    for (const ctx of [
      BASE,
      { ...BASE, colorSource: 'residual' as const },
      { ...BASE, showFocalityContours: true },
      { ...BASE, fixedScaleExplainer: true },
    ]) {
      const msg = describeHeatmapResult({ hvd: 12.3, spread: 21.7, peak: 4.5 }, ctx)
      expect(msg).toMatch(/relative units/i)
      // The abbreviation "V/m" must never appear; "activation" must never appear. ("volts per metre"
      // IS allowed — but only inside the explicit "not … volts per metre" negation.)
      expect(msg).not.toMatch(/\bV\/m\b/)
      expect(msg.toLowerCase()).not.toContain('activation')
    }
  })

  it('narrates the metrics as ILLUSTRATIVE mm with the active preset', () => {
    const msg = describeHeatmapResult({ hvd: 12.3, spread: 21.7, peak: 4.5 }, BASE)
    expect(msg).toMatch(/half-value depth 12\.3 mm/i)
    expect(msg).toMatch(/focal spread 21\.7 mm/i)
    expect(msg).toMatch(/illustrative/i)
    expect(msg).toMatch(/F3/)
    expect(msg).toMatch(/not validated millimetres/i)
  })

  it('mirrors the legend layer precedence: contours → residual → fixed → induced |E|', () => {
    const m = { hvd: 1, spread: 2, peak: 3 }
    // contours win even when residual + fixed are also on
    expect(
      describeHeatmapResult(m, {
        ...BASE,
        colorSource: 'residual',
        showFocalityContours: true,
        fixedScaleExplainer: true,
      }),
    ).toMatch(/iso-contour bands/i)
    expect(describeHeatmapResult(m, { ...BASE, colorSource: 'residual' })).toMatch(
      /not a validated error/i,
    )
    expect(describeHeatmapResult(m, { ...BASE, fixedScaleExplainer: true })).toMatch(
      /fixed reference scale/i,
    )
    expect(describeHeatmapResult(m, BASE)).toMatch(/normalised to this pose/i)
  })

  it('the residual layer names the SAME scale as |E| — fixed reference under the teaching-aid toggle, per-pose otherwise', () => {
    const m = { hvd: 1, spread: 2, peak: 3 }
    // residual on a fixed reference scale must name BOTH the residual AND the fixed scale (the gap this
    // closes — mirrors the legend, where the fixed-scale note and the residual note both render).
    const residualFixed = describeHeatmapResult(m, {
      ...BASE,
      colorSource: 'residual',
      fixedScaleExplainer: true,
    })
    expect(residualFixed).toMatch(/not a validated error/i)
    expect(residualFixed).toMatch(/fixed reference scale/i)
    // residual on the default per-pose scale names the residual AND the per-pose normalisation.
    const residualPerPose = describeHeatmapResult(m, { ...BASE, colorSource: 'residual' })
    expect(residualPerPose).toMatch(/not a validated error/i)
    expect(residualPerPose).toMatch(/normalised to this pose/i)
  })
})

describe('HeatmapLiveRegion (#34 component)', () => {
  it('is a polite, atomic status region and announces the result on a new solve', () => {
    render(<HeatmapLiveRegion />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('aria-atomic')).toBe('true')
    expect(region.className).toContain('sr-only')
    // Before a solve: the placeholder prompt.
    expect(region.textContent).toMatch(/no field yet/i)

    act(() => {
      useStimStore.getState().setFieldMetrics({ hvd: 9.4, spread: 18.2, peak: 2.1 })
    })
    expect(region.textContent).toMatch(/relative units/i)
    expect(region.textContent).toMatch(/half-value depth 9\.4 mm/i)
    expect(region.textContent).not.toMatch(/\bV\/m\b/)
  })
})
