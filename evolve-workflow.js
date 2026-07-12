// Evolution loop: generate, verify correctness, evaluate as the reader, refine.
// The Workflow runtime injects args, agent(), parallel(), and log().
export const meta = {
  name: 'evolve-loop',
  description: 'Correctness-gated reader selection with evaluation-driven refinement',
  phases: [
    { title: 'Generate', detail: 'two brains, different stances' },
    { title: 'Verify', detail: 'compare candidates by verified points' },
    { title: 'Reader', detail: 'reader notes + final selection' },
    { title: 'Refine', detail: 'conservative + bold revisions' },
  ],
}

const IN = typeof args === 'string' ? JSON.parse(args) : (args ?? {})

if (!IN.ask) {
  return { error: 'args.ask is required — refusing to run agents against an undefined question', rounds: 0, converged: false, driedOut: false, history: [] }
}

const MAX_ROUNDS = IN.maxRounds ?? 4
const PROFILE = IN.profile ?? 'A curious practitioner who wants intuitive explanations before jargon and a concrete way to apply the answer.'
const ASK = IN.ask
const MODELS = IN.models ?? {}

const resolve = (name) => (name && name !== 'inherit') ? { model: name } : {}
const brainOpts = resolve(MODELS.brain)
const correctOpts = resolve(MODELS.correct)
const readerOpts = resolve(MODELS.reader)

const correctnessSchema = (labels) => ({
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      minItems: labels.length,
      maxItems: labels.length,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', enum: labels },
          verifiedPoints: {
            type: 'integer',
            minimum: 0,
            description: 'count of distinct, load-bearing points verified against authoritative evidence',
          },
          issues: {
            type: 'array',
            items: { type: 'string' },
            description: 'false, unsupported, misleading, or technically broken claims; empty when none',
          },
        },
        required: ['label', 'verifiedPoints', 'issues'],
      },
    },
    summary: { type: 'string', description: 'one sentence comparing the candidates on correctness' },
  },
  required: ['reviews', 'summary'],
})

const readerSchema = (labels) => ({
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      minItems: labels.length,
      maxItems: labels.length,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', enum: labels },
          understandable: { type: 'boolean' },
          useful: { type: 'boolean' },
          understandNotes: {
            type: 'array',
            items: { type: 'string' },
            description: 'actionable reader stumbles; empty when fully understandable',
          },
          usefulNotes: {
            type: 'array',
            items: { type: 'string' },
            description: 'actionable missing or unhelpful parts; empty when fully useful',
          },
        },
        required: ['label', 'understandable', 'useful', 'understandNotes', 'usefulNotes'],
      },
    },
    winner: { type: 'string', enum: labels },
    reason: { type: 'string', description: 'one sentence explaining the reader choice' },
  },
  required: ['reviews', 'winner', 'reason'],
})

const STANCES = [
  { key: 'direct', text: 'Direct and minimal: answer in the most straightforward, compact way that still fully serves the ask.' },
  { key: 'thorough', text: 'Thorough and didactic: build intuition first, use a concrete example, cover what the reader will need right after.' },
]

const candidateBlocks = (labeled) => labeled
  .map(([label, , text]) => `---CANDIDATE ${label}---\n${text}\n---END ${label}---`)
  .join('\n\n')

