/**
 * Deploy gate (release): tests and the shipped dependency audit must pass before the
 * deploy artifact is built. Fails closed on the first non-zero exit.
 *
 * Scope is deliberately what reaches a visitor. `--omit=dev` audits only the packages that end up
 * in `web/dist`; vite/vitest/esbuild run on the build machine and are gone by the time the site is
 * served, so a fresh advisory against one of them must not take the deployment down — main accepts
 * pull requests only, so a red deploy could not be hotfixed quickly. Dev-dependency advisories are
 * still surfaced, loudly and on every pull request, by CI's `Dependency audit (.)` job, which runs
 * the FULL `npm audit`. `tooling/` and `tooling/video/` never ship and never run during a deploy;
 * they are likewise audited as their own CI checks rather than here.
 */
import { spawnSync } from 'node:child_process'
const commands = [
  ['run', 'check:toolchain'],
  ['test'],
  ['audit', '--omit=dev'],
  ['run', 'build'],
]
for (const args of commands) {
  const result = spawnSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error || result.status !== 0) process.exit(result.status || 1)
}
