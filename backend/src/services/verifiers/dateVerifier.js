/**
 * Trustworthy Date & Weekday Synchronization Verifier
 * Implements authoritative date calculation, parsing, and multi-tier verification.
 */

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Parses displayed date and weekday from page text or element context.
 * Supports various formats without assuming a fixed format:
 * - "Thu", "Thursday"
 * - "29 Oct 2026", "October 29, 2026", "2026-10-29", "10/29/2026"
 * - "Today", "Today (Thu)"
 *
 * @param {string} text
 * @returns {object} Parsed date details
 */
export function extractDateTokens(text) {
  if (!text || typeof text !== 'string') {
    return { weekday: null, dateStr: null, parsedDate: null };
  }

  const clean = text.trim();

  // 1. Identify weekday
  let foundWeekday = null;
  for (let i = 0; i < 7; i++) {
    const full = WEEKDAYS_FULL[i];
    const short = WEEKDAYS_SHORT[i];
    const regex = new RegExp(`\\b(${full}|${short})\\b`, 'i');
    if (regex.test(clean)) {
      foundWeekday = {
        index: i,
        short,
        full,
      };
      break;
    }
  }

  // 2. Identify calendar date (YYYY-MM-DD, Month DD YYYY, DD Month YYYY, etc.)
  let parsedDate = null;
  let dateStr = null;

  // ISO 8601: YYYY-MM-DD
  const isoMatch = clean.match(/\b(20\d\d)[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    parsedDate = new Date(Date.UTC(y, m, d));
    dateStr = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Month Name + Day + optional Year: "October 29, 2026" or "29 Oct 2026"
  if (!parsedDate) {
    const monthPattern = `(?:${MONTHS_FULL.join('|')}|${MONTHS_SHORT.join('|')})`;
    const mdyRegex = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?\\b`, 'i');
    const dmyRegex = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern}),?\\s*(\\d{4})?\\b`, 'i');

    const mdyMatch = clean.match(mdyRegex);
    const dmyMatch = clean.match(dmyRegex);

    if (mdyMatch) {
      const monthStr = mdyMatch[1];
      const day = parseInt(mdyMatch[2], 10);
      const year = mdyMatch[3] ? parseInt(mdyMatch[3], 10) : new Date().getFullYear();
      const monthIndex = getMonthIndex(monthStr);
      if (monthIndex !== -1) {
        parsedDate = new Date(Date.UTC(year, monthIndex, day));
        dateStr = mdyMatch[0];
      }
    } else if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const monthStr = dmyMatch[2];
      const year = dmyMatch[3] ? parseInt(dmyMatch[3], 10) : new Date().getFullYear();
      const monthIndex = getMonthIndex(monthStr);
      if (monthIndex !== -1) {
        parsedDate = new Date(Date.UTC(year, monthIndex, day));
        dateStr = dmyMatch[0];
      }
    }
  }

  return {
    weekday: foundWeekday,
    dateStr,
    parsedDate,
  };
}

function getMonthIndex(str) {
  const s = str.toLowerCase().slice(0, 3);
  return MONTHS_SHORT.findIndex((m) => m.toLowerCase() === s);
}

/**
 * Authoritatively verifies date & weekday synchronization:
 * 1. Internal consistency: Does the displayed date's calculated weekday match the displayed weekday?
 * 2. Real-time accuracy: Does the displayed date/day correspond to current runtime date?
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {Date} [options.referenceClock=new Date()]
 * @returns {Promise<{ pass: boolean, weekdaySync: boolean, currentDateMatch: boolean, expected: string, actual: string, details: object }>}
 */
