// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ShareBar } from './ShareBar'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// V2-7b (C6): the "Print handout" button is the on-screen entry point to the print-only <PrintSummary>
// one-pager. It must just open the browser print dialog — the @media print rules do the rest.
describe('ShareBar — Print handout button (V2-7b, C6)', () => {
  it('renders a Print handout button', () => {
    render(<ShareBar />)
    expect(screen.getByRole('button', { name: /print handout/i })).toBeTruthy()
  })

  it('calls window.print() when clicked', () => {
    const printSpy = vi.fn()
    vi.stubGlobal('print', printSpy)
    render(<ShareBar />)
    fireEvent.click(screen.getByRole('button', { name: /print handout/i }))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })
})
