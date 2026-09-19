/**
 * Deploy gate (release): tests and the root dependency audit must pass before the
 * deploy artifact is built. Fails closed on the first non-zero exit.
 *
 * Scope is deliberately the SHIPPED/BUILD tree only. The root audit includes development
 * dependencies because vite/vitest run on the build machine. `tooling/` and `tooling/video/` never
 * ship in `web/dist` and never run during a deploy, so they are audited as separate CI checks rather
 * than here: an advisory in an authoring tool must not block an unrelated site deploy or hotfix.
 */
import { spawnSync } from 'node:child_process'
const commands = [
  ['run', 'check:toolchain'],
  ['test'],
  ['audit'],
  ['run', 'build'],
]
for (const args of commands) {
  const result = spawnSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error || result.status !== 0) process.exit(result.status || 1)
}
