// ─────────────────────────────────────────────────────────────────────────────
//  Example 02 · structured output — from prose to data you can branch on
//
//  Teaches: the `schema` option — the single biggest upgrade to agent().
//           Free text is for humans; validated objects are for programs.
//  Agents spawned: 2 (the same question asked both ways, to contrast)
//  Run: "Run the workflow at examples/02-structured-output.js"
//       (optionally: ... with args {q: "should I use tabs or spaces?"})
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHAT `schema` does: pass a JSON Schema in opts and the runtime FORCES the
//  subagent to answer through a structured-output tool call, validated
//  against your schema — the model retries on mismatch, and agent() resolves
//  to a parsed, validated OBJECT. You never JSON.parse model prose, never
//  regex a verdict out of a paragraph.
//
//  WHY it matters: orchestration means CODE making decisions from agent
//  answers — loops, thresholds, votes, routing. Code cannot reliably branch
//  on "Well, it depends, but overall I'd lean toward...". It branches
//  beautifully on `{recommendation: 'python', confidence: 0.8}`.

export const meta = {
  name: 'ex02-structured-output',
  description: 'The same question answered as prose vs as a validated object',
  phases: [{ title: 'Free text' }, { title: 'Structured' }],
}

let IN = args ?? {}
if (typeof IN === 'string') { try { IN = JSON.parse(IN) } catch { IN = { q: IN } } }
const q = IN.q ?? 'Should a complete beginner learn Python or JavaScript first?'

//  A schema is a contract, and every field teaches something:
//  - `enum` is a GUARDRAIL, not a suggestion: the agent physically cannot
//    return 'rust' here — validation rejects it before your script ever
//    sees it. Constraining at the validation layer beats writing "please
//    only answer python or javascript" in the prompt. (evolve-workflow.js
//    builds its judge's enum dynamically from the actual candidate labels
//    for exactly this reason.)
//  - `description` on a property is PROMPT TEXT — the agent reads it. Put
//    real instructions there.
//  - `required` means the field WILL be present. No optional-chaining
//    gymnastics downstream.
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    recommendation: {
      type: 'string',
      enum: ['python', 'javascript', 'either'],
      description: 'your single pick for this beginner',
    },
    confidence: {
      type: 'number', minimum: 0, maximum: 1,
      description: 'how sure you are, 0 to 1 — be honest, not polite',
    },
    reasons: {
      type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4,
      description: 'each reason: one sentence, concrete, no hedging',
    },
  },
  required: ['recommendation', 'confidence', 'reasons'],
}

//  These two calls are independent, so Example 03's parallel() could run
//  them concurrently — kept sequential here so each phase reads clearly in
//  /workflows while you watch.

log('Round 1: same question, free text')
const prose = await agent(
  `${q}\n\nAnswer in a short paragraph. Your final message must be the answer only.`,
  { label: 'as-prose', phase: 'Free text' }
)

log('Round 2: same question, schema-enforced')
const verdict = await agent(
  `${q}\n\nAnswer honestly for a typical complete beginner.`,
  { label: 'as-data', phase: 'Structured', schema: VERDICT_SCHEMA }
)

//  THE PAYOFF: the script now ACTS on the answer — deterministic code
//  branching on validated fields. This tiny if/else is the seed of every
//  orchestration pattern: evolve's convergence check is just
//  `verdicts.every(c => c.passes)` on objects shaped by a schema like this.
let decision = 'structured agent failed (null) — nothing to branch on'
if (verdict) {
  decision = verdict.confidence >= 0.7
    ? `high confidence (${verdict.confidence}) — a script could auto-proceed with '${verdict.recommendation}'`
    : `low confidence (${verdict.confidence}) — a script could route this to a human, or to more agents (Example 06)`
}

return {
  question: q,
  freeText: prose ?? '(prose agent failed)',
  structured: verdict,           // an object — inspect the exact shape the schema promised
  whatCodeDidWithIt: decision,   // proof the script can now make decisions
}

//  TRY: change `enum` to just ['python'] and re-run — the agent is cornered
//  into one answer no matter what it "thinks". Then delete `confidence` from
//  `required` and watch downstream code have to start null-checking it.
