import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEsbuildTree } from './esbuild-policy.mjs'
const tree = version => ({ dependencies: { vite: { dependencies: { esbuild: { version } } } } })
test('accepts an absent optional esbuild peer', () => assert.equal(checkEsbuildTree({ dependencies: { esbuild: {} } }), 0))
test('accepts patched versions', () => {
  for (const version of ['0.28.1', '0.28.2', '0.29.0', '1.0.0']) assert.equal(checkEsbuildTree(tree(version)), 1)
})
test('rejects vulnerable, malformed, and prerelease versions', () => {
  for (const version of ['0.27.9', '0.28.0', '0.28.1-beta', 'unexpected', undefined]) assert.throws(() => checkEsbuildTree(tree(version)))
})
test('checks every nested installed copy', () => {
  const root = tree('0.28.1')
  root.dependencies.oldTool = tree('0.27.0')
  assert.throws(() => checkEsbuildTree(root))
})
