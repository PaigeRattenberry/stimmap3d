# Contributing

Use Node 24 and the committed lockfiles. Run from the repository root:

```sh
npm ci
npm ci --prefix tooling
npm ci --prefix tooling/video
npm run check:toolchain
npm run release:check
npm audit --prefix tooling
npm audit --prefix tooling/video
npx --prefix tooling/video playwright install chromium
npm run test:browser
```

For Python 3.12 and mesh/trial checks, follow [tooling/README.md](tooling/README.md). CI also runs both authoring audits and the mesh pipeline. Release checks do not imply that repository branch rules are enabled.

Source comments and test names carry historical work-item labels from pre-release planning: milestones (M0–M6, v1.x–v2.x, V2-1…V2-7b, P0), numbered improvements (#1–#43) and short codes (C1–C6). They are not GitHub issue or pull-request numbers in this repository. The honesty gates (a)–(e) are defined in [DESIGN.md](DESIGN.md) §1.

Keep changes focused and describe observable behavior, validation and limitations. Preserve the persistent disclaimer, relative units, synthetic labels, citation IDs, license notices and separate statistical definitions. Retain the Methods/design lockstep test. Never add real participant records or credentials. AI-assisted changes need the same review and verification; disclose material automation and unresolved assumptions without publishing raw conversations.
