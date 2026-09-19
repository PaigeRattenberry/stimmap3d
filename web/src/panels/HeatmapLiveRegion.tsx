/**
 * Screen-reader live region narrating the heatmap RESULT (V2-5, improvement #34).
 *
 * The cortex heatmap is a WebGL canvas — invisible to assistive tech — and its two visible readouts
 * don't reach a screen-reader on update: `FieldMetricsHUD` is `aria-hidden`, and `FieldMetricsCard` is
 * static text (re-rendered, but a non-live region is not announced when its numbers change). So a SR
 * user gets no signal that the field re-solved. This polite `aria-live` region closes that gap: it
 * speaks a one-sentence summary of the finding every time `store.fieldMetrics` is published (each
 * settled solve), WITHOUT double-speaking the card — it is the ONLY `aria-live` surface for the result.
 *
 * HONESTY (gate (e)): the narration speaks "relative units", reports d½/S½ as ILLUSTRATIVE millimetres,
 * and NEVER says V/m or "activation" — the same framing as the on-screen legend/card it voices. It
 * introduces no new number (it reads the already-published `fieldMetrics`).
 *
 * It is visually hidden (`.sr-only`) — sighted users already have the legend, HUD, and card — and lives
 * OUTSIDE the scene's `ErrorBoundary`, so a WebGL/mesh failure can't strip the announcement. It reads
 * the store reactively, but only the small live-region text re-renders (it never touches the recolour
 * hot path), so the "no re-render on drag" invariant for the scene is untouched.
 */
import { useStimStore } from '../store'
import type { ColorSource, FieldMetricsReadout, Preset } from '../store'
import { presetLabel } from '../data/presets'

/** Context the narration needs beyond the metrics — what layer/scale the cortex currently shows. */
export interface HeatmapNarrationContext {
  preset: Preset
  colorSource: ColorSource
  showFocalityContours: boolean
  fixedScaleExplainer: boolean
}

/**
 * The sentence the live region speaks for the current result. PURE (no store / DOM) so the wording —
 * and the gate-(e) guarantees ("relative units", never "V/m", never "activation") — are unit-tested.
 * Mirrors the legend's layer precedence (focality contours → residual → induced |E|) so the spoken
 * scalar always matches what is painted on the cortex.
 */
export function describeHeatmapResult(
  metrics: FieldMetricsReadout | null,
  ctx: HeatmapNarrationContext,
): string {
  if (!metrics) {
    return 'Induced-field heatmap: no field yet. Place the coil with a preset or by dragging it across the scalp to compute the field.'
  }

  // What scalar + scale is on the cortex right now (matches ColorScaleLegend's precedence). The |E|
  // and residual layers share ONE scale — the per-pose peak by default, or the fixed reference scale
  // under the teaching-aid toggle — exactly as the legend's residual note promises ("same scale as the
  // |E| layer"), so the scale phrase is derived once and reused. Contours carry their own per-pose-% scale.
  const scale = ctx.fixedScaleExplainer
    ? 'on a fixed reference scale (a teaching aid)'
    : 'normalised to this pose’s peak'

  let layer: string
  if (ctx.showFocalityContours) {
    layer = 'focality iso-contour bands, as a percentage of this pose’s peak'
  } else if (ctx.colorSource === 'residual') {
    layer = `the radial-removal residual — an approximation residual, not a validated error — in relative units, ${scale}`
  } else {
    layer = `induced field magnitude in relative units, ${scale}`
  }

  const hvd = metrics.hvd.toFixed(1)
  const spread = metrics.spread.toFixed(1)

  return (
    `Heatmap updated for the ${presetLabel(ctx.preset)} preset. Showing ${layer}. ` +
    `Illustrative half-value depth ${hvd} mm and focal spread ${spread} mm — ` +
    `relative units, not validated millimetres or volts per metre.`
  )
}

export function HeatmapLiveRegion() {
  const metrics = useStimStore((s) => s.fieldMetrics)
  const preset = useStimStore((s) => s.preset)
  const colorSource = useStimStore((s) => s.colorSource)
  const showFocalityContours = useStimStore((s) => s.showFocalityContours)
  const fixedScaleExplainer = useStimStore((s) => s.fixedScaleExplainer)

  const message = describeHeatmapResult(metrics, {
    preset,
    colorSource,
    showFocalityContours,
    fixedScaleExplainer,
  })

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
