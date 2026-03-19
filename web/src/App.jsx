import { useCallback, useEffect, useMemo, useState } from 'react';
import Dropzone from './components/Dropzone.jsx';
import Field from './components/Field.jsx';
import OutputCard from './components/OutputCard.jsx';

function App() {
  const [mode, setMode] = useState('studio'); // 'advisor' or 'studio'
  const [advisors, setAdvisors] = useState([]);
  const [students, setStudents] = useState([]);
  const [lotteryName, setLotteryName] = useState('');
  const [parameters, setParameters] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Studio mode specific fields
  const [maxStudentsPerStudio, setMaxStudentsPerStudio] = useState('12');
  const [minStudentsPerStudio, setMinStudentsPerStudio] = useState('8');

  const [appPassword, setAppPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [provider, setProvider] = useState('huggingface'); // 'ollama' or 'huggingface'
  const [loadingProvider, setLoadingProvider] = useState(true);

  const handleAdvisorsParsed = useCallback((data) => {
    setAdvisors(data);
  }, []);

  const handleStudentsParsed = useCallback((data) => {
    setStudents(data);
  }, []);

  const fetchProvider = useCallback(async () => {
    try {
      const headers = {};
      if (appPassword) {
        headers['x-app-pass'] = appPassword;
      }
      const response = await fetch('/api/provider', { headers });
      if (response.ok) {
        const data = await response.json();
        setProvider(data.provider);
      }
    } catch (err) {
      console.error('Failed to fetch provider:', err);
    } finally {
      setLoadingProvider(false);
    }
  }, [appPassword]);

  const handleProviderToggle = useCallback(async (newProvider) => {
    try {
      const response = await fetch('/api/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProvider })
      });
      if (response.ok) {
        const data = await response.json();
        setProvider(data.provider);
      }
    } catch (err) {
      console.error('Failed to update provider:', err);
    }
  }, []);

  // Check if password is required on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/provider');
        if (response.status === 401) {
          // Password is required
          setIsAuthenticated(false);
        } else {
          // No password required, allow access
          setIsAuthenticated(true);
        }
      } catch (err) {
        // If we can't reach server, assume no password required
        setIsAuthenticated(true);
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  const submitPayload = useCallback(
    async (payload) => {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (appPassword) {
        headers['x-app-pass'] = appPassword;
      }

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const startJob = async () => {
        const response = await fetch('/api/run', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body?.error?.message ||
            body?.error ||
            'Server rejected the request. Please verify the inputs.';
          throw new Error(message);
        }
        if (!body?.jobId) {
          throw new Error('Job did not start. Please try again.');
        }
        return body.jobId;
      };

      const pollJob = async (jobId) => {
        const pollHeaders = { ...headers };
        let attempts = 0;
        const maxAttempts = 300; // ~10 minutes at 2s intervals
        while (attempts < maxAttempts) {
          const resp = await fetch(`/api/run/${jobId}`, { headers: pollHeaders });
          const data = await resp.json().catch(() => null);
          if (resp.status === 401) {
            throw new Error('Unauthorized. Check the password and try again.');
          }
          if (!resp.ok) {
            const msg = data?.error || 'Job failed to start.';
            throw new Error(msg);
          }
          if (data?.status === 'succeeded' && data.result) {
            return data.result;
          }
          if (data?.status === 'failed') {
            throw new Error(data?.error || 'Job failed.');
          }
          attempts += 1;
          await wait(2000);
        }
        throw new Error('Job timed out. Please try again on Fast mode or retry.');
      };

      try {
        const jobId = await startJob();
        const result = await pollJob(jobId);
        setResults(result);
      } catch (err) {
        throw err;
      }
    },
    [appPassword]
  );

  const handleGenerate = useCallback(async () => {
    // Validation based on mode
    if (mode === 'advisor') {
      if (!advisors.length) {
        setError('Please upload a faculty CSV or XLSX.');
        return;
      }
    }

    if (!students.length) {
      setError('Please upload a students CSV or XLSX.');
      return;
    }

    const trimmedName = lotteryName.trim();
    if (!trimmedName) {
      setError('Lottery name is required.');
      return;
    }

    // Build payload based on mode
    let payload;
    if (mode === 'advisor') {
      payload = {
        mode: 'advisor',
        advisors,
        students,
        parameters,
        lotteryName: trimmedName
      };
    } else {
      // Studio mode: infer faculty from student preferences
      const studioNames = new Set();
      students.forEach((student) => {
        (student.preferences || []).forEach((pref) => studioNames.add(pref));
      });

      const inferredAdvisors = Array.from(studioNames).map((name) => ({
        name,
        capacity: parseInt(maxStudentsPerStudio, 10) || 12,
        notes: `minimum ${minStudentsPerStudio} students`
      }));

      payload = {
        mode: 'studio',
        advisors: inferredAdvisors,
        students,
        parameters,
        lotteryName: trimmedName
      };
    }

    setLoading(true);
    setError('');
    try {
      await submitPayload(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [advisors, lotteryName, parameters, students, submitPayload, mode, maxStudentsPerStudio, minStudentsPerStudio]);

  const handleSplashPasswordSubmit = useCallback(async () => {
    if (!passwordInput.trim()) {
      setPasswordError('Password is required.');
      return;
    }

    // Test the password by making a simple API call
    try {
      const response = await fetch('/api/provider', {
        headers: {
          'x-app-pass': passwordInput
        }
      });

      if (response.status === 401) {
        setPasswordError('Incorrect password. Please try again.');
        setPasswordInput('');
        return;
      }

      // Password is correct
      setAppPassword(passwordInput);
      setIsAuthenticated(true);
      setPasswordError('');
      setPasswordInput('');
      fetchProvider();
    } catch (err) {
      setPasswordError('Failed to verify password. Please try again.');
    }
  }, [passwordInput, fetchProvider]);

  const handleSplashPasswordKeyPress = useCallback((event) => {
    if (event.key === 'Enter') {
      handleSplashPasswordSubmit();
    }
  }, [handleSplashPasswordSubmit]);

  const hasResults = useMemo(() => Boolean(results?.options?.length), [results]);

  // Fetch initial provider on mount
  useEffect(() => {
    fetchProvider();
  }, [fetchProvider, appPassword]);

  const speedInfo = useMemo(() => {
    if (provider === 'ollama') {
      return {
        label: 'Slow',
        description: 'Uses a lightweight (Qwen3-8B) LLM on Adam\'s home server. Will take approx 10min. Low energy + Free.'
      };
    }
    return {
      label: 'Fast',
      description: 'Uses a midweight (Qwen2.5-72B) via HuggingFace API. Will take approx 10 seconds. Mid energy + $0.01 billed to Adam.'
    };
  }, [provider]);

  // Show splash screen if not authenticated
  if (!isAuthenticated && !checkingAuth) {
    return (
      <div className="splash-screen">
        <div className="splash-card">
          <h1>GSAPP Lottery</h1>
          <p>Enter the password to access this site</p>
          <input
            type="password"
            className="splash-input"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            onKeyPress={handleSplashPasswordKeyPress}
            placeholder="Enter the password"
            autoFocus
          />
          {passwordError && <div className="splash-error">{passwordError}</div>}
          <button type="button" className="splash-button" onClick={handleSplashPasswordSubmit}>
            Enter
          </button>
        </div>
      </div>
    );
  }

  // Show nothing while checking auth
  if (checkingAuth) {
    return null;
  }

  // Show main app if authenticated
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>GSAPP Lottery</h1>
      </header>

      {/* Mode Selector */}
      <div className="mode-selector">
        <div className="mode-buttons">
          <button
            type="button"
            className={`mode-button ${mode === 'studio' ? 'mode-button--active' : ''}`}
            onClick={() => setMode('studio')}
            disabled={loading}
          >
            Architecture Studio Lottery
          </button>
          <button
            type="button"
            className={`mode-button ${mode === 'advisor' ? 'mode-button--active' : ''}`}
            onClick={() => setMode('advisor')}
            disabled={loading}
          >
            CDP Advisor Lottery
          </button>
        </div>
      </div>

      {/* Advisor Mode: Show both dropzones */}
      {mode === 'advisor' && (
        <div className="grid-row">
          <Dropzone
            label="UPLOAD FACULTY (.CSV / .XLSX)"
            mode="advisors"
            lotteryMode={mode}
            onParsed={handleAdvisorsParsed}
            templatePath="/templates/advisors-template.csv"
          />
          <Dropzone
            label="UPLOAD STUDENT SELECTIONS (.CSV / .XLSX)"
            mode="students"
            lotteryMode={mode}
            onParsed={handleStudentsParsed}
            templatePath="/templates/students-template.csv"
          />
        </div>
      )}

      {/* Studio Mode: Show only student dropzone and capacity inputs */}
      {mode === 'studio' && (
        <>
          <div className="grid-row">
            <Dropzone
              label="UPLOAD STUDENT SELECTIONS (.CSV / .XLSX)"
              mode="students"
              lotteryMode={mode}
              onParsed={handleStudentsParsed}
              templatePath="/templates/students-studio-template.csv"
            />
            <div className="studio-config-card">
              <div className="studio-config-label">Studio Configuration</div>
              <div className="studio-config-fields">
                <div className="studio-config-field">
                  <label htmlFor="max-students">Max students per studio:</label>
                  <input
                    id="max-students"
                    type="number"
                    min="1"
                    value={maxStudentsPerStudio}
                    onChange={(e) => setMaxStudentsPerStudio(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="studio-config-field">
                  <label htmlFor="min-students">Min students per studio:</label>
                  <input
                    id="min-students"
                    type="number"
                    min="0"
                    value={minStudentsPerStudio}
                    onChange={(e) => setMinStudentsPerStudio(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="grid-row">
        <Field
          label="Lottery name"
          value={lotteryName}
          onChange={setLotteryName}
          placeholder="e.g. Spring 2026"
        />
        <Field
          label="Additional parameters (optional)"
          value={parameters}
          onChange={setParameters}
          placeholder="Additional constraints for the solver to incorporate. E.g. 'Studio x can have a minimum of 6 students.' Not all constraints will work, and in that case they will be noted in the output."
          multiline
        />
      </div>

      <div className="action-row">
        <button
          type="button"
          className="primary-button"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>

        <div className="speed-toggle">
          <span className="speed-label">Speed:</span>
          <div className="speed-buttons">
            <button
              type="button"
              className={`speed-button ${provider === 'ollama' ? 'speed-button--active' : ''}`}
              onClick={() => handleProviderToggle('ollama')}
              disabled={loading || loadingProvider}
            >
              Slow
            </button>
            <button
              type="button"
              className={`speed-button ${provider === 'huggingface' ? 'speed-button--active' : ''}`}
              onClick={() => handleProviderToggle('huggingface')}
              disabled={loading || loadingProvider}
            >
              Fast
            </button>
          </div>
          <span className="speed-description">{speedInfo.description}</span>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {hasResults && (
        <section className="results-section">
          <div className="results-meta">
            <span className="results-slug">Slug: {results.lotterySlug}</span>
          </div>

          <div className="results-block">
            <h2 className="results-block__heading">Download Outputs</h2>
            <div className="results-downloads">
              <a
                href={results.xlsxPath}
                download
                className="results-download-btn"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 20H18M12 4V16M12 16L8 12M12 16L16 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download XLSX (all outputs, color marks assignment)
              </a>
              <a
                href={`/api/zip/${results.lotterySlug}`}
                download
                className="results-download-btn"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 20H18M12 4V16M12 16L8 12M12 16L16 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download CSV (zip file with three outputs)
              </a>
            </div>
          </div>

          <div className="results-block">
            <h2 className="results-block__heading">Generated Option Descriptions</h2>
            <div className="output-grid">
              {results.options.map((option) => (
                <OutputCard key={option.id} option={option} allOptions={results.options} mode={mode} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
