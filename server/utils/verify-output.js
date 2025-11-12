const fs = require('fs');

/**
 * Simple CSV parser that handles quoted fields
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    data.push(row);
  }

  return data;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

/**
 * Verifies lottery output against input data for correctness
 * @param {string} studentsCsvPath - Path to students CSV file
 * @param {string} advisorsCsvPath - Path to advisors CSV file
 * @param {string} outputJsonPath - Path to output JSON file (single option)
 * @returns {object} Verification results with any issues found
 */
function verifyOutput(studentsCsvPath, advisorsCsvPath, outputJsonPath) {
  // Read input data
  const studentsCSV = fs.readFileSync(studentsCsvPath, 'utf-8');
  const advisorsCSV = fs.readFileSync(advisorsCsvPath, 'utf-8');
  const outputData = JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8'));

  const studentsData = parseCSV(studentsCSV);
  const advisorsData = parseCSV(advisorsCSV);

  const results = {
    valid: true,
    issues: [],
    warnings: []
  };

  // Build student preferences map
  const studentPreferences = {};
  studentsData.forEach(student => {
    if (!student.Name) return;
    const preferences = [];
    for (let i = 1; i <= 20; i++) {
      const choice = student[`${i}${getOrdinalSuffix(i)} Choice`];
      if (choice) preferences.push(choice);
    }
    studentPreferences[student.Name] = preferences;
  });

  // Build advisor constraints map
  const advisorConstraints = {};
  advisorsData.forEach(advisor => {
    if (!advisor.name) return;
    advisorConstraints[advisor.name] = {
      capacity: parseInt(advisor.capacity),
      notes: advisor.notes || ''
    };
  });

  const inputStudents = Object.keys(studentPreferences);
  const inputAdvisors = Object.keys(advisorConstraints);

  // 1. Verify all students are assigned
  const outputStudents = outputData.assignments.map(a => a.student);
  const missingStudents = inputStudents.filter(s => !outputStudents.includes(s));
  const extraStudents = outputStudents.filter(s => !inputStudents.includes(s));

  if (missingStudents.length > 0) {
    results.valid = false;
    results.issues.push(`Missing students in output: ${missingStudents.join(', ')}`);
  }

  if (extraStudents.length > 0) {
    results.valid = false;
    results.issues.push(`HALLUCINATED students not in input: ${extraStudents.join(', ')}`);
  }

  if (outputStudents.length !== inputStudents.length) {
    results.valid = false;
    results.issues.push(`Student count mismatch: ${outputStudents.length} in output vs ${inputStudents.length} in input`);
  }

  // Check for duplicate student assignments
  const studentSet = new Set();
  outputData.assignments.forEach(a => {
    if (studentSet.has(a.student)) {
      results.valid = false;
      results.issues.push(`Duplicate assignment: ${a.student} assigned multiple times`);
    }
    studentSet.add(a.student);
  });

  // 2. Verify all advisors are valid
  const outputAdvisors = [...new Set(outputData.assignments.map(a => a.advisor))];
  const hallucinated = outputAdvisors.filter(a => !inputAdvisors.includes(a));

  if (hallucinated.length > 0) {
    results.valid = false;
    results.issues.push(`HALLUCINATED advisors not in input: ${hallucinated.join(', ')}`);
  }

  // 3. Verify capacity constraints
  const advisorCounts = {};
  outputData.assignments.forEach(a => {
    advisorCounts[a.advisor] = (advisorCounts[a.advisor] || 0) + 1;
  });

  Object.entries(advisorCounts).forEach(([advisor, count]) => {
    const constraint = advisorConstraints[advisor];
    if (!constraint) return;

    if (count > constraint.capacity) {
      results.valid = false;
      results.issues.push(`CAPACITY VIOLATION: ${advisor} has ${count} students (capacity: ${constraint.capacity})`);
    }

    // Check special constraints (e.g., "Must have either 0 or 2 students")
    if (constraint.notes) {
      const match = constraint.notes.match(/must have either (\d+) or (\d+) students/i);
      if (match) {
        const allowed = [parseInt(match[1]), parseInt(match[2])];
        if (!allowed.includes(count)) {
          results.valid = false;
          results.issues.push(`SPECIAL CONSTRAINT VIOLATION: ${advisor} has ${count} students (must have ${allowed[0]} or ${allowed[1]})`);
        }
      }
    }
  });

  // 4. Verify rankings are accurate
  const rankingErrors = [];
  outputData.assignments.forEach(a => {
    const preferences = studentPreferences[a.student];
    if (!preferences) return;

    const actualRank = preferences.indexOf(a.advisor) + 1;
    if (actualRank === 0) {
      // Advisor not in preferences, should be 999
      if (a.rank !== 999) {
        rankingErrors.push(`${a.student} → ${a.advisor}: rank should be 999 (not in preferences) but is ${a.rank}`);
      }
    } else {
      // Advisor in preferences
      if (a.rank !== actualRank) {
        rankingErrors.push(`${a.student} → ${a.advisor}: rank should be ${actualRank} but is ${a.rank}`);
      }
    }
  });

  if (rankingErrors.length > 0) {
    results.valid = false;
    results.issues.push(`RANKING ERRORS (${rankingErrors.length}):`);
    rankingErrors.forEach(err => results.issues.push(`  - ${err}`));
  }

  // 5. Calculate statistics
  const ranks = outputData.assignments.map(a => a.rank);
  const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  const firstChoiceCount = ranks.filter(r => r === 1).length;
  const maxRank = Math.max(...ranks);

  results.stats = {
    totalStudents: outputData.assignments.length,
    averageRank: parseFloat(avgRank.toFixed(2)),
    firstChoicePercent: parseFloat((firstChoiceCount / ranks.length).toFixed(4)),
    lowestRank: maxRank,
    reportedAvg: outputData.summary?.averagePlacement,
    reportedFirstChoice: outputData.summary?.percentFirstChoice,
    reportedLowest: outputData.summary?.lowestPlacement
  };

  // Check if reported stats match calculated stats
  if (Math.abs(results.stats.averageRank - results.stats.reportedAvg) > 0.01) {
    results.warnings.push(`Reported average (${results.stats.reportedAvg}) doesn't match calculated (${results.stats.averageRank})`);
  }

  return results;
}

