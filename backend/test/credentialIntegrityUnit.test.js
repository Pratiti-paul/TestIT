import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLoginVerificationObjective, requiresValidCredentials } from '../src/services/aiAgentService.js';

describe('Credential Integrity & Exact Value Preservation Unit Tests', () => {
  // Helper simulating the exact credential injection decision logic inside executeAgentAction
  function resolveCredentialFill({
    elemType = 'text',
    elemName = '',
    elemPlaceholder = '',
    elemAriaLabel = '',
    elemAutocomplete = '',
    elemId = '',
    targetStr = '',
    value = '',
    thought = '',
    objective = {},
    credentials = {},
  }) {
    const isPassword =
      elemType === 'password' ||
      targetStr.includes('password') ||
      elemName.includes('password') ||
      elemPlaceholder.includes('password') ||
      elemId.includes('password') ||
      elemAutocomplete.includes('password');

    const isUsernameKeyword = (str) =>
      /email|e-mail|username|user|login|identifier|account|uname|uid/i.test(str || '');

    const isUsername =
      !isPassword &&
      (
        elemType === 'email' ||
        elemAutocomplete === 'username' ||
        elemAutocomplete === 'email' ||
        isUsernameKeyword(elemName) ||
        isUsernameKeyword(elemPlaceholder) ||
        isUsernameKeyword(elemAriaLabel) ||
        isUsernameKeyword(elemId) ||
        isUsernameKeyword(targetStr) ||
        /\b(fill|enter|input|type)\b.*(email|username|login|credential)/i.test(thought)
      );

    const rawVal = String(value !== undefined && value !== null ? value : '');
    const thoughtStr = String(thought || '').toLowerCase();
    const objBehavior = String(objective?.targetBehavior || '').toLowerCase();
    const objDesc = String(objective?.description || '').toLowerCase();

    const isPlaceholderToken =
      rawVal === '[VALID_USERNAME]' ||
      rawVal === '[VALID_PASSWORD]' ||
      rawVal === '' ||
      rawVal === '""' ||
      rawVal === "''";

    const isDeliberateInvalidValue =
      !isPlaceholderToken &&
      Boolean(rawVal) &&
      /^(?:invalid|wrong|incorrect|bad_user|fake_user|test_wrong|fail_user|dummy|nonexistent)/i.test(rawVal);

    const hasValidIntent =
      /\b(valid|correct|real|supplied|user\s*cred|test\s*cred|account\s*cred|actual\s*cred|log\s*in|sign\s*in|authenticate|access\s*dashboard|proceed\s*with|then\s*login|now\s*login)\b/i.test(
        thoughtStr
      );

    const hasInvalidRejectionIntent =
      (/\b(test|verify|assert|check|observe)\b.*(rejection|denied|failure|invalid\s*login)/i.test(thoughtStr) ||
        /\b(fill|enter|input|type|submit)\b.*(invalid|wrong|incorrect|fake|bad)\b.*(cred|user|email|pass|login)/i.test(
          thoughtStr
        )) &&
      !hasValidIntent;

    const isInvalidOnlyObj =
      isLoginVerificationObjective(objective) &&
      requiresValidCredentials(objective) === false &&
      /\b(invalid|wrong|rejection|denied)\b/i.test(`${objBehavior} ${objDesc}`);

    const isDeliberateInvalidIntent =
      !isPlaceholderToken &&
      (isDeliberateInvalidValue || hasInvalidRejectionIntent || (isInvalidOnlyObj && !hasValidIntent));

    let textToFill;
    let displayValue;

    if (isPassword) {
      if (isDeliberateInvalidIntent) {
        textToFill = rawVal && /invalid|wrong|fake|bad|incorrect/i.test(rawVal) ? rawVal : 'wrong_password';
        displayValue = '•••••••• (invalid test password)';
      } else {
        textToFill = credentials?.password || rawVal;
        displayValue = '••••••••';
      }
    } else if (isUsername) {
      if (isDeliberateInvalidIntent) {
        if (rawVal && /invalid|wrong|fake|bad|incorrect/i.test(rawVal)) {
          if (elemType === 'email' && !rawVal.includes('@')) {
            textToFill = `${rawVal}@example.com`;
          } else {
            textToFill = rawVal;
          }
        } else {
          textToFill = 'invalid_user@example.com';
        }
        displayValue = `"${textToFill}"`;
      } else {
        textToFill = credentials?.username ? credentials.username : rawVal;
        displayValue = `"${textToFill}"`;
      }
    } else {
      textToFill = rawVal;
      displayValue = `"${rawVal}"`;
    }

    return { textToFill, displayValue, isUsername, isPassword, isDeliberateInvalidIntent };
  }

  it('1. guarantees exact email preservation when user enters "abc@gmail.com" and model returns "a@gmail.com"', () => {
    const result = resolveCredentialFill({
      elemType: 'email',
      elemName: 'email',
      targetStr: 'placeholder Email',
      value: 'a@gmail.com', // Truncated or hallucinated model value
      thought: 'Fill user email to log in',
      credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
    });

    assert.equal(result.isUsername, true);
    assert.equal(result.isDeliberateInvalidIntent, false);
    assert.equal(result.textToFill, 'abc@gmail.com');
    assert.equal(result.displayValue, '"abc@gmail.com"');
  });

  it('2. correctly identifies username field with camelCase name "userEmail" or id "txtEmail" and injects exact credentials', () => {
    const result = resolveCredentialFill({
      elemType: 'text',
      elemName: 'userEmail',
      elemId: 'txtEmail',
      targetStr: 'css #txtEmail',
      value: 'a@gmail.com', // Hallucinated value
      thought: 'Enter login email',
      credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
    });

    assert.equal(result.isUsername, true);
    assert.equal(result.textToFill, 'abc@gmail.com');
  });

  it('3. handles transition from invalid to valid login where thought mentions preceding rejection without confusing intent', () => {
    const result = resolveCredentialFill({
      elemType: 'email',
      elemName: 'email',
      targetStr: 'placeholder Email',
      value: 'a@gmail.com',
      thought: 'After verifying invalid login rejection, now enter user credentials to test valid login.',
      credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
    });

    assert.equal(result.isDeliberateInvalidIntent, false);
    assert.equal(result.textToFill, 'abc@gmail.com');
  });

  it('4. ensures deliberate invalid login never fills "a@gmail.com" even if model hallucinates "a@gmail.com" as an invalid value', () => {
    const result = resolveCredentialFill({
      elemType: 'email',
      elemName: 'email',
      targetStr: 'placeholder Email',
      value: 'a@gmail.com', // Model thought a@gmail.com is a fake invalid email
      thought: 'Fill invalid email address to test authentication rejection',
      objective: {
        description: 'Verify login rejection with invalid credentials',
        targetBehavior: 'Rejection error message displayed',
      },
      credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
    });

    assert.equal(result.isDeliberateInvalidIntent, true);
    // Must NOT fill a@gmail.com, and must NOT fill abc@gmail.com
    assert.notEqual(result.textToFill, 'a@gmail.com');
    assert.notEqual(result.textToFill, 'abc@gmail.com');
    assert.equal(result.textToFill, 'invalid_user@example.com');
  });

  it('5. preserves explicit invalid test email (e.g. invalid_test@example.com)', () => {
    const result = resolveCredentialFill({
      elemType: 'email',
      elemName: 'email',
      targetStr: 'placeholder Email',
      value: 'invalid_tester_999@example.com',
      thought: 'Fill invalid username to test rejection',
      credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
    });

    assert.equal(result.isDeliberateInvalidIntent, true);
    assert.equal(result.textToFill, 'invalid_tester_999@example.com');
  });

  it('6. safely masks password as •••••••• and preserves exact password for Playwright', () => {
    const result = resolveCredentialFill({
      elemType: 'password',
      elemName: 'password',
      targetStr: 'placeholder Password',
      value: '',
      thought: 'Fill password to authenticate',
      credentials: { username: 'abc@gmail.com', password: 'SuperSecretPass123!@#' },
    });

    assert.equal(result.isPassword, true);
    assert.equal(result.textToFill, 'SuperSecretPass123!@#');
    assert.equal(result.displayValue, '••••••••');
  });

  it('7. leaves public non-credential fields (like search queries) unchanged', () => {
    const result = resolveCredentialFill({
      elemType: 'search',
      elemName: 'q',
      elemPlaceholder: 'Search medicines...',
      targetStr: 'placeholder Search medicines...',
      value: 'Paracetamol',
      thought: 'Search for Paracetamol in catalog',
      credentials: { username: 'abc@gmail.com', password: 'ValidPassword123!' },
    });

    assert.equal(result.isUsername, false);
    assert.equal(result.isPassword, false);
    assert.equal(result.textToFill, 'Paracetamol');
    assert.equal(result.displayValue, '"Paracetamol"');
  });
});

