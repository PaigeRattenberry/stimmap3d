// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GuidedTour, TOUR_STEPS } from './GuidedTour'
import { useStimStore } from '../store'

/**
 * Guided Tour (V2-4a, #7). The contracts guarded here:
 *  1. the ORDERED beat sequence mirrors the refreshed DESIGN.md demo script (and
 *     leads with the honest beats);
 *  2. invoking a beat dispatches its REAL store action through the normal store path (a preset /
 *     protocol / toggle change actually mutates the store — never a fake visual-only mutation),
 *     and the tour is skippable;
 *  3. each beat FULLY owns its scene — beats never accumulate one another's toggles (the must-fix:
 *     the self-error beat shows a clean residual, not one posterised by the prior focality beat); and
 *  4. closing the tour (Skip / Done / Escape) resets the app to a clean default scene, and the card
 *     is a modal dialog (aria-modal) for the Tab focus-trap.
 *
 * The store is a singleton in this file, so each test resets it afterwards.
 */

const get = () => useStimStore.getState()

beforeEach(() => {
  act(() => {
    get().closeTour()
    get().reset()
  })
})

afterEach(() => {
  cleanup()
  act(() => {
    get().closeTour()
    get().reset()
  })
})

describe('TOUR_STEPS — ordered beats stay in the documented order', () => {
  it('runs the beats in order, leading with the honest frame and closing on Methods', () => {
    // This list is the tour beat order the demo recorder also follows — keep them in lockstep.
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'frame', // 1. not for clinical use + relative units (honest frame)
      'hero', // 2. live heatmap
      'intensity', // 3. why intensity keeps the footprint (gate (e))
      'depth-dose', // 4. depth–dose & tilt
      'focality', // 5. focality, made visible
      'self-error', // 6. radial-removal residual (gates (b)/(e))
      'debate', // 7. the ~6 mm targeting debate
      'dose', // 8. OR vs absolute, separated (gate (c)/(d))
      'share', // 9. share the exact view — deep link / PNG / print handout (gate (a)/(e) baked in)
      'methods', // 10. what it gets wrong + self-check quiz (gate (b))
    ])
  })

  it('spotlights the matching data-tour anchors in order', () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      'disclaimer',
      'scene',
      'controls',
      'field-metrics',
      'scene',
      'controls',
      'methods-explainers',
      'analytics',
      'share',
      'methods-link',
    ])
  })

  it('opens on the disclaimer beat and closes on the Methods (pure-spotlight) beat', () => {
    expect(TOUR_STEPS[0].anchor).toBe('disclaimer')
    expect(TOUR_STEPS[0].action).toBeTypeOf('function') // resets to a clean state
    const last = TOUR_STEPS[TOUR_STEPS.length - 1]
    expect(last.anchor).toBe('methods-link')
    expect(last.action).toBeUndefined() // the closer mutates nothing (not a fake action)
  })
})

describe('each beat dispatches its REAL store action', () => {
  it("frame beat resets to a clean default state", () => {
    act(() => {
      get().setPreset('Cz')
      get().setTilt(30)
      get().setFixedScaleExplainer(true)
    })
    act(() => byId('frame').action?.())
    expect(get().preset).toBe('F3')
    expect(get().tilt).toBe(0)
    expect(get().fixedScaleExplainer).toBe(false)
  })

  it('hero beat snaps the F3 preset', () => {
    act(() => {
      get().setPreset('Cz')
    })
    act(() => byId('hero').action?.())
    expect(get().preset).toBe('F3')
  })

  it('intensity beat turns on the fixed-scale explainer (gate (e) teaching aid)', () => {
    act(() => byId('intensity').action?.())
    expect(get().fixedScaleExplainer).toBe(true)
  })

  it('depth-dose beat cants the coil (tilt = 20°)', () => {
    act(() => byId('depth-dose').action?.())
    expect(get().tilt).toBe(20)
  })

  it('focality beat turns on the iso-contour bands', () => {
    act(() => byId('focality').action?.())
    expect(get().showFocalityContours).toBe(true)
  })

  it('self-error beat switches the heatmap to the radial-removal residual', () => {
    act(() => byId('self-error').action?.())
    expect(get().colorSource).toBe('residual')
  })

  it('debate beat shows the F3-vs-connectivity overlay', () => {
    act(() => byId('debate').action?.())
    expect(get().showTargetCompare).toBe(true)
  })

  it('dose beat re-keys the analytics panel to iTBS', () => {
    act(() => {
      get().setProtocol('10hz-hf-l')
    })
    act(() => byId('dose').action?.())
    expect(get().protocol).toBe('itbs')
  })
})

