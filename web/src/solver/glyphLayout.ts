/**
 * Shared E-field DIRECTION-glyph buffer layout (Milestone v1.2, improvement #1).
 *
 * Imported by BOTH the solver (`efield.ts` packs the interleaved buffer) and the scene
 * (`EFieldGlyphs.tsx` unpacks it + sizes the allocate-once `InstancedMesh`), so the producer and
 * consumer can never drift. Kept dependency-free so importing it onto the main thread pulls in no
 * solver/worker code.
 *
 * Each glyph is GLYPH_STRIDE consecutive Float32s:
 *   [0,1,2]  surface position (MNI mm), lifted slightly off the cortex so arrows don't z-fight it
 *   [3,4,5]  UNIT tangential field direction (post radial-removal); (0,0,0) ⇒ hide that instance
 *   [6]      raw |E| (relative units) — coloured through the SAME LUT + per-pose peak as the heatmap
 */

/** Floats per glyph: position(3) + unit direction(3) + |E|(1). */
export const GLYPH_STRIDE = 7

/**
 * Max arrows: the allocate-once `InstancedMesh` capacity AND the solver's top-N selection cap.
 * A few hundred is plenty to read the field direction over the focal patch without clutter.
 */
export const GLYPH_COUNT = 220
