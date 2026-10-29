/**
 * Checks available LLM provider configurations in the environment.
 * @deprecated Legacy config reader retained for test suite compatibility.
 * Active provider selection and execution is handled exclusively by aiProvider/index.js.
 *
 * @returns {{ provider: 'gemini' | 'openai' | null, apiKey: string | null, model: string | null }}
 */
export function getLlmConfig() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY.trim(),
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    };
  }

  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY.trim(),
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }

  return {
    provider: null,
    apiKey: null,
    model: null,
  };
}

/**
 * Prohibited patterns that must never be executed for safety.
 */
const PROHIBITED_PATTERNS = [
  {
    regex: /(credit\s*card|debit\s*card|cvv|expiry\s*date|payment\s*gateway|stripe|paypal|real\s*purchase|buy\s*now\s*live)/i,
    reason: 'Live monetary payments and credit card transactions are prohibited for safety.',
  },
  {
    regex: /(delete\s*all|drop\s*table|drop\s*database|truncate\s*table|wipe\s*data|rm\s*-rf)/i,
    reason: 'Destructive deletion of real databases or server data is prohibited.',
  },
  {
    regex: /(bypass\s*captcha|solve\s*captcha|bypass\s*mfa|bypass\s*2fa|hack|exploit|sql\s*injection)/i,
    reason: 'Attempting to bypass CAPTCHA, multi-factor authentication, or security controls is prohibited.',
  },
];

/**
 * Scans user instructions for prohibited safety violations.
 *
 * @param {string} instructions
 * @returns {string[]} Detected prohibited issues
 */
export function detectProhibitedActions(instructions) {
  if (!instructions || typeof instructions !== 'string') return [];
  const violations = [];

  for (const item of PROHIBITED_PATTERNS) {
    if (item.regex.test(instructions)) {
      violations.push(item.reason);
    }
  }

  return violations;
}

/**
 * Analyzes whether instructions require authentication credentials.
 *
 * @param {string} instructions
 * @param {object} [credentials]
 * @returns {{ requiresAuth: boolean, hasValidCredentials: boolean, missingCredentials: string[] }}
 */
export function analyzeCredentialRequirements(instructions, credentials = {}) {
  const text = (instructions || '').toLowerCase();
  const requiresValidLogin =
    text.includes('valid credential') ||
    text.includes('valid login') ||
    text.includes('log in with valid') ||
    text.includes('sign in with valid') ||
    text.includes('valid and invalid') ||
    text.includes('valid & invalid') ||
    text.includes('my account') ||
    text.includes('user profile') ||
    text.includes('logged in');

  const hasUsername = Boolean(credentials?.username && String(credentials.username).trim());
  const hasPassword = Boolean(credentials?.password && String(credentials.password).trim());

  const missing = [];
  if (requiresValidLogin) {
    if (!hasUsername) missing.push('Username / Email');
    if (!hasPassword) missing.push('Password');
  }

  return {
    requiresAuth: requiresValidLogin,
    hasValidCredentials: hasUsername && hasPassword,
    missingCredentials: missing,
  };
}

