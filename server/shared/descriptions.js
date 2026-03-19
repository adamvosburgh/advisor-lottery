/**
 * Algorithm descriptions and comparison text generation.
 * Logic mirrors web/src/components/OutputCard.jsx exactly.
 */

const ALGORITHM_DESCRIPTIONS = {
  1: 'This algorithm protects students from bad outcomes by resolving overloaded studios. Every student starts in their first-choice studio, then for each overfull studio, the student with the best available alternative gets moved to their next-best open studio — repeating until no studio is over capacity.',
  2: 'This algorithm maximizes the number of students who get their top choice. Each unmatched student proposes to their top remaining studio, studios accept up to capacity but bump their lowest-ranked student if a better proposal comes in, and bumped students re-propose to their next choice until everyone is placed.',
  3: 'This algorithm minimizes overall dissatisfaction across the whole group. The student with the fewest good options gets placed first into their best available studio, repeating until everyone is assigned, then pairs of students are swapped wherever a trade would reduce total dissatisfaction.'
};

function generateComparisonText(option, allOptions) {
  if (!allOptions || allOptions.length < 3) return '';

  const metrics = allOptions.map((o) => ({
    id: o.id,
    avg: o.summary.averagePlacement,
    fc: o.summary.percentFirstChoice,
    lp: o.summary.lowestPlacement
  }));

  const me = metrics.find((m) => m.id === option.id);
  if (!me) return '';
  const others = metrics.filter((m) => m.id !== option.id);

  const bestAvg = me.avg <= Math.min(...others.map((o) => o.avg));
  const worstAvg = me.avg >= Math.max(...others.map((o) => o.avg));
  const bestFC = me.fc >= Math.max(...others.map((o) => o.fc));
  const worstFC = me.fc <= Math.min(...others.map((o) => o.fc));
  const bestLP = me.lp <= Math.min(...others.map((o) => o.lp));
  const worstLP = me.lp >= Math.max(...others.map((o) => o.lp));

  const strengths = [];
  const weaknesses = [];
  if (bestFC) strengths.push('highest first-choice rate');
  if (bestAvg) strengths.push('best average placement');
  if (bestLP) strengths.push('best worst-case placement');
  if (worstFC) weaknesses.push('lowest first-choice rate');
  if (worstAvg) weaknesses.push('highest average placement');
  if (worstLP) weaknesses.push('highest worst-case placement');

  if (strengths.length > 0 && weaknesses.length > 0) {
    return `This output has the ${strengths.join(' and ')} but the ${weaknesses.join(' and ')}.`;
  }
  if (strengths.length > 0) {
    return `This output has the ${strengths.join(' and ')} with no notable tradeoffs.`;
  }
  if (weaknesses.length > 0) {
    return `This output has no standout strengths but the ${weaknesses.join(' and ')}.`;
  }
  return 'This output sits in the middle ground across all three metrics.';
}

/**
 * Generate the full description for a single option.
 * @param {Object} option     - One of finalOptions (has .id and .summary)
 * @param {Array}  allOptions - All three options (needed for comparison sentence)
 * @returns {string}
 */
function generateDescription(option, allOptions) {
  const staticDesc = ALGORITHM_DESCRIPTIONS[option.id] || '';
  const comparisonDesc = generateComparisonText(option, allOptions);
  return comparisonDesc ? `${staticDesc} ${comparisonDesc}` : staticDesc;
}

module.exports = { generateDescription };
