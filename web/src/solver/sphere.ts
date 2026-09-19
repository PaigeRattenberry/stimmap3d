/**
 * Best-fit sphere + radial-component removal helpers (Milestone 2).
 *
 * In a spherically symmetric conductor the TMS-induced E-field's RADIAL component
 * is exactly zero and the field is independent of the radial conductivity profile
 * (Heller & van Hulsteyn 1992, Biophys J 63:129; Eaton 1992, Med Biol Eng Comput
 * 30:433; Sarvas 1987, Phys Med Biol 32:11). So instead of solving the scalar
 * potential φ we subtract the radial projection of the primary field −dA/dt.
 *
 * HONEST CAVEAT (verified against the primary sources): radial removal reproduces
 * the *exact* radial-nullity result, but it is only a FIRST-ORDER approximation of
 * the true tangential field. The secondary field −∇φ (the harmonic surface-charge
 * potential) cancels the radial primary part *and* perturbs the tangential part;
 * deleting only the radial component of −dA/dt leaves that tangential perturbation
 * out. This is a deliberate, real-time-friendly simplification reported in RELATIVE
 * units (DESIGN §3.1/§3.2) — never the exact spherical-conductor solution.
 *
 * All inputs are interleaved [x0,y0,z0, x1,y1,z1, …] Float32Arrays in MNI mm, the
 * frame the M1 mesh pipeline bakes geometry into (web/src/scene/useMeshGeometry.ts).
 */

/** [x, y, z] — structurally identical to the store's `Vec3` (kept local so the solver imports nothing). */
export type Vec3 = [number, number, number]

export interface Sphere {
  center: Vec3
  radius: number
}

/**
 * Per-vertex Gaussian proximity weights for the "local best-fit under the coil"
 * sphere (DESIGN §2): vertices near `ref` dominate the fit, so the spherical
 * approximation is anchored where the field is strongest and is allowed to degrade
 * away from the coil (honest about §3.2's "single sphere degrades away from coil").
 *
 * Continuous (Gaussian, not a hard cutoff) so the fitted centre moves smoothly as
 * the coil is dragged in M3 — no discontinuous jumps in the heatmap.
 *
 * Numerically stabilised by subtracting the nearest vertex's squared distance before
 * exp(): the closest vertex always gets weight 1.0, so weights never underflow to all-
 * zero even for a far coil. The Kåsa fit is invariant to a global weight scale, so this
 * shift leaves the fitted sphere unchanged while preventing a degenerate all-zero fit.
 *
 * @param sigma  Gaussian width in mm (≈ the focal scale to weight over).
 * @param out    Optional reused output buffer (length = vertex count) — honours the
 *               "allocate once" rule when the solver calls this every pose update.
 */
export function proximityWeights(
  positions: Float32Array,
  ref: Vec3,
  sigma: number,
  out?: Float32Array,
): Float32Array {
  const n = positions.length / 3
  const w = out ?? new Float32Array(n)
  const [rx, ry, rz] = ref
  const inv2s2 = 1 / (2 * sigma * sigma)
  // Pass 1: nearest squared distance (the stabilising offset).
  let minD2 = Infinity
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - rx
    const dy = positions[i * 3 + 1] - ry
    const dz = positions[i * 3 + 2] - rz
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < minD2) minD2 = d2
  }
  if (!Number.isFinite(minD2)) minD2 = 0 // n === 0
  // Pass 2: weights relative to the nearest vertex (max weight = 1, no underflow).
  for (let i = 0; i < n; i++) {
    const dx = positions[i * 3] - rx
    const dy = positions[i * 3 + 1] - ry
    const dz = positions[i * 3 + 2] - rz
    w[i] = Math.exp(-(dx * dx + dy * dy + dz * dz - minD2) * inv2s2)
  }
  return w
}

