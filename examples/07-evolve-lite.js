// ─────────────────────────────────────────────────────────────────────────────
//  Example 07 · evolve-lite — comparative selection: the heart of /evolve
//
//  Teaches: the champion pattern — generate DIVERSE candidates, judge
//           COMPARATIVELY (never "rate this 1–10"), replace the champion
//           only when beaten. This is evolve-workflow.js with the loop and
//           armor stripped away so the skeleton shows.
//  Agents spawned: 7  (3 generators, 1 judge, 1 critic, 1 reviser, 1 final judge)
//  Run: "Run the workflow at examples/07-evolve-lite.js"
//       (optionally: ... with args {ask: "your question"})
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHY comparison beats scoring: models are noisy at absolute judgments
//  ("this is a 7") but far more consistent at relative ones ("B serves this
//  reader better than A"). So never ask "is it good?" — arrange for the
//  question to always be "did anything beat it?".
//
//  WHY diverse stances: three unconstrained "answer this" agents produce
//  three similar takes. Three STANCES — compact, didactic, skeptical — force
//  the candidates into different corners of the solution space, so the judge
//  has a real choice. Diversity is engineered in prompts, not left to luck.

export const meta = {
  name: 'ex07-evolve-lite',
  description: 'Three stances, a judge, one critique-revise-rejudge round — /evolve minus the loop',
  phases: [{ title: 'Generate' }, { title: 'Judge' }, { title: 'Critique' }, { title: 'Refine' }],
}

let IN = args ?? {}
if (typeof IN === 'string') { try { IN = JSON.parse(IN) } catch { IN = { ask: IN } } }
const ask = IN.ask ?? 'How should a small team decide what to test: unit, integration, or end-to-end?'

const STANCES = [
  { key: 'compact', text: 'Answer in the most direct, compact way that still fully serves the ask.' },
  { key: 'didactic', text: 'Build intuition first, then give a concrete example, then practical guidance.' },
  { key: 'skeptical', text: 'Lead with what usually goes wrong and the trade-offs everyone underestimates.' },
]

//  The judge's schema is built from the ACTUAL labels in play — the enum
//  guardrail from Example 02. A judge over two candidates physically cannot
//  answer 'C'.
const pickSchema = (labels) => ({
  type: 'object',
  properties: {
    winner: { type: 'string', enum: labels },
    reason: { type: 'string', description: 'one sentence: why it beats the others' },
  },
  required: ['winner', 'reason'],
})

//  ── Generate: three candidates, concurrently (Example 03's move) ──
log(`Generating ${STANCES.length} candidates for: ${ask}`)
const raw = await parallel(STANCES.map(s => () =>
  agent(
    `${ask}\n\nStance for this attempt: ${s.text}\n\n` +
    `Your final message must be the complete answer and nothing else.`,
    { label: `gen:${s.key}`, phase: 'Generate' }
  )
))
//  map-before-filter keeps each surviving candidate paired with its stance.
const candidates = raw.map((text, i) => text && { stance: STANCES[i].key, text }).filter(Boolean)
if (!candidates.length) return { error: 'all generators failed' }

//  ── Judge: one comparative pick over whoever survived ──
const label = (i) => String.fromCharCode(65 + i)   // 0→A, 1→B, 2→C
const pick = async (cands, framing) => {
  const v = await agent(
    `${framing}\nThe ask was:\n"${ask}"\n\nJudge content only — ignore the order candidates appear in.\n\n` +
    cands.map((c, i) => `--- CANDIDATE ${label(i)} ---\n${c.text}\n--- END ${label(i)} ---`).join('\n\n'),
    { label: 'judge', phase: 'Judge', schema: pickSchema(cands.map((c, i) => label(i))) }
  )
  //  Judge failure → the FIRST candidate by convention here. The real
  //  evolve-workflow.js is stricter: it falls back to the incumbent
  //  champion specifically, so a judge outage can never crown an unjudged
  //  revision. (Read §5 of evolve-workflow.annotated.js for that version.)
  const idx = v ? v.winner.charCodeAt(0) - 65 : 0
  return { chosen: cands[idx], reason: v?.reason ?? 'judge unavailable — defaulted' }
}

const first = await pick(candidates, 'Pick the candidate that serves the asker best overall.')
let champion = first.chosen
log(`Champion: '${champion.stance}' stance — ${first.reason}`)

//  ── Critique: one lens (the full evolve runs three, disclaiming turf) ──
const critique = await agent(
  `Critique the answer below against this ask:\n"${ask}"\n\n` +
  `List every substantive issue: gaps, wrong emphasis, unclear steps, anything ` +
  `that would force a follow-up question. No style nitpicks.\n\n` +
  `--- ANSWER ---\n${champion.text}\n--- END ---`,
  {
    label: 'critic', phase: 'Critique', model: 'haiku',
    schema: {
      type: 'object',
      properties: {
        passes: { type: 'boolean', description: 'true ONLY if zero substantive issues remain' },
        issues: { type: 'array', items: { type: 'string' } },
      },
      required: ['passes', 'issues'],
    },
  }
)

if (!critique || critique.passes || !critique.issues.length) {
  return {
    ask, final: champion.text, stance: champion.stance,
    trajectory: [`round 0: '${champion.stance}' won — ${first.reason}`,
                 critique ? 'critic passed the champion — no revision round needed' : 'critic failed — champion stands unexamined (the full evolve retries here)'],
  }
}

//  ── Refine + re-judge: the revision must BEAT the incumbent to replace it ──
log(`Critic found ${critique.issues.length} issue(s) — revising`)
const revised = await agent(
  `Revise the answer below. It answers:\n"${ask}"\n\nIssues found by a critic:\n` +
  critique.issues.map(i => '- ' + i).join('\n') +
  `\n\nFix the issues; keep what works. Your final message must be the complete ` +
  `revised answer and nothing else.\n\n--- ANSWER ---\n${champion.text}\n--- END ---`,
  { label: 'reviser', phase: 'Refine' }
)

let finalVerdict = 'reviser failed — champion stands by default'
if (revised) {
  //  THE INCUMBENT RULE: without "prefer the incumbent unless the revision
  //  is a real improvement", every round crowns a cosmetic rewording and
  //  the answer drifts instead of improving. Champion status must be TAKEN.
  const rematch = await pick(
    [champion, { stance: 'revised', text: revised }],
    'Candidate A is the incumbent champion. Prefer it unless candidate B is a real ' +
    'improvement — cosmetic rewording that adds no value must not win.'
  )
  champion = rematch.chosen
  finalVerdict = `${champion.stance === 'revised' ? 'revision won' : 'champion survived'} — ${rematch.reason}`
  log(finalVerdict)
}

return {
  ask,
  final: champion.text,
  trajectory: [
    `round 0: '${first.chosen.stance}' won the ${candidates.length}-way pick — ${first.reason}`,
    `critique: ${critique.issues.length} issue(s)`,
    `rematch: ${finalVerdict}`,
  ],
}

//  TRY: diff this file against evolve-workflow.js and list what the full
//  version adds: the while-loop, THREE disclaiming critics, TWO reviser
//  stances (conservative/bold), position-rotation (PERMS), the dry counter,
//  vacuous-truth guards, incumbent-safe judge fallback. Every addition is a
//  defense — the skeleton is what you just read.
