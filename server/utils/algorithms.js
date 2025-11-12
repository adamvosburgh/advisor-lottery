/**
 * Matching algorithms for advisor-student lottery assignment
 */

function normalizeKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function calculateSummaryStats(assignments) {
  if (assignments.length === 0) {
    return {
      averagePlacement: 0,
      percentFirstChoice: 0,
      lowestPlacement: 0
    };
  }

  const ranks = assignments.map((a) => a.rank);
  const totalAssignments = ranks.length;
  const sumRanks = ranks.reduce((total, rank) => total + rank, 0);
  const firstChoiceCount = ranks.filter((rank) => rank === 1).length;
  const lowestPlacement = Math.max(...ranks);

  return {
    averagePlacement: Math.round((sumRanks / totalAssignments) * 100) / 100,
    percentFirstChoice: Math.round((firstChoiceCount / totalAssignments) * 10000) / 10000,
    lowestPlacement
  };
}

/**
 * Water-filling algorithm: Minimizes worst-case placement
 * 1. Place all students in their first choice
 * 2. For overloaded advisors, move students with best alternatives
 * 3. Repeat until all capacity constraints are met
 */
function runWaterFillingAlgorithm(students, advisors, parameters = '') {
  // Build lookup maps
  const advisorMap = new Map();
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    advisorMap.set(key, {
      name: advisor.name,
      capacity: advisor.capacity,
      notes: advisor.notes || '',
      assigned: []
    });
  });

  const studentPreferences = new Map();
  students.forEach((student) => {
    const prefs = (student.preferences || []).map((p) => normalizeKey(p));
    studentPreferences.set(normalizeKey(student.name), {
      name: student.name,
      preferences: prefs,
      currentAdvisor: null,
      currentRank: null
    });
  });

  // Initial assignment: everyone gets first choice
  studentPreferences.forEach((student) => {
    if (student.preferences.length > 0) {
      const firstChoice = student.preferences[0];
      const advisor = advisorMap.get(firstChoice);
      if (advisor) {
        advisor.assigned.push(student.name);
        student.currentAdvisor = firstChoice;
        student.currentRank = 1;
      }
    }
  });

  // Iteratively resolve overloaded advisors
  const MAX_ITERATIONS = 1000;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    let madeChange = false;
    iteration += 1;

    // Find overloaded advisors
    for (const [advisorKey, advisor] of advisorMap.entries()) {
      if (advisor.assigned.length > advisor.capacity) {
        // Find student with best alternative among assigned students
        let bestAlternative = null;
        let bestAltRank = Infinity;
        let bestAltNextAdvisor = null;

        advisor.assigned.forEach((studentName) => {
          const studentKey = normalizeKey(studentName);
          const student = studentPreferences.get(studentKey);
          if (!student) return;

          // Find next available advisor
          for (let i = student.currentRank; i < student.preferences.length; i += 1) {
            const nextAdvisorKey = student.preferences[i];
            const nextAdvisor = advisorMap.get(nextAdvisorKey);
            if (nextAdvisor && nextAdvisor.assigned.length < nextAdvisor.capacity) {
              const altRank = i + 1;
              if (altRank < bestAltRank) {
                bestAltRank = altRank;
                bestAlternative = student;
                bestAltNextAdvisor = nextAdvisorKey;
              }
              break;
            }
          }
        });

        // Move student with best alternative
        if (bestAlternative && bestAltNextAdvisor) {
          // Remove from current advisor
          advisor.assigned = advisor.assigned.filter(
            (name) => normalizeKey(name) !== normalizeKey(bestAlternative.name)
          );

          // Add to new advisor
          const newAdvisor = advisorMap.get(bestAltNextAdvisor);
          newAdvisor.assigned.push(bestAlternative.name);

          // Update student
          bestAlternative.currentAdvisor = bestAltNextAdvisor;
          bestAlternative.currentRank = bestAltRank;

          madeChange = true;
        } else {
          // Can't resolve this overload, force to next available
          const studentToMove = advisor.assigned[0];
          const studentKey = normalizeKey(studentToMove);
          const student = studentPreferences.get(studentKey);

          advisor.assigned.shift();

          // Find ANY advisor with space
          let foundSpace = false;
          for (const [nextAdvisorKey, nextAdvisor] of advisorMap.entries()) {
            if (nextAdvisor.assigned.length < nextAdvisor.capacity) {
              nextAdvisor.assigned.push(student.name);
              const prefIndex = student.preferences.indexOf(nextAdvisorKey);
              student.currentAdvisor = nextAdvisorKey;
              student.currentRank = prefIndex >= 0 ? prefIndex + 1 : 999;
              foundSpace = true;
              madeChange = true;
              break;
            }
          }

          if (!foundSpace) {
            // This should not happen if total capacity >= students
            throw new Error('Unable to assign all students: insufficient total capacity');
          }
        }
      }
    }

    if (!madeChange) break;
  }

  // Build final assignments
  const assignments = [];
  studentPreferences.forEach((student) => {
    assignments.push({
      student: student.name,
      advisor: advisorMap.get(student.currentAdvisor)?.name || 'Unknown',
      rank: student.currentRank || 999
    });
  });

  const stats = calculateSummaryStats(assignments);

  return {
    id: 1,
    assignments,
    summary: {
      algorithm: 'Water-Filling (Overflow Redistribution)',
      averagePlacement: stats.averagePlacement,
      percentFirstChoice: stats.percentFirstChoice,
      lowestPlacement: stats.lowestPlacement,
      notes: `Minimized worst-case placement by systematically moving students with best alternatives. Converged in ${iteration} iterations.`,
      strategyUsed: 'Balanced Minimax - Minimizes worst-case placement'
    }
  };
}

