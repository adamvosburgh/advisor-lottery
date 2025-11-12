const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const slugify = require('slugify');
const dotenv = require('dotenv');
const {
  validateRequestPayload,
  validateModelResponse,
  validateAndAnnotate
} = require('./utils/validate');
const { callModel } = require('./utils/hf');
const { OUTPUT_DIR, ensureOutputsDir, writeJSON } = require('./utils/fileio');
const { saveOptionCSVs } = require('./utils/csv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const JSON_BOUNDARY_REMINDER =
  'Return a single JSON object that starts with {"options": and ends with }';

function buildSystemPrompt(strategy) {
  const strategyDescriptions = {
    minimax: `OPTIMIZATION STRATEGY: BALANCED MINIMAX
Your goal is to minimize the worst placement (the highest rank number any student receives) while keeping the average placement low.

APPROACH:
1. Start by placing all students in their first choice
2. For advisors that are over-capacity, systematically reassign students to their next best available option
3. Continue this overflow redistribution until all capacity constraints are met
4. Prioritize moving students with the best alternative options to minimize the maximum displacement

This strategy ensures NO student receives a catastrophically bad placement, even if it means fewer students get their absolute first choice.`,

    greedy: `OPTIMIZATION STRATEGY: MAXIMIZE FIRST CHOICES
Your goal is to maximize the number of students who receive their first choice advisor.

APPROACH:
1. Assign as many students as possible to their #1 choice
2. For remaining students, assign them to their best available option
3. Accept that some students may receive significantly lower placements if it means more students overall get their first choice

This strategy prioritizes the total count of first-choice placements over fairness of distribution.`,

    average: `OPTIMIZATION STRATEGY: MINIMIZE AVERAGE PLACEMENT
Your goal is to achieve the lowest possible average rank across all students.

APPROACH:
1. Consider global trade-offs where moving one student from rank 1 to rank 2 might allow two students to move from rank 5 to rank 1
2. Make strategic sacrifices across multiple students for overall statistical optimization
3. Balance between maximizing first choices and minimizing worst-case scenarios

This strategy finds the best overall statistical outcome through strategic compromises.`
  };

  return `You are an academic lottery assistant. You receive structured JSON input and must produce valid JSON output.

The structured JSON input that you will receive will feature:
1. A list of advisors, each with a capacity, and sometimes notes.
2. A list of students, each with a list of their preferred advisors in order of first to last preference.

HARD CONSTRAINTS (MUST BE SATISFIED):
1. Each advisor can have AT MOST their "capacity" number of students (never exceed this)
2. If an advisor has a note like "Must have either 0 or X students", they must have EXACTLY 0 or EXACTLY X students (no other numbers)
3. Each student must be assigned to exactly one advisor

${strategyDescriptions[strategy]}

OUTPUT FORMAT:
${JSON_BOUNDARY_REMINDER}
Produce ONE option that respects ALL hard constraints and follows the optimization strategy above.
Include a complete assignments list for every student, and a summary object that explains the results.

{
  "options": [
    {
      "id": 1,
      "assignments": [{ "student": "<name>", "advisor": "<name>", "rank": <integer 1-based position in preference list> }],
      "summary": {
        "algorithm": "<short description of strategy used>",
        "averagePlacement": <number>,
        "percentFirstChoice": <number between 0 and 1>,
        "lowestPlacement": <integer>,
        "notes": "<explanation of key trade-offs made>"
      }
    }
  ]
}

Return only JSON. No explanatory text outside the JSON structure.`;
}

const BASE_USER_DIRECTIVE = `Treat notes and explicit forbiddances as hard constraints; treat other parameter preferences as soft. Produce one optimized solution following the specified strategy. ${JSON_BOUNDARY_REMINDER} It is fine for advisors to receive zero students as long as all capacities and notes are obeyed.`;

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
const MAX_MODEL_ATTEMPTS = 4;

function buildPromptPayload(lotterySlug, requestData) {
  return {
    lottery_name: lotterySlug,
    advisors: requestData.advisors,
    students: requestData.students,
    parameters: requestData.parameters
  };
}

function buildUserPrompt(lotterySlug, requestData) {
  const payload = buildPromptPayload(lotterySlug, requestData);
  const payloadJSON = JSON.stringify(payload, null, 2);
  return `${BASE_USER_DIRECTIVE}
${payloadJSON}`;
}

function buildCorrectionPrompt(lotterySlug, requestData, currentJSON, violations) {
  const violationJSON = JSON.stringify(violations, null, 2);
  const previousJSON = JSON.stringify(currentJSON, null, 2);
  const payload = buildPromptPayload(lotterySlug, requestData);
  const payloadJSON = JSON.stringify(payload, null, 2);
  return `${BASE_USER_DIRECTIVE}

Your prior JSON violated these constraints: ${violationJSON}

CRITICAL REMINDER:
1. Each advisor's "capacity" is the MAXIMUM number of students they can have (never exceed this)
2. If an advisor has a note like "Must have either 0 or X students", they must have EXACTLY 0 or EXACTLY X students (no other numbers allowed)
3. You must assign ONLY the students from the input data - do not invent students or assign advisors as if they were students
4. Every student from the input must be assigned exactly once

Please return corrected JSON, changing as little as possible, preserving option IDs.
Reference JSON you produced:
${previousJSON}

Original request for reference:
${payloadJSON}`;
}

function buildRepairPrompt(lotterySlug, requestData, invalidText) {
  const payload = buildPromptPayload(lotterySlug, requestData);
  const payloadJSON = JSON.stringify(payload, null, 2);
  return `${BASE_USER_DIRECTIVE}

Your previous response was not valid JSON. ${JSON_BOUNDARY_REMINDER}
Original request:
${payloadJSON}

Previous invalid response:
${invalidText}`;
}

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

function cleanModelText(text) {
  if (typeof text !== 'string') {
    return '';
  }

  let trimmed = text.trim();

  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    trimmed = fenced[1].trim();
  }

  return trimmed;
}

