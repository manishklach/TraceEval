# TraceEval v0.2 API and Schema Spec

## API Principles

- every generated artifact must preserve lineage back to source traces
- write APIs should be idempotent where possible
- replay and export operations should be asynchronous jobs
- reviewer actions should be auditable
- promptfoo exports should be reproducible from stored case sets

## Entity States

### Cluster status

Allowed values:

- `new`
- `triage`
- `generating_cases`
- `reviewing`
- `ready_to_export`
- `resolved`
- `ignored`

### Case status

Allowed values:

- `proposed`
- `approved`
- `rejected`
- `duplicate`
- `needs_edit`
- `exported`
- `retired`

### Replay status

Allowed values:

- `queued`
- `running`
- `completed`
- `failed`

### Export status

Allowed values:

- `draft`
- `validated`
- `published`
- `failed`

## Core Request Shapes

### `POST /api/ingest/source-events`

Purpose: ingest normalized or semi-normalized source events from trace systems.

Request body:

```json
{
  "source": "langfuse",
  "events": [
    {
      "externalId": "evt_123",
      "conversationId": "conv_8841",
      "userIntent": "refund after duplicate charge",
      "failureSignal": "user_thumb_down",
      "severity": "critical",
      "modelName": "gpt-5-mini",
      "toolTrace": "refund_lookup -> policy_lookup",
      "transcriptExcerpt": "Agent promised an unsupported exception flow.",
      "happenedAt": "2026-03-09T15:21:00Z",
      "metadata": {
        "environment": "prod",
        "workspace": "support-agent"
      }
    }
  ]
}
```

Response body:

```json
{
  "accepted": 1,
  "deduped": 0,
  "ingestBatchId": "ingest_001"
}
```

### `GET /api/clusters`

Purpose: list clusters with triage metadata.

Query params:

- `status`
- `severity`
- `owner`
- `limit`
- `cursor`

Response body:

```json
{
  "items": [
    {
      "id": "cluster_01",
      "title": "Policy hallucinations in refund flows",
      "status": "triage",
      "severity": "critical",
      "traceCount": 12,
      "confidenceScore": 0.94,
      "rootCauseLabel": "policy_hallucination",
      "owner": "ml-platform"
    }
  ],
  "nextCursor": null
}
```

### `POST /api/clusters/:id/generate-cases`

Purpose: create one or more eval proposals from a cluster.

Request body:

```json
{
  "maxCases": 3,
  "generator": "default",
  "reviewerRequired": true
}
```

Response body:

```json
{
  "clusterId": "cluster_01",
  "generatedCaseIds": ["case_101", "case_102"]
}
```

### `POST /api/cases/:id/review`

Purpose: record a human review decision for a case.

Request body:

```json
{
  "decision": "approved",
  "reviewer": "manish",
  "notes": "Good minimal reproduction. Assertion type changed to contains-json."
}
```

Response body:

```json
{
  "caseId": "case_101",
  "status": "approved",
  "reviewId": "review_221"
}
```

### `POST /api/replays`

Purpose: compare baseline and candidate versions across selected cases.

Request body:

```json
{
  "baselineVersionId": "rel_017",
  "candidateVersionId": "rel_018",
  "caseIds": ["case_101", "case_102"],
  "mode": "async"
}
```

Response body:

```json
{
  "replayId": "replay_45",
  "status": "queued"
}
```

### `POST /api/exports/promptfoo`

Purpose: build a promptfoo pack from approved cases.

Request body:

```json
{
  "caseIds": ["case_101", "case_102"],
  "targetPath": "exports/promptfooconfig.refunds.yaml",
  "includeMetadata": true
}
```

Response body:

```json
{
  "exportId": "export_19",
  "status": "draft",
  "previewUrl": "/api/exports/export_19/content"
}
```

## Schema Direction

### `source_feeds`

```sql
create table source_feeds (
  id text primary key,
  name text not null,
  kind text not null,
  status text not null,
  owner text not null,
  records_24h integer not null,
  last_ingest_at timestamptz not null,
  freshness_minutes integer not null
);
```

### `trace_events`

```sql
create table trace_events (
  id text primary key,
  source_feed_id text not null references source_feeds(id),
  external_event_id text,
  conversation_id text not null,
  failure_signal text not null,
  severity text not null,
  model_name text not null,
  tool_trace text,
  user_intent text not null,
  transcript_excerpt text not null,
  happened_at timestamptz not null,
  metadata_json jsonb not null default '{}'
);
```

### `failure_clusters`

```sql
create table failure_clusters (
  id text primary key,
  title text not null,
  status text not null,
  severity text not null,
  confidence_score numeric not null,
  root_cause_label text,
  root_cause_hypothesis text not null,
  owner text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null
);
```

### `cluster_memberships`

```sql
create table cluster_memberships (
  cluster_id text not null references failure_clusters(id),
  trace_event_id text not null references trace_events(id),
  membership_score numeric not null,
  primary key (cluster_id, trace_event_id)
);
```

### `eval_cases`

```sql
create table eval_cases (
  id text primary key,
  cluster_id text not null references failure_clusters(id),
  status text not null,
  name text not null,
  priority text not null,
  assertion_type text not null,
  expected_behavior text not null,
  generated_from text not null,
  owner text,
  last_exported_at timestamptz,
  content_json jsonb not null,
  lineage_json jsonb not null
);
```

### `case_reviews`

```sql
create table case_reviews (
  id text primary key,
  eval_case_id text not null references eval_cases(id),
  decision text not null,
  reviewer text not null,
  notes text,
  created_at timestamptz not null
);
```

### `release_versions`

```sql
create table release_versions (
  id text primary key,
  environment text not null,
  prompt_version text,
  model_name text,
  retriever_version text,
  tool_manifest_version text,
  policy_pack_version text,
  created_at timestamptz not null
);
```

### `replay_runs`

```sql
create table replay_runs (
  id text primary key,
  baseline_version_id text not null references release_versions(id),
  candidate_version_id text not null references release_versions(id),
  status text not null,
  created_by text,
  created_at timestamptz not null
);
```

### `replay_case_results`

```sql
create table replay_case_results (
  id text primary key,
  replay_run_id text not null references replay_runs(id),
  eval_case_id text not null references eval_cases(id),
  baseline_score numeric,
  candidate_score numeric,
  delta numeric,
  verdict text not null,
  attribution_label text,
  details_json jsonb not null default '{}'
);
```

### `export_batches`

```sql
create table export_batches (
  id text primary key,
  target_system text not null,
  target_path text not null,
  case_count integer not null,
  status text not null,
  content_hash text,
  created_by text,
  created_at timestamptz not null
);
```

## UI State Model

### Cluster queue columns

- new
- triage
- generating cases
- reviewing
- ready to export
- resolved

### Case review actions

- approve
- reject
- edit
- mark duplicate
- request regeneration

### Replay comparison filters

- by release
- by product area
- by failure label
- by owner
- by severity

## Critical Acceptance Criteria

For `v0.2`, the implementation is acceptable only if:

- approved cases always preserve trace lineage
- replay results can be tied back to explicit baseline and candidate versions
- promptfoo exports are deterministic
- case review history is auditable
- ingestion is idempotent for duplicate external event IDs
