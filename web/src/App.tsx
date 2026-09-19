import { lazy, Suspense, useEffect, useRef, type RefObject } from 'react'
import { DisclaimerBanner } from './ui/DisclaimerBanner'
import { useHashRoute, type Route } from './ui/useHashRoute'
import { PrintSummary } from './panels/PrintSummary'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './App.css'

const VisualizerView = lazy(() => import('./VisualizerView').then(m => ({ default: m.VisualizerView })))
const MethodsPage = lazy(() => import('./panels/MethodsPage').then(m => ({ default: m.MethodsPage })))
const SourcesPage = lazy(() => import('./ui/SourcesPage').then(m => ({ default: m.SourcesPage })))
const routeTitle: Record<Route, string> = { app: 'Visualizer', methods: 'Methods & Limitations', sources: 'Sources' }

/** The routed view. A switch (not a ternary) so each route — including `#/sources` — is explicit. */
function RoutedView({ route }: { route: Route }) {
  switch (route) {
    case 'methods':
      return <MethodsPage />
    case 'sources':
      return <SourcesPage />
    default:
      return <VisualizerView />
  }
}

/**
 * Publish the pinned disclaimer banner's MEASURED height as the `--disclaimer-h` custom property on
 * <html>, so CSS that has to reserve space beneath it (`html { scroll-padding-top }`, see App.css)
 * tracks the real banner instead of a guessed constant.
 *
 * WHY MEASURED: the gate-(a) prose is ~330 characters and reflows with viewport width — one line on a
 * wide desktop, ~7 lines (~150px) on a 375px phone — and the banner is `position: sticky`. A constant
 * reserve under-reserves on narrow viewports, so a browser-initiated "reveal" scroll (keyboard focus,
 * find-in-page, an anchor jump) lands the target UNDER the banner: for a keyboard user the focused
 * control is then completely invisible (WCAG 2.4.11, focus-not-obscured). A ResizeObserver on the
 * wrapper fires on exactly the reflows that change the height (resize, font-size media query, zoom).
 *
 * Degrades cleanly: with no ResizeObserver (the `node`/happy-dom test env) the property is simply set
 * once from the initial layout, and CSS falls back to its `5rem` literal if it is never set at all.
 */
function useDisclaimerHeightVar(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof document === 'undefined') return
    const publish = () => {
      const h = el.getBoundingClientRect().height
      if (h > 0) document.documentElement.style.setProperty('--disclaimer-h', `${Math.ceil(h)}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
}

export default function App() {
  const route = useHashRoute()
  const disclaimerRef = useRef<HTMLDivElement | null>(null)
  useDisclaimerHeightVar(disclaimerRef)
  const mainRef = useRef<HTMLElement | null>(null)
  const previousRoute = useRef(route)
  useEffect(() => {
    document.title = routeTitle[route] + ' | StimMap3D'
    if (previousRoute.current !== route) {
      mainRef.current?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
      previousRoute.current = route
    }
  }, [route])

  return (
    <>
      {/* Print-only clinician one-pager (C6): display:none on screen, revealed in @media print with
          the disclaimer + "synthetic" + relative-units framing baked in, so the printed share
          artifact never loses gate (a)/(d)/(e) even though the on-screen banner doesn't print. */}
      <PrintSummary />
      <a className="skip-link" href="#main-content" onClick={event => {
        event.preventDefault()
        mainRef.current?.focus()
        mainRef.current?.scrollIntoView({ block: 'start' })
      }}>Skip to main content</a>

      {/* Wrapper carries the tour's `disclaimer` anchor and pins the banner to the top (sticky, see
          `.app-disclaimer`) so the gate-(a) "not for clinical use" line stays on-screen as the page
          scrolls; the banner itself is untouched (gate (a)). Because it is pinned it floats over the
          content beneath it, so it is deliberately pointer-transparent (it holds nothing clickable) —
          otherwise it would swallow coil drags and orbits aimed at the top strip of the WebGL scene.
          The ref feeds `--disclaimer-h`, the reserve every "scroll something into view" depends on. */}
      <div className="app-disclaimer" data-tour="disclaimer" ref={disclaimerRef}>
        <DisclaimerBanner />
      </div>

      <header className="app-header">
        <a className="app-header__brand" href="#/">
          StimMap3D
        </a>
        <nav className="app-header__nav" aria-label="Primary">
          <a href="#/" aria-current={route === 'app' ? 'page' : undefined}>
            Visualizer
          </a>
          <a
            href="#/methods"
            data-tour="methods-link"
            aria-current={route === 'methods' ? 'page' : undefined}
          >
            Methods &amp; Limitations
          </a>
          <a href="#/sources" aria-current={route === 'sources' ? 'page' : undefined}>
            Sources
          </a>
        </nav>
      </header>

      <main id="main-content" className="app-main" ref={mainRef} tabIndex={-1} aria-label={routeTitle[route]}>
        <ErrorBoundary key={route} label="Page" fallback={<p role="alert">This page could not load. <button onClick={() => window.location.reload()}>Reload</button></p>}>
          <Suspense fallback={<p role="status">Loading {routeTitle[route]}...</p>}>
            <RoutedView route={route} />
          </Suspense>
        </ErrorBoundary>
      </main>

      <footer className="app-footer">
        <span>Educational artifact · synthetic data · analytical (non-FEM) E-field</span>
        <span className="app-footer__links">
          <a href="#/sources">Sources &amp; licenses</a>
          <a href="#/methods">What this gets wrong →</a>
        </span>
      </footer>
    </>
  )
}
