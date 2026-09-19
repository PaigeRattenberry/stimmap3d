/**
 * Deep-link state-URL (V2-4b, improvement #18) — the impure glue around the pure `stateUrl.ts` codec:
 * read the URL, HYDRATE the store once on app init, and keep the URL in SYNC as state changes. Wired
 * from `main.tsx` (before React renders + immediately after), never from a component, so it stays off
 * the heatmap recolour hot path.
 *
 * Two acceptance-blocking hazards live here:
 *  • H2 — `applyDeepLinkState` applies `preset` BEFORE the explicit `coilPose`. `setPreset` bumps
 *    `placementSeq`, which makes `TMSCoil` re-project the coil onto the scalp (clobbering any pose);
 *    by setting the deep-linked `coilPose` LAST, a link carrying both a preset AND a custom pose keeps
 *    the custom pose. (`TMSCoil` also latches `placedSeqRef` to the hydrated pose so its *initial*
 *    auto-placement is skipped — the two together make the custom pose survive in the live app.)
 *  • no-re-render-on-drag (P0 #31) — `installUrlSync` couples to the store through a TRANSIENT
 *    `useStimStore.subscribe` (NOT a React hook) and writes via `history.replaceState` (which fires
 *    neither `hashchange` nor `popstate`), debounced. So a coil drag updates the URL without
 *    re-rendering React and without reallocating the heatmap colour buffer (`allocs` stays 1).
 */
import { useStimStore } from '../store'
import type { StimState } from '../store'
import {
  decodeStateFromParams,
  encodeStateToParams,
  type DeepLinkState,
} from './stateUrl'

type Store = typeof useStimStore

/** The 12 resettable keys, in one place — used to pick the serialisable slice and detect changes. */
const DEEP_LINK_KEYS: readonly (keyof DeepLinkState)[] = [
  'coilPose',
  'intensity',
  'tilt',
  'colormap',
  'showGlyphs',
  'colorSource',
  'fixedScaleExplainer',
  'showFocalityContours',
  'preset',
  'protocol',
  'showTargetCompare',
  'showElectrodeMarkers',
]

/** Extract just the serialisable slice from the full store state. */
export function pickDeepLinkState(s: StimState): DeepLinkState {
  return {
    coilPose: s.coilPose,
    intensity: s.intensity,
    tilt: s.tilt,
    colormap: s.colormap,
    showGlyphs: s.showGlyphs,
    colorSource: s.colorSource,
    fixedScaleExplainer: s.fixedScaleExplainer,
    showFocalityContours: s.showFocalityContours,
    preset: s.preset,
    protocol: s.protocol,
    showTargetCompare: s.showTargetCompare,
    showElectrodeMarkers: s.showElectrodeMarkers,
  }
}

/** True iff any of the 12 deep-link slices changed (coilPose by reference — `setCoilPose` always
 *  makes a fresh object). Lets the sync writer ignore churn from runtime-derived fields (fieldMetrics,
 *  targetCompareMm, placementSeq) and the tour, which must never move the URL. */
export function deepLinkChanged(a: StimState, b: StimState): boolean {
  return DEEP_LINK_KEYS.some((k) => a[k] !== b[k])
}

/**
 * Apply a decoded partial to the store through the normal store actions. H2: `preset` FIRST (it bumps
 * `placementSeq`), then everything else, then `coilPose` LAST so a preset re-snap can't clobber an
 * explicit deep-linked pose. Only the keys present in `decoded` are applied — everything else keeps
 * its default. Idempotent and side-effect-free beyond the store writes.
 */
export function applyDeepLinkState(decoded: Partial<DeepLinkState>, store: Store = useStimStore): void {
  const s = store.getState()
  if (decoded.preset !== undefined) s.setPreset(decoded.preset)
  if (decoded.protocol !== undefined) s.setProtocol(decoded.protocol)
  if (decoded.colormap !== undefined) s.setColormap(decoded.colormap)
  if (decoded.colorSource !== undefined) s.setColorSource(decoded.colorSource)
  if (decoded.intensity !== undefined) s.setIntensity(decoded.intensity)
  if (decoded.tilt !== undefined) s.setTilt(decoded.tilt)
  if (decoded.showGlyphs !== undefined) s.setShowGlyphs(decoded.showGlyphs)
  if (decoded.fixedScaleExplainer !== undefined) s.setFixedScaleExplainer(decoded.fixedScaleExplainer)
  if (decoded.showFocalityContours !== undefined) s.setShowFocalityContours(decoded.showFocalityContours)
  if (decoded.showTargetCompare !== undefined) s.setShowTargetCompare(decoded.showTargetCompare)
  if (decoded.showElectrodeMarkers !== undefined) s.setShowElectrodeMarkers(decoded.showElectrodeMarkers)
  // coilPose LAST — see H2 in the module doc comment.
  if (decoded.coilPose !== undefined) s.setCoilPose(decoded.coilPose)
}

/** Decode the given query string and hydrate the store (H2 order). Returns the decoded partial (for
 *  tests/diagnostics). A malformed or empty query decodes to `{}` and applies nothing → defaults. */
export function hydrateStoreFromUrl(search: string, store: Store = useStimStore): Partial<DeepLinkState> {
  const decoded = decodeStateFromParams(search)
  applyDeepLinkState(decoded, store)
  return decoded
}

/** A minimal view of the bits of `window.location` the sync writer needs (injectable for tests). */
export interface UrlLocation {
  search: string
  pathname: string
  hash: string
}

/**
 * Build the next relative URL for the given state — PURE. Starts from the current query so foreign
 * params survive (the codec deletes only its own keys), omits slices left at their default, and keeps
 * the route in the hash. Returns e.g. `"/?landmarks=1&cmap=turbo#/"`.
 */
export function buildSyncedUrl(state: DeepLinkState, loc: UrlLocation): string {
  const params = encodeStateToParams(state, new URLSearchParams(loc.search))
  const query = params.toString()
  return (query ? `${loc.pathname}?${query}` : loc.pathname) + (loc.hash || '')
}

/** Default debounce for the URL write — long enough that a fast drag coalesces to one write, short
 *  enough that the address bar feels live. */
const SYNC_DEBOUNCE_MS = 250

/**
 * Install the transient, debounced `replaceState` URL sync. Returns an unsubscribe (unused in the app
 * — it lives for the page's lifetime — but handy for tests). Subscribing does NOT re-render React;
 * `replaceState` does NOT navigate or fire `hashchange`/`popstate`, so the heatmap hot path is
 * untouched. The first write happens only after a real deep-link slice changes (e.g. the coil's
 * initial placement, or a control move) — install AFTER hydration so the shared link isn't rewritten
 * on load.
 */
export function installUrlSync(
  store: Store = useStimStore,
  debounceMs: number = SYNC_DEBOUNCE_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = () => {
    if (typeof window === 'undefined') return
    const url = buildSyncedUrl(pickDeepLinkState(store.getState()), {
      search: window.location.search,
      pathname: window.location.pathname,
      hash: window.location.hash,
    })
    window.history.replaceState(window.history.state, '', url)
  }
  return store.subscribe((s, prev) => {
    if (!deepLinkChanged(s, prev)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, debounceMs)
  })
}
