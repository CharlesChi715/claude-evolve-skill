// ═══════════════════════════════════════════════════════════════════════════
//  evolve-workflow.js — ANNOTATED STUDY COPY
// ═══════════════════════════════════════════════════════════════════════════
//
//  This file is the real evolve-workflow.js with teaching comments woven in.
//  Every CODE line is byte-identical to the original — only comment lines and
//  blank lines were added — so this copy would run exactly the same if you
//  pointed the Workflow tool's scriptPath at it. Read it top to bottom, or
//  jump around via the section banners (§1–§8).
//
//  Comment legend (used throughout):
//    WHAT   — what this piece does, in plain language
//    HOW    — the mechanism, step by step
//    WHY    — the design reason it's built this way
//    GOTCHA — a subtlety that will bite you if you change it casually
//    TRY    — a safe experiment to deepen understanding
//
//  Companion: TEACHING.md in this repo explains the same material in six
//  layered levels; "subtlety N" references below point at its Level 3 list.
//
//  The one-paragraph mental model before you start:
//  This script is a DETERMINISTIC CONDUCTOR. It cannot think — it is ordinary
//  JavaScript run by the Claude Code harness (not by the model). Every
//  `agent(prompt, opts)` call spawns a one-shot AI subagent with a fresh,
//  empty context that answers one prompt and disappears. The algorithm is
//  natural selection for answers: seed two diverse candidates, let a judge
//  crown a champion, then each round critics find flaws, two revisers breed
//  challenger variants, and the champion is replaced only if beaten.
//  Judgment lives in the agents; control flow lives in this code.
//
// ═══════════════════════════════════════════════════════════════════════════
//  §1  THE META BLOCK — the workflow's ID card
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: `meta` names the workflow, describes it for the permission dialog,
//  and pre-declares the phase titles the progress UI (/workflows) will show
//  as group boxes.
//
//  WHY it must be a PURE LITERAL (no variables, no function calls, no
//  template strings): the harness parses it STATICALLY, before executing a
//  single line of the script, to render the permission prompt and phase list.
//  Anything computed would require running the script first — chicken and egg.
//
//  GOTCHA: phase titles are matched EXACTLY (string equality) against the
//  `phase:` tags on agent() calls below. Rename one side and the agents just
//  land in their own unmatched group — no error, only a messier progress tree.
//
//  GOTCHA (subtlety 11): notice the script never CALLS the global phase()
//  function — every agent below carries a per-call `phase:` tag instead.
//  phase() sets one shared "current phase", and with parallel agents in
//  flight that shared state is a race — the tool docs recommend per-agent
//  tags inside parallel/pipeline for exactly this reason. meta.phases up
//  here pre-declares the group boxes; the tags below assign agents to them.

export const meta = {
  name: 'evolve-loop',
  description: 'Two diverse solutions, judge keeps a champion, critique-driven two-variant refinement until converged',
  phases: [
    { title: 'Generate', detail: 'two brains, different stances' },
    { title: 'Critique', detail: 'reader-fit, usefulness, correctness in parallel' },
    { title: 'Refine', detail: 'conservative + bold revisions of the champion' },
    { title: 'Judge', detail: 'champion must be beaten to be replaced' },
  ],
}

// ═══════════════════════════════════════════════════════════════════════════
//  §2  INPUTS — normalize args, fail fast, resolve models   (subtleties 1–2)
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: `args` is a global the runtime injects — whatever Main Claude passed
//  in the Workflow tool call ({ask, profile, models, maxRounds, draft?}).
//  The script has NO other way to receive input: workflow scripts are
//  sandboxed (no filesystem or Node.js APIs — the injected globals are the
//  whole toolkit), which is why Main Claude reads critics.md and passes the
//  profile IN rather than this script reading the file itself.
//
//  GOTCHA (subtlety 1): the harness (Claude Code's runtime — same thing) can
//  deliver args JSON-encoded as a string instead of an object. Without this
//  normalization, `IN.ask` on a string would be undefined and the whole run
//  would chase a ghost question.

// args may arrive absent or JSON-encoded as a string (harness quirk) — normalize, then fail fast
const IN = typeof args === 'string' ? JSON.parse(args) : (args ?? {})

