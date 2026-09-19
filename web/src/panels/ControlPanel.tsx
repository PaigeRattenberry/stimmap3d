/**
 * Targeting + field controls (Milestone 4), bound to the Zustand store. A hand-rolled
 * React panel (DESIGN §2 allows `leva` or a hand-built panel) styled to match the dark
 * theme and the `ColorScaleLegend` overlay.
 *
 * WIRING (all through the store — the panel never touches the scene/solver directly):
 *  • PRESET buttons → `setPreset`, which bumps the store's `placementSeq`. `TMSCoil` reacts to
 *    that request, projects the preset's MNI target onto the scalp, and `setCoilPose`s it; the
 *    heatmap then re-solves automatically (see useEFieldHeatmap's transient subscription). One
 *    click → coil snaps — and re-clicking the already-active preset re-snaps a dragged coil.
 *  • COLORMAP toggle → `setColormap`. Wired in M3: re-maps the cached field through the new
 *    LUT (no re-solve) and the legend re-renders.
 *  • INTENSITY slider → `setIntensity` (relative dI/dt). HONESTY NOTE: the cortex heatmap is
 *    intentionally INVARIANT to intensity — |E| is linear in dI/dt and the colour scale is
 *    the robust per-pose peak of that same field, so 2× intensity → 2× peak → identical
 *    normalised colours (see useEFieldHeatmap header). Intensity scales DOSE, surfaced in the
 *    dose–response panel; it does not reshape the relative-units footprint. Labeled as such.
 *  • STAND-OFF slider → `setCoilPose({ standoff })`: lifts the coil off the scalp (a real,
 *    visible gap).
 *  • TILT slider → `setTilt` (degrees): cants the coil off the scalp about the target. Tilt is a
 *    DEDICATED store scalar (not `coilPose.rotation`, which a preset re-snap overwrites) composed
 *    onto the pose by `composeTilt`, so it survives re-snaps and reaches BOTH the rendered coil and
 *    the solver. Modeled as increased effective coil-to-cortex distance → the depth–dose readout in
 *    `FieldMetricsCard` deepens d½, broadens S½, and changes relative field magnitude as tilt rises (v1.1).
 *  We deliberately expose tilt/stand-off, NOT free X/Y/Z position sliders — those would let the
 *  coil leave the scalp and bypass the projection (placement stays the job of presets + drag).
 */
import { INTENSITY, STANDOFF, TILT } from '../domains'
import { useStimStore, COLORMAP_LABELS } from '../store'
import type { Colormap, ColorSource } from '../store'
import { PRESETS } from '../data/presets'
import { getCitation } from '../data/citations'
import { PresetRadioGroup } from './PresetRadioGroup'

// COLORMAP_LABELS lives with the Colormap union in store.ts (its single source, shared with the print
// one-pager). The toggle order is just its key order.
const COLORMAPS = Object.keys(COLORMAP_LABELS) as Colormap[]

// Keyed by the ColorSource union (same lock-step discipline) — adding a source forces a label.
const COLOR_SOURCE_LABELS: Record<ColorSource, string> = {
  field: 'Induced |E|',
  residual: 'Approx. residual',
}
const COLOR_SOURCES = Object.keys(COLOR_SOURCE_LABELS) as ColorSource[]

const STANDOFF_MIN = STANDOFF.min
const STANDOFF_MAX = STANDOFF.max
const INTENSITY_MIN = INTENSITY.min
const INTENSITY_MAX = INTENSITY.max
const TILT_MIN = TILT.min
const TILT_MAX = TILT.max

