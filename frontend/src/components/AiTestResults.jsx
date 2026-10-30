import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Globe,
  Camera,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Lock,
  ShieldAlert,
  SkipForward,
  HelpCircle,
} from 'lucide-react';
import {
  resolveStatusBanner,
  resolvePlannerAttribution,
  resolveFailureDetails,
  resolveStepDetails,
} from '../utils/aiTestResultsPresenter.js';

/**
 * AiTestResults
 *
 * Renders the complete AI test report:
 * - Overall status banner (PASSED / FAILED / PARTIAL / BLOCKED / UNSUPPORTED / ERROR)
 * - AI Planner metadata & clear deterministic fallback / mock indicator
 * - Blocked / Prerequisite requirements banner
 * - Structured failure details (description, hypothesis, expected vs actual)
 * - Metrics summary cards and live page diagnostics
 * - Step-by-step execution timeline with expected vs actual outcomes
 * - Clear status badges: PASS, FAIL, BLOCKED, ERROR, SKIPPED
 * - Evidence screenshots and enlarged modal preview
 */
export function AiTestResults({ report }) {
  const [expandedScreenshots, setExpandedScreenshots] = useState({});
  const [modalImage, setModalImage] = useState(null);

  if (!report || typeof report !== 'object') return null;

  const {
    isPassed,
    isBlocked,
    isPartial,
    isUnsupported,
    isError,
    isFailed,
    hasFailedOrError,
    statusTitle,
    statusSubtitle,
    durationSec,
  } = resolveStatusBanner(report);

  const {
    isLiveAi,
    plannerTitle,
    plannerBadge,
    notice: plannerNotice,
  } = resolvePlannerAttribution(report.planner);

  const failureDetails = resolveFailureDetails(report.failure, isError);

  const toggleScreenshot = (stepIndex) => {
    setExpandedScreenshots((prev) => ({
      ...prev,
      [stepIndex]: !prev[stepIndex],
    }));
  };

  return (
    <section className="functional-results-section" aria-labelledby="ai-results-heading">
      {/* 1. Overall Status Banner */}
      <div
        className={`test-status-banner ${
          isPassed
            ? 'status-banner-passed'
            : isBlocked
            ? 'status-banner-blocked'
            : isPartial
            ? 'status-banner-partial'
            : isUnsupported
            ? 'status-banner-blocked'
            : 'status-banner-failed'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="banner-left">
          <div className="status-icon-wrapper">
            {isPassed && <CheckCircle2 size={38} className="icon-passed" aria-hidden="true" />}
            {isFailed && <XCircle size={38} className="icon-failed" aria-hidden="true" />}
            {isError && <AlertTriangle size={38} className="icon-failed" aria-hidden="true" />}
            {isPartial && <AlertTriangle size={38} className="icon-partial" aria-hidden="true" />}
            {isBlocked && <ShieldAlert size={38} className="icon-blocked" aria-hidden="true" />}
            {isUnsupported && <HelpCircle size={38} className="icon-blocked" aria-hidden="true" />}
          </div>
          <div className="status-text-content">
            <span className="status-label-eyebrow">AI QA Test Outcome</span>
            <h2 id="ai-results-heading" className="status-title">
              {statusTitle}
            </h2>
            <p className="status-subtitle">{statusSubtitle}</p>
          </div>
        </div>

        <div className="banner-meta">
          <span className="banner-duration">
            <Clock size={16} aria-hidden="true" />
            <span>{durationSec}s duration</span>
          </span>
          <span className="banner-url" title={report.finalUrl || report.startUrl}>
            <Globe size={16} aria-hidden="true" />
            <span>{report.finalUrl || report.startUrl}</span>
          </span>
        </div>
      </div>

      {/* 2. AI Planner Attribution Card */}
      {report.planner && (
        <div
          className={`planner-attribution-card ${
            isLiveAi ? 'planner-ai-live' : 'planner-fallback-active'
          }`}
        >
          <div className="planner-card-header">
            <Cpu size={18} aria-hidden="true" />
            <strong>{plannerTitle}</strong>
            <span className="planner-badge">{plannerBadge}</span>
          </div>
          {plannerNotice && <p className="planner-notice-text">{plannerNotice}</p>}
        </div>
      )}

      {/* 3. Blocked Policy / Prerequisite / Unsupported Alert */}
      {(isBlocked || isUnsupported) && (
        <div className="failure-alert-box blocked-alert-box" role="alert">
          <div className="failure-box-header">
            <Lock size={20} className="icon-alert" aria-hidden="true" />
            <h3>{isUnsupported ? 'Flow Not Supported by Fallback Engine' : 'Test Execution Blocked'}</h3>
          </div>
          <p className="failure-message">{report.blockedReason}</p>
          {Array.isArray(report.missingCredentials) && report.missingCredentials.length > 0 && (
            <p className="missing-creds-tip">
              Required prerequisites: <strong>{report.missingCredentials.join(', ')}</strong>.
              Provide test credentials in the form above to enable authenticated testing.
            </p>
          )}
        </div>
      )}

      {/* 4. Failure Detail Box */}
      {hasFailedOrError && failureDetails && (
        <div className="failure-alert-box" role="alert">
          <div className="failure-box-header">
            <AlertTriangle size={20} className="icon-alert" aria-hidden="true" />
            <h3>{failureDetails.failureHeading}</h3>
          </div>

          {failureDetails.primaryMessage && (
            <p className="failure-message">{failureDetails.primaryMessage}</p>
          )}

          {failureDetails.hypothesis && (
            <div className="failure-hypothesis">
              <strong>Hypothesis:</strong> {failureDetails.hypothesis}
            </div>
          )}

          {(failureDetails.hasExpected || failureDetails.hasActual) && (
            <div
              className="step-outcomes-grid"
              style={{
                gridTemplateColumns:
                  failureDetails.hasExpected && failureDetails.hasActual ? '1fr 1fr' : '1fr',
              }}
            >
              {failureDetails.hasExpected && (
                <div className="outcome-block expected-block">
                  <span className="outcome-label">Expected:</span>
                  <p className="outcome-text">{failureDetails.expected}</p>
                </div>
              )}
              {failureDetails.hasActual && (
                <div className="outcome-block actual-block actual-failed">
                  <span className="outcome-label">Actual:</span>
                  <p className="outcome-text">{failureDetails.actual}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. Metrics & Page Diagnostics Grid */}
      <div className="test-metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Total Steps</span>
          <strong className="metric-value">{report.totalSteps || 0}</strong>
          <span className="metric-caption">{report.executedSteps || 0} executed</span>
        </div>

        <div className="metric-card metric-card-passed">
          <span className="metric-label">Passed Steps</span>
          <strong className="metric-value metric-value-passed">{report.passedSteps || 0}</strong>
          <span className="metric-caption">Verified assertions</span>
        </div>

        <div className="metric-card metric-card-failed">
          <span className="metric-label">Failed Steps</span>
          <strong className="metric-value metric-value-failed">
            {(report.failedSteps || 0) + (report.errorSteps || 0)}
          </strong>
          <span className="metric-caption">
            {(report.failedSteps || 0) + (report.errorSteps || 0) === 0 ? 'No failures' : 'Caused test halt'}
          </span>
        </div>

        {((report.blockedSteps || 0) > 0 || (report.skippedSteps || 0) > 0) && (
          <div className="metric-card">
            <span className="metric-label">Blocked / Skipped</span>
            <strong className="metric-value">
              {(report.blockedSteps || 0) + (report.skippedSteps || 0)}
            </strong>
            <span className="metric-caption">
              {report.blockedSteps || 0} blocked, {report.skippedSteps || 0} skipped
            </span>
          </div>
        )}

        <div className="metric-card">
          <span className="metric-label">Page Status</span>
          <strong className="metric-value">
            {report.pageDiagnostics?.httpStatus || (isBlocked || isError || isUnsupported ? 'N/A' : 200)}
          </strong>
          <span className="metric-caption">
            {report.pageDiagnostics?.loadTimeMs !== undefined && report.pageDiagnostics?.loadTimeMs !== null
              ? `${report.pageDiagnostics.loadTimeMs}ms load time`
              : (report.pageDiagnostics?.httpStatus ? 'HTTP Response' : 'N/A')}
          </span>
        </div>
      </div>

      {/* 6. Step-by-Step Execution Timeline */}
      {Array.isArray(report.steps) && report.steps.length > 0 && (
        <div className="steps-results-container">
          <div className="steps-results-header">
            <h3>Verified Browser Interactions ({report.steps.length})</h3>
            <span className="steps-count-badge">
              {report.executedSteps || 0} of {report.totalSteps || 0} Steps Executed
            </span>
          </div>

          <div className="step-cards-list">
            {report.steps.map((step) => {
              const {
                normStatus,
                isPass,
                isFail,
                isBlock,
                isErr,
                isSkip,
                cardClass,
                pillClass,
                actualBlockClass,
                hasExpected,
                hasActual,
                expected,
                actual,
              } = resolveStepDetails(step);

              const hasScreenshot = Boolean(step.screenshot);
              const isExpanded = Boolean(expandedScreenshots[step.stepIndex]);

              return (
                <article
                  key={step.id || step.stepIndex}
                  className={`step-result-card ${cardClass}`}
                >
                  <div className="step-result-top">
                    <div className="step-info-group">
                      <span className="step-index-pill">Step {step.stepIndex}</span>
                      <span className={`step-action-badge action-${step.action}`}>
                        {step.action}
                      </span>
                      <h4 className="step-card-title">{step.description}</h4>
                    </div>

                    <div className="step-status-group">
                      <span className="step-duration-badge">
                        <Clock size={13} aria-hidden="true" />
                        <span>{step.durationMs || 0}ms</span>
                      </span>
                      <span className={`step-status-pill ${pillClass}`}>
                        {isPass && (
                          <>
                            <CheckCircle2 size={14} aria-hidden="true" />
                            <span>PASSED</span>
                          </>
                        )}
                        {isFail && (
                          <>
                            <XCircle size={14} aria-hidden="true" />
                            <span>FAILED</span>
                          </>
                        )}
                        {isBlock && (
                          <>
                            <ShieldAlert size={14} aria-hidden="true" />
                            <span>BLOCKED</span>
                          </>
                        )}
                        {isErr && (
                          <>
                            <AlertTriangle size={14} aria-hidden="true" />
                            <span>ERROR</span>
                          </>
                        )}
                        {isSkip && (
                          <>
                            <SkipForward size={14} aria-hidden="true" />
                            <span>SKIPPED</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {(hasExpected || hasActual) && (
                    <div
                      className="step-outcomes-grid"
                      style={{
                        gridTemplateColumns: hasExpected && hasActual ? '1fr 1fr' : '1fr',
                      }}
                    >
                      {hasExpected && (
                        <div className="outcome-block expected-block">
                          <span className="outcome-label">Expected:</span>
                          <p className="outcome-text">{expected}</p>
                        </div>
                      )}

                      {hasActual && (
                        <div className={`outcome-block actual-block ${actualBlockClass}`}>
                          <span className="outcome-label">Actual:</span>
                          <p className="outcome-text">{actual}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {hasScreenshot && (
                    <div className="step-screenshot-section">
                      <button
                        type="button"
                        className="screenshot-toggle-btn"
                        onClick={() => toggleScreenshot(step.stepIndex)}
                        aria-expanded={isExpanded}
                      >
                        <Camera size={15} aria-hidden="true" />
                        <span>
                          {isExpanded ? 'Hide Evidence Screenshot' : 'View Evidence Screenshot'}
                        </span>
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>

                      {isExpanded && (
                        <div className="screenshot-preview-box">
                          <img
                            src={step.screenshot}
                            alt={`Step ${step.stepIndex} browser capture`}
                            className="screenshot-img"
                            onClick={() => setModalImage(step.screenshot)}
                          />
                          <button
                            type="button"
                            className="view-full-btn"
                            onClick={() => setModalImage(step.screenshot)}
                            title="Expand screenshot"
                          >
                            <Maximize2 size={14} aria-hidden="true" />
                            <span>Enlarge</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Lightbox / Modal for enlarged screenshot */}
      {modalImage && (
        <div
          className="screenshot-modal-backdrop"
          onClick={() => setModalImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged screenshot preview"
        >
          <div className="screenshot-modal-content" onClick={(e) => e.stopPropagation()}>
            <img src={modalImage} alt="Enlarged capture" className="modal-screenshot-img" />
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setModalImage(null)}
              aria-label="Close modal"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
