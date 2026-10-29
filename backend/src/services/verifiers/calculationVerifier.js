/**
 * Calculation & Data Integrity Verifier
 * Independently derives mathematical expectations (totals, subtotals, item counts, sorting)
 * rather than blindly accepting displayed website totals.
 */

/**
 * Extracts numbers/currency amounts from text strings.
 * e.g. "$120.50" -> 120.5, "₹ 30" -> 30, "Qty: 3" -> 3
 *
 * @param {string} text
 * @returns {number|null}
 */
export function extractNumericAmount(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.replace(/,/g, '').match(/[-+]?[0-9]*\.?[0-9]+/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Verifies that a displayed total matches the sum of observed line items and quantities.
 *
 * @param {Array<{ name?: string, priceText: string, quantityText?: string }>} items
 * @param {string} displayedTotalText
 * @param {object} [options]
 * @param {number} [options.extraFees=0] (tax, shipping, etc.)
 * @returns {{ pass: boolean, expectedTotal: number, displayedTotal: number, difference: number, details: string }}
 */
export function verifyCalculation(items, displayedTotalText, options = {}) {
  const extraFees = options.extraFees || 0;
  let calculatedSum = 0;

  for (const item of items) {
    const unitPrice = extractNumericAmount(item.priceText) || 0;
    const qty = item.quantityText ? extractNumericAmount(item.quantityText) || 1 : 1;
    calculatedSum += unitPrice * qty;
  }

  const expectedTotal = Math.round((calculatedSum + extraFees) * 100) / 100;
  const displayedTotal = extractNumericAmount(displayedTotalText) || 0;
  const diff = Math.abs(expectedTotal - displayedTotal);
  const pass = diff < 0.01;

  return {
    pass,
    expectedTotal,
    displayedTotal,
    difference: diff,
    details: `Calculated sum from ${items.length} items (${expectedTotal}) vs displayed total (${displayedTotal}). Status: ${
      pass ? 'MATCH' : 'MISMATCH'
    }`,
  };
}

/**
 * Verifies that an array of items is correctly sorted.
 *
 * @param {Array<any>} items
 * @param {'asc'|'desc'} direction
 * @param {'number'|'string'|'date'} type
 * @returns {{ isSorted: boolean, violationIndex?: number, reason: string }}
 */
export function verifySorting(items, direction = 'asc', type = 'string') {
  if (!Array.isArray(items) || items.length <= 1) {
    return { isSorted: true, reason: 'List has 0 or 1 item; trivially sorted.' };
  }

  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i];
    const b = items[i + 1];

    let comp = 0;
    if (type === 'number') {
      const numA = extractNumericAmount(String(a)) || 0;
      const numB = extractNumericAmount(String(b)) || 0;
      comp = numA - numB;
    } else {
      comp = String(a).localeCompare(String(b));
    }

    if (direction === 'asc' && comp > 0) {
      return {
        isSorted: false,
        violationIndex: i,
        reason: `Sorting violation at index ${i}: "${a}" should appear before or equal to "${b}" in ascending order.`,
      };
    }
    if (direction === 'desc' && comp < 0) {
      return {
        isSorted: false,
        violationIndex: i,
        reason: `Sorting violation at index ${i}: "${a}" should appear after or equal to "${b}" in descending order.`,
      };
    }
  }

  return { isSorted: true, reason: `Items are properly sorted in ${direction} order.` };
}

