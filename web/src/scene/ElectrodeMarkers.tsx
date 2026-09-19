/**
 * Targeting-legibility markers (V2-1) — an opt-in scene layer that makes
 * the otherwise-abstract coil targets legible:
 *   • instanced dots at the F3/F4/Fz/Cz 10-20 scalp projections, each with a camera-facing label;
 *   • a SCHEMATIC DLPFC→sgACC anticorrelation cue: a dashed line from the cortical DLPFC
 *     connectivity node (-44, 38, 34) down to the deep subgenual-ACC seed (6, 16, -10), conveying
 *     the rationale behind the connectivity preset (stimulate a cortical node to reach a deep
 *     limbic node).
 *
 * HONESTY — the DLPFC→sgACC cue is ILLUSTRATIVE, NOT a computed connectome / tractography. It is
 * a hand-drawn schematic of the Fox-2012 anticorrelation rationale and carries no quantitative
 * connectivity value; the on-screen caption says so. The DLPFC node (-44, 38, 34) and the sgACC
 * seed (6, 16, -10) are factual MNI coordinates (Fox 2012, PMID 22658708 — see citations.json
 * `fox-2012-sgacc-target` / `fox-2012-sgacc-seed`).
 *
 * Mounted inside the scene's MNI→Y-up group (so MNI-mm positions land on the anatomy) and gated at
 * the mount site by `store.showElectrodeMarkers` (mirrors `EFieldGlyphs`). The four scalp dots
 * reuse `bestScalpVertexForTarget` — the SAME radial projection the coil itself uses — and are
 * written into an allocate-once `InstancedMesh`: the instance-matrix buffer is created once at
 * capacity and mutated in place (never per frame, never reallocated). The dots share one material
 * colour (no per-instance `instanceColor`), so `getColorAllocCount()` is unaffected (stays 1) — the
 * heatmap's cortex colour attribute is entirely separate.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { DynamicDrawUsage, Matrix4 } from 'three'
import type { InstancedMesh, Mesh } from 'three'
import { bestScalpVertexForTarget } from './coilPlacement'
import { electrode, FOX_CONNECTIVITY_TARGET, SGACC_SEED } from '../data/presets'
import type { Vec3 } from '../store'

/** The 10-20 scalp sites surfaced as dots (the four committed in electrodes.json). */
const SCALP_SITES: { name: string; label: string }[] = [
  { name: 'F3', label: 'F3' },
  { name: 'F4', label: 'F4' },
  { name: 'Fz', label: 'Fz' },
  { name: 'Cz', label: 'Cz' },
]
/** Instanced-buffer capacity — fixed, allocated once (never grows). */
const MARKER_CAPACITY = SCALP_SITES.length

const ELECTRODE_COLOR = '#7fb0ff' // calm electrode-blue: reads as reference scaffold
const DLPFC_NODE_COLOR = '#ff9e64' // warm coral: the cortical stimulation node
const SGACC_NODE_COLOR = '#b48cff' // violet: the deep limbic seed (destination)
const CUE_COLOR = '#aab3cc' // muted slate: the schematic, non-quantitative cue

const DOT_RADIUS = 2.6 // mm — subtle scaffold dots
const DOT_SURFACE_GAP = 2.5 // mm proud of the scalp so the dots read as pads placed ON the surface
const DLPFC_NODE_RADIUS = 2.6
const SGACC_NODE_RADIUS = 3.2 // slightly larger: the cue's deep endpoint

/** Midpoint of the DLPFC→sgACC cue (MNI mm), where the schematic caption anchors. */
const CUE_MID: Vec3 = [
  (FOX_CONNECTIVITY_TARGET[0] + SGACC_SEED[0]) / 2,
  (FOX_CONNECTIVITY_TARGET[1] + SGACC_SEED[1]) / 2,
  (FOX_CONNECTIVITY_TARGET[2] + SGACC_SEED[2]) / 2,
]

// Reused scratch — the allocate-once discipline (no per-write allocation).
const scratchMat = new Matrix4()

interface ProjectedSite {
  name: string
  label: string
  /** The chosen scalp vertex (MNI mm). */
  pos: Vec3
}

