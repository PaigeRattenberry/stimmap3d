/**
 * Live E-field heatmap wiring (Milestone 3) — drives the M2 Web Worker and recolours
 * the cortex when a field comes back. The solver NEVER runs on the main thread (a single
 * ~50k-vert × ~254-dipole pass measured ≈ 52 ms in V8, over the 16 ms frame budget);
 * this hook owns the worker and only mutates vertex colours on the `field` reply.
 *
 * KEY BEHAVIOURS
 *  • init transfers a COPY of the brain positions, never the live geometry buffer —
 *    transferring that would detach it and blank the mesh.
 *  • Coalescing: at most ONE solve is in flight. While dragging, newer poses overwrite a
 *    single `pending` slot; when the field returns we recolour, then send the latest
 *    pending pose. A fast drag can never back up the worker queue → no stutter.
 *  • `id` stale-drop: each solve carries an incrementing id; a reply whose id is not the
 *    one we are waiting on is ignored (belt-and-braces alongside single-in-flight).
 *  • Store coupling is TRANSIENT (`store.subscribe`), so dragging the coil does not
 *    re-render the React tree every pointer move — only the worker round-trips.
 *  • Re-solve fires on COIL-POSE or TILT change, posting the tilt-COMPOSED pose (`composeTilt`)
 *    the rendered coil uses. |E| is linear in `intensity` and the default scale scales with it,
 *    so an intensity change does not re-solve (only a cached zero/absent field is re-requested).
 *  • VALIDITY: `store.solverStatus` is 'loading' | 'ready' | 'error'.
 *    A mid-drag reply that a newer pose has superseded is still PAINTED (live feedback, one solve
 *    behind) but leaves the status 'loading'; only a reply for the pose on screen with nothing
 *    queued is 'ready', which is what gates PNG export. A preset/reset re-snap invalidates (clears
 *    colours, glyphs, peak, metrics) and drops replies from the old placement. Worker startup,
 *    computation, decode, and timeout failures are TERMINAL: output is cleared and the user is
 *    asked to reload.
 *  • Normalisation: smooth layers use the field's histogram 99.9th percentile (`st.max`);
 *    iso-contour bands use the absolute per-pose maximum (`st.absMax`); the fixed-scale explainer
 *    uses the deterministic reference-v1 peak (`solver/reference.ts`), solved at intensity 1 on every
 *    worker init. The residual layer maps through the same field reference. Toggles, colormap and
 *    colour-source changes RE-COLOUR the cached buffers — never a re-solve, never a realloc.
 * All values are RELATIVE units, never V/m (gate (e)).
 */

import { useEffect, useRef } from 'react'
import type { BufferGeometry, Float32BufferAttribute } from 'three'
import { useStimStore } from '../store'
import type { CoilPose } from '../store'
import { composeTilt } from './coilPlacement'
import {
  applyContourColors,
  applyFieldColors,
  computeFieldScale,
  fixedScaleMax,
  getColorAllocCount,
  getColormapLUT,
  HIST_BINS,
} from './HeatmapMaterial'
import { clearGlyphs, publishGlyphs } from './glyphChannel'
import { clearPeak, publishPeak } from './peakChannel'
import {
  initialCoalescerState,
  reduceCoalescer,
  type CoalescerAction,
  type CoalescerResult,
  type CoalescerState,
} from './efieldCoalescer'
import type { SolverRequest, SolverResponse } from '../solver/efield.worker'

/**
 * The store's initial/reset coil position is the [0,0,0] head-origin sentinel — a coil buried
 * inside the head, never a real placement (TMSCoil projects it onto the scalp moments later). We
 * skip solving it so a `reset()` (or the first frame before placement) doesn't spend a ~50 ms
 * worker pass on, and briefly recolour the cortex for, an off-target buried pose. A scalp drag or
 * preset projection can never land exactly on the origin, so this only ever skips the placeholder.
 */
