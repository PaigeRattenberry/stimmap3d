import type { EFieldSolver } from './efield'

/** Reference v1: horizontal coil at (centroid X, centroid Y, max Z + 10 mm),
 * 4 mm stand-off, zero rotation/tilt, intensity 1. Uses the absolute surface maximum.
 * Recomputed from the same mesh on worker startup; independent of navigation and user pose. */
export function referencePeak(solver: EFieldSolver, positions: Float32Array): number {
  let x = 0, y = 0, z = -Infinity
  const n = positions.length / 3
  for (let i = 0; i < positions.length; i += 3) {
    x += positions[i]; y += positions[i + 1]; z = Math.max(z, positions[i + 2])
  }
  const field = solver.solve({ position: [x / n, y / n, z + 10], rotation: [0, 0, 0], standoff: 4 }, 1)
  let peak = 0
  for (const value of field) peak = Math.max(peak, value)
  if (!(peak > 0) || !Number.isFinite(peak)) throw new Error('Invalid reference field')
  return peak
}
