/**
 * Methods & Limitations page (honesty gate (b)).
 *
 * The "what it gets wrong" list and the one-line method summary are the verbatim
 * §3.2 text from DESIGN.md — they MUST stay faithful to the source as the app's
 * authoritative statement of what the model does and does not claim.
 *
 * V2-7b (#23/#21) adds the §3.1 math as a visual first-principles DERIVATION FIGURE (a
 * self-contained inline SVG that decomposes −∂A/∂t into the radial part removed and the
 * tangential part kept) — its prose + tangential caveat ship in LOCKSTEP with DESIGN §3.1. That
 * lockstep is enforced from BOTH sides: `App.test.tsx` proves the page renders the phrases, and
 * `MethodsPage.lockstep.test.ts` proves DESIGN.md still contains them (and the {@link METHOD_ONELINER}
 * one-liner verbatim). Plus a keyboard-accessible {@link SelfCheckQuiz} that drills the honesty
 * gates by retrieval practice.
 */
import { CitationLink } from '../ui/CitationLink'
import { SelfCheckQuiz } from './SelfCheckQuiz'

import { METHOD_ONELINER } from './methodSummary'
export { METHOD_ONELINER } from './methodSummary'

export function MethodsPage() {
  return (
    <article className="methods">
      <a className="methods__back" href="#/">
        ← Back to the visualizer
      </a>

      <h1>Methods &amp; Limitations</h1>

      <p className="methods__lede">
        StimMap3D is an <strong>educational, illustrative</strong> tool. It trades anatomical
        accuracy for a real-time, explainable approximation of the TMS-induced electric field.
        This page states, plainly, how the model works and what it gets wrong.
      </p>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works">How the E-field is computed</h2>
        <blockquote className="methods__oneliner">{METHOD_ONELINER}</blockquote>
      </section>

      <section aria-labelledby="derivation">
        <h2 id="derivation">Deriving the spherical approximation</h2>
        <p>
          Here is the whole model, from first principles. The induced field has two parts — a{' '}
          <em>primary</em> term set by the coil current and a <em>secondary</em> term set by charge
          piling up at tissue boundaries:
        </p>
        <p className="derivation__equation" aria-label="E equals minus the time derivative of A minus the gradient of phi">
          <strong>E</strong> = &minus;&part;<strong>A</strong>/&part;t &minus; &nabla;&phi;
        </p>
        <p>
          The secondary term <span className="derivation__nowrap">&minus;&nabla;&phi;</span> is the
          expensive one — solving it exactly is what normally forces a finite-element mesh. The
          spherical approximation sidesteps it with one physical fact: <strong>in a spherically
          symmetric conductor the induced field is purely tangential</strong> — its radial component
          is exactly zero, and the result is independent of the radial conductivity profile (Heller
          &amp; van Hulsteyn 1992; Eaton 1992; Sarvas 1987). So instead of solving{' '}
          <span className="derivation__nowrap">&minus;&nabla;&phi;</span> we simply{' '}
          <strong>subtract the radial component</strong> of the primary field against the best-fit
          sphere&rsquo;s centre.
        </p>

        <figure className="derivation-figure">
          <svg
            className="derivation-svg"
            viewBox="0 0 680 380"
            role="img"
            aria-labelledby="deriv-svg-title deriv-svg-desc"
          >
            <title id="deriv-svg-title">
              Decomposing the induced field into radial and tangential parts on the best-fit sphere
            </title>
            <desc id="deriv-svg-desc">
              A figure-8 coil sits above a spherical head model. At a cortical point P the primary
              induced field is split against the outward surface normal into a radial component,
              which the spherical approximation removes, and a tangential component, which it keeps
              and colours as the heatmap.
            </desc>
            <defs>
              <marker
                id="deriv-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--fg)" />
              </marker>
              <marker
                id="deriv-arrow-accent"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
              </marker>
              <marker
                id="deriv-arrow-warn"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--warn-border)" />
              </marker>
            </defs>

            {/* Best-fit spherical head + its centre O */}
            <circle cx="340" cy="360" r="150" fill="rgba(91,140,255,0.06)" stroke="var(--border)" strokeWidth="1.5" />
            <circle cx="340" cy="360" r="2.5" fill="var(--fg-muted)" />
            <text x="349" y="366" className="derivation-svg__label">O (sphere centre)</text>
            <text x="470" y="330" className="derivation-svg__label derivation-svg__label--muted">
              best-fit sphere
            </text>

            {/* Figure-8 coil glyph, above the surface point */}
            <g transform="translate(255 118)">
              <ellipse cx="-26" cy="0" rx="26" ry="15" fill="none" stroke="var(--fg-muted)" strokeWidth="2" />
              <ellipse cx="26" cy="0" rx="26" ry="15" fill="none" stroke="var(--fg-muted)" strokeWidth="2" />
              <text x="0" y="-26" className="derivation-svg__label derivation-svg__label--muted" textAnchor="middle">
                figure-8 coil
              </text>
            </g>

            {/* Outward normal n̂ (radial direction) from P */}
            <line x1="277" y1="224" x2="247" y2="161" stroke="var(--fg-muted)" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#deriv-arrow)" />
            <text x="214" y="150" className="derivation-svg__label derivation-svg__label--muted">n̂ (radial)</text>

            {/* Radial component (REMOVED) — dashed, warn colour */}
            <line x1="277" y1="224" x2="258" y2="183" stroke="var(--warn-border)" strokeWidth="3" strokeDasharray="5 4" markerEnd="url(#deriv-arrow-warn)" />
            <text x="286" y="188" className="derivation-svg__label derivation-svg__label--warn">
              radial part ✗ removed
            </text>

            {/* Tangential component (KEPT) — solid, accent colour */}
            <line x1="277" y1="224" x2="196" y2="262" stroke="var(--accent)" strokeWidth="3" markerEnd="url(#deriv-arrow-accent)" />
            <text x="150" y="285" className="derivation-svg__label derivation-svg__label--accent">
              tangential part ✓ kept → |E|
            </text>

            {/* Primary induced field E = −∂A/∂t at P */}
            <line x1="277" y1="224" x2="176" y2="221" stroke="var(--fg)" strokeWidth="2" markerEnd="url(#deriv-arrow)" />
            <text x="120" y="212" className="derivation-svg__label">&minus;&part;A/&part;t</text>

            {/* Surface point P */}
            <circle cx="277" cy="224" r="4" fill="var(--fg)" />
            <text x="286" y="232" className="derivation-svg__label">P</text>
          </svg>
          <figcaption className="derivation-figure__caption">
            At each cortical point <strong>P</strong>, the model splits the primary field{' '}
            <span className="derivation__nowrap">&minus;&part;A/&part;t</span> against the outward
            normal <span className="derivation__nowrap">n̂</span> and drops the radial part
            (step&nbsp;4 below): <code>E&nbsp;&minus;=&nbsp;(E·n̂)&nbsp;n̂</code>. What remains is the
            tangential field, whose magnitude becomes the heatmap — in{' '}
            <strong>relative units, never V/m</strong>.
          </figcaption>
        </figure>

        <p>The per-vertex algorithm is exactly those steps:</p>
        <ol className="derivation__steps">
          <li>place the rigid figure-8 dipole array at the coil&rsquo;s pose;</li>
          <li>
            sum each dipole&rsquo;s vector potential to get <strong>A</strong> at every cortical
            vertex;
          </li>
          <li>
            scale by the relative intensity to get the primary field{' '}
            <span className="derivation__nowrap">&minus;&part;A/&part;t</span>;
          </li>
          <li>
            <strong>subtract the radial component</strong> against the sphere centre:{' '}
            <code>E&nbsp;&minus;=&nbsp;(E·n̂)&nbsp;n̂</code>;
          </li>
          <li>take the magnitude <code>|E|</code> and map it through the colour scale.</li>
        </ol>
        <p className="methods__units-note">
          <strong>The honest caveat.</strong> Removing the radial component is a{' '}
          <strong>first-order tangential approximation, not the exact secondary-field solution</strong>:
          the true <span className="derivation__nowrap">&minus;&nabla;&phi;</span> cancels the radial
          part <em>and also</em> reshapes the tangential component, which this model never solves. So
          even inside the sphere the tangential field is approximate — which is exactly why the app
          stays in clearly-labelled <strong>relative units</strong> and offers a self-error map of the
          radial magnitude it throws away (Eaton 1992; see the limitations below).
        </p>
      </section>

      <section aria-labelledby="what-it-gets-wrong">
        <h2 id="what-it-gets-wrong">What this approximation gets wrong</h2>
        <p>The analytical spherical model:</p>
        <ul className="methods__limitations">
          <li>
            <strong>ignores gyral/sulcal folding</strong> (evaluates on a smooth surface; real
            hotspots can be centimeters off),
          </li>
          <li>
            <strong>tissue heterogeneity</strong> (scalp/skull/CSF/gray/white),
          </li>
          <li>
            <strong>CSF current shunting</strong>, and
          </li>
          <li>
            <strong>white-matter anisotropy</strong>;
          </li>
          <li>
            uses an <strong>idealized dipole coil</strong> (~4–10% field error vs. real spiral
            windings, per PLOS ONE 2017);
          </li>
          <li>
            shows <strong>induced E-field magnitude, not neural activation</strong> (which depends
            on field direction relative to axons and on thresholds); and
          </li>
          <li>
            the <strong>single best-fit sphere</strong> degrades away from the coil and in
            non-spherical regions (frontal/temporal poles); and
          </li>
          <li>
            applies a <strong>first-order tangential approximation</strong>: removing the radial
            component of −∂A/∂t cancels the radial field, but the exact secondary −∇φ also
            perturbs the tangential part, which this model never solves (Eaton 1992); and
          </li>
          <li>
            derives its <strong>depth–dose readouts</strong> (half-value depth d½, focal spread
            S½) from this same field — they are
            a <strong>surface-derived approximation</strong> in relative units, not validated
            depths or machine output, and coil tilt is modeled as a larger effective
            coil-to-cortex distance using an authored 0.32 mm/degree lift heuristic, not derived from Deng or Stokes. Stokes describes increased output required to maintain equivalent motor-cortex stimulation at greater distance; no machine-output percentage is calculated here.
          </li>
        </ul>
        <p className="methods__units-note">
          Smooth field and residual colours use the induced field’s histogram estimate of the
          99.9th percentile. Contour bands instead divide the selected scalar by the absolute
          induced-field maximum for that pose. Residual bands are residual / field maximum;
          the marker always indicates the induced-field maximum. Contours take precedence over
          the fixed-scale option.
        </p>
        <p className="methods__units-note">
          Fixed-scale reference v1 is a separate solve at intensity 1: a horizontal coil with zero
          rotation at the brain centroid’s X/Y and 10 mm above its highest Z vertex, with 4 mm
          stand-off and zero tilt. The reference is its absolute surface maximum. This authored
          teaching reference is recomputed from the same mesh at startup and survives shared links
          and route changes. Links share configuration, with pose components rounded to three
          decimals; camera orbit and zoom are not included. Custom poses are limited to 250 mm
          from the MNI origin and are illustrative placements, not guaranteed scalp contact.
        </p>
        <p className="methods__units-note">
          E-field magnitudes are shown in clearly-labeled <strong>relative units</strong>, not
          calibrated V/m. All per-patient outcome trajectories are <strong>synthetic</strong>,
          generated from published summary statistics.
        </p>
        <p className="methods__units-note">
          The optional <strong>self-error map</strong> recolours the cortex with the{' '}
          <strong>radial-removal residual</strong> — the per-vertex magnitude this first-order
          approximation strips out (the radial part of &minus;&part;A/&part;t it cancels). It makes
          the caveat above spatial: the residual is ≈0 directly under the coil, where the induced
          field is tangential, and grows where the single best-fit sphere degrades away from the
          coil (frontal/temporal poles). It is shown in the same <strong>relative units</strong> as
          the heatmap and is an <strong>approximation residual, not a validated error</strong>.
        </p>
        <p className="methods__units-note">
          The optional <strong>E-field direction glyphs</strong> (arrows on the cortex) encode the
          induced field&rsquo;s tangential <strong>direction</strong> in those same relative units —
          its orientation relative to gyral/sulcal geometry co-determines which neural elements are
          engaged (<CitationLink id="bungert-2017-direction" />). The arrows are constant length
          (direction only, never scaled to imply strength) and show{' '}
          <strong>direction, not neural activation</strong>.
        </p>
      </section>

      <section aria-labelledby="colour-scale">
        <h2 id="colour-scale">Reading the colour scale (and colormap choice)</h2>
        <p>
          The heatmap maps the induced field through a colour <strong>lookup table</strong>, always in
          clearly-labelled <strong>relative units</strong> — never calibrated V/m (the same gate that
          governs the legend). Three colormaps are offered, and the choice is itself a data-visualisation
          honesty point for an audience that prints figures:
        </p>
        <ul className="methods__limitations">
          <li>
            <strong>Viridis (default)</strong> — <strong>perceptually uniform</strong>: equal steps in
            field value read as roughly equal steps in perceived lightness, and it stays legible under the
            common forms of colour-vision deficiency. It is the default precisely so the picture is hard to
            misread.
          </li>
          <li>
            <strong>Turbo</strong> — higher contrast, but <strong>not perceptually uniform</strong>: equal
            steps in value are <em>not</em> equal steps in perceived brightness, so a rainbow map like this
            can invent gradients where the field is flat and hide gradients where it is steep. It is offered
            for contrast only, kept <strong>off by default, and is not claimed to be colour-blind-safe</strong>{' '}
            (<CitationLink id="turbo-colormap-google-2019" />).
          </li>
          <li>
            <strong>Cividis</strong> — a perceptually-uniform map <strong>optimised for viewers with
            colour-vision deficiency</strong> (it is near-isoluminant in the red–green channel), so the same
            relative-units field stays faithfully ordered for deuteranopic/protanopic readers (
            <CitationLink id="nunez-2018-cividis" />).
          </li>
        </ul>
        <p className="methods__units-note">
          Switching colormap only re-maps the cached field through a different lookup table — it changes the
          colours, never the underlying <strong>relative-units</strong> values or the per-pose
          normalisation. None of the three implies absolute V/m.
        </p>
      </section>

      <SelfCheckQuiz />

      <section aria-labelledby="sources">
        <h2 id="sources">Sources &amp; licenses</h2>
        <p>
          Every clinical figure and asset cites its open-literature source and license. The
          machine-readable record lives in <code>web/src/data/citations.json</code> and renders
          in full as a browsable, license-badged{' '}
          <a href="#/sources">provenance ledger</a> — every entry with its source link and the
          honest caveats it carries.
        </p>
      </section>
    </article>
  )
}
