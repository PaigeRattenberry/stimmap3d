/**
 * Tracks the OS "reduce motion" accessibility setting (Milestone 6 polish). When on, the scene
 * disables OrbitControls' inertial damping (the only continuous motion in the app) and the CSS
 * in index.css neutralises transitions/animations. SSR / no-`matchMedia` safe (defaults false).
 */
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(QUERY).matches
  })

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}
