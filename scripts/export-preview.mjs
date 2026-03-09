import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDashboardSnapshot, openDb, initSchema } from '../src/db.mjs';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const outputPath = path.join(projectRoot, 'data', 'dashboard-preview.svg');
const db = openDb();
initSchema(db);
const data = getDashboardSnapshot(db);

const metrics = [
  ['Traces', data.pipelineSummary.total_traces],
  ['Clusters', data.pipelineSummary.active_clusters],
  ['Ready cases', data.pipelineSummary.export_ready_cases],
  ['Coverage', `${data.pipelineSummary.case_export_coverage}%`],
  ['Regressions', data.pipelineSummary.regressions_detected],
  ['Improvements', data.pipelineSummary.improvements_captured]
];

const metricBlocks = metrics.map((item, index) => {
  const x = 40 + index * 190;
  return `
    <g transform="translate(${x}, 120)">
      <rect width="166" height="92" rx="18" fill="#fff8ee" stroke="rgba(29,35,27,0.12)" />
      <text x="18" y="34" fill="#6f756c" font-size="16">${item[0]}</text>
      <text x="18" y="70" fill="#1d231b" font-size="30" font-weight="700">${item[1]}</text>
    </g>`;
}).join('');

const clusterRows = data.clusters.slice(0, 3).map((cluster, index) => {
  const y = 350 + index * 86;
  return `
    <text x="54" y="${y}" fill="#1d231b" font-size="18" font-weight="700">${cluster.title}</text>
    <text x="54" y="${y + 26}" fill="#6f756c" font-size="14">${cluster.root_cause_hypothesis}</text>
    <text x="54" y="${y + 50}" fill="#6f756c" font-size="14">${cluster.trace_count} traces · ${Math.round(cluster.confidence_score * 100)}% confidence · ${cluster.status}</text>
  `;
}).join('');

const evalRows = data.evalCases.slice(0, 4).map((item, index) => {
  const y = 650 + index * 42;
  return `
    <text x="54" y="${y}" fill="#1d231b" font-size="16">${item.name}</text>
    <text x="540" y="${y}" fill="#6f756c" font-size="16">${item.assertion_type}</text>
    <text x="760" y="${y}" fill="#6f756c" font-size="16">${item.promptfoo_ready ? 'exportable' : 'needs review'}</text>
  `;
}).join('');

const replayRows = data.replayRuns.slice(0, 3).map((run, index) => {
  const y = 650 + index * 58;
  return `
    <text x="930" y="${y}" fill="#1d231b" font-size="16">${run.eval_case_name}</text>
    <text x="930" y="${y + 22}" fill="#6f756c" font-size="14">${run.verdict} · ${run.regressions_found} regressions · ${run.improvements_found} improvements</text>
  `;
}).join('');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1440" height="920" viewBox="0 0 1440 920" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1440" height="920" fill="#f4f0e8" />
  <rect x="24" y="24" width="1392" height="872" rx="28" fill="#f6f1e7" stroke="rgba(29,35,27,0.12)" />
  <text x="40" y="72" fill="#b67718" font-size="18" letter-spacing="2">TRACE-TO-EVAL MONITOR</text>
  <text x="40" y="104" fill="#1d231b" font-size="44" font-weight="700">Find failures in production, then export them into promptfoo.</text>
  ${metricBlocks}

  <rect x="40" y="270" width="1360" height="300" rx="24" fill="#fff8ee" stroke="rgba(29,35,27,0.12)" />
  <text x="54" y="306" fill="#1d231b" font-size="24" font-weight="700">Failure clusters</text>
  ${clusterRows}

  <rect x="40" y="610" width="820" height="250" rx="24" fill="#fff8ee" stroke="rgba(29,35,27,0.12)" />
  <text x="54" y="646" fill="#1d231b" font-size="24" font-weight="700">Generated eval cases</text>
  ${evalRows}

  <rect x="900" y="610" width="500" height="250" rx="24" fill="#fff8ee" stroke="rgba(29,35,27,0.12)" />
  <text x="924" y="646" fill="#1d231b" font-size="24" font-weight="700">Replay runs</text>
  ${replayRows}
</svg>`;

writeFileSync(outputPath, svg);
console.log(outputPath);
