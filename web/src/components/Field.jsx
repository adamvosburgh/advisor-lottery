function Field({ label, value, onChange, placeholder, multiline = false }) {
  return (
    <label className="field-card">
      <span className="field-label">{label}</span>
      {multiline ? (
        <textarea
          className="field-input field-input--textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={5}
        />
      ) : (
        <input
          className="field-input"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

export default Field;
