import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { openDb, getSampleRows } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';

function loadRows() {
  const db = openDb();
  try { return getSampleRows(db); } finally { db.close(); }
}

function requestJson(port, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const request = http.request({ hostname: '127.0.0.1', port, path, method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function requestText(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: data }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function closeServer(server) { server.close(); await once(server, 'close'); }
function logStep(message) { console.log(`- ${message}`); }

async function run() {
  const rows = loadRows();
  assert.equal(rows.release_versions.length, 3);
  assert.equal(rows.replay_runs.length, 2);
  assert.equal(rows.replay_case_results.length, 4);
  logStep('seeded sample database contains replay versions and results');

  const dashboardServer = await startServer({ port: 0 });
  try {
    const dashboard = await requestJson(dashboardServer.address().port, '/api/dashboard');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.pipelineSummary.replay_runs, 2);
    assert.equal(dashboard.body.pipelineSummary.regressed_results, 2);
    assert.equal(dashboard.body.pipelineSummary.improved_results, 2);
    logStep('dashboard api exposes replay summary');
  } finally { await closeServer(dashboardServer); }

  const replayServer = await startServer({ port: 0 });
  try {
    const versions = await requestJson(replayServer.address().port, '/api/release-versions');
    assert.equal(versions.status, 200);
    assert.equal(versions.body.items.length, 3);

    const replays = await requestJson(replayServer.address().port, '/api/replays');
    assert.equal(replays.status, 200);
    assert.equal(replays.body.items.length, 2);

    const createdReplay = await requestJson(replayServer.address().port, '/api/replays', {
      method: 'POST',
      body: {
        baselineVersionId: 'rel-018',
        candidateVersionId: 'rel-019',
        caseIds: ['case-01', 'case-02'],
        createdBy: 'manish'
      }
    });
    assert.equal(createdReplay.status, 202);
    assert.equal(createdReplay.body.results.length, 2);
    assert.equal(createdReplay.body.results[0].attribution_label, 'retriever_change');

    const replayDetails = await requestJson(replayServer.address().port, `/api/replays/${createdReplay.body.replayRun.id}`);
    assert.equal(replayDetails.status, 200);
    assert.equal(replayDetails.body.results.length, 2);
    logStep('replay APIs create runs and expose attribution details');
  } finally { await closeServer(replayServer); }

  const caseServer = await startServer({ port: 0 });
  try {
    const caseDetails = await requestJson(caseServer.address().port, '/api/cases/case-01');
    assert.equal(caseDetails.status, 200);
    assert.ok(caseDetails.body.replayResults.length >= 1);
    logStep('case details include replay history');
  } finally { await closeServer(caseServer); }

  const exportServer = await startServer({ port: 0 });
  try {
    const exportResponse = await requestText(exportServer.address().port, '/api/promptfoo-export');
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.body, /Decline unsupported refund exceptions/);
    logStep('approved cases still export correctly');
  } finally { await closeServer(exportServer); }

  const ingestServer = await startServer({ port: 0 });
  try {
    const ingest = await requestJson(ingestServer.address().port, '/api/ingest/source-events', {
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
            metadata: { environment: 'prod', workspace: 'support-agent' }
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
            metadata: { environment: 'prod', workspace: 'support-agent' }
          }
        ]
      }
    });
    assert.equal(ingest.status, 202);
    assert.equal(ingest.body.accepted, 1);
    assert.equal(ingest.body.deduped, 1);
    logStep('ingest api still works after replay changes');
  } finally { await closeServer(ingestServer); }

  console.log('Verification passed');
}

await run();
