// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FieldMetricsCard } from './FieldMetricsCard'

describe('FieldMetricsCard honesty caveat (gate (e), P0)', () => {
  afterEach(cleanup)

  it('renders the surface-derived / not-validated-cm-or-V·m relative-units caveat', () => {
    render(<FieldMetricsCard />)
    // The load-bearing gate-(e) prose — assert the REAL rendered strings (not a paraphrase):
    expect(screen.getByText(/surface-derived approximation/i)).toBeTruthy()
    expect(screen.getByText(/not validated cm or V·m/i)).toBeTruthy()
    expect(screen.queryByText(/≈\d+%/)).toBeNull()
    expect(screen.getByText(/additional stimulator output needed/i)).toBeTruthy()
    expect(screen.getByText(/authored heuristic/i)).toBeTruthy()
    expect(screen.getByText(/does not calculate machine settings/i)).toBeTruthy()
    // …and the card badges itself illustrative · relative.
    expect(screen.getByText(/illustrative · relative/i)).toBeTruthy()
  })
})
