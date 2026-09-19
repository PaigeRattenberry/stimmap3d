/**
 * The verbatim gate-(a) lead. Exported as the single source of truth so the PNG-export compositor
 * (V2-4b #19, `scene/exportPng.ts`) bakes the EXACT same non-clinical disclaimer into the shared
 * image that the persistent on-screen banner shows (the banner itself does not travel into a raw
 * WebGL capture). Keep this faithful — `App.test.tsx`'s gate-(a) assertion matches this text.
 */
export const DISCLAIMER_LEAD = 'Illustrative model — not for clinical use.'

/**
 * The disclaimer BODY — the sentence that follows {@link DISCLAIMER_LEAD}. Exported as the SINGLE
 * SOURCE of the gate-(a) prose so the print one-pager ({@link ../panels/PrintSummary PrintSummary})
 * renders the EXACT same text (emphasis and all) the on-screen banner does, instead of a hand-copied
 * paraphrase that could silently drift. Using one shared component — not two strings — makes drift
 * structurally impossible. (The PNG compositor bakes only the LEAD as a raster caption, so it keeps
 * using the {@link DISCLAIMER_LEAD} string; only the two HTML surfaces render this body.)
 */
export function DisclaimerBody() {
  return (
    <>
      StimMap3D shows a deliberately simplified <em>analytical</em> approximation of the TMS-induced
      electric field (not a finite-element simulation of any individual&rsquo;s anatomy) and
      synthetic outcome data. It is not diagnostic, not prescriptive, and not a medical device.
    </>
  )
}

/**
 * Persistent, non-dismissible disclaimer.
 *
 * Rendered once in {@link ../App App}, OUTSIDE the routed view, so it is visible
 * on every screen — honesty gate (a) from DESIGN.md and the
 * "strict clinical guardrails" decision in DESIGN §1.
 */
export function DisclaimerBanner() {
  return (
    <div className="disclaimer-banner" role="alert">
      <span className="disclaimer-banner__icon" aria-hidden="true">
        ⚠️
      </span>
      <p className="disclaimer-banner__text">
        <strong>{DISCLAIMER_LEAD}</strong> <DisclaimerBody />
      </p>
    </div>
  )
}
