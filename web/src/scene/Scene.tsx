/**
 * The R3F hero scene: orbitable brain + semi-transparent scalp, the draggable figure-8
 * coil, and the live E-field heatmap (Milestones 1 & 3).
 *
 * Orientation is the crux of M1. Meshes are authored in MNI-RAS millimetres
 * (X=Right, Y=Anterior, Z=Superior) and placed under a single group rotated −90° about
 * X to bring them into three.js' Y-up frame. That is a PURE ROTATION (no axis is
 * mirrored / negatively scaled), so left↔right is preserved by construction — superior
 * maps to screen-up and anatomical right stays anatomical right.
 *
 * Keeping mesh coordinates in MNI mm (rather than recentring/normalising) is deliberate:
 * the M2 analytical solver and the M3 coil all reason in MNI millimetres. The coil is
 * rendered INSIDE the same group so its local pose IS `store.coilPose` (MNI mm); the only
 * frame conversion is the drag raycast's world-hit → MNI (see TMSCoil).
 *
 * M3 wiring: the brain `BufferGeometry` is built ONCE here and shared by both the rendered
 * heatmap mesh and the worker (one cortex, ~40k verts — never loaded twice). `?landmarks=1`
 * overlays left (magenta) / right (cyan) DLPFC markers — an orientation self-check.
 */
import { Canvas, useThree } from '@react-three/fiber'
import { Html, OrbitControls, Stats } from '@react-three/drei'
import { Suspense, useEffect, useState, useMemo, useRef, type RefObject } from 'react'
import { Vector3, WebGLRenderer } from 'three'
import type { BufferGeometry, Group, Mesh } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { BrainMesh } from './BrainMesh'
import { ScalpMesh } from './ScalpMesh'
import { TMSCoil } from './TMSCoil'
import { TargetCompare } from './TargetCompare'
import { EFieldGlyphs } from './EFieldGlyphs'
import { ElectrodeMarkers } from './ElectrodeMarkers'
import { PeakMarker } from './PeakMarker'
import { useMeshGeometry } from './useMeshGeometry'
import { useEFieldHeatmap } from './useEFieldHeatmap'
import { ensureColorAttribute } from './HeatmapMaterial'
import { SceneFailure } from './SceneFailure'
import { useStimStore } from '../store'
import { usePrefersReducedMotion } from '../ui/usePrefersReducedMotion'
import type { Colormap, CoilPose, Preset, Vec3 } from '../store'

const BRAIN_URL = '/models/brain.glb'

/** MNI-RAS → three.js Y-up. Pure rotation: superior→up, no L/R mirror. */
const MNI_TO_YUP: [number, number, number] = [-Math.PI / 2, 0, 0]
/** Orbit pivot ≈ cortex centroid expressed in the rotated (three) frame. */
const ORBIT_TARGET: [number, number, number] = [0, 6, 16]

const showLandmarks =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('landmarks')

/** Mean vertex position (MNI mm) — the head centroid the coil uses for placement. */
function brainCentroid(geometry: BufferGeometry): Vec3 {
  const p = geometry.getAttribute('position')
  const n = p.count
  if (n === 0) return [0, 0, 0]
  let sx = 0
  let sy = 0
  let sz = 0
  for (let i = 0; i < n; i++) {
    sx += p.getX(i)
    sy += p.getY(i)
    sz += p.getZ(i)
  }
  return [sx / n, sy / n, sz / n]
}

/** Orientation self-check (?landmarks=1): left DLPFC magenta, right DLPFC cyan, in MNI mm. */
function Landmarks() {
  return (
    <group>
      <mesh position={[-38, 44, 26]}>
        <sphereGeometry args={[6, 24, 24]} />
        <meshBasicMaterial color="#ff3df0" />
      </mesh>
      <mesh position={[38, 44, 26]}>
        <sphereGeometry args={[6, 24, 24]} />
        <meshBasicMaterial color="#3df0ff" />
      </mesh>
    </group>
  )
}

/** Camera position for the default hero view (left-anterolateral, three-frame mm). */
const HERO_POS: [number, number, number] = [-205, 150, -300]

/**
 * Dev-only orientation harness: exposes `window.__setView(name)` so the verification
 * pass can snap to canonical views. Tree-shaken out of production (`import.meta.env.DEV`).
 * three frame: +Y up, +Z posterior / −Z anterior, +X = MNI right.
 */
