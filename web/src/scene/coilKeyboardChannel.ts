/**
 * Coil keyboard-nudge bus (V2-5, improvement #15).
 *
 * A tiny module-level command bus connecting the focusable DOM `CoilKeyboardControl` (the producer,
 * outside the WebGL canvas) to `TMSCoil` (the consumer, which owns the scalp mesh + head centroid and
 * the exact preset/drag projection). Keyboard input asks for an MNI-space nudge; `TMSCoil`'s registered
 * handler re-projects it onto the scalp through the SAME pure helpers the drag/preset paths use
 * (`bestScalpVertexForTarget` → `poseFromMNI` → `setCoilPose`), so keyboard control CANNOT bypass the
 * honesty/projection layer — it stays on the scalp and re-solves like any other placement.
 *
 * Deliberately NOT through the Zustand store (mirrors {@link peakChannel}/glyphChannel): it is a
 * one-shot command, not reactive state, and must not add a store-subscription re-render to the coil
 * surface. One consumer (the mounted coil); the producer no-ops gracefully (returns false) when the
 * scene isn't mounted, so the control degrades to its 1–5 preset hotkeys alone.
 */

/** Which MNI axis a nudge moves along: x = left↔right, y = posterior↔anterior, z = inferior↔superior. */
export type CoilAxis = 'x' | 'y' | 'z'

/**
 * The scalp-reprojecting handler `TMSCoil` registers: move the coil `deltaMm` along the MNI `axis`.
 * Returns whether the coil ACTUALLY MOVED — false when the move is a geometric no-op (an
 * anatomical-axis nudge is degenerate when the axis aligns with the local surface normal, e.g. Up/Down
 * exactly at the vertex, where the direction-based projection re-selects the same scalp vertex). The
 * caller uses this to avoid silently eating a keystroke that changed nothing.
 */
export type CoilNudgeHandler = (axis: CoilAxis, deltaMm: number) => boolean

let handler: CoilNudgeHandler | null = null

/** `TMSCoil` registers its scalp-reprojecting nudge handler on mount. */
export function registerCoilNudge(fn: CoilNudgeHandler): void {
  handler = fn
}

/** Drop the handler on unmount (only if it is still the current one — avoids clobbering a remount). */
export function clearCoilNudge(fn: CoilNudgeHandler): void {
  if (handler === fn) handler = null
}

/**
 * Request a coil nudge from the keyboard control. Returns true ONLY if a handler was registered (the
 * scene is mounted) AND the coil actually moved — so the caller can let the keystroke fall through to
 * its default (page scroll) when nothing happened (scene not ready, or a degenerate pole nudge),
 * giving the user feedback instead of a silently-eaten key.
 */
export function nudgeCoil(axis: CoilAxis, deltaMm: number): boolean {
  if (!handler) return false
  return handler(axis, deltaMm)
}
