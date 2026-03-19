const ExcelJS = require('exceljs');
const path = require('path');
const { OUTPUT_DIR } = require('../shared/fileio');
const { buildSummarySheet } = require('../shared/xlsx-summary');

// Color palette — one per studio column position (ARGB format for exceljs)
const STUDIO_COLORS = [
  'FFE6B8AF', // 1st  — light salmon
  'FFDD7E6B', // 2nd  — darker salmon
  'FFF4CCCC', // 3rd  — light pink
  'FFEA9999', // 4th  — medium pink
  'FFFCE5CD', // 5th  — light peach
  'FFF9CB9C', // 6th  — peach
  'FFFFF2CC', // 7th  — light yellow
  'FFFFE599', // 8th  — yellow
  'FFD9EAD3', // 9th  — light green
  'FFB6D7A8', // 10th — green
  'FFD0E0E3', // 11th — light teal
  'FF92D050', // 12th — bright green
  'FF00B0F0', // 13th — blue
  'FFA4C2F4', // 14th — light blue
  'FFB4A7D6', // 15th — lavender
  'FF00FF00', // 16th — lime
  'FFCC4125', // 17th — red
  'FF999999', // 18th — gray
];

/**
 * Populate a worksheet with the ballot grid + assignment colors for one algorithm output.
 */
function buildSheet(worksheet, students, assignments) {
  const studioSet = new Set();
  for (const student of students) {
    for (const pref of student.preferences) {
      studioSet.add(pref);
    }
  }
  const studios = Array.from(studioSet).sort();

  const studioColor = new Map();
  studios.forEach((studio, index) => {
    studioColor.set(studio, STUDIO_COLORS[index % STUDIO_COLORS.length]);
  });

  const assignedStudio = new Map();
  for (const a of assignments) {
    assignedStudio.set(a.student, a.advisor);
  }

  // Header row
  const headerRow = worksheet.addRow(['C/PID#', ...studios]);
  headerRow.getCell(1).font = { bold: true };
  studios.forEach((studio, index) => {
    const cell = headerRow.getCell(index + 2);
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: studioColor.get(studio) } };
  });

  // Student rows
  for (const student of students) {
    const rankOf = new Map();
    student.preferences.forEach((studio, index) => {
      rankOf.set(studio, index + 1);
    });

    const rowValues = [student.name, ...studios.map((s) => rankOf.get(s) ?? '')];
    const row = worksheet.addRow(rowValues);

    const assigned = assignedStudio.get(student.name);
    if (assigned) {
      const col = studios.indexOf(assigned);
      if (col !== -1) {
        row.getCell(col + 2).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: studioColor.get(assigned) }
        };
      }
    }
  }
}

/**
 * Generate a single xlsx file with one sheet per algorithm output.
 * Called for studio-mode runs.
 */
async function saveStudioXLSX(lotterySlug, students, finalOptions) {
  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet('Summary');
  buildSummarySheet(summarySheet, finalOptions, 'studio');

  for (const option of finalOptions) {
    const sheet = workbook.addWorksheet(`Option ${option.id}`);
    buildSheet(sheet, students, option.assignments);
  }

  const filePath = path.join(OUTPUT_DIR, `${lotterySlug}_output.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { saveStudioXLSX };
