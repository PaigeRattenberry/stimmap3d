/**
 * Peak-field marker (Milestone v2.3, improvement #14) — a small marker pinned to the focal hotspot
 * (the peak-|E| cortical vertex) for the iso-contour focality overlay. Mounted inside the scene's
 * MNI→Y-up group (so its MNI-mm position lands on the cortex), gated at the mount site by
 * `store.showFocalityContours` (mirrors `EFieldGlyphs`/`ElectrodeMarkers`).
 *
 * HOT PATH — the marker group is moved IMPERATIVELY via the `peakChannel` bus (one allocate-once
 * mesh + label, position mutated in place per field reply), NEVER through React state, so dragging
 * the coil re-positions the marker without re-rendering the React tree. The mesh/material/`Html` are
 * created once on mount; the marker owns no field colour attribute, so `getColorAllocCount()` stays
 * 1. Hidden until the first peak arrives (avoids a one-frame flash at the origin). The peak vertex
 * is the SAME `argmax(|E|)` the depth–dose `FieldMetricsCard` reports as its surface peak.
 */
import { useEffect, useRef } from 'react'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import { applyLatestPeak, registerPeakConsumer, unregisterPeakConsumer } from './peakChannel'
import type { Vec3 } from '../store'

/** DEV-only handle the Playwright verification reads (mirrors `window.__stimHeatmap`/`__stimGlyphs`). */
interface PeakWindow {
  __stimPeak?: {
    readonly active: boolean
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

const MARKER_COLOR = '#ffffff' // a crisp white dot reads as a marker over any colormap band
/** Lift (mm) of the marker off the cortical surface along the outward (head-centre→vertex) normal,
 *  so it sits just proud of the banded heatmap instead of z-fighting it. */
const MARKER_LIFT_MM = 2

export function PeakMarker({ headCenter }: { headCenter: Vec3 }) {
  const groupRef = useRef<Group>(null)
  // Latest applied position, kept in a ref for the DEV handle (no per-frame React state).
  const posRef = useRef({ active: false, x: 0, y: 0, z: 0 })

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.visible = false
    const [cx, cy, cz] = headCenter

    const consumer = (x: number, y: number, z: number) => {
      // Lift along the outward radial (head centroid → vertex) so the marker sits proud of the surface.
      const nx = x - cx
      const ny = y - cy
      const nz = z - cz
      const g = MARKER_LIFT_MM / (Math.hypot(nx, ny, nz) || 1)
      const px = x + nx * g
      const py = y + ny * g
      const pz = z + nz * g
      group.position.set(px, py, pz)
      group.visible = true
      const p = posRef.current
      p.active = true
      p.x = px
      p.y = py
      p.z = pz
    }
    registerPeakConsumer(consumer)
    applyLatestPeak(consumer) // place from the most recent solve, if any (toggle defaults OFF)

    if (import.meta.env.DEV) {
      ;(window as unknown as PeakWindow).__stimPeak = {
        get active() {
          return posRef.current.active
        },
        get x() {
          return posRef.current.x
        },
        get y() {
          return posRef.current.y
        },
        get z() {
          return posRef.current.z
        },
      }
    }

    return () => {
      unregisterPeakConsumer(consumer)
      if (import.meta.env.DEV) delete (window as unknown as PeakWindow).__stimPeak
    }
  }, [headCenter])

  return (
    <group ref={groupRef}>
      {/* Bright unlit dot at the focal hotspot. Default depth-test, so it occludes correctly when the
          peak is on the far side of the head; the small lift keeps it from z-fighting the cortex. */}
      <mesh>
        <sphereGeometry args={[2.6, 20, 20]} />
        <meshBasicMaterial color={MARKER_COLOR} toneMapped={false} />
      </mesh>
      {/* Camera-facing tag, lifted superior to clear the dot. Reuses the small marker-chip style. */}
      <Html center distanceFactor={340} position={[0, 9, 0]}>
        <span className="electrode-tag" style={{ borderColor: MARKER_COLOR }}>
          peak · 100%
        </span>
      </Html>
    </group>
  )
}
