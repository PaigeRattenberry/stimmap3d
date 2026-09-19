/**
 * Dose–response analytics (Milestone 5) — the literature/synthetic half of the fused product.
 *
 * Bound to the store's `protocol` / `setProtocol` (its first and only consumer): picking a
 * protocol re-keys every view. Three deliberately SEPARATED views keep the DESIGN §4 honesty contract:
 *
 *   1. ABSOLUTE response/remission % — directly-measured head-to-head/open-label anchors
 *      (THREE-D, Berlim) plus the explicit sham baseline. Percentages only.
 *   2. ODDS RATIO vs sham — the Mutz 2019 network meta-analysis, on its OWN axis (never the
 *      percent axis), with the sham→probability conversion shown explicitly and sourced.
 *   3. SYNTHETIC MADRS/BDI trajectory for the selected protocol — the cohort mean wrapped in a
 *      ±1 SD population-spread band with per-patient population-scatter halos (V2-7a: C4 + #39), badged
 *      synthetic.
 *
 * Honesty gates: (c) ORs and absolute rates never share an axis — they live in sections 1 vs 2;
 * (d) every synthetic series is badged and the cohort is labeled illustrative. Every cited
 * number carries a source link via the shared <CitationLink>. OR-derived rates (1 Hz LF-R) are
 * hatch-marked in the chart itself — provenance is visual, not just foot prose.
 *
 * V2-7a (pedagogy): the trajectory chart gains population-scatter halos + a provenance-badged ±1 SD
 * band (C4/#39); the quarantined AcceleratedCallout gains the SAINT/SNT targeting+schedule story (C3)
 * and a qualitative coil-orientation tolerability cue (C5). Gate (c) firewall preserved — SAINT's rate
 * never touches the absolute-% or OR axes; the halos/band reskin data trajectoryData() already
 * computes (no new statistic is fabricated).
 */
