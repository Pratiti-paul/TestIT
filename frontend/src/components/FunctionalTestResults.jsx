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
} from 'lucide-react';

/**
 * FunctionalTestResults
 *
 * Renders the full execution report of a multi-step user-flow test:
 * - Overall status banner (PASSED vs FAILED)
 * - Metric summary cards (Total steps, Passed, Failed, Duration)
 * - Failure alert box (if applicable)
 * - Detailed step-by-step timeline cards with expected vs actual outcomes
 * - Inline screenshot view / expander for evidence captures
 *
 * @param {object} props
 * @param {object} props.result - Execution report returned by functional test runner
 */
export function FunctionalTestResults({ result }) {
  const [expandedScreenshots, setExpandedScreenshots] = useState({});
  const [modalImage, setModalImage] = useState(null);

  if (!result) return null;

  const isPassed = result.status === 'passed';
  const durationSec = ((result.durationMs || 0) / 1000).toFixed(2);

  const toggleScreenshot = (stepIndex) => {
    setExpandedScreenshots((prev) => ({
      ...prev,
      [stepIndex]: !prev[stepIndex],
    }));
  };

  return (
    <section className="functional-results-section" aria-labelledby="results-heading">
      {/* 1. Overall Status Banner */}
      <div
        className={`test-status-banner ${isPassed ? 'status-banner-passed' : 'status-banner-failed'}`}
        role="status"
        aria-live="polite"
      >
        <div className="banner-left">
          <div className="status-icon-wrapper">
            {isPassed ? (
              <CheckCircle2 size={36} className="icon-passed" aria-hidden="true" />
            ) : (
              <XCircle size={36} className="icon-failed" aria-hidden="true" />
            )}
          </div>
          <div className="status-text-content">
            <span className="status-label-eyebrow">Functional Flow Status</span>
            <h2 id="results-heading" className="status-title">
              {isPassed ? 'Test Passed Successfully' : 'Test Flow Failed'}
            </h2>
            <p className="status-subtitle">
              {result.testName} &mdash; {result.description || 'Custom multi-step user flow'}
            </p>
          </div>
        </div>

        <div className="banner-meta">
          <span className="banner-duration">
            <Clock size={16} aria-hidden="true" />
            <span>{durationSec}s total duration</span>
          </span>
          <span className="banner-url" title={result.finalUrl || result.startUrl}>
            <Globe size={16} aria-hidden="true" />
            <span>{result.finalUrl || result.startUrl}</span>
          </span>
        </div>
      </div>

      {/* 2. Metrics Summary Grid */}
      <div className="test-metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Total Steps</span>
          <strong className="metric-value">{result.totalSteps || 0}</strong>
          <span className="metric-caption">{result.executedSteps || 0} executed</span>
        </div>

        <div className="metric-card metric-card-passed">
          <span className="metric-label">Passed Steps</span>
          <strong className="metric-value metric-value-passed">{result.passedSteps || 0}</strong>
          <span className="metric-caption">Successful assertions</span>
        </div>

        <div className="metric-card metric-card-failed">
          <span className="metric-label">Failed / Errors</span>
          <strong className="metric-value metric-value-failed">{result.failedSteps || 0}</strong>
          <span className="metric-caption">
            {result.failedSteps === 0 ? 'No issues encountered' : 'Halted execution'}
          </span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Execution Time</span>
          <strong className="metric-value">{result.durationMs || 0} ms</strong>
          <span className="metric-caption">Browser wall time</span>
        </div>
      </div>

      {/* 3. Failure Detail Box (if test failed) */}
      {!isPassed && result.failure && (
        <div className="failure-alert-box" role="alert">
          <div className="failure-box-header">
            <AlertTriangle size={20} className="icon-alert" aria-hidden="true" />
            <h3>
              Failure at Step {result.failure.stepIndex}: {result.failure.action}
            </h3>
          </div>
          <p className="failure-message">{result.failure.message}</p>
        </div>
      )}

      {/* 4. Step-by-Step Execution Timeline */}
      <div className="steps-results-container">
        <div className="steps-results-header">
          <h3>Step-by-Step Execution Timeline</h3>
          <span className="steps-count-badge">
            {result.executedSteps || 0} of {result.totalSteps || 0} Steps
          </span>
        </div>

        <div className="step-cards-list">
          {Array.isArray(result.steps) &&
            result.steps.map((step) => {
              const stepPassed = step.status === 'passed';
              const hasScreenshot = Boolean(step.screenshot);
              const isExpanded = Boolean(expandedScreenshots[step.stepIndex]);

              return (
                <article
                  key={step.id || step.stepIndex}
                  className={`step-result-card ${stepPassed ? 'card-passed' : 'card-failed'}`}
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
                      <span
                        className={`step-status-pill ${
                          stepPassed ? 'pill-passed' : 'pill-failed'
                        }`}
                      >
                        {stepPassed ? (
                          <>
                            <CheckCircle2 size={14} aria-hidden="true" />
                            <span>PASSED</span>
                          </>
                        ) : (
                          <>
                            <XCircle size={14} aria-hidden="true" />
                            <span>{step.status === 'error' ? 'ERROR' : 'FAILED'}</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="step-outcomes-grid">
                    <div className="outcome-block expected-block">
                      <span className="outcome-label">Expected:</span>
                      <p className="outcome-text">{step.expected}</p>
                    </div>

                    <div
                      className={`outcome-block actual-block ${
                        stepPassed ? 'actual-passed' : 'actual-failed'
                      }`}
                    >
                      <span className="outcome-label">Actual:</span>
                      <p className="outcome-text">{step.actual}</p>
                    </div>
                  </div>

                  {hasScreenshot && (
                    <div className="step-screenshot-section">
                      <button
                        type="button"
                        className="screenshot-toggle-btn"
                        onClick={() => toggleScreenshot(step.stepIndex)}
                        aria-expanded={isExpanded}
                      >
                        <Camera size={15} aria-hidden="true" />
                        <span>{isExpanded ? 'Hide Evidence Screenshot' : 'View Evidence Screenshot'}</span>
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

