const ExcelJS = require('exceljs');
const path = require('path');
const { OUTPUT_DIR } = require('../shared/fileio');

// Color palette — one per advisor column position (ARGB format for exceljs)
const ADVISOR_COLORS = [
  'FFE6B8AF', 'FFDD7E6B', 'FFF4CCCC', 'FFEA9999',
  'FFFCE5CD', 'FFF9CB9C', 'FFFFF2CC', 'FFFFE599',
  'FFD9EAD3', 'FFB6D7A8', 'FFD0E0E3', 'FF92D050',
  'FF00B0F0', 'FFA4C2F4', 'FFB4A7D6', 'FF00FF00',
  'FFCC4125', 'FF999999',
];

/**
 * Populate a worksheet for advisor-mode output.
 * Rows = students (by name), columns = advisors (sorted alphabetically).
 * Cell value = the rank the student gave this advisor (blank if not ranked).
 * Assigned advisor cell is highlighted.
 *
 * @param {ExcelJS.Worksheet} worksheet
 * @param {Array<{name: string, preferences: string[]}>} students
 * @param {Array<{name: string}>} advisors
 * @param {Array<{student: string, advisor: string, rank: number}>} assignments
 */
function buildAdvisorSheet(worksheet, students, advisors, assignments) {
  // Advisors sorted alphabetically for consistent column order
  const sortedAdvisors = [...advisors].sort((a, b) => a.name.localeCompare(b.name));

  const advisorColor = new Map();
  sortedAdvisors.forEach((advisor, index) => {
    advisorColor.set(advisor.name, ADVISOR_COLORS[index % ADVISOR_COLORS.length]);
  });

  // Map student name → assigned advisor name
  const assignedAdvisor = new Map();
  for (const a of assignments) {
    assignedAdvisor.set(a.student, a.advisor);
  }

  // Header row: "Name" + advisor names
  const headerRow = worksheet.addRow(['Name', ...sortedAdvisors.map((a) => a.name)]);
  headerRow.getCell(1).font = { bold: true };
  sortedAdvisors.forEach((advisor, index) => {
    const cell = headerRow.getCell(index + 2);
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: advisorColor.get(advisor.name) }
    };
  });

  // Student rows
  for (const student of students) {
    // Build preference rank lookup: advisor name → rank (1-based)
    const rankOf = new Map();
    (student.preferences || []).forEach((advisorName, index) => {
      rankOf.set(advisorName, index + 1);
    });

    const rowValues = [
      student.name,
      ...sortedAdvisors.map((a) => rankOf.get(a.name) ?? '')
    ];
    const row = worksheet.addRow(rowValues);

    // Highlight the assigned advisor cell
    const assigned = assignedAdvisor.get(student.name);
    if (assigned) {
      const col = sortedAdvisors.findIndex((a) => a.name === assigned);
      if (col !== -1) {
        row.getCell(col + 2).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: advisorColor.get(assigned) }
        };
      }
    }
  }
}

/**
 * Generate a single xlsx file with one sheet per algorithm output.
 * Called for advisor-mode runs.
 */
async function saveAdvisorXLSX(lotterySlug, students, advisors, finalOptions) {
  const workbook = new ExcelJS.Workbook();

  for (const option of finalOptions) {
    const sheet = workbook.addWorksheet(`Option ${option.id}`);
    buildAdvisorSheet(sheet, students, advisors, option.assignments);
  }

  const filePath = path.join(OUTPUT_DIR, `${lotterySlug}_output.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { saveAdvisorXLSX };
