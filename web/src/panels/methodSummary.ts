/**
 * The verbatim §3.2 one-line method summary — the app's authoritative statement of what the model
 * computes. Exported as the single source so the print one-pager ({@link ../panels/PrintSummary
 * PrintSummary}) restates it EXACTLY rather than paraphrasing (which had drifted). Kept byte-faithful
 * to DESIGN.md §3.2; `MethodsPage.lockstep.test.ts` fails if the spec and this constant diverge.
 */
export const METHOD_ONELINER =
  'E-field = tangential projection of −dA/dt from a magnetic-dipole figure-8 model in a single ' +
  'best-fit spherical conductor (Heller & van Hulsteyn 1992; Eaton 1992; Sarvas 1987). The radial ' +
  'component is zero by the spherical boundary condition and the field is independent of the ' +
  'conductivity profile — which is exactly why it runs in real time and is not anatomically ' +
  'accurate. For anatomically faithful fields, use FEM (e.g., SimNIBS).'
