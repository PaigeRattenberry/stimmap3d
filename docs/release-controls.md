# Release configuration

This source tree builds a static site, deployed at https://stimmap3d.pages.dev. The canonical and Open Graph URLs in web/index.html carry that origin; deployArtifacts.test.ts requires all three to be absolute https on one origin, so a partial edit fails the build rather than shipping a broken link-preview card. Changing host or adding a custom domain means changing all three together, plus the README demo line and the repository homepage field.

Run the checks in CONTRIBUTING.md, plus the Python/mesh pipeline in tooling/README.md. Review fresh screenshots and the generated THIRD_PARTY_NOTICES.txt. The README screenshot, docs/screenshots/visualizer.png, is captured manually from the production app and is also the input to the preview-card generator: after replacing it, run npm run make-og-image --prefix tooling to regenerate web/public/og-image.png.

For Cloudflare Pages: repository root, build command npm ci && npm run release:check, output web/dist, production branch main. Upload only web/dist. Set NODE_VERSION=24 as a build environment variable rather than relying on .nvmrc detection: package.json declares engines >=24 <25, so npm ci fails outright on an older build image. The app requires no runtime secrets.

Choose preview access explicitly. The repository is public, so every preview deployment URL is reachable by anyone who finds it; repository visibility never restricted those URLs, and it cannot now. Disable preview deployments unless a preview is actively needed.

Before publishing, verify private vulnerability reporting, secret scanning/push protection and branch rules available for the selected repository. CI job names are Build & test (Node 24), Dependency audit (.), Dependency audit (tooling), Dependency audit (tooling/video), and Mesh pipeline and clinical anchors. Confirm actual emitted check names before configuring required checks. A direct Git deployment does not wait for unrelated CI jobs: protect main or use a CI-controlled deployment. The Pages build command covers the toolchain policy, tests, the shipped-dependency audit (npm audit --omit=dev) and the production build. It does not cover the production-browser checks, the development-dependency half of the root audit, the authoring audits or the mesh pipeline, which run only in CI. That split is deliberate: only packages that reach a visitor can stop a deployment, while CI's Dependency audit (.) job still runs the full audit and blocks merges. Require all five checks on main before connecting Pages so that only fully checked commits reach the production branch.

After deployment, run the production-browser suite against the live origin rather than the artifact:

```
STIMMAP_SMOKE_BASE=https://stimmap3d.pages.dev node tooling/video/release-smoke.mjs
```

That covers routes, worker and model loading, shared links, narrow layout and zoom, failure states and PNG export against real host responses. Confirm HTTPS and the effective _headers rules separately, since no browser assertion reads them. Print output and the visual fidelity of an exported PNG still need a human, as does any real assistive technology; the suite checks that their labels are present and truthful, not that they look right.

CI also runs weekly on a schedule. The dependency audits read the registry's current advisories, so their result changes without a commit, and deployment fails closed on `npm audit --omit=dev`; the weekly run surfaces an advisory against an idle repository rather than at deploy time.
