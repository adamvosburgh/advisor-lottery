import { useRef, useState, useCallback } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

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
    throw new Error('Advisors file must have "Name" and "Capacity" columns. Optional: "Notes". See template for correct format.');
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
    throw new Error('No advisor rows detected. Please check your file format and see template.');
  }

  return advisors;
}

function normalizeStudentRows(results, lotteryMode = 'advisor') {
  const { data, meta } = results;
  const fields = (meta.fields || []).map((field) => field.trim());
  if (!fields.length) {
    throw new Error('Students file is missing headers.');
  }

  const studentHeader = fields[0];
  const studentHeaderNormalized = normalizeHeader(studentHeader);
  const isValidStudentHeader =
    studentHeaderNormalized === 'student' ||
    studentHeaderNormalized === 'name' ||
    (lotteryMode === 'studio' && studentHeaderNormalized.includes('pid'));

  if (!isValidStudentHeader) {
    if (lotteryMode === 'studio') {
      throw new Error('First column must be "C/PID#", "Name", or "Student". See template for correct format.');
    } else {
      throw new Error('First column must be "Name" or "Student". See template for correct format.');
    }
  }

  let preferenceStartIndex = 1;
  const terminology = lotteryMode === 'studio' ? 'studio' : 'advisor';

  // For advisor mode, require email as second column
  if (lotteryMode === 'advisor') {
    if (fields.length < 2) {
      throw new Error('Students file needs at least "Name" and "Email" columns, plus preference columns. See template for correct format.');
    }

    const secondHeader = fields[1];
    const secondHeaderNormalized = normalizeHeader(secondHeader);
    if (secondHeaderNormalized !== 'email') {
      throw new Error('Second column must be "Email". See template for correct format.');
    }

    preferenceStartIndex = 2; // Skip name and email
  }

  // Get preference columns (skip first column and email if advisor mode)
  const remainingHeaders = fields.slice(preferenceStartIndex);
  if (!remainingHeaders.length) {
    throw new Error(`Students file needs at least one ${terminology} preference column. See template for correct format.`);
  }

  // For studio mode, enforce STUDIO X header format
  if (lotteryMode === 'studio') {
    const invalidHeaders = remainingHeaders.filter((header) => !/^STUDIO [A-Z]+$/i.test(header.trim()));
    if (invalidHeaders.length) {
      throw new Error(
        `Studio columns must use the "STUDIO X" format (e.g., STUDIO A, STUDIO B). Invalid headers: ${invalidHeaders.join(', ')}`
      );
    }
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
    throw new Error('No student rows detected. Please check your file format and see template.');
  }

  return students;
}

function Dropzone({ label, mode, lotteryMode, onParsed, templatePath }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const parseFile = useCallback(
    (file) => {
      if (!file) {
        return;
      }

      const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

      if (isXlsx) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            Papa.parse(csv, {
              header: true,
              skipEmptyLines: 'greedy',
              transformHeader: (header) => header.trim(),
              complete: (results) => {
                try {
                  const payload =
                    mode === 'advisors'
                      ? normalizeAdvisorRows(results)
                      : normalizeStudentRows(results, lotteryMode);
                  onParsed(payload);
                  setFileName(file.name);
                  setError('');
                } catch (err) {
                  setFileName('');
                  setError(err.message || 'Failed to parse file.');
                }
              }
            });
          } catch (err) {
            setFileName('');
            setError(err.message || 'Failed to read XLSX file.');
          }
        };
        reader.onerror = () => {
          setFileName('');
          setError('Failed to read file.');
        };
        reader.readAsArrayBuffer(file);
      } else {
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
                  : normalizeStudentRows(results, lotteryMode);
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
      }
    },
    [mode, lotteryMode, onParsed]
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
      <div className="dropzone-label">
        {label}
        {templatePath && (
          <>
            {' / '}
            <a
              href={templatePath}
              download
              onClick={(e) => e.stopPropagation()}
              style={{ color: '#0066cc', textDecoration: 'underline' }}
            >
              TEMPLATE
            </a>
          </>
        )}
      </div>
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
          accept=".csv,.xlsx,.xls,text/csv"
          className="dropzone-input"
          onChange={onInputChange}
        />
        <div className="dropzone-message">
          {fileName ? (
            <span>{fileName}</span>
          ) : (
            <span>Drop CSV or XLSX here or click to select</span>
          )}
        </div>
      </div>
      {error && <div className="dropzone-error">{error}</div>}
    </div>
  );
}

export default Dropzone;
