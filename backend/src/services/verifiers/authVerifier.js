/**
 * Adaptive, Evidence-Based Authentication Verifier
 * Evaluates multiple independent browser signals to verify authentication outcomes
 * without hardcoding application-specific selectors or relying on fixed labels.
 */

/**
 * Inspects page state after credential submission to determine authentication outcome.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {string} [options.submittedUsername]
 * @param {string} [options.preLoginUrl]
 * @param {number} [options.timeout=5000]
 * @returns {Promise<{ pass: boolean, status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NEEDS_CLARIFICATION', expected: string, actual: string, signals: object }>}
 */
export async function verifyAuthenticationSuccess(page, options = {}) {
  const timeout = options.timeout || 8000;
  const pollInterval = 250;
  const preLoginUrl = options.preLoginUrl || '';
  const submittedUser = options.submittedUsername || '';
  const startMs = Date.now();
  const maxIterations = Math.max(1, Math.ceil(timeout / pollInterval));

  const expected = 'Application establishes an authenticated session and transitions away from login form';

  // 1. Initial brief wait for network/DOM reaction
  await page.waitForTimeout(300);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  let latestSignals = null;
  let iterations = 0;

  // 2. Asynchronous bounded verification loop
  while (Date.now() - startMs < timeout && iterations < maxIterations) {
    iterations++;

    const currentUrl = page.url();
    let urlChanged = false;
    if (preLoginUrl) {
      try {
        urlChanged = new URL(currentUrl).pathname !== new URL(preLoginUrl).pathname;
      } catch {
        urlChanged = currentUrl !== preLoginUrl;
      }
    }

    // Context cookie inspection for HTTP-only session tokens
    let hasSessionCookie = false;
    let sessionCookieName = null;
    try {
      if (page.context && typeof page.context().cookies === 'function') {
        const cookies = await page.context().cookies();
        const sessionCookiePatterns = /session|auth|token|jwt|sid|logged_in/i;
        const matched = cookies.find((c) => sessionCookiePatterns.test(c.name));
        if (matched) {
          hasSessionCookie = true;
          sessionCookieName = matched.name;
        }
      }
    } catch {
      // Ignore cookie retrieval errors
    }

    // Multi-signal in-page evaluation
    const signals = await page
      .evaluate(
        ({ submittedUser, preLoginUrl }) => {
          // A. Check for visible authentication errors or alerts
          const errorAlertSelectors = [
            '[role="alert"]',
            '.error',
            '.error-message',
            '.auth-error-message',
            '.alert-danger',
            '.alert-error',
            '.toast-error',
            '.Toastify__toast--error',
            '.notification-error',
            '[class*="error" i]',
          ];

          let observedError = null;
          for (const sel of errorAlertSelectors) {
            const els = Array.from(document.querySelectorAll(sel));
            for (const el of els) {
              const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
              const text = (el.innerText || el.textContent || '').trim();
              if (
                isVisible &&
                text &&
                /invalid|incorrect|failed|wrong|unauthorized|not found|error/i.test(text)
              ) {
                observedError = text.slice(0, 150);
                break;
              }
            }
            if (observedError) break;
          }

          // B. Check if login form controls are still visible on page
          const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(
            (i) => i.offsetWidth > 0 && i.offsetHeight > 0
          );
          const hasVisiblePasswordInput = passwordInputs.length > 0;

          // C. Check storage for auth tokens / session markers
          let hasAuthTokenInStorage = false;
          let tokenKey = null;
          try {
            const authKeyPatterns = /token|auth|jwt|session|user_id|currentUser/i;
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (authKeyPatterns.test(k) && localStorage.getItem(k)) {
                hasAuthTokenInStorage = true;
                tokenKey = k;
                break;
              }
            }
            if (!hasAuthTokenInStorage) {
              for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (authKeyPatterns.test(k) && sessionStorage.getItem(k)) {
                  hasAuthTokenInStorage = true;
                  tokenKey = `sessionStorage.${k}`;
                  break;
                }
              }
            }
          } catch {
            // Storage access may be restricted
          }

          // D. Check for discovered post-login indicators
          const discoveredIndicators = [];

          // Check for sign out / logout controls
          const logoutElements = Array.from(
            document.querySelectorAll('button, a, [role="button"], [role="link"]')
          ).filter((el) => {
            const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
            return (
              text.includes('log out') ||
              text.includes('logout') ||
              text.includes('sign out') ||
              text.includes('signout')
            );
          });
          if (logoutElements.length > 0) {
            discoveredIndicators.push('Logout/Sign-out control');
          }

          // Check for profile / avatar / account links or buttons
          const profileElements = Array.from(
            document.querySelectorAll(
              '[aria-label*="profile" i], [aria-label*="account" i], [aria-label*="user" i], a[href*="profile" i], a[href*="account" i], .user-avatar, .user-profile'
            )
          ).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
          if (profileElements.length > 0) {
            discoveredIndicators.push('User profile/account control');
          }

          // Check for user greeting or username text
          if (submittedUser) {
            const handle = submittedUser.split('@')[0].toLowerCase();
            const bodyText = (document.body ? document.body.innerText || '' : '').toLowerCase();
            if (bodyText.includes(`welcome`) || (handle && bodyText.includes(handle))) {
              discoveredIndicators.push(`User greeting (${handle})`);
            }
          }

          // Check for authenticated navigation areas (e.g. dashboard, account, profile, portal, settings)
          const authenticatedNav = Array.from(
            document.querySelectorAll('a[href*="dashboard" i], a[href*="account" i], a[href*="profile" i], a[href*="portal" i], a[href*="settings" i], a[href*="my-" i]')
          ).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
          if (authenticatedNav.length > 0) {
            discoveredIndicators.push('Authenticated navigation links');
          }

          // Check for HTML5 form validation messages or aria-invalid inputs
          const invalidInput = document.querySelector('input:invalid, [aria-invalid="true"]');
          const validationMessage = invalidInput ? invalidInput.validationMessage || invalidInput.getAttribute('aria-errormessage') || 'Form input validation failed' : null;

          // Check for pending loading state / spinner / loading button text
          const loadingBtn = Array.from(document.querySelectorAll('button, input[type="submit"]')).find((b) => {
            const text = (b.innerText || b.textContent || b.value || '').trim();
            return /loading|logging\s*in|signing\s*in|submitting|please\s*wait/i.test(text);
          });
          const hasAriaBusy = Boolean(document.querySelector('[aria-busy="true"]'));
          const hasSpinner = Boolean(document.querySelector('.spinner, [class*="spinner" i], [class*="loading" i], button[disabled] .spinner'));
          const isLoading = Boolean(loadingBtn || hasAriaBusy || hasSpinner);
          const loadingText = loadingBtn
            ? (loadingBtn.innerText || loadingBtn.textContent || loadingBtn.value || '').trim()
            : hasSpinner
            ? 'Spinner active'
            : hasAriaBusy
            ? 'aria-busy'
            : null;

          return {
            observedError,
            validationMessage,
            isLoading,
            loadingText,
            hasVisiblePasswordInput,
            hasAuthTokenInStorage,
            tokenKey,
            discoveredIndicators,
            cookiePresent: Boolean(document.cookie),
          };
        },
        { submittedUser, preLoginUrl }
      )
      .catch(() => ({
        observedError: null,
        validationMessage: null,
        isLoading: false,
        loadingText: null,
        hasVisiblePasswordInput: false,
        hasAuthTokenInStorage: false,
        tokenKey: null,
        discoveredIndicators: [],
        cookiePresent: false,
      }));

    signals.hasSessionCookie = hasSessionCookie;
    signals.sessionCookieName = sessionCookieName;
    latestSignals = signals;

    // Collect positive authentication signals
    const positiveSignals = [];
    if (urlChanged && !signals.hasVisiblePasswordInput) {
      positiveSignals.push(`navigated away from login to "${currentUrl}"`);
    }
    if (!signals.hasVisiblePasswordInput && (signals.hasAuthTokenInStorage || hasSessionCookie || signals.discoveredIndicators.length > 0)) {
      positiveSignals.push('login form dismissed');
    }
    if (signals.hasAuthTokenInStorage) {
      positiveSignals.push(`auth token stored in ${signals.tokenKey}`);
    }
    if (hasSessionCookie) {
      positiveSignals.push(`session cookie present (${sessionCookieName})`);
    }
    if (signals.discoveredIndicators.length > 0) {
      positiveSignals.push(`discovered ${signals.discoveredIndicators.join(', ')}`);
    }

    // 1. Definite Success: Verified session established
    if (
      (positiveSignals.length >= 2 || (urlChanged && !signals.hasVisiblePasswordInput) || signals.hasAuthTokenInStorage || hasSessionCookie) &&
      !signals.observedError
    ) {
      return {
        pass: true,
        status: 'PASS',
        expected,
        actual: `Authentication confirmed: ${positiveSignals.join('; ')}.`,
        signals,
      };
    }

    // 2. Definite Failure: Visible error message appeared (and not currently in loading state)
    if (signals.observedError && !signals.isLoading) {
      return {
        pass: false,
        status: 'FAIL',
        expected,
        actual: `Authentication failed: Application rejected credentials with error: "${signals.observedError}". Later authenticated steps will be blocked as they depend on a successful login session.`,
        signals,
      };
    }

    // 3. Form Validation Failure: HTML5 validation error prevented submission
    if (signals.validationMessage && signals.hasVisiblePasswordInput && !urlChanged && !signals.isLoading) {
      return {
        pass: false,
        status: 'FAIL',
        expected,
        actual: `Authentication failed: Form validation error prevented submission: "${signals.validationMessage}".`,
        signals,
      };
    }

    // 4. In-flight / Loading: If a loading indicator is active, DO NOT fail! Continue waiting
    if (signals.isLoading) {
      await page.waitForTimeout(pollInterval);
      continue;
    }

    // 5. If form is unchanged and no loading state, wait a short buffer (at least 2000ms from start)
    // before considering it a settled failure, since some frameworks have delays between click and response
    if (Date.now() - startMs < Math.min(timeout, 2000) && iterations < maxIterations) {
      await page.waitForTimeout(pollInterval);
      continue;
    }

    // If still on login page with visible password input and no positive signals, continue polling until timeout
    await page.waitForTimeout(pollInterval);
  }

  // 3. Timeout reached: Evaluate outcome based on latest observed state
  const currentUrl = page.url();

  // If timeout occurred while still in loading state:
  if (latestSignals?.isLoading) {
    return {
      pass: false,
      status: 'NEEDS_CLARIFICATION',
      expected,
      actual: `Authentication request timed out: Login form remained in a loading state ('${latestSignals.loadingText || 'Logging in...'}') after ${timeout}ms. Server or network response may be delayed.`,
      signals: latestSignals,
    };
  }

  // If password input is still visible on login form:
  if (latestSignals?.hasVisiblePasswordInput) {
    return {
      pass: false,
      status: 'FAIL',
      expected,
      actual: `Authentication timed out: Login form remains displayed at "${currentUrl}" with password field visible after ${timeout}ms; no session established. Later authenticated steps will be blocked.`,
      signals: latestSignals,
    };
  }

  // Fallback inconclusive outcome:
  return {
    pass: false,
    status: 'NEEDS_CLARIFICATION',
    expected,
    actual: `Authentication outcome is inconclusive: Credentials submitted at "${currentUrl}", but neither an explicit error, redirect, nor verified session token could be definitively established within ${timeout}ms.`,
    signals: latestSignals,
  };
}

