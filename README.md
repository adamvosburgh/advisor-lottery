# Advisor Lottery

Single-page advisor–student lottery tool built with Vite + React on the frontend and an Express proxy on the backend. The server protects the Hugging Face API key and orchestrates MiniMax-M2 to produce three candidate assignment plans per run. Each run saves its prompt and model outputs under `outputs/`.

> **Heads-up:** Sample CSVs and screenshots live in your local `examples/` (ignored by git). Drop your own files there while testing.

## Project Structure

```
advisor-lottery/
├─ package.json              # backend deps + combined scripts
├─ server/
│  ├─ server.js              # Express API
│  └─ utils/                 # validation, Hugging Face, CSV + file helpers
├─ web/                      # Vite + React SPA
│  ├─ package.json
│  └─ src/
│     ├─ App.jsx             # single screen UI
│     ├─ components/         # Dropzone, Field, OutputCard
│     └─ styles.css          # warm, single-screen layout
├─ outputs/                  # generated prompts + CSVs (gitignored)
└─ examples/                 # place your local test CSVs (gitignored)
```

## Prerequisites

- Node.js 18+
- Hugging Face API token with access to `MiniMaxAI/MiniMax-M2`

## Installation

```bash
# install backend deps
npm install

# install frontend deps
cd web
npm install
```

## Environment

Create `.env` at the project root:

```bash
HF_API_KEY=hf_xxx          # required
APP_SHARED_PASSWORD=       # optional shared passphrase, leave blank to disable
PORT=3001                  # optional override
```

The server never exposes `HF_API_KEY` to the browser. When `APP_SHARED_PASSWORD` is set, the frontend prompts for it and sends it as the `x-app-pass` header on every `/api/run` call.

## Running Locally

```bash
# start Express (port 3001) + Vite dev server (port 3000)
npm run dev

# OR run them independently
npm run server          # backend only
npm run web:dev         # frontend only
```

Navigate to `http://localhost:3000`. Each `/api/run` request is rate limited (20/minute) and the proxy writes:

- `outputs/<lottery-slug>_prompt.json`
- `outputs/<lottery-slug>_output{1..3}.json`
- `outputs/<lottery-slug>_output{1..3}.csv`

CSV downloads are streamed via `GET /download/:filename`.

## CSV Format Cheatsheet

### Advisors

```csv
name,capacity,notes
Beth,2,Does not want Jay
Robert,3,Must have either 0 or 3 advisees (0 or max)
Ana,1,
```

- `name` (or `advisor`) and `capacity` are required.
- `notes` is optional; phrases containing “0 or max” enforce the hard rule, and “does not want ...” creates forbidden pairs.

### Students

Both styles are accepted:

```csv
# rank_* headers – left → right is top choice → fallback
student,rank_1,rank_2,rank_3
Jay,Beth,Robert,Ana
Sara,Robert,Beth,

# advisor-name headers – left → right is preference order
student,Beth,Robert,Ana
Casey,1,2,
```

Mixing styles per file is fine. Empty cells are ignored, duplicate advisor names collapse to one, and unranked advisors default to rank 999 when assigned.

## Frontend Highlights

- Roboto Mono on a warm neutral palette (`#F7F5F2` background, `#FAF7EE` cards).
- Two-dropzone upload row, field row for lottery name + parameters, center `Generate` button, and three output cards with download buttons + warning badges.
- Papa Parse handles CSV ingestion entirely in the browser—no file contents ever hit the server.

> 💡 Add a UI screenshot (e.g., `examples/ui-screenshot.png`) to this directory for quick visual reference.

## Backend Highlights

- Express proxy enforces the shared password (if set) and validates payloads with Zod.
- Prompt + raw/validated outputs are persisted to `outputs/`.
- MiniMax-M2 is called via the Hugging Face router API (`https://router.huggingface.co/v1/chat/completions`).
- Hard constraints enforced post-LLM: unique student assignments, capacity caps, “0 or max” advisors, forbidden pairs. If violations remain after a retry prompt, the offending option is flagged with a warning in the response.

## Testing Checklist

- ✅ Upload advisors CSV with “0 or max” advisor note – expect enforcement.
- ✅ Upload students CSV with partial rankings – ensure 999 rank fallback.
- ✅ Include a “does not want” forbidden pair – verify the LLM is re-prompted / warning flagged.
- ✅ Validate CSV downloads for each option (`/download/<slug>_output1.csv` etc.).
- ✅ Optional auth: set `APP_SHARED_PASSWORD`, confirm the modal gate on the SPA.

Add your own CSV fixtures under `examples/` while iterating—they remain local.

## Deployment Notes

- Keep the Express server private; the client never sees the HF token.
- Reverse proxy `/download/*` to the Node process if serving behind nginx.
- Periodically clean out `outputs/` if running unattended—they accumulate quickly.