import { useEffect, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ErrorBar,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { useStimStore } from '../store'
import type { Protocol } from '../store'
import { CitationLink } from '../ui/CitationLink'
import {
  asPercent,
  getProtocolData,
  orToProbability,
  protocols,
  shamBaseline,
  trials,
} from '../data/trials'
import type { ProtocolData } from '../data/trials'

const C = {
  response: '#5b8cff', // accent
  remission: '#40c88c', // green (matches the connectivity badge family)
  sham: '#6b7494',
  or: '#b48cff',
  ci: '#ede6ff', // light lavender — 95% CI whisker, reads over both the OR bar and the dark plot
  natfreqSham: '#6b7494', // sham responders in the natural-frequency waffle (matches the sham swatch)
  natfreqDim: 'rgba(120, 134, 176, 0.22)', // un-shaded waffle dots
  mean: '#ffb454', // accent-warm — the synthetic mean line
  band: 'rgba(255, 180, 84, 0.18)', // ±1 SD population-spread band fill (V2-7a: slightly lifted for legibility)
  patient: 'rgba(184, 192, 214, 0.42)', // per-patient population-scatter halo dots (V2-7a: C4)
  grid: 'rgba(120, 134, 176, 0.18)',
  axis: '#aab3cc',
}

type Scale = 'madrs' | 'bdi'

function SyntheticBadge() {
  return <span className="analytics-badge analytics-badge--synthetic">Synthetic</span>
}

/* ── view-model builders (pure; data-driven so locked figures flow straight through) ── */

interface AbsRow {
  key: string
  name: string
  response: number // percent
  remission: number // percent
  kind: 'sham' | 'measured' | 'or-derived'
  selected: boolean
}

function absoluteData(selected: Protocol): AbsRow[] {
  const sham: AbsRow = {
    key: 'sham',
    name: 'Sham',
    response: shamBaseline.responseRate * 100,
    remission: shamBaseline.remissionRate * 100,
    kind: 'sham',
    selected: false,
  }
  const rows = protocols.map((p) => ({
    key: p.id,
    name: p.label,
    response: p.rates.responseRate * 100,
    remission: p.rates.remissionRate * 100,
    kind: p.rates.source,
    selected: p.id === selected,
  }))
  return [sham, ...rows]
}

interface OrRow {
  key: string
  name: string
  or: number
  ciLow: number
  ciHigh: number
  /**
   * Asymmetric 95% CI as a 2-element OFFSET array for recharts <ErrorBar> (#16). recharts reads
   * `[a, b]` as deltas from the bar value → whisker spans `[or − a, or + b]`, NOT absolute
   * endpoints — so feed `[or − ciLow, ciHigh − or]` (both ≥ 0 since ciLow < or < ciHigh).
   */
  orErr: [number, number]
  selected: boolean
}

function oddsData(selected: Protocol): OrRow[] {
  return protocols.map((p) => {
    const { or, ciLow, ciHigh } = p.odds.response
    return {
      key: p.id,
      name: p.label,
      or,
      ciLow,
      ciHigh,
      orErr: [or - ciLow, ciHigh - or],
      selected: p.id === selected,
    }
  })
}

/**
 * Build the trajectory chart rows: a ±1 SD band rendered as a stacked transparent base + visible
 * span, the cohort mean, and the faint per-patient lines. The band span is `(mean+sd) − base`
 * (not `2·sd`) so that when `sd > mean` — base is clamped at 0 — the band top stays at `mean+sd`
 * instead of overshooting. Also returns the data max so the Y-axis can size to fit every line.
 */
function trajectoryData(p: ProtocolData, scale: Scale) {
  const meanKey = scale === 'madrs' ? 'madrsMean' : 'bdiMean'
  const sdKey = scale === 'madrs' ? 'madrsSd' : 'bdiSd'
  let max = 0
  const rows = p.summary.map((s, wi) => {
    const mean = s[meanKey]
    const sd = s[sdKey]
    const base = Math.max(mean - sd, 0)
    const row: Record<string, number> = {
      week: s.week,
      mean,
      bandBase: base,
      bandSpan: mean + sd - base,
    }
    max = Math.max(max, mean + sd)
    p.patients.forEach((pat, i) => {
      const v = pat.trajectory[wi][scale]
      row[`pat${i}`] = v
      max = Math.max(max, v)
    })
    return row
  })
  return { rows, max }
}

/**
 * Trajectory tooltip: the chart carries the mean line, a ±1 SD band, and ~12 faint patient
 * lines — a default tooltip would list all ~14 series. Show only the cohort mean.
 */
function TrajectoryTooltip(props: {
  active?: boolean
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>
  label?: unknown
  scaleLabel: string
}) {
  const { active, payload, label, scaleLabel } = props
  if (!active || !payload?.length) return null
  const mean = payload.find((p) => p.dataKey === 'mean')
  if (typeof mean?.value !== 'number') return null
  return (
    <div className="analytics-tooltip">
      <div className="analytics-tooltip__label">Week {String(label)}</div>
      <div>
        Cohort mean {scaleLabel}: <strong>{mean.value.toFixed(1)}</strong>
      </div>
    </div>
  )
}

/* ── sub-views ── */

function ProtocolSelector({
  protocol,
  setProtocol,
}: {
  protocol: Protocol
  setProtocol: (p: Protocol) => void
}) {
  return (
    <div className="control-group">
      <h3 className="control-group__title">Protocol</h3>
      <div className="segmented" role="group" aria-label="rTMS protocol">
        {protocols.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`segmented__btn${p.id === protocol ? ' segmented__btn--active' : ''}`}
            aria-pressed={p.id === protocol}
            onClick={() => setProtocol(p.id)}
            title={p.longLabel}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Bar fill keyed on provenance: sham = grey; directly-measured = solid; OR-derived = a hatch
 * pattern (so the 1 Hz LF-R bar is visually marked as derived in the chart itself, regardless
 * of which protocol is selected — gate (c)/(4), not just foot prose).
 */
function barFill(row: AbsRow, base: string, hatchId: string): string {
  if (row.kind === 'sham') return C.sham
  if (row.kind === 'or-derived') return `url(#${hatchId})`
  return base
}

/** Hidden SVG <defs> carrying the OR-derived hatch patterns (referenced by Cell fills). */
function HatchDefs() {
  const hatch = (id: string, color: string) => (
    <pattern id={id} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
      <rect width={5} height={5} fill={color} fillOpacity={0.28} />
      <line x1={0} y1={0} x2={0} y2={5} stroke={color} strokeWidth={2.4} />
    </pattern>
  )
  return (
    <svg aria-hidden width={0} height={0} style={{ position: 'absolute' }}>
      <defs>
        {hatch('orHatchResp', C.response)}
        {hatch('orHatchRem', C.remission)}
      </defs>
    </svg>
  )
}

function AbsoluteSection({ selected }: { selected: Protocol }) {
  const data = absoluteData(selected)
  const active = getProtocolData(selected)
  const opacity = (row: AbsRow) => (row.kind === 'sham' || row.selected ? 1 : 0.5)

  return (
    <section className="analytics-card" aria-label="Published absolute response and remission rates">
      <HatchDefs />
      <header className="analytics-card__head">
        <h3 className="analytics-card__title">Absolute response &amp; remission</h3>
        <span className="analytics-card__tag">% of patients · cited rates</span>
      </header>
      <p className="analytics-card__lede">
        Cited acute-course rates — directly measured in head-to-head / open-label trials (THREE-D,
        Berlim), shown against the explicit sham baseline. 1 Hz LF-R has no head-to-head trial, so
        its bars are <strong>OR-derived</strong> (hatched). Remission cutoffs differ across these
        trials (THREE-D uses HRSD-17 &lt; 8; the sham arms use HAM-D-based cutoffs), so read the
        remission bars as an approximate cross-trial comparison, not a like-for-like one. This axis
        is <strong>percentages only</strong> — odds ratios live in the next panel.
      </p>
      <div className="analytics-chart" role="img" aria-label="Grouped bar chart of response and remission percentages by protocol vs sham">
        <ResponsiveContainer width="100%" height={232}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 4 }} barGap={2}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: C.axis, fontSize: 12 }} tickLine={false} />
            <YAxis
              tick={{ fill: C.axis, fontSize: 11 }}
              tickLine={false}
              width={38}
              domain={[0, 60]}
              unit="%"
            />
            <Tooltip
              cursor={{ fill: 'rgba(120,134,176,0.12)' }}
              contentStyle={{
                background: '#141a30',
                border: '1px solid #2a3358',
                borderRadius: 8,
                color: '#e8ecf6',
                fontSize: 12,
              }}
              formatter={(v: number, n) => [`${v.toFixed(0)}%`, n === 'response' ? 'Response' : 'Remission']}
            />
            <Bar dataKey="response" name="response" radius={[3, 3, 0, 0]}>
              {data.map((row) => (
                <Cell key={row.key} fill={barFill(row, C.response, 'orHatchResp')} fillOpacity={opacity(row)} />
              ))}
            </Bar>
            <Bar dataKey="remission" name="remission" radius={[3, 3, 0, 0]}>
              {data.map((row) => (
                <Cell key={row.key} fill={barFill(row, C.remission, 'orHatchRem')} fillOpacity={opacity(row)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="analytics-legend">
        <span><i className="swatch" style={{ background: C.response }} /> Response (≥50% reduction)</span>
        <span><i className="swatch" style={{ background: C.remission }} /> Remission (per-protocol cutoff)</span>
        <span><i className="swatch" style={{ background: C.sham }} /> Sham baseline</span>
        <span><i className="swatch swatch--hatch" /> OR-derived (vs sham)</span>
      </div>
      {active && (
        <>
          <p className="analytics-card__foot">
            <strong>{active.label}:</strong> {asPercent(active.rates.responseRate)} response,{' '}
            {asPercent(active.rates.remissionRate)} remission —{' '}
            {active.rates.source === 'or-derived' ? (
              <span className="analytics-badge analytics-badge--derived">OR-derived vs sham</span>
            ) : (
              <>measured in the {active.arm}</>
            )}{' '}
            <CitationLink id={active.rates.citationId} short />. Sham baseline{' '}
            {asPercent(shamBaseline.responseRate)} / {asPercent(shamBaseline.remissionRate)}{' '}
            <CitationLink id={shamBaseline.citationId} short />.
          </p>
          <p className="analytics-card__def">{active.rates.definition}</p>
        </>
      )}
    </section>
  )
}

/**
 * Natural-frequency waffle (#17): one 10×10 pictograph of 100 patients with `count` dots shaded.
 * Pure inline SVG — no new dependency, and no layout measurement (happy-dom returns 0 for getBBox,
 * so the grid is laid out from constants, never from a measured size). The count is data-driven:
 * the OR-derived response probability (or the sham baseline) × 100, rounded.
 *
 * Pedagogy (inline sources only — NOT ledger entries; the citations schema is asset|number|software
 * and would reject a pedagogy type): natural-frequency "X of 100" framing improves Bayesian-style
 * comprehension over bare percentages — Gigerenzer & Hoffrage 1995 (Psych Review 102(4):684); icon
 * arrays are an effective natural-frequency display — Tubau et al. 2019 (Psych Research 83:1535,
 * doi:10.1007/s00426-018-1041-4).
 */
function NatFreqWaffle({
  count,
  color,
  label,
  caption,
}: {
  count: number
  color: string
  label: string
  caption: string
}) {
  const TOTAL = 100
  const COLS = 10
  const shaded = Math.max(0, Math.min(TOTAL, count))
  return (
    <figure className="natfreq">
      <figcaption className="natfreq__label">{label}</figcaption>
      <svg
        className="natfreq__grid"
        viewBox="0 0 100 100"
        role="img"
        aria-label={`${shaded} of ${TOTAL} ${caption}`}
      >
        {Array.from({ length: TOTAL }, (_, i) => (
          <circle
            key={i}
            cx={(i % COLS) * 10 + 5}
            cy={Math.floor(i / COLS) * 10 + 5}
            r={3.4}
            fill={i < shaded ? color : C.natfreqDim}
          />
        ))}
      </svg>
      <span className="natfreq__caption">
        <strong>{shaded}</strong> of 100 · {caption}
      </span>
    </figure>
  )
}

function OddsSection({ selected }: { selected: Protocol }) {
  const data = oddsData(selected)
  const active = getProtocolData(selected)
  // Size the OR axis to the widest 95% CI upper bound (not just the point estimate) so no whisker
  // is clipped — recharts folds ErrorBar values into the domain, but pin the cap explicitly (#16).
  // Round up to a clean integer (e.g. 7.08 → 8) so the axis shows tidy ticks, not a raw float.
  const xUpper = Math.max(2, Math.ceil(Math.max(...data.map((d) => d.ciHigh)) * 1.05))

  // OR → probability against the sham baseline, broken into auditable steps (#17). The final result
  // reuses the single locked primitive (orToProbability); the shown intermediate odds mirror its
  // closed form (odds₀ = p₀/(1−p₀); treated odds = OR·odds₀; p = odds/(1+odds)).
  const p0 = shamBaseline.responseRate
  const shamOdds = p0 / (1 - p0)
  const or = active?.odds.response.or ?? 0
  const treatedOdds = or * shamOdds
  const derivedResp = active ? orToProbability(or, p0) : 0
  const derivedCount = Math.round(derivedResp * 100) // OR-derived responders per 100 (waffle)
  const shamCount = Math.round(p0 * 100) // sham responders per 100 (waffle)

  return (
    <section className="analytics-card" aria-label="Response odds ratio versus sham">
      <header className="analytics-card__head">
        <h3 className="analytics-card__title">Odds ratio vs sham</h3>
        <span className="analytics-card__tag">odds ratio · separate axis</span>
      </header>
      <p className="analytics-card__lede">
        Network meta-analytic <strong>response odds ratios relative to sham</strong> (Mutz 2019).
        An OR is <em>not</em> a response rate — the dashed line marks OR = 1 (sham, no effect). The
        whiskers are each protocol&apos;s <strong>95% confidence interval</strong>.
      </p>
      <div className="analytics-chart" role="img" aria-label="Horizontal bar chart of response odds ratio vs sham by protocol">
        <ResponsiveContainer width="100%" height={188}>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
          >
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, xUpper]}
              tick={{ fill: C.axis, fontSize: 11 }}
              tickLine={false}
              label={{ value: 'Odds ratio vs sham (95% CI)', position: 'insideBottom', offset: -2, fill: C.axis, fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: C.axis, fontSize: 12 }}
              tickLine={false}
              width={76}
            />
            <Tooltip
              cursor={{ fill: 'rgba(120,134,176,0.12)' }}
              contentStyle={{
                background: '#141a30',
                border: '1px solid #2a3358',
                borderRadius: 8,
                color: '#e8ecf6',
                fontSize: 12,
              }}
              formatter={(v: number) => [`${v.toFixed(2)}×`, 'OR vs sham']}
            />
            <ReferenceLine x={1} stroke="#ffd9a8" strokeDasharray="4 3" />
            <Bar dataKey="or" radius={[0, 3, 3, 0]} barSize={22} isAnimationActive={false}>
              {data.map((row) => (
                <Cell key={row.key} fill={C.or} fillOpacity={row.selected ? 1 : 0.5} />
              ))}
              {/* 95% CI whisker (#16). `orErr` carries the asymmetric [low, high] OFFSETS; direction
                  is "x" because the chart is layout="vertical" (OR lives on the X axis). The CI is
                  confined to this OR axis and never appears on the absolute-% axis (gate (c)). */}
              <ErrorBar dataKey="orErr" direction="x" width={5} stroke={C.ci} strokeWidth={1.5} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {active && (
        <>
          <div className="analytics-conversion">
            <p className="analytics-conversion__title">OR → probability against the sham baseline</p>
            <p className="analytics-conversion__formula">
              <code>p = OR·p₀/(1−p₀) ÷ (1 + OR·p₀/(1−p₀))</code>, with sham{' '}
              <code>p₀ = {asPercent(shamBaseline.responseRate, 1)}</code> response{' '}
              <CitationLink id={shamBaseline.citationId} short />.
            </p>
            {/* Numbered, auditable walkthrough of that one formula (#17). Phrasing avoids the exact
                "p = OR·p₀" literal so the test's singular getByText for the formula stays unique. */}
            <ol className="analytics-walkthrough">
              <li>
                <span className="analytics-walkthrough__step">Sham odds.</span> Convert the baseline
                response rate to odds: {asPercent(p0, 1)} ÷ {asPercent(1 - p0, 1)} ={' '}
                <strong>{shamOdds.toFixed(3)}</strong>.
              </li>
              <li>
                <span className="analytics-walkthrough__step">Apply the odds ratio.</span> Scale the
                sham odds by {active.label}&apos;s OR: {shamOdds.toFixed(3)} × {or.toFixed(2)} ={' '}
                <strong>{treatedOdds.toFixed(3)}</strong> (treated odds).
              </li>
              <li>
                <span className="analytics-walkthrough__step">Back to a probability.</span> odds ÷ (1
                + odds): {treatedOdds.toFixed(3)} ÷ {(1 + treatedOdds).toFixed(3)} ={' '}
                <strong>{asPercent(derivedResp)}</strong> response vs sham.
              </li>
            </ol>
            <p className="analytics-conversion__result">
              <strong>{active.label}:</strong> OR{' '}
              <strong>{active.odds.response.or.toFixed(2)}×</strong> (95% CI{' '}
              {active.odds.response.ciLow.toFixed(2)}–{active.odds.response.ciHigh.toFixed(2)}){' '}
              <CitationLink id={active.odds.response.citationId} short /> → <strong>{asPercent(derivedResp)}</strong>{' '}
              response vs sham.
            </p>
            <p className="analytics-conversion__note">
              {active.rates.source === 'or-derived' ? (
                <>
                  The absolute response bar on the left <strong>is</strong> this OR-derived figure —
                  no head-to-head trial measures 1 Hz LF-R directly, so its rate comes only from the
                  Mutz OR against the labeled sham baseline.
                </>
              ) : (
                <>
                  This sham-anchored figure ({asPercent(derivedResp)}) is{' '}
                  {derivedResp < active.rates.responseRate ? 'lower' : 'higher'} than the head-to-head
                  absolute on the left ({asPercent(active.rates.responseRate)}) because the two use
                  different denominators — a ~{asPercent(shamBaseline.responseRate)} sham reference vs
                  an active comparative trial. That is exactly why ORs and absolute rates stay on
                  separate axes.
                </>
              )}
            </p>
          </div>

          {/* Natural-frequency icon array (#17): the SAME OR-derived-vs-sham probability the card
              above prints, as two "N of 100" waffles. OR-side only — labeled derived/illustrative so
              it never reads as a directly-measured absolute rate (gate (c)). */}
          <div
            className="analytics-natfreq"
            role="group"
            aria-label="Natural-frequency comparison of OR-derived versus sham responders per 100 patients"
          >
            <p className="analytics-conversion__title">
              Natural frequency — out of 100 patients{' '}
              <span className="analytics-badge analytics-badge--derived">OR-derived · illustrative</span>
            </p>
            <div className="natfreq-array">
              <NatFreqWaffle
                count={shamCount}
                color={C.natfreqSham}
                label="Sham baseline"
                caption="respond on sham"
              />
              <NatFreqWaffle
                count={derivedCount}
                color={C.or}
                label={`${active.label} · OR-derived`}
                caption="respond, derived from the OR"
              />
            </div>
            <p className="analytics-conversion__note">
              The same sham-anchored {asPercent(derivedResp)} from the conversion above, shown as a
              natural-frequency array (“{derivedCount} of 100”). It is{' '}
              <strong>derived from the Mutz odds ratio against the labeled sham baseline</strong> —
              illustrative, <em>not</em> a directly-measured rate, and never plotted on the
              absolute-percentage axis.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

function TrajectorySection({ selected }: { selected: Protocol }) {
  const [scale, setScale] = useState<Scale>('madrs')
  const p = getProtocolData(selected)
  if (!p) return null
  const { rows: data, max } = trajectoryData(p, scale)
  const scaleLabel = scale === 'madrs' ? 'MADRS' : 'BDI'
  // Size the Y-axis to fit every series (round up to the next 5, capped at the scale max) so no
  // patient point is ever clipped, regardless of the seed the cohort was generated with.
  const yMax = Math.min(scale === 'madrs' ? 60 : 63, Math.ceil((max + 2) / 5) * 5)

  return (
    <section className="analytics-card analytics-card--wide" aria-label="Synthetic symptom trajectory">
      <header className="analytics-card__head">
        <h3 className="analytics-card__title">
          Synthetic {scaleLabel} trajectory — {p.label} <SyntheticBadge />
        </h3>
        <div className="segmented segmented--mini" role="group" aria-label="Trajectory scale">
          {(['madrs', 'bdi'] as Scale[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`segmented__btn${s === scale ? ' segmented__btn--active' : ''}`}
              aria-pressed={s === scale}
              onClick={() => setScale(s)}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <p className="analytics-card__lede">
        An <strong>illustrative</strong> cohort of {p.cohortSize} simulated patients (fixed-seed,
        generated from published summary statistics) — <em>not real patients</em>. Each faint dot is
        one individual synthetic patient (the population scatter, {p.patients.length} shown); the bold
        line is the cohort mean, wrapped in a ±1 SD band so the week-to-week spread is visible.
      </p>
      <div className="analytics-chart" role="img" aria-label={`Synthetic ${scaleLabel} trajectories over 6 weeks for ${p.label}`}>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: -6, bottom: 16 }}>
            <CartesianGrid stroke={C.grid} />
            <XAxis
              dataKey="week"
              tick={{ fill: C.axis, fontSize: 11 }}
              tickLine={false}
              label={{ value: 'Weeks since baseline', position: 'insideBottom', offset: -8, fill: C.axis, fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: C.axis, fontSize: 11 }}
              tickLine={false}
              width={34}
              domain={[0, yMax]}
              label={{ value: `${scaleLabel} score`, angle: -90, position: 'insideLeft', offset: 14, fill: C.axis, fontSize: 11 }}
            />
            <Tooltip
              cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
              content={(props) => <TrajectoryTooltip {...props} scaleLabel={scaleLabel} />}
            />
            {/* ±1 SD population-spread band (#39): transparent base + visible span (stacked). The band and
                the halos below reskin data trajectoryData() already computes — no new statistic — and
                are provenance-badged synthetic in the legend beneath the chart. */}
            <Area dataKey="bandBase" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="bandSpan" stackId="band" stroke="none" fill={C.band} isAnimationActive={false} />
            {/* Population-scatter halos (C4): each synthetic patient's per-week value as a faint dot,
                so the cohort spread around the mean is visible at every timepoint. ZAxis pins a small,
                uniform symbol size (there is no z channel — every point renders the same size). */}
            <ZAxis type="number" range={[9, 9]} />
            {p.patients.map((_, i) => (
              <Scatter
                key={`pat${i}`}
                dataKey={`pat${i}`}
                fill={C.patient}
                shape="circle"
                isAnimationActive={false}
                legendType="none"
              />
            ))}
            <Line
              dataKey="mean"
              stroke={C.mean}
              strokeWidth={2.5}
              dot={{ r: 2.5, fill: C.mean }}
              isAnimationActive={false}
            />
            <ReferenceLine
              y={10}
              stroke={C.remission}
              strokeDasharray="4 3"
              label={{ value: scale === 'madrs' ? 'MADRS ≤ 10 remission' : '', position: 'insideTopRight', fill: C.remission, fontSize: 10 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Overlay legend (C4/#39): names the population-scatter halos + the ±1 SD band and carries a
          "synthetic" badge over both, so the provenance discipline the OR-derived bars use in the
          absolute card extends into the trajectory chart. */}
      <div className="analytics-legend">
        <span>
          <i className="swatch swatch--dot" style={{ background: C.patient }} /> Individual synthetic
          patients ({p.patients.length} shown)
        </span>
        <span>
          <i className="swatch swatch--band" style={{ background: C.band }} /> ±1 SD band around the mean
        </span>
        <span>
          <i className="swatch" style={{ background: C.mean }} /> Cohort mean
        </span>
        <SyntheticBadge />
      </div>
      <p className="analytics-card__foot">
        Synthetic trajectories are shaped to be consistent with this protocol's cited endpoint
        rates (above), but are <strong>illustrative only</strong> — no individual datum is a real
        measurement. Response = ≥50% reduction; remission = MADRS ≤ 10.
      </p>
    </section>
  )
}

/**
 * Accelerated-protocol context (SNT/SAINT) — deliberately QUARANTINED: shown as an
 * experimental callout, never folded into the standard 3-protocol comparison and never used
 * as a sham baseline. The SNT 2022 RCT is sham-controlled but tiny (n=29, stopped at a planned
 * interim); the ~90% figure is the 2020 open-label, uncontrolled pilot. Both are MADRS-based and
 * the categorical rates are cumulative across the 4-week follow-up (not a single-timepoint rate).
 */
function AcceleratedCallout() {
  return (
    <section className="analytics-note" aria-label="Accelerated protocols context (SNT/SAINT)">
      <header className="analytics-note__head">
        <h3 className="analytics-note__title">Accelerated protocols (SNT / SAINT)</h3>
        <span className="analytics-badge analytics-badge--experimental">Experimental · small-n</span>
      </header>
      <p className="analytics-note__body">
        Stanford&apos;s accelerated, fMRI-guided iTBS (90,000 pulses over 5 days) reports far higher
        rates, but on very small samples. The sham-controlled <strong>SNT RCT</strong> (n=29,
        stopped at a planned interim) found <strong>78.6%</strong> remission (11/14) vs{' '}
        <strong>13.3%</strong> sham (MADRS ≤ 10), <em>cumulative across the 4-week follow-up</em> —
        not a single-timepoint rate <CitationLink id="cole-snt-saint" short />. The often-quoted ~90%
        remission is the earlier <strong>open-label, uncontrolled</strong> SAINT pilot (19/21){' '}
        <CitationLink id="cole-2020-saint-pilot" short />. These are <strong>not</strong> directly
        comparable to the standard protocols above (different course, targeting, durability), so
        they are kept separate; a larger replication reports a more modest ~50% vs 21%.
      </p>

      {/* C3 — the spatial/schedule story that ties this callout to the live scene's connectivity
          preset WITHOUT folding the rate into the comparison (gate (c) firewall reinforced). */}
      <div className="analytics-note__sub">
        <h4 className="analytics-note__subtitle">Why it isn&apos;t on the charts: targeting + schedule</h4>
        <p className="analytics-note__body">
          Two things set SAINT / SNT apart from the three protocols above. <strong>Targeting</strong> —
          instead of a scalp heuristic it uses individualized fMRI functional-connectivity targeting:
          the left-DLPFC site most anti-correlated with the subgenual ACC, the same connectivity
          principle the app&apos;s sgACC-connectivity preset illustrates in the scene above{' '}
          <CitationLink id="cole-snt-saint" short />. <strong>Schedule</strong> — it is accelerated:
          about ten iTBS sessions per day across five days (~90,000 pulses), versus a standard,
          once-daily course over ~six weeks. Because both the target and the dosing schedule differ,
          its rate is <strong>not</strong> a like-for-like comparison — which is exactly why it stays
          quarantined here and never enters the absolute-percentage or odds-ratio axes.
        </p>
      </div>

      {/* C5 — a qualitative, illustrative coil-orientation tolerability cue. No number, no citation
          (there is no tolerability statistic in the ledger, and none is claimed here). */}
      <div className="analytics-note__cue">
        <p className="analytics-note__cue-title">
          Orientation also shapes tolerability
          <span className="analytics-badge analytics-badge--illustrative">Illustrative · qualitative</span>
        </p>
        <p className="analytics-note__body">
          Coil orientation isn&apos;t only about where the induced field points for efficacy — it also
          affects comfort. Rotating the figure-8 coil changes how much current couples into scalp muscle
          and superficial nerves, so orientation can trade a stronger cortical field against scalp or
          facial discomfort, and can steer the field away from the most sensitive zones. This is a{' '}
          <strong>qualitative teaching cue only</strong>: the model shows relative field direction, not
          tolerability, and no discomfort rate is implied.
        </p>
      </div>
    </section>
  )
}

export function AnalyticsPanel() {
  const protocol = useStimStore((s) => s.protocol)
  const setProtocol = useStimStore((s) => s.setProtocol)

  // DEV-only hook parity with Scene.tsx (the protocol buttons are real DOM Playwright can click;
  // this is just deterministic-verification convenience). Tree-shaken from production.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __setProtocol?: (p: Protocol) => void }
    w.__setProtocol = (p) => useStimStore.getState().setProtocol(p)
    return () => {
      delete w.__setProtocol
    }
  }, [])

  return (
    <section className="analytics-panel" aria-label="Dose–response analytics" data-tour="analytics">
      <header className="analytics-panel__head">
        <div>
          <h2 className="analytics-panel__title">
            Dose–response by protocol <SyntheticBadge />
          </h2>
          <p className="analytics-panel__lede">
            Published response/remission evidence by rTMS protocol, with an explicit sham baseline
            and a synthetic patient cohort. Pick a protocol to re-key every view. Educational —
            absolute rates and odds ratios are kept on separate axes (DESIGN §4); all trajectories
            are synthetic.
          </p>
        </div>
      </header>

      <ProtocolSelector protocol={protocol} setProtocol={setProtocol} />

      <p className="analytics-defs">
        <strong>Definitions.</strong> <span className="analytics-defs__term">Response</span> ={' '}
        {trials.definitions.response}. <span className="analytics-defs__term">Remission</span> ={' '}
        {trials.definitions.remission}.
      </p>

      <div className="analytics-grid">
        <AbsoluteSection selected={protocol} />
        <OddsSection selected={protocol} />
      </div>

      <TrajectorySection selected={protocol} />

      <AcceleratedCallout />

      <p className="analytics-panel__foot">
        Every rate and odds ratio above cites its primary source; the patient cohort is{' '}
        <SyntheticBadge /> and generated from published summary statistics ({trials.generator},
        fixed seed {trials.seed}). Odds ratios are relative to sham and converted only against the
        labeled baseline — never plotted on the percentage axis.
      </p>
    </section>
  )
}
