/**
 * Peak-marker data channel (Milestone v2.3, improvement #14).
 *
 * A tiny module-level bus carrying the per-pose PEAK-vertex position (MNI mm) from
 * `useEFieldHeatmap` (which owns the worker + cached field) to the `PeakMarker` mesh — the focal
 * hotspot the iso-contour focality overlay marks. Deliberately NOT through the Zustand store: a
 * per-pose value that updates on every solve must never trigger a React re-render on the drag hot
 * path (the same reason the heatmap mutates its colour attribute imperatively, and the glyph layer
 * rides {@link glyphChannel}). One producer (the heatmap hook), one consumer (the marker, mounted
 * only when the focality overlay is on). The latest position is cached so a marker that mounts LATER
 * (the toggle is OFF by default) jumps to the most recent peak immediately, with no fresh solve.
 */

/** Imperative sink: the peak vertex position in MNI mm. */
export type PeakConsumer = (x: number, y: number, z: number) => void

let consumer: PeakConsumer | null = null
let hasLatest = false
let lx = 0
let ly = 0
let lz = 0

/** Publish the latest peak-vertex position; caches it and, if a marker is mounted, moves it now. */
export function publishPeak(x: number, y: number, z: number): void {
  hasLatest = true
  lx = x
  ly = y
  lz = z
  consumer?.(x, y, z)
}

export function registerPeakConsumer(c: PeakConsumer): void {
  consumer = c
}

export function unregisterPeakConsumer(c: PeakConsumer): void {
  if (consumer === c) consumer = null
}

/** Move `c` to the cached latest peak (if any) — used on mount so toggling the overlay ON places
 *  the marker from the most recent solve without forcing a re-solve. */
export function applyLatestPeak(c: PeakConsumer): void {
  if (hasLatest) c(lx, ly, lz)
}

/** Drop the cached peak when the heatmap unmounts (geometry change): a stale position is in the old
 *  mesh's MNI frame and must not place the marker on a freshly loaded cortex. */
export function clearPeak(): void {
  hasLatest = false
}
