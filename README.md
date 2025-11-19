# Advisor Lottery

Faculty–student assignment tool using three deterministic matching algorithms with LLM-powered constraint extraction and validation.

**Live Site:** https://lab.adamvosburgh.com

**Architecture:**
1. Three deterministic algorithms generate optimal assignments
2. Names are anonymized before LLM calls (HMAC-SHA256 + random salt)
3. LLM extracts constraints from natural language and validates outputs
4. Results are de-anonymized and returned with real names
5. Dual LLM support: local Ollama (free, slow) or HuggingFace API (paid, fast)

## Quick Start

### Development
```bash
npm install
cd web && npm install && cd ..

# Create .env in root directory
npm run dev
```

Navigate to `http://localhost:4748`

### Production
See `DEPLOYMENT.md` for full deployment instructions with PM2 and Cloudflare Tunnel.

## Environment

Create `.env` at project root:

```bash
# LLM Provider (ollama or huggingface)
LLM_PROVIDER=ollama

# HuggingFace (only if LLM_PROVIDER=huggingface)
HF_API_KEY=hf_xxx

# Ollama (only if LLM_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Server
APP_SHARED_PASSWORD=       # optional - leave blank to disable password protection
PORT=4747                  # backend port
```

## How It Works

### 1. Upload CSVs

**Faculty:**
```csv
name,capacity,notes
Alice,2,Must have either 0 or 2 students
Bob,3,Would prefer 1 student
Carol,1,
```

**Students:**
```csv
student,rank_1,rank_2,rank_3
Jay,Alice,Bob,Carol
Sara,Bob,Alice,Carol
```

### 2. Algorithms Generate Assignments

Three deterministic algorithms run in parallel:
- **Water-Filling**: Minimizes worst-case placement (minimax)
- **Deferred Acceptance**: Maximizes first-choice assignments (greedy)
- **Minimum Regret**: Balances overall satisfaction (constraint satisfaction heuristics)

### 3. LLM Validation

**Dual LLM Support:**
- **Ollama (Local)**: Llama-3.1-8B running locally - free, slower (~5 min)
- **HuggingFace (API)**: Llama-3.1-70B via API - paid, faster (~10 sec)
- Toggle between providers in the UI or via `.env`

**LLM Tasks:**
- Extracts constraints from natural language (e.g., "must have 0 or 2 students" → conditional capacity constraint)
- Categorizes into hard constraints (violations block solution), soft constraints (generate warnings), and optimization goals (guide user choice)
- Validates all three algorithm outputs
- Generates plain-language summaries tailored to user's specific constraints

### 4. Privacy Layer

All names are anonymized before LLM calls:
- Uses HMAC-SHA256 with random 256-bit salt (unique per run)
- Salt never sent to API 
- Results de-anonymized before returning to user

### 5. Output Files

Each run writes to `outputs/`:
- `<slug>_output1.csv`, `_output2.csv`, `_output3.csv` - Downloadable results
- `<slug>_prompt.json` - Request data and extracted constraints (real names)
- `<slug>_llm-payloads.json` - Anonymized data sent to API (for transparency)

## Project Structure

```
advisor-lottery/
├─ server/
│  ├─ server.js              # Express API with algorithm orchestration
│  └─ utils/
│     ├─ algorithms.js       # Water-Filling, Deferred Acceptance, Minimum Regret
│     ├─ hf.js               # LLM constraint extraction & validation
│     ├─ anonymize.js        # HMAC-SHA256 pseudonymization
│     ├─ validate.js         # Zod schema validation
│     ├─ csv.js              # CSV output generation
│     └─ fileio.js           # File I/O utilities
├─ web/                      # Vite + React SPA
│  └─ src/
│     ├─ App.jsx             # Single-screen UI
│     ├─ components/         # Dropzone, Field, OutputCard
│     └─ styles.css
├─ outputs/                  # Generated files (gitignored)
└─ examples/                 # Test data (gitignored)
```

## Technical Details

- **LLM**: Llama-3.1-70B-Instruct via Hugging Face Router API
- **Constraint Extraction**: System prompt categorizes natural language into hard/soft/optimization constraints
- **Validation**: LLM checks algorithm outputs against extracted constraints, triggers retries if violations detected
- **Anonymization**: HMAC-SHA256 with random salt prevents rainbow table attacks
- **Fallback**: LLM failures fall back to regex-based validation
- **Rate Limit**: 20 requests/minute
- **Auth**: Optional shared password via `APP_SHARED_PASSWORD`

## CSV Format Notes

**Students CSV** accepts two styles:
```csv
# Style 1: rank_* headers
student,rank_1,rank_2,rank_3
Casey,Alice,Bob,Carol

# Style 2: faculty-name headers
student,Alice,Bob,Carol
Casey,1,2,3
```

Mixing styles is fine. Empty cells ignored, unranked faculty default to rank 999.

## Deployment

- Keep Express server private (never expose `HF_API_KEY`)
- Reverse proxy `/download/*` if behind nginx
- Periodically clean `outputs/` directory
