/**
 * glTF/GLB build helpers (author-time only): turn raw {positions, indices} typed
 * arrays into a decimated, normal-shaded, meshopt-compressed .glb.
 *
 * Compression is EXT_meshopt_compression (+ KHR_mesh_quantization): three.js
 * GLTFLoader decodes both with its bundled MeshoptDecoder (drei `useGLTF` wires it
 * automatically), so NOTHING is fetched from a CDN at runtime — the live path stays
 * fully static (DESIGN §2). Draco is deliberately avoided (its decoder is a gstatic
 * CDN fetch in drei's default loader).
 */
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { weld, simplify, meshopt as meshoptCompress } from '@gltf-transform/functions'
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'

function io() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
}

/** Assemble a single-mesh Document from flat arrays (normals optional). */
export function buildDocument(name, { positions, indices, normals }) {
  const doc = new Document()
  // A fixed label, not glTF-Transform's versioned default, so a library bump that leaves the
  // geometry untouched also leaves the committed GLB bytes (and their hashes) untouched.
  doc.getRoot().getAsset().generator = 'StimMap3D prep_meshes.mjs'
  const buffer = doc.createBuffer()
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor(`${name}_POSITION`).setType('VEC3').setArray(positions).setBuffer(buffer))
    .setIndices(doc.createAccessor(`${name}_indices`).setType('SCALAR').setArray(indices).setBuffer(buffer))
  if (normals) {
    prim.setAttribute('NORMAL', doc.createAccessor(`${name}_NORMAL`).setType('VEC3').setArray(normals).setBuffer(buffer))
  }
  const mesh = doc.createMesh(name).addPrimitive(prim)
  doc.createScene(name).addChild(doc.createNode(name).setMesh(mesh))
  return doc
}

function firstPrimitive(doc) {
  return doc.getRoot().listMeshes()[0].listPrimitives()[0]
}

/**
 * Weld → simplify toward `targetVerts`, in place. Keeps the mesh INDEXED (gltf-transform's
 * normals() de-indexes and ~3×'s the vertex count, so we leave normals to the runtime —
 * three's geometry.computeVertexNormals() gives smooth per-vertex normals on load).
 * Returns the decimated geometry as flat arrays for the write path.
 */
export async function decimate(doc, targetVerts, { error = 0.005 } = {}) {
  await MeshoptSimplifier.ready
  const before = firstPrimitive(doc).getAttribute('POSITION').getCount()
  const ratio = Math.max(0, Math.min(1, targetVerts / before))
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error }),
  )
  const prim = firstPrimitive(doc)
  const after = prim.getAttribute('POSITION').getCount()
  return {
    before,
    after,
    arrays: {
      positions: prim.getAttribute('POSITION').getArray(),
      indices: prim.getIndices().getArray(),
    },
  }
}

/**
 * Write `arrays` to `outPath`. Tries meshopt compression first and silently falls
 * back to an uncompressed GLB if the encoder errors — the scene must always load.
 * @returns {Promise<'meshopt'|'uncompressed'>}
 */
export async function writeGLB(name, arrays, outPath, { compress = true } = {}) {
  if (compress) {
    try {
      await MeshoptEncoder.ready
      const doc = buildDocument(name, arrays)
      await doc.transform(meshoptCompress({ encoder: MeshoptEncoder, level: 'medium' }))
      await io().write(outPath, doc)
      return 'meshopt'
    } catch (err) {
      console.warn(`  ! meshopt compression failed (${err.message}); writing uncompressed`)
    }
  }
  await io().write(outPath, buildDocument(name, arrays))
  return 'uncompressed'
}
