// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SourcesPage } from './SourcesPage'
import { citationEntries, citations, groupByType, SHIPPED_ASSETS } from '../data/citations'

afterEach(cleanup)

describe('SourcesPage (#/sources provenance ledger)', () => {
  it('renders one heading per ledger entry — the whole ledger is on screen', () => {
    render(<SourcesPage />)
    // Every entry renders an <h3> title; a dropped entry would fail this count.
    const entryHeadings = screen.getAllByRole('heading', { level: 3 })
    expect(entryHeadings).toHaveLength(citationEntries.length)
  })

  it('surfaces the structured top-level review date verbatim (#35 light)', () => {
    render(<SourcesPage />)
    expect(screen.getByText(citations.reviewed)).toBeTruthy()
  })

  it('shows exactly one group heading per non-empty type', () => {
    render(<SourcesPage />)
    const groupHeadings = screen.getAllByRole('heading', { level: 2 })
    expect(groupHeadings).toHaveLength(groupByType().length)
    // The canonical labels are present — scoped to the group headings, since ledger prose (e.g. the
    // BSD "THIS SOFTWARE IS PROVIDED…" notice) can legitimately contain the same words.
    expect(screen.getByRole('heading', { level: 2, name: /Assets & meshes/i })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: /Clinical & physics figures/i })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: /Software/i })).toBeTruthy()
  })

  it('reproduces every shipped asset’s license notice verbatim on the page', () => {
    const { container } = render(<SourcesPage />)
    const rendered = [...container.querySelectorAll('.sources__notice-text')].map((n) => n.textContent)
    const ids = new Set(Object.values(SHIPPED_ASSETS).flat())
    expect(ids.size).toBeGreaterThan(0)
    for (const id of ids) {
      const notice = citationEntries.find((c) => c.id === id)?.notice
      expect(notice, id).toBeTruthy()
      expect(rendered).toContain(notice)
    }
  })

  it('gives every entry an outbound source link (CitationLink resolves)', () => {
    render(<SourcesPage />)
    const links = screen.getAllByRole('link')
    // Back link + at least one CitationLink per entry.
    expect(links.length).toBeGreaterThanOrEqual(citationEntries.length + 1)
    // Spot-check a known entry renders with its license badge text.
    expect(screen.getByText('Mutz et al. 2019 — network meta-analysis')).toBeTruthy()
  })
})
