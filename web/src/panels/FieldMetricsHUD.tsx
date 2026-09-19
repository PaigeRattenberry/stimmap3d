/**
 * Depth–dose HUD (Milestone v1.1) — the compact, glanceable copy of the depth–dose readout, pinned
 * to the top-right corner of the scene (the colour legend owns top-left). It keeps the live d½ / S½
 * visible WHILE the user drags the tilt / stand-off slider — something the in-flow
 * `FieldMetricsCard` under the scene can't do on a short viewport.
 *
 * The detailed `FieldMetricsCard` remains the annotated / honesty source of truth (full caveat and
 * citations); this HUD carries only the numbers + the "illustrative · relative" tag (gate (e)
 * inline) from the SAME store slice. `aria-hidden` — the card is the accessible copy. Wide-screen
 * only (CSS hides it < 980px, where the card flows under the scene as the baseline).
 */
import { useStimStore } from '../store'

export function FieldMetricsHUD() {
  const metrics = useStimStore((s) => s.fieldMetrics)
  return (
    <div className="field-metrics-hud" aria-hidden="true">
      <div className="field-metrics-hud__head">
        <span className="field-metrics-hud__title">Depth–dose</span>
        <span className="field-metrics-hud__tag">illustrative · relative</span>
      </div>
      <div className="field-metrics-hud__rows">
        <div className="field-metrics-hud__row">
          <span className="field-metrics-hud__key">d½</span>
          <span className="field-metrics-hud__val">{metrics ? `${metrics.hvd.toFixed(1)} mm` : '—'}</span>
        </div>
        <div className="field-metrics-hud__row">
          <span className="field-metrics-hud__key">S½</span>
          <span className="field-metrics-hud__val">{metrics ? `${metrics.spread.toFixed(1)} mm` : '—'}</span>
        </div>
      </div>
    </div>
  )
}
