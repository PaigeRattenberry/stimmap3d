/**
 * Labeled E-field colour scale (Milestone 3) — honesty gate (e): the heatmap is shown in
 * clearly-labeled RELATIVE units, never V/m. An HTML overlay (not in the WebGL canvas) so
 * the gradient is crisp and the text is selectable/accessible. It reads `store.colormap`
 * so the bar always matches the active LUT (viridis default, turbo optional).
 *
 * The field is normalised to its robust per-pose peak (a high percentile of |E|, so a
 * single near-singular vertex can't wash out the scale — see HeatmapMaterial), so the bar
 * runs 0 → peak in arbitrary units and communicates *relative* hotspot structure, not dose.
 */
import { useStimStore } from '../store'
import { colormapBandedGradientCss, colormapGradientCss } from './HeatmapMaterial'

export function ColorScaleLegend() {
  const colormap = useStimStore((s) => s.colormap)
  const showGlyphs = useStimStore((s) => s.showGlyphs)
  const residual = useStimStore((s) => s.colorSource) === 'residual'
  // v2.3 honesty labels (gate (e)): the contour overlay reads "% of this-pose peak"; the fixed-scale
  // explainer is unmistakably a frozen teaching scale, never per-pose-normalised and never V/m.
  const contours = useStimStore((s) => s.showFocalityContours)
  const fixedScale = useStimStore((s) => s.fixedScaleExplainer)
  const gradient = contours ? colormapBandedGradientCss(colormap) : colormapGradientCss(colormap)

  const ariaWhat = contours
    ? (residual ? 'Residual bands (% of absolute field peak)' : 'Focality iso-contour bands (% of this-pose peak)')
    : residual
      ? 'Radial-removal residual'
      : 'Induced E-field magnitude'

  return (
    <div
      className="color-scale"
      role="img"
      aria-label={`${ariaWhat} colour scale (${colormap}), relative units, not clinical`}
    >
      <div className="color-scale__title">
        {contours
          ? (residual ? 'Residual · % of field peak' : 'Focality · % of this-pose peak')
          : residual
            ? 'Approx. residual · relative units'
            : 'Induced |E| · relative units'}
      </div>
      <div className="color-scale__bar" style={{ background: gradient }} aria-hidden="true" />
      <div className="color-scale__ticks" aria-hidden="true">
        <span>0</span>
        <span>{contours ? '50%' : 'low'}</span>
        <span>{contours ? '90%' : 'high'}</span>
        <span>{contours ? '100%' : fixedScale ? 'reference' : '99.9%'}</span>
      </div>
      {contours ? (
        <p className="color-scale__note">
          {residual ? 'Radial-removal residual' : 'Induced |E|'} bands at <strong>25 / 50 / 75 / 90 %</strong> of this pose&apos;s absolute maximum
          |E| — relative units, <strong>not V/m</strong>. The marker pins the induced-field maximum, including in residual mode.
        </p>
      ) : fixedScale ? (
        <p className="color-scale__note">
          <strong>Fixed reference scale (teaching aid)</strong> — reference v1 at intensity 1, held across pose/intensity so
          raising intensity visibly brightens the cortex. Relative units,{' '}
          <strong>not per-pose normalised, not V/m</strong>.
        </p>
      ) : (
        <p className="color-scale__note">
          Arbitrary / relative units, normalised to the induced field’s 99.9th percentile per pose — <strong>not clinical, not V/m</strong>.
        </p>
      )}
      {residual && (
        <p className="color-scale__note">
          {/* The residual always rides whatever scale the |E| layer currently uses (the per-pose
              peak by default, the frozen reference under the fixed-scale explainer, banded under
              contours) — so this wording stays accurate in every mode, not just the per-pose one. */}
          Radial component removed per vertex, on the <strong>same scale as the |E| layer</strong> —{' '}
          <strong>approximation residual, not a validated error</strong>.
        </p>
      )}
      {showGlyphs && (
        <p className="color-scale__note">
          Arrows show the induced-field <strong>direction</strong> (relative units) —{' '}
          <strong>not activation</strong>.
        </p>
      )}
    </div>
  )
}
