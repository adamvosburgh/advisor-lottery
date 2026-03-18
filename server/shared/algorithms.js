/**
 * Matching algorithms for advisor-student lottery assignment
 * Shared by both studio and advisor modes.
 */

function normalizeKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

/**
 * Extract minimum capacity from advisor notes
 * Looks for patterns like "minimum 8 students", "min 8", etc.
 */
function extractMinimumCapacity(notes) {
  if (!notes) return 0;
  const match = notes.match(/min(?:imum)?\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Resolve effective min capacity for an advisor object.
 * Uses explicit minCapacity field if set, otherwise parses notes.
 */
function resolveMinCapacity(advisor) {
  return advisor.minCapacity !== undefined
    ? advisor.minCapacity
    : extractMinimumCapacity(advisor.notes || '');
}

/**
 * Check if assignment is mathematically feasible given min/max constraints
 * Returns: { feasible: boolean, reason?: string }
 */
function checkFeasibility(students, advisors, mode = 'advisor') {
  const totalStudents = students.length;
  const totalMaxCapacity = advisors.reduce((sum, a) => sum + a.capacity, 0);
  const totalMinCapacity = advisors.reduce((sum, a) => sum + resolveMinCapacity(a), 0);
  const terminology = mode === 'studio' ? 'studio' : 'advisor';
  const terminologyPlural = mode === 'studio' ? 'studios' : 'advisors';

  if (totalStudents > totalMaxCapacity) {
    return {
      feasible: false,
      reason: `Cannot assign ${totalStudents} students: total maximum capacity is only ${totalMaxCapacity}. Please increase ${terminology} capacities or reduce student count.`
    };
  }

  if (totalStudents < totalMinCapacity) {
    return {
      feasible: false,
      reason: `Cannot assign ${totalStudents} students: total minimum capacity requirement is ${totalMinCapacity}. Please reduce minimum requirements or increase student count.`
    };
  }

  return { feasible: true };
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
 */
function runWaterFillingAlgorithm(students, advisors, parameters = '', mode = 'advisor') {
  const advisorMap = new Map();
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    advisorMap.set(key, {
      name: advisor.name,
      capacity: advisor.capacity,
      minCapacity: resolveMinCapacity(advisor),
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

  const feasibility = checkFeasibility(students, Array.from(advisorMap.values()), mode);
  if (!feasibility.feasible) {
    return {
      error: feasibility.reason,
      assignments: [],
      summary: {
        algorithm: 'Water-Filling (Overflow Redistribution)',
        averagePlacement: 0,
        percentFirstChoice: 0,
        lowestPlacement: 0,
        notes: `Infeasible: ${feasibility.reason}`,
        strategyUsed: 'Balanced Minimax - Minimizes worst-case placement',
        studioSizes: {},
        allStudentsAssigned: false
      }
    };
  }

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

    for (const [advisorKey, advisor] of advisorMap.entries()) {
      if (advisor.assigned.length > advisor.capacity) {
        let bestAlternative = null;
        let bestAltRank = Infinity;
        let bestAltNextAdvisor = null;

        advisor.assigned.forEach((studentName) => {
          const studentKey = normalizeKey(studentName);
          const student = studentPreferences.get(studentKey);
          if (!student) return;

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

        if (bestAlternative && bestAltNextAdvisor) {
          advisor.assigned = advisor.assigned.filter(
            (name) => normalizeKey(name) !== normalizeKey(bestAlternative.name)
          );
          const newAdvisor = advisorMap.get(bestAltNextAdvisor);
          newAdvisor.assigned.push(bestAlternative.name);
          bestAlternative.currentAdvisor = bestAltNextAdvisor;
          bestAlternative.currentRank = bestAltRank;
          madeChange = true;
        } else {
          const studentToMove = advisor.assigned[0];
          const studentKey = normalizeKey(studentToMove);
          const student = studentPreferences.get(studentKey);
          advisor.assigned.shift();

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
            throw new Error('Unable to assign all students: insufficient total capacity');
          }
        }
      }
    }

    if (!madeChange) break;
  }

  // Phase 3: Enforce minimum capacity constraints
  {
    const getUnderenrolled = () => {
      const result = [];
      advisorMap.forEach((advisor, key) => {
        const shortfall = advisor.minCapacity - advisor.assigned.length;
        if (shortfall > 0) result.push({ key, advisor, shortfall });
      });
      return result.sort((a, b) => b.shortfall - a.shortfall);
    };

    for (const { key: underKey, advisor: underAdvisor } of getUnderenrolled()) {
      while (underAdvisor.assigned.length < underAdvisor.minCapacity) {
        const donors = [];
        advisorMap.forEach((advisor, key) => {
          const slack = advisor.assigned.length - advisor.minCapacity;
          if (key !== underKey && slack > 0) donors.push({ key, advisor, slack });
        });
        donors.sort((a, b) => b.slack - a.slack);

        if (donors.length === 0) break;

        let bestStudent = null;
        let bestStudentDonorKey = null;
        let bestRank = Infinity;

        for (const { key: dKey, advisor: dAdvisor } of donors) {
          for (const studentName of dAdvisor.assigned) {
            const student = studentPreferences.get(normalizeKey(studentName));
            if (!student) continue;
            const rank = student.preferences.indexOf(underKey);
            if (rank >= 0 && rank + 1 < bestRank) {
              bestRank = rank + 1;
              bestStudent = student;
              bestStudentDonorKey = dKey;
            }
          }
        }

        if (!bestStudent) {
          const { key: dKey, advisor: dAdvisor } = donors[0];
          const studentName = dAdvisor.assigned[0];
          bestStudent = studentPreferences.get(normalizeKey(studentName));
          bestStudentDonorKey = dKey;
          bestRank = 999;
        }

        if (!bestStudent) break;

        const donorAdvisor = advisorMap.get(bestStudentDonorKey);
        donorAdvisor.assigned = donorAdvisor.assigned.filter(
          (n) => normalizeKey(n) !== normalizeKey(bestStudent.name)
        );
        underAdvisor.assigned.push(bestStudent.name);
        bestStudent.currentAdvisor = underKey;
        bestStudent.currentRank = bestRank;
      }
    }
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

  const minimumViolations = [];
  advisorMap.forEach((advisor) => {
    if (advisor.assigned.length < advisor.minCapacity) {
      minimumViolations.push({
        name: advisor.name,
        current: advisor.assigned.length,
        minimum: advisor.minCapacity,
        shortfall: advisor.minCapacity - advisor.assigned.length
      });
    }
  });

  const studioSizes = {};
  advisorMap.forEach((advisor) => {
    studioSizes[advisor.name] = advisor.assigned.length;
  });

  const assignedSet = new Set(assignments.map((a) => a.student));
  const allStudentsAssigned = students.every((s) => assignedSet.has(s.name));

  const terminologyPlural = mode === 'studio' ? 'studios' : 'advisors';

  return {
    id: 1,
    assignments,
    summary: {
      algorithm: 'Water-Filling (Overflow Redistribution)',
      averagePlacement: stats.averagePlacement,
      percentFirstChoice: stats.percentFirstChoice,
      lowestPlacement: stats.lowestPlacement,
      notes: `Minimized worst-case placement by systematically moving students with best alternatives among ${terminologyPlural}. Converged in ${iteration} iterations.`,
      strategyUsed: 'Balanced Minimax - Minimizes worst-case placement',
      constraintsSatisfied: minimumViolations.length === 0,
      minimumCapacityViolations: minimumViolations,
      studioSizes,
      allStudentsAssigned
    }
  };
}

/**
 * Student-Optimal Deferred Acceptance Algorithm
 * Maximizes first choices while maintaining stability
 */
function runDeferredAcceptance(students, advisors, parameters = '', mode = 'advisor') {
  const advisorMap = new Map();
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    advisorMap.set(key, {
      name: advisor.name,
      capacity: advisor.capacity,
      minCapacity: resolveMinCapacity(advisor),
      notes: advisor.notes || '',
      tentativeMatches: []
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

  const feasibility = checkFeasibility(students, Array.from(advisorMap.values()), mode);
  if (!feasibility.feasible) {
    return {
      error: feasibility.reason,
      assignments: [],
      summary: {
        algorithm: 'Student-Optimal Deferred Acceptance',
        averagePlacement: 0,
        percentFirstChoice: 0,
        lowestPlacement: 0,
        notes: `Infeasible: ${feasibility.reason}`,
        strategyUsed: 'Maximize First Choices - Prioritizes number of students getting #1',
        studioSizes: {},
        allStudentsAssigned: false
      }
    };
  }

  const MAX_ITERATIONS = 10000;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration += 1;

    const unmatchedStudent = studentQueue.find(
      (s) => !s.matched && s.nextProposalIndex < s.preferences.length
    );

    if (!unmatchedStudent) break;

    const proposedAdvisorKey = unmatchedStudent.preferences[unmatchedStudent.nextProposalIndex];
    const advisor = advisorMap.get(proposedAdvisorKey);

    if (!advisor) {
      unmatchedStudent.nextProposalIndex += 1;
      continue;
    }

    const proposalRank = unmatchedStudent.nextProposalIndex + 1;

    if (advisor.tentativeMatches.length < advisor.capacity) {
      advisor.tentativeMatches.push({ studentName: unmatchedStudent.name, rank: proposalRank });
      unmatchedStudent.matched = true;
    } else {
      advisor.tentativeMatches.push({ studentName: unmatchedStudent.name, rank: proposalRank });
      advisor.tentativeMatches.sort((a, b) => a.rank - b.rank);
      const rejected = advisor.tentativeMatches.pop();

      if (rejected.studentName === unmatchedStudent.name) {
        unmatchedStudent.nextProposalIndex += 1;
        unmatchedStudent.matched = false;
      } else {
        unmatchedStudent.matched = true;
        const rejectedStudent = studentQueue.find((s) => s.name === rejected.studentName);
        if (rejectedStudent) {
          rejectedStudent.matched = false;
          rejectedStudent.nextProposalIndex =
            rejectedStudent.preferences.indexOf(proposedAdvisorKey) + 1;
        }
      }
    }
  }

  // Phase 3: Enforce minimum capacity constraints
  {
    const getUnderenrolledDA = () => {
      const result = [];
      advisorMap.forEach((advisor, key) => {
        const shortfall = advisor.minCapacity - advisor.tentativeMatches.length;
        if (shortfall > 0) result.push({ key, advisor, shortfall });
      });
      return result.sort((a, b) => b.shortfall - a.shortfall);
    };

    for (const { key: underKey, advisor: underAdvisor } of getUnderenrolledDA()) {
      while (underAdvisor.tentativeMatches.length < underAdvisor.minCapacity) {
        const donors = [];
        advisorMap.forEach((advisor, key) => {
          const slack = advisor.tentativeMatches.length - advisor.minCapacity;
          if (key !== underKey && slack > 0) donors.push({ key, advisor, slack });
        });
        donors.sort((a, b) => b.slack - a.slack);

        if (donors.length === 0) break;

        let bestMatch = null;
        let bestMatchDonorKey = null;
        let bestRank = Infinity;

        for (const { key: dKey, advisor: dAdvisor } of donors) {
          for (const match of dAdvisor.tentativeMatches) {
            const student = studentQueue.find((s) => s.name === match.studentName);
            if (!student) continue;
            const rank = student.preferences.indexOf(underKey);
            if (rank >= 0 && rank + 1 < bestRank) {
              bestRank = rank + 1;
              bestMatch = match;
              bestMatchDonorKey = dKey;
            }
          }
        }

        if (!bestMatch) {
          const { key: dKey, advisor: dAdvisor } = donors[0];
          bestMatch = dAdvisor.tentativeMatches[0];
          bestMatchDonorKey = dKey;
          bestRank = 999;
        }

        if (!bestMatch) break;

        const donorAdvisor = advisorMap.get(bestMatchDonorKey);
        donorAdvisor.tentativeMatches = donorAdvisor.tentativeMatches.filter(
          (m) => m.studentName !== bestMatch.studentName
        );
        underAdvisor.tentativeMatches.push({ studentName: bestMatch.studentName, rank: bestRank });
      }
    }
  }

  // Build final assignments
  const assignments = [];
  advisorMap.forEach((advisor) => {
    advisor.tentativeMatches.forEach((match) => {
      assignments.push({ student: match.studentName, advisor: advisor.name, rank: match.rank });
    });
  });

  // Handle unmatched students
  studentQueue.forEach((student) => {
    if (!student.matched) {
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

  const minimumViolations = [];
  advisorMap.forEach((advisor) => {
    if (advisor.tentativeMatches.length < advisor.minCapacity) {
      minimumViolations.push({
        name: advisor.name,
        current: advisor.tentativeMatches.length,
        minimum: advisor.minCapacity,
        shortfall: advisor.minCapacity - advisor.tentativeMatches.length
      });
    }
  });

  const studioSizes = {};
  advisorMap.forEach((advisor) => {
    studioSizes[advisor.name] = advisor.tentativeMatches.length;
  });

  const assignedSet = new Set(assignments.map((a) => a.student));
  const allStudentsAssigned = students.every((s) => assignedSet.has(s.name));

  const terminologyPlural = mode === 'studio' ? 'studios' : 'advisors';

  return {
    id: 2,
    assignments,
    summary: {
      algorithm: 'Student-Optimal Deferred Acceptance',
      averagePlacement: stats.averagePlacement,
      percentFirstChoice: stats.percentFirstChoice,
      lowestPlacement: stats.lowestPlacement,
      notes: `Maximized first-choice assignments through stable matching. Students propose to ${terminologyPlural} in preference order.`,
      strategyUsed: 'Maximize First Choices - Prioritizes number of students getting #1',
      constraintsSatisfied: minimumViolations.length === 0,
      minimumCapacityViolations: minimumViolations,
      studioSizes,
      allStudentsAssigned
    }
  };
}

/**
 * Check for constraint violations and adjust if needed
 */
function validateConstraints(assignments, advisors, students, parameters = '', mode = 'advisor') {
  const violations = [];
  const advisorCounts = new Map();
  const terminology = mode === 'studio' ? 'studio' : 'advisor';

  assignments.forEach((assignment) => {
    const key = normalizeKey(assignment.advisor);
    advisorCounts.set(key, (advisorCounts.get(key) || 0) + 1);
  });

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
          capacity: advisor.capacity,
          message: `${terminology.charAt(0).toUpperCase() + terminology.slice(1)} "${advisor.name}" must have either 0 or ${advisor.capacity} students (currently has ${count})`
        });
        zeroOrMaxViolations.push(advisor);
      }
    }
  });

  const minimumViolations = [];
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    const count = advisorCounts.get(key) || 0;
    const minCapacity = resolveMinCapacity(advisor);

    if (minCapacity > 0 && count < minCapacity && count > 0) {
      violations.push({
        type: 'minimum_capacity',
        advisor: advisor.name,
        count,
        minCapacity,
        shortfall: minCapacity - count,
        message: `${terminology.charAt(0).toUpperCase() + terminology.slice(1)} "${advisor.name}" is below minimum capacity: ${count}/${minCapacity} students (shortfall: ${minCapacity - count})`
      });
      minimumViolations.push(advisor);
    }
  });

  return {
    violations,
    hasViolations: violations.length > 0,
    zeroOrMaxViolations,
    minimumViolations
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
 */
function runMinimumRegretAlgorithm(students, advisors, parameters = '', mode = 'advisor') {
  const advisorMap = new Map();
  advisors.forEach((advisor) => {
    const key = normalizeKey(advisor.name);
    advisorMap.set(key, {
      name: advisor.name,
      capacity: advisor.capacity,
      minCapacity: resolveMinCapacity(advisor),
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

  const feasibility = checkFeasibility(students, Array.from(advisorMap.values()), mode);
  if (!feasibility.feasible) {
    return {
      error: feasibility.reason,
      assignments: [],
      summary: {
        algorithm: 'Minimum Regret (Best Alternative)',
        averagePlacement: 0,
        percentFirstChoice: 0,
        lowestPlacement: 0,
        notes: `Infeasible: ${feasibility.reason}`,
        strategyUsed: 'Minimum Regret - Balances overall satisfaction',
        studioSizes: {},
        allStudentsAssigned: false
      }
    };
  }

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

  let assignmentsMade = 0;
  const MAX_ITERATIONS = 1000;

  while (assignmentsMade < studentList.length && assignmentsMade < MAX_ITERATIONS) {
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

  // Swap optimization to reduce total regret
  const MAX_SWAP_ITERATIONS = 100;
  for (let swapIter = 0; swapIter < MAX_SWAP_ITERATIONS; swapIter += 1) {
    let improvedRegret = false;

    for (let i = 0; i < studentList.length; i += 1) {
      for (let j = i + 1; j < studentList.length; j += 1) {
        const student1 = studentList[i];
        const student2 = studentList[j];

        if (!student1.assigned || !student2.assigned) continue;

        const advisor1Key = student1.assignedAdvisor;
        const advisor2Key = student2.assignedAdvisor;

        if (advisor1Key === advisor2Key) continue;

        const currentRegret = (student1.assignedRank - 1) + (student2.assignedRank - 1);
        const student1NewRank = student1.preferences.indexOf(advisor2Key) + 1 || 999;
        const student2NewRank = student2.preferences.indexOf(advisor1Key) + 1 || 999;
        const newRegret = (student1NewRank - 1) + (student2NewRank - 1);

        if (newRegret < currentRegret) {
          const advisor1 = advisorMap.get(advisor1Key);
          const advisor2 = advisorMap.get(advisor2Key);

          advisor1.assigned = advisor1.assigned.filter((name) => name !== student1.name);
          advisor2.assigned = advisor2.assigned.filter((name) => name !== student2.name);

          advisor2.assigned.push(student1.name);
          advisor1.assigned.push(student2.name);

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

  // Phase 3: Enforce minimum capacity constraints
  {
    const getUnderenrolledMR = () => {
      const result = [];
      advisorMap.forEach((advisor, key) => {
        const shortfall = advisor.minCapacity - advisor.assigned.length;
        if (shortfall > 0) result.push({ key, advisor, shortfall });
      });
      return result.sort((a, b) => b.shortfall - a.shortfall);
    };

    for (const { key: underKey, advisor: underAdvisor } of getUnderenrolledMR()) {
      while (underAdvisor.assigned.length < underAdvisor.minCapacity) {
        const donors = [];
        advisorMap.forEach((advisor, key) => {
          const slack = advisor.assigned.length - advisor.minCapacity;
          if (key !== underKey && slack > 0) donors.push({ key, advisor, slack });
        });
        donors.sort((a, b) => b.slack - a.slack);

        if (donors.length === 0) break;

        let bestStudent = null;
        let bestStudentDonorKey = null;
        let bestRank = Infinity;

        for (const { key: dKey, advisor: dAdvisor } of donors) {
          for (const studentName of dAdvisor.assigned) {
            const student = studentList.find((s) => s.name === studentName);
            if (!student) continue;
            const rank = student.preferences.indexOf(underKey);
            if (rank >= 0 && rank + 1 < bestRank) {
              bestRank = rank + 1;
              bestStudent = student;
              bestStudentDonorKey = dKey;
            }
          }
        }

        if (!bestStudent) {
          const { key: dKey, advisor: dAdvisor } = donors[0];
          const studentName = dAdvisor.assigned[0];
          bestStudent = studentList.find((s) => s.name === studentName);
          bestStudentDonorKey = dKey;
          bestRank = 999;
        }

        if (!bestStudent) break;

        const donorAdvisor = advisorMap.get(bestStudentDonorKey);
        donorAdvisor.assigned = donorAdvisor.assigned.filter((n) => n !== bestStudent.name);
        underAdvisor.assigned.push(bestStudent.name);
        bestStudent.assignedAdvisor = underKey;
        bestStudent.assignedRank = bestRank;
      }
    }
  }

  const assignments = studentList.map((student) => ({
    student: student.name,
    advisor: advisorMap.get(student.assignedAdvisor)?.name || 'Unknown',
    rank: student.assignedRank
  }));

  const stats = calculateSummaryStats(assignments);
  const totalRegret = assignments.reduce((sum, a) => sum + (a.rank - 1), 0);

  const minimumViolations = [];
  advisorMap.forEach((advisor) => {
    if (advisor.assigned.length < advisor.minCapacity) {
      minimumViolations.push({
        name: advisor.name,
        current: advisor.assigned.length,
        minimum: advisor.minCapacity,
        shortfall: advisor.minCapacity - advisor.assigned.length
      });
    }
  });

  const studioSizes = {};
  advisorMap.forEach((advisor) => {
    studioSizes[advisor.name] = advisor.assigned.length;
  });

  const assignedSet = new Set(assignments.map((a) => a.student));
  const allStudentsAssigned = students.every((s) => assignedSet.has(s.name));

  const terminology = mode === 'studio' ? 'studio' : 'advisor';
  const terminologyPlural = mode === 'studio' ? 'studios' : 'advisors';

  return {
    id: 3,
    assignments,
    summary: {
      algorithm: 'Minimum Regret (Best Alternative)',
      averagePlacement: stats.averagePlacement,
      percentFirstChoice: stats.percentFirstChoice,
      lowestPlacement: stats.lowestPlacement,
      notes: `Minimized total regret (sum of distances from top choice) across all students. Total regret: ${totalRegret}. Students with fewer good ${terminology} options were prioritized.`,
      strategyUsed: 'Minimum Regret - Balances overall satisfaction',
      constraintsSatisfied: minimumViolations.length === 0,
      minimumCapacityViolations: minimumViolations,
      studioSizes,
      allStudentsAssigned
    }
  };
}

module.exports = {
  normalizeKey,
  runWaterFillingAlgorithm,
  runDeferredAcceptance,
  runMinimumRegretAlgorithm,
  validateConstraints,
  adjustAdvisorsForRetry,
  calculateSummaryStats
};
