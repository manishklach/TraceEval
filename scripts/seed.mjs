import { initSchema, openDb, resetDatabase } from '../src/db.mjs';

const db = openDb();
resetDatabase(db);
initSchema(db);

const sourceFeeds = [
  ['src-intercom', 'Intercom conversations', 'support', 'healthy', 'support-eng', 482, '2026-03-09T16:58:00Z', 4],
  ['src-langfuse', 'Langfuse traces', 'tracing', 'healthy', 'ml-platform', 1298, '2026-03-09T16:57:00Z', 5],
  ['src-zendesk', 'Zendesk escalations', 'ticketing', 'lagging', 'cx-ops', 73, '2026-03-09T16:22:00Z', 40]
];
const ingestBatches = [
  ['ingest-seed-01', 'src-intercom', 'Intercom conversations', 2, 0, 'completed', '2026-03-09T16:10:00Z', '2026-03-09T16:10:08Z'],
  ['ingest-seed-02', 'src-langfuse', 'Langfuse traces', 3, 1, 'completed', '2026-03-09T16:25:00Z', '2026-03-09T16:25:05Z'],
  ['ingest-seed-03', 'src-zendesk', 'Zendesk escalations', 1, 0, 'completed', '2026-03-09T16:45:00Z', '2026-03-09T16:45:03Z']
];
const traceEvents = [
  ['trace-01', 'src-intercom', 'evt-1001', 'conv-8841', 'user_thumb_down', 'critical', 'gpt-5-mini', 'refund_lookup -> policy_lookup -> hallucinates exception path', 'refund after duplicate charge', 'Agent promised an exception path that policy does not allow and created a support escalation.', '2026-03-09T15:21:00Z', '{"environment":"prod","workspace":"support-agent"}'],
  ['trace-02', 'src-langfuse', 'evt-2001', 'conv-8842', 'tool_error', 'high', 'gpt-5-mini', 'shipment_lookup timed out twice before fallback response', 'late shipment claim', 'Agent failed to acknowledge unavailable shipment API and kept retrying without a user-facing fallback.', '2026-03-09T15:48:00Z', '{"environment":"prod","workspace":"support-agent"}'],
  ['trace-03', 'src-intercom', 'evt-1002', 'conv-8843', 'human_handoff', 'high', 'gpt-5', 'policy_lookup -> order_lookup -> contradictory summary', 'subscription cancellation', 'Agent mixed annual and monthly cancellation windows, causing human takeover.', '2026-03-09T16:01:00Z', '{"environment":"prod","workspace":"support-agent"}'],
  ['trace-04', 'src-zendesk', 'evt-3001', 'conv-8844', 'sla_breach', 'medium', 'gpt-5-mini', 'kb_search returned stale article', 'change billing email', 'Agent cited an obsolete help-center article and did not recover when user challenged the answer.', '2026-03-09T14:54:00Z', '{"environment":"prod","workspace":"billing-agent"}'],
  ['trace-05', 'src-langfuse', 'evt-2002', 'conv-8845', 'user_thumb_down', 'critical', 'gpt-5', 'order_lookup -> refund_lookup -> unsupported country branch', 'VAT refund question', 'Agent invented a country-specific VAT refund route with no backing tool or policy citation.', '2026-03-09T16:11:00Z', '{"environment":"prod","workspace":"support-agent"}'],
  ['trace-06', 'src-intercom', 'evt-1003', 'conv-8846', 'human_handoff', 'medium', 'gpt-5-mini', 'kb_search -> profile_update -> authentication fallback missing', 'update phone number', 'Agent could not complete identity verification fallback and left the user in a loop.', '2026-03-09T16:33:00Z', '{"environment":"prod","workspace":"profile-agent"}']
];
const traceArtifacts = [
  ['artifact-trace-01-raw', 'trace-01', 'raw', '{"customerEmail":"refund@example.com"}', 'pending', '2026-03-09T16:10:00Z'],
  ['artifact-trace-01-redacted', 'trace-01', 'redacted', '{"customerEmail":"[redacted-email]"}', 'complete', '2026-03-09T16:10:00Z'],
  ['artifact-trace-02-raw', 'trace-02', 'raw', '{"ticket":"order-7721"}', 'pending', '2026-03-09T16:25:00Z'],
  ['artifact-trace-02-redacted', 'trace-02', 'redacted', '{"ticket":"order-[redacted-id]"}', 'complete', '2026-03-09T16:25:00Z'],
  ['artifact-trace-03-raw', 'trace-03', 'raw', '{"summary":"handoff"}', 'pending', '2026-03-09T16:10:00Z'],
  ['artifact-trace-03-redacted', 'trace-03', 'redacted', '{"summary":"handoff"}', 'complete', '2026-03-09T16:10:00Z'],
  ['artifact-trace-04-raw', 'trace-04', 'raw', '{"customerEmail":"billing@example.com"}', 'pending', '2026-03-09T16:45:00Z'],
  ['artifact-trace-04-redacted', 'trace-04', 'redacted', '{"customerEmail":"[redacted-email]"}', 'complete', '2026-03-09T16:45:00Z'],
  ['artifact-trace-05-raw', 'trace-05', 'raw', '{"ticket":"invoice-4419"}', 'pending', '2026-03-09T16:25:00Z'],
  ['artifact-trace-05-redacted', 'trace-05', 'redacted', '{"ticket":"invoice-[redacted-id]"}', 'complete', '2026-03-09T16:25:00Z'],
  ['artifact-trace-06-raw', 'trace-06', 'raw', '{"customerPhone":"555 212 7788"}', 'pending', '2026-03-09T16:10:00Z'],
  ['artifact-trace-06-redacted', 'trace-06', 'redacted', '{"customerPhone":"[redacted-number]"}', 'complete', '2026-03-09T16:10:00Z']
];
const failureClusters = [
  ['cluster-01', 'Policy hallucinations in refund flows', 'triage', 'critical', 2, 0.94, 'Prompt is not requiring policy citation before refund exceptions are stated.', 'ml-platform', '2026-03-09T15:21:00Z', '2026-03-09T16:11:00Z', 'High-priority finance workflow.', '2026-03-09T16:12:00Z'],
  ['cluster-02', 'Tool timeout handling for shipment support', 'reviewing', 'high', 2, 0.88, 'Agent loop retries the shipment tool instead of switching to fallback messaging after timeout budget is exhausted.', 'support-eng', '2026-03-09T15:48:00Z', '2026-03-09T16:33:00Z', 'Needs retry-budget policy.', '2026-03-09T16:34:00Z'],
  ['cluster-03', 'Outdated help-center retrieval', 'watch', 'medium', 2, 0.76, 'Retriever ranking favors older billing articles and lacks freshness weighting.', 'cx-ops', '2026-03-09T14:54:00Z', '2026-03-09T16:01:00Z', 'Watching for billing article freshness.', '2026-03-09T16:02:00Z']
];
const clusterLabels = [
  ['label-01', 'cluster-01', 'root_cause', 'policy_hallucination', 0.94, 'seed', '2026-03-09T16:12:00Z'],
  ['label-02', 'cluster-02', 'root_cause', 'tool_timeout', 0.88, 'seed', '2026-03-09T16:34:00Z'],
  ['label-03', 'cluster-03', 'root_cause', 'retrieval_staleness', 0.76, 'seed', '2026-03-09T16:02:00Z']
];
const clusterRecomputeRuns = [
  ['recompute-01', 'cluster-01', 'rules-v1', 'completed', 2, 'Seeded recompute for refund policy incidents.', '2026-03-09T16:12:00Z'],
  ['recompute-02', 'cluster-02', 'rules-v1', 'completed', 2, 'Seeded recompute for shipment tool timeout incidents.', '2026-03-09T16:34:00Z'],
  ['recompute-03', 'cluster-03', 'rules-v1', 'completed', 2, 'Seeded recompute for stale retrieval incidents.', '2026-03-09T16:02:00Z']
];
const clusterTraces = [['cluster-01', 'trace-01'], ['cluster-01', 'trace-05'], ['cluster-02', 'trace-02'], ['cluster-02', 'trace-06'], ['cluster-03', 'trace-03'], ['cluster-03', 'trace-04']];
const evalCases = [
  ['case-01', 'cluster-01', 'approved', 'Decline unsupported refund exceptions without policy citation', 'p0', 'contains-json', 1, 'The answer should refuse unsupported refund exceptions and cite the canonical refund policy path.', 'trace-cluster-synthesis', 'ml-platform', 'User intent: refund after duplicate charge', '2026-03-09T16:40:00Z', '2026-03-09T16:41:00Z'],
  ['case-02', 'cluster-01', 'approved', 'Handle VAT refund questions without inventing country routes', 'p0', 'not-contains', 1, 'The answer must not invent a VAT process for unsupported countries.', 'trace-cluster-synthesis', 'ml-platform', 'User intent: VAT refund question', '2026-03-09T16:40:00Z', '2026-03-09T16:42:00Z'],
  ['case-03', 'cluster-02', 'needs_edit', 'Fallback cleanly after shipment tool timeout', 'p1', 'contains', 0, 'After the second tool timeout, the answer should apologize, explain the limitation, and offer next steps.', 'trace-cluster-synthesis', 'support-eng', 'User intent: late shipment claim', null, '2026-03-09T16:45:00Z'],
  ['case-04', 'cluster-03', 'proposed', 'Prefer fresh billing article for email change policy', 'p2', 'llm-rubric', 0, 'The answer should reference the current billing contact workflow rather than stale documentation.', 'ticket-summary-mining', 'cx-ops', 'User intent: change billing email', null, '2026-03-09T16:46:00Z']
];
const caseReviews = [
  ['review-01', 'case-01', 'approved', 'manish', 'Good canonical policy case.', '2026-03-09T16:41:00Z'],
  ['review-02', 'case-02', 'approved', 'manish', 'Kept as negative hallucination check.', '2026-03-09T16:42:00Z'],
  ['review-03', 'case-03', 'needs_edit', 'support-lead', 'Add explicit fallback wording.', '2026-03-09T16:46:00Z']
];
const replayRuns = [
  ['replay-01', 'case-01', 'prompt:v17+retriever:v4', 'prompt:v18+retriever:v4', 'improved', 0, 1, '2026-03-09T16:44:00Z'],
  ['replay-02', 'case-02', 'prompt:v17+retriever:v4', 'prompt:v18+retriever:v4', 'regressed', 1, 0, '2026-03-09T16:44:00Z'],
  ['replay-03', 'case-03', 'prompt:v17+retriever:v4', 'prompt:v18+retriever:v5', 'improved', 0, 1, '2026-03-09T16:49:00Z'],
  ['replay-04', 'case-04', 'prompt:v17+retriever:v4', 'prompt:v18+retriever:v5', 'watch', 0, 0, '2026-03-09T16:52:00Z']
];
const exportBatches = [
  ['export-01', 'promptfoo', 'exports/promptfooconfig.refunds.yaml', 2, 'published', '2026-03-09T16:40:00Z'],
  ['export-02', 'promptfoo', 'exports/promptfooconfig.shipping.yaml', 1, 'published', '2026-03-09T16:45:00Z'],
  ['export-03', 'promptfoo', 'exports/promptfooconfig.billing.yaml', 1, 'draft', '2026-03-09T16:53:00Z']
];

