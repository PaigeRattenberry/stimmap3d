import { afterEach, describe, expect, it } from 'vitest'
import { Float32BufferAttribute } from 'three'
import { createEFieldSolver } from '../solver/efield'
import { referencePeak } from '../solver/reference'
import { useStimStore } from '../store'
import { recolorActive } from './useEFieldHeatmap'
import { computeFieldScale, getColormapLUT, HIST_BINS, LUT_SIZE } from './HeatmapMaterial'
import { initialCoalescerState } from './efieldCoalescer'
import { exportUnitsLabel } from './exportPng'

const positions = new Float32Array(2048 * 3)
for (let i = 0; i < 2048; i++) {
  const z = 1 - 2 * i / 2047, r = Math.sqrt(1 - z * z), angle = i * Math.PI * (3 - Math.sqrt(5))
  positions.set([80 * r * Math.cos(angle), 80 * r * Math.sin(angle), 80 * z], i * 3)
}
afterEach(() => useStimStore.getState().reset())
describe('numeric scalar and reference contracts', () => {
  it('reference v1 is independent of previous pose, intensity, and solver instance', () => {
    const solver = createEFieldSolver(positions)
    const reference = referencePeak(solver, positions)
    solver.solve({ position: [50, 50, 50], rotation: [1, 2, 0], standoff: 20 }, 2)
    expect(referencePeak(solver, positions)).toBe(reference)
    expect(referencePeak(createEFieldSolver(positions), positions)).toBe(reference)
  })
  it('all eight modes select the correct scalar and reference, including an isolated outlier', () => {
    const solver = createEFieldSolver(positions)
    const fixedRef = referencePeak(solver, positions)
    const field = solver.solve({ position: [0, 0, 80], rotation: [0, 0, 0], standoff: 4 }, 1).slice()
    const residual = solver.residual.slice()
    // One isolated peak distinguishes robust smooth normalization from true-max bands.
    field[0] = Math.max(...field) * 100
    const hist = new Int32Array(HIST_BINS)
    const scale = computeFieldScale(field, field.length, hist)
    expect(scale.absMax).toBeGreaterThan(scale.peak * 10)
    const lut = getColormapLUT('viridis')
    for (const colorSource of ['field', 'residual'] as const) for (const showFocalityContours of [false, true]) for (const fixedScaleExplainer of [false, true]) {
      useStimStore.setState({ colorSource, showFocalityContours, fixedScaleExplainer, intensity: 2 })
      const attr = new Float32BufferAttribute(new Float32Array(field.length * 3), 3)
      const runtime: Parameters<typeof recolorActive>[0] = { worker: null, coalescer: initialCoalescerState(), field, residual, glyphs: null, max: scale.peak, absMax: scale.absMax, p99: scale.p99, fixedRef, fieldIntensity: 1, lastSolveIntensity: 1, appliedMax: 0, lut, hist, solves: 1, fields: 1, recolors: 0 }
      recolorActive(runtime, attr)
      const reference = showFocalityContours ? scale.absMax : fixedScaleExplainer ? fixedRef / 2 : scale.peak
      expect(runtime.appliedMax).toBe(reference)
      const values = colorSource === 'field' ? field : residual
      for (let i = 0; i < values.length; i++) {
        const fraction = Math.min(1, Math.max(0, values[i] / reference))
        const level = showFocalityContours ? [0.25, 0.5, 0.75, 0.9].filter(n => fraction >= n).length / 4 : fraction
        const index = Math.round(level * (LUT_SIZE - 1))
        expect(attr.getX(i)).toBe(lut[index * 3])
      }
      const label = exportUnitsLabel(useStimStore.getState())
      expect(label).toContain(colorSource === 'field' ? 'Induced |E|' : 'Radial-removal residual')
      expect(label).toContain(showFocalityContours ? 'absolute field maximum' : fixedScaleExplainer ? 'reference v1' : '99.9th percentile')
    }
  })
})
