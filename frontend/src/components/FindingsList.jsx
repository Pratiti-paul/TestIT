import {
  AlertOctagon,
  AlertTriangle,
  Info,
  ShieldCheck,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';

const SEVERITY_CONFIG = {
  critical: {
    label: 'CRITICAL',
    className: 'badge-severity-critical',
    Icon: AlertOctagon,
  },
  high: {
    label: 'HIGH',
    className: 'badge-severity-high',
    Icon: AlertOctagon,
  },
  medium: {
    label: 'MEDIUM',
    className: 'badge-severity-medium',
    Icon: AlertTriangle,
  },
  low: {
    label: 'LOW',
    className: 'badge-severity-low',
    Icon: AlertTriangle,
  },
  info: {
    label: 'INFO',
    className: 'badge-severity-info',
    Icon: Info,
  },
};

const CATEGORY_NAMES = {
  'page-load': 'Page Load',
  'javascript-error': 'JavaScript Error',
  'console-error': 'Console Error',
  'failed-request': 'Failed Network Request',
  'broken-link': 'Broken Link',
  'broken-image': 'Broken Image',
  'missing-metadata': 'Page Metadata',
  accessibility: 'Accessibility',
};

function FindingCard({ finding }) {
  const [expanded, setExpanded] = useState(false);

  const severityKey = finding.severity?.toLowerCase() || 'info';
  const config = SEVERITY_CONFIG[severityKey] || SEVERITY_CONFIG.info;
  const { Icon, label, className } = config;

  const hasEvidence =
    finding.evidence &&
    typeof finding.evidence === 'object' &&
    Object.keys(finding.evidence).length > 0;

  return (
    <article className="finding-card" aria-labelledby={`finding-title-${finding.id}`}>
      <div className="finding-header">
        <div className="finding-badges">
          <span className={`severity-badge ${className}`}>
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </span>

          <span className="category-badge">
            {CATEGORY_NAMES[finding.category] || finding.category}
          </span>
        </div>

        <h3 id={`finding-title-${finding.id}`} className="finding-title">
          {finding.title}
        </h3>
      </div>

      <p className="finding-message">{finding.message}</p>

      {finding.url && (
        <div className="finding-url-row">
          <span className="url-label">Affected Target:</span>
          <a
            href={finding.url}
            target="_blank"
            rel="noopener noreferrer"
            className="finding-url-link"
            title={finding.url}
          >
            <span className="url-text">{finding.url}</span>
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      )}

      {hasEvidence && (
        <div className="evidence-container">
          <button
            type="button"
            className="evidence-toggle-btn"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <span>Technical Evidence</span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {expanded && (
            <pre className="evidence-pre">
              <code>{JSON.stringify(finding.evidence, null, 2)}</code>
            </pre>
          )}
        </div>
      )}
    </article>
  );
}

export function FindingsList({ findings }) {
  if (!findings || findings.length === 0) {
    return (
      <section className="findings-section" aria-labelledby="findings-heading">
        <h2 id="findings-heading" className="section-title">
          Detected Findings
        </h2>
        <div className="empty-findings-card">
          <div className="empty-icon" aria-hidden="true">
            <ShieldCheck size={44} />
          </div>
          <h3>No Quality Issues Detected!</h3>
          <p>
            The scanned website passed all quality, link health, metadata, and accessibility checks
            cleanly.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="findings-section" aria-labelledby="findings-heading">
      <div className="findings-header-row">
        <h2 id="findings-heading" className="section-title">
          Detected Findings ({findings.length})
        </h2>
      </div>

      <div className="findings-list">
        {findings.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </div>
    </section>
  );
}

