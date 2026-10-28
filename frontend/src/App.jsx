import { useState } from 'react';
import { Header } from './components/Header';
import { ScanForm } from './components/ScanForm';
import { ScanOverview } from './components/ScanOverview';
import { ChecksSummary } from './components/ChecksSummary';
import { FindingsList } from './components/FindingsList';
import { runWebsiteScan } from './services/api';
import './App.css';

const CURRENT_YEAR = new Date().getFullYear();

function App() {
  const [scanResult, setScanResult] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [apiError, setApiError] = useState('');

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

  return (
    <div className="testit-app">
      <Header />

      <main className="main-content">
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
      </main>

      <footer className="app-footer">
        <p>TestIT &copy; {CURRENT_YEAR} &mdash; Automated Website Testing Platform</p>
      </footer>
    </div>
  );
}

export default App;
