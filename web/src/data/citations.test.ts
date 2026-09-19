// Reads web/public/models at run time, so pull in Node types (see ui/disclaimerLayer.test.ts).
/// <reference types="node" />
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_LICENSES,
  CITATION_IDS,
  CITATION_TYPE_ORDER,
  citationEntries,
  citations,
  getCitation,
  groupByType,
  SHIPPED_ASSETS,
} from './citations'

const REQUIRED_STRING_FIELDS = ['id', 'label', 'use', 'source', 'url', 'license'] as const
const VALID_TYPES = ['asset', 'number', 'software']

describe('citations.json ledger', () => {
  it('declares a version and an ISO review date', () => {
    expect(citations.version).toBeGreaterThanOrEqual(1)
    expect(citations.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('contains at least the DESIGN §4 seed assets/numbers', () => {
    expect(citationEntries.length).toBeGreaterThanOrEqual(11)
  })

  it('redistributed entries match the shipped-asset notice mapping', () => {
    const shipped = [...new Set(Object.values(SHIPPED_ASSETS).flat())].sort()
    expect(citationEntries.filter(c => c.distribution === 'redistributed').map(c => c.id).sort()).toEqual(shipped)
    for (const entry of citationEntries) {
      expect(['redistributed', 'cited-fact', 'reference-only']).toContain(entry.distribution)
    }
  })

  it('has unique ids', () => {
    const ids = citationEntries.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The CitationId union (used to brand CitationLink's prop + every field that names a ledger
  // entry, #30) is backed by the hand-written CITATION_IDS list because resolveJsonModule widens
  // JSON strings to `string`. This test is what keeps that list honest: it must be EXACTLY the id
  // set in citations.json, so a new/renamed/removed entry that isn't reflected in CITATION_IDS
  // (or a stale/typo'd CITATION_IDS entry) turns the suite red instead of shipping a union that
  // silently disagrees with the ledger.
  it('CITATION_IDS is exactly the ledger id set (the CitationId union cannot drift from JSON)', () => {
    const ledgerIds = [...citationEntries.map((c) => c.id)].sort()
    const brandedIds = [...CITATION_IDS].sort()
    expect(brandedIds).toEqual(ledgerIds)
  })

  it('CITATION_IDS lists each id exactly once', () => {
    expect(new Set(CITATION_IDS).size).toBe(CITATION_IDS.length)
  })

  describe.each(citationEntries.map((c) => [c.id, c] as const))('entry %s', (_id, entry) => {
    it.each(REQUIRED_STRING_FIELDS)('has a non-empty %s', (field) => {
      const value = entry[field]
      expect(typeof value).toBe('string')
      expect((value as string).trim().length).toBeGreaterThan(0)
    })

    it('has the required triad: url + license + type', () => {
      // The DESIGN §4 honesty contract: every asset/number records where it came from,
      // under what license, and what kind of thing it is.
      expect(entry.url.startsWith('https://')).toBe(true)
      expect(VALID_TYPES).toContain(entry.type)
      expect(ALLOWED_LICENSES as readonly string[]).toContain(entry.license)
    })
  })
})

// Redistribution notices: the deployed site serves the meshes to anyone, and their licenses
// (BSD-2-Clause, ICBM152 terms) require the copyright notice to travel with every copy. The license
// NAME alone is not enough, so every shipped file must map to ledger entries carrying the notice.
describe('SHIPPED_ASSETS — redistributed files carry their required license notices', () => {
  const modelsDir = fileURLToPath(new URL('../../public/models/', import.meta.url))
  const shippedGlbs = readdirSync(modelsDir).filter((f) => f.endsWith('.glb'))

  it('finds the committed meshes (guards the directory lookup itself)', () => {
    expect(shippedGlbs.length).toBeGreaterThanOrEqual(2)
  })

  it.each(shippedGlbs)('models/%s is mapped to at least one ledger entry', (file) => {
    expect(SHIPPED_ASSETS[`models/${file}`]?.length ?? 0).toBeGreaterThan(0)
  })

  it.each(Object.entries(SHIPPED_ASSETS))('%s: every source entry carries a copyright notice', (_file, ids) => {
    for (const id of ids) {
      const notice = getCitation(id)?.notice ?? ''
      expect(notice, id).toMatch(/copyright/i)
    }
  })
})

describe('groupByType — the #/sources provenance browser is complete', () => {
  it('partitions every ledger entry exactly once (nothing dropped on screen)', () => {
    const grouped = groupByType().flatMap((g) => g.entries)
    // Same count + same id set as the raw ledger → the page can never silently drop an entry.
    expect(grouped).toHaveLength(citationEntries.length)
    expect(new Set(grouped.map((e) => e.id)).size).toBe(citationEntries.length)
  })

  it('emits groups in the canonical asset → number → software order', () => {
    const order = groupByType().map((g) => g.type)
    const rank = (t: string) => CITATION_TYPE_ORDER.indexOf(t as never)
    expect(order).toEqual([...order].sort((a, b) => rank(a) - rank(b)))
    for (const t of order) expect(CITATION_TYPE_ORDER).toContain(t)
  })

  it('every grouped entry resolves back to the ledger (no dangling id reaches the page)', () => {
    for (const e of groupByType().flatMap((g) => g.entries)) {
      expect(getCitation(e.id)).toBe(e)
    }
  })
})
