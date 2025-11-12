const HF_MODEL = 'meta-llama/Llama-3.1-70B-Instruct';
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions';

async function callModel(systemPrompt, userPrompt, temperature = 0) {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    throw new Error('HF_API_KEY is not configured');
  }

  const payload = {
    model: HF_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 4096,
    temperature,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hugging Face API error (${response.status}): ${text}`);
  }

  const result = await response.json();

  const choice = result?.choices?.[0];
  const message = choice?.message;
  const content = Array.isArray(message?.content)
    ? message.content
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item && typeof item.text === 'string') {
            return item.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('')
    : typeof message?.content === 'string'
      ? message.content
      : '';

  if (!content) {
    throw new Error(`Received empty response from Hugging Face Inference API. Raw: ${JSON.stringify(result)}`);
  }

  return content;
}

/**
 * Extract constraints and preferences from natural language using LLM
 * Categorizes into hard constraints, soft constraints, and optimization goals
 *
 * @param {Array} advisors - Real advisor data
 * @param {string} parameters - Additional parameters text
 * @param {Map} realToPseudo - Name mapping for anonymization
 * @param {Map} pseudoToReal - Reverse mapping for de-anonymization
 */
async function extractConstraints(advisors, parameters, realToPseudo, pseudoToReal) {
  const systemPrompt = `You are a constraint extraction assistant. Parse natural language text to identify assignment rules and preferences.

Categorize into three types:

1. HARD CONSTRAINTS (must be satisfied - violations require algorithm retry):
   - Conditional capacity: "must have 0 or 2", "needs 1 or 3", "all or nothing", "either X or Y students"
   - Forbidden pairs: "cannot work with", "does not want", "should avoid", "won't advise"
   - Required pairs: "must work with", "should be assigned to"

2. SOFT CONSTRAINTS (should be satisfied - generate warnings if not met):
   - Preferences: "prefer", "would like", "ideally", "if possible"
   - Priorities: "priority should be given to", "senior students first"
   - Balance goals: "try to balance", "avoid having too many/few"

3. OPTIMIZATION GOALS (guide user's choice - generate commentary):
   - Minimize/maximize metrics: "minimize travel", "maximize satisfaction"
   - Distribution preferences: "spread evenly", "avoid concentrating"
   - General objectives: "fairness", "equity", "workload balance"

Return a JSON object:
{
  "hardConstraints": {
    "conditionalCapacity": [
      {"advisorName": "string", "allowedCounts": [0, 2], "rawText": "original text"}
    ],
    "forbiddenPairs": [
      {"advisorName": "string", "studentName": "string", "rawText": "original text"}
    ],
    "requiredPairs": [
      {"advisorName": "string", "studentName": "string", "rawText": "original text"}
    ]
  },
  "softConstraints": [
    {"type": "preference" | "priority" | "balance", "scope": "global" | "specific", "target": "string (advisor/student name if specific)", "description": "clear description", "rawText": "original text"}
  ],
  "optimizationGoals": [
    {"type": "minimize" | "maximize" | "distribute" | "general", "metric": "string (what to optimize)", "description": "clear description", "rawText": "original text"}
  ]
}`;

  const { anonymizeAdvisors, anonymizeText, deanonymizeConstraints } = require('./anonymize');

  // Anonymize advisor data before sending to LLM
  const anonymizedAdvisors = anonymizeAdvisors(advisors, realToPseudo);
  const anonymizedParameters = anonymizeText(parameters, realToPseudo);

  const advisorConstraints = anonymizedAdvisors
    .filter((a) => a.notes && a.notes.trim().length > 0)
    .map((a) => `Advisor "${a.name}" (capacity ${a.capacity}): ${a.notes}`)
    .join('\n');

  const userPrompt = `Extract and categorize all constraints, preferences, and goals from the following:

ADVISORS:
${advisorConstraints || 'None'}

ADDITIONAL PARAMETERS:
${anonymizedParameters || 'None'}

Return only the JSON object, no additional text.`;

  try {
    const response = await callModel(systemPrompt, userPrompt, 0);
    const cleaned = response.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '');
    const anonymizedConstraints = JSON.parse(cleaned);

    // De-anonymize the results before returning
    const deanonymizedConstraints = deanonymizeConstraints(anonymizedConstraints, pseudoToReal);

    // Return both de-anonymized results and the anonymized data sent to LLM
    return {
      constraints: deanonymizedConstraints,
      llmPayload: {
        systemPrompt,
        userPrompt,
        anonymizedAdvisors,
        anonymizedParameters
      }
    };
  } catch (error) {
    console.warn('LLM constraint extraction failed, using empty constraints:', error.message);
    return {
      constraints: {
        hardConstraints: { conditionalCapacity: [], forbiddenPairs: [], requiredPairs: [] },
        softConstraints: [],
        optimizationGoals: []
      },
      llmPayload: null
    };
  }
}

/**
 * Validate algorithm outputs using LLM
 * Returns violations (hard), warnings (soft), and commentary (optimization goals)
 *
 * @param {Array} advisors - Real advisor data
 * @param {Array} students - Real student data
 * @param {string} parameters - Additional parameters text
 * @param {Array} assignments - Algorithm assignments
 * @param {Object} extractedConstraints - Already de-anonymized constraints
 * @param {Map} realToPseudo - Name mapping for anonymization
 * @param {Map} pseudoToReal - Reverse mapping for de-anonymization
 */
async function validateAssignments(advisors, students, parameters, assignments, extractedConstraints, realToPseudo, pseudoToReal) {
  const systemPrompt = `You are an assignment validator. Evaluate assignments against constraints and preferences.

Review THREE categories:

1. HARD CONSTRAINTS (violations block the solution):
   - Conditional capacity: advisor must have specific student counts
   - Forbidden pairs: specific advisor-student pairs that cannot be matched
   - Required pairs: specific advisor-student pairs that must be matched
   - Capacity limits: advisors cannot exceed their maximum capacity

2. SOFT CONSTRAINTS (warnings don't block, but inform the user):
   - Preferences not met (e.g., "prefer to balance workload" but some advisors have 0)
   - Priorities not followed (e.g., "senior students first" but juniors got better placements)
   - Balance goals not achieved (e.g., "avoid 0 students" but several advisors have 0)

3. OPTIMIZATION GOALS (commentary helps user choose):
   - How well did this option achieve stated goals?
   - Metrics: count advisors with 0 students, variance in workload, etc.
   - Neutral, factual assessment to help user compare options

Return a JSON object:
{
  "isValid": boolean (false only if hard constraints violated),
  "userFacingSummary": "3-4 sentence plain-language explanation of this option's results, tailored to the user's specific constraints and goals. Focus on what matters to them, but describe what the algorithm prioritizes in the first sentence.",
  "violations": [
    {"type": "conditional_capacity" | "forbidden_pair" | "required_pair" | "capacity_exceeded", "advisorName": "string", "studentName": "string (if applicable)", "message": "clear explanation"}
  ],
  "warnings": [
    {"type": "preference" | "priority" | "balance", "severity": "low" | "medium" | "high", "message": "clear explanation of what wasn't satisfied"}
  ],
  "commentary": [
    {"goal": "string (the optimization goal)", "assessment": "factual evaluation of how well this option achieved the goal", "metrics": {"key": "value"}}
  ]
}`;

  const {
    anonymizeAdvisors,
    anonymizeAssignments,
    anonymizeConstraints,
    anonymizeText,
    deanonymizeValidation
  } = require('./anonymize');

  // Anonymize data before sending to LLM
  const anonymizedAdvisors = anonymizeAdvisors(advisors, realToPseudo);
  const anonymizedAssignments = anonymizeAssignments(assignments, realToPseudo);
  const anonymizedParameters = anonymizeText(parameters, realToPseudo);

  // Re-anonymize the constraints (they were de-anonymized after extraction)
  const anonymizedConstraints = anonymizeConstraints(extractedConstraints, realToPseudo);

  // Build assignment summary with anonymized data
  const assignmentsByAdvisor = new Map();
  anonymizedAssignments.forEach((assignment) => {
    if (!assignmentsByAdvisor.has(assignment.advisor)) {
      assignmentsByAdvisor.set(assignment.advisor, []);
    }
    assignmentsByAdvisor.get(assignment.advisor).push(assignment.student);
  });

  const assignmentSummary = anonymizedAdvisors
    .map((advisor) => {
      const assigned = assignmentsByAdvisor.get(advisor.name) || [];
      return `${advisor.name} (capacity ${advisor.capacity}): ${assigned.length} students [${assigned.join(', ')}]`;
    })
    .join('\n');

  const userPrompt = `Validate these assignments against all extracted constraints and goals:

EXTRACTED CONSTRAINTS & GOALS:
${JSON.stringify(anonymizedConstraints, null, 2)}

ASSIGNMENTS:
${assignmentSummary}

ADVISOR NOTES AND PARAMETERS (for reference):
${anonymizedAdvisors.map((a) => `${a.name}: ${a.notes || 'none'}`).join('\n')}
Parameters: ${anonymizedParameters || 'none'}

Provide violations (hard), warnings (soft), and commentary (goals).
Return only the JSON object, no additional text.`;

  try {
    const response = await callModel(systemPrompt, userPrompt, 0);
    const cleaned = response.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '');
    const anonymizedValidation = JSON.parse(cleaned);

    // De-anonymize the results before returning
    const deanonymizedValidation = deanonymizeValidation(anonymizedValidation, pseudoToReal);

    // Return both de-anonymized results and the anonymized data sent to LLM
    return {
      validation: deanonymizedValidation,
      llmPayload: {
        systemPrompt,
        userPrompt,
        anonymizedAdvisors,
        anonymizedAssignments,
        anonymizedConstraints,
        anonymizedParameters
      }
    };
  } catch (error) {
    console.warn('LLM validation failed, assuming valid:', error.message);
    return {
      validation: { isValid: true, violations: [], warnings: [], commentary: [] },
      llmPayload: null
    };
  }
}

module.exports = {
  callModel,
  extractConstraints,
  validateAssignments
};
