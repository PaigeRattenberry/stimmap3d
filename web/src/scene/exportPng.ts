/**
 * PNG snapshot export (V2-4b, improvement #19) — composite the live WebGL frame onto an offscreen 2D
 * canvas and BAKE IN the honesty framing, then download a PNG.
 *
 * GATE (a)/(e) ARE LOAD-BEARING HERE (the must-not-regress acceptance criterion). The persistent
 * `DisclaimerBanner` and the HTML `ColorScaleLegend` are DOM overlays — they are NOT part of the WebGL
 * canvas, so a raw capture of the scene would ship a bare image with no non-clinical disclaimer and no
 * relative-units label: a real gate-(a)/(e) regression in exactly the artifact meant to be shared.
 * `drawExportOverlay` therefore re-draws both, in the 2D context, onto every exported frame.
 *
 * Mechanism (per the the implementation review correction — model this on MDN `getContext`, which
 * documents `preserveDrawingBuffer`, NOT the old `toDataURL` page): the R3F `Canvas` sets
 * `preserveDrawingBuffer: true` (see `Scene.tsx`) so its backbuffer is still readable here; we
 * `drawImage` it onto a 2D canvas, overlay the text, and `canvas.toBlob(...)` to a PNG download.
 * Pure helpers (`drawExportOverlay` + the two text constants) are unit-tested with a mocked 2D context.
 */
import { deepLinkChanged } from '../ui/deepLink'
import { DISCLAIMER_LEAD } from '../ui/DisclaimerBanner'
import { useStimStore } from '../store'
import type { StimState } from '../store'

/** Gate (a): the verbatim non-clinical disclaimer lead (shared with the on-screen banner). */
export const EXPORT_DISCLAIMER = DISCLAIMER_LEAD

/** Gate (e): the DEFAULT (field-mode) relative-units label — `ColorScaleLegend`'s default title
 *  ("Induced |E| · relative units") + its "not V/m" note. `exportUnitsLabel` swaps the scalar name for
 *  the residual / focality modes so the baked caption names the scalar actually shown on the cortex. */
export const EXPORT_UNITS_LABEL = 'Induced |E| · relative units — not V/m'

/**
 * The relative-units caption to bake in for the CURRENT heatmap mode. Mirrors `ColorScaleLegend`'s
 * title PRECEDENCE (focality contours → residual → induced |E|) so an exported PNG never names the
 * wrong scalar (e.g. "Induced |E|" over a residual or contour image). Every branch keeps the gate-(e)
 * "relative units … not V/m" framing, so the honesty label holds in every mode.
 */
export function exportUnitsLabel(
  s: Pick<StimState, 'colorSource' | 'showFocalityContours'> & Partial<Pick<StimState, 'fixedScaleExplainer'>>,
): string {
  const scalar = s.colorSource === 'residual' ? 'Radial-removal residual' : 'Induced |E|'
  if (s.showFocalityContours) return scalar + ' / absolute field maximum · 25/50/75/90% bands · relative units, not V/m'
  return scalar + (s.fixedScaleExplainer ? ' / reference v1 (intensity 1)' : ' / field 99.9th percentile') + ' · relative units, not V/m'
}

/**
 * Draw the baked-in honesty overlay onto a 2D context filling a `width × height` image: a translucent
 * footer strip, then the gate-(a) disclaimer and the gate-(e) relative-units label. PURE w.r.t. app
 * state — only touches the passed context — so it is unit-testable with a mocked 2D context. Font sizes
 * scale with image width so the text stays legible on a high-DPI capture.
 */
export function drawExportOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  unitsLabel: string = EXPORT_UNITS_LABEL,
): void {
  const pad = Math.max(10, Math.round(width * 0.018))
  const leadSize = Math.max(14, Math.round(width * 0.026))
  const unitsSize = Math.max(12, Math.round(width * 0.02))
  const gap = Math.round(leadSize * 0.4)
  const leadFont = `600 ${leadSize}px system-ui, -apple-system, Segoe UI, sans-serif`
  const unitsFont = `${unitsSize}px system-ui, -apple-system, Segoe UI, sans-serif`
  // Measure with the same font used to draw. System font widths differ across platforms.
  const wrap = (text: string, font: string): string[] => {
    ctx.font = font
    const lines: string[] = []
    let line = ''
    for (const word of text.split(' ')) {
      const next = line ? line + ' ' + word : word
      if (line && ctx.measureText?.(next).width > width - 2 * pad) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
    return lines
  }
  const leadLines = wrap(EXPORT_DISCLAIMER, leadFont)
  const lines = wrap(unitsLabel, unitsFont)
  const leadHeight = leadLines.length * (leadSize + 3)
  const stripH = pad * 2 + leadHeight + gap + lines.length * (unitsSize + 3)

  ctx.save?.()
  // Translucent dark footer so the white text reads over any cortex colour underneath.
  ctx.fillStyle = 'rgba(8, 12, 26, 0.82)'
  ctx.fillRect(0, height - stripH, width, stripH)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // Gate (a): the non-clinical disclaimer (emphasised).
  ctx.fillStyle = '#ffffff'
  ctx.font = leadFont
  leadLines.forEach((text, i) => ctx.fillText(text, pad, height - stripH + pad + i * (leadSize + 3)))

  // Gate (e): the relative-units label for the active mode.
  ctx.fillStyle = '#cdd6f4'
  ctx.font = unitsFont
  lines.forEach((text, i) => ctx.fillText(text, pad, height - stripH + pad + leadHeight + gap + i * (unitsSize + 3)))

  ctx.restore?.()
}

/** Composite the source WebGL canvas onto a fresh 2D canvas with the honesty overlay baked in. */
export function compositeExport(
  source: HTMLCanvasElement,
  unitsLabel: string = EXPORT_UNITS_LABEL,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('PNG export: 2D canvas context unavailable')
  ctx.drawImage(source, 0, 0)
  drawExportOverlay(ctx, out.width, out.height, unitsLabel)
  return out
}

/** The single WebGL `<canvas>` inside the scene stage (the export button lives outside the R3F tree,
 *  so it reaches the canvas through the DOM — the cleanest seam, with no store/ref coupling). */
export function findSceneCanvas(root: ParentNode = document): HTMLCanvasElement | null {
  return root.querySelector<HTMLCanvasElement>('.scene-stage canvas')
}

/** Trigger a click-to-download of the given blob as `filename`. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser time to start consuming the download URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Export only a current rendered solve; resolve after blob creation/download initiation. */
export async function exportScenePng(
  filename = 'stimmap3d.png',
  source: HTMLCanvasElement | null = findSceneCanvas(),
  // Read the active heatmap mode ONCE, at click time (off the recolour hot path), so the baked caption
  // names the scalar actually rendered (induced |E| / residual / focality bands) — mirroring the legend.
  unitsLabel: string = exportUnitsLabel(useStimStore.getState()),
): Promise<boolean> {
  const state = useStimStore.getState()
  if (!source || state.solverStatus !== 'ready' || !state.fieldMetrics) return false
  try {
    // Let the vertex-color update reach the preserved WebGL frame before copying it.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const current = useStimStore.getState()
    if (current.solverStatus !== 'ready' || current.fieldMetrics !== state.fieldMetrics ||
        deepLinkChanged(current, state) || document.querySelector('.stage-error')) return false
    const out = compositeExport(source, unitsLabel)
    const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'))
    if (!blob) return false
    downloadBlob(blob, filename)
    return true
  } catch { return false }
}