function ViewRig() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  useEffect(() => {
    const [tx, ty, tz] = ORBIT_TARGET
    const R = 380
    const views: Record<string, [number, number, number]> = {
      front: [tx, ty, tz - R], // anterior — face toward camera
      back: [tx, ty, tz + R],
      left: [tx - R, ty, tz], // MNI left hemisphere
      right: [tx + R, ty, tz], // MNI right hemisphere
      top: [tx, ty + R, tz + 0.001],
      hero: HERO_POS,
    }
    const w = window as unknown as {
      __setView?: (n: string) => void
      __projectMNI?: (mni: [number, number, number]) => { x: number; y: number }
    }
    w.__setView = (name) => {
      const p = views[name]
      if (!p) return
      camera.position.set(p[0], p[1], p[2])
      camera.lookAt(tx, ty, tz)
      controls?.target.set(tx, ty, tz)
      controls?.update()
    }
    // Project an MNI point to viewport pixels (so Playwright can press on the coil). The
    // group's MNI→world map is the fixed −90°-about-X rotation: (x,y,z)→(x,z,−y).
    w.__projectMNI = (mni) => {
      const ndc = new Vector3(mni[0], mni[2], -mni[1]).project(camera)
      const rect = gl.domElement.getBoundingClientRect()
      return {
        x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
      }
    }
    return () => {
      delete w.__setView
      delete w.__projectMNI
    }
  }, [camera, gl, controls])
  return null
}

function Loader() {
  return (
    <Html center>
      <span style={{ color: '#aab3cc', font: '14px system-ui', whiteSpace: 'nowrap' }}>
        Loading model…
      </span>
    </Html>
  )
}

/** The cortex mesh + its live recolor: one shared geometry, color attribute, and worker. */
function HeatmapBrain({ geometry }: { geometry: BufferGeometry }) {
  const colorAttr = useMemo(() => ensureColorAttribute(geometry), [geometry])
  useEFieldHeatmap(geometry, colorAttr)
  return <BrainMesh geometry={geometry} />
}

/**
 * Everything inside the MNI→Y-up group. Loads the brain geometry ONCE (suspends until
 * brain.glb is decoded), then shares it with the heatmap mesh and the coil's scalp
 * raycast target. Also installs the DEV-only `__setCoilPose` hook for verification —
 * Playwright cannot grab a 3D object inside the WebGL canvas, so it drives the coil here.
 */
function SceneContent({
  scalpRef,
  groupRef,
}: {
  scalpRef: RefObject<Mesh | null>
  groupRef: RefObject<Group | null>
}) {
  const geometry = useMeshGeometry(BRAIN_URL)
  const showGlyphs = useStimStore((s) => s.showGlyphs)
  const showElectrodeMarkers = useStimStore((s) => s.showElectrodeMarkers)
  const showFocalityContours = useStimStore((s) => s.showFocalityContours)
  const headCenter = useMemo<Vec3>(
    () => (geometry ? brainCentroid(geometry) : [0, 0, 0]),
    [geometry],
  )

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as {
      __setCoilPose?: (p: Partial<CoilPose>) => void
      __getCoilPose?: () => CoilPose
      __setColormap?: (c: Colormap) => void
      __setColorSource?: (s: 'field' | 'residual') => void
      __setIntensity?: (i: number) => void
      __setPreset?: (p: Preset) => void
      __getPreset?: () => Preset
    }
    const store = useStimStore.getState
    w.__setCoilPose = (p) => store().setCoilPose(p)
    w.__getCoilPose = () => store().coilPose
    w.__setColormap = (c) => store().setColormap(c)
    w.__setColorSource = (s) => store().setColorSource(s)
    w.__setIntensity = (i) => store().setIntensity(i)
    w.__setPreset = (p) => store().setPreset(p)
    w.__getPreset = () => store().preset
    return () => {
      delete w.__setCoilPose
      delete w.__getCoilPose
      delete w.__setColormap
      delete w.__setColorSource
      delete w.__setIntensity
      delete w.__setPreset
      delete w.__getPreset
    }
  }, [])

  if (!geometry) return null
  return (
    <>
      <HeatmapBrain geometry={geometry} />
      <ScalpMesh ref={scalpRef} />
      <TMSCoil scalpRef={scalpRef} groupRef={groupRef} headCenter={headCenter} />
      <TargetCompare scalpRef={scalpRef} headCenter={headCenter} />
      {/* E-field DIRECTION glyphs (v1.2, #1): an arrow layer fed by the worker over the glyph bus,
          mounted only when the toggle is on. It reads no geometry — its MNI-mm positions come from
          the solver — but lives inside this MNI group so those positions land on the cortex. */}
      {showGlyphs && <EFieldGlyphs />}
      {/* Targeting-legibility markers (v2.1, #6/C2): 10-20 dots + a SCHEMATIC DLPFC→sgACC cue.
          Gated here like the glyphs; reuses the scalp ref + head centroid for the projection. */}
      {showElectrodeMarkers && (
        <ElectrodeMarkers scalpRef={scalpRef} headCenter={headCenter} />
      )}
      {/* Iso-contour focality overlay (v2.3, #14): the peak-|E| marker. The cortex is re-coloured
          into "% of this-pose peak" bands by the heatmap hook; this pins the focal hotspot. Gated
          here like the glyphs; the marker rides the peak bus (no React re-render on the drag path). */}
      {showFocalityContours && <PeakMarker headCenter={headCenter} />}
      {showLandmarks && <Landmarks />}
    </>
  )
}

