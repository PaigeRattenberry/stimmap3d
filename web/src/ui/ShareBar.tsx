/**
 * Share toolbar (V2-4b) — the pull affordances for the
 * shareable artifacts:
 *  • COPY LINK builds the deep-link URL SYNCHRONOUSLY from the current store (`buildSyncedUrl`), so a
 *    click inside `main.tsx`'s 250 ms address-bar debounce still copies the latest configuration. It
 *    shares the configuration (rounded pose), not the camera orbit/zoom.
 *  • EXPORT PNG saves a slide-ready snapshot (#19) with the non-clinical disclaimer + relative-units
 *    label BAKED INTO the image (gates (a)/(e)). `exportScenePng` resolves only once a READY field
 *    has been captured and the blob created; otherwise the toolbar reports "not ready".
 *  • PRINT HANDOUT (V2-7b, C6) calls `window.print()`, which the `@media print` rules resolve to the
 *    <PrintSummary> one-pager with the interactive chrome hidden.
 *
 * Lives OUTSIDE the R3F `Canvas` and subscribes to NOTHING reactive in the store (it reads state
 * lazily on click), so it never re-renders on a coil drag — the P0 #31 invariant is untouched.
 */
import { useCallback, useState } from 'react'
import { useStimStore } from '../store'
import { buildSyncedUrl } from './deepLink'
import { exportScenePng } from '../scene/exportPng'

type Flash = 'idle' | 'copied' | 'copy-failed' | 'saved' | 'save-failed'

const STATUS_TEXT: Record<Exclude<Flash, 'idle'>, string> = {
  copied: 'Link copied — share this configuration (camera view is not included).',
  'copy-failed': 'Copy blocked — select the address bar to copy the link.',
  saved: 'PNG saved — disclaimer + relative-units label baked in.',
  'save-failed': 'Scene not ready yet — try again in a moment.',
}

export function ShareBar() {
  const [flash, setFlash] = useState<Flash>('idle')

  const flashFor = useCallback((next: Exclude<Flash, 'idle'>) => {
    setFlash(next)
    if (typeof window !== 'undefined') window.setTimeout(() => setFlash('idle'), 2400)
  }, [])

  const copyLink = useCallback(async () => {
    const relative = buildSyncedUrl(useStimStore.getState(), window.location)
    window.history.replaceState(window.history.state, '', relative)
    const url = new URL(relative, window.location.href).href
    try {
      await navigator.clipboard.writeText(url)
      flashFor('copied')
    } catch {
      flashFor('copy-failed')
    }
  }, [flashFor])

  const exportPng = useCallback(async () => {
    flashFor(await exportScenePng('stimmap3d.png') ? 'saved' : 'save-failed')
  }, [flashFor])

  // Opens the browser print dialog; the @media print rules swap the whole app for the <PrintSummary>
  // one-pager. No flash — the browser's own print UI is the feedback, and there's no success/fail here.
  const printHandout = useCallback(() => {
    if (typeof window !== 'undefined') window.print()
  }, [])

  return (
    <div className="share-bar" data-tour="share">
      <button type="button" className="share-btn" onClick={copyLink}>
        <span aria-hidden="true">🔗 </span>Copy link
      </button>
      <button type="button" className="share-btn" onClick={exportPng}>
        <span aria-hidden="true">⬇ </span>Export PNG
      </button>
      <button type="button" className="share-btn" onClick={printHandout}>
        <span aria-hidden="true">🖨 </span>Print handout
      </button>
      <span className="share-bar__status" role="status" aria-live="polite">
        {flash === 'idle' ? '' : STATUS_TEXT[flash]}
      </span>
      <span className="share-bar__hint">
        Share this configuration — a deep link, a slide-ready PNG, or a print-ready one-page summary —
        each carrying the “not&nbsp;for&nbsp;clinical&nbsp;use” + relative-units framing.
      </span>
    </div>
  )
}
