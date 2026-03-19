const { generateDescription } = require('./descriptions');

/**
 * Build a Summary worksheet showing key metrics for all algorithm options.
 * @param {import('exceljs').Worksheet} worksheet
 * @param {Array} finalOptions
 * @param {'studio'|'advisor'} mode
 */
function buildSummarySheet(worksheet, finalOptions, mode) {
  const sizeLabel = mode === 'studio' ? 'Studio Sizes' : 'Advisor Load';

  worksheet.getColumn(1).width = 20;
  worksheet.getColumn(2).width = 36;
  worksheet.getColumn(3).width = 36;
  worksheet.getColumn(4).width = 36;

  // Header row
  const headerRow = worksheet.addRow(['', 'Output 1', 'Output 2', 'Output 3']);
  headerRow.font = { bold: true };

  // Scalar metric rows
  const scalarRows = [
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
    ]
  ];

  for (const rowData of scalarRows) {
    const row = worksheet.addRow(rowData);
    row.getCell(1).font = { bold: true };
  }

  // Description row — long text, wrap enabled
  const descRow = worksheet.addRow([
    'Description',
    ...finalOptions.map((o) => generateDescription(o))
  ]);
  descRow.getCell(1).font = { bold: true };
  for (let col = 2; col <= 4; col++) {
    descRow.getCell(col).alignment = { wrapText: true, vertical: 'top' };
  }
  descRow.height = 120;

  // Studio sizes row — sorted alphabetically, one per line, wrap enabled
  const sizesRow = worksheet.addRow([
    sizeLabel,
    ...finalOptions.map((o) => {
      if (!o.summary.studioSizes) return '—';
      return Object.entries(o.summary.studioSizes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([n, c]) => `${n}: ${c}`)
        .join('\n');
    })
  ]);
  sizesRow.getCell(1).font = { bold: true };
  sizesRow.getCell(1).alignment = { vertical: 'top' };
  const studioCount = finalOptions[0]?.summary?.studioSizes
    ? Object.keys(finalOptions[0].summary.studioSizes).length
    : 1;
  sizesRow.height = Math.max(20, studioCount * 15);
  for (let col = 2; col <= 4; col++) {
    sizesRow.getCell(col).alignment = { wrapText: true, vertical: 'top' };
  }
}

module.exports = { buildSummarySheet };