/**
 * Student-Optimal Deferred Acceptance Algorithm
 * Maximizes first choices while maintaining stability
 */
function runDeferredAcceptance(students, advisors, parameters = '') {
  // Build lookup maps
  const advisorMap = new Map();
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    advisorMap.set(key, {
      name: advisor.name,
      capacity: advisor.capacity,
      notes: advisor.notes || '',
      tentativeMatches: [] // [{studentName, rank}]
    });
  });

  const studentQueue = [];
  students.forEach((student) => {
    const prefs = (student.preferences || []).map((p) => normalizeKey(p));
    studentQueue.push({
      name: student.name,
      preferences: prefs,
      nextProposalIndex: 0,
      matched: false
    });
  });

  // Deferred acceptance loop
  const MAX_ITERATIONS = 10000;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration += 1;

    // Find an unmatched student who hasn't exhausted preferences
    const unmatchedStudent = studentQueue.find(
      (s) => !s.matched && s.nextProposalIndex < s.preferences.length
    );

    if (!unmatchedStudent) break; // All students matched or exhausted preferences

    // Student proposes to next advisor on list
    const proposedAdvisorKey = unmatchedStudent.preferences[unmatchedStudent.nextProposalIndex];
    const advisor = advisorMap.get(proposedAdvisorKey);

    if (!advisor) {
      unmatchedStudent.nextProposalIndex += 1;
      continue;
    }

    const proposalRank = unmatchedStudent.nextProposalIndex + 1;

    if (advisor.tentativeMatches.length < advisor.capacity) {
      // Advisor has space, accept tentatively
      advisor.tentativeMatches.push({
        studentName: unmatchedStudent.name,
        rank: proposalRank
      });
      unmatchedStudent.matched = true;
    } else {
      // Advisor is full, check if this student is better than worst current match
      // For greedy approach, accept anyone (first-come basis)
      // We'll just accept and bump the worst
      advisor.tentativeMatches.push({
        studentName: unmatchedStudent.name,
        rank: proposalRank
      });

      // Sort by rank (lower is better) and remove worst
      advisor.tentativeMatches.sort((a, b) => a.rank - b.rank);
      const rejected = advisor.tentativeMatches.pop();

      if (rejected.studentName === unmatchedStudent.name) {
        // This student was rejected
        unmatchedStudent.nextProposalIndex += 1;
        unmatchedStudent.matched = false;
      } else {
        // Someone else was rejected
        unmatchedStudent.matched = true;
        const rejectedStudent = studentQueue.find(
          (s) => s.name === rejected.studentName
        );
        if (rejectedStudent) {
          rejectedStudent.matched = false;
          rejectedStudent.nextProposalIndex =
            rejectedStudent.preferences.indexOf(proposedAdvisorKey) + 1;
        }
      }
    }
  }

  // Build final assignments
  const assignments = [];
  advisorMap.forEach((advisor) => {
    advisor.tentativeMatches.forEach((match) => {
      assignments.push({
        student: match.studentName,
        advisor: advisor.name,
        rank: match.rank
      });
    });
  });

  // Handle unmatched students (if any)
  studentQueue.forEach((student) => {
    if (!student.matched) {
      // Assign to first advisor with space (shouldn't happen if capacity >= students)
      for (const [advisorKey, advisor] of advisorMap.entries()) {
        if (advisor.tentativeMatches.length < advisor.capacity) {
          assignments.push({
            student: student.name,
            advisor: advisor.name,
            rank: student.preferences.indexOf(advisorKey) + 1 || 999
          });
          advisor.tentativeMatches.push({ studentName: student.name, rank: 999 });
          break;
        }
      }
    }
  });

  const stats = calculateSummaryStats(assignments);

  return {
    id: 2,
    assignments,
    summary: {
      algorithm: 'Student-Optimal Deferred Acceptance',
      averagePlacement: stats.averagePlacement,
      percentFirstChoice: stats.percentFirstChoice,
      lowestPlacement: stats.lowestPlacement,
      notes: `Maximized first-choice assignments through stable matching. Students propose to advisors in preference order.`,
      strategyUsed: 'Maximize First Choices - Prioritizes number of students getting #1'
    }
  };
}

