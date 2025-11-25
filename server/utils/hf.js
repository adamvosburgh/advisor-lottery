// Import the LLM abstraction layer that handles multiple providers
const { callModel } = require('./llm');

/**
 * Extract constraints and preferences from natural language using LLM
 * Categorizes into hard constraints, soft constraints, and optimization goals
 *
 * @param {Array} advisors - Real advisor data
 * @param {string} parameters - Additional parameters text
 * @param {Map} realToPseudo - Name mapping for anonymization
 * @param {Map} pseudoToReal - Reverse mapping for de-anonymization
 */
async function extractConstraints(advisors, parameters, realToPseudo, pseudoToReal, mode = 'advisor') {
  const terminology = mode === 'studio' ? 'studio' : 'advisor';
  const terminologyPlural = mode === 'studio' ? 'studios' : 'advisors';
  const verbForm = mode === 'studio' ? 'work with' : 'advise';

  const systemPrompt = `You are a constraint extraction assistant. Parse natural language text to identify assignment rules and preferences for ${terminology} assignments.

Categorize into three types:

1. HARD CONSTRAINTS (must be satisfied - violations require algorithm retry):
   - Conditional capacity: "must have 0 or 2", "needs 1 or 3", "all or nothing", "either X or Y students"
     IMPORTANT: Do NOT treat "minimum X" or "maximum X" as conditional capacity - these are handled separately by the backend
     Only include constraints that specify DISCRETE allowed values (e.g., "0 or 2", "either 1 or 3")
   - Forbidden pairs: "cannot work with", "does not want", "should avoid", "won't ${verbForm}"
   - Required pairs: "must work with", "should be assigned to"

2. SOFT CONSTRAINTS (should be satisfied - generate warnings if not met):
   - Preferences: "prefer", "would like", "ideally", "if possible"
   - Priorities: "priority should be given to", "senior students first"
   - Balance goals: "try to balance", "avoid having too many/few"

3. OPTIMIZATION GOALS (guide user's choice - generate commentary):
   - Minimize/maximize metrics: "minimize travel", "maximize satisfaction"
   - Distribution preferences: "spread evenly", "avoid concentrating"
   - General objectives: "fairness", "equity", "workload balance"

NOTE: Ignore "minimum X students" or "maximum X students" constraints - the backend algorithms handle these automatically using capacity fields.

Return a JSON object:
{
  "hardConstraints": {
    "conditionalCapacity": [
      {"advisorName": "string (${terminology} name)", "allowedCounts": [0, 2], "rawText": "original text"}
    ],
    "forbiddenPairs": [
      {"advisorName": "string (${terminology} name)", "studentName": "string", "rawText": "original text"}
    ],
    "requiredPairs": [
      {"advisorName": "string (${terminology} name)", "studentName": "string", "rawText": "original text"}
    ]
  },
  "softConstraints": [
    {"type": "preference" | "priority" | "balance", "scope": "global" | "specific", "target": "string (${terminology}/student name if specific)", "description": "clear description", "rawText": "original text"}
  ],
  "optimizationGoals": [
    {"type": "minimize" | "maximize" | "distribute" | "general", "metric": "string (what to optimize)", "description": "clear description", "rawText": "original text"}
  ]
}`;

  const { anonymizeAdvisors, anonymizeText, deanonymizeConstraints } = require('./anonymize');

  // Anonymize advisor data before sending to LLM
  const anonymizedAdvisors = anonymizeAdvisors(advisors, realToPseudo);
  const anonymizedParameters = anonymizeText(parameters, realToPseudo);

  const terminologyUpper = terminology.toUpperCase();
  const terminologyPluralUpper = terminologyPlural.toUpperCase();

  const advisorConstraints = anonymizedAdvisors
    .filter((a) => a.notes && a.notes.trim().length > 0)
    .map((a) => `${terminology.charAt(0).toUpperCase() + terminology.slice(1)} "${a.name}" (capacity ${a.capacity}): ${a.notes}`)
    .join('\n');

  const userPrompt = `Extract and categorize all constraints, preferences, and goals from the following:

${terminologyPluralUpper}:
${advisorConstraints || 'None'}

ADDITIONAL PARAMETERS:
${anonymizedParameters || 'None'}

Return only the JSON object, no additional text.`;

  try {
    const response = await callModel(systemPrompt, userPrompt, 0);
    const cleaned = response.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '');

    let anonymizedConstraints;
    try {
      anonymizedConstraints = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Failed to parse LLM response as JSON:', parseError.message);
      console.error('Raw response (first 500 chars):', cleaned.substring(0, 500));
      throw new Error(`LLM returned invalid JSON: ${parseError.message}`);
    }

    // De-anonymize the results before returning
    const deanonymizedConstraints = deanonymizeConstraints(anonymizedConstraints, pseudoToReal);

    // Return both de-anonymized results and the anonymized data sent to LLM
    return {
      constraints: deanonymizedConstraints,
      llmPayload: {
        mode,
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
async function validateAssignments(advisors, students, parameters, assignments, extractedConstraints, realToPseudo, pseudoToReal, mode = 'advisor') {
  const terminology = mode === 'studio' ? 'studio' : 'advisor';
  const terminologyPlural = mode === 'studio' ? 'studios' : 'advisors';

  const systemPrompt = `You are an assignment validator. Evaluate assignments against constraints and preferences.

Review THREE categories:

1. HARD CONSTRAINTS (violations block the solution):
   - Conditional capacity: ${terminology} must have specific student counts (ONLY check constraints from EXTRACTED CONSTRAINTS, ignore notes like "minimum X")
   - Forbidden pairs: specific ${terminology}-student pairs that cannot be matched
   - Required pairs: specific ${terminology}-student pairs that must be matched
   - Capacity limits: ${terminologyPlural} cannot exceed their maximum capacity

IMPORTANT: Do NOT report violations for "minimum X students" or "maximum X students" constraints in notes.
The backend algorithms automatically enforce minimum/maximum capacity constraints. Only check the conditional capacity constraints from EXTRACTED CONSTRAINTS.

2. SOFT CONSTRAINTS (warnings don't block, but inform the user):
   - Preferences not met (e.g., "prefer to balance workload" but some ${terminologyPlural} have 0)
   - Priorities not followed (e.g., "senior students first" but juniors got better placements)
   - Balance goals not achieved (e.g., "avoid 0 students" but several ${terminologyPlural} have 0)

3. OPTIMIZATION GOALS (commentary helps user choose):
   - How well did this option achieve stated goals?
   - Metrics: count ${terminologyPlural} with 0 students, variance in workload, etc.
   - Neutral, factual assessment to help user compare options

Return a JSON object:
{
  "isValid": boolean (false only if hard constraints violated),
  "userFacingSummary": "2-3 sentence plain-language explanation of this option's results. Describe what the algorithm prioritizes in the first sentence. Focus on student placement quality (average rank, % first choice). Do NOT mention minimum capacity constraints - those are automatically enforced. Use '${terminology}' when referring to ${terminologyPlural}.",
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

  const terminologyUpper = terminology.toUpperCase();
  const terminologyPluralUpper = terminologyPlural.toUpperCase();

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

${terminologyUpper} NOTES AND PARAMETERS (for reference):
${anonymizedAdvisors.map((a) => `${a.name}: ${a.notes || 'none'}`).join('\n')}
Parameters: ${anonymizedParameters || 'none'}

Provide violations (hard), warnings (soft), and commentary (goals).
Return only the JSON object, no additional text.`;

  try {
    const response = await callModel(systemPrompt, userPrompt, 0);
    const cleaned = response.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '');

    let anonymizedValidation;
    try {
      anonymizedValidation = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('Failed to parse LLM validation response as JSON:', parseError.message);
      console.error('Raw response (first 500 chars):', cleaned.substring(0, 500));
      throw new Error(`LLM returned invalid JSON: ${parseError.message}`);
    }

    // De-anonymize the results before returning
    const deanonymizedValidation = deanonymizeValidation(anonymizedValidation, pseudoToReal);

    // Return both de-anonymized results and the anonymized data sent to LLM
    return {
      validation: deanonymizedValidation,
      llmPayload: {
        mode,
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
