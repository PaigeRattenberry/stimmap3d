// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PrintSummary } from './PrintSummary'
import { getProtocolData } from '../data/trials'
import { useStimStore } from '../store'

afterEach(() => {
  cleanup()
  useStimStore.getState().reset()
})

// The automated share-artifact assertion: the printed one-pager must
// bake in the load-bearing framing even though the on-screen banner does not travel into print.
describe('PrintSummary — printable one-pager bakes in gates (a)/(d)/(e)', () => {
  it('(a) bakes in the non-clinical disclaimer', () => {
    render(<PrintSummary />)
    expect(screen.getByText(/not for clinical use/i)).toBeTruthy()
  })

  it('(d) badges the outcome data synthetic', () => {
    render(<PrintSummary />)
    expect(screen.getByText(/^Synthetic$/)).toBeTruthy() // the explicit badge
    expect(screen.getByText(/every per-patient trajectory is\s+synthetic/i)).toBeTruthy()
  })

  it('(e) labels the E-field relative units, not V/m', () => {
    render(<PrintSummary />)
    expect(screen.getByText(/relative units/i)).toBeTruthy()
    expect(screen.getByText(/not calibrated V\/m/i)).toBeTruthy()
  })

  it('summarises the live coil/protocol configuration (defaults)', () => {
    render(<PrintSummary />)
    expect(screen.getByText(/Beam-F3 left DLPFC/i)).toBeTruthy() // preset F3 label
    expect(screen.getByText(getProtocolData('10hz-hf-l')!.longLabel)).toBeTruthy()
  })

  it('reflects a changed protocol', () => {
    useStimStore.getState().setProtocol('itbs')
    render(<PrintSummary />)
    expect(screen.getByText(getProtocolData('itbs')!.longLabel)).toBeTruthy()
  })
})
