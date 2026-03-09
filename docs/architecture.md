# Architecture

## Product Summary

This system is a `trace-to-eval` control plane.

It sits upstream from `promptfoo` and turns raw production evidence into reusable evaluation assets.

### Input side

The input side ingests:

- support conversations
- tracing systems
- thumbs-down feedback
- human handoffs
- tool errors
- support tickets and escalations

### Output side

The output side produces:

- root-cause clusters
- canonical eval cases
- replay comparisons across versions
- promptfoo-ready YAML packs

## Core Entities

### `source_feeds`

Represents connected systems such as Langfuse, Intercom, or Zendesk.

### `trace_events`

A normalized failure record from live traffic. Each record carries the failure signal, user intent, model, and excerpted transcript or tool path.

### `failure_clusters`

A cluster groups related incidents into a single likely root cause. This is the unit of triage and prioritization.

### `eval_cases`

A generated canonical case attached to a failure cluster. This is the artifact that can later be exported to promptfoo.

### `replay_runs`

Stores side-by-side replays across a baseline and a candidate configuration. This is where regression bisection starts.

### `export_batches`

Tracks packaging and publishing of generated evals to promptfoo or another downstream eval engine.

## System Flow

1. Adapters ingest records from trace and support systems.
2. Normalization converts them into `trace_events`.
3. Clustering groups incidents by semantic similarity plus rule-based signals.
4. A canonicalization step proposes `eval_cases`.
5. Replay compares the new cases across baseline and candidate builds.
6. Approved cases are exported as promptfoo YAML or JSON.

## Differentiation From Promptfoo

Promptfoo is the execution layer.

This product is the discovery and feedback layer.

That distinction matters:

- promptfoo helps teams run evals they already know to write
- this product helps teams discover the evals they should have written

## Data and Model Strategy

### Clustering

A pragmatic first version should combine:

- embedding similarity on transcript excerpts
- exact-match bucketing for tool errors
- policy violation heuristics
- time-window aggregation for incident spikes

### Canonicalization

Each cluster should produce a compact eval case with:

- stable description
- input prompt or transcript slice
- expected behavior
- assertion type
- trace lineage metadata

### Replay and Bisection

The replay layer should answer:

- did the candidate fix the original failure
- did it introduce a new failure mode
- is the delta likely caused by prompt, retrieval, tool, or model changes

## Recommended Real Implementation

### Backend

- TypeScript service
- Postgres for production storage
- worker queue for ingestion and clustering
- object storage for raw transcripts and attachments

### Integrations

- Langfuse or OpenTelemetry traces
- help-desk APIs
- warehouse source for tickets and CSAT
- git hosting for export PRs
- promptfoo CLI for local pack validation

### UX

The dashboard should support:

- source health
- cluster triage queue
- eval proposal review
- replay diff review
- export history and promotion state

## API Direction

A credible next API surface would include:

- `POST /ingest/traces`
- `POST /clusters/:id/generate-cases`
- `POST /replays`
- `POST /exports/promptfoo`
- `GET /clusters`
- `GET /cases`

## Why This Could Win

The operational pain for LLM teams is not just low test quality. It is blind spots.

Blind spots come from failing to turn production incidents into durable tests. That is the gap this product targets.
