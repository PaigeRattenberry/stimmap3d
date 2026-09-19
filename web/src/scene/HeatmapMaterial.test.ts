/**
 * Milestone 3 unit tests for the heatmap recolor engine (HeatmapMaterial.ts).
 *
 * These cover the PURE, deterministic core of the live-recolor path that the
 * Playwright pass exercises end-to-end: the colormap LUTs, the allocate-once color
 * attribute (CLAUDE.md buffer rule), the robust per-pose field scale, the in-place
 * colour mapping, and the legend gradient. No DOM / WebGL is needed — three's `Color`
 * and `BufferAttribute` and d3's interpolators all run headless — so this file uses
 * Vitest's default `node` environment (matching efield.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute } from 'three'
import {
  applyContourColors,
  applyFieldColors,
  colormapBandedGradientCss,
  colormapGradientCss,
  computeFieldScale,
  CONTOUR_LEVELS,
  ensureColorAttribute,
  fixedScaleMax,
  getColorAllocCount,
  getColormapLUT,
  HIST_BINS,
  LUT_SIZE,
} from './HeatmapMaterial'

/** A bare geometry with `n` vertices (position only) — the heatmap's recolor target. */
function geometryWithVertices(n: number): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3))
  return g
}

describe('constants (DESIGN §2 / DESIGN.md)', () => {
  it('LUT is 256 entries and the histogram is 1024 bins', () => {
    expect(LUT_SIZE).toBe(256)
    expect(HIST_BINS).toBe(1024)
  })
})

