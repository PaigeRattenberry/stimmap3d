import { useEffect, useState } from 'react'

export type Route = 'app' | 'methods' | 'sources'

export const routeHref: Record<Route, string> = {
  app: '#/',
  methods: '#/methods',
  sources: '#/sources',
}

function parseHash(): Route {
  // Accepts "#/methods" / "#/sources" and the bare "#methods" / "#sources"; anything else
  // resolves to the app view.
  const slug = window.location.hash.replace(/^#\/?/, '').toLowerCase()
  if (slug === 'methods') return 'methods'
  if (slug === 'sources') return 'sources'
  return 'app'
}

/**
 * Tiny dependency-free hash router.
 *
 * Hash routing keeps the live demo a pure static site: deep links resolve
 * client-side with no Cloudflare Pages SPA-fallback config required
 * (see README → Deployment). The Methods/Limitations page lives at `#/methods`.
 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    // Back/Forward can restore an entry whose query was changed by replaceState.
    // Listen to popstate too; Chromium need not emit hashchange for that traversal.
    window.addEventListener('popstate', onChange)
    return () => {
      window.removeEventListener('hashchange', onChange)
      window.removeEventListener('popstate', onChange)
    }
  }, [])

  return route
}