/**
 * Extracts a specific search query term from user instructions.
 * If no specific search query is given (or only generic terms like "products", "items"),
 * returns null so the caller does not invent an arbitrary keyword.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function extractSearchQuery(text) {
  if (!text || typeof text !== 'string') return null;

  const genericTerms = new Set([
    'product',
    'products',
    'item',
    'items',
    'goods',
    'something',
    'anything',
    'result',
    'results',
    'bar',
    'box',
    'field',
    'input',
    'button',
    'functionality',
    'feature',
    'catalog',
    'page',
    'website',
    'site',
    'filter',
    'filters',
  ]);

  const isGeneric = (str) => {
    const cleaned = str.toLowerCase().replace(/^(?:for|the|a|an|and|then)\s+/i, '').trim();
    if (!cleaned) return true;
    if (genericTerms.has(cleaned)) return true;
    const words = cleaned.split(/\s+/);
    if (words.length > 0 && genericTerms.has(words[0])) return true;
    if (words.every((w) => genericTerms.has(w) || ['in', 'from', 'on', 'the', 'of', 'and', 'or'].includes(w))) return true;
    return false;
  };

  // 1. Quoted string: search for "...", query "...", find "..."
  const quotedMatch =
    text.match(/(?:search|query|find|look)\s+(?:for\s+)?["'“]([^"'“”\n\r]+)["'”]/i) ||
    text.match(/["'“]([^"'“”\n\r]+)["'”]/i);
  if (quotedMatch && quotedMatch[1]) {
    const candidate = quotedMatch[1].trim();
    if (candidate && !isGeneric(candidate)) {
      return candidate;
    }
  }

  // 2. "search for <term>", "query for <term>", "look for <term>"
  const searchForMatch = text.match(
    /(?:search|query|look)\s+for\s+([^,;.\n]+?)(?:[,;.]|\s+(?:and|then|with|to|\.|$)|$)/i
  );
  if (searchForMatch && searchForMatch[1]) {
    const candidate = searchForMatch[1].trim();
    if (candidate && !isGeneric(candidate)) {
      return candidate;
    }
  }

  // 3. "search <term>", "find <term>", "query <term>" (excluding "search for", "search and", etc.)
  const directMatch = text.match(
    /(?:search|find|query)\s+(?!for\s+|and\s+|then\s+|with\s+|the\s+)([^,;.\n]+?)(?:[,;.]|\s+(?:and|then|with|to|\.|$)|$)/i
  );
  if (directMatch && directMatch[1]) {
    const candidate = directMatch[1].trim();
    if (candidate && !isGeneric(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Deterministic fallback planning engine.
 * Converts natural-language instructions into structured Playwright test steps
 * without using an LLM. Clearly marked as deterministic fallback.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.instructions
 * @param {object} [params.credentials]
 * @returns {object} Structured plan
 */
