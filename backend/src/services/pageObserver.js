/**
 * Page Observer Service
 * Produces structured, compact, sanitized snapshots of browser state for the autonomous QA agent.
 */

/**
 * Captures a rich observation of the active Playwright page.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {Array<string>} [options.consoleErrors=[]]
 * @returns {Promise<object>}
 */
export async function observePage(page, options = {}) {
  const url = page.url();
  const title = (await page.title().catch(() => '')) || '';

  // Bounded check for in-flight spinners/loading skeletons settling before taking observation
  const isCurrentlyLoading = await page
    .evaluate(() => {
      return Boolean(
        document.querySelector(
          '[aria-busy="true"], .spinner, [class*="spinner" i], [class*="loading" i], .skeleton, [class*="skeleton" i]'
        )
      );
    })
    .catch(() => false);

  if (isCurrentlyLoading) {
    const settleStart = Date.now();
    while (Date.now() - settleStart < 2500) {
      await page.waitForTimeout(200);
      const stillBusy = await page
        .evaluate(() => {
          return Boolean(
            document.querySelector(
              '[aria-busy="true"], .spinner, [class*="spinner" i], [class*="loading" i], .skeleton, [class*="skeleton" i]'
            )
          );
        })
        .catch(() => false);
      if (!stillBusy) break;
    }
  }

  // Evaluate in-browser structured DOM snapshot safely
  const domData = await page.evaluate(() => {
    // Helper to get element text safely
    const getText = (el) => (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');

    // 1. Headings
    const headingEls = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
    const headings = headingEls
      .map((h) => ({ tag: h.tagName.toLowerCase(), text: getText(h) }))
      .filter((h) => h.text.length > 0)
      .slice(0, 15);

    // 2. Interactive elements (buttons, inputs, links, selects)
    const interactiveElements = [];

    // Inputs & textareas
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    for (const input of inputs.slice(0, 25)) {
      const isVisible = input.offsetWidth > 0 && input.offsetHeight > 0;
      if (!isVisible) continue;

      const type = input.getAttribute('type') || input.tagName.toLowerCase();
      const placeholder = input.getAttribute('placeholder') || '';
      const name = input.getAttribute('name') || '';
      const ariaLabel = input.getAttribute('aria-label') || '';
      const value = type === 'password' ? '••••••••' : (input.value || '');
      const disabled = input.disabled || input.hasAttribute('disabled');
      const required = input.required || input.hasAttribute('required');

      // Find associated label text if available
      let labelText = '';
      if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) labelText = getText(label);
      }
      if (!labelText && input.closest('label')) {
        labelText = getText(input.closest('label'));
      }

      interactiveElements.push({
        tag: input.tagName.toLowerCase(),
        type,
        name: name || undefined,
        placeholder: placeholder || undefined,
        label: labelText || ariaLabel || undefined,
        value: value ? value.slice(0, 50) : undefined,
        disabled: disabled || undefined,
        required: required || undefined,
      });
    }

    // Buttons
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'));
    for (const btn of buttons.slice(0, 30)) {
      const isVisible = btn.offsetWidth > 0 && btn.offsetHeight > 0;
      if (!isVisible) continue;

      const text = getText(btn);
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const disabled = btn.disabled || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
      const isSelected = btn.getAttribute('aria-selected') === 'true' || btn.classList.contains('active') || btn.classList.contains('bg-primary');

      const container = btn.closest('tr, article, section, li, [class*="card" i], [class*="row" i], [class*="item" i], form');
      const containerContext = container ? getText(container).slice(0, 60) : undefined;

      interactiveElements.push({
        tag: 'button',
        text: text.slice(0, 40) || ariaLabel || 'button',
        ariaLabel: ariaLabel || undefined,
        disabled: disabled || undefined,
        isSelected: isSelected || undefined,
        context: containerContext,
      });
    }

    // Key visible links
    const links = Array.from(document.querySelectorAll('a[href]'));
    for (const link of links.slice(0, 25)) {
      const isVisible = link.offsetWidth > 0 && link.offsetHeight > 0;
      const text = getText(link);
      if (!isVisible || !text || text.length > 50) continue;

      interactiveElements.push({
        tag: 'a',
        text: text.slice(0, 40),
        href: link.getAttribute('href') || '',
      });
    }

    // 3. Active / Highlighted controls (useful for calendars, tabs, active navigation)
    const activeEls = Array.from(
      document.querySelectorAll(
        '[aria-selected="true"], [aria-current], button.bg-primary, .active-day, .active, .selected'
      )
    );
    const activeControls = activeEls
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: getText(el).slice(0, 40),
        role: el.getAttribute('role') || undefined,
        ariaCurrent: el.getAttribute('aria-current') || undefined,
      }))
      .filter((a) => a.text.length > 0)
      .slice(0, 10);

    // 4. Compact visible body text snippet (excluding scripts/styles)
    const bodyClone = document.body ? document.body.cloneNode(true) : null;
    let visibleTextSnippet = '';
    if (bodyClone) {
      bodyClone.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());
      visibleTextSnippet = (bodyClone.innerText || bodyClone.textContent || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 2000);
    }

    return {
      headings,
      interactiveElements,
      activeControls,
      visibleTextSnippet,
    };
  }).catch(() => ({
    headings: [],
    interactiveElements: [],
    activeControls: [],
    visibleTextSnippet: '',
  }));

  return {
    url,
    title,
    headings: domData.headings,
    interactiveElements: domData.interactiveElements,
    activeControls: domData.activeControls,
    visibleTextSnippet: domData.visibleTextSnippet,
    consoleErrors: options.consoleErrors || [],
  };
}

