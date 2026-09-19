/**
 * Preset radiogroup (V2-5, improvement #32) — the targeting-preset grid as a proper
 * roving-tabindex `radiogroup` (W3C ARIA APG radio pattern), replacing the old
 * `role="group"` + per-button `aria-pressed` semantics.
 *
 * WHY: a single-select set of one-click placements IS a radio group; `aria-pressed` toggles
 * mis-described it to assistive tech (each button read as an independent on/off toggle). The radio
 * pattern is the correct semantics: ONE tab stop into the group (the checked radio), arrow keys move
 * the selection, `aria-checked` marks the active preset.
 *
 * BEHAVIOUR (unchanged for mouse users): selecting a preset calls the same `setPreset` — which bumps
 * `placementSeq` so the coil re-snaps, even when re-selecting the already-active preset (the existing
 * "snap a dragged coil back" affordance). Selection follows focus (APG radio), and re-selecting the
 * active radio still re-snaps. Visuals (`.preset-grid`/`.preset-btn`) are untouched; only the roles,
 * `aria-checked`, the roving `tabIndex`, and the arrow/Home/End key handling are new.
 */
import { useRef, type KeyboardEvent } from 'react'
import { useStimStore } from '../store'
import { PRESETS } from '../data/presets'

export function PresetRadioGroup() {
  const preset = useStimStore((s) => s.preset)
  const setPreset = useStimStore((s) => s.setPreset)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])

  /** Check the preset at `index` (wrapping) and move DOM focus to it — selection follows focus. */
  const select = (index: number) => {
    const i = ((index % PRESETS.length) + PRESETS.length) % PRESETS.length
    setPreset(PRESETS[i].id) // checks it + re-snaps the coil (placementSeq bump), exactly as before
    btnRefs.current[i]?.focus() // focus() works on a tabIndex=-1 radio; it becomes the tab stop on re-render
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        select(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        select(index - 1)
        break
      case 'Home':
        e.preventDefault()
        select(0)
        break
      case 'End':
        e.preventDefault()
        select(PRESETS.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div className="preset-grid" role="radiogroup" aria-label="Coil placement presets">
      {PRESETS.map((p, i) => {
        const checked = p.id === preset
        return (
          <button
            key={p.id}
            ref={(el) => {
              btnRefs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`preset-btn${checked ? ' preset-btn--active' : ''}`}
            onClick={() => setPreset(p.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            title={p.label}
          >
            {p.shortLabel}
          </button>
        )
      })}
    </div>
  )
}
