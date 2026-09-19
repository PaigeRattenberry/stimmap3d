// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  drawExportOverlay,
  EXPORT_DISCLAIMER,
  EXPORT_UNITS_LABEL,
  exportUnitsLabel,
} from './exportPng'
import { DISCLAIMER_LEAD } from '../ui/DisclaimerBanner'

/**
 * V2-4b PNG export (#19) — gate (a)/(e) bake-in is the must-not-regress criterion. The persistent
 * DisclaimerBanner and the HTML ColorScaleLegend do NOT travel into a raw WebGL capture, so the
 * compositor must re-draw them. This pins that contract with a MOCKED 2D context: `drawExportOverlay`
 * MUST write both the non-clinical disclaimer (gate a) and the relative-units label (gate e).
 */

/** A minimal recording stand-in for CanvasRenderingContext2D — captures every fillText call. */
function mockCtx() {
  const texts: string[] = []
  const ctx = {
    fillStyle: '',
    font: '',
    textBaseline: '' as CanvasTextBaseline,
    textAlign: '' as CanvasTextAlign,
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn((text: string) => {
      texts.push(text)
    }),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts }
}

describe('drawExportOverlay — bakes in the honesty framing (gate a + e)', () => {
  it('writes the verbatim non-clinical disclaimer (gate a)', () => {
    const { ctx, texts } = mockCtx()
    drawExportOverlay(ctx, 1024, 768)
    expect(texts).toContain(EXPORT_DISCLAIMER)
    expect(texts.some((t) => /not for clinical use/i.test(t))).toBe(true)
  })

  it('writes the relative-units label (gate e), explicitly not V/m', () => {
    const { ctx, texts } = mockCtx()
    drawExportOverlay(ctx, 1024, 768)
    expect(texts).toContain(EXPORT_UNITS_LABEL)
    expect(texts.some((t) => /relative units/i.test(t))).toBe(true)
    expect(texts.some((t) => /not .*V\/m/i.test(t))).toBe(true)
  })

  it('draws a backing strip before the text so it stays legible over the cortex', () => {
    const { ctx } = mockCtx()
    drawExportOverlay(ctx, 1024, 768)
    expect((ctx.fillRect as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    expect((ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('bakes the supplied mode label when one is passed (residual mode)', () => {
    const { ctx, texts } = mockCtx()
    const residualLabel = exportUnitsLabel({ colorSource: 'residual', showFocalityContours: false })
    drawExportOverlay(ctx, 1024, 768, residualLabel)
    expect(texts).toContain(residualLabel)
    expect(texts).toContain(EXPORT_DISCLAIMER) // the disclaimer is still always baked in
  })
})

describe('exportUnitsLabel — mirrors the legend title per mode, keeping gate-(e) framing in every branch', () => {
  it('field mode → "Induced |E|" (the default)', () => {
    expect(exportUnitsLabel({ colorSource: 'field', showFocalityContours: false })).toContain("field 99.9th percentile")
  })

  it("residual mode → \"Approx. residual\", not \"Induced |E|\"", () => {
    const label = exportUnitsLabel({ colorSource: 'residual', showFocalityContours: false })
    expect(label).toMatch(/radial-removal residual/i)
    expect(label).not.toMatch(/Induced \|E\|/)
    expect(label).toMatch(/relative units/i)
    expect(label).toMatch(/not V\/m/i)
  })

  it('residual contours name the residual and absolute induced-field reference', () => {
    const label = exportUnitsLabel({ colorSource: 'residual', showFocalityContours: true })
    expect(label).toMatch(/absolute field maximum/i)
    expect(label).toMatch(/not V\/m/i)
  })

  it('EVERY mode keeps the gate-(e) "relative units / not V/m" honesty framing', () => {
    const modes = [
      { colorSource: 'field' as const, showFocalityContours: false },
      { colorSource: 'residual' as const, showFocalityContours: false },
      { colorSource: 'field' as const, showFocalityContours: true },
      { colorSource: 'residual' as const, showFocalityContours: true },
    ]
    for (const m of modes) {
      expect(exportUnitsLabel(m)).toMatch(/not V\/m/i)
    }
  })
})

describe('export text constants stay faithful to the on-screen sources of truth', () => {
  it('the baked disclaimer IS the banner lead (single source of truth)', () => {
    expect(EXPORT_DISCLAIMER).toBe(DISCLAIMER_LEAD)
    expect(EXPORT_DISCLAIMER).toBe('Illustrative model — not for clinical use.')
  })

  it('the baked units label mirrors the legend wording (relative units, not V/m)', () => {
    expect(EXPORT_UNITS_LABEL).toMatch(/relative units/i)
    expect(EXPORT_UNITS_LABEL).toMatch(/not V\/m/i)
    expect(EXPORT_UNITS_LABEL).toContain('Induced |E|')
  })
})

// Linux's wider system font exposed clipped disclaimer text in the real 320px browser check.
it('wraps both captions within a narrow canvas using the drawing font', () => {
  const calls: { text: string; x: number; y: number; font: string }[] = []
  const { ctx } = mockCtx()
  ctx.measureText = text => ({ width: text.length * 9 }) as TextMetrics
  ctx.fillText = (text, x, y) => { calls.push({ text, x, y, font: ctx.font }) }
  drawExportOverlay(ctx, 289, 436, exportUnitsLabel({ colorSource: 'residual', showFocalityContours: true }))
  expect(calls.filter(call => call.font.startsWith('600')).length).toBeGreaterThan(1)
  expect(calls.map(call => call.text).join(' ')).toContain(EXPORT_DISCLAIMER)
  for (const call of calls) {
    expect(call.x + call.text.length * 9).toBeLessThanOrEqual(289 - 10)
    expect(call.y).toBeGreaterThanOrEqual(0)
    expect(call.y).toBeLessThan(436)
  }
})
