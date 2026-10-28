import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
} from 'lucide-react';

const CHECK_LABELS = {
  pageLoad: 'Page Load Health',
  javascriptErrors: 'JavaScript Runtime Errors',
  consoleErrors: 'Browser Console Errors',
  networkRequests: 'Network Requests & Assets',
  pageMetadata: 'Page SEO Metadata',
  brokenImages: 'Broken Images Detection',
  brokenLinks: 'Broken Same-Origin Links',
  accessibility: 'Baseline Accessibility',
};

function renderCheckStatusBadge(check) {
  const status = check?.status || 'skipped';

  switch (status) {
    case 'passed':
      return (
        <span className="check-badge badge-passed">
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>Passed</span>
        </span>
      );
    case 'issues_found':
      return (
        <span className="check-badge badge-issues">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            {check.issuesCount ?? check.brokenCount ?? 1}{' '}
            {(check.issuesCount ?? check.brokenCount) === 1 ? 'Issue' : 'Issues'}
          </span>
        </span>
      );
    case 'failed':
      return (
        <span className="check-badge badge-failed">
          <XCircle size={14} aria-hidden="true" />
          <span>Check Failed</span>
        </span>
      );
    case 'skipped':
    default:
      return (
        <span className="check-badge badge-skipped">
          <HelpCircle size={14} aria-hidden="true" />
          <span>Skipped</span>
        </span>
      );
  }
}

export function ChecksSummary({ summary, checks }) {
  if (!summary) return null;

  const severityCounts = summary.bySeverity || {};

  return (
    <section className="summary-section" aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="section-title">
        Quality Checks Summary
      </h2>

      {/* Severity Metrics Bar */}
      <div className="severity-bar-card">
        <div className="total-findings-box">
          <div className="total-count">{summary.totalFindings ?? 0}</div>
          <div className="total-label">Total Findings</div>
        </div>

        <div className="severity-breakdown-grid">
          <div className="severity-pill pill-critical">
            <span className="pill-name">Critical</span>
            <span className="pill-count">{severityCounts.critical || 0}</span>
          </div>
          <div className="severity-pill pill-high">
            <span className="pill-name">High</span>
            <span className="pill-count">{severityCounts.high || 0}</span>
          </div>
          <div className="severity-pill pill-medium">
            <span className="pill-name">Medium</span>
            <span className="pill-count">{severityCounts.medium || 0}</span>
          </div>
          <div className="severity-pill pill-low">
            <span className="pill-name">Low</span>
            <span className="pill-count">{severityCounts.low || 0}</span>
          </div>
          <div className="severity-pill pill-info">
            <span className="pill-name">Info</span>
            <span className="pill-count">{severityCounts.info || 0}</span>
          </div>
        </div>
      </div>

      {/* Checks Grid */}
      {checks && Object.keys(checks).length > 0 && (
        <div className="checks-grid">
          {Object.entries(checks).map(([checkKey, checkData]) => (
            <div key={checkKey} className="check-card">
              <div className="check-info">
                <span className="check-name">{CHECK_LABELS[checkKey] || checkKey}</span>
                {checkData.totalChecked !== undefined && (
                  <span className="check-meta">Checked: {checkData.totalChecked}</span>
                )}
              </div>
              <div className="check-status">{renderCheckStatusBadge(checkData)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