/**
 * Algebraic (Kåsa) least-squares sphere fit.
 *
 * A sphere (x−a)²+(y−b)²+(z−c)²=R² rearranges to the LINEAR model
 *   x²+y²+z² = (2a)x + (2b)y + (2c)z + (R²−a²−b²−c²),
 * so fitting [u,v,w,d] = [2a, 2b, 2c, R²−a²−b²−c²] is one weighted 4×4 normal-
 * equations solve — no iteration, robust for the near-spherical cranium. (The
 * algebraic fit slightly biases R under noise vs. a geometric fit; immaterial here,
 * where we only need the centre for the radial direction.)
 *
 * @param weights Optional per-vertex weights (length = vertex count); omit for a
 *                global fit. The only per-call allocation is the O(1) 4×4 system.
 */
export function fitSphere(positions: Float32Array, weights?: Float32Array | null): Sphere {
  const n = positions.length / 3
  // Symmetric 4×4 normal matrix M and RHS g for unknowns [u,v,w,d] (row-major M).
  const M = new Float64Array(16)
  const g = new Float64Array(4)
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    const wgt = weights ? weights[i] : 1
    if (wgt === 0) continue
    const b = x * x + y * y + z * z // RHS basis value
    // Feature row f = [x, y, z, 1]; accumulate wgt·fᵀf into M and wgt·b·f into g.
    const f0 = x
    const f1 = y
    const f2 = z
    const f3 = 1
    M[0] += wgt * f0 * f0
    M[1] += wgt * f0 * f1
    M[2] += wgt * f0 * f2
    M[3] += wgt * f0 * f3
    M[5] += wgt * f1 * f1
    M[6] += wgt * f1 * f2
    M[7] += wgt * f1 * f3
    M[10] += wgt * f2 * f2
    M[11] += wgt * f2 * f3
    M[15] += wgt * f3 * f3
    g[0] += wgt * b * f0
    g[1] += wgt * b * f1
    g[2] += wgt * b * f2
    g[3] += wgt * b * f3
  }
  // Mirror the symmetric lower triangle.
  M[4] = M[1]
  M[8] = M[2]
  M[12] = M[3]
  M[9] = M[6]
  M[13] = M[7]
  M[14] = M[11]

  // solve4x4InPlace overwrites g with the solution [u,v,w,d] (no scratch allocation).
  if (solve4x4InPlace(M, g)) {
    const a = g[0] / 2
    const b = g[1] / 2
    const c = g[2] / 2
    const r2 = g[3] + a * a + b * b + c * c
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && r2 > 0) {
      return { center: [a, b, c], radius: Math.sqrt(r2) }
    }
  }
  // Fallback for degenerate (near-coplanar / singular) inputs: weighted centroid
  // + mean radius. Keeps the solver robust rather than emitting NaNs.
  return centroidSphere(positions, weights)
}

/** Weighted centroid + mean distance — the degenerate-case fallback for {@link fitSphere}. */
function centroidSphere(positions: Float32Array, weights?: Float32Array | null): Sphere {
  const n = positions.length / 3
  let sx = 0
  let sy = 0
  let sz = 0
  let sw = 0
  for (let i = 0; i < n; i++) {
    const wgt = weights ? weights[i] : 1
    sx += wgt * positions[i * 3]
    sy += wgt * positions[i * 3 + 1]
    sz += wgt * positions[i * 3 + 2]
    sw += wgt
  }
  if (sw === 0) sw = 1
  const cx = sx / sw
  const cy = sy / sw
  const cz = sz / sw
  let sr = 0
  let cw = 0
  for (let i = 0; i < n; i++) {
    const wgt = weights ? weights[i] : 1
    const dx = positions[i * 3] - cx
    const dy = positions[i * 3 + 1] - cy
    const dz = positions[i * 3 + 2] - cz
    sr += wgt * Math.sqrt(dx * dx + dy * dy + dz * dz)
    cw += wgt
  }
  return { center: [cx, cy, cz], radius: cw > 0 ? sr / cw : 1 }
}

/**
 * Solve the 4×4 system a·x = b by Gaussian elimination with partial pivoting,
 * IN PLACE: `a` (row-major, length 16) is destroyed and the solution x is written
 * back into `b` (length 4). Returns false if the system is singular. No allocation —
 * callers pass throwaway buffers (fitSphere's freshly built M/g) so destroying them
 * is fine, keeping the local-fit hot path allocation-free.
 */
