# Engineering decisions

## Bound asynchronous solver work

Rapid coil movement can queue obsolete calculations and let stale results overwrite the latest pose. The coalescer keeps one request in flight and replaces pending work with the newest request. This preserves responsiveness without claiming every intermediate pose was solved. Per-frame unbounded dispatch would increase backlog; synchronous calculation would contend with rendering.

Evidence: [coalescer](../web/src/scene/efieldCoalescer.ts), [adversarial ordering tests](../web/src/scene/efieldCoalescer.test.ts), [heatmap integration](../web/src/scene/useEFieldHeatmap.ts) and [render-count tests](../web/src/scene/heatmapRenderCount.test.tsx). Run npm test. Worker failures still require explicit UI handling; coalescing alone does not make a displayed frame valid.

## Export the current solved frame

An existing canvas may contain an obsolete heatmap while replacement geometry or a worker result loads. Export readiness tracks geometry, computation and painting, and failures invalidate it. Merely enabling export when a canvas exists would produce plausible but stale figures.

Evidence: [export implementation](../web/src/scene/exportPng.ts), [readiness tests](../web/src/scene/exportReadiness.test.ts), [toolbar tests](../web/src/ui/ShareBar.test.tsx), and [production Chromium checks](../tooling/video/release-smoke.mjs). Run npm run test:browser after building. DOM mocks alone cannot establish that WebGL pixels match the current pose.

## Keep scientific statements tied to reproducible artifacts

Two agreeing documents or a passing phrase test can repeat the same scientific error. The method statement therefore includes the secondary-field caveat, while scientific definitions and licenses remain attached to their sources. Pinned source hashes detect changed mesh inputs; Node and Python outputs are compared without claiming equal topology or clinical validity. A generic filename or plausible-looking surface cannot establish provenance.

Evidence: [Methods lockstep](../web/src/panels/MethodsPage.lockstep.test.ts), [source manifest](../tooling/mesh-sources.json), [mesh verification](../tooling/verify_meshes.mjs), [tamper tests](../tooling/test_mesh_sources.py), and [trial-anchor verification](../tooling/verify_trials.py). See tooling/README.md for commands. Automated consistency checks supplement source review; they do not independently validate clinical claims.