describe('beats FULLY own their scene — no accumulation (regression for the must-fix)', () => {
  // The must-fix: beats only ADDED state, so the self-error beat rendered the residual buffer
  // through the prior beat's still-on focality contours (posterised bands), contradicting its copy.
  // Each beat now fully specifies its scene, so a later beat clears an earlier beat's leftover toggle.

  it('self-error beat shows a CLEAN residual: it turns the prior focality contours back OFF', () => {
    act(() => byId('focality').action?.())
    expect(get().showFocalityContours).toBe(true)
    act(() => byId('self-error').action?.())
    expect(get().colorSource).toBe('residual')
    expect(get().showFocalityContours).toBe(false) // ← the fix: residual is the smooth map, not banded
  })

  it('stepping to a later beat clears an earlier beat toggle (Back/forward never accumulates)', () => {
    act(() => byId('intensity').action?.()) // fixed-scale explainer ON
    expect(get().fixedScaleExplainer).toBe(true)
    act(() => byId('depth-dose').action?.()) // a different beat: cants the coil…
    expect(get().tilt).toBe(20)
    expect(get().fixedScaleExplainer).toBe(false) // …and the explainer it didn't ask for is off
  })

  it('debate beat clears the residual layer so the overlay sits over a clean field heatmap', () => {
    act(() => byId('self-error').action?.()) // residual layer on
    expect(get().colorSource).toBe('residual')
    act(() => byId('debate').action?.())
    expect(get().showTargetCompare).toBe(true)
    expect(get().colorSource).toBe('field') // back to the field heatmap under the overlay
    expect(get().showFocalityContours).toBe(false)
  })

  it('every state-changing beat leaves no other accumulating layer set than the one it showcases', () => {
    // Walk the beats in order; after each, exactly the layers that beat showcases should be on.
    const layerState = () => ({
      tilt: get().tilt,
      colorSource: get().colorSource,
      fixedScaleExplainer: get().fixedScaleExplainer,
      showFocalityContours: get().showFocalityContours,
      showTargetCompare: get().showTargetCompare,
    })
    const CLEAN = {
      tilt: 0,
      colorSource: 'field',
      fixedScaleExplainer: false,
      showFocalityContours: false,
      showTargetCompare: false,
    }
    act(() => byId('hero').action?.())
    expect(layerState()).toEqual(CLEAN)
    act(() => byId('intensity').action?.())
    expect(layerState()).toEqual({ ...CLEAN, fixedScaleExplainer: true })
    act(() => byId('depth-dose').action?.())
    expect(layerState()).toEqual({ ...CLEAN, tilt: 20 })
    act(() => byId('focality').action?.())
    expect(layerState()).toEqual({ ...CLEAN, showFocalityContours: true })
    act(() => byId('self-error').action?.())
    expect(layerState()).toEqual({ ...CLEAN, colorSource: 'residual' })
    act(() => byId('debate').action?.())
    expect(layerState()).toEqual({ ...CLEAN, showTargetCompare: true })
    act(() => byId('dose').action?.())
    expect(layerState()).toEqual(CLEAN)
  })
})

describe('<GuidedTour /> — pull-initiated, drives actions, skippable', () => {
  it('renders nothing until opened', () => {
    render(<GuidedTour />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from the store, dispatches the active beat, advances, and skips', () => {
    act(() => {
      get().setPreset('Cz') // prove the opening beat's reset() actually fires through the component
    })
    render(<GuidedTour />)

    act(() => get().openTour())
    // Opening renders the card on beat 1 and the frame beat reset the store back to defaults.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Step 1 of 10/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Not for clinical use/i })).toBeTruthy()
    expect(get().preset).toBe('F3')

    // Advance to the intensity beat (step 3) and confirm its real action fired via the component.
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Next$/i })))
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Next$/i })))
    expect(screen.getByText(/Step 3 of 10/i)).toBeTruthy()
    expect(get().fixedScaleExplainer).toBe(true)

    // Skippable at any beat — and closing returns the app to a CLEAN default scene (close-cleanup):
    // the beats' real toggles (here fixedScaleExplainer) are reset, not left on after exit.
    act(() => fireEvent.click(screen.getByRole('button', { name: /Skip tour/i })))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(get().tourOpen).toBe(false)
    expect(get().fixedScaleExplainer).toBe(false)
  })

  it('frames beat 1 by scrolling the DOCUMENT to the top, not by centring the pinned banner', () => {
    // The disclaimer banner is `position: sticky` and pinned to the viewport top, so it can never be
    // centred: `scrollIntoView({ block: 'center' })` on it just scrolls up by half a viewport and
    // stops wherever that lands. Re-entering beat 1 from deep in the page (Back, or reopening after
    // Escape) would then frame the MIDDLE of the app for the "not for clinical use" beat — and the
    // unattended demo recorder walks exactly that sequence. Beat 1 must scroll to the top instead.
    const anchor = document.createElement('div')
    anchor.setAttribute('data-tour', 'disclaimer')
    document.body.appendChild(anchor)
    const centred: unknown[] = []
    anchor.scrollIntoView = ((opts: unknown) => centred.push(opts)) as HTMLElement['scrollIntoView']
    const scrolledTo: unknown[] = []
    const realScrollTo = window.scrollTo
    window.scrollTo = ((opts: unknown) => scrolledTo.push(opts)) as typeof window.scrollTo

    try {
      render(<GuidedTour />)
      act(() => get().openTour())

      expect(scrolledTo).toEqual([{ top: 0, behavior: 'auto' }])
      expect(centred).toEqual([]) // never "centre" a top-pinned element
    } finally {
      window.scrollTo = realScrollTo
      anchor.remove()
    }
  })

  it('Back is disabled on the first beat', () => {
    render(<GuidedTour />)
    act(() => get().openTour())
    const back = screen.getByRole('button', { name: /^Back$/i }) as HTMLButtonElement
    expect(back.disabled).toBe(true)
  })

  it('Escape ends the tour and resets the app (keyboard close-cleanup)', () => {
    render(<GuidedTour />)
    act(() => get().openTour())
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Next$/i }))) // → hero
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Next$/i }))) // → intensity
    expect(get().fixedScaleExplainer).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(get().tourOpen).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(get().fixedScaleExplainer).toBe(false) // reset on exit
  })

  it('renders as a modal dialog (aria-modal) so the Tab focus-trap applies', () => {
    render(<GuidedTour />)
    act(() => get().openTour())
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })
})

/** Resolve a beat by id (the ordered list is asserted above; this keeps the action tests readable). */
function byId(id: string) {
  const step = TOUR_STEPS.find((s) => s.id === id)
  if (!step) throw new Error(`GuidedTour.test: no beat with id "${id}"`)
  return step
}
