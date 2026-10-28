import { Globe, ArrowRight, Clock, Hash, CheckCircle2, AlertTriangle } from 'lucide-react';

export function ScanOverview({ data }) {
  if (!data) return null;

  const isRedirected = data.finalUrl && data.finalUrl !== data.url;
  const isHealthyStatus = data.httpStatus >= 200 && data.httpStatus < 400;

  return (
    <section className="overview-section" aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="section-title">
        Website Overview
      </h2>

      <div className="overview-grid">
        {/* Scanned URL Card */}
        <div className="overview-card span-full">
          <div className="card-label">Target Destination</div>
          <div className="url-display-group">
            <div className="url-row">
              <Globe size={16} className="text-muted" aria-hidden="true" />
              <span className="url-value" title={data.url}>
                {data.url}
              </span>
            </div>

            {isRedirected && (
              <div className="redirect-row">
                <ArrowRight size={14} className="redirect-arrow" aria-hidden="true" />
                <span className="redirect-label">Redirected to:</span>
                <span className="final-url-value" title={data.finalUrl}>
                  {data.finalUrl}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Page Title Card */}
        <div className="overview-card span-two">
          <div className="card-label">Page Title</div>
          <div className="card-value title-value">
            {data.title ? data.title : <em className="text-muted">No title specified</em>}
          </div>
        </div>

        {/* HTTP Status Card */}
        <div className="overview-card">
          <div className="card-label">HTTP Status</div>
          <div className="card-value status-badge-row">
            {isHealthyStatus ? (
              <span className="status-badge status-ok">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{data.httpStatus} OK</span>
              </span>
            ) : (
              <span className="status-badge status-error">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{data.httpStatus} Error</span>
              </span>
            )}
          </div>
        </div>

        {/* Load Duration */}
        <div className="overview-card">
          <div className="card-label">Page Load Timing</div>
          <div className="card-value metric-row">
            <Clock size={16} className="text-muted" aria-hidden="true" />
            <span>{data.loadTimeMs ?? 0} ms</span>
          </div>
        </div>

        {/* Total Scan Duration */}
        <div className="overview-card">
          <div className="card-label">Total Scan Time</div>
          <div className="card-value metric-row">
            <Clock size={16} className="text-muted" aria-hidden="true" />
            <span>{data.scanDurationMs ? `${(data.scanDurationMs / 1000).toFixed(2)}s` : '—'}</span>
          </div>
        </div>

        {/* Heading Count */}
        <div className="overview-card">
          <div className="card-label">Headings Found (H1–H6)</div>
          <div className="card-value metric-row">
            <Hash size={16} className="text-muted" aria-hidden="true" />
            <span>{data.headingCount ?? 0}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