export function ElectrodeMarkers({
  scalpRef,
  headCenter,
}: {
  scalpRef: RefObject<Mesh | null>
  headCenter: Vec3
}) {
  const meshRef = useRef<InstancedMesh>(null)
  const [sites, setSites] = useState<ProjectedSite[] | null>(null)
  const computedRef = useRef(false)

  // Allocate-once: flag the instance-matrix buffer as dynamic-draw and draw nothing until the
  // projection lands (avoids a one-frame flash of identity-matrix dots at the origin).
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.count = 0
  }, [])

  // Project the 10-20 sites onto the scalp ONCE the mesh decodes (mirrors TargetCompare's
  // first-ready-frame latch — scalp positions + headCenter are static after load, so a single
  // O(N) pass per site suffices; thereafter the early-return makes this a no-op every frame).
  useFrame(() => {
    if (computedRef.current) return
    const pos = scalpRef.current?.geometry.getAttribute('position')
    if (!pos || pos.count === 0) return
    const arr = pos.array as ArrayLike<number>
    const projected: ProjectedSite[] = []
    for (const site of SCALP_SITES) {
      const v = bestScalpVertexForTarget(electrode(site.name), headCenter, arr, pos.count)
      if (!v) return // scalp not ready yet; retry next frame
      // Nudge the dot outward along the head-centroid radial so it sits proud of the scalp
      // surface (a pad placed ON the scalp), rather than z-fighting coincident with it.
      const nx = v[0] - headCenter[0]
      const ny = v[1] - headCenter[1]
      const nz = v[2] - headCenter[2]
      const g = DOT_SURFACE_GAP / (Math.hypot(nx, ny, nz) || 1)
      projected.push({
        name: site.name,
        label: site.label,
        pos: [v[0] + nx * g, v[1] + ny * g, v[2] + nz * g],
      })
    }
    computedRef.current = true
    setSites(projected)
  })

  // Write the projected dot positions into the instance matrices IN PLACE once they're known
  // (a pure translation per dot — rotation is irrelevant for a sphere).
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || !sites) return
    for (let i = 0; i < sites.length; i++) {
      const [x, y, z] = sites[i].pos
      scratchMat.makeTranslation(x, y, z)
      mesh.setMatrixAt(i, scratchMat)
    }
    mesh.count = sites.length // draw only the populated instances; the buffer stays full capacity
    mesh.instanceMatrix.clearUpdateRanges()
    mesh.instanceMatrix.addUpdateRange(0, sites.length * 16)
    mesh.instanceMatrix.needsUpdate = true
  }, [sites])

  return (
    <group>
      {/* Instanced 10-20 scalp dots — allocate-once, matrices mutated in place. */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MARKER_CAPACITY]}
        frustumCulled={false}
      >
        <sphereGeometry args={[DOT_RADIUS, 20, 20]} />
        <meshStandardMaterial
          color={ELECTRODE_COLOR}
          emissive={ELECTRODE_COLOR}
          emissiveIntensity={0.7}
        />
      </instancedMesh>

      {/* Electrode name tags — drei Html, camera-facing (`center`) so they read from any orbit
          angle, lifted slightly superior so the tag clears its dot. */}
      {sites?.map((s) => (
        <Html key={s.name} center distanceFactor={340} position={[s.pos[0], s.pos[1] + 9, s.pos[2]]}>
          <span className="electrode-tag" style={{ borderColor: ELECTRODE_COLOR }}>
            {s.label}
          </span>
        </Html>
      ))}

      {/* C2: schematic DLPFC→sgACC anticorrelation cue. Drawn with depth-test OFF + a high render
          order so it floats over the anatomy as an illustrative diagram — reinforcing that it is a
          SCHEMATIC rationale, not a computed connectome. */}
      <Line
        points={[FOX_CONNECTIVITY_TARGET, SGACC_SEED]}
        color={CUE_COLOR}
        lineWidth={1.5}
        dashed
        dashScale={2.5}
        transparent
        opacity={0.85}
        depthTest={false}
        renderOrder={19}
      />
      <mesh position={FOX_CONNECTIVITY_TARGET} renderOrder={20}>
        <sphereGeometry args={[DLPFC_NODE_RADIUS, 20, 20]} />
        <meshBasicMaterial color={DLPFC_NODE_COLOR} depthTest={false} toneMapped={false} />
      </mesh>
      <mesh position={SGACC_SEED} renderOrder={20}>
        <sphereGeometry args={[SGACC_NODE_RADIUS, 20, 20]} />
        <meshBasicMaterial color={SGACC_NODE_COLOR} depthTest={false} toneMapped={false} />
      </mesh>

      {/* The DLPFC node is the "DLPFC label on the relevant frontal site" (it sits over F3). */}
      <Html
        center
        distanceFactor={340}
        position={[FOX_CONNECTIVITY_TARGET[0] - 7, FOX_CONNECTIVITY_TARGET[1] + 2, FOX_CONNECTIVITY_TARGET[2] - 6]}
      >
        <span className="electrode-tag" style={{ borderColor: DLPFC_NODE_COLOR }}>
          DLPFC
        </span>
      </Html>
      <Html
        center
        distanceFactor={340}
        position={[SGACC_SEED[0] + 2, SGACC_SEED[1] - 4, SGACC_SEED[2] - 11]}
      >
        <span className="electrode-tag" style={{ borderColor: SGACC_NODE_COLOR }}>
          sgACC seed
        </span>
      </Html>
      <Html center distanceFactor={350} position={[CUE_MID[0] - 2, CUE_MID[1] + 11, CUE_MID[2]]}>
        <span className="cue-caption">
          <strong>Schematic</strong> DLPFC→sgACC anticorrelation
          <span className="cue-caption__sub">illustrative — not a computed connectome</span>
        </span>
      </Html>
    </group>
  )
}
