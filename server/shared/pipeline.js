const path = require('path');
const { randomBytes } = require('crypto');

const { extractConstraints, validateAssignments } = require('./constraints');
const { OUTPUT_DIR, writeJSON } = require('./fileio');
const { saveOptionCSVs } = require('./csv');
const { saveStudioXLSX } = require('../studio/xlsx');
const { saveAdvisorXLSX } = require('../advisor/xlsx');
const { createNameMapping } = require('./anonymize');
const { saveSummaryTxt } = require('./summary');
const {
  normalizeKey,
  runWaterFillingAlgorithm,
  runDeferredAcceptance,
  runMinimumRegretAlgorithm,
  validateConstraints: validateAlgorithmConstraints,
  adjustAdvisorsForRetry
} = require('./algorithms');

const N_RUNS = 10;

/**
 * Apply per-entity capacity overrides extracted from additional parameters.
 * Override minCapacity and/or maxCapacity (capacity) for named advisors/studios.
 * Per-entity overrides take precedence over the global default.
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

/**
 * Fisher-Yates shuffle of an array in place using crypto.randomBytes.
 */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Select the run with the best primary metric, breaking ties with averagePlacement (lower = better).
 * @param {Array<{result: object, run: number}>} candidates
 * @param {string} primaryKey - summary field to optimize
 * @param {boolean} primaryAsc - true = lower is better, false = higher is better
 */
function selectBestRun(candidates, primaryKey, primaryAsc) {
  return candidates.reduce((best, curr) => {
    const bv = best.result.summary[primaryKey];
    const cv = curr.result.summary[primaryKey];
    const better = primaryAsc ? cv < bv : cv > bv;
    if (better) return curr;
    if (cv === bv && curr.result.summary.averagePlacement < best.result.summary.averagePlacement) return curr;
    return best;
  });
}

function createJobId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function runJob(jobId, jobs, requestData, lotterySlug, mode) {
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

  // Capture original input order once — used for run 1 (deterministic baseline) and output re-sort
  const originalOrder = new Map(requestData.students.map((s, i) => [s.name, i]));

  const algorithms = [
    { id: 1, runner: runWaterFillingAlgorithm },
    { id: 2, runner: runDeferredAcceptance },
    { id: 3, runner: runMinimumRegretAlgorithm }
  ];

  // STEP 0: Extract constraints using LLM once, before the run loop
  const hasParameters = requestData.parameters != null && requestData.parameters.trim().length > 0;
  const hasNotes = requestData.advisors.some((a) => a.notes != null && a.notes.trim().length > 0);

  let extractionResult;
  if (!hasParameters && !hasNotes) {
    // eslint-disable-next-line no-console
    console.log('  [0] Skipping LLM — no natural language content to parse.');
    extractionResult = {
      constraints: {
        hardConstraints: { conditionalCapacity: [], forbiddenPairs: [], requiredPairs: [] },
        capacityOverrides: [],
        softConstraints: [],
        optimizationGoals: []
      },
      llmPayload: null
    };
  } else {
    // eslint-disable-next-line no-console
    console.log('  [0] Extracting constraints from natural language...');
    extractionResult = await extractConstraints(
      requestData.advisors,
      requestData.parameters,
      realToPseudo,
      pseudoToReal,
      mode
    );
  }
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

  const runAlgorithmWithRetry = (runner, studentsForRun) => {
    let option = runner(studentsForRun, advisorsWithOverrides, requestData.parameters, mode);
    const constraints = validateAlgorithmConstraints(
      option.assignments,
      advisorsWithOverrides,
      studentsForRun,
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
      option = runner(studentsForRun, adjustedAdvisors, requestData.parameters, mode);
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

  // STEPS 1–3: Run all three algorithms N_RUNS times, collecting candidates per algorithm
  // eslint-disable-next-line no-console
  console.log(`  Running ${N_RUNS} iterations (run 1 uses original order, runs 2–${N_RUNS} shuffled)...`);

  const candidatesPerAlgo = [[], [], []];

  for (let run = 1; run <= N_RUNS; run += 1) {
    // Run 1: original input order (deterministic baseline). Subsequent runs: fresh shuffled copy.
    const studentsForRun = [...requestData.students];
    if (run > 1) {
      shuffleInPlace(studentsForRun);
    }

    // eslint-disable-next-line no-console
    console.log(`  [Run ${run}/${N_RUNS}]`);
    for (let a = 0; a < algorithms.length; a += 1) {
      const result = runAlgorithmWithRetry(algorithms[a].runner, studentsForRun);
      candidatesPerAlgo[a].push({ result, run });
    }
  }

  // Select best result per algorithm based on each algorithm's optimization target
  // Option 1 (Water-Filling): lowest averagePlacement
  // Option 2 (Deferred Acceptance): highest percentFirstChoice, tiebreak lowest averagePlacement
  // Option 3 (Minimum Regret): lowest lowestPlacement (best worst-case), tiebreak lowest averagePlacement
  const winners = [
    selectBestRun(candidatesPerAlgo[0], 'averagePlacement', true),
    selectBestRun(candidatesPerAlgo[1], 'percentFirstChoice', false),
    selectBestRun(candidatesPerAlgo[2], 'lowestPlacement', true),
  ];

  // eslint-disable-next-line no-console
  console.log(
    `  Best runs selected: Option 1 → run ${winners[0].run}, Option 2 → run ${winners[1].run}, Option 3 → run ${winners[2].run}`
  );

  const finalOptions = winners.map(({ result, run }) => ({ ...result, runNumber: run }));

  // STEP 4: Deterministic validation of all three winning options
  // eslint-disable-next-line no-console
  console.log('  Validating assignments...');

  for (let i = 0; i < finalOptions.length; i += 1) {
    const option = finalOptions[i];
    const validation = validateAssignments(
      advisorsWithOverrides,
      requestData.students,
      option.assignments,
      extractedConstraints
    );

    finalOptions[i].validation = validation;

    if (!validation.isValid) {
      // eslint-disable-next-line no-console
      console.log(`    Option ${option.id} has violations:`, validation.violations);
    }
  }

  // Restore input xlsx row order in students array and each option's assignments
  // so output rows align with the original spreadsheet regardless of algorithm used
  requestData.students.sort((a, b) => originalOrder.get(a.name) - originalOrder.get(b.name));
  for (const option of finalOptions) {
    option.assignments.sort(
      (a, b) =>
        (originalOrder.get(a.student) ?? Infinity) - (originalOrder.get(b.student) ?? Infinity)
    );
  }

  const promptLog = {
    timestamp: new Date().toISOString(),
    approach: 'Three Deterministic Algorithms with LLM Constraint Extraction & Deterministic Validation',
    nRuns: N_RUNS,
    winningRuns: { option1: winners[0].run, option2: winners[1].run, option3: winners[2].run },
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
    constraintExtraction: extractionLLMPayload
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
  console.log('  Complete!\n');

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

module.exports = {
  createJobId,
  runJob
};
