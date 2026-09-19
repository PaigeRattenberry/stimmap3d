import { describe, it, expect } from 'vitest'
import {
  createEFieldSolver,
  makeFigure8Coil,
  type CoilPose,
} from './efield'
import { fitSphere, proximityWeights } from './sphere'
import { GLYPH_COUNT, GLYPH_STRIDE } from './glyphLayout'
import { composeTilt } from '../scene/coilPlacement'

/**
 * Milestone 2 acceptance tests (DESIGN.md; DESIGN §3.1 calibration).
 *
 * Driven entirely by SYNTHETIC vertex arrays at cortical scale in MNI mm (points on
 * a ~80 mm sphere near the MNI origin) — no brain.glb is loaded (that is M3). We
 * assert scale-independent SHAPE / RATIOS (peak location, depth fall-off, linear
 * scaling, radial-nullity), never absolute V/m, consistent with the relative-units
 * honesty framing (gate (e)).
 *
 * Runs in Vitest's default `node` environment (pure numeric solver — no DOM).
 */

const R_HEAD = 80 // mm — synthetic cortical-shell radius, near MNI origin
const HEAD_CENTER: [number, number, number] = [0, 0, 0]

/**
 * Vertices on a spherical cap around the +z pole (index 0 is the exact pole). The
 * coil sits over +z, so the pole is the surface point directly under the junction.
 */
function sphericalCap(
  radius: number,
  center: [number, number, number],
  alphaMaxDeg: number,
  rings: number,
  azimuth: number,
): Float32Array {
  const pts: number[] = [center[0], center[1], center[2] + radius] // pole first
  const aMax = (alphaMaxDeg * Math.PI) / 180
  for (let i = 1; i <= rings; i++) {
    const alpha = (aMax * i) / rings
    const z = radius * Math.cos(alpha)
    const rho = radius * Math.sin(alpha)
    for (let j = 0; j < azimuth; j++) {
      const beta = (2 * Math.PI * j) / azimuth
      pts.push(center[0] + rho * Math.cos(beta), center[1] + rho * Math.sin(beta), center[2] + z)
    }
  }
  return new Float32Array(pts)
}

/** A radial probe line from the cortical surface inward toward the head centre. */
function depthLine(radius: number, maxDepth: number, step: number): Float32Array {
  const pts: number[] = []
  for (let d = 0; d <= maxDepth + 1e-9; d += step) {
    pts.push(0, 0, radius - d) // along +z axis, under the junction
  }
  return new Float32Array(pts)
}

/** Fibonacci sphere — an evenly spread shell, used for the benchmark vertex budget. */
function fibonacciSphere(radius: number, count: number): Float32Array {
  const pos = new Float32Array(count * 3)
  const ga = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const z = 1 - (i / (count - 1)) * 2
    const rho = Math.sqrt(Math.max(0, 1 - z * z))
    const t = ga * i
    pos[i * 3] = radius * Math.cos(t) * rho
    pos[i * 3 + 1] = radius * Math.sin(t) * rho
    pos[i * 3 + 2] = radius * z
  }
  return pos
}

/** Coil placed flat over the +z pole (local +z = world +z = outward radial). */
function coilOverPole(standoff: number): CoilPose {
  return { position: [0, 0, R_HEAD], rotation: [0, 0, 0], standoff }
}

function dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.hypot(ax - bx, ay - by, az - bz)
}

