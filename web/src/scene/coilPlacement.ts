/**
 * Pure coil-placement geometry (Milestone 4) — extracted from `TMSCoil` so the preset → scalp
 * projection can be unit-tested without a WebGL / R3F render. No React and no per-call THREE
 * allocation: the quaternion/euler/vector scratch is module-level and reused (the app is
 * single-threaded and these calls never interleave, so reuse is safe — the same allocate-once
 * discipline the component used, just hoisted so the drag path keeps it too).
 */
import { Euler, Quaternion, Vector3 } from 'three'
import type { CoilPose, Preset, Vec3 } from '../store'
import { PRESETS } from '../data/presets'

/** Coil-local +z; a pose rotates this onto the outward scalp normal. */
const Z_AXIS = new Vector3(0, 0, 1)
/** Coil-local +x; the wing-separation axis — the in-plane axis the tilt cant pivots about. */
const X_AXIS = new Vector3(1, 0, 0)
// Module-level scratch — reused across calls, never aliased past a single call's return.
const scratchN = new Vector3()
const scratchQ = new Quaternion()
const scratchE = new Euler()
// Dedicated tilt scratch (composeTilt needs several live at once — q0, the cant qt, the
// composed q', and the two normals n̂/n̂').
const tiltQ0 = new Quaternion()
const tiltQt = new Quaternion()
const tiltQp = new Quaternion()
const tiltN = new Vector3()
const tiltNt = new Vector3()
const tiltE = new Euler()

/**
 * Neutral left-DLPFC anchor (MNI mm) — the Mir-Moghtadaei 2015 MRI-neuronavigated target
 * (which coincides with Fox 2012's efficacy-seed optimum). Used ONLY as a fallback aim if a
 * preset has no `target` (it should not, post-M4) or `PRESETS` is empty. The real preset targets
 * live in presets.ts / electrodes.json.
 */
export const FALLBACK_TARGET: Vec3 = [-38, 44, 26]

/** The active preset's coil-centre target (MNI mm), or the neutral fallback anchor. */
export function presetTarget(preset: Preset): Vec3 {
  return PRESETS.find((p) => p.id === preset)?.target ?? FALLBACK_TARGET
}

/**
 * Project an MNI target onto the scalp: pick the scalp vertex whose direction FROM the head
 * centroid is most aligned with the target's direction from that centroid. This is a radial
 * scan, NOT a raycast — a ray through a closed scalp is ambiguous between the near/far crossings.
 * A DEEP / cortical target (e.g. the Fox-2012 connectivity optimum, which sits inside the head)
 * therefore projects OUT onto the scalp instead of sinking the coil into the brain.
 *
 * `positions` is a flat, non-interleaved [x0,y0,z0, x1,y1,z1, …] buffer (the same layout the
 * solver consumes); `count` defaults to its vertex count. Returns the chosen vertex (MNI mm), or
 * null if there are no vertices.
 */
export function bestScalpVertexForTarget(
  target: Vec3,
  headCenter: Vec3,
  positions: ArrayLike<number>,
  count = Math.floor(positions.length / 3),
): Vec3 | null {
  if (count <= 0) return null

  // Unit direction (MNI) from the head centroid toward the target.
  let ux = target[0] - headCenter[0]
  let uy = target[1] - headCenter[1]
  let uz = target[2] - headCenter[2]
  const ul = Math.hypot(ux, uy, uz) || 1
  ux /= ul
  uy /= ul
  uz /= ul

  let best = -Infinity
  let bx = 0
  let by = 0
  let bz = 0
  for (let i = 0; i < count; i++) {
    const vx = positions[i * 3]
    const vy = positions[i * 3 + 1]
    const vz = positions[i * 3 + 2]
    const rx = vx - headCenter[0]
    const ry = vy - headCenter[1]
    const rz = vz - headCenter[2]
    const rl = Math.hypot(rx, ry, rz) || 1
    const dot = (rx * ux + ry * uy + rz * uz) / rl
    if (dot > best) {
      best = dot
      bx = vx
      by = vy
      bz = vz
    }
  }
  return [bx, by, bz]
}

/** A computed inter-target comparison: both scalp coil-centre points (MNI mm) + their gap (mm). */
export interface ScalpTargetGap {
  a: Vec3
  b: Vec3
  /** Straight-line (Euclidean) distance between `a` and `b`, in millimetres. */
  mm: number
}

/**
 * Straight-line (Euclidean) distance, in MNI millimetres, between where two presets' coil
 * CENTRES land on the scalp — each target projected onto the scalp via
 * {@link bestScalpVertexForTarget}. This DERIVES the F3-vs-connectivity targeting-debate gap
 * live from the same preset coordinates + scalp geometry the coil itself uses, instead of
 * asserting a hard-coded "~6 mm" (M6-4 / improvement #5).
 *
 * HONESTY: this is a straight-line chord THROUGH SPACE between the two on-scalp coil centres —
 * not a geodesic along the scalp, and a different quantity from the cited ≈0.65 cm cortical
 * Beam-F3-vs-MRI-neuronavigated median discrepancy (Mir-Moghtadaei 2015). Returns null if
 * either projection fails (no scalp vertices).
 */