function getOrdinalSuffix(i) {
  const j = i % 10;
  const k = i % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length !== 3) {
    console.log('Usage: node verify-output.js <students.csv> <advisors.csv> <output.json>');
    console.log('Example: node verify-output.js examples/sp2026-student-selections-ex1.csv examples/sp2026-advisor-options.csv outputs/spring-2026-test-data-1-llama70b_output1.json');
    process.exit(1);
  }

  const [studentsCsv, advisorsCsv, outputJson] = args;

  console.log('=== LOTTERY OUTPUT VERIFICATION ===');
  console.log(`Students: ${studentsCsv}`);
  console.log(`Advisors: ${advisorsCsv}`);
  console.log(`Output: ${outputJson}`);
  console.log('');

  const results = verifyOutput(studentsCsv, advisorsCsv, outputJson);

  if (results.issues.length === 0) {
    console.log('✓ ALL CHECKS PASSED');
  } else {
    console.log('❌ ISSUES FOUND:');
    results.issues.forEach(issue => console.log(issue));
  }

  if (results.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:');
    results.warnings.forEach(warning => console.log(warning));
  }

  console.log('\n=== STATISTICS ===');
  console.log(`Total Students: ${results.stats.totalStudents}`);
  console.log(`Average Rank: ${results.stats.averageRank} (reported: ${results.stats.reportedAvg})`);
  console.log(`First Choice %: ${(results.stats.firstChoicePercent * 100).toFixed(2)}% (reported: ${(results.stats.reportedFirstChoice * 100).toFixed(2)}%)`);
  console.log(`Lowest Rank: ${results.stats.lowestRank} (reported: ${results.stats.reportedLowest})`);

  console.log('\n=== RESULT ===');
  console.log(results.valid ? '✓ OUTPUT IS VALID' : '❌ OUTPUT IS INVALID');

  process.exit(results.valid ? 0 : 1);
}

module.exports = { verifyOutput };