// Correctness qualifies candidates; the reader makes the final choice.
const evaluate = async (labeled, tag) => {
  const labels = labeled.map(([label]) => label)
  const incumbent = labeled.find(([, name]) => name === 'champion')
  const blocks = candidateBlocks(labeled)

  const correctness = await agent(
    `Compare the candidate answers to this ask:\n"${ASK}"\n\n` +
    `Verify every load-bearing factual and technical point against authoritative evidence. ` +
    `Use official documentation for tools and APIs; do not trust memory alone. Count only ` +
    `distinct substantive points — do not reward verbosity, repetition, or trivial facts. ` +
    `Record false, unsupported, misleading, or broken claims as issues. Review every label ` +
    `exactly once.\n\n${blocks}`,
    { label: `verify:${tag}`, phase: 'Verify', schema: correctnessSchema(labels), ...correctOpts }
  )

  const validReviews = correctness?.reviews?.filter(r => labels.includes(r.label)) ?? []
  const reviewedLabels = new Set(validReviews.map(r => r.label))
  if (reviewedLabels.size !== labels.length) {
    const fallback = incumbent ?? labeled[0]
    return {
      name: fallback[1],
      passes: false,
      issues: ['[correct] correctness verifier failed'],
      reason: 'correctness verifier failed; kept the safest fallback',
      correctness: { summary: 'no valid correctness review', reviews: [] },
      reader: { reason: 'not run', reviews: [] },
    }
  }

  const maxVerified = Math.max(...validReviews.map(r => r.verifiedPoints))
  const qualifiedLabels = labels.filter(label =>
    validReviews.some(r => r.label === label && r.verifiedPoints === maxVerified)
  )
  const qualified = labeled.filter(([label]) => qualifiedLabels.includes(label))
  const qualifiedBlocks = candidateBlocks(qualified)
  const incumbentNote = incumbent && qualifiedLabels.includes(incumbent[0])
    ? `Candidate ${incumbent[0]} is the incumbent. Keep it unless another qualified answer is meaningfully easier to understand or more useful.\n\n`
    : ''

  const reader = await agent(
    `You ARE the reader described below. Write your notes in first person as that reader.\n` +
    `${PROFILE}\n\nYou asked:\n"${ASK}"\n\n` +
    `The correctness verifier qualified only the candidates tied for the most verified ` +
    `substantive points. Evaluate each remaining candidate for:\n` +
    `1. UNDERSTANDABLE — one top-to-bottom read, intuition before jargon, no unexplained gaps.\n` +
    `2. USEFUL — answers the actual ask, covers explicit and implicit needs, and is actionable.\n` +
    `Review every qualified label exactly once. For each candidate, write only actionable ` +
    `problems in the two notes arrays; leave an ` +
    `array empty when there is no problem. Then pick the answer you would most want to ` +
    `receive overall. Ignore factual correctness because the verifier already gated it.\n\n` +
    incumbentNote + qualifiedBlocks,
    { label: `reader:${tag}`, phase: 'Reader', schema: readerSchema(qualifiedLabels), ...readerOpts }
  )

  const chosenLabel = qualifiedLabels.includes(reader?.winner)
    ? reader.winner
    : (incumbent && qualifiedLabels.includes(incumbent[0]) ? incumbent[0] : qualifiedLabels[0])
  const chosen = labeled.find(([label]) => label === chosenLabel) ?? qualified[0]
  const correctReview = validReviews.find(r => r.label === chosenLabel)
  const readerReview = reader?.reviews?.find(r => r.label === chosenLabel)
  const issues = [
    ...(correctReview?.issues ?? []).map(issue => `[correct] ${issue}`),
    ...(readerReview?.understandNotes ?? []).map(note => `[understand] ${note}`),
    ...(readerReview?.usefulNotes ?? []).map(note => `[useful] ${note}`),
  ]

  if (!readerReview) issues.push('[reader] reader evaluator failed to review the selected answer')

  const passes = Boolean(
    readerReview &&
    readerReview.understandable &&
    readerReview.useful &&
    !issues.length
  )

  return {
    name: chosen[1],
    passes,
    issues,
    reason: `correctness qualified ${qualifiedLabels.join('/')} at ${maxVerified} verified point(s); ` +
      (reader?.reason ?? `reader evaluation failed; defaulted to ${chosen[1]}`),
    correctness: {
      summary: correctness?.summary ?? 'no correctness summary',
      reviews: validReviews,
    },
    reader: {
      reason: reader?.reason ?? 'reader evaluation failed',
      reviews: reader?.reviews ?? [],
    },
  }
}

