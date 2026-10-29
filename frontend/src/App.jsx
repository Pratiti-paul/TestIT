import { useState } from 'react';
import { Zap, PlayCircle } from 'lucide-react';
import { Header } from './components/Header';
import { ScanForm } from './components/ScanForm';
import { ScanOverview } from './components/ScanOverview';
import { ChecksSummary } from './components/ChecksSummary';
import { FindingsList } from './components/FindingsList';
import { FunctionalTestForm } from './components/FunctionalTestForm';
import { FunctionalTestResults } from './components/FunctionalTestResults';
import { runWebsiteScan, executeFunctionalTest } from './services/api';
import './App.css';

const CURRENT_YEAR = new Date().getFullYear();

function App() {
  const [activeTab, setActiveTab] = useState('quick-scan'); // 'quick-scan' | 'functional-tests'

  // Quick Scan State
  const [scanResult, setScanResult] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [apiError, setApiError] = useState('');

  // Functional Test State
  const [testResult, setTestResult] = useState(null);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testError, setTestError] = useState('');

  const handleScan = async (url) => {
    setIsScanning(true);
    setApiError('');

    try {
      const data = await runWebsiteScan(url);
      setScanResult(data);
    } catch (err) {
      setApiError(err.message || 'An error occurred while scanning the website.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleRunFunctionalTest = async (testDefinition) => {
    setIsRunningTest(true);
    setTestError('');

    try {
      const data = await executeFunctionalTest(testDefinition);
      setTestResult(data);
    } catch (err) {
      setTestError(err.message || 'An error occurred while executing the functional test.');
    } finally {
      setIsRunningTest(false);
    }
  };

  return (
    <div className="testit-app">
      <Header />

      <nav className="mode-tabs-container" aria-label="Testing Mode Navigation" role="tablist">
        <button
          type="button"
          role="tab"
          id="tab-quick-scan"
          aria-selected={activeTab === 'quick-scan'}
          aria-controls="panel-quick-scan"
          className={`mode-tab-button ${activeTab === 'quick-scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('quick-scan')}
        >
          <Zap size={18} aria-hidden="true" />
          <div className="mode-tab-text">
            <span className="mode-tab-title">Quick Scan</span>
            <span className="mode-tab-subtitle">Page-level Diagnostics</span>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-functional-tests"
          aria-selected={activeTab === 'functional-tests'}
          aria-controls="panel-functional-tests"
          className={`mode-tab-button ${activeTab === 'functional-tests' ? 'active' : ''}`}
          onClick={() => setActiveTab('functional-tests')}
        >
          <PlayCircle size={18} aria-hidden="true" />
          <div className="mode-tab-text">
            <span className="mode-tab-title">Functional Tests</span>
            <span className="mode-tab-subtitle">User-Flow QA Engine</span>
          </div>
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'quick-scan' && (
          <div
            id="panel-quick-scan"
            role="tabpanel"
            aria-labelledby="tab-quick-scan"
            className="tab-panel"
          >
            <ScanForm
              onScan={handleScan}
              isScanning={isScanning}
              apiError={apiError}
              isStaleResult={Boolean(scanResult && isScanning)}
            />

            {scanResult && (
              <div className={`results-container ${isScanning ? 'results-dimmed' : ''}`}>
                <ScanOverview data={scanResult} />
                <ChecksSummary summary={scanResult.summary} checks={scanResult.checks} />
                <FindingsList findings={scanResult.findings} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'functional-tests' && (
          <div
            id="panel-functional-tests"
            role="tabpanel"
            aria-labelledby="tab-functional-tests"
            className="tab-panel"
          >
            <FunctionalTestForm
              onRunTest={handleRunFunctionalTest}
              isRunning={isRunningTest}
              apiError={testError}
              isStaleResult={Boolean(testResult && isRunningTest)}
            />

            {testResult && (
              <div className={`results-container ${isRunningTest ? 'results-dimmed' : ''}`}>
                <FunctionalTestResults result={testResult} />
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>TestIT &copy; {CURRENT_YEAR} &mdash; Automated Website Testing Platform</p>
      </footer>
    </div>
  );
}

export default App;
