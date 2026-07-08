// ─────────────────────────────────────────────────────────────────────────────
//  Example 08 · research swarm — the capstone: plan → probe → verify → write
//
//  Teaches: composing EVERYTHING — schemas (02), fan-out (03), pipeline (04),
//           tool-armed probes (05), adversarial verification (06), strong-
//           model synthesis (03/07) — plus one new move: a completeness
//           critic whose findings trigger one more round of work.
//  Agents spawned: ~10–15 depending on the plan and gaps found
//  Run from this repo:
//       "Run the workflow at examples/08-research-swarm.js"
//       (optionally: ... with args {question: "anything answerable from this repo"})
// ─────────────────────────────────────────────────────────────────────────────
//
//  THE SHAPE, and why each joint is what it is:
//
//    Plan        1 agent decomposes the question into angles      (schema)
//    Research    per angle: a tool-armed researcher digs          (pipeline —
//    Verify      per angle: a skeptic re-checks every claim        no barrier
//                against the actual files                          between them)
//    Synthesize  1 strong agent writes from CONFIRMED claims only (barrier —
//                                                                  needs all)
//    Critique    1 agent hunts for gaps; gaps spawn one gap-fill
//                round and a rewrite                              (loop, once)
//
//  The deepest lesson sits in the Verify column: the researcher's claims are
//  never trusted raw. The same file can be misread once; it is much harder
//  for TWO independent agents — one trying to build, one trying to break —
//  to misread it the same way.

export const meta = {
  name: 'ex08-research-swarm',
  description: 'Decompose a question, research each angle with tools, verify claims, synthesize, fill gaps',
  phases: [
    { title: 'Plan' },
    { title: 'Research' },
    { title: 'Verify' },
    { title: 'Synthesize' },
    { title: 'Critique' },
  ],
}

let IN = args ?? {}
if (typeof IN === 'string') { try { IN = JSON.parse(IN) } catch { IN = { question: IN } } }
const question = IN.question ??
  'How does the /evolve skill in this repo work end to end — from the moment a user types /evolve to the final answer they receive?'

//  ── Plan: one agent turns a question into a work-list ──
//  The planner's output IS the orchestration's shape: the pipeline below
//  fans out over whatever angles it returns. Discover-then-fan-out is how
//  workflows handle work whose size you don't know when you write the script.
log(`Planning: ${question}`)
const plan = await agent(
  `You are planning repo-grounded research. The question:\n"${question}"\n\n` +
  `The repository in the current working directory is the primary source. Skim it ` +
  `briefly with your tools if useful, then decompose the question into 3-4 research ` +
  `angles. Angles must be NON-OVERLAPPING (each owns territory, like beats on a ` +
  `newsdesk) and each must name where in the repo its answers likely live.`,
  {
    label: 'planner', phase: 'Plan',
    schema: {
      type: 'object',
      properties: {
        angles: {
          type: 'array', minItems: 2, maxItems: 4,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'short name for this angle' },
              brief: { type: 'string', description: 'what exactly to find out, and where to look' },
            },
            required: ['title', 'brief'],
          },
        },
      },
      required: ['angles'],
    },
  }
)
if (!plan?.angles?.length) return { error: 'planner failed — no angles to research' }
log(`Plan: ${plan.angles.map(a => a.title).join(' | ')}`)

//  ── Research → Verify: pipelined per angle ──
//  No barrier between the two stages: angle 1 can be under verification
//  while angle 3 is still being researched. Each angle's chain is
//  independent — the definition of pipeline work.
const verifiedByAngle = await pipeline(
  plan.angles,

  //  Researcher: tools + schema = an aimable probe (Example 05's pair).
  //  Every claim must carry its source — unattributed claims are
  //  unverifiable, and unverifiable claims die in the next stage.
  (angle) => agent(
    `Research this angle of the question "${question}":\n\n` +
    `ANGLE: ${angle.title}\n${angle.brief}\n\n` +
    `Use your tools on the repository in the current working directory. Report only ` +
    `what you actually observed, each claim with the file (and section/line if apt) ` +
    `it came from.`,
    {
      label: `research:${angle.title}`, phase: 'Research',
      schema: {
        type: 'object',
        properties: {
          claims: {
            type: 'array', minItems: 1,
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                source: { type: 'string', description: 'file path (+ line/section) this rests on' },
              },
              required: ['claim', 'source'],
            },
          },
        },
        required: ['claims'],
      },
    }
  ),

  //  Verifier: Example 06's skeptic, aimed at this angle's claims. Note the
  //  stage signature (prev, originalItem, index) doing its job: the angle
  //  arrives as the second parameter, no threading needed.
  (research, angle) => {
    if (!research?.claims?.length) return null
    return agent(
      `You are a skeptic verifying research claims against the repository in the ` +
      `current working directory. For EACH claim below, open the cited source with ` +
      `your tools and check it. Unverifiable or overstated claims must be rejected — ` +
      `err toward rejection.\n\n` +
      research.claims.map((c, i) => `${i + 1}. "${c.claim}" — cited source: ${c.source}`).join('\n'),
      {
        label: `verify:${angle.title}`, phase: 'Verify',
        schema: {
          type: 'object',
          properties: {
            confirmed: { type: 'array', items: { type: 'string' }, description: 'claims that held up, verbatim' },
            rejected: {
              type: 'array',
              items: {
                type: 'object',
                properties: { claim: { type: 'string' }, why: { type: 'string' } },
                required: ['claim', 'why'],
              },
            },
          },
          required: ['confirmed', 'rejected'],
        },
      }
    ).then(v => v && { angle: angle.title, confirmed: v.confirmed, rejected: v.rejected })
  }
)

