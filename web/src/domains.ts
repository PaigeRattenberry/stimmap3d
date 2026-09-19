/** Supported interactive domains, shared by controls, store actions, and shared links. */
export const INTENSITY = { min: 0.2, max: 2 }
export const STANDOFF = { min: 2, max: 20 }
export const TILT = { min: 0, max: 35 }
export function clampDomain(value: number, domain: { min: number; max: number }, fallback: number) {
  return Number.isFinite(value) ? Math.min(domain.max, Math.max(domain.min, value)) : fallback
}
/** Custom MNI poses must remain within 250 mm of the origin; placement is illustrative,
 * not a guarantee of scalp contact. The origin is the preset-placement sentinel. */
export function validPosition(v: readonly number[]) {
  return v.length === 3 && v.every(Number.isFinite) && Math.hypot(...v) <= 250
}
export function normalizeRotation(v: [number, number, number]): [number, number, number] {
  return v.map((n) => (n >= -Math.PI && n <= Math.PI ? n : Math.atan2(Math.sin(n), Math.cos(n)))) as [number, number, number]
}
