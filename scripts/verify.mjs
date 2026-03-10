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
      let data = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { data += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
    });
    request.on('error', reject); if (payload) request.write(payload); request.end();
  });
}
function requestText(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      let data = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { data += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: data }));
    });
    request.on('error', reject); request.end();
  });
}
async function closeServer(server) { server.close(); await once(server, 'close'); }
function logStep(message) { console.log(`- ${message}`); }

async function run() {
  const rows = loadRows();
  assert.equal(rows.eval_cases.length, 4);
  assert.equal(rows.case_reviews.length, 3);
  assert.equal(rows.eval_cases.filter((row) => row.status === 'proposed').length, 1);
  logStep('seeded sample database contains reviewable eval cases');

  const dashboardServer = await startServer({ port: 0 });
  try {
    const dashboard = await requestJson(dashboardServer.address().port, '/api/dashboard');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.pipelineSummary.cases_waiting_review, 1);
    assert.equal(dashboard.body.pipelineSummary.completed_reviews, 3);
    logStep('dashboard api exposes review workflow summary');
  } finally { await closeServer(dashboardServer); }

  const caseServer = await startServer({ port: 0 });
  try {
    const generate = await requestJson(caseServer.address().port, '/api/clusters/cluster-03/generate-cases', { method: 'POST', body: { generator: 'triage-review-generator', reviewerRequired: true } });
    assert.equal(generate.status, 202);
    assert.equal(generate.body.generatedCaseIds.length, 1);

    const generatedCaseId = generate.body.generatedCaseIds[0];
    const patch = await requestJson(caseServer.address().port, `/api/cases/${generatedCaseId}`, { method: 'PATCH', body: { name: 'Generated billing freshness review case', priority: 'p1', expectedBehavior: 'Use only fresh billing guidance.', inputText: 'User asks to change billing email.', assertionType: 'contains' } });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.name, 'Generated billing freshness review case');
    assert.equal(patch.body.priority, 'p1');

    const review = await requestJson(caseServer.address().port, `/api/cases/${generatedCaseId}/review`, { method: 'POST', body: { decision: 'approved', reviewer: 'manish', notes: 'Good minimal repro.' } });
    assert.equal(review.status, 200);
    assert.equal(review.body.case.status, 'approved');
    assert.equal(review.body.case.promptfoo_ready, 1);

    const caseDetail = await requestJson(caseServer.address().port, `/api/cases/${generatedCaseId}`);
    assert.equal(caseDetail.status, 200);
    assert.equal(caseDetail.body.reviews.length, 1);
    assert.equal(caseDetail.body.reviews[0].decision, 'approved');
    logStep('case generation, editing, and review APIs work end to end');
  } finally { await closeServer(caseServer); }

  const exportServer = await startServer({ port: 0 });
  try {
    const exportResponse = await requestText(exportServer.address().port, '/api/promptfoo-export');
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.body, /description: Trace-derived eval pack/);
    assert.match(exportResponse.body, /Generated billing freshness review case/);
    logStep('approved reviewed cases flow into promptfoo export');
  } finally { await closeServer(exportServer); }

  const ingestServer = await startServer({ port: 0 });
  try {
    const ingest = await requestJson(ingestServer.address().port, '/api/ingest/source-events', { method: 'POST', body: { source: 'Intercom live feed', owner: 'support-eng', events: [{ externalId: 'evt-live-01', conversationId: 'conv-live-01', userIntent: 'refund for duplicate charge', failureSignal: 'user thumb down', severity: 'critical', modelName: 'gpt-5-mini', toolTrace: 'refund_lookup -> ticket-9911', transcriptExcerpt: 'Customer jane@example.com said order 998877 was charged twice.', happenedAt: '2026-03-09T17:10:00Z', metadata: { environment: 'prod', workspace: 'support-agent' } }, { externalId: 'evt-live-01', conversationId: 'conv-live-01', userIntent: 'refund for duplicate charge', failureSignal: 'user thumb down', severity: 'critical', modelName: 'gpt-5-mini', toolTrace: 'refund_lookup -> ticket-9911', transcriptExcerpt: 'Customer jane@example.com said order 998877 was charged twice.', happenedAt: '2026-03-09T17:10:00Z', metadata: { environment: 'prod', workspace: 'support-agent' } }] } });
    assert.equal(ingest.status, 202);
    assert.equal(ingest.body.accepted, 1);
    assert.equal(ingest.body.deduped, 1);
    logStep('ingest api still works after review workflow changes');
  } finally { await closeServer(ingestServer); }

  console.log('Verification passed');
}
await run();
