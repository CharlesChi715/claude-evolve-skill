// ─────────────────────────────────────────────────────────────────────────────
//  Example 01 · hello agent — the atom
//
//  Teaches: what ONE agent() call actually is, and the three rules that
//           govern every agent you will ever spawn.
//  Agents spawned: 1
//  Run: tell Claude — "Run the workflow at examples/01-hello-agent.js"
//       (optionally: ... with args {q: "your question"})
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHAT agent() is: `agent(prompt, opts)` spawns a SUBAGENT — a fresh,
//  one-shot AI invocation with its own empty context window. It reads your
//  prompt, optionally uses its tools, produces one final message, and
//  disappears. `await` gives you that final message as a string.
//
//  The three rules:
//
//  1. THE PROMPT IS ITS ENTIRE WORLD. The subagent cannot see this script,
//     its variables, the conversation you're having with Claude, or any
//     other agent. Anything it must know — data, context, constraints —
//     must be interpolated INTO the prompt string.
//
//  2. THE FINAL MESSAGE IS THE RETURN VALUE. Subagents are told this
//     explicitly by the runtime: their last message is data returned to a
//     program, not prose shown to a human. You still reinforce it in the
//     prompt (see below), because one chatty "Sure! Here's your answer:"
//     preamble becomes part of your data forever.
//
//  3. FAILURE IS null, NOT AN EXCEPTION. If the agent dies (terminal API
//     error after retries) or the user skips it mid-run, agent() resolves
//     to null. Orchestration code treats nulls as weather — always have a
//     plan for them.

export const meta = {
  name: 'ex01-hello-agent',
  description: 'One agent() call — the atom every other example is built from',
  phases: [{ title: 'Ask' }],
}

//  GOTCHA: `args` (a global the runtime injects) is whatever the caller
//  passed — but it may arrive as a JSON-encoded STRING instead of an object,
//  or as a bare question typed by a human. Normalize defensively; every
//  example in this course that takes input opens with these three lines
//  (05 takes no input, so it alone skips them).
let IN = args ?? {}
if (typeof IN === 'string') { try { IN = JSON.parse(IN) } catch { IN = { q: IN } } }

const q = IN.q ?? 'Explain what a "thunk" is, in one short paragraph, to a comfortable programmer.'

//  log() is YOUR narration channel — it shows as a progress line in
//  /workflows. The agent never sees it (rule 1).
log(`Asking one agent: ${q}`)

const answer = await agent(
  //  Rule 1 in action: the question is interpolated in. Rule 2 in action:
  //  the closing instruction. Without it you'd usually be fine (the runtime
  //  already primes subagents to return raw data) — with it you're safe.
  `${q}\n\nYour final message must be the answer itself and nothing else — ` +
  `it is returned to a program, not shown to a human.`,
  {
    label: 'hello',   // what this agent is called in the /workflows tree
    phase: 'Ask',     // which meta.phases group box it appears under
  }
)

//  Rule 3 in action: `answer` might be null. The `??` fallback means this
//  workflow returns something sensible either way.
//
//  WHAT the return value is: a workflow's `return` is its ONLY output
//  channel. This object goes back to the Claude session that launched the
//  workflow, which then presents it to you.
return {
  question: q,
  answer: answer ?? '(the agent failed — agent() returned null)',
}

//  TRY: run it, then open the run's journal.jsonl (the Workflow tool result
//  told you the transcript directory) and find the agent's raw return —
//  it is exactly the `answer` string above. Then re-run with
//  args {q: "..."} to see the prompt change.
