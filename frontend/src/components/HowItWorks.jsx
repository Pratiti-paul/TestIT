import { Globe, Sparkles, KeyRound, Bot, CheckCircle2, ArrowRight } from 'lucide-react';

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Enter Website URL',
    description: 'Provide any public web application, staging environment, or preview deployment you want to test.',
    icon: Globe,
    accentColor: '#73A5CA', // Soft Blue
    bgTint: 'rgba(115, 165, 202, 0.12)',
  },
  {
    step: '02',
    title: 'Describe What to Test',
    description: 'State your testing goals, user journeys, edge cases, or sorting requirements in plain natural English.',
    icon: Sparkles,
    accentColor: '#FF933E', // Primary Orange
    bgTint: 'rgba(255, 147, 62, 0.12)',
  },
  {
    step: '03',
    title: 'Optional Test Credentials',
    description: 'Provide test credentials for authenticated portals. Credentials are used strictly in-session and never logged or stored.',
    icon: KeyRound,
    accentColor: '#FFCB56', // Golden Yellow
    bgTint: 'rgba(255, 203, 86, 0.18)',
  },
  {
    step: '04',
    title: 'Run Autonomous AI Test',
    description: 'Playwright launches in real time, dynamically discovering live controls, navigating flows, and testing interactions.',
    icon: Bot,
    accentColor: '#FF933E', // Primary Orange
    bgTint: 'rgba(255, 147, 62, 0.12)',
  },
  {
    step: '05',
    title: 'Review Verified Outcomes',
    description: 'Inspect step-by-step evidence, action status badges, DOM diffs, and screenshot timelines of the verified state.',
    icon: CheckCircle2,
    accentColor: '#73A5CA', // Soft Blue
    bgTint: 'rgba(115, 165, 202, 0.12)',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="how-it-works-section" aria-labelledby="how-it-works-heading">
      <div className="how-it-works-header">
        <span className="how-it-works-pill">Automated Testing Workflow</span>
        <h2 id="how-it-works-heading" className="how-it-works-title">
          How TestIT Works
        </h2>
        <p className="how-it-works-subtitle">
          From natural-language instructions to verifiable browser test results in 5 intuitive steps.
        </p>
      </div>

      <div className="how-it-works-grid">
        {WORKFLOW_STEPS.map((stepItem, index) => {
          const Icon = stepItem.icon;
          return (
            <div key={stepItem.step} className="how-step-card">
              <div className="how-step-card-header">
                <span className="how-step-badge">{stepItem.step}</span>
                <div
                  className="how-step-icon"
                  style={{
                    backgroundColor: stepItem.bgTint,
                    color: stepItem.accentColor,
                  }}
                  aria-hidden="true"
                >
                  <Icon size={20} />
                </div>
              </div>

              <h3 className="how-step-name">{stepItem.title}</h3>
              <p className="how-step-explanation">{stepItem.description}</p>

              {index < WORKFLOW_STEPS.length - 1 && (
                <div className="how-step-flow-arrow" aria-hidden="true">
                  <ArrowRight size={16} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

