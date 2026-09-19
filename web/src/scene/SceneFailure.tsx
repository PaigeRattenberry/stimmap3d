/**
 * Scene + solver failure/progress feedback.
 *
 *  • `SceneFailure` replaces the 3-D stage when WebGL is unavailable, renderer initialisation fails,
 *    the graphics context is lost, or a mesh fails to load. It marks the solver output invalid
 *    (status 'error', metrics cleared → PNG export refuses) but leaves `solverError` null: the stage
 *    message is the single alert, so `SolverStatus` doesn't announce the same failure twice.
 *  • `SolverStatus` overlays the stage (outside its ErrorBoundary): a solver error as an alert with a
 *    reload action, or — only while NO field has been painted yet — a delayed "Computing field…"
 *    status. It stays silent during a drag, when the previous field is still on screen.
 */
import { useEffect } from 'react'
import { useStimStore } from '../store'

export function SceneFailure({ message = 'The 3-D model or WebGL renderer could not load.' }: { message?: string }) {
  useEffect(() => {
    useStimStore.setState({ solverStatus: 'error', solverError: null, fieldMetrics: null })
  }, [message])
  return <div className="stage-error" role="alert">
    <p className="stage-error__title">The 3-D scene is unavailable.</p>
    <p>{message} Methods and Sources remain available.</p>
    <button type="button" onClick={() => window.location.reload()}>Reload to retry</button>
  </div>
}

export function SolverStatus() {
  const status = useStimStore(s => s.solverStatus)
  const error = useStimStore(s => s.solverError)
  const hasField = useStimStore(s => s.fieldMetrics !== null)
  if (status === 'error') {
    if (!error) return null
    return <div className="solver-status" role="alert">
      <p>{error}</p>
      <button type="button" onClick={() => window.location.reload()}>Reload to retry solver</button>
    </div>
  }
  if (status === 'ready' || hasField) return null
  return <div className="solver-status solver-status--loading" role="status">
    <p>Computing field… Metrics and PNG export will be available when ready.</p>
  </div>
}
