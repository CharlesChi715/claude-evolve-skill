# Critic configuration for /evolve

Edit this file freely; the skill reads it at the start of every run.
It customizes WHO the answer is judged for and WHICH model each agent uses.

## Reader profile

Who the answer is for and how they like answers. The `understand` critic
and the `reader` tournament judge both become this reader and work in
first person; the generators and revisers write for them.
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

- `brain` — generators and revisers.
- `judge` — default cheap model for the three critics and impersonating reader.
- `understand` / `useful` / `correct` — per-critic overrides.
- `pick` — default cheap model for the two tournament judges.
- `pick-reader` / `pick-correct` — per-judge overrides.

brain: inherit
judge: haiku
correct: inherit
pick: haiku
