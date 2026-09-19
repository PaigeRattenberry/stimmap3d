// @vitest-environment node
import { normalizeRotation } from '../domains'
import { describe, it, expect } from 'vitest'
import {
  decodeStateFromParams,
  encodeStateToParams,
  STATE_PARAM_KEYS,
  type DeepLinkState,
} from './stateUrl'
import { INITIAL } from '../store'

/**
 * V2-4b deep-link state-URL (#18) — codec contract. Three acceptance-blocking guarantees are pinned
 * here: (1) every one of the 12 resettable keys round-trips losslessly; (2) the 5 runtime-derived
 * fields (H1) can NEVER appear in or be read from a URL; (3) malformed/unknown params degrade to
 * defaults and the decoder never throws. Pure (node env) — no DOM, no store mutation.
 */

// A state where EVERY one of the 12 keys differs from its default, so encode writes (and decode
// reads back) all of them. All numbers are ≤3 decimals so the round3 codec is exactly lossless.
const FULL: DeepLinkState = {
  coilPose: { position: [-12.5, 40.25, 50.125], rotation: [1.5, -0.25, 0.75], standoff: 8 },
  intensity: 1.6,
  tilt: 22,
  colormap: 'turbo',
  showGlyphs: true,
  colorSource: 'residual',
  fixedScaleExplainer: true,
  showFocalityContours: true,
  preset: 'connectivity',
  protocol: 'itbs',
  showTargetCompare: true,
  showElectrodeMarkers: true,
}

describe('stateUrl codec — lossless round-trip (12 keys)', () => {
  it('encodes then decodes every key back to the same value', () => {
    const query = encodeStateToParams(FULL).toString()
    const decoded = decodeStateFromParams(query)
    expect(decoded).toEqual(FULL)
  })

  it('round-trips each key independently (changed-from-default only)', () => {
    for (const [key, value] of Object.entries(FULL) as [keyof DeepLinkState, unknown][]) {
      const query = encodeStateToParams({ ...INITIAL, [key]: value }).toString()
      const decoded = decodeStateFromParams(query)
      expect(decoded[key]).toEqual(value)
    }
  })

  it('omits slices left at their default → a default state yields an empty query', () => {
    expect(encodeStateToParams(INITIAL).toString()).toBe('')
  })

  // V2-5 (#33): cividis is in the Colormap union AND the decoder whitelist, so a ?cmap=cividis link
  // round-trips instead of being silently rejected to the viridis default.
  it('round-trips every non-default colormap, including cividis (#33 lock-step)', () => {
    for (const cmap of ['turbo', 'cividis'] as const) {
      const query = encodeStateToParams({ ...INITIAL, colormap: cmap }).toString()
      expect(query).toContain(`cmap=${cmap}`)
      expect(decodeStateFromParams(query)).toEqual({ colormap: cmap })
    }
  })

  it('preserves foreign params (e.g. the dev ?landmarks flag) when a base is supplied', () => {
    const base = new URLSearchParams('landmarks=1')
    const params = encodeStateToParams({ ...INITIAL, colormap: 'turbo' }, base)
    expect(params.get('landmarks')).toBe('1')
    expect(params.get('cmap')).toBe('turbo')
  })
})

describe('stateUrl codec — H1: runtime-derived fields never travel', () => {
  it('the encoder has no param key for placementSeq / targetCompareMm / fieldMetrics / tourOpen / tourStep', () => {
    const query = encodeStateToParams(FULL).toString()
    for (const banned of ['placementSeq', 'targetCompareMm', 'fieldMetrics', 'tourOpen', 'tourStep']) {
      expect(query).not.toContain(banned)
    }
    // And those names are not among the keys the writer manages.
    for (const banned of ['placementSeq', 'targetCompareMm', 'fieldMetrics', 'tourOpen', 'tourStep']) {
      expect(STATE_PARAM_KEYS).not.toContain(banned)
    }
  })

  it('the decoder ignores runtime-derived params even if a hand-crafted link carries them', () => {
    const decoded = decodeStateFromParams(
      '?placementSeq=9&targetCompareMm=17.3&fieldMetrics=1&tourOpen=1&tourStep=4&cmap=turbo',
    )
    expect(decoded).toEqual({ colormap: 'turbo' }) // only the valid known key survives
    expect('placementSeq' in decoded).toBe(false)
    expect('fieldMetrics' in decoded).toBe(false)
  })
})

describe('stateUrl codec — malformed/unknown input degrades to defaults, never throws', () => {
  it('returns an empty partial for empty / non-query / garbage input', () => {
    expect(decodeStateFromParams('')).toEqual({})
    expect(decodeStateFromParams('?')).toEqual({})
    expect(decodeStateFromParams('not a query at all')).toEqual({})
    expect(decodeStateFromParams('%%%&&&===')).toEqual({})
  })

  it('drops individually-malformed values (bad number, unknown enum, wrong-arity pose, bad bool)', () => {
    const decoded = decodeStateFromParams(
      '?int=abc&tilt=&cmap=rainbow&src=plasma&preset=ZZ&proto=5hz&cp=1,2,3&glyph=maybe&fixed=2',
    )
    expect(decoded).toEqual({})
  })

  it('keeps the valid keys alongside malformed ones', () => {
    const decoded = decodeStateFromParams('?int=abc&cmap=turbo&cp=1,2,3&preset=F4')
    expect(decoded).toEqual({ colormap: 'turbo', preset: 'F4' })
  })

  it('rejects a coilPose that is not exactly 7 finite numbers', () => {
    expect(decodeStateFromParams('?cp=1,2,3,4,5,6').coilPose).toBeUndefined() // 6 parts
    expect(decodeStateFromParams('?cp=1,2,3,4,5,6,7,8').coilPose).toBeUndefined() // 8 parts
    expect(decodeStateFromParams('?cp=1,2,x,4,5,6,7').coilPose).toBeUndefined() // non-finite
    expect(decodeStateFromParams('?cp=1,2,3,4,5,6,7').coilPose).toEqual({
      position: [1, 2, 3],
      rotation: normalizeRotation([4, 5, 6]),
      standoff: 7,
    })
  })
})
