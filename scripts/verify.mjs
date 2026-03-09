import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openDb, getSampleRows } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';
import './seed.mjs';

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
    const request = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (response) => {
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

function logStep(message) {
  console.log(`- ${message}`);
}

async function run() {
  const rows = loadRows();
  assert.equal(rows.source_feeds.length, 3);
  assert.equal(rows.ingest_batches.length, 3);
  assert.equal(rows.trace_events.length, 6);
  assert.equal(rows.trace_artifacts.length, 12);
  assert.equal(rows.failure_clusters.length, 3);
  assert.equal(rows.eval_cases.length, 4);
  logStep('seeded sample database contains ingestion and pipeline data');

  const dashboardServer = await startServer({ port: 0 });
  try {
    const dashboardResponse = await requestJson(dashboardServer.address().port, '/api/dashboard');
    assert.equal(dashboardResponse.status, 200);
    assert.equal(dashboardResponse.body.pipelineSummary.total_traces, 6);
    assert.equal(dashboardResponse.body.pipelineSummary.accepted_ingests, 6);
    assert.equal(dashboardResponse.body.pipelineSummary.deduped_ingests, 1);
    assert.equal(dashboardResponse.body.recentIngests[0].id, 'ingest-seed-03');
    logStep('dashboard api returns expected pipeline summary');
  } finally {
    await closeServer(dashboardServer);
  }

  const exportServer = await startServer({ port: 0 });
  try {
    const exportResponse = await requestText(exportServer.address().port, '/api/promptfoo-export');
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.body, /description: Trace-derived eval pack/);
    assert.match(exportResponse.body, /case-01/);
    assert.doesNotMatch(exportResponse.body, /case-04/);
    logStep('promptfoo export endpoint emits yaml derived from eval cases');
  } finally {
    await closeServer(exportServer);
  }

  const ingestServer = await startServer({ port: 0 });
  try {
    const ingestResponse = await requestJson(ingestServer.address().port, '/api/ingest/source-events', {
      method: 'POST',
      body: {
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
      }
    });

    assert.equal(ingestResponse.status, 202);
    assert.equal(ingestResponse.body.accepted, 1);
    assert.equal(ingestResponse.body.deduped, 1);

    const updatedRows = loadRows();
    const inserted = updatedRows.trace_events.find((row) => row.id === ingestResponse.body.traceEventIds[0]);
    assert.equal(inserted.failure_signal, 'user_thumb_down');
    assert.match(inserted.transcript_excerpt, /\[redacted-email\]/);

    const redactedArtifact = updatedRows.trace_artifacts.find((row) => row.trace_event_id === ingestResponse.body.traceEventIds[0] && row.artifact_type === 'redacted');
    assert.match(redactedArtifact.payload, /\[redacted-email\]/);
    assert.match(redactedArtifact.payload, /\[redacted-id\]/);
    logStep('ingest api normalizes, redacts, and dedupes source events');
  } finally {
    await closeServer(ingestServer);
  }

  console.log('Verification passed');
}

await run();
