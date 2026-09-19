import type { Preset, Vec3 } from '../store'
import type { CitationId } from './citations'
import electrodes from './electrodes.json'

export interface TargetingPreset {
  id: Preset
  /** Full label, e.g. "F3 — Beam-F3 left DLPFC". */
  label: string
  /** Compact label for the one-click button (e.g. "F3"). */
  shortLabel: string
  /** Short method explainer shown under the preset buttons. */
  description: string
  /** Coil-centre target in MNI mm (scalp electrode site, or the Fox-2012 cortical optimum). */
  target?: Vec3
  /** Matching id in citations.json — a {@link CitationId} so a typo fails the build (#30). */
  citationId?: CitationId
}

/**
 * Human-readable label for a targeting preset (falls back to the raw id on an unknown preset). The
 * single source shared by the heatmap live-region narration and the print one-pager, so both name a
 * preset identically.
 */
export function presetLabel(preset: Preset): string {
  return PRESETS.find((p) => p.id === preset)?.label ?? preset
}

/**
 * Look up an electrode's MNI-mm coordinate from electrodes.json by 10-20 name. Throws on a miss
 * (the coordinate is committed build-time data) so a typo / renamed key fails loudly at module
 * load rather than silently falling back to a fabricated, un-cited literal.
 */
export function electrode(name: string): Vec3 {
  const e = electrodes.electrodes.find((x) => x.name === name)
  if (!e) throw new Error(`presets.ts: electrode "${name}" missing from electrodes.json`)
  return [e.mni[0], e.mni[1], e.mni[2]]
}

/**
 * Fox 2012 connectivity-based DLPFC optimum — the left-DLPFC site whose resting-state signal
 * is most anticorrelated with the subgenual-ACC seed (MNI mm; Fox et al. 2012, PMID 22658708;
 * subgenual-seed peak, their Figure 3A). This is a CORTICAL (deep) point; TMSCoil projects it
 * OUT onto the scalp. Kept here (not in electrodes.json) because it is a literature coordinate,
 * not a 10-20 electrode. Verified-coordinate notes (see citations.json -> fox-2012-sgacc-target):
 * the efficacy-seed variant is (-38, 44, 26); Weigand 2018 (N=1000) refines the optimum to
 * (-42, 44, 30); and the often-quoted (-44, 40, 29) is actually Fox's a-priori "BA46-center"
 * candidate target, NOT the connectivity-derived peak — so we do not use it.
 */
export const FOX_CONNECTIVITY_TARGET: Vec3 = [-44, 38, 34]

/**
 * Fox 2012 subgenual-ACC (sgACC) SEED — the deep limbic REFERENCE region whose resting-state signal
 * defines the connectivity preset: the DLPFC target is the cortical site most ANTICORRELATED with
 * this seed. A 10 mm sphere centred at MNI (6, 16, -10) (Fox et al. 2012, PMID 22658708). It is a
 * seed / reference region — NOT a coil target and NOT a 10-20 scalp electrode — so it lives here as
 * a literature coordinate (like `FOX_CONNECTIVITY_TARGET`), never in electrodes.json. Surfaced by
 * the V2-1 `ElectrodeMarkers` layer as the deep end of a SCHEMATIC (illustrative, not a computed
 * connectome) DLPFC→sgACC cue. Provenance: citations.json → `fox-2012-sgacc-seed`.
 */
export const SGACC_SEED: Vec3 = [6, 16, -10]

/**
 * Targeting presets (Milestone 4): one-click coil placement.
 *
 * KEY DESIGN POINT (DESIGN.md): the F3 preset aims at the real **F3 electrode
 * site** (FieldTrip standard_1020 MNI scalp, ≈ -50, 53, 42) — the Beam-F3 coil position. It
 * lands ≈6 mm from the Fox connectivity optimum, because Beam-F3 was *designed* to approximate
 * that target (Mir-Moghtadaei 2015: ~0.65 cm median discrepancy). So F3 and the connectivity
 * preset are honestly CLOSE — the explainer cards say so. The genuinely different / deprecated
 * method is the 5-cm rule (~2 cm posterior); the app's big visible contrasts are the DLPFC
 * presets (F3/F4/connectivity) vs the midline references (Fz/Cz).
 *
 * Each `target` is in MNI mm; `TMSCoil` projects it onto the scalp with an outward-normal
 * pose and `setCoilPose`s it, which auto-re-solves the heatmap.
 */
export const PRESETS: TargetingPreset[] = [
  {
    id: 'F3',
    label: 'F3 — Beam-F3 left DLPFC',
    shortLabel: 'F3',
    description:
      'Left DLPFC via the Beam-F3 scalp heuristic (the 10-20 F3 electrode site). The standard HF 10 Hz target.',
    target: electrode('F3'),
    citationId: 'beam-2009-f3',
  },
  {
    id: 'F4',
    label: 'F4 — right DLPFC',
    shortLabel: 'F4',
    description:
      'Right DLPFC (the F3 mirror) — the 1 Hz low-frequency right-sided (LF-R) target.',
    target: electrode('F4'),
    citationId: 'standard-1020-electrodes',
  },
  {
    id: 'Fz',
    label: 'Fz — frontal midline',
    shortLabel: 'Fz',
    description: 'Frontal-midline 10-20 reference site (medial prefrontal).',
    target: electrode('Fz'),
    citationId: 'standard-1020-electrodes',
  },
  {
    id: 'Cz',
    label: 'Cz — vertex',
    shortLabel: 'Cz',
    description: 'The vertex (central-midline 10-20 reference) — over the leg motor area.',
    target: electrode('Cz'),
    citationId: 'standard-1020-electrodes',
  },
  {
    id: 'connectivity',
    label: 'Connectivity — sgACC-anticorrelated DLPFC',
    shortLabel: 'Conn.',
    description:
      'The DLPFC site most anticorrelated with the subgenual ACC (predicts better antidepressant response). Fox 2012 optimum.',
    target: FOX_CONNECTIVITY_TARGET,
    citationId: 'fox-2012-sgacc-target',
  },
]
