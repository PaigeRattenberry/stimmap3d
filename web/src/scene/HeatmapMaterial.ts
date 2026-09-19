/**
 * Heatmap recolor path (Milestone 3) — the MVP `vertexColors` strategy.
 *
 * The brain `BufferGeometry` carries a `color` attribute allocated ONCE with
 * `setUsage(THREE.DynamicDrawUsage)` and mutated in place; we flag uploads with
 * `clearUpdateRanges()` + `addUpdateRange()` + `needsUpdate` (NOT the deprecated
 * `setDynamic`/`updateRange`). Per-vertex |E| is mapped through a 256-entry LUT that
 * reads `store.colormap` (viridis default, turbo optional — DESIGN §2). A colormap
 * switch only RE-MAPS the cached field through the new LUT; it never triggers a re-solve.
 *
 * COLOUR SPACE: the 3D LUT stores LINEAR-sRGB values (three's ColorManagement treats
 * vertex colours as working/linear space), so d3's sRGB swatches are converted via
 * `Color.setStyle(css, SRGBColorSpace)`. The HTML legend, by contrast, wants the raw
 * sRGB CSS (browsers paint gradients in sRGB) — see {@link colormapGradientCss}.
 */

import { interpolateCividis, interpolateTurbo, interpolateViridis } from 'd3-scale-chromatic'
import { Color, DynamicDrawUsage, Float32BufferAttribute, SRGBColorSpace } from 'three'
import type { BufferGeometry } from 'three'
import type { Colormap } from '../store'

/** Number of LUT entries (DESIGN §2 / DESIGN.md: 256-entry LUT). */
export const LUT_SIZE = 256

type Interpolator = (t: number) => string

/**
 * The d3 interpolator per colormap. Keyed by the `Colormap` union (a `Record`, so adding a colormap
 * to the union without a matching interpolator is a COMPILE error — the same lock-step discipline as
 * ControlPanel's `COLORMAP_LABELS`). viridis/cividis are perceptually uniform; turbo is not (Methods).
 */
const INTERPOLATORS: Record<Colormap, Interpolator> = {
  viridis: interpolateViridis,
  turbo: interpolateTurbo,
  cividis: interpolateCividis,
}

function interpolatorFor(name: Colormap): Interpolator {
  return INTERPOLATORS[name]
}

/**
 * 256×3 LINEAR-sRGB lookup table for a colormap, built once and cached. Values are in
 * three's working (linear) colour space so they can be written straight into the
 * vertex-`color` attribute with correct on-screen appearance.
 */
const lutCache = new Map<Colormap, Float32Array>()

export function getColormapLUT(name: Colormap): Float32Array {
  let lut = lutCache.get(name)
  if (!lut) {
    const interp = interpolatorFor(name)
    lut = new Float32Array(LUT_SIZE * 3)
    const c = new Color()
    for (let i = 0; i < LUT_SIZE; i++) {
      c.setStyle(interp(i / (LUT_SIZE - 1)), SRGBColorSpace) // sRGB → working linear
      lut[i * 3] = c.r
      lut[i * 3 + 1] = c.g
      lut[i * 3 + 2] = c.b
    }
    lutCache.set(name, lut)
  }
  return lut
}

/**
 * Count of REAL color-attribute allocations. The CLAUDE.md "allocate the heatmap color
 * buffer once" rule means this must reach 1 and stay there for the life of a geometry;
 * the M3 verification asserts it via `window.__stimHeatmap.allocs`.
 */
let colorAllocCount = 0
export function getColorAllocCount(): number {
  return colorAllocCount
}

/**
 * Ensure the geometry owns a dynamic `color` BufferAttribute, allocating it ONCE.
 * Re-entrant: if a correctly-sized attribute already exists (e.g. across a remount with
 * the same cached geometry) it is reused, so the allocation count never climbs past 1.
 */
export function ensureColorAttribute(geometry: BufferGeometry): Float32BufferAttribute {
  const position = geometry.getAttribute('position')
  const n = position.count
  const existing = geometry.getAttribute('color') as Float32BufferAttribute | undefined
  if (existing && existing.count === n) return existing

  const attr = new Float32BufferAttribute(new Float32Array(n * 3), 3)
  attr.setUsage(DynamicDrawUsage)
  geometry.setAttribute('color', attr)
  colorAllocCount++
  return attr
}

/** Histogram resolution for the robust field-scale percentile. */
export const HIST_BINS = 1024

