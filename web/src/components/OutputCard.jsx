function OutputCard({ option }) {
  const { summary, csvPath, warning } = option;
  const averagePlacement =
    typeof summary.averagePlacement === 'number'
      ? summary.averagePlacement.toFixed(1)
      : '—';
  const percentFirstChoice =
    typeof summary.percentFirstChoice === 'number'
      ? `${(summary.percentFirstChoice * 100).toFixed(1)}%`
      : '—';
  const lowestPlacement =
    typeof summary.lowestPlacement === 'number' ? summary.lowestPlacement : '—';

  const handleDownload = () => {
    if (csvPath) {
      window.open(csvPath, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="output-card">
      <div className="output-card__header">
        <div className="output-card__title">Output {option.id}</div>
        <div className="output-card__meta">
          <span>Average placement: {averagePlacement}</span>
          <button
            type="button"
            className="download-button"
            onClick={handleDownload}
            aria-label={`Download option ${option.id}`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 20H18M12 4V16M12 16L8 12M12 16L16 12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="output-card__body">
        <div className="output-card__line">
          <strong>Algorithm</strong>
          <span>{summary.algorithm}</span>
        </div>
        <div className="output-card__line">
          <strong>% first choice</strong>
          <span>{percentFirstChoice}</span>
        </div>
        <div className="output-card__line">
          <strong>Lowest placement</strong>
          <span>{lowestPlacement}</span>
        </div>
        <div className="output-card__notes">{summary.notes}</div>
      </div>
      {warning && <div className="output-card__warning">{warning}</div>}
    </div>
  );
}

export default OutputCard;
