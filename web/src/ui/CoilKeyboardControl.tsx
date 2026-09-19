/**
 * Keyboard coil control (V2-5, improvement #15) — drive the hero gesture without a mouse.
 *
 * The figure-8 coil lives inside the WebGL canvas and isn't focusable, so this is its focusable DOM
 * proxy: a labelled, keyboard-operable region with a visible focus ring (WCAG 2.4.7) that does NOT
 * trap focus (Tab leaves it normally). When focused:
 *  • Arrow keys (and Page Up/Down) NUDGE the coil along the scalp in anatomical MNI axes, routed
 *    through `nudgeCoil` → `TMSCoil`'s scalp re-projection (`bestScalpVertexForTarget`/`poseFromMNI`),
 *    so a keyboard move can't leave the scalp or bypass the projection/honesty layer (the same path a
 *    drag uses; tilt is then composed downstream by the solver, exactly as for a drag).
 *  • Keys 1–5 jump to the five presets via `setPreset` (which re-snaps the coil), like clicking them.
 *
 * The key→action mapping is a PURE, exported helper so the bindings (and the anatomical axis choice)
 * are unit-tested without a DOM. The visible hint documents the keys; `aria-keyshortcuts` exposes them
 * to assistive tech.
 */
import { useCallback, type KeyboardEvent } from 'react'
import { useStimStore } from '../store'
import { PRESETS } from '../data/presets'
import { nudgeCoil, type CoilAxis } from '../scene/coilKeyboardChannel'

/** mm the coil target steps per arrow press (then re-projected onto the nearest scalp direction). */
export const NUDGE_MM = 6

export type CoilKeyAction =
  | { type: 'nudge'; axis: CoilAxis; deltaMm: number }
  | { type: 'preset'; index: number }
  | null

/**
 * Map a key to a coil action — PURE (no DOM/store). Arrows/Page move the MNI target in ANATOMICAL
 * axes (deterministic, not camera-relative): ←/→ = MNI x (left/right), ↑/↓ = MNI z (superior/inferior),
 * PageUp/PageDown = MNI y (anterior/posterior). Digits 1–5 select presets by their grid order.
 */
export function keyToCoilAction(key: string): CoilKeyAction {
  switch (key) {
    case 'ArrowRight':
      return { type: 'nudge', axis: 'x', deltaMm: NUDGE_MM }
    case 'ArrowLeft':
      return { type: 'nudge', axis: 'x', deltaMm: -NUDGE_MM }
    case 'ArrowUp':
      return { type: 'nudge', axis: 'z', deltaMm: NUDGE_MM }
    case 'ArrowDown':
      return { type: 'nudge', axis: 'z', deltaMm: -NUDGE_MM }
    case 'PageUp':
      return { type: 'nudge', axis: 'y', deltaMm: NUDGE_MM }
    case 'PageDown':
      return { type: 'nudge', axis: 'y', deltaMm: -NUDGE_MM }
    default:
      if (key >= '1' && key <= '5') return { type: 'preset', index: Number(key) - 1 }
      return null
  }
}

export function CoilKeyboardControl() {
  const setPreset = useStimStore((s) => s.setPreset)

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Never hijack a modifier chord — Alt+←/Ctrl+PageUp/etc. are browser/OS shortcuts the user
      // expects to keep working even while this control is focused.
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const action = keyToCoilAction(e.key)
      if (!action) return
      if (action.type === 'preset') {
        const p = PRESETS[action.index]
        if (p) {
          e.preventDefault()
          setPreset(p.id)
        }
        return
      }
      // Consume the key (suppress page scroll) ONLY when the coil actually moved. A degenerate pole
      // nudge or a not-yet-mounted scene returns false → the arrow falls through to page-scroll, so the
      // keystroke is never silently eaten with nothing to show for it.
      if (nudgeCoil(action.axis, action.deltaMm)) e.preventDefault()
    },
    [setPreset],
  )

  return (
    <div
      className="coil-kbd"
      role="group"
      aria-label="Keyboard coil control: arrow keys nudge the coil along the scalp; keys 1 to 5 jump to presets"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight PageUp PageDown 1 2 3 4 5"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <span className="coil-kbd__title" aria-hidden="true">
        ⌨ Keyboard coil
      </span>
      <span className="coil-kbd__keys" aria-hidden="true">
        <kbd className="coil-kbd__key">← →</kbd>
        <kbd className="coil-kbd__key">↑ ↓</kbd>
        <kbd className="coil-kbd__key">PgUp/PgDn</kbd>
        <kbd className="coil-kbd__key">1–5</kbd>
      </span>
      <span className="coil-kbd__hint">
        Focus this, then nudge the coil along the scalp with the arrow/page keys, or press 1–5 to jump to
        a preset — every move re-projects onto the scalp, just like dragging.
      </span>
    </div>
  )
}
