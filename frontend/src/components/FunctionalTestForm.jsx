import { useState } from 'react';
import { Play, Loader2, AlertCircle, Plus, Trash2, RefreshCw, Code, LayoutList } from 'lucide-react';
import { validateClientUrl } from '../utils/urlHelpers';

const DEFAULT_SAMPLE_TEST = {
  name: 'Generic Search & Verify Flow',
  description: 'Navigates to the website, enters a search query, submits the search, and verifies results are visible.',
  startUrl: 'https://example.com',
  steps: [
    {
      id: 'step-1',
      action: 'navigate',
      url: 'https://example.com',
      description: 'Navigate to target website',
      timeoutMs: 8000,
    },
    {
      id: 'step-2',
      action: 'fill',
      target: { strategy: 'placeholder', value: 'Search...' },
      value: 'Medicine',
      description: 'Type query into search input',
      timeoutMs: 5000,
    },
    {
      id: 'step-3',
      action: 'click',
      target: { strategy: 'role', value: 'button', name: 'Search' },
      description: 'Click search button',
      timeoutMs: 5000,
    },
    {
      id: 'step-4',
      action: 'assertVisible',
      target: { strategy: 'text', value: 'Results' },
      description: 'Verify search results are displayed',
      timeoutMs: 5000,
    },
  ],
  options: {
    timeoutMs: 30000,
    stepTimeoutMs: 5000,
  },
};

