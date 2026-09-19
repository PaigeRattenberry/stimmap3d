/**
 * Self-check quiz (V2-7b, improvement #21) — retrieval practice on the honesty gates.
 *
 * A small, keyboard-accessible self-test rendered inside the Methods page. It reinforces the four
 * honesty gates a reader most needs to internalise — relative units (not V/m), magnitude (not
 * activation), synthetic outcome data, and odds-ratio-vs-absolute-rate — by asking the reader to
 * retrieve them rather than re-read them.
 *
 * WHY a quiz and not just prose: testing yourself (retrieval practice) durably improves retention
 * more than re-reading the same passage (Roediger & Karpicke 2006, Psychological Science
 * 17(3):249-255, doi:10.1111/j.1467-9280.2006.01693.x) — cited INLINE per the plan (this is a
 * pedagogy rationale, not an app data source, so it is deliberately NOT a citations.json entry).
 *
 * ANSWER KEYS ARE NOT INVENTED: every correct answer restates a claim the app already makes and
 * cites — the gate text in this same Methods page and DESIGN §3.2/§4 — so grading can never
 * contradict a cited fact.
 *
 * A11Y (matches the V2-5 floor): each question is a <fieldset> with its <legend>, options are
 * native radios with associated <label>s (keyboard-operable for free, one tab-stop group each),
 * and the score lands in an aria-live region. Verdicts are prefixed with ✓/✗ text (never
 * colour-only — WCAG 1.4.1). No store coupling, no new dependency.
 */
import { useId, useState } from 'react'

interface QuizOption {
  text: string
  correct?: true
}
interface QuizQuestion {
  /** Stable key for the radio-group `name` and answer map. */
  key: string
  /** The gate this question drills, shown as a small tag. */
  gate: string
  prompt: string
  options: QuizOption[]
  /** Shown after checking — restates the cited fact behind the key. */
  explanation: string
}

const QUESTIONS: QuizQuestion[] = [
  {
    key: 'units',
    gate: 'Units',
    prompt: 'The cortex heatmap shows the induced E-field in…',
    options: [
      { text: 'calibrated volts per metre (V/m)' },
      { text: 'relative units — deliberately not calibrated V/m', correct: true },
      { text: 'millitesla of magnetic flux density' },
    ],
    explanation:
      'The analytical solver outputs relative units only and is never calibrated to V/m — the legend and every readout say so (honesty gate (e)).',
  },
  {
    key: 'activation',
    gate: 'Magnitude',
    prompt: 'A bright hotspot on the heatmap marks…',
    options: [
      { text: 'where neurons are guaranteed to fire' },
      { text: 'the induced-field magnitude — not neural activation', correct: true },
      { text: 'the exact motor threshold at that spot' },
    ],
    explanation:
      'The map shows |E| magnitude. Activation also depends on the field’s direction relative to axons and on thresholds, which this model does not compute.',
  },
  {
    key: 'synthetic',
    gate: 'Data',
    prompt: 'The per-patient symptom trajectories in the dose–response panel are…',
    options: [
      { text: 'real participant records from a clinical trial' },
      { text: 'synthetic, generated from published summary statistics', correct: true },
      { text: 'live data streamed from a clinic' },
    ],
    explanation:
      'Every per-patient trajectory is synthetic (badged “Synthetic”), shaped from published summary statistics — never real patient data (honesty gate (d)).',
  },
  {
    key: 'odds-ratio',
    gate: 'OR vs %',
    prompt: 'A protocol’s odds ratio versus sham…',
    options: [
      { text: 'is the same thing as its absolute response rate' },
      {
        text: 'is relative to sham — it must be converted against a labelled baseline before comparing with absolute rates',
        correct: true,
      },
      { text: 'can be plotted on the same axis as raw response percentages' },
    ],
    explanation:
      'Odds ratios are relative to sham. The panel converts them to probabilities against an explicit, labelled sham baseline and keeps ORs and absolute percentages on separate axes (honesty gate (c); DESIGN §4).',
  },
]

const CORRECT_INDEX = (q: QuizQuestion) => q.options.findIndex((o) => o.correct)

export function SelfCheckQuiz() {
  // answers[key] = selected option index (undefined until the reader picks one).
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [checked, setChecked] = useState(false)
  const groupId = useId()

  const answeredCount = QUESTIONS.filter((q) => answers[q.key] !== undefined).length
  const score = QUESTIONS.filter((q) => answers[q.key] === CORRECT_INDEX(q)).length
  const allAnswered = answeredCount === QUESTIONS.length

  const reset = () => {
    setAnswers({})
    setChecked(false)
  }

  return (
    <section aria-labelledby="self-check" className="self-check">
      <h2 id="self-check">Self-check: did the honest bits land?</h2>
      <p>
        Testing yourself — <em>retrieval practice</em> — cements the caveats better than re-reading
        them (Roediger &amp; Karpicke 2006, <cite>Psychological Science</cite> 17(3):249–255). Four
        quick checks on what this model does and doesn&rsquo;t claim.
      </p>

      <form
        className="self-check__form"
        aria-label="Self-check quiz on the honesty gates"
        onSubmit={(e) => {
          e.preventDefault()
          setChecked(true)
        }}
      >
        {QUESTIONS.map((q, qi) => {
          const selected = answers[q.key]
          const correctIndex = CORRECT_INDEX(q)
          const isCorrect = selected === correctIndex
          return (
            <fieldset className="self-check__q" key={q.key}>
              <legend className="self-check__legend">
                <span className="self-check__num" aria-hidden="true">
                  {qi + 1}.
                </span>{' '}
                <span className="self-check__gate">{q.gate}</span> {q.prompt}
              </legend>
              {q.options.map((opt, oi) => {
                const id = `${groupId}-${q.key}-${oi}`
                return (
                  <div className="self-check__option" key={id}>
                    <input
                      type="radio"
                      id={id}
                      name={`${groupId}-${q.key}`}
                      checked={selected === oi}
                      onChange={() => {
                        setAnswers((a) => ({ ...a, [q.key]: oi }))
                        setChecked(false) // re-answering clears the stale verdict
                      }}
                    />
                    <label htmlFor={id}>{opt.text}</label>
                  </div>
                )
              })}
              {checked && selected !== undefined && (
                <p
                  className={`self-check__verdict self-check__verdict--${isCorrect ? 'ok' : 'no'}`}
                >
                  <strong>{isCorrect ? '✓ Correct.' : '✗ Not quite.'}</strong> {q.explanation}
                </p>
              )}
            </fieldset>
          )
        })}

        <div className="self-check__actions">
          <button type="submit" className="self-check__btn self-check__btn--primary" disabled={!allAnswered}>
            Check answers
          </button>
          <button type="button" className="self-check__btn" onClick={reset}>
            Reset
          </button>
        </div>
      </form>

      {/* Score lands here for screen readers (polite) and sighted users alike. */}
      <p className="self-check__score" role="status" aria-live="polite">
        {checked
          ? `You answered ${score} of ${QUESTIONS.length} correctly.`
          : allAnswered
            ? 'Ready — select “Check answers”.'
            : `Answer all ${QUESTIONS.length} questions, then check.`}
      </p>
    </section>
  )
}
