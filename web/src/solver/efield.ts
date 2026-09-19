/**
 * Analytical spherical-model E-field solver (Milestone 2 — the core).
 *
 * Models a figure-8 TMS coil as two opposing magnetic-dipole grids, sums their
 * vector potential A over cortical vertices, takes E = −(dI/dt)·A, removes the
 * radial component vs. a best-fit sphere (sphere.ts), and returns |E| per vertex.
 * Pure TypeScript, typed arrays, buffers allocated once. See DESIGN §3.1.
 *
 * PHYSICS (verified against primary sources — see sphere.ts header):
 *   • Dipole vector potential: A(r) = (μ₀/4π) · (m × R) / |R|³,  R = r − r′
 *     (Griffiths Eq. 5.85; cross-product order m × R and the |R|³ cube are required).
 *   • Induced field: E = −∂A/∂t = −(dI/dt)·A, so |E| is LINEAR in dI/dt
 *     (Roth & Basser 1990; quasistatic, linear tissue).
 *   • Figure-8: opposite axial moments (+m ẑ / −m ẑ) make A reinforce under the
 *     junction, so |E| peaks there, directed along the central wire segment
 *     (Thielscher & Kammer 2004). SAME-sign moments would cancel at the centre.
 *   • Radial removal (sphere.ts) enforces the spherical conductor's exact radial-
 *     nullity (Heller & van Hulsteyn 1992; Sarvas 1987) — a deliberate first-order,
 *     RELATIVE-units approximation, never the exact tangential field.
 *
 * UNITS: output is RELATIVE / arbitrary (consistent with the store's `intensity`
 * and DESIGN's "relative units" framing). μ₀/4π and the absolute dI/dt are deliberately
 * omitted, so `intensity` is the sole scalar and the honest labelled colour scale lands
 * in M3 (gate (e)). Absolute V/m is deliberately NOT claimed.
 *
 * Frame: everything is MNI-RAS mm (X=right, Y=anterior, Z=superior) — the frame
 * the M1 mesh pipeline bakes geometry into. The scene's render-only −90°-about-X
 * tilt does not touch solver inputs.
 */

import {
  fitSphere,
  proximityWeights,
  removeRadialComponent,
  type Sphere,
  type Vec3,
} from './sphere'
import { GLYPH_COUNT, GLYPH_STRIDE } from './glyphLayout'

export type { Vec3, Sphere }

/**
 * Coil pose — structurally identical to the store's `CoilPose` (web/src/store.ts)
 * so M3 can pass `store.coilPose` with no adapter; we intentionally don't import it.
 *
 * Convention: the coil's local +z axis points AWAY from the head (out of the
 * scalp). `standoff` lifts the dipole plane off `position` along that local axis.
 * World transform of a coil-local point pₗ: p = R(rotation)·(pₗ + standoff·ẑ) + position.
 */
export interface CoilPose {
  /** Coil-centre target on the scalp, MNI mm. */
  position: Vec3
  /** Euler rotation (XYZ order, radians) — matches three.js so M3's coil mesh agrees. */
  rotation: Vec3
  /** Stand-off gap from the scalp along the coil's local +z, mm. */
  standoff: number
}

/** Figure-8 dipole model in coil-LOCAL coordinates (built once, then posed per frame). */
export interface CoilModel {
  /** Interleaved dipole positions, coil-local mm. Length 3·count. */
  positions: Float32Array
  /** Interleaved dipole moment vectors, relative units (±ẑ). Length 3·count. */
  moments: Float32Array
  /** Number of dipoles K. */
  count: number
}

export interface Figure8Options {
  /** Effective current radius of each wing, mm (smaller than the physical casing). */
  wingRadius?: number
  /** Centre-to-centre distance between the two wings, mm. */
  wingSeparation?: number
  /** Concentric dipole rings per wing (grid resolution). */
  rings?: number
  /**
   * Sign relationship between the two wings. 'opposing' (default, physical figure-8)
   * → reinforce under the junction. 'same' → fields cancel at the centre; exposed only
   * so tests can assert the figure-8 sign logic (no junction peak when same-signed).
   */
  winding?: 'opposing' | 'same'
}

