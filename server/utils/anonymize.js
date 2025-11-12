/**
 * Anonymization utilities for protecting student and advisor identities
 * when sending data to external LLM APIs
 */

const crypto = require('crypto');

/**
 * Generate a consistent pseudonymous ID for a name with salt
 * Uses HMAC-SHA256 with a random salt to prevent rainbow table attacks
 * The salt is unique per lottery run and never sent to the API
 *
 * @param {string} name - The real name to anonymize
 * @param {string} prefix - Prefix for the pseudonym (ADV or STU)
 * @param {string} salt - Random salt unique to this lottery run
 * @returns {string} Pseudonymized ID like "ADV_8f3a2bc1"
 */
function generatePseudonym(name, prefix, salt) {
  // Use HMAC-SHA256 with salt to make it impossible to reverse
  const hmac = crypto.createHmac('sha256', salt);
  hmac.update(name);
  const hash = hmac.digest('hex');
  const shortHash = hash.substring(0, 8);
  return `${prefix}_${shortHash}`;
}

/**
 * Create bidirectional mapping between real names and pseudonyms
 * Generates a random salt that makes it computationally infeasible to
 * reverse the pseudonyms, even with rainbow tables
 *
 * @param {Array} advisors - Array of advisor objects with name property
 * @param {Array} students - Array of student objects with name property
 * @returns {Object} { realToPseudo, pseudoToReal, salt }
 */
function createNameMapping(advisors, students) {
  // Generate a random salt unique to this lottery run
  const salt = crypto.randomBytes(32).toString('hex');

  const realToPseudo = new Map();
  const pseudoToReal = new Map();

  // Map advisor names
  advisors.forEach((advisor) => {
    const pseudo = generatePseudonym(advisor.name, 'ADV', salt);
    realToPseudo.set(advisor.name, pseudo);
    pseudoToReal.set(pseudo, advisor.name);
  });

  // Map student names
  students.forEach((student) => {
    const pseudo = generatePseudonym(student.name, 'STU', salt);
    realToPseudo.set(student.name, pseudo);
    pseudoToReal.set(pseudo, student.name);
  });

  return { realToPseudo, pseudoToReal, salt };
}

/**
 * Replace all occurrences of real names with pseudonyms in a string
 */
function anonymizeText(text, realToPseudo) {
  if (!text) return text;

  let anonymized = text;

  // Sort names by length (longest first) to avoid partial replacements
  const names = Array.from(realToPseudo.keys()).sort((a, b) => b.length - a.length);

  names.forEach((realName) => {
    const pseudo = realToPseudo.get(realName);
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    anonymized = anonymized.replace(regex, pseudo);
  });

  return anonymized;
}

/**
 * Anonymize advisor list for LLM
 */
function anonymizeAdvisors(advisors, realToPseudo) {
  return advisors.map((advisor) => ({
    name: realToPseudo.get(advisor.name),
    capacity: advisor.capacity,
    notes: anonymizeText(advisor.notes, realToPseudo)
  }));
}

/**
 * Anonymize student list for LLM
 */
function anonymizeStudents(students, realToPseudo) {
  return students.map((student) => ({
    name: realToPseudo.get(student.name),
    preferences: student.preferences.map((pref) => realToPseudo.get(pref) || pref)
  }));
}

/**
 * Anonymize assignments for LLM validation
 */
function anonymizeAssignments(assignments, realToPseudo) {
  return assignments.map((assignment) => ({
    student: realToPseudo.get(assignment.student) || assignment.student,
    advisor: realToPseudo.get(assignment.advisor) || assignment.advisor,
    rank: assignment.rank
  }));
}

/**
 * Anonymize constraint extraction results (for re-sending to LLM)
 */
function anonymizeConstraints(constraints, realToPseudo) {
  if (!constraints) return constraints;

  const result = {
    hardConstraints: {
      conditionalCapacity: [],
      forbiddenPairs: [],
      requiredPairs: []
    },
    softConstraints: [],
    optimizationGoals: []
  };

  // Anonymize hard constraints
  if (constraints.hardConstraints) {
    result.hardConstraints.conditionalCapacity = (
      constraints.hardConstraints.conditionalCapacity || []
    ).map((c) => ({
      ...c,
      advisorName: realToPseudo.get(c.advisorName) || c.advisorName,
      rawText: anonymizeText(c.rawText, realToPseudo)
    }));

    result.hardConstraints.forbiddenPairs = (constraints.hardConstraints.forbiddenPairs || []).map(
      (c) => ({
        ...c,
        advisorName: realToPseudo.get(c.advisorName) || c.advisorName,
        studentName: realToPseudo.get(c.studentName) || c.studentName,
        rawText: anonymizeText(c.rawText, realToPseudo)
      })
    );

    result.hardConstraints.requiredPairs = (constraints.hardConstraints.requiredPairs || []).map(
      (c) => ({
        ...c,
        advisorName: realToPseudo.get(c.advisorName) || c.advisorName,
        studentName: realToPseudo.get(c.studentName) || c.studentName,
        rawText: anonymizeText(c.rawText, realToPseudo)
      })
    );
  }

  // Anonymize soft constraints
  result.softConstraints = (constraints.softConstraints || []).map((c) => ({
    ...c,
    target: realToPseudo.get(c.target) || c.target,
    rawText: anonymizeText(c.rawText, realToPseudo),
    description: anonymizeText(c.description, realToPseudo)
  }));

  // Anonymize optimization goals
  result.optimizationGoals = (constraints.optimizationGoals || []).map((c) => ({
    ...c,
    rawText: anonymizeText(c.rawText, realToPseudo),
    description: anonymizeText(c.description, realToPseudo)
  }));

  return result;
}

