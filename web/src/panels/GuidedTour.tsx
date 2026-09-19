/**
 * Guided Tour (V2-4a, improvement #7) — a pull-initiated, skippable, ordered-step walkthrough.
 *
 * Each beat is `{ id, title, body, anchor, action? }`: it spotlights a `data-tour` anchor and
 * dispatches a REAL store action through the normal store path (`useStimStore.getState()` →
 * `setPreset`/`setProtocol`/feature toggles — never a fake, visual-only mutation), so the viewer
 * watches the genuine app react. The beat sequence MIRRORS the refreshed DESIGN.md
 * demo script in lockstep (edit the two together), and LEADS WITH the honest beats: the persistent
 * non-clinical disclaimer + relative units (gates (a)/(e)), the intensity-invariance explainer
 * (gate (e)), the radial-removal self-error map (gates (b)/(e)), the ~6 mm F3-vs-connectivity
 * finding, the OR-vs-absolute separation (gate (c)/(d)), the `share` beat (deep link / PNG / print
 * handout — each with the gate (a)/(e) framing baked in), and the Methods/Limitations closer (b).
 *
 * EACH BEAT FULLY OWNS ITS SCENE — NO ACCUMULATION. Every state-changing beat goes through
 * `applyScene(...)`, which sets EVERY accumulating visual layer (tilt, colorSource, the two
 * explainer toggles, the target-compare overlay) to the beat's requested value OR a clean baseline.
 * So a beat never inherits a previous beat's leftover toggle: the self-error beat shows a CLEAN
 * residual map (the prior focality contours are turned back OFF — otherwise the residual would be
 * posterised into contour bands, contradicting its own copy), and stepping Back re-establishes
 * exactly that beat's scene rather than an additive pile-up. `preset` is the one thing applyScene
 * sets only on request (re-snapping the coil every beat would be wasteful and jumpy).
 *
 * PULL, NOT PUSH. The tour never auto-launches — it opens only from the App CTA and is skippable
 * at every beat (Skip button + Escape). Per Nielsen Norman Group's onboarding guidance ("Onboarding
 * Tutorials vs. Contextual Help"), forced/push walkthroughs are justified only for genuinely novel
 * interaction paradigms and should always be dismissible; a draggable-coil visualiser is novel
 * enough to *offer* a guided path, but the user stays in control — hence pull-initiated + always
 * skippable, never a modal the viewer can't escape. It IS a focus-trapping modal while open
 * (`aria-modal`, Tab cycles within the card, focus returns to the CTA on close) since the scrim
 * blocks the page; closing (Skip / Done / Escape) runs `reset()` so the user lands on a CLEAN
 * default scene, symmetric with the opening (frame) beat — never the tour's accumulated toggles.
 *
 * Honesty: the tour drives ONLY existing store actions and existing labelled UI — it introduces no
 * new E-field number, never mixes ORs with absolute rates, and leaves every synthetic badge /
 * relative-units label intact. The scrim is translucent so the persistent `DisclaimerBanner` stays
 * visible throughout (gate (a)). Respects `prefers-reduced-motion` (#27): no smooth scroll and no
 * animated ring movement when reduced motion is requested.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useStimStore } from '../store'
import type { ColorSource, Preset, Protocol } from '../store'

/** The `data-tour` anchor each beat spotlights (set on the matching element in `App`/panels). */
export type TourAnchor =
  | 'disclaimer'
  | 'scene'
  | 'controls'
  | 'field-metrics'
  | 'methods-explainers'
  | 'analytics'
  | 'share'
  | 'methods-link'

export interface TourStep {
  /** Stable id (used by tests to assert the ordered beat sequence). */
  id: string
  /** Short beat heading shown in the tour card. */
  title: string
  /** Beat copy — folds in the "what am I looking at" framing (so #29 needs no separate component). */
  body: ReactNode
  /** Which `data-tour` element to spotlight. */
  anchor: TourAnchor
  /**
   * The REAL store action this beat performs, dispatched through the normal store path when the
   * beat becomes active. Most beats call `applyScene(...)`, which FULLY specifies the visual layers
   * (so beats never accumulate one another's toggles and stepping Back re-establishes exactly this
   * beat's scene). The `frame` beat instead calls the store's `reset()` (a clean slate + coil
   * re-centre). Omitted for the two pure-spotlight beats — the `share` beat (points at the share
   * toolbar) and the `methods` closer (points at the Methods link) — which mutate nothing:
   * deliberately NOT a fake visual mutation. Each rides the CLEAN scene the prior `dose` beat set.
   */
  action?: () => void
}

const store = () => useStimStore.getState()

/**
 * The visual scene a beat wants to show. Anything omitted falls back to `BASE_SCENE`, so every
 * state-changing beat FULLY specifies the accumulating layers — beats never inherit each other's
 * leftover toggles (the must-not-regress invariant: the self-error beat shows a clean residual, not
 * a residual posterised by the prior beat's still-on focality contours). `preset`/`protocol` are
 * single-valued; `preset` is applied only on request (re-snapping the coil every beat would re-solve
 * needlessly and make the coil jump), while `protocol` is reconciled every beat for determinism.
 */
interface TourScene {
  preset?: Preset
  protocol?: Protocol
  tilt?: number
  colorSource?: ColorSource
  fixedScaleExplainer?: boolean
  showFocalityContours?: boolean
  showTargetCompare?: boolean
}

/** Clean baseline for the accumulating layers — the state a beat reverts anything it doesn't ask for. */
const BASE_SCENE = {
  protocol: '10hz-hf-l' as Protocol,
  tilt: 0,
  colorSource: 'field' as ColorSource,
  fixedScaleExplainer: false,
  showFocalityContours: false,
  showTargetCompare: false,
}

/**
 * Reconcile the store to a beat's scene through the normal store actions. Sets EVERY accumulating
 * layer (to the beat's value or the clean baseline), so the beat owns its scene outright. The
 * off-by-default toggles are set BEFORE `setColorSource`, so the buffer-selecting recolour reads the
 * final normalisation and there is no sub-frame residual×contour combination. `setPreset` is last
 * (and only when asked): a re-snap re-solves, so it should run against the final layer state.
 */
function applyScene(scene: TourScene): void {
  const s = store()
  s.setTilt(scene.tilt ?? BASE_SCENE.tilt)
  s.setFixedScaleExplainer(scene.fixedScaleExplainer ?? BASE_SCENE.fixedScaleExplainer)
  s.setShowFocalityContours(scene.showFocalityContours ?? BASE_SCENE.showFocalityContours)
  s.setShowTargetCompare(scene.showTargetCompare ?? BASE_SCENE.showTargetCompare)
  s.setColorSource(scene.colorSource ?? BASE_SCENE.colorSource)
  s.setProtocol(scene.protocol ?? BASE_SCENE.protocol)
  if (scene.preset) s.setPreset(scene.preset)
}

