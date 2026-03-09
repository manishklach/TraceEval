import { initSchema, openDb, resetDatabase } from '../src/db.mjs';

const db = openDb();
resetDatabase(db);
initSchema(db);

const sourceFeeds = [
  ['src-intercom', 'Intercom conversations', 'support', 'healthy', 'support-eng', 482, '2026-03-09T16:58:00Z', 4],
  ['src-langfuse', 'Langfuse traces', 'tracing', 'healthy', 'ml-platform', 1298, '2026-03-09T16:57:00Z', 5],
  ['src-zendesk', 'Zendesk escalations', 'ticketing', 'lagging', 'cx-ops', 73, '2026-03-09T16:22:00Z', 40]
];

const traceEvents = [
  ['trace-01', 'src-intercom', 'conv-8841', 'user_thumb_down', 'critical', 'gpt-5-mini', 'refund_lookup -> policy_lookup -> hallucinates exception path', 'refund after duplicate charge', 'Agent promised an exception path that policy does not allow and created a support escalation.', '2026-03-09T15:21:00Z'],
  ['trace-02', 'src-langfuse', 'conv-8842', 'tool_error', 'high', 'gpt-5-mini', 'shipment_lookup timed out twice before fallback response', 'late shipment claim', 'Agent failed to acknowledge unavailable shipment API and kept retrying without a user-facing fallback.', '2026-03-09T15:48:00Z'],
  ['trace-03', 'src-intercom', 'conv-8843', 'human_handoff', 'high', 'gpt-5', 'policy_lookup -> order_lookup -> contradictory summary', 'subscription cancellation', 'Agent mixed annual and monthly cancellation windows, causing human takeover.', '2026-03-09T16:01:00Z'],
  ['trace-04', 'src-zendesk', 'conv-8844', 'sla_breach', 'medium', 'gpt-5-mini', 'kb_search returned stale article', 'change billing email', 'Agent cited an obsolete help-center article and did not recover when user challenged the answer.', '2026-03-09T14:54:00Z'],
  ['trace-05', 'src-langfuse', 'conv-8845', 'user_thumb_down', 'critical', 'gpt-5', 'order_lookup -> refund_lookup -> unsupported country branch', 'VAT refund question', 'Agent invented a country-specific VAT refund route with no backing tool or policy citation.', '2026-03-09T16:11:00Z'],
  ['trace-06', 'src-intercom', 'conv-8846', 'human_handoff', 'medium', 'gpt-5-mini', 'kb_search -> profile_update -> authentication fallback missing', 'update phone number', 'Agent could not complete identity verification fallback and left the user in a loop.', '2026-03-09T16:33:00Z']
];

const failureClusters = [
  ['cluster-01', 'Policy hallucinations in refund flows', 'triage', 'critical', 2, 0.94, 'Prompt is not requiring policy citation before refund exceptions are stated.', 'ml-platform', '2026-03-09T15:21:00Z', '2026-03-09T16:11:00Z'],
  ['cluster-02', 'Tool timeout handling for shipment support', 'generating_eval', 'high', 2, 0.88, 'Agent loop retries the shipment tool instead of switching to fallback messaging after timeout budget is exhausted.', 'support-eng', '2026-03-09T15:48:00Z', '2026-03-09T16:33:00Z'],
  ['cluster-03', 'Outdated help-center retrieval', 'watch', 'medium', 2, 0.76, 'Retriever ranking favors older billing articles and lacks freshness weighting.', 'cx-ops', '2026-03-09T14:54:00Z', '2026-03-09T16:01:00Z']
];

const clusterTraces = [
  ['cluster-01', 'trace-01'],
  ['cluster-01', 'trace-05'],
  ['cluster-02', 'trace-02'],
  ['cluster-02', 'trace-06'],
  ['cluster-03', 'trace-03'],
  ['cluster-03', 'trace-04']
];

const evalCases = [
  ['case-01', 'cluster-01', 'Decline unsupported refund exceptions without policy citation', 'p0', 'contains-json', 1, 'The answer should refuse unsupported refund exceptions and cite the canonical refund policy path.', 'trace-cluster-synthesis', 'ml-platform', '2026-03-09T16:40:00Z'],
  ['case-02', 'cluster-01', 'Handle VAT refund questions without inventing country routes', 'p0', 'not-contains', 1, 'The answer must not invent a VAT process for unsupported countries.', 'trace-cluster-synthesis', 'ml-platform', '2026-03-09T16:40:00Z'],
  ['case-03', 'cluster-02', 'Fallback cleanly after shipment tool timeout', 'p1', 'contains', 1, 'After the second tool timeout, the answer should apologize, explain the limitation, and offer next steps.', 'trace-cluster-synthesis', 'support-eng', '2026-03-09T16:45:00Z'],
  ['case-04', 'cluster-03', 'Prefer fresh billing article for email change policy', 'p2', 'llm-rubric', 0, 'The answer should reference the current billing contact workflow rather than stale documentation.', 'ticket-summary-mining', 'cx-ops', null]
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
  try {
    for (const row of rows) {
      statement.run(...row);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

insertMany(
  'INSERT INTO source_feeds (id, name, kind, status, owner, records_24h, last_ingest_at, freshness_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  sourceFeeds
);

insertMany(
  `INSERT INTO trace_events
   (id, source_feed_id, conversation_id, failure_signal, severity, model_name, tool_trace, user_intent, transcript_excerpt, happened_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  traceEvents
);

insertMany(
  `INSERT INTO failure_clusters
   (id, title, status, severity, trace_count, confidence_score, root_cause_hypothesis, owner, first_seen_at, last_seen_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  failureClusters
);

insertMany(
  'INSERT INTO cluster_traces (cluster_id, trace_event_id) VALUES (?, ?)',
  clusterTraces
);

insertMany(
  `INSERT INTO eval_cases
   (id, cluster_id, name, priority, assertion_type, promptfoo_ready, expected_behavior, generated_from, owner, last_exported_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  evalCases
);

insertMany(
  `INSERT INTO replay_runs
   (id, eval_case_id, baseline_version, candidate_version, verdict, regressions_found, improvements_found, executed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  replayRuns
);

insertMany(
  `INSERT INTO export_batches
   (id, target_system, target_path, case_count, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
  exportBatches
);

console.log(`Seeded ${traceEvents.length} traces, ${failureClusters.length} clusters, and ${evalCases.length} eval cases into data/monitor.db`);