//  WHAT: fail-fast guard. No ask → return an error object immediately, before
//  spending a single agent call.
//
//  WHY the `error` field: this is the script's CONTRACT with SKILL.md Step 3
//  — Main Claude checks "does the result have `error` instead of `final`?"
//  and reports failure rather than presenting a non-answer. A workflow's
//  return value is its only channel back to the caller, so errors travel as
//  data, not exceptions.
if (!IN.ask) {
  return { error: 'args.ask is required — refusing to run agents against an undefined question', rounds: 0, converged: false, driedOut: false, history: [] }
}

//  WHAT: defaults. `??` (nullish coalescing) fills in when the field is
//  absent OR explicitly null/undefined — a real value like maxRounds: 2 or
//  a custom profile passes through.
const MAX_ROUNDS = IN.maxRounds ?? 4
const PROFILE = IN.profile ?? 'A curious practitioner who wants intuitive explanations before jargon and a concrete way to apply the answer.'
const ASK = IN.ask
const MODELS = IN.models ?? {}

//  WHAT: model plumbing (subtlety 2). critics.md's Models section arrives as
//  e.g. {brain: 'inherit', judge: 'haiku', correct: 'inherit', pick: 'inherit'}.
//  resolve() turns a role's value into agent-options: a real name becomes
//  {model: 'haiku'}, while 'inherit' or missing becomes {} — and spreading {}
//  into agent opts (`...brainOpts`) adds nothing, so the agent runs on the
//  session model.
//
//  GOTCHA: in criticOpts, `MODELS[key] ?? MODELS.judge` means a per-critic
//  entry beats the `judge` default — but `??` only fires on undefined/null,
//  NOT on 'inherit'. So `correct: inherit` in critics.md PINS that critic to
//  the session model, whereas OMITTING `correct` lets it fall through to the
//  (usually cheaper) judge default. Two configs that look synonymous, aren't.
//  This is why SKILL.md insists every configured line be passed through,
//  including 'inherit' values.

// 'inherit' or missing -> no override, agent runs on the session model
const resolve = (name) => (name && name !== 'inherit') ? { model: name } : {}
const brainOpts = resolve(MODELS.brain)
const pickOpts = resolve(MODELS.pick)
const criticOpts = (key) => resolve(MODELS[key] ?? MODELS.judge)

// ═══════════════════════════════════════════════════════════════════════════
//  §3  SCHEMAS — structured output as a guardrail          (subtlety 3)
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: passing `schema` in agent opts changes the deal entirely: instead of
//  free text, the runtime FORCES the subagent to answer through a structured-
//  output tool call validated against this JSON Schema — the model retries on
//  mismatch, and agent() resolves to a parsed, validated OBJECT. The script
//  never string-parses a critic's opinion.
//
//  And one easy-to-miss surface: the `description` strings on schema
//  properties are shown to the subagent — they are per-field INSTRUCTIONS,
//  not documentation. The judge's reasons come back as tidy one-liners
//  because pickSchema's reason field literally asks for "one sentence".
//
//  WHY: control flow below branches on these values (`verdicts.every(c =>
//  c.passes)`). Branching on free text ("hmm, did it say it passes?") would
//  put model whim inside the loop conditions — exactly what a deterministic
//  conductor must not do.

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    passes: { type: 'boolean', description: 'true ONLY if zero substantive issues remain' },
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'each issue: what is wrong, where in the answer, and what better looks like',
    },
  },
  required: ['passes', 'issues'],
}

//  WHAT: the judge's verdict schema — built FRESH per judging, from the actual
//  candidate labels in play.
//
//  WHY dynamic (subtlety 3): the `enum` constrains the answer space at the
//  VALIDATION layer, so a 2-way pick physically cannot return 'C', and a
//  hallucinated label is rejected before the script ever sees it. Far
//  stronger than writing "please answer only A or B" in the prompt.

// enum is built from the actual labels so e.g. a 2-way pick cannot return 'C'
const pickSchema = (labels) => ({
  type: 'object',
  properties: {
    winner: { type: 'string', enum: labels, description: 'label of the best candidate' },
    reason: { type: 'string', description: 'one sentence: why it beats the others' },
  },
  required: ['winner', 'reason'],
})

