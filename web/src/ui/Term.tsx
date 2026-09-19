/**
 * Glossary term + accessible tooltip (V2-5, improvement #22).
 *
 * Wraps an inline jargon term in a focusable trigger that reveals a curated definition from the
 * finite {@link GLOSSARY} — `<Term id="dlpfc">DLPFC</Term>`. Follows the W3C ARIA APG tooltip
 * pattern: the trigger is keyboard-focusable with a visible focus ring (WCAG 2.4.7), the definition
 * is exposed via `aria-describedby` (so a screen-reader reads it when the term is focused), the
 * tooltip carries `role="tooltip"`, it shows on hover AND focus, and Escape dismisses it.
 *
 * The tooltip element stays in the DOM (hidden with display:none, not unmounted) so the trigger's
 * `aria-describedby` idref always resolves — no dangling reference for axe to flag, and the
 * description is available to AT regardless of the visual show/hide state. No store coupling, no new
 * dependency. If an id somehow isn't in the glossary, it renders the children as plain text (never throws).
 */
import { useId, useState, useRef, useLayoutEffect, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GLOSSARY, type GlossaryId } from './glossary'

export function Term({ id, children }: { id: GlossaryId; children?: ReactNode }) {
  const entry = GLOSSARY[id]
  const tipId = useId()
  // Track hover and focus SEPARATELY so an incidental mouse-leave can't close a tooltip that focus is
  // keeping open (the APG "shows on focus" guarantee). Escape dismisses while focused/hovered; the
  // dismissal resets on the next focus/hover so the tooltip can re-open.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const open = (hovered || focused) && !dismissed

  const trigger = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLSpanElement>(null)
  const [placement, setPlacement] = useState({ left: 8, top: 8 })
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      if (!trigger.current || !tip.current) return
      const rect = trigger.current.getBoundingClientRect()
      const viewport = window.visualViewport
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      tip.current.style.maxWidth = Math.max(16, Math.min(260, width - 16)) + "px"
      const box = tip.current.getBoundingClientRect()
      const leftEdge = viewport?.offsetLeft ?? 0
      const topEdge = viewport?.offsetTop ?? 0
      const bannerBottom = document.querySelector('.app-disclaimer')?.getBoundingClientRect().bottom ?? topEdge
      const top = rect.top - box.height - 6 >= Math.max(topEdge, bannerBottom) + 8
        ? rect.top - box.height - 6 : rect.bottom + 6
      setPlacement({
        left: Math.max(leftEdge + 8, Math.min(rect.left, leftEdge + width - box.width - 8)),
        top: Math.max(topEdge + 8, Math.min(top, topEdge + height - box.height - 8)),
      })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open])

  if (!entry) return <>{children}</>

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setDismissed(true)
    }
  }

  return (
    <span className="term-wrap">
      <button
        type="button"
        ref={trigger}
        className="term"
        aria-describedby={tipId}
        onMouseEnter={() => {
          setHovered(true)
          setDismissed(false)
        }}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => {
          setFocused(true)
          setDismissed(false)
        }}
        onBlur={() => {
          setFocused(false)
          setDismissed(false)
        }}
        onKeyDown={onKeyDown}
      >
        {children ?? entry.term}
      </button>
      {createPortal(<span ref={tip} style={placement} role="tooltip" id={tipId} className={`term__tip${open ? ' term__tip--open' : ''}`}>
        {entry.definition}
      </span>, document.body)}
    </span>
  )
}