const surviving = verifiedByAngle.filter(Boolean)
const confirmed = surviving.flatMap(a => a.confirmed.map(c => `[${a.angle}] ${c}`))
const rejected = surviving.flatMap(a => a.rejected)
log(`${confirmed.length} claims confirmed, ${rejected.length} rejected, across ${surviving.length}/${plan.angles.length} angles`)
if (!confirmed.length) return { error: 'no claims survived verification', rejected }

//  ── Synthesize: strong model, confirmed claims ONLY ──
//  The barrier here is legitimate: a report must weave ALL angles together.
//  The prompt's key constraint — write from the confirmed list, nothing
//  else — is what makes the verification stage mean something.
const writeReport = (claims, note) => agent(
  `Write a clear, well-organized answer to:\n"${question}"\n\n${note}` +
  `Build it ONLY from the verified claims below — do not add facts of your own. ` +
  `Cite the bracketed angle tags inline. Your final message must be the answer only.\n\n` +
  claims.map(c => '- ' + c).join('\n'),
  { label: 'synthesize', phase: 'Synthesize' }
)
let report = await writeReport(confirmed, '')
if (!report) return { error: 'synthesizer failed', confirmed, rejected }

//  ── Critique → one gap-fill round ──
//  The completeness critic asks the question every fan-out must face:
//  what did the DECOMPOSITION miss? Its gaps become new research work —
//  a loop, run exactly once here. (evolve runs its critique loop up to
//  maxRounds times; the unbounded version is the loop-until-dry pattern.)
const audit = await agent(
  `A reader asked:\n"${question}"\n\nBelow is a draft answer. What is MISSING — ` +
  `sub-questions the reader clearly wanted answered that the draft skips? ` +
  `List at most 2 gaps, each phrased as a researchable question. Empty list if none.` +
  `\n\n--- DRAFT ---\n${report}\n--- END ---`,
  {
    label: 'gap-critic', phase: 'Critique',
    schema: {
      type: 'object',
      properties: { gaps: { type: 'array', maxItems: 2, items: { type: 'string' } } },
      required: ['gaps'],
    },
  }
)

let gapsFilled = []
if (audit?.gaps?.length) {
  log(`Gap-fill round: ${audit.gaps.join(' | ')}`)
  const extra = await parallel(audit.gaps.map(g => () =>
    agent(
      `Answer this from the repository in the current working directory, with your ` +
      `tools, citing files: "${g}". Report only what you verified.`,
      {
        label: `gap:${g.slice(0, 40)}`, phase: 'Critique',
        schema: {
          type: 'object',
          properties: { claims: { type: 'array', items: { type: 'string' } } },
          required: ['claims'],
        },
      }
    )
  ))
  gapsFilled = extra.filter(Boolean).flatMap(e => e.claims.map(c => `[gap-fill] ${c}`))
  if (gapsFilled.length) {
    const second = await writeReport(
      confirmed.concat(gapsFilled),
      'A first draft missed some sub-questions; the [gap-fill] claims below address them — integrate them. '
    )
    if (second) report = second
  }
}

return {
  question,
  angles: plan.angles.map(a => a.title),
  claimsConfirmed: confirmed.length,
  claimsRejected: rejected,        // read these — what verification KILLED is the interesting part
  gapsFilled: audit?.gaps ?? [],
  report,
}

//  TRY: read `claimsRejected` in the result first — every entry is a
//  confident-sounding statement that did not survive contact with the
//  actual files. That list is the argument for this entire architecture.
//  Then aim it elsewhere: run from another repo with
//  args {question: "what are the moving parts of this codebase?"}.
