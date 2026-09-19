import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Published tarballs that omit their own root notice, keyed by exact package version so a bump
 * fails the build until its replacement is reviewed. See notices/README.md for the upstream tags.
 */
const supplementalNotices: Record<string, string> = {
  'victory-vendor@36.9.2': 'victory-vendor-36.9.2.txt',
  '@react-three/fiber@9.6.1': 'react-three-fiber-9.6.1.txt',
  '@react-three/fiber@9.7.0': 'react-three-fiber-9.7.0.txt',
}

/** Collect notices from the packages whose modules actually reach the production chunks. */
export function thirdPartyNotices(): Plugin {
  let root = ''
  return {
    name: 'third-party-notices',
    apply: 'build',
    configResolved(config) { root = config.root },
    generateBundle(_options, bundle) {
      const packages = new Map<string, Set<string>>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of Object.keys(chunk.modules)) {
          if (!id.replaceAll('\\', '/').includes('/node_modules/')) continue
          let dir = dirname(id.split('?')[0])
          const notices: string[] = []
          while (dir !== dirname(dir)) {
            if (existsSync(dir)) {
              for (const name of readdirSync(dir).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name))) {
                notices.push(readFileSync(join(dir, name), 'utf8'))
              }
            }
            const manifest = join(dir, 'package.json')
            if (existsSync(manifest)) {
              const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
              if (pkg.name && pkg.version) {
                const key = pkg.name + '@' + pkg.version
                const supplemental = supplementalNotices[key]
                if (supplemental) notices.push(readFileSync(resolve(root, 'build-tools/notices', supplemental), 'utf8'))
                if (!notices.length) this.error('Missing bundled software notice: ' + key)
                const collected = packages.get(key) ?? new Set<string>()
                for (const notice of notices) collected.add(notice)
                packages.set(key, collected)
                break
              }
            }
            dir = dirname(dir)
          }
        }
      }
      const ledger = JSON.parse(readFileSync(resolve(root, 'src/data/citations.json'), 'utf8'))
      const assets = ledger.entries.filter((entry: { distribution: string }) => entry.distribution === 'redistributed')
      const text = [
        'StimMap3D - Third-party notices',
        'Code is MIT-licensed; the following assets and bundled software retain their own notices. Cited facts and considered references are described separately on Sources. No article figures or text are reproduced by citing their results.',
        ...assets.map((entry: { label: string; url: string; notice: string }) => entry.label + '\n' + entry.url + '\n\n' + entry.notice),
        'BUNDLED SOFTWARE (identified from production chunks)',
        ...[...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, notice]) => name + '\n' + [...notice].join('\n\n')),
      ].join('\n\n' + '='.repeat(72) + '\n\n') + '\n'
      if (!packages.size) this.error('No bundled software notices collected')
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: text })
    },
  }
}
