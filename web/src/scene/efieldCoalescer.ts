/**
 * Single-in-flight E-field solve coalescer — PURE state machine (Milestone v2.6 / #25).
 *
 * Extracted from `useEFieldHeatmap`'s worker `useEffect` so the trickiest concurrency surface in
 * the app is unit-testable in isolation: "at most ONE solve in flight; while dragging, newer poses
 * overwrite a single `pending` slot; a reply whose id we are no longer waiting on is dropped".
 *
 * This module models DECISIONS ONLY. It owns the `{ready, inFlight, pending, lastId, expectedId}`
 * bookkeeping AND the stale-drop decision (so the drop rule lives in exactly one, unit-tested
 * place), and answers, for each event, "what is the next state, must we postMessage a solve, and —
 * for a reply — must the hook DROP it?". It performs NO side effects — no Worker, no store, no DOM.
 * `postMessage`, recolour, and glyph/peak publishing all stay in the hook, which calls
 * {@link reduceCoalescer} to decide the transition and then performs the {@link SendInstruction} the
 * reducer hands back. Behaviour is identical to the inline version it replaced (see
 * `efieldCoalescer.test.ts` for the drop / coalesce / stale-id ordering proofs).
 *
 * Event → action mapping in the hook:
 *   worker 'ready'          → `ready`        (then the hook dispatches the kick `request`)
 *   pose / tilt change      → `request`
 *   'field' reply           → `reply` (owns the stale-drop) … process the field … `flushPending`
 *   'error' message         → `fail` … `flushPending`   (clear, then fire the coalesced pose)
 *   env-level worker error  → `fail`                     (clear only; no pending re-fire)
 * The reply ORDERING (clear in-flight → the hook paints the field → `flushPending`) is split across
 * two dispatches on purpose: the field must be painted BEFORE the coalesced pose is re-fired.
 */
import type { CoilPose } from '../store'

/** One queued/in-flight solve request: the tilt-composed pose + the intensity it will be solved at. */
export interface SolveReq {
  pose: CoilPose
  intensity: number
}

/** The coalescer's entire state — the five fields the hook used to hold inline. */
export interface CoalescerState {
  /** Worker has answered `ready` — solves may now be sent (before this, requests only queue). */
  ready: boolean
  /** A solve is currently out at the worker (the single-in-flight invariant). */
  inFlight: boolean
  /** The latest request seen while not-ready or in-flight — only the NEWEST is kept (coalescing). */
  pending: SolveReq | null
  /** Monotonic id stamped on the most recent send. */
  lastId: number
  /** The id we are waiting on; a reply carrying any other id is stale and dropped. */
  expectedId: number
}

export type CoalescerAction =
  | { type: 'ready' }
  | { type: 'request'; req: SolveReq }
  | { type: 'reply'; id: number | undefined }
  | { type: 'fail' }
  | { type: 'flushPending' }

/** A solve the hook must postMessage: the request, and the id to stamp on it. */
export interface SendInstruction {
  req: SolveReq
  id: number
}

export interface CoalescerResult {
  state: CoalescerState
  /** Non-null ⇒ the hook must postMessage a `solve` for `send.req` carrying `send.id`. */
  send: SendInstruction | null
  /** Set by the `reply` action: a stale-id reply the hook must DROP without recolouring. */
  stale?: boolean
}

/** Fresh state: not ready, nothing in flight, no pending, `expectedId` -1 so no stray id matches. */
export function initialCoalescerState(): CoalescerState {
  return { ready: false, inFlight: false, pending: null, lastId: 0, expectedId: -1 }
}

/**
 * Is this reply for a solve we are no longer waiting on (id ≠ expected)? Belt-and-braces alongside
 * single-in-flight: a reply that lost the race to a newer send (or that arrives with no id) is
 * dropped without recolouring. `expectedId` starts at -1, so any reply before the first send drops.
 * Exported as a pure predicate so the `reply` action and the unit tests share ONE definition.
 */
export function isStaleReply(state: CoalescerState, id: number | undefined): boolean {
  return id !== state.expectedId
}

/**
 * Advance the state for a fresh send: stamp the next id, mark in-flight, clear the pending slot.
 * Shared by the `request` (ready & idle) and `flushPending` (coalesced) paths — the one place the
 * id increments, exactly as the old inline `send` did (`const id = ++st.lastId`).
 */
function applySend(state: CoalescerState, req: SolveReq): CoalescerResult {
  const id = state.lastId + 1
  return {
    state: { ...state, pending: null, inFlight: true, lastId: id, expectedId: id },
    send: { req, id },
  }
}

/**
 * The coalescer transition. Pure: returns the next state, (optionally) the solve the hook must
 * postMessage, and (for `reply`) whether the reply is stale and must be dropped. Never mutates
 * `state`.
 */
export function reduceCoalescer(state: CoalescerState, action: CoalescerAction): CoalescerResult {
  switch (action.type) {
    case 'ready':
      // Worker is up; solves may now be sent. The hook follows this with the kick `request`.
      return { state: { ...state, ready: true }, send: null }
    case 'request':
      // Not ready yet, or a solve is already running → keep ONLY the latest request (coalesce).
      if (!state.ready || state.inFlight) {
        return { state: { ...state, pending: action.req }, send: null }
      }
      return applySend(state, action.req)
    case 'reply':
      // A FIELD reply landed. The drop decision lives HERE, not in the hook: a reply whose id we no
      // longer await is stale → state untouched, `stale: true`, so the hook returns without
      // recolouring. A MATCHED reply clears in-flight; `pending` is deliberately LEFT intact so the
      // hook paints the field first, then dispatches `flushPending` to fire the coalesced pose.
      if (isStaleReply(state, action.id)) return { state, send: null, stale: true }
      return { state: { ...state, inFlight: false }, send: null, stale: false }
    case 'fail':
      // A worker ERROR (message or env-level): the in-flight solve is dead, so clear it
      // unconditionally (an error carries no id to match). The hook decides whether to re-fire the
      // coalesced pose (error message → yes, via `flushPending`; env-level onerror → no).
      return { state: { ...state, inFlight: false }, send: null }
    case 'flushPending':
      // Coalesced: fire the most recent pose that arrived while we were busy, if any. With NO
      // pending this is a referential no-op — it returns the SAME state object on purpose, so the
      // common "matched reply, nothing queued" path allocates nothing on the hot drag path.
      if (state.pending) return applySend(state, state.pending)
      return { state, send: null }
  }
}
