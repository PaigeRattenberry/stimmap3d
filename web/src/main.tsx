import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { hydrateStoreFromUrl, installUrlSync } from './ui/deepLink'

// Deep-link state-URL (V2-4b, #18). Hydrate the store from the URL query BEFORE React renders, so the
// scene's coil honours a deep-linked pose on its FIRST mount (TMSCoil skips its initial auto-placement
// when a real, non-placeholder pose is already present — see TMSCoil's placedSeqRef guard). Then install
// the transient, debounced replaceState sync — AFTER hydration, so hydration's own setters don't
// immediately rewrite the shared link. Both run exactly once, outside React, off the recolour hot path.
if (typeof window !== 'undefined') {
  hydrateStoreFromUrl(window.location.search)
  installUrlSync()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
