r"""Milestone 1 — author-time mesh prep (NEVER on the live path).

Python reference pipeline for the two delivered mesh shapes:

    web/public/models/brain.glb  — NiiVue MNI152-2009 whole-cortex surface (MZ3),
                                   decimated to ~40k verts.
    web/public/models/scalp.glb  — scalp/head surface, marching-cubes from the
                                   whole-head ICBM152 2009c T1 (TemplateFlow), in the
                                   same MNI/RAS frame so it encloses the cortex.

Coordinates stay in MNI millimetres (the M2 solver and the scene's RAS->Y-up rotation
depend on that). See DESIGN.md §2 and §4.
Record source + license for every asset in web/src/data/citations.json.

NOTE — Node mirror: this repo also ships `prep_meshes.mjs`, using the same sources
and targets with different marching-cubes and decimation implementations. The Node pipeline generates the
committed GLBs (it uses @gltf-transform + meshoptimizer for decimation and the
EXT_meshopt_compression that three.js decodes with no CDN). This Python script is the
reference with a pinned environment. The algorithms produce similar bounds, not identical
topology or bytes. Its GLBs are uncompressed and load directly in the app. Prefer the Node
pipeline for reproducing the committed meshopt-compressed deliverables.

Run (PowerShell):
    cd tooling
    py -m venv .venv ; .\.venv\Scripts\Activate.ps1
    pip install -r requirements.txt
    python prep_meshes.py --out-dir .cache/python-meshes
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import gzip
import struct
import urllib.request
from pathlib import Path

import numpy as np
import trimesh

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = HERE.parent / "web" / "public" / "models"

SOURCES = json.loads((HERE / "mesh-sources.json").read_text(encoding="utf-8"))["sources"]

BRAIN_TARGET_VERTS = 40_000
SCALP_TARGET_VERTS = 18_000
SCALP_THRESHOLD_FRAC = 0.16  # air->skin step (fraction of max T1 intensity)


def cached(source: dict) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / source["filename"]
    raw = path.read_bytes() if path.exists() else urllib.request.urlopen(source["url"], timeout=120).read()
    if hashlib.sha256(raw).hexdigest() != source["sha256"]:
        raise ValueError(f"Source checksum mismatch: {path}; inspect/remove the cache before retrying")
    if not path.exists():
        path.write_bytes(raw)
    return path


def read_mz3(path: Path) -> trimesh.Trimesh:
    """Minimal reader for the NiiVue MZ3 surface format (see lib/mz3.mjs for the spec)."""
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":  # gzip
        raw = gzip.decompress(raw)
    magic, attr, nface, nvert, nskip = struct.unpack_from("<HHIII", raw, 0)
    if magic != 23117:
        raise ValueError(f"not an MZ3 file (magic={magic})")
    if not (attr & 1) or not (attr & 2):
        raise ValueError(f"MZ3 missing FACE/VERT data (attr={attr})")
    off = 16 + nskip
    faces = np.frombuffer(raw, dtype="<i4", count=nface * 3, offset=off).reshape(-1, 3)
    off += nface * 3 * 4
    verts = np.frombuffer(raw, dtype="<f4", count=nvert * 3, offset=off).reshape(-1, 3)
    return trimesh.Trimesh(vertices=verts.astype(np.float64), faces=faces, process=False)


def scalp_from_t1(path: Path, threshold_frac: float) -> trimesh.Trimesh:
    """Marching-cubes scalp from a whole-head T1, mapped through the NIfTI affine to MNI mm."""
    import nibabel as nib
    from skimage import measure

    img = nib.load(str(path))
    vol = np.asarray(img.dataobj, dtype=np.float32)
    thr = threshold_frac * float(vol.max())
    verts, faces, _normals, _values = measure.marching_cubes(vol, level=thr, step_size=2)
    # voxel indices -> world (MNI mm) via the affine
    verts_h = np.c_[verts, np.ones(len(verts))]
    verts_mm = (img.affine @ verts_h.T).T[:, :3]
    mesh = trimesh.Trimesh(vertices=verts_mm, faces=faces, process=True)
    # keep the largest connected component (drops speckle / stray islands)
    parts = mesh.split(only_watertight=False)
    if len(parts):
        mesh = max(parts, key=lambda m: len(m.vertices))
    return mesh


def decimate(mesh: trimesh.Trimesh, target_verts: int) -> trimesh.Trimesh:
    target_faces = max(4, int(target_verts * 2))  # ~2 faces per vertex
    if len(mesh.faces) > target_faces:
        mesh = mesh.simplify_quadric_decimation(face_count=target_faces)
    mesh.remove_unreferenced_vertices()
    return mesh


def main() -> None:
    global OUT, CACHE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=OUT)
    parser.add_argument("--cache-dir", type=Path, default=CACHE)
    args = parser.parse_args()
    OUT, CACHE = args.out_dir.resolve(), args.cache_dir.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    # Scratch runs keep the report beside their outputs. Writing the DELIVERED model directory (the
    # default) is different: Vite copies it verbatim into web/dist, so the report goes to the ignored
    # cache instead of into the published site next to the GLBs.
    delivered = (HERE.parent / "web" / "public" / "models").resolve()
    provenance = CACHE / "provenance-python.json" if OUT == delivered else OUT / "provenance.json"
    provenance.parent.mkdir(parents=True, exist_ok=True)

    print("- brain.glb  (NiiVue MNI152-2009 whole cortex)")
    brain = decimate(read_mz3(cached(SOURCES["cortex"])), BRAIN_TARGET_VERTS)
    brain.export(OUT / "brain.glb")
    print(f"  brain.glb: {len(brain.vertices)} verts, bounds(mm) {brain.bounds.round(0).tolist()}")

    print("- scalp.glb  (whole-head ICBM152 2009c T1 -> marching cubes)")
    scalp = scalp_from_t1(cached(SOURCES["head"]), SCALP_THRESHOLD_FRAC)
    scalp = decimate(scalp, SCALP_TARGET_VERTS)
    scalp.export(OUT / "scalp.glb")
    print(f"  scalp.glb: {len(scalp.vertices)} verts, bounds(mm) {scalp.bounds.round(0).tolist()}")

    report = {
        "generator": "prep_meshes.py", "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "python": platform.python_version(),
        "packages": {p: importlib.metadata.version(p) for p in ["numpy", "trimesh", "fast-simplification", "nibabel", "scikit-image", "scipy", "networkx"]},
        "sources": SOURCES,
        "outputs": {name: {"sha256": hashlib.sha256((OUT / name).read_bytes()).hexdigest(),
                            "vertices": len(mesh.vertices), "faces": len(mesh.faces),
                            "boundsMm": mesh.bounds.tolist()} for name, mesh in [("brain.glb", brain), ("scalp.glb", scalp)]},
    }
    provenance.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"done. Uncompressed GLBs in {OUT}; provenance report: {provenance}")


if __name__ == "__main__":
    main()
