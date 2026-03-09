import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDashboardSnapshot, getPromptfooExport, getSampleRows, initSchema, openDb } from './db.mjs';

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

export function buildApp() {
  const db = openDb();
  initSchema(db);

  return createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname === '/api/health') {
      json(response, 200, { ok: true, service: 'traceeval' });
      return;
    }

    if (url.pathname === '/api/dashboard') {
      json(response, 200, getDashboardSnapshot(db));
      return;
    }

    if (url.pathname === '/api/sample-db') {
      json(response, 200, getSampleRows(db));
      return;
    }

    if (url.pathname === '/api/promptfoo-export') {
      text(response, 200, getPromptfooExport(db), 'text/yaml; charset=utf-8');
      return;
    }

    if (url.pathname === '/app.js') {
      serveFile(response, 'app.js', 'application/javascript; charset=utf-8');
      return;
    }

    if (url.pathname === '/styles.css') {
      serveFile(response, 'styles.css', 'text/css; charset=utf-8');
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      serveFile(response, 'index.html', 'text/html; charset=utf-8');
      return;
    }

    text(response, 404, 'Not found');
  });
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