function tryParseJSON(text) {
  const attempts = [];
  const cleaned = cleanModelText(text);

  if (cleaned) {
    attempts.push(cleaned);
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      attempts.push(cleaned.slice(firstBrace, lastBrace + 1));
    }
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      continue;
    }
  }

  return null;
}

async function persistRawResponses(lotterySlug, rawResponses) {
  if (!rawResponses.length) {
    return;
  }

  try {
    await writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_raw_responses.json`), rawResponses);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Failed to persist raw model responses', error);
  }
}

async function runStrategyAttempt(strategy, requestData, lotterySlug, temperature) {
  const systemPrompt = buildSystemPrompt(strategy);
  const userPrompt = buildUserPrompt(lotterySlug, requestData);
  const rawResponses = [];

  for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
    let modelText;
    let currentPrompt = attempt === 0 ? userPrompt : rawResponses[rawResponses.length - 1].nextPrompt;
    let promptLabel = attempt === 0 ? 'initial' : rawResponses[rawResponses.length - 1].nextLabel;

    try {
      modelText = await callModel(systemPrompt, currentPrompt, temperature);
    } catch (error) {
      return { success: false, error: error.message || 'Model call failed.', rawResponses };
    }

    rawResponses.push({ attempt: promptLabel, text: modelText, strategy });

    const parsedJSON = tryParseJSON(modelText);
    if (!parsedJSON) {
      if (attempt === MAX_MODEL_ATTEMPTS - 1) {
        return { success: false, error: 'Model failed to return valid JSON after multiple retries.', rawResponses };
      }
      rawResponses[rawResponses.length - 1].nextPrompt = buildRepairPrompt(lotterySlug, requestData, modelText);
      rawResponses[rawResponses.length - 1].nextLabel = `repair-${attempt + 1}`;
      continue;
    }

    let modelResponse;
    try {
      modelResponse = validateModelResponse(parsedJSON);
    } catch (schemaError) {
      if (attempt === MAX_MODEL_ATTEMPTS - 1) {
        return {
          success: false,
          error: 'Model response did not match expected schema.',
          details: serializeZodError(schemaError),
          rawResponses
        };
      }
      rawResponses[rawResponses.length - 1].nextPrompt = buildRepairPrompt(
        lotterySlug,
        requestData,
        JSON.stringify(parsedJSON, null, 2)
      );
      rawResponses[rawResponses.length - 1].nextLabel = `schema-${attempt + 1}`;
      continue;
    }

    const annotated = validateAndAnnotate(requestData, modelResponse);
    if (annotated.violationsByOption.length === 0) {
      return { success: true, option: annotated.options[0], rawResponses };
    }

    if (attempt === MAX_MODEL_ATTEMPTS - 1) {
      return {
        success: false,
        error: 'Model could not satisfy hard constraints after multiple attempts.',
        violations: annotated.violationsByOption,
        rawResponses
      };
    }

    rawResponses[rawResponses.length - 1].nextPrompt = buildCorrectionPrompt(
      lotterySlug,
      requestData,
      modelResponse,
      annotated.violationsByOption
    );
    rawResponses[rawResponses.length - 1].nextLabel = `correction-${attempt + 1}`;
  }

  return { success: false, error: 'Max attempts reached without solution.', rawResponses };
}

function selectBestOption(options, strategy) {
  if (options.length === 0) return null;
  if (options.length === 1) return options[0];

  if (strategy === 'minimax') {
    // Minimize the worst placement (lowestPlacement is actually the highest rank number)
    return options.reduce((best, current) => {
      if (current.summary.lowestPlacement < best.summary.lowestPlacement) return current;
      if (current.summary.lowestPlacement === best.summary.lowestPlacement) {
        // Tie-breaker: better average
        return current.summary.averagePlacement < best.summary.averagePlacement ? current : best;
      }
      return best;
    });
  } else if (strategy === 'greedy') {
    // Maximize first choice percentage
    return options.reduce((best, current) => {
      if (current.summary.percentFirstChoice > best.summary.percentFirstChoice) return current;
      if (current.summary.percentFirstChoice === best.summary.percentFirstChoice) {
        // Tie-breaker: better average
        return current.summary.averagePlacement < best.summary.averagePlacement ? current : best;
      }
      return best;
    });
  } else if (strategy === 'average') {
    // Minimize average placement
    return options.reduce((best, current) => {
      if (current.summary.averagePlacement < best.summary.averagePlacement) return current;
      if (current.summary.averagePlacement === best.summary.averagePlacement) {
        // Tie-breaker: better worst case
        return current.summary.lowestPlacement < best.summary.lowestPlacement ? current : best;
      }
      return best;
    });
  }

  return options[0];
}

function enhanceSummaryWithStrategy(option, strategy) {
  const strategyLabels = {
    minimax: 'Balanced Minimax - Minimizes worst-case placement',
    greedy: 'Maximize First Choices - Prioritizes number of students getting #1',
    average: 'Minimize Average - Optimizes overall statistical satisfaction'
  };

  return {
    ...option,
    summary: {
      ...option.summary,
      strategyUsed: strategyLabels[strategy],
      algorithm: `${option.summary.algorithm} (${strategy})`
    }
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

    // Log the initial prompt info
    const promptLog = {
      timestamp: new Date().toISOString(),
      strategies: ['minimax', 'greedy', 'average'],
      attemptsPerStrategy: 3,
      temperature: 0.8,
      request: requestData
    };

    await writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_prompt.json`), promptLog);

    // Run 9 attempts: 3 for each strategy
    const strategies = ['minimax', 'greedy', 'average'];
    const allRawResponses = [];
    const resultsByStrategy = {
      minimax: [],
      greedy: [],
      average: []
    };

    // eslint-disable-next-line no-console
    console.log(`Running 9 lottery attempts (3 per strategy) for ${lotterySlug}...`);

    for (const strategy of strategies) {
      for (let run = 0; run < 3; run += 1) {
        // eslint-disable-next-line no-console
        console.log(`  Strategy: ${strategy}, Run: ${run + 1}/3`);

        const result = await runStrategyAttempt(strategy, requestData, lotterySlug, 0.8);

        allRawResponses.push({
          strategy,
          run: run + 1,
          ...result
        });

        if (result.success) {
          resultsByStrategy[strategy].push(result.option);
        }
      }
    }

    // Save all raw responses
    await persistRawResponses(lotterySlug, allRawResponses);

    // Select the best option for each strategy
    const finalOptions = [];
    let hasAnySuccess = false;

    for (let i = 0; i < strategies.length; i += 1) {
      const strategy = strategies[i];
      const options = resultsByStrategy[strategy];

      if (options.length > 0) {
        hasAnySuccess = true;
        const bestOption = selectBestOption(options, strategy);
        const enhancedOption = enhanceSummaryWithStrategy(bestOption, strategy);
        enhancedOption.id = i + 1; // Assign IDs 1, 2, 3
        finalOptions.push(enhancedOption);
      }
    }

    if (!hasAnySuccess) {
      return res.status(502).json({
        error: 'All attempts failed to produce valid solutions.',
        details: 'Check raw responses for debugging information.'
      });
    }

    // If some strategies failed, we still return the successful ones
    if (finalOptions.length < 3) {
      // eslint-disable-next-line no-console
      console.warn(`Only ${finalOptions.length}/3 strategies succeeded for ${lotterySlug}`);
    }

    // Write output files
    const outputWritePromises = finalOptions.map((option) =>
      writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_output${option.id}.json`), option)
    );
    outputWritePromises.push(saveOptionCSVs(lotterySlug, finalOptions));
    await Promise.all(outputWritePromises);

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
