import assert from 'node:assert/strict'

/** npm ls emits {} for an absent optional peer; all resolved copies need a patched version. */
export function checkEsbuildTree(tree) {
  let count = 0
  function visit(node) {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      if (name === 'esbuild' && Object.keys(dep).length > 0) {
        assert.match(dep.version, /^\d+\.\d+\.\d+$/, 'Unexpected esbuild version')
        const [major, minor, patch] = dep.version.split('.').map(Number)
        assert.ok(major > 0 || minor > 28 || (minor === 28 && patch >= 1), 'Unpatched esbuild: ' + dep.version)
        count++
      }
      visit(dep)
    }
  }
  visit(tree)
  return count
}
