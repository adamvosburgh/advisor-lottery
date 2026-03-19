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
  const hmac = crypto.createHmac('sha256', salt);
  hmac.update(name);
  const hash = hmac.digest('hex');
  const shortHash = hash.substring(0, 8);
  return `${prefix}_${shortHash}`;
}

/**
 * Create bidirectional mapping between real names and pseudonyms
 */
function createNameMapping(advisors, students) {
  const salt = crypto.randomBytes(32).toString('hex');

  const realToPseudo = new Map();
  const pseudoToReal = new Map();

  advisors.forEach((advisor) => {
    const pseudo = generatePseudonym(advisor.name, 'ADV', salt);
    realToPseudo.set(advisor.name, pseudo);
    pseudoToReal.set(pseudo, advisor.name);
  });

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

  const names = Array.from(realToPseudo.keys()).sort((a, b) => b.length - a.length);

  names.forEach((realName) => {
    const pseudo = realToPseudo.get(realName);
    const regex = new RegExp(`\\b${realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    anonymized = anonymized.replace(regex, pseudo);
  });

  return anonymized;
}

/**
 * Anonymize advisor/studio list for LLM
 */
function anonymizeAdvisors(advisors, realToPseudo) {
  return advisors.map((advisor) => ({
    name: realToPseudo.get(advisor.name),
    capacity: advisor.capacity,
    notes: anonymizeText(advisor.notes, realToPseudo)
  }));
}

/**
 * Replace all occurrences of pseudonyms with real names in a string
 */
function deanonymizeText(text, pseudoToReal) {
  if (!text) return text;

  let deanonymized = text;

  const pseudonyms = Array.from(pseudoToReal.keys()).sort((a, b) => b.length - a.length);

  pseudonyms.forEach((pseudo) => {
    const realName = pseudoToReal.get(pseudo);
    const regex = new RegExp(`\\b${pseudo}\\b`, 'g');
    deanonymized = deanonymized.replace(regex, realName);
  });

  return deanonymized;
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
    capacityOverrides: [],
    softConstraints: [],
    optimizationGoals: []
  };

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

  // De-anonymize per-entity capacity overrides
  result.capacityOverrides = (constraints.capacityOverrides || []).map((c) => ({
    ...c,
    name: pseudoToReal.get(c.name) || c.name,
    rawText: deanonymizeText(c.rawText, pseudoToReal)
  }));

  result.softConstraints = (constraints.softConstraints || []).map((c) => ({
    ...c,
    target: pseudoToReal.get(c.target) || c.target,
    rawText: deanonymizeText(c.rawText, pseudoToReal),
    description: deanonymizeText(c.description, pseudoToReal)
  }));

  result.optimizationGoals = (constraints.optimizationGoals || []).map((c) => ({
    ...c,
    rawText: deanonymizeText(c.rawText, pseudoToReal),
    description: deanonymizeText(c.description, pseudoToReal)
  }));

  return result;
}

module.exports = {
  createNameMapping,
  anonymizeAdvisors,
  anonymizeText,
  deanonymizeConstraints
};