const insertMany = (sql, rows) => {
  const statement = db.prepare(sql);
  db.exec('BEGIN');
  try { for (const row of rows) statement.run(...row); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
};

insertMany('INSERT INTO source_feeds (id, name, kind, status, owner, records_24h, last_ingest_at, freshness_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', sourceFeeds);
insertMany('INSERT INTO ingest_batches (id, source_feed_id, source_name, accepted_count, deduped_count, status, received_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ingestBatches);
insertMany('INSERT INTO trace_events (id, source_feed_id, external_event_id, conversation_id, failure_signal, severity, model_name, tool_trace, user_intent, transcript_excerpt, happened_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', traceEvents);
insertMany('INSERT INTO trace_artifacts (id, trace_event_id, artifact_type, payload, redaction_status, created_at) VALUES (?, ?, ?, ?, ?, ?)', traceArtifacts);
insertMany('INSERT INTO failure_clusters (id, title, status, severity, trace_count, confidence_score, root_cause_hypothesis, owner, first_seen_at, last_seen_at, triage_note, last_recomputed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', failureClusters);
insertMany('INSERT INTO cluster_labels (id, cluster_id, label_type, label_value, confidence_score, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', clusterLabels);
insertMany('INSERT INTO cluster_recompute_runs (id, cluster_id, strategy, status, trace_count, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', clusterRecomputeRuns);
insertMany('INSERT INTO cluster_traces (cluster_id, trace_event_id) VALUES (?, ?)', clusterTraces);
insertMany('INSERT INTO eval_cases (id, cluster_id, status, name, priority, assertion_type, promptfoo_ready, expected_behavior, generated_from, owner, input_text, last_exported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', evalCases);
insertMany('INSERT INTO case_reviews (id, eval_case_id, decision, reviewer, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', caseReviews);
insertMany('INSERT INTO replay_runs (id, eval_case_id, baseline_version, candidate_version, verdict, regressions_found, improvements_found, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', replayRuns);
insertMany('INSERT INTO export_batches (id, target_system, target_path, case_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', exportBatches);

console.log(`Seeded ${traceEvents.length} traces, ${caseReviews.length} case reviews, and ${evalCases.length} eval cases into data/monitor.db`);
db.close();
