// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Term } from './Term'
import { GLOSSARY } from './glossary'

afterEach(cleanup)

describe('GLOSSARY data (finite, vetted — #22)', () => {
  it('every entry has a non-empty term and definition', () => {
    const entries = Object.values(GLOSSARY)
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.term.trim().length).toBeGreaterThan(0)
      expect(e.definition.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('Term — accessible tooltip (APG pattern)', () => {
  it('renders a focusable trigger described by a role=tooltip with the definition', () => {
    render(<Term id="dlpfc">DLPFC</Term>)
    const trigger = screen.getByRole('button', { name: 'DLPFC' })
    const tip = screen.getByRole('tooltip')
    // aria-describedby wires the trigger to the tooltip (idref resolves — tooltip is always in the DOM).
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id)
    expect(tip.textContent).toBe(GLOSSARY.dlpfc.definition)
  })

  it('falls back to the canonical term when given no children', () => {
    render(<Term id="beam-f3" />)
    expect(screen.getByRole('button', { name: GLOSSARY['beam-f3'].term })).toBeTruthy()
  })

  it('is hidden by default; focus and hover each open it; Escape and blur/leave dismiss it', () => {
    render(<Term id="sgacc">sgACC</Term>)
    const trigger = screen.getByRole('button', { name: 'sgACC' })
    const tip = screen.getByRole('tooltip')
    const isOpen = () => tip.className.includes('term__tip--open')

    expect(isOpen()).toBe(false)

    fireEvent.focus(trigger)
    expect(isOpen()).toBe(true)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(isOpen()).toBe(false) // Escape dismisses while focused
    fireEvent.blur(trigger)

    fireEvent.mouseEnter(trigger)
    expect(isOpen()).toBe(true)
    fireEvent.mouseLeave(trigger)
    expect(isOpen()).toBe(false) // not focused → hover-out closes
  })

  it('an incidental mouse-leave does NOT close a tooltip that focus is keeping open (APG)', () => {
    render(<Term id="dlpfc">DLPFC</Term>)
    const trigger = screen.getByRole('button', { name: 'DLPFC' })
    const tip = screen.getByRole('tooltip')

    fireEvent.focus(trigger) // opened by focus
    fireEvent.mouseEnter(trigger)
    fireEvent.mouseLeave(trigger) // mouse leaves, but focus remains
    expect(tip.className).toContain('term__tip--open') // still open because still focused
  })
})
