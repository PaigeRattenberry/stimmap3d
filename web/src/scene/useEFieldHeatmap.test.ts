import { describe, it, expect } from 'vitest'
import { isPlaceholderPose } from './useEFieldHeatmap'
import type { CoilPose } from '../store'

/**
 * Milestone 4 — the [0,0,0] origin sentinel. The store's initial/reset coil position is the
 * head-origin placeholder (a coil buried inside the head); the heatmap must SKIP solving it so a
 * reset doesn't spend a worker pass on, and briefly recolour for, an off-target buried pose. A
 * real scalp drag or preset projection can never land exactly on the origin, so only the
 * placeholder is ever skipped.
 */

const pose = (position: CoilPose['position']): CoilPose => ({
  position,
  rotation: [0, 0, 0],
  standoff: 4,
})

describe('isPlaceholderPose', () => {
  it('is true only for the exact [0,0,0] origin', () => {
    expect(isPlaceholderPose(pose([0, 0, 0]))).toBe(true)
  })

  it('is false for any real on-scalp placement', () => {
    expect(isPlaceholderPose(pose([-50.2, 53.1, 42.2]))).toBe(false) // F3 scalp site
    expect(isPlaceholderPose(pose([0, 0, 0.0001]))).toBe(false) // not exactly the origin
    expect(isPlaceholderPose(pose([-50, 48, 50]))).toBe(false) // the fallback pose
  })
})
