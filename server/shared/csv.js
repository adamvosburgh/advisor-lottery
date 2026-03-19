const path = require('path');
const { OUTPUT_DIR, writeCSV } = require('./fileio');

function assignmentsToRows(assignments, mode = 'advisor') {
  const advisorKey = mode === 'studio' ? 'studio' : 'advisor';
  return assignments.map((record) => ({
    student: record.student,
    [advisorKey]: record.advisor,
    rank: record.rank
  }));
}

function rowsToCSV(rows, mode = 'advisor') {
  const advisorKey = mode === 'studio' ? 'studio' : 'advisor';
  const header = `student,${advisorKey},rank`;
  const lines = rows.map((row) => {
    const student = row.student;
    const advisor = row[advisorKey];
    const rank = row.rank;
    return [student, advisor, rank].map((value) => {
      if (value === undefined || value === null) {
        return '';
      }
      const cell = String(value);
      return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
    }).join(',');
  });
  return [header, ...lines].join('\n');
}

async function saveOptionCSVs(lotterySlug, options, mode = 'advisor') {
  const tasks = options.map(async (option) => {
    const rows = assignmentsToRows(option.assignments, mode);
    const csvContent = rowsToCSV(rows, mode);
    const filePath = path.join(OUTPUT_DIR, `${lotterySlug}_output${option.id}.csv`);
    await writeCSV(filePath, csvContent);
  });
  await Promise.all(tasks);
}

module.exports = {
  saveOptionCSVs
};
