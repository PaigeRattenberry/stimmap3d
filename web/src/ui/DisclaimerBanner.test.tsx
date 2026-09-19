// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DisclaimerBanner } from './DisclaimerBanner'
import { PrintSummary } from '../panels/PrintSummary'

afterEach(cleanup)

// Gate (a) single-source: the on-screen banner and the print one-pager render the SAME disclaimer body
// through the shared <DisclaimerBody>. A distinctive body phrase must appear on BOTH surfaces — if
// someone re-inlines a paraphrase on either side, one of these goes red and the drift is caught.
const BODY_PHRASE = /not a finite-element simulation of any individual/i

describe('DisclaimerBody — shared gate-(a) prose (single source)', () => {
  it('the persistent on-screen banner renders the shared body', () => {
    render(<DisclaimerBanner />)
    expect(screen.getByText(BODY_PHRASE)).toBeTruthy()
  })

  it('the print one-pager renders the SAME shared body, not a paraphrase', () => {
    render(<PrintSummary />)
    expect(screen.getByText(BODY_PHRASE)).toBeTruthy()
  })
})
