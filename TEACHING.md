# Understanding `evolve-workflow.js` and the Claude Code Workflow tool

**How to read this guide.** It's built in six levels of depth. Each level is
self-contained: you can stop after any level and have a complete (if shallower)
picture. Each later level re-explains nothing — it assumes the levels above it.
The companion file [`evolve-workflow.annotated.js`](evolve-workflow.annotated.js)
is the same script with teaching comments woven through every section; read it
alongside Levels 2–3.

- **Level 0** — the one-breath mental model
- **Level 1** — the cast of characters: what runs what
- **Level 2** — the algorithm: natural selection for answers
- **Level 3** — the defensive details: eleven subtleties in the code
- **Level 4** — under the hood: what the Workflow runtime guarantees
- **Level 5** — why it's built this way, where it's weak, and exercises

---

## Level 0 — the one-breath mental model

`evolve-workflow.js` is **natural selection for answers**. Instead of asking
one AI to write an answer and trust its own judgment, it breeds *diverse*
candidate answers, lets a judge (role-playing your target reader) crown a
**champion**, then repeatedly: critics find flaws → two revisers breed
challenger variants → the champion is replaced **only if a challenger beats
it**. It stops when critics find nothing left to fix.

The **Workflow tool** is the stage this runs on: a plain JavaScript script that
acts as a *deterministic conductor* for a fleet of AI agents. The script itself
cannot think — it's ordinary code with loops and ifs. The agents it spawns can
think but can't steer — each is a one-shot AI call that answers one prompt and
disappears. All the judgment lives in the agents; all the control flow lives in
the code.

That division of labor is the single most important idea here:

> **Judgment in the model, control flow in the code.**
> Loops, thresholds, retries, and stopping rules are things code does reliably
> and models do sloppily. Writing, critiquing, and comparing are things models
> do well and code can't do at all. The Workflow tool exists to let you put
> each job where it belongs.

---

## Level 1 — the cast of characters: what runs what

### The pipeline when you type `/evolve <question>`

Five layers, top to bottom:

```
You            type  /evolve explain TCP slow start
  │
Skill          SKILL.md — a markdown "recipe card" injected into Claude's
  │            context. Not code. It tells Claude: read critics.md (the
  │            skill's config file), collect the ask, call the Workflow
  │            tool, report the result.
  │
Main Claude    the session you're chatting with. Follows the recipe:
  │            builds `args` ({ask, profile, models, maxRounds}) and calls
  │            Workflow with scriptPath → evolve-workflow.js
  │
Workflow       Claude Code's runtime executes the .js file as real,
runtime        deterministic JavaScript — the model does NOT interpret it.
  │            Runs in the background; progress is visible via /workflows.
  │
Agents         every `agent(prompt, opts)` call in the script spawns a fresh
               subagent — an independent AI call with its own empty context.
               Its final text (or schema-validated object) is the return value.
```

