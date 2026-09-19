/**
 * Shared provenance link (DESIGN §4 ledger): resolves a citations.json id to its source URL.
 * Consolidates the anchor markup the panels previously hand-rolled, so a change to how cited
 * sources render (aria, rel, a license affordance) lives in exactly one place. The `id` prop is
 * the {@link CitationId} union, so a typo'd citation id is a COMPILE error (V2-6, #30) — not a
 * silently-missing link. The runtime null-guard is kept as belt-and-braces for the cast JSON path.
 */
import { getCitation } from '../data/citations'
import type { CitationId } from '../data/citations'

export function CitationLink({ id, short }: { id: CitationId; short?: boolean }) {
  const c = getCitation(id)
  if (!c) return null
  return (
    <a className="citation-link" href={c.url} target="_blank" rel="noreferrer">
      {short ? 'Source' : c.label} ↗
    </a>
  )
}
