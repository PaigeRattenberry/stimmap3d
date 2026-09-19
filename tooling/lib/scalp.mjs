/**
 * Derive a scalp/head surface from an MNI T1 volume (author-time only).
 *
 * Marching cubes at the air→skin intensity step, mapped through the NIfTI affine into
 * MNI millimetres (same RAS frame as the cortical mesh, so the scalp encloses the
 * cortex). Falls back to a smooth ellipsoidal head fitted to the cortex bounds if the
 * volume path fails — the scene must always get a scalp.
 */
// Named imports, not a default: nifti-reader-js is CJS at 0.6.x and native ESM from 0.8.0, which
// dropped the default export. Named specifiers resolve under both.
import { isCompressed, decompress, readHeader, readImage } from 'nifti-reader-js'
import isosurface from 'isosurface'

const { marchingCubes } = isosurface

function typedView(datatypeCode, img) {
  switch (datatypeCode) {
    case 2: return new Uint8Array(img) // DT_UINT8
    case 4: return new Int16Array(img) // DT_INT16
    case 8: return new Int32Array(img) // DT_INT32
    case 16: return new Float32Array(img) // DT_FLOAT32
    case 512: return new Uint16Array(img) // DT_UINT16
    default: return new Uint8Array(img)
  }
}

/** Parse a (possibly gzipped) NIfTI ArrayBuffer into a sampleable volume + affine. */
export function loadVolume(arrayBuffer) {
  let buf = arrayBuffer
  if (isCompressed(buf)) buf = decompress(buf)
  const h = readHeader(buf)
  const data = typedView(h.datatypeCode, readImage(h, buf))
  return { data, nx: h.dims[1], ny: h.dims[2], nz: h.dims[3], affine: h.affine }
}

/** Marching-cubes scalp from a volume. Returns flat {positions, indices} in MNI mm. */
export function scalpFromVolume(vol, { step = 2, thresholdFrac = 0.12 } = {}) {
  const { data, nx, ny, nz, affine: A } = vol
  let max = 0
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i]
  const thr = thresholdFrac * max

  const gx = Math.floor(nx / step)
  const gy = Math.floor(ny / step)
  const gz = Math.floor(nz / step)
  const sample = (i, j, k) => {
    const x = Math.min(i * step, nx - 1)
    const y = Math.min(j * step, ny - 1)
    const z = Math.min(k * step, nz - 1)
    return data[x + y * nx + z * nx * ny]
  }
  // Zero level-set at the skin boundary; inside (bright) is negative.
  const potential = (i, j, k) => thr - sample(i, j, k)
  const surf = marchingCubes([gx, gy, gz], potential)

  const toWorld = (i, j, k) => {
    const vi = i * step, vj = j * step, vk = k * step
    return [
      A[0][0] * vi + A[0][1] * vj + A[0][2] * vk + A[0][3],
      A[1][0] * vi + A[1][1] * vj + A[1][2] * vk + A[1][3],
      A[2][0] * vi + A[2][1] * vj + A[2][2] * vk + A[2][3],
    ]
  }
  const positions = new Float32Array(surf.positions.length * 3)
  for (let p = 0; p < surf.positions.length; p++) {
    const [x, y, z] = toWorld(surf.positions[p][0], surf.positions[p][1], surf.positions[p][2])
    positions[p * 3] = x
    positions[p * 3 + 1] = y
    positions[p * 3 + 2] = z
  }
  const indices = new Uint32Array(surf.cells.length * 3)
  for (let c = 0; c < surf.cells.length; c++) {
    indices[c * 3] = surf.cells[c][0]
    indices[c * 3 + 1] = surf.cells[c][1]
    indices[c * 3 + 2] = surf.cells[c][2]
  }
  // isosurface emits a triangle soup (coincident edge verts aren't shared), so weld
  // before connectivity analysis — otherwise every triangle looks like its own island.
  return keepLargestComponent(weldMesh({ positions, indices }))
}

/** Merge bit-coincident vertices and rewrite indices (welds an unindexed triangle soup). */
export function weldMesh({ positions, indices }, tol = 0.01) {
  const map = new Map()
  const newPos = []
  const remap = new Int32Array(positions.length / 3)
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]
    const key = `${Math.round(x / tol)}_${Math.round(y / tol)}_${Math.round(z / tol)}`
    let idx = map.get(key)
    if (idx === undefined) {
      idx = newPos.length / 3
      map.set(key, idx)
      newPos.push(x, y, z)
    }
    remap[v] = idx
  }
  const newIdx = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) newIdx[i] = remap[indices[i]]
  return { positions: new Float32Array(newPos), indices: newIdx }
}

/** Drop everything but the largest connected component (removes speckle / stray islands). */
export function keepLargestComponent({ positions, indices }) {
  const nv = positions.length / 3
  const parent = new Int32Array(nv)
  for (let i = 0; i < nv; i++) parent[i] = i
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let t = 0; t < indices.length; t += 3) {
    union(indices[t], indices[t + 1])
    union(indices[t + 1], indices[t + 2])
  }
  const size = new Map()
  let best = -1, bestN = 0
  for (let i = 0; i < nv; i++) {
    const r = find(i)
    const n = (size.get(r) || 0) + 1
    size.set(r, n)
    if (n > bestN) { bestN = n; best = r }
  }
  // Re-index the kept component.
  const remap = new Int32Array(nv).fill(-1)
  const keptPos = []
  for (let i = 0; i < nv; i++) {
    if (find(i) === best) {
      remap[i] = keptPos.length / 3
      keptPos.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    }
  }
  const keptIdx = []
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]]
    if (a >= 0 && b >= 0 && c >= 0) keptIdx.push(a, b, c)
  }
  return { positions: new Float32Array(keptPos), indices: new Uint32Array(keptIdx) }
}

/**
 * Deterministic fallback: a smooth ellipsoidal head fitted to the cortex bounds plus a
 * scalp margin. Used only if no whole-head T1 is available. Encloses the cortex; clearly
 * a simplified proxy (no facial detail).
 */
export function derivedScalpFromBrain(brainPositions, { marginMm = 10, lat = 64, lon = 96 } = {}) {
  const mn = [Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < brainPositions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = brainPositions[i + a]
      if (v < mn[a]) mn[a] = v
      if (v > mx[a]) mx[a] = v
    }
  }
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]
  // Per-axis radii: half-extent + margin, with a little extra dome on top (superior).
  const r = [
    (mx[0] - mn[0]) / 2 + marginMm,
    (mx[1] - mn[1]) / 2 + marginMm,
    (mx[2] - mn[2]) / 2 + marginMm,
  ]
  const positions = []
  for (let iLat = 0; iLat <= lat; iLat++) {
    const theta = (iLat / lat) * Math.PI // 0..PI
    const st = Math.sin(theta), ct = Math.cos(theta)
    for (let iLon = 0; iLon <= lon; iLon++) {
      const phi = (iLon / lon) * 2 * Math.PI
      positions.push(
        c[0] + r[0] * st * Math.cos(phi),
        c[1] + r[1] * st * Math.sin(phi),
        c[2] + r[2] * ct,
      )
    }
  }
  const indices = []
  const stride = lon + 1
  for (let iLat = 0; iLat < lat; iLat++) {
    for (let iLon = 0; iLon < lon; iLon++) {
      const a = iLat * stride + iLon
      const b = a + stride
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}
