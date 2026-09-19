/**
 * E-field DIRECTION glyphs (Milestone v1.2, improvement #1) — an allocate-once `InstancedMesh`
 * arrow layer on the cortex that surfaces the induced-field DIRECTION the solver already computes
 * (per-vertex tangential `ex/ey/ez`, post radial-removal) and the heatmap discards. Mounted inside
 * the scene's MNI→Y-up group (so the MNI-mm glyph positions align with the cortex), gated by
 * `store.showGlyphs`.
 *
 * HONESTY — gate (e) is load-bearing here:
 *  • Arrows are CONSTANT length (a fixed cone). Length is NEVER scaled by |E| — that would imply an
 *    absolute field strength the relative-units model does not claim.
 *  • Colour always encodes the relative induced |E| (the SAME LUT + per-pose peak `st.max` as the
 *    |E| heatmap), so a glyph's hue matches the cortex in the default |E| layer. It tracks |E| even
 *    when the cortex is switched to the v1.3 residual self-error layer (the arrows are a FIELD-
 *    direction cue, independent of the surface scalar) — so it is described as "coloured by
 *    relative |E|", not "like the heatmap". Direction (orientation) ≠ neural activation — the
 *    legend + Methods copy say "direction, relative units — not activation".
 *
 * HOT PATH — the per-instance matrix + colour buffers are SEPARATE from the heatmap colour
 * attribute and are allocated ONCE (the `InstancedMesh` is created once at capacity `GLYPH_COUNT`,
 * its `instanceColor` allocated once here), then mutated in place per field reply via the
 * `glyphChannel` bus — never per frame and never reallocated, so `getColorAllocCount()` stays 1.
 * The data arrives over the worker round-trip (gated through the store), not from React state, so
 * dragging the coil never re-renders this component.
 */
import { useEffect, useRef } from 'react'
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import type { InstancedMesh } from 'three'
import { GLYPH_COUNT, GLYPH_STRIDE } from '../solver/glyphLayout'
import { LUT_SIZE } from './HeatmapMaterial'
import { applyLatestGlyphs, registerGlyphConsumer, unregisterGlyphConsumer } from './glyphChannel'

/** DEV-only handle the Playwright verification reads (mirrors `window.__stimHeatmap`): how many
 *  arrows are currently drawn, and whether the per-instance colour buffer was allocated. */
interface GlyphWindow {
  __stimGlyphs?: {
    readonly count: number
    readonly capacity: number
    readonly hasColor: boolean
  }
}

/** Arrow size in MNI mm. CONSTANT for every glyph (gate (e): length must NOT encode |E|). */
const GLYPH_LENGTH = 7
const GLYPH_RADIUS = 1.0

/** `ConeGeometry`'s axis is local +Y (apex toward +Y); we rotate +Y onto the field direction. */
const CONE_AXIS = new Vector3(0, 1, 0)

// Reused scratch — no per-glyph / per-update allocation (the allocate-once discipline).
const scratchPos = new Vector3()
const scratchDir = new Vector3()
const scratchQuat = new Quaternion()
const scratchMat = new Matrix4()
const UNIT_SCALE = new Vector3(1, 1, 1)
const ZERO_SCALE = new Vector3(0, 0, 0)
const scratchColor = new Color()

/** Write the interleaved glyph buffer into the instance matrix + colour buffers (in place). */
function writeGlyphs(
  mesh: InstancedMesh,
  glyphs: Float32Array,
  max: number,
  lut: Float32Array,
): void {
  const count = Math.min(GLYPH_COUNT, (glyphs.length / GLYPH_STRIDE) | 0)
  const inv = max > 0 ? 1 / max : 0
  const last = LUT_SIZE - 1
  const colorAttr = mesh.instanceColor
  for (let s = 0; s < count; s++) {
    const o = s * GLYPH_STRIDE
    scratchPos.set(glyphs[o], glyphs[o + 1], glyphs[o + 2])
    scratchDir.set(glyphs[o + 3], glyphs[o + 4], glyphs[o + 5])
    if (scratchDir.lengthSq() > 1e-12) {
      scratchQuat.setFromUnitVectors(CONE_AXIS, scratchDir.normalize())
      scratchMat.compose(scratchPos, scratchQuat, UNIT_SCALE)
    } else {
      // Degenerate (|E| ≈ 0) → collapse the instance so it isn't drawn as a stray dot.
      scratchMat.compose(scratchPos, scratchQuat, ZERO_SCALE)
    }
    mesh.setMatrixAt(s, scratchMat)

    // Colour through the SAME relative LUT + per-pose peak as the heatmap (gate (e)).
    let t = glyphs[o + 6] * inv
    if (t <= 0) t = 0
    else if (t >= 1) t = 1
    let idx = (t * last + 0.5) | 0
    if (idx > last) idx = last
    const c = idx * 3
    // The LUT already holds LINEAR-sRGB (three's working space), so write components straight in.
    scratchColor.setRGB(lut[c], lut[c + 1], lut[c + 2])
    if (colorAttr) colorAttr.setXYZ(s, scratchColor.r, scratchColor.g, scratchColor.b)
  }
  mesh.count = count // draw only the active instances; the buffers stay full capacity
  mesh.instanceMatrix.needsUpdate = true
  if (colorAttr) colorAttr.needsUpdate = true
}

export function EFieldGlyphs() {
  const meshRef = useRef<InstancedMesh>(null)

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    // Allocate the per-instance colour buffer ONCE (the matrix buffer is allocated by the
    // InstancedMesh itself, also once). Both are SEPARATE from the heatmap colour attribute and are
    // mutated in place — never reallocated — so getColorAllocCount() is unaffected (stays 1).
    let colorAttr = mesh.instanceColor
    if (!colorAttr) {
      colorAttr = new InstancedBufferAttribute(new Float32Array(GLYPH_COUNT * 3), 3)
      mesh.instanceColor = colorAttr
    }
    colorAttr.setUsage(DynamicDrawUsage)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.count = 0 // nothing drawn until the first field reply populates the instances

    const consumer = (glyphs: Float32Array, max: number, lut: Float32Array) =>
      writeGlyphs(mesh, glyphs, max, lut)
    registerGlyphConsumer(consumer)
    // Paint immediately from the most recent solve so toggling glyphs ON shows arrows without
    // waiting for a fresh worker round-trip (the field hasn't changed → no re-solve needed).
    applyLatestGlyphs(consumer)

    if (import.meta.env.DEV) {
      ;(window as unknown as GlyphWindow).__stimGlyphs = {
        get count() {
          return mesh.count
        },
        get capacity() {
          return GLYPH_COUNT
        },
        get hasColor() {
          return mesh.instanceColor !== null
        },
      }
    }

    return () => {
      unregisterGlyphConsumer(consumer)
      if (import.meta.env.DEV) delete (window as unknown as GlyphWindow).__stimGlyphs
    }
  }, [])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, GLYPH_COUNT]} frustumCulled={false}>
      <coneGeometry args={[GLYPH_RADIUS, GLYPH_LENGTH, 8]} />
      {/* Unlit + un-tone-mapped so each arrow reads as its pure relative-LUT colour, legibly
          distinct from the lit cortex beneath it. instanceColor multiplies this white base. */}
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}