describe('getColormapLUT', () => {
  it('returns a 256×3 LINEAR table with every channel in [0,1]', () => {
    const lut = getColormapLUT('viridis')
    expect(lut).toBeInstanceOf(Float32Array)
    expect(lut.length).toBe(LUT_SIZE * 3)
    for (let i = 0; i < lut.length; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0)
      expect(lut[i]).toBeLessThanOrEqual(1)
    }
  })

  it('caches per colormap (same reference on repeat calls — built once)', () => {
    expect(getColormapLUT('viridis')).toBe(getColormapLUT('viridis'))
    expect(getColormapLUT('turbo')).toBe(getColormapLUT('turbo'))
  })

  it('viridis and turbo are distinct tables', () => {
    const v = getColormapLUT('viridis')
    const t = getColormapLUT('turbo')
    expect(v).not.toBe(t)
    // They must actually differ somewhere (not two views of one buffer).
    let differs = false
    for (let i = 0; i < v.length; i++) {
      if (v[i] !== t[i]) {
        differs = true
        break
      }
    }
    expect(differs).toBe(true)
  })

  it('viridis runs dark (low) → bright (high)', () => {
    const v = getColormapLUT('viridis')
    const lo = v[0] + v[1] + v[2]
    const last = LUT_SIZE - 1
    const hi = v[last * 3] + v[last * 3 + 1] + v[last * 3 + 2]
    expect(hi).toBeGreaterThan(lo)
  })

  // V2-5 (#33): cividis — the perceptually-uniform, CVD-optimised colormap. Lock-stepped into the
  // Colormap union, ControlPanel labels, the interpolator Record, and the deep-link whitelist.
  it('cividis is a valid 256×3 LINEAR table, distinct from viridis AND turbo', () => {
    const c = getColormapLUT('cividis')
    expect(c).toBeInstanceOf(Float32Array)
    expect(c.length).toBe(LUT_SIZE * 3)
    for (let i = 0; i < c.length; i++) {
      expect(c[i]).toBeGreaterThanOrEqual(0)
      expect(c[i]).toBeLessThanOrEqual(1)
    }
    const differsFrom = (other: Float32Array) => {
      for (let i = 0; i < c.length; i++) if (c[i] !== other[i]) return true
      return false
    }
    expect(differsFrom(getColormapLUT('viridis'))).toBe(true)
    expect(differsFrom(getColormapLUT('turbo'))).toBe(true)
  })

  it('cividis runs dark (low) → bright (high), like a sequential map', () => {
    const c = getColormapLUT('cividis')
    const last = LUT_SIZE - 1
    const lo = c[0] + c[1] + c[2]
    const hi = c[last * 3] + c[last * 3 + 1] + c[last * 3 + 2]
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('ensureColorAttribute (allocate ONCE — CLAUDE.md buffer rule)', () => {
  it('creates a dynamic color attribute sized to the vertex count, allocating exactly once', () => {
    const g = geometryWithVertices(50)
    const before = getColorAllocCount()
    const attr = ensureColorAttribute(g)
    expect(getColorAllocCount()).toBe(before + 1)
    expect(attr.count).toBe(50)
    expect(attr.itemSize).toBe(3)
    expect(attr.usage).toBe(DynamicDrawUsage)
    expect(g.getAttribute('color')).toBe(attr)
  })

  it('is re-entrant: a second call on the same geometry reuses the buffer (no new alloc)', () => {
    const g = geometryWithVertices(50)
    const first = ensureColorAttribute(g)
    const between = getColorAllocCount()
    const second = ensureColorAttribute(g)
    expect(second).toBe(first)
    expect(getColorAllocCount()).toBe(between) // unchanged — the invariant this test asserts
  })

  it('reallocates only when the existing attribute is the wrong size', () => {
    const g = geometryWithVertices(8)
    ensureColorAttribute(g)
    const before = getColorAllocCount()
    // Swap in a differently-sized position attribute; the stale color attr must be replaced.
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(16 * 3), 3))
    const attr = ensureColorAttribute(g)
    expect(attr.count).toBe(16)
    expect(getColorAllocCount()).toBe(before + 1)
  })
})

describe('computeFieldScale (robust per-pose normalisation)', () => {
  it('returns zeros for an all-zero field', () => {
    const hist = new Int32Array(HIST_BINS)
    const s = computeFieldScale(new Float32Array(1000), 1000, hist)
    expect(s).toEqual({ absMax: 0, peak: 0, p99: 0 })
  })

  it('robust peak ignores a single-vertex near-singularity (the whole point)', () => {
    // 9990 vertices at the real hotspot level (~1), 10 at a 100× numerical spike.
    const n = 10000
    const field = new Float32Array(n)
    for (let i = 0; i < n; i++) field[i] = i < 10 ? 100 : 1
    const hist = new Int32Array(HIST_BINS)
    const s = computeFieldScale(field, n, hist)

    expect(s.absMax).toBe(100) // the spike dominates the absolute max…
    // …but the robust peak/p99 stay near the real hotspot level, NOT the spike.
    expect(s.peak).toBeGreaterThanOrEqual(1)
    expect(s.peak).toBeLessThan(5)
    expect(s.p99).toBeLessThan(5)
    // Normalising to absMax would crush the bulk to ~1% of the scale; robust peak keeps it visible.
    expect(s.peak / s.absMax).toBeLessThan(0.1)
  })

  it('tracks a smooth distribution closely and keeps peak ≥ p99', () => {
    const n = 1000
    const field = new Float32Array(n)
    for (let i = 0; i < n; i++) field[i] = i // 0 … 999
    const hist = new Int32Array(HIST_BINS)
    const s = computeFieldScale(field, n, hist)

    expect(s.absMax).toBe(999)
    // 99.9th percentile sits just under the max (within ~1 bin of quantisation).
    expect(s.peak).toBeGreaterThan(990)
    expect(s.peak).toBeLessThanOrEqual(s.absMax * (1 + 1 / HIST_BINS))
    // The higher percentile is never below the lower one.
    expect(s.peak).toBeGreaterThanOrEqual(s.p99)
  })

  it('honours a custom percentile and reuses the caller-supplied histogram', () => {
    const n = 1000
    const field = new Float32Array(n)
    for (let i = 0; i < n; i++) field[i] = i
    const hist = new Int32Array(HIST_BINS)
    const median = computeFieldScale(field, n, hist, 0.5).peak
    expect(median).toBeGreaterThan(480)
    expect(median).toBeLessThan(520)
    // Re-running with the same histogram (it is re-zeroed internally) gives the same answer.
    const again = computeFieldScale(field, n, hist, 0.5).peak
    expect(again).toBe(median)
  })
})

describe('applyFieldColors (in-place mapping + clamp + upload flag)', () => {
  it('maps |E| through the LUT, clamps above the peak, and writes in place', () => {
    const g = geometryWithVertices(4)
    const attr = ensureColorAttribute(g)
    const lut = getColormapLUT('viridis')
    const buffer = attr.array // capture the reference to prove no realloc
    const versionBefore = attr.version

    // max = 1 → t = field. Vertices at 0, 0.5, 1.0, and 2.0 (over-range → clamps to 1.0).
    applyFieldColors(attr, new Float32Array([0, 0.5, 1, 2]), 1, lut)

    expect(attr.array).toBe(buffer) // mutated in place, never reallocated
    // `needsUpdate` is a write-only setter in three (reads are undefined); its observable
    // effects are a bumped version + a single full-range upload window via the MODERN API
    // (clearUpdateRanges/addUpdateRange — not the deprecated singular `updateRange`).
    expect(attr.version).toBeGreaterThan(versionBefore)
    expect(attr.updateRanges).toEqual([{ start: 0, count: 4 * 3 }])

    const colors = attr.array as Float32Array
    const slot = (idx: number) => [lut[idx * 3], lut[idx * 3 + 1], lut[idx * 3 + 2]]
    // idx = round(t * 255): 0 → 0, 0.5 → 128, 1.0 → 255, clamp → 255.
    expect([colors[0], colors[1], colors[2]]).toEqual(slot(0))
    expect([colors[3], colors[4], colors[5]]).toEqual(slot(128))
    expect([colors[6], colors[7], colors[8]]).toEqual(slot(255))
    // The over-range vertex clamps to the top colour (identical to the field == max vertex).
    expect([colors[9], colors[10], colors[11]]).toEqual([colors[6], colors[7], colors[8]])
  })

  it('paints the LUT floor everywhere when max == 0 (the unsolved baseline)', () => {
    const g = geometryWithVertices(3)
    const attr = ensureColorAttribute(g)
    const lut = getColormapLUT('viridis')
    // Even with non-zero field values, max == 0 means inv == 0 → every vertex maps to LUT[0].
    applyFieldColors(attr, new Float32Array([5, 10, 999]), 0, lut)
    const colors = attr.array as Float32Array
    for (let v = 0; v < 3; v++) {
      expect(colors[v * 3]).toBe(lut[0])
      expect(colors[v * 3 + 1]).toBe(lut[1])
      expect(colors[v * 3 + 2]).toBe(lut[2])
    }
  })
})

describe('colormapGradientCss (HTML legend, sRGB)', () => {
  it('builds a left→right gradient with one stop per sample, spanning 0 → 100%', () => {
    const css = colormapGradientCss('viridis', 16)
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true)
    expect((css.match(/%/g) ?? []).length).toBe(16) // one percentage per stop
    expect(css).toContain('0.0%')
    expect(css).toContain('100.0%')
  })

  it('defaults to 16 stops and differs between colormaps', () => {
    const v = colormapGradientCss('viridis')
    expect((v.match(/%/g) ?? []).length).toBe(16)
    expect(v).not.toBe(colormapGradientCss('turbo'))
  })
})

