function formatTimestamp(value) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function metricCard(label, value, tone = 'neutral') {
  return `
    <article class="metric tone-${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function badge(label, tone) {
  return `<span class="badge tone-${tone}">${label}</span>`;
}

function severityTone(level) {
  if (level === 'critical') return 'danger';
  if (level === 'high') return 'warn';
  if (level === 'medium') return 'neutral';
  return 'muted';
}

function statusTone(status) {
  if (status === 'healthy' || status === 'published' || status === 'improved') return 'good';
  if (status === 'lagging' || status === 'triage' || status === 'generating_eval' || status === 'draft' || status === 'watch') return 'warn';
  if (status === 'critical' || status === 'regressed' || status === 'failed') return 'danger';
  return 'neutral';
}

async function loadDashboard() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();

  document.getElementById('generatedAt').textContent = formatTimestamp(data.generatedAt);
  document.getElementById('exportPreview').textContent = data.promptfooExport;

  const stats = [
    metricCard('Traces ingested', data.pipelineSummary.total_traces, 'neutral'),
    metricCard('Active clusters', data.pipelineSummary.active_clusters, 'danger'),
    metricCard('Export-ready cases', data.pipelineSummary.export_ready_cases, 'good'),
    metricCard('Coverage', `${data.pipelineSummary.case_export_coverage}%`, 'warn'),
    metricCard('Healthy sources', data.pipelineSummary.healthy_sources, 'good'),
    metricCard('Regressions found', data.pipelineSummary.regressions_detected, 'danger'),
    metricCard('Improvements kept', data.pipelineSummary.improvements_captured, 'good')
  ];
  document.getElementById('stats').innerHTML = stats.join('');

  document.getElementById('sourceCards').innerHTML = data.sources.map((source) => `
    <article class="info-card">
      <div class="card-head">
        <h3>${source.name}</h3>
        ${badge(source.status, statusTone(source.status))}
      </div>
      <p>${source.kind}</p>
      <p class="muted">Owner: ${source.owner}</p>
      <div class="info-stats">
        <strong>${source.records_24h}</strong><span>records / 24h</span>
        <strong>${source.freshness_minutes}m</strong><span>freshness lag</span>
      </div>
      <p class="muted">Last ingest ${formatTimestamp(source.last_ingest_at)}</p>
    </article>
  `).join('');

  document.getElementById('clusterCards').innerHTML = data.clusters.map((cluster) => `
    <article class="cluster-card">
      <div class="card-head">
        <h3>${cluster.title}</h3>
        ${badge(cluster.severity, severityTone(cluster.severity))}
      </div>
      <p>${badge(cluster.status, statusTone(cluster.status))} ${badge(`${Math.round(cluster.confidence_score * 100)}% confidence`, 'neutral')}</p>
      <p class="muted">${cluster.root_cause_hypothesis}</p>
      <div class="info-stats compact">
        <strong>${cluster.trace_count}</strong><span>source traces</span>
        <strong>${cluster.linked_traces}</strong><span>linked rows</span>
      </div>
      <p class="muted">Owner: ${cluster.owner} · Updated ${formatTimestamp(cluster.last_seen_at)}</p>
    </article>
  `).join('');

  document.getElementById('evalCasesTable').innerHTML = data.evalCases.map((item) => `
    <tr>
      <td>
        <strong>${item.name}</strong>
        <div class="muted">${item.id}</div>
      </td>
      <td>
        ${item.cluster_title}
        <div class="muted">${badge(item.cluster_severity, severityTone(item.cluster_severity))}</div>
      </td>
      <td>${badge(item.priority, statusTone(item.priority === 'p0' ? 'regressed' : item.priority === 'p1' ? 'watch' : 'healthy'))}</td>
      <td>${item.assertion_type}<div class="muted">${item.generated_from}</div></td>
      <td>${item.promptfoo_ready ? badge('exportable', 'good') : badge('needs review', 'warn')}</td>
      <td>${item.owner}</td>
    </tr>
  `).join('');

  document.getElementById('replayList').innerHTML = data.replayRuns.map((run) => `
    <article class="stack-card">
      <div class="card-head">
        <h3>${run.eval_case_name}</h3>
        ${badge(run.verdict, statusTone(run.verdict))}
      </div>
      <p>${run.baseline_version} -> ${run.candidate_version}</p>
      <p class="muted">${run.regressions_found} regressions · ${run.improvements_found} improvements</p>
      <p class="muted">Executed ${formatTimestamp(run.executed_at)}</p>
    </article>
  `).join('');

  document.getElementById('exportList').innerHTML = data.exports.map((batch) => `
    <article class="stack-card">
      <div class="card-head">
        <h3>${batch.target_path}</h3>
        ${badge(batch.status, statusTone(batch.status))}
      </div>
      <p>${batch.target_system}</p>
      <p class="muted">${batch.case_count} cases · ${formatTimestamp(batch.created_at)}</p>
    </article>
  `).join('');
}

loadDashboard().catch((error) => {
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Dashboard failed to load</h1><p>${error.message}</p></section></main>`;
});
