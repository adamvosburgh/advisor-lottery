/**
 * Algorithm descriptions and comparison text generation.
 * Logic mirrors web/src/components/OutputCard.jsx exactly.
 */

const ALGORITHM_DESCRIPTIONS = {
  1: 'This algorithm protects students from bad outcomes by resolving overloaded studios. Every student starts in their first-choice studio, then for each overfull studio, the student with the best available alternative gets moved to their next-best open studio — repeating until no studio is over capacity.',
  2: 'This algorithm maximizes the number of students who get their top choice. Each unmatched student proposes to their top remaining studio, studios accept up to capacity but bump their lowest-ranked student if a better proposal comes in, and bumped students re-propose to their next choice until everyone is placed.',
  3: 'This algorithm minimizes overall dissatisfaction across the whole group. The student with the fewest good options gets placed first into their best available studio, repeating until everyone is assigned, then pairs of students are swapped wherever a trade would reduce total dissatisfaction.'
};

const SELECTION_DESCRIPTIONS = {
  1: 'The algorithm runs once with the uploaded student order, then re-runs nine times with the order shuffled; the run with the lowest average placement is kept.',
  2: 'The algorithm runs once with the uploaded student order, then re-runs nine times with the order shuffled; the run with the highest first-choice rate is kept.',
  3: 'The algorithm runs once with the uploaded student order, then re-runs nine times with the order shuffled; the run with the best (lowest) worst-case placement is kept.'
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

  // Best/worst only count when there's actual variation across options.
  // If all three tie on a metric, no one is "best" or "worst" on it.
  const allAvg = metrics.map((m) => m.avg);
  const allFC = metrics.map((m) => m.fc);
  const allLP = metrics.map((m) => m.lp);
  const minAvg = Math.min(...allAvg);
  const maxAvg = Math.max(...allAvg);
  const minFC = Math.min(...allFC);
  const maxFC = Math.max(...allFC);
  const minLP = Math.min(...allLP);
  const maxLP = Math.max(...allLP);

  const bestAvg = me.avg === minAvg && minAvg !== maxAvg;
  const worstAvg = me.avg === maxAvg && minAvg !== maxAvg;
  const bestFC = me.fc === maxFC && minFC !== maxFC;
  const worstFC = me.fc === minFC && minFC !== maxFC;
  const bestLP = me.lp === minLP && minLP !== maxLP;
  const worstLP = me.lp === maxLP && minLP !== maxLP;

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
  const selectionDesc = SELECTION_DESCRIPTIONS[option.id] || '';
  const comparisonDesc = generateComparisonText(option, allOptions);
  return [staticDesc, selectionDesc, comparisonDesc].filter(Boolean).join(' ');
}

module.exports = { generateDescription };