export function FunctionalTestForm({ onRunTest, isRunning, apiError, isStaleResult }) {
  const [testDef, setTestDef] = useState(DEFAULT_SAMPLE_TEST);
  const [editorMode, setEditorMode] = useState('visual'); // 'visual' | 'json'
  const [jsonText, setJsonText] = useState(JSON.stringify(DEFAULT_SAMPLE_TEST, null, 2));
  const [validationError, setValidationError] = useState('');

  const handleLoadSample = () => {
    setTestDef(DEFAULT_SAMPLE_TEST);
    setJsonText(JSON.stringify(DEFAULT_SAMPLE_TEST, null, 2));
    setValidationError('');
  };

  const handleJsonChange = (e) => {
    const text = e.target.value;
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      setTestDef(parsed);
      setValidationError('');
    } catch (err) {
      setValidationError(`Invalid JSON syntax: ${err.message}`);
    }
  };

  const handleStepChange = (index, field, value) => {
    const updatedSteps = [...testDef.steps];
    updatedSteps[index] = { ...updatedSteps[index], [field]: value };
    const updatedDef = { ...testDef, steps: updatedSteps };
    setTestDef(updatedDef);
    setJsonText(JSON.stringify(updatedDef, null, 2));
  };

  const handleTargetChange = (index, targetField, targetValue) => {
    const updatedSteps = [...testDef.steps];
    const currentTarget = updatedSteps[index].target || { strategy: 'css', value: '' };
    updatedSteps[index] = {
      ...updatedSteps[index],
      target: { ...currentTarget, [targetField]: targetValue },
    };
    const updatedDef = { ...testDef, steps: updatedSteps };
    setTestDef(updatedDef);
    setJsonText(JSON.stringify(updatedDef, null, 2));
  };

  const handleAddStep = () => {
    const newStep = {
      id: `step-${testDef.steps.length + 1}`,
      action: 'click',
      target: { strategy: 'role', value: 'button', name: 'Submit' },
      description: 'Click button',
      timeoutMs: 5000,
    };
    const updatedDef = { ...testDef, steps: [...testDef.steps, newStep] };
    setTestDef(updatedDef);
    setJsonText(JSON.stringify(updatedDef, null, 2));
  };

  const handleRemoveStep = (index) => {
    const updatedSteps = testDef.steps.filter((_, i) => i !== index);
    const updatedDef = { ...testDef, steps: updatedSteps };
    setTestDef(updatedDef);
    setJsonText(JSON.stringify(updatedDef, null, 2));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRunning) return;

    setValidationError('');

    let defToRun = testDef;
    if (editorMode === 'json') {
      try {
        defToRun = JSON.parse(jsonText);
      } catch (err) {
        setValidationError(`Invalid JSON syntax: ${err.message}`);
        return;
      }
    }

    if (!defToRun.name || !defToRun.name.trim()) {
      setValidationError('Please provide a test name.');
      return;
    }

    const urlCheck = validateClientUrl(defToRun.startUrl);
    if (!urlCheck.isValid) {
      setValidationError(`Invalid start URL: ${urlCheck.error}`);
      return;
    }

    if (!Array.isArray(defToRun.steps) || defToRun.steps.length === 0) {
      setValidationError('Please add at least one test step.');
      return;
    }

    onRunTest(defToRun);
  };

  const activeError = validationError || apiError;

  return (
    <section className="scan-form-section" aria-labelledby="functional-heading">
      <div className="section-intro">
        <h1 id="functional-heading">Functional User-Flow Testing</h1>
        <p className="intro-text">
          Execute real multi-step user flows against an authorized website. Test login forms,
          product searches, shopping cart updates, and verify that actual features work as expected.
        </p>
      </div>

      <div className="form-toolbar">
        <button
          type="button"
          className="secondary-btn"
          onClick={handleLoadSample}
          disabled={isRunning}
        >
          <RefreshCw size={15} aria-hidden="true" />
          <span>Reset to Sample Test</span>
        </button>

        <div className="mode-toggle-group">
          <button
            type="button"
            className={`mode-toggle-btn ${editorMode === 'visual' ? 'active' : ''}`}
            onClick={() => setEditorMode('visual')}
          >
            <LayoutList size={15} aria-hidden="true" />
            <span>Visual Builder</span>
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${editorMode === 'json' ? 'active' : ''}`}
            onClick={() => setEditorMode('json')}
          >
            <Code size={15} aria-hidden="true" />
            <span>JSON Editor</span>
          </button>
        </div>
      </div>

      <form className="functional-form" onSubmit={handleSubmit} noValidate>
        {editorMode === 'visual' ? (
          <div className="visual-editor-container">
            <div className="form-row-grid">
              <div className="form-field">
                <label htmlFor="test-name-input">Test Name</label>
                <input
                  id="test-name-input"
                  type="text"
                  className="url-input"
                  value={testDef.name}
                  onChange={(e) => {
                    const updated = { ...testDef, name: e.target.value };
                    setTestDef(updated);
                    setJsonText(JSON.stringify(updated, null, 2));
                  }}
                  disabled={isRunning}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="test-start-url">Starting Website URL</label>
                <input
                  id="test-start-url"
                  type="url"
                  className="url-input"
                  value={testDef.startUrl}
                  onChange={(e) => {
                    const updated = { ...testDef, startUrl: e.target.value };
                    setTestDef(updated);
                    setJsonText(JSON.stringify(updated, null, 2));
                  }}
                  disabled={isRunning}
                  placeholder="https://example.com"
                  required
                />
              </div>
            </div>

            <div className="steps-builder-section">
              <div className="steps-header">
                <h3>Ordered Test Steps ({testDef.steps.length})</h3>
                <span className="steps-tip">Accessible locators (role, label, placeholder) are preferred.</span>
              </div>

              <div className="steps-list">
                {testDef.steps.map((step, index) => {
                  const needsTarget = [
                    'click',
                    'fill',
                    'select',
                    'assertVisible',
                    'assertText',
                    'assertCount',
                  ].includes(step.action);

                  const needsValue = ['fill', 'select', 'assertText', 'assertUrl', 'assertCount'].includes(
                    step.action
                  );

                  return (
                    <div key={step.id || index} className="step-builder-card">
                      <div className="step-card-header">
                        <span className="step-number">Step {index + 1}</span>
                        <input
                          type="text"
                          className="step-desc-input"
                          placeholder="Step description..."
                          value={step.description || ''}
                          onChange={(e) => handleStepChange(index, 'description', e.target.value)}
                          disabled={isRunning}
                        />
                        <button
                          type="button"
                          className="delete-step-btn"
                          onClick={() => handleRemoveStep(index)}
                          disabled={isRunning || testDef.steps.length <= 1}
                          title="Remove step"
                          aria-label={`Remove step ${index + 1}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="step-card-body">
                        <div className="step-field-group">
                          <label>Action</label>
                          <select
                            className="step-select"
                            value={step.action}
                            onChange={(e) => handleStepChange(index, 'action', e.target.value)}
                            disabled={isRunning}
                          >
                            <option value="navigate">navigate (Open URL)</option>
                            <option value="click">click (Click element)</option>
                            <option value="fill">fill (Type into input)</option>
                            <option value="select">select (Choose dropdown)</option>
                            <option value="assertVisible">assertVisible (Check visible)</option>
                            <option value="assertText">assertText (Check text)</option>
                            <option value="assertUrl">assertUrl (Check URL)</option>
                            <option value="assertCount">assertCount (Check count)</option>
                            <option value="screenshot">screenshot (Capture snapshot)</option>
                          </select>
                        </div>

                        {step.action === 'navigate' && (
                          <div className="step-field-group span-two">
                            <label>Destination URL</label>
                            <input
                              type="url"
                              className="url-input"
                              placeholder="https://example.com/search"
                              value={step.url || ''}
                              onChange={(e) => handleStepChange(index, 'url', e.target.value)}
                              disabled={isRunning}
                            />
                          </div>
                        )}

                        {needsTarget && (
                          <>
                            <div className="step-field-group">
                              <label>Locator Strategy</label>
                              <select
                                className="step-select"
                                value={step.target?.strategy || 'role'}
                                onChange={(e) => handleTargetChange(index, 'strategy', e.target.value)}
                                disabled={isRunning}
                              >
                                <option value="role">role (button, textbox, link)</option>
                                <option value="placeholder">placeholder (e.g. Search...)</option>
                                <option value="label">label (Accessible form label)</option>
                                <option value="text">text (Visible element text)</option>
                                <option value="css">css (CSS Selector)</option>
                              </select>
                            </div>

                            <div className="step-field-group">
                              <label>Locator Value</label>
                              <input
                                type="text"
                                className="url-input"
                                placeholder={
                                  step.target?.strategy === 'role'
                                    ? 'button, textbox, etc.'
                                    : 'Search text or CSS selector'
                                }
                                value={step.target?.value || ''}
                                onChange={(e) => handleTargetChange(index, 'value', e.target.value)}
                                disabled={isRunning}
                              />
                            </div>

                            {step.target?.strategy === 'role' && (
                              <div className="step-field-group">
                                <label>Role Name / Label</label>
                                <input
                                  type="text"
                                  className="url-input"
                                  placeholder="e.g. Search, Submit, Cart"
                                  value={step.target?.name || ''}
                                  onChange={(e) => handleTargetChange(index, 'name', e.target.value)}
                                  disabled={isRunning}
                                />
                              </div>
                            )}
                          </>
                        )}

                        {needsValue && (
                          <div className="step-field-group">
                            <label>Input / Expected Value</label>
                            <input
                              type={step.action === 'assertCount' ? 'number' : 'text'}
                              className="url-input"
                              placeholder="Value to enter or assert..."
                              value={step.value ?? ''}
                              onChange={(e) =>
                                handleStepChange(
                                  index,
                                  'value',
                                  step.action === 'assertCount' ? Number(e.target.value) : e.target.value
                                )
                              }
                              disabled={isRunning}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                className="add-step-btn"
                onClick={handleAddStep}
                disabled={isRunning || testDef.steps.length >= 25}
              >
                <Plus size={16} aria-hidden="true" />
                <span>Add Step</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="json-editor-container">
            <label htmlFor="test-json-textarea" className="sr-only">
              JSON Test Definition
            </label>
            <textarea
              id="test-json-textarea"
              className="json-textarea"
              rows={16}
              value={jsonText}
              onChange={handleJsonChange}
              disabled={isRunning}
              spellCheck="false"
            />
          </div>
        )}

        {activeError && (
          <div className="form-error-banner" role="alert" aria-live="polite">
            <AlertCircle size={18} className="error-icon" aria-hidden="true" />
            <span className="error-text">{activeError}</span>
          </div>
        )}

        {isRunning && (
          <div className="scanning-status-banner" role="status" aria-live="polite">
            <Loader2 className="spinner" size={20} aria-hidden="true" />
            <div className="status-text">
              <strong>Running Functional Browser Flow...</strong>
              <p>
                Interacting with target website through Playwright: executing steps, filling inputs,
                clicking elements, and asserting expected results.
              </p>
            </div>
          </div>
        )}

        {isStaleResult && !isRunning && (
          <p className="stale-notice">
            Showing results from previous functional run. Click <strong>Run Functional Test</strong> to re-execute.
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="scan-button" disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="spinner" size={18} aria-hidden="true" />
                <span>Executing Test...</span>
              </>
            ) : (
              <>
                <Play size={18} aria-hidden="true" />
                <span>Run Functional Test</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