/**
 * Defaults approximating a standard 70 mm figure-8 (e.g. Magstim 70 mm / MagVenture
 * C-B60): effective current radius ≈ 24 mm with the two wings touching at the
 * junction (separation = 2·radius). Sized so the half-value depth lands in Deng
 * 2013's figure-8 band (0.9–3.4 cm) at a realistic coil-to-cortex standoff.
 */
const FIG8_DEFAULTS: Required<Figure8Options> = {
  wingRadius: 24,
  wingSeparation: 48,
  rings: 6,
  winding: 'opposing',
}

/** Dipoles in ring k of a wing (∝ k → uniform area density); ring 0 is the centre. */
function ringCount(k: number): number {
  return k === 0 ? 1 : Math.max(6, 6 * k)
}

/**
 * Build a rigid figure-8 dipole grid in coil-local coordinates: two co-planar
 * disks of axial (±ẑ) dipoles in the local z=0 plane, wings centred at
 * (±separation/2, 0, 0). The coil's stand-off from the scalp is applied later, per
 * pose (efield.ts solve), so the model itself carries no z-offset.
 *
 * Dipole density is ~uniform per unit area (ring k carries ∝ k dipoles, since an
 * annulus area grows ∝ r), i.e. a uniformly magnetised disk — equivalent to a
 * current loop at its rim, which is the figure-8's effective source. Each dipole
 * carries equal moment magnitude; the two wings carry opposite axial signs so the
 * field reinforces under the junction (DESIGN §3.1).
 */
export function makeFigure8Coil(options?: Figure8Options): CoilModel {
  const { wingRadius, wingSeparation, rings, winding } = { ...FIG8_DEFAULTS, ...options }
  const halfSep = wingSeparation / 2
  // Right wing sign is opposite the left for a physical figure-8 ('opposing').
  const wings: Array<{ cx: number; sign: number }> = [
    { cx: -halfSep, sign: +1 },
    { cx: +halfSep, sign: winding === 'opposing' ? -1 : +1 },
  ]
  let count = 0
  for (let k = 0; k <= rings; k++) count += ringCount(k)
  count *= wings.length

  // Single pass straight into the typed arrays (no intermediate JS arrays).
  const positions = new Float32Array(count * 3)
  const moments = new Float32Array(count * 3)
  let i = 0
  for (const { cx, sign } of wings) {
    for (let k = 0; k <= rings; k++) {
      const r = (wingRadius * k) / rings
      const nk = ringCount(k)
      for (let a = 0; a < nk; a++) {
        const theta = (2 * Math.PI * a) / nk
        positions[i * 3] = cx + r * Math.cos(theta)
        positions[i * 3 + 1] = r * Math.sin(theta)
        positions[i * 3 + 2] = 0
        moments[i * 3 + 2] = sign // moments are (0, 0, ±1); x/y already zero
        i++
      }
    }
  }
  return { positions, moments, count }
}

/** Where the radial-removal sphere comes from. */
export type SphereFit =
  /** Best-fit sphere weighted toward vertices under the coil (DESIGN §2 — default). */
  | 'local'
  /** Single global best-fit sphere over all vertices (computed once). */
  | 'global'
  /** A fixed, caller-supplied centre (used by tests with a known synthetic head). */
  | { center: Vec3 }

export interface SolverOptions {
  /** Figure-8 model to pose; defaults to {@link makeFigure8Coil}(). */
  coil?: CoilModel
  /** Radial-removal sphere strategy (default 'local'). */
  sphereFit?: SphereFit
  /** Gaussian width (mm) for the 'local' proximity weighting. */
  localSigma?: number
  /** Remove the radial component (default true); false exposes the raw primary field for tests. */
  removeRadial?: boolean
}

/**
 * Depth–dose metrics derived from the most recent {@link EFieldSolver.solve} (v1.1, #2/C1).
 *
 * All quantities are RELATIVE / ILLUSTRATIVE — they descend from the same first-order,
 * relative-units spherical approximation as the heatmap, so the mm distances are NOT
 * validated against measured dosimetry (gate (e)). They make the depth–focality tradeoff
 * (Deng 2013) tangible, nothing more.
 */