describe('analytical E-field solver (Milestone 2)', () => {
  it('field magnitude peaks under the coil centre (figure-8 junction)', () => {
    const positions = sphericalCap(R_HEAD, HEAD_CENTER, 60, 14, 48)
    const solver = createEFieldSolver(positions, { sphereFit: { center: HEAD_CENTER } })
    const field = solver.solve(coilOverPole(6), 1)

    // Argmax vertex should be the surface point under the junction (the pole, index 0).
    let maxI = 0
    for (let i = 1; i < field.length; i++) if (field[i] > field[maxI]) maxI = i
    const px = positions[maxI * 3]
    const py = positions[maxI * 3 + 1]
    const pz = positions[maxI * 3 + 2]
    expect(dist(px, py, pz, 0, 0, R_HEAD)).toBeLessThan(5)

    // Figure-8 sign logic (verified physics): with SAME-sign wings the two wing
    // fields CANCEL at the centre, so the pole is NOT the peak. This makes the
    // "opposing → junction peak" result non-vacuous.
    const sameCoil = makeFigure8Coil({ winding: 'same' })
    const sameSolver = createEFieldSolver(positions, {
      coil: sameCoil,
      sphereFit: { center: HEAD_CENTER },
    })
    const sameField = sameSolver.solve(coilOverPole(6), 1)
    let sameMaxI = 0
    for (let i = 1; i < sameField.length; i++) if (sameField[i] > sameField[sameMaxI]) sameMaxI = i
    // Pole is a near-null for same-sign winding, and the true peak is off-centre.
    expect(sameField[0]).toBeLessThan(0.2 * sameField[sameMaxI])
    expect(dist(positions[sameMaxI * 3], positions[sameMaxI * 3 + 1], positions[sameMaxI * 3 + 2], 0, 0, R_HEAD)).toBeGreaterThan(5)
  })

  it('radial component ≈ 0 after projection onto the best-fit sphere', () => {
    // Wide cap of vertices exactly on the sphere → off-axis points carry a real
    // radial component before projection.
    const positions = sphericalCap(R_HEAD, HEAD_CENTER, 75, 18, 64)
    const pose = coilOverPole(6)

    // The default 'local' fit must recover the true centre from on-sphere points.
    const fittedAll = fitSphere(positions)
    expect(dist(fittedAll.center[0], fittedAll.center[1], fittedAll.center[2], 0, 0, 0)).toBeLessThan(1e-3)
    expect(Math.abs(fittedAll.radius - R_HEAD)).toBeLessThan(1e-2)

    const maxRadialFraction = (ex: Float32Array, ey: Float32Array, ez: Float32Array, center: [number, number, number]) => {
      let maxRad = 0
      let maxMag = 0
      for (let i = 0; i < ex.length; i++) {
        let nx = positions[i * 3] - center[0]
        let ny = positions[i * 3 + 1] - center[1]
        let nz = positions[i * 3 + 2] - center[2]
        const len = Math.hypot(nx, ny, nz) || 1
        nx /= len
        ny /= len
        nz /= len
        const rad = Math.abs(ex[i] * nx + ey[i] * ny + ez[i] * nz)
        const mag = Math.hypot(ex[i], ey[i], ez[i])
        if (rad > maxRad) maxRad = rad
        if (mag > maxMag) maxMag = mag
      }
      return maxRad / maxMag
    }

    // Without removal: a meaningful radial component exists (test is non-vacuous).
    const raw = createEFieldSolver(positions, { removeRadial: false })
    raw.solve(pose, 1)
    expect(maxRadialFraction(raw.ex, raw.ey, raw.ez, raw.sphere.center as [number, number, number])).toBeGreaterThan(0.05)

    // With removal (default, 'local' fit): radial component is driven to ≈ 0.
    const solver = createEFieldSolver(positions)
    solver.solve(pose, 1)
    expect(maxRadialFraction(solver.ex, solver.ey, solver.ez, solver.sphere.center as [number, number, number])).toBeLessThan(1e-4)
  })

  it('magnitude falls with depth (half-value depth ≈ 0.9–3.4 cm)', () => {
    // Probe radially inward from the cortical surface; coil stands off by a realistic
    // coil-winding-to-cortex distance (lumping scalp/skull/CSF).
    const step = 0.25
    const positions = depthLine(R_HEAD, 60, step)
    const solver = createEFieldSolver(positions, { sphereFit: { center: HEAD_CENTER } })
    const field = solver.solve(coilOverPole(15), 1) // ≈ scalp+skull+CSF coil-to-cortex gap

    const surface = field[0]
    expect(surface).toBeGreaterThan(0)

    // Monotonic fall-off into the head (Deng's d½ is measured from the surface max).
    for (let i = 1; i < field.length; i++) {
      expect(field[i]).toBeLessThanOrEqual(field[i - 1] + 1e-7)
    }

    // First depth where |E| drops to half the cortical-surface max.
    let halfDepth = -1
    for (let i = 0; i < field.length; i++) {
      if (field[i] <= 0.5 * surface) {
        halfDepth = i * step
        break
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[M2] half-value depth ≈ ${halfDepth.toFixed(1)} mm (Deng 2013 figure-8 band: 9–34 mm)`)
    expect(halfDepth).toBeGreaterThanOrEqual(9)
    expect(halfDepth).toBeLessThanOrEqual(34)
  })

  it('doubling dI/dt doubles |E| (linearity)', () => {
    const positions = sphericalCap(R_HEAD, HEAD_CENTER, 60, 12, 48)
    const solver = createEFieldSolver(positions)
    const pose = coilOverPole(6)

    const field1 = solver.solve(pose, 1).slice() // copy: the buffer is reused
    const field2 = solver.solve(pose, 2)

    let maxRel = 0
    for (let i = 0; i < field1.length; i++) {
      const expected = 2 * field1[i]
      const rel = Math.abs(field2[i] - expected) / (expected + 1e-12)
      if (rel > maxRel) maxRel = rel
    }
    expect(maxRel).toBeLessThan(1e-5)

    // Zero drive → zero field (and finite throughout).
    const zero = solver.solve(pose, 0)
    for (let i = 0; i < zero.length; i++) expect(zero[i]).toBe(0)
  })

  it('local sphere fit stays well-posed for a distant coil (no underflow collapse)', () => {
    // Regression guard: a far reference must not underflow every Gaussian weight to 0
    // and collapse the fitted centre to the origin. proximityWeights is max-normalised,
    // so the nearest vertex always weighs 1 and the (scale-invariant) Kåsa fit recovers
    // the true centre regardless of coil distance.
    const positions = sphericalCap(R_HEAD, HEAD_CENTER, 60, 14, 48)
    const farRef: [number, number, number] = [0, 0, 5000] // way outside any plausible head
    const weights = proximityWeights(positions, farRef, 30)
    let maxW = 0
    for (let i = 0; i < weights.length; i++) if (weights[i] > maxW) maxW = weights[i]
    expect(maxW).toBeCloseTo(1, 6) // nearest vertex normalised to 1, not all-zero

    const fitted = fitSphere(positions, weights)
    expect(dist(fitted.center[0], fitted.center[1], fitted.center[2], 0, 0, 0)).toBeLessThan(0.5)
    expect(Math.abs(fitted.radius - R_HEAD)).toBeLessThan(0.5)
  })

  it('benchmark: single solver pass over ~50k verts (documented, not asserted)', () => {
    const N = 50_000
    const positions = fibonacciSphere(R_HEAD, N)
    const solver = createEFieldSolver(positions) // default 'local' fit (production path)
    const pose = coilOverPole(6)

    // Warm up the JIT, then time the median of several passes.
    for (let w = 0; w < 3; w++) solver.solve(pose, 1)
    const samples: number[] = []
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now()
      solver.solve(pose, 1)
      samples.push(performance.now() - t0)
    }
    samples.sort((a, b) => a - b)
    const median = samples[Math.floor(samples.length / 2)]
    const best = samples[0]
    // eslint-disable-next-line no-console
    console.log(
      `[M2] benchmark ${N} verts × ${solver.dipoleCount} dipoles: ` +
        `median ${median.toFixed(2)} ms, best ${best.toFixed(2)} ms ` +
        `(16 ms frame budget → ${median < 16 ? 'main thread OK' : 'consider worker'})`,
    )

    const field = solver.solve(pose, 1)
    expect(field.length).toBe(N)
    expect(Number.isFinite(field[0])).toBe(true)
    let allFinite = true
    for (let i = 0; i < field.length; i++) if (!Number.isFinite(field[i])) allFinite = false
    expect(allFinite).toBe(true)
  })
})

/**
 * Depth–dose metrics (Milestone v1.1, #2/C1). computeMetrics() probes the SAME solve's off-surface
 * field for the half-value depth d½, measures the on-surface half-max spread S½ from the per-vertex
 * field, and reports the surface peak. We assert scale-independent SHAPE again — d½/S½ grow as the
 * coil is stood off / canted (the Deng-2013 depth–focality tradeoff), and the peak drops — never
 * absolute cm/V·m (relative-units honesty, gate (e)). Tilt is composed with the SAME `composeTilt`
 * the visual coil + solver path use, so this exercises the real shared geometry.
 */
describe('depth–dose metrics (Milestone v1.1)', () => {
  // A dense cap so the supra-half-max spread region is well sampled and the peak is captured.
  const positions = sphericalCap(R_HEAD, HEAD_CENTER, 75, 26, 72)
  const newSolver = () => createEFieldSolver(positions, { sphereFit: { center: HEAD_CENTER } })

  it('reports a finite, on-target peak with a plausible d½ and a positive S½', () => {
    const solver = newSolver()
    solver.solve(coilOverPole(6), 1)
    const m = solver.computeMetrics()

    expect(m.peak).toBeGreaterThan(0)
    expect(m.spread).toBeGreaterThan(0)
    // d½ in a broad plausible band (order-of-magnitude sanity vs Deng's 9–34 mm; the synthetic
    // shell + standoff land it near the low end). NOT pinned tightly — it is illustrative/relative.
    expect(m.hvd).toBeGreaterThan(3)
    expect(m.hvd).toBeLessThan(40)

    // The peak surface vertex is the focal hotspot under the junction (the +z pole).
    const i = m.peakIndex
    expect(dist(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], 0, 0, R_HEAD)).toBeLessThan(5)
  })

  it('d½ deepens and S½ broadens as the coil stands off (depth–focality tradeoff)', () => {
    const solver = newSolver()
    solver.solve(coilOverPole(6), 1)
    const near = solver.computeMetrics()
    solver.solve(coilOverPole(15), 1)
    const far = solver.computeMetrics()

    expect(far.hvd).toBeGreaterThan(near.hvd) // further coil → relatively deeper field
    expect(far.spread).toBeGreaterThan(near.spread) // …and a broader, less focal footprint
  })

  it('canting the coil (tilt) deepens d½, broadens S½, and lowers the surface peak', () => {
    const solver = newSolver()
    const flat = coilOverPole(6)
    solver.solve(flat, 1)
    const m0 = solver.computeMetrics()
    // Compose a 30° cant with the SAME helper the app uses (junction-pivot + effective-distance lift).
    solver.solve(composeTilt(flat, 30), 1)
    const mTilt = solver.computeMetrics()

    expect(mTilt.hvd).toBeGreaterThan(m0.hvd) // tilt = larger effective coil-to-cortex distance
    expect(mTilt.spread).toBeGreaterThan(m0.spread)
    expect(mTilt.peak).toBeLessThan(m0.peak) // …and less reaches the surface (lower relative field magnitude)
  })

  it('zero tilt is a no-op: composeTilt(pose, 0) leaves the metrics unchanged', () => {
    const solver = newSolver()
    solver.solve(coilOverPole(6), 1)
    const a = solver.computeMetrics()
    solver.solve(composeTilt(coilOverPole(6), 0), 1)
    const b = solver.computeMetrics()
    expect(b.hvd).toBeCloseTo(a.hvd, 6)
    expect(b.spread).toBeCloseTo(a.spread, 6)
    expect(b.peak).toBeCloseTo(a.peak, 6)
  })
})

/**
 * E-field DIRECTION glyphs (Milestone v1.2, #1). computeGlyphs() packs a coil-local subsample of
 * the SAME solve into the reused `glyphs` buffer (glyphLayout.ts layout). We assert the
 * relative-units / honesty-relevant shape: it is a capped SUBSAMPLE near the coil, the directions
 * are UNIT vectors tangent to the sphere (radial-removed), positions sit just proud of the surface,
 * and a deterministic solve at a fixed pose yields an identical set (so the arrows don't jump).
 * Length is never derived from |E| here — that is the renderer's constant-cone job (gate (e)).
 */
describe('E-field direction glyphs (Milestone v1.2)', () => {
  const positions = sphericalCap(R_HEAD, HEAD_CENTER, 75, 26, 72)
  const newSolver = () => createEFieldSolver(positions, { sphereFit: { center: HEAD_CENTER } })

  it('packs a capped, unit-direction, surface-tangent subsample from the last solve', () => {
    const solver = newSolver()
    solver.solve(coilOverPole(6), 1)
    const count = solver.computeGlyphs()

    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(GLYPH_COUNT)
    expect(count).toBeLessThan(positions.length / 3) // a SUBSAMPLE, not every vertex

    const g = solver.glyphs
    for (let s = 0; s < count; s++) {
      const o = s * GLYPH_STRIDE
      // Direction is a unit vector (these focal vertices all carry a non-null field).
      const dlen = Math.hypot(g[o + 3], g[o + 4], g[o + 5])
      expect(dlen).toBeGreaterThan(0.99)
      expect(dlen).toBeLessThan(1.01)
      // Position sits just OUTSIDE the cortical shell (lifted along the outward normal).
      const rad = Math.hypot(g[o], g[o + 1], g[o + 2])
      expect(rad).toBeGreaterThan(R_HEAD)
      expect(rad).toBeLessThan(R_HEAD + 4)
      // Direction is tangent to the sphere → its radial component ≈ 0 (post radial-removal).
      const radialDot = (g[o] * g[o + 3] + g[o + 1] * g[o + 4] + g[o + 2] * g[o + 5]) / rad
      expect(Math.abs(radialDot)).toBeLessThan(0.05)
      // Magnitude is the relative |E| (finite, non-negative).
      expect(g[o + 6]).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(g[o + 6])).toBe(true)
    }
  })

  it('is stable: an identical pose yields an identical glyph set across solves (no jump)', () => {
    const solver = newSolver()
    const pose = coilOverPole(6)
    solver.solve(pose, 1)
    const a = solver.computeGlyphs()
    const first = solver.glyphs.slice(0, a * GLYPH_STRIDE)

    solver.solve(pose, 1)
    const b = solver.computeGlyphs()
    const second = solver.glyphs.slice(0, b * GLYPH_STRIDE)

    expect(b).toBe(a) // same count
    for (let i = 0; i < first.length; i++) expect(second[i]).toBeCloseTo(first[i], 6)
  })

  it('samples only near the coil: a far-away coil selects a disjoint set', () => {
    const solver = newSolver()
    solver.solve(coilOverPole(6), 1) // coil over the +z pole
    const nearCount = solver.computeGlyphs()
    const nearFirst = solver.glyphs[0] // x of the first (lowest-index) selected glyph
    expect(nearCount).toBeGreaterThan(0)

    // Place the coil over the +x side of the cap: a different patch → a different first glyph.
    solver.solve({ position: [R_HEAD, 0, 0], rotation: [0, Math.PI / 2, 0], standoff: 6 }, 1)
    const farCount = solver.computeGlyphs()
    expect(farCount).toBeGreaterThan(0)
    // The selected region moved with the coil (the packed buffer is not identical to the near one).
    expect(solver.glyphs[0]).not.toBeCloseTo(nearFirst, 3)
  })
})

/**
 * Radial-removal residual / self-error map (Milestone v1.3, #13). The solver now exposes the
 * per-vertex magnitude `removeRadialComponent` STRIPS OUT — `|E·n̂|` — as a `residual` buffer (free
 * data off the same solve). We assert the relative-units / honesty-relevant SHAPE: (1) it is the
 * orthogonal complement of the tangential field, so `|E_primary|² = |E_tangential|² + residual²`
 * exactly; (2) it is ≈0 directly under the coil (the field is tangential there) and grows away from
 * it — the "where the spherical approximation is least trustworthy" story (DESIGN §3.2 made
 * spatial); and (3) it is all-zero when radial removal is disabled (nothing is stripped). Never an
 * absolute V·m claim — it is an approximation residual in relative units.
 */
describe('radial-removal residual / self-error map (Milestone v1.3)', () => {
  // A wide cap so off-axis vertices carry a real radial component before projection (non-vacuous).
  const positions = sphericalCap(R_HEAD, HEAD_CENTER, 75, 18, 64)
  const pose = coilOverPole(6)
  const N = positions.length / 3

  it('residual is the orthogonal complement of the tangential field (|E|² = |Etan|² + residual²)', () => {
    // Same FIXED sphere centre for both, so the radial direction n̂ — and thus the split — matches.
    const raw = createEFieldSolver(positions, {
      sphereFit: { center: HEAD_CENTER },
      removeRadial: false,
    })
    const tan = createEFieldSolver(positions, { sphereFit: { center: HEAD_CENTER } })
    raw.solve(pose, 1) // raw.field = |E_primary| (no removal)
    tan.solve(pose, 1) // tan.field = |E_tangential|, tan.residual = |E·n̂| (the removed magnitude)

    let maxRel = 0
    for (let i = 0; i < N; i++) {
      const primary2 = raw.field[i] * raw.field[i]
      const recon = tan.field[i] * tan.field[i] + tan.residual[i] * tan.residual[i]
      const rel = Math.abs(recon - primary2) / (primary2 + 1e-12)
      if (rel > maxRel) maxRel = rel
    }
    expect(maxRel).toBeLessThan(1e-4) // float32 round-trip; a bug would be orders of magnitude worse
  })

  it('residual ≈ 0 under the coil (the cap) and grows away from it', () => {
    const tan = createEFieldSolver(positions, { sphereFit: { center: HEAD_CENTER } })
    tan.solve(pose, 1)

    let maxResidual = 0
    for (let i = 0; i < tan.residual.length; i++) {
      if (tan.residual[i] > maxResidual) maxResidual = tan.residual[i]
    }
    // Off-axis vertices DO carry a removed radial part (otherwise the layer would be vacuous).
    expect(maxResidual).toBeGreaterThan(0)
    // Index 0 is the pole, directly under the junction: the induced field is tangential there, so
    // the removed radial magnitude is a tiny fraction of the peak residual (self-error ≈0 over cap).
    expect(tan.residual[0]).toBeLessThan(0.05 * maxResidual)
  })

  it('residual is all-zero when radial removal is disabled (nothing is stripped)', () => {
    const raw = createEFieldSolver(positions, {
      sphereFit: { center: HEAD_CENTER },
      removeRadial: false,
    })
    raw.solve(pose, 1)
    for (let i = 0; i < raw.residual.length; i++) expect(raw.residual[i]).toBe(0)
  })
})