// ═══════════════════════════════════════════════════════════════════════════
//  §4  THE ROLE PROMPTS — three critic lenses, two generator stances
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: LENSES defines the three critics. Each entry's `brief()` builds the
//  prompt; the `key` doubles as the [tag] on issues, the label in the UI, and
//  the per-critic model key in critics.md.
//
//  WHY three DISCLAIMING lenses instead of one "review this" critic: a single
//  critic implicitly trades dimensions off ("wordy but accurate — fine
//  overall"). Each brief here explicitly DISCLAIMS the other critics' turf
//  ("Ignore factual accuracy… other critics own those"), so wordiness has
//  nowhere to hide from `understand`, and charm buys nothing from `correct`.
//  One critic, one dimension, no horse-trading.
//
//  Note the role-play move in `understand`: "You ARE the reader… critique in
//  first person". The critic doesn't evaluate readability in the abstract —
//  it simulates YOUR reader (the critics.md profile) stumbling in real time.
//
//  GOTCHA: brief() is a function (a closure over PROFILE and ASK), not a
//  precomputed string — the prompt is assembled at spawn time. With const
//  bindings this is equivalent, but it keeps the array declaration-order-
//  independent and cheap until used.
//
//  TRY: add a fourth lens, e.g. `concise` (flags only redundancy). The loop
//  below never hardcodes "3" — it checks against LENSES.length — so a fourth
//  entry (plus optionally a `concise:` model line in critics.md) just works.

const LENSES = [
  {
    key: 'understand',
    brief: () =>
      `You ARE the reader described in this profile — critique in first person, as them:\n` +
      `${PROFILE}\n\n` +
      `Read the answer below top to bottom ONCE, the way a human reads. Flag every point ` +
      `where you would stumble, reread, or give up: jargon used before it is explained, ` +
      `missing intuition or mental model, steps assuming knowledge this profile does not have, ` +
      `walls of text, important things buried at the bottom. Ignore factual accuracy, and ` +
      `ignore whether the ask's TOPICS are fully covered — other critics own those. DO ` +
      `enforce this profile's structural and presentation preferences (ordering, examples, ` +
      `how-to-try ending). passes=true only if this reader follows the whole answer ` +
      `comfortably in one pass.`,
  },
  {
    key: 'useful',
    brief: () =>
      `Judge ONLY whether the answer serves the ask. The reader asked:\n"${ASK}"\n\n` +
      `Check: every explicit part of the ask is addressed; implicit needs are met; the ` +
      `answer is actionable — the reader can DO the thing, not just nod along; nothing ` +
      `missing that forces an immediate follow-up question. You own topic coverage relative ` +
      `to the ask ONLY; ignore writing style and the reader's presentation preferences — ` +
      `another critic owns those. passes=true only if the reader would not need to ask for more.`,
  },
  {
    key: 'correct',
    brief: () =>
      `Judge ONLY factual and technical correctness of the answer below: claims, code, ` +
      `commands, names of tools and APIs. A convincing answer that is wrong is the worst ` +
      `outcome. Flag anything false, code that would not run as shown, and confident ` +
      `statements that are actually uncertain. Ignore style and coverage. passes=true only ` +
      `if every checkable claim holds up.`,
  },
]

//  WHAT: the two Round-0 generator stances — the initial gene pool.
//
//  WHY: diversity is ENGINEERED via the prompt, not left to sampling luck.
//  Two unconstrained "answer this" calls tend to produce two similar takes on
//  the same idea; pushing one agent toward compact-and-direct and the other
//  toward didactic-and-thorough guarantees the judge has a real choice to
//  make about what serves this reader.
//
//  TRY: add a third stance ('skeptical: lead with what usually goes wrong')
//  and trace Round 0 to find why its answer would be silently DROPPED: only
//  the generation fan-out maps over STANCES — the whole if/else after the
//  parallel() call is wired for exactly two (the `const [direct, thorough]`
//  destructure, the hardcoded two-entry `labeled` array, the two-way champion
//  ternary, and the one-failure fallback branch). Generalizing that block to
//  N stances is the real exercise; pickSchema already takes labels
//  dynamically, so the judge side needs nothing.

const STANCES = [
  { key: 'direct', text: 'Direct and minimal: answer in the most straightforward, compact way that still fully serves the ask.' },
  { key: 'thorough', text: 'Thorough and didactic: build intuition first, use a concrete example, cover what the reader will need right after.' },
]