export interface FieldMetrics {
  /** Surface peak |E| (relative units) — the max over the surface vertices. */
  peak: number
  /** Index of the peak surface vertex (the focal hotspot under the coil junction). */
  peakIndex: number
  /**
   * Half-value depth d½ (mm): the inward depth, from the surface peak toward the best-fit
   * sphere centre, at which |E| falls to half the surface peak (Deng 2013's d½ definition).
   * Larger = the field reaches relatively deeper (less focal). Grows with stand-off / tilt.
   */
  hvd: number
  /**
   * On-surface half-max spread S½ (mm): the mean distance from the peak vertex to every
   * surface vertex whose |E| ≥ ½·peak — an illustrative focal-spread measure (a mean, so it
   * runs smaller than a strict outer radius). Broadens as the coil is lifted / canted (the
   * depth–focality tradeoff).
   */
  spread: number
}

export interface EFieldSolver {
  readonly vertexCount: number
  readonly dipoleCount: number
  readonly coil: CoilModel
  /** Per-vertex |E| in relative units; the SAME buffer is returned every solve. */
  readonly field: Float32Array
  /** Per-vertex E vector components (relative units), reused each solve. */
  readonly ex: Float32Array
  readonly ey: Float32Array
  readonly ez: Float32Array
  /**
   * Per-vertex radial-removal RESIDUAL `|E·n̂|` (v1.3, #13) — the magnitude the spherical
   * approximation strips out at each vertex, reused each solve. Relative units, NOT a validated
   * error (DESIGN §3.2 made spatial). Populated whenever `removeRadial` is on (the default);
   * all-zero when it is off (no removal ran). See {@link removeRadialComponent}.
   */
  readonly residual: Float32Array
  /**
   * Interleaved E-field DIRECTION-glyph buffer (v1.2, #1), reused each solve. Only the first
   * {@link EFieldSolver.computeGlyphs} return value × `GLYPH_STRIDE` entries are valid. See
   * glyphLayout.ts for the per-glyph layout.
   */
  readonly glyphs: Float32Array
  /** The sphere used by the most recent solve (radial-removal reference). */
  readonly sphere: Sphere
  /** Recompute |E| for a pose + intensity (dI/dt proxy); mutates and returns `field`. */
  solve(pose: CoilPose, intensity: number): Float32Array
  /**
   * Depth–dose metrics for the MOST RECENT {@link solve} — call immediately after `solve`
   * (it reuses that solve's posed dipoles, sphere, and `field`; an intervening `solve`
   * invalidates it). Allocation-free: only reads the reused buffers + O(1) scratch.
   */
  computeMetrics(): FieldMetrics
  /**
   * Pack a coil-local E-field DIRECTION-glyph subsample from the MOST RECENT {@link solve} (v1.2,
   * #1) — like {@link computeMetrics}, reusing that solve's `field`/`ex/ey/ez`/sphere. Selects the
   * top-N vertices by |E| WITHIN a radius of the coil centre, back-faces (away from the coil)
   * culled, and writes them into the reused `glyphs` buffer (glyphLayout.ts layout), emitted in
   * ascending vertex-index order so a deterministic solve at a fixed pose yields an identical set
   * (arrows don't jump). Returns the glyph COUNT (≤ `GLYPH_COUNT`). Allocation-free.
   */
  computeGlyphs(): number
}

const DEFAULT_LOCAL_SIGMA = 30 // mm — ≈ figure-8 focal scale

/**
 * Plummer softening (mm²) on |R|² in the 1/|R|³ kernel: bounds the singularity so a
 * vertex landing exactly on a dipole can't emit NaN/Inf into the heatmap. At (0.01 mm)²
 * it is utterly negligible at cortical distances (R ~ tens of mm); dipoles also sit a
 * stand-off above the scalp, so coincidence is already unphysical — this is belt-and-braces.
 */
const SOFTENING2 = 1e-4

/** Inward step (mm) for the half-value-depth probe; fine enough that linear interpolation
 *  between samples gives sub-step precision without measurable cost (O(steps·K) per metrics call). */
const HVD_STEP = 0.5
/** Hard cap (mm) on the inward HVD probe — a backstop; the probe normally crosses ½·peak
 *  long before reaching the sphere centre. */
const HVD_MAX_DEPTH = 120

