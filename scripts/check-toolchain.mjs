/** Validate the installed dependency tree, not just the presence of an override. */
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { checkEsbuildTree } from './esbuild-policy.mjs'
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use the tested Node 24 line (.nvmrc)')
// npm supplies its CLI path to scripts; invoking it through node also works on Windows without a shell.
const args = ['ls', '--all', '--json']
const result = process.env.npm_execpath
  ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: 'utf8' })
  : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { encoding: 'utf8', shell: process.platform === 'win32' })
assert.equal(result.status, 0, result.stderr || 'Unable to inspect installed dependency tree')
const count = checkEsbuildTree(JSON.parse(result.stdout))
console.log('Node 24 verified; ' + (count ? count + ' patched esbuild entries' : 'esbuild optional peer is absent'))
