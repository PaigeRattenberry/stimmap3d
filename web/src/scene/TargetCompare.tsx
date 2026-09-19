/**
 * F3-vs-connectivity targeting-debate overlay (Milestone 6, improvement #5).
 *
 * Draws the two coil-centre placements — the Beam-F3 scalp site vs the Fox-2012
 * connectivity optimum (a deep cortical point projected OUT onto the scalp) — and the
 * straight-line segment between them, labeled with their live distance. That distance is
 * DERIVED from the same preset coordinates + scalp geometry the coil itself uses
 * (`interTargetScalpDistanceMm` → `bestScalpVertexForTarget`), replacing the previously
 * hard-coded "~6 mm". It is published to the store so `MethodExplainers` can quote it too.
 *
 * Mounted ALWAYS (so the distance is computed for `MethodExplainers` the moment the scalp
 * decodes, regardless of the toggle); the visible markers/line/label render only when
 * `showTargetCompare` is on.
 *
 * HONESTY: the readout is a Euclidean STRAIGHT-LINE chord between the two on-scalp coil
 * centres — not a geodesic along the scalp, and a different quantity from the cited ≈0.65 cm
 * cortical Beam-F3-vs-MRI-neuronavigated discrepancy. Geometry only — no second field solve.
 */
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { useRef, useState, type RefObject } from 'react'
import type { Mesh } from 'three'
import { useStimStore } from '../store'
import type { Preset, Vec3 } from '../store'
import { interTargetScalpDistanceMm, type ScalpTargetGap } from './coilPlacement'

const A_PRESET: Preset = 'F3'
const B_PRESET: Preset = 'connectivity'
const COLOR_A = '#ffb454' // Beam-F3 (warm — matches the heuristic method-card language)
const COLOR_B = '#40c88c' // connectivity (green — matches the connectivity method-card badge)

function Marker({
  at,
  color,
  label,
  labelAt,
}: {
  at: Vec3
  color: string
  label: string
  /** Label anchor offset (mm) — the two markers push their tags apart so both stay readable
   *  even though the targets are only millimetres apart. */
  labelAt: Vec3
}) {
  return (
    <group position={at}>
      <mesh>
        {/* Radius kept below the inter-centre gap (~6 mm) so the two markers read as DISTINCT
            points rather than one merged blob at the scale they depict. */}
        <sphereGeometry args={[3, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
      <Html center distanceFactor={320} position={labelAt}>
        <span className="target-compare__tag" style={{ borderColor: color, color }}>
          {label}
        </span>
      </Html>
    </group>
  )
}

export function TargetCompare({
  scalpRef,
  headCenter,
}: {
  scalpRef: RefObject<Mesh | null>
  headCenter: Vec3
}) {
  const show = useStimStore((s) => s.showTargetCompare)
  const setTargetCompareMm = useStimStore((s) => s.setTargetCompareMm)
  const [gap, setGap] = useState<ScalpTargetGap | null>(null)
  const computedRef = useRef(false)

  // Compute ONCE the scalp verts decode (mirrors TMSCoil's placement latch). headCenter + scalp
  // positions are static after load, so a single O(N) pass on the first ready frame suffices;
  // thereafter the early-return makes this a no-op every frame.
  useFrame(() => {
    if (computedRef.current) return
    const pos = scalpRef.current?.geometry.getAttribute('position')
    if (!pos || pos.count === 0) return
    const result = interTargetScalpDistanceMm(
      A_PRESET,
      B_PRESET,
      headCenter,
      pos.array as ArrayLike<number>,
      pos.count,
    )
    if (!result) return
    computedRef.current = true
    setGap(result)
    setTargetCompareMm(result.mm)
  })

  if (!show || !gap) return null
  const { a, b, mm } = gap
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

  return (
    <group>
      <Line points={[a, b]} color="#e8ecf6" lineWidth={2} dashed dashScale={3} />
      <Marker at={a} color={COLOR_A} label="F3 (Beam-F3)" labelAt={[-14, 16, 0]} />
      <Marker at={b} color={COLOR_B} label="Connectivity" labelAt={[16, -16, 0]} />
      <Html center distanceFactor={340} position={[mid[0], mid[1] + 34, mid[2]]}>
        <div className="target-compare__label">
          <strong>{mm.toFixed(1)} mm</strong> apart
          <span className="target-compare__sub">straight-line · not geodesic</span>
        </div>
      </Html>
    </group>
  )
}
