/**
 * Advisor Lottery Server
 *
 * Architecture:
 * 1. Three deterministic matching algorithms generate optimal assignments
 *    - Water-Filling: Minimizes worst-case placement (minimax)
 *    - Deferred Acceptance: Maximizes first-choice assignments (greedy)
 *    - Minimum Regret: Balances overall satisfaction
 *
 * 2. LLM (Llama-3.1-70B) handles natural language processing
 *    - Extracts constraints from advisor notes and parameters
 *    - Validates algorithm outputs for constraint violations
 *    - Triggers retries with adjusted constraints when violations detected
 *
 * 3. Robust error handling with fallbacks
 *    - LLM failures fall back to regex-based validation
 *    - Algorithm adjustments handle conditional capacity constraints
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const slugify = require('slugify');
const dotenv = require('dotenv');
const { validateRequestPayload, validateAndAnnotate } = require('./utils/validate');
const { extractConstraints, validateAssignments } = require('./utils/hf');
const { OUTPUT_DIR, ensureOutputsDir, writeJSON } = require('./utils/fileio');
const { saveOptionCSVs } = require('./utils/csv');
const { createNameMapping } = require('./utils/anonymize');
const {
  runWaterFillingAlgorithm,
  runDeferredAcceptance,
  runMinimumRegretAlgorithm,
  validateConstraints,
  adjustAdvisorsForRetry
} = require('./utils/algorithms');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();

app.use(
  cors({
    origin: 'http://localhost:3000'
  })
);
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

const sharedPassword = process.env.APP_SHARED_PASSWORD;
const port = process.env.PORT || 3001;

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

app.post('/api/run', async (req, res) => {
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

    // eslint-disable-next-line no-console
    console.log(`\nRunning advisor lottery for ${lotterySlug}...`);

    // Create name mapping for anonymization with random salt
    const { realToPseudo, pseudoToReal, salt } = createNameMapping(
      requestData.advisors,
      requestData.students
    );

    // STEP 0: Extract constraints using LLM
    // eslint-disable-next-line no-console
    console.log('  [0/3] Extracting constraints from natural language...');
    const extractionResult = await extractConstraints(
      requestData.advisors,
      requestData.parameters,
      realToPseudo,
      pseudoToReal
    );
    const extractedConstraints = extractionResult.constraints;
    const extractionLLMPayload = extractionResult.llmPayload;

    // STEP 1: Run Water-Filling Algorithm (Option 1)
    // eslint-disable-next-line no-console
    console.log('  [1/3] Running water-filling algorithm (minimax)...');
    let option1 = runWaterFillingAlgorithm(
      requestData.students,
      requestData.advisors,
      requestData.parameters
    );

    // Check for constraint violations and retry if needed
    let constraints1 = validateConstraints(
      option1.assignments,
      requestData.advisors,
      requestData.students,
      requestData.parameters
    );

    if (constraints1.hasViolations && constraints1.zeroOrMaxViolations.length > 0) {
      // eslint-disable-next-line no-console
      console.log('    Constraint violation detected, adjusting and retrying...');
      const adjustedAdvisors = adjustAdvisorsForRetry(
        requestData.advisors,
        constraints1.zeroOrMaxViolations
      );
      option1 = runWaterFillingAlgorithm(
        requestData.students,
        adjustedAdvisors,
        requestData.parameters
      );
    }

    // STEP 2: Run Deferred Acceptance (Option 2)
    // eslint-disable-next-line no-console
    console.log('  [2/3] Running deferred acceptance algorithm (greedy)...');
    let option2 = runDeferredAcceptance(
      requestData.students,
      requestData.advisors,
      requestData.parameters
    );

    // Check for constraint violations and retry if needed
    let constraints2 = validateConstraints(
      option2.assignments,
      requestData.advisors,
      requestData.students,
      requestData.parameters
    );

    if (constraints2.hasViolations && constraints2.zeroOrMaxViolations.length > 0) {
      // eslint-disable-next-line no-console
      console.log('    Constraint violation detected, adjusting and retrying...');
      const adjustedAdvisors = adjustAdvisorsForRetry(
        requestData.advisors,
        constraints2.zeroOrMaxViolations
      );
      option2 = runDeferredAcceptance(
        requestData.students,
        adjustedAdvisors,
        requestData.parameters
      );
    }

    // STEP 3: Run Minimum Regret Algorithm (Option 3)
    // eslint-disable-next-line no-console
    console.log('  [3/3] Running minimum regret algorithm...');
    let option3 = runMinimumRegretAlgorithm(
      requestData.students,
      requestData.advisors,
      requestData.parameters
    );

    // Check for constraint violations and retry if needed
    let constraints3 = validateConstraints(
      option3.assignments,
      requestData.advisors,
      requestData.students,
      requestData.parameters
    );

    if (constraints3.hasViolations && constraints3.zeroOrMaxViolations.length > 0) {
      // eslint-disable-next-line no-console
      console.log('    Constraint violation detected, adjusting and retrying...');
      const adjustedAdvisors = adjustAdvisorsForRetry(
        requestData.advisors,
        constraints3.zeroOrMaxViolations
      );
      option3 = runMinimumRegretAlgorithm(
        requestData.students,
        adjustedAdvisors,
        requestData.parameters
      );
    }

    // STEP 4: LLM Validation of all three options
    // eslint-disable-next-line no-console
    console.log('  [4/4] Validating assignments with LLM...');
    const finalOptions = [option1, option2, option3];
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
        pseudoToReal
      );

      const validation = validationResult.validation;
      validationLLMPayloads.push({
        optionId: option.id,
        payload: validationResult.llmPayload
      });

      // Attach validation results to the option for frontend display
      finalOptions[i].validation = {
        warnings: validation.warnings || [],
        commentary: validation.commentary || []
      };

      // Replace technical notes with user-facing summary if available
      if (validation.userFacingSummary) {
        finalOptions[i].summary.notes = validation.userFacingSummary;
      }

      if (!validation.isValid && validation.violations.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`    Option ${option.id} has violations:`, validation.violations);

        // Try to identify which advisors need adjustment for hard constraint violations
        const violatedAdvisors = validation.violations
          .filter((v) => v.type === 'conditional_capacity' || v.type === 'required_pair')
          .map((v) => v.advisorName)
          .filter(Boolean);

        if (violatedAdvisors.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`    Retrying Option ${option.id} with adjusted constraints...`);

          // Set violating advisors to capacity 0
          const adjustedAdvisors = requestData.advisors.map((advisor) => {
            if (violatedAdvisors.includes(advisor.name)) {
              return { ...advisor, capacity: 0 };
            }
            return advisor;
          });

          // Re-run the algorithm
          if (option.id === 1) {
            finalOptions[i] = runWaterFillingAlgorithm(
              requestData.students,
              adjustedAdvisors,
              requestData.parameters
            );
          } else if (option.id === 2) {
            finalOptions[i] = runDeferredAcceptance(
              requestData.students,
              adjustedAdvisors,
              requestData.parameters
            );
          } else if (option.id === 3) {
            finalOptions[i] = runMinimumRegretAlgorithm(
              requestData.students,
              adjustedAdvisors,
              requestData.parameters
            );
          }

          // Re-validate after retry
          const revalidationResult = await validateAssignments(
            requestData.advisors,
            requestData.students,
            requestData.parameters,
            finalOptions[i].assignments,
            extractedConstraints,
            realToPseudo,
            pseudoToReal
          );

          const revalidation = revalidationResult.validation;
          // Update the validation payload with retry data
          validationLLMPayloads[i] = {
            optionId: option.id,
            payload: revalidationResult.llmPayload,
            retried: true
          };

          finalOptions[i].validation = {
            warnings: revalidation.warnings || [],
            commentary: revalidation.commentary || []
          };

          // Replace technical notes with user-facing summary if available
          if (revalidation.userFacingSummary) {
            finalOptions[i].summary.notes = revalidation.userFacingSummary;
          }
        }
      }

      // Log warnings and commentary
      if (validation.warnings && validation.warnings.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`    Option ${option.id} has ${validation.warnings.length} warning(s)`);
      }
      if (validation.commentary && validation.commentary.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`    Option ${option.id} commentary: ${validation.commentary.length} goal(s) assessed`);
      }
    }

    // Log results
    const promptLog = {
      timestamp: new Date().toISOString(),
      approach: 'Three Deterministic Algorithms with LLM Constraint Extraction & Validation',
      extractedConstraints,
      option1_stats: finalOptions[0].summary,
      option2_stats: finalOptions[1].summary,
      option3_stats: finalOptions[2].summary,
      request: requestData
    };

    await writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_prompt.json`), promptLog);

    // Write anonymized LLM payloads for transparency
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

    // Write output files
    const outputWritePromises = finalOptions.map((option) =>
      writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_output${option.id}.json`), option)
    );
    outputWritePromises.push(saveOptionCSVs(lotterySlug, finalOptions));
    outputWritePromises.push(
      writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_llm-payloads.json`), anonymizationLog)
    );
    await Promise.all(outputWritePromises);

    // eslint-disable-next-line no-console
    console.log('  ✓ Complete!\n');

    const responsePayload = {
      lotterySlug,
      options: finalOptions.map((option) => ({
        id: option.id,
        summary: option.summary,
        csvPath: `/download/${lotterySlug}_output${option.id}.csv`,
        warning: null
      }))
    };

    return res.json(responsePayload);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Advisor Lottery server listening on port ${port}`);
});
