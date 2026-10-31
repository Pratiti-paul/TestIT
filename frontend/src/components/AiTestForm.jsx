import { useState } from 'react';
import { Sparkles, Loader2, AlertCircle, ShieldCheck, KeyRound, ChevronDown, ChevronUp } from 'lucide-react';
import { validateClientUrl } from '../utils/urlHelpers';

/**
 * AiTestForm
 *
 * Streamlined single-page interface:
 * 1. Website URL input
 * 2. "What should the AI test?" multiline textarea
 * 3. Primary "Run AI Test" button
 * 4. Optional secure credentials drawer and authorization confirmation
 */
export function AiTestForm({ onRunTest, isRunning, apiError }) {
  const [url, setUrl] = useState('');
  const [instructions, setInstructions] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [clientError, setClientError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRunning) return;

    setClientError('');

    const urlCheck = validateClientUrl(url);
    if (!urlCheck.isValid) {
      setClientError(`Invalid URL: ${urlCheck.error}`);
      return;
    }

    if (!instructions || !instructions.trim()) {
      setClientError('Please provide testing instructions describing what the AI should test.');
      return;
    }

    if (!isAuthorized) {
      setClientError('Please confirm that you are authorized to test this target website.');
      return;
    }

    const credentials =
      username.trim() || password.trim()
        ? { username: username.trim(), password: password.trim() }
        : undefined;

    onRunTest({
      url: urlCheck.url,
      instructions: instructions.trim(),
      credentials,
      authorized: true,
    });
  };

  const activeError = clientError || apiError;

  return (
    <section className="scan-form-section" aria-labelledby="ai-test-heading">
      <div className="section-intro">
        <p className="ai-test-description">
          Enter any website URL and describe what to test in plain English. The AI analyzes your
          goals, plans the user journey, interacts with real page controls using Playwright, and
          verifies the actual outcomes.
        </p>
      </div>

      <form className="scan-form" onSubmit={handleSubmit} noValidate>
        {/* 1. Website URL Field */}
        <div className="form-field">
          <label htmlFor="website-url">Website URL</label>
          <input
            id="website-url"
            type="url"
            className="url-input"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isRunning}
            required
          />
        </div>

        {/* 2. What should the AI test? Textarea */}
        <div className="form-field">
          <label htmlFor="ai-instructions">What should the AI test?</label>
          <textarea
            id="ai-instructions"
            className="json-textarea instructions-textarea"
            rows={4}
            placeholder="Describe the test flow in plain English (e.g. search for a product, test login form, add items to cart, verify calculations)..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={isRunning}
            required
          />
        </div>

        {/* Optional Credentials Drawer */}
        <div className="credentials-drawer-wrapper">
          <button
            type="button"
            className="credentials-toggle-btn"
            onClick={() => setShowCredentials(!showCredentials)}
            disabled={isRunning}
            aria-expanded={showCredentials}
          >
            <KeyRound size={15} aria-hidden="true" />
            <span>Test Account Credentials (Optional &mdash; for authenticated flows)</span>
            {showCredentials ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showCredentials && (
            <div className="credentials-fields-grid">
              <div className="form-field">
                <label htmlFor="cred-username">Username or Email</label>
                <input
                  id="cred-username"
                  type="text"
                  className="url-input"
                  placeholder="testuser@example.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isRunning}
                  autoComplete="off"
                />
              </div>

              <div className="form-field">
                <label htmlFor="cred-password">Password</label>
                <input
                  id="cred-password"
                  type="password"
                  className="url-input"
                  placeholder="Test password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isRunning}
                  autoComplete="off"
                />
              </div>
              <p className="credentials-privacy-notice">
                Credentials are used strictly during this active session and are never logged, stored, or exposed in reports.
              </p>
            </div>
          )}
        </div>

        {/* Authorization confirmation */}
        <div className="authorization-row">
          <label className="checkbox-label" htmlFor="auth-confirm">
            <input
              type="checkbox"
              id="auth-confirm"
              checked={isAuthorized}
              onChange={(e) => setIsAuthorized(e.target.checked)}
              disabled={isRunning}
            />
            <ShieldCheck size={16} className="auth-icon" aria-hidden="true" />
            <span>I confirm that I am authorized to test this target website.</span>
          </label>
        </div>

        {/* Active Error Banner */}
        {activeError && (
          <div className="form-error-banner" role="alert" aria-live="polite">
            <AlertCircle size={18} className="error-icon" aria-hidden="true" />
            <span className="error-text">{activeError}</span>
          </div>
        )}

        {/* Running Progress Banner */}
        {isRunning && (
          <div className="scanning-status-banner" role="status" aria-live="polite">
            <Loader2 className="spinner" size={22} aria-hidden="true" />
            <div className="status-text">
              <strong>AI Testing in Progress...</strong>
              <p>
                Synthesizing test plan, launching secure Playwright browser, discovering accessible page
                controls, and verifying expected outcomes.
              </p>
            </div>
          </div>
        )}

        {/* Primary Action Button */}
        <div className="form-actions">
          <button
            type="submit"
            className="scan-button primary-ai-btn"
            disabled={isRunning || !isAuthorized}
          >
            {isRunning ? (
              <>
                <Loader2 className="spinner" size={18} aria-hidden="true" />
                <span>Running AI Test...</span>
              </>
            ) : (
              <>
                <Sparkles size={18} aria-hidden="true" />
                <span>Run AI Test</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

