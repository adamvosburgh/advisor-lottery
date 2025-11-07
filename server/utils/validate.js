const { z } = require('zod');

const AdvisorSchema = z
  .object({
    name: z.string().min(1, 'Advisor name is required'),
    capacity: z.coerce.number().int().min(0, 'Capacity must be zero or a positive integer'),
    notes: z.string().optional().nullable()
  })
  .transform((advisor) => ({
    name: advisor.name.trim(),
    capacity: advisor.capacity,
    notes: advisor.notes ? advisor.notes.trim() || undefined : undefined
  }));

const StudentSchema = z
  .object({
    name: z.string().min(1, 'Student name is required'),
    preferences: z
      .array(z.string().transform((pref) => pref.trim()).pipe(z.string().min(1)))
      .optional()
  })
  .transform((student) => ({
    name: student.name.trim(),
    preferences: (student.preferences || []).filter(Boolean)
  }));

const RequestSchema = z.object({
  advisors: z.array(AdvisorSchema).min(1, 'At least one advisor is required'),
  students: z.array(StudentSchema).min(1, 'At least one student is required'),
  parameters: z.string().optional().transform((value) => (value ? value.trim() : '')),
  lotteryName: z.string().min(1, 'Lottery name is required').transform((value) => value.trim())
});

const AssignmentSchema = z.object({
  student: z.string().min(1),
  advisor: z.string().min(1),
  rank: z.coerce.number().int().min(1).optional()
});

const SummarySchema = z.object({
  algorithm: z.string().min(1),
  averagePlacement: z.number().finite(),
  percentFirstChoice: z.number().min(0).max(1),
  lowestPlacement: z.number().int().min(0),
  notes: z.string().min(1)
});

const OptionSchema = z.object({
  id: z.coerce.number().int().min(1),
  assignments: z.array(AssignmentSchema).min(1),
  summary: SummarySchema
});

const ModelResponseSchema = z.object({
  options: z.array(OptionSchema).length(3)
});

function validateRequestPayload(payload) {
  return RequestSchema.parse(payload);
}

function validateModelResponse(payload) {
  return ModelResponseSchema.parse(payload);
}

function normalizeKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function roundNumber(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function extractForbiddenPairs(text, advisorLookup, studentLookup) {
  if (!text) {
    return [];
  }

  const pairs = [];
  const pattern =
    /([A-Za-z][A-Za-z\s'.-]+?)\s+(?:does\s+not\s+want(?:\s+to\s+(?:work\s+with|advise))?|won't\s+work\s+with|cannot\s+work\s+with|should\s+avoid)\s+([A-Za-z][A-Za-z\s'.-]+)/gi;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const left = match[1].trim();
    const right = match[2].trim();
    const leftKey = normalizeKey(left);
    const rightKey = normalizeKey(right);

    if (advisorLookup.has(leftKey) && studentLookup.has(rightKey)) {
      const advisor = advisorLookup.get(leftKey);
      const student = studentLookup.get(rightKey);
      pairs.push({
        advisorKey: leftKey,
        advisorName: advisor.name,
        studentKey: rightKey,
        studentName: student.name
      });
    } else if (advisorLookup.has(rightKey) && studentLookup.has(leftKey)) {
      const advisor = advisorLookup.get(rightKey);
      const student = studentLookup.get(leftKey);
      pairs.push({
        advisorKey: rightKey,
        advisorName: advisor.name,
        studentKey: leftKey,
        studentName: student.name
      });
    }
  }

  return pairs;
}

function validateAndAnnotate(request, modelResponse) {
  const advisorLookup = new Map();
  const studentLookup = new Map();
  const preferenceLookup = new Map();
  const zeroOrMaxSet = new Set();

  for (const advisor of request.advisors) {
    const key = normalizeKey(advisor.name);
    advisorLookup.set(key, advisor);
    if (advisor.notes && advisor.notes.toLowerCase().includes('0 or max')) {
      zeroOrMaxSet.add(key);
    }
  }

  for (const student of request.students) {
    const key = normalizeKey(student.name);
    studentLookup.set(key, student);
    preferenceLookup.set(
      key,
      (student.preferences || []).map((pref) => normalizeKey(pref))
    );
  }

  const forbiddenPairs = [
    ...extractForbiddenPairs(request.parameters, advisorLookup, studentLookup),
    ...request.advisors.flatMap((advisor) =>
      extractForbiddenPairs(advisor.notes, advisorLookup, studentLookup)
    )
  ];

  const processedOptions = [];
  const violationsByOption = [];

  for (const option of modelResponse.options) {
    const clonedAssignments = option.assignments.map((assignment) => ({
      student: typeof assignment.student === 'string' ? assignment.student.trim() : '',
      advisor: typeof assignment.advisor === 'string' ? assignment.advisor.trim() : '',
      rank: typeof assignment.rank === 'number' && Number.isFinite(assignment.rank) ? assignment.rank : undefined
    }));

    const summary = { ...option.summary };
    const violations = [];
    const seenStudents = new Set();
    const advisorCounts = new Map();

    for (const assignment of clonedAssignments) {
      const { student, advisor } = assignment;
      const studentKey = normalizeKey(student);
      const advisorKey = normalizeKey(advisor);

      if (!student) {
        violations.push('Assignment is missing a student name.');
        continue;
      }

      if (!advisor) {
        violations.push(`Assignment for "${student}" is missing an advisor name.`);
        continue;
      }

      if (!studentLookup.has(studentKey)) {
        violations.push(`Assignment references unknown student "${student}".`);
      }

      if (!advisorLookup.has(advisorKey)) {
        violations.push(`Assignment references unknown advisor "${advisor}".`);
      }

      if (seenStudents.has(studentKey)) {
        violations.push(`Student "${student}" appears more than once.`);
      } else {
        seenStudents.add(studentKey);
      }

      const currentCount = advisorCounts.get(advisorKey) || 0;
      advisorCounts.set(advisorKey, currentCount + 1);

      const preferenceList = preferenceLookup.get(studentKey) || [];
      const advisorIndex = preferenceList.indexOf(advisorKey);
      const computedRank = advisorIndex >= 0 ? advisorIndex + 1 : 999;
      assignment.rank = computedRank;

      const matchedForbidden = forbiddenPairs.find(
        (pair) => pair.advisorKey === advisorKey && pair.studentKey === studentKey
      );
      if (matchedForbidden) {
        violations.push(
          `Forbidden pairing: advisor "${matchedForbidden.advisorName}" with student "${matchedForbidden.studentName}".`
        );
      }
    }

    for (const student of request.students) {
      const studentKey = normalizeKey(student.name);
      if (!seenStudents.has(studentKey)) {
        violations.push(`Student "${student.name}" is missing an assignment.`);
      }
    }

    for (const advisor of request.advisors) {
      const advisorKey = normalizeKey(advisor.name);
      const count = advisorCounts.get(advisorKey) || 0;
      if (count > advisor.capacity) {
        violations.push(
          `Advisor "${advisor.name}" exceeds capacity (${count}/${advisor.capacity}).`
        );
      }
      if (zeroOrMaxSet.has(advisorKey) && count !== 0 && count !== advisor.capacity) {
        violations.push(
          `Advisor "${advisor.name}" must have either 0 or ${advisor.capacity} advisees (received ${count}).`
        );
      }
    }

    if (violations.length > 0) {
      const existing = violationsByOption.find((entry) => entry.optionId === option.id);
      if (existing) {
        existing.violations.push(...violations);
      } else {
        violationsByOption.push({ optionId: option.id, violations: [...violations] });
      }
    }

    const ranks = clonedAssignments.map((assignment) => assignment.rank ?? 999);
    const totalAssignments = ranks.length;
    const sumRanks = ranks.reduce((total, rank) => total + rank, 0);
    const firstChoiceCount = ranks.filter((rank) => rank === 1).length;
    const lowestPlacement = totalAssignments > 0 ? Math.max(...ranks) : 0;

    summary.averagePlacement =
      totalAssignments > 0 ? roundNumber(sumRanks / totalAssignments, 2) : 0;
    summary.percentFirstChoice =
      totalAssignments > 0 ? roundNumber(firstChoiceCount / totalAssignments, 4) : 0;
    summary.lowestPlacement = lowestPlacement;

    processedOptions.push({
      id: option.id,
      assignments: clonedAssignments,
      summary
    });
  }

  return {
    options: processedOptions,
    violationsByOption
  };
}

module.exports = {
  validateRequestPayload,
  validateModelResponse,
  validateAndAnnotate
};