export interface FieldScale {
  /** Absolute max |E| — can be a single-vertex near-singularity, not a real hotspot. */
  absMax: number
  /** Robust normalisation reference (high percentile of |E|). */
  peak: number
  /** 99th-percentile |E| (diagnostic). */
  p99: number
}

/**
 * Robust normalisation reference for a per-vertex |E| field.
 *
 * The analytical solver's 1/|R|³ kernel can spike at a single cortical vertex that
 * happens to lie a few mm from a coil dipole (a numerical near-singularity — the solver's
 * softening is deliberately tiny). Normalising the colour scale to that absolute max
 * washes the entire heatmap to the LUT floor (the real focal hotspot disappears). So the
 * scale is normalised to a HIGH PERCENTILE of |E| instead: the real hotspot keeps its
 * structure and the singular tail simply clamps to the top colour. O(n) via a reused
 * histogram (no per-call allocation — CLAUDE.md buffer rule).
 */
export function computeFieldScale(
  field: Float32Array,
  n: number,
  hist: Int32Array,
  percentile = 0.999,
): FieldScale {
  let absMax = 0
  for (let i = 0; i < n; i++) {
    const v = field[i]
    if (v > absMax) absMax = v
  }
  if (absMax <= 0) return { absMax: 0, peak: 0, p99: 0 }

  hist.fill(0)
  const scale = (HIST_BINS - 1) / absMax
  for (let i = 0; i < n; i++) {
    let b = (field[i] * scale) | 0
    if (b < 0) b = 0
    else if (b >= HIST_BINS) b = HIST_BINS - 1
    hist[b]++
  }
  const quantile = (p: number): number => {
    const target = p * n
    let cum = 0
    for (let b = 0; b < HIST_BINS; b++) {
      cum += hist[b]
      if (cum >= target) return (b + 1) / scale // upper edge of the bin
    }
    return absMax
  }
  return { absMax, peak: quantile(percentile), p99: quantile(0.99) }
}

/**
 * Map per-vertex |E| → colours, mutating the color attribute IN PLACE (no reallocation).
 * `max` normalises |E| to the per-pose robust peak for the relative-units scale (DESIGN
 * §3.1 step 5 / honesty gate (e)); pass the same cached `max` when only the colormap
 * changed so the scale stays stable. Values above `max` clamp to the top colour.
 */
export function applyFieldColors(
  attr: Float32BufferAttribute,
  field: Float32Array,
  max: number,
  lut: Float32Array,
): void {
  const colors = attr.array as Float32Array
  const n = attr.count
  const inv = max > 0 ? 1 / max : 0
  const last = LUT_SIZE - 1
  for (let i = 0; i < n; i++) {
    let t = field[i] * inv
    if (t <= 0) t = 0
    else if (t >= 1) t = 1
    // Round to the nearest LUT bin (the +0.5 floor); clamp guards the t===1 edge.
    let idx = (t * last + 0.5) | 0
    if (idx > last) idx = last
    const o = idx * 3
    const c = i * 3
    colors[c] = lut[o]
    colors[c + 1] = lut[o + 1]
    colors[c + 2] = lut[o + 2]
  }
  // Upload the whole (full-range) buffer via the modern API, not the deprecated
  // singular `updateRange`.
  attr.clearUpdateRanges()
  attr.addUpdateRange(0, n * 3)
  attr.needsUpdate = true
}

/**
 * The `max` to feed {@link applyFieldColors} for the EXPLAINER-ONLY fixed-scale path (v2.3, #8 —
 * "why cranking intensity doesn't move the footprint").
 *
 * The default heatmap normalises every pose to its own robust peak, so it is exactly invariant to
 * `intensity`: |E| ∝ dI/dt (see efield.ts `solve`, where `scale = -intensity`), and the per-pose
 * peak scales with it, so `field / peak` cancels intensity. The fixed-scale teaching aid instead
 * holds a FROZEN reference (`ref` — the deterministic reference-v1 peak at intensity 1) so raising
 * intensity visibly brightens the cortex. The cached field already carries the intensity it was
 * SOLVED at (`solveIntensity`); to reflect the CURRENT slider value WITHOUT a re-solve, the
 * displayed fraction must be `(field / solveIntensity) · currentIntensity / ref`, i.e. `field / max`
 * with `max = ref · solveIntensity / currentIntensity`. So a higher `currentIntensity` shrinks
 * `max`, brightening the same cached field. Returns `ref` when `currentIntensity ≤ 0` (a no-op).
 *
 * This stays in RELATIVE units and is NEVER absolute V/m — `ref` is the reference-v1 peak held fixed (gate (e)).
 */
