import { afterEach, describe, expect, it } from 'vitest'
import { decodeStateFromParams } from './ui/stateUrl'
import { INITIAL, useStimStore } from './store'
import { INTENSITY, STANDOFF, TILT } from './domains'

afterEach(() => useStimStore.getState().reset())
describe('shared-link and action domains', () => {
  it.each([[-1e300, 0.2, 0], [1e300, 2, 35], [0.2, 0.2, 0.2], [2, 2, 2]])('clamps %s without overflow', (n, intensity, tilt) => {
    expect(decodeStateFromParams(`?int=${encodeURIComponent(n)}&tilt=${encodeURIComponent(n)}`)).toMatchObject({ intensity, tilt })
    useStimStore.getState().setIntensity(n)
    useStimStore.getState().setTilt(n)
    expect(useStimStore.getState()).toMatchObject({ intensity, tilt })
  })
  it('rejects empty tokens, non-finite and remote custom positions', () => {
    for (const cp of [',2,3,4,5,6,7', '1,2,3, ,5,6,7', '1e300,0,0,0,0,0,4', '200,200,200,0,0,0,4', 'NaN,0,0,0,0,0,4']) {
      expect(decodeStateFromParams('?cp=' + cp).coilPose).toBeUndefined()
    }
    expect(decodeStateFromParams('?int=Infinity&tilt=NaN')).toEqual({})
    useStimStore.getState().setCoilPose({ position: [1e300, 0, 0] })
    expect(useStimStore.getState().coilPose.position).toEqual(INITIAL.coilPose.position)
  })
  it('bounds gaps and normalizes rotations while preserving supported boundary values', () => {
    const pose = decodeStateFromParams('?cp=0,0,250,1000000,-1000000,0,-10').coilPose!
    expect(pose.standoff).toBe(STANDOFF.min)
    expect(pose.rotation.every(n => Math.abs(n) <= Math.PI)).toBe(true)
    expect(decodeStateFromParams('?cp=0,0,250,0,0,0,1e300').coilPose?.standoff).toBe(STANDOFF.max)
    expect(decodeStateFromParams(`?int=${INTENSITY.max}&tilt=${TILT.max}`)).toEqual({ intensity: 2, tilt: 35 })
  })
})
