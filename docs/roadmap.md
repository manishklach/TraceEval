# Roadmap

## Phase 1: Concept Validation

Goal: prove that production failure mining produces better eval coverage than hand-authored suites alone.

Build:

- adapters for one trace source and one support source
- normalized incident schema
- basic semantic plus rule-based clustering
- manual approval flow for generated evals
- promptfoo YAML export

Success criteria:

- at least 30 percent of generated cases catch issues not already covered by the existing suite
- median time from incident to exportable eval under one business day

## Phase 2: Regression Attribution

Goal: explain what changed when quality moves.

Build:

- replay engine with baseline vs candidate comparisons
- prompt, model, retriever, and tool version metadata
- trend views per release
- attribution heuristics at the case-result level

Success criteria:

- engineers can identify the most likely regression source in under 10 minutes for common incidents

## Phase 3: Team Workflow

Goal: make the system operational inside a real org.

Build:

- reviewers, approvals, and ownership
- PR generation for promptfoo config updates
- Slack or email alerts for new critical clusters
- audit log for exported eval lineage

Success criteria:

- support, ML, and platform teams can collaborate in one queue without spreadsheet handoffs

## Phase 4: Moat Expansion

Goal: deepen the product beyond a thin export wrapper.

Build:

- active learning to prioritize which clusters deserve eval generation first
- deduplication across channels and products
- automatic cluster naming and remediation suggestions
- cohort views by intent, segment, market, or tool path

Success criteria:

- the system becomes the default source of truth for eval backlog creation

## Immediate Focus

The build-ready plan for the next phase lives in [`docs/v0.2-plan.md`](./v0.2-plan.md) and [`docs/api-v0.2.md`](./api-v0.2.md).

If the team starts implementation now, the correct order is:

1. ingestion and normalization
2. clustering and triage
3. case generation and review
4. replay and attribution
5. promptfoo export workflow

## Risks

- clustering quality may be noisy early
- transcript privacy and retention rules can complicate ingestion
- teams may distrust auto-generated evals without good reviewer UX
- export alone is not enough; attribution and triage quality must be strong

## Go-To-Market Framing

The first buyer is likely a team already running promptfoo, custom evals, or Langfuse, but still learning about failures from support escalations and postmortems.

The pitch is not "replace your eval tooling."

The pitch is "stop losing production incidents because nobody turned them into tests."
