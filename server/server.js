/**
 * Advisor Lottery Server
 *
 * Architecture:
 * 1. Three deterministic matching algorithms generate optimal assignments
 *    - Water-Filling: Minimizes worst-case placement (minimax)
 *    - Deferred Acceptance: Maximizes first-choice assignments (greedy)
 *    - Minimum Regret: Balances overall satisfaction
 *
 * 2. LLM handles natural language processing
 *    - Extracts constraints (including per-entity capacity overrides) from advisor notes and parameters
 *    - Validates algorithm outputs for constraint violations
 *    - Triggers retries with adjusted constraints when violations detected
 *
 * 3. Robust error handling with fallbacks
 *    - LLM failures fall back to empty constraints
 *    - Algorithm adjustments handle conditional capacity constraints
 *
 * File layout:
 *   server/shared/   — algorithms, LLM, anonymization, CSV, file I/O
 *   server/studio/   — studio-mode XLSX export
 *   server/advisor/  — advisor-mode XLSX export
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
const { extractConstraints, validateAssignments } = require('./shared/constraints');
const { OUTPUT_DIR, ensureOutputsDir, writeJSON } = require('./shared/fileio');
const { saveOptionCSVs } = require('./shared/csv');
const { saveStudioXLSX } = require('./studio/xlsx');
const { saveAdvisorXLSX } = require('./advisor/xlsx');
const { createNameMapping } = require('./shared/anonymize');
const { generateDescription } = require('./shared/descriptions');
const {
  normalizeKey,
  runWaterFillingAlgorithm,
  runDeferredAcceptance,
  runMinimumRegretAlgorithm,
  validateConstraints,
  adjustAdvisorsForRetry
} = require('./shared/algorithms');

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

function createJobId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Apply per-entity capacity overrides extracted from additional parameters.
 * Override minCapacity and/or maxCapacity (capacity) for named advisors/studios.
 * Per-entity overrides take precedence over the global default.
 *
 * @param {Array} advisors - Original advisor array
 * @param {Array} overrides - capacityOverrides from extractedConstraints
 * @returns {Array} New advisor array with overrides applied
 */
function applyCapacityOverrides(advisors, overrides) {
  if (!overrides || overrides.length === 0) return advisors;

  return advisors.map((advisor) => {
    const override = overrides.find(
      (o) => normalizeKey(o.name) === normalizeKey(advisor.name)
    );
    if (!override) return advisor;

    const updated = { ...advisor };
    if (override.minCapacity !== undefined && override.minCapacity !== null) {
      updated.minCapacity = override.minCapacity;
    }
    if (override.maxCapacity !== undefined && override.maxCapacity !== null) {
      updated.capacity = override.maxCapacity;
    }
    return updated;
  });
}

function saveSummaryTxt(lotterySlug, finalOptions, mode) {
  const sizeLabel = mode === 'studio' ? 'Studio Sizes' : 'Advisor Load';
  const lines = [];
  for (const option of finalOptions) {
    const s = option.summary;
    const avg = typeof s.averagePlacement === 'number' ? s.averagePlacement.toFixed(2) : '—';
    const pct =
      typeof s.percentFirstChoice === 'number'
        ? `${(s.percentFirstChoice * 100).toFixed(1)}%`
        : '—';
    const lowest = typeof s.lowestPlacement === 'number' ? s.lowestPlacement : '—';
    const description = generateDescription(option);
    const sizeLines = s.studioSizes
      ? Object.entries(s.studioSizes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([n, c]) => `${n}: ${c}`)
      : ['—'];
    lines.push(`OUTPUT ${option.id} — ${s.algorithm}`);
    lines.push(`Average Placement: ${avg}`);
    lines.push(`% First Choice: ${pct}`);
    lines.push(`Lowest Placement: ${lowest}`);
    lines.push(`Description: ${description}`);
    lines.push(`${sizeLabel}:`);
    for (const sz of sizeLines) lines.push(sz);
    lines.push('');
  }
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${lotterySlug}_summary.txt`),
    lines.join('\n')
  );
}

async function runJob(jobId, requestData, lotterySlug, mode) {
  jobs.set(jobId, { status: 'running' });
  try {
    const result = await handleLottery(requestData, lotterySlug, mode);
    jobs.set(jobId, { status: 'succeeded', result });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[JOB ${jobId}] failed:`, error);
    jobs.set(jobId, { status: 'failed', error: error.message || 'Job failed' });
  }
}

