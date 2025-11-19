import { useCallback, useEffect, useMemo, useState } from 'react';
import Dropzone from './components/Dropzone.jsx';
import Field from './components/Field.jsx';
import OutputCard from './components/OutputCard.jsx';

function App() {
  const [advisors, setAdvisors] = useState([]);
  const [students, setStudents] = useState([]);
  const [lotteryName, setLotteryName] = useState('');
  const [parameters, setParameters] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [appPassword, setAppPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [provider, setProvider] = useState('ollama'); // 'ollama' or 'huggingface'
  const [loadingProvider, setLoadingProvider] = useState(true);

  const handleAdvisorsParsed = useCallback((data) => {
    setAdvisors(data);
  }, []);

  const handleStudentsParsed = useCallback((data) => {
    setStudents(data);
  }, []);

  const fetchProvider = useCallback(async () => {
    try {
      const response = await fetch('/api/provider');
      if (response.ok) {
        const data = await response.json();
        setProvider(data.provider);
      }
    } catch (err) {
      console.error('Failed to fetch provider:', err);
    } finally {
      setLoadingProvider(false);
    }
  }, []);

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

      let response;
      try {
        response = await fetch('/api/run', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } catch (err) {
        throw new Error('Failed to reach the server. Is the backend running?');
      }

      let body = null;
      try {
        body = await response.json();
      } catch (err) {
        // ignore JSON parse errors; body stays null
      }

      if (!response.ok) {
        const message =
          body?.error?.message ||
          body?.error ||
          'Server rejected the request. Please verify the inputs.';
        throw new Error(message);
      }

      setResults(body);
      return true;
    },
    [appPassword]
  );

  const handleGenerate = useCallback(async () => {
    if (!advisors.length) {
      setError('Please upload a faculty CSV.');
      return;
    }
    if (!students.length) {
      setError('Please upload a students CSV.');
      return;
    }

    const trimmedName = lotteryName.trim();
    if (!trimmedName) {
      setError('Lottery name is required.');
      return;
    }

    const payload = {
      advisors,
      students,
      parameters,
      lotteryName: trimmedName
    };

    setLoading(true);
    setError('');
    try {
      await submitPayload(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [advisors, lotteryName, parameters, students, submitPayload]);

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
    } catch (err) {
      setPasswordError('Failed to verify password. Please try again.');
    }
  }, [passwordInput]);

  const handleSplashPasswordKeyPress = useCallback((event) => {
    if (event.key === 'Enter') {
      handleSplashPasswordSubmit();
    }
  }, [handleSplashPasswordSubmit]);

  const hasResults = useMemo(() => Boolean(results?.options?.length), [results]);

  // Fetch initial provider on mount
  useEffect(() => {
    fetchProvider();
  }, [fetchProvider]);

  const speedInfo = useMemo(() => {
    if (provider === 'ollama') {
      return {
        label: 'Slow',
        description: 'Uses a lightweight (llama 3.1:8B) LLM on Adam\'s home server. Will take approx 5min. Low energy + Free.'
      };
    }
    return {
      label: 'Fast',
      description: 'Uses a midweight (llama 3.1:70B) LLM via an API call. Will take approx 10 seconds. Mid energy + $0.01 billed to Adam.'
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
        <p>Generate optimal faculty-student assignments using deterministic algorithims, and an LLM for constraint validation.</p>
      </header>

      <div className="grid-row">
        <Dropzone
          label="UPLOAD FACULTY (.CSV)"
          mode="advisors"
          onParsed={handleAdvisorsParsed}
          templatePath="/templates/advisors-template.csv"
        />
        <Dropzone
          label="UPLOAD STUDENT SELECTIONS (.CSV)"
          mode="students"
          onParsed={handleStudentsParsed}
          templatePath="/templates/students-template.csv"
        />
      </div>

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
          placeholder="Additional constraints, priorities, notes for the solver to incorporate"
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
            <span>Generated {results.options.length} optimized assignment options.</span>
          </div>
          <div className="output-grid">
            {results.options.map((option) => (
              <OutputCard key={option.id} option={option} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
