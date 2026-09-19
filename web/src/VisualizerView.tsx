/**
 * The hero visualizer route (Milestones 3–4), split out of `App` in a loading pass so the
 * graphics/chart bundle is a LAZY chunk: a direct `#/methods` or `#/sources` visit never downloads
 * the scene, the solver worker or the meshes. `App` owns the honesty layer (banner/header/footer)
 * and the routing; everything below is the visualizer itself.
 */
import { lazy, Suspense } from 'react'
import { ControlPanel } from './panels/ControlPanel'
import { FieldMetricsCard } from './panels/FieldMetricsCard'
import { FieldMetricsHUD } from './panels/FieldMetricsHUD'
import { HeatmapLiveRegion } from './panels/HeatmapLiveRegion'
import { CoilKeyboardControl } from './ui/CoilKeyboardControl'
import { MethodExplainers } from './panels/MethodExplainers'
import { SceneFailure, SolverStatus } from './scene/SceneFailure'
import { Scene } from './scene/Scene'
import { ColorScaleLegend } from './scene/ColorScaleLegend'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { FirstRunCard } from './ui/FirstRunCard'
import { ShareBar } from './ui/ShareBar'
import { GuidedTour } from './panels/GuidedTour'
import { useStimStore } from './store'

const AnalyticsPanel = lazy(() => import('./panels/AnalyticsPanel').then(m => ({ default: m.AnalyticsPanel })))

/** Fallback when the WebGL scene / cortical mesh fails to load (gate (a)'s banner is unaffected). */
function SceneErrorState() { return <SceneFailure /> }

/** Fallback when the dose–response panel fails to render. */
function PanelErrorState() {
  return (
    <div className="panel-error" role="alert">
      <p className="stage-error__title">The dose–response panel couldn’t render.</p>
      <p>
        The synthetic analytics failed to draw. The 3-D visualizer above is unaffected; reload to
        retry.
      </p>
    </div>
  )
}

/**
 * Hero view (Milestones 3–4): the orbitable 3D brain + semi-transparent scalp, a draggable
 * figure-8 coil, and the live E-field heatmap with a labeled relative-units colour scale —
 * now with the M4 targeting `ControlPanel` (presets + intensity + colormap) beside the
 * scene and the `MethodExplainers` cards below. All three read/write the shared Zustand
 * store. The honesty layer (banner/header/footer) is owned by `App`, untouched here.
 */
export function VisualizerView() {
  // Pull-initiated tour (V2-4a, #7): the CTA opens it; the tour itself never auto-launches.
  const openTour = useStimStore((s) => s.openTour)
  return (
    <>
      <FirstRunCard />
      <div className="tour-cta-bar">
        <button type="button" className="tour-cta" onClick={openTour}>
          <span aria-hidden="true">▶ </span>Take the guided tour
        </button>
        <span className="tour-cta-bar__hint">
          A guided, skippable walkthrough of the honest beats — what it shows and what it gets wrong.
        </span>
      </div>
      {/* Share affordances (V2-4b): copy the deep-link URL (#18) or export a PNG with the disclaimer +
          relative-units label baked in (#19). Outside the Canvas; no reactive store subscription. */}
      <ShareBar />
      <section className="visualizer">
        <div className="scene-stage" data-tour="scene">
          {/* Scene owns its own Suspense + "Loading model…" fallback; this boundary adds the
              error state for a GLB decode/WebGL failure (the banner above stays put). */}
          <ErrorBoundary label="Scene" fallback={<SceneErrorState />}>
            <Scene />
            <ColorScaleLegend />
            {/* Compact live gauge pinned to the scene's top-right, so the depth–dose numbers stay on
                screen while a slider is dragged; the detailed card under the scene stays the source. */}
            <FieldMetricsHUD />
            <p className="scene-stage__caption">
              Drag the <strong>coil</strong> across the scalp to move it, or pick a{' '}
              <strong>preset</strong>; the cortex heatmap recomputes live. Drag empty space to
              orbit, scroll to zoom. Illustrative model in relative units — not for clinical use.
            </p>
          </ErrorBoundary>
          {/* Solver progress/error overlay: inside the stage so it sits ON the scene at every
              width (not auto-placed after the analytics grid rows), outside the boundary so a solver
              failure stays visible even when the scene itself has failed. */}
          <SolverStatus />
        </div>
        {/* Keyboard coil control (#15): a focusable, non-trapping affordance to nudge the coil along the
            scalp + jump to presets without a mouse — routed through the same scalp re-projection as a drag. */}
        <CoilKeyboardControl />
        {/* Screen-reader live region (#34): narrates the heatmap RESULT on every settled solve, speaking
            "relative units" (gate (e)). Outside the ErrorBoundary above so a scene failure can't mute it;
            visually hidden (the legend/HUD/card serve sighted users). */}
        <HeatmapLiveRegion />
        {/* The depth–dose readout sits directly UNDER the scene (its natural home — it describes the
            field shown there), filling the otherwise-empty left column. The control panel spans the
            right. Nothing WITHIN the visualizer is sticky, so scrolling never floats the card over the
            controls; the only pinned element is the app-level disclaimer banner, which is
            pointer-transparent so it can't intercept anything it floats over. */}
        <FieldMetricsCard />
        <ControlPanel />
        <MethodExplainers />
        <ErrorBoundary label="AnalyticsPanel" fallback={<PanelErrorState />}>
          <Suspense fallback={<p role="status">Loading analytics...</p>}><AnalyticsPanel /></Suspense>
        </ErrorBoundary>
      </section>
      {/* The tour overlay (renders null unless opened from the CTA). Fixed-position, so it sits
          above the visualizer chrome and its `data-tour` ring can spotlight any anchored element. */}
      <GuidedTour />
    </>
  )
}