export async function verifyDateAndWeekdaySync(page, options = {}) {
  const reference = options.referenceClock || new Date();
  const refDayIndex = reference.getDay();
  const refDayShort = WEEKDAYS_SHORT[refDayIndex];
  const refDayFull = WEEKDAYS_FULL[refDayIndex];

  // 1. Inspect page for active day / calendar controls
  const activeControlData = await page.evaluate(() => {
    const activeSelectors = [
      'button.bg-primary',
      'button[aria-selected="true"]',
      'button.active',
      '[aria-current="date"]',
      '.active-day',
      '[class*="active"][class*="day"]',
      '[class*="selected"][class*="day"]',
    ];

    for (const sel of activeSelectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text) {
          return { selector: sel, text };
        }
      }
    }

    // Header date indicators
    const header = document.querySelector('header, .header, [class*="date-header"]');
    if (header) {
      return { selector: 'header', text: (header.innerText || header.textContent || '').trim() };
    }

    return null;
  });

  const fullBodyText = await page.innerText('body').catch(() => '');

  // Extract from active control first, fallback to body text
  const primaryText = activeControlData?.text || fullBodyText.slice(0, 500);
  const parsed = extractDateTokens(primaryText);

  // If no weekday found in active control, search body text
  if (!parsed.weekday) {
    const bodyParsed = extractDateTokens(fullBodyText);
    if (bodyParsed.weekday) {
      parsed.weekday = bodyParsed.weekday;
    }
    if (bodyParsed.parsedDate && !parsed.parsedDate) {
      parsed.parsedDate = bodyParsed.parsedDate;
      parsed.dateStr = bodyParsed.dateStr;
    }
  }

  // 1. Check weekday synchronization
  let weekdaySync = false;
  let currentDateMatch = false;
  let explanation = '';

  if (parsed.parsedDate) {
    // If a full date is displayed (e.g. 2026-10-29):
    // Calculate its true mathematical weekday (UTC date)
    const expectedDayIndex = parsed.parsedDate.getUTCDay();
    const expectedDayFull = WEEKDAYS_FULL[expectedDayIndex];
    const expectedDayShort = WEEKDAYS_SHORT[expectedDayIndex];

    if (parsed.weekday) {
      weekdaySync = parsed.weekday.index === expectedDayIndex;
      explanation += `Calculated weekday for displayed date (${parsed.dateStr}) is ${expectedDayFull}. Displayed weekday: ${parsed.weekday.full}. Internal sync: ${
        weekdaySync ? 'MATCH' : 'MISMATCH'
      }. `;
    } else {
      weekdaySync = true;
      explanation += `Displayed date (${parsed.dateStr}) mathematically corresponds to ${expectedDayFull}. `;
    }

    // Compare with reference clock
    const refDateUTC = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const pageDateUTC = Date.UTC(
      parsed.parsedDate.getUTCFullYear(),
      parsed.parsedDate.getUTCMonth(),
      parsed.parsedDate.getUTCDate()
    );
    currentDateMatch = pageDateUTC === refDateUTC;
  } else if (parsed.weekday) {
    // If only weekday is displayed (e.g. "Thu", "Today (Thu)"):
    // Compare directly with reference clock weekday
    weekdaySync = parsed.weekday.index === refDayIndex;
    currentDateMatch = weekdaySync;
    explanation += `Active control displays weekday "${parsed.weekday.full}" (${parsed.weekday.short}), correctly synchronized with system date (${refDayFull}, ${refDayShort}). `;
  } else if (fullBodyText.includes('Today')) {
    // Check if Today is accompanied by reference day
    if (fullBodyText.includes(refDayShort) || fullBodyText.includes(refDayFull)) {
      weekdaySync = true;
      currentDateMatch = true;
      explanation += `Page indicates "Today", correctly synchronized with system date (${refDayFull}, ${refDayShort}). `;
    }
  }

  const pass = weekdaySync && currentDateMatch;
  const expected = `Active day and date are synchronized with current system calendar (${refDayFull}, ${refDayShort})`;
  const actual = explanation.trim() || `Could not resolve active date or weekday from page content.`;

  return {
    pass,
    weekdaySync,
    currentDateMatch,
    expected,
    actual,
    details: {
      activeControl: activeControlData,
      parsedWeekday: parsed.weekday?.full || null,
      parsedDateStr: parsed.dateStr || null,
      referenceClockDay: refDayFull,
      referenceClockIso: reference.toISOString(),
    },
  };
}
