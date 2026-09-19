/**
 * Targeting-method explainer cards (Milestone 4) — "clinical-method literacy on screen".
 *
 * Three left-DLPFC localization methods, each cited to its PRIMARY source (DESIGN §4):
 *  • 5-cm rule — deprecated; misses DLPFC in >1/3 of patients (ignores head size).
 *  • Beam-F3 — a 10-20 scalp heuristic; ≈0.65 cm MEDIAN discrepancy from an MRI-neuronavigated
 *    target (Mir-Moghtadaei 2015), rising to ~1.36 cm at the 95th percentile (a median, not a
 *    hard bound).
 *  • Connectivity-based — the DLPFC site most anticorrelated with the subgenual ACC, which
 *    predicts better antidepressant response (Fox 2012; refined by Weigand 2018).
 *
 * Attribution follows the primary publications: Fox 2012 for connectivity targeting;
 * Beam 2009 and Mir-Moghtadaei 2015 for Beam-F3. The active method is highlighted.
 */
import { useStimStore } from '../store'
import type { Preset } from '../store'
import { getCitation } from '../data/citations'
import type { Citation, CitationId } from '../data/citations'
import { Term } from '../ui/Term'

type MethodKey = 'five-cm' | 'beam-f3' | 'connectivity'

interface MethodCard {
  key: MethodKey
  name: string
  badge: string
  badgeKind: 'deprecated' | 'heuristic' | 'connectivity'
  body: string
  /** Citation ids (resolved against the ledger for the source links) — {@link CitationId}s, so a
   *  typo is a compile error here too, not a silently-dropped source link (#30). */
  citationIds: CitationId[]
}

const METHODS: MethodCard[] = [
  {
    key: 'five-cm',
    name: '5-cm rule',
    badge: 'Deprecated',
    badgeKind: 'deprecated',
    body: 'Places the coil 5 cm anterior to the motor hotspot along the scalp. Because it ignores individual head size it lands posterior to the DLPFC in more than a third of patients — superseded by scalp-heuristic and connectivity methods.',
    citationIds: ['five-cm-rule-deprecation'],
  },
  {
    key: 'beam-f3',
    name: 'Beam-F3',
    badge: '≈0.65 cm median',
    badgeKind: 'heuristic',
    body: 'A 10-20 / EEG-based scalp heuristic that locates the F3 electrode site over left DLPFC from a few head measurements — no MRI needed. It lands a median ≈0.65 cm from an MRI-neuronavigated DLPFC target (up to ~1.36 cm at the 95th percentile; a median, not a guaranteed bound). Because it was tuned to approximate the connectivity target, the F3 and connectivity presets here land close together on the scalp.',
    citationIds: ['beam-2009-f3', 'mir-moghtadaei-2015-beamf3'],
  },
  {
    key: 'connectivity',
    name: 'Connectivity-based',
    badge: 'sgACC-anticorrelated',
    badgeKind: 'connectivity',
    body: 'Targets the DLPFC site whose resting-state signal is most anticorrelated with the subgenual anterior cingulate (sgACC) — a location that predicts better antidepressant response. The hard-coded preset uses the Fox 2012 group optimum (-44, 38, 34), refined by Weigand 2018. It sits close to the Beam-F3 / F3 site, which is exactly why Beam-F3 is a useful MRI-free proxy.',
    citationIds: ['fox-2012-sgacc-target', 'weigand-2018-connectivity'],
  },
]

/** Which method card the active preset exercises (F4/Fz/Cz are plain 10-20 references). */
function methodForPreset(preset: Preset): MethodKey | null {
  if (preset === 'F3') return 'beam-f3'
  if (preset === 'connectivity') return 'connectivity'
  return null
}

export function MethodExplainers() {
  const preset = useStimStore((s) => s.preset)
  const targetCompareMm = useStimStore((s) => s.targetCompareMm)
  const activeMethod = methodForPreset(preset)

  return (
    <section className="method-explainers" aria-label="Targeting-method explainers" data-tour="methods-explainers">
      <h2 className="method-explainers__title">Targeting methods — how each preset finds the DLPFC</h2>
      <p className="method-explainers__lede">
        Modern scalp-heuristic (<Term id="beam-f3">Beam-F3</Term>) and connectivity-based targets — the{' '}
        <Term id="dlpfc">DLPFC</Term> site most anticorrelated with the <Term id="sgacc">sgACC</Term> —
        land close together (Beam-F3 was tuned to approximate the connectivity target), so the F3 and
        connectivity presets here differ only slightly. The genuinely different, now-deprecated method is
        the older 5-cm rule, which lands ~2 cm posterior and misses the DLPFC in over a third of patients.
      </p>
      <p className="method-explainers__gap">
        <span className="method-explainers__gap-tag">Live measure</span>{' '}
        {targetCompareMm != null ? (
          <>
            the F3 and connectivity coil centres sit{' '}
            <strong>{targetCompareMm.toFixed(1)} mm</strong> apart on the scalp — a straight-line
            chord derived live from the same preset coordinates (not a geodesic, and distinct from
            the ≈0.65 cm cortical Beam-F3 discrepancy). Toggle{' '}
            <em>“Compare F3 vs connectivity”</em> in the controls to see both centres.
          </>
        ) : (
          <>
            toggle <em>“Compare F3 vs connectivity”</em> in the controls to draw both coil centres
            and read their straight-line scalp gap, derived live from the preset coordinates.
          </>
        )}
      </p>
      <div className="method-cards">
        {METHODS.map((m) => {
          const isActive = m.key === activeMethod
          return (
            <article
              key={m.key}
              className={`method-card${isActive ? ' method-card--active' : ''}`}
              aria-current={isActive ? 'true' : undefined}
            >
              <header className="method-card__head">
                <h3 className="method-card__name">{m.name}</h3>
                <span className={`method-card__badge method-card__badge--${m.badgeKind}`}>
                  {m.badge}
                </span>
              </header>
              <p className="method-card__body">{m.body}</p>
              <p className="method-card__sources">
                {m.citationIds
                  .map(getCitation)
                  .filter((c): c is Citation => c != null)
                  .map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ' · '}
                      <a href={c.url} target="_blank" rel="noreferrer">
                        {c.label} ↗
                      </a>
                    </span>
                  ))}
              </p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
