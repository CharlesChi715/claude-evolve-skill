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