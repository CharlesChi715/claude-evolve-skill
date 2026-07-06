---
name: evolve
description: Produce a high-quality answer by evolutionary refinement — two diverse brain agents generate candidate solutions, a judge picks a champion, then each round critics find issues, two revisers (conservative and bold) breed variants, and the judge keeps whichever beats the champion, until critics all pass or improvement dries up. Use when the user wants the best possible answer via multiple runs, or invokes /evolve.
argument-hint: [question to answer, or "last answer" to evolve an existing one]
---

# Evolve — generate-and-select refinement loop

Champion-vs-challengers evolution: quality comes from breeding diverse variants
and letting a judge (acting as the reader) select, not from a single agent's
self-assessment. All loop logic lives in `evolve-workflow.js` next to this
file — run it via the Workflow tool's `scriptPath`; NEVER copy or inline it.

## Step 0 — load critic configuration

Read `~/.claude/skills/refine/critics.md` (shared with /refine) if it exists:

- **"Reader profile"** section (verbatim text) → `profile`.
- **"Models"** section → a `models` object. Roles used here:
  - `brain`: generators and revisers. Keep strong.
  - `pick`: the tournament judge that compares candidates.
  - `judge`: default for the three critics; `understand`/`useful`/`correct`
    override it per-critic.
  Valid values: `haiku`, `sonnet`, `opus`, `fable`, `inherit` (= no override).
  Pass EVERY configured line through as a key, including `inherit` values —
  for a per-critic key, `inherit` pins that critic to the session model,
  whereas omitting the key would let it fall back to the `judge` default.

If the file does not exist, use `profile` = "A curious practitioner who wants
intuitive explanations before jargon and a concrete way to apply the answer.",
`models` = `{}`, and tell the user they can create that file to customize.

## Step 1 — collect the ask (and optionally a draft)

- **Ask**: the question to answer. From the arguments; if the arguments say
  "last answer", the ask is the user message your last substantive answer
  responded to — pass it verbatim.
- **Draft** (optional): only when evolving an existing answer ("last answer"),
  pass it as `draft` — the workflow then skips the generate phase and starts
  refining it directly. For a fresh question, omit `draft` entirely so two
  diverse candidates are generated.

## Step 2 — run the Workflow

Invoke the Workflow tool with:

```
scriptPath: "/Users/charles/.claude/skills/evolve/evolve-workflow.js"
args: {
  ask: "<the question>",
  profile: "<Reader profile section text>",
  models: { brain: "...", pick: "...", judge: "...", ... },  // from critics.md
  maxRounds: 4,
  draft: "<existing answer>"   // ONLY when evolving an existing answer
}
```

## Step 3 — report the result

- If the result has an `error` field instead of `final`, the run failed before
  producing an answer — report the error and offer to retry; do not present an
  answer.
- Present `final` as the answer.
- Summarize the evolution in a few sentences using `history`: if the run
  started from a fresh question, which stance won round 0 and why (this entry
  is absent when a draft was passed in); then per round how many issues the
  critics found and whether the conservative revision, bold revision, or
  incumbent champion won (include the judge's reasons — they're one-liners).
- Ended because `converged` (critics all pass) → say so. Ended because
  `driedOut` → check the last history entries: the champion winning twice means
  refinement stopped improving, while "revisers failed" events mean the
  revision agents errored out — report whichever actually happened. Hit the
  round cap with neither → say so honestly.