export function isPlaceholderPose(pose: CoilPose): boolean {
  const [x, y, z] = pose.position
  return x === 0 && y === 0 && z === 0
}

interface HeatmapRuntime {
  worker: Worker | null
  /** Single-in-flight solve coalescer state — the pure reducer in `efieldCoalescer.ts` (#25) owns
   *  every send / queue / stale-drop decision; the hook just performs the `send` effects it returns. */
  coalescer: CoalescerState
  field: Float32Array | null
  /** Latest interleaved E-field DIRECTION-glyph buffer (v1.2), or null before the first reply. */
  glyphs: Float32Array | null
  /** Latest per-vertex radial-removal RESIDUAL buffer (v1.3, #13), or null before the first reply. */
  residual: Float32Array | null
  /** Robust normalisation reference (per-pose high percentile of |E|). */
  max: number
  /** Intensity the cached `field` was SOLVED at (v2.3, #8) — the fixed-scale path re-scales by
   *  current÷this without a re-solve. Set from the matched solve's request each field reply. */
  fieldIntensity: number
  /** Intensity of the most recent `send` (v2.3) — promoted to `fieldIntensity` when its reply lands. */
  lastSolveIntensity: number
  /** Deterministic reference-v1 peak at intensity 1 (solver/reference.ts). */
  fixedRef: number
  /** The `max` fed to the most recent recolour (v2.3) — the DEV handle exposes it so the Playwright
   *  pass can assert intensity moves it in the fixed-scale path and not in the default/contour paths. */
  appliedMax: number
  lut: Float32Array
  /** Reused histogram for the robust field scale (allocate-once). */
  hist: Int32Array
  // diagnostics (DEV)
  absMax: number
  p99: number
  solves: number
  fields: number
  recolors: number
}

/** DEV-only handle the Playwright verification reads (see Scene `__setCoilPose`). */
interface HeatmapWindow {
  __stimHeatmap?: {
    readonly solves: number
    readonly fields: number
    readonly recolors: number
    readonly allocs: number
    readonly max: number
    readonly absMax: number
    readonly p99: number
    readonly ready: boolean
    readonly vertexCount: number
    /** Active heatmap colour source ('field' | 'residual') (v1.3, #13). */
    readonly colorSource: string
    /** Whether the fixed-scale intensity explainer is active (v2.3, #8). */
    readonly fixedScaleExplainer: boolean
    /** Whether the iso-contour focality overlay is active (v2.3, #14). */
    readonly showFocalityContours: boolean
    /** The normalisation `max` applied by the most recent recolour (v2.3) — constant across an
     *  intensity change in the default/contour paths; inversely scaled by it in the fixed-scale path. */
    readonly appliedMax: number
    /**
     * Residual at the focal (peak-|E|) cap vertex ÷ the largest residual anywhere (v1.3) — small
     * when the residual is ≈0 directly under the coil and grows away from it (the self-error story).
     */
    readonly peakResidualFraction: number
  }
}

/** Recolor the selected scalar using the explicitly defined field reference for each mode. */
export function recolorActive(st: HeatmapRuntime, colorAttr: Float32BufferAttribute): void {
  const s = useStimStore.getState()
  const buf = s.colorSource === 'residual' ? st.residual : st.field
  if (!buf) return
  if (s.showFocalityContours) {
    // v2.3 #14 — iso-contour focality bands. ALWAYS against the absolute per-pose peak (`st.absMax`), so
    // the "% of this-pose peak" label stays honest even when the fixed-scale explainer is also on.
    applyContourColors(colorAttr, buf, st.absMax, st.lut)
    st.appliedMax = st.absMax
  } else if (s.fixedScaleExplainer && st.fixedRef > 0 && st.fieldIntensity > 0) {
    // v2.3 #8 — fixed-scale intensity explainer. Map the cached field against the FROZEN reference,
    // re-scaled to the CURRENT intensity (no re-solve) so cranking intensity brightens the cortex.
    const max = fixedScaleMax(st.fixedRef, st.fieldIntensity, s.intensity)
    applyFieldColors(colorAttr, buf, max, st.lut)
    st.appliedMax = max
  } else {
    // Default M3 path: normalised to the robust per-pose peak → exactly invariant to intensity.
    applyFieldColors(colorAttr, buf, st.max, st.lut)
    st.appliedMax = st.max
  }
  st.recolors++
}

