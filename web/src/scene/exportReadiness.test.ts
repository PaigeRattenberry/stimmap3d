// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exportScenePng } from './exportPng'
import { useStimStore } from '../store'

beforeEach(() => {
  useStimStore.setState({ solverStatus: 'ready', fieldMetrics: { hvd: 12, spread: 13, peak: 1 } })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); useStimStore.getState().reset() })
it('rejects an unsolved frame even when a canvas exists', async () => {
  useStimStore.setState({ solverStatus: 'loading' })
  expect(await exportScenePng('test.png', document.createElement('canvas'))).toBe(false)
})
it('reports null blobs and synchronous canvas errors as failures', async () => {
  const canvas = document.createElement('canvas')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, fillRect() {}, fillText() {} } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(null))
  expect(await exportScenePng('test.png', canvas)).toBe(false)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('canvas failure') })
  expect(await exportScenePng('test.png', canvas)).toBe(false)
})
it('does not copy a frame whose configuration changed before rendering completed', async () => {
  const draw = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    useStimStore.getState().setTilt(20)
    cb(0); return 1
  })
  expect(await exportScenePng('test.png', document.createElement('canvas'))).toBe(false)
  expect(draw).not.toHaveBeenCalled()
})

it('allows unrelated runtime bookkeeping during the render wait', async () => {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, fillRect() {}, fillText() {} } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(null))
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    useStimStore.getState().setTargetCompareMm(6.3)
    cb(0); return 1
  })
  await exportScenePng('test.png', document.createElement('canvas'))
  expect(drawImage).toHaveBeenCalledOnce()
})
