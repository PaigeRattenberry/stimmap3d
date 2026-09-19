/**
 * Milestone 5 — author-time synthetic trial generator (NEVER on the live path).
 *
 * Node implementation of the model in generate_trials.py (see tooling/README.md). Produces the committed
 * deliverable:
 *
 *   web/src/data/trials.json  — per-protocol cited acute-course rates + Mutz odds ratios,
 *                               an explicit sourced sham baseline, and a SYNTHETIC cohort of
 *                               per-patient MADRS/BDI trajectories by protocol.
 *
 * Honesty rules (DESIGN §4), enforced here:
 *  • Every trajectory is SYNTHETIC and labeled as such (gate (d)).
 *  • Meta-analytic odds ratios (Mutz 2019) are RELATIVE TO SHAM — converted to absolute
 *    probabilities only against the explicit, sourced sham baseline below, never mixed with
 *    directly-measured rates (gate (c)). A protocol whose absolute rate is OR-derived is
 *    tagged `source:"or-derived"` so the panel can label it as such.
 *  • A FIXED RNG SEED makes the synthetic cohort reproducible.
 *
 * Run:  node generate_trials.mjs   (from tooling/, or `npm run generate-trials`)
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'web', 'src', 'data', 'trials.json')

// ───────────────────────────────────────────────────────────────────────────────────────
// CLINICAL CONSTANTS — verified against primary sources (M5 figure-verification pass).
// Each value is tagged with its citations.json id. ORs are RELATIVE TO SHAM (Mutz 2019).
// ───────────────────────────────────────────────────────────────────────────────────────

const SEED = 20260620

/**
 * Explicit, SOURCED sham baseline for OR→probability conversion (DESIGN §4). Verified
 * verbatim against the Berlim 2014 sham arms (PMID 23507264): "...(compared with 10.4% and
 * 5% of those receiving sham rTMS)." These pooled sham-arm proportions come from the same
 * sham-controlled RCT network, so they are an internally-matched p0. Locked 2026-06-20.
 */
const SHAM = {
  response: 0.104, // 10.4% pooled sham response (Berlim 2014, sham arms)
  remission: 0.05, // 5% pooled sham remission (printed "5%", no decimal — no false precision)
  citationId: 'berlim-2014-sham',
}

/**
 * Per-protocol inputs. `rateSource:"measured"` → absolute rate is directly observed in the
 * cited trial arm. `rateSource:"or-derived"` → absolute rate is computed from the protocol's
 * Mutz response OR against SHAM (so it is honestly labeled, never faked as measured).
 */
const PROTOCOLS = [
  {
    id: '10hz-hf-l',
    label: '10 Hz HF-L',
    longLabel: 'High-frequency 10 Hz rTMS, left DLPFC',
    arm: 'THREE-D 10 Hz arm (Blumberger 2018; per-protocol)',
    rateSource: 'measured',
    response: 0.47, // 47.4% (91/192) — THREE-D, per-protocol among assessed
    remission: 0.27, // 26.6% (51/192)
    rateCitation: 'three-d-blumberger-2018',
    definition:
      'Response = ≥50% reduction in HRSD-17; remission = HRSD-17 < 8. THREE-D 10 Hz arm, per-protocol among assessed (denom 192/205), 4–6-week endpoint.',
    or: { value: 3.17, ciLow: 2.29, ciHigh: 4.37, citation: 'mutz-2019-nma' },
  },
  {
    id: 'itbs',
    label: 'iTBS',
    longLabel: 'Intermittent theta-burst stimulation, left DLPFC',
    arm: 'THREE-D iTBS arm (Blumberger 2018; per-protocol)',
    rateSource: 'measured',
    response: 0.49, // 49.2% (95/193) — THREE-D, per-protocol among assessed
    remission: 0.32, // 31.6% (61/193)
    rateCitation: 'three-d-blumberger-2018',
    definition:
      'Response = ≥50% reduction in HRSD-17; remission = HRSD-17 < 8. THREE-D iTBS arm, per-protocol among assessed (denom 193/209), 4–6-week endpoint.',
    or: { value: 3.2, ciLow: 1.45, ciHigh: 7.08, citation: 'mutz-2019-nma' },
  },
  {
    id: '1hz-lf-r',
    label: '1 Hz LF-R',
    longLabel: 'Low-frequency 1 Hz rTMS, right DLPFC',
    arm: 'Mutz 2019 LF-R odds ratio → sham baseline (OR-derived)',
    rateSource: 'or-derived',
    rateCitation: 'mutz-2019-nma',
    definition:
      'OR-derived (no head-to-head trial measures 1 Hz LF-R directly): the Mutz LF-R response OR vs sham applied to the labeled sham baseline. Remission applies the SAME response OR to the sham remission baseline — an illustrative proxy, since Mutz reports no LF-R remission OR. Mutz per-trial response = ≥50% reduction (HDRS preferred).',
    or: { value: 3.65, ciLow: 2.13, ciHigh: 6.24, citation: 'mutz-2019-nma' },
  },
]

