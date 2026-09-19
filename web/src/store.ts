import { INTENSITY, STANDOFF, TILT, clampDomain, validPosition, normalizeRotation } from './domains'
import { create } from 'zustand'

/** [x, y, z] in scene/MNI millimetres (the exact frame is pinned in Milestone 1). */
export type Vec3 = [number, number, number]

/** rTMS protocols surfaced in the dose–response panel (Milestone 5). */
export type Protocol = '10hz-hf-l' | '1hz-lf-r' | 'itbs'

/** One-click coil-placement presets (Milestone 4). */
export type Preset = 'F3' | 'F4' | 'Fz' | 'Cz' | 'connectivity'

/**
 * Perceptual colormaps for the E-field heatmap (Milestone 3; cividis added in V2-5/#33).
 *  • `'viridis'` — the perceptually-uniform, CVD-robust DEFAULT (DESIGN §2).
 *  • `'turbo'`   — high-contrast but NOT perceptually uniform; offered, never the default (see Methods).
 *  • `'cividis'` — a perceptually-uniform map optimised for colour-vision deficiency (V2-5 accessibility).
 * Widening this union is lock-stepped: `COLORMAP_LABELS` below (a `Record<Colormap,…>`, so a missing
 * label is a COMPILE error), HeatmapMaterial's interpolator `Record`, and the deep-link `COLORMAPS`
 * whitelist in `ui/stateUrl.ts` all key off it — add a colormap in all three.
 */
export type Colormap = 'viridis' | 'turbo' | 'cividis'

/**
 * Canonical display labels for each colormap. Co-located with the {@link Colormap} union and keyed by
 * it, so adding a colormap to the type forces a label here (no silently-unreachable colormap). The
 * single source every UI surface renders — the ControlPanel toggle AND the print one-pager — so the
 * clinician handout can never show a different name than the on-screen control.
 */
export const COLORMAP_LABELS: Record<Colormap, string> = {
  viridis: 'Viridis',
  turbo: 'Turbo',
  cividis: 'Cividis',
}

/**
 * Which per-vertex scalar the cortex heatmap maps through the LUT (Milestone v1.3, #13).
 *  • `'field'`    — the induced |E| magnitude (the default, shipped since M3).
 *  • `'residual'` — the radial-removal residual `|E·n̂|`: the magnitude the spherical
 *    approximation strips out, a SELF-ERROR map of where the model is least trustworthy
 *    (DESIGN §3.2 made spatial). Both ride the SAME solve + the SAME LUT (the source-swap
 *    machinery S-2/#9 will reuse); the residual is shown in relative units and is explicitly
 *    NOT a validated error (gate (e)).
 */
export type ColorSource = 'field' | 'residual'

export interface CoilPose {
  /** Coil-centre position. */
  position: Vec3
  /** Euler rotation, radians. */
  rotation: Vec3
  /** Stand-off gap from the scalp, millimetres. */
  standoff: number
}

/**
 * Depth–dose readout published by the heatmap worker each solve (Milestone v1.1, #2/C1). All
 * RELATIVE / ILLUSTRATIVE — half-value depth d½ and focal spread S½ in mm, surface peak |E| in
 * relative units; not validated dosimetry (gate (e)). Mirrors `targetCompareMm`: runtime-derived,
 * so it is deliberately NOT part of `INITIAL`/`reset`.
 */
export interface FieldMetricsReadout {
  /** Half-value depth d½ (mm). */
  hvd: number
  /** On-surface half-max spread S½ (mm). */
  spread: number
  /** Surface peak |E| (relative units). */
  peak: number
}

export interface StimState {
  // --- E-field / coil ---
  coilPose: CoilPose
  /** Relative coil "intensity" (proxy for dI/dt); arbitrary units — see Methods page. */
  intensity: number
  /**
   * Coil cant in DEGREES (0 = flush), a DEDICATED scalar composed onto `coilPose` AFTER placement
   * (see `composeTilt`). It is separate from `coilPose.rotation` precisely because rotation is
   * overwritten on every preset re-snap (TMSCoil re-projects on `placementSeq`), whereas tilt must
   * SURVIVE a re-snap. Drives the depth–dose tradeoff: larger tilt → deeper d½, broader S½, changed relative magnitude (Milestone v1.1, improvement #3). Default 0.
   */
  tilt: number
  colormap: Colormap