/**
 * Check for constraint violations and adjust if needed
 * Returns: { violations: [], adjusted: boolean, adjustedAdvisors: [] }
 */
function validateConstraints(assignments, advisors, students, parameters = '') {
  const violations = [];
  const advisorCounts = new Map();

  // Count assignments per advisor
  assignments.forEach((assignment) => {
    const key = normalizeKey(assignment.advisor);
    advisorCounts.set(key, (advisorCounts.get(key) || 0) + 1);
  });

  // Check "0 or max" constraints
  const zeroOrMaxViolations = [];
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    const count = advisorCounts.get(key) || 0;
    const notes = (advisor.notes || '').toLowerCase();

    if (notes.includes('0 or max') || notes.includes('either 0 or')) {
      if (count !== 0 && count !== advisor.capacity) {
        violations.push({
          type: 'zero_or_max',
          advisor: advisor.name,
          count,
          capacity: advisor.capacity
        });
        zeroOrMaxViolations.push(advisor);
      }
    }
  });

  return {
    violations,
    hasViolations: violations.length > 0,
    zeroOrMaxViolations
  };
}

/**
 * Adjust advisor capacities for retry
 */
function adjustAdvisorsForRetry(advisors, violatedAdvisors) {
  return advisors.map((advisor) => {
    const isViolated = violatedAdvisors.some(
      (v) => normalizeKey(v.name) === normalizeKey(advisor.name)
    );
    if (isViolated) {
      return { ...advisor, capacity: 0 };
    }
    return advisor;
  });
}

/**
 * Minimum Regret Algorithm
 * Minimizes total "regret" across all students
 * Regret = how far each student is from their top choice
 */
