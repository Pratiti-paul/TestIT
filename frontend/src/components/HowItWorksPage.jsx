import { Link } from 'react-router-dom';
import {
  Globe,
  Sparkles,
  KeyRound,
  Bot,
  CheckCircle2,
  FileCheck2,
  ArrowRight,
  Check,
  X,
  AlertTriangle,
  Ban,
  AlertCircle,
} from 'lucide-react';

const STEPS = [
  {
    number: '01',
    title: 'Enter Your Website',
    icon: Globe,
    accentColor: '#73A5CA',
    bgTint: 'rgba(115, 165, 202, 0.12)',
    paragraphs: [
      'Start by providing the URL of the website you want to test.',
      'TestIT opens your website in a real browser and observes its structure, visible elements, navigation, and available interactions.',
    ],
  },
  {
    number: '02',
    title: 'Describe What You Want to Test',
    icon: Sparkles,
    accentColor: '#FF933E',
    bgTint: 'rgba(255, 147, 62, 0.12)',
    paragraphs: [
      'Tell TestIT what you want to check using simple, everyday language.',
    ],
    examplesLabel: 'For example:',
    examples: [
      'Test login with valid and invalid credentials.',
      'Search for a product and add it to the cart.',
      'Check whether the checkout form validates missing information.',
      'Verify that navigation links work correctly.',
    ],
    closingText: "You don't need to write test scripts or know programming.",
  },
  {
    number: '03',
    title: 'Provide Credentials (If Required)',
    icon: KeyRound,
    accentColor: '#FFCB56',
    bgTint: 'rgba(255, 203, 86, 0.16)',
    paragraphs: [
      "Testing public pages doesn't require an account.",
      'For workflows that require authentication, you can optionally provide authorized test credentials. TestIT securely uses the supplied credentials during browser execution and protects sensitive information.',
    ],
  },
  {
    number: '04',
    title: 'Let AI Explore and Execute',
    icon: Bot,
    accentColor: '#FF933E',
    bgTint: 'rgba(255, 147, 62, 0.12)',
    paragraphs: [
      'Once you start the test, the AI analyzes the website, identifies relevant elements, plans the necessary actions, and interacts with the website using real browser automation.',
      'It can navigate pages, fill forms, click buttons, search, and adapt its approach based on what it observes.',
    ],
  },
  {
    number: '05',
    title: 'Verify Actual Outcomes',
    icon: CheckCircle2,
    accentColor: '#73A5CA',
    bgTint: 'rgba(115, 165, 202, 0.12)',
    paragraphs: [
      "TestIT doesn't just check whether a button was clicked.",
      'It examines what happened after each action and looks for evidence that the requested outcome actually occurred.',
      'For example, adding a product to a cart should be verified through the resulting cart state, not merely the button click.',
    ],
  },
  {
    number: '06',
    title: 'Review Your Test Results',
    icon: FileCheck2,
    accentColor: '#FF933E',
    bgTint: 'rgba(255, 147, 62, 0.12)',
    paragraphs: [
      'Once execution finishes, review the results to understand what worked and what didn’t.',
      'Each objective is classified according to its outcome, such as:',
    ],
    outcomes: [
      {
        tag: 'PASS',
        desc: 'The expected outcome was verified.',
        badgeClass: 'outcome-badge-pass',
        icon: Check,
      },
      {
        tag: 'FAIL',
        desc: 'The expected outcome was not achieved.',
        badgeClass: 'outcome-badge-fail',
        icon: X,
      },
      {
        tag: 'BLOCKED',
        desc: 'Testing could not proceed because of a genuine blocker.',
        badgeClass: 'outcome-badge-blocked',
        icon: Ban,
      },
      {
        tag: 'PARTIAL',
        desc: 'Some objectives were completed, while others remain unfinished.',
        badgeClass: 'outcome-badge-partial',
        icon: AlertTriangle,
      },
      {
        tag: 'ERROR',
        desc: 'A technical issue interrupted execution.',
        badgeClass: 'outcome-badge-error',
        icon: AlertCircle,
      },
    ],
    closingText:
      'You can use the execution details and available evidence to understand exactly where problems occurred.',
  },
];

export function HowItWorksPage() {
  return (
    <article className="how-it-works-page" aria-label="How TestIT Works Guide">
      {/* 1. Page Header & Editorial Intro */}
      <header className="how-page-header">
        <h1 className="how-page-title">How TestIT Works</h1>
        <h3 className="how-page-subtitle">Website testing, reimagined with AI.</h3>
        <p className="how-page-lead">
          TestIT turns your testing instructions into real browser interactions. Simply provide
          a website, describe what you want to test, and let AI explore the experience, execute
          actions, and verify the results.
        </p>
      </header>

      <hr className="how-page-divider" aria-hidden="true" />

      {/* 2. Step-by-Step Flow (01 to 06) */}
      <div className="how-steps-flow">
        {STEPS.map((step) => {
          const StepIcon = step.icon;
          return (
            <section key={step.number} className="how-step-item" aria-labelledby={`step-${step.number}-heading`}>
              <div className="how-step-item-header">
                <div
                  className="how-step-icon-well"
                  style={{
                    backgroundColor: step.bgTint,
                    color: step.accentColor,
                  }}
                  aria-hidden="true"
                >
                  <StepIcon size={20} />
                </div>
                <h2 id={`step-${step.number}-heading`} className="how-step-item-title">
                  <span className="how-step-number">{step.number}</span>
                  <span className="how-step-divider-dash">&mdash;</span>
                  <span className="how-step-title-text">{step.title}</span>
                </h2>
              </div>

              <div className="how-step-item-body">
                {step.paragraphs.map((p, idx) => (
                  <p key={idx} className="how-step-text">
                    {p}
                  </p>
                ))}

                {/* Examples List (Step 02) */}
                {step.examples && (
                  <div className="how-step-examples-block">
                    <p className="how-examples-label">{step.examplesLabel}</p>
                    <ul className="how-examples-list">
                      {step.examples.map((ex, exIdx) => (
                        <li key={exIdx} className="how-example-item">
                          <span className="how-bullet-dash" aria-hidden="true">&ndash;</span>
                          <span className="how-example-text">{ex}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Outcomes List (Step 06) */}
                {step.outcomes && (
                  <div className="how-outcomes-block">
                    <ul className="how-outcomes-list">
                      {step.outcomes.map((item) => {
                        const OutcomeIcon = item.icon;
                        return (
                          <li key={item.tag} className="how-outcome-row">
                            <span className={`how-outcome-tag ${item.badgeClass}`}>
                              <OutcomeIcon size={13} aria-hidden="true" />
                              <span className="how-outcome-tag-name">{item.tag}</span>
                            </span>
                            <span className="how-outcome-dash" aria-hidden="true">&mdash;</span>
                            <span className="how-outcome-desc">{item.desc}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {step.closingText && (
                  <p className="how-step-closing-text">{step.closingText}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <hr className="how-page-divider" aria-hidden="true" />

      {/* 3. Closing Hero Motto & Action */}
      <footer className="how-page-footer">
        <h2 className="how-footer-heading">
          No scripts. No complicated setup. Just describe, test, and verify.
        </h2>

        <p className="how-footer-tagline">
          <strong>TestIT</strong> &mdash; <span>Every click tested.</span>{' '}
          <em className="how-tagline-italic">Every experience trusted.</em>
        </p>

        <div className="how-footer-cta">
          <Link to="/" className="how-cta-button">
            <span>Start Testing Now</span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </footer>
    </article>
  );
}
