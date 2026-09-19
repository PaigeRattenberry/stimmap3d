/**
 * Cortical surface mesh (Milestone 1 → live heatmap in Milestone 3).
 *
 * The brain `BufferGeometry` is built ONCE by `useMeshGeometry(BRAIN_URL)` in the
 * parent (Scene) and shared with the M2 worker, so this component just renders the
 * passed-in geometry. In M3 that geometry carries a dynamic `color` attribute
 * (HeatmapMaterial.ensureColorAttribute) that the worker recolours per pose.
 *
 * The base colour is WHITE because `vertexColors` MULTIPLIES the base by the per-vertex
 * colour — a tan tint would skew the viridis/turbo LUT. It stays a lit
 * `meshStandardMaterial` so the cortex still reads as 3D under the scene lighting.
 */
import type { BufferGeometry } from 'three'

export function BrainMesh({ geometry }: { geometry: BufferGeometry }) {
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors color="#ffffff" roughness={0.85} metalness={0.04} />
    </mesh>
  )
}
