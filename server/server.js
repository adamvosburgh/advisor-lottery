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

const SYSTEM_PROMPT = `You are an academic lottery assistant. You receive structured JSON input and must produce valid JSON output.

The structured JSON input that you will receive will feature:
1. A list of advisors, each with a capacity, and sometimes notes.
2. A list of students, each with a list of their preferred advisors in order of first to last preference.

HARD CONSTRAINTS (MUST BE SATISFIED):
1. Each advisor can have AT MOST their "capacity" number of students (never exceed this)
2. If an advisor has a note like "Must have either 0 or X students", they must have EXACTLY 0 or EXACTLY X students (no other numbers)
3. Each student must be assigned to exactly one advisor

OUTPUT FORMAT:
${JSON_BOUNDARY_REMINDER}
Produce three distinct options that respect ALL hard constraints and aim for highest average rank.
For each option: include a complete assignments list for every student, and a summary object that explains algorithmic logic and trade-offs.

{
  "options": [
    {
      "id": 1,
      "assignments": [{ "student": "<name>", "advisor": "<name>", "rank": <integer 1-based position in preference list> }],
      "summary": {
        "algorithm": "<short description>",
        "averagePlacement": <number>,
        "percentFirstChoice": <number between 0 and 1>,
        "lowestPlacement": <integer>,
        "notes": "<short bullet-like paragraph>"
      }
    },
    { ... id:2 ... },
    { ... id:3 ... }
  ]
}

Return only JSON. No explanatory text outside the JSON structure.`;

const BASE_USER_DIRECTIVE = `Treat notes and explicit forbiddances as hard constraints; treat other parameter preferences as soft. Produce three different viable options. ${JSON_BOUNDARY_REMINDER} It is fine for advisors to receive zero students as long as all capacities and notes are obeyed.`;

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

    const promptLog = {
      timestamp: new Date().toISOString(),
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(lotterySlug, requestData),
      request: requestData
    };

    await writeJSON(path.join(OUTPUT_DIR, `${lotterySlug}_prompt.json`), promptLog);

    const rawResponses = [];
    let currentPrompt = promptLog.userPrompt;
    let promptLabel = 'initial';
    let finalOptions = null;
    for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
      let modelText;
      try {
        modelText = await callModel(SYSTEM_PROMPT, currentPrompt);
      } catch (error) {
        await persistRawResponses(lotterySlug, rawResponses);
        return res.status(502).json({ error: error.message || 'Model call failed.' });
      }

      rawResponses.push({ attempt: promptLabel, text: modelText });

      const parsedJSON = tryParseJSON(modelText);
      if (!parsedJSON) {
        if (attempt === MAX_MODEL_ATTEMPTS - 1) {
          await persistRawResponses(lotterySlug, rawResponses);
          return res
            .status(502)
            .json({ error: 'Model failed to return valid JSON after multiple retries.' });
        }

        currentPrompt = buildRepairPrompt(lotterySlug, requestData, modelText);
        promptLabel = `repair-${attempt + 1}`;
        continue;
      }

      let modelResponse;
      try {
        modelResponse = validateModelResponse(parsedJSON);
      } catch (schemaError) {
        if (attempt === MAX_MODEL_ATTEMPTS - 1) {
          await persistRawResponses(lotterySlug, rawResponses);
        return res.status(502).json({
          error: 'Model response did not match expected schema.',
          details: serializeZodError(schemaError)
        });
        }

        currentPrompt = buildRepairPrompt(
          lotterySlug,
          requestData,
          JSON.stringify(parsedJSON, null, 2)
        );
        promptLabel = `schema-${attempt + 1}`;
        continue;
      }

      const annotated = validateAndAnnotate(requestData, modelResponse);
      if (annotated.violationsByOption.length === 0) {
        finalOptions = annotated.options;
        lastViolations = null;
        break;
      }

      if (attempt === MAX_MODEL_ATTEMPTS - 1) {
        await persistRawResponses(lotterySlug, rawResponses);
        return res.status(422).json({
          error: 'Model could not satisfy hard constraints after multiple attempts.',
          violations: annotated.violationsByOption
        });
      }

      currentPrompt = buildCorrectionPrompt(
        lotterySlug,
        requestData,
        modelResponse,
        annotated.violationsByOption
      );
      promptLabel = `correction-${attempt + 1}`;
    }

    if (!finalOptions) {
      await persistRawResponses(lotterySlug, rawResponses);
      return res.status(502).json({ error: 'Model did not return a valid solution.' });
    }

    await persistRawResponses(lotterySlug, rawResponses);

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