export function fixedScaleMax(
  ref: number,
  solveIntensity: number,
  currentIntensity: number,
): number {
  return currentIntensity > 0 ? (ref * solveIntensity) / currentIntensity : ref
}

/**
 * Iso-contour fraction levels (v2.3, #14): the boundaries, as a fraction of the per-pose peak,
 * between the discrete focality bands. Vertices are posterised into the bands these levels carve
 * out, so the band edges read as iso-contours ("25 / 50 / 75 / 90 % of this-pose peak").
 */
export const CONTOUR_LEVELS = [0.25, 0.5, 0.75, 0.9] as const

/**
 * Map per-vertex |E| → DISCRETE "% of peak" focality bands (v2.3, #14), mutating the color
 * attribute IN PLACE — the SAME allocate-once attribute the smooth {@link applyFieldColors} path
 * uses, so `getColorAllocCount()` is unaffected. Each vertex's fraction `t = |E| / max` is
 * posterised to the band it falls in (the count of `levels` it meets or exceeds, 0…levels.length)
 * and coloured at that band's representative LUT position (`band ÷ levels.length`), so the brightest
 * band marks the focal core and the band boundaries read as iso-contours. Pass the absolute per-pose field
 * maximum as `max` so the bands are honestly "% of this-pose peak" (gate (e)). Above the top level the
 * fraction simply saturates into the brightest band (mirrors the smooth path's clamp).
 */
export function applyContourColors(
  attr: Float32BufferAttribute,
  field: Float32Array,
  max: number,
  lut: Float32Array,
  levels: readonly number[] = CONTOUR_LEVELS,
): void {
  const colors = attr.array as Float32Array
  const n = attr.count
  const inv = max > 0 ? 1 / max : 0
  const last = LUT_SIZE - 1
  const bandCount = levels.length // bands 0…bandCount → bandCount+1 distinct shades
  for (let i = 0; i < n; i++) {
    const t = field[i] * inv
    // Band index = how many iso-levels this vertex meets/exceeds (0 = periphery, bandCount = core).
    let band = 0
    for (let b = 0; b < bandCount; b++) if (t >= levels[b]) band++
    // Representative LUT position for the band: even steps from the floor (0) up to the peak (1).
    let idx = ((band / bandCount) * last + 0.5) | 0
    if (idx > last) idx = last
    const o = idx * 3
    const c = i * 3
    colors[c] = lut[o]
    colors[c + 1] = lut[o + 1]
    colors[c + 2] = lut[o + 2]
  }
  // Same modern full-range upload flag as applyFieldColors (no deprecated singular updateRange).
  attr.clearUpdateRanges()
  attr.addUpdateRange(0, n * 3)
  attr.needsUpdate = true
}

/**
 * CSS `linear-gradient(...)` for the HTML colour-scale legend, sampled in display sRGB
 * (the raw d3 swatches) — correct for a browser-painted gradient, unlike the linear 3D
 * LUT above. `stops` controls smoothness.
 */
export function colormapGradientCss(name: Colormap, stops = 16): string {
  const interp = interpolatorFor(name)
  const parts: string[] = []
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1)
    parts.push(`${interp(t)} ${(t * 100).toFixed(1)}%`)
  }
  return `linear-gradient(to right, ${parts.join(', ')})`
}

/**
 * CSS `linear-gradient(...)` with HARD-EDGED stops for the focality-band legend (v2.3, #14): the
 * same colormap as {@link colormapGradientCss}, posterised into the {@link CONTOUR_LEVELS} bands so
 * the legend bar mirrors the banded cortex. Each band is a single flat colour spanning its
 * percentage range (display sRGB, browser-painted — like the smooth gradient). The band colours
 * (`band ÷ levels.length`) match {@link applyContourColors}' LUT positions.
 */
export function colormapBandedGradientCss(
  name: Colormap,
  levels: readonly number[] = CONTOUR_LEVELS,
): string {
  const interp = interpolatorFor(name)
  const bandCount = levels.length
  // Percentage edges of each band: floor (0), the level boundaries, then the peak (100).
  const edges = [0, ...levels.map((l) => l * 100), 100]
  const parts: string[] = []
  for (let b = 0; b <= bandCount; b++) {
    const color = interp(b / bandCount)
    // Two stops at the same colour → a hard edge at each band boundary.
    parts.push(`${color} ${edges[b].toFixed(1)}%`, `${color} ${edges[b + 1].toFixed(1)}%`)
  }
  return `linear-gradient(to right, ${parts.join(', ')})`
}