export function Scene() {
  const groupRef = useRef<Group | null>(null)
  const scalpRef = useRef<Mesh | null>(null)
  // Respect the OS "reduce motion" setting: drop OrbitControls' inertial damping (the only
  // continuous animation here). Never affects the disclaimer banner or any content.
  const reducedMotion = usePrefersReducedMotion()
  const [graphicsError, setGraphicsError] = useState<string | null>(null)
  const [capable, setCapable] = useState(false)
  useEffect(() => {
    try {
      const context = document.createElement('canvas').getContext('webgl2')
      if (!context) throw new Error('WebGL2 unavailable')
      context.getExtension('WEBGL_lose_context')?.loseContext()
      setCapable(true)
    } catch { setGraphicsError('WebGL2 is unavailable. Enable hardware acceleration or use a WebGL2-capable browser.') }
  }, [])
  if (graphicsError) return <SceneFailure message={graphicsError} />
  if (!capable) return <p role="status">Checking graphics support…</p>

  return (
    <Canvas
      camera={{ position: HERO_POS, fov: 35, near: 1, far: 6000 }}
      dpr={[1, 2]}
      // `preserveDrawingBuffer: true` keeps the WebGL backbuffer readable AFTER the compositor swaps,
      // which the PNG export (#19) needs — without it `toBlob`/`drawImage` of the canvas yields a blank
      // frame (the buffer is cleared on swap). Tradeoff: the driver can't discard the buffer each frame,
      // so it costs a little extra GPU memory + a copy per frame; negligible for this single static-camera
      // scene and well worth a share-ready snapshot. Nothing else about the Canvas changes.
      gl={(defaults) => {
        try { return new WebGLRenderer({ ...defaults, antialias: true, preserveDrawingBuffer: true }) }
        catch (error) { setGraphicsError('WebGL renderer initialization failed.'); throw error }
      }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault()
          setGraphicsError('The graphics context was lost. Reload to restore the scene.')
        }, { once: true })
      }}
    >
      <color attach="background" args={['#0b1021']} />
      <hemisphereLight args={['#dfe7ff', '#1a2138', 0.7]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[140, 240, 200]} intensity={1.5} />
      <directionalLight position={[-260, 70, -180]} intensity={0.55} color="#9ab4ff" />

      <Suspense fallback={<Loader />}>
        <group ref={groupRef} rotation={MNI_TO_YUP}>
          <SceneContent scalpRef={scalpRef} groupRef={groupRef} />
        </group>
      </Suspense>

      <OrbitControls
        makeDefault
        target={ORBIT_TARGET}
        enableDamping={!reducedMotion}
        enablePan={false}
        minDistance={130}
        maxDistance={1600}
      />
      {import.meta.env.DEV && <Stats />}
      {import.meta.env.DEV && <ViewRig />}
    </Canvas>
  )
}
