import { describe, it, expect } from 'vitest'
import { useStimStore } from './store'

/**
 * Milestone 4 — store actions that drive coil (re)placement. The focus is `placementSeq`, the
 * monotonic "place the coil now" request counter that lets re-selecting the ALREADY-active
 * preset re-snap a dragged coil (the UX fix) and lets `reset` re-centre. Assertions are written
 * as deltas so they don't depend on which test ran first (the store is a singleton in this file).
 */

const get = () => useStimStore.getState()

describe('placementSeq (coil-placement requests)', () => {
  it('starts as a non-negative number', () => {
    expect(typeof get().placementSeq).toBe('number')
    expect(get().placementSeq).toBeGreaterThanOrEqual(0)
  })

  it('setPreset to a DIFFERENT preset bumps the counter and switches preset', () => {
    get().setPreset('Cz')
    const before = get().placementSeq
    get().setPreset('F4')
    expect(get().preset).toBe('F4')
    expect(get().placementSeq).toBe(before + 1)
  })

  it('re-selecting the ACTIVE preset still bumps the counter (re-snaps a dragged coil)', () => {
    get().setPreset('F3')
    const current = get().preset
    const before = get().placementSeq
    get().setPreset(current) // click the already-active preset
    expect(get().preset).toBe(current) // preset unchanged...
    expect(get().placementSeq).toBe(before + 1) // ...but a fresh placement is requested
  })

  it('a coil drag (setCoilPose) does NOT request a placement', () => {
    const before = get().placementSeq
    get().setCoilPose({ position: [-50, 53, 42] })
    expect(get().placementSeq).toBe(before) // unchanged — drags must not re-snap
  })
})

describe('reset', () => {
  it('restores defaults and requests a fresh placement', () => {
    get().setIntensity(1.8)
    get().setColormap('turbo')
    get().setPreset('Cz')
    get().setCoilPose({ position: [-50, 53, 42], standoff: 12 })
    get().setShowTargetCompare(true)
    get().setShowElectrodeMarkers(true)
    get().setShowGlyphs(true)
    get().setColorSource('residual')
    get().setFixedScaleExplainer(true)
    get().setShowFocalityContours(true)
    get().setTilt(22)
    const before = get().placementSeq

    get().reset()

    const s = get()
    expect(s.intensity).toBe(1)
    expect(s.colormap).toBe('viridis')
    expect(s.preset).toBe('F3')
    expect(s.coilPose.position).toEqual([0, 0, 0]) // the placeholder origin; TMSCoil re-projects it
    expect(s.coilPose.standoff).toBe(4)
    expect(s.showTargetCompare).toBe(false) // M6-4: the overlay toggle is a default, reset clears it
    expect(s.showElectrodeMarkers).toBe(false) // V2-1: marker toggle is a default (in INITIAL), reset clears it
    expect(s.showGlyphs).toBe(false) // V1-2: glyph toggle is a default (in INITIAL), reset clears it
    expect(s.colorSource).toBe('field') // V1-3: colorSource is a default (in INITIAL), reset clears it
    expect(s.fixedScaleExplainer).toBe(false) // V2-3: fixed-scale explainer is a default, reset clears it
    expect(s.showFocalityContours).toBe(false) // V2-3: focality contours is a default, reset clears it
    expect(s.tilt).toBe(0) // V1-1: tilt is a default (in INITIAL), so reset clears it back to flush
    expect(s.placementSeq).toBe(before + 1)
  })
})

describe('tilt + fieldMetrics (V1-1 depth–dose beat)', () => {
  it('setTilt updates the dedicated tilt scalar', () => {
    get().setTilt(18)
    expect(get().tilt).toBe(18)
    get().setTilt(0)
    expect(get().tilt).toBe(0)
  })

  it('tilt survives a preset re-snap (it is NOT coilPose.rotation)', () => {
    get().setTilt(25)
    get().setPreset('connectivity') // a re-snap overwrites coilPose, but must leave tilt alone
    expect(get().tilt).toBe(25)
    get().setPreset('F3') // re-clicking re-snaps again — tilt still preserved
    expect(get().tilt).toBe(25)
    get().reset()
  })

  it('publishes runtime-derived field metrics; reset clears stale metrics', () => {
    get().setFieldMetrics({ hvd: 12.3, spread: 21.7, peak: 4.5 })
    expect(get().fieldMetrics).toEqual({ hvd: 12.3, spread: 21.7, peak: 4.5 })
    get().reset()
    // Reset invalidates the field; only the next completed solve can restore it.
    expect(get().fieldMetrics).toBeNull()
  })
})

