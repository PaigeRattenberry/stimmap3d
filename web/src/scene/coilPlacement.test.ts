import { describe, it, expect } from 'vitest'
import { Euler, Vector3 } from 'three'
import {
  FALLBACK_TARGET,
  bestScalpVertexForTarget,
  interTargetScalpDistanceMm,
  poseFromMNI,
  presetTarget,
} from './coilPlacement'
import { PRESETS } from '../data/presets'
import type { Preset, Vec3 } from '../store'

/**
 * Milestone 4 — pure coil-placement geometry (the preset → scalp projection extracted from
 * TMSCoil). Runs in Vitest's default `node` env: no WebGL / R3F, just the deterministic radial
 * scan + pose math, exercised with SYNTHETIC vertex clouds (points on a sphere in MNI mm).
 */

const R = 100 // mm — synthetic scalp-shell radius

/** A point at MNI = center + R·normalize(dir). */
function pointAt(center: Vec3, dir: Vec3, r = R): Vec3 {
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1
  return [center[0] + (dir[0] / n) * r, center[1] + (dir[1] / n) * r, center[2] + (dir[2] / n) * r]
}

/** Reconstruct the coil's outward axis (local +z rotated by the pose's Euler, XYZ order). */
function outwardAxis(rotation: Vec3): Vector3 {
  return new Vector3(0, 0, 1).applyEuler(new Euler(rotation[0], rotation[1], rotation[2], 'XYZ'))
}

describe('presetTarget', () => {
  it('returns each preset’s declared target', () => {
    for (const p of PRESETS) {
      expect(presetTarget(p.id)).toEqual(p.target)
    }
  })

  it('falls back to the neutral DLPFC anchor for an unknown preset', () => {
    // Cast past the union to exercise the `?? FALLBACK_TARGET` branch (a renamed/missing id).
    expect(presetTarget('does-not-exist' as Preset)).toEqual(FALLBACK_TARGET)
  })
})

describe('bestScalpVertexForTarget', () => {
  it('returns null when there are no vertices', () => {
    expect(bestScalpVertexForTarget([-44, 38, 34], [0, 0, 0], [])).toBeNull()
    expect(bestScalpVertexForTarget([-44, 38, 34], [0, 0, 0], [1, 2, 3], 0)).toBeNull()
  })

  it('projects a DEEP target OUT onto the scalp vertex along its radial', () => {
    const center: Vec3 = [0, 0, 0]
    const target: Vec3 = [-44, 38, 34] // the Fox connectivity optimum: inside the head
    const onDir = pointAt(center, target) // scalp vertex exactly along the target radial
    const positions = [
      ...onDir,
      100, 0, 0, // +x decoy
      0, 100, 0, // +y decoy
      0, 0, -100, // -z decoy
      -100, 0, 0, // -x decoy (right sign in x, wrong y/z)
    ]

    const best = bestScalpVertexForTarget(target, center, positions)
    expect(best).not.toBeNull()
    // Picks the on-radial vertex...
    expect(best![0]).toBeCloseTo(onDir[0], 6)
    expect(best![1]).toBeCloseTo(onDir[1], 6)
    expect(best![2]).toBeCloseTo(onDir[2], 6)
    // ...and that vertex sits OUTSIDE the (deep) target — projection out, not into the brain.
    expect(Math.hypot(best![0], best![1], best![2])).toBeGreaterThan(
      Math.hypot(target[0], target[1], target[2]),
    )
  })

  it('selects by direction (angle), not by Euclidean nearness to the target', () => {
    const center: Vec3 = [0, 0, 0]
    const target: Vec3 = [0, 0, 20] // shallow +z target, 20 mm from center
    // A vertex slightly off-axis but physically CLOSER to the target, vs the on-axis vertex.
    const offAxisCloser: Vec3 = [60, 0, 80] // |v - target| smaller, but ~37° off the +z radial
    const onAxis: Vec3 = [0, 0, 100] // exactly on the +z radial
    const positions = [...offAxisCloser, ...onAxis]

    const best = bestScalpVertexForTarget(target, center, positions)
    expect(best).toEqual(onAxis) // direction wins over nearness
  })

  it('works with a non-origin head centre', () => {
    const center: Vec3 = [5, -8, 12]
    const dir: Vec3 = [-0.6, 0.5, 0.6]
    const target: Vec3 = pointAt(center, dir, 40) // deep, along `dir`
    const onDir = pointAt(center, dir, R)
    const positions = [
      ...onDir,
      ...pointAt(center, [1, 0, 0]),
      ...pointAt(center, [0, -1, 0]),
      ...pointAt(center, [0, 0, -1]),
    ]
    const best = bestScalpVertexForTarget(target, center, positions)
    expect(best![0]).toBeCloseTo(onDir[0], 6)
    expect(best![1]).toBeCloseTo(onDir[1], 6)
    expect(best![2]).toBeCloseTo(onDir[2], 6)
  })

  it('honours an explicit `count` (ignores trailing buffer slack)', () => {
    const center: Vec3 = [0, 0, 0]
    // Only the first vertex is "real"; the +x vertex after it must be excluded by count=1.
    const positions = [0, 0, 100, 100, 0, 0]
    const best = bestScalpVertexForTarget([0, 0, 50], center, positions, 1)
    expect(best).toEqual([0, 0, 100])
  })
})

