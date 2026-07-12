// ============================================================================
// WHAT THIS FILE DOES (big picture, read this first!)
//
// This script asks several AI agents to write an answer to a question, then
// makes them compete and improve it, like an evolution loop:
//
//   1. GENERATE: two agents each write an answer in a different style
//   2. JUDGE:    two judges vote on the better one — the "champion":
//                a "reader" judge role-playing the target reader, and a
//                "correct" judge that checks claims against official docs
//   3. CRITIQUE: three critic agents look for problems in the champion
//   4. REFINE:   two agents rewrite the champion to fix those problems
//   5. JUDGE:    the same two judges vote on champion vs the two rewrites —
//                the champion is only replaced when BOTH agree
//   6. Repeat steps 3–5 until the critics are happy, or we run out of rounds
//
// IMPORTANT: some things in this file are NOT normal JavaScript — they are
// given to us by the tool that runs this script ("the harness"):
//   - agent(prompt)   → sends a prompt to an AI agent, returns its answer
//   - parallel([...]) → runs several agent calls at the same time
//   - log(message)    → prints a progress message for the human watching
//   - args            → the input the user passed in (like function arguments)
// You won't find these defined anywhere in this file — that's expected.
// ============================================================================

// "export" makes this value visible to the code that loads this file.
// "const" declares a variable that can never be re-assigned (you can't later
// write meta = somethingElse). It's the default way to declare variables.
// The { ... } here is an OBJECT: a bundle of named values ("key: value" pairs).
export const meta = {
  name: 'evolve-loop',
  description: 'Two diverse solutions, judge keeps a champion, critique-driven two-variant refinement until converged',
  // "phases" is an ARRAY (an ordered list, written with [ ]) of objects.
  phases: [
    { title: 'Generate', detail: 'two brains, different stances' },
    { title: 'Critique', detail: 'reader-fit, usefulness, correctness in parallel' },
    { title: 'Refine', detail: 'conservative + bold revisions of the champion' },
    { title: 'Judge', detail: 'reader judge + docs-checking correctness judge; both must agree to dethrone' },
  ],
}

// args may arrive absent or JSON-encoded as a string (harness quirk) — normalize, then fail fast
//
// Two new things on this line:
// 1. "typeof x === 'string'" checks what TYPE a value is.
// 2. "condition ? valueIfTrue : valueIfFalse" is the TERNARY operator —
//    a one-line if/else that produces a value.
// 3. "args ?? {}" uses the NULLISH COALESCING operator: it means
//    "use args, but if args is null or undefined, use {} (empty object) instead".
// So: if args is a string, parse it as JSON; otherwise use it as-is (or {}).
const IN = typeof args === 'string' ? JSON.parse(args) : (args ?? {})

// "!IN.ask" means "IN.ask is missing or empty". The ! flips true/false.
// If the user didn't give us a question to answer, stop immediately.
// "return" at the top level here ends the whole script and hands back
// this object as the result.
if (!IN.ask) {
  return { error: 'args.ask is required — refusing to run agents against an undefined question', rounds: 0, converged: false, driedOut: false, history: [] }
}

// More "??" defaults: use the user's value if they gave one, otherwise a fallback.
const MAX_ROUNDS = IN.maxRounds ?? 4
const PROFILE = IN.profile ?? 'A curious practitioner who wants intuitive explanations before jargon and a concrete way to apply the answer.'
const ASK = IN.ask
const MODELS = IN.models ?? {}

// This is an ARROW FUNCTION — a compact way to write a function:
//   const resolve = (name) => result
// is roughly the same as:
//   function resolve(name) { return result; }
// When the body is a single expression, its value is returned automatically.
//
// Logic: if a model name was given AND it isn't the word 'inherit',
// return an object like { model: 'some-name' }; otherwise return {} (empty =
// no override, the agent runs on the default model).
// "&&" means AND — both sides must be true.
const resolve = (name) => (name && name !== 'inherit') ? { model: name } : {}

// Call resolve() to build the options for each kind of agent.
const brainOpts = resolve(MODELS.brain)
// Each tournament judge can have its own model via 'pick-reader' /
// 'pick-correct' in critics.md; otherwise both fall back to the shared
// 'pick' role.
const pickOpts = (key) => resolve(MODELS['pick-' + key] ?? MODELS.pick)
// This arrow function takes a key (like 'correct') and looks it up in MODELS.
// MODELS[key] uses BRACKET NOTATION: get a property whose name is stored in
// a variable (MODELS.correct would only ever mean the literal name "correct").
const criticOpts = (key) => resolve(MODELS[key] ?? MODELS.judge)

