function formatTimestamp(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function metricCard(label, value, tone = 'neutral') { return `<article class="metric tone-${tone}"><span>${label}</span><strong>${value}</strong></article>`; }
function badge(label, tone) { return `<span class="badge tone-${tone}">${label}</span>`; }
function severityTone(level) { if (level === 'critical') return 'danger'; if (level === 'high') return 'warn'; if (level === 'medium') return 'neutral'; return 'muted'; }
function statusTone(status) {
  if (['healthy', 'published', 'improved', 'completed', 'approved', 'exported'].includes(status)) return 'good';
  if (['lagging', 'triage', 'generating_eval', 'draft', 'watch', 'reviewing', 'needs_edit', 'proposed', 'unchanged'].includes(status)) return 'warn';
  if (['critical', 'regressed', 'failed', 'rejected', 'duplicate'].includes(status)) return 'danger';
  return 'neutral';
}

async function loadDashboard() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();
  document.getElementById('generatedAt').textContent = formatTimestamp(data.generatedAt);
  document.getElementById('exportPreview').textContent = data.promptfooExport;

  document.getElementById('stats').innerHTML = [
    metricCard('Replay runs', data.pipelineSummary.replay_runs, 'neutral'),
    metricCard('Improved results', data.pipelineSummary.improved_results, 'good'),
    metricCard('Regressed results', data.pipelineSummary.regressed_results, 'danger'),
    metricCard('Cases waiting review', data.pipelineSummary.cases_waiting_review, 'warn'),
    metricCard('Export-ready cases', data.pipelineSummary.export_ready_cases, 'good'),
    metricCard('Coverage', `${data.pipelineSummary.case_export_coverage}%`, 'neutral'),
    metricCard('Root-cause labels', data.pipelineSummary.root_cause_labels, 'good'),
    metricCard('Accepted ingests', data.pipelineSummary.accepted_ingests, 'neutral')
  ].join('');

  document.getElementById('releaseList').innerHTML = data.releaseVersions.map((item) => `<article class="stack-card"><div class="card-head"><h3>${item.id}</h3>${badge(item.environment, 'neutral')}</div><p>${item.prompt_version} · ${item.model_name}</p><p class="muted">${item.retriever_version} · ${item.tool_manifest_version} · ${item.policy_pack_version}</p><p class="muted">${formatTimestamp(item.created_at)}</p></article>`).join('');
  document.getElementById('replayResultList').innerHTML = data.recentReplayResults.map((item) => `<article class="stack-card"><div class="card-head"><h3>${item.case_name}</h3>${badge(item.verdict, statusTone(item.verdict))}</div><p>${item.attribution_label}</p><p class="muted">baseline ${item.baseline_score.toFixed(2)} -> candidate ${item.candidate_score.toFixed(2)} (${item.delta > 0 ? '+' : ''}${item.delta.toFixed(2)})</p></article>`).join('');
  document.getElementById('replayList').innerHTML = data.replayRuns.map((run) => `<article class="stack-card"><div class="card-head"><h3>${run.id}</h3>${badge(run.status, statusTone(run.status))}</div><p>${run.baseline_prompt_version} -> ${run.candidate_prompt_version}</p><p class="muted">${run.result_count} results · ${run.improvements_found || 0} improved · ${run.regressions_found || 0} regressed</p><p class="muted">${formatTimestamp(run.created_at)}</p></article>`).join('');
  document.getElementById('reviewList').innerHTML = data.recentReviews.map((review) => `<article class="stack-card"><div class="card-head"><h3>${review.case_name}</h3>${badge(review.decision, statusTone(review.decision))}</div><p>${review.reviewer}</p><p class="muted">${review.notes || 'No notes'}</p><p class="muted">${formatTimestamp(review.created_at)}</p></article>`).join('') || '<p class="muted">No reviews yet.</p>';
  document.getElementById('clusterCards').innerHTML = data.clusters.map((cluster) => `<article class="cluster-card"><div class="card-head"><h3>${cluster.title}</h3>${badge(cluster.severity, severityTone(cluster.severity))}</div><p>${badge(cluster.status, statusTone(cluster.status))} ${badge(cluster.root_cause_label, 'neutral')}</p><p class="muted">${cluster.root_cause_hypothesis}</p><div class="info-stats compact"><strong>${cluster.trace_count}</strong><span>source traces</span><strong>${cluster.recompute_count}</strong><span>recomputes</span></div><p class="muted">Owner: ${cluster.owner}</p></article>`).join('');
  document.getElementById('exportList').innerHTML = data.exports.map((item) => `<article class="stack-card"><div class="card-head"><h3>${item.target_path}</h3>${badge(item.status, statusTone(item.status))}</div><p>${item.case_count} selected cases</p><p class="muted">${item.pr_title || 'No PR title'}</p><p class="muted">${formatTimestamp(item.created_at)}</p></article>`).join('');
  document.getElementById('sourceCards').innerHTML = data.sources.map((source) => `<article class="info-card"><div class="card-head"><h3>${source.name}</h3>${badge(source.status, statusTone(source.status))}</div><p>${source.kind}</p><p class="muted">Owner: ${source.owner}</p><div class="info-stats"><strong>${source.records_24h}</strong><span>records / 24h</span><strong>${source.freshness_minutes}m</strong><span>freshness lag</span></div><p class="muted">Last ingest ${formatTimestamp(source.last_ingest_at)}</p></article>`).join('');
  document.getElementById('evalCasesTable').innerHTML = data.evalCases.map((item) => `<tr><td><strong>${item.name}</strong><div class="muted">${item.id}</div></td><td>${item.cluster_title}<div class="muted">${badge(item.cluster_severity, severityTone(item.cluster_severity))}</div></td><td>${badge(item.status, statusTone(item.status))}<div class="muted">${item.review_count} reviews</div></td><td>${badge(item.priority, statusTone(item.priority === 'p0' ? 'regressed' : item.priority === 'p1' ? 'watch' : 'healthy'))}</td><td>${item.assertion_type}<div class="muted">${item.generated_from}</div></td><td>${item.owner}</td></tr>`).join('');
}

loadDashboard().catch((error) => {
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Dashboard failed to load</h1><p>${error.message}</p></section></main>`;
});
