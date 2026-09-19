/**
 * Web Worker wrapper for the analytical E-field solver (Milestone 2/3).
 *
 * WHY THIS EXISTS: a single solver pass over ~50k cortical vertices × ~254 dipoles
 * measures ≈ 50 ms in V8 (see the benchmark in efield.test.ts) — well over the 16 ms
 * frame budget. Running it on the main thread would stutter the R3F scene while the
 * coil is dragged, so M3 offloads recompute to this worker and recolours when the
 * field message comes back (the heatmap recolours only on pose change, not per frame).
 *
 * This module is the WORKER ENTRY only (it owns one solver instance and answers
 * `solve` messages). It must NOT be imported on the main thread — M3 spawns it with:
 *
 *   const worker = new Worker(new URL('./efield.worker.ts', import.meta.url), { type: 'module' })
 *   worker.postMessage({ type: 'init', positions: positions.buffer }, [positions.buffer])
 *   worker.onmessage = (e) => { if (e.data.type === 'field') recolor(new Float32Array(e.data.field)) }
 *   worker.postMessage({ type: 'solve', pose, intensity, id })
 *
 * The pure solver it wraps (efield.ts) is what the unit tests exercise; this file is
 * a thin, message-marshalling shell with no physics of its own.
 */

import { createEFieldSolver, type EFieldSolver } from './efield'
import type { CoilPose, SolverOptions } from './efield'
import { referencePeak } from './reference'
import { GLYPH_STRIDE } from './glyphLayout'

/** Main thread → worker. */
export type SolverRequest =
  | {
      type: 'init'
      /** Interleaved vertex positions [x,y,z,…] in MNI mm; transfer its ArrayBuffer. */
      positions: ArrayBuffer
      /** Solver options. NB: a transferred CoilModel's buffers must also be transferred. */
      options?: SolverOptions
    }
  | {
      type: 'solve'
      pose: CoilPose
      /** Relative dI/dt proxy (store.intensity). */
      intensity: number
      /** Optional correlation id so the client can match responses to requests. */
      id?: number
    }

/**
 * Depth–dose metrics piggy-backed on the field reply (v1.1). Plain numbers, INCLUDED in the
 * message object (NOT transferred) so the heatmap hook can publish them to the store for the
 * `FieldMetricsCard`. This is the FIRST additive extension of the shared `'field'` contract —
 * later viz layers (#1 glyphs, #13 residual, #9 FEM) extend it the same minimal, additive way.
 */
export interface FieldMetricsPayload {
  /** Half-value depth d½ (mm, relative/illustrative). */
  hvd: number
  /** On-surface half-max spread S½ (mm, relative/illustrative). */
  spread: number
  /** Surface peak |E| (relative units). */
  peak: number
}

/** Worker → main thread. */
export type SolverResponse =
  | { type: 'ready'; referencePeak: number; vertexCount: number; dipoleCount: number }
  | {
      type: 'field'
      id?: number
      field: ArrayBuffer
      metrics?: FieldMetricsPayload
      /**
       * Optional interleaved E-field DIRECTION-glyph buffer (v1.2, #1): the same additive extension
       * pattern as `metrics`, but a TRANSFERRED `ArrayBuffer` (it carries per-glyph floats, so it
       * rides the transfer list, not a structured-clone copy). `GLYPH_STRIDE` floats per glyph; the
       * length / `GLYPH_STRIDE` is the glyph count. See glyphLayout.ts for the layout.
       */
      glyphs?: ArrayBuffer
      /**
       * Optional per-vertex radial-removal RESIDUAL buffer (v1.3, #13) — the THIRD additive
       * extension of this contract, alongside `metrics` and `glyphs`. A TRANSFERRED `ArrayBuffer`
       * of one Float32 per vertex (same length/order as `field`): `|E·n̂|`, the magnitude the
       * spherical approximation strips out. Maps through the SAME LUT as `field`, selected by
       * `store.colorSource`. Relative units, NOT a validated error — see DESIGN §3.2.
       */
      residual?: ArrayBuffer
    }
  | { type: 'error'; message: string }

/**
 * Minimal dedicated-worker scope (the project's tsconfig loads the DOM lib, not the
 * WebWorker lib, so we type just what we use instead of pulling a conflicting lib).
 */
interface WorkerScope {
  postMessage(message: SolverResponse, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent<SolverRequest>) => void) | null
}

const ctx = globalThis as unknown as WorkerScope

let solver: EFieldSolver | null = null

ctx.onmessage = (event: MessageEvent<SolverRequest>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      const positions = new Float32Array(msg.positions)
      solver = createEFieldSolver(positions, msg.options)
      ctx.postMessage({
        type: 'ready',
        referencePeak: referencePeak(solver, positions),
        vertexCount: solver.vertexCount,
        dipoleCount: solver.dipoleCount,
      })
      return
    }
    if (msg.type === 'solve') {
      if (!solver) {
        ctx.postMessage({ type: 'error', message: 'solve before init' })
        return
      }
      // Solve, then read depth–dose metrics off that SAME solve (its posed dipoles + sphere +
      // live `field`) BEFORE we copy/transfer the buffer. The solver reuses its own `field`
      // buffer, so copy it to transfer (and not detach) the live one. `metrics` rides along as
      // plain numbers (structured-cloned, not transferred).
      const field = solver.solve(msg.pose, msg.intensity)
      const { hvd, spread, peak } = solver.computeMetrics()
      // DIRECTION glyphs ride the SAME solve (its `field`/`ex/ey/ez`/sphere) and are computed
      // unconditionally — the O(N) select is sub-millisecond next to the O(N·K) solve, so the
      // glyph layer (default OFF) can paint instantly from the latest reply when toggled on, with
      // no re-solve. Slice the solver's reused glyph buffer to its live length, then TRANSFER it
      // (don't structured-clone) alongside the field.
      const glyphCount = solver.computeGlyphs()
      const out = field.slice()
      const glyphsOut = solver.glyphs.slice(0, glyphCount * GLYPH_STRIDE)
      // The radial-removal RESIDUAL (v1.3, #13) is filled in place by the same solve. Copy the
      // solver's reused buffer (don't detach it) and TRANSFER the copy alongside the field — it is
      // free data (no extra solve), so the residual layer (default OFF) can paint from the latest
      // reply when toggled on, with no re-solve.
      const residualOut = solver.residual.slice()
      ctx.postMessage(
        {
          type: 'field',
          id: msg.id,
          field: out.buffer,
          metrics: { hvd, spread, peak },
          glyphs: glyphsOut.buffer,
          residual: residualOut.buffer,
        },
        [out.buffer, glyphsOut.buffer, residualOut.buffer],
      )
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