/**
 * Radius (mm) around the coil centre within which DIRECTION glyphs are sampled (v1.2, #1). Sized to
 * cover the cortical patch under a scalp-placed coil — the scalp→cortex gap is ~12–18 mm, so a
 * patch a few cm wide needs a radius comfortably larger than that gap.
 */
const GLYPH_RADIUS_MM = 55
/** Square of {@link GLYPH_RADIUS_MM} (compared against squared distance to skip a sqrt per vertex). */
const GLYPH_RADIUS2 = GLYPH_RADIUS_MM * GLYPH_RADIUS_MM
/** Lift (mm) of each glyph off the cortical surface along the outward normal, so an arrow sits just
 *  proud of the heatmap instead of z-fighting it. */
const GLYPH_LIFT_MM = 1.5

/**
 * Create a solver bound to a fixed set of vertices (the cortical surface, MNI mm).
 * Every N- and K-sized buffer is allocated here ONCE and reused; {@link
 * EFieldSolver.solve}'s only per-call heap use is the two O(1) constant-size
 * Float64Arrays of the local Kåsa fit system (sphere.ts), so M3 can call it on
 * every coil-pose change with no meaningful GC churn (CLAUDE.md buffer rule).
 *
 * @param positions Interleaved vertex positions [x,y,z,…], MNI mm (not copied).
 */
