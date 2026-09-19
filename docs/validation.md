# Validation

Validated with Node 24.16.0, CPython 3.12.14 and the committed lockfiles. Clean npm installs completed in the root, tooling and tooling/video; Python requirements were installed in a new virtual environment.

- Release gate: 447 app tests across 35 files, four toolchain-policy tests, root audit and production build passed.
- Both authoring-root npm audits passed with no reported vulnerabilities.
- All 24 production Chromium checks passed, including loading/failure behavior, narrow layouts and PNG export labels.
- Node mesh regeneration matched both shipped SHA-256 hashes. Python reference bounds differed by at most 0.167 mm for brain and 2 mm for scalp; these are frame/scale checks, not anatomical validation.
- Trial-anchor verification and both source-tamper tests passed. Synthetic numerical data and delivered meshes were preserved.
- The README screenshot and 1200x630 preview card were regenerated from the production app. PNG export, print, Methods, Sources, quiz and tour were inspected locally.

GitHub Actions runs the same checks on every push to main and every pull request, in five jobs: Build & test (Node 24), which includes the production Chromium checks; Dependency audit for the root, tooling and tooling/video; and Mesh pipeline and clinical anchors. See the repository's Actions tab for current results.

Non-blocking tool output includes the Recharts 2 deprecation, large visualization chunk warning, future Vite native-config import warning and Node's shell-argument deprecation in the release runner. These warnings do not fail the build; no compatibility migration is included.

These are automated checks and visual inspection, not independent human review or clinical validation. Host headers, deployment access and signed-out live behavior still need verification on the selected destination. See [release configuration](release-controls.md).
