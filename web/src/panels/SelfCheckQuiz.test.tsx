// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SelfCheckQuiz } from './SelfCheckQuiz'

afterEach(cleanup)

// The four correct options, by accessible name (their associated <label>). Em-dash-free so the
// regexes can't drift on a dash character.
const CORRECT = [
  /deliberately not calibrated V\/m/i, // Units → relative units
  /induced-field magnitude/i, //            Magnitude → not activation
  /synthetic, generated from published/i, // Data → synthetic
  /relative to sham/i, //                    OR vs % → relative to sham
]

const selectCorrect = () =>
  CORRECT.forEach((name) => fireEvent.click(screen.getByRole('radio', { name })))

const checkBtn = () => screen.getByRole('button', { name: /check answers/i })

describe('SelfCheckQuiz (#21 — retrieval practice on the honesty gates)', () => {
  it('renders four questions as labelled groups with radios + the inline retrieval-practice citation', () => {
    render(<SelfCheckQuiz />)
    expect(screen.getAllByRole('group')).toHaveLength(4) // one <fieldset> per question
    expect(screen.getAllByRole('radio')).toHaveLength(12) // three options each
    // Roediger & Karpicke 2006 cited INLINE (deliberately NOT a citations.json entry).
    expect(screen.getByText(/Roediger & Karpicke 2006/i)).toBeTruthy()
  })

  it('disables "Check answers" until every question is answered', () => {
    render(<SelfCheckQuiz />)
    expect(checkBtn().hasAttribute('disabled')).toBe(true)
    selectCorrect()
    expect(checkBtn().hasAttribute('disabled')).toBe(false)
  })

  it('grades all-correct as 4 of 4 and reports it in the live region', () => {
    render(<SelfCheckQuiz />)
    selectCorrect()
    fireEvent.click(checkBtn())
    expect(screen.getByRole('status').textContent).toMatch(/4 of 4 correctly/i)
    expect(screen.getAllByText(/✓ Correct\./i)).toHaveLength(4)
  })

  it('grades a wrong answer down and shows the ✗ verdict + cited explanation', () => {
    render(<SelfCheckQuiz />)
    // Deliberately wrong on Units (the V/m distractor); correct on the other three.
    fireEvent.click(screen.getByRole('radio', { name: /calibrated volts per metre/i }))
    CORRECT.slice(1).forEach((name) => fireEvent.click(screen.getByRole('radio', { name })))
    fireEvent.click(checkBtn())
    expect(screen.getByRole('status').textContent).toMatch(/3 of 4 correctly/i)
    expect(screen.getByText(/✗ Not quite\./i)).toBeTruthy()
    // The explanation restates the cited gate (relative units, never V/m) — no invented fact.
    expect(screen.getByText(/never calibrated to V\/m/i)).toBeTruthy()
  })

  it('re-answering after checking clears the stale verdicts', () => {
    render(<SelfCheckQuiz />)
    selectCorrect()
    fireEvent.click(checkBtn())
    expect(screen.getAllByText(/✓ Correct\./i)).toHaveLength(4)
    // Changing an answer withdraws the grade until the reader checks again.
    fireEvent.click(screen.getByRole('radio', { name: /calibrated volts per metre/i }))
    expect(screen.queryByText(/✓ Correct\./i)).toBeNull()
  })
})
