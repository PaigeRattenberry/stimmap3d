import { describe, it, expect } from 'vitest'
import { PRESETS, FOX_CONNECTIVITY_TARGET, SGACC_SEED } from './presets'
import { getCitation } from './citations'
import electrodes from './electrodes.json'
import type { Preset } from '../store'

/**
 * Milestone 4 — targeting-preset integrity. These guard the data the one-click presets are
 * built from: that every preset covers the `Preset` union, carries a real MNI target, and
 * cites a source that actually exists in the provenance ledger (honesty: no preset points at
 * an un-cited coordinate). The scalp presets must match electrodes.json verbatim; the
 * connectivity preset must use the VERIFIED Fox-2012 peak, not the mis-attributed candidate.
 */

const ALL_IDS: Preset[] = ['F3', 'F4', 'Fz', 'Cz', 'connectivity']

function byId(id: Preset) {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`preset ${id} missing`)
  return p
}

function electrodeMni(name: string): number[] {
  const e = electrodes.electrodes.find((x) => x.name === name)
  if (!e) throw new Error(`electrode ${name} missing from electrodes.json`)
  return e.mni
}

describe('PRESETS', () => {
  it('covers exactly the Preset union, once each', () => {
    expect([...PRESETS.map((p) => p.id)].sort()).toEqual([...ALL_IDS].sort())
  })

  it('every preset is fully populated (labels, target, citation)', () => {
    for (const p of PRESETS) {
      expect(p.label.trim()).not.toBe('')
      expect(p.shortLabel.trim()).not.toBe('')
      expect(p.description.trim()).not.toBe('')
      expect(p.citationId, `${p.id} cites a source`).toBeTruthy()
      expect(p.target, `${p.id} has a target`).toBeDefined()
      expect(p.target).toHaveLength(3)
      for (const c of p.target!) expect(Number.isFinite(c)).toBe(true)
    }
  })

  it('every preset’s citationId resolves in the provenance ledger', () => {
    for (const p of PRESETS) {
      expect(getCitation(p.citationId!), `${p.id} → ${p.citationId}`).toBeDefined()
    }
  })

  it('scalp presets use the electrodes.json (FieldTrip standard_1020) coordinates verbatim', () => {
    expect(byId('F3').target).toEqual(electrodeMni('F3'))
    expect(byId('F4').target).toEqual(electrodeMni('F4'))
    expect(byId('Fz').target).toEqual(electrodeMni('Fz'))
    expect(byId('Cz').target).toEqual(electrodeMni('Cz'))
  })

  it('the connectivity preset uses the verified Fox-2012 sgACC peak (-44, 38, 34)', () => {
    // NOT the mis-attributed BA46 candidate (-44, 40, 29) — see citations → fox-2012-sgacc-target.
    expect(byId('connectivity').target).toEqual([-44, 38, 34])
    expect(byId('connectivity').target).not.toEqual([-44, 40, 29])
  })

  it('attributes F3 to Beam-F3 and connectivity to Fox 2012', () => {
    expect(byId('F3').citationId).toBe('beam-2009-f3')
    expect(byId('connectivity').citationId).toBe('fox-2012-sgacc-target')
  })
})

describe('sgACC seed + DLPFC node (V2-1 targeting-legibility markers, #6/C2)', () => {
  it('exports the verified Fox-2012 coordinates the ElectrodeMarkers layer draws', () => {
    expect(FOX_CONNECTIVITY_TARGET).toEqual([-44, 38, 34]) // cortical DLPFC node (cue origin)
    expect(SGACC_SEED).toEqual([6, 16, -10]) // deep subgenual-ACC seed (cue destination)
    expect(SGACC_SEED).toHaveLength(3)
    for (const c of SGACC_SEED) expect(Number.isFinite(c)).toBe(true)
  })

  it('the sgACC seed coordinate is sourced to Fox 2012 in the ledger — never the flagged PMID', () => {
    const seed = getCitation('fox-2012-sgacc-seed')
    expect(seed, 'fox-2012-sgacc-seed resolves in the provenance ledger').toBeDefined()
    expect(seed!.type).toBe('number')
    // Fox 2012 is PMID 22658708; the ATTRIBUTION (source + url) must point there. 25922128 is the
    // mis-cited unrelated tES paper flagged in the the implementation review corrections table — it
    // must never be the source (the notes may still reference it as an explicit "do not cite" warning).
    expect(seed!.source).toContain('22658708')
    expect(seed!.url).toContain('22658708')
    expect(seed!.source).not.toContain('25922128')
    expect(seed!.url).not.toContain('25922128')
  })
})

describe('electrodes.json', () => {
  it('declares an MNI frame and 3-number coordinates for every scalp site', () => {
    expect(electrodes.frame).toBe('MNI')
    expect(electrodes.electrodes.length).toBeGreaterThanOrEqual(4)
    for (const e of electrodes.electrodes) {
      expect(e.name.trim()).not.toBe('')
      expect(e.mni).toHaveLength(3)
      for (const c of e.mni) expect(Number.isFinite(c)).toBe(true)
    }
  })
})
