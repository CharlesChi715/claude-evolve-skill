---
name: evolve
description: Produce a high-quality answer by evolutionary refinement — generate diverse candidates, qualify the ones with the most verified points, let a model impersonate the reader to assess understandability and usefulness and select a champion, then refine and repeat. Use when the user wants the best possible answer via multiple runs, or invokes /evolve.
argument-hint: [question to answer, or "last answer" to evolve an existing one]
---

# Evolve — generate-and-select refinement loop

Champion-vs-challengers evolution: a correctness verifier first qualifies the
answer(s) with the most verified points. A reader evaluator then impersonates
the configured reader, records understandability and usefulness notes, and
selects the champion. All loop logic lives in `evolve-workflow.js` next to this
file — run it via the Workflow tool's `scriptPath`; never copy or inline it.

## Step 0 — load evaluation configuration

Read `critics.md` (next to this file):

- **"Reader profile"** section (verbatim text) → `profile`.
- **"Models"** section → a `models` object. Roles used here:
  - `brain`: generators and revisers. Keep strong.
  - `correct`: verifies and compares factual and technical points.
  - `reader`: impersonates the reader, writes understandability/usefulness
    notes, and selects among correctness-qualified answers.
  Valid values: `haiku`, `sonnet`, `opus`, `fable`, `inherit` (= no override).
  Pass every configured line through, including `inherit` values.

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

Resolve `evolve-workflow.js` next to this `SKILL.md` to an absolute path, then
invoke the Workflow tool. Never hardcode a username or copy the script.

```
scriptPath: "<absolute path to this skill>/evolve-workflow.js"
args: {
  ask: "<the question>",
  profile: "<Reader profile section text>",
  models: { brain: "...", correct: "...", reader: "..." },  // from critics.md
  maxRounds: 4,
  draft: "<existing answer>"   // ONLY when evolving an existing answer
}
```

## Step 3 — report the result

- If the result has an `error` field instead of `final`, the run failed before
  producing an answer — report the error and offer to retry; do not present an
  answer.
- Present `final` as the answer.
- Summarize the evolution in a few sentences using `history`: which answer
  passed the correctness gate, why the reader selected the champion, the
  remaining issue count, and whether each round kept the champion or selected
  the conservative or bold revision.
- Ended because `converged` (correctness and reader evaluation pass) → say so. Ended because
  `driedOut` → check the history: two counted rounds produced no new champion.
  Distinguish incumbent wins from reviser failures. Hit the round cap with
  neither flag → say so honestly.
