/**
 * Deep-link state-URL (V2-4b, improvement #18) — PURE, DOM-free encode/decode of the resettable
 * store slices to/from a URL query string. The impure glue (read `location.search`, hydrate the
 * store in the H2 order, and the debounced `history.replaceState` sync) lives in `deepLink.ts`;
 * keeping the codec pure makes every key + the malformed-input fallback + the H2 round-trip unit
 * testable with no browser.
 *
 * URL-SCHEME DECISION (documented rationale). State lives in `window.location.search` (a query
 * string BEFORE the `#`), NOT inside the hash. Two reasons:
 *  1. CONSISTENCY — the only pre-existing URL flag in the app, the dev-only `?landmarks` toggle read
 *     in `scene/Scene.tsx`, already lives in `location.search`. One scheme, one place to look.
 *  2. ORTHOGONALITY — `useHashRoute.ts` owns `location.hash` (`#/`, `#/methods`, `#/sources`) and
 *     keys off it alone. Writing the query via `history.replaceState` changes `location.search`
 *     WITHOUT firing `hashchange`/`popstate` and without navigating or reloading, so the router never
 *     re-renders and the heatmap's no-re-render-on-drag invariant (P0 #31) is untouched. A shared
 *     "money-shot" link is therefore `https://host/?<state>#/` — query for state, hash for route.
 *
 * Two acceptance-blocking hazards this module is built around:
 *  • H1 — only the 12 `INITIAL` keys are ever encoded. Runtime-derived fields (`placementSeq`,
 *    `targetCompareMm`, `fieldMetrics`) and the transient tour UI (`tourOpen`, `tourStep`) have NO
 *    param key here and can never reach the URL.
 *  • H2 — the codec is order-free, but the HYDRATION in `deepLink.ts` applies `preset` (which bumps
 *    `placementSeq` → a coil re-snap) BEFORE the explicit `coilPose`, so a link carrying both keeps
 *    the custom pose. See `applyDeepLinkState`.
 */
import { INTENSITY, STANDOFF, TILT, clampDomain, validPosition, normalizeRotation } from '../domains'
import { INITIAL } from '../store'
import type { CoilPose, Colormap, ColorSource, Preset, Protocol, StimState } from '../store'

/** Exactly the resettable slices (the `INITIAL` keys) — the only state a link round-trips. */
export type DeepLinkState = Pick<
  StimState,
  | 'coilPose'
  | 'intensity'
  | 'tilt'
  | 'colormap'
  | 'showGlyphs'
  | 'colorSource'
  | 'fixedScaleExplainer'
  | 'showFocalityContours'
  | 'preset'
  | 'protocol'
  | 'showTargetCompare'
  | 'showElectrodeMarkers'
>

/** Short, stable query-param keys (kept compact for shareable URLs). */
const P = {
  coilPose: 'cp',
  intensity: 'int',
  tilt: 'tilt',
  colormap: 'cmap',
  showGlyphs: 'glyph',
  colorSource: 'src',
  fixedScaleExplainer: 'fixed',
  showFocalityContours: 'contour',
  preset: 'preset',
  protocol: 'proto',
  showTargetCompare: 'cmp',
  showElectrodeMarkers: 'elec',
} as const

/** Every param key this module owns — the sync writer deletes exactly these before re-writing, so
 *  foreign params (e.g. the dev `?landmarks` flag) survive a state change untouched. */
export const STATE_PARAM_KEYS: readonly string[] = Object.values(P)

// Allowed enum values — a decoded value outside its set is rejected (→ default), never applied.
// `COLORMAPS` is derived from a `Record<Colormap, true>` (not a bare array literal) so adding a colormap
// to the union without listing it here is a COMPILE error — the same lock-step the union doc promises,
// matching ControlPanel's COLORMAP_LABELS and HeatmapMaterial's INTERPOLATORS. (#33 review follow-up.)
const COLORMAP_SET: Record<Colormap, true> = { viridis: true, turbo: true, cividis: true }
const COLORMAPS = Object.keys(COLORMAP_SET) as Colormap[]
const COLOR_SOURCES: readonly ColorSource[] = ['field', 'residual']
const PRESETS: readonly Preset[] = ['F3', 'F4', 'Fz', 'Cz', 'connectivity']
const PROTOCOLS: readonly Protocol[] = ['10hz-hf-l', '1hz-lf-r', 'itbs']

/** Round to 3 decimals (sub-micron in mm) so the codec is compact AND round-trip-lossless for any
 *  value already at ≤3 decimals (positions/angles/standoff/intensity/tilt all are in practice). */
const round3 = (n: number): number => Math.round(n * 1000) / 1000

function encodeCoilPose(pose: CoilPose): string {
  const [px, py, pz] = pose.position
  const [rx, ry, rz] = pose.rotation
  return [px, py, pz, rx, ry, rz, pose.standoff].map(round3).join(',')
}

/** Parse exactly 7 finite comma-separated numbers → a CoilPose, else null (malformed → default). */
function parseCoilPose(raw: string): CoilPose | null {
  const tokens = raw.split(',')
  if (tokens.some((s) => s.trim() === '')) return null
  const parts = tokens.map(Number)
  if (parts.length !== 7 || parts.some((n) => !Number.isFinite(n))) return null
  if (!validPosition(parts.slice(0, 3))) return null
  return {
    position: [parts[0], parts[1], parts[2]],
    rotation: normalizeRotation([parts[3], parts[4], parts[5]]),
    standoff: clampDomain(parts[6], STANDOFF, INITIAL.coilPose.standoff),
  }
}