describe('interTargetScalpDistanceMm', () => {
  // A coarse synthetic scalp shell so each preset's radial picks a real vertex on it.
  const center: Vec3 = [0, 10, 15]
  const dirs: Vec3[] = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-0.85, 0.45, 0.45], // toward the left-frontal DLPFC radials
    [-0.7, 0.4, 0.6],
  ]
  const positions = dirs.flatMap((d) => pointAt(center, d))

  it('returns null when there are no scalp vertices', () => {
    expect(interTargetScalpDistanceMm('F3', 'connectivity', center, [])).toBeNull()
  })

  it('returns the chord between each preset’s OWN scalp projection (derived, not asserted)', () => {
    const r = interTargetScalpDistanceMm('F3', 'connectivity', center, positions)
    expect(r).not.toBeNull()
    const a = bestScalpVertexForTarget(presetTarget('F3'), center, positions)!
    const b = bestScalpVertexForTarget(presetTarget('connectivity'), center, positions)!
    expect(r!.a).toEqual(a)
    expect(r!.b).toEqual(b)
    expect(r!.mm).toBeCloseTo(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 6)
    expect(Number.isFinite(r!.mm)).toBe(true)
    expect(r!.mm).toBeGreaterThanOrEqual(0)
  })

  it('is zero when both presets resolve to the same scalp vertex', () => {
    // Single-vertex cloud → both projections land on it → identical points, zero gap.
    const single = pointAt(center, [-0.8, 0.45, 0.45])
    const r = interTargetScalpDistanceMm('F3', 'connectivity', center, single)
    expect(r!.mm).toBe(0)
  })
})

describe('poseFromMNI', () => {
  it('orients the coil’s local +z along the outward normal', () => {
    const pose = poseFromMNI([0, 0, 100], [0, 0, 1], [0, 0, 0])
    expect(pose.position).toEqual([0, 0, 100])
    const axis = outwardAxis(pose.rotation)
    expect(axis.x).toBeCloseTo(0, 6)
    expect(axis.y).toBeCloseTo(0, 6)
    expect(axis.z).toBeCloseTo(1, 6)
  })

  it('flips an inward-facing normal so the coil always faces away from the head', () => {
    const point: Vec3 = [0, 0, 100]
    const center: Vec3 = [0, 0, 0]
    // Pass an INWARD normal; the pose must still point outward (+z away from centre).
    const pose = poseFromMNI(point, [0, 0, -1], center)
    const axis = outwardAxis(pose.rotation)
    const outward = new Vector3(point[0] - center[0], point[1] - center[1], point[2] - center[2])
    expect(axis.dot(outward)).toBeGreaterThan(0)
  })

  it('aligns +z with the radial for an off-axis scalp point', () => {
    const center: Vec3 = [3, -4, 5]
    const point = pointAt(center, [-0.65, 0.56, 0.5], R)
    const normal: Vec3 = [point[0] - center[0], point[1] - center[1], point[2] - center[2]]
    const pose = poseFromMNI(point, normal, center)
    const axis = outwardAxis(pose.rotation).normalize()
    const radial = new Vector3(normal[0], normal[1], normal[2]).normalize()
    expect(axis.x).toBeCloseTo(radial.x, 5)
    expect(axis.y).toBeCloseTo(radial.y, 5)
    expect(axis.z).toBeCloseTo(radial.z, 5)
  })
})
