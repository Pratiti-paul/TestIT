import { useState } from 'react';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { validateClientUrl } from '../utils/urlHelpers';

export function ScanForm({ onScan, isScanning, apiError, isStaleResult }) {
  const [inputUrl, setInputUrl] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isScanning) return;

    setValidationError('');

    const validation = validateClientUrl(inputUrl);
    if (!validation.isValid) {
      setValidationError(validation.error);
      return;
    }

    onScan(validation.url);
  };

  const handleInputChange = (e) => {
    setInputUrl(e.target.value);
    if (validationError) {
      setValidationError('');
    }
  };

  const activeError = validationError || apiError;

  return (
    <section className="scan-form-section" aria-labelledby="form-heading">
      <div className="section-intro">
        <h1 id="form-heading">Test your website</h1>
        <p className="intro-text">
          Run an automated quality inspection using Playwright. TestIT verifies page health,
          uncovers broken links and missing images, captures JavaScript errors, audits essential
          metadata, and performs baseline accessibility checks.
        </p>
      </div>

      <form className="scan-form" onSubmit={handleSubmit} noValidate>
        <div className="input-group">
          <label htmlFor="scan-url-input" className="sr-only">
            Website URL
          </label>
          <div className="input-wrapper">
            <input
              id="scan-url-input"
              type="url"
              className={`url-input ${activeError ? 'input-error' : ''}`}
              placeholder="https://example.com"
              value={inputUrl}
              onChange={handleInputChange}
              disabled={isScanning}
              autoComplete="url"
              autoCapitalize="none"
              spellCheck="false"
              required
            />
            <button
              type="submit"
              className="scan-button"
              disabled={isScanning || !inputUrl.trim()}
              aria-label={isScanning ? 'Scanning website...' : 'Scan Website'}
            >
              {isScanning ? (
                <>
                  <Loader2 className="spinner" size={18} aria-hidden="true" />
                  <span>Scanning...</span>
                </>
              ) : (
                <>
                  <Search size={18} aria-hidden="true" />
                  <span>Scan Website</span>
                </>
              )}
            </button>
          </div>
        </div>

        {activeError && (
          <div className="form-error-banner" role="alert" aria-live="polite">
            <AlertCircle size={18} className="error-icon" aria-hidden="true" />
            <span className="error-text">{activeError}</span>
          </div>
        )}

        {isScanning && (
          <div className="scanning-status-banner" role="status" aria-live="polite">
            <Loader2 className="spinner" size={20} aria-hidden="true" />
            <div className="status-text">
              <strong>Scanning website with Playwright Chromium...</strong>
              <p>
                Navigating to destination, evaluating DOM, checking same-origin links, and capturing
                diagnostics. This may take 5–15 seconds.
              </p>
            </div>
          </div>
        )}

        {isStaleResult && !isScanning && (
          <p className="stale-notice">
            Showing results from previous scan. Click <strong>Scan Website</strong> to run a new test.
          </p>
        )}
      </form>
    </section>
  );
}