/** A present, non-empty, finite number — else null (so `?int=` or `?int=NaN` degrades to default). */
function parseFiniteNum(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Strict `'1'`/`'0'` boolean — anything else is null (→ default). */
function parseBool(raw: string | null): boolean | null {
  if (raw === '1') return true
  if (raw === '0') return false
  return null
}

function parseEnum<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null
}

/**
 * Encode the resettable slices into a `URLSearchParams`. Only slices that DIFFER from `defaults`
 * (the exported `INITIAL`) are written, so a fresh/default app yields a minimal URL. Pass `base` to
 * merge into an existing query (the sync writer does this so foreign params like `?landmarks`
 * survive); the owned keys are cleared first so a slice reverted to its default disappears.
 */
export function encodeStateToParams(
  state: DeepLinkState,
  base?: URLSearchParams,
  defaults: DeepLinkState = INITIAL,
): URLSearchParams {
  const params = base ?? new URLSearchParams()
  for (const k of STATE_PARAM_KEYS) params.delete(k)

  if (!coilPoseEquals(state.coilPose, defaults.coilPose)) {
    params.set(P.coilPose, encodeCoilPose(state.coilPose))
  }
  if (state.intensity !== defaults.intensity) params.set(P.intensity, String(round3(state.intensity)))
  if (state.tilt !== defaults.tilt) params.set(P.tilt, String(round3(state.tilt)))
  if (state.colormap !== defaults.colormap) params.set(P.colormap, state.colormap)
  if (state.colorSource !== defaults.colorSource) params.set(P.colorSource, state.colorSource)
  if (state.preset !== defaults.preset) params.set(P.preset, state.preset)
  if (state.protocol !== defaults.protocol) params.set(P.protocol, state.protocol)
  if (state.showGlyphs !== defaults.showGlyphs) params.set(P.showGlyphs, state.showGlyphs ? '1' : '0')
  if (state.fixedScaleExplainer !== defaults.fixedScaleExplainer) {
    params.set(P.fixedScaleExplainer, state.fixedScaleExplainer ? '1' : '0')
  }
  if (state.showFocalityContours !== defaults.showFocalityContours) {
    params.set(P.showFocalityContours, state.showFocalityContours ? '1' : '0')
  }
  if (state.showTargetCompare !== defaults.showTargetCompare) {
    params.set(P.showTargetCompare, state.showTargetCompare ? '1' : '0')
  }
  if (state.showElectrodeMarkers !== defaults.showElectrodeMarkers) {
    params.set(P.showElectrodeMarkers, state.showElectrodeMarkers ? '1' : '0')
  }
  return params
}

/**
 * Decode a query string into a `Partial<DeepLinkState>` — only the keys that were PRESENT and VALID.
 * Unknown params are ignored; malformed values (bad number, unknown enum, wrong-arity coilPose) are
 * dropped so the slice falls back to its default. NEVER throws — a bad link degrades to defaults.
 */
export function decodeStateFromParams(search: string): Partial<DeepLinkState> {
  const out: Partial<DeepLinkState> = {}
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  } catch {
    return out
  }

  const cp = params.get(P.coilPose)
  if (cp !== null) {
    const pose = parseCoilPose(cp)
    if (pose) out.coilPose = pose
  }

  const intensity = parseFiniteNum(params.get(P.intensity))
  if (intensity !== null) out.intensity = clampDomain(intensity, INTENSITY, INITIAL.intensity)
  const tilt = parseFiniteNum(params.get(P.tilt))
  if (tilt !== null) out.tilt = clampDomain(tilt, TILT, INITIAL.tilt)

  const colormap = parseEnum(params.get(P.colormap), COLORMAPS)
  if (colormap) out.colormap = colormap
  const colorSource = parseEnum(params.get(P.colorSource), COLOR_SOURCES)
  if (colorSource) out.colorSource = colorSource
  const preset = parseEnum(params.get(P.preset), PRESETS)
  if (preset) out.preset = preset
  const protocol = parseEnum(params.get(P.protocol), PROTOCOLS)
  if (protocol) out.protocol = protocol

  const showGlyphs = parseBool(params.get(P.showGlyphs))
  if (showGlyphs !== null) out.showGlyphs = showGlyphs
  const fixedScaleExplainer = parseBool(params.get(P.fixedScaleExplainer))
  if (fixedScaleExplainer !== null) out.fixedScaleExplainer = fixedScaleExplainer
  const showFocalityContours = parseBool(params.get(P.showFocalityContours))
  if (showFocalityContours !== null) out.showFocalityContours = showFocalityContours
  const showTargetCompare = parseBool(params.get(P.showTargetCompare))
  if (showTargetCompare !== null) out.showTargetCompare = showTargetCompare
  const showElectrodeMarkers = parseBool(params.get(P.showElectrodeMarkers))
  if (showElectrodeMarkers !== null) out.showElectrodeMarkers = showElectrodeMarkers

  return out
}

/** Structural coilPose equality (the codec omits a pose that still equals the default origin). */
export function coilPoseEquals(a: CoilPose, b: CoilPose): boolean {
  return (
    a.standoff === b.standoff &&
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    a.position[2] === b.position[2] &&
    a.rotation[0] === b.rotation[0] &&
    a.rotation[1] === b.rotation[1] &&
    a.rotation[2] === b.rotation[2]
  )
}
