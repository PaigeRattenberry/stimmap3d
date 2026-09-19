// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PresetRadioGroup } from './PresetRadioGroup'
import { PRESETS } from '../data/presets'
import { useStimStore } from '../store'

afterEach(() => {
  cleanup()
  useStimStore.getState().reset()
})

const radios = () => within(screen.getByRole('radiogroup')).getAllByRole('radio')

describe('PresetRadioGroup — APG radio pattern (#32)', () => {
  it('is a radiogroup with one radio per preset, the active one checked', () => {
    useStimStore.getState().setPreset('F3')
    render(<PresetRadioGroup />)
    const group = screen.getByRole('radiogroup', { name: /coil placement presets/i })
    expect(group).toBeTruthy()
    const items = radios()
    expect(items).toHaveLength(PRESETS.length)
    const checked = items.filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1) // exactly one selected
    expect(checked[0].getAttribute('title')).toMatch(/Beam-F3/i) // F3 is active
  })

  it('is a single tab stop: only the checked radio has tabIndex 0 (roving tabindex)', () => {
    useStimStore.getState().setPreset('F3')
    render(<PresetRadioGroup />)
    const items = radios()
    const tabbable = items.filter((r) => r.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(items.filter((r) => r.getAttribute('tabindex') === '-1')).toHaveLength(PRESETS.length - 1)
    expect(tabbable[0].getAttribute('aria-checked')).toBe('true')
  })

  it('ArrowDown/ArrowRight moves selection to the next preset and calls setPreset', () => {
    useStimStore.getState().setPreset('F3') // index 0
    render(<PresetRadioGroup />)
    fireEvent.keyDown(radios()[0], { key: 'ArrowDown' })
    expect(useStimStore.getState().preset).toBe(PRESETS[1].id) // F4
    fireEvent.keyDown(radios()[1], { key: 'ArrowRight' })
    expect(useStimStore.getState().preset).toBe(PRESETS[2].id) // Fz
  })

  it('ArrowUp/ArrowLeft moves to the previous preset and WRAPS at the ends', () => {
    useStimStore.getState().setPreset(PRESETS[0].id) // first
    render(<PresetRadioGroup />)
    fireEvent.keyDown(radios()[0], { key: 'ArrowUp' })
    // wrapped to the last preset
    expect(useStimStore.getState().preset).toBe(PRESETS[PRESETS.length - 1].id)
  })

  it('Home selects the first preset, End the last', () => {
    useStimStore.getState().setPreset(PRESETS[2].id)
    render(<PresetRadioGroup />)
    fireEvent.keyDown(radios()[2], { key: 'End' })
    expect(useStimStore.getState().preset).toBe(PRESETS[PRESETS.length - 1].id)
    fireEvent.keyDown(radios()[PRESETS.length - 1], { key: 'Home' })
    expect(useStimStore.getState().preset).toBe(PRESETS[0].id)
  })

  it('clicking a radio re-snaps even when it is already active (placementSeq bump preserved)', () => {
    useStimStore.getState().setPreset('F3')
    render(<PresetRadioGroup />)
    const f3 = radios().find((r) => r.getAttribute('title')?.includes('Beam-F3'))!
    const before = useStimStore.getState().placementSeq
    fireEvent.click(f3)
    expect(useStimStore.getState().preset).toBe('F3') // unchanged…
    expect(useStimStore.getState().placementSeq).toBe(before + 1) // …but a fresh placement requested
  })
})