export function useEFieldHeatmap(
  geometry: BufferGeometry,
  colorAttr: Float32BufferAttribute,
): void {
  const colormap = useStimStore((s) => s.colormap)

  const rt = useRef<HeatmapRuntime>({
    worker: null,
    coalescer: initialCoalescerState(),
    field: null,
    glyphs: null,
    residual: null,
    max: 0,
    fieldIntensity: 0,
    lastSolveIntensity: 0,
    fixedRef: 0,
    appliedMax: 0,
    lut: getColormapLUT(useStimStore.getState().colormap),
    hist: new Int32Array(HIST_BINS),
    absMax: 0,
    p99: 0,
    solves: 0,
    fields: 0,
    recolors: 0,
  })

  // --- worker lifecycle + transient store subscription (mount once per geometry) ---
  useEffect(() => {
    const st = rt.current
    // Vite/Rolldown bundles this worker from the URL; the path is relative to THIS module.
    let timer: ReturnType<typeof setTimeout> | undefined
    let failed = false
    let sentPose = useStimStore.getState().coilPose
    let sentTilt = 0
    let sentPlacement = -1
    let worker: Worker
    const blank = new Float32Array(colorAttr.count)
    const invalidate = () => {
      st.field = null; st.residual = null; st.glyphs = null
      clearGlyphs(); clearPeak()
      applyFieldColors(colorAttr, blank, 0, st.lut)
      useStimStore.setState({ fieldMetrics: null })
    }
    const fail = (message: string) => {
      failed = true
      clearTimeout(timer)
      worker?.terminate()
      invalidate()
      useStimStore.setState({ solverStatus: 'error', solverError: message, fieldMetrics: null })
    }
    const armTimeout = (phase: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => fail('Solver ' + phase + ' timed out. Reload to retry.'), 15000)
    }
    useStimStore.setState({ solverStatus: 'loading', solverError: null, fieldMetrics: null })
    try {
      worker = new Worker(new URL('../solver/efield.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      fail('Solver worker could not start. Reload to retry.')
      return
    }
    armTimeout('startup')
    st.worker = worker

    // Drive the pure coalescer (efieldCoalescer.ts, #25): apply the transition, then perform any
    // SEND side-effect it returns. The reducer owns the {ready, inFlight, pending, id} bookkeeping;
    // the hot-path side-effects (the solve counter, the fixed-scale intensity record, postMessage)
    // stay here. This is the single seam where a solve actually leaves for the worker.
    const dispatch = (action: CoalescerAction): CoalescerResult => {
      const result = reduceCoalescer(st.coalescer, action)
      st.coalescer = result.state
      if (result.send) {
        st.solves++
        sentPose = useStimStore.getState().coilPose
        sentTilt = useStimStore.getState().tilt
        sentPlacement = useStimStore.getState().placementSeq
        // Remember the intensity this solve uses; single-in-flight + id stale-drop guarantee it still
        // matches when the reply lands → promoted to `st.fieldIntensity` for the fixed-scale path (#8).
        st.lastSolveIntensity = result.send.req.intensity
        const msg: SolverRequest = {
          type: 'solve',
          pose: result.send.req.pose,
          intensity: result.send.req.intensity,
          id: result.send.id,
        }
        armTimeout('computation')
        try { worker.postMessage(msg) } catch { fail('Solver request could not be sent.') }
      }
      return result
    }

    // Not ready yet, or a solve is already running → the reducer keeps only the LATEST request.
    // Deliberately does NOT invalidate: the last painted field stays on the cortex while the next
    // solve runs, so a drag or slider scrub keeps live feedback. `loading` alone blocks PNG export.
    const request = (pose: CoilPose, intensity: number) => {
      if (failed) return
      useStimStore.setState({ solverStatus: 'loading', solverError: null })
      dispatch({ type: 'request', req: { pose, intensity } })
    }

    const recolor = () => recolorActive(st, colorAttr)

    // The cortex position attribute (MNI mm) stays intact — the worker init transfers a COPY, never
    // this buffer. Used to look up the focal hotspot's coordinates for the PeakMarker (v2.3, #14).
    const positionAttr = geometry.getAttribute('position')
    const publishPeakFrom = (field: Float32Array): void => {
      let pk = 0
      for (let i = 1; i < field.length; i++) if (field[i] > field[pk]) pk = i
      publishPeak(positionAttr.getX(pk), positionAttr.getY(pk), positionAttr.getZ(pk))
    }

    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      if (failed) return
      const data = event.data
      if (data.type === 'ready') {
        clearTimeout(timer)
        st.fixedRef = data.referencePeak
        dispatch({ type: 'ready' })
        // Kick the first solve from whatever pose the store currently holds (the coil's
        // initial scalp placement may already have written it, or arrive moments later). Skip
        // the [0,0,0] placeholder — the coil hasn't been projected onto the scalp yet. The
        // placeholder check is on the BASE pose; we solve the tilt-composed pose.
        const s = useStimStore.getState()
        if (!isPlaceholderPose(s.coilPose)) request(composeTilt(s.coilPose, s.tilt), s.intensity)
        return
      }
      if (data.type === 'field') {
        // The reducer owns the stale-drop: a reply we no longer await clears nothing and is dropped
        // here with no recolour. A matched reply clears in-flight; pending fires AFTER we paint.
        if (dispatch({ type: 'reply', id: data.id }).stale) return
        clearTimeout(timer)
        const current = useStimStore.getState()
        // A reply solved before a preset/reset re-snap belongs to a discarded placement: never paint it.
        if (sentPlacement !== current.placementSeq) { dispatch({ type: 'flushPending' }); return }
        // A reply superseded mid-drag is still painted (the heatmap tracks the drag, one solve behind),
        // but only a reply for the pose on screen, with nothing queued, marks the field current.
        const settled = !st.coalescer.pending && sentPose === current.coilPose && sentTilt === current.tilt
        const field = new Float32Array(data.field)
        if (field.length !== colorAttr.count || field.some(v => !Number.isFinite(v)) || !data.metrics || !Object.values(data.metrics).every(Number.isFinite)) { fail('Solver returned invalid field data.'); return }
        st.field = field
        const scale = computeFieldScale(field, field.length, st.hist)
        st.max = scale.peak
        st.absMax = scale.absMax
        st.p99 = scale.p99
        // Cache solve intensity for linear rescaling against reference v1.
        st.fieldIntensity = st.lastSolveIntensity

        // Radial-removal RESIDUAL self-error layer (v1.3, #13): cache it (free data off this same
        // reply) so toggling colorSource later re-colours instantly with no re-solve. It maps
        // through the SAME per-pose peak (st.max) as the field — matched relative units (gate (e)).
        if (data.residual) st.residual = new Float32Array(data.residual)
        st.fields++
        recolor() // paints whichever source (field | residual) colorSource currently selects
        // v2.3 #14 — publish the focal hotspot (argmax|E|, the SAME peak the metrics card reports)
        // for the PeakMarker over the module bus, never the store (no React re-render on the drag
        // hot path). Cached, so toggling the overlay on later places the marker with no re-solve.
        publishPeakFrom(field)
        // Route the E-field DIRECTION glyphs to the (optional) glyph layer via the module bus —
        // NOT the store (a per-pose buffer must not re-render React on the drag hot path). Coloured
        // through the SAME per-pose peak (st.max) + LUT (st.lut) as the heatmap. Published every
        // reply and cached, so toggling the layer on later paints instantly with no re-solve.
        if (data.glyphs) {
          st.glyphs = new Float32Array(data.glyphs)
          publishGlyphs(st.glyphs, st.max, st.lut)
        }
        // Publish depth–dose metrics for the card/HUD (store update → only they re-render). They track
        // the painted field; `solverStatus` stays 'loading' (export blocked) until the reply is settled.
        if (st.fieldIntensity > 0) useStimStore.setState({ fieldMetrics: { ...data.metrics, peak: data.metrics.peak * current.intensity / st.fieldIntensity }, solverStatus: settled ? 'ready' : 'loading', solverError: null })
        dispatch({ type: 'flushPending' }) // coalesced: fire the most recent pose now (if any)
        return
      }
      // Terminal failure: clear output and require an explicit reload.
      fail('Solver computation failed: ' + data.message)
    }

    worker.onerror = (e) => {
      // Environment-level failures cannot be recovered by sending another pose.
      e.preventDefault()
      fail('Solver worker failed to load or stopped unexpectedly.')
    }

    worker.onmessageerror = () => fail('Solver response could not be decoded.')

    // Paint the unsolved baseline (LUT floor) so the cortex never flashes black before
    // the first field arrives.
    applyFieldColors(colorAttr, new Float32Array(colorAttr.count), 0, st.lut)

    // init — transfer a COPY of the positions, never the live geometry buffer.
    const position = geometry.getAttribute('position')
    const positions = new Float32Array(position.array as Float32Array)
    const initMsg: SolverRequest = { type: 'init', positions: positions.buffer }
    try { worker.postMessage(initMsg, [positions.buffer]) } catch { fail('Solver initialization could not be sent.') }

    // Transient subscription: re-solve on coil-pose OR tilt change WITHOUT re-rendering React on
    // every drag frame. Intensity is deliberately NOT a trigger once a valid field is cached (see
    // the header note — the per-pose-normalised heatmap is invariant to it, so a re-solve would be
    // wasted work with no visible change). We still pass the CURRENT intensity so the solved field
    // stays correctly scaled for any later consumer. The posted pose is the tilt-COMPOSED pose,
    // so a tilt change re-solves the canted field and the placeholder guard uses the base pose.
    const unsubscribe = useStimStore.subscribe((s, prev) => {
      if (failed) return
      if (s.placementSeq !== prev.placementSeq || (s.coilPose !== prev.coilPose && isPlaceholderPose(s.coilPose))) invalidate()
      if (s.intensity !== prev.intensity) {
        if (!(st.fieldIntensity > 0) || !(st.absMax > 0)) {
          if (!isPlaceholderPose(s.coilPose)) request(composeTilt(s.coilPose, s.tilt), s.intensity)
        } else if (s.fieldMetrics) {
          useStimStore.setState({ fieldMetrics: { ...s.fieldMetrics, peak: st.absMax * s.intensity / st.fieldIntensity } })
        }
      }
      if (
        (s.coilPose !== prev.coilPose || s.tilt !== prev.tilt) &&
        !isPlaceholderPose(s.coilPose)
      ) {
        request(composeTilt(s.coilPose, s.tilt), s.intensity)
      }
      // Switching the colour source ('field' ↔ 'residual', v1.3 #13) only re-maps the cached
      // buffers through the LUT — no re-solve, no realloc (same color attribute).
      if (s.colorSource !== prev.colorSource) recolor()
      // v2.3 explainers — a toggle change re-colours the cached buffers (no re-solve). An intensity
      // change re-colours ONLY in the fixed-scale path (#8): the default + contour paths normalise to
      // the per-pose peak, so they are intensity-invariant and a recolour there would be wasted work
      // with identical output (this is exactly what keeps the default footprint invariant).
      if (
        s.fixedScaleExplainer !== prev.fixedScaleExplainer ||
        s.showFocalityContours !== prev.showFocalityContours
      ) {
        recolor()
      }
      if (s.intensity !== prev.intensity && s.fixedScaleExplainer && !s.showFocalityContours) {
        recolor()
      }
    })

    if (import.meta.env.DEV) {
      const w = window as unknown as HeatmapWindow
      w.__stimHeatmap = {
        get solves() {
          return st.solves
        },
        get fields() {
          return st.fields
        },
        get recolors() {
          return st.recolors
        },
        get allocs() {
          return getColorAllocCount()
        },
        get max() {
          return st.max
        },
        get absMax() {
          return st.absMax
        },
        get p99() {
          return st.p99
        },
        get ready() {
          return st.coalescer.ready
        },
        get vertexCount() {
          return colorAttr.count
        },
        get colorSource() {
          return useStimStore.getState().colorSource
        },
        get fixedScaleExplainer() {
          return useStimStore.getState().fixedScaleExplainer
        },
        get showFocalityContours() {
          return useStimStore.getState().showFocalityContours
        },
        get appliedMax() {
          return st.appliedMax
        },
        get peakResidualFraction() {
          // Residual at the focal (peak-|E|) cap vertex ÷ the largest residual anywhere: ≈0 under
          // the coil, larger away from it. One O(n) scan on demand (DEV only) — hot path untouched.
          if (!st.field || !st.residual) return 0
          let pk = 0
          let maxR = 0
          for (let i = 0; i < st.field.length; i++) {
            if (st.field[i] > st.field[pk]) pk = i
            if (st.residual[i] > maxR) maxR = st.residual[i]
          }
          return maxR > 0 ? st.residual[pk] / maxR : 0
        },
      }
    }

    return () => {
      unsubscribe()
      clearTimeout(timer)
      failed = true
      useStimStore.setState({ fieldMetrics: null, solverStatus: 'loading', solverError: null })
      worker.terminate()
      st.worker = null
      // Reset the coalescer's ready/in-flight/pending, but KEEP the id counter climbing across a
      // remount (exactly as the old inline cleanup did) so any late reply from the now-terminated
      // worker can never match a fresh `expectedId`.
      st.coalescer = { ...st.coalescer, ready: false, inFlight: false, pending: null }
      // Drop the cached field so a remount (or the colormap effect re-running because
      // `colorAttr` changed with a new geometry) can't re-map a stale, possibly
      // wrong-sized field against the fresh attribute.
      st.field = null
      // Likewise drop the cached glyphs (their positions are in the old geometry's MNI frame).
      st.glyphs = null
      clearGlyphs()
      // …and the cached residual (a stale, possibly wrong-sized buffer must not re-map either).
      st.residual = null
      // …and the cached peak position (old MNI frame) + the frozen fixed-scale reference, so a fresh
      // geometry re-calibrates the explainer instead of inheriting a stale anchor (v2.3, #8/#14).
      clearPeak()
      st.fixedRef = 0
      st.fieldIntensity = 0
      if (import.meta.env.DEV) {
        delete (window as unknown as HeatmapWindow).__stimHeatmap
      }
    }
  }, [geometry, colorAttr])

  // --- colormap change: re-map the cached buffers through the new LUT (no re-solve) ---
  useEffect(() => {
    const st = rt.current
    st.lut = getColormapLUT(colormap)
    // Re-colour the active source (field | residual, v1.3) through the new LUT — no-op until a
    // field reply has populated the matching buffer.
    recolorActive(st, colorAttr)
    // Re-colour the glyph layer through the new LUT too, so arrows track the colormap toggle.
    if (st.glyphs) publishGlyphs(st.glyphs, st.max, st.lut)
  }, [colormap, colorAttr])
}
