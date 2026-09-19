/**
 * Draggable figure-8 TMS coil (Milestone 3) — the hero interaction.
 *
 * The coil is rendered INSIDE the scene's MNI→Y-up group, so its local transform is in
 * MNI millimetres and equals `store.coilPose` directly (the same frame the M2 solver
 * reasons in — no adapter). Dragging raycasts the pointer against the semi-transparent
 * scalp; the world-space hit is converted back to MNI via the group's `worldToLocal`
 * before `setCoilPose`, so the store + solver stay in MNI mm end-to-end.
 *
 * Coil-pose convention (matches solver/efield.ts): local +z points AWAY from the head
 * (the outward scalp normal); `standoff` lifts the winding plane off the scalp along +z,
 * which is what makes the stand-off gap visible. The figure-8 windings lie in the local
 * z = 0 plane of that lifted body, so the junction (between the two wings) sits directly
 * over the target — where the induced field peaks.
 *
 * Orientation cues (the "wow" read): copper twin windings, a bright junction marker at
 * the field-peak centre, a handle showing in-plane rotation, a stand-off stem bridging
 * scalp→coil, and a footprint ring marking the target projection on the scalp.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Raycaster, Vector2, Vector3 } from 'three'
import type { Group, Mesh } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStimStore } from '../store'
import type { CoilPose, Vec3 } from '../store'
import { bestScalpVertexForTarget, poseFromMNI, presetTarget, tiltLiftMm } from './coilPlacement'
import { isPlaceholderPose } from './useEFieldHeatmap'
import { clearCoilNudge, registerCoilNudge, type CoilAxis } from './coilKeyboardChannel'

/** Visual geometry (mm) — matched to the solver's 70 mm figure-8 defaults (efield.ts). */
const WING_RADIUS = 24
const WING_HALF_SEP = 24 // wing centres at ±24 → the two rings touch at the junction
const WING_TUBE = 3.2

/** Fallback pose if the initial scalp scan can't run (no scalp verts; left-frontal scalp). */
const FALLBACK_POSE: Pick<CoilPose, 'position' | 'rotation'> = {
  position: [-50, 48, 50],
  rotation: [Math.PI / 2, 0, -0.6],
}

interface TMSCoilProps {
  /** The scalp mesh to raycast coil placement against. */
  scalpRef: RefObject<Mesh | null>
  /** The MNI→Y-up group (for world↔MNI conversion). */
  groupRef: RefObject<Group | null>
  /** Brain centroid (MNI mm) — disambiguates the outward scalp normal + aims placement. */
  headCenter: Vec3
}

