const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR } = require('./fileio');
const { generateDescription } = require('./descriptions');

function saveSummaryTxt(lotterySlug, finalOptions, mode) {
  const sizeLabel = mode === 'studio' ? 'Studio Sizes' : 'Advisor Load';
  const lines = [];
  for (const option of finalOptions) {
    const s = option.summary;
    const avg = typeof s.averagePlacement === 'number' ? s.averagePlacement.toFixed(2) : '—';
    const pct =
      typeof s.percentFirstChoice === 'number'
        ? `${(s.percentFirstChoice * 100).toFixed(1)}%`
        : '—';
    const lowest = typeof s.lowestPlacement === 'number' ? s.lowestPlacement : '—';
    const description = generateDescription(option, finalOptions);
    const sizeLines = s.studioSizes
      ? Object.entries(s.studioSizes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([n, c]) => `${n}: ${c}`)
      : ['—'];
    lines.push(`OUTPUT ${option.id} — ${s.algorithm}`);
    lines.push(`Average Placement: ${avg}`);
    lines.push(`% First Choice: ${pct}`);
    lines.push(`Lowest Placement: ${lowest}`);
    lines.push(`Description: ${description}`);
    lines.push(`${sizeLabel}:`);
    for (const sz of sizeLines) lines.push(sz);
    lines.push('');
  }
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${lotterySlug}_summary.txt`),
    lines.join('\n')
  );
}

module.exports = { saveSummaryTxt };
