import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignClusterOwner,
  getClusterDetails,
  getDashboardSnapshot,
  getPromptfooExport,
  getSampleRows,
  ingestSourceEvents,
  initSchema,
  listClusters,
  openDb,
  recomputeCluster
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
  if (!existsSync(filePath)) {
    text(response, 404, 'Not found');
    return;
  }
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
      if (!body) {
        resolve({});
        return;
      }
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

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        json(response, 200, { ok: true, service: 'traceeval' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        json(response, 200, getDashboardSnapshot(db));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/sample-db') {
        json(response, 200, getSampleRows(db));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/promptfoo-export') {
        text(response, 200, getPromptfooExport(db), 'text/yaml; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/clusters') {
        json(response, 200, { items: listClusters(db) });
        return;
      }
      if (request.method === 'GET' && clusterMatch) {
        json(response, 200, getClusterDetails(db, clusterMatch[1]));
        return;
      }
      if (request.method === 'POST' && recomputeMatch) {
        const payload = await readJsonBody(request);
        json(response, 202, recomputeCluster(db, recomputeMatch[1], payload.strategy || 'rules-v1', payload.requestedBy || 'triage-bot'));
        return;
      }
      if (request.method === 'POST' && assignOwnerMatch) {
        const payload = await readJsonBody(request);
        if (!payload.owner) {
          json(response, 400, { error: 'Body must include owner' });
          return;
        }
        json(response, 200, assignClusterOwner(db, assignOwnerMatch[1], payload.owner, payload.triageNote || ''));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/ingest/source-events') {
        const payload = await readJsonBody(request);
        if (!payload.source || !Array.isArray(payload.events)) {
          json(response, 400, { error: 'Body must include source and events[]' });
          return;
        }
        json(response, 202, ingestSourceEvents(db, payload));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/app.js') {
        serveFile(response, 'app.js', 'application/javascript; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/styles.css') {
        serveFile(response, 'styles.css', 'text/css; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        serveFile(response, 'index.html', 'text/html; charset=utf-8');
        return;
      }
      text(response, 404, 'Not found');
    } catch (error) {
      json(response, 500, { error: error.message });
    }
  });

  server.on('close', () => {
    db.close();
  });

  return server;
}

export function startServer({ port = 3000 } = {}) {
  const server = buildApp();
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT || '3000');
  const server = await startServer({ port });
  console.log(`TraceEval listening on http://localhost:${server.address().port}`);
}
