/**
 * First-run onboarding card (Milestone 6 polish, #28).
 *
 * A dismissible "how to drive it + what it is" card. It is ADDITIVE to the persistent
 * disclaimer banner — never a replacement: honesty gate (a) is owned by `DisclaimerBanner` in
 * `App` (outside the route), and this card neither covers nor substitutes for it. Dismissal is
 * remembered in `localStorage`, deliberately NOT the resettable Zustand store, so "Reset to
 * defaults" doesn't resurrect onboarding for a returning user.
 */
import { useState } from 'react'

const STORAGE_KEY = 'stimmap3d:first-run-dismissed:v1'

function initiallyDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false // private mode / storage disabled → just show it (non-blocking)
  }
}

export function FirstRunCard() {
  const [dismissed, setDismissed] = useState(initiallyDismissed)
  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* storage disabled — dismissal just won't persist across reloads */
    }
  }

  return (
    <aside className="first-run-card" aria-label="Getting started">
      <button
        type="button"
        className="first-run-card__close"
        onClick={dismiss}
        aria-label="Dismiss the getting-started card"
      >
        ×
      </button>
      <h2 className="first-run-card__title">New here? Here’s how to drive it</h2>
      <ul className="first-run-card__list">
        <li>
          <strong>Drag the coil</strong> across the scalp — or pick a <strong>preset</strong> —
          and the cortex heatmap recomputes live.
        </li>
        <li>
          <strong>Orbit</strong> by dragging empty space; <strong>scroll</strong> to zoom.
        </li>
        <li>
          Tune <strong>intensity</strong>, <strong>colormap</strong>, and <strong>stand-off</strong>;
          open <strong>Methods &amp; Limitations</strong> for exactly what this model gets wrong.
        </li>
      </ul>
      <p className="first-run-card__note">
        An illustrative model in clearly-labeled relative units, with synthetic outcome data.
      </p>
    </aside>
  )
}
