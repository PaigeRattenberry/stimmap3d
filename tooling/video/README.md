# Browser verification and recording

Author-time Playwright tools run against the production application. They are not part of the browser runtime or an npm workspace.

From the repository root, run npm ci --prefix tooling/video, npx --prefix tooling/video playwright install chromium, npm run build, then npm run test:browser. The regression runner starts its own loopback server and checks route loading, keyboard behavior, loading/failure states and export validity.

To run the same checks against a real deployment instead, set STIMMAP_SMOKE_BASE to its origin:

```
STIMMAP_SMOKE_BASE=https://stimmap3d.pages.dev node tooling/video/release-smoke.mjs
```

No loopback server starts and no build is needed, so this additionally covers what only a host provides: the _headers rules, the served MIME type of the module worker, and HTTP caching. Use it after deploying, or against a preview URL. STIMMAP_SMOKE_FILTER narrows the run to checks whose name contains it.

For an optional demo recording, serve the production build with npm run preview, then run npm run record --prefix tooling/video. TARGET_URL can select another local preview address. The recorder uses headed Chromium and may use ffmpeg for MP4 conversion. Review the entire recording, audio, captions, thumbnail and metadata before sharing. Output stays ignored; recordings are not required release artifacts.
