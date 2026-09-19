/**
 * Scalp surface mesh (Milestone 1). Semi-transparent so the cortex stays visible;
 * marching-cubes-derived from the whole-head ICBM152 2009c T1 (tooling/prep_meshes),
 * in the same MNI/RAS frame as the cortex so it encloses the brain. Rendered inside the
 * scene's MNI→Y-up group.
 *
 * DoubleSide + depthWrite:false so the translucent shell reads correctly from any angle
 * and never occludes the cortex behind it.
 */
import { DoubleSide } from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { useMeshGeometry } from './useMeshGeometry'

const SCALP_URL = '/models/scalp.glb'

export function ScalpMesh(props: ThreeElements['mesh']) {
  const geometry = useMeshGeometry(SCALP_URL)
  if (!geometry) return null
  return (
    <mesh geometry={geometry} renderOrder={2} {...props}>
      <meshStandardMaterial
        color="#e7c6ad"
        roughness={0.9}
        metalness={0}
        transparent
        opacity={0.16}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  )
}
