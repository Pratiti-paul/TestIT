import { ALLOWED_ACTIONS, ALLOWED_STRATEGIES } from '../utils/functionalTestValidator.js';

/**
 * Checks available LLM provider configurations in the environment.
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

  // If the instructions describe a flow the fallback cannot reliably construct without an LLM
  if (!testsLogin && !testsSearch && !testsCart) {
    return {
      status: 'unsupported',
      unsupportedReason:
        'The deterministic fallback engine cannot reliably plan this custom user journey without an AI model. Please configure an AI API key (GEMINI_API_KEY or OPENAI_API_KEY) in backend/.env, or specify supported flows (e.g., login, search, add to cart).',
      objective: `Unsupported journey: ${text.slice(0, 100)}`,
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
      });
    }

    // If testing valid credentials
    if (testsValid && credentials.username && credentials.password) {
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
      });

      // Verify post-login condition
      steps.push({
        id: `step-${stepCounter++}`,
        action: 'assertVisible',
        target: { strategy: 'text', value: 'Logout' },
        fallbacks: [
          { strategy: 'role', value: 'button', name: 'Logout' },
          { strategy: 'role', value: 'button', name: 'Sign out' },
          { strategy: 'text', value: 'Sign out' },
          { strategy: 'text', value: 'Account' },
          { strategy: 'text', value: 'Dashboard' },
        ],
        description: 'Verify reliable post-login condition (authenticated session is active)',
        expected: 'Authenticated session indicators (Logout, Dashboard, or Account) are visible',
        timeoutMs: 8000,
      });
    }
  }

  // 2. Check for Search flow
  let searchQuery = 'Paracetamol';

  if (testsSearch) {
    const searchMatch =
      text.match(/search\s+(?:for\s+)?["']?([^"',.\n]+)["']?/i) ||
      text.match(/query\s+(?:for\s+)?["']?([^"',.\n]+)["']?/i);
    if (searchMatch && searchMatch[1]) {
      searchQuery = searchMatch[1].trim();
    }

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'fill',
      target: { strategy: 'placeholder', value: 'Search' },
      fallbacks: [
        { strategy: 'placeholder', value: 'search' },
        { strategy: 'role', value: 'searchbox' },
        { strategy: 'label', value: 'Search' },
        { strategy: 'css', value: 'input[type="search"], input[placeholder*="search" i], input[name="q"], input[name="search"]' },
      ],
      value: searchQuery,
      description: `Type "${searchQuery}" into the search input`,
      expected: `Search input accepts query "${searchQuery}"`,
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'click',
      target: { strategy: 'role', value: 'button', name: 'Search' },
      fallbacks: [
        { strategy: 'text', value: 'Search' },
        { strategy: 'css', value: 'button[type="submit"], form button, .search-btn' },
      ],
      description: `Submit search query for "${searchQuery}"`,
      expected: `Submit search query to display relevant search results`,
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'assertVisible',
      target: { strategy: 'text', value: searchQuery },
      fallbacks: [
        { strategy: 'text', value: 'Results' },
        { strategy: 'text', value: 'Products' },
        { strategy: 'css', value: '.search-results, .product-card, .results' },
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
      target: { strategy: 'role', value: 'button', name: 'Add to Cart' },
      fallbacks: [
        { strategy: 'text', value: 'Add to Cart' },
        { strategy: 'role', value: 'button', name: 'Add' },
        { strategy: 'text', value: 'Add' },
        { strategy: 'css', value: '.add-to-cart, button[aria-label*="cart" i], .product-card button' },
      ],
      description: `Add item ("${searchQuery}") to the shopping cart`,
      expected: `Add product ("${searchQuery}") to the shopping cart`,
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'click',
      target: { strategy: 'role', value: 'button', name: 'Cart' },
      fallbacks: [
        { strategy: 'text', value: 'Cart' },
        { strategy: 'role', value: 'link', name: 'Cart' },
        { strategy: 'css', value: 'a[href*="cart"], button[aria-label*="cart" i], .cart-icon' },
      ],
      description: 'Navigate to the shopping cart view',
      expected: 'Open shopping cart view',
      timeoutMs: 5000,
    });

    steps.push({
      id: `step-${stepCounter++}`,
      action: 'assertVisible',
      target: { strategy: 'text', value: searchQuery },
      fallbacks: [
        { strategy: 'css', value: '.cart-item, .cart-list, table.cart' },
        { strategy: 'text', value: 'Cart' },
      ],
      description: `Verify that the cart contains the intended item ("${searchQuery}")`,
      expected: `Shopping cart contains the intended item ("${searchQuery}")`,
      timeoutMs: 5000,
    });

    if (lower.includes('quantity')) {
      steps.push({
        id: `step-${stepCounter++}`,
        action: 'assertVisible',
        target: { strategy: 'text', value: '1' },
        fallbacks: [
          { strategy: 'css', value: 'input[type="number"], .quantity, .item-qty' },
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
        target: { strategy: 'text', value: 'Total' },
        fallbacks: [
          { strategy: 'text', value: '$' },
          { strategy: 'text', value: '₹' },
          { strategy: 'css', value: '.total-price, .cart-total, [data-testid="total"]' },
        ],
        description: 'Verify that the total price calculation is displayed',
        expected: 'Total price calculation is displayed in the cart',
        timeoutMs: 5000,
      });
    }
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
    objective: `Test user journey: ${text.slice(0, 120)}...`,
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

  // 3. Provider selection
  const llmConfig = getLlmConfig();

  // If LLM provider is configured, call the LLM API
  if (llmConfig.provider === 'gemini') {
    try {
      const plan = await callGeminiPlanner({ url, instructions, credentials, config: llmConfig });
      return {
        ...plan,
        status: authCheck.requiresAuth && !authCheck.hasValidCredentials ? 'partial' : 'ready',
        missingCredentials: authCheck.missingCredentials,
        prohibitedActions: [],
        planner: {
          mode: 'llm',
          provider: 'gemini',
          model: llmConfig.model,
          aiConfigured: true,
          notice: `Test plan synthesized by Google Gemini AI (${llmConfig.model}).`,
        },
      };
    } catch (err) {
      console.warn('Gemini AI planner failed, falling back to deterministic engine:', err.message);
      // Fall through to deterministic fallback
    }
  } else if (llmConfig.provider === 'openai') {
    try {
      const plan = await callOpenAiPlanner({ url, instructions, credentials, config: llmConfig });
      return {
        ...plan,
        status: authCheck.requiresAuth && !authCheck.hasValidCredentials ? 'partial' : 'ready',
        missingCredentials: authCheck.missingCredentials,
        prohibitedActions: [],
        planner: {
          mode: 'llm',
          provider: 'openai',
          model: llmConfig.model,
          aiConfigured: true,
          notice: `Test plan synthesized by OpenAI (${llmConfig.model}).`,
        },
      };
    } catch (err) {
      console.warn('OpenAI planner failed, falling back to deterministic engine:', err.message);
      // Fall through to deterministic fallback
    }
  }

  // 4. Deterministic Fallback Engine (no LLM configured or LLM failed)
  const fallbackPlan = generateDeterministicPlan({ url, instructions, credentials });

  if (fallbackPlan.status === 'unsupported') {
    return {
      status: 'unsupported',
      unsupportedReason: fallbackPlan.unsupportedReason,
      blockedReason: fallbackPlan.unsupportedReason,
      missingCredentials: [],
      prohibitedActions: [],
      planner: {
        mode: 'deterministic_fallback',
        provider: 'rule_based_engine',
        model: 'testit-rules-v1',
        aiConfigured: false,
        notice:
          'No AI API key is configured and the instructions cannot be reliably planned by the deterministic fallback rules engine. Configure an AI API key (GEMINI_API_KEY or OPENAI_API_KEY) in backend/.env, or specify supported user flows (login, search, add to cart).',
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

/**
 * Calls Gemini Generative Language REST API to generate a structured test plan.
 */
