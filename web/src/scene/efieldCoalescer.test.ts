import { describe, it, expect } from 'vitest'
import {
  initialCoalescerState,
  isStaleReply,
  reduceCoalescer,
  type CoalescerState,
  type SolveReq,
} from './efieldCoalescer'

/**
 * Milestone v2.6 / #25 — the single-in-flight solve coalescer, extracted from `useEFieldHeatmap`
 * into a pure reducer so its concurrency decisions are testable without a Worker, the store, or
 * the DOM. These tests pin the four behaviours the hook relies on (and that a refactor must never
 * silently regress): SEND only when ready & idle, QUEUE-the-latest while busy (coalescing),
 * DROP a stale-id reply, and FLUSH the coalesced pose after a matched reply — in that order.
 *
 * The hook's event→action mapping is mirrored here: 'ready' → `ready`; a pose change → `request`;
 * a matched reply → `replyClear` then (after painting) `flushPending`; a stale reply is gated out
 * by `isStaleReply` first. Breaking any of these turns this suite red (P0 acceptance criterion).
 */

const REQ = (tag: number): SolveReq => ({
  pose: { position: [tag, 0, 0], rotation: [0, 0, 0], standoff: 4 },
  intensity: 1,
})

/** Drive a reply exactly as the hook does: the `reply` action owns the stale-drop; on a matched
 *  reply the hook paints the field, THEN dispatches `flushPending` to fire the coalesced pose. */
function deliverReply(state: CoalescerState, id: number) {
  const reply = reduceCoalescer(state, { type: 'reply', id })
  if (reply.stale) return { state: reply.state, send: null, dropped: true as const }
  const flushed = reduceCoalescer(reply.state, { type: 'flushPending' })
  return { ...flushed, dropped: false as const }
}

describe('initialCoalescerState', () => {
  it('starts not-ready, idle, empty, with expectedId -1 (no stray reply can match)', () => {
    expect(initialCoalescerState()).toEqual({
      ready: false,
      inFlight: false,
      pending: null,
      lastId: 0,
      expectedId: -1,
    })
  })
})

describe('request — gating on ready/in-flight', () => {
  it('queues (does NOT send) before the worker is ready', () => {
    const { state, send } = reduceCoalescer(initialCoalescerState(), { type: 'request', req: REQ(1) })
    expect(send).toBeNull()
    expect(state.pending).toEqual(REQ(1))
    expect(state.inFlight).toBe(false)
    expect(state.lastId).toBe(0) // no id burned on a queued request
  })

  it('sends once ready & idle, stamping the next id and marking in-flight', () => {
    const ready = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    const { state, send } = reduceCoalescer(ready, { type: 'request', req: REQ(7) })
    expect(send).toEqual({ req: REQ(7), id: 1 })
    expect(state.inFlight).toBe(true)
    expect(state.pending).toBeNull()
    expect(state.lastId).toBe(1)
    expect(state.expectedId).toBe(1)
  })
})

describe('coalescing — keep only the LATEST request while busy', () => {
  it('a request while in-flight queues the latest and sends nothing', () => {
    const ready = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    const sent = reduceCoalescer(ready, { type: 'request', req: REQ(1) }).state // in-flight, id 1
    const a = reduceCoalescer(sent, { type: 'request', req: REQ(2) })
    expect(a.send).toBeNull()
    expect(a.state.pending).toEqual(REQ(2))
    // a SECOND request while still busy overwrites the pending slot — the older one is discarded.
    const b = reduceCoalescer(a.state, { type: 'request', req: REQ(3) })
    expect(b.send).toBeNull()
    expect(b.state.pending).toEqual(REQ(3)) // newest wins
    expect(b.state.inFlight).toBe(true) // still the original solve in flight
    expect(b.state.lastId).toBe(1) // no new id burned while coalescing
  })

  it('on the matched reply, fires the coalesced (latest) pose with a fresh id, drops the rest', () => {
    let s = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    s = reduceCoalescer(s, { type: 'request', req: REQ(1) }).state // send id 1, in-flight
    s = reduceCoalescer(s, { type: 'request', req: REQ(2) }).state // pending = 2
    s = reduceCoalescer(s, { type: 'request', req: REQ(3) }).state // pending = 3 (2 discarded)
    const reply = deliverReply(s, 1)
    expect(reply.dropped).toBe(false)
    expect(reply.send).toEqual({ req: REQ(3), id: 2 }) // latest pose fired, next id
    expect(reply.state.inFlight).toBe(true)
    expect(reply.state.pending).toBeNull()
    expect(reply.state.expectedId).toBe(2)
  })

  it('a matched reply with NO pending settles idle (no send)', () => {
    let s = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    s = reduceCoalescer(s, { type: 'request', req: REQ(1) }).state // send id 1
    const reply = deliverReply(s, 1)
    expect(reply.send).toBeNull()
    expect(reply.state.inFlight).toBe(false)
    expect(reply.state.pending).toBeNull()
  })
})

