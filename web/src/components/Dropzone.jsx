import { useRef, useState, useCallback } from 'react';
import Papa from 'papaparse';

const GENERIC_HEADERS = ['rank', 'preference', 'choice'];

function normalizeHeader(header) {
  return header.trim().toLowerCase();
}

function isGenericHeader(header) {
  const normalized = normalizeHeader(header);
  return GENERIC_HEADERS.some((keyword) => normalized.startsWith(keyword));
}

function uniqueList(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }
  return output;
}

function normalizeAdvisorRows(results) {
  const { data, meta } = results;
  const fields = (meta.fields || []).map((field) => field.trim());
  const nameField =
    fields.find((field) => normalizeHeader(field) === 'advisor') ||
    fields.find((field) => normalizeHeader(field) === 'name');
  const capacityField = fields.find((field) => normalizeHeader(field) === 'capacity');
  const notesField = fields.find((field) => normalizeHeader(field) === 'notes');

  if (!nameField || !capacityField) {
    throw new Error('Expected headers like "name" (or "advisor") and "capacity" in advisors CSV.');
  }

  const advisors = [];
  for (const row of data) {
    if (!row || Object.keys(row).length === 0) {
      continue;
    }
    const name = (row[nameField] || '').trim();
    const capacityValue = (row[capacityField] || '').toString().trim();
    if (!name || !capacityValue) {
      continue;
    }
    const capacity = Number.parseInt(capacityValue, 10);
    if (Number.isNaN(capacity)) {
      throw new Error(`Capacity must be a number for advisor "${name}".`);
    }
    const notesRaw = notesField ? (row[notesField] || '').trim() : '';
    advisors.push({
      name,
      capacity,
      ...(notesRaw ? { notes: notesRaw } : {})
    });
  }

  if (!advisors.length) {
    throw new Error('No advisor rows detected after parsing.');
  }

  return advisors;
}

function normalizeStudentRows(results) {
  const { data, meta } = results;
  const fields = (meta.fields || []).map((field) => field.trim());
  if (!fields.length) {
    throw new Error('Students CSV is missing headers.');
  }

  const studentHeader = fields[0];
  const studentHeaderNormalized = normalizeHeader(studentHeader);
  if (studentHeaderNormalized !== 'student' && studentHeaderNormalized !== 'name') {
    throw new Error('First column must be labeled "student" or "name".');
  }

  const remainingHeaders = fields.slice(1);
  if (!remainingHeaders.length) {
    throw new Error('Students CSV needs at least one preference column.');
  }

  const allGeneric = remainingHeaders.every((header) => isGenericHeader(header));

  const students = [];
  for (const row of data) {
    if (!row || Object.keys(row).length === 0) {
      continue;
    }
    const studentName = (row[studentHeader] || '').trim();
    if (!studentName) {
      continue;
    }

    const rawValues = remainingHeaders.map((header) => {
      const cell = row[header];
      return typeof cell === 'string' ? cell.trim() : cell;
    });

    let preferences = [];

    if (allGeneric) {
      preferences = rawValues.filter((value) => typeof value === 'string' && value.length > 0);
    } else {
      const textualValues = rawValues.filter(
        (value) => typeof value === 'string' && value.length > 0 && isNaN(Number(value))
      );

      if (textualValues.length) {
        preferences = textualValues;
      } else {
        const numericRanking = remainingHeaders
          .map((header, index) => ({
            header,
            value: rawValues[index]
          }))
          .filter(({ value }) => value !== null && value !== undefined && value !== '');

        const numericOnly = numericRanking.every(({ value }) => /^\d+$/.test(String(value)));

        if (numericOnly && numericRanking.length) {
          numericRanking.sort((a, b) => Number(a.value) - Number(b.value));
          preferences = numericRanking.map(({ header }) => header.trim());
        } else if (numericRanking.length) {
          preferences = numericRanking.map(({ header }) => header.trim());
        } else {
          preferences = remainingHeaders.map((header) => header.trim());
        }
      }
    }

    preferences = uniqueList(
      preferences.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    );

    students.push({
      name: studentName,
      preferences
    });
  }

  if (!students.length) {
    throw new Error('No student rows detected after parsing.');
  }

  return students;
}

function Dropzone({ label, mode, onParsed }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const parseFile = useCallback(
    (file) => {
      if (!file) {
        return;
      }

      Papa.parse(file, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          try {
            if (results.errors && results.errors.length) {
              throw new Error(results.errors[0].message);
            }
            const payload =
              mode === 'advisors'
                ? normalizeAdvisorRows(results)
                : normalizeStudentRows(results);
            onParsed(payload);
            setFileName(file.name);
            setError('');
          } catch (err) {
            setFileName('');
            setError(err.message || 'Failed to parse CSV.');
          }
        },
        error: (err) => {
          setFileName('');
          setError(err.message || 'Failed to read CSV file.');
        }
      });
    },
    [mode, onParsed]
  );

  const handleFiles = useCallback(
    (files) => {
      const [file] = files;
      if (file) {
        parseFile(file);
      }
    },
    [parseFile]
  );

  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (event.dataTransfer?.files?.length) {
      handleFiles(event.dataTransfer.files);
    }
  };

  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const onClick = () => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  };

  const onInputChange = (event) => {
    const files = event.target.files;
    if (files?.length) {
      handleFiles(files);
    }
  };

  return (
    <div className="dropzone-card">
      <div className="dropzone-label">{label}</div>
      <div
        className={`dropzone-area ${isDragging ? 'dropzone-area--active' : ''}`}
        onClick={onClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="dropzone-input"
          onChange={onInputChange}
        />
        <div className="dropzone-message">
          {fileName ? (
            <span>{fileName}</span>
          ) : (
            <span>Drop CSV here or click to select</span>
          )}
        </div>
      </div>
      {error && <div className="dropzone-error">{error}</div>}
    </div>
  );
}

export default Dropzone;
