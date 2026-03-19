/**
 * Algorithm descriptions and comparison text generation.
 * Logic mirrors web/src/components/OutputCard.jsx exactly.
 */

const ALGORITHM_DESCRIPTIONS = {
  1: 'This algorithm protects students from bad outcomes by resolving overloaded studios. Every student starts in their first-choice studio, then for each overfull studio, the student with the best available alternative gets moved to their next-best open studio — repeating until no studio is over capacity.',
  2: 'This algorithm maximizes the number of students who get their top choice. Each unmatched student proposes to their top remaining studio, studios accept up to capacity but bump their lowest-ranked student if a better proposal comes in, and bumped students re-propose to their next choice until everyone is placed.',
  3: 'This algorithm minimizes overall dissatisfaction across the whole group. The student with the fewest good options gets placed first into their best available studio, repeating until everyone is assigned, then pairs of students are swapped wherever a trade would reduce total dissatisfaction.'
};

function generateComparisonText(option) {
  const s = option.summary;
  const avg = typeof s.averagePlacement === 'number' ? s.averagePlacement.toFixed(2) : '—';
  const pct =
    typeof s.percentFirstChoice === 'number'
      ? `${(s.percentFirstChoice * 100).toFixed(1)}%`
      : '—';
  const lowest = typeof s.lowestPlacement === 'number' ? s.lowestPlacement : '—';
  return `Average placement: ${avg}, first-choice rate: ${pct}, worst-case placement: rank ${lowest}.`;
}

/**
 * Generate the full 4-sentence description for a single option.
 * @param {Object} option - One of finalOptions (has .id and .summary)
 * @param {Array}  allOptions - All three options (needed for comparison sentences)
 * @returns {string}
 */
function generateDescription(option) {
  const staticDesc = ALGORITHM_DESCRIPTIONS[option.id] || '';
  const comparisonDesc = generateComparisonText(option);
  return comparisonDesc ? `${staticDesc} ${comparisonDesc}` : staticDesc;
}

module.exports = { generateDescription };