describe('reply action — owns the stale-drop decision', () => {
  it('a matched reply clears in-flight, is not stale, and does NOT itself send (flush is separate)', () => {
    let s = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    s = reduceCoalescer(s, { type: 'request', req: REQ(1) }).state // in-flight, expecting id 1
    const r = reduceCoalescer(s, { type: 'reply', id: 1 })
    expect(r.stale).toBe(false)
    expect(r.state.inFlight).toBe(false)
    expect(r.send).toBeNull() // the coalesced pose fires only via the SEPARATE flushPending step
  })

  it('a stale reply is flagged stale with state untouched (in-flight preserved)', () => {
    let s = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    s = reduceCoalescer(s, { type: 'request', req: REQ(1) }).state // expecting id 1
    const r = reduceCoalescer(s, { type: 'reply', id: 0 })
    expect(r.stale).toBe(true)
    expect(r.state).toBe(s) // untouched — still waiting on id 1
    expect(r.state.inFlight).toBe(true)
  })
})

describe('stale-id drop', () => {
  it('isStaleReply is true for any id but the one we await, false for the exact expected id', () => {
    const state: CoalescerState = { ...initialCoalescerState(), expectedId: 5 }
    expect(isStaleReply(state, 5)).toBe(false)
    expect(isStaleReply(state, 4)).toBe(true) // an earlier, superseded solve
    expect(isStaleReply(state, 6)).toBe(true)
    expect(isStaleReply(state, undefined)).toBe(true) // a reply with no id never matches
  })

  it('before any send (expectedId -1) every reply is stale', () => {
    expect(isStaleReply(initialCoalescerState(), 0)).toBe(true)
  })

  it('a stale reply is dropped: no recolour-eligible state change, no send, in-flight preserved', () => {
    let s = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    s = reduceCoalescer(s, { type: 'request', req: REQ(1) }).state // expecting id 1, in-flight
    const stale = deliverReply(s, 0) // a leftover reply from an earlier solve
    expect(stale.dropped).toBe(true)
    expect(stale.send).toBeNull()
    expect(stale.state).toBe(s) // untouched — still waiting on id 1
    expect(stale.state.inFlight).toBe(true)
  })
})

describe('worker-error recovery (fail without flush)', () => {
  it('clears in-flight but leaves pending intact (the env-level onerror path)', () => {
    let s = reduceCoalescer(initialCoalescerState(), { type: 'ready' }).state
    s = reduceCoalescer(s, { type: 'request', req: REQ(1) }).state // in-flight, id 1
    s = reduceCoalescer(s, { type: 'request', req: REQ(2) }).state // pending = 2
    const cleared = reduceCoalescer(s, { type: 'fail' })
    expect(cleared.send).toBeNull()
    expect(cleared.state.inFlight).toBe(false)
    expect(cleared.state.pending).toEqual(REQ(2)) // not re-fired here (matches onerror)
    // …and a subsequent pose request now sends immediately (idle again), superseding the pending.
    const next = reduceCoalescer(cleared.state, { type: 'request', req: REQ(9) })
    expect(next.send).toEqual({ req: REQ(9), id: 2 })
    expect(next.state.pending).toBeNull()
  })
})

describe('purity', () => {
  it('never mutates the input state object', () => {
    const start = initialCoalescerState()
    const snapshot = { ...start }
    reduceCoalescer(start, { type: 'ready' })
    reduceCoalescer(start, { type: 'request', req: REQ(1) })
    reduceCoalescer(start, { type: 'flushPending' })
    expect(start).toEqual(snapshot) // inputs are frozen-in-spirit: each call returns a new object
  })
})
