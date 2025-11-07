const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'outputs');

async function ensureOutputsDir() {
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
}

async function atomicWrite(filePath, content, encoding = 'utf8') {
  await ensureOutputsDir();
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tempFile, content, { encoding });
  await fs.promises.rename(tempFile, filePath);
}

async function writeJSON(filePath, data) {
  const payload = JSON.stringify(data, null, 2);
  await atomicWrite(filePath, payload, 'utf8');
}

async function writeCSV(filePath, csvString) {
  await atomicWrite(filePath, csvString, 'utf8');
}

module.exports = {
  OUTPUT_DIR,
  ensureOutputsDir,
  writeJSON,
  writeCSV
};