export function interTargetScalpDistanceMm(
  presetA: Preset,
  presetB: Preset,
  headCenter: Vec3,
  positions: ArrayLike<number>,
  count = Math.floor(positions.length / 3),
): ScalpTargetGap | null {
  const a = bestScalpVertexForTarget(presetTarget(presetA), headCenter, positions, count)
  const b = bestScalpVertexForTarget(presetTarget(presetB), headCenter, positions, count)
  if (!a || !b) return null
  return { a, b, mm: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }
}

/**
 * MNI scalp point + outward normal → an MNI coil pose: local +z is aligned to the normal,
 * flipped to point AWAY from the head interior so the coil always faces outward.
 */
export function poseFromMNI(
  point: Vec3,
  normal: Vec3,
  headCenter: Vec3,
): Pick<CoilPose, 'position' | 'rotation'> {
  const n = scratchN.set(normal[0], normal[1], normal[2]).normalize()
  const outX = point[0] - headCenter[0]
  const outY = point[1] - headCenter[1]
  const outZ = point[2] - headCenter[2]
  if (n.x * outX + n.y * outY + n.z * outZ < 0) n.multiplyScalar(-1)
  scratchQ.setFromUnitVectors(Z_AXIS, n)
  scratchE.setFromQuaternion(scratchQ, 'XYZ')
  return { position: [point[0], point[1], point[2]], rotation: [scratchE.x, scratchE.y, scratchE.z] }
}

/** mm of extra effective coil-to-cortex distance per degree of cant (illustrative). */
const TILT_LIFT_MM_PER_DEG = 0.32

/**
 * Authored tilt heuristic: 0.32 mm lift per degree, shared by rendering and solving.
 * Not derived from Stokes or Deng; not a calibrated distance or output model.
 */
export function tiltLiftMm(tiltDeg: number): number {
  return TILT_LIFT_MM_PER_DEG * Math.max(0, tiltDeg)
}

/**
 * Compose a dedicated `tilt` cant (degrees) ONTO a placed coil pose — the single source of truth
 * shared by the rendered coil (`TMSCoil`) and the solver path (`useEFieldHeatmap`), so the canted
 * windings drawn on screen are exactly the ones the field is solved from (v1.1, improvement #3).
 *
 * The cant pivots about the coil-local +x axis THROUGH the junction (the winding-plane centre over
 * the target), so the junction stays laterally over the scalp target while the wings cant up; the
 * junction is additionally raised by {@link tiltLiftMm} along the (un-tilted) outward normal, which
 * is what makes the depth–dose readouts respond (larger effective coil-to-cortex distance → deeper
 * d½, broader S½, changed relative field magnitude). `standoff` is preserved, so a downstream consumer still draws/
 * lifts the body the same way. Zero tilt returns the base pose unchanged (no allocation).
 *
 * The algebra keeps the junction fixed (laterally) by construction:
 *   q' = q₀·q_tilt,   n̂ = q₀·ẑ,   n̂' = q'·ẑ
 *   position' = position + (standoff + lift)·n̂ − standoff·n̂'
 * so that  position' + standoff·n̂'  (the posed winding-plane centre)  =  position + (standoff+lift)·n̂.
 */
export function composeTilt(base: CoilPose, tiltDeg: number): CoilPose {
  if (!tiltDeg) return base
  const theta = (tiltDeg * Math.PI) / 180
  tiltE.set(base.rotation[0], base.rotation[1], base.rotation[2], 'XYZ')
  tiltQ0.setFromEuler(tiltE)
  tiltQt.setFromAxisAngle(X_AXIS, theta) // cant about the coil-LOCAL wing axis
  tiltQp.copy(tiltQ0).multiply(tiltQt) // q' = q₀·q_tilt (local-frame rotation)
  tiltN.copy(Z_AXIS).applyQuaternion(tiltQ0) // n̂ (outward normal, pre-cant)
  tiltNt.copy(Z_AXIS).applyQuaternion(tiltQp) // n̂' (post-cant)
  const so = base.standoff
  const reach = so + tiltLiftMm(tiltDeg)
  const px = base.position[0] + reach * tiltN.x - so * tiltNt.x
  const py = base.position[1] + reach * tiltN.y - so * tiltNt.y
  const pz = base.position[2] + reach * tiltN.z - so * tiltNt.z
  tiltE.setFromQuaternion(tiltQp, 'XYZ')
  return { position: [px, py, pz], rotation: [tiltE.x, tiltE.y, tiltE.z], standoff: so }
}
