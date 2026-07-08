// ─────────────────────────────────────────────────────────────────────────────
//  Example 03 · fan-out — many minds at once, then one synthesis
//
//  Teaches: parallel() — running a fleet of agents concurrently — plus the
//           two habits that make fleets survivable (thunks, null-filtering)
//           and the first taste of COST SHAPING with per-agent models.
//  Agents spawned: 6  (5 cheap perspective-takers + 1 strong synthesizer)
//  Run: "Run the workflow at examples/03-fan-out.js"
//       (optionally: ... with args {topic: "on-call rotations"})
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHAT parallel() is: give it an array of THUNKS and it runs them
//  concurrently, waiting for ALL to finish (a "barrier"). Failed agents
//  become null in the results array; parallel() itself never throws.
//
//  Jargon check — "thunk": a function wrapping a computation so it doesn't
//  start until called: `() => agent(...)` instead of `agent(...)`. Why it
//  matters: `agent(...)` would START the call the moment the array is built;
//  wrapping it lets parallel() control scheduling. (The runtime caps
//  concurrent agents at min(16, CPU cores − 2) per workflow and queues the
//  rest — you can hand parallel() 100 thunks and it just works.)
//
//  WHY fan out at all: one agent gives you one context window's take. Five
//  agents with five DIFFERENT briefs give you five independent takes — they
//  can't anchor on each other because (rule 1 from Example 01) none of them
//  knows the others exist. Diversity is engineered in the prompts, exactly
//  like evolve-workflow.js's two generator stances.

export const meta = {
  name: 'ex03-fan-out',
  description: 'Five perspectives in parallel, one synthesis — the map/reduce of agents',
  phases: [{ title: 'Fan out' }, { title: 'Synthesize' }],
}

let IN = args ?? {}
if (typeof IN === 'string') { try { IN = JSON.parse(IN) } catch { IN = { topic: IN } } }
const topic = IN.topic ?? 'mandatory code review before every merge'

const PERSPECTIVES = [
  'a security engineer',
  'a brand-new hire in their first week',
  'a product manager under deadline pressure',
  'a site reliability engineer who gets paged at night',
  'an open-source maintainer drowning in drive-by PRs',
]

log(`Fanning out ${PERSPECTIVES.length} perspectives on: ${topic}`)

//  COST SHAPING, the first big fleet lesson: `model: 'haiku'` runs an agent
//  on a small, fast, cheap model. Bulk work (one short opinion each) goes to
//  haiku; the ONE call whose quality gates the whole result — the synthesis —
//  omits `model` and inherits the session's (strong) model. This is the same
//  dial critics.md exposes for evolve: cheap critics, strong brain/judge.
const takes = await parallel(PERSPECTIVES.map(who => () =>
  agent(
    `You are ${who}. In 3–5 sentences, give YOUR honest take on: "${topic}". ` +
    `Lead with your single biggest concern or benefit — the thing the other ` +
    `roles would miss. Your final message must be the take only.`,
    { label: who.split(' ').slice(0, 3).join(' '), phase: 'Fan out', model: 'haiku' }
  )
))

//  THE FLEET HABIT: `.filter(Boolean)` drops the nulls. With 5 agents,
//  occasionally one dies — a fleet that requires 5/5 survivors is fragile;
//  a fleet that synthesizes whoever showed up is robust. But never drop
//  silently: log what was lost, or a partial result reads as a full one.
const survivors = takes.filter(Boolean)
if (survivors.length < takes.length) {
  log(`${takes.length - survivors.length} perspective agent(s) failed — synthesizing from ${survivors.length}`)
}
if (survivors.length === 0) {
  return { error: 'all perspective agents failed; nothing to synthesize', topic }
}

//  THE BARRIER IS LEGITIMATE HERE: synthesis needs ALL takes together —
//  its whole job is comparing them. (When stages DON'T need each other's
//  full results, prefer pipeline() — that's Example 04.)
log('Synthesizing')
const brief = await agent(
  `You are writing a decision brief about: "${topic}".\n\n` +
  `Below are ${survivors.length} independent takes from different roles. Merge them into ` +
  `a short brief: (1) points of agreement, (2) the sharpest CONFLICT between roles and ` +
  `what it hinges on, (3) a recommendation that names the trade-off it accepts. ` +
  `Your final message must be the brief only.\n\n` +
  survivors.map((t, i) => `--- TAKE ${i + 1} ---\n${t}`).join('\n\n'),
  { label: 'synthesize', phase: 'Synthesize' }   // no model: → inherits the strong session model
)

return {
  topic,
  perspectivesHeard: survivors.length,
  brief: brief ?? '(synthesizer failed — raw takes below)',
  rawTakes: survivors,
}

//  TRY: watch this run in /workflows — all five fan-out agents go live at
//  once, the synthesizer only starts after the last one lands (that's the
//  barrier). Then re-run with 15 perspectives of your own and notice the
//  wall-clock barely moves: concurrency, not sequence, is doing the work.