// ═══════════════════════════════════════════════════════════════════════════
//  §5  THE JUDGE — comparative selection with an incumbent   (subtleties 6–7)
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: judgePreamble frames every pick: the judge role-plays the reader
//  profile and chooses which candidate serves that reader best.
//
//  WHY comparison, not scoring: the judge is never asked "rate this 1–10" —
//  absolute scores from language models are noisy and drift between calls.
//  "Which of these is better for this reader?" is a relative judgment models
//  are far more consistent at. The whole champion mechanic exists to convert
//  "is it good?" into "did anything beat it?".
//
//  WHY the incumbent clause (subtlety 7): without "prefer it unless a
//  revision is a real improvement", every round would crown a cosmetically
//  reworded 'winner' and the answer would DRIFT without improving. The bias
//  is deliberately toward stability over churn. Honest caveat: it will
//  occasionally reject a genuinely-better bold rewrite that reads as taste —
//  that's the accepted price.
//
//  Note "Judge content only — ignore the order candidates appear in": half of
//  the position-bias defense; the other half is the PERMS rotation in §7.

const judgePreamble = (championLabel) =>
  `You judge as this reader:\n${PROFILE}\n\nThey asked:\n"${ASK}"\n\n` +
  `Pick the candidate that serves this reader best overall: easiest for them to understand, ` +
  `best coverage of the ask, and correct. Judge content only — ignore the order candidates ` +
  `appear in.\n` +
  (championLabel
    ? `Candidate ${championLabel} is the current champion (the unchanged incumbent). Prefer it ` +
      `unless a revision is a real improvement — cosmetic rewording that adds no value must ` +
      `not beat the champion.\n\n`
    : `\n`)

//  WHAT: pick() runs one tournament. `labeled` is an array of triples
//  [label, name, text] — e.g. ['A', 'conservative', '<full answer text>'] —
//  so the judge sees neutral labels (A/B/C) while the script keeps the
//  meaningful names. It returns {name, reason}, never the raw text.
//
//  HOW, line by line:
//  - championEntry: find the incumbent among the candidates (if any — Round 0
//    has none, so judgePreamble gets undefined and omits the incumbent
//    clause). `([, name]) =>` destructures a triple, skipping the label.
//  - the prompt: preamble + each candidate fenced between ---CANDIDATE X---
//    markers so long answers can't bleed into each other.
//  - schema: pickSchema(labels) — the enum-of-actual-labels guardrail from §3.
//  - `...pickOpts`: the tournament judge's model override from critics.md
//    ('pick' role — comparing whole answers is hard; keep it strong).
//
//  GOTCHA (subtlety 7, second half): the fallback line. agent() returns null
//  if the judge call fails, and v?.winner may match nothing. The fallback is
//  championEntry ?? labeled[0] — the INCUMBENT, never an unjudged revision.
//  When the referee doesn't show up, nobody wins by default. (labeled[0] only
//  matters in Round 0, where there is no incumbent yet.)

const pick = async (labeled, tag) => {
  const championEntry = labeled.find(([, name]) => name === 'champion')
  const v = await agent(
    judgePreamble(championEntry?.[0]) +
    labeled.map(([label, , text]) => `---CANDIDATE ${label}---\n${text}\n---END ${label}---`).join('\n\n'),
    { label: `pick:${tag}`, phase: 'Judge', schema: pickSchema(labeled.map(([label]) => label)), ...pickOpts }
  )
  // on judge failure fall back to the incumbent, never to an unjudged revision
  const hit = labeled.find(([label]) => label === v?.winner) ?? championEntry ?? labeled[0]
  return { name: hit[1], reason: v?.reason ?? `judge unavailable — defaulted to ${hit[1]}` }
}

