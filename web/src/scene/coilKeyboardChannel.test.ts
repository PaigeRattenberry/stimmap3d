import { describe, expect, it, vi } from 'vitest'
import {
  clearCoilNudge,
  nudgeCoil,
  registerCoilNudge,
  type CoilNudgeHandler,
} from './coilKeyboardChannel'

describe('coilKeyboardChannel — coil keyboard-nudge bus (#15)', () => {
  it('nudgeCoil is a graceful no-op (returns false) with no handler registered', () => {
    expect(nudgeCoil('x', 6)).toBe(false)
  })

  it('dispatches the axis + delta to the handler and RELAYS its moved/no-op result', () => {
    const calls: Array<[string, number]> = []
    const handler: CoilNudgeHandler = (axis, delta) => {
      calls.push([axis, delta])
      return true // the coil moved
    }
    registerCoilNudge(handler)
    expect(nudgeCoil('z', -6)).toBe(true)
    expect(calls).toEqual([['z', -6]])
    clearCoilNudge(handler)
    expect(nudgeCoil('z', -6)).toBe(false) // cleared → no consumer
  })

  it('relays a handler that reports a no-op move (false) so the caller can let the key fall through', () => {
    const handler: CoilNudgeHandler = () => false // a degenerate pole nudge → nothing moved
    registerCoilNudge(handler)
    expect(nudgeCoil('z', 6)).toBe(false)
    clearCoilNudge(handler)
  })

  it('clearCoilNudge only clears the CURRENT handler (a stale unmount cannot clobber a remount)', () => {
    const a = vi.fn(() => true)
    const b = vi.fn(() => true)
    registerCoilNudge(a)
    registerCoilNudge(b) // b replaces a (e.g. a remount registered before the old effect cleaned up)
    clearCoilNudge(a) // a is stale — must NOT remove b
    expect(nudgeCoil('y', 6)).toBe(true)
    expect(b).toHaveBeenCalledWith('y', 6)
    expect(a).not.toHaveBeenCalled()
    clearCoilNudge(b)
  })
})