// Synthetic-cohort knobs.
const COHORT = 40 // patients simulated per protocol (reads as a distribution, keeps JSON lean)
const DISPLAY_PATIENTS = 12 // faint "spaghetti" lines persisted per protocol
const WEEKS = [0, 1, 2, 3, 4, 5, 6] // weekly samples over a 6-week acute course
const BASE_MADRS = { mean: 30, sd: 4 } // typical TRD entry severity
const BASE_BDI = { mean: 30, sd: 7 }

// ───────────────────────────────────────────────────────────────────────────────────────
// Deterministic RNG (mulberry32) + Box–Muller normals — so the cohort is reproducible.
// ───────────────────────────────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRng(seed) {
  const rand = mulberry32(seed)
  let spare = null
  return {
    uniform: () => rand(),
    /** Standard-normal sample (Box–Muller, cached spare). */
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const z = spare
        spare = null
        return mean + sd * z
      }
      let u = 0
      let v = 0
      while (u === 0) u = rand()
      while (v === 0) v = rand()
      const mag = Math.sqrt(-2 * Math.log(u))
      spare = mag * Math.sin(2 * Math.PI * v)
      return mean + sd * (mag * Math.cos(2 * Math.PI * v))
    },
    bernoulli: (p) => rand() < p,
  }
}

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi)
const round1 = (x) => Math.round(x * 10) / 10
const round3 = (x) => Math.round(x * 1000) / 1000

/** Mutz OR → absolute probability vs sham (mirror of trials.ts orToProbability). */
function orToProbability(or, p0) {
  const p = clamp(p0, 1e-6, 1 - 1e-6)
  const odds0 = p / (1 - p)
  const odds = or * odds0
  return odds / (1 + odds)
}

// ───────────────────────────────────────────────────────────────────────────────────────
// Simulation
// ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a protocol's absolute response/remission rate. `source` describes the RESPONSE rate
 * ('measured' | 'or-derived'); `remissionSource` describes the REMISSION rate separately, since
 * an OR-derived protocol's remission is only an illustrative 'or-proxy' (the response OR applied
 * to the sham remission baseline — Mutz reports no LF-R remission OR). The flags let the panel
 * mark provenance at the data level instead of in prose.
 */
function resolveRates(p) {
  if (p.rateSource === 'or-derived') {
    return {
      responseRate: orToProbability(p.or.value, SHAM.response),
      remissionRate: orToProbability(p.or.value, SHAM.remission),
      source: 'or-derived',
      remissionSource: 'or-proxy',
    }
  }
  return {
    responseRate: p.response,
    remissionRate: p.remission,
    source: 'measured',
    remissionSource: 'measured',
  }
}

/**
 * One patient's coupled MADRS+BDI trajectory. A single latent recovery curve r(t) ∈ [0,1]
 * (0 at baseline, 1 at endpoint) drives both scales from their own baselines, so the two
 * series move together. Endpoint severity is set by responder/remitter status.
 */
