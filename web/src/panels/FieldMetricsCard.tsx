/**
 * Depth–dose readout card (Milestone v1.1).
 *
 * Makes the depth–focality tradeoff tangible: as the coil is canted (tilt) or raised (stand-off),
 * the half-value depth d½ sinks deeper and the on-surface focal spread S½ broadens. d½/S½ are
 * published by the heatmap worker each solve (`store.fieldMetrics`). No machine-output percentage
 * is calculated: Stokes 2005 is cited only for the compensatory direction (more output needed at
 * greater distance), and the 0.32 mm/degree tilt lift is an authored heuristic.
 *
 * HONESTY (gate (e)): every number here is a SURFACE-DERIVED, RELATIVE/ILLUSTRATIVE quantity from
 * the analytical (non-FEM) spherical approximation — never a validated cm or V·m.
 */
import { useStimStore } from '../store'
import { CitationLink } from '../ui/CitationLink'

export function FieldMetricsCard() {
  const metrics = useStimStore((s) => s.fieldMetrics)
  return (
    <section className="field-metrics-card" aria-label="Depth–dose readout" data-tour="field-metrics">
      <div className="field-metrics-card__head">
        <h2 className="field-metrics-card__title">Depth–dose readout</h2>
        <span className="field-metrics-card__badge">illustrative · relative</span>
      </div>

      <div className="field-metrics-grid">
        <div className="field-metric">
          <span className="field-metric__label">
            Half-value depth <em>d½</em>
          </span>
          <span className="field-metric__value">
            {metrics ? `${metrics.hvd.toFixed(1)} mm` : '—'}
          </span>
          <span className="field-metric__sub">depth where |E| halves</span>
        </div>
        <div className="field-metric">
          <span className="field-metric__label">
            Focal spread <em>S½</em>
          </span>
          <span className="field-metric__value">
            {metrics ? `${metrics.spread.toFixed(1)} mm` : '—'}
          </span>
          <span className="field-metric__sub">on-surface mean spread</span>
        </div>
      </div>

      <p className="field-metrics-card__hint">
        Change tilt or stand-off to explore the computed depth and spread. These are relative shape measures, not delivered dose.
        {!metrics && ' Place the coil (drag or a preset) to compute d½ and S½.'}
      </p>

      <p className="field-metrics-card__caveat">
        Surface-derived approximation — illustrative, relative units,{' '}
        <strong>not validated cm or V·m</strong>. d½ and S½ come from the analytical (non-FEM)
        spherical field — S½ is an on-surface mean half-max spread, <em>not</em> Deng&rsquo;s V½/d½
        focality area. Stokes studied the additional stimulator output needed to maintain equivalent motor-cortex stimulation as distance increases; this app does not calculate machine settings. The tilt lift (0.32 mm/degree) is an authored heuristic, not derived from Stokes or Deng.
      </p>
      <p className="field-metrics-card__sources">
        <CitationLink id="deng-2013-depth-focality" /> ·{' '}
        <CitationLink id="stokes-2005-output-distance" />
      </p>
    </section>
  )
}