const history = []
let champion = IN.draft ?? null
let evaluation

// Round 0: generate diverse candidates, then run the unified evaluator.
if (!champion) {
  const candidates = await parallel(STANCES.map(s => () =>
    agent(
      `Answer the ask below for this reader — match their preferences:\n${PROFILE}\n\n` +
      `Stance for this attempt: ${s.text}\n\n` +
      `Your final message must be the complete answer and nothing else.\n\nAsk:\n"${ASK}"`,
      { label: `generate:${s.key}`, phase: 'Generate', ...brainOpts }
    )
  ))

  const labeled = candidates
    .map((text, i) => text && [String.fromCharCode(65 + i), STANCES[i].key, text])
    .filter(Boolean)

  if (!labeled.length) {
    return { error: 'both generators failed; nothing to refine', rounds: 0, converged: false, driedOut: false, history }
  }

  evaluation = await evaluate(labeled, 'r0')
  champion = labeled.find(([, name]) => name === evaluation.name)?.[2] ?? labeled[0][2]
  history.push({
    round: 0,
    event: `initial selection: ${evaluation.name}`,
    issues: evaluation.issues.length,
    reason: evaluation.reason,
    correctness: evaluation.correctness,
    reader: evaluation.reader,
  })
  log(`Round 0: '${evaluation.name}' selected — ${evaluation.reason}`)
} else {
  evaluation = await evaluate([[ 'A', 'champion', champion ]], 'draft')
  history.push({
    round: 0,
    event: 'draft evaluated',
    issues: evaluation.issues.length,
    reason: evaluation.reason,
    correctness: evaluation.correctness,
    reader: evaluation.reader,
  })
  log(`Draft evaluated — ${evaluation.reason}`)
}

const PERMS = [
  ['champion', 'conservative', 'bold'],
  ['conservative', 'bold', 'champion'],
  ['bold', 'champion', 'conservative'],
]

let round = 0
let dry = 0
let converged = evaluation.passes

if (converged) {
  history.push({ round: 0, event: 'unified evaluation passes' })
  log('Round 0: correctness and reader evaluation pass — converged')
}

while (!converged && round < MAX_ROUNDS) {
  round++

  const issues = evaluation.issues.length
    ? evaluation.issues
    : ['[evaluation] improve correctness, understandability, and usefulness based on the evaluation summary']
  const issueList = issues.map(issue => '- ' + issue).join('\n')
  const reviseBase =
    `Revise the answer below. It answers this ask:\n"${ASK}"\nand is written for this ` +
    `reader — match their preferences:\n${PROFILE}\n\nEvaluation notes:\n${issueList}\n\n` +
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

  const byName = { champion, conservative: children[0], bold: children[1] }
  const contenders = PERMS[round % 3]
    .filter(name => byName[name])
    .map((name, i) => [String.fromCharCode(65 + i), name, byName[name]])

  if (contenders.length < 2) {
    dry++
    history.push({ round, issues: issues.length, event: `revisers failed (dry ${dry}/2)` })
    if (dry >= 2) break
    continue
  }

  evaluation = await evaluate(contenders, `r${round}`)
  history.push({
    round,
    issues: evaluation.issues.length,
    winner: evaluation.name,
    reason: evaluation.reason,
    correctness: evaluation.correctness,
    reader: evaluation.reader,
  })

  if (evaluation.name === 'champion') {
    dry++
    log(`Round ${round}: champion survives (${dry}/2 dry) — ${evaluation.reason}`)
  } else {
    dry = 0
    champion = byName[evaluation.name]
    log(`Round ${round}: ${evaluation.name} revision becomes champion — ${evaluation.reason}`)
  }

  converged = evaluation.passes
  if (converged) {
    history.push({ round, event: 'unified evaluation passes' })
    log(`Round ${round}: correctness and reader evaluation pass — converged`)
  }

  if (dry >= 2) break
}

return { final: champion, rounds: round, converged, driedOut: dry >= 2, history }
