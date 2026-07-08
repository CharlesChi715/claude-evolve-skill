# Critic configuration for /evolve

Edit this file freely; the skill reads it at the start of every run.
It customizes WHO the answer is judged for and WHICH model each agent uses.

## Reader profile

Who the answer is for and how they like answers. The `understand` critic
becomes this reader and critiques in first person; the generators and
revisers write for them, and the tournament judge picks as them.
Add lines over time as you notice what does or doesn't work for you — this is
your critics' memory.

- Learning Claude Code skills and agent orchestration; comfortable programmer,
  new to multi-agent patterns.
- Wants the intuitive mental model FIRST, then the mechanism, then a short
  concrete example.
- Jargon must be explained at first use; prefers plain language over
  terse expert shorthand.
- Likes honest caveats ("this isn't truly X, it's Y") over marketing framing.
- Every answer should end with how to actually use or try the thing.

## Models

Roles, one per line. Valid values: haiku, sonnet, opus, fable, inherit
(`inherit` = same model as the main session).

- `brain` — the agents that generate and revise answers. Keep it strong.
- `judge` — default model for all three critics. Smaller saves tokens.
- `understand` / `useful` / `correct` — optional per-critic overrides that
  beat the `judge` default.
- `pick` — the tournament judge that compares whole candidate answers.
  Comparing solutions is harder than flagging issues; keep it strong.

brain: inherit
judge: haiku
correct: inherit
pick: inherit
