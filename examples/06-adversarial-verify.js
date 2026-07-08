// ─────────────────────────────────────────────────────────────────────────────
//  Example 06 · adversarial verification — agents checking agents
//
//  Teaches: never trust one agent's confidence. Truth becomes a FLEET
//           property: independent skeptics try to DESTROY a claim with
//           tools, and deterministic code counts the votes.
//  Agents spawned: 3 skeptics (each with tools, each a different attack angle)
//  Run from this repo:
//       "Run the workflow at examples/06-adversarial-verify.js"
//       (optionally: ... with args {claim: "any checkable claim about this repo"})
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHY refute, not confirm: ask an agent "is this right?" and it usually
//  says yes — agreement is the path of least resistance, and (worse) a
//  claim that LOOKS plausible pattern-matches as true. Ask an agent to
//  REFUTE, arm it with tools, and tell it that uncertainty counts as
//  refuted — now surviving means something. A claim still standing after
//  three motivated, independent attacks is worth trusting.
//
//  WHY three DIFFERENT angles instead of three identical skeptics: identical
//  skeptics share blind spots — they redundantly catch the same failure mode
//  and miss the same others. Diverse lenses (read it whole / hunt
//  counterexamples / attack the wording) cover failure modes redundancy
//  can't. evolve-workflow.js makes the same move with its three critic
//  lenses; the /code-review machinery makes it at larger scale.

export const meta = {
  name: 'ex06-adversarial-verify',
  description: 'Three tool-armed skeptics attack one claim; code tallies the verdict',
  phases: [{ title: 'Refute' }, { title: 'Verdict' }],
}

let IN = args ?? {}
if (typeof IN === 'string') { try { IN = JSON.parse(IN) } catch { IN = { claim: IN } } }

//  The default claim is deliberately about THIS repo, checkable in seconds
//  by any agent willing to open the file. (It happens to be true — the
//  skeptics' grep will find `phase:` option keys but no `phase(` call.)
const claim = IN.claim ??
  'In this repo\'s evolve-workflow.js, the global phase() function is never called; ' +
  'phases are assigned only through the per-agent "phase:" option on agent() calls.'

const ANGLES = [
  { key: 'close-reader', hint: 'Read the relevant file(s) in the current working directory top to bottom yourself before deciding — do not trust a skim.' },
  { key: 'counterexample-hunter', hint: 'Use search tools (grep and friends) to hunt for a single concrete counterexample. One is enough to refute.' },
  { key: 'wording-attacker', hint: 'Attack the claim\'s WORDING: find the strictest honest reading of each word, then check whether the strict reading still holds against the actual files.' },
]

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true if you found real evidence against the claim, OR could not verify it — unverifiable counts as refuted' },
    evidence: { type: 'string', description: 'the specific file/line/observation your verdict rests on — cite what you actually saw' },
  },
  required: ['refuted', 'evidence'],
}

log(`3 skeptics attacking: ${claim}`)

const votes = await parallel(ANGLES.map(a => () =>
  agent(
    `You are a skeptic. Your ONLY goal is to REFUTE this claim about the repository ` +
    `in the current working directory:\n\n"${claim}"\n\n` +
    `Attack angle assigned to you: ${a.hint}\n\n` +
    `Use your tools — do not judge from plausibility. If you cannot actually verify ` +
    `the claim against the real files, report refuted=true: unverified claims do not ` +
    `get the benefit of the doubt here.`,
    { label: `skeptic:${a.key}`, phase: 'Refute', schema: VERDICT_SCHEMA }
  )
))

//  THE TALLY IS CODE, NOT VIBES. Which votes count, what quorum means, what
//  a tie does — all deterministic decisions that belong in the script, not
//  in another model's mood. (Same reason evolve's convergence check is an
//  `every()` over schema fields.)
const responders = votes
  .map((v, i) => v ? { skeptic: ANGLES[i].key, ...v } : null)   // map-before-filter keeps attribution
  .filter(Boolean)

let verdict
if (responders.length < 2) {
  verdict = 'INCONCLUSIVE — fewer than 2 skeptics responded; never conclude from a quorum you did not get'
} else {
  const refutedVotes = responders.filter(r => r.refuted).length
  verdict = refutedVotes * 2 > responders.length
    ? `REFUTED by ${refutedVotes}/${responders.length} skeptics`
    : `STANDS — survived ${responders.length} independent refutation attempts`
}

log(`Verdict: ${verdict}`)

return {
  claim,
  verdict,
  votes: responders,   // read each skeptic's evidence — the receipts matter more than the tally
}

//  TRY: re-run with a claim that is FALSE but plausible-sounding, e.g.
//  args {claim: "evolve-workflow.js retries a failed critic agent up to
//  3 times before giving up"} — and watch tool-armed skeptics shred what a
//  single agent might have politely confirmed. Then flip one skeptic's brief
//  from "refute" to "confirm" and notice how much softer its evidence gets.
