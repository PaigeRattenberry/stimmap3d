/**
 * In-app provenance ledger browser (Milestone 6, #10 + #35-light).
 *
 * Fulfils the Methods page's literal promise that "the complete citation set renders here in
 * Milestone 6": a browsable, license-badged view of `web/src/data/citations.json` at
 * `#/sources`, grouped asset | number | software, every entry carrying its source link, license,
 * intended use, and the honest provenance notes the ledger already records.
 *
 * Self-contained on purpose — no WebGL / Recharts — so `App.test`'s Scene/AnalyticsPanel mocks
 * still exercise the routed shell, and it reads the same `groupByType`/`citationEntries` the
 * panels use (one ledger, one source of truth). The structured top-level `reviewed` date is
 * surfaced verbatim (#35 light); there is intentionally NO per-entry date field / schema change.
 */
import { citations, groupByType } from '../data/citations'
import type { CitationType } from '../data/citations'
import { CitationLink } from './CitationLink'

const TYPE_LABEL: Record<CitationType, string> = {
  asset: 'Assets & meshes',
  number: 'Clinical & physics figures',
  software: 'Software references',
}

const TYPE_BLURB: Record<CitationType, string> = {
  asset: 'Distributed meshes, cited electrode coordinates, and considered atlases; each entry states its role.',
  number: 'Every cited clinical or physics figure — each used only as labeled.',
  software: 'Considered software and methodology references. These are not runtime dependencies.',
}

export function SourcesPage() {
  const groups = groupByType()
  const total = citations.entries.length

  return (
    <article className="sources">
      <a className="sources__back" href="#/">
        ← Back to the visualizer
      </a>

      <h1>Sources &amp; provenance ledger</h1>

      <p className="sources__lede">
        Every asset, clinical figure, and physics anchor in StimMap3D cites its open-literature
        source and license. This is the machine-readable ledger in{' '}
        <code>web/src/data/citations.json</code> — all <strong>{total}</strong> entries, rendered
        in full, with the honest caveats each one carries. Ledger last reviewed{' '}
        <time dateTime={citations.reviewed}>{citations.reviewed}</time>.
      </p>

      <p>“Citable” describes factual provenance, not a redistribution license. Article license
        labels do not apply to this app’s original code or grant permission to reuse article figures.
        Bundled software and mesh notices are available as a <a href="/THIRD_PARTY_NOTICES.txt">plain-text download</a>.</p>

      {groups.map((group) => (
        <section
          key={group.type}
          className="sources__group"
          aria-labelledby={`sources-${group.type}`}
        >
          <h2 id={`sources-${group.type}`} className="sources__group-title">
            {TYPE_LABEL[group.type]}{' '}
            <span className="sources__count">{group.entries.length}</span>
          </h2>
          <p className="sources__group-blurb">{TYPE_BLURB[group.type]}</p>

          <ul className="sources__list">
            {group.entries.map((c) => (
              <li key={c.id} className="sources__entry">
                <div className="sources__entry-head">
                  <h3 className="sources__entry-title">{c.label}</h3>
                  <span className={`sources__license sources__license--${c.type}`}>
                    {c.license}
                  </span>
                </div>
                <p className="sources__use">
                  <span className="sources__use-tag">{c.distribution === 'redistributed' ? 'Redistributed asset' : c.distribution === 'cited-fact' ? 'Cited fact' : 'Reference only'}</span> {c.use}
                </p>
                <p className="sources__source">{c.source}</p>
                {c.notes && <p className="sources__notes">{c.notes}</p>}
                {c.notice && (
                  <details className="sources__notice">
                    <summary>License notice (reproduced as the license requires)</summary>
                    <pre className="sources__notice-text">{c.notice}</pre>
                  </details>
                )}
                <CitationLink id={c.id} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  )
}
