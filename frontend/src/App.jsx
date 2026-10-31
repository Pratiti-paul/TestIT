import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { AiTestForm } from './components/AiTestForm';
import { AiTestResults } from './components/AiTestResults';
import { HowItWorksPage } from './components/HowItWorksPage';
import { executeAiTest } from './services/api';
import './App.css';

const CURRENT_YEAR = new Date().getFullYear();

function HomePage({ onRunAiTest, isRunning, testError, testReport }) {
  return (
    <>
      <section className="hero-statement-section" aria-label="Tagline">
        <h1 className="hero-statement-title">
          <span className="hero-statement-line">Every click tested.</span>
          <span className="hero-statement-italic">Every experience trusted.</span>
        </h1>
        <p className="hero-statement-subtitle">
          The autonomous AI that turns plain English goals into real browser interactions and verified outcomes in every web app.
        </p>
      </section>

      <AiTestForm
        onRunTest={onRunAiTest}
        isRunning={isRunning}
        apiError={testError}
      />

      {testReport && (
        <div className={`results-container ${isRunning ? 'results-dimmed' : ''}`}>
          <AiTestResults report={testReport} />
        </div>
      )}
    </>
  );
}

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

  return (
    <div className="testit-app">
      <Header />

      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                onRunAiTest={handleRunAiTest}
                isRunning={isRunning}
                testError={testError}
                testReport={testReport}
              />
            }
          />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route
            path="*"
            element={
              <HomePage
                onRunAiTest={handleRunAiTest}
                isRunning={isRunning}
                testError={testError}
                testReport={testReport}
              />
            }
          />
        </Routes>
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