export function ControlPanel() {
  const preset = useStimStore((s) => s.preset)
  const intensity = useStimStore((s) => s.intensity)
  const setIntensity = useStimStore((s) => s.setIntensity)
  const colormap = useStimStore((s) => s.colormap)
  const setColormap = useStimStore((s) => s.setColormap)
  const colorSource = useStimStore((s) => s.colorSource)
  const setColorSource = useStimStore((s) => s.setColorSource)
  const fixedScaleExplainer = useStimStore((s) => s.fixedScaleExplainer)
  const setFixedScaleExplainer = useStimStore((s) => s.setFixedScaleExplainer)
  const showFocalityContours = useStimStore((s) => s.showFocalityContours)
  const setShowFocalityContours = useStimStore((s) => s.setShowFocalityContours)
  const showGlyphs = useStimStore((s) => s.showGlyphs)
  const setShowGlyphs = useStimStore((s) => s.setShowGlyphs)
  const standoff = useStimStore((s) => s.coilPose.standoff)
  const setCoilPose = useStimStore((s) => s.setCoilPose)
  const tilt = useStimStore((s) => s.tilt)
  const setTilt = useStimStore((s) => s.setTilt)
  const showTargetCompare = useStimStore((s) => s.showTargetCompare)
  const setShowTargetCompare = useStimStore((s) => s.setShowTargetCompare)
  const showElectrodeMarkers = useStimStore((s) => s.showElectrodeMarkers)
  const setShowElectrodeMarkers = useStimStore((s) => s.setShowElectrodeMarkers)
  const reset = useStimStore((s) => s.reset)

  const active = PRESETS.find((p) => p.id === preset)
  const citation = active?.citationId ? getCitation(active.citationId) : undefined

  return (
    <aside className="control-panel" aria-label="Coil targeting and field controls" data-tour="controls">
      {/* --- Targeting presets --- */}
      <section className="control-group">
        <h2 className="control-group__title">Targeting preset</h2>
        {/* #32: a roving-tabindex radiogroup (APG radio pattern) — single-select presets are a radio
            group, not independent aria-pressed toggles. Same setPreset behaviour + visuals. */}
        <PresetRadioGroup />
        {active && (
          <p className="control-hint">
            <strong>{active.label}.</strong> {active.description}
            {citation && (
              <>
                {' '}
                <a href={citation.url} target="_blank" rel="noreferrer">
                  Source ↗
                </a>
              </>
            )}
          </p>
        )}
      </section>

      {/* --- Intensity (relative dI/dt) --- */}
      <section className="control-group">
        <div className="control-group__row">
          <label className="control-group__title" htmlFor="intensity">
            Intensity
          </label>
          <output className="control-value" htmlFor="intensity">
            {intensity.toFixed(2)}×
          </output>
        </div>
        <input
          id="intensity"
          type="range"
          min={INTENSITY_MIN}
          max={INTENSITY_MAX}
          step={0.05}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
        />
        <p className="control-hint control-hint--muted">
          Relative dI/dt (arbitrary units). Scales the <em>dose</em> (see the dose–response panel) — the
          per-pose relative-units heatmap is normalised, so its <em>shape doesn&apos;t change</em>.
        </p>
      </section>

      {/* --- Intensity explainer (v2.3, #8): the fixed-scale teaching aid, beside the slider --- */}
      <section className="control-group">
        <h2 className="control-group__title">Why intensity keeps the footprint</h2>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={fixedScaleExplainer}
            onChange={(e) => setFixedScaleExplainer(e.target.checked)}
          />
          <span>Fixed-scale intensity explainer</span>
        </label>
        <p className="control-hint control-hint--muted">
          The default heatmap re-normalises each pose to its field’s 99.9th percentile, so the <em>shape never
          moves</em> with intensity (|E| ∝ dI/dt — the field and its scale scale together). Turn this
          on to map |E| against a <strong>deterministic reference v1 at intensity 1</strong> instead: now raising intensity{' '}
          <strong>visibly brightens</strong> the cortex. A teaching aid only — still{' '}
          <strong>relative units, never V/m</strong>.
        </p>
      </section>

      {/* --- Colormap --- */}
      <section className="control-group">
        <h2 className="control-group__title">Colormap</h2>
        <div className="segmented" role="group" aria-label="Heatmap colormap">
          {COLORMAPS.map((c) => (
            <button
              key={c}
              type="button"
              className={`segmented__btn${c === colormap ? ' segmented__btn--active' : ''}`}
              aria-pressed={c === colormap}
              onClick={() => setColormap(c)}
            >
              {COLORMAP_LABELS[c]}
            </button>
          ))}
        </div>
      </section>

      {/* --- Heatmap layer (v1.3, #13): induced |E| vs the radial-removal self-error residual --- */}
      <section className="control-group">
        <h2 className="control-group__title">Heatmap layer</h2>
        <div className="segmented" role="group" aria-label="Heatmap colour source">
          {COLOR_SOURCES.map((src) => (
            <button
              key={src}
              type="button"
              className={`segmented__btn${src === colorSource ? ' segmented__btn--active' : ''}`}
              aria-pressed={src === colorSource}
              onClick={() => setColorSource(src)}
            >
              {COLOR_SOURCE_LABELS[src]}
            </button>
          ))}
        </div>
        <p className="control-hint control-hint--muted">
          Switch the cortex map to the <strong>radial-removal residual</strong> — the magnitude the
          spherical approximation strips out at each vertex (≈0 directly under the coil, growing
          where the cortex curves away from the best-fit sphere). Same colour scale, in{' '}
          <strong>relative units</strong> — an <strong>approximation residual, not a validated
          error</strong> (see Methods).
        </p>
      </section>

      {/* --- Focality contours (v2.3, #14): iso-contour bands + peak marker --- */}
      <section className="control-group">
        <h2 className="control-group__title">Focality contours</h2>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showFocalityContours}
            onChange={(e) => setShowFocalityContours(e.target.checked)}
          />
          <span>Show iso-contour bands &amp; peak marker</span>
        </label>
        <p className="control-hint control-hint--muted">
          Posterises the cortex into <strong>25 / 50 / 75 / 90 % of this-pose peak</strong> bands (the
          band edges are the iso-contours) and pins the peak vertex — making focality visible and
          comparable across presets. Relative units — <strong>% of peak, not V/m</strong>.
        </p>
      </section>

      {/* --- E-field direction glyphs (v1.2): arrows for the induced-field DIRECTION --- */}
      <section className="control-group">
        <h2 className="control-group__title">Field direction</h2>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showGlyphs}
            onChange={(e) => setShowGlyphs(e.target.checked)}
          />
          <span>Show E-field direction glyphs</span>
        </label>
        <p className="control-hint control-hint--muted">
          Constant-length arrows on the cortex marking the induced-field <em>direction</em>, coloured
          by relative induced <em>|E|</em> — orientation, <strong>not</strong> neural activation.
        </p>
      </section>

      {/* --- Stand-off gap --- */}
      <section className="control-group">
        <div className="control-group__row">
          <label className="control-group__title" htmlFor="standoff">
            Stand-off gap
          </label>
          <output className="control-value" htmlFor="standoff">
            {standoff.toFixed(0)} mm
          </output>
        </div>
        <input
          id="standoff"
          type="range"
          min={STANDOFF_MIN}
          max={STANDOFF_MAX}
          step={1}
          value={standoff}
          onChange={(e) => setCoilPose({ standoff: Number(e.target.value) })}
        />
        <p className="control-hint control-hint--muted">
          Coil-to-scalp gap (mm). Placement stays on the scalp — drag the coil or pick a preset
          to move it.
        </p>
      </section>

      {/* --- Coil tilt (v1.1): cants the coil; drives the depth–dose readout --- */}
      <section className="control-group">
        <div className="control-group__row">
          <label className="control-group__title" htmlFor="tilt">
            Coil tilt
          </label>
          <output className="control-value" htmlFor="tilt">
            {tilt.toFixed(0)}°
          </output>
        </div>
        <input
          id="tilt"
          type="range"
          min={TILT_MIN}
          max={TILT_MAX}
          step={1}
          value={tilt}
          onChange={(e) => setTilt(Number(e.target.value))}
        />
        <p className="control-hint control-hint--muted">
          Cants the coil off the scalp about the target — modeled as a larger effective
          coil-to-cortex distance: deeper half-value depth, broader focal spread, lower % output
          (see the depth–dose readout). Survives preset re-snaps.
        </p>
      </section>

      {/* --- Targeting-debate overlay (M6): F3 vs connectivity, live straight-line gap --- */}
      <section className="control-group">
        <h2 className="control-group__title">Targeting debate</h2>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showTargetCompare}
            onChange={(e) => setShowTargetCompare(e.target.checked)}
          />
          <span>Compare F3 vs connectivity</span>
        </label>
        <p className="control-hint control-hint--muted">
          Draws both coil centres on the scalp and their straight-line gap — derived live from the
          preset coordinates (Euclidean, not geodesic).
        </p>
      </section>

      {/* --- Targeting markers (V2-1, #6 + C2): 10-20 dots, DLPFC label, schematic sgACC cue --- */}
      <section className="control-group">
        <h2 className="control-group__title">Targeting markers</h2>
        <label className="control-toggle">
          <input
            type="checkbox"
            checked={showElectrodeMarkers}
            onChange={(e) => setShowElectrodeMarkers(e.target.checked)}
          />
          <span>Show 10-20 sites &amp; DLPFC→sgACC cue</span>
        </label>
        <p className="control-hint control-hint--muted">
          Labelled F3/F4/Fz/Cz dots on the scalp, plus the DLPFC node and a <strong>schematic</strong>{' '}
          cue down to the deep subgenual-ACC (sgACC) seed it anticorrelates with —{' '}
          <strong>illustrative, not a computed connectome</strong> (Fox 2012).
        </p>
      </section>

      <button type="button" className="control-reset" onClick={reset}>
        Reset to defaults
      </button>
    </aside>
  )
}