export function generateDeterministicPlan({ url, instructions, credentials = {} }) {
  const text = (instructions || '').trim();
  const lower = text.toLowerCase();
  const steps = [];

  // Check what functional flows are actually requested
  const testsLogin = lower.includes('login') || lower.includes('log in') || lower.includes('sign in');
  const testsInvalid = lower.includes('invalid') || lower.includes('wrong') || lower.includes('bad credential');
  const testsValid = lower.includes('valid') || lower.includes('success');
  const testsSearch = lower.includes('search') || lower.includes('find') || lower.includes('query');
  const testsCart = lower.includes('cart') || lower.includes('add to cart') || lower.includes('add the first result');
  const testsDate =
    lower.includes('date') ||
    lower.includes('day') ||
    lower.includes('calendar') ||
    lower.includes('synchroniz') ||
    lower.includes('sync') ||
    lower.includes('today') ||
    lower.includes('schedule') ||
    lower.includes('time') ||
    lower.includes('meal');

  // If no testing instructions were provided
  if (!text) {
    return {
      status: 'unsupported',
      unsupportedReason: 'No testing instructions provided.',
      objective: 'No instructions provided',
      instructions: '',
      userInstructions: '',
      steps: [],
    };
  }

  // If the instructions describe a flow the deterministic fallback cannot reliably plan without an LLM
  if (!testsLogin && !testsSearch && !testsCart && !testsDate) {
    return {
      status: 'unsupported',
      unsupportedReason:
        `The deterministic fallback engine cannot reliably interpret or plan this custom objective ("${text.length > 80 ? text.slice(0, 80) + '...' : text}") without an AI model. Live AI planning (configured via GEMINI_API_KEY or OPENAI_API_KEY in backend/.env) or a supported user flow (login, search, cart, or date synchronization) is required.`,
      objective: `Unsupported objective: ${text}`,
      instructions: text,
      userInstructions: text,
      steps: [],
    };
  }

  // Step 1: Always navigate to the starting page
  steps.push({
    id: 'step-1',
    action: 'navigate',
    url,
    description: `Navigate to target website (${url})`,
    expected: `Navigate to target website (${url})`,
    timeoutMs: 10000,
  });

  let stepCounter = 2;

  // 1. Check for Login testing
  if (testsLogin) {
    // Step 2: Ensure Login Page (detect signup vs login page, navigate to login if needed)
    steps.push({
      id: `step-${stepCounter++}`,
      action: 'ensureLoginPage',
      target: { strategy: 'text', value: 'Login' },
      fallbacks: [
        { strategy: 'role', value: 'link', name: 'Login' },
        { strategy: 'role', value: 'link', name: 'Log in' },
        { strategy: 'role', value: 'link', name: 'Sign in' },
        { strategy: 'css', value: 'a[href*="login" i], a[href*="signin" i], a:has-text("Login")' },
      ],
      description: 'Confirm current page is Login or navigate to Login page from Signup/Home',
      expected: 'Current page confirmed as Login page with email and password inputs',
      timeoutMs: 8000,
    });

    // If testing invalid credentials
    if (testsInvalid || (!testsValid && !credentials.username)) {
      steps.push({
        id: `step-${stepCounter++}`,
        action: 'fill',
        target: { strategy: 'placeholder', value: 'email' },
        fallbacks: [
          { strategy: 'label', value: 'Email' },
          { strategy: 'label', value: 'Username' },
          { strategy: 'placeholder', value: 'Username' },
          { strategy: 'css', value: 'input[type="email"], input[name="email"], input[name="username"]' },
        ],
        value: 'invalid.tester@example.com',
        description: 'Enter invalid username/email to verify rejection',
        expected: 'Login form email/username field accepts input',
        timeoutMs: 5000,
        flowId: 'auth',
      });

      steps.push({
        id: `step-${stepCounter++}`,
        action: 'fill',
        target: { strategy: 'placeholder', value: 'password' },
        fallbacks: [
          { strategy: 'label', value: 'Password' },
          { strategy: 'css', value: 'input[type="password"]' },
        ],
        value: 'WrongPassword123!',
        isSensitive: true,
        description: 'Enter invalid password to test authentication rejection',
        expected: 'Login form password field accepts input',
        timeoutMs: 5000,
        flowId: 'auth',
      });

      steps.push({
        id: `step-${stepCounter++}`,
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Log in' },
        fallbacks: [
          { strategy: 'role', value: 'button', name: 'Sign in' },
          { strategy: 'role', value: 'button', name: 'Login' },
          { strategy: 'text', value: 'Log in' },
          { strategy: 'css', value: 'button[type="submit"], input[type="submit"]' },
        ],
        description: 'Submit invalid login credentials',
        expected: 'Submit login credentials to observe authentication rejection',
        timeoutMs: 5000,
        flowId: 'auth',
      });

      steps.push({
        id: `step-${stepCounter++}`,
        action: 'assertInvalidLogin',
        target: { strategy: 'text', value: 'Invalid' },
        fallbacks: [
          { strategy: 'text', value: 'incorrect' },
          { strategy: 'text', value: 'failed' },
          { strategy: 'role', value: 'alert' },
          { strategy: 'css', value: '.error, .alert, [role="alert"]' },
        ],
        description: 'Verify login error message is displayed or user remains unauthenticated on login page',
        expected: 'Observable authentication error displayed or user remains unauthenticated on login page',
        timeoutMs: 5000,
        flowId: 'auth',
      });
    }

    // If testing valid credentials
    if (testsValid && credentials.username && credentials.password) {
      if (testsInvalid) {
        // Establish a fresh, uncontaminated session before valid login attempt
        steps.push({
          id: `step-${stepCounter++}`,
          action: 'resetAuthSession',
          description: 'Establish fresh session for valid authentication test',
          expected: 'Browser clears contaminated session and reloads login form cleanly',
          timeoutMs: 5000,
          flowId: 'auth',
        });
      }

      steps.push({
        id: `step-${stepCounter++}`,
        action: 'fill',
        target: { strategy: 'placeholder', value: 'email' },
        fallbacks: [
          { strategy: 'label', value: 'Email' },
          { strategy: 'label', value: 'Username' },
          { strategy: 'placeholder', value: 'Username' },
          { strategy: 'css', value: 'input[type="email"], input[name="email"], input[name="username"]' },
        ],
        value: credentials.username,
        description: 'Enter valid test account username/email',
        expected: `Enter valid username/email "${credentials.username}"`,
        timeoutMs: 5000,
        flowId: 'auth',
      });

      steps.push({
        id: `step-${stepCounter++}`,
        action: 'fill',
        target: { strategy: 'placeholder', value: 'password' },
        fallbacks: [
          { strategy: 'label', value: 'Password' },
          { strategy: 'css', value: 'input[type="password"]' },
        ],
        value: credentials.password,
        isSensitive: true,
        description: 'Enter valid test account password',
        expected: 'Enter valid password into login form',
        timeoutMs: 5000,
        flowId: 'auth',
      });

      steps.push({
        id: `step-${stepCounter++}`,
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Log in' },
        fallbacks: [
          { strategy: 'role', value: 'button', name: 'Sign in' },
          { strategy: 'role', value: 'button', name: 'Login' },
          { strategy: 'text', value: 'Log in' },
          { strategy: 'css', value: 'button[type="submit"], input[type="submit"]' },
        ],
        description: 'Submit valid login credentials',
        expected: 'Submit valid credentials and complete authentication',
        timeoutMs: 5000,
        flowId: 'auth',
      });

      // Adaptive evidence-based post-login verification (replaces rigid guessed labels)
      steps.push({
        id: `step-${stepCounter++}`,
        action: 'assertAuthenticatedState',
        submittedUsername: credentials.username,
        description: 'Verify authenticated session established (redirect, form dismissal, session tokens)',
        expected: 'Application establishes an authenticated session and transitions away from login form',
        timeoutMs: 8000,
        flowId: 'auth',
        isAuthGate: true,
      });
    }
  }

  // 2. Check for Search flow
  let searchQuery = null;
  if (testsSearch || testsCart) {
    searchQuery = extractSearchQuery(text);
  }

  if (testsSearch && !searchQuery) {
    return {
      status: 'unsupported',
      unsupportedReason:
        'Search testing was requested, but no specific search query or keyword was specified in the testing instructions. Please specify what to search for (e.g., "search for Headphones" or "search for Laptop").',
      objective: `Unsupported search objective: ${text}`,
      instructions: text,
      userInstructions: text,
      steps: [],
    };
  }

  if (testsSearch) {
    // Step to ensure we are on the search/catalog interface (discovering catalog link if not present)
    steps.push({
      id: `step-${stepCounter++}`,
      action: 'ensureSearchPage',
      startUrl: url,
      flowId: 'search',
      requiresAuth: false,
      target: { strategy: 'role', value: 'searchbox' },
      fallbacks: [
        { strategy: 'placeholder', value: 'Search' },
        { strategy: 'css', value: 'input[type="search"], input[name="search" i], input[name="q" i], input[placeholder*="search" i], input[class*="search" i]' },
        { strategy: 'role', value: 'link', name: 'Products' },
        { strategy: 'role', value: 'link', name: 'Shop' },
        { strategy: 'role', value: 'link', name: 'Catalog' },
        { strategy: 'role', value: 'link', name: 'Store' },
        { strategy: 'role', value: 'link', name: 'Items' },
        { strategy: 'role', value: 'link', name: 'Browse' },
        { strategy: 'css', value: 'a[href*="product" i], a[href*="catalog" i], a[href*="shop" i], a[href*="store" i], a[href*="item" i]' },
      ],
      description: 'Navigate to products or catalog listing page if search is not on current page',
      expected: 'Products or search page is active and presents a search field',
      timeoutMs: 8000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'fill',
      flowId: 'search',
      requiresAuth: false,
      target: { strategy: 'role', value: 'searchbox' },
      fallbacks: [
        { strategy: 'placeholder', value: 'Search' },
        { strategy: 'label', value: 'Search' },
        { strategy: 'css', value: 'input[type="search"], input[name="search" i], input[name="q" i], input[placeholder*="search" i], input[class*="search" i]' },
      ],
      value: searchQuery,
      isSearch: true,
      description: `Type "${searchQuery}" into the search input`,
      expected: `Search input accepts query "${searchQuery}"`,
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'click',
      flowId: 'search',
      requiresAuth: false,
      target: {
        strategy: 'css',
        value: 'button[type="submit"], button[aria-label*="search" i], button:has-text("Search"), button:has-text("🔍"), input[type="submit"]',
      },
      fallbacks: [
        { strategy: 'role', value: 'button', name: 'Search' },
        { strategy: 'text', value: '🔍' },
        { strategy: 'text', value: 'Search' },
      ],
      description: `Submit search query for "${searchQuery}"`,
      expected: `Submit search query to display relevant search results`,
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'assertVisible',
      flowId: 'search',
      requiresAuth: false,
      target: { strategy: 'text', value: searchQuery },
      fallbacks: [
        { strategy: 'css', value: '.product-card, .item-card, [class*="card"], [role="article"], .search-results, .results' },
        { strategy: 'text', value: 'Results' },
      ],
      description: `Verify that search results matching "${searchQuery}" are displayed`,
      expected: `Search results matching "${searchQuery}" are displayed`,
      timeoutMs: 5000,
    });
  }

  // 3. Check for Cart / Add to Cart flow
  if (testsCart) {
    steps.push({
      id: `step-${stepCounter++}`,
      action: 'click',
      flowId: 'cart',
      requiresAuth: false,
      target: {
        strategy: 'css',
        value: searchQuery
          ? `[class*="card"]:has-text("${searchQuery}") button, .product-card:has-text("${searchQuery}") button, [role="article"]:has-text("${searchQuery}") button, .item-card:has-text("${searchQuery}") button`
          : '.product-card button, [class*="card"] button, .item-card button, .add-to-cart, button[aria-label*="cart" i]',
      },
      fallbacks: [
        { strategy: 'role', value: 'button', name: 'Add to Cart' },
        { strategy: 'text', value: 'Add to Cart' },
        { strategy: 'role', value: 'button', name: 'Add' },
        { strategy: 'text', value: 'Add' },
        { strategy: 'css', value: '.add-to-cart, button[aria-label*="cart" i], .product-card button, [class*="card"] button, .item-card button' },
      ],
      description: searchQuery ? `Add item ("${searchQuery}") to the shopping cart` : 'Add first item to the shopping cart',
      expected: searchQuery ? `Add product ("${searchQuery}") to the shopping cart` : 'Add product to the shopping cart',
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'click',
      flowId: 'cart',
      requiresAuth: false,
      target: {
        strategy: 'css',
        value: 'a.cart-btn, a[href*="cart" i], button[aria-label*="cart" i], .cart-icon',
      },
      fallbacks: [
        { strategy: 'text', value: '🛒' },
        { strategy: 'role', value: 'link', name: 'Cart' },
        { strategy: 'role', value: 'button', name: 'Cart' },
        { strategy: 'text', value: 'Cart' },
      ],
      description: 'Navigate to the shopping cart view',
      expected: 'Open shopping cart view',
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'assertVisible',
      flowId: 'cart',
      requiresAuth: false,
      target: searchQuery
        ? { strategy: 'text', value: searchQuery }
        : { strategy: 'css', value: '.cart-page, .cart-items-container, .cart-item, table.cart' },
      fallbacks: [
        { strategy: 'css', value: '.cart-page, .cart-items-container, .cart-item, table.cart' },
        { strategy: 'text', value: 'Cart' },
      ],
      description: searchQuery
        ? `Verify that the cart contains the intended item ("${searchQuery}")`
        : 'Verify that the cart contains the added item',
      expected: searchQuery
        ? `Shopping cart contains the intended item ("${searchQuery}")`
        : 'Shopping cart contains the added item',
      timeoutMs: 5000,
    });

    if (lower.includes('quantity')) {
      steps.push({
        id: `step-${stepCounter++}`,
        action: 'assertVisible',
        flowId: 'cart',
        requiresAuth: false,
        target: { strategy: 'text', value: '1' },
        fallbacks: [
          { strategy: 'css', value: 'input[type="number"], .quantity, .item-qty, .cart-page' },
        ],
        description: 'Verify that the cart item quantity is displayed correctly',
        expected: 'Cart item quantity is displayed correctly',
        timeoutMs: 5000,
      });
    }

    if (lower.includes('price') || lower.includes('total')) {
      steps.push({
        id: `step-${stepCounter++}`,
        action: 'assertVisible',
        flowId: 'cart',
        requiresAuth: false,
        target: { strategy: 'text', value: 'Total' },
        fallbacks: [
          { strategy: 'text', value: '₹' },
          { strategy: 'text', value: '$' },
          { strategy: 'css', value: '.order-summary, .total-price, .cart-total, [data-testid="total"]' },
        ],
        description: 'Verify that the total price calculation is displayed',
        expected: 'Total price calculation is displayed in the cart',
        timeoutMs: 5000,
      });
    }
  }

  // 4. Check for Date / Day / Calendar Synchronization flow
  if (testsDate) {
    const today = new Date();
    const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daysFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDayShort = daysShort[today.getDay()];
    const currentDayFull = daysFull[today.getDay()];

    // Step: Verify current day or date header indicator is visible on the page
    steps.push({
      id: `step-${stepCounter++}`,
      action: 'assertVisible',
      target: {
        strategy: 'text',
        value: 'Today',
      },
      fallbacks: [
        { strategy: 'text', value: currentDayShort },
        { strategy: 'text', value: currentDayFull },
        { strategy: 'css', value: 'header, [class*="date" i], [class*="calendar" i], .today' },
      ],
      description: 'Verify current day or date header indicator is visible on the page',
      expected: 'Current day or date header indicator is visible on the page',
      timeoutMs: 5000,
    });

    // Step: Assert active day synchronization with current system day
    steps.push({
      id: `step-${stepCounter++}`,
      action: 'assertDateSync',
      description: `Verify that the page day and date is correctly synchronized with current day (${currentDayFull})`,
      expected: `Active day/date on the page matches the current system day (${currentDayFull} / ${currentDayShort})`,
      timeoutMs: 5000,
    });

    // Step: Verify timeline / schedule content displays for today
    steps.push({
      id: `step-${stepCounter++}`,
      action: 'assertVisible',
      target: {
        strategy: 'css',
        value: 'button.bg-primary, [aria-selected="true"], [aria-current="date"], button.active, .active-day',
      },
      fallbacks: [
        { strategy: 'text', value: currentDayShort },
        { strategy: 'text', value: 'Breakfast' },
        { strategy: 'text', value: 'Lunch' },
        { strategy: 'css', value: '.schedule, .timeline, main, header' },
      ],
      description: 'Verify that the daily timeline/schedule displays active content synchronized for today',
      expected: 'Daily timeline/schedule displays active content synchronized for today',
      timeoutMs: 5000,
    });
  }

  // Final screenshot step for visual confirmation
  steps.push({
    id: `step-${stepCounter++}`,
    action: 'screenshot',
    description: 'Capture evidence snapshot of final verified page state',
    expected: 'Visual evidence snapshot captured',
    timeoutMs: 5000,
  });

  return {
    status: 'ready',
    objective: `Test user journey: ${text.slice(0, 120)}...`,
    instructions: text,
    userInstructions: text,
    steps: steps.slice(0, 25), // Enforce 25 step limit
  };
}

