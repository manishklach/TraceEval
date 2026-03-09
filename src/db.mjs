import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const dataDir = path.join(projectRoot, 'data');
const dbPath = path.join(dataDir, 'monitor.db');

function ensureDataDir() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function slugify(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
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
  if (['critical', 'high', 'medium', 'low'].includes(severity)) {
    return severity;
  }
  return 'medium';
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
  const fallbackIntent = trace.user_intent || 'unknown workflow';
  if (label === 'policy_hallucination') return `Policy hallucinations in ${fallbackIntent}`;
  if (label === 'tool_timeout') return `Tool timeout handling for ${fallbackIntent}`;
  if (label === 'retrieval_staleness') return `Retrieval freshness issues for ${fallbackIntent}`;
  if (label === 'identity_flow_gap') return `Identity fallback gaps for ${fallbackIntent}`;
  return `Unclassified failures in ${fallbackIntent}`;
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
      name TEXT NOT NULL,
      priority TEXT NOT NULL,
      assertion_type TEXT NOT NULL,
      promptfoo_ready INTEGER NOT NULL,
      expected_behavior TEXT NOT NULL,
      generated_from TEXT NOT NULL,
      owner TEXT NOT NULL,
      last_exported_at TEXT,
      FOREIGN KEY (cluster_id) REFERENCES failure_clusters(id)
    );

    CREATE TABLE IF NOT EXISTS replay_runs (
      id TEXT PRIMARY KEY,
      eval_case_id TEXT NOT NULL,
      baseline_version TEXT NOT NULL,
      candidate_version TEXT NOT NULL,
      verdict TEXT NOT NULL,
      regressions_found INTEGER NOT NULL,
      improvements_found INTEGER NOT NULL,
      executed_at TEXT NOT NULL,
      FOREIGN KEY (eval_case_id) REFERENCES eval_cases(id)
    );

    CREATE TABLE IF NOT EXISTS export_batches (
      id TEXT PRIMARY KEY,
      target_system TEXT NOT NULL,
      target_path TEXT NOT NULL,
      case_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function resetDatabase(db) {
  db.exec(`
    DROP TABLE IF EXISTS export_batches;
    DROP TABLE IF EXISTS replay_runs;
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

    db.prepare(`INSERT INTO ingest_batches (id, source_feed_id, source_name, accepted_count, deduped_count, status, received_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      batchId, sourceFeedId, sourceName, accepted, deduped, 'completed', receivedAt, nowIso()
    );

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

  const traces = db.prepare(`
    SELECT t.* FROM trace_events t
    JOIN cluster_traces ct ON ct.trace_event_id = t.id
    WHERE ct.cluster_id = ?
    ORDER BY t.happened_at DESC
  `).all(clusterId);

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
  const dominantSeverity = traces.reduce((best, trace) => {
    return severityOrder[trace.severity] > severityOrder[best] ? trace.severity : best;
  }, cluster.severity || 'medium');
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
      title,
      'reviewing',
      dominantSeverity,
      traces.length,
      confidence,
      `Likely ${dominantLabel.replace(/_/g, ' ')} based on grouped trace evidence.`,
      owner,
      note,
      timestamp,
      timestamp,
      clusterId
    );
    db.prepare(`INSERT INTO cluster_recompute_runs (id, cluster_id, strategy, status, trace_count, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      recomputeId, clusterId, strategy, 'completed', traces.length, note, timestamp
    );
    db.prepare(`INSERT INTO cluster_labels (id, cluster_id, label_type, label_value, confidence_score, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      labelId, clusterId, 'root_cause', dominantLabel, confidence, requestedBy, timestamp
    );
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
      c.*,
      COALESCE(MAX(CASE WHEN cl.label_type = 'root_cause' THEN cl.label_value END), 'unlabeled') AS root_cause_label,
      COALESCE(MAX(CASE WHEN cl.label_type = 'root_cause' THEN cl.confidence_score END), c.confidence_score) AS label_confidence,
      COUNT(DISTINCT ct.trace_event_id) AS linked_traces,
      COUNT(DISTINCT rr.id) AS recompute_count
    FROM failure_clusters c
    LEFT JOIN cluster_labels cl ON cl.cluster_id = c.id
    LEFT JOIN cluster_traces ct ON ct.cluster_id = c.id
    LEFT JOIN cluster_recompute_runs rr ON rr.cluster_id = c.id
    GROUP BY c.id
    ORDER BY
      CASE c.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      c.last_seen_at DESC
  `).all();
}

export function getClusterDetails(db, clusterId) {
  const cluster = db.prepare(`SELECT * FROM failure_clusters WHERE id = ?`).get(clusterId);
  if (!cluster) throw new Error(`Cluster not found: ${clusterId}`);
  return {
    cluster,
    labels: db.prepare(`SELECT * FROM cluster_labels WHERE cluster_id = ? ORDER BY created_at DESC`).all(clusterId),
    recomputeRuns: db.prepare(`SELECT * FROM cluster_recompute_runs WHERE cluster_id = ? ORDER BY created_at DESC`).all(clusterId),
    traces: db.prepare(`SELECT t.* FROM trace_events t JOIN cluster_traces ct ON ct.trace_event_id = t.id WHERE ct.cluster_id = ? ORDER BY t.happened_at DESC`).all(clusterId)
  };
}

export function getPromptfooExport(db) {
  const cases = db.prepare(`
    SELECT e.id, e.name, e.assertion_type, e.expected_behavior, c.title AS cluster_title
    FROM eval_cases e
    JOIN failure_clusters c ON c.id = e.cluster_id
    WHERE e.promptfoo_ready = 1
    ORDER BY CASE e.priority WHEN 'p0' THEN 1 WHEN 'p1' THEN 2 ELSE 3 END, e.id
  `).all();

  const tests = cases.map((item) => `  - description: "${escapeYaml(item.name)}"
    metadata:
      caseId: "${item.id}"
      cluster: "${escapeYaml(item.cluster_title)}"
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

export function getDashboardSnapshot(db) {
  const pipelineSummary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM trace_events) AS total_traces,
      (SELECT COUNT(*) FROM failure_clusters WHERE status != 'resolved') AS active_clusters,
      (SELECT COUNT(*) FROM eval_cases WHERE promptfoo_ready = 1) AS export_ready_cases,
      (SELECT COUNT(*) FROM source_feeds WHERE status = 'healthy') AS healthy_sources,
      (SELECT COALESCE(SUM(regressions_found), 0) FROM replay_runs) AS regressions_detected,
      (SELECT COALESCE(SUM(improvements_found), 0) FROM replay_runs) AS improvements_captured,
      (SELECT COALESCE(SUM(accepted_count), 0) FROM ingest_batches) AS accepted_ingests,
      (SELECT COALESCE(SUM(deduped_count), 0) FROM ingest_batches) AS deduped_ingests,
      (SELECT COUNT(*) FROM cluster_recompute_runs) AS recompute_runs,
      (SELECT COUNT(*) FROM cluster_labels WHERE label_type = 'root_cause') AS root_cause_labels
  `).get();

  const coverage = db.prepare(`SELECT ROUND(100.0 * SUM(CASE WHEN promptfoo_ready = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS case_export_coverage FROM eval_cases`).get();
  const sources = db.prepare(`SELECT * FROM source_feeds ORDER BY CASE status WHEN 'healthy' THEN 1 WHEN 'lagging' THEN 2 ELSE 3 END, records_24h DESC`).all();
  const recentIngests = db.prepare(`SELECT b.*, s.kind FROM ingest_batches b JOIN source_feeds s ON s.id = b.source_feed_id ORDER BY b.received_at DESC LIMIT 8`).all();
  const clusters = listClusters(db);
  const recentClusterActivity = db.prepare(`
    SELECT rr.*, c.title, c.owner
    FROM cluster_recompute_runs rr
    JOIN failure_clusters c ON c.id = rr.cluster_id
    ORDER BY rr.created_at DESC
    LIMIT 8
  `).all();
  const evalCases = db.prepare(`
    SELECT e.id, e.name, e.priority, e.assertion_type, e.promptfoo_ready, e.expected_behavior, e.generated_from, e.owner, e.last_exported_at, c.title AS cluster_title, c.severity AS cluster_severity
    FROM eval_cases e
    JOIN failure_clusters c ON c.id = e.cluster_id
    ORDER BY CASE e.priority WHEN 'p0' THEN 1 WHEN 'p1' THEN 2 ELSE 3 END, e.id
  `).all();
  const replayRuns = db.prepare(`SELECT r.*, e.name AS eval_case_name FROM replay_runs r JOIN eval_cases e ON e.id = r.eval_case_id ORDER BY r.executed_at DESC LIMIT 8`).all();
  const exports = db.prepare(`SELECT * FROM export_batches ORDER BY created_at DESC`).all();

  return {
    generatedAt: nowIso(),
    pipelineSummary: { ...pipelineSummary, case_export_coverage: Number(coverage.case_export_coverage || 0) },
    sources,
    recentIngests,
    recentClusterActivity,
    clusters,
    evalCases,
    replayRuns,
    exports,
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
    replay_runs: db.prepare(`SELECT * FROM replay_runs ORDER BY id`).all(),
    export_batches: db.prepare(`SELECT * FROM export_batches ORDER BY id`).all()
  };
}
