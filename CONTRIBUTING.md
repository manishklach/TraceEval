# Contributing to TraceEval

Thanks for contributing. This repo is an early product prototype, so the goal is fast iteration without losing clarity about the workflow we are building.

## What We Are Building

TraceEval is a trace-to-eval control plane:

- ingest production-like failures
- cluster them into root-cause groups
- generate reviewable eval cases
- replay them across versions
- attribute regressions
- export promptfoo-ready packs

Contributions that make that loop clearer, more reliable, or more realistic are the highest value.

## Local Setup

Requirements:

- Node.js 22 or newer

Install and run:

```powershell
npm run seed
npm start
```

Run verification:

```powershell
npm test
```

Open `http://localhost:3000` to inspect the dashboard.

## Contribution Guidelines

- Keep changes scoped to a clear product or technical outcome.
- Prefer deterministic behavior over cleverness. The seed and verification flow should stay repeatable.
- Preserve lineage between traces, clusters, eval cases, replays, and exports.
- Keep exported promptfoo artifacts stable when inputs have not changed.
- Update docs when the workflow, API surface, or product framing changes.

## Preferred Change Types

- new ingestion adapters or normalization improvements
- better clustering and triage logic
- review workflow improvements
- replay and attribution improvements
- export and GitHub integration improvements
- dashboard clarity and usability improvements
- stronger verification coverage

## Before Opening a PR

- Run `npm test`
- Update `README.md` if user-facing behavior changed
- Update `docs/` if APIs, milestones, or architecture changed
- Add or update sample seeded data if your change adds a new workflow path

## Pull Request Notes

In the PR description, include:

- what changed
- why it matters to the TraceEval workflow
- any schema or API changes
- how you verified the change

## Roadmap Alignment

If you are not sure what to work on next, check:

- [README.md](./README.md)
- [roadmap.md](./docs/roadmap.md)
- [v0.2-plan.md](./docs/v0.2-plan.md)

If you want to propose a larger direction change, open an issue first so we can align on scope before implementation.