describe('default heatmap path is intensity-invariant (v2.3 #8 honesty — gate (e))', () => {
  it('scaling the field by intensity leaves the per-pose-normalised colours identical', () => {
    // The shipped DEFAULT path normalises to the robust per-pose peak. |E| ∝ dI/dt (efield.ts
    // `scale = -intensity`), so a 2× intensity gives a 2× field AND a 2× peak → field/peak is
    // unchanged → identical colours. This is exactly why cranking intensity doesn't move the
    // footprint (the explainer in #8 makes it visible; this test pins the default invariance).
    const g = geometryWithVertices(64)
    const lut = getColormapLUT('viridis')
    const hist = new Int32Array(HIST_BINS)
    const base = new Float32Array(64)
    for (let i = 0; i < 64; i++) base[i] = Math.exp(-((i - 20) ** 2) / 50) // a focal bump in [0,1]

    const attr = ensureColorAttribute(g)
    applyFieldColors(attr, base, computeFieldScale(base, 64, hist).peak, lut)
    const colorsLow = Array.from(attr.array as Float32Array)

    const hot = base.map((v) => v * 2) // a 2× intensity re-solve
    applyFieldColors(attr, hot, computeFieldScale(hot, 64, hist).peak, lut)
    const colorsHigh = Array.from(attr.array as Float32Array)

    expect(colorsHigh).toEqual(colorsLow) // invariant to intensity — the honest default
  })
})

describe('fixedScaleMax (v2.3 #8 fixed-scale intensity explainer)', () => {
  it('reproduces the frozen reference when current == solve intensity (ratio 1)', () => {
    expect(fixedScaleMax(4, 1, 1)).toBe(4)
    expect(fixedScaleMax(4, 1.5, 1.5)).toBeCloseTo(4)
  })

  it('raising current intensity SHRINKS max → the same cached field brightens', () => {
    const lowMax = fixedScaleMax(4, 1, 1) // intensity 1
    const highMax = fixedScaleMax(4, 1, 2) // cranked to 2, no re-solve
    expect(highMax).toBeLessThan(lowMax)
    const v = 1.0 // a fixed cached vertex
    expect(v / highMax).toBeGreaterThan(v / lowMax) // brightness = field/max rises
  })

  it('guards a non-positive current intensity (returns the reference, no divide-by-zero)', () => {
    expect(fixedScaleMax(4, 1, 0)).toBe(4)
  })

  it('maps a cached field to a HIGHER LUT bin at higher intensity (no re-solve)', () => {
    const g = geometryWithVertices(2)
    const attr = ensureColorAttribute(g)
    const lut = getColormapLUT('viridis')
    const slot = (idx: number) => [lut[idx * 3], lut[idx * 3 + 1], lut[idx * 3 + 2]]
    const ref = 2 // frozen reference (first-solve robust peak)
    const cached = new Float32Array([0, 0.5]) // solved at intensity 1; vertex 1 = 0.5

    applyFieldColors(attr, cached, fixedScaleMax(ref, 1, 1), lut) // t = 0.5/2 = 0.25 → idx 64
    let c = attr.array as Float32Array
    expect([c[3], c[4], c[5]]).toEqual(slot(64))

    applyFieldColors(attr, cached, fixedScaleMax(ref, 1, 2), lut) // SAME field, t = 0.5/1 = 0.5 → idx 128
    c = attr.array as Float32Array
    expect([c[3], c[4], c[5]]).toEqual(slot(128))
  })
})

describe('applyContourColors (v2.3 #14 iso-contour focality bands)', () => {
  it('posterises |E| into the CONTOUR_LEVELS bands and writes in place', () => {
    const g = geometryWithVertices(6)
    const attr = ensureColorAttribute(g)
    const lut = getColormapLUT('viridis')
    const buffer = attr.array
    const versionBefore = attr.version
    const last = LUT_SIZE - 1
    const bandCount = CONTOUR_LEVELS.length
    const bandSlot = (band: number) => {
      const idx = Math.min(last, ((band / bandCount) * last + 0.5) | 0)
      return [lut[idx * 3], lut[idx * 3 + 1], lut[idx * 3 + 2]]
    }

    // max = 1 → t == field. 0.10→band0, 0.25→band1, 0.55→band2, 0.80→band3, 0.95→band4, 2.0→clamp.
    applyContourColors(attr, new Float32Array([0.1, 0.25, 0.55, 0.8, 0.95, 2.0]), 1, lut)

    expect(attr.array).toBe(buffer) // mutated in place, never reallocated
    expect(attr.version).toBeGreaterThan(versionBefore)
    expect(attr.updateRanges).toEqual([{ start: 0, count: 6 * 3 }]) // modern full-range upload
    const c = attr.array as Float32Array
    const at = (v: number) => [c[v * 3], c[v * 3 + 1], c[v * 3 + 2]]
    expect(at(0)).toEqual(bandSlot(0))
    expect(at(1)).toEqual(bandSlot(1))
    expect(at(2)).toEqual(bandSlot(2))
    expect(at(3)).toEqual(bandSlot(3))
    expect(at(4)).toEqual(bandSlot(4))
    expect(at(5)).toEqual(bandSlot(4)) // over the top level → saturates into the brightest band
  })

  it('emits exactly one colour per band over a smooth ramp (posterised, not smooth)', () => {
    const g = geometryWithVertices(100)
    const attr = ensureColorAttribute(g)
    const lut = getColormapLUT('turbo')
    const field = new Float32Array(100)
    for (let i = 0; i < 100; i++) field[i] = i / 99 // smooth 0 → 1
    applyContourColors(attr, field, 1, lut)
    const c = attr.array as Float32Array
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(`${c[i * 3]},${c[i * 3 + 1]},${c[i * 3 + 2]}`)
    expect(seen.size).toBe(CONTOUR_LEVELS.length + 1) // 4 levels → 5 bands → 5 distinct colours
  })
})

describe('colormapBandedGradientCss (v2.3 #14 banded legend)', () => {
  it('builds hard-edged stops at the contour boundaries (two stops per band)', () => {
    const css = colormapBandedGradientCss('viridis')
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true)
    expect((css.match(/%/g) ?? []).length).toBe((CONTOUR_LEVELS.length + 1) * 2)
    for (const pct of ['0.0%', '25.0%', '50.0%', '75.0%', '90.0%', '100.0%']) {
      expect(css).toContain(pct)
    }
  })
})
