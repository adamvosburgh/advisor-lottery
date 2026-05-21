// Static 2-sentence descriptions for each algorithm (layman's terms)
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

function OutputCard({ option, allOptions, mode = 'studio' }) {
  const { summary } = option;

  const isStudio = mode === 'studio';
  const sizeLabel = isStudio ? 'Studio Sizes' : 'Advisor Load';
  const capacityLabel = isStudio ? 'Studio sizes' : 'Advisor capacities';

  const averagePlacement =
    typeof summary.averagePlacement === 'number'
      ? summary.averagePlacement.toFixed(2)
      : '—';

  const percentFirstChoice =
    typeof summary.percentFirstChoice === 'number'
      ? `${(summary.percentFirstChoice * 100).toFixed(1)}%`
      : '—';

  const lowestPlacement =
    typeof summary.lowestPlacement === 'number' ? summary.lowestPlacement : '—';

  // Studio/advisor load sizes
  const studioSizes = summary.studioSizes
    ? Object.entries(summary.studioSizes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => `${name}: ${count}`)
        .join(', ')
    : null;

  // Constraint checks
  const capacitiesMet = summary.constraintsSatisfied !== false;
  const allAssignedOnce = summary.allStudentsAssigned !== false;

  const staticDesc = ALGORITHM_DESCRIPTIONS[option.id] || summary.notes || '';
  const selectionDesc = SELECTION_DESCRIPTIONS[option.id] || '';
  const comparisonDesc = generateComparisonText(option, allOptions);
  const description = [staticDesc, selectionDesc, comparisonDesc].filter(Boolean).join(' ');

  return (
    <div className="output-card">
      <div className="output-card__header">
        <div className="output-card__title">Output {option.id}</div>
        <div className="output-card__avg">
          Average Placement: {averagePlacement}
        </div>
      </div>

      <div className="output-card__body">
        <div className="output-card__line">
          <strong>Algorithm</strong>
          <span>{summary.algorithm}</span>
        </div>
        <div className="output-card__line">
          <strong>% First Choice</strong>
          <span>{percentFirstChoice}</span>
        </div>
        <div className="output-card__line">
          <strong>Lowest Placement</strong>
          <span>{lowestPlacement}</span>
        </div>

        {studioSizes && (
          <div className="output-card__sizes">
            <strong>{sizeLabel}</strong>
            <span>{studioSizes}</span>
          </div>
        )}

        <div className="output-card__constraints">
          <div className={`constraint-check ${capacitiesMet ? 'constraint-check--ok' : 'constraint-check--fail'}`}>
            {capacityLabel}: {capacitiesMet ? '✓' : '✗'}
          </div>
          <div className={`constraint-check ${allAssignedOnce ? 'constraint-check--ok' : 'constraint-check--fail'}`}>
            All students assigned once: {allAssignedOnce ? '✓' : '✗'}
          </div>
        </div>

        <div className="output-card__description">{description}</div>
      </div>
    </div>
  );
}

export default OutputCard;
