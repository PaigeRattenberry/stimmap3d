/**
 * Printable one-page summary (V2-7b, improvement C6).
 *
 * THE C2 HAZARD, HANDLED: the persistent App.tsx <DisclaimerBanner> is the only disclaimer surface,
 * and a print layout can silently drop it — exactly the leak the V2-4b PNG export also had to close.
 * This block is a SELF-CONTAINED share artifact: it bakes the load-bearing framing directly into the
 * printed page so it survives even if the on-screen banner is stripped —
 *   (a) the verbatim non-clinical disclaimer — the {@link DISCLAIMER_LEAD} lead (also baked into the
 *       PNG export) followed by the shared {@link DisclaimerBody}, i.e. the EXACT prose the on-screen
 *       banner renders, not a paraphrase that could drift,
 *   (d) a "Synthetic" badge on the outcome-data line, and
 *   (e) the "relative units, not V/m" label on the E-field line.
 *
 * It is `display:none` on screen (App.css) and revealed only inside `@media print`, where the rest of
 * the interactive chrome is hidden — so the printout is a clean config + methods + provenance handout.
 * It reads the live store config so the sheet matches what the viewer has on screen.
 *
 * `aria-hidden` because it is a redundant print-only mirror of on-screen content — it must not add a
 * duplicate disclaimer to the screen-reader tree (the real banner already serves AT). The automated
 * share-artifact assertion lives in PrintSummary.test.tsx, which asserts the three baked-in
 * strings render.
 */
import { DISCLAIMER_LEAD, DisclaimerBody } from '../ui/DisclaimerBanner'
import { useStimStore, COLORMAP_LABELS } from '../store'
import { presetLabel } from '../data/presets'
import { getProtocolData } from '../data/trials'
import { METHOD_ONELINER } from './methodSummary'

export function PrintSummary() {
  const preset = useStimStore((s) => s.preset)
  const protocol = useStimStore((s) => s.protocol)
  const intensity = useStimStore((s) => s.intensity)
  const colormap = useStimStore((s) => s.colormap)
  const tilt = useStimStore((s) => s.tilt)
  const standoff = useStimStore((s) => s.coilPose.standoff)

  const protocolLabel = getProtocolData(protocol)?.longLabel ?? protocol

  return (
    <section className="print-summary" aria-hidden="true">
      <header className="print-summary__head">
        <h2 className="print-summary__title">StimMap3D — configuration summary</h2>
        {/* Gate (a), single-sourced: the lead constant + the shared <DisclaimerBody> — the EXACT same
            prose the on-screen banner shows, so the printed handout can never drift from it. */}
        <p className="print-summary__disclaimer">
          <strong>{DISCLAIMER_LEAD}</strong> <DisclaimerBody />
        </p>
      </header>

      <dl className="print-summary__config">
        <div>
          <dt>Coil placement</dt>
          <dd>{presetLabel(preset)}</dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd>{protocolLabel}</dd>
        </div>
        <div>
          <dt>Relative intensity (dI/dt)</dt>
          <dd>{intensity.toFixed(2)}× — arbitrary units</dd>
        </div>
        <div>
          <dt>Colormap</dt>
          <dd>{COLORMAP_LABELS[colormap]}</dd>
        </div>
        <div>
          <dt>Coil tilt</dt>
          <dd>{tilt.toFixed(0)}°</dd>
        </div>
        <div>
          <dt>Stand-off gap</dt>
          <dd>{standoff.toFixed(0)} mm</dd>
        </div>
      </dl>

      <p className="print-summary__line">
        <strong>E-field:</strong> shown in <strong>relative units — not calibrated V/m</strong>, and
        as field magnitude or radial-removal residual, not neural activation. No machine-output percentage is calculated. Tilt uses an authored 0.32 mm/degree lift heuristic.
      </p>
      <p className="print-summary__line">
        <strong>Outcome data:</strong>{' '}
        <span className="print-summary__badge">Synthetic</span> — every per-patient trajectory is
        synthetic, generated from published summary statistics; odds ratios are relative to sham and
        converted against a labelled baseline, never mixed with absolute rates.
      </p>

      <p className="print-summary__methods">
        {/* The authoritative §3.2 one-liner, restated VERBATIM from its single source (MethodsPage's
            METHOD_ONELINER) — not paraphrased — so the printout can never drift from the spec. */}
        <strong>Method.</strong> {METHOD_ONELINER}
      </p>

      <p className="print-summary__prov">
        <strong>Provenance.</strong> Every clinical figure and asset cites its open-literature
        source and license in the in-app ledger (the <code>#/sources</code> page and{' '}
        <code>web/src/data/citations.json</code>). Full methods &amp; limitations: the{' '}
        <code>#/methods</code> page.
      </p>
    </section>
  )
}
