/**
 * Glyph data channel (Milestone v1.2, improvement #1).
 *
 * A tiny module-level bus carrying the worker's per-pose E-field DIRECTION buffer from
 * `useEFieldHeatmap` (which owns the worker) to the `EFieldGlyphs` `InstancedMesh` layer —
 * deliberately NOT through the Zustand store: a per-pose Float32 buffer must never trigger a React
 * re-render on the drag hot path (the same reason the heatmap mutates its colour attribute
 * imperatively). One producer (the heatmap hook), one consumer (the glyph layer, mounted only when
 * the toggle is on). The latest payload is cached so a glyph layer that mounts LATER (the toggle is
 * OFF by default) paints immediately from the most recent solve instead of waiting for a fresh
 * worker round-trip.
 */

/** Imperative sink: `(interleaved glyph buffer, per-pose robust peak, colormap LUT)`. */
export type GlyphConsumer = (glyphs: Float32Array, max: number, lut: Float32Array) => void

let consumer: GlyphConsumer | null = null
let latestGlyphs: Float32Array | null = null
let latestMax = 0
let latestLut: Float32Array | null = null

/** Publish the latest glyph buffer (+ its normalisation peak and active LUT); caches it and, if a
 *  glyph layer is mounted, paints it now. */
export function publishGlyphs(glyphs: Float32Array, max: number, lut: Float32Array): void {
  latestGlyphs = glyphs
  latestMax = max
  latestLut = lut
  consumer?.(glyphs, max, lut)
}

export function registerGlyphConsumer(c: GlyphConsumer): void {
  consumer = c
}

export function unregisterGlyphConsumer(c: GlyphConsumer): void {
  if (consumer === c) consumer = null
}

/** Paint `c` from the cached latest payload (if any) — used on mount so toggling glyphs ON shows
 *  arrows from the most recent solve without forcing a re-solve. */
export function applyLatestGlyphs(c: GlyphConsumer): void {
  if (latestGlyphs && latestLut) c(latestGlyphs, latestMax, latestLut)
}

/** Drop the cached payload when the heatmap unmounts (geometry change): a stale buffer is in the
 *  old mesh's MNI frame and must not paint onto a freshly loaded cortex. */
export function clearGlyphs(): void {
  latestGlyphs = null
  latestLut = null
  latestMax = 0
}
