/**
 * Milestone 1 — author-time mesh prep (NEVER on the live path).
 *
 * Node mesh pipeline (see tooling/README.md). Produces the two committed deliverables:
 *
 *   web/public/models/brain.glb  — NiiVue MNI152-2009 whole-cortex surface (MZ3),
 *                                  decimated to ~40k verts.
 *   web/public/models/scalp.glb  — scalp/head surface, marching-cubes from the
 *                                  whole-head ICBM152 2009c T1 (TemplateFlow), in the
 *                                  same MNI/RAS frame so it encloses the cortex.
 *
 * Both are meshopt-compressed (decoded by three.js' bundled MeshoptDecoder; no CDN).
 * Coordinates stay in MNI millimetres — the M2 solver and the scene's RAS→Y-up
 * rotation depend on that. Run: `npm run prep-meshes` (from tooling/).
 *
 * Sources (provenance recorded in web/src/data/citations.json):
 *  - Cortex:  github.com/niivue/niivue  demos/images/mni152_2009.mz3   (BSD-2)
 *  - Head T1: templateflow tpl-MNI152NLin2009cAsym_res-01_T1w.nii.gz   (ICBM152 terms)
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { readMZ3 } from './lib/mz3.mjs'
import { buildDocument, decimate, writeGLB } from './lib/glb.mjs'
import { loadVolume, scalpFromVolume } from './lib/scalp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({ options: { 'out-dir': { type: 'string' }, 'cache-dir': { type: 'string' } } })
const CACHE = resolve(values['cache-dir'] ?? join(HERE, '.cache'))
const OUT = resolve(values['out-dir'] ?? join(HERE, '..', 'web', 'public', 'models'))
// Scratch runs keep the report beside their outputs. Writing the DELIVERED model directory (the
// default) is different: Vite copies it verbatim into web/dist, so the report goes to the ignored
// cache instead of into the published site next to the GLBs.
const DELIVERED = resolve(join(HERE, '..', 'web', 'public', 'models'))
const PROVENANCE = OUT === DELIVERED ? join(CACHE, 'provenance-node.json') : join(OUT, 'provenance.json')
const SOURCES = JSON.parse(await readFile(join(HERE, 'mesh-sources.json'), 'utf8')).sources
const sha256 = buf => createHash('sha256').update(buf).digest('hex')
const outputs = {}

const BRAIN_TARGET_VERTS = 40_000
const SCALP_TARGET_VERTS = 18_000
const SCALP_THRESHOLD_FRAC = 0.16 // air→skin step (fraction of max T1); >0.2 cuts into the skull

async function cached(source) {
  await mkdir(CACHE, { recursive: true })
  const path = join(CACHE, source.filename)
  let buf
  if (existsSync(path)) buf = await readFile(path)
  else {
    const res = await fetch(source.url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error('Source download failed: ' + res.status)
    buf = Buffer.from(await res.arrayBuffer())
  }
  if (sha256(buf) !== source.sha256) throw new Error('Source checksum mismatch: ' + path)
  if (!existsSync(path)) await writeFile(path, buf)
  return buf
}

function bounds(positions) {
  const mn = [Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a]
      if (v < mn[a]) mn[a] = v
      if (v > mx[a]) mx[a] = v
    }
  return [mn, mx]
}

async function emit(name, raw, targetVerts, outFile) {
  const doc = buildDocument(name, raw)
  const { before, after, arrays } = await decimate(doc, targetVerts)
  const outPath = join(OUT, outFile)
  const method = await writeGLB(name, arrays, outPath)
  const kb = ((await stat(outPath)).size / 1024).toFixed(0)
  console.log(`  ${outFile}: ${before} → ${after} verts, ${method}, ${kb} KB`)
  console.log(`     bounds(mm): ${JSON.stringify(bounds(arrays.positions))}`)
  outputs[outFile] = { sha256: sha256(await readFile(outPath)), vertices: after, compression: method, boundsMm: bounds(arrays.positions) }
  return arrays.positions
}

async function main() {
  await mkdir(OUT, { recursive: true })

  console.log('• brain.glb  (NiiVue MNI152-2009 whole cortex)')
  const cortex = readMZ3(await cached(SOURCES.cortex))
  await emit(
    'brain',
    { positions: cortex.positions, indices: cortex.indices },
    BRAIN_TARGET_VERTS,
    'brain.glb',
  )

  console.log('• scalp.glb  (whole-head ICBM152 2009c T1 → marching cubes)')
  const raw = await cached(SOURCES.head)
  const vol = loadVolume(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  const scalpRaw = scalpFromVolume(vol, { step: 2, thresholdFrac: SCALP_THRESHOLD_FRAC })
  await emit('scalp', scalpRaw, SCALP_TARGET_VERTS, 'scalp.glb')

  const lock = JSON.parse(await readFile(join(HERE, 'package-lock.json'), 'utf8'))
  await mkdir(dirname(PROVENANCE), { recursive: true })
  await writeFile(PROVENANCE, JSON.stringify({ generator: 'prep_meshes.mjs', generatorSha256: sha256(await readFile(fileURLToPath(import.meta.url))), node: process.version, sources: SOURCES, lockfileSha256: sha256(await readFile(join(HERE, 'package-lock.json'))), lockfilePackages: Object.fromEntries(Object.entries(lock.packages).filter(([key, value]) => key && value.version).map(([key, value]) => [key, value.version])), outputs }, null, 2) + '\n')
  console.log('done. provenance: ' + PROVENANCE)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
