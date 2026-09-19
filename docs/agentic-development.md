# AI-assisted development

Developed with AI-assisted implementation and review, using explicit behavioral constraints, regression tests, browser checks and maintainer decisions. The app itself is not an AI system. This document describes the supported workflow, not a transcript or a measurement of code authorship.

Work is decomposed around observable contracts: worker ordering, export readiness, accessible controls, scientific wording and reproducible assets. Acceptance criteria identify failure cases before implementation. Implementation and automated review then inspect code and exercise those cases. Maintainer decisions establish product scope and scientific boundaries; automated review is not independent human review or clinical validation.

The code records useful corrections: stale results must not validate export; rendered Methods text must agree with the design caveat; response rates must retain their denominators; package upgrades must preserve peer compatibility and asset checks. Tests and production-browser checks provide evidence of behavior, not a guarantee that prose or scientific assumptions are correct.

## Reusable task brief (example)

Implement a bounded worker update path. Keep at most one solve active and the newest pending pose. Ignore obsolete responses and invalidate export after failure. Verify rapid updates, stale replies, worker startup failure and rendered output. Describe the remaining approximation and browser limits.

## Reusable review brief (example)

Trace one user action through state, computation, painting and export. Challenge ordering assumptions and failed resource loads. Check the cited source and statistical denominator independently of UI wording. Run the narrow regression checks and relevant production-browser paths. Report observed failures and unresolved limits, distinguishing automated results from human decisions.

These briefs are newly written examples, not verbatim historical prompts. See [engineering decisions](engineering-decisions.md) for code and executable evidence.
