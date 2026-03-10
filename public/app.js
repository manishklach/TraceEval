function formatTimestamp(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function metricCard(label, value, tone = 'neutral') { return `<article class="metric tone-${tone}"><span>${label}</span><strong>${value}</strong></article>`; }
function badge(label, tone) { return `<span class="badge tone-${tone}">${label}</span>`; }
function severityTone(level) { if (level === 'critical') return 'danger'; if (level === 'high') return 'warn'; if (level === 'medium') return 'neutral'; return 'muted'; }
function statusTone(status) {
  if (['healthy', 'published', 'improved', 'completed', 'approved', 'exported'].includes(status)) return 'good';
  if (['lagging', 'triage', 'generating_eval', 'draft', 'watch', 'reviewing', 'needs_edit', 'proposed'].includes(status)) return 'warn';
  if (['critical', 'regressed', 'failed', 'rejected', 'duplicate'].includes(status)) return 'danger';
  return 'neutral';
}

async function loadDashboard() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();
  document.getElementById('generatedAt').textContent = formatTimestamp(data.generatedAt);
  document.getElementById('exportPreview').textContent = data.promptfooExport;
  document.getElementById('stats').innerHTML = [
    metricCard('Traces ingested', data.pipelineSummary.total_traces, 'neutral'),
    metricCard('Active clusters', data.pipelineSummary.active_clusters, 'danger'),
    metricCard('Cases waiting review', data.pipelineSummary.cases_waiting_review, 'warn'),
    metricCard('Completed reviews', data.pipelineSummary.completed_reviews, 'good'),
    metricCard('Export-ready cases', data.pipelineSummary.export_ready_cases, 'good'),
    metricCard('Coverage', `${data.pipelineSummary.case_export_coverage}%`, 'neutral'),
    metricCard('Root-cause labels', data.pipelineSummary.root_cause_labels, 'good'),
    metricCard('Recompute runs', data.pipelineSummary.recompute_runs, 'neutral')
  ].join('');
  document.getElementById('sourceCards').innerHTML = data.sources.map((source) => `<article class="info-card"><div class="card-head"><h3>${source.name}</h3>${badge(source.status, statusTone(source.status))}</div><p>${source.kind}</p><p class="muted">Owner: ${source.owner}</p><div class="info-stats"><strong>${source.records_24h}</strong><span>records / 24h</span><strong>${source.freshness_minutes}m</strong><span>freshness lag</span></div><p class="muted">Last ingest ${formatTimestamp(source.last_ingest_at)}</p></article>`).join('');
  document.getElementById('ingestList').innerHTML = data.recentIngests.map((batch) => `<article class="stack-card"><div class="card-head"><h3>${batch.source_name}</h3>${badge(batch.status, statusTone(batch.status))}</div><p>${batch.kind}</p><p class="muted">${batch.accepted_count} accepted · ${batch.deduped_count} deduped</p><p class="muted">Received ${formatTimestamp(batch.received_at)}</p></article>`).join('');
  document.getElementById('clusterActivityList').innerHTML = data.recentClusterActivity.map((run) => `<article class="stack-card"><div class="card-head"><h3>${run.title}</h3>${badge(run.status, statusTone(run.status))}</div><p>${run.strategy}</p><p class="muted">${run.trace_count} traces · owner ${run.owner}</p><p class="muted">${run.note}</p></article>`).join('');
  document.getElementById('reviewList').innerHTML = data.recentReviews.map((review) => `<article class="stack-card"><div class="card-head"><h3>${review.case_name}</h3>${badge(review.decision, statusTone(review.decision))}</div><p>${review.reviewer}</p><p class="muted">${review.notes || 'No notes'}</p><p class="muted">${formatTimestamp(review.created_at)}</p></article>`).join('') || '<p class="muted">No reviews yet.</p>';
  document.getElementById('clusterCards').innerHTML = data.clusters.map((cluster) => `<article class="cluster-card"><div class="card-head"><h3>${cluster.title}</h3>${badge(cluster.severity, severityTone(cluster.severity))}</div><p>${badge(cluster.status, statusTone(cluster.status))} ${badge(cluster.root_cause_label, 'neutral')}</p><p class="muted">${cluster.root_cause_hypothesis}</p><div class="info-stats compact"><strong>${cluster.trace_count}</strong><span>source traces</span><strong>${cluster.recompute_count}</strong><span>recomputes</span></div><p class="muted">Owner: ${cluster.owner} · ${cluster.triage_note || 'No triage note'}</p></article>`).join('');
  document.getElementById('evalCasesTable').innerHTML = data.evalCases.map((item) => `<tr><td><strong>${item.name}</strong><div class="muted">${item.id}</div></td><td>${item.cluster_title}<div class="muted">${badge(item.cluster_severity, severityTone(item.cluster_severity))}</div></td><td>${badge(item.status, statusTone(item.status))}<div class="muted">${item.review_count} reviews</div></td><td>${badge(item.priority, statusTone(item.priority === 'p0' ? 'regressed' : item.priority === 'p1' ? 'watch' : 'healthy'))}</td><td>${item.assertion_type}<div class="muted">${item.generated_from}</div></td><td>${item.owner}</td></tr>`).join('');
  document.getElementById('replayList').innerHTML = data.replayRuns.map((run) => `<article class="stack-card"><div class="card-head"><h3>${run.eval_case_name}</h3>${badge(run.verdict, statusTone(run.verdict))}</div><p>${run.baseline_version} -> ${run.candidate_version}</p><p class="muted">${run.regressions_found} regressions · ${run.improvements_found} improvements</p><p class="muted">Executed ${formatTimestamp(run.executed_at)}</p></article>`).join('');
  document.getElementById('exportList').innerHTML = data.exports.map((batch) => `<article class="stack-card"><div class="card-head"><h3>${batch.target_path}</h3>${badge(batch.status, statusTone(batch.status))}</div><p>${batch.target_system}</p><p class="muted">${batch.case_count} cases · ${formatTimestamp(batch.created_at)}</p></article>`).join('');
}
loadDashboard().catch((error) => { document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Dashboard failed to load</h1><p>${error.message}</p></section></main>`; });
