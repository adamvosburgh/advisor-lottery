# GSAPP Lottery

Faculty–student assignment tool with two mode-aware pipelines:
- **CDP Advisor Lottery** – assigns students to advisors.
- **Architecture Studio Lottery** – assigns students to studios.

Both modes use three deterministic algorithms plus an LLM layer for constraint extraction from natural language. Assignment validation is deterministic. Names are anonymized before any LLM call (HMAC-SHA256 + random salt). Dual LLM providers are supported (local Ollama or Hugging Face API).

## Quick Start (Development)
```bash
npm install
cd web && npm install && cd ..

# Create .env in project root (see below)
npm run dev           # runs backend + frontend together
```
Open http://localhost:4748.

## Environment (.env at project root)
```bash
# LLM Provider
LLM_PROVIDER=ollama          # or huggingface

# Hugging Face (only if LLM_PROVIDER=huggingface)
HF_API_KEY=hf_xxx

# Ollama (only if LLM_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b

# Server
APP_SHARED_PASSWORD=         # optional; leave blank to disable
PORT=4747
```

## Using the App
1) Choose **Lottery Type** in the UI: *Studio* (Architecture) or *Advisor* (CDP). The backend adjusts prompts, validation language, and file labels based on this mode.
2) Enter a lottery name (used for output filenames).
3) Upload Advisors/Studios CSV: `name,capacity,notes`.
4) Upload Students CSV (either rank columns or rank_* headers):
   ```csv
   # Style A: rank columns
   student,rank_1,rank_2,rank_3
   Casey,Alice,Bob,Carol

   # Style B: advisor/studio columns
   student,Alice,Bob,Carol
   Casey,1,2,3
   ```
   Empty cells are ignored; unranked advisors/studios default to a low preference.
5) Run. You get three options:
   - **Water-Filling (minimax)**
   - **Deferred Acceptance (first-choice heavy)**
   - **Minimum Regret (balanced)**
   Each option is validated deterministically and downloadable as CSV or XLSX.

## Outputs
- `outputs/<slug>_output[1-3].csv` – assignments (real names).
- `outputs/<slug>_output[1-3].json` – full summaries and validation per option.
- `outputs/<slug>_output.xlsx` – all three options with color-coded assignments.
- `outputs/<slug>_prompt.json` – request data + extracted constraints.
- `outputs/<slug>_llm-payloads.json` – anonymized payloads sent to the LLM (pseudonyms only).
- `outputs/<slug>_summary.txt` – human-readable summary of all three options.

## Scripts
- `npm run dev` – run backend + frontend together.
- `npm run server` – backend only.
- `npm run web:dev` – frontend only.
- `npm run web` – build and preview frontend.

## Project Structure
```
advisor-lottery/
├─ server/
│  ├─ server.js              # Express API, routing, middleware
│  ├─ shared/
│  │  ├─ pipeline.js         # Lottery orchestration (constraint extraction → algorithms → validation → output)
│  │  ├─ algorithms.js       # Water-Filling, Deferred Acceptance, Minimum Regret
│  │  ├─ constraints.js      # LLM constraint extraction + deterministic validation
│  │  ├─ llm.js              # LLM adapter (Ollama + Hugging Face)
│  │  ├─ anonymize.js        # HMAC-SHA256 pseudonymization
│  │  ├─ validate.js         # Zod request schema validation
│  │  ├─ csv.js              # CSV output generation
│  │  ├─ descriptions.js     # Algorithm descriptions + comparison text
│  │  ├─ summary.js          # Summary text file generation
│  │  ├─ xlsx-summary.js     # XLSX summary sheet builder
│  │  └─ fileio.js           # File I/O utilities
│  ├─ studio/
│  │  └─ xlsx.js             # Studio-mode XLSX export
│  └─ advisor/
│     └─ xlsx.js             # Advisor-mode XLSX export
├─ web/                      # Vite + React SPA
│  └─ src/
│     ├─ App.jsx             # Single-screen UI with mode toggle
│     ├─ components/         # Dropzone, Field, OutputCard
│     └─ styles.css
├─ outputs/                  # Generated files (gitignored)
└─ examples/                 # Sample data (gitignored)
```

## Deployment
See `DEPLOYMENT.md` for PM2 + Cloudflare Tunnel setup and day-to-day operations.