  /**
   * Show the E-field DIRECTION glyphs — constant-length arrows on the cortex marking the induced
   * field's tangential direction (Milestone v1.2, #1). Default OFF (additive teaching layer). The
   * arrows reuse the heatmap's relative LUT and encode DIRECTION only, not neural activation (gate
   * (e)) — see `EFieldGlyphs`.
   */
  showGlyphs: boolean

  /**
   * Which scalar the cortex heatmap colours (Milestone v1.3, #13) — `'field'` (induced |E|,
   * default) or `'residual'` (the radial-removal self-error map). Both map through the same
   * per-pose LUT; switching only RE-COLOURS the cached buffers (no re-solve). Default `'field'`.
   */
  colorSource: ColorSource

  /**
   * EXPLAINER-ONLY fixed-scale heatmap path (Milestone v2.3, #8) — the "why cranking intensity
   * doesn't move the footprint" teaching aid. The DEFAULT cortex heatmap is normalised to the
   * robust per-pose peak, so it is exactly invariant to `intensity` (|E| ∝ dI/dt and the scale
   * scales with it — see `useEFieldHeatmap`). That is honest but reads like a bug. With this ON
   * the cortex is instead mapped against a FROZEN reference scalar, so raising `intensity`
   * VISIBLY brightens the cortex (the cached field is re-scaled by current÷solve intensity — no
   * re-solve). It is UNMISTAKABLY a teaching aid: still RELATIVE units, NEVER absolute V/m, and
   * NEVER the default (gate (e)). Default OFF.
   */
  fixedScaleExplainer: boolean

  /**
   * Iso-contour focality bands + peak marker (Milestone v2.3, #14). With this ON the cortex is
   * re-coloured into discrete "% of this-pose peak" bands (the band boundaries ARE the
   * iso-contours) and a marker is drawn at the peak vertex, making focality visible and
   * comparable across presets. Bands are always computed against the true per-pose peak (so the
   * "% of this-pose peak" label holds even alongside the fixed-scale explainer). Default OFF.
   */
  showFocalityContours: boolean

  // --- targeting & protocol ---
  preset: Preset
  protocol: Protocol

  /** Show the F3-vs-connectivity targeting-debate overlay in the scene (Milestone 6, #5). */
  showTargetCompare: boolean

  /**
   * Show the V2-1 targeting-legibility markers (improvement #6 + C2): instanced 10-20 dots
   * (F3/F4/Fz/Cz) with labels, a DLPFC node annotation, and a SCHEMATIC DLPFC→sgACC anticorrelation
   * cue down to the deep subgenual-ACC seed. Default OFF (additive teaching layer). The cue is
   * illustrative — NOT a computed connectome — see `ElectrodeMarkers`.
   */
  showElectrodeMarkers: boolean

  /**
   * Monotonic "(re)place the coil on the scalp" request counter, bumped by `setPreset` and
   * `reset`. `TMSCoil` re-projects the active preset's target whenever this changes — so
   * re-clicking the ALREADY-active preset (e.g. to snap a dragged coil back) still re-places it,
   * even though `preset` itself is unchanged. Never decreases; it gates placement, it is not state.
   */
  placementSeq: number

  /**
   * Live straight-line scalp distance (mm) between the F3 and connectivity coil centres,
   * published by the scene's `TargetCompare` overlay once the scalp mesh decodes (null before).
   * RUNTIME-DERIVED geometry — deliberately NOT part of `INITIAL`/`reset` (a fixed geometric
   * fact of the mesh, not user state). `MethodExplainers` reads it to replace the old "~6 mm".
   */
  targetCompareMm: number | null

