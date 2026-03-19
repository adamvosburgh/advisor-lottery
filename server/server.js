/**
 * GSAPP Lottery Server
 *
 * Express API with two mode-aware pipelines:
 *   - CDP Advisor Lottery (mode: 'advisor')
 *   - Architecture Studio Lottery (mode: 'studio')
 *
 * Pipeline logic lives in shared/pipeline.js.
 * This file handles routing, middleware, and job management.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const archiver = require('archiver');
const slugify = require('slugify');
const dotenv = require('dotenv');

const { validateRequestPayload } = require('./shared/validate');
const { ensureOutputsDir, OUTPUT_DIR } = require('./shared/fileio');
const { createJobId, runJob } = require('./shared/pipeline');

const envPath = path.join(__dirname, '..', '.env');
// eslint-disable-next-line no-console
console.log(`[SERVER] Loading .env from: ${envPath}`);
const dotenvResult = dotenv.config({ path: envPath, override: true });
// eslint-disable-next-line no-console
console.log(`[SERVER] dotenv result:`, dotenvResult.error ? `ERROR: ${dotenvResult.error}` : `SUCCESS (${Object.keys(dotenvResult.parsed || {}).length} vars)`);

const sharedPassword = process.env.APP_SHARED_PASSWORD;
const port = process.env.PORT || 4747;
const jobs = new Map(); // jobId -> { status, result, error }

// eslint-disable-next-line no-console
console.log(`[SERVER] Shared password is ${sharedPassword ? 'SET (length: ' + sharedPassword.length + ')' : 'NOT SET'}`);

const app = express();

app.set('trust proxy', 1);

app.use(
  cors({
    origin: 'https://lottery.adamvosburgh.com'
  })
);
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }
});

function serializeZodError(error) {
  if (!error?.issues) {
    return { message: 'Unknown validation error' };
  }
  return {
    message: 'Validation failed',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/api/run', limiter, async (req, res) => {
  try {
    if (sharedPassword) {
      const provided = req.headers['x-app-pass'];
      if (!provided || provided !== sharedPassword) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    let requestData;
    try {
      requestData = validateRequestPayload(req.body);
    } catch (error) {
      return res.status(400).json({ error: serializeZodError(error) });
    }

    const lotterySlug = slugify(requestData.lotteryName, {
      lower: true,
      strict: true,
      remove: /[^-\w\s]/g
    }).replace(/^-+|-+$/g, '');

    if (!lotterySlug) {
      return res.status(400).json({ error: 'Lottery name could not be converted into a slug.' });
    }

    await ensureOutputsDir();

    const mode = requestData.mode === 'studio' ? 'studio' : 'advisor';
    const jobId = createJobId();
    jobs.set(jobId, { status: 'queued' });
    runJob(jobId, jobs, requestData, lotterySlug, mode);

    return res.status(202).json({ jobId, status: 'queued' });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/run/:jobId', statusLimiter, (req, res) => {
  if (sharedPassword) {
    const provided = req.headers['x-app-pass'];
    if (!provided || provided !== sharedPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status === 'succeeded') {
    return res.json({ status: 'succeeded', result: job.result });
  }
  if (job.status === 'failed') {
    return res.json({ status: 'failed', error: job.error || 'Job failed' });
  }
  return res.json({ status: job.status });
});

app.get('/api/provider', (req, res) => {
  if (sharedPassword) {
    const provided = req.headers['x-app-pass'];
    if (!provided || provided !== sharedPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  const currentProvider = process.env.LLM_PROVIDER || 'huggingface';
  return res.json({ provider: currentProvider });
});

app.post('/api/provider', (req, res) => {
  const { provider } = req.body;

  if (!provider || !['ollama', 'huggingface'].includes(provider.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid provider. Must be "ollama" or "huggingface".' });
  }

  process.env.LLM_PROVIDER = provider.toLowerCase();
  // eslint-disable-next-line no-console
  console.log(`[SERVER] LLM provider switched to: ${process.env.LLM_PROVIDER}`);

  return res.json({ provider: process.env.LLM_PROVIDER });
});

/**
 * Download a single output file (CSV, XLSX, JSON).
 */
app.get('/download/:file', (req, res) => {
  const requested = req.params.file;
  if (!/^[a-z0-9_.-]+$/i.test(requested)) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.join(OUTPUT_DIR, requested);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  return res.download(filePath);
});

/**
 * Download a zip archive containing all three CSV outputs for a given lottery.
 */
app.get('/api/zip/:slug', (req, res) => {
  const { slug } = req.params;
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug.' });
  }

  const files = [
    ...([1, 2, 3].map((i) => ({
      diskPath: path.join(OUTPUT_DIR, `${slug}_output${i}.csv`),
      archiveName: `${slug}_output${i}.csv`
    }))),
    {
      diskPath: path.join(OUTPUT_DIR, `${slug}_summary.txt`),
      archiveName: `${slug}_summary.txt`
    }
  ];

  const existing = files.filter((f) => fs.existsSync(f.diskPath));
  if (existing.length === 0) {
    return res.status(404).json({ error: 'No CSV files found for this lottery.' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${slug}_outputs.zip"`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[ZIP] Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create zip archive.' });
    }
  });

  archive.pipe(res);
  existing.forEach((f) => archive.file(f.diskPath, { name: f.archiveName }));
  archive.finalize();
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`GSAPP Lottery server listening on port ${port}`);
});