export function TMSCoil({ scalpRef, groupRef, headCenter }: TMSCoilProps) {
  const coilPose = useStimStore((s) => s.coilPose)
  const setCoilPose = useStimStore((s) => s.setCoilPose)
  const preset = useStimStore((s) => s.preset)
  const placementSeq = useStimStore((s) => s.placementSeq)
  const tilt = useStimStore((s) => s.tilt)

  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null

  const [hovered, setHovered] = useState(false)
  const hoveredRef = useRef(false) // mirror of `hovered` so the drag effect deps stay stable
  const draggingRef = useRef(false)
  /** The `placementSeq` the coil is currently snapped to (-1 until the first placement). */
  const placedSeqRef = useRef<number>(-1)
  /** Whether the load-time fallback pose has been seeded (so we never re-seed it per frame). */
  const fallbackSeededRef = useRef(false)

  // Deep-link guard (V2-4b, #18): if the store already holds a REAL coil pose at mount — a
  // deep-linked pose hydrated before render, NOT the [0,0,0] placeholder — latch `placedSeqRef` to
  // the current `placementSeq` so the initial auto-placement below is SKIPPED and the shared pose is
  // honoured. A normal load boots at the placeholder, so this leaves `placedSeqRef` at -1 and the
  // first F3 projection runs exactly as before; a later setPreset still bumps `placementSeq` → re-snap.
  // One-shot (guarded by `deepLinkGuardRef`) so it never re-evaluates on TMSCoil's per-drag re-renders.
  const deepLinkGuardRef = useRef(false)
  if (!deepLinkGuardRef.current) {
    deepLinkGuardRef.current = true
    const initial = useStimStore.getState()
    if (!isPlaceholderPose(initial.coilPose)) placedSeqRef.current = initial.placementSeq
  }

  // Reused scratch — no per-event allocation.
  const raycaster = useMemo(() => new Raycaster(), [])
  const ndc = useMemo(() => new Vector2(), [])

  /**
   * World-space scalp hit (point + geometry-local normal, which equals MNI here since the
   * scalp mesh is untransformed within the group) → an MNI coil pose.
   */
  const poseFromHit = (
    worldPoint: Vector3,
    mniNormal: Vector3,
  ): Pick<CoilPose, 'position' | 'rotation'> | null => {
    const group = groupRef.current
    if (!group) return null
    const local = group.worldToLocal(worldPoint.clone()) // → MNI mm
    return poseFromMNI([local.x, local.y, local.z], [mniNormal.x, mniNormal.y, mniNormal.z], headCenter)
  }

  // --- preset → on-scalp coil pose (initial placement AND every placement request) ---
  // Deterministic geometry scan (NOT a raycast — a ray through a closed scalp is ambiguous
  // between the near/far crossings): pick the scalp vertex whose direction from the head
  // centroid is most aligned with the active preset's target, and face the coil along its
  // radial (see coilPlacement.ts). This projects a DEEP/cortical target (e.g. the Fox-2012
  // connectivity optimum) OUT onto the scalp instead of sinking the coil inside the head.
  //
  // Gated on `placementSeq` — the store bumps it on every setPreset() and reset(), so this
  // fires once on mount, once per preset change, AND once when the SAME preset is re-selected
  // (re-snapping a dragged coil), but NEVER on a drag (a drag changes coilPose, not the seq).
  // Idle in steady state: this runs every frame only because the scalp geometry loads
  // asynchronously and we must place the coil as soon as its verts decode. Once a request is
  // satisfied it does a single O(1) guard and returns — it issues setCoilPose (and thus a
  // re-solve) ONLY on a new placement request, never per frame (the early-return + fallback latch).
  useFrame(() => {
    if (placedSeqRef.current === placementSeq) return // this placement request already satisfied
    const scalp = scalpRef.current
    const posAttr = scalp?.geometry.getAttribute('position')
    if (!posAttr || posAttr.count === 0) {
      // Scalp still decoding: seed the fallback pose ONCE (never per frame — that would churn
      // setCoilPose and force a re-solve every frame, violating the "recolor only on pose
      // change" invariant), so the coil isn't stranded at the [0,0,0] origin. Leave
      // `placedSeqRef` unadvanced so the real scan still runs once verts arrive.
      if (!fallbackSeededRef.current) {
        setCoilPose(FALLBACK_POSE)
        fallbackSeededRef.current = true
      }
      return
    }

    const best = bestScalpVertexForTarget(
      presetTarget(preset),
      headCenter,
      posAttr.array as ArrayLike<number>,
      posAttr.count,
    )
    if (!best) return
    setCoilPose(
      poseFromMNI(
        best,
        [best[0] - headCenter[0], best[1] - headCenter[1], best[2] - headCenter[2]],
        headCenter,
      ),
    )
    placedSeqRef.current = placementSeq
    fallbackSeededRef.current = false
  })

  // --- drag: window-level pointer move/up so a fast drag never loses the pointer ---
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return
      const scalp = scalpRef.current
      if (!scalp) return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObject(scalp, false)
      if (hits.length === 0 || !hits[0].face) return
      const pose = poseFromHit(hits[0].point, hits[0].face.normal)
      if (pose) setCoilPose(pose)
    }
    const endDrag = (ev: PointerEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (controls) controls.enabled = true
      document.body.style.cursor = hoveredRef.current ? 'grab' : 'auto'
      try {
        gl.domElement.releasePointerCapture(ev.pointerId)
      } catch {
        /* pointer already released */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      // If we unmount mid-drag, don't strand the page in the drag state.
      if (draggingRef.current) {
        draggingRef.current = false
        if (controls) controls.enabled = true
        document.body.style.cursor = 'auto'
      }
    }
  }, [camera, gl, controls, raycaster, ndc, scalpRef, setCoilPose])

  // --- keyboard nudge (V2-5, #15): re-project an MNI-space nudge onto the scalp ---
  // Registers the handler the focusable `CoilKeyboardControl` invokes over `coilKeyboardChannel`.
  // It re-projects through the SAME helpers the drag/preset paths use (bestScalpVertexForTarget →
  // poseFromMNI → setCoilPose), so a keyboard move stays on the scalp and re-solves like any other
  // placement — tilt is composed downstream by the solver, exactly as for a drag. It reads the CURRENT
  // pose (a nudge is relative to where the coil is now) and does NOT bump `placementSeq` (a drag-like
  // move, not a preset re-snap), so a later re-snap doesn't clobber it.
  useEffect(() => {
    const onNudge = (axis: CoilAxis, deltaMm: number): boolean => {
      const scalp = scalpRef.current
      const posAttr = scalp?.geometry.getAttribute('position')
      if (!posAttr || posAttr.count === 0) return false // scene not ready → caller lets the key scroll
      const cur = useStimStore.getState().coilPose.position
      const target: Vec3 = [cur[0], cur[1], cur[2]]
      const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      target[idx] += deltaMm
      const best = bestScalpVertexForTarget(
        target,
        headCenter,
        posAttr.array as ArrayLike<number>,
        posAttr.count,
      )
      if (!best) return false
      // Anatomical-axis nudges re-project by DIRECTION from the head centroid, which is degenerate when
      // the nudge axis aligns with the local surface normal (e.g. Up/Down exactly at the vertex): the
      // projection re-selects the SAME scalp vertex, so the move is a no-op. Report that (→ false) so the
      // control lets the arrow fall through to page-scroll instead of silently eating the keystroke. The
      // other two axes are always well-defined at such a pose, so the coil is never fully stuck.
      const moved =
        Math.hypot(best[0] - cur[0], best[1] - cur[1], best[2] - cur[2]) > 1e-3
      if (!moved) return false
      setCoilPose(
        poseFromMNI(
          best,
          [best[0] - headCenter[0], best[1] - headCenter[1], best[2] - headCenter[2]],
          headCenter,
        ),
      )
      return true
    }
    registerCoilNudge(onNudge)
    return () => clearCoilNudge(onNudge)
  }, [headCenter, scalpRef, setCoilPose])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    draggingRef.current = true
    if (controls) controls.enabled = false // stop OrbitControls fighting the drag
    document.body.style.cursor = 'grabbing'
    try {
      gl.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported */
    }
  }
  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHovered(true)
    hoveredRef.current = true
    if (!draggingRef.current) document.body.style.cursor = 'grab'
  }
  const onPointerOut = () => {
    setHovered(false)
    hoveredRef.current = false
    if (!draggingRef.current) document.body.style.cursor = 'auto'
  }

  // Tilt is applied to the COIL BODY ONLY — a cant about the coil-local +x axis through the junction,
  // plus the effective-distance lift — NOT to the whole group. So the footprint ring + stand-off stem
  // stay rooted on the scalp at the target while the windings cant up. This body transform reproduces
  // composeTilt(coilPose, tilt) EXACTLY (same world winding-plane centre + same cant), so the canted
  // windings drawn here are precisely the ones the solver path solves (useEFieldHeatmap → composeTilt):
  //   body-world(p) = position + R0·(Rx(tilt)·p + (0,0,standoff+lift)) = composeTilt's posed dipole.
  // `tilt` is a separate store scalar, so a preset re-snap (which overwrites coilPose.rotation) keeps it.
  const standoff = coilPose.standoff
  const tiltRad = (tilt * Math.PI) / 180
  const bodyLift = standoff + tiltLiftMm(tilt) // the junction rises as the coil cants (effective distance)
  const accent = hovered ? '#8fb2ff' : '#5b8cff'

  return (
    <group
      position={coilPose.position}
      rotation={coilPose.rotation}
      scale={hovered ? 1.04 : 1}
      onPointerDown={onPointerDown}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {/* Footprint ring on the scalp: where the coil centre projects (the target). */}
      <mesh position={[0, 0, 0.4]} rotation={[0, 0, 0]}>
        <torusGeometry args={[7, 0.7, 12, 40]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
      </mesh>

      {/* Stand-off stem: a visible bridge from scalp (z=0) up to the coil body (z=bodyLift); it
          lengthens as tilt lifts the body further off the scalp (the effective coil-to-cortex gap). */}
      <mesh position={[0, 0, bodyLift / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.1, 1.1, bodyLift, 16]} />
        <meshStandardMaterial color="#aeb9d6" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Coil body, lifted to the (tilt-raised) junction height and canted about the coil-local +x
          axis — the same cant + lift the solver sees via composeTilt. */}
      <group position={[0, 0, bodyLift]} rotation={[tiltRad, 0, 0]}>
        {/* Twin windings (copper); they touch at the junction. */}
        <mesh position={[-WING_HALF_SEP, 0, 0]}>
          <torusGeometry args={[WING_RADIUS, WING_TUBE, 16, 48]} />
          <meshStandardMaterial color="#c4702f" metalness={0.7} roughness={0.33} />
        </mesh>
        <mesh position={[WING_HALF_SEP, 0, 0]}>
          <torusGeometry args={[WING_RADIUS, WING_TUBE, 16, 48]} />
          <meshStandardMaterial color="#c4702f" metalness={0.7} roughness={0.33} />
        </mesh>

        {/* Thin casing disc tying the two wings together. */}
        <mesh position={[0, 0, -WING_TUBE]}>
          <boxGeometry args={[WING_HALF_SEP * 2 + WING_RADIUS, WING_RADIUS * 2, 2.2]} />
          <meshStandardMaterial color="#20283c" roughness={0.6} metalness={0.2} />
        </mesh>

        {/* Junction marker: the field-peak centre, highlighted. */}
        <mesh position={[0, 0, 2]}>
          <sphereGeometry args={[3.6, 20, 20]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={hovered ? 1.1 : 0.7}
          />
        </mesh>

        {/* Handle (orientation cue): points along the in-plane +Y of the coil. */}
        <mesh position={[0, WING_RADIUS + 22, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[4, 4, 44, 20]} />
          <meshStandardMaterial color="#2b3550" roughness={0.55} metalness={0.25} />
        </mesh>
        <mesh position={[0, WING_RADIUS + 47, 0]}>
          <coneGeometry args={[5.2, 12, 20]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.4} />
        </mesh>
      </group>
    </group>
  )
}