  /**
   * Validity of the painted field. 'loading' while a solve for the current
   * pose is outstanding (PNG export is blocked), 'ready' once it has landed, 'error' after a terminal
   * solver/graphics failure. A pose/tilt change sets 'loading' but never clears an 'error'.
   */
  solverStatus: 'loading' | 'ready' | 'error'
  /** Human-readable solver failure shown by `SolverStatus`; null when not in a solver error. */
  solverError: string | null
  /**
   * Live depth–dose metrics for the painted field, or null before the first field arrives.
   * RUNTIME-DERIVED (like `targetCompareMm`) — published by `useEFieldHeatmap`, read by
   * `FieldMetricsCard`/`FieldMetricsHUD`. During a drag they track the painted (one-solve-behind)
   * field while `solverStatus` is 'loading'; cleared on preset/reset re-snaps and on failure.
   */
  fieldMetrics: FieldMetricsReadout | null

  // --- guided tour (V2-4a, improvement #7) ---

  /**
   * Whether the pull-initiated Guided Tour is showing (`GuidedTour`). RUNTIME-ONLY transient UI —
   * deliberately NOT part of `INITIAL`/`reset` (the same bucket as `placementSeq`/`targetCompareMm`/
   * `fieldMetrics`). Two reasons it must stay out of reset: (1) the tour's OWN first beat dispatches
   * `reset()` as its real store action (to start from a clean default state), so a `reset()` that
   * also closed the tour would kill the tour on step 1; (2) the control-panel "Reset to defaults"
   * is a field/targeting reset, not an onboarding control. Default closed.
   */
  tourOpen: boolean
  /** 0-based index into `GuidedTour`'s ordered beats. Runtime-only (see `tourOpen`). */
  tourStep: number

  // --- actions ---
  setCoilPose: (pose: Partial<CoilPose>) => void
  setIntensity: (intensity: number) => void
  setTilt: (tilt: number) => void
  setColormap: (colormap: Colormap) => void
  setShowGlyphs: (show: boolean) => void
  setColorSource: (source: ColorSource) => void
  setFixedScaleExplainer: (on: boolean) => void
  setShowFocalityContours: (on: boolean) => void
  setPreset: (preset: Preset) => void
  setProtocol: (protocol: Protocol) => void
  setShowTargetCompare: (show: boolean) => void
  setShowElectrodeMarkers: (show: boolean) => void
  setTargetCompareMm: (mm: number) => void
  setFieldMetrics: (metrics: FieldMetricsReadout) => void
  /** Open the Guided Tour at its first beat (pull-initiated from the App CTA). */
  openTour: () => void
  /** Close/skip the tour and rewind to the first beat (so re-opening starts fresh). */
  closeTour: () => void
  /** Advance to the next beat. `GuidedTour` guards the upper bound (last beat → `closeTour`). */
  nextTourStep: () => void
  /** Step back one beat, clamped at the first (beat 0). */
  prevTourStep: () => void
  reset: () => void
}

type StimDefaults = Pick<
  StimState,
  | 'coilPose'
  | 'intensity'
  | 'tilt'
  | 'colormap'
  | 'showGlyphs'
  | 'colorSource'
  | 'fixedScaleExplainer'
  | 'showFocalityContours'
  | 'preset'
  | 'protocol'
  | 'showTargetCompare'
  | 'showElectrodeMarkers'
>

/**
 * The exact resettable defaults — the slices `reset()` restores AND the only slices the deep-link
 * state-URL (#18, `ui/stateUrl.ts`) serialises. Exported so the encoder has ONE source of truth for
 * "default" (so a link omits any slice left at its default) and `store.test.ts` can keep asserting
 * the reset set. Runtime-derived fields (`placementSeq`/`targetCompareMm`/`fieldMetrics`) and the
 * transient tour UI (`tourOpen`/`tourStep`) are deliberately NOT here — never reset, never in a URL.
 */
