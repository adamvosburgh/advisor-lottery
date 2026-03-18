// Static 2-sentence descriptions for each algorithm (layman's terms)
const ALGORITHM_DESCRIPTIONS = {
  1: 'This algorithm iteratively moves students from overloaded slots by prioritizing those who have good alternatives, converging toward a minimax outcome. It focuses on ensuring no student ends up especially far from their preferences.',
  2: 'This algorithm runs a proposal process where students suggest their top available choice and slots tentatively accept or reject — repeating until stable. It is guaranteed to produce a student-optimal matching that maximizes the number of students receiving their first choice.',
  3: 'This algorithm assigns the most constrained students first — those with the fewest viable options — then refines assignments through pairwise swaps to reduce total dissatisfaction. It minimizes the sum of preference distances across all students rather than optimizing any single metric.'
};

/**
 * Generate 2-sentence comparison text for this option vs. the other two.
 */
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
  const bestLP = me.lp <= Math.min(...others.map((o) => o.lp)); // lower = better worst case
  const worstLP = me.lp >= Math.max(...others.map((o) => o.lp));

  const fcPct = (me.fc * 100).toFixed(1);

  const strengths = [];
  const weaknesses = [];

  if (bestFC) strengths.push(`highest first-choice rate (${fcPct}%)`);
  if (bestAvg) strengths.push(`best average placement (${me.avg.toFixed(2)})`);
  if (bestLP) strengths.push(`best worst-case placement (rank ${me.lp})`);

  if (worstFC) weaknesses.push(`lowest first-choice rate (${fcPct}%)`);
  if (worstAvg) weaknesses.push(`highest average placement (${me.avg.toFixed(2)})`);
  if (worstLP) weaknesses.push(`highest worst-case placement (rank ${me.lp})`);

  let sentence1;
  let sentence2;

  if (strengths.length > 0) {
    sentence1 = `Among the three options, this output has the ${strengths.join(' and ')}.`;
  } else {
    sentence1 = `This output sits in the middle ground on all three metrics — average placement (${me.avg.toFixed(2)}), first-choice rate (${fcPct}%), and worst-case placement (rank ${me.lp}).`;
  }

  if (weaknesses.length > 0) {
    sentence2 = `The tradeoff is the ${weaknesses.join(' and ')}.`;
  } else if (strengths.length > 0) {
    sentence2 = 'It performs competitively across all three comparison metrics with no notable tradeoffs relative to the other options.';
  } else {
    sentence2 = 'No single metric stands out as notably better or worse compared to the other two options.';
  }

  return `${sentence1} ${sentence2}`;
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
        .map(([name, count]) => `${name}: ${count}`)
        .join(', ')
    : null;

  // Constraint checks
  const capacitiesMet = summary.constraintsSatisfied !== false;
  const allAssignedOnce = summary.allStudentsAssigned !== false;

  // 4-sentence description
  const staticDesc = ALGORITHM_DESCRIPTIONS[option.id] || summary.notes || '';
  const comparisonDesc = generateComparisonText(option, allOptions);
  const description = comparisonDesc ? `${staticDesc} ${comparisonDesc}` : staticDesc;

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