When the script finishes, its `return {...}` object travels back up to Main
Claude, which writes the human-facing summary (that's Step 3 in SKILL.md). The
script never talks to you directly — `log()` lines show as progress notes, but
the *answer* is delivered by Main Claude.

**Jargon check — "skill":** in Claude Code, a skill is just a folder with a
`SKILL.md` file. Invoking `/evolve` pastes those instructions into Claude's
context. There is no skill "engine"; the markdown *is* the program, and Claude
is its interpreter. That's why SKILL.md says "NEVER copy or inline the script"
— the deterministic part must stay in the .js file where the runtime, not the
model, executes it.

**Where `critics.md` fits:** before calling the Workflow, Main Claude reads
`~/.claude/skills/evolve/critics.md` — a plain-markdown config file that ships
with the skill — and passes two things through as args: the **Reader profile**
(verbatim text — who the answer is judged for) and the **Models** map (which
Claude model each role runs on). Trimmed, the file looks like this:

```markdown
## Reader profile
- Learning Claude Code skills; comfortable programmer, new to multi-agent patterns.
- Wants the intuitive mental model FIRST, then the mechanism, then an example.

## Models
brain: inherit     # the generate/revise agents — keep strong
judge: haiku       # default model for the three critics — small saves tokens
correct: inherit   # optional per-critic override; beats the judge default
pick: inherit      # the tournament judge — comparing whole answers is hard
```

The script never reads this file itself — it can't (Level 4 explains why);
everything it knows arrives in `args`.

### The five primitives the script is given

Workflow scripts are sandboxed: no filesystem access, no Node.js APIs — the
small toolkit of globals the runtime injects is the script's entire interface
to the world:

| Primitive | What it does | Used in evolve? |
|---|---|---|
| `agent(prompt, opts)` | Spawn one subagent; `await` its answer. With `opts.schema` (a JSON Schema) you get a validated object instead of free text. Returns `null` if the agent fails or is skipped. | Everywhere |
| `parallel([thunk, ...])` | Run several thunks concurrently and **wait for all of them** (a *barrier*). A failed thunk becomes `null` in the results; the call itself never throws. | Generators, critics, revisers |
| `pipeline(items, stage1, stage2, ...)` | Per-item assembly line with **no barrier** — item A can be in stage 3 while item B is still in stage 1. | Not used here (see Level 4 for why evolve legitimately wants barriers) |
| `log(msg)` / `phase(title)` | Progress narration / progress grouping in the UI. | `log` yes; `phase` via per-agent `opts.phase` instead (Level 3, subtlety 11) |
| `args` | Whatever Main Claude passed in, verbatim. | The ask, profile, models, maxRounds, optional draft |

(`Jargon check — "thunk":` a function wrapping a computation so it doesn't
start until called — `() => agent(...)` instead of `agent(...)`. `parallel`
needs thunks so *it* controls when each one starts.)

Two more globals exist but evolve doesn't use them: `budget` (a shared
output-token ceiling, set when the user puts something like "+500k" in their
request to cap or scale the run) and `workflow()` (run another workflow as a
sub-step, one level of nesting max).

### Honest caveat: what an "agent" really is

Words like "brain", "critic", "judge" suggest persistent beings that remember
and collaborate. They don't exist. Every `agent()` call is a **stateless,
one-shot AI invocation**: fresh context window, sees only its prompt (plus its
tools), produces one final message, gone. The "critic" in round 2 has no memory
of round 1 — it isn't the same anything. All continuity lives in the script's
variables (`champion`, `history`, `dry`). This is a feature, not a bug: fresh
contexts are what make the critiques *independent* (Level 5).

One more caveat: subagents do have tools (they can read files, run commands,
search). Evolve's prompts don't ask them to — every role here works purely from
the text in its prompt.

---

## Level 2 — the algorithm: natural selection for answers

The genetic-algorithm mapping, up front:

| Genetics | evolve-workflow.js |
|---|---|
| Initial gene pool | Two candidates from *different stances* (direct vs thorough) |
| Fitness function | The `pick` judge, role-playing your reader profile |
| Small mutation | The **conservative** reviser (fix listed issues only) |
| Large mutation / recombination | The **bold** reviser (fix issues AND restructure freely) |
| Selection with elitism | 3-way tournament; the champion survives unless *beaten* |
| Convergence test | Three critics all vote "passes" |
| Stagnation detection | The `dry` counter — two rounds without a new champion |

### Round 0 — seed the population (skipped if you pass a `draft`)

Two "brain" agents answer the ask **in parallel**, each pushed to a different
corner of the solution space by a *stance* line in its prompt:

- `direct` — "most straightforward, compact way that still fully serves the ask"
- `thorough` — "build intuition first, concrete example, cover what's needed next"

Diversity is engineered *in the prompt*, not left to sampling randomness — two
unconstrained attempts would likely be two similar takes on the same idea. A
judge agent then compares them **as your reader** (the profile from
`critics.md` is pasted into its prompt: "You judge as this reader: …") and
crowns the champion. If exactly one generator fails, the survivor wins
unopposed; if both fail, the script returns an `error` and stops.

When you run `/evolve last answer`, Main Claude passes the existing text as
`args.draft`, and it becomes the champion directly — Round 0 never runs.

### The refinement round (repeats up to `maxRounds`, default 4)

**1. Critique — three lenses in parallel.** Each critic gets the champion's
full text and a brief that *deliberately disclaims the other critics' turf*, so
one dimension can't be traded off against another:

