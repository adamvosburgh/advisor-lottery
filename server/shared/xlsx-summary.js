/**
 * Build a Summary worksheet showing key metrics for all algorithm options.
 * @param {import('exceljs').Worksheet} worksheet
 * @param {Array} finalOptions
 * @param {'studio'|'advisor'} mode
 */
function buildSummarySheet(worksheet, finalOptions, mode) {
  const sizeLabel = mode === 'studio' ? 'Studio Sizes' : 'Advisor Load';

  worksheet.getColumn(1).width = 20;
  worksheet.getColumn(2).width = 32;
  worksheet.getColumn(3).width = 32;
  worksheet.getColumn(4).width = 32;

  const headerRow = worksheet.addRow(['', 'Output 1', 'Output 2', 'Output 3']);
  headerRow.font = { bold: true };

  const rows = [
    ['Algorithm', ...finalOptions.map((o) => o.summary.algorithm)],
    [
      'Average Placement',
      ...finalOptions.map((o) =>
        typeof o.summary.averagePlacement === 'number'
          ? o.summary.averagePlacement.toFixed(2)
          : '—'
      )
    ],
    [
      '% First Choice',
      ...finalOptions.map((o) =>
        typeof o.summary.percentFirstChoice === 'number'
          ? `${(o.summary.percentFirstChoice * 100).toFixed(1)}%`
          : '—'
      )
    ],
    [
      'Lowest Placement',
      ...finalOptions.map((o) =>
        typeof o.summary.lowestPlacement === 'number' ? o.summary.lowestPlacement : '—'
      )
    ],
    [
      sizeLabel,
      ...finalOptions.map((o) =>
        o.summary.studioSizes
          ? Object.entries(o.summary.studioSizes)
              .map(([n, c]) => `${n}: ${c}`)
              .join(', ')
          : '—'
      )
    ]
  ];

  for (const rowData of rows) {
    const row = worksheet.addRow(rowData);
    row.getCell(1).font = { bold: true };
  }
}

module.exports = { buildSummarySheet };
