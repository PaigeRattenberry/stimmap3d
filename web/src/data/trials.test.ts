// Pure-logic test (node env, the global default) for the M5 odds-ratio → probability
// conversion — the single most likely silent statistical error in the analytics view
// (DESIGN §4). No DOM, no Recharts; just the math contract.
import { describe, expect, it } from 'vitest'
import { orToProbability, protocols, shamBaseline, trials } from './trials'
import { getCitation } from './citations'

describe('orToProbability — Mutz OR → absolute probability vs sham (DESIGN §4)', () => {
  it('is the identity at OR = 1 (no effect → sham baseline probability)', () => {
    for (const p0 of [0.05, 0.1, 0.15, 0.2, 0.5]) {
      expect(orToProbability(1, p0)).toBeCloseTo(p0, 12)
    }
  })

  it('is strictly increasing in OR', () => {
    const p0 = 0.15
    let prev = -Infinity
    for (const or of [0.25, 0.5, 1, 1.5, 2, 3, 5, 10]) {
      const p = orToProbability(or, p0)
      expect(p).toBeGreaterThan(prev)
      prev = p
    }
  })

  it('returns a genuine probability in (0, 1) for any finite OR > 0', () => {
    for (const or of [0.01, 0.5, 1, 4, 50, 1000]) {
      for (const p0 of [0.01, 0.1, 0.2, 0.5, 0.9]) {
        const p = orToProbability(or, p0)
        expect(p).toBeGreaterThan(0)
        expect(p).toBeLessThan(1)
      }
    }
  })

  it('OR > 1 raises and OR < 1 lowers the probability relative to baseline', () => {
    const p0 = 0.15
    expect(orToProbability(2, p0)).toBeGreaterThan(p0)
    expect(orToProbability(0.5, p0)).toBeLessThan(p0)
  })

  it('matches the closed form p = OR·p0/(1−p0) / (1 + OR·p0/(1−p0))', () => {
    const cases: Array<[number, number]> = [
      [2.3, 0.12],
      [3.4, 0.15],
      [1.7, 0.18],
    ]
    for (const [or, p0] of cases) {
      const odds0 = p0 / (1 - p0)
      const expected = (or * odds0) / (1 + or * odds0)
      expect(orToProbability(or, p0)).toBeCloseTo(expected, 12)
    }
  })
})

describe('trials.json synthetic dataset shape (DESIGN §3/§4)', () => {
  it('is badged synthetic with a sourced, sane sham baseline', () => {
    expect(trials.synthetic).toBe(true)
    expect(shamBaseline.citationId.length).toBeGreaterThan(0)
    // Sham response/remission must be plausible placebo rates (DESIGN §4 ballpark).
    expect(shamBaseline.responseRate).toBeGreaterThan(0)
    expect(shamBaseline.responseRate).toBeLessThan(0.35)
    expect(shamBaseline.remissionRate).toBeGreaterThan(0)
    expect(shamBaseline.remissionRate).toBeLessThanOrEqual(shamBaseline.responseRate)
  })

  it('covers all three protocols, each cited, with remission ≤ response', () => {
    expect(protocols.map((p) => p.id).sort()).toEqual(['10hz-hf-l', '1hz-lf-r', 'itbs'])
    for (const p of protocols) {
      expect(p.rates.citationId.length).toBeGreaterThan(0)
      expect(p.rates.remissionRate).toBeLessThanOrEqual(p.rates.responseRate)
      expect(p.odds.response.or).toBeGreaterThan(0)
      expect(p.odds.response.citationId.length).toBeGreaterThan(0)
      // Every protocol carries a sane 95% CI (read-only assertion for the OddsSection ErrorBar,
      // V2-2 #16): 0 < ciLow < or < ciHigh, so the asymmetric whisker offsets are both positive.
      expect(p.odds.response.ciLow).toBeGreaterThan(0)
      expect(p.odds.response.ciLow).toBeLessThan(p.odds.response.or)
      expect(p.odds.response.or).toBeLessThan(p.odds.response.ciHigh)
      expect(p.summary.length).toBeGreaterThan(1)
      expect(p.patients.length).toBeGreaterThan(0)
    }
  })

  it('resolves every citationId it references in the ledger (gate (d): no dangling provenance)', () => {
    // The panel's <CitationLink> renders nothing on a miss, so an un-resolvable id would ship a
    // cited clinical number with no source link and a green suite. Enforce resolution here.
    const ids = new Set<string>([shamBaseline.citationId])
    for (const p of protocols) {
      ids.add(p.rates.citationId)
      ids.add(p.odds.response.citationId)
    }
    // Ids the AnalyticsPanel references by literal (the SNT/SAINT accelerated-protocol callout).
    ids.add('cole-snt-saint')
    ids.add('cole-2020-saint-pilot')
    for (const id of ids) {
      expect(getCitation(id), `citation "${id}" missing from citations.json`).toBeTruthy()
    }
  })

  it('flags an OR-derived protocol\'s remission as an or-proxy, never measured', () => {
    for (const p of protocols) {
      if (p.rates.source === 'or-derived') {
        expect(p.rates.remissionSource).toBe('or-proxy')
      } else {
        expect(p.rates.remissionSource).toBe('measured')
      }
    }
  })

  it('keeps an OR-derived absolute rate consistent with its OR and the sham baseline', () => {
    // Where a protocol's absolute rate is OR-derived (e.g. 1 Hz LF-R), it must equal the
    // conversion of its Mutz OR against the sham baseline — never a fabricated direct rate.
    for (const p of protocols.filter((p) => p.rates.source === 'or-derived')) {
      const derived = orToProbability(p.odds.response.or, shamBaseline.responseRate)
      // The committed rate is rounded to 3 dp for a lean JSON, so compare at 2-dp tolerance.
      expect(p.rates.responseRate).toBeCloseTo(derived, 2)
    }
  })
})
