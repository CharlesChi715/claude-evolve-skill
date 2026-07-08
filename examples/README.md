# The `agent()` course — from one call to a swarm

Eight runnable workflow scripts, each one rung deeper. The subject is a single
function:

```js
const result = await agent(prompt, opts)
```

That's the atom. Everything impressive a workflow ever does — fleets, judges,
skeptics, swarms — is this one call, composed.

## The mental model first

`agent(prompt, opts)` spawns a **subagent**: a fresh, one-shot AI invocation
with its own empty context window and a full tool belt (it can read files, run
commands, search). It reads your prompt, works, produces one final message,
and disappears. Three rules govern every call:

1. **The prompt is its entire world.** No memory, no shared state, no
   knowledge of the script or of other agents. Everything it needs goes into
   the prompt string.
2. **Its final message is the return value.** Raw data for your script, not
   prose for a human.
3. **Failure is `null`, not an exception.** Plan for it.

The power comes from what wraps the call — and that's plain JavaScript:

| `opts` knob | What it unlocks | First taught in |
|---|---|---|
| `label`, `phase` | Legible progress in `/workflows` | 01 |
| `schema` | Validated objects instead of prose — code can branch on answers | 02 |
| `model` | Cost shaping: haiku fleets, strong judges | 03 |
| *(tools — always on)* | Agents that act on the world, not just write | 05 |
| `effort` | Reasoning depth per agent (same idea as `model`; not used in these examples) | — |
| `agentType`, `isolation` | Custom agent definitions; per-agent git worktrees for parallel file mutation | — (see the Workflow tool docs) |

## The ladder

| # | Script | The one idea it adds | Agents |
|---|---|---|---|
| 01 | `01-hello-agent.js` | The atom: one call, three rules | 1 |
| 02 | `02-structured-output.js` | `schema` — answers become data; `enum` as a guardrail | 2 |
| 03 | `03-fan-out.js` | `parallel()` — independent minds at once; null-filtering; haiku fleets | 6 |
| 04 | `04-pipeline.js` | `pipeline()` — per-item assembly lines, no barrier; the `(prev, item, index)` stage signature | 8 |
| 05 | `05-agents-with-tools.js` | Agents ACT: a scout, per-file readers, a cartographer — the script never touches a file | ~10 |
| 06 | `06-adversarial-verify.js` | Agents checking agents: tool-armed skeptics + a deterministic vote | 3 |
| 07 | `07-evolve-lite.js` | Comparative selection: stances → judge → champion → critique → rematch | 7 |
| 08 | `08-research-swarm.js` | The capstone: plan → research → verify → synthesize → gap-fill, all prior ideas composed | 10–15 |

Read them in order; each file's header says what it assumes. The comments use
the same legend as [`../evolve-workflow.annotated.js`](../evolve-workflow.annotated.js):
`WHAT` (plain language), `WHY` (design reason), `GOTCHA` (trap), `TRY`
(experiment).

## How to run any of them

In a Claude Code session opened in this repo, just ask:

```
Run the workflow at examples/03-fan-out.js
Run the workflow at examples/06-adversarial-verify.js with args {claim: "..."}
```

Claude invokes the Workflow tool with that `scriptPath`; the run goes to the
background. While it runs, type `/workflows` to watch the phase boxes and
agents live. When it finishes, Claude receives the script's `return` object —
ask to see any part of it. To audit what each agent really said, ask for the
run's `journal.jsonl`.

Costs are small by design: bulk agents run on `haiku`, and only
quality-critical calls (judges, synthesizers) inherit your session model.
The comments point out every such choice — that dial is itself part of the
curriculum.

## The arc, if you only remember one thing per rung

1. An agent is a **function call**, not a being.
2. A schema turns its opinion into **data your code can branch on**.
3. Independence is the point of a fleet — agents can't anchor on what they
   never see.
4. Don't make fast items wait for slow ones unless a stage truly needs
   **all** of the previous one.
5. The script is sandboxed; the agents are not — **they** are your hands.
6. Never trust one agent's confidence; truth is a **fleet property**.
7. Never ask "is it good?" — arrange for "**did anything beat it?**"
8. Plan → probe → **verify** → synthesize → ask what's missing. Every serious
   swarm is some spelling of that.

Then go read [`../evolve-workflow.annotated.js`](../evolve-workflow.annotated.js):
you'll recognize every move, now wearing production armor. The full layered
theory (runtime guarantees, resume, determinism, design critique) lives in
[`../TEACHING.md`](../TEACHING.md).