async function handleLottery(requestData, lotterySlug, mode) {
  // eslint-disable-next-line no-console
  console.log(`\n[JOB] Running ${mode} lottery for ${lotterySlug}...`);

  const { realToPseudo, pseudoToReal, salt } = createNameMapping(
    requestData.advisors,
    requestData.students
  );

  const algorithms = [
    { id: 1, runner: runWaterFillingAlgorithm },
    { id: 2, runner: runDeferredAcceptance },
    { id: 3, runner: runMinimumRegretAlgorithm }
  ];

  // STEP 0: Extract constraints using LLM (including per-entity capacity overrides)
  // eslint-disable-next-line no-console
  console.log('  [0/3] Extracting constraints from natural language...');
  const extractionResult = await extractConstraints(
    requestData.advisors,
    requestData.parameters,
    realToPseudo,
    pseudoToReal,
    mode
  );
  const extractedConstraints = extractionResult.constraints;
  const extractionLLMPayload = extractionResult.llmPayload;

  // Apply per-entity capacity overrides from additional parameters.
  // These take precedence over the global min/max for named advisors/studios.
  const advisorsWithOverrides = applyCapacityOverrides(
    requestData.advisors,
    extractedConstraints.capacityOverrides || []
  );

  if (advisorsWithOverrides !== requestData.advisors && extractedConstraints.capacityOverrides?.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Applied ${extractedConstraints.capacityOverrides.length} per-entity capacity override(s)`);
  }

  const runAlgorithmWithRetry = (runner) => {
    let option = runner(requestData.students, advisorsWithOverrides, requestData.parameters, mode);
    const constraints = validateConstraints(
      option.assignments,
      advisorsWithOverrides,
      requestData.students,
      requestData.parameters,
      mode
    );

    if (constraints.hasViolations && constraints.zeroOrMaxViolations.length > 0) {
      // eslint-disable-next-line no-console
      console.log('    Constraint violation detected, adjusting and retrying...');
      const adjustedAdvisors = adjustAdvisorsForRetry(
        advisorsWithOverrides,
        constraints.zeroOrMaxViolations
      );
      option = runner(requestData.students, adjustedAdvisors, requestData.parameters, mode);
    }

    const minViolations = option.summary?.minimumCapacityViolations;
    if (minViolations && minViolations.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `    WARNING: minimum capacity still violated after Phase 3 for: ${minViolations.map((v) => `${v.name} (${v.current}/${v.minimum})`).join(', ')}`
      );
    }

    return option;
  };

  const reRunWithAdjustedAdvisors = (optionId, adjustedAdvisors) => {
    const runner = algorithms.find((a) => a.id === optionId)?.runner;
    if (!runner) return null;
    return runner(requestData.students, adjustedAdvisors, requestData.parameters, mode);
  };

  // STEP 1–3: Run algorithms
  const finalOptions = [];
  const labels = [
    '[1/3] Running water-filling algorithm (minimax)...',
    '[2/3] Running deferred acceptance algorithm (greedy)...',
    '[3/3] Running minimum regret algorithm...'
  ];
  for (let i = 0; i < algorithms.length; i += 1) {
    // eslint-disable-next-line no-console
    console.log(`  ${labels[i]}`);
    finalOptions.push(runAlgorithmWithRetry(algorithms[i].runner));
  }

  // STEP 4: LLM Validation of all three options
  // eslint-disable-next-line no-console
  console.log('  [4/4] Validating assignments with LLM...');
  const validationLLMPayloads = [];

  for (let i = 0; i < finalOptions.length; i += 1) {
    const option = finalOptions[i];
    const validationResult = await validateAssignments(
      requestData.advisors,
      requestData.students,
      requestData.parameters,
      option.assignments,
      extractedConstraints,
      realToPseudo,
      pseudoToReal,
      mode
    );

    const validation = validationResult.validation;
    validationLLMPayloads.push({
      optionId: option.id,
      payload: validationResult.llmPayload
    });

    finalOptions[i].validation = {
      warnings: validation.warnings || [],
      commentary: validation.commentary || []
    };

    if (!validation.isValid && validation.violations.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`    Option ${option.id} has violations:`, validation.violations);

      const violatedAdvisors = validation.violations
        .filter((v) => v.type === 'forbidden_pair' || v.type === 'required_pair')
        .map((v) => v.advisorName)
        .filter(Boolean);

      if (violatedAdvisors.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`    Retrying Option ${option.id} with adjusted constraints...`);

        const adjustedAdvisors = advisorsWithOverrides.map((advisor) => {
          if (violatedAdvisors.includes(advisor.name)) {
            return { ...advisor, capacity: 0 };
          }
          return advisor;
        });

        const retriedOption = reRunWithAdjustedAdvisors(option.id, adjustedAdvisors);

        if (retriedOption) {
          finalOptions[i] = retriedOption;

          const revalidationResult = await validateAssignments(
            requestData.advisors,
            requestData.students,
            requestData.parameters,
            finalOptions[i].assignments,
            extractedConstraints,
            realToPseudo,
            pseudoToReal,
            mode
          );

          const revalidation = revalidationResult.validation;
          validationLLMPayloads[i] = {
            optionId: option.id,
            payload: revalidationResult.llmPayload,
            retried: true
          };

          finalOptions[i].validation = {
            warnings: revalidation.warnings || [],
            commentary: revalidation.commentary || []
          };
        }
      }
    }

    if (validation.warnings && validation.warnings.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`    Option ${option.id} has ${validation.warnings.length} warning(s)`);
    }
  }

  const promptLog = {
    timestamp: new Date().toISOString(),
    approach: 'Three Deterministic Algorithms with LLM Constraint Extraction & Validation',
    extractedConstraints,
    capacityOverridesApplied: extractedConstraints.capacityOverrides || [],
    option1_stats: finalOptions[0].summary,
    option2_stats: finalOptions[1].summary,
    option3_stats: finalOptions[2].summary,
    request: requestData
  };

  await writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_prompt.json`), promptLog);

  const anonymizationLog = {
    timestamp: new Date().toISOString(),
    description:
      'This file shows exactly what data was sent to the LLM API. All names are pseudonymized with HMAC-SHA256 + random salt.',
    salt,
    nameMapping: {
      note: 'Mapping between real names and pseudonyms (only stored locally, never sent to API)',
      advisors: Array.from(realToPseudo.entries())
        .filter(([name]) => requestData.advisors.some((a) => a.name === name))
        .map(([real, pseudo]) => ({ real, pseudo })),
      students: Array.from(realToPseudo.entries())
        .filter(([name]) => requestData.students.some((s) => s.name === name))
        .map(([real, pseudo]) => ({ real, pseudo }))
    },
    constraintExtraction: extractionLLMPayload,
    validations: validationLLMPayloads
  };

  const outputWritePromises = finalOptions.map((option) =>
    writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_output${option.id}.json`), option)
  );
  outputWritePromises.push(saveOptionCSVs(lotterySlug, finalOptions, mode));
  outputWritePromises.push(
    writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_llm-payloads.json`), anonymizationLog)
  );

  // Generate XLSX for both modes
  if (mode === 'studio') {
    outputWritePromises.push(saveStudioXLSX(lotterySlug, requestData.students, finalOptions));
  } else {
    outputWritePromises.push(
      saveAdvisorXLSX(lotterySlug, requestData.students, requestData.advisors, finalOptions)
    );
  }

  saveSummaryTxt(lotterySlug, finalOptions, mode);
  await Promise.all(outputWritePromises);

  // eslint-disable-next-line no-console
  console.log('  ✓ Complete!\n');

  return {
    lotterySlug,
    mode,
    xlsxPath: `/download/${lotterySlug}_output.xlsx`,
    options: finalOptions.map((option) => ({
      id: option.id,
      summary: option.summary,
      csvPath: `/download/${lotterySlug}_output${option.id}.csv`,
      warning: null
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
    runJob(jobId, requestData, lotterySlug, mode);

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
 * No auth required — consistent with the zip endpoint below.
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
 * No auth required — the slug is derived from the lottery name and not easily guessable.
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
  console.log(`Advisor Lottery server listening on port ${port}`);
});
