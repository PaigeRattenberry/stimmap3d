/** Read-only comparison of disposable regeneration to shipped geometry. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
const dirs = process.argv.slice(2)
assert.equal(dirs.length, 2, 'Usage: node tooling/verify_meshes.mjs <node-output> <python-output>')
const sources = JSON.parse(await readFile(new URL('./mesh-sources.json', import.meta.url), 'utf8'))
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const report = {}
for (const name of ['brain.glb', 'scalp.glb']) {
  const original = await io.read(resolve('web/public/models', name))
  const reference = getBounds(original.getRoot().listScenes()[0])
  report[name] = { shippedBoundsMm: reference, outputs: [] }
  for (const [index, dir] of dirs.entries()) {
    const path = join(dir, name)
    const hash = createHash('sha256').update(await readFile(path)).digest('hex')
    if (index === 0) assert.equal(hash, sources.shipped[name], 'Node artifact changed: ' + name)
    const doc = await io.read(path)
    const bounds = getBounds(doc.getRoot().listScenes()[0])
    const delta = Math.max(...bounds.min.map((v, i) => Math.abs(v - reference.min[i])), ...bounds.max.map((v, i) => Math.abs(v - reference.max[i])))
    // A geometry-frame sanity bound, not anatomical or clinical validation.
    assert.ok(Number.isFinite(delta) && delta < 3, name + ' bounds differ by >=3 mm')
    const positions = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION')
    assert.ok(positions.getCount() > 10000, 'Unexpectedly empty/coarse mesh')
    report[name].outputs.push({ pipeline: index === 0 ? 'Node' : 'Python', sha256: hash, boundsMm: bounds, maxBoundsDifferenceMm: delta, vertices: positions.getCount() })
  }
}
console.log(JSON.stringify(report, null, 2))
