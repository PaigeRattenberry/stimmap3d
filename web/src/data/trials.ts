/**
 * Typed view of the synthetic dose–response dataset (Milestone 5).
 *
 * `trials.json` is PRE-BAKED author-time data (tooling/generate_trials.mjs, fixed seed) —
 * see DESIGN §2. This module types it and exposes the single statistical primitive the
 * panel depends on: the meta-analytic odds-ratio → probability conversion against an
 * EXPLICIT, labeled sham baseline (DESIGN §4 "synthetic-data rule").
 *
 * Honesty contract (gates (c)/(d)):
 *  • Odds ratios (Mutz 2019) are RELATIVE TO SHAM, never absolute rates — convert through a
 *    sourced sham baseline, and keep ORs and percentages on separate axes in the panel.
 *  • Every rate carries its citation id; every per-patient trajectory is synthetic and badged.
 */
import trialsData from './trials.json'
import type { Protocol } from '../store'
import type { CitationId } from './citations'

/** One weekly trajectory sample for a single synthetic patient. */
export interface TrajectoryPoint {
  /** Weeks since baseline (0 = pre-treatment). */
  week: number
  /** Montgomery–Åsberg Depression Rating Scale, synthetic. */
  madrs: number
  /** Beck Depression Inventory, synthetic. */
  bdi: number
}

/** A single synthetic patient's full trajectory + endpoint classification. */
export interface SyntheticPatient {
  id: number
  /** Endpoint ≥50% symptom reduction. */
  responder: boolean
  /** Endpoint MADRS ≤ 10. */
  remitter: boolean
  trajectory: TrajectoryPoint[]
}

/** Cohort weekly mean ± SD, derived from the full simulated cohort (not just the display subset). */
export interface WeeklySummary {
  week: number
  madrsMean: number
  madrsSd: number
  bdiMean: number
  bdiSd: number
}

/**
 * A protocol's cited acute-course rates. `source` distinguishes a directly-measured absolute
 * rate (THREE-D / Berlim) from one DERIVED from a Mutz odds ratio against the sham baseline —
 * the latter must never be presented as if it were directly measured (DESIGN §4).
 */
export interface ProtocolRates {
  /** 0–1. */
  responseRate: number
  /** 0–1. */
  remissionRate: number
  /** Provenance of the RESPONSE rate. */
  source: 'measured' | 'or-derived'
  /**
   * Provenance of the REMISSION rate, tracked separately: an OR-derived protocol's remission
   * is only an illustrative `or-proxy` (the response OR applied to the sham remission baseline,
   * since Mutz reports no LF-R remission OR) — never a directly-measured rate.
   */
  remissionSource: 'measured' | 'or-proxy'
  citationId: CitationId
  /** The trial's exact response/remission definition (scale + cutoff). */
  definition: string
}

/** Mutz 2019 response odds ratio vs sham (separate axis from any percentage). */
export interface ProtocolOdds {
  response: {
    /** Odds ratio relative to sham. */
    or: number
    ciLow: number
    ciHigh: number
    citationId: CitationId
  }
}

export interface ProtocolData {
  id: Protocol
  /** Compact label for the selector (e.g. "10 Hz HF-L"). */
  label: string
  /** Full descriptive label. */
  longLabel: string
  /** Which trial arm anchors this protocol's absolute rate. */
  arm: string
  rates: ProtocolRates
  odds: ProtocolOdds
  summary: WeeklySummary[]
  /** A small display subset of the simulated cohort (faint "spaghetti" lines). */
  patients: SyntheticPatient[]
  /** Full simulated cohort size (the summary's n). */
  cohortSize: number
}

/** The explicit, SOURCED sham baseline used for every OR→probability conversion. */
export interface ShamBaseline {
  /** 0–1. */
  responseRate: number
  /** 0–1. */
  remissionRate: number
  citationId: CitationId
  note: string
}

export interface TrialsFile {
  note: string
  synthetic: true
  generator: string
  seed: number
  definitions: { response: string; remission: string }
  shamBaseline: ShamBaseline
  protocols: ProtocolData[]
}

/**
 * Runtime shape is produced by the committed generator and exercised by trials.test.ts,
 * so this single assertion is safe and intentional (mirrors the citations.ts pattern). NOTE: this
 * cast erases source-checking, so the `CitationId` brand on the citationId fields above is enforced
 * for these JSON-sourced values at RUNTIME (trials.test.ts resolves each against the ledger), not by
 * tsc — the brand is compile-time load-bearing only for the consuming `<CitationLink>` sites, whose
 * `id` prop is `CitationId` (same JSON-cast boundary as citations.ts's own CITATION_IDS drift test).
 */
export const trials = trialsData as unknown as TrialsFile

export const protocols: ProtocolData[] = trials.protocols
export const shamBaseline: ShamBaseline = trials.shamBaseline

/** Look up a protocol's synthetic+cited bundle by its store enum. */
export function getProtocolData(id: Protocol): ProtocolData | undefined {
  return protocols.find((p) => p.id === id)
}

/**
 * Convert a meta-analytic odds ratio to an absolute probability against a sham baseline `p0`
 * (DESIGN §4):  odds = OR · p0/(1−p0);  p = odds / (1 + odds).
 *
 * Properties (locked by trials.test.ts): OR = 1 → p = p0 (identity at sham); strictly
 * increasing in OR; the result is a genuine probability in (0, 1) for any finite OR > 0 and
 * any p0 ∈ (0, 1), so no manual clamping is needed. `p0` is clamped off the {0,1} singularities
 * defensively.
 */
export function orToProbability(or: number, p0: number): number {
  const p = Math.min(Math.max(p0, 1e-6), 1 - 1e-6)
  const odds0 = p / (1 - p)
  const odds = or * odds0
  return odds / (1 + odds)
}

/** Format a 0–1 rate as a whole-number percent string (e.g. 0.47 → "47%"). */
export function asPercent(rate: number, digits = 0): string {
  return `${(rate * 100).toFixed(digits)}%`
}
