# StimMap3D architecture

Author: Paige Rattenberry. Educational rTMS targeting and electric-field visualization.

## 1. Product boundaries

The app explains coil placement and published protocol comparisons. It is not a medical device, diagnostic tool, treatment planner, or patient-specific simulation. No backend or patient records are required. A persistent disclaimer appears on every route and exported figure. All individual trajectories are synthetic; all field values use relative units.

Tests and source comments refer to these commitments as honesty gates:

- **(a)** The non-clinical disclaimer is visible on every route and carried into exported and printed figures.
- **(b)** The Methods & Limitations page is reachable and quotes the method statement and limitations in §3.2.
- **(c)** Odds ratios are never plotted or mixed with absolute response rates; they become probabilities only against an explicit, labeled sham baseline (§4).
- **(d)** All synthetic data is badged as synthetic, and every figure resolves to a citation-ledger entry.
- **(e)** The E-field is shown only in clearly labeled relative units, never V/m or a calibrated dose.

## 2. Browser architecture

Vite builds a static React/TypeScript application. Hash routes load the visualizer, Methods and Sources independently. React Three Fiber renders meshopt-compressed cortical and scalp meshes. Zustand owns coil pose, intensity, protocol and display settings. A worker computes field samples; the coalescer bounds work to one active solve and the newest pending request. Stale or failed results cannot establish export readiness. Typed arrays and reusable color buffers avoid allocating geometry on each update.

The rendering channels update field colors and metrics without requiring a React render for each sample. Continuous field colors use a robust peak; contours use the absolute field maximum. Fixed-scale mode uses a separate intensity-1 reference solve. Viridis is the default; Turbo and grayscale are explicit alternatives. Mesh coordinates are MNI millimetres, rotated to Y-up for display.

PNG export requires the current geometry, worker result and painted frame to agree. Loading and failure invalidate output; a previously valid canvas alone is insufficient. Shared URLs encode configuration, with pose rounded to three decimals, but do not encode camera orbit or zoom. Custom placements are illustrative, not guaranteed scalp contact.

## 3. Model and limitations

### 3.1 Computation

A rigid figure-8 dipole array supplies the vector potential at cortical vertices. The solver scales the primary field by relative intensity, removes its radial component against a best-fit sphere, then maps the tangential magnitude to color. This is a first-order tangential approximation, not the exact secondary-field solution. The true secondary field also reshapes the tangential component, which this solver does not compute. The radial-removal residual is an approximation residual, not validated error.

### 3.2 Required method statement

E-field = tangential projection of −dA/dt from a magnetic-dipole figure-8 model in a single best-fit spherical conductor (Heller & van Hulsteyn 1992; Eaton 1992; Sarvas 1987). The radial component is zero by the spherical boundary condition and the field is independent of the conductivity profile — which is exactly why it runs in real time and is not anatomically accurate. For anatomically faithful fields, use FEM (e.g., SimNIBS).

It **ignores gyral/sulcal folding** (evaluates on a smooth surface; real hotspots can be centimeters off), **tissue heterogeneity** (scalp/skull/CSF/gray/white), **CSF current shunting**, and **white-matter anisotropy**; uses an **idealized dipole coil** (~4–10% field error vs. real spiral windings, per PLOS ONE 2017); shows **induced E-field magnitude, not neural activation** (which depends on field direction relative to axons and on thresholds); the **single best-fit sphere** degrades away from the coil and in non-spherical regions (frontal/temporal poles); and it applies a **first-order tangential approximation** — removing the radial component of −∂A/∂t cancels the radial field, but the exact secondary −∇φ also perturbs the *tangential* part, which this model never solves, so even within the sphere the field is approximate (Eaton 1992). This removed quantity — the per-vertex magnitude of the radial component stripped out, `|E·n̂|` — can be surfaced as an optional **self-error map** that recolours the cortex through the *same* relative-units scale (it is ≈0 directly under the coil, where the induced field is tangential, and grows where the single best-fit sphere degrades away from the coil toward the frontal/temporal poles); it is an **approximation residual, not a validated error**. The **depth–dose readouts** derived from this field — half-value depth (d½) and on-surface focal spread (S½) — are likewise **surface-derived, relative-units illustrations, not validated depths or machine-output percentages**: d½ and S½ come from this same first-order analytical field, coil **tilt** is modeled as an *increase in effective coil-to-cortex distance* (an authored 0.32 mm/degree lift heuristic, not derived from Deng or Stokes) rather than a re-derivation of the canted-coil field, and none of it is calibrated to cm or V·m.

No FEM comparison or clinical validation is shipped.

## 4. Evidence and reproducibility

The citation ledger records source URLs, license terms, attribution and statistical definitions. Beam-F3 and connectivity targeting are attributed to their primary publications. Preserve citation IDs and required notices. The build emits THIRD_PARTY_NOTICES.txt from delivered assets and installed dependencies.

Odds ratios remain relative to sham. Conversion uses an explicit labeled baseline: p = OR*p0 / (1-p0+OR*p0). Converted estimates and directly observed rates remain separate. THREE-D rates use assessed per-protocol denominators; accelerated-study categorical outcomes remain separate from standard-protocol comparisons. Synthetic cohort trajectories illustrate summary statistics and are never real participant observations.

Author-time Node and Python tools consume hash-verified public mesh sources. Node produces the delivered compressed assets; Python provides a reference pipeline with different topology. Bounds checks establish frame and scale consistency, not anatomical equivalence. Keep generation reports outside web/public. Fixed-seed trial data stays committed; prose changes do not require resampling it.

See [engineering decisions](docs/engineering-decisions.md), [AI-assisted development](docs/agentic-development.md), [tooling](tooling/README.md) and [release checks](docs/release-controls.md).