// ═══════════════════════════════════════════════════════════════════════════
//  §6  ROUND 0 — seed the population, crown a champion
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: `history` is the audit trail (returned at the end; Main Claude
//  narrates it to you — SKILL.md Step 3). `champion` is the ONLY continuity
//  in the whole system: agents are stateless one-shot calls, so the current
//  best answer lives here, in a script variable, between rounds.
//
//  The `IN.draft ?? null` line is the `/evolve last answer` path: when Main
//  Claude passes an existing answer as args.draft, it becomes the champion
//  directly and the entire `if (!champion)` generate block is skipped.

const history = []
let champion = IN.draft ?? null

// Round 0 — generate two diverse solutions, judge picks the starting champion
if (!champion) {

  //  WHAT: spawn both generators CONCURRENTLY. parallel() takes THUNKS —
  //  `() => agent(...)`, functions that don't start until called — so the
  //  runtime controls the launch, and it's a BARRIER: it waits for both to
  //  finish. A failed agent becomes null in the results; parallel() itself
  //  never throws.
  //
  //  WHY a barrier is legitimate here: the very next step is a tournament,
  //  and a tournament needs ALL contenders present. (The Workflow docs push
  //  pipeline() by default because barriers waste wall-clock — this script is
  //  the textbook exception, three times over: §6 pick, §7 critics, §7 pick.)
  //
  //  Note each prompt's last instruction: "Your final message must be the
  //  complete answer and nothing else." Subagents are told their final text
  //  IS the return value — one chatty "Here's your answer!" preamble would
  //  become part of the champion text forever.
  const cands = await parallel(STANCES.map(s => () =>
    agent(
      `Answer the ask below for this reader — match their preferences:\n${PROFILE}\n\n` +
      `Stance for this attempt: ${s.text}\n\n` +
      `Your final message must be the complete answer and nothing else.\n\nAsk:\n"${ASK}"`,
      { label: `generate:${s.key}`, phase: 'Generate', ...brainOpts }
    )
  ))

  //  WHAT: null-tolerant unpacking (subtlety 9). Three cases:
  //  - both alive → run the first tournament; winner becomes champion.
  //  - exactly one alive → `direct ?? thorough` picks the survivor; it wins
  //    unopposed (and history records which stance it was).
  //  - both dead → champion stays null; caught right below.
  const [direct, thorough] = cands
  if (direct && thorough) {
    const labeled = [[ 'A', 'direct', direct ], [ 'B', 'thorough', thorough ]]
    const verdict = await pick(labeled, 'r0')
    champion = verdict.name === 'direct' ? direct : thorough
    history.push({ round: 0, event: `initial pick: ${verdict.name}`, reason: verdict.reason })
    log(`Round 0: '${verdict.name}' stance wins — ${verdict.reason}`)
  } else {
    champion = direct ?? thorough
    history.push({ round: 0, event: `one generator failed; '${direct ? 'direct' : 'thorough'}' champion unopposed` })
    log('Round 0: one generator failed; the other becomes champion unopposed')
  }
}

//  WHAT: the both-generators-dead exit — same error-as-data contract as §2.
//  There is nothing to refine, so say so and stop before the loop burns
//  critic calls on nothing.
if (!champion) {
  return { error: 'both generators failed; nothing to refine', rounds: 0, converged: false, driedOut: false, history }
}

// ═══════════════════════════════════════════════════════════════════════════
//  §7  THE EVOLUTION LOOP — critique → breed → tournament   (subtleties 4–10)
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: PERMS (subtlety 6) — three orderings of the same three contenders.
//  Each round uses PERMS[round % 3], so which SLOT (A, B, or C) the champion
//  occupies rotates round to round.
//
//  WHY: AI judges statistically favor candidates by position (often first or
//  last). If the champion always sat in slot A, "prefer the champion" plus
//  first-position bias would compound into near-unbeatable incumbency. The
//  rotation spreads position luck evenly; the prompt's "ignore the order"
//  line handles the rest.

// permutations for 3-way judging, rotated per round to counter position bias
const PERMS = [
  ['champion', 'conservative', 'bold'],
  ['conservative', 'bold', 'champion'],
  ['bold', 'champion', 'conservative'],
]

//  WHAT: the loop's three state variables:
//  - round: counts UP toward MAX_ROUNDS (the token-budget backstop).
//  - dry (subtlety 8): counts rounds where a CONTEST happened but produced
//    no new champion — the incumbent won the tournament, or both revisers
//    died so no tournament could be held. Zero-issue retry rounds (Step 2½)
//    skip past it untouched, so the two increments need not be adjacent
//    rounds. dry reaching 2 → stop: we're at a local optimum; more rounds
//    burn tokens, not quality. Any successful replacement resets it to 0.
//  - converged: set only when ALL critics pass — the genuinely-done ending.

let round = 0
let dry = 0
let converged = false

while (round < MAX_ROUNDS) {
  round++

  //  ── Step 1: critique through three lenses, concurrently ──
  //
  //  WHAT: one agent per lens, each getting its brief plus the champion text
  //  between ---BEGIN/END ANSWER--- fences. `...criticOpts(l.key)` applies
  //  the per-critic model from critics.md (falling back to the `judge`
  //  default — remember the 'inherit' pinning gotcha from §2).
  //
  //  The original comment below says it plainly: this barrier is intentional.
  //  Convergence is defined as "ALL critics pass", which you cannot know
  //  until all verdicts are in.

  // Barrier is intentional: convergence needs ALL critics' verdicts together.
  const critiques = await parallel(LENSES.map(l => () =>
    agent(
      l.brief() + `\n\n---BEGIN ANSWER---\n` + champion + `\n---END ANSWER---`,
      { label: `critique:${l.key}:r${round}`, phase: 'Critique', schema: CRITIQUE_SCHEMA, ...criticOpts(l.key) }
    )
  ))

  //  GOTCHA (subtlety 5): map BEFORE filter. While the array index still
  //  lines up with LENSES, each verdict is stamped with its critic's key —
  //  THEN nulls (failed critics) are dropped. Filter first and the indexes
  //  shift: issues get attributed to the wrong critic. The [tag]'s consumer
  //  is the revisers, who see which lens raised each issue. (History stores
  //  only issue COUNTS — the tagged strings themselves never leave the loop.)

  // map before filter to keep index alignment with LENSES, so issues stay attributed to their critic
  const verdicts = critiques.map((c, i) => c ? { critic: LENSES[i].key, ...c } : null).filter(Boolean)
  const issues = verdicts.flatMap(c => c.issues.map(msg => `[${c.critic}] ${msg}`))

  //  ── Step 2: converged? ──
  //
  //  GOTCHA (subtlety 4): the vacuous-truth footgun. In JavaScript,
  //  [].every(...) is TRUE — an empty list "all passes" by definition. If all
  //  three critics crashed, `verdicts.every(c => c.passes)` alone would
  //  declare convergence on ZERO evidence. Hence the double condition:
  //  every lens must have RESPONDED, and every response must pass.

  // require ALL lenses to respond: [].every() is true, so empty verdicts must not read as success
  if (verdicts.length === LENSES.length && verdicts.every(c => c.passes)) {
    converged = true
    history.push({ round, event: 'all critics pass' })
    log(`Round ${round}: all critics pass — converged`)
    break
  }

  //  ── Step 2½: the odd corner (subtlety 10) ──
  //
  //  WHAT: reachable when there are zero issue strings yet no convergence:
  //  either some critics never responded, or a critic said passes=false with
  //  an EMPTY issues list (schema-legal, semantically useless). Revising on
  //  zero issues would be pure noise, so log why and retry a fresh critique
  //  round. Honest cost: `continue` still consumed one of the MAX_ROUNDS —
  //  the cap bounds total spend, including spend on misfires.
  if (!issues.length) {
    const why = verdicts.length < LENSES.length
      ? `only ${verdicts.length}/${LENSES.length} critics responded, no issues`
      : 'a critic failed the answer without listing issues'
    history.push({ round, event: `${why} — retrying` })
    log(`Round ${round}: ${why} — retrying next round`)
    continue
  }
  log(`Round ${round}: ${issues.length} issue(s) found, breeding two revisions`)

  //  ── Step 3: breed two challengers ──
  //
  //  WHAT: both revisers get the same package — ask, reader profile, the
  //  tagged issue list, and the full champion text — but OPPOSITE stances:
  //
  //  - CONSERVATIVE = exploitation. Fix only what the critics flagged; bank
  //    the known gains; change nothing else.
  //  - BOLD = exploration. Fix the issues AND restructure freely — the escape
  //    hatch when the champion's whole shape is the problem and patching
  //    can't get there.
  //
  //  WHY both, every round: conservative-only refinement polishes its way
  //  into a local optimum; bold-only risks losing last round's fixes in each
  //  rewrite. Breeding one of each lets the TOURNAMENT decide, per round, how
  //  adventurous this answer's evolution gets — selection pressure instead of
  //  a hyperparameter.

  const issueList = issues.map(i => '- ' + i).join('\n')
  const reviseBase =
    `Revise the answer below. It answers this ask:\n"${ASK}"\nand is written for this ` +
    `reader — match their preferences:\n${PROFILE}\n\nIssues found by critics:\n${issueList}\n\n` +
    `Your final message must be the complete revised answer and nothing else.\n\n`

  const children = await parallel([
    () => agent(
      reviseBase +
      `Revision stance — CONSERVATIVE: fix ONLY the listed issues; preserve everything ` +
      `they do not touch; do not rewrite for taste.\n\n---BEGIN ANSWER---\n${champion}\n---END ANSWER---`,
      { label: `refine:conservative:r${round}`, phase: 'Refine', ...brainOpts }
    ),
    () => agent(
      reviseBase +
      `Revision stance — BOLD: fix the listed issues AND freely restructure, cut, or ` +
      `rewrite wherever it makes the answer genuinely better for this reader.\n\n` +
      `---BEGIN ANSWER---\n${champion}\n---END ANSWER---`,
      { label: `refine:bold:r${round}`, phase: 'Refine', ...brainOpts }
    ),
  ])

  //  ── Step 4: assemble the tournament field ──
  //
  //  WHAT: byName maps role names to texts (children[0]/[1] may be null —
  //  reviser failures, subtlety 9 again). Then this round's PERM ordering is
  //  filtered down to the candidates that actually exist, and labels are
  //  assigned by POSITION AFTER the filter.
  //
  //  GOTCHA (subtlety 6, second half): labels-after-filter means the field is
  //  always contiguously labeled A, B(, C) — if bold died, the judge sees a
  //  clean A/B choice, never an A/C with a suspicious hole. And pickSchema's
  //  enum is built from these same labels, so the judge cannot vote for the
  //  missing one.
  const byName = { champion, conservative: children[0], bold: children[1] }
  const contenders = PERMS[round % 3]
    .filter(name => byName[name])
    .map((name, i) => [String.fromCharCode(65 + i), name, byName[name]])

  //  WHAT: fewer than two contenders = both revisers died (the champion is
  //  always present) = no tournament possible. That's a no-improvement round,
  //  so it counts toward `dry` (subtlety 8) — two such rounds and the loop
  //  gives up rather than spinning on failing revisers.
  if (contenders.length < 2) {
    dry++
    history.push({ round, issues: issues.length, event: `revisers failed (dry ${dry}/2)` })
    if (dry >= 2) break
    continue
  }

  //  ── Step 5: the tournament, and selection with elitism ──
  //
  //  WHAT: pick() (§5) returns {name, reason}. Champion wins → dry++ and,
  //  once dry reaches 2, stop: improvement has dried up (driedOut).
  //  A challenger wins → it BECOMES the champion, dry resets, evolution
  //  continues. Every verdict lands in history with the judge's one-line
  //  reason — that's what makes the final summary explainable instead of
  //  "trust me, it's better".
  const verdict = await pick(contenders, `r${round}`)
  history.push({ round, issues: issues.length, winner: verdict.name, reason: verdict.reason })

  if (verdict.name === 'champion') {
    dry++
    log(`Round ${round}: champion survives (${dry}/2 dry) — ${verdict.reason}`)
    if (dry >= 2) break
  } else {
    dry = 0
    champion = byName[verdict.name]
    log(`Round ${round}: ${verdict.name} revision becomes champion — ${verdict.reason}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  §8  THE RETURN — the script's only voice
// ═══════════════════════════════════════════════════════════════════════════
//
//  WHAT: top-level return is legal here because the harness runs the script
//  body inside an async function context. This object is the ENTIRE output —
//  it travels back to Main Claude (the Workflow tool call's result), which
//  presents `final` and narrates `history` per SKILL.md Step 3.
//
//  Reading the flags together tells the ending's story:
//  - converged=true             → critics ran out of substantive objections.
//  - driedOut=true              → two no-improvement contests since the last
//                                 replacement (incumbent wins and/or reviser
//                                 wipeouts, in any mix) — a local optimum.
//  - both false, rounds=MAX     → round cap hit mid-climb. SKILL.md says to
//                                 report that ending honestly — and note
//                                 (this file's observation) that if the last
//                                 round crowned a fresh revision, it was
//                                 NEVER re-critiqued by the three lenses.
//
//  GOTCHA: `driedOut: dry >= 2` is recomputed here rather than stored — note
//  it is TRUE only when the loop broke on dryness; a single dry round before
//  the cap leaves it false, as it should.
//
//  TRY: after any /evolve run, open the run's journal (journal.jsonl in the
//  workflow's transcript directory) and match each agent's raw return value
//  to the history entries below — the whole evolution is auditable.

return { final: champion, rounds: round, converged, driedOut: dry >= 2, history }
