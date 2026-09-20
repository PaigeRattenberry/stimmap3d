# Notice on third-party assets and data

This note lives outside `LICENSE` on purpose: GitHub's license detector only recognizes an
unmodified license text, so appending this section made the repository report "Other" instead
of MIT. `LICENSE` is now the verbatim MIT text and this file carries the scope note.

The MIT license in `LICENSE` covers StimMap3D's own source code only. Third-party data, meshes,
atlases, electrode coordinates, and any bundled reference outputs are licensed separately by
their respective sources. Each such asset and every clinical figure records its source URL,
license, and type in `web/src/data/citations.json`; see also DESIGN.md §4. Permissive-first
sources were chosen deliberately; GPL-licensed tools (e.g. SimNIBS) are used only offline with
their output data shipped, never their code.

Assets that are actually redistributed in `web/dist` additionally carry the verbatim notice
their license requires, mapped through `SHIPPED_ASSETS` in `web/src/data/citations.ts` and
checked by `web/src/data/citations.test.ts`. The build emits `THIRD_PARTY_NOTICES.txt` beside
the app from those asset notices and the installed dependencies, so attribution survives without
a successful JavaScript render.