export function createEFieldSolver(
  positions: Float32Array,
  options: SolverOptions = {},
): EFieldSolver {
  const coil = options.coil ?? makeFigure8Coil()
  const sphereFit: SphereFit = options.sphereFit ?? 'local'
  const localSigma = options.localSigma ?? DEFAULT_LOCAL_SIGMA
  const removeRadial = options.removeRadial ?? true

  const n = positions.length / 3
  const k = coil.count

  // --- buffers allocated once ---
  const ex = new Float32Array(n)
  const ey = new Float32Array(n)
  const ez = new Float32Array(n)
  const field = new Float32Array(n)
  // Per-vertex radial-removal residual |E·n̂| (v1.3, #13) — allocate-once, filled in place by
  // removeRadialComponent each solve (or zeroed when removeRadial is off).
  const residual = new Float32Array(n)
  // Posed dipoles in world (MNI) frame, SoA for a tight inner loop.
  const dpx = new Float32Array(k)
  const dpy = new Float32Array(k)
  const dpz = new Float32Array(k)
  const dmx = new Float32Array(k)
  const dmy = new Float32Array(k)
  const dmz = new Float32Array(k)
  const weights = new Float32Array(n) // reused by the 'local' sphere fit
  const rot = new Float64Array(9) // reused row-major rotation matrix (per-solve, in place)
  const sphere: Sphere = { center: [0, 0, 0], radius: 1 }

  // --- glyph buffers (v1.2, #1), allocated once and reused by computeGlyphs ---
  const glyphs = new Float32Array(GLYPH_COUNT * GLYPH_STRIDE) // interleaved direction glyphs
  const glyphCand = new Int32Array(n) // reused candidate-index scratch for the radius/top-N select
  // The coil centre of the most recent solve — computeGlyphs samples a radius around it.
  let lastCx = 0
  let lastCy = 0
  let lastCz = 0

  // The global sphere is pose-independent — fit it lazily, once.
  let globalSphere: Sphere | null = null
  // The scalar applied by the most recent solve (= −intensity); computeMetrics reuses it so the
  // off-surface probe is on the SAME relative scale as the cached per-vertex `field`.
  let lastScale = 0

  function poseDipoles(pose: CoilPose): void {
    const m = eulerXYZToMatrix(pose.rotation[0], pose.rotation[1], pose.rotation[2], rot)
    const [px, py, pz] = pose.position
    const so = pose.standoff
    const cp = coil.positions
    const cm = coil.moments
    for (let i = 0; i < k; i++) {
      // Lift local point by standoff along local +z, then rotate, then translate.
      const lx = cp[i * 3]
      const ly = cp[i * 3 + 1]
      const lz = cp[i * 3 + 2] + so
      dpx[i] = m[0] * lx + m[1] * ly + m[2] * lz + px
      dpy[i] = m[3] * lx + m[4] * ly + m[5] * lz + py
      dpz[i] = m[6] * lx + m[7] * ly + m[8] * lz + pz
      // Moments rotate (direction only, no translation).
      const mx = cm[i * 3]
      const my = cm[i * 3 + 1]
      const mz = cm[i * 3 + 2]
      dmx[i] = m[0] * mx + m[1] * my + m[2] * mz
      dmy[i] = m[3] * mx + m[4] * my + m[5] * mz
      dmz[i] = m[6] * mx + m[7] * my + m[8] * mz
    }
  }

  function chooseSphere(pose: CoilPose): Sphere {
    // Fixed caller-supplied centre (test-only path): the radius is unused for radial removal
    // (only the centre defines n̂) and nothing reads sphere.radius anywhere, so it is intentionally
    // NOT measured. Report NaN ("no measured radius") rather than a misleading 0 that reads like a
    // real zero-radius sphere, and rather than pay an O(N) pass for a value no consumer needs (#43).
    if (typeof sphereFit === 'object') return { center: sphereFit.center, radius: NaN }
    if (sphereFit === 'global') {
      if (!globalSphere) globalSphere = fitSphere(positions)
      return globalSphere
    }
    // 'local': weight vertices by proximity to the coil centre, then fit.
    proximityWeights(positions, pose.position, localSigma, weights)
    return fitSphere(positions, weights)
  }

  function solve(pose: CoilPose, intensity: number): Float32Array {
    poseDipoles(pose)
    // Remember the coil centre for computeGlyphs' radius sampling (the glyphs ride this same solve).
    lastCx = pose.position[0]
    lastCy = pose.position[1]
    lastCz = pose.position[2]
    // E = −(dI/dt)·A. μ₀/4π and absolute units are deliberately omitted (output is
    // RELATIVE units; the labelled scale lands in M3, gate (e)), so `intensity` is the
    // whole scalar. The negative sign is kept for fidelity (it cancels in |E|), and
    // linearity in `intensity` is therefore exact.
    const scale = -intensity
    lastScale = scale

    for (let i = 0; i < n; i++) {
      const rx = positions[i * 3]
      const ry = positions[i * 3 + 1]
      const rz = positions[i * 3 + 2]
      let ax = 0
      let ay = 0
      let az = 0
      for (let j = 0; j < k; j++) {
        // R = r − r′ (vertex minus dipole).
        const Rx = rx - dpx[j]
        const Ry = ry - dpy[j]
        const Rz = rz - dpz[j]
        const r2 = Rx * Rx + Ry * Ry + Rz * Rz + SOFTENING2
        const invR = 1 / Math.sqrt(r2)
        const invR3 = invR * invR * invR
        // A += (m × R) / |R|³.
        const mx = dmx[j]
        const my = dmy[j]
        const mz = dmz[j]
        ax += (my * Rz - mz * Ry) * invR3
        ay += (mz * Rx - mx * Rz) * invR3
        az += (mx * Ry - my * Rx) * invR3
      }
      ex[i] = scale * ax
      ey[i] = scale * ay
      ez[i] = scale * az
    }

    const s = chooseSphere(pose)
    sphere.center[0] = s.center[0]
    sphere.center[1] = s.center[1]
    sphere.center[2] = s.center[2]
    sphere.radius = s.radius

    // Radial removal also captures the per-vertex residual |E·n̂| it strips (v1.3, #13) — free
    // data riding this same pass. When removal is off (raw-primary test path) the residual is
    // meaningless, so zero it rather than leave a stale buffer.
    if (removeRadial) removeRadialComponent(ex, ey, ez, positions, sphere.center, residual)
    else residual.fill(0)

    for (let i = 0; i < n; i++) {
      const x = ex[i]
      const y = ey[i]
      const z = ez[i]
      field[i] = Math.sqrt(x * x + y * y + z * z)
    }
    return field
  }

  /**
   * |E| at an ARBITRARY point (not just a surface vertex), reusing the most recent solve's
   * posed dipoles + sphere + scale. This is the off-surface evaluation the half-value-depth
   * probe needs (the per-vertex `field` only covers the surface). Same `−∂A/∂t` kernel and
   * same radial-removal convention vs. `sphere.center` as the surface solve, so a probe at a
   * surface vertex reproduces that vertex's `field` value exactly. O(K), no allocation.
   */
  function fieldMagnitudeAt(px: number, py: number, pz: number): number {
    let ax = 0
    let ay = 0
    let az = 0
    for (let j = 0; j < k; j++) {
      const Rx = px - dpx[j]
      const Ry = py - dpy[j]
      const Rz = pz - dpz[j]
      const r2 = Rx * Rx + Ry * Ry + Rz * Rz + SOFTENING2
      const invR = 1 / Math.sqrt(r2)
      const invR3 = invR * invR * invR
      const mx = dmx[j]
      const my = dmy[j]
      const mz = dmz[j]
      ax += (my * Rz - mz * Ry) * invR3
      ay += (mz * Rx - mx * Rz) * invR3
      az += (mx * Ry - my * Rx) * invR3
    }
    let evx = lastScale * ax
    let evy = lastScale * ay
    let evz = lastScale * az
    if (removeRadial) {
      let nx = px - sphere.center[0]
      let ny = py - sphere.center[1]
      let nz = pz - sphere.center[2]
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (len > 0) {
        const inv = 1 / len
        nx *= inv
        ny *= inv
        nz *= inv
        const dot = evx * nx + evy * ny + evz * nz
        evx -= dot * nx
        evy -= dot * ny
        evz -= dot * nz
      }
    }
    return Math.sqrt(evx * evx + evy * evy + evz * evz)
  }

  function computeMetrics(): FieldMetrics {
    // Surface peak = the focal hotspot under the coil junction (Deng's "cortical-surface max").
    let peakIndex = 0
    for (let i = 1; i < n; i++) if (field[i] > field[peakIndex]) peakIndex = i
    const peak = field[peakIndex]
    if (!(peak > 0)) return { peak: 0, peakIndex: 0, hvd: 0, spread: 0 }
    const half = 0.5 * peak

    const px = positions[peakIndex * 3]
    const py = positions[peakIndex * 3 + 1]
    const pz = positions[peakIndex * 3 + 2]

    // --- d½: probe inward from the surface peak toward the sphere centre ---
    let dx = sphere.center[0] - px
    let dy = sphere.center[1] - py
    let dz = sphere.center[2] - pz
    const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz)
    let hvd = 0
    if (dlen > 1e-6) {
      const inv = 1 / dlen
      dx *= inv
      dy *= inv
      dz *= inv
      const maxDepth = Math.min(dlen, HVD_MAX_DEPTH)
      let prevT = 0
      let prevV = peak // the probe at depth 0 equals the surface peak by construction
      for (let t = HVD_STEP; t <= maxDepth + 1e-9; t += HVD_STEP) {
        const v = fieldMagnitudeAt(px + dx * t, py + dy * t, pz + dz * t)
        if (v <= half) {
          const denom = prevV - v
          hvd = denom > 1e-12 ? prevT + ((prevV - half) / denom) * (t - prevT) : t
          break
        }
        prevT = t
        prevV = v
        hvd = t // not yet crossed — keep the deepest probed depth as a backstop
      }
    }

    // --- S½: mean distance from the peak vertex to the supra-half-max surface region ---
    let sumD = 0
    let cnt = 0
    for (let i = 0; i < n; i++) {
      if (field[i] >= half) {
        const vx = positions[i * 3] - px
        const vy = positions[i * 3 + 1] - py
        const vz = positions[i * 3 + 2] - pz
        sumD += Math.sqrt(vx * vx + vy * vy + vz * vz)
        cnt++
      }
    }
    const spread = cnt > 0 ? sumD / cnt : 0

    return { peak, peakIndex, hvd, spread }
  }

  /**
   * Pack the E-field DIRECTION-glyph subsample (v1.2, #1) for the most recent solve — see the
   * {@link EFieldSolver.computeGlyphs} contract. Single O(N) scan to gather candidates within
   * `GLYPH_RADIUS_MM` of the coil centre on the coil-facing hemisphere, an optional partial sort to
   * the top-`GLYPH_COUNT` by |E| only when the patch is denser than the cap, then a stable
   * ascending-index emission of position(lifted)/unit-direction/|E| into `glyphs`. Allocation-free.
   */
  function computeGlyphs(): number {
    const sx = sphere.center[0]
    const sy = sphere.center[1]
    const sz = sphere.center[2]
    // Coil-outward direction (sphere centre → coil): a vertex whose outward normal points the other
    // way is a back-face (the far side of the head). Sign of the dot is all we need — no normalise.
    const odx = lastCx - sx
    const ody = lastCy - sy
    const odz = lastCz - sz

    let nc = 0
    for (let i = 0; i < n; i++) {
      const vx = positions[i * 3]
      const vy = positions[i * 3 + 1]
      const vz = positions[i * 3 + 2]
      const dx = vx - lastCx
      const dy = vy - lastCy
      const dz = vz - lastCz
      if (dx * dx + dy * dy + dz * dz > GLYPH_RADIUS2) continue // outside the coil-centre radius
      // Outward normal ≈ (vertex − sphere centre); cull back-faces (normal facing away from coil).
      const nx = vx - sx
      const ny = vy - sy
      const nz = vz - sz
      if (nx * odx + ny * ody + nz * odz <= 0) continue
      glyphCand[nc++] = i
    }

    const active = nc < GLYPH_COUNT ? nc : GLYPH_COUNT
    if (nc > GLYPH_COUNT) {
      // Denser patch than the cap → keep the strongest |E| (the focal core under the coil).
      glyphCand.subarray(0, nc).sort((a, b) => field[b] - field[a])
    }
    // Emit in ascending vertex-index order: a deterministic solve at a fixed pose then yields an
    // identical glyph set across solves (so the arrows don't jump frame-to-frame).
    glyphCand.subarray(0, active).sort()

    for (let s = 0; s < active; s++) {
      const idx = glyphCand[s]
      const vx = positions[idx * 3]
      const vy = positions[idx * 3 + 1]
      const vz = positions[idx * 3 + 2]
      // Outward unit normal — lifts the glyph just proud of the surface.
      let nx = vx - sx
      let ny = vy - sy
      let nz = vz - sz
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (nl > 0) {
        const inv = 1 / nl
        nx *= inv
        ny *= inv
        nz *= inv
      }
      // Unit tangential field direction (already radial-removed); (0,0,0) for a null-field vertex.
      let ux = ex[idx]
      let uy = ey[idx]
      let uz = ez[idx]
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz)
      if (ul > 1e-9) {
        const inv = 1 / ul
        ux *= inv
        uy *= inv
        uz *= inv
      } else {
        ux = 0
        uy = 0
        uz = 0
      }
      const o = s * GLYPH_STRIDE
      glyphs[o] = vx + GLYPH_LIFT_MM * nx
      glyphs[o + 1] = vy + GLYPH_LIFT_MM * ny
      glyphs[o + 2] = vz + GLYPH_LIFT_MM * nz
      glyphs[o + 3] = ux
      glyphs[o + 4] = uy
      glyphs[o + 5] = uz
      glyphs[o + 6] = field[idx]
    }
    return active
  }

  return {
    vertexCount: n,
    dipoleCount: k,
    coil,
    field,
    ex,
    ey,
    ez,
    residual,
    glyphs,
    sphere,
    solve,
    computeMetrics,
    computeGlyphs,
  }
}

/**
 * Euler (XYZ order, radians) → row-major 3×3 rotation matrix [r00,r01,r02, r10,…],
 * written into the provided reused buffer (no per-call allocation). Matches three.js'
 * Matrix4.makeRotationFromEuler('XYZ') so the solver's posing agrees with M3's coil
 * mesh transform exactly.
 */
function eulerXYZToMatrix(x: number, y: number, z: number, out: Float64Array): Float64Array {
  const c1 = Math.cos(x)
  const s1 = Math.sin(x)
  const c2 = Math.cos(y)
  const s2 = Math.sin(y)
  const c3 = Math.cos(z)
  const s3 = Math.sin(z)
  out[0] = c2 * c3
  out[1] = -c2 * s3
  out[2] = s2
  out[3] = c1 * s3 + c3 * s1 * s2
  out[4] = c1 * c3 - s1 * s2 * s3
  out[5] = -c2 * s1
  out[6] = s1 * s3 - c1 * c3 * s2
  out[7] = c3 * s1 + c1 * s2 * s3
  out[8] = c1 * c2
  return out
}
