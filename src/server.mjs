import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignClusterOwner,
  createExportBatch,
  createReplayRun,
  generateCasesFromCluster,
  getCaseDetails,
  getClusterDetails,
  getDashboardSnapshot,
  getExportBatch,
  getPromptfooExport,
  getReplayDetails,
  getSampleRows,
  ingestSourceEvents,
  initSchema,
  listCases,
  listClusters,
  listExportBatches,
  listReleaseVersions,
  listReplayRuns,
  openDb,
  recomputeCluster,
  reviewCase,
  updateCase
} from './db.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

function text(response, statusCode, payload, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, { 'Content-Type': contentType });
  response.end(payload);
}

function serveFile(response, relativePath, contentType) {
  const filePath = path.join(publicDir, relativePath);
  if (!existsSync(filePath)) return text(response, 404, 'Not found');
  response.writeHead(200, { 'Content-Type': contentType });
  response.end(readFileSync(filePath));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

export function buildApp() {
  const db = openDb();
  initSchema(db);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const clusterMatch = url.pathname.match(/^\/api\/clusters\/([^/]+)$/);
    const recomputeMatch = url.pathname.match(/^\/api\/clusters\/([^/]+)\/recompute$/);
    const assignOwnerMatch = url.pathname.match(/^\/api\/clusters\/([^/]+)\/assign-owner$/);
    const generateCasesMatch = url.pathname.match(/^\/api\/clusters\/([^/]+)\/generate-cases$/);
    const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)$/);
    const caseReviewMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/review$/);
    const replayMatch = url.pathname.match(/^\/api\/replays\/([^/]+)$/);
    const exportMatch = url.pathname.match(/^\/api\/exports\/([^/]+)$/);
    const exportContentMatch = url.pathname.match(/^\/api\/exports\/([^/]+)\/content$/);

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true, service: 'traceeval' });
      if (request.method === 'GET' && url.pathname === '/api/dashboard') return json(response, 200, getDashboardSnapshot(db));
      if (request.method === 'GET' && url.pathname === '/api/sample-db') return json(response, 200, getSampleRows(db));
      if (request.method === 'GET' && url.pathname === '/api/promptfoo-export') return text(response, 200, getPromptfooExport(db), 'text/yaml; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/api/clusters') return json(response, 200, { items: listClusters(db) });
      if (request.method === 'GET' && url.pathname === '/api/cases') return json(response, 200, { items: listCases(db) });
      if (request.method === 'GET' && url.pathname === '/api/release-versions') return json(response, 200, { items: listReleaseVersions(db) });
      if (request.method === 'GET' && url.pathname === '/api/replays') return json(response, 200, { items: listReplayRuns(db) });
      if (request.method === 'GET' && url.pathname === '/api/exports') return json(response, 200, { items: listExportBatches(db) });
      if (request.method === 'GET' && clusterMatch) return json(response, 200, getClusterDetails(db, clusterMatch[1]));
      if (request.method === 'GET' && caseMatch) return json(response, 200, getCaseDetails(db, caseMatch[1]));
      if (request.method === 'GET' && replayMatch) return json(response, 200, getReplayDetails(db, replayMatch[1]));
      if (request.method === 'GET' && exportMatch) return json(response, 200, getExportBatch(db, exportMatch[1]));
      if (request.method === 'GET' && exportContentMatch) {
        const item = getExportBatch(db, exportContentMatch[1]);
        return text(response, 200, item.exportBatch.content, 'text/yaml; charset=utf-8');
      }

      if (request.method === 'POST' && recomputeMatch) {
        const payload = await readJsonBody(request);
        return json(response, 202, recomputeCluster(db, recomputeMatch[1], payload.strategy || 'rules-v1', payload.requestedBy || 'triage-bot'));
      }
      if (request.method === 'POST' && assignOwnerMatch) {
        const payload = await readJsonBody(request);
        if (!payload.owner) return json(response, 400, { error: 'Body must include owner' });
        return json(response, 200, assignClusterOwner(db, assignOwnerMatch[1], payload.owner, payload.triageNote || ''));
      }
      if (request.method === 'POST' && generateCasesMatch) {
        const payload = await readJsonBody(request);
        return json(response, 202, generateCasesFromCluster(db, generateCasesMatch[1], payload.generator || 'default-generator', payload.reviewerRequired !== false));
      }
      if (request.method === 'POST' && caseReviewMatch) {
        const payload = await readJsonBody(request);
        if (!payload.decision || !payload.reviewer) return json(response, 400, { error: 'Body must include decision and reviewer' });
        return json(response, 200, reviewCase(db, caseReviewMatch[1], payload.decision, payload.reviewer, payload.notes || ''));
      }
      if (request.method === 'PATCH' && caseMatch) {
        const payload = await readJsonBody(request);
        return json(response, 200, updateCase(db, caseMatch[1], payload));
      }
      if (request.method === 'POST' && url.pathname === '/api/replays') {
        const payload = await readJsonBody(request);
        if (!payload.baselineVersionId || !payload.candidateVersionId) return json(response, 400, { error: 'Body must include baselineVersionId and candidateVersionId' });
        return json(response, 202, createReplayRun(db, payload));
      }
      if (request.method === 'POST' && url.pathname === '/api/exports/promptfoo') {
        const payload = await readJsonBody(request);
        return json(response, 202, createExportBatch(db, payload));
      }
      if (request.method === 'POST' && url.pathname === '/api/ingest/source-events') {
        const payload = await readJsonBody(request);
        if (!payload.source || !Array.isArray(payload.events)) return json(response, 400, { error: 'Body must include source and events[]' });
        return json(response, 202, ingestSourceEvents(db, payload));
      }

      if (request.method === 'GET' && url.pathname === '/app.js') return serveFile(response, 'app.js', 'application/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/styles.css') return serveFile(response, 'styles.css', 'text/css; charset=utf-8');
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(response, 'index.html', 'text/html; charset=utf-8');
      return text(response, 404, 'Not found');
    } catch (error) {
      return json(response, 500, { error: error.message });
    }
  });

  server.on('close', () => db.close());
  return server;
}

export function startServer({ port = 3000 } = {}) {
  const server = buildApp();
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT || '3000');
  const server = await startServer({ port });
  console.log(`TraceEval listening on http://localhost:${server.address().port}`);
}
