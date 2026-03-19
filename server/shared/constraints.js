/**
 * LLM-powered constraint extraction and deterministic assignment validation.
 * Shared by both studio and advisor modes via the `mode` parameter.
 */

const { callModel } = require('./llm');

/**
 * Extract constraints and preferences from natural language using LLM.
 * Now also extracts per-entity capacity overrides (e.g. "Studio H can go as low as 6")
 * from the additional parameters field.
 *
 * @param {Array} advisors - Real advisor data
 * @param {string} parameters - Additional parameters text
 * @param {Map} realToPseudo - Name mapping for anonymization
 * @param {Map} pseudoToReal - Reverse mapping for de-anonymization
 * @param {string} mode - 'advisor' or 'studio'
 */
async function extractConstraints(advisors, parameters, realToPseudo, pseudoToReal, mode = 'advisor') {
  const terminology = mode === 'studio' ? 'studio' : 'advisor';
  const terminologyPlural = mode === 'studio' ? 'studios' : 'advisors';
  const verbForm = mode === 'studio' ? 'work with' : 'advise';

  const systemPrompt = `You are a constraint extraction assistant. Parse natural language text to identify assignment rules and preferences for ${terminology} assignments.

Categorize into three types plus capacity overrides:

1. HARD CONSTRAINTS (must be satisfied - violations require algorithm retry):
   - Conditional capacity: "must have 0 or 2", "needs 1 or 3", "all or nothing", "either X or Y students"
     IMPORTANT: Only include constraints that specify DISCRETE allowed values (e.g., "0 or 2", "either 1 or 3")
   - Forbidden pairs: "cannot work with", "does not want", "should avoid", "won't ${verbForm}"
   - Required pairs: "must work with", "should be assigned to"

2. CAPACITY OVERRIDES (per-entity min/max that differ from the global default):
   Only extract from ADDITIONAL PARAMETERS, not from ${terminology} notes (those are handled by the backend).
   Examples: "Studio H can go as low as 6 students", "Studio A must have at least 10 students",
   "Advisor Smith can take up to 5 students this semester".
   Also handle creative restructuring like "all studios must have an even number of students"
   by adding a conditionalCapacity for each named ${terminology} with appropriate allowedCounts.
   Do NOT extract the global minimum or maximum that applies to all ${terminologyPlural} equally
   (those are embedded in the ${terminology} notes and handled separately).

3. SOFT CONSTRAINTS (should be satisfied - generate warnings if not met):
   - Preferences: "prefer", "would like", "ideally", "if possible"
   - Priorities: "priority should be given to", "senior students first"
   - Balance goals: "try to balance", "avoid having too many/few"

4. OPTIMIZATION GOALS (guide user's choice - generate commentary):
   - Minimize/maximize metrics: "minimize travel", "maximize satisfaction"
   - Distribution preferences: "spread evenly", "avoid concentrating"
   - General objectives: "fairness", "equity", "workload balance"

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
  "capacityOverrides": [
    {"name": "string (${terminology} name)", "minCapacity": number_or_null, "maxCapacity": number_or_null, "rawText": "original text"}
  ],
  "softConstraints": [
    {"type": "preference" | "priority" | "balance", "scope": "global" | "specific", "target": "string (${terminology}/student name if specific)", "description": "clear description", "rawText": "original text"}
  ],
  "optimizationGoals": [
    {"type": "minimize" | "maximize" | "distribute" | "general", "metric": "string (what to optimize)", "description": "clear description", "rawText": "original text"}
  ]
}`;

  const {
    anonymizeAdvisors,
    anonymizeText,
    deanonymizeConstraints
  } = require('./anonymize');

  const anonymizedAdvisors = anonymizeAdvisors(advisors, realToPseudo);
  const anonymizedParameters = anonymizeText(parameters, realToPseudo);

  const advisorConstraints = anonymizedAdvisors
    .filter((a) => a.notes && a.notes.trim().length > 0)
    .map((a) => `${terminology.charAt(0).toUpperCase() + terminology.slice(1)} "${a.name}" (capacity ${a.capacity}): ${a.notes}`)
    .join('\n');

  const userPrompt = `Extract and categorize all constraints, preferences, and goals from the following:

${terminologyPlural.toUpperCase()}:
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

    // Ensure capacityOverrides exists even if the LLM omitted it
    if (!anonymizedConstraints.capacityOverrides) {
      anonymizedConstraints.capacityOverrides = [];
    }

    const deanonymizedConstraints = deanonymizeConstraints(anonymizedConstraints, pseudoToReal);

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
        capacityOverrides: [],
        softConstraints: [],
        optimizationGoals: []
      },
      llmPayload: null
    };
  }
}

/**
 * Deterministic validation of algorithm outputs against extracted constraints.
 * Checks: max capacity, min capacity (notes + overrides), conditional capacity,
 * and that every student is assigned exactly once.
 *
 * @param {Array} advisors - Advisor data (with capacity, minCapacity, notes)
 * @param {Array} students - Student data
 * @param {Array} assignments - Array of {advisor, student} pairs
 * @param {Object} extractedConstraints - From extractConstraints()
 * @returns {{ isValid: boolean, violations: Array }}
 */
function validateAssignments(advisors, students, assignments, extractedConstraints) {
  const violations = [];

  // Build assignment counts per advisor
  const countByAdvisor = new Map();
  const assignedStudents = new Set();
  const duplicateStudents = [];

  for (const a of assignments) {
    countByAdvisor.set(a.advisor, (countByAdvisor.get(a.advisor) || 0) + 1);
    if (assignedStudents.has(a.student)) {
      duplicateStudents.push(a.student);
    }
    assignedStudents.add(a.student);
  }

  // Check every student assigned exactly once
  const allStudentNames = students.map((s) => s.name);
  const unassigned = allStudentNames.filter((s) => !assignedStudents.has(s));
  if (unassigned.length > 0) {
    violations.push({
      type: 'unassigned_students',
      message: `${unassigned.length} student(s) not assigned: ${unassigned.join(', ')}`
    });
  }
  if (duplicateStudents.length > 0) {
    violations.push({
      type: 'duplicate_assignment',
      message: `${duplicateStudents.length} student(s) assigned more than once: ${duplicateStudents.join(', ')}`
    });
  }

  // Check capacity constraints per advisor
  for (const advisor of advisors) {
    const count = countByAdvisor.get(advisor.name) || 0;

    // Max capacity
    if (count > advisor.capacity) {
      violations.push({
        type: 'capacity_exceeded',
        advisorName: advisor.name,
        message: `${advisor.name} has ${count} students but max capacity is ${advisor.capacity}`
      });
    }

    // Min capacity (from notes/backend-parsed minCapacity)
    const minCap = advisor.minCapacity != null ? advisor.minCapacity : null;
    if (minCap != null && count < minCap && count > 0) {
      violations.push({
        type: 'below_minimum',
        advisorName: advisor.name,
        message: `${advisor.name} has ${count} students but minimum is ${minCap}`
      });
    }
  }

  // Check capacity overrides from extracted constraints
  const overrides = extractedConstraints.capacityOverrides || [];
  for (const override of overrides) {
    const count = countByAdvisor.get(override.name) || 0;
    if (override.minCapacity != null && count < override.minCapacity && count > 0) {
      violations.push({
        type: 'override_below_minimum',
        advisorName: override.name,
        message: `${override.name} has ${count} students but override minimum is ${override.minCapacity}`
      });
    }
    if (override.maxCapacity != null && count > override.maxCapacity) {
      violations.push({
        type: 'override_above_maximum',
        advisorName: override.name,
        message: `${override.name} has ${count} students but override maximum is ${override.maxCapacity}`
      });
    }
  }

  // Check conditional capacity (allowedCounts)
  const conditionalCaps = extractedConstraints.hardConstraints?.conditionalCapacity || [];
  for (const cc of conditionalCaps) {
    const count = countByAdvisor.get(cc.advisorName) || 0;
    if (!cc.allowedCounts.includes(count)) {
      violations.push({
        type: 'conditional_capacity',
        advisorName: cc.advisorName,
        message: `${cc.advisorName} has ${count} students but allowed counts are [${cc.allowedCounts.join(', ')}]`
      });
    }
  }

  return {
    isValid: violations.length === 0,
    violations
  };
}

module.exports = {
  extractConstraints,
  validateAssignments
};
