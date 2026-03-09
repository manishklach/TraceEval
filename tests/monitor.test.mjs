import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openDb, getSampleRows } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';
import '../scripts/seed.mjs';

function loadRows() {
  const db = openDb();
  try {
    return getSampleRows(db);
  } finally {
    db.close();
  }
}

function requestJson(port, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        : undefined
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          body: data ? JSON.parse(data) : null
        });
      });
    });

    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function requestText(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET'
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        resolve({ status: response.statusCode, body: data });
      });
    });

    request.on('error', reject);
    request.end();
  });
}

async function closeServer(server) {
  server.close();
  await once(server, 'close');
}

test('seeded sample database contains ingestion and pipeline data', { concurrency: false }, () => {
  const rows = loadRows();
  assert.equal(rows.source_feeds.length, 3);
  assert.equal(rows.ingest_batches.length, 3);
  assert.equal(rows.trace_events.length, 6);
  assert.equal(rows.trace_artifacts.length, 12);
  assert.equal(rows.failure_clusters.length, 3);
  assert.equal(rows.eval_cases.length, 4);
  assert.equal(rows.export_batches.filter((row) => row.status === 'published').length, 2);
});

test('dashboard api returns expected pipeline summary', { concurrency: false }, async () => {
  const server = await startServer({ port: 0 });
  const address = server.address();
  const response = await requestJson(address.port, '/api/dashboard');

  assert.equal(response.status, 200);
  assert.equal(response.body.pipelineSummary.total_traces, 6);
  assert.equal(response.body.pipelineSummary.accepted_ingests, 6);
  assert.equal(response.body.pipelineSummary.deduped_ingests, 1);
  assert.equal(response.body.pipelineSummary.active_clusters, 3);
  assert.equal(response.body.pipelineSummary.export_ready_cases, 3);
  assert.equal(response.body.pipelineSummary.case_export_coverage, 75);
  assert.equal(response.body.recentIngests[0].id, 'ingest-seed-03');

  await closeServer(server);
});

test('promptfoo export endpoint emits yaml derived from eval cases', { concurrency: false }, async () => {
  const server = await startServer({ port: 0 });
  const address = server.address();
  const response = await requestText(address.port, '/api/promptfoo-export');

  assert.equal(response.status, 200);
  assert.match(response.body, /description: Trace-derived eval pack/);
  assert.match(response.body, /case-01/);
  assert.match(response.body, /type: contains-json/);
  assert.doesNotMatch(response.body, /case-04/);

  await closeServer(server);
});

test('ingest api normalizes, redacts, and dedupes source events', { concurrency: false }, async () => {
  const server = await startServer({ port: 0 });
  const address = server.address();

  const requestBody = {
    source: 'Intercom live feed',
    owner: 'support-eng',
    events: [
      {
        externalId: 'evt-live-01',
        conversationId: 'conv-live-01',
        userIntent: 'refund for duplicate charge',
        failureSignal: 'user thumb down',
        severity: 'critical',
        modelName: 'gpt-5-mini',
        toolTrace: 'refund_lookup -> ticket-9911',
        transcriptExcerpt: 'Customer jane@example.com said order 998877 was charged twice.',
        happenedAt: '2026-03-09T17:10:00Z',
        metadata: {
          environment: 'prod',
          workspace: 'support-agent'
        }
      },
      {
        externalId: 'evt-live-01',
        conversationId: 'conv-live-01',
        userIntent: 'refund for duplicate charge',
        failureSignal: 'user thumb down',
        severity: 'critical',
        modelName: 'gpt-5-mini',
        toolTrace: 'refund_lookup -> ticket-9911',
        transcriptExcerpt: 'Customer jane@example.com said order 998877 was charged twice.',
        happenedAt: '2026-03-09T17:10:00Z',
        metadata: {
          environment: 'prod',
          workspace: 'support-agent'
        }
      }
    ]
  };

  const response = await requestJson(address.port, '/api/ingest/source-events', {
    method: 'POST',
    body: requestBody
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.accepted, 1);
  assert.equal(response.body.deduped, 1);
  assert.equal(response.body.sourceFeedId, 'src-intercom-live-feed');
  assert.equal(response.body.traceEventIds.length, 1);

  const rows = loadRows();
  const inserted = rows.trace_events.find((row) => row.id === response.body.traceEventIds[0]);
  assert.equal(inserted.failure_signal, 'user_thumb_down');
  assert.match(inserted.transcript_excerpt, /\[redacted-email\]/);

  const redactedArtifact = rows.trace_artifacts.find((row) => row.trace_event_id === response.body.traceEventIds[0] && row.artifact_type === 'redacted');
  assert.match(redactedArtifact.payload, /\[redacted-email\]/);
  assert.match(redactedArtifact.payload, /\[redacted-id\]/);

  await closeServer(server);
});
