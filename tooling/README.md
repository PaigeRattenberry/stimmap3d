# Author-time mesh and data tooling

These scripts produce static assets locally. They are outside the npm workspace and never run during the site build or in a visitor's browser. The Node generators produced the committed GLBs and trial dataset.

## Available scripts

| Script | Output |
|---|---|
| `prep_meshes.mjs` | Meshopt-compressed brain.glb and scalp.glb |
| `prep_meshes.py` | Uncompressed reference GLBs; similar bounds, different topology |
| `generate_trials.mjs` | Byte-stable fixed-seed trials.json |
| `generate_trials.py` | Same model and cited anchors; different NumPy synthetic draws |
| `make_og_image.mjs` | Link-preview card with non-clinical disclaimer |
| `verify_meshes.mjs` / `verify_trials.py` | Read-only regeneration checks |

SimNIBS comparison and FastAPI mirror scripts are **planned**, not installed capabilities. No SimNIBS output is currently shipped.

## Reproduce safely

Use Node 24 and CPython 3.12 (tested patch: 3.12.14). Commands below run from the repository root and keep regenerated meshes in ignored scratch directories:

```powershell
npm ci --prefix tooling
node tooling/prep_meshes.mjs --out-dir .cache/node-meshes
py -3.12 -m venv tooling/.venv
tooling/.venv/Scripts/python -m pip install -r tooling/requirements.txt
tooling/.venv/Scripts/python tooling/prep_meshes.py --out-dir .cache/python-meshes
node tooling/verify_meshes.mjs .cache/node-meshes .cache/python-meshes
tooling/.venv/Scripts/python tooling/verify_trials.py
tooling/.venv/Scripts/python -m unittest discover -s tooling -p test_mesh_sources.py
```

The pinned requirements include fast-simplification, which Trimesh calls for decimation, and SciPy/networkx for component processing. Both mesh scripts accept `--cache-dir`. Omitting `--out-dir` deliberately writes the delivered model directory; use scratch output for verification. Python GLBs are directly loadable without a compression step; use Node for the committed compression format.

Both pipelines use `mesh-sources.json`: a pinned NiiVue commit, a versioned TemplateFlow S3 object, SHA-256 source hashes, and committed GLB hashes. The Node GLBs carry a fixed `asset.generator` label rather than glTF-Transform's versioned default, so a library bump that leaves the geometry unchanged also leaves those hashes unchanged. Every cached or downloaded source is checked before parsing. A mismatch fails; inspect or remove the affected cached file and retry. Source changes require an explicit provenance update. Network/source failures do not substitute a different scalp model.

A scratch output directory also receives `provenance.json` with input provenance, generator/runtime/package versions, output hashes, counts and bounds; keep that report beside regenerated assets when reviewing replacements. A default run writes the delivered `web/public/models` directory, which Vite copies verbatim into `web/dist`, so its report goes to the ignored cache (`provenance-node.json` / `provenance-python.json`) instead of into the published site; both scripts print the path they used. Meshes stay in MNI millimetres; the runtime applies the MNI-RAS to Y-up rotation. Bounds checks establish frame/scale consistency, not anatomical equivalence or clinical accuracy. See the committed mesh-verification.json baseline and [engineering decisions](../docs/engineering-decisions.md).

## Synthetic trials

`node tooling/generate_trials.mjs` writes the committed dataset using fixed seed 20260620. Python's `generate_trials.py` documents the same generative model and cited clinical constants but uses a different RNG; its draws are not byte-equivalent. `verify_trials.py` checks cited rates, odds ratios, sham baseline and cohort sizes without writing deliverables.

All patient trajectories are synthetic. Odds ratios are relative to sham and must use the explicit labeled sham baseline when converted to probabilities. Mesh/template notices and factual references live in `web/src/data/citations.json`. Planned atlas or FEM additions need their own source and terms review.