- `understand` — *becomes* the reader ("You ARE the reader… critique in first
  person") and reads top-to-bottom once, flagging every stumble: unexplained
  jargon, missing intuition, walls of text. Explicitly told to ignore accuracy
  and coverage.
- `useful` — judges only whether the answer serves the ask: every explicit part
  addressed, actionable, no forced follow-up question. Explicitly told to
  ignore style.
- `correct` — judges only facts, code, commands, names. Told to ignore style
  and coverage. ("A convincing answer that is wrong is the worst outcome.")

Each returns a schema-enforced verdict: `{passes: boolean, issues: string[]}`.

**2. Converge?** If **all three** critics responded *and* all say `passes`,
the loop ends — `converged: true`. (Why "all three responded" matters is
subtlety 4 in Level 3.)

**3. Breed two challengers.** All issues (each tagged `[understand]`,
`[useful]`, or `[correct]`) go to two reviser agents in parallel, both given
the champion text plus the issue list, with opposite stances:

- **conservative** — "fix ONLY the listed issues; preserve everything they do
  not touch; do not rewrite for taste." (Exploitation: bank the known fixes.)
- **bold** — "fix the listed issues AND freely restructure, cut, or rewrite."
  (Exploration: escape local optima the conservative path can't.)

**4. Tournament.** A judge sees three candidates — champion, conservative,
bold — labeled A/B/C in an order that *rotates every round* (position-bias
counter, subtlety 6). It's told which label is the incumbent champion and to
prefer it "unless a revision is a real improvement — cosmetic rewording that
adds no value must not beat the champion." Winner becomes (or remains) the
champion.

**5. Stagnation check.** If the champion survived, `dry` increments; when
`dry` reaches 2 the loop ends with `driedOut: true` ("we're at a local
optimum; more rounds are burning tokens, not adding quality"). Any replacement
resets `dry` to 0.

### The three ways the loop ends

| Ending | Meaning | Signal in the result |
|---|---|---|
| Critics all pass | Genuine convergence — nothing left to flag | `converged: true` |
| Two no-improvement contests since the last replacement (incumbent wins and/or reviser failures, any mix) | Improvement dried up | `driedOut: true` |
| Round cap (`maxRounds`) | Ran out of budget mid-climb | both flags `false` |

Honest caveat on the third ending: if the cap hits right after a revision won,
that final champion was **never re-critiqued** — SKILL.md tells Main Claude to
disclose that rather than present the result as verified.

### A worked trace

`/evolve explain TCP slow start` might unfold like:

```
Round 0  generate: direct ✍   thorough ✍       (parallel)
         pick: "B (thorough) — builds the congestion-window intuition
               before the algorithm; direct assumes the reader knows cwnd"
Round 1  critique: understand ✗ (2 issues: 'cwnd' used before defined;
                   no example numbers)   useful ✓   correct ✓
         revise: conservative ✍  bold ✍          (parallel)
         pick: "conservative — fixed both stumbles without losing the
               structure; bold's rewrite dropped the loss-recovery part"
Round 2  critique: all three ✓  →  converged
```

Result object: `{final: <the answer>, rounds: 2, converged: true,
driedOut: false, history: [...]}` — and `history` is exactly what Main Claude
narrates back to you.

---

## Level 3 — the defensive details: eleven subtleties in the code

These are the parts you'd only notice by reading closely — and the parts most
likely to break if you edit casually. Each is called out by number in the
annotated file's comments.

**1. `args` normalization + fail-fast.** The harness (Claude Code's runtime
from Level 1 — the two words mean the same thing here) sometimes delivers
`args` JSON-encoded as a string, so line one is
`typeof args === 'string' ? JSON.parse(args) : (args ?? {})`. Then a missing
`ask` returns `{error: ...}` immediately — the error/`final` split is the
script's *contract* with SKILL.md Step 3, which checks for `error` before
presenting anything.

**2. Model plumbing and the `inherit` trap.** `resolve(name)` turns a model
name into `{model: name}` — or `{}` for `'inherit'`/missing, and `{}` spread
into agent opts means "no override; run on the session model." The subtle bit
is `criticOpts(key)`: `resolve(MODELS[key] ?? MODELS.judge)`. `??` only fires
on `undefined`/`null` — so `correct: 'inherit'` in critics.md *pins* that
critic to the session model, while *omitting* `correct` lets it fall through
to the cheaper `judge` default. Same-looking config, different behavior;
SKILL.md warns about exactly this.

**3. Schemas as guardrails, not requests.** `opts.schema` doesn't *ask* the
agent for JSON — the runtime forces it to answer through a validated
structured-output tool and retries on mismatch (Level 4). And `pickSchema`
builds its `enum` from the *actual* candidate labels, so a 2-way pick
physically cannot return `"C"`. Constraining at the validation layer beats
writing "please only answer A or B" in the prompt.

**4. The `[].every()` vacuous-truth footgun.** In JavaScript,
`[].every(x => x.passes)` is `true` — an empty list "all passes" vacuously. If
all three critics crashed, a naive check would declare convergence on zero
evidence. Hence the double condition:
`verdicts.length === LENSES.length && verdicts.every(c => c.passes)`.

**5. Map before filter, to keep attribution.** Failed critics come back as
`null`. The code maps `critiques` to verdicts *first* — while the array index
still lines up with `LENSES` — so each issue gets its `[understand]`-style tag,
and only *then* filters the nulls out. Filter first and the indexes shift: the
wrong critic gets credited.

**6. Position-bias rotation.** AI judges statistically favor candidates by
position (often first or last). `PERMS` holds three orderings of
champion/conservative/bold, and `PERMS[round % 3]` rotates which slot each
contender occupies per round — plus the judge prompt says "ignore the order."
Also note labels are assigned **after** filtering out failed revisers
(`.filter(...).map((name, i) => [String.fromCharCode(65 + i), ...])`), so
candidates are always labeled contiguously A, B(, C) with no gap for the judge
to trip on.

**7. Incumbent bias, twice.** The judge is told to prefer the champion unless
a revision is a *real* improvement — otherwise every round would produce a
cosmetically-reworded "winner" and the answer would drift without improving.
And if the judge call itself fails, the fallback is
`championEntry ?? labeled[0]` — the *incumbent*, never an unjudged revision.
When the referee doesn't show up, nobody wins by default.

**8. What `dry` really counts.** Not just "champion won" — it also increments
when fewer than two contenders exist (both revisers failed), because that
round also produced no improvement. But it is *not* simply "consecutive rounds
without a new champion": the zero-issue retry branch (subtlety 10) `continue`s
before ever touching `dry`, so a retry round neither increments nor resets it
— meaning the two increments that end the loop need not be adjacent rounds.
Precisely: `dry` counts *contested* rounds without a new champion since the
last replacement, and any successful replacement resets it to 0.

**9. `null`-tolerance everywhere.** `agent()` returns `null` on failure rather
than throwing. Every consumption site is shaped for that: Round 0 handles
one-or-both generators dying; verdicts filter nulls; contenders filter missing
revisions; `pick` survives a dead judge (`v?.winner`). A workflow that fans out
dozens of calls *will* see occasional nulls — the script treats them as
weather, not exceptions.

**10. The "no issues but not converged" branch.** It's possible to reach a
state with zero issues yet no convergence — some critics didn't respond, or a
critic said `passes: false` with an empty issue list. Revising on zero issues
would be noise, so the script logs why and `continue`s to a fresh critique
round. Honest cost: that burns one of the `maxRounds`.

**11. Phases without `phase()`.** The script never calls the global `phase()`
— every agent carries `opts.phase: 'Generate' | 'Critique' | ...` instead.
The global sets shared state, and with parallel agents in flight, "current
phase" is a race. Per-agent tags are race-free, and `meta.phases` pre-declares
the same four titles so the UI shows the group boxes in order from the start.

---

## Level 4 — under the hood: what the Workflow runtime guarantees

Now the stage itself. These facts are properties of Claude Code's Workflow
tool, not of this script.

**Execution model.** The script is plain JavaScript (not TypeScript — type
annotations won't parse), run by the harness in an async context, so top-level
`await` and top-level `return` are legal. There is **no** filesystem or
Node.js API access — standard built-ins plus the injected globals are the
script's entire reach. That's why the reader profile must arrive via `args`
rather than the script reading `critics.md` itself.

**The `meta` block is parsed before the script runs.** It must be a *pure
literal* — no variables, no function calls, no template interpolation — because
the harness reads it statically to render the permission dialog and the phase
list before executing anything. `meta.phases` titles are matched *exactly*
against `phase()` calls / `opts.phase` tags.

**Determinism, because of resume.** `Date.now()`, `Math.random()`, and
argless `new Date()` **throw** inside a workflow script. Reason: every
completed `agent()` call is journaled, and a resumed run
(`resumeFromRunId`) replays the longest unchanged *prefix* of `agent()` calls
from cache — matching on (prompt, opts). Nondeterminism in prompt construction
would make replay impossible. This is also your debugging superpower: the
journal (`journal.jsonl` in the run's transcript directory) records what every
agent actually returned; and after editing the script you can resume, paying
only for the calls after your edit.

**`parallel` is a barrier; `pipeline` is not.** Level 1's table defined both;
the design question is when each is right. The tool docs push you toward
`pipeline` by default because barriers waste wall-clock (every item waits for
the slowest) — but evolve is a textbook case of *legitimate* barriers:
convergence needs **all** critics' verdicts together; a tournament needs
**all** contenders present; Round 0's pick needs **both** candidates. When
stage N genuinely consumes the whole of stage N−1, a barrier is correct.

**Concurrency and caps.** Concurrent agents per workflow are capped at
`min(16, CPU cores − 2)`; excess calls queue transparently. Lifetime cap:
1000 agents per workflow (a runaway-loop backstop). A single
`parallel`/`pipeline` call takes at most 4096 items. Evolve's widest fan-out
is 3, so none of this binds here — but it's why you can pass 100 items to
`parallel` in your own scripts and it just works.

**Schema enforcement.** The mechanism behind subtlety 3: validation happens at
the *tool-call layer* — the subagent must answer through a structured-output
tool, a mismatched answer is rejected and retried before `agent()` ever
resolves, and your script receives a parsed object, never a string to
`JSON.parse` yourself. A surface most people miss: the `description` strings
on schema properties are shown to the subagent as per-field *instructions* —
evolve's judges return tidy one-line reasons because `pickSchema`'s reason
field literally asks for "one sentence".

**Per-agent knobs.** Besides `label`/`phase`/`schema`: `model` (what
critics.md's roles map onto — `haiku`/`sonnet`/`opus`/`fable`; omit to inherit
the session model), `effort` (reasoning depth), `agentType` (use a custom
subagent definition), and `isolation: 'worktree'` (own git worktree, only for
agents that mutate files in parallel — evolve's agents only write text, so it's
unused).

**Return-value discipline.** Subagents are explicitly told their final message
IS the return value — raw data for the script, not prose for a human. That's
why every brain prompt here ends with "Your final message must be the complete
answer and nothing else": one stray "Here's your revised answer!" preamble
would become part of the champion text.

**Lifecycle.** Workflows run in the background: the Workflow tool call returns
immediately with a run ID, `/workflows` shows the live progress tree
(`log()` lines and the phase groups from `meta.phases`), and the script's
return object is delivered back to Main Claude on completion. Every invocation
also persists its script under the session directory, which is what
`scriptPath` + resume iterate on.

---

## Level 5 — why it's built this way, where it's weak, and exercises

### The design principles

**Never let the author grade its own work.** A model asked "is your answer
good?" says yes — the same blind spots that produced a flaw also hide it, and
self-assessment skews agreeable. Evolve splits author / critic / judge into
separate agents with separate context windows, so every evaluation is
independent. (This is the moral of the SKILL.md line: "quality comes from
breeding diverse variants and letting a judge select, not from a single
agent's self-assessment.")

**Comparison beats scoring.** The judge never rates an answer 7/10 — absolute
scores from language models are noisy and drift. It only ever answers "which
of these is better *for this reader*?", a relative judgment models are far
more consistent at. That's why the champion mechanic exists at all: it turns
"is it good?" into "did anything beat it?"

**One critic, one dimension.** A single "review this" critic implicitly
trades dimensions off ("a bit wordy but very accurate — fine overall"). Three
disclaiming lenses can't: wordiness has nowhere to hide from `understand`,
and being charming buys nothing from `correct`.

**Explore and exploit at the same time.** Conservative-only refinement gets
stuck polishing a mediocre structure; bold-only refinement risks losing fixes
in each rewrite. Breeding one of each per round, every round, means the
tournament — not a hyperparameter — decides how adventurous this particular
answer's evolution gets.

**Two-of-everything cost shape.** Why 2 stances, not 5? Why 3 critics, not 8?
Each extra brain-class agent is a full answer-length generation. The per-round
arithmetic: 3 calls to seed (two generators + a pick), 6 per contested round
(three critics + two revisers + a pick), 3 for the converging round — so a run
that converges in round 2 costs ~12 calls, and the default 4-round cap tops
out near 27. critics.md lets you spend less (haiku critics) or more (fable
everything) without touching code.

### Honest limits

- **Critics have no memory across rounds.** Round 3's `understand` critic can
  re-raise a nitpick that Round 1's revision deliberately handled differently,
  or flag brand-new taste issues forever. Convergence relies on critics
  running out of *substantive* objections; the round cap and `dry` counter
  are the backstops against oscillation, not a proof it can't happen.
- **The judge reads all candidates in one context.** Three long answers plus
  the profile must fit and stay distinguishable; very long answers degrade
  judgment quality before they hit hard limits.
- **`correct` is a reading check, not a test run.** The critic judges code and
  claims by inspection. Subagents *have* tools, so you could prompt it to
  execute code it doubts — the current brief doesn't.
- **Incumbent bias can reject real improvements.** "Prefer the champion" is
  deliberately conservative; occasionally a genuinely better bold rewrite will
  lose for looking like taste. The bet: bias toward stability beats bias
  toward churn.
- **A dead judge freezes evolution.** Judge failure falls back to the
  incumbent (safe), but if it kept failing you'd ride `dry` to a quiet
  `driedOut` exit rather than an error. The `history` log is where you'd see
  that pattern.

### Exercises, in rising order of ambition

1. **Read a run.** After `/evolve <question>`, ask Claude to show you the
   run's `journal.jsonl` — the Workflow tool result names the run's transcript
   directory, and `/workflows` lists recent runs. In it, find: both Round 0
   candidates, each critic's raw verdict object, and the judge's reason
   strings. Match them to `history`.
2. **Retune the fleet.** In `critics.md`, set `judge: haiku` but
   `understand: inherit` (subtlety 2 — pinning vs falling through), rerun,
   and compare critique quality per token spent.
3. **Add a stance — and find the trap.** Give `STANCES` a third entry (e.g.
   *skeptical:* "lead with what usually goes wrong"), then trace Round 0 and
   find why the third answer would be silently DISCARDED: only the generation
   fan-out maps over `STANCES` — the `[direct, thorough]` destructure, the
   hardcoded two-entry `labeled` array, the two-way champion ternary, and the
   one-failure branch are all wired for exactly two. The real exercise is
   generalizing that block to N stances (build `labeled` by mapping over the
   survivors); `pickSchema` already takes labels dynamically, so the judge
   side needs nothing.
4. **Add a fourth lens.** A `concise` critic that only flags redundancy.
   You'll touch `LENSES` and critics.md's Models section — and notice
   subtleties 4 and 5 quietly keep working because they're written against
   `LENSES.length`, not the number 3.
5. **Make `correct` empirical.** Change its brief to instruct: extract every
   runnable command/claim and verify with your tools before voting.
6. **Write your own workflow from scratch.** Below.

### Try it now — a minimal workflow of your own

The essential moves in ~20 lines — two primitives, one schema, one return:

```js
export const meta = {
  name: 'toy-tournament',
  description: 'Three styled answers, one judge picks',
  phases: [{ title: 'Answer' }, { title: 'Judge' }],
}
let A = args ?? {}                      // subtlety 1's normalization, compact form
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = { q: A } } }
const q = A.q ?? 'Why is the sky blue?'
const styles = ['for a curious child', 'for a physicist', 'as a single tweet']
const answers = (await parallel(styles.map(style => () =>
  agent(`Answer "${q}" ${style}. Your final message must be the answer only.`,
        { phase: 'Answer', label: style })
))).filter(Boolean)                       // agent() failures arrive as null
const verdict = await agent(
  `Pick the clearest answer to "${q}".\n\n` +
  answers.map((a, i) => `--- CANDIDATE ${i} ---\n${a}`).join('\n\n'),
  { phase: 'Judge', schema: {
      type: 'object',
      properties: { winner: { type: 'number' }, reason: { type: 'string' } },
      required: ['winner', 'reason'],
  } }
)
return { best: answers[verdict?.winner] ?? answers[0], why: verdict?.reason, all: answers }
```

Save it anywhere (say `~/toy-tournament.js`), then in any Claude Code session:
*"Run the workflow at ~/toy-tournament.js with args {q: 'why do ships
float?'}"*. Watch it in `/workflows`; when it finishes, ask Claude to show you
the returned object — then go re-read `evolve-workflow.annotated.js` and
notice it's this exact skeleton, grown eleven defensive details and one
evolutionary loop.