// A SCHEMA describes the exact shape of the answer we want back from a
// critic agent — like a form the agent must fill in. This forces the agent
// to reply with real data ({ passes: true/false, issues: [...] }) instead of
// free-form text we'd have to parse ourselves.
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
//
// This is a function that BUILDS a schema. It takes the list of candidate
// labels (like ['A', 'B']) and returns a schema object.
// The "enum: labels" line means: the winner field may ONLY be one of these
// exact values — the judge can't invent a label that doesn't exist.
// Note the (...) around the object body: without them, JavaScript would
// mistake the { for the start of a function body instead of an object.
const pickSchema = (labels) => ({
  type: 'object',
  properties: {
    winner: { type: 'string', enum: labels, description: 'label of the best candidate' },
    reason: { type: 'string', description: 'one sentence: why it beats the others' },
  },
  required: ['winner', 'reason'],
})

// LENSES = the three critics. Each looks at the answer from one angle only:
//   'understand' → is it easy to read for this specific reader?
//   'useful'     → does it actually answer the question?
//   'correct'    → are the facts and code right?
// Each lens has a "brief" — a function that returns the critic's instructions.
//
// The instructions use TEMPLATE LITERALS: strings written with backticks `...`
// You can embed variables inside them with ${variable}.
// "\n" inside a string means "new line".
// The long strings are split across lines and glued together with "+"
// (string concatenation) purely so the code stays readable.
const LENSES = [
  {
    key: 'understand',
    // "brief: () => ..." — a function with NO parameters (empty parens) that
    // returns the prompt text when called.
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

// The two writing styles used for the very first drafts.
const STANCES = [
  { key: 'direct', text: 'Direct and minimal: answer in the most straightforward, compact way that still fully serves the ask.' },
  { key: 'thorough', text: 'Thorough and didactic: build intuition first, use a concrete example, cover what the reader will need right after.' },
]

// The tournament judges. A PANEL of two, splitting the work by who is
// qualified to judge it:
//   'reader'  → IS the reader (first person) and votes on TWO metrics at
//               once: UNDERSTAND (could they follow it?) and USEFUL (does
//               it serve their ask?). Subjective calls belong to the person
//               the answer is for.
//   'correct' → votes for the most factually correct candidate, and must
//               CHECK OFFICIAL DOCS (web search / fetching documentation)
//               rather than trusting memory. This one deliberately does NOT
//               impersonate the reader: correctness is objective, and
//               role-playing a non-expert would only handicap fact-checking.
// Each judge fills in pickSchema ({ winner, reason }); the champion is only
// dethroned when BOTH agree. A split vote keeps the incumbent (and in round
// 0, where there is no incumbent yet, the reader judge breaks the tie).
const JUDGE_LENSES = [
  {
    key: 'reader',
    brief: () =>
      `You ARE the reader described in this profile — judge in first person, as them:\n` +
      `${PROFILE}\n\n` +
      `You asked:\n"${ASK}"\n\n` +
      `Vote for the candidate that wins on BOTH of these metrics together:\n` +
      `1. UNDERSTAND — the one YOU could follow most comfortably in one top-to-bottom read: ` +
      `intuition before mechanism, jargon explained at first use, nothing assuming knowledge ` +
      `you lack, your structural and presentation preferences honored.\n` +
      `2. USEFUL — the one that best SERVES your ask: every explicit part addressed, ` +
      `implicit needs met, actionable enough that you can DO the thing without an immediate ` +
      `follow-up question.\n` +
      `If the metrics disagree, pick the candidate you would rather have received overall. ` +
      `Ignore factual accuracy — the other judge verifies that against official docs.`,
  },
  {
    key: 'correct',
    brief: () =>
      `The candidates below all answer this ask:\n"${ASK}"\n\n` +
      `Vote for the most factually and technically CORRECT candidate: claims, code, ` +
      `commands, names of tools and APIs. Do NOT judge from memory alone — verify the ` +
      `load-bearing checkable claims against OFFICIAL documentation (search the web and ` +
      `fetch the official docs for the tools/APIs referenced; a claim the docs contradict ` +
      `is wrong no matter how confident it sounds). A convincing candidate that is wrong ` +
      `must lose. Ignore style and coverage — the other judge owns those.`,
  },
]

// The shared tail of every judging prompt: the position-bias guard, plus —
// when a championLabel is given (e.g. 'B') — the incumbent-bias rule that a
// revision must be a REAL improvement to dethrone the champion.
// (championLabel ? textA : textB) — the ternary again, choosing between
// two chunks of text.
const judgeTail = (championLabel) =>
  `\n\nJudge content only — ignore the order candidates appear in.\n` +
  (championLabel
    ? `Candidate ${championLabel} is the current champion (the unchanged incumbent). Prefer it ` +
      `unless another candidate is a real improvement on the metrics YOU own — cosmetic ` +
      `rewording that adds no value must not beat the champion.\n\n`
    : `\n`)

// pick() runs one judging round and returns { name, reason }.
//
// "async" marks a function that does slow work (here: waiting for AI
// agents to reply). Inside it you can use "await", which means "pause here
// until this finishes, then continue with the result".
//
// "labeled" is an array of small arrays, one per candidate:
//   ['A', 'direct', 'the answer text...']
//    label  name     the actual text
const pick = async (labeled, tag) => {
  // .find() returns the FIRST array element that matches the test,
  // or undefined if none match.
  // "([, name]) => ..." is DESTRUCTURING in the parameter: instead of taking
  // the whole entry, we unpack it. The empty slot before the comma means
  // "skip position 0 (the label), call position 1 'name'".
  const championEntry = labeled.find(([, name]) => name === 'champion')
  const labels = labeled.map(([label]) => label)
  // .map() transforms EVERY element of an array using a function, giving a
  // new array. Here each candidate becomes a block of labeled text.
  // .join('\n\n') then glues all the blocks into one big string,
  // separated by blank lines.
  const blocks = labeled.map(([label, , text]) => `---CANDIDATE ${label}---\n${text}\n---END ${label}---`).join('\n\n')

  // Both judges vote at the same time. Each entry of "votes" is an object
  // shaped like pickSchema — { winner: 'A', reason: '...' } — or null if
  // that judge failed. The order matches JUDGE_LENSES:
  // votes[0] = reader, votes[1] = correct.
  //
  // "championEntry?.[0]" uses OPTIONAL CHAINING (?.): if championEntry is
  // undefined (no champion in this round), the whole thing is undefined
  // instead of crashing with an error.
  const votes = await parallel(JUDGE_LENSES.map(j => () =>
    agent(
      j.brief() + judgeTail(championEntry?.[0]) + blocks,
      // "...pickOpts(j.key)" is the SPREAD operator: it copies this judge's
      // model override (if any) into the options object.
      { label: `pick:${j.key}:${tag}`, phase: 'Judge', schema: pickSchema(labels), ...pickOpts(j.key) }
    )
  ))

  // Tally the votes: candidate label → how many judges voted for it.
  // .filter(Boolean) drops failed judges (null entries) first.
  const tally = {}
  votes.filter(Boolean).forEach(v => { tally[v.winner] = (tally[v.winner] ?? 0) + 1 })

  // UNANIMITY rule: with two judges, a candidate wins only when BOTH voted
  // for it (2 votes). A split vote — or a failed judge — falls back to the
  // incumbent champion, never to an unjudged revision. When no champion
  // exists yet (round 0), the reader judge's vote breaks the tie: the
  // reader is the person the answer is for.
  const unanimousLabel = labels.find(l => (tally[l] ?? 0) >= 2)
  const readerEntry = labeled.find(([label]) => label === votes[0]?.winner)
  const hit = labeled.find(([label]) => label === unanimousLabel) ?? championEntry ?? readerEntry ?? labeled[0]

  // Human-readable record: how each judge voted, plus one winning-side
  // reason when the panel agreed.
  const voteMap = JUDGE_LENSES.map((j, i) => `${j.key}→${votes[i]?.winner ?? 'n/a'}`).join(', ')
  const backing = votes.find(v => v && v.winner === hit[0])
  return {
    name: hit[1],
    reason: `[${voteMap}] ` + (unanimousLabel
      ? (backing?.reason ?? 'unanimous vote')
      : `judges split — defaulted to ${hit[1]}`),
  }
}

// "let" declares a variable that CAN be re-assigned later (unlike const).
// history collects a record of what happened each round.
// champion starts as the user's own draft if they supplied one, else null.
const history = []
let champion = IN.draft ?? null

// Round 0 — generate two diverse solutions, the judges vote on the starting champion
// (skipped entirely if the user already gave us a draft to improve)
if (!champion) {
  // parallel() takes an array of FUNCTIONS and runs them at the same time.
  // Note the shape: "s => () => agent(...)". The .map turns each stance s
  // into a function "() => agent(...)" — a recipe parallel() can start when
  // it's ready, rather than a call that fires immediately.
  // "await" pauses until BOTH agents have finished; cands is then an array
  // of their two answers (an entry is null if that agent failed).
  const cands = await parallel(STANCES.map(s => () =>
    agent(
      `Answer the ask below for this reader — match their preferences:\n${PROFILE}\n\n` +
      `Stance for this attempt: ${s.text}\n\n` +
      `Your final message must be the complete answer and nothing else.\n\nAsk:\n"${ASK}"`,
      { label: `generate:${s.key}`, phase: 'Generate', ...brainOpts }
    )
  ))

  // ARRAY DESTRUCTURING: unpack the two results into named variables.
  // Same as: const direct = cands[0]; const thorough = cands[1];
  const [direct, thorough] = cands

  if (direct && thorough) {
    // Both succeeded → let the judge pick the starting champion.
    const labeled = [[ 'A', 'direct', direct ], [ 'B', 'thorough', thorough ]]
    const verdict = await pick(labeled, 'r0')
    champion = verdict.name === 'direct' ? direct : thorough
    // .push() adds an item to the end of an array.
    history.push({ round: 0, event: `initial pick: ${verdict.name}`, reason: verdict.reason })
    log(`Round 0: '${verdict.name}' stance wins — ${verdict.reason}`)
  } else {
    // Only one (or neither) succeeded → whichever exists wins by default.
    champion = direct ?? thorough
    history.push({ round: 0, event: `one generator failed; '${direct ? 'direct' : 'thorough'}' champion unopposed` })
    log('Round 0: one generator failed; the other becomes champion unopposed')
  }
}

// If BOTH generators failed, there is nothing to improve — give up cleanly.
if (!champion) {
  return { error: 'both generators failed; nothing to refine', rounds: 0, converged: false, driedOut: false, history }
}

// permutations for 3-way judging, rotated per round to counter position bias
// (AI judges tend to slightly favor whichever answer appears first, so we
// shuffle the presentation order differently each round to cancel that out)
const PERMS = [
  ['champion', 'conservative', 'bold'],
  ['conservative', 'bold', 'champion'],
  ['bold', 'champion', 'conservative'],
]

let round = 0
let dry = 0          // counts consecutive rounds with no improvement
let converged = false // becomes true when all critics pass the answer

// The main improvement loop. "while (condition) { ... }" repeats the block
// as long as the condition stays true.
while (round < MAX_ROUNDS) {
  // "round++" adds 1 to round (shorthand for round = round + 1).
  round++

  // Barrier is intentional: convergence needs ALL critics' verdicts together.
  // Run all three critics at once on the current champion. Each returns
  // { passes, issues } (per CRITIQUE_SCHEMA), or null if that critic failed.
  const critiques = await parallel(LENSES.map(l => () =>
    agent(
      l.brief() + `\n\n---BEGIN ANSWER---\n` + champion + `\n---END ANSWER---`,
      { label: `critique:${l.key}:r${round}`, phase: 'Critique', schema: CRITIQUE_SCHEMA, ...criticOpts(l.key) }
    )
  ))

  // map before filter to keep index alignment with LENSES, so issues stay attributed to their critic
  //
  // .map((c, i) => ...) — map's function can take a second parameter: the
  //   INDEX (position) of the element. We use i to look up which critic
  //   (LENSES[i]) produced this critique.
  // "{ critic: ..., ...c }" — spread again: build a new object that has a
  //   "critic" name plus everything that was inside c (passes, issues).
  // .filter(Boolean) removes the null entries (failed critics). Boolean is
  //   used as a quick test function: null → false → dropped.
  const verdicts = critiques.map((c, i) => c ? { critic: LENSES[i].key, ...c } : null).filter(Boolean)

  // .flatMap() is like .map() but flattens the result one level: each critic
  // contributes a LIST of issues, and we want one combined flat list, not a
  // list of lists. Each issue gets tagged with its critic's name, like
  // "[correct] the command on line 3 doesn't exist".
  const issues = verdicts.flatMap(c => c.issues.map(msg => `[${c.critic}] ${msg}`))

  // require ALL lenses to respond: [].every() is true, so empty verdicts must not read as success
  //
  // .every() returns true only if the test passes for ALL elements.
  // Gotcha it guards against: .every() on an EMPTY array is true! So if all
  // three critics crashed, verdicts would be [] and every() alone would
  // wrongly say "all passed" — hence the length check first.
  if (verdicts.length === LENSES.length && verdicts.every(c => c.passes)) {
    converged = true
    history.push({ round, event: 'all critics pass' })
    log(`Round ${round}: all critics pass — converged`)
    // "break" exits the while loop immediately.
    break
  }

  // Weird case: nobody passed, but nobody listed a concrete issue either
  // (some critics may have failed to respond). Nothing to fix → try again.
  if (!issues.length) {
    const why = verdicts.length < LENSES.length
      ? `only ${verdicts.length}/${LENSES.length} critics responded, no issues`
      : 'a critic failed the answer without listing issues'
    history.push({ round, event: `${why} — retrying` })
    log(`Round ${round}: ${why} — retrying next round`)
    // "continue" skips the rest of this loop pass and starts the next round.
    continue
  }

  log(`Round ${round}: ${issues.length} issue(s) found, breeding two revisions`)

  // Turn the issues array into one bullet-list string:
  // map each issue to "- issue text", then join with newlines.
  const issueList = issues.map(i => '- ' + i).join('\n')

  // The shared part of both revision prompts.
  const reviseBase =
    `Revise the answer below. It answers this ask:\n"${ASK}"\nand is written for this ` +
    `reader — match their preferences:\n${PROFILE}\n\nIssues found by critics:\n${issueList}\n\n` +
    `Your final message must be the complete revised answer and nothing else.\n\n`

  // Two rewriters run at the same time with opposite personalities:
  // conservative = minimal fixes only; bold = free to restructure everything.
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

  // A lookup table: candidate name → its answer text.
  // children[0] / children[1] may be null if that rewriter failed.
  const byName = { champion, conservative: children[0], bold: children[1] }
  // Note: "{ champion }" is SHORTHAND for "{ champion: champion }" — when the
  // key and the variable share a name you can write it once.

  // Build this round's contenders:
  // "round % 3" is the REMAINDER of round ÷ 3 (0, 1, or 2) — a classic trick
  //   to cycle through the 3 orderings in PERMS forever.
  // .filter() keeps only candidates whose text actually exists (drops nulls).
  // .map() then attaches a display label: String.fromCharCode(65 + i) turns
  //   0→'A', 1→'B', 2→'C' (65 is the character code for 'A').
  const contenders = PERMS[round % 3]
    .filter(name => byName[name])
    .map((name, i) => [String.fromCharCode(65 + i), name, byName[name]])

  // Need at least 2 candidates for a contest. If both rewriters failed,
  // count this as a "dry" round; two dry rounds in a row = stop trying.
  if (contenders.length < 2) {
    dry++
    history.push({ round, issues: issues.length, event: `revisers failed (dry ${dry}/2)` })
    if (dry >= 2) break
    continue
  }

  // Let the judge pick between champion / conservative / bold.
  const verdict = await pick(contenders, `r${round}`)
  history.push({ round, issues: issues.length, winner: verdict.name, reason: verdict.reason })

  if (verdict.name === 'champion') {
    // The old answer survived — neither rewrite beat it. That's a dry round.
    dry++
    log(`Round ${round}: champion survives (${dry}/2 dry) — ${verdict.reason}`)
    if (dry >= 2) break
  } else {
    // A rewrite won → it becomes the new champion, and the dry counter resets.
    dry = 0
    champion = byName[verdict.name]
    log(`Round ${round}: ${verdict.name} revision becomes champion — ${verdict.reason}`)
  }
}

// The final result handed back to whoever ran this workflow:
//   final     → the best answer we ended up with
//   rounds    → how many improvement rounds ran
//   converged → true if the critics eventually approved the answer
//   driedOut  → true if we stopped because improvements dried up instead
//   history   → the round-by-round record built along the way
return { final: champion, rounds: round, converged, driedOut: dry >= 2, history }
