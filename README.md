# Clinical Multi-Station Workflow

A full-stack clinical workflow system for multi-station patient processing.

This project supports:
- Station 1 registration with complete demographic form capture
- Station 2-6 clinical updates (fibroscan, BCA, video, retinal, blood)
- Live incoming patient feed for downstream stations
- Strict station-level access control
- Local-first storage with optional Google Sheets sync
- Offline Excel backup export

---

## Project Structure

- `backend/`
  - Express + TypeScript API server
  - SQLite local persistence (`clinic_backup.db`)
  - Offline Excel backup writer (`clinic_backup_offline.xlsx`)
  - Google Sheets sync integration
- `frontend/frontend/`
  - React + TypeScript + Vite station UI
- `shared-types.ts`
  - Shared type contracts between frontend and backend
- `shared-types.js`
  - Runtime-compatible shared types artifact
- `scripts/start-stations.sh`
  - Starts backend and frontend, selects free frontend port, prints station URLs
- `scripts/stop-stations.sh`
  - Stops processes created by start script
- `.run/`
  - Runtime PID and log files

---

## How the Workflow Operates

### Station Responsibilities

- Station 1
  - Registers patient
  - Generates unique daily 3-digit `tempId`
  - Saves full baseline profile
- Station 2
  - Updates fibroscan data
- Station 3
  - Updates BCA data
- Station 4
  - Updates video status
- Station 5
  - Updates retinal data
- Station 6
  - Updates blood sample status

### End-to-End Data Flow

1. Station 1 submits registration
2. Backend stores record in SQLite
3. Backend emits live event (`patient-registered`)
4. Station 2-6 screens receive incoming IDs in dropdown
5. Selected station updates only its own section
6. Backend emits `patient-updated`
7. Optional Google Sheets sync runs best-effort
8. Excel backup is refreshed locally

---

## Station Isolation and Security Model

Station independence is enforced at API level.

### Credential Model

Each request includes station credentials:
- Header: `x-station-number`
- Header: `x-station-id`
- Header: `x-station-password`

For Server-Sent Events stream:
- Query param: `station`
- Query param: `operatorId`
- Query param: `password`

### Isolation Rules

- A station can only call endpoints allowed for that station.
- Update endpoint enforces strict mapping:
  - Station 2 -> `fibroscan`
  - Station 3 -> `bca`
  - Station 4 -> `video`
  - Station 5 -> `retinal`
  - Station 6 -> `blood`
- Unauthorized or mismatched credentials return HTTP `403`.

Default credentials (override in `.env`):
- Station 1: ID `station1`, password `station1pass`
- Station 2: ID `station2`, password `station2pass`
- Station 3: ID `station3`, password `station3pass`
- Station 4: ID `station4`, password `station4pass`
- Station 5: ID `station5`, password `station5pass`
- Station 6: ID `station6`, password `station6pass`

---

## Prerequisites

- Node.js 18+ (recommended 20+)
- npm
- macOS/Linux shell for provided scripts
- Optional for Google sync:
  - Service Account credentials in `.env`, or
  - Application Default Credentials (`gcloud auth application-default login`)

---

## Setup

### 1) Install dependencies

From project root:

```bash
cd backend && npm install
cd ../frontend/frontend && npm install
```

### 2) Configure backend environment

Create `backend/.env` and set values as needed.

Supported backend environment variables:
- `PORT` (default: `5001`)
- `STATION_1_ID` to `STATION_6_ID`
- `STATION_1_PASSWORD` to `STATION_6_PASSWORD`
- `GOOGLE_SHEETS_ID`
- `GOOGLE_SHEETS_TAB` (default: `Patients`)
- `GOOGLE_USE_ADC` (`true` to use ADC)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` (when not using ADC)
- `GOOGLE_PRIVATE_KEY` (when not using ADC)
- `GOOGLE_PULL_INTERVAL_MS` (default: `2000`)

---

## Running the Project

### Recommended: script-based startup

From root:

```bash
zsh scripts/start-stations.sh
```

The script:
- Starts backend on port `5001` (or reuses if already healthy)
- Starts frontend on first available port from `5173`
- Sets frontend API base URL to backend host
- Prints direct station URLs:
  - `...?station=1`
  - `...?station=2`
  - `...?station=3`
  - `...?station=4`
  - `...?station=5`
  - `...?station=6`

Stop services:

```bash
zsh scripts/stop-stations.sh
```

### Manual development mode

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend/frontend
npm run dev
```

Production build checks:

```bash
cd backend && npm run build
cd ../frontend/frontend && npm run build
```

---

## Frontend Behavior

- Station can be locked by URL query `?station=N`
- Station ID and password can be saved in browser local storage per station
- Station screen remains hidden until valid station login is completed
- Station 2-6 show live incoming IDs as dropdown selection
- Patient progress panel shows completion state across stations
- Footer includes copyright attribution

---

## API Reference (Core)

### Health and utility
- `GET /api/health`
- `GET /api/id-status`

### Registration
- `POST /api/register`
  - Allowed: Station 1 only
  - Requires station auth headers

### Station auth check
- `GET /api/station/auth-check`
  - Allowed: Station 1-6
  - Requires station auth headers

### Station reads
- `GET /api/patient/:id`
  - Allowed: Stations 2-6
  - Requires station auth headers
- `GET /api/patients/today`
  - Allowed: Stations 2-6
  - Requires station auth headers

### Station updates
- `PUT /api/patient/:id/station/:station`
  - Allowed station must match `:station`
  - Requires matching station auth headers

### Live events
- `GET /api/events?station=<2..6>&operatorId=<station-id>&password=<station-password>`
  - SSE stream for incoming and updates

### Sync
- `GET /api/sync/config`
- `POST /api/sync/pending`
- `POST /api/sync/pull`

---

## Data and Backup

Primary local store:
- `backend/clinic_backup.db`

Offline export refreshed on each local write:
- `backend/clinic_backup_offline.xlsx`

Notes:
- Local DB is source of truth.
- Excel backup failures do not block DB writes.
- Google sync failures are handled as non-blocking.

---

## Troubleshooting

### `403 Unauthorized station credentials`
- Verify `x-station-number`, `x-station-id`, and `x-station-password`
- Verify `.env` station ID/password values
- Verify station is calling only permitted endpoint

### `curl` returns connection refused / exit code 7
- Backend not running on expected port
- Start services with `zsh scripts/start-stations.sh`

### No live incoming IDs at Station 2-6
- Ensure Station 1 successfully registered patient
- Ensure SSE endpoint is reachable
- Ensure station auth for event stream is valid

### Google sync not happening
- Check `GET /api/sync/config`
- Validate `GOOGLE_*` env configuration
- If using ADC, ensure `gcloud` ADC login is present

---

## Developer Notes

- Shared contracts are in `shared-types.ts`
- Backend uses TypeScript ESM (`"type": "module"`)
- Frontend uses Vite + React 18
- Station-level isolation is enforced server-side and should not be relaxed

---

## Copyright

Md Ashraf, 2026
Institute Of Liver And Billiary Science, New Delhi
