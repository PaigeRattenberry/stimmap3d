/**
 * Minimal reader for the NiiVue MZ3 surface-mesh format (author-time only).
 *
 * MZ3 is a compact little-endian binary mesh format (optionally gzip-wrapped):
 *   uint16 magic = 23117 (0x5A4D, "MZ")
 *   uint16 attr  bitflags: 1=FACE 2=VERT 4=RGBA 8=SCALAR ...
 *   uint32 nface
 *   uint32 nvert
 *   uint32 nskip   (extra bytes to skip after the 16-byte header)
 *   [faces]  nface*3 * int32   (when attr&1)
 *   [verts]  nvert*3 * float32 (when attr&2)
 *   ...
 * Spec: https://github.com/neurolabusc/surf-ice/tree/master/mz3 and the NiiVue reader.
 */
import { gunzipSync } from 'node:zlib'

const MZ3_MAGIC = 23117

/** @returns {{ nvert:number, nface:number, positions:Float32Array, indices:Uint32Array }} */
export function readMZ3(buffer) {
  let bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  // Transparently gunzip (gzip magic 0x1f 0x8b).
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = dv.getUint16(0, true)
  if (magic !== MZ3_MAGIC) throw new Error(`not an MZ3 file (magic=${magic})`)

  const attr = dv.getUint16(2, true)
  const nface = dv.getUint32(4, true)
  const nvert = dv.getUint32(8, true)
  const nskip = dv.getUint32(12, true)

  const isFace = (attr & 1) !== 0
  const isVert = (attr & 2) !== 0
  if (!isFace || !isVert) throw new Error(`MZ3 missing FACE/VERT data (attr=${attr})`)

  let off = 16 + nskip
  const indices = new Uint32Array(nface * 3)
  for (let i = 0; i < indices.length; i++, off += 4) indices[i] = dv.getInt32(off, true)

  const positions = new Float32Array(nvert * 3)
  for (let i = 0; i < positions.length; i++, off += 4) positions[i] = dv.getFloat32(off, true)

  return { nvert, nface, positions, indices }
}
