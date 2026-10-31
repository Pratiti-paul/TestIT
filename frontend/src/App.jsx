import { useState } from 'react';
import { Header } from './components/Header';
import { AiTestForm } from './components/AiTestForm';
import { HowItWorks } from './components/HowItWorks';
import { AiTestResults } from './components/AiTestResults';
import { executeAiTest } from './services/api';
import './App.css';

const CURRENT_YEAR = new Date().getFullYear();

function App() {
  const [testReport, setTestReport] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [testError, setTestError] = useState('');

  const handleRunAiTest = async (payload) => {
    setIsRunning(true);
    setTestError('');

    try {
      const data = await executeAiTest(payload);
      setTestReport(data);
    } catch (err) {
      setTestError(err.message || 'An error occurred during AI test execution.');
    } finally {
      setIsRunning(false);
    }
  };

  const scrollToHowItWorks = () => {
    const el = document.getElementById('how-it-works');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="testit-app">
      <Header onNavigateHowItWorks={scrollToHowItWorks} />

      <main className="main-content">
        <AiTestForm
          onRunTest={handleRunAiTest}
          isRunning={isRunning}
          apiError={testError}
        />

        <HowItWorks />

        {testReport && (
          <div className={`results-container ${isRunning ? 'results-dimmed' : ''}`}>
            <AiTestResults report={testReport} />
          </div>
        )}
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <p className="footer-brand">
            <strong>TestIT</strong> &mdash; Universal AI-Driven Automated Website Testing
          </p>
          <p className="footer-copyright">
            &copy; {CURRENT_YEAR} TestIT Platform. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
