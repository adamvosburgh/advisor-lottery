// Static 2-sentence descriptions for each algorithm (layman's terms)
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

function OutputCard({ option, mode = 'studio' }) {
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

  // 4-sentence description
  const staticDesc = ALGORITHM_DESCRIPTIONS[option.id] || summary.notes || '';
  const comparisonDesc = generateComparisonText(option);
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
