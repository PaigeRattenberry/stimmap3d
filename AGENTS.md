# Agent guidance

Read DESIGN.md and CONTRIBUTING.md before substantial changes. Work within the requested scope and preserve user files. The app is static: Python and asset generators are author-time only. Never introduce patient data or calibrated clinical claims.

Keep the disclaimer on all routes and exported figures; label synthetic trajectories and relative field units. Preserve citation attribution, license notices and statistical denominators. Keep Methods/design wording in lockstep. For asynchronous changes, test stale replies, loading and failure before export. Avoid regenerating scientific assets for unrelated prose changes.

Use npm ci with Node 24 and committed lockfiles. Run meaningful existing checks listed in CONTRIBUTING.md. Review generated output as well as source. Summarize automated evidence accurately; do not describe automated review as independent human review. Publishing repositories, releases or deployments requires explicit maintainer authorization.
