# Release configuration

This source tree builds a static site. Hosting destinations and security-reporting controls require maintainer configuration before release. The canonical and Open Graph URLs in web/index.html deliberately use https://example.invalid/; replace all three with the approved origin and rebuild. Add the verified demo URL to README only after deployment.

Run the checks in CONTRIBUTING.md, plus the Python/mesh pipeline in tooling/README.md. Review fresh screenshots and the generated THIRD_PARTY_NOTICES.txt. The screenshot generator input is docs/screenshots/visualizer.png; run npm run make-og-image --prefix tooling after refreshing it.

For Cloudflare Pages: repository root, Node 24, build command npm ci && npm run release:check, output web/dist, production branch main. Upload only web/dist. Choose preview access explicitly: a private Git repository does not restrict deployment URLs. The app requires no runtime secrets.

Before publishing, verify private vulnerability reporting, secret scanning/push protection and branch rules available for the selected repository. CI job names are Build & test (Node 24), Dependency audit (.), Dependency audit (tooling), Dependency audit (tooling/video), and Mesh pipeline and clinical anchors. Confirm actual emitted check names before configuring required checks. A direct Git deployment does not wait for unrelated CI jobs: protect main or use a CI-controlled deployment.

After deployment, check HTTPS, effective headers, worker and model loading, shared links, routes, narrow layout, failure states, PNG export, print, Sources and notices while signed out. Only a live check can verify host behavior.