/**
 * The ordered beats — the single source of truth the demo recorder mirrors. Keep this array and the
 * beat sequence in tooling/video/record.mjs in lockstep.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'frame',
    title: 'Not for clinical use',
    anchor: 'disclaimer',
    // Start from a known clean state so the tour is reproducible — reset() is a real store action.
    action: () => store().reset(),
    body: (
      <>
        This banner stays on <strong>every screen</strong>: StimMap3D is an{' '}
        <strong>illustrative model — not for clinical use</strong>. The E-field is a simplified{' '}
        <em>analytical</em> (non-FEM) approximation shown in clearly-labelled{' '}
        <strong>relative units</strong>, and all outcome data is <strong>synthetic</strong>.
      </>
    ),
  },
  {
    id: 'hero',
    title: 'The hero — a live heatmap',
    anchor: 'scene',
    action: () => applyScene({ preset: 'F3' }),
    body: (
      <>
        Drag the figure-8 <strong>coil</strong> across the scalp — or pick a <strong>preset</strong>{' '}
        (we just snapped to <strong>F3 / Beam-F3</strong>), or nudge it with the{' '}
        <strong>keyboard coil control</strong> — and the cortex heatmap recomputes live. The colour
        scale (top-left) is normalised per pose to its own peak, in{' '}
        <strong>relative units, not V/m</strong>.
      </>
    ),
  },
  {
    id: 'intensity',
    title: 'Why intensity keeps the footprint',
    anchor: 'controls',
    action: () => applyScene({ fixedScaleExplainer: true }),
    body: (
      <>
        Cranking <strong>intensity</strong> doesn&rsquo;t move the footprint — |E| ∝ dI/dt and the
        per-pose scale scales with it, so the normalised shape is invariant. We just switched on the{' '}
        <strong>fixed-scale explainer</strong>: now raising intensity <strong>visibly brightens</strong>{' '}
        the cortex. A teaching aid only — still <strong>relative units, never V/m</strong>.
      </>
    ),
  },
  {
    id: 'depth-dose',
    title: 'Depth–dose & tilt',
    anchor: 'field-metrics',
    action: () => applyScene({ tilt: 20 }),
    body: (
      <>
        Canting the coil (we set <strong>tilt = 20°</strong>) drives the depth–dose readout: the
        half-value depth <em>d½</em> deepens, the focal spread <em>S½</em> broadens, and the
        relative field magnitude changes — the depth–focality–dose tradeoff. Surface-derived,
        relative — <strong>not validated cm or V·m</strong>.
      </>
    ),
  },
  {
    id: 'focality',
    title: 'Focality, made visible',
    anchor: 'scene',
    action: () => applyScene({ showFocalityContours: true }),
    body: (
      <>
        Iso-contour bands posterise the cortex into <strong>25 / 50 / 75 / 90 % of this-pose peak</strong>{' '}
        and pin the peak vertex — so focality becomes something you can see and compare across presets.
        Relative units — <strong>% of peak, not V/m</strong>.
      </>
    ),
  },
  {
    id: 'self-error',
    title: 'Where the model is least trustworthy',
    anchor: 'controls',
    // Clean residual: applyScene turns the prior beat's focality contours back OFF, so the residual
    // self-error map shows as the smooth gradient its copy describes — not posterised contour bands.
    action: () => applyScene({ colorSource: 'residual' }),
    body: (
      <>
        Switch the heatmap layer to the <strong>radial-removal residual</strong> — the magnitude the
        spherical approximation strips out. It is ≈0 directly under the coil and grows where the
        single best-fit sphere degrades (frontal/temporal poles): the Methods caveat made spatial. An{' '}
        <strong>approximation residual, not a validated error</strong>.
      </>
    ),
  },
  {
    id: 'debate',
    title: 'The targeting debate, measured live',
    anchor: 'methods-explainers',
    action: () => applyScene({ showTargetCompare: true }),
    body: (
      <>
        Compare <strong>F3 vs connectivity</strong>. Beam-F3 (the F3 site) was <em>designed</em> to
        approximate the connectivity target — within <strong>~0.65 cm (≈6 mm)</strong> of an
        MRI-guided DLPFC at the cortex (Mir-Moghtadaei 2015) — so they&rsquo;re honestly close, not a
        faked separation. The overlay draws both coil centres and their live straight-line{' '}
        <em>scalp</em> gap (a distinct, larger chord). The genuinely deprecated method is the older
        5-cm rule.
      </>
    ),
  },
  {
    id: 'dose',
    title: 'Dose, separated honestly',
    anchor: 'analytics',
    action: () => applyScene({ protocol: 'itbs' }),
    body: (
      <>
        We picked <strong>iTBS</strong> in the dose–response panel. Directly-measured{' '}
        <strong>absolute response/remission rates</strong> and the Mutz{' '}
        <strong>odds ratios vs sham</strong> stay on <strong>separate axes</strong> — the
        OR→probability conversion is shown step-by-step against an explicit, labelled sham baseline.
        The synthetic trajectory chart draws <strong>per-patient population-scatter</strong> around a{' '}
        <strong>±1 SD band</strong> so the spread is visible, and the whole cohort is badged{' '}
        <strong>synthetic</strong>. The accelerated <strong>SAINT / SNT</strong> story is kept in a
        quarantined callout — its far higher rate <strong>never</strong> touches the absolute-% or OR
        axes (gate (c)).
      </>
    ),
  },
  {
    id: 'share',
    title: 'Share this configuration',
    anchor: 'share',
    // Pure-spotlight beat: it points at the share toolbar and mutates nothing. The scene it shares is
    // whatever the prior (dose) beat left CLEAN — so no action is needed to "own" it.
    body: (
      <>
        Every view is shareable from the toolbar up top: <strong>Copy link</strong> grabs a deep link
        that shares this configuration (rounded pose, camera not included), <strong>Export PNG</strong> saves a slide-ready snapshot with
        the <strong>disclaimer + relative-units label baked in</strong>, and{' '}
        <strong>Print handout</strong> opens a print-ready clinician one-pager — each one carries the{' '}
        “not for clinical use” framing wherever it travels.
      </>
    ),
  },
  {
    id: 'methods',
    title: "Here's exactly what it gets wrong",
    anchor: 'methods-link',
    // Pure-spotlight closer: it points at the Methods link and mutates nothing (NOT a fake action).
    body: (
      <>
        Open <strong>Methods &amp; Limitations</strong> for the model&rsquo;s own honest account of
        what it gets wrong — gyral/sulcal folding, tissue heterogeneity, the first-order tangential
        approximation, and more — plus a short <strong>self-check quiz</strong> that drills the
        honesty gates (relative units, magnitude ≠ activation, synthetic data, OR vs absolute rate).
        That page (and this disclaimer) are reachable on every screen.
      </>
    ),
  },
]

/**
 * Bounding box of the spotlighted anchor, in PAGE coordinates (viewport rect + scroll offset). Page
 * coordinates are scroll-INVARIANT for in-flow anchors, so the absolutely-positioned ring stays glued
 * to its anchor as the page scrolls the element into view — no per-frame scroll tracking, and no race
 * with a smooth `scrollIntoView` (we can measure before the scroll even starts and still land in the
 * right place). EXCEPTION: the `disclaimer` anchor is `position: sticky` (`.app-disclaimer`), so its
 * page coordinates track scrollY while pinned. The scroll listener re-measures it, so the ring does
 * follow — but a CSS `transition: top` would make it TRAIL the banner by a quarter-second during a
 * wheel-scroll, drawing the spotlight over whatever happens to be under it (header, scene, control
 * panel) on the honesty-framing beat. So scroll/resize-driven re-measures snap (see `trackAnchor`);
 * only a BEAT CHANGE glides the ring from one anchor to the next, which is the movement the
 * transition exists for.
 */
interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

function readAnchorRect(anchor: TourAnchor): AnchorRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null // not laid out (e.g. happy-dom) — skip the ring
  const sx = window.scrollX || 0
  const sy = window.scrollY || 0
  return { top: r.top + sy, left: r.left + sx, width: r.width, height: r.height }
}

export function GuidedTour() {
  const open = useStimStore((s) => s.tourOpen)
  const rawStep = useStimStore((s) => s.tourStep)
  const next = useStimStore((s) => s.nextTourStep)
  const prev = useStimStore((s) => s.prevTourStep)
  const close = useStimStore((s) => s.closeTour)

  // End the tour (Skip / Done / Escape): `reset()` returns the app to a CLEAN default scene — coil
  // re-centred, every explainer layer off — rather than the pile of REAL toggles the beats flipped
  // on. Symmetric with the opening (frame) beat's reset, so the user never lands mid-tour-state.
  // `closeTour()` then hides the overlay and rewinds to beat 0. (closeTour stays a pure tour action;
  // the reset-on-exit policy lives here, in the component that owns the tour UX.)
  const endTour = useCallback(() => {
    useStimStore.getState().reset()
    close()
  }, [close])

  // Detect reduced motion inline (no shared hook needed): drop the smooth scroll + ring transition.
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const step = Math.min(Math.max(rawStep, 0), TOUR_STEPS.length - 1)
  const current = TOUR_STEPS[step]
  const isFirst = step === 0
  const isLast = step === TOUR_STEPS.length - 1

  const [rect, setRect] = useState<AnchorRect | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  /** The element focused when the tour opened (the CTA) — focus returns here on close. */
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  /**
   * Does the ring GLIDE to its new box, or snap to it? A beat change moves the spotlight from one
   * anchor to another — that glide is the point of the CSS transition. A scroll/resize re-measure is
   * a CORRECTION (the sticky disclaimer banner's page coordinates move with scrollY), and animating a
   * correction makes the ring lag behind what it is spotlighting. So those snap.
   */
  const [ringGlides, setRingGlides] = useState(true)

  const measure = useCallback(() => {
    if (!open) return
    setRect(readAnchorRect(current.anchor))
  }, [open, current.anchor])

  /** Re-measure without animating — for scroll/resize/reflow, where the ring must track exactly. */
  const trackAnchor = useCallback(() => {
    setRingGlides(false)
    measure()
  }, [measure])

  // On each active beat: dispatch its REAL store action, scroll its anchor into view, and measure
  // the spotlight ring. Re-dispatching on Back is intentional (returning to a beat re-applies it).
  // The scroll is INSTANT (`behavior: 'auto'`) for two reasons: (1) it settles synchronously, so the
  // immediate measure reads the final layout and the page-coordinate ring lands on the anchor with
  // no race (a smooth scroll fires a stream of scroll events that fought the re-measure across rapid
  // beat changes); (2) an instant jump is never "jarring", so it satisfies prefers-reduced-motion by
  // construction. The ring's own movement keeps a brief CSS glide (disabled under reduced motion).
  useEffect(() => {
    if (!open) return
    current.action?.()
    setRingGlides(true) // a beat change is the one movement the ring's transition is for
    const el =
      typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>(`[data-tour="${current.anchor}"]`)
        : null
    // The disclaimer banner is `position: sticky` and pinned to the viewport top, so it can never be
    // CENTRED: `scrollIntoView({ block: 'center' })` on it just scrolls up by half a viewport and
    // stops wherever that lands. Re-entering beat 1 from deep in the page (Back, or reopening the
    // tour after Escape) would then frame the middle of the app for the "not for clinical use" beat —
    // and the unattended demo recorder walks exactly that sequence. Scroll the document to the top
    // instead, which is what "show me the banner in context" actually means for a top-pinned element.
    if (current.anchor === 'disclaimer') window.scrollTo?.({ top: 0, behavior: 'auto' })
    else el?.scrollIntoView?.({ block: 'center', behavior: 'auto' })
    measure()
    // `current` is derived from `step`; depending on `step` (a primitive) re-runs this once per beat.
  }, [open, step, measure])

  // Keep the ring glued to the anchor while the page scrolls/resizes during the tour.
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', trackAnchor, true)
    window.addEventListener('resize', trackAnchor)
    return () => {
      window.removeEventListener('scroll', trackAnchor, true)
      window.removeEventListener('resize', trackAnchor)
    }
  }, [open, trackAnchor])

  // Re-measure on any content reflow (e.g. the Recharts panels or the 3-D scene settle their size
  // after the beat's measure), which shifts the page position of the anchors below them. A body
  // ResizeObserver fires exactly on those layout changes, so the ring never goes stale.
  useEffect(() => {
    if (!open || typeof ResizeObserver === 'undefined' || typeof document === 'undefined') return
    const ro = new ResizeObserver(() => trackAnchor())
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [open, trackAnchor])

  // Escape ends the tour (always-dismissible, per the NN/g pull guidance above).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, endTour])

  // Focus management (WAI-ARIA dialog): on open, remember what had focus (the CTA) and move focus
  // into the card; on close, return focus to where it came from so keyboard users aren't dropped at
  // the top of the document. Pairs with the Tab-trap below and `aria-modal` on the card.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current =
        typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
      cardRef.current?.focus?.()
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  // Trap Tab within the card while the modal tour is open: the scrim blocks the page, so focus must
  // cycle among the card's own controls instead of escaping to the inert background behind it.
  const onCardKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const card = cardRef.current
    if (!card) return
    const focusables = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled])'))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (e.shiftKey) {
      if (active === first || active === card) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  if (!open) return null

  const PAD = 6 // breathing room around the spotlighted element

  return (
    <div className={`guided-tour${reducedMotion ? ' guided-tour--reduced' : ''}`}>
      {/* Translucent scrim: dims the page but keeps everything (incl. the disclaimer banner) legible,
          and blocks stray clicks so a beat's state isn't disturbed mid-tour. Gate (a) safe. */}
      <div className="guided-tour__scrim" aria-hidden="true" />

      {/* The spotlight ring is portaled to <body> and absolutely positioned in PAGE coordinates, so
          it tracks the anchor through scroll and sits above the scrim (its own z-index). */}
      {rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`guided-tour__ring${reducedMotion || !ringGlides ? ' guided-tour__ring--reduced' : ''}`}
            aria-hidden="true"
            style={{
              top: rect.top - PAD,
              left: rect.left - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
            }}
          />,
          document.body,
        )}

      <div
        className="guided-tour__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        tabIndex={-1}
        ref={cardRef}
        onKeyDown={onCardKeyDown}
      >
        <div className="guided-tour__progress">
          Step {step + 1} of {TOUR_STEPS.length}
        </div>
        <h2 className="guided-tour__title" id="guided-tour-title">
          {current.title}
        </h2>
        <p className="guided-tour__body">{current.body}</p>
        <div className="guided-tour__actions">
          <button type="button" className="guided-tour__skip" onClick={endTour}>
            Skip tour
          </button>
          <div className="guided-tour__nav">
            <button
              type="button"
              className="guided-tour__btn"
              onClick={prev}
              disabled={isFirst}
            >
              Back
            </button>
            {isLast ? (
              <button type="button" className="guided-tour__btn guided-tour__btn--primary" onClick={endTour}>
                Done
              </button>
            ) : (
              <button type="button" className="guided-tour__btn guided-tour__btn--primary" onClick={next}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
