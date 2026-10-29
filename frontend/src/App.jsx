import { useState } from 'react';
import { Header } from './components/Header';
import { AiTestForm } from './components/AiTestForm';
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

  return (
    <div className="testit-app">
      <Header />

      <main className="main-content">
        <AiTestForm
          onRunTest={handleRunAiTest}
          isRunning={isRunning}
          apiError={testError}
        />

        {testReport && (
          <div className={`results-container ${isRunning ? 'results-dimmed' : ''}`}>
            <AiTestResults report={testReport} />
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>TestIT &copy; {CURRENT_YEAR} &mdash; AI-Driven Automated Website Testing</p>
      </footer>
    </div>
  );
}

export default App;
