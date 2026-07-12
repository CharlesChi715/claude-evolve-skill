# evolve

A [Claude Code](https://code.claude.com) skill that produces a high-quality answer by **evolutionary refinement** — instead of trusting one agent's self-assessment, it breeds diverse candidate answers and lets a two-judge panel (one role-playing the reader, one fact-checking against official docs) vote for a champion, then improves it round by round until critics stop finding issues.

## How it works

The loop logic lives in [`evolve-workflow.js`](evolve-workflow.js) and runs deterministically via Claude Code's Workflow tool. Each stage:

1. **Generate** — two "brain" agents write candidate answers from *different stances*, so the starting pool is diverse rather than two takes on the same idea. (Skipped when you evolve an existing draft.)
2. **Judge** — two tournament judges vote: a **reader** judge that impersonates the reader profile in first person and weighs understandability + usefulness together, and a **correct** judge that verifies claims against official documentation (web search) instead of trusting memory. Unanimity crowns the reigning **champion**; a split vote keeps the incumbent (at round 0, the reader judge breaks the tie).
3. **Critique** — three critics review the champion in parallel through distinct lenses: reader-fit (does the target reader stumble?), usefulness (does it answer the actual ask?), and correctness.
4. **Refine** — two revisers breed challengers from the champion: one **conservative** (fixes the flagged issues, changes nothing else) and one **bold** (more aggressive rework).
5. **Select** — the same two-judge panel votes again; the champion is only replaced if both judges prefer a challenger. Otherwise it stands.

The loop ends when **all critics pass** (`converged`), after two counted rounds without a new champion (`driedOut`), or at the round cap (default 4).

The design principle: quality comes from *diversity + selection*, not from a single agent grading its own work.

## Install

Copy the skill into your Claude Code skills directory:

```bash
git clone git@github.com:CharlesChi715/claude-evolve-skill.git
mkdir -p ~/.claude/skills/evolve
cp claude-evolve-skill/SKILL.md claude-evolve-skill/evolve-workflow.js claude-evolve-skill/critics.md ~/.claude/skills/evolve/
```

Then start a new Claude Code session and run `/evolve <your question>`.

## Configure (optional)

`evolve` reads `critics.md` beside the installed `SKILL.md` (normally `~/.claude/skills/evolve/critics.md`). If present, it customizes two things:

- **Reader profile** — who the answer is written for. The reader-fit critic and the `reader` tournament judge become this person and work in first person; the revisers write for them.
- **Models** — which model each role uses (`brain`, `pick` default for the tournament judges with per-judge `pick-reader`/`pick-correct` overrides, `judge` default for critics with per-critic `understand`/`useful`/`correct` overrides). Valid values: `haiku`, `sonnet`, `opus`, `fable`, `inherit`.

If the file doesn't exist, sensible defaults are used and every agent runs on the session model.

## Usage

```
/evolve explain how TCP congestion control works
/evolve last answer          # evolve your previous answer instead of a fresh question
```

The skill reports the final answer plus a short summary of how it evolved — which stance won round 0, how many issues each round found, and whether the conservative revision, bold revision, or incumbent champion won each time.

## Files

| File | Role |
|------|------|
| `SKILL.md` | Skill manifest — instructions Claude follows to collect the ask, load config, and invoke the workflow. |
| `evolve-workflow.js` | The evolution loop itself, run by the Workflow tool. |
| `critics.md` | Critic configuration — the reader profile the answer is judged for, and per-role model choices. Edit to taste. |

## Examples

Real `/evolve` runs showing how answers improve through critique, revision, and selection.

### What is a deterministic AI-agent workflow?

**Prompt:** `What is a deterministic AI-agent workflow?`

#### Without `/evolve`

<details>
<summary>Show the full original answer</summary>

A deterministic AI agent workflow is an AI-powered process where the steps,
branching, and outputs are predictable given the same inputs.

In plain terms:

- The workflow follows a fixed sequence or decision tree.
- The AI may perform specific tasks, but it cannot improvise the overall process.
- Running it again with the same input and model settings should produce the
  same or very similar behavior.

**Example**

A deterministic workflow might:

1. Receive a customer message.
2. Classify it into one of five categories.
3. Route billing questions to a billing template.
4. Run a refund-policy check for refund questions.
5. Return a response in a fixed format.

The AI can help with classification or drafting, but the workflow logic stays
controlled.

The key idea is:

- **Deterministic workflow:** controlled, repeatable, rule-based orchestration.
- **Agentic workflow:** more flexible, adaptive, and less predictable.

If you want, I can also show:

- A simple diagram of a deterministic agent workflow.
- How it differs from a normal LLM agent in code.

</details>

The answer is broad but long, and it implies that identical model settings
should produce the same or very similar output. That confuses deterministic
orchestration with nondeterministic model output.

#### With `/evolve`

> A deterministic AI-agent workflow is a workflow where your code controls the
> sequence and decisions, while AI agents perform only specific, bounded tasks.

For example:

1. Extract information with an agent.
2. Validate it with normal code.
3. Save it if valid.
4. Ask the agent to retry if invalid.

```python
result = extraction_agent.run(document)

if validate(result):
    save(result)
else:
    retry_agent.run(result)
```

The agent's exact wording may still vary because an LLM is usually
nondeterministic. Here, “deterministic” describes the **control flow**, not
every AI-generated output.

- **Deterministic workflow:** code decides what happens next.
- **Autonomous agent:** the AI decides what actions to take next.
- **Hybrid workflow:** code controls the major stages while an agent has
  limited freedom inside each stage.

The evolved answer is more precise, more concise, and makes the key distinction
explicit. See the [full before-and-after example](examples/Q-What-is-deterministic-ai-agent-workflow.md).