export const INITIAL: StimDefaults = {
  coilPose: { position: [0, 0, 0], rotation: [0, 0, 0], standoff: 4 },
  intensity: 1,
  tilt: 0, // flush coil; survives preset re-snaps (it is NOT part of coilPose.rotation)
  colormap: 'viridis', // perceptually safer default (DESIGN §2); turbo optional
  showGlyphs: false, // direction glyphs are an opt-in teaching layer (v1.2, #1)
  colorSource: 'field', // the heatmap shows induced |E| by default; 'residual' is opt-in (v1.3, #13)
  fixedScaleExplainer: false, // the heatmap is normalised per-pose by default; fixed-scale is opt-in (v2.3, #8)
  showFocalityContours: false, // smooth gradient by default; iso-contour bands are opt-in (v2.3, #14)
  preset: 'F3', // Beam-F3 left DLPFC
  protocol: '10hz-hf-l',
  showTargetCompare: false,
  showElectrodeMarkers: false, // targeting-legibility markers are an opt-in teaching layer (v2.1, #6/C2)
}

/**
 * Central app state (DESIGN §2): coil pose, intensity, selected protocol/preset,
 * and colormap. Milestone 0 wires the shape and defaults; the scene, solver, and
 * panels read and write these slices in later milestones.
 */
export const useStimStore = create<StimState>((set) => ({
  ...INITIAL,
  placementSeq: 0,
  targetCompareMm: null,
  fieldMetrics: null,
  solverStatus: 'loading',
  solverError: null,
  tourOpen: false,
  tourStep: 0,
  setCoilPose: (pose) => set((s) => ({ coilPose: {
    position: pose.position && validPosition(pose.position) ? pose.position : s.coilPose.position,
    rotation: pose.rotation?.every(Number.isFinite) ? normalizeRotation(pose.rotation) : s.coilPose.rotation,
    standoff: clampDomain(pose.standoff ?? s.coilPose.standoff, STANDOFF, s.coilPose.standoff),
  }, solverStatus: s.solverStatus === 'error' ? 'error' : 'loading' })),
  setIntensity: (intensity) => set((s) => ({ intensity: clampDomain(intensity, INTENSITY, s.intensity) })),
  setTilt: (value) => set((s) => {
    const tilt = clampDomain(value, TILT, s.tilt)
    return tilt === s.tilt ? s : { tilt, solverStatus: s.solverStatus === 'error' ? 'error' : 'loading' }
  }),
  setColormap: (colormap) => set({ colormap }),
  setShowGlyphs: (showGlyphs) => set({ showGlyphs }),
  setColorSource: (colorSource) => set({ colorSource }),
  setFixedScaleExplainer: (fixedScaleExplainer) => set({ fixedScaleExplainer }),
  setShowFocalityContours: (showFocalityContours) => set({ showFocalityContours }),
  // Bump `placementSeq` even when `preset` is unchanged so re-selecting the active preset
  // re-snaps the coil (it has no effect on the heatmap until TMSCoil writes the new pose).
  setPreset: (preset) => set((s) => ({ preset, fieldMetrics: null, solverStatus: s.solverStatus === 'error' ? 'error' : 'loading', placementSeq: s.placementSeq + 1 })),
  setProtocol: (protocol) => set({ protocol }),
  setShowTargetCompare: (showTargetCompare) => set({ showTargetCompare }),
  setShowElectrodeMarkers: (showElectrodeMarkers) => set({ showElectrodeMarkers }),
  setTargetCompareMm: (targetCompareMm) => set({ targetCompareMm }),
  setFieldMetrics: (fieldMetrics) => set({ fieldMetrics }),
  // Tour: open at beat 0, advance/step-back (clamped low; the component caps the high end), and
  // close (rewinding to 0). None of these touch INITIAL/reset — see the `tourOpen` doc comment.
  openTour: () => set({ tourOpen: true, tourStep: 0 }),
  closeTour: () => set({ tourOpen: false, tourStep: 0 }),
  nextTourStep: () => set((s) => ({ tourStep: s.tourStep + 1 })),
  prevTourStep: () => set((s) => ({ tourStep: Math.max(0, s.tourStep - 1) })),
  // Restore defaults AND request a fresh placement (so Reset re-centres the coil). `reset` is a
  // shallow MERGE, so `targetCompareMm` (a geometry fact, not in INITIAL) is intentionally kept.
  reset: () => set((s) => ({ ...INITIAL, fieldMetrics: null, solverStatus: s.solverStatus === 'error' ? 'error' : 'loading', placementSeq: s.placementSeq + 1 })),
}))
