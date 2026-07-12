# evolve

A [Claude Code](https://code.claude.com) skill that produces a high-quality answer by **evolutionary refinement** — instead of trusting one agent's self-assessment, it breeds diverse candidate answers and lets a two-judge panel (one role-playing the reader, one fact-checking against official docs) vote for a champion, then improves it round by round until critics stop finding issues.

## How it works

The loop logic lives in [`evolve-workflow.js`](evolve-workflow.js) and runs deterministically via Claude Code's Workflow tool. Each stage:

1. **Generate** — two "brain" agents write candidate answers from *different stances*, so the starting pool is diverse rather than two takes on the same idea. (Skipped when you evolve an existing draft.)
2. **Judge** — two tournament judges vote: a **reader** judge that impersonates the reader profile in first person and weighs understandability + usefulness together, and a **correct** judge that verifies claims against official documentation (web search) instead of trusting memory. Unanimity crowns the reigning **champion**; a split vote keeps the incumbent (at round 0, the reader judge breaks the tie).
3. **Critique** — three critics review the champion in parallel through distinct lenses: reader-fit (does the target reader stumble?), usefulness (does it answer the actual ask?), and correctness.
4. **Refine** — two revisers breed challengers from the champion: one **conservative** (fixes the flagged issues, changes nothing else) and one **bold** (more aggressive rework).
5. **Select** — the same two-judge panel votes again; the champion is only replaced if both judges prefer a challenger. Otherwise it stands.

The loop ends when **all critics pass** (`converged`), when improvement **dries up** (`driedOut` — the champion wins twice running), or at the round cap (default 4).

The design principle: quality comes from *diversity + selection*, not from a single agent grading its own work.

## Install

Copy the skill into your Claude Code skills directory:

```bash
git clone git@github.com:CharlesChi715/claude-evolve-skill.git
mkdir -p ~/.claude/skills/evolve
cp claude-evolve-skill/SKILL.md claude-evolve-skill/evolve-workflow.js claude-evolve-skill/critics.md ~/.claude/skills/evolve/
```

> **⚠️ One path to fix.** `SKILL.md` tells the Workflow tool where to find the script via an absolute `scriptPath`. Edit line ~48 of your installed `~/.claude/skills/evolve/SKILL.md` so the path points at *your* home directory:
>
> ```
> scriptPath: "/Users/<you>/.claude/skills/evolve/evolve-workflow.js"
> ```

Then start a new Claude Code session and run `/evolve <your question>`.

## Configure (optional)

`evolve` reads its own config file at `~/.claude/skills/evolve/critics.md` (shipped with the skill). If present, it customizes two things:

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

## Learn how it works

This repo doubles as a course on the Workflow tool and agent orchestration:

- [`TEACHING.md`](TEACHING.md) — the whole system in six layered levels of depth, from a one-breath mental model down to runtime guarantees and design critique.
- [`evolve-workflow.annotated.js`](evolve-workflow.annotated.js) — the real script with teaching comments on every section (code byte-identical to `evolve-workflow.js`).
- [`examples/`](examples/) — the `agent()` course: eight runnable workflows from one agent call to a plan→research→verify→synthesize swarm.
