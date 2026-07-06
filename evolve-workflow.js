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

// args may arrive absent or JSON-encoded as a string (harness quirk) — normalize, then fail fast
const IN = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!IN.ask) {
  return { error: 'args.ask is required — refusing to run agents against an undefined question', rounds: 0, converged: false, driedOut: false, history: [] }
}
const MAX_ROUNDS = IN.maxRounds ?? 4
const PROFILE = IN.profile ?? 'A curious practitioner who wants intuitive explanations before jargon and a concrete way to apply the answer.'
const ASK = IN.ask
const MODELS = IN.models ?? {}

// 'inherit' or missing -> no override, agent runs on the session model
const resolve = (name) => (name && name !== 'inherit') ? { model: name } : {}
const brainOpts = resolve(MODELS.brain)
const pickOpts = resolve(MODELS.pick)
const criticOpts = (key) => resolve(MODELS[key] ?? MODELS.judge)

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

// enum is built from the actual labels so e.g. a 2-way pick cannot return 'C'
const pickSchema = (labels) => ({
  type: 'object',
  properties: {
    winner: { type: 'string', enum: labels, description: 'label of the best candidate' },
    reason: { type: 'string', description: 'one sentence: why it beats the others' },
  },
  required: ['winner', 'reason'],
})

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

const STANCES = [
  { key: 'direct', text: 'Direct and minimal: answer in the most straightforward, compact way that still fully serves the ask.' },
  { key: 'thorough', text: 'Thorough and didactic: build intuition first, use a concrete example, cover what the reader will need right after.' },
]

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

const history = []
let champion = IN.draft ?? null

// Round 0 — generate two diverse solutions, judge picks the starting champion
if (!champion) {
  const cands = await parallel(STANCES.map(s => () =>
    agent(
      `Answer the ask below for this reader — match their preferences:\n${PROFILE}\n\n` +
      `Stance for this attempt: ${s.text}\n\n` +
      `Your final message must be the complete answer and nothing else.\n\nAsk:\n"${ASK}"`,
      { label: `generate:${s.key}`, phase: 'Generate', ...brainOpts }
    )
  ))
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

if (!champion) {
  return { error: 'both generators failed; nothing to refine', rounds: 0, converged: false, driedOut: false, history }
}

// permutations for 3-way judging, rotated per round to counter position bias
const PERMS = [
  ['champion', 'conservative', 'bold'],
  ['conservative', 'bold', 'champion'],
  ['bold', 'champion', 'conservative'],
]

let round = 0
let dry = 0
let converged = false

while (round < MAX_ROUNDS) {
  round++

  // Barrier is intentional: convergence needs ALL critics' verdicts together.
  const critiques = await parallel(LENSES.map(l => () =>
    agent(
      l.brief() + `\n\n---BEGIN ANSWER---\n` + champion + `\n---END ANSWER---`,
      { label: `critique:${l.key}:r${round}`, phase: 'Critique', schema: CRITIQUE_SCHEMA, ...criticOpts(l.key) }
    )
  ))
  // map before filter to keep index alignment with LENSES, so issues stay attributed to their critic
  const verdicts = critiques.map((c, i) => c ? { critic: LENSES[i].key, ...c } : null).filter(Boolean)
  const issues = verdicts.flatMap(c => c.issues.map(msg => `[${c.critic}] ${msg}`))
  // require ALL lenses to respond: [].every() is true, so empty verdicts must not read as success
  if (verdicts.length === LENSES.length && verdicts.every(c => c.passes)) {
    converged = true
    history.push({ round, event: 'all critics pass' })
    log(`Round ${round}: all critics pass — converged`)
    break
  }
  if (!issues.length) {
    const why = verdicts.length < LENSES.length
      ? `only ${verdicts.length}/${LENSES.length} critics responded, no issues`
      : 'a critic failed the answer without listing issues'
    history.push({ round, event: `${why} — retrying` })
    log(`Round ${round}: ${why} — retrying next round`)
    continue
  }
  log(`Round ${round}: ${issues.length} issue(s) found, breeding two revisions`)

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

return { final: champion, rounds: round, converged, driedOut: dry >= 2, history }
