// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CoilKeyboardControl, keyToCoilAction, NUDGE_MM } from './CoilKeyboardControl'
import { clearCoilNudge, registerCoilNudge, type CoilNudgeHandler } from '../scene/coilKeyboardChannel'
import { useStimStore } from '../store'
import { PRESETS } from '../data/presets'

afterEach(() => {
  cleanup()
  useStimStore.getState().reset()
})

const getControl = () => screen.getByRole('group', { name: /keyboard coil control/i })

describe('keyToCoilAction — pure key map (#15)', () => {
  it('maps arrows + page keys to ANATOMICAL-axis nudges (deterministic, not camera-relative)', () => {
    expect(keyToCoilAction('ArrowRight')).toEqual({ type: 'nudge', axis: 'x', deltaMm: NUDGE_MM })
    expect(keyToCoilAction('ArrowLeft')).toEqual({ type: 'nudge', axis: 'x', deltaMm: -NUDGE_MM })
    expect(keyToCoilAction('ArrowUp')).toEqual({ type: 'nudge', axis: 'z', deltaMm: NUDGE_MM })
    expect(keyToCoilAction('ArrowDown')).toEqual({ type: 'nudge', axis: 'z', deltaMm: -NUDGE_MM })
    expect(keyToCoilAction('PageUp')).toEqual({ type: 'nudge', axis: 'y', deltaMm: NUDGE_MM })
    expect(keyToCoilAction('PageDown')).toEqual({ type: 'nudge', axis: 'y', deltaMm: -NUDGE_MM })
  })

  it('maps 1–5 to preset indices and ignores everything else', () => {
    expect(keyToCoilAction('1')).toEqual({ type: 'preset', index: 0 })
    expect(keyToCoilAction('5')).toEqual({ type: 'preset', index: 4 })
    expect(keyToCoilAction('6')).toBeNull()
    expect(keyToCoilAction('0')).toBeNull()
    expect(keyToCoilAction('a')).toBeNull()
    expect(keyToCoilAction('Enter')).toBeNull()
  })
})

describe('CoilKeyboardControl — focusable, non-trapping keyboard coil (#15)', () => {
  it('is a focusable, labelled group that exposes its key shortcuts', () => {
    render(<CoilKeyboardControl />)
    const control = getControl()
    expect(control.getAttribute('tabindex')).toBe('0')
    expect(control.getAttribute('aria-keyshortcuts')).toContain('ArrowUp')
    expect(control.getAttribute('aria-keyshortcuts')).toContain('1')
  })

  it('arrow keys dispatch a scalp nudge through the bus and suppress page scroll when the coil moves', () => {
    const calls: Array<[string, number]> = []
    const handler: CoilNudgeHandler = (axis, delta) => {
      calls.push([axis, delta])
      return true // the coil moved
    }
    registerCoilNudge(handler)
    render(<CoilKeyboardControl />)

    const handled = fireEvent.keyDown(getControl(), { key: 'ArrowUp' })
    expect(handled).toBe(false) // defaultPrevented → page doesn't scroll while the control is focused
    expect(calls).toEqual([['z', NUDGE_MM]])

    clearCoilNudge(handler)
  })

  it('a no-op nudge (degenerate pole / scene not mounted) is NOT consumed — the key falls through', () => {
    // Handler reports nothing moved → the arrow should NOT be preventDefault'd, so the page can scroll
    // and the user gets feedback instead of a silently-eaten keystroke.
    const handler: CoilNudgeHandler = () => false
    registerCoilNudge(handler)
    render(<CoilKeyboardControl />)
    const handled = fireEvent.keyDown(getControl(), { key: 'ArrowDown' })
    expect(handled).toBe(true) // not prevented
    clearCoilNudge(handler)
  })

  it('ignores modifier chords (Alt/Ctrl/Meta + arrow) so browser/OS shortcuts keep working', () => {
    const calls: Array<[string, number]> = []
    const handler: CoilNudgeHandler = (axis, delta) => {
      calls.push([axis, delta])
      return true
    }
    registerCoilNudge(handler)
    render(<CoilKeyboardControl />)
    const handled = fireEvent.keyDown(getControl(), { key: 'ArrowLeft', altKey: true })
    expect(handled).toBe(true) // not prevented → the Alt+← back-shortcut still runs
    expect(calls).toEqual([]) // and no nudge was dispatched
    clearCoilNudge(handler)
  })

  it('routes keys 1–5 to setPreset (re-snapping the coil), like clicking the presets', () => {
    render(<CoilKeyboardControl />)
    fireEvent.keyDown(getControl(), { key: '2' })
    expect(useStimStore.getState().preset).toBe(PRESETS[1].id)
    fireEvent.keyDown(getControl(), { key: '5' })
    expect(useStimStore.getState().preset).toBe(PRESETS[4].id)
  })

  it('does not trap focus: an unmapped key (Tab) is left to bubble', () => {
    render(<CoilKeyboardControl />)
    const handled = fireEvent.keyDown(getControl(), { key: 'Tab' })
    expect(handled).toBe(true) // not prevented → Tab can move focus out of the control
  })
})
