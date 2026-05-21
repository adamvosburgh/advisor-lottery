# GSAPP Lottery

Live: https://lottery.adamvosburgh.com — contact me if you believe you should have the password.

Faculty–student assignment tool that produces a quick first pass at lottery results for student council to work from. Two mode-aware pipelines:
- **Architecture Studio Lottery** – assigns students to studios.
- **CDP Advisor Lottery** – assigns students to advisors.

## Pipeline

For each submission:
1. **Constraint extraction (optional LLM).** If the additional-parameters field is non-empty, or any uploaded advisor/studio has a `notes` value, the text is sent to an LLM once before any algorithm runs. It returns structured hard constraints (forbidden/required pairs, conditional capacity), per-entity capacity overrides, soft constraints, and optimization goals. If both fields are blank the step is skipped and the Fast/Slow buttons in the UI are disabled. Names are pseudonymized with HMAC-SHA256 + random salt before any LLM call.
2. **Multi-run search.** Each of the three algorithms runs `N_RUNS = 10` times. Run 1 uses the original input row order; runs 2–10 use Fisher-Yates shuffles seeded from `crypto.randomBytes` so input row order doesn't silently break ties. One winner per algorithm is kept: lowest `averagePlacement` for Water-Filling, highest `percentFirstChoice` for Deferred Acceptance, lowest worst-case placement for Minimum Regret.
3. **Capacity enforcement (Phase 3).** Each algorithm finishes with a deterministic pass that pulls students from over-enrolled advisors/studios into anyone below their minimum, preferring students with the lowest rank for the under-filled destination.
4. **Deterministic validation.** Winning assignments are checked against extracted constraints (max/min capacity, conditional capacity, full assignment). Violations are reported but do not block output.
5. **Re-sort.** All three winning options are re-sorted back to the original input row order before output.

LLM providers are pluggable: local Ollama (Qwen3-8B, "Slow") or Hugging Face API (Qwen2.5-72B, "Fast"). Toggle via the UI or `LLM_PROVIDER` env var.

## Quick Start (Development)
```bash
npm install
cd web && npm install && cd ..

# Create .env in project root (see below)
npm run dev           # backend + frontend together
```
Open http://localhost:4748.

## Environment (.env at project root)
```bash
LLM_PROVIDER=ollama          # or huggingface

# Hugging Face (only if LLM_PROVIDER=huggingface)
HF_API_KEY=hf_xxx

# Ollama (only if LLM_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b

APP_SHARED_PASSWORD=         # optional; leave blank to disable
PORT=4747
```

## Using the App

In both modes, give the lottery a name (used for output file slugs) and optionally add extra constraints to the additional-parameters field in plain English. The Fast/Slow buttons select the LLM provider when the LLM is needed, and disable automatically when it isn't.

### Architecture Studio Lottery
No studio file is uploaded. Studios are inferred from the union of student preferences, and global max/min capacity are set via the numeric inputs (sent to the backend as a numeric `minCapacity` per studio, not as a notes string). Per-studio overrides can be expressed in plain English in the additional-parameters field (e.g. "Studio H can go as low as 6 students") and parsed by the LLM into `capacityOverrides`.

- Student template: [`web/public/templates/students-studio-template.csv`](web/public/templates/students-studio-template.csv)

### CDP Advisor Lottery
Upload an advisors CSV/XLSX with columns `Name`, `Capacity`, and optional `Notes`. Notes are free-form natural language ("must have 0 or 2", "won't advise X", "minimum 4 students", etc.) and are parsed by the LLM into structured constraints.

- Advisor template: [`web/public/templates/advisors-template.csv`](web/public/templates/advisors-template.csv)
- Student template: [`web/public/templates/students-template.csv`](web/public/templates/students-template.csv)

## Outputs
- `outputs/<slug>_output[1-3].csv` – assignments (real names).
- `outputs/<slug>_output[1-3].json` – full summaries and validation per option.
- `outputs/<slug>_output.xlsx` – all three options with color-coded assignments.
- `outputs/<slug>_prompt.json` – request data, extracted constraints, per-algorithm stats, winning-run indices.
- `outputs/<slug>_llm-payloads.json` – anonymized payloads sent to the LLM (pseudonyms only). `constraintExtraction: null` when the LLM was skipped.
- `outputs/<slug>_summary.txt` – human-readable summary of all three options.

## Scripts
- `npm run dev` – backend + frontend together.
- `npm run server` – backend only.
- `npm run web:dev` – frontend only.
- `npm run web` – build and preview frontend.

## Project Structure
```
advisor-lottery/
├─ server/
│  ├─ server.js              # Express API, routing, middleware
│  ├─ shared/
│  │  ├─ pipeline.js         # Orchestration: extract → multi-run → select winners → validate → write
│  │  ├─ algorithms.js       # Water-Filling, Deferred Acceptance, Minimum Regret (+ Phase 3 capacity enforcement)
│  │  ├─ constraints.js      # LLM constraint extraction + deterministic validation
│  │  ├─ llm.js              # LLM adapter (Ollama + Hugging Face)
│  │  ├─ anonymize.js        # HMAC-SHA256 pseudonymization
│  │  ├─ validate.js         # Zod request schema
│  │  ├─ csv.js              # CSV output
│  │  ├─ descriptions.js     # Algorithm descriptions + comparison text
│  │  ├─ summary.js          # Summary text file
│  │  ├─ xlsx-summary.js     # XLSX summary sheet
│  │  └─ fileio.js           # File I/O utilities
│  ├─ studio/xlsx.js         # Studio-mode XLSX export
│  └─ advisor/xlsx.js        # Advisor-mode XLSX export
├─ web/                      # Vite + React SPA
│  ├─ public/templates/      # Downloadable CSV templates
│  └─ src/
│     ├─ App.jsx
│     ├─ components/         # Dropzone, Field, OutputCard
│     └─ styles.css
├─ outputs/                  # Generated files (gitignored)
└─ examples/                 # Sample data (gitignored)
```

## Deployment
See `DEPLOYMENT.md` for PM2 + Cloudflare Tunnel setup and day-to-day operations.