/**
 * De-anonymize constraint extraction results
 */
function deanonymizeConstraints(constraints, pseudoToReal) {
  if (!constraints) return constraints;

  const result = {
    hardConstraints: {
      conditionalCapacity: [],
      forbiddenPairs: [],
      requiredPairs: []
    },
    softConstraints: [],
    optimizationGoals: []
  };

  // De-anonymize hard constraints
  if (constraints.hardConstraints) {
    result.hardConstraints.conditionalCapacity = (
      constraints.hardConstraints.conditionalCapacity || []
    ).map((c) => ({
      ...c,
      advisorName: pseudoToReal.get(c.advisorName) || c.advisorName,
      rawText: deanonymizeText(c.rawText, pseudoToReal)
    }));

    result.hardConstraints.forbiddenPairs = (constraints.hardConstraints.forbiddenPairs || []).map(
      (c) => ({
        ...c,
        advisorName: pseudoToReal.get(c.advisorName) || c.advisorName,
        studentName: pseudoToReal.get(c.studentName) || c.studentName,
        rawText: deanonymizeText(c.rawText, pseudoToReal)
      })
    );

    result.hardConstraints.requiredPairs = (constraints.hardConstraints.requiredPairs || []).map(
      (c) => ({
        ...c,
        advisorName: pseudoToReal.get(c.advisorName) || c.advisorName,
        studentName: pseudoToReal.get(c.studentName) || c.studentName,
        rawText: deanonymizeText(c.rawText, pseudoToReal)
      })
    );
  }

  // De-anonymize soft constraints
  result.softConstraints = (constraints.softConstraints || []).map((c) => ({
    ...c,
    target: pseudoToReal.get(c.target) || c.target,
    rawText: deanonymizeText(c.rawText, pseudoToReal),
    description: deanonymizeText(c.description, pseudoToReal)
  }));

  // De-anonymize optimization goals
  result.optimizationGoals = (constraints.optimizationGoals || []).map((c) => ({
    ...c,
    rawText: deanonymizeText(c.rawText, pseudoToReal),
    description: deanonymizeText(c.description, pseudoToReal)
  }));

  return result;
}

/**
 * De-anonymize validation results
 */
function deanonymizeValidation(validation, pseudoToReal) {
  if (!validation) return validation;

  return {
    isValid: validation.isValid,
    userFacingSummary: deanonymizeText(validation.userFacingSummary, pseudoToReal),
    violations: (validation.violations || []).map((v) => ({
      ...v,
      advisorName: pseudoToReal.get(v.advisorName) || v.advisorName,
      studentName: pseudoToReal.get(v.studentName) || v.studentName,
      message: deanonymizeText(v.message, pseudoToReal)
    })),
    warnings: (validation.warnings || []).map((w) => ({
      ...w,
      message: deanonymizeText(w.message, pseudoToReal)
    })),
    commentary: (validation.commentary || []).map((c) => ({
      ...c,
      goal: deanonymizeText(c.goal, pseudoToReal),
      assessment: deanonymizeText(c.assessment, pseudoToReal)
    }))
  };
}

/**
 * Replace all occurrences of pseudonyms with real names in a string
 */
function deanonymizeText(text, pseudoToReal) {
  if (!text) return text;

  let deanonymized = text;

  // Sort pseudonyms by length (longest first) to avoid partial replacements
  const pseudonyms = Array.from(pseudoToReal.keys()).sort((a, b) => b.length - a.length);

  pseudonyms.forEach((pseudo) => {
    const realName = pseudoToReal.get(pseudo);
    const regex = new RegExp(`\\b${pseudo}\\b`, 'g');
    deanonymized = deanonymized.replace(regex, realName);
  });

  return deanonymized;
}

module.exports = {
  createNameMapping,
  anonymizeAdvisors,
  anonymizeStudents,
  anonymizeAssignments,
  anonymizeConstraints,
  anonymizeText,
  deanonymizeConstraints,
  deanonymizeValidation,
  deanonymizeText
};
