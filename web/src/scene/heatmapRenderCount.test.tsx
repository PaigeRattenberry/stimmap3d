// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useEFieldHeatmap } from './useEFieldHeatmap'
import { ensureColorAttribute, getColorAllocCount } from './HeatmapMaterial'
import { useStimStore } from '../store'

/**
 * Milestone P0 / #31 — pin the headline perf invariants: dragging the coil must NOT re-render the
 * React tree, and an intensity change must NOT re-solve (the per-pose-normalised heatmap is
 * intensity-invariant, so a re-solve would spend a ~50 ms worker pass for zero visible change).
 * The recolor path couples to the store TRANSIENTLY (`store.subscribe`) and reads only ONE reactive
 * slice (`colormap`) via a selector, so coil-pose / tilt changes drive a worker round-trip with
 * zero React re-render, intensity drives neither, and a colormap change re-renders exactly once
 * (re-mapping the cached field through the new LUT — no re-solve).
 *
 * Until now the only guard was the DEV `window.__stimHeatmap` handle read by MANUAL Playwright; this
 * mounts the REAL hook and counts both renders and solves. The single consumer of the hook is
 * Scene's `HeatmapBrain` (a 4-line wrapper that calls `useEFieldHeatmap` and renders `<BrainMesh>`,
 * with NO reactive store reads of its own), so the subscription footprint this guards lives entirely
 * in the hook — which is imported real here, not cloned. `HeatmapBrainProbe` mirrors that wrapper so
 * a regression that adds e.g. `useStimStore(s => s.coilPose)` to the hook turns CI red.
 *
 * The Worker is stubbed (happy-dom has no real one and we don't need the solver) — we assert the
 * subscription/selector wiring + the allocate-once color buffer, never WebGL output (that stays in
 * the advisory Playwright pass — WebGL CI is nondeterministic).
 */

interface PostedMsg {
  type?: string
  id?: number
}
let lastWorker: MockWorker | null = null
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: PostedMsg[] = []
  constructor() {
    lastWorker = this
  }
  postMessage(msg: PostedMsg) {
    this.posted.push(msg)
  }
  terminate() {}
}

beforeEach(() => {
  vi.stubGlobal('Worker', MockWorker)
  lastWorker = null
})

afterEach(() => {
  cleanup()
  act(() => useStimStore.getState().reset())
  vi.unstubAllGlobals()
})

const VERTS = 8
function geometryWithVertices(n: number): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3))
  return g
}

let renders = 0
/** A faithful copy of Scene's `HeatmapBrain` consumer (minus the `<BrainMesh>` it returns). */
function HeatmapBrainProbe({ geometry }: { geometry: BufferGeometry }) {
  renders++
  const colorAttr = useMemo(() => ensureColorAttribute(geometry), [geometry])
  useEFieldHeatmap(geometry, colorAttr)
  return null
}

const solveCount = (w: MockWorker) => w.posted.filter((m) => m.type === 'solve').length
const lastSolveId = (w: MockWorker) =>
  [...w.posted].reverse().find((m) => m.type === 'solve')?.id ?? -1

/** Deliver a matched `field` reply so the in-flight solve clears and the worker goes idle. */
function deliverField(w: MockWorker, id: number, value = 1) {
  act(() =>
    w.onmessage?.(
      new MessageEvent('message', {
        data: { type: 'field', id, field: new Float32Array(VERTS).fill(value).buffer, metrics: { hvd: 12, spread: 13, peak: value } },
      }),
    ),
  )
}