/**
 * Plans an AI test by calling a configured LLM provider, or falls back cleanly
 * to the deterministic fallback engine if no provider is configured.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.instructions
 * @param {object} [params.credentials]
 * @returns {Promise<object>} Complete test plan with metadata
 */
export async function planAiTest({ url, instructions, credentials = {} }) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error('A valid website URL is required.');
  }

  if (!instructions || typeof instructions !== 'string' || !instructions.trim()) {
    throw new Error('Testing instructions are required.');
  }

  // 1. Safety check for prohibited operations
  const prohibitedViolations = detectProhibitedActions(instructions);
  if (prohibitedViolations.length > 0) {
    return {
      status: 'blocked',
      blockedReason: `Safety restriction: ${prohibitedViolations.join(' ')}`,
      prohibitedActions: prohibitedViolations,
      planner: {
        mode: 'safety_guard',
        provider: 'safety_interceptor',
        aiConfigured: false,
        notice: 'Test blocked by safety policy before planning or browser execution.',
      },
      objective: 'Blocked: Prohibited action detected',
      steps: [],
      missingCredentials: [],
    };
  }

  // 2. Check credential requirements
  const authCheck = analyzeCredentialRequirements(instructions, credentials);
  const textLower = instructions.toLowerCase();
  const onlyValidLoginRequested =
    authCheck.requiresAuth &&
    !authCheck.hasValidCredentials &&
    !textLower.includes('invalid') &&
    !textLower.includes('search') &&
    !textLower.includes('cart');

  if (onlyValidLoginRequested) {
    return {
      status: 'blocked',
      blockedReason:
        'Authentication credentials required: Testing authenticated features requires a test username/email and password. Please provide test credentials or specify unauthenticated tests.',
      missingCredentials: authCheck.missingCredentials,
      prohibitedActions: [],
      planner: {
        mode: 'credential_guard',
        provider: 'credential_analyzer',
        aiConfigured: false,
        notice: 'Test blocked: User requested authenticated flow without providing credentials.',
      },
      objective: 'Blocked: Authentication credentials missing',
      steps: [],
    };
  }

  // 3. Deterministic Fallback Engine
  const fallbackPlan = generateDeterministicPlan({ url, instructions, credentials });

  if (fallbackPlan.status === 'unsupported') {
    return {
      status: 'unsupported',
      unsupportedReason: fallbackPlan.unsupportedReason,
      blockedReason: fallbackPlan.unsupportedReason,
      missingCredentials: [],
      prohibitedActions: [],
      instructions: instructions.trim(),
      userInstructions: instructions.trim(),
      planner: {
        mode: 'deterministic_fallback',
        provider: 'rule_based_engine',
        model: 'testit-rules-v1',
        aiConfigured: false,
        notice:
          'No AI API key is configured and the instructions cannot be reliably planned by the deterministic fallback rules engine. Configure an AI API key (GEMINI_API_KEY or OPENAI_API_KEY) in backend/.env, or specify supported user flows (login, search, add to cart, or date synchronization).',
      },
      objective: fallbackPlan.objective,
      steps: [],
    };
  }

  return {
    ...fallbackPlan,
    status: authCheck.requiresAuth && !authCheck.hasValidCredentials ? 'partial' : 'ready',
    missingCredentials: authCheck.missingCredentials,
    prohibitedActions: [],
    instructions: instructions.trim(),
    userInstructions: instructions.trim(),
    planner: {
      mode: 'deterministic_fallback',
      provider: 'rule_based_engine',
      model: 'testit-rules-v1',
      aiConfigured: false,
      notice:
        'No AI API key configured in backend environment (set GEMINI_API_KEY or OPENAI_API_KEY in backend/.env to activate live LLM planning). Test plan was created using TestIT deterministic fallback rules engine.',
    },
  };
}
