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

    CREATE TABLE IF NOT EXISTS trace_events (
      id TEXT PRIMARY KEY,
      source_feed_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      failure_signal TEXT NOT NULL,
      severity TEXT NOT NULL,
      model_name TEXT NOT NULL,
      tool_trace TEXT,
      user_intent TEXT NOT NULL,
      transcript_excerpt TEXT NOT NULL,
      happened_at TEXT NOT NULL,
      FOREIGN KEY (source_feed_id) REFERENCES source_feeds(id)
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
      last_seen_at TEXT NOT NULL
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
    DROP TABLE IF EXISTS failure_clusters;
    DROP TABLE IF EXISTS trace_events;
    DROP TABLE IF EXISTS source_feeds;
  `);
}

export function getPromptfooExport(db) {
  const cases = db.prepare(`
    SELECT
      e.id,
      e.name,
      e.assertion_type,
      e.expected_behavior,
      c.title AS cluster_title
    FROM eval_cases e
    JOIN failure_clusters c ON c.id = e.cluster_id
    WHERE e.promptfoo_ready = 1
    ORDER BY
      CASE e.priority
        WHEN 'p0' THEN 1
        WHEN 'p1' THEN 2
        ELSE 3
      END,
      e.id
  `).all();

  const tests = cases.map((item) => `  - description: "${item.name}"
    metadata:
      caseId: "${item.id}"
      cluster: "${item.cluster_title}"
    vars:
      incident: "${item.expected_behavior}"
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
      (SELECT COALESCE(SUM(improvements_found), 0) FROM replay_runs) AS improvements_captured
  `).get();

  const coverage = db.prepare(`
    SELECT
      ROUND(
        100.0 * SUM(CASE WHEN promptfoo_ready = 1 THEN 1 ELSE 0 END) / COUNT(*),
        1
      ) AS case_export_coverage
    FROM eval_cases
  `).get();

  const sources = db.prepare(`
    SELECT *
    FROM source_feeds
    ORDER BY
      CASE status
        WHEN 'healthy' THEN 1
        WHEN 'lagging' THEN 2
        ELSE 3
      END,
      records_24h DESC
  `).all();

  const clusters = db.prepare(`
    SELECT
      c.*,
      COUNT(ct.trace_event_id) AS linked_traces
    FROM failure_clusters c
    LEFT JOIN cluster_traces ct ON ct.cluster_id = c.id
    GROUP BY c.id
    ORDER BY
      CASE c.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      c.last_seen_at DESC
  `).all();

  const evalCases = db.prepare(`
    SELECT
      e.id,
      e.name,
      e.priority,
      e.assertion_type,
      e.promptfoo_ready,
      e.expected_behavior,
      e.generated_from,
      e.owner,
      e.last_exported_at,
      c.title AS cluster_title,
      c.severity AS cluster_severity
    FROM eval_cases e
    JOIN failure_clusters c ON c.id = e.cluster_id
    ORDER BY
      CASE e.priority
        WHEN 'p0' THEN 1
        WHEN 'p1' THEN 2
        ELSE 3
      END,
      e.id
  `).all();

  const replayRuns = db.prepare(`
    SELECT
      r.*,
      e.name AS eval_case_name
    FROM replay_runs r
    JOIN eval_cases e ON e.id = r.eval_case_id
    ORDER BY r.executed_at DESC
    LIMIT 8
  `).all();

  const exports = db.prepare(`
    SELECT *
    FROM export_batches
    ORDER BY created_at DESC
  `).all();

  return {
    generatedAt: new Date().toISOString(),
    pipelineSummary: {
      ...pipelineSummary,
      case_export_coverage: Number(coverage.case_export_coverage || 0)
    },
    sources,
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
    trace_events: db.prepare(`SELECT * FROM trace_events ORDER BY id`).all(),
    failure_clusters: db.prepare(`SELECT * FROM failure_clusters ORDER BY id`).all(),
    cluster_traces: db.prepare(`SELECT * FROM cluster_traces ORDER BY cluster_id, trace_event_id`).all(),
    eval_cases: db.prepare(`SELECT * FROM eval_cases ORDER BY id`).all(),
    replay_runs: db.prepare(`SELECT * FROM replay_runs ORDER BY id`).all(),
    export_batches: db.prepare(`SELECT * FROM export_batches ORDER BY id`).all()
  };
}