async function callGeminiPlanner({ url, instructions, credentials, config }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  const systemInstruction = `You are TestIT AI, an expert QA test planning agent.
Your job is to convert natural-language website testing instructions into an ordered list of concrete, executable Playwright browser test steps.

Allowed Actions: ${ALLOWED_ACTIONS.join(', ')}.
Allowed Target Strategies: ${ALLOWED_STRATEGIES.join(', ')}.
Maximum steps: 25.
Do NOT attempt destructive actions or payment submissions.
Every navigation step must be on origin: "${new URL(url).origin}".

Return ONLY valid JSON matching this schema:
{
  "objective": "Concise summary of the test plan",
  "steps": [
    {
      "id": "step-1",
      "action": "navigate",
      "url": "${url}",
      "description": "Navigate to starting website",
      "timeoutMs": 8000
    },
    {
      "id": "step-2",
      "action": "fill",
      "target": { "strategy": "placeholder", "value": "Search..." },
      "value": "string value",
      "description": "Clear description of action",
      "timeoutMs": 5000
    }
  ]
}`;

  const userPrompt = `Website URL: ${url}
User Instructions: "${instructions}"
Credentials Provided: ${credentials?.username ? 'Yes (Username supplied)' : 'No test credentials supplied'}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }] }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textContent) {
    throw new Error('Gemini API returned an empty response');
  }

  const parsed = JSON.parse(textContent);
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('Gemini did not return an array of test steps');
  }

  return {
    objective: parsed.objective || 'AI Planned Test Journey',
    steps: parsed.steps.slice(0, 25),
  };
}

/**
 * Calls OpenAI Chat Completions API to generate a structured test plan.
 */
async function callOpenAiPlanner({ url, instructions, credentials, config }) {
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const systemInstruction = `You are TestIT AI, an expert QA test planning agent.
Convert natural language website testing instructions into an ordered list of concrete, executable Playwright browser test steps.
Allowed Actions: ${ALLOWED_ACTIONS.join(', ')}.
Allowed Target Strategies: ${ALLOWED_STRATEGIES.join(', ')}.
Maximum steps: 25.
Return JSON with "objective" and "steps".`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        {
          role: 'user',
          content: `Website URL: ${url}\nInstructions: "${instructions}"\nCredentials: ${
            credentials?.username ? 'Supplied' : 'None'
          }`,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);

  return {
    objective: parsed.objective || 'AI Planned Test Journey',
    steps: parsed.steps.slice(0, 25),
  };
}