function runMinimumRegretAlgorithm(students, advisors, parameters = '') {
  // Build lookup maps
  const advisorMap = new Map();
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    advisorMap.set(key, {
      name: advisor.name,
      capacity: advisor.capacity,
      notes: advisor.notes || '',
      assigned: []
    });
  });

  const studentList = students.map((student) => {
    const prefs = (student.preferences || []).map((p) => normalizeKey(p));
    return {
      name: student.name,
      preferences: prefs,
      assigned: false,
      assignedAdvisor: null,
      assignedRank: null
    };
  });

  // Helper: Count how many available options a student has in their top N choices
  const countAvailableOptions = (student, topN = 5) => {
    let count = 0;
    for (let i = 0; i < Math.min(topN, student.preferences.length); i += 1) {
      const advisorKey = student.preferences[i];
      const advisor = advisorMap.get(advisorKey);
      if (advisor && advisor.assigned.length < advisor.capacity) {
        count += 1;
      }
    }
    return count;
  };

  // Assign students one at a time, dynamically prioritizing those with fewest options
  let assignmentsMade = 0;
  const MAX_ITERATIONS = 1000;

  while (assignmentsMade < studentList.length && assignmentsMade < MAX_ITERATIONS) {
    // Find unassigned student with fewest available options (most constrained)
    let mostConstrainedStudent = null;
    let fewestOptions = Infinity;

    for (const student of studentList) {
      if (student.assigned) continue;

      const availableOptions = countAvailableOptions(student);
      if (availableOptions < fewestOptions) {
        fewestOptions = availableOptions;
        mostConstrainedStudent = student;
      }
    }

    if (!mostConstrainedStudent) break;

    // Assign this student to their best available advisor
    let assigned = false;
    for (let prefIdx = 0; prefIdx < mostConstrainedStudent.preferences.length; prefIdx += 1) {
      const advisorKey = mostConstrainedStudent.preferences[prefIdx];
      const advisor = advisorMap.get(advisorKey);

      if (advisor && advisor.assigned.length < advisor.capacity) {
        advisor.assigned.push(mostConstrainedStudent.name);
        mostConstrainedStudent.assigned = true;
        mostConstrainedStudent.assignedAdvisor = advisorKey;
        mostConstrainedStudent.assignedRank = prefIdx + 1;
        assignmentsMade += 1;
        assigned = true;
        break;
      }
    }

    if (assigned) continue;

    // If couldn't assign to any preference, assign to first available advisor
    for (const [advisorKey, advisor] of advisorMap.entries()) {
      if (advisor.assigned.length < advisor.capacity) {
        advisor.assigned.push(mostConstrainedStudent.name);
        mostConstrainedStudent.assigned = true;
        mostConstrainedStudent.assignedAdvisor = advisorKey;
        mostConstrainedStudent.assignedRank = 999;
        assignmentsMade += 1;
        break;
      }
    }
  }

  // Now try to improve by swapping students to reduce total regret
  // Regret = rank - 1 (so rank 1 has 0 regret, rank 2 has 1 regret, etc.)
  const MAX_SWAP_ITERATIONS = 100;
  for (let swapIter = 0; swapIter < MAX_SWAP_ITERATIONS; swapIter += 1) {
    let improvedRegret = false;

    // Try swapping pairs of students if it reduces total regret
    for (let i = 0; i < studentList.length; i += 1) {
      for (let j = i + 1; j < studentList.length; j += 1) {
        const student1 = studentList[i];
        const student2 = studentList[j];

        if (!student1.assigned || !student2.assigned) continue;

        const advisor1Key = student1.assignedAdvisor;
        const advisor2Key = student2.assignedAdvisor;

        if (advisor1Key === advisor2Key) continue;

        // Calculate current regret
        const currentRegret = (student1.assignedRank - 1) + (student2.assignedRank - 1);

        // What would regret be if we swapped?
        const student1NewRank = student1.preferences.indexOf(advisor2Key) + 1 || 999;
        const student2NewRank = student2.preferences.indexOf(advisor1Key) + 1 || 999;
        const newRegret = (student1NewRank - 1) + (student2NewRank - 1);

        // Only swap if it reduces total regret
        if (newRegret < currentRegret) {
          // Perform swap
          const advisor1 = advisorMap.get(advisor1Key);
          const advisor2 = advisorMap.get(advisor2Key);

          // Remove from current advisors
          advisor1.assigned = advisor1.assigned.filter((name) => name !== student1.name);
          advisor2.assigned = advisor2.assigned.filter((name) => name !== student2.name);

          // Assign to new advisors
          advisor2.assigned.push(student1.name);
          advisor1.assigned.push(student2.name);

          // Update student records
          student1.assignedAdvisor = advisor2Key;
          student1.assignedRank = student1NewRank;
          student2.assignedAdvisor = advisor1Key;
          student2.assignedRank = student2NewRank;

          improvedRegret = true;
        }
      }
    }

    if (!improvedRegret) break;
  }

  // Build final assignments
  const assignments = studentList.map((student) => ({
    student: student.name,
    advisor: advisorMap.get(student.assignedAdvisor)?.name || 'Unknown',
    rank: student.assignedRank
  }));

  const stats = calculateSummaryStats(assignments);
  const totalRegret = assignments.reduce((sum, a) => sum + (a.rank - 1), 0);

  return {
    id: 3,
    assignments,
    summary: {
      algorithm: 'Minimum Regret (Best Alternative)',
      averagePlacement: stats.averagePlacement,
      percentFirstChoice: stats.percentFirstChoice,
      lowestPlacement: stats.lowestPlacement,
      notes: `Minimized total regret (sum of distances from top choice) across all students. Total regret: ${totalRegret}. Students with fewer good options were prioritized.`,
      strategyUsed: 'Minimum Regret - Balances overall satisfaction'
    }
  };
}

module.exports = {
  runWaterFillingAlgorithm,
  runDeferredAcceptance,
  runMinimumRegretAlgorithm,
  validateConstraints,
  adjustAdvisorsForRetry,
  calculateSummaryStats
};
