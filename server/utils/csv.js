const path = require('path');
const { OUTPUT_DIR, writeCSV } = require('./fileio');

function assignmentsToRows(assignments) {
  return assignments.map((record) => ({
    student: record.student,
    advisor: record.advisor,
    rank: record.rank
  }));
}

function rowsToCSV(rows) {
  const header = 'student,advisor,rank';
  const lines = rows.map(({ student, advisor, rank }) =>
    [student, advisor, rank].map((value) => {
      if (value === undefined || value === null) {
        return '';
      }
      const cell = String(value);
      return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
    }).join(',')
  );
  return [header, ...lines].join('\n');
}

async function saveOptionCSVs(lotterySlug, options) {
  const tasks = options.map(async (option) => {
    const rows = assignmentsToRows(option.assignments);
    const csvContent = rowsToCSV(rows);
    const filePath = path.join(OUTPUT_DIR, `${lotterySlug}_output${option.id}.csv`);
    await writeCSV(filePath, csvContent);
  });
  await Promise.all(tasks);
}

module.exports = {
  assignmentsToRows,
  saveOptionCSVs
};
