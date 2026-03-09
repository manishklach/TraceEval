import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb, getSampleRows } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';
import '../scripts/seed.mjs';

test('seeded sample database contains trace-to-eval pipeline data', () => {
  const rows = getSampleRows(openDb());
  assert.equal(rows.source_feeds.length, 3);
  assert.equal(rows.trace_events.length, 6);
  assert.equal(rows.failure_clusters.length, 3);
  assert.equal(rows.eval_cases.length, 4);
  assert.equal(rows.export_batches.filter((row) => row.status === 'published').length, 2);
});

test('dashboard api returns expected pipeline summary', async () => {
  const server = await startServer({ port: 0 });
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/dashboard`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.pipelineSummary.total_traces, 6);
  assert.equal(payload.pipelineSummary.active_clusters, 3);
  assert.equal(payload.pipelineSummary.export_ready_cases, 3);
  assert.equal(payload.pipelineSummary.case_export_coverage, 75);
  assert.equal(payload.clusters[0].id, 'cluster-01');

  server.close();
  await once(server, 'close');
});

test('promptfoo export endpoint emits yaml derived from eval cases', async () => {
  const server = await startServer({ port: 0 });
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/promptfoo-export`);
  const payload = await response.text();

  assert.equal(response.status, 200);
  assert.match(payload, /description: Trace-derived eval pack/);
  assert.match(payload, /case-01/);
  assert.match(payload, /type: contains-json/);
  assert.doesNotMatch(payload, /case-04/);

  server.close();
  await once(server, 'close');
});
