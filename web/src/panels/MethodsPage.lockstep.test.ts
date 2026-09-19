// @vitest-environment node
import { describe, expect, it } from 'vitest'
import designMd from '../../../DESIGN.md?raw'
import { METHOD_ONELINER } from './MethodsPage'

/**
 * Methods ↔ DESIGN.md lockstep (honesty gate (b), DESIGN.md).
 *
 * The App.test.tsx phrase-guards prove the Methods PAGE renders the authoritative method statement and
 * the §3.1 derivation caveat. That alone does NOT enforce lockstep — it passes even if someone edits
 * DESIGN.md to soften or drop a caveat while leaving the page untouched. This test closes the other
 * half: it reads the committed spec (inlined via Vite `?raw`) and asserts the spec STILL contains the
 * exact strings the page shows. Together the two tests make the lockstep real — a divergence on either
 * side goes red.
 */
describe('MethodsPage ↔ DESIGN.md lockstep', () => {
  it('quotes the §3.2 method one-liner (METHOD_ONELINER) verbatim from DESIGN.md', () => {
    // If this fails, the shared constant drifted from the spec (or vice versa) — reconcile them.
    expect(designMd).toContain(METHOD_ONELINER)
  })

  it('mirrors the #23 derivation-figure tangential caveat into DESIGN §3.1', () => {
    expect(designMd).toContain('not the exact secondary-field solution')
  })
})