function simulatePatient(rng, id, responseRate, remissionRate) {
  const responder = rng.bernoulli(responseRate)
  // Remitters are a subset of responders: P(remit | respond) = remission/response.
  const remitter = responder && rng.bernoulli(remissionRate / Math.max(responseRate, 1e-6))

  const madrsBase = clamp(rng.normal(BASE_MADRS.mean, BASE_MADRS.sd), 20, 44)
  const bdiBase = clamp(rng.normal(BASE_BDI.mean, BASE_BDI.sd), 18, 48)

  // Endpoint MADRS by status (MADRS remission = ≤10; response = ≥50% reduction).
  let madrsEnd
  if (remitter) {
    madrsEnd = clamp(rng.normal(7, 2), 2, 10)
  } else if (responder) {
    // ≥50% reduction but not in remission → between 10 and half of baseline.
    madrsEnd = clamp(rng.normal(0.42 * madrsBase, 2), 10.5, Math.max(11, 0.5 * madrsBase))
  } else {
    // <50% reduction → endpoint above half of baseline.
    madrsEnd = clamp(rng.normal(0.72 * madrsBase, 3), 0.55 * madrsBase, madrsBase + 1)
  }
  // BDI endpoint tracks the same recovery band (synthetic, no clinical BDI cutoff claimed).
  const bdiFrac = madrsEnd / madrsBase
  const bdiEnd = clamp(bdiBase * bdiFrac + rng.normal(0, 2), 3, bdiBase)

  const k = clamp(rng.normal(0.5, 0.12), 0.28, 0.85) // per-patient recovery rate
  const denom = 1 - Math.exp(-k * WEEKS[WEEKS.length - 1])

  const trajectory = WEEKS.map((week) => {
    const r = week === 0 ? 0 : (1 - Math.exp(-k * week)) / denom
    const noise = week === 0 ? 0 : rng.normal(0, 1.1)
    const madrs = clamp(madrsBase - r * (madrsBase - madrsEnd) + noise, 0, 50)
    const bdiNoise = week === 0 ? 0 : rng.normal(0, 1.3)
    const bdi = clamp(bdiBase - r * (bdiBase - bdiEnd) + bdiNoise, 0, 60)
    return { week, madrs: round1(madrs), bdi: round1(bdi) }
  })

  return { id, responder, remitter, trajectory }
}

function weeklySummary(patients) {
  return WEEKS.map((week) => {
    const madrs = patients.map((p) => p.trajectory[week].madrs)
    const bdi = patients.map((p) => p.trajectory[week].bdi)
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = (xs, m) => Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
    const mMad = mean(madrs)
    const mBdi = mean(bdi)
    return {
      week,
      madrsMean: round1(mMad),
      madrsSd: round1(sd(madrs, mMad)),
      bdiMean: round1(mBdi),
      bdiSd: round1(sd(bdi, mBdi)),
    }
  })
}

function main() {
  const rng = makeRng(SEED)

  const protocols = PROTOCOLS.map((p) => {
    const { responseRate, remissionRate, source, remissionSource } = resolveRates(p)
    const cohort = Array.from({ length: COHORT }, (_, i) =>
      simulatePatient(rng, i, responseRate, remissionRate),
    )
    return {
      id: p.id,
      label: p.label,
      longLabel: p.longLabel,
      arm: p.arm,
      rates: {
        responseRate: round3(responseRate),
        remissionRate: round3(remissionRate),
        source,
        remissionSource,
        citationId: p.rateCitation,
        definition: p.definition,
      },
      odds: {
        response: {
          or: p.or.value,
          ciLow: p.or.ciLow,
          ciHigh: p.or.ciHigh,
          citationId: p.or.citation,
        },
      },
      cohortSize: COHORT,
      summary: weeklySummary(cohort),
      patients: cohort.slice(0, DISPLAY_PATIENTS),
    }
  })

  const out = {
    note:
      'PRE-BAKED synthetic dose–response data (DESIGN §3 honesty layer). Generated author-time by tooling/generate_trials.mjs (Node generator) under a FIXED seed. Per-protocol response/remission rates and odds ratios are CITED to primary sources; every per-patient MADRS/BDI trajectory is SYNTHETIC. Odds ratios (Mutz 2019) are relative to sham and are converted to probabilities only against the explicit, sourced sham baseline below (DESIGN §4) — never mixed with directly-measured rates.',
    synthetic: true,
    generator: 'tooling/generate_trials.mjs',
    seed: SEED,
    definitions: {
      response: '≥50% reduction from baseline symptom score (per the cited trial; scale noted per protocol)',
      remission: 'MADRS ≤ 10 (the THREE-D 10 Hz/iTBS anchors use HRSD-17 < 8; both noted per protocol)',
    },
    shamBaseline: {
      responseRate: SHAM.response,
      remissionRate: SHAM.remission,
      citationId: SHAM.citationId,
      note: 'Pooled sham (placebo) response/remission used as the baseline p0 for OR→probability conversion (DESIGN §4).',
    },
    protocols,
  }

  return out
}

const json = JSON.stringify(main(), null, 2)
await writeFile(OUT, json + '\n', 'utf8')
console.log(`wrote ${OUT}\n  ${json.length} bytes, seed ${SEED}`)
