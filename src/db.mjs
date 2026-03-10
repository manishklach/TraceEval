import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const dataDir = path.join(projectRoot, 'data');
const dbPath = path.join(dataDir, 'monitor.db');

function ensureDataDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function slugify(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function nowIso() {
  return new Date().toISOString();
}

function escapeYaml(value) {
  return String(value).replace(/"/g, '\\"');
}

function redactText(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b\d{3}[-.\s]?\d{2,4}[-.\s]?\d{4}\b/g, '[redacted-number]')
    .replace(/\b(order|invoice|ticket)[-_ ]?\d+\b/gi, '$1-[redacted-id]');
}

function normalizeFailureSignal(value) {
  const signal = slugify(value).replace(/-/g, '_');
  return signal || 'unknown_signal';
}

function normalizeSeverity(value) {
  const severity = String(value || 'medium').toLowerCase();
  return ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'medium';
}

function inferSourceKind(source) {
  const name = String(source || '').toLowerCase();
  if (name.includes('langfuse') || name.includes('trace') || name.includes('helicone')) return 'tracing';
  if (name.includes('intercom') || name.includes('support')) return 'support';
  if (name.includes('zendesk') || name.includes('ticket')) return 'ticketing';
  if (name.includes('feedback')) return 'feedback';
  return 'ingest';
}

function inferRootCauseLabel(trace) {
  const haystack = `${trace.failure_signal} ${trace.tool_trace || ''} ${trace.transcript_excerpt || ''} ${trace.user_intent || ''}`.toLowerCase();
  if (haystack.includes('policy') || haystack.includes('refund')) return 'policy_hallucination';
  if (haystack.includes('timeout') || haystack.includes('fallback')) return 'tool_timeout';
  if (haystack.includes('stale') || haystack.includes('article') || haystack.includes('retriev')) return 'retrieval_staleness';
  if (haystack.includes('auth') || haystack.includes('verification')) return 'identity_flow_gap';
  return 'unknown_failure_mode';
}

function inferClusterOwner(label) {
  if (label === 'policy_hallucination') return 'ml-platform';
  if (label === 'tool_timeout') return 'support-eng';
  if (label === 'retrieval_staleness') return 'cx-ops';
  return 'triage-bot';
}

function inferClusterTitle(label, trace) {
  const intent = trace.user_intent || 'unknown workflow';
  if (label === 'policy_hallucination') return `Policy hallucinations in ${intent}`;
  if (label === 'tool_timeout') return `Tool timeout handling for ${intent}`;
  if (label === 'retrieval_staleness') return `Retrieval freshness issues for ${intent}`;
  if (label === 'identity_flow_gap') return `Identity fallback gaps for ${intent}`;
  return `Unclassified failures in ${intent}`;
}

function inferCasePriority(clusterSeverity) {
  if (clusterSeverity === 'critical') return 'p0';
  if (clusterSeverity === 'high') return 'p1';
  return 'p2';
}

function inferAssertionType(rootCauseLabel) {
  if (rootCauseLabel === 'policy_hallucination') return 'contains-json';
  if (rootCauseLabel === 'tool_timeout') return 'contains';
  if (rootCauseLabel === 'retrieval_staleness') return 'llm-rubric';
  return 'contains';
}

function inferCaseExpectedBehavior(cluster, trace) {
  const label = (trace.root_cause_label || 'unknown_failure_mode').replace(/_/g, ' ');
  return `The assistant should avoid ${label} and handle ${trace.user_intent || 'the user request'} correctly using approved workflow guidance.`;
}

function inferReplayAttribution(baselineVersion, candidateVersion, caseItem) {
  if (baselineVersion.prompt_version !== candidateVersion.prompt_version) return 'prompt_change';
  if (baselineVersion.retriever_version !== candidateVersion.retriever_version) return 'retriever_change';
  if (baselineVersion.model_name !== candidateVersion.model_name) return 'model_change';
  if (baselineVersion.tool_manifest_version !== candidateVersion.tool_manifest_version) return 'tooling_change';
  if (caseItem.assertion_type === 'llm-rubric') return 'evaluation_rubric_shift';
  return 'unknown_change';
}

function normalizeEvent(sourceFeedId, event, index) {
  const happenedAt = event.happenedAt || nowIso();
  const conversationId = String(event.conversationId || `conversation-${index + 1}`);
  const failureSignal = normalizeFailureSignal(event.failureSignal);
  const severity = normalizeSeverity(event.severity);
  const transcriptExcerpt = redactText(event.transcriptExcerpt || event.summary || 'No transcript excerpt provided.');
  const toolTrace = redactText(event.toolTrace || event.toolPath || '');
  const userIntent = redactText(event.userIntent || 'unknown intent');
  const modelName = String(event.modelName || 'unknown-model');
  const externalEventId = event.externalId ? String(event.externalId) : null;
  const metadata = {
    environment: event.metadata?.environment || 'unknown',
    workspace: event.metadata?.workspace || 'unknown',
    tags: event.metadata?.tags || []
  };

  return {
    id: `trace-${slugify(sourceFeedId)}-${Date.now()}-${index}`,
    source_feed_id: sourceFeedId,
    external_event_id: externalEventId,
    conversation_id: conversationId,
    failure_signal: failureSignal,
    severity,
    model_name: modelName,
    tool_trace: toolTrace,
    user_intent: userIntent,
    transcript_excerpt: transcriptExcerpt,
    happened_at: happenedAt,
    metadata_json: JSON.stringify(metadata),
    raw_payload: JSON.stringify(event),
    redacted_payload: JSON.stringify({ ...event, transcriptExcerpt, toolTrace, userIntent })
  };
}

export function openDb() {
  ensureDataDir();
  return new DatabaseSync(dbPath);
}

export function initSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS source_feeds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      owner TEXT NOT NULL,
      records_24h INTEGER NOT NULL,
      last_ingest_at TEXT NOT NULL,
      freshness_minutes INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingest_batches (
      id TEXT PRIMARY KEY,
      source_feed_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      accepted_count INTEGER NOT NULL,
      deduped_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      FOREIGN KEY (source_feed_id) REFERENCES source_feeds(id)
    );

    CREATE TABLE IF NOT EXISTS trace_events (
      id TEXT PRIMARY KEY,
      source_feed_id TEXT NOT NULL,
      external_event_id TEXT,
      conversation_id TEXT NOT NULL,
      failure_signal TEXT NOT NULL,
      severity TEXT NOT NULL,
      model_name TEXT NOT NULL,
      tool_trace TEXT,
      user_intent TEXT NOT NULL,
      transcript_excerpt TEXT NOT NULL,
      happened_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (source_feed_id) REFERENCES source_feeds(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_events_source_external
      ON trace_events(source_feed_id, external_event_id)
      WHERE external_event_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS trace_artifacts (
      id TEXT PRIMARY KEY,
      trace_event_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      redaction_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (trace_event_id) REFERENCES trace_events(id)
    );

    CREATE TABLE IF NOT EXISTS failure_clusters (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      trace_count INTEGER NOT NULL,
      confidence_score REAL NOT NULL,
      root_cause_hypothesis TEXT NOT NULL,
      owner TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      triage_note TEXT,
      last_recomputed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cluster_labels (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      label_type TEXT NOT NULL,
      label_value TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      assigned_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cluster_id) REFERENCES failure_clusters(id)
    );

    CREATE TABLE IF NOT EXISTS cluster_recompute_runs (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL,
      trace_count INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (cluster_id) REFERENCES failure_clusters(id)
    );

    CREATE TABLE IF NOT EXISTS cluster_traces (
      cluster_id TEXT NOT NULL,
      trace_event_id TEXT NOT NULL,
      PRIMARY KEY (cluster_id, trace_event_id),
      FOREIGN KEY (cluster_id) REFERENCES failure_clusters(id),
      FOREIGN KEY (trace_event_id) REFERENCES trace_events(id)
    );

    CREATE TABLE IF NOT EXISTS eval_cases (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      status TEXT NOT NULL,
      name TEXT NOT NULL,
      priority TEXT NOT NULL,
      assertion_type TEXT NOT NULL,
      promptfoo_ready INTEGER NOT NULL,
      expected_behavior TEXT NOT NULL,
      generated_from TEXT NOT NULL,
      owner TEXT NOT NULL,
      input_text TEXT NOT NULL DEFAULT '',
      last_exported_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (cluster_id) REFERENCES failure_clusters(id)
    );

    CREATE TABLE IF NOT EXISTS case_reviews (
      id TEXT PRIMARY KEY,
      eval_case_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (eval_case_id) REFERENCES eval_cases(id)
    );

    CREATE TABLE IF NOT EXISTS release_versions (
      id TEXT PRIMARY KEY,
      environment TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model_name TEXT NOT NULL,
      retriever_version TEXT NOT NULL,
      tool_manifest_version TEXT NOT NULL,
      policy_pack_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS replay_runs (
      id TEXT PRIMARY KEY,
      baseline_version_id TEXT NOT NULL,
      candidate_version_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (baseline_version_id) REFERENCES release_versions(id),
      FOREIGN KEY (candidate_version_id) REFERENCES release_versions(id)
    );

    CREATE TABLE IF NOT EXISTS replay_case_results (
      id TEXT PRIMARY KEY,
      replay_run_id TEXT NOT NULL,
      eval_case_id TEXT NOT NULL,
      baseline_score REAL NOT NULL,
      candidate_score REAL NOT NULL,
      delta REAL NOT NULL,
      verdict TEXT NOT NULL,
      attribution_label TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (replay_run_id) REFERENCES replay_runs(id),
      FOREIGN KEY (eval_case_id) REFERENCES eval_cases(id)
    );

    CREATE TABLE IF NOT EXISTS export_batches (
      id TEXT PRIMARY KEY,
      target_system TEXT NOT NULL,
      target_path TEXT NOT NULL,
      case_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      case_ids_json TEXT NOT NULL DEFAULT '[]',
      pr_title TEXT,
      pr_body TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function resetDatabase(db) {
  db.exec(`
    DROP TABLE IF EXISTS export_batches;
    DROP TABLE IF EXISTS replay_case_results;
    DROP TABLE IF EXISTS replay_runs;
    DROP TABLE IF EXISTS release_versions;
    DROP TABLE IF EXISTS case_reviews;
    DROP TABLE IF EXISTS eval_cases;
    DROP TABLE IF EXISTS cluster_traces;
    DROP TABLE IF EXISTS cluster_recompute_runs;
    DROP TABLE IF EXISTS cluster_labels;
    DROP TABLE IF EXISTS failure_clusters;
    DROP TABLE IF EXISTS trace_artifacts;
    DROP TABLE IF EXISTS trace_events;
    DROP TABLE IF EXISTS ingest_batches;
    DROP TABLE IF EXISTS source_feeds;
  `);
}
export function ensureSourceFeed(db, sourceName, owner = 'ingest-api') {
  const sourceId = `src-${slugify(sourceName)}`;
  const existing = db.prepare(`SELECT * FROM source_feeds WHERE id = ?`).get(sourceId);
  const timestamp = nowIso();
  if (!existing) {
    db.prepare(`INSERT INTO source_feeds (id, name, kind, status, owner, records_24h, last_ingest_at, freshness_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sourceId, sourceName, inferSourceKind(sourceName), 'healthy', owner, 0, timestamp, 0
    );
  }
  return sourceId;
}

export function ingestSourceEvents(db, payload) {
  const sourceName = String(payload?.source || 'external-ingest');
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const receivedAt = nowIso();
  const sourceFeedId = ensureSourceFeed(db, sourceName, payload?.owner || 'ingest-api');
  const batchId = `ingest-${slugify(sourceName)}-${Date.now()}`;
  let accepted = 0;
  let deduped = 0;
  const traceEventIds = [];

  db.exec('BEGIN');
  try {
    const insertTrace = db.prepare(`INSERT INTO trace_events (id, source_feed_id, external_event_id, conversation_id, failure_signal, severity, model_name, tool_trace, user_intent, transcript_excerpt, happened_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertArtifact = db.prepare(`INSERT INTO trace_artifacts (id, trace_event_id, artifact_type, payload, redaction_status, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    const findExisting = db.prepare(`SELECT id FROM trace_events WHERE source_feed_id = ? AND external_event_id = ?`);

    events.forEach((event, index) => {
      const normalized = normalizeEvent(sourceFeedId, event, index);
      if (normalized.external_event_id) {
        const existing = findExisting.get(sourceFeedId, normalized.external_event_id);
        if (existing) {
          deduped += 1;
          return;
        }
      }
      insertTrace.run(normalized.id, normalized.source_feed_id, normalized.external_event_id, normalized.conversation_id, normalized.failure_signal, normalized.severity, normalized.model_name, normalized.tool_trace, normalized.user_intent, normalized.transcript_excerpt, normalized.happened_at, normalized.metadata_json);
      insertArtifact.run(`artifact-${normalized.id}-raw`, normalized.id, 'raw', normalized.raw_payload, 'pending', receivedAt);
      insertArtifact.run(`artifact-${normalized.id}-redacted`, normalized.id, 'redacted', normalized.redacted_payload, 'complete', receivedAt);
      traceEventIds.push(normalized.id);
      accepted += 1;
    });

    db.prepare(`INSERT INTO ingest_batches (id, source_feed_id, source_name, accepted_count, deduped_count, status, received_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(batchId, sourceFeedId, sourceName, accepted, deduped, 'completed', receivedAt, nowIso());
    const records24h = db.prepare(`SELECT COUNT(*) AS count FROM trace_events WHERE source_feed_id = ? AND happened_at >= datetime('now', '-1 day')`).get(sourceFeedId).count;
    db.prepare(`UPDATE source_feeds SET status = ?, records_24h = ?, last_ingest_at = ?, freshness_minutes = ? WHERE id = ?`).run('healthy', records24h, receivedAt, 0, sourceFeedId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { accepted, deduped, ingestBatchId: batchId, sourceFeedId, traceEventIds };
}

export function assignClusterOwner(db, clusterId, owner, triageNote = '') {
  const existing = db.prepare(`SELECT id FROM failure_clusters WHERE id = ?`).get(clusterId);
  if (!existing) throw new Error(`Cluster not found: ${clusterId}`);
  db.prepare(`UPDATE failure_clusters SET owner = ?, triage_note = ?, status = ?, last_seen_at = ? WHERE id = ?`).run(owner, triageNote, 'triage', nowIso(), clusterId);
  return db.prepare(`SELECT * FROM failure_clusters WHERE id = ?`).get(clusterId);
}

export function recomputeCluster(db, clusterId, strategy = 'rules-v1', requestedBy = 'triage-bot') {
  const cluster = db.prepare(`SELECT * FROM failure_clusters WHERE id = ?`).get(clusterId);
  if (!cluster) throw new Error(`Cluster not found: ${clusterId}`);
  const traces = db.prepare(`SELECT t.* FROM trace_events t JOIN cluster_traces ct ON ct.trace_event_id = t.id WHERE ct.cluster_id = ? ORDER BY t.happened_at DESC`).all(clusterId);

  const labelCounts = new Map();
  for (const trace of traces) {
    const label = inferRootCauseLabel(trace);
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }

  let dominantLabel = 'unknown_failure_mode';
  let dominantCount = 0;
  for (const [label, count] of labelCounts.entries()) {
    if (count > dominantCount) {
      dominantLabel = label;
      dominantCount = count;
    }
  }

  const confidence = traces.length ? Number((dominantCount / traces.length).toFixed(2)) : 0.5;
  const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
  const dominantSeverity = traces.reduce((best, trace) => severityOrder[trace.severity] > severityOrder[best] ? trace.severity : best, cluster.severity || 'medium');
  const sampleTrace = traces[0] || { user_intent: 'unknown workflow' };
  const title = inferClusterTitle(dominantLabel, sampleTrace);
  const note = `Recomputed with ${strategy}; dominant label ${dominantLabel} from ${dominantCount}/${Math.max(traces.length, 1)} traces.`;
  const owner = inferClusterOwner(dominantLabel);
  const recomputeId = `recompute-${slugify(clusterId)}-${Date.now()}`;
  const labelId = `label-${slugify(clusterId)}-${Date.now()}`;
  const timestamp = nowIso();

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE failure_clusters SET title = ?, status = ?, severity = ?, trace_count = ?, confidence_score = ?, root_cause_hypothesis = ?, owner = ?, triage_note = ?, last_recomputed_at = ?, last_seen_at = ? WHERE id = ?`).run(
      title, 'reviewing', dominantSeverity, traces.length, confidence,
      `Likely ${dominantLabel.replace(/_/g, ' ')} based on grouped trace evidence.`, owner, note, timestamp, timestamp, clusterId
    );
    db.prepare(`INSERT INTO cluster_recompute_runs (id, cluster_id, strategy, status, trace_count, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(recomputeId, clusterId, strategy, 'completed', traces.length, note, timestamp);
    db.prepare(`INSERT INTO cluster_labels (id, cluster_id, label_type, label_value, confidence_score, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(labelId, clusterId, 'root_cause', dominantLabel, confidence, requestedBy, timestamp);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    cluster: db.prepare(`SELECT * FROM failure_clusters WHERE id = ?`).get(clusterId),
    latestLabel: db.prepare(`SELECT * FROM cluster_labels WHERE id = ?`).get(labelId),
    recomputeRun: db.prepare(`SELECT * FROM cluster_recompute_runs WHERE id = ?`).get(recomputeId)
  };
}

export function listClusters(db) {
  return db.prepare(`
    SELECT
      c.*, COALESCE(MAX(CASE WHEN cl.label_type = 'root_cause' THEN cl.label_value END), 'unlabeled') AS root_cause_label,
      COALESCE(MAX(CASE WHEN cl.label_type = 'root_cause' THEN cl.confidence_score END), c.confidence_score) AS label_confidence,
      COUNT(DISTINCT ct.trace_event_id) AS linked_traces,
      COUNT(DISTINCT rr.id) AS recompute_count
    FROM failure_clusters c
    LEFT JOIN cluster_labels cl ON cl.cluster_id = c.id
    LEFT JOIN cluster_traces ct ON ct.cluster_id = c.id
    LEFT JOIN cluster_recompute_runs rr ON rr.cluster_id = c.id
    GROUP BY c.id
    ORDER BY CASE c.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, c.last_seen_at DESC
  `).all();
}

export function listCases(db, { clusterId } = {}) {
  const whereClause = clusterId ? 'WHERE e.cluster_id = ?' : '';
  return db.prepare(`
    SELECT
      e.*, c.title AS cluster_title, c.severity AS cluster_severity,
      COUNT(cr.id) AS review_count,
      MAX(cr.created_at) AS last_reviewed_at
    FROM eval_cases e
    JOIN failure_clusters c ON c.id = e.cluster_id
    LEFT JOIN case_reviews cr ON cr.eval_case_id = e.id
    ${whereClause}
    GROUP BY e.id
    ORDER BY CASE e.priority WHEN 'p0' THEN 1 WHEN 'p1' THEN 2 ELSE 3 END, e.updated_at DESC
  `).all(...(clusterId ? [clusterId] : []));
}

export function getClusterDetails(db, clusterId) {
  const cluster = db.prepare(`SELECT * FROM failure_clusters WHERE id = ?`).get(clusterId);
  if (!cluster) throw new Error(`Cluster not found: ${clusterId}`);
  return {
    cluster,
    labels: db.prepare(`SELECT * FROM cluster_labels WHERE cluster_id = ? ORDER BY created_at DESC`).all(clusterId),
    recomputeRuns: db.prepare(`SELECT * FROM cluster_recompute_runs WHERE cluster_id = ? ORDER BY created_at DESC`).all(clusterId),
    traces: db.prepare(`SELECT t.* FROM trace_events t JOIN cluster_traces ct ON ct.trace_event_id = t.id WHERE ct.cluster_id = ? ORDER BY t.happened_at DESC`).all(clusterId),
    cases: listCases(db, { clusterId })
  };
}
export function getCaseDetails(db, caseId) {
  const item = db.prepare(`SELECT * FROM eval_cases WHERE id = ?`).get(caseId);
  if (!item) throw new Error(`Case not found: ${caseId}`);
  return {
    case: item,
    reviews: db.prepare(`SELECT * FROM case_reviews WHERE eval_case_id = ? ORDER BY created_at DESC`).all(caseId),
    replayResults: db.prepare(`SELECT * FROM replay_case_results WHERE eval_case_id = ? ORDER BY created_at DESC`).all(caseId)
  };
}

export function updateCase(db, caseId, updates) {
  const existing = db.prepare(`SELECT * FROM eval_cases WHERE id = ?`).get(caseId);
  if (!existing) throw new Error(`Case not found: ${caseId}`);
  const next = {
    name: updates.name ?? existing.name,
    priority: updates.priority ?? existing.priority,
    assertion_type: updates.assertionType ?? existing.assertion_type,
    expected_behavior: updates.expectedBehavior ?? existing.expected_behavior,
    input_text: updates.inputText ?? existing.input_text,
    status: updates.status ?? existing.status,
    promptfoo_ready: updates.promptfooReady ?? existing.promptfoo_ready
  };
  db.prepare(`UPDATE eval_cases SET name = ?, priority = ?, assertion_type = ?, expected_behavior = ?, input_text = ?, status = ?, promptfoo_ready = ?, updated_at = ? WHERE id = ?`).run(
    next.name, next.priority, next.assertion_type, next.expected_behavior, next.input_text, next.status, next.promptfoo_ready, nowIso(), caseId
  );
  return db.prepare(`SELECT * FROM eval_cases WHERE id = ?`).get(caseId);
}

export function reviewCase(db, caseId, decision, reviewer, notes = '') {
  const existing = db.prepare(`SELECT * FROM eval_cases WHERE id = ?`).get(caseId);
  if (!existing) throw new Error(`Case not found: ${caseId}`);
  const allowed = ['approved', 'rejected', 'needs_edit', 'duplicate'];
  if (!allowed.includes(decision)) throw new Error(`Unsupported review decision: ${decision}`);
  const reviewId = `review-${slugify(caseId)}-${Date.now()}`;
  const timestamp = nowIso();
  const nextStatus = decision === 'approved' ? 'approved' : decision;
  const nextReady = decision === 'approved' ? 1 : 0;

  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO case_reviews (id, eval_case_id, decision, reviewer, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(reviewId, caseId, decision, reviewer, notes, timestamp);
    db.prepare(`UPDATE eval_cases SET status = ?, promptfoo_ready = ?, updated_at = ? WHERE id = ?`).run(nextStatus, nextReady, timestamp, caseId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    case: db.prepare(`SELECT * FROM eval_cases WHERE id = ?`).get(caseId),
    review: db.prepare(`SELECT * FROM case_reviews WHERE id = ?`).get(reviewId)
  };
}

export function generateCasesFromCluster(db, clusterId, generator = 'default-generator', reviewerRequired = true) {
  const clusterDetails = getClusterDetails(db, clusterId);
  const cluster = clusterDetails.cluster;
  const latestLabel = clusterDetails.labels[0]?.label_value || 'unknown_failure_mode';
  const trace = clusterDetails.traces[0];
  if (!trace) throw new Error(`Cluster ${clusterId} has no traces to generate cases from`);

  const caseId = `case-${slugify(clusterId)}-${Date.now()}`;
  const status = reviewerRequired ? 'proposed' : 'approved';
  const promptfooReady = reviewerRequired ? 0 : 1;
  const timestamp = nowIso();
  const name = `Generated case for ${cluster.title}`;

  db.prepare(`INSERT INTO eval_cases (id, cluster_id, status, name, priority, assertion_type, promptfoo_ready, expected_behavior, generated_from, owner, input_text, last_exported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    caseId, clusterId, status, name, inferCasePriority(cluster.severity), inferAssertionType(latestLabel), promptfooReady,
    inferCaseExpectedBehavior(cluster, { ...trace, root_cause_label: latestLabel }), generator, cluster.owner,
    `User intent: ${trace.user_intent}\nFailure excerpt: ${trace.transcript_excerpt}`, null, timestamp
  );

  db.prepare(`UPDATE failure_clusters SET status = ?, last_seen_at = ? WHERE id = ?`).run(reviewerRequired ? 'reviewing' : 'ready_to_export', timestamp, clusterId);
  return { generatedCaseIds: [caseId], items: listCases(db, { clusterId }).filter((item) => item.id === caseId) };
}

export function listReleaseVersions(db) {
  return db.prepare(`SELECT * FROM release_versions ORDER BY created_at DESC`).all();
}

export function getReplayDetails(db, replayRunId) {
  const replayRun = db.prepare(`
    SELECT r.*, b.prompt_version AS baseline_prompt_version, c.prompt_version AS candidate_prompt_version,
      b.model_name AS baseline_model_name, c.model_name AS candidate_model_name,
      b.retriever_version AS baseline_retriever_version, c.retriever_version AS candidate_retriever_version
    FROM replay_runs r
    JOIN release_versions b ON b.id = r.baseline_version_id
    JOIN release_versions c ON c.id = r.candidate_version_id
    WHERE r.id = ?
  `).get(replayRunId);
  if (!replayRun) throw new Error(`Replay run not found: ${replayRunId}`);
  return {
    replayRun,
    results: db.prepare(`
      SELECT rr.*, e.name AS case_name, e.priority, e.cluster_id
      FROM replay_case_results rr
      JOIN eval_cases e ON e.id = rr.eval_case_id
      WHERE rr.replay_run_id = ?
      ORDER BY rr.created_at DESC
    `).all(replayRunId)
  };
}

export function listReplayRuns(db) {
  return db.prepare(`
    SELECT r.*, b.prompt_version AS baseline_prompt_version, c.prompt_version AS candidate_prompt_version,
      COUNT(rr.id) AS result_count,
      SUM(CASE WHEN rr.verdict = 'regressed' THEN 1 ELSE 0 END) AS regressions_found,
      SUM(CASE WHEN rr.verdict = 'improved' THEN 1 ELSE 0 END) AS improvements_found
    FROM replay_runs r
    JOIN release_versions b ON b.id = r.baseline_version_id
    JOIN release_versions c ON c.id = r.candidate_version_id
    LEFT JOIN replay_case_results rr ON rr.replay_run_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();
}

export function createReplayRun(db, payload) {
  const baseline = db.prepare(`SELECT * FROM release_versions WHERE id = ?`).get(payload.baselineVersionId);
  const candidate = db.prepare(`SELECT * FROM release_versions WHERE id = ?`).get(payload.candidateVersionId);
  if (!baseline || !candidate) throw new Error('Baseline or candidate version not found');

  const caseIds = Array.isArray(payload.caseIds) && payload.caseIds.length
    ? payload.caseIds
    : listCases(db).filter((item) => ['approved', 'exported'].includes(item.status)).map((item) => item.id);
  if (!caseIds.length) throw new Error('No cases selected for replay');

  const replayRunId = `replay-run-${Date.now()}`;
  const createdAt = nowIso();
  const caseItems = caseIds.map((caseId) => {
    const item = db.prepare(`SELECT * FROM eval_cases WHERE id = ?`).get(caseId);
    if (!item) throw new Error(`Case not found: ${caseId}`);
    return item;
  });

  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO replay_runs (id, baseline_version_id, candidate_version_id, status, created_by, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      replayRunId, baseline.id, candidate.id, 'completed', payload.createdBy || 'traceeval', createdAt, createdAt
    );

    for (const item of caseItems) {
      const attribution = inferReplayAttribution(baseline, candidate, item);
      const baselineScore = baseline.prompt_version === candidate.prompt_version ? 0.76 : 0.72;
      const candidateScore = attribution === 'prompt_change' || attribution === 'retriever_change' ? baselineScore + 0.12 : baselineScore - 0.08;
      const delta = Number((candidateScore - baselineScore).toFixed(2));
      const verdict = delta > 0.01 ? 'improved' : delta < -0.01 ? 'regressed' : 'unchanged';
      db.prepare(`INSERT INTO replay_case_results (id, replay_run_id, eval_case_id, baseline_score, candidate_score, delta, verdict, attribution_label, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        `replay-case-${slugify(item.id)}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        replayRunId,
        item.id,
        baselineScore,
        candidateScore,
        delta,
        verdict,
        attribution,
        JSON.stringify({ baselineVersionId: baseline.id, candidateVersionId: candidate.id, caseStatus: item.status }),
        createdAt
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getReplayDetails(db, replayRunId);
}
export function getPromptfooExport(db) {
  return buildPromptfooExportContent(db);
}

function selectExportableCases(db, caseIds = null) {
  const placeholders = Array.isArray(caseIds) && caseIds.length ? `AND e.id IN (${caseIds.map(() => '?').join(', ')})` : '';
  return db.prepare(`
    SELECT e.id, e.name, e.assertion_type, e.expected_behavior, e.priority, e.owner, e.status, c.title AS cluster_title
    FROM eval_cases e
    JOIN failure_clusters c ON c.id = e.cluster_id
    WHERE e.promptfoo_ready = 1 AND e.status IN ('approved', 'exported') ${placeholders}
    ORDER BY CASE e.priority WHEN 'p0' THEN 1 WHEN 'p1' THEN 2 ELSE 3 END, e.id
  `).all(...(Array.isArray(caseIds) && caseIds.length ? caseIds : []));
}

function buildPromptfooExportContent(db, caseIds = null) {
  const cases = selectExportableCases(db, caseIds);
  const tests = cases.map((item) => `  - description: "${escapeYaml(item.name)}"
    metadata:
      caseId: "${item.id}"
      cluster: "${escapeYaml(item.cluster_title)}"
      owner: "${escapeYaml(item.owner)}"
      priority: "${item.priority}"
    vars:
      incident: "${escapeYaml(item.expected_behavior)}"
    assert:
      - type: ${item.assertion_type}`).join('\n');

  return `description: Trace-derived eval pack
prompts:
  - file://prompts/support-agent.txt
providers:
  - openai:gpt-5-mini
tests:
${tests}`;
}

function buildExportPrBody(items, targetPath) {
  const lines = items.map((item) => `- ${item.id}: ${item.name} (${item.priority}, ${item.cluster_title})`);
  return `Add TraceEval-generated promptfoo pack for ${targetPath}\n\nIncluded cases:\n${lines.join('\n')}`;
}

export function createExportBatch(db, payload) {
  const targetSystem = payload.targetSystem || 'promptfoo';
  const targetPath = payload.targetPath || `exports/promptfooconfig.${Date.now()}.yaml`;
  const selectedCases = selectExportableCases(db, payload.caseIds || null);
  if (!selectedCases.length) {
    throw new Error('No approved exportable cases selected');
  }

  const exportId = `export-${Date.now()}`;
  const createdAt = nowIso();
  const content = buildPromptfooExportContent(db, selectedCases.map((item) => item.id));
  const prTitle = `Export ${selectedCases.length} TraceEval cases to ${targetPath}`;
  const prBody = buildExportPrBody(selectedCases, targetPath);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO export_batches (id, target_system, target_path, case_count, status, content, case_ids_json, pr_title, pr_body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      exportId,
      targetSystem,
      targetPath,
      selectedCases.length,
      payload.status || 'draft',
      content,
      JSON.stringify(selectedCases.map((item) => item.id)),
      prTitle,
      prBody,
      createdAt
    );

    db.prepare(`
      UPDATE eval_cases
      SET status = 'exported', last_exported_at = ?, updated_at = ?
      WHERE id = ?
    `);
    for (const item of selectedCases) {
      db.prepare(`UPDATE eval_cases SET status = 'exported', last_exported_at = ?, updated_at = ? WHERE id = ?`).run(createdAt, createdAt, item.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getExportBatch(db, exportId);
}

export function listExportBatches(db) {
  return db.prepare(`SELECT * FROM export_batches ORDER BY created_at DESC`).all();
}

export function getExportBatch(db, exportId) {
  const item = db.prepare(`SELECT * FROM export_batches WHERE id = ?`).get(exportId);
  if (!item) throw new Error(`Export batch not found: ${exportId}`);
  return {
    exportBatch: item,
    caseIds: JSON.parse(item.case_ids_json || '[]')
  };
}

export function getDashboardSnapshot(db) {
  const pipelineSummary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM trace_events) AS total_traces,
      (SELECT COUNT(*) FROM failure_clusters WHERE status != 'resolved') AS active_clusters,
      (SELECT COUNT(*) FROM eval_cases WHERE promptfoo_ready = 1 AND status IN ('approved', 'exported')) AS export_ready_cases,
      (SELECT COUNT(*) FROM eval_cases WHERE status = 'proposed') AS cases_waiting_review,
      (SELECT COUNT(*) FROM case_reviews) AS completed_reviews,
      (SELECT COUNT(*) FROM source_feeds WHERE status = 'healthy') AS healthy_sources,
      (SELECT COALESCE(SUM(accepted_count), 0) FROM ingest_batches) AS accepted_ingests,
      (SELECT COALESCE(SUM(deduped_count), 0) FROM ingest_batches) AS deduped_ingests,
      (SELECT COUNT(*) FROM cluster_recompute_runs) AS recompute_runs,
      (SELECT COUNT(*) FROM cluster_labels WHERE label_type = 'root_cause') AS root_cause_labels,
      (SELECT COUNT(*) FROM replay_runs) AS replay_runs,
      (SELECT COUNT(*) FROM replay_case_results WHERE verdict = 'regressed') AS regressed_results,
      (SELECT COUNT(*) FROM replay_case_results WHERE verdict = 'improved') AS improved_results
  `).get();

  const coverage = db.prepare(`SELECT ROUND(100.0 * SUM(CASE WHEN promptfoo_ready = 1 AND status IN ('approved', 'exported') THEN 1 ELSE 0 END) / COUNT(*), 1) AS case_export_coverage FROM eval_cases`).get();

  return {
    generatedAt: nowIso(),
    pipelineSummary: { ...pipelineSummary, case_export_coverage: Number(coverage.case_export_coverage || 0) },
    sources: db.prepare(`SELECT * FROM source_feeds ORDER BY CASE status WHEN 'healthy' THEN 1 WHEN 'lagging' THEN 2 ELSE 3 END, records_24h DESC`).all(),
    recentIngests: db.prepare(`SELECT b.*, s.kind FROM ingest_batches b JOIN source_feeds s ON s.id = b.source_feed_id ORDER BY b.received_at DESC LIMIT 8`).all(),
    recentClusterActivity: db.prepare(`SELECT rr.*, c.title, c.owner FROM cluster_recompute_runs rr JOIN failure_clusters c ON c.id = rr.cluster_id ORDER BY rr.created_at DESC LIMIT 8`).all(),
    recentReviews: db.prepare(`SELECT cr.*, e.name AS case_name, e.status FROM case_reviews cr JOIN eval_cases e ON e.id = cr.eval_case_id ORDER BY cr.created_at DESC LIMIT 8`).all(),
    clusters: listClusters(db),
    evalCases: listCases(db),
    releaseVersions: listReleaseVersions(db),
    replayRuns: listReplayRuns(db),
    recentReplayResults: db.prepare(`SELECT rr.*, e.name AS case_name FROM replay_case_results rr JOIN eval_cases e ON e.id = rr.eval_case_id ORDER BY rr.created_at DESC LIMIT 8`).all(),
    exports: listExportBatches(db),
    promptfooExport: getPromptfooExport(db)
  };
}

export function getSampleRows(db) {
  return {
    source_feeds: db.prepare(`SELECT * FROM source_feeds ORDER BY id`).all(),
    ingest_batches: db.prepare(`SELECT * FROM ingest_batches ORDER BY id`).all(),
    trace_events: db.prepare(`SELECT * FROM trace_events ORDER BY id`).all(),
    trace_artifacts: db.prepare(`SELECT * FROM trace_artifacts ORDER BY id`).all(),
    failure_clusters: db.prepare(`SELECT * FROM failure_clusters ORDER BY id`).all(),
    cluster_labels: db.prepare(`SELECT * FROM cluster_labels ORDER BY id`).all(),
    cluster_recompute_runs: db.prepare(`SELECT * FROM cluster_recompute_runs ORDER BY id`).all(),
    cluster_traces: db.prepare(`SELECT * FROM cluster_traces ORDER BY cluster_id, trace_event_id`).all(),
    eval_cases: db.prepare(`SELECT * FROM eval_cases ORDER BY id`).all(),
    case_reviews: db.prepare(`SELECT * FROM case_reviews ORDER BY id`).all(),
    release_versions: db.prepare(`SELECT * FROM release_versions ORDER BY id`).all(),
    replay_runs: db.prepare(`SELECT * FROM replay_runs ORDER BY id`).all(),
    replay_case_results: db.prepare(`SELECT * FROM replay_case_results ORDER BY id`).all(),
    export_batches: db.prepare(`SELECT * FROM export_batches ORDER BY id`).all()
  };
}
