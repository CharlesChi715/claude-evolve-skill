// ─────────────────────────────────────────────────────────────────────────────
//  Example 04 · pipeline — per-item assembly lines, no waiting at the gates
//
//  Teaches: pipeline() — multi-STAGE work where each item flows through its
//           stages independently — and the stage-callback signature
//           (prevResult, originalItem, index) that spares you context-threading.
//  Agents spawned: 8  (4 terms × 2 stages, all on haiku)
//  Run: "Run the workflow at examples/04-pipeline.js"
//       (optionally: ... with args {terms: ["mutex", "race condition"]})
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHAT pipeline() is: `pipeline(items, stage1, stage2, ...)` pushes each
//  item through all stages in order — but items DON'T wait for each other.
//  Term A can be in stage 2 while term B is still in stage 1. There is NO
//  barrier between stages.
//
//  WHY that beats chained parallel() calls: with barriers
//  (parallel → parallel), every stage waits for the SLOWEST item of the
//  previous stage. With a pipeline, wall-clock ≈ the slowest single item's
//  full journey, not the sum of slowest-per-stage. Fleets rarely finish in
//  step — pipelines don't make the fast ones idle.
//
//  WHEN you still want a barrier: only when a stage genuinely needs ALL
//  prior results together — synthesis (Example 03), a tournament
//  (Example 07), a convergence vote (evolve's critics). Default: pipeline.

export const meta = {
  name: 'ex04-pipeline',
  description: 'Each term flows explain→quiz independently — assembly lines, not lockstep',
  phases: [{ title: 'Explain' }, { title: 'Quiz' }],
}

let IN = args ?? {}
if (typeof IN === 'string') { try { IN = JSON.parse(IN) } catch { IN = {} } }
const terms = Array.isArray(IN.terms) && IN.terms.length
  ? IN.terms
  : ['thunk', 'barrier', 'idempotent', 'memoization']

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'one multiple-choice question testing the explanation' },
    choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    answerIndex: { type: 'number', minimum: 0, maximum: 3, description: 'index into choices of the correct answer' },
    trap: { type: 'string', description: 'which wrong choice is the tempting one, and why' },
  },
  required: ['question', 'choices', 'answerIndex', 'trap'],
}

log(`Pipelining ${terms.length} terms through explain → quiz`)

//  THE STAGE SIGNATURE — the detail everyone misses. Every stage callback
//  receives (prevResult, originalItem, index):
//    stage 1 gets (the item itself, the item, its index)
//    stage 2 gets (whatever stage 1 returned, STILL the original item, index)
//  So stage 2 below can label its agent with the term WITHOUT stage 1 having
//  to smuggle the term inside its return value. The pipeline threads your
//  context for you.
//
//  GOTCHA: inside pipeline stages, always tag agents with an explicit
//  `phase:` — stages from different items run interleaved, so any notion of
//  "the current phase" is a race. Per-agent tags are race-free. (Same rule
//  evolve-workflow.js follows everywhere.)
//
//  GOTCHA: a stage that throws drops THAT item to null and skips its
//  remaining stages — the other items sail on untouched. Per-item blast
//  radius, not per-run.
const deck = await pipeline(
  terms,
  (term) => agent(
    `Explain "${term}" to a comfortable programmer who has never met the word: ` +
    `intuition first, then the mechanism, then one concrete one-line example. ` +
    `4–6 sentences. Your final message must be the explanation only.`,
    { label: `explain:${term}`, phase: 'Explain', model: 'haiku' }
  ),
  (explanation, term, i) => {
    //  Rule 3 (nulls) inside a pipeline: if this item's stage 1 died,
    //  don't spend a stage-2 agent on nothing — return null and let the
    //  final filter handle it.
    if (!explanation) return null
    log(`term ${i + 1}/${terms.length} ("${term}") entered the quiz stage`)
    return agent(
      `Below is an explanation of "${term}". Write ONE multiple-choice question that ` +
      `tests whether a reader truly got it — the wrong answers must be plausible ` +
      `misunderstandings, not jokes.\n\n--- EXPLANATION ---\n${explanation}`,
      { label: `quiz:${term}`, phase: 'Quiz', model: 'haiku', schema: QUIZ_SCHEMA }
    ).then(quiz => quiz && { term, explanation, quiz })   // bundle item + both stages' work
  }
)

const cards = deck.filter(Boolean)
if (cards.length < terms.length) {
  log(`${terms.length - cards.length} term(s) fell out of the pipeline (agent failures)`)
}

return {
  terms,
  completed: cards.length,
  deck: cards,   // each card: {term, explanation, quiz:{question, choices, answerIndex, trap}}
}

//  TRY: watch /workflows while it runs — you'll catch a quiz agent for one
//  term running WHILE another term is still being explained. That
//  interleaving is the whole point. Then rebuild this with two parallel()
//  calls instead and feel the difference: nothing quizzes until every
//  explanation is done.
