// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyDeepLinkState,
  buildSyncedUrl,
  deepLinkChanged,
  hydrateStoreFromUrl,
  pickDeepLinkState,
} from './deepLink'
import { encodeStateToParams, type DeepLinkState } from './stateUrl'
import { INITIAL, useStimStore } from '../store'
import { isPlaceholderPose } from '../scene/useEFieldHeatmap'

/**
 * V2-4b deep-link hydration + sync (#18). These drive the REAL store (node env, like store.test.ts)
 * to prove the two hazards at the store level: H2 (a preset+coilPose link keeps the custom pose) and
 * the end-to-end encode→hydrate fidelity, plus that a malformed link degrades to defaults and that the
 * URL writer never churns on runtime-derived (non-deep-link) state.
 */

const get = () => useStimStore.getState()

// Every one of the 12 keys non-default (≤3 decimals so the codec is lossless).
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

beforeEach(() => get().reset())
afterEach(() => get().reset())

describe('applyDeepLinkState — H2: preset applied first, explicit coilPose survives the re-snap', () => {
  it('a {preset, coilPose} link keeps the custom pose (not clobbered by the preset bump)', () => {
    const custom = FULL.coilPose
    const seqBefore = get().placementSeq
    applyDeepLinkState({ preset: 'connectivity', coilPose: custom })
    expect(get().preset).toBe('connectivity')
    expect(get().coilPose).toEqual(custom) // the explicit pose wins because it is applied LAST
    expect(get().placementSeq).toBe(seqBefore + 1) // preset was applied (the re-snap request) exactly once
  })

  it('only the keys present in the partial are applied; the rest keep their defaults', () => {
    applyDeepLinkState({ colormap: 'turbo' })
    expect(get().colormap).toBe('turbo')
    expect(get().preset).toBe(INITIAL.preset)
    expect(get().intensity).toBe(INITIAL.intensity)
    expect(get().tilt).toBe(INITIAL.tilt)
  })
})

describe('hydrateStoreFromUrl — end-to-end encode → hydrate fidelity', () => {
  it('hydrates all 12 slices from a query produced by the encoder', () => {
    const query = encodeStateToParams(FULL).toString()
    const decoded = hydrateStoreFromUrl(query)
    expect(decoded).toEqual(FULL)
    expect(pickDeepLinkState(get())).toEqual(FULL)
  })

  it('a malformed link degrades to defaults (applies nothing, never throws)', () => {
    expect(() => hydrateStoreFromUrl('?int=abc&cmap=rainbow&cp=1,2,3&preset=ZZ&glyph=maybe')).not.toThrow()
    expect(pickDeepLinkState(get())).toEqual({
      coilPose: INITIAL.coilPose,
      intensity: INITIAL.intensity,
      tilt: INITIAL.tilt,
      colormap: INITIAL.colormap,
      showGlyphs: INITIAL.showGlyphs,
      colorSource: INITIAL.colorSource,
      fixedScaleExplainer: INITIAL.fixedScaleExplainer,
      showFocalityContours: INITIAL.showFocalityContours,
      preset: INITIAL.preset,
      protocol: INITIAL.protocol,
      showTargetCompare: INITIAL.showTargetCompare,
      showElectrodeMarkers: INITIAL.showElectrodeMarkers,
    })
  })

  it('an empty query is a no-op', () => {
    expect(hydrateStoreFromUrl('')).toEqual({})
    expect(get().colormap).toBe(INITIAL.colormap)
  })
})

describe('deepLinkChanged — only the 12 serialisable slices move the URL', () => {
  it('returns true when a deep-link slice changes', () => {
    const prev = get()
    get().setColormap('turbo')
    expect(deepLinkChanged(prev, get())).toBe(true)
  })

  it('returns false when only a runtime-derived field changes (fieldMetrics must not move the URL)', () => {
    const prev = get()
    get().setFieldMetrics({ hvd: 12.3, spread: 21.7, peak: 4.5 })
    expect(deepLinkChanged(prev, get())).toBe(false)
  })

  it('returns false when only the tour (transient UI) changes', () => {
    const prev = get()
    get().openTour()
    get().nextTourStep()
    expect(deepLinkChanged(prev, get())).toBe(false)
    get().closeTour()
  })
})

describe('buildSyncedUrl — preserves foreign params, omits defaults, keeps the route in the hash', () => {
  it('writes changed slices, keeps ?landmarks, and re-appends the hash route', () => {
    const url = buildSyncedUrl(
      { ...INITIAL, colormap: 'turbo' },
      { search: '?landmarks=1', pathname: '/', hash: '#/' },
    )
    expect(url.startsWith('/?')).toBe(true)
    expect(url.endsWith('#/')).toBe(true)
    expect(url).toContain('landmarks=1') // foreign dev flag survives a state change
    expect(url).toContain('cmap=turbo')
  })

  it('drops the query entirely when every slice is default (but keeps foreign params)', () => {
    expect(buildSyncedUrl(INITIAL, { search: '', pathname: '/', hash: '#/methods' })).toBe('/#/methods')
    expect(buildSyncedUrl(INITIAL, { search: '?landmarks=1', pathname: '/', hash: '' })).toBe(
      '/?landmarks=1',
    )
  })
})

describe('isPlaceholderPose — the TMSCoil deep-link guard depends on this', () => {
  it('is true only for the [0,0,0] origin position (the unplaced sentinel)', () => {
    expect(isPlaceholderPose({ position: [0, 0, 0], rotation: [1, 2, 3], standoff: 4 })).toBe(true)
    expect(isPlaceholderPose({ position: [1, 0, 0], rotation: [0, 0, 0], standoff: 4 })).toBe(false)
    expect(isPlaceholderPose(FULL.coilPose)).toBe(false)
  })
})
