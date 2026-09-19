import citationsData from './citations.json'

/**
 * The complete set of valid citation ids — the single source of truth for the {@link CitationId}
 * union that brands every reference to the ledger (V2-6, the implementation review #30).
 *
 * WHY AN EXPLICIT LIST (not `typeof citationsData.entries[number]['id']`): `resolveJsonModule`
 * WIDENS every JSON string value to `string`, so a type derived straight from the import cannot
 * tell a real id from a typo (verified against this toolchain). Instead the ids are enumerated
 * here `as const`, and `citations.test.ts` asserts this list is EXACTLY the id set in
 * citations.json — so the two can never drift: add/rename/remove a ledger entry without matching
 * this list (or vice-versa) and the suite turns red. That test is what keeps this "derived from
 * citations.json" in practice.
 */
export const CITATION_IDS = [
  'niivue-icbm152-mesh',
  'mni-icbm152-2009-t1',
  'mne-standard-1005',
  'standard-1020-electrodes',
  'harvard-oxford-atlas',
  'brodmann-mricrogl',
  'fox-2012-sgacc-target',
  'fox-2012-sgacc-seed',
  'beam-2009-f3',
  'mir-moghtadaei-2015-beamf3',
  'weigand-2018-connectivity',
  'five-cm-rule-deprecation',
  'mutz-2019-nma',
  'three-d-blumberger-2018',
  'berlim-2014',
  'berlim-2014-sham',
  'cole-snt-saint',
  'cole-2020-saint-pilot',
  'deng-2013-depth-focality',
  'stokes-2005-output-distance',
  'bungert-2017-direction',
  'turbo-colormap-google-2019',
  'nunez-2018-cividis',
  'simnibs',
] as const

/**
 * A valid citations.json id. Narrowing {@link CitationLink}'s `id` prop — and every data field
 * that names a ledger entry (see trials.ts / presets.ts / MethodExplainers) — to this union turns
 * a typo'd citation id into a COMPILE error instead of a silently-dropped source link, hardening
 * the provenance value prop (gates (c)/(d)).
 */
export type CitationId = (typeof CITATION_IDS)[number]

/** What a citation entry refers to. */
export type CitationType = 'asset' | 'number' | 'software'

/** The set of license values currently allowed in the ledger (permissive-first; DESIGN §4). */
export const ALLOWED_LICENSES = [
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-SA-4.0',
  'CC-BY-NC',
  'GPL-3.0',
  'Open access (CC-BY-NC)',
  'ICBM152 terms (permissive, BSD-like, commercial-OK)',
  'Citable',
  'Citable (factual MNI coordinate)',
] as const

export interface Citation {
  /** Stable kebab-case key — one of the ledger's own {@link CitationId}s. */
  id: CitationId
  /** Human-readable label. */
  label: string
  /** What kind of thing this cites. */
  type: CitationType
  /** Distinguishes distributed assets, cited facts, and considered references. */
  distribution: 'redistributed' | 'cited-fact' | 'reference-only'
  /** How StimMap3D uses it. */
  use: string
  /** Origin: publication, dataset, or project name. */
  source: string
  /** Canonical URL (required field, DESIGN §4). */
  url: string
  /** License identifier or provenance note; "Citable" is not a redistribution license. */
  license: string
  /**
   * The verbatim copyright/permission notice the license requires to accompany redistributed
   * copies (e.g. BSD-2-Clause's notice + conditions + disclaimer; the ICBM152 "copyright notice
   * appear in all copies" term). Required for every ledger entry a {@link SHIPPED_ASSETS} file
   * derives from — rendered in full on #/sources, which is the "other materials provided with the
   * distribution" for the deployed site.
   */
  notice?: string
  /** Honest caveats / provenance notes. */
  notes?: string
}

/**
 * Every third-party-derived file served from `web/public` (and so redistributed by the deployed
 * site and the repo), mapped to the ledger entries it derives from. `citations.test.ts` asserts
 * each `web/public/models/*.glb` appears here and that every listed entry carries a `notice` — so
 * adding a new mesh without its license notice turns the suite red instead of shipping unattributed.
 */
export const SHIPPED_ASSETS: Record<string, readonly CitationId[]> = {
  'models/brain.glb': ['niivue-icbm152-mesh', 'mni-icbm152-2009-t1'],
  'models/scalp.glb': ['mni-icbm152-2009-t1'],
}

export interface CitationsFile {
  version: number
  /** ISO date the ledger was last reviewed (author-maintained). */
  reviewed: string
  note?: string
  entries: Citation[]
}

/**
 * Typed view of the citation ledger. The runtime shape is enforced by
 * citations.test.ts, so the single assertion here is safe and intentional.
 */
export const citations = citationsData as unknown as CitationsFile

export const citationEntries: Citation[] = citations.entries

/** Canonical display order for the ledger groups (asset → number → software). */
export const CITATION_TYPE_ORDER: CitationType[] = ['asset', 'number', 'software']

/** Look up a single citation by id. */
export function getCitation(id: string): Citation | undefined {
  return citationEntries.find((c) => c.id === id)
}

/**
 * Partition the ledger by type, in canonical order, dropping empty groups and preserving each
 * entry's original order within its group. Every entry appears exactly once — the in-app
 * provenance browser (#/sources) renders this, so completeness here == completeness on screen
 * (enforced by citations.test.ts).
 */
export function groupByType(
  entries: Citation[] = citationEntries,
): { type: CitationType; entries: Citation[] }[] {
  return CITATION_TYPE_ORDER.map((type) => ({
    type,
    entries: entries.filter((e) => e.type === type),
  })).filter((g) => g.entries.length > 0)
}