function solve4x4InPlace(a: Float64Array, b: Float64Array): boolean {
  const N = 4
  for (let col = 0; col < N; col++) {
    // Partial pivot: largest |a[row][col]| at/below the diagonal.
    let pivot = col
    let best = Math.abs(a[col * N + col])
    for (let row = col + 1; row < N; row++) {
      const v = Math.abs(a[row * N + col])
      if (v > best) {
        best = v
        pivot = row
      }
    }
    if (best < 1e-12) return false // singular
    if (pivot !== col) {
      for (let k = 0; k < N; k++) {
        const t = a[col * N + k]
        a[col * N + k] = a[pivot * N + k]
        a[pivot * N + k] = t
      }
      const tb = b[col]
      b[col] = b[pivot]
      b[pivot] = tb
    }
    // Eliminate below.
    const diag = a[col * N + col]
    for (let row = col + 1; row < N; row++) {
      const factor = a[row * N + col] / diag
      if (factor === 0) continue
      for (let k = col; k < N; k++) a[row * N + k] -= factor * a[col * N + k]
      b[row] -= factor * b[col]
    }
  }
  // Back-substitution, writing the solution into b in place: b[row] is read before
  // it is overwritten, and b[k>row] already hold their solved values.
  for (let row = N - 1; row >= 0; row--) {
    let sum = b[row]
    for (let k = row + 1; k < N; k++) sum -= a[row * N + k] * b[k]
    b[row] = sum / a[row * N + row]
  }
  return true
}

/**
 * Remove the radial component of a vector field, in place, vs. a sphere centre:
 *   E_i ← E_i − (E_i · n̂_i) n̂_i,   n̂_i = (p_i − centre)/‖p_i − centre‖.
 *
 * This is DESIGN §3.1 step 4 — the operation that enforces the spherical
 * boundary condition's exact radial-nullity (see file header for the honest
 * caveat that the tangential part is only first-order). Component arrays are
 * SoA (ex/ey/ez), mutated in place; `positions` is interleaved.
 *
 * SELF-ERROR MAP (v1.3, #13): the per-vertex magnitude this STRIPS OUT — `|E_i · n̂_i|`,
 * the length of the removed radial vector (n̂ is unit) — is the spatial signature of the
 * first-order approximation: it is ≈0 directly under a flush coil (the induced field is
 * tangent to the head there) and grows where the cortex curves away from the single best-fit
 * sphere. The orthogonal projection means it satisfies `|E_primary|² = |E_tangential|² +
 * residual²` exactly. It is free data already computed here, so the optional `outResidual`
 * buffer captures it (allocate-once, mutated in place) for the residual colour layer; pass
 * `undefined` to skip. RELATIVE units, NOT a validated error (gate (e)) — see DESIGN §3.2.
 *
 * @param outResidual Optional reused buffer (length = vertex count) filled with `|E_i · n̂_i|`.
 */
export function removeRadialComponent(
  ex: Float32Array,
  ey: Float32Array,
  ez: Float32Array,
  positions: Float32Array,
  center: Vec3,
  outResidual?: Float32Array,
): void {
  const n = ex.length
  const cx = center[0]
  const cy = center[1]
  const cz = center[2]
  for (let i = 0; i < n; i++) {
    let nx = positions[i * 3] - cx
    let ny = positions[i * 3 + 1] - cy
    let nz = positions[i * 3 + 2] - cz
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len === 0) {
      if (outResidual) outResidual[i] = 0 // vertex at the centre has no radial direction
      continue
    }
    const inv = 1 / len
    nx *= inv
    ny *= inv
    nz *= inv
    const dot = ex[i] * nx + ey[i] * ny + ez[i] * nz
    if (outResidual) outResidual[i] = Math.abs(dot) // magnitude removed = |radial component|
    ex[i] -= dot * nx
    ey[i] -= dot * ny
    ez[i] -= dot * nz
  }
}