describe('showGlyphs (V1-2 E-field direction glyphs)', () => {
  it('toggles the direction-glyph layer flag; defaults off', () => {
    get().reset()
    expect(get().showGlyphs).toBe(false) // additive teaching layer is opt-in
    get().setShowGlyphs(true)
    expect(get().showGlyphs).toBe(true)
    get().setShowGlyphs(false)
    expect(get().showGlyphs).toBe(false)
  })
})

describe('showElectrodeMarkers (V2-1 targeting-legibility markers)', () => {
  it('toggles the 10-20 dots + DLPFC→sgACC cue layer flag; defaults off', () => {
    get().reset()
    expect(get().showElectrodeMarkers).toBe(false) // additive teaching layer is opt-in
    get().setShowElectrodeMarkers(true)
    expect(get().showElectrodeMarkers).toBe(true)
    get().setShowElectrodeMarkers(false)
    expect(get().showElectrodeMarkers).toBe(false)
  })
})

describe('colorSource (V1-3 self-error / residual layer)', () => {
  it('toggles the heatmap colour source between field and residual; defaults to field', () => {
    get().reset()
    expect(get().colorSource).toBe('field') // the induced |E| map is the default
    get().setColorSource('residual')
    expect(get().colorSource).toBe('residual')
    get().setColorSource('field')
    expect(get().colorSource).toBe('field')
  })
})

describe('fixedScaleExplainer + showFocalityContours (V2-3 heatmap-honesty explainers)', () => {
  it('toggles the fixed-scale intensity explainer flag; defaults off', () => {
    get().reset()
    expect(get().fixedScaleExplainer).toBe(false) // the per-pose-normalised heatmap is the default
    get().setFixedScaleExplainer(true)
    expect(get().fixedScaleExplainer).toBe(true)
    get().setFixedScaleExplainer(false)
    expect(get().fixedScaleExplainer).toBe(false)
  })

  it('toggles the iso-contour focality overlay flag; defaults off', () => {
    get().reset()
    expect(get().showFocalityContours).toBe(false) // the smooth gradient is the default
    get().setShowFocalityContours(true)
    expect(get().showFocalityContours).toBe(true)
    get().setShowFocalityContours(false)
    expect(get().showFocalityContours).toBe(false)
  })
})

describe('showTargetCompare + targetCompareMm (M6-4 overlay)', () => {
  it('toggles the targeting-debate overlay flag', () => {
    get().setShowTargetCompare(true)
    expect(get().showTargetCompare).toBe(true)
    get().setShowTargetCompare(false)
    expect(get().showTargetCompare).toBe(false)
  })

  it('publishes the live scalp gap; reset (a merge) deliberately keeps it', () => {
    get().setTargetCompareMm(17.3)
    expect(get().targetCompareMm).toBeCloseTo(17.3, 6)
    get().reset()
    // It is a fixed geometric fact of the mesh, not user state, so reset does not null it.
    expect(get().targetCompareMm).toBeCloseTo(17.3, 6)
  })
})

describe('tour slice (V2-4a guided tour)', () => {
  it('opens at beat 0 and skip/close rewinds to a clean start', () => {
    get().openTour()
    expect(get().tourOpen).toBe(true)
    expect(get().tourStep).toBe(0)
    get().nextTourStep()
    get().nextTourStep()
    expect(get().tourStep).toBe(2)
    get().closeTour()
    expect(get().tourOpen).toBe(false)
    expect(get().tourStep).toBe(0) // rewound, so re-opening starts fresh
  })

  it('next advances; prev clamps at the first beat (never negative)', () => {
    get().openTour()
    expect(get().tourStep).toBe(0)
    get().prevTourStep()
    expect(get().tourStep).toBe(0) // clamped
    get().nextTourStep()
    get().nextTourStep()
    get().prevTourStep()
    expect(get().tourStep).toBe(1)
    get().closeTour()
  })

  it('is deliberately OUT of INITIAL/reset: reset() does NOT close an open tour', () => {
    // Tour UI is runtime-only transient state (the bucket with placementSeq/targetCompareMm/
    // fieldMetrics), so it is intentionally absent from the exact reset set asserted above. This is
    // load-bearing: the tour's OWN first beat dispatches reset(), so a reset() that also closed the
    // tour would kill it on step 1. Lock that contract in.
    get().openTour()
    get().nextTourStep()
    const stepBefore = get().tourStep
    get().reset()
    expect(get().tourOpen).toBe(true) // still open after a reset()
    expect(get().tourStep).toBe(stepBefore) // and parked on the same beat
    get().closeTour()
  })
})
