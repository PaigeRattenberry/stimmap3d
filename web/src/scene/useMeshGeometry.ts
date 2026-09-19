/**
 * Milestone 1 — load a single-mesh GLB and hand back a clean BufferGeometry in MNI mm.
 *
 * `useGLTF(url, false)` keeps Draco off (drei's Draco path is a gstatic CDN fetch) while
 * meshopt stays on — three's bundled MeshoptDecoder decodes our EXT_meshopt_compression /
 * KHR_mesh_quantization meshes with no network calls (DESIGN §2).
 *
 * The compressed GLBs store POSITION as normalized int16 with the dequantization
 * scale/offset on the GLTF node transform. We bake that transform into a fresh Float32
 * geometry (reading via Vector3.fromBufferAttribute denormalizes correctly) so the result
 * is in real MNI millimetres — what the M2 solver and M3 heatmap need — and we own the
 * buffer (drei's cached geometry stays untouched).
 */
import { useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three'

export function useMeshGeometry(url: string): BufferGeometry | null {
  const { scene } = useGLTF(url, false)
  return useMemo(() => {
    let found: Mesh | null = null
    scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (!found && mesh.isMesh) found = mesh
    })
    if (!found) return null

    const mesh = found as Mesh
    mesh.updateWorldMatrix(true, false)
    const src = mesh.geometry as BufferGeometry
    const pos = src.getAttribute('position')
    if (!pos) return null
    const out = new Float32Array(pos.count * 3)
    const v = new Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      out[i * 3] = v.x
      out[i * 3 + 1] = v.y
      out[i * 3 + 2] = v.z
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(out, 3))
    const index = src.getIndex()
    if (index) geometry.setIndex(index.clone())
    geometry.computeVertexNormals()
    return geometry
  }, [scene])
}