describe('useEFieldHeatmap render-count & re-solve invariants (#31)', () => {
  it('coil-pose / tilt re-solve transiently with no re-render; intensity does neither; colormap re-renders once', () => {
    const g = geometryWithVertices(VERTS)
    const allocsBefore = getColorAllocCount()
    renders = 0
    render(<HeatmapBrainProbe geometry={g} />)
    expect(renders).toBe(1) // a single mount render

    // Allocate-once (CLAUDE.md buffer rule / acceptance: getColorAllocCount() === 1): mounting the
    // heatmap consumer creates EXACTLY one color attribute.
    expect(getColorAllocCount() - allocsBefore).toBe(1)

    const w = lastWorker
    expect(w).not.toBeNull()
    expect(w!.posted.some((m) => m.type === 'init')).toBe(true) // init posted on mount

    // Bring the worker up. The kick is skipped (the store's initial pose is the [0,0,0] placeholder),
    // so the worker is idle with no solve yet.
    act(() => w!.onmessage?.(new MessageEvent('message', { data: { type: 'ready', referencePeak: 1 } })))
    expect(solveCount(w!)).toBe(0)

    // (1) A coil drag from idle: routes through the TRANSIENT subscription → a worker solve is sent,
    // and the React tree does NOT re-render. This is the invariant #31 exists to protect.
    act(() => useStimStore.getState().setCoilPose({ position: [-50, 53, 42] }))
    expect(renders).toBe(1) // ← no re-render on drag
    expect(solveCount(w!)).toBe(1) // …but the solve WAS dispatched transiently

    // Clear that solve so the worker is genuinely IDLE — only then could a forbidden intensity
    // re-solve actually fire, which is what makes the next assertion bite.
    deliverField(w!, lastSolveId(w!))
    expect(renders).toBe(1) // painting the returned field does not re-render the consumer either
    expect(solveCount(w!)).toBe(1) // nothing queued → no follow-up solve

    // (2) Intensity from idle: NOT a heatmap trigger → no re-solve AND no re-render. A regression
    // that added intensity to the re-solve subscription would send a solve here (idle) and fail this.
    act(() => useStimStore.getState().setIntensity(1.7))
    expect(renders).toBe(1) // no re-render
    expect(solveCount(w!)).toBe(1) // ← no re-solve (per-pose-normalised → intensity-invariant)

    // (3) Colormap is the ONE reactive selector the hook reads → exactly one re-render, and it
    // re-maps the cached LUT rather than re-solving.
    act(() => useStimStore.getState().setColormap('turbo'))
    expect(renders).toBe(2) // exactly one re-render
    expect(solveCount(w!)).toBe(1) // colormap never re-solves
    expect(getColorAllocCount() - allocsBefore).toBe(1) // …and allocates no second color buffer

    // (4) Tilt from idle: IS a re-solve trigger (deeper d½ / broader S½) but, like the drag, runs
    // through the transient subscription → a new solve, still NO additional re-render.
    act(() => useStimStore.getState().setTilt(20))
    expect(renders).toBe(2) // no extra re-render
    expect(solveCount(w!)).toBe(2) // tilt re-solved transiently
  })
})

// Solve validity must not cost live drag feedback: a reply superseded mid-drag is still painted (with its
// metrics), but only the reply for the pose on screen marks the field 'ready' (the PNG export gate).
it('paints a superseded mid-drag reply without marking it ready; the settled reply is ready', () => {
  const g = geometryWithVertices(VERTS)
  render(<HeatmapBrainProbe geometry={g} />)
  const w = lastWorker!
  const color = g.getAttribute('color')
  act(() => w.onmessage?.(new MessageEvent('message', { data: { type: 'ready', referencePeak: 1 } })))
  const blankR = color.getX(0)

  act(() => useStimStore.getState().setCoilPose({ position: [-50, 53, 42] }))
  const firstId = lastSolveId(w)
  act(() => useStimStore.getState().setCoilPose({ position: [-51, 53, 42] })) // drag continues → pending
  deliverField(w, firstId)
  expect(color.getX(0)).not.toBe(blankR) // the superseded field is on the cortex, not blanked
  expect(useStimStore.getState().fieldMetrics).not.toBeNull()
  expect(useStimStore.getState().solverStatus).toBe('loading')
  expect(solveCount(w)).toBe(2) // the pending pose was flushed

  act(() => useStimStore.getState().setTilt(10)) // a further move keeps the painted field + metrics
  expect(color.getX(0)).not.toBe(blankR)
  expect(useStimStore.getState().fieldMetrics).not.toBeNull()
  deliverField(w, lastSolveId(w))
  expect(useStimStore.getState().solverStatus).toBe('loading') // the tilt solve is still outstanding
  deliverField(w, lastSolveId(w))
  expect(useStimStore.getState().solverStatus).toBe('ready')

  act(() => useStimStore.getState().setPreset('Cz')) // a re-snap DOES invalidate
  expect(color.getX(0)).toBe(blankR)
  expect(useStimStore.getState().fieldMetrics).toBeNull()
})

// Old or corrupted state can contain a zero-intensity cached solve; valid controls must recover.
it('re-solves a cached zero field when intensity becomes positive', () => {
  useStimStore.setState({ intensity: 0, coilPose: { position: [0, 0, 80], rotation: [0, 0, 0], standoff: 4 } })
  render(<HeatmapBrainProbe geometry={geometryWithVertices(VERTS)} />)
  const w = lastWorker!
  act(() => w.onmessage?.(new MessageEvent('message', { data: { type: 'ready', referencePeak: 1 } })))
  deliverField(w, lastSolveId(w), 0)
  const before = solveCount(w)
  act(() => useStimStore.getState().setIntensity(1))
  expect(solveCount(w)).toBe(before + 1)
  deliverField(w, lastSolveId(w), 1)
  expect(useStimStore.getState().solverStatus).toBe('ready')
  expect(useStimStore.getState().fieldMetrics?.peak).toBe(1)
})
