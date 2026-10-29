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
  const timeout = options.timeout || 5000;
  const preLoginUrl = options.preLoginUrl || '';
  const submittedUser = options.submittedUsername || '';

  // 1. Wait for network stabilization and possible DOM transitions/redirects
  await page.waitForTimeout(600);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const currentUrl = page.url();
  let urlChanged = false;
  if (preLoginUrl) {
    try {
      urlChanged = new URL(currentUrl).pathname !== new URL(preLoginUrl).pathname;
    } catch {
      urlChanged = currentUrl !== preLoginUrl;
    }
  }

  // 2. Multi-signal browser evaluation
  const signals = await page
    .evaluate(
      ({ submittedUser, preLoginUrl }) => {
        // A. Check for visible authentication errors or alerts
        const errorAlertSelectors = [
          '[role="alert"]',
          '.error',
          '.error-message',
          '.alert-danger',
          '.alert-error',
          '.toast-error',
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

        // Check for authenticated navigation areas (e.g. cart, appointments, dashboard)
        const authenticatedNav = Array.from(
          document.querySelectorAll('a[href*="dashboard" i], a[href*="cart" i], a[href*="my-" i], a[href*="home" i]')
        ).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
        if (authenticatedNav.length > 0) {
          discoveredIndicators.push('Authenticated navigation links');
        }

        // Check for HTML5 form validation messages or aria-invalid inputs
        const invalidInput = document.querySelector('input:invalid, [aria-invalid="true"]');
        const validationMessage = invalidInput ? invalidInput.validationMessage || invalidInput.getAttribute('aria-errormessage') || 'Form input validation failed' : null;

        // Check for pending loading state / spinner
        const isLoading = Boolean(document.querySelector('[aria-busy="true"], .spinner, [class*="loading" i], button[disabled] .spinner'));

        return {
          observedError,
          validationMessage,
          isLoading,
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
      hasVisiblePasswordInput: false,
      hasAuthTokenInStorage: false,
      tokenKey: null,
      discoveredIndicators: [],
      cookiePresent: false,
    }));

  const expected = 'Application establishes an authenticated session and transitions away from login form';

  // 3. Evaluate signals

  // A. Definite Failure: Error message observed
  if (signals.observedError) {
    return {
      pass: false,
      status: 'FAIL',
      expected,
      actual: `Authentication failed: Application rejected credentials with error: "${signals.observedError}". Later authenticated steps will be blocked as they depend on a successful login session.`,
      signals,
    };
  }

  // B. Definite Failure: HTML5 / Form validation failed
  if (signals.validationMessage && signals.hasVisiblePasswordInput && !urlChanged) {
    return {
      pass: false,
      status: 'FAIL',
      expected,
      actual: `Authentication failed: Form validation error prevented submission: "${signals.validationMessage}".`,
      signals,
    };
  }

  // C. Definite Failure: Still on same login page with password field intact and no auth markers
  if (
    signals.hasVisiblePasswordInput &&
    !urlChanged &&
    !signals.hasAuthTokenInStorage &&
    signals.discoveredIndicators.length === 0
  ) {
    if (signals.isLoading) {
      return {
        pass: false,
        status: 'NEEDS_CLARIFICATION',
        expected,
        actual: `Authentication outcome is inconclusive: Form is currently in a loading state at "${currentUrl}". Network or server response may be delayed.`,
        signals,
      };
    }

    return {
      pass: false,
      status: 'FAIL',
      expected,
      actual: `Authentication failed: Login form remains displayed at "${currentUrl}" with password field visible; no session established. Later authenticated steps will be blocked.`,
      signals,
    };
  }

  // C. Successful Authentication via multiple positive signals
  const positiveSignals = [];
  if (urlChanged) {
    positiveSignals.push(`navigated away from login to "${currentUrl}"`);
  }
  if (!signals.hasVisiblePasswordInput) {
    positiveSignals.push('login form dismissed');
  }
  if (signals.hasAuthTokenInStorage) {
    positiveSignals.push(`auth token stored in ${signals.tokenKey}`);
  }
  if (signals.discoveredIndicators.length > 0) {
    positiveSignals.push(`discovered ${signals.discoveredIndicators.join(', ')}`);
  }

  // If at least 2 positive signals or (redirect + form dismissal)
  if (positiveSignals.length >= 2 || (urlChanged && !signals.hasVisiblePasswordInput)) {
    return {
      pass: true,
      status: 'PASS',
      expected,
      actual: `Authentication confirmed: ${positiveSignals.join('; ')}.`,
      signals,
    };
  }

  // D. Inconclusive State
  return {
    pass: false,
    status: 'NEEDS_CLARIFICATION',
    expected,
    actual: `Authentication outcome is inconclusive: Credentials submitted at "${currentUrl}", but neither an explicit error, redirect, nor verified session token could be definitively established.`,
    signals,
  };
}

