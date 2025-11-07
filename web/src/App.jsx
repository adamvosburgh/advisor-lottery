import { useCallback, useMemo, useState } from 'react';
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
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [pendingPayload, setPendingPayload] = useState(null);

  const handleAdvisorsParsed = useCallback((data) => {
    setAdvisors(data);
  }, []);

  const handleStudentsParsed = useCallback((data) => {
    setStudents(data);
  }, []);

  const submitPayload = useCallback(
    async (payload, passwordOverride) => {
      const headers = {
        'Content-Type': 'application/json'
      };

      const passwordToUse = passwordOverride || appPassword;
      if (passwordToUse) {
        headers['x-app-pass'] = passwordToUse;
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

      if (response.status === 401) {
        setPendingPayload(payload);
        setShowPasswordPrompt(true);
        if (passwordToUse) {
          setPasswordError('Incorrect password, please try again.');
          setPasswordInput('');
        }
        return false;
      }

      if (!response.ok) {
        const message =
          body?.error?.message ||
          body?.error ||
          'Server rejected the request. Please verify the inputs.';
        throw new Error(message);
      }

      setResults(body);
      setPendingPayload(null);
      setPasswordError('');
      return true;
    },
    [appPassword]
  );

  const handleGenerate = useCallback(async () => {
    if (!advisors.length) {
      setError('Please upload an advisors CSV.');
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

  const handlePasswordSubmit = useCallback(async () => {
    if (!passwordInput.trim()) {
      setPasswordError('Password is required.');
      return;
    }

    if (!pendingPayload) {
      setShowPasswordPrompt(false);
      return;
    }

    setShowPasswordPrompt(false);
    setAppPassword(passwordInput);
    setLoading(true);
    const payload = pendingPayload;
    try {
      const handled = await submitPayload(payload, passwordInput);
      if (!handled) {
        // remain in prompt; submitPayload already re-opened modal if needed
      } else {
        setPasswordInput('');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [passwordInput, pendingPayload, submitPayload]);

  const handlePasswordCancel = useCallback(() => {
    setShowPasswordPrompt(false);
    setPasswordInput('');
    setPasswordError('');
    setPendingPayload(null);
  }, []);

  const hasResults = useMemo(() => Boolean(results?.options?.length), [results]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Advisor Lottery</h1>
        <p>Create three lottery assignments via MiniMax M2.</p>
      </header>

      <div className="grid-row">
        <Dropzone label="Upload Advisors (.csv)" mode="advisors" onParsed={handleAdvisorsParsed} />
        <Dropzone
          label="Upload Student Selections (.csv)"
          mode="students"
          onParsed={handleStudentsParsed}
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
          placeholder="Forbidden pairs, priorities, extra notes..."
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
      </div>

      {error && <div className="error-banner">{error}</div>}

      {hasResults && (
        <section className="results-section">
          <div className="results-meta">
            <span className="results-slug">Slug: {results.lotterySlug}</span>
            <span>MiniMax M2 generated {results.options.length} options.</span>
          </div>
          <div className="output-grid">
            {results.options.map((option) => (
              <OutputCard key={option.id} option={option} />
            ))}
          </div>
        </section>
      )}

      {showPasswordPrompt && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Enter shared password</h2>
            <p>This server requires the shared passphrase before generating results.</p>
            <input
              type="password"
              className="modal-input"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              placeholder="Password"
            />
            {passwordError && <div className="modal-error">{passwordError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={handlePasswordCancel}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={handlePasswordSubmit}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
