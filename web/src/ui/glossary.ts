/**
 * Glossary — a FINITE, VETTED term list for the `<Term>` tooltip layer (V2-5, improvement #22).
 *
 * Deliberately NOT an auto-scanner of app copy (the accessibility contract forbids it: auto-scan creates
 * a11y/tooltip sprawl and mis-defines context-dependent words). Every entry is hand-curated and its
 * definition matches a CITED fact already in the ledger / method cards, so the glossary opens the app
 * to the secondary student/patient audience without diluting or contradicting the expert surface.
 *
 * Keyed by a stable slug; `as const satisfies …` keeps the keys literal so `<Term id="dlpfc">` is a
 * compile-time-checked id (a typo is a build error), while still validating each entry's shape.
 */
export interface GlossaryEntry {
  /** Canonical term — the default visible label when `<Term>` has no children. */
  term: string
  /** Accessible definition: shown in the tooltip AND read to screen-readers via `aria-describedby`. */
  definition: string
}

export const GLOSSARY = {
  dlpfc: {
    term: 'DLPFC',
    definition:
      'Dorsolateral prefrontal cortex — the cortical region targeted by depression rTMS. The left DLPFC is the standard high-frequency target.',
  },
  sgacc: {
    term: 'sgACC',
    definition:
      'Subgenual anterior cingulate cortex — a deep limbic region. The connectivity preset stimulates the DLPFC site whose resting-state signal is most anticorrelated with the sgACC (Fox 2012).',
  },
  'beam-f3': {
    term: 'Beam-F3',
    definition:
      'A 10-20 EEG scalp heuristic that locates the left-DLPFC (F3) site from a few head measurements — no MRI needed (Beam 2009). It lands a median ≈0.65 cm from an MRI-neuronavigated target.',
  },
} as const satisfies Record<string, GlossaryEntry>

/** The valid `<Term id>` values — the literal keys of {@link GLOSSARY}. */
export type GlossaryId = keyof typeof GLOSSARY
