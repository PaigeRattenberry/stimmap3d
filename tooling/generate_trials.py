"""Milestone 5 — author-time synthetic trial generator (NEVER on the live path).

CANONICAL, dependency-light Python reference for the synthetic dose-response dataset.
From published summary statistics (Mutz 2019 ORs; THREE-D and Berlim 2014 absolute
rates), it converts odds ratios to probabilities against an explicit sham baseline and
simulates per-patient MADRS/BDI trajectories by protocol, writing
``web/src/data/trials.json``.

REPRODUCIBILITY NOTE (same precedent as prep_meshes.py / prep_meshes.mjs — see
tooling/README.md): the committed
``trials.json`` is produced by the deterministic Node mirror ``generate_trials.mjs``
(fixed mulberry32 seed → byte-stable output). This file is the canonical reference
implementation of the *same generative model*; because NumPy's PRNG differs from the
mirror's mulberry32, its specific synthetic draws differ, but the model, constants, and
honesty rules are identical. Run it (with the tooling venv) to regenerate from Python.

Honesty rules (DESIGN.md §4), enforced here:
  * Every trajectory is SYNTHETIC and labeled as such (gate (d)).
  * Meta-analytic odds ratios (Mutz 2019) are RELATIVE TO SHAM — converted to absolute
    probabilities only against the explicit, sourced sham baseline below (gate (c)); a
    protocol whose absolute rate is OR-derived is tagged ``source="or-derived"``.
  * A FIXED RNG SEED makes the synthetic cohort reproducible.

See DESIGN.md. Author-time only; not on the build/runtime path.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / "web" / "src" / "data" / "trials.json"

# ───────────────────────────────────────────────────────────────────────────────────────
# CLINICAL CONSTANTS — verified against primary sources (M5 figure-verification pass,
# 2026-06-20). Each value is tagged with its citations.json id. ORs are RELATIVE TO SHAM.
# ───────────────────────────────────────────────────────────────────────────────────────

SEED = 20260620

# Explicit, SOURCED sham baseline for OR→probability conversion (DESIGN §4). Berlim 2014
# sham arms (PMID 23507264): "...(compared with 10.4% and 5% of those receiving sham rTMS)."
SHAM = {"response": 0.104, "remission": 0.05, "citationId": "berlim-2014-sham"}

PROTOCOLS = [
    {
        "id": "10hz-hf-l",
        "label": "10 Hz HF-L",
        "longLabel": "High-frequency 10 Hz rTMS, left DLPFC",
        "arm": "THREE-D 10 Hz arm (Blumberger 2018; per-protocol)",
        "rateSource": "measured",
        "response": 0.47,  # 47.4% (91/192), per-protocol among assessed
        "remission": 0.27,  # 26.6% (51/192)
        "rateCitation": "three-d-blumberger-2018",
        "definition": (
            "Response = ≥50% reduction in HRSD-17; remission = HRSD-17 < 8. THREE-D 10 Hz "
            "arm, per-protocol among assessed (denom 192/205), 4–6-week endpoint."
        ),
        "or": {"value": 3.17, "ciLow": 2.29, "ciHigh": 4.37, "citation": "mutz-2019-nma"},
    },
    {
        "id": "itbs",
        "label": "iTBS",
        "longLabel": "Intermittent theta-burst stimulation, left DLPFC",
        "arm": "THREE-D iTBS arm (Blumberger 2018; per-protocol)",
        "rateSource": "measured",
        "response": 0.49,  # 49.2% (95/193)
        "remission": 0.32,  # 31.6% (61/193)
        "rateCitation": "three-d-blumberger-2018",
        "definition": (
            "Response = ≥50% reduction in HRSD-17; remission = HRSD-17 < 8. THREE-D iTBS "
            "arm, per-protocol among assessed (denom 193/209), 4–6-week endpoint."
        ),
        "or": {"value": 3.20, "ciLow": 1.45, "ciHigh": 7.08, "citation": "mutz-2019-nma"},
    },
    {
        "id": "1hz-lf-r",
        "label": "1 Hz LF-R",
        "longLabel": "Low-frequency 1 Hz rTMS, right DLPFC",
        "arm": "Mutz 2019 LF-R odds ratio → sham baseline (OR-derived)",
        "rateSource": "or-derived",
        "rateCitation": "mutz-2019-nma",
        "definition": (
            "OR-derived (no head-to-head trial measures 1 Hz LF-R directly): the Mutz LF-R "
            "response OR vs sham applied to the labeled sham baseline. Remission applies the "
            "SAME response OR to the sham remission baseline — an illustrative proxy, since "
            "Mutz reports no LF-R remission OR. Mutz per-trial response = ≥50% reduction (HDRS preferred)."
        ),
        "or": {"value": 3.65, "ciLow": 2.13, "ciHigh": 6.24, "citation": "mutz-2019-nma"},
    },
]

COHORT = 40  # simulated patients per protocol
DISPLAY_PATIENTS = 12  # faint "spaghetti" lines persisted per protocol
WEEKS = [0, 1, 2, 3, 4, 5, 6]  # weekly samples over a 6-week acute course
BASE_MADRS = (30.0, 4.0)  # (mean, sd) typical TRD entry severity
BASE_BDI = (30.0, 7.0)


def or_to_probability(odds_ratio: float, p0: float) -> float:
    """Mutz OR → absolute probability vs sham:  odds = OR·p0/(1−p0);  p = odds/(1+odds)."""
    p0 = min(max(p0, 1e-6), 1 - 1e-6)
    odds = odds_ratio * (p0 / (1 - p0))
    return odds / (1 + odds)


def resolve_rates(p: dict) -> tuple[float, float, str, str]:
    """Returns (responseRate, remissionRate, source, remissionSource). For OR-derived
    protocols the remission is an illustrative 'or-proxy' (response OR vs sham remission
    baseline), flagged separately from the genuinely OR-converted response."""
    if p["rateSource"] == "or-derived":
        return (
            or_to_probability(p["or"]["value"], SHAM["response"]),
            or_to_probability(p["or"]["value"], SHAM["remission"]),
            "or-derived",
            "or-proxy",
        )
    return (p["response"], p["remission"], "measured", "measured")


def simulate_patient(rng: np.random.Generator, pid: int, p_resp: float, p_rem: float) -> dict:
    """One coupled MADRS+BDI trajectory; a latent recovery curve drives both scales."""
    responder = bool(rng.random() < p_resp)
    remitter = responder and bool(rng.random() < p_rem / max(p_resp, 1e-6))

    madrs_base = float(np.clip(rng.normal(*BASE_MADRS), 20, 44))
    bdi_base = float(np.clip(rng.normal(*BASE_BDI), 18, 48))

    if remitter:
        madrs_end = float(np.clip(rng.normal(7, 2), 2, 10))
    elif responder:
        madrs_end = float(np.clip(rng.normal(0.42 * madrs_base, 2), 10.5, max(11, 0.5 * madrs_base)))
    else:
        madrs_end = float(np.clip(rng.normal(0.72 * madrs_base, 3), 0.55 * madrs_base, madrs_base + 1))

    bdi_end = float(np.clip(bdi_base * (madrs_end / madrs_base) + rng.normal(0, 2), 3, bdi_base))

    k = float(np.clip(rng.normal(0.5, 0.12), 0.28, 0.85))
    denom = 1 - np.exp(-k * WEEKS[-1])

    trajectory = []
    for week in WEEKS:
        r = 0.0 if week == 0 else (1 - np.exp(-k * week)) / denom
        madrs = float(np.clip(madrs_base - r * (madrs_base - madrs_end) + (0 if week == 0 else rng.normal(0, 1.1)), 0, 50))
        bdi = float(np.clip(bdi_base - r * (bdi_base - bdi_end) + (0 if week == 0 else rng.normal(0, 1.3)), 0, 60))
        trajectory.append({"week": week, "madrs": round(madrs, 1), "bdi": round(bdi, 1)})

    return {"id": pid, "responder": responder, "remitter": remitter, "trajectory": trajectory}


def weekly_summary(patients: list[dict]) -> list[dict]:
    out = []
    for wi, week in enumerate(WEEKS):
        madrs = np.array([pt["trajectory"][wi]["madrs"] for pt in patients])
        bdi = np.array([pt["trajectory"][wi]["bdi"] for pt in patients])
        out.append(
            {
                "week": week,
                "madrsMean": round(float(madrs.mean()), 1),
                "madrsSd": round(float(madrs.std()), 1),
                "bdiMean": round(float(bdi.mean()), 1),
                "bdiSd": round(float(bdi.std()), 1),
            }
        )
    return out


def build() -> dict:
    rng = np.random.default_rng(SEED)
    protocols = []
    for p in PROTOCOLS:
        resp, rem, source, remission_source = resolve_rates(p)
        cohort = [simulate_patient(rng, i, resp, rem) for i in range(COHORT)]
        protocols.append(
            {
                "id": p["id"],
                "label": p["label"],
                "longLabel": p["longLabel"],
                "arm": p["arm"],
                "rates": {
                    "responseRate": round(resp, 3),
                    "remissionRate": round(rem, 3),
                    "source": source,
                    "remissionSource": remission_source,
                    "citationId": p["rateCitation"],
                    "definition": p["definition"],
                },
                "odds": {
                    "response": {
                        "or": p["or"]["value"],
                        "ciLow": p["or"]["ciLow"],
                        "ciHigh": p["or"]["ciHigh"],
                        "citationId": p["or"]["citation"],
                    }
                },
                "cohortSize": COHORT,
                "summary": weekly_summary(cohort),
                "patients": cohort[:DISPLAY_PATIENTS],
            }
        )

    return {
        "note": (
            "PRE-BAKED synthetic dose–response data (DESIGN §3 honesty layer). The committed "
            "file is produced by tooling/generate_trials.mjs "
            "under a FIXED seed; generate_trials.py is the canonical reference. "
            "Per-protocol response/remission rates and odds ratios are CITED to primary sources; "
            "every per-patient MADRS/BDI trajectory is SYNTHETIC. Odds ratios (Mutz 2019) are "
            "relative to sham and converted to probabilities only against the explicit, sourced "
            "sham baseline below (DESIGN §4) — never mixed with directly-measured rates."
        ),
        "synthetic": True,
        "generator": "tooling/generate_trials.mjs",
        "seed": SEED,
        "definitions": {
            "response": "≥50% reduction from baseline symptom score (per the cited trial; scale noted per protocol)",
            "remission": "MADRS ≤ 10 (the THREE-D 10 Hz/iTBS anchors use HRSD-17 < 8; both noted per protocol)",
        },
        "shamBaseline": {
            "responseRate": SHAM["response"],
            "remissionRate": SHAM["remission"],
            "citationId": SHAM["citationId"],
            "note": "Pooled sham (placebo) response/remission used as the baseline p0 for OR→probability conversion (DESIGN §4).",
        },
        "protocols": protocols,
    }


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} (seed {SEED})")
