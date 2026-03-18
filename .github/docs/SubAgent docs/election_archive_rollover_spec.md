# Election Data Archive / Rollover Feature Specification

**Project:** Voter Outreach & Mapping Platform — Obion County, Tennessee  
**Feature:** Election Cycle Archive & Rollover  
**Spec Version:** 1.0  
**Authored:** 2026-03-11  
**Status:** Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Research Basis & Best Practices](#3-research-basis--best-practices)
4. [Proposed Feature Architecture](#4-proposed-feature-architecture)
5. [Database Schema Changes](#5-database-schema-changes)
6. [API Endpoint Definitions](#6-api-endpoint-definitions)
7. [Frontend Component Plan](#7-frontend-component-plan)
8. [Step-by-Step Implementation Plan](#8-step-by-step-implementation-plan)
9. [Migration Strategy](#9-migration-strategy)
10. [Risk Analysis & Mitigations](#10-risk-analysis--mitigations)

---

## 1. Executive Summary

The Voter Outreach & Mapping Platform currently operates as a **single-cycle system**: every import overwrites or updates the live voter/election-history dataset with no concept of a named election cycle, no historical snapshots, and no ability to compare data across elections. When the Obion County Election Commission releases a new voter file after each election, the campaign team must choose between overwriting existing data (losing historical context) or avoiding re-imports altogether.

The **Election Data Archive / Rollover** feature introduces first-class, named **election cycles** (e.g., "2024 General Election", "2026 Primary"). At any time, users can:

1. **Archive the current state** — freeze a named snapshot of all voters, their election history, routes, and analytics under a cycle label.
2. **Prepare for the next cycle** — optionally reset per-election data (election history, saved routes) while retaining the geocoded voter address list — the most expensive asset to rebuild.
3. **Browse and compare past cycles** — view archived analytics, download CSV/ZIP exports, or inspect which voters appeared in a past cycle.
4. **Restore** for comparison — view the system through the lens of any past cycle without destructively altering live data.

The implementation is deliberately additive and non-destructive: existing tables gain nullable FK columns; no data is deleted without an explicit confirmation; the archive operation uses a transaction so it either completes fully or rolls back.

---

## 2. Current State Analysis

### 2.1 Database Tables (Inferred from setup.js, migrations 003–009, and models)

| Table | Purpose | Key Columns |
|---|---|---|
| `voters` | Master voter registry | `id`, `voter_id` (TEXT UNIQUE), `last_name`, `first_name`, `address`, `city`, `state`, `zip_code`, `precinct_number`, `date_of_birth`, `latitude`, `longitude`, `geocoding_quality`, `super_voter`, `created_at`, `updated_at` |
| `election_history` | Per-voter per-election participation record | `id`, `voter_id` (FK → voters.voter_id), `election_code` (e.g. "E_1", "E_2"), `voted`, `party_code`, `early_voted`, `created_at` |
| `precincts` | Precinct stats cache | `id`, `precinct_number`, `name`, `total_voters`, `active_voters`, `super_voters`, `created_at` |
| `geocoding_cache` | Address-to-coordinate cache | `id`, `address_hash`, `original_address`, `formatted_address`, `latitude`, `longitude`, `quality_score`, `place_id`, `components`, `cached_at` |
| `import_logs` | File upload/import job history | `id`, `filename`, `file_size`, `total_records`, `records_processed`, `records_successful`, `records_failed`, `start_time`, `end_time`, `status`, `error_message` |
| `import_errors` | Per-record import failures | `id`, `import_id` (FK), `record_number`, `error_type`, `error_message`, `record_data` |
| `geocoding_jobs` | Batch geocoding progress | `id`, `status`, `total_records`, `processed_count`, `success_count`, `failed_count`, `cache_hits`, `api_calls`, `start_time`, `end_time`, `options`, `error_message` |
| `geocoding_errors` | Per-voter geocoding failures | `id`, `job_id` (FK), `voter_id` (FK → voters.id), `address`, `error_type`, `error_message`, `retry_count` |
| `api_quotas` | Daily API quota tracking | `id`, `date`, `service`, `request_count` |
| `route_cache` | Distance/duration pairs between waypoints | `id`, `origin_lat`, `origin_lng`, `destination_lat`, `destination_lng`, `route_hash`, `travel_mode`, `distance_meters`, `duration_seconds`, `cached_at`, `expires_at` |
| `api_usage` | Google Maps API call logging | `id`, `api_name`, `call_date`, `call_count`, `cache_hits`, `cache_misses`, `quota_remaining` |
| `saved_routes` | Shareable canvassing routes (JSON) | `id` (TEXT), `user_id`, `route_name`, `route_data` (JSON), `travel_mode`, `created_at`, `accessed_at`, `access_count`, `expires_at`, `is_public` |

### 2.2 Current Data Flow

```
Election Commission CSV/DBF file
        │
        ▼
POST /api/upload/csv  (or /dbf)
        │
        ▼
import-processor.js
  ├── parseCSV / parseDBF
  ├── validateVoter
  ├── VoterModel.create()  → INSERT / UPDATE voters
  ├── Store election_history entries (E_1, E_2, … fields)
  ├── recalculateAllPrecinctStats()
  └── recalculateAllSuperVoters()
        │
        ▼
Live database (single flat state)
        │
        ├── Analytics / Dashboard (reads voters + election_history)
        ├── MapView (reads voters w/ lat/lng)
        ├── Voters list (reads voters + election_history join)
        └── Route Planner (reads voters, writes saved_routes)
```

### 2.3 What "Current Election" Means Today

There is **no election cycle concept** in the current codebase. The system has:
- `election_code` TEXT values (e.g., "E_1", "E_2") that are column names from the imported DBF file — not human-readable election names.
- No cycle start/end dates, no named elections, no versioning.
- All `election_history` rows exist in a single flat namespace.

The `super_voter` flag is computed globally across all `election_history` records (no per-cycle threshold).

### 2.4 Import Modes

| Mode | Behavior |
|---|---|
| `replace` | UPDATE existing voter if voter_id already in DB, INSERT if new |
| `skip` | INSERT OR IGNORE — existing records untouched |
| `flag` | Throw error on any duplicate voter_id |

In `replace` mode, a fresh county file import **updates all voter records and appends new election_history rows** — no old data is preserved as a point-in-time snapshot.

### 2.5 Frontend Pages

The SPA (hash-router, Vite + Tailwind) has six pages: Dashboard, Voters, Never Voted, Upload, Map, Analytics. There is no Settings or Archive page.

---

## 3. Research Basis & Best Practices

### 3.1 Election Data Archival Patterns (NIST SP 1500-100 / EAC VVSG)

The National Institute of Standards and Technology (NIST) Special Publication 1500-100 and the Election Assistance Commission (EAC) Voluntary Voting System Guidelines define election data as **long-retention records** (minimum 22 months per federal law, longer for state records). Key patterns used by voter registration systems (VRS):

- **Cycle-stamped records**: Every mutation to a voter record attaches an election cycle identifier so the full audit chain is recoverable.
- **Snapshot isolation**: A point-in-time snapshot of the voter file is required before and after each election for certification audits.
- **Read-only archives**: Once certified, archived election records must be write-protected.
- **Separation of voter master file and history**: Many VRS implementations keep a timeless address/demographic record (the "EAVS voter") separate from the per-election participation record.

**Application to this project**: Separate the evergreen voter address list (`voters` table) from per-election participation (`election_history`) and allow the participation records to be tagged with a named cycle.

### 3.2 Database Archival Strategies

**Option A — Soft-delete / cycle tagging (chosen approach)**  
Add a nullable `cycle_id` FK to transactional tables. Records without a cycle_id belong to the current live cycle. Archive = mass-update those records with the new cycle_id. Pros: no data duplication, no schema migrations on every cycle, fully reversible. Cons: queries for "current" data always need `WHERE cycle_id IS NULL`.

**Option B — Snapshot tables (e.g., `election_history_2024`)**  
Dynamic table creation per cycle. Pros: completely isolated. Cons: schema drift, cannot use FK constraints, makes cross-cycle queries impractical, requires DDL inside transactions (not supported cleanly in SQLite).

**Option C — Append-only with temporal column**  
Add `valid_from` / `valid_to` timestamps. Full bitemporal history. Pros: richest model. Cons: far too complex for a local single-user county app; query complexity is prohibitive.

**Decision**: Option A (cycle tagging via nullable FK) is the right balance for a local SQLite app with relatively small data volumes (< 30,000 voters for Obion County).

### 3.3 Audit Trail & Rollback Considerations

- All archive operations must execute inside a **single SQLite transaction** — either all tables are tagged or none are (preventing partial archives).
- A `cycle_analytics_snapshots` table captures computed metrics at archive time (turnout, super voter counts by precinct) since re-computing them later from tagged records is possible but slow.
- **Soft delete only** for cycle records — `deleted_at` timestamp, never physical DELETE until user explicitly purges.
- Export bundles (ZIP/CSV) serve as the offline audit copy.

### 3.4 Multi-Cycle / Multi-Year Voter Data Patterns

Voter registration databases (e.g., Tennessee's TNVOTER, NVRA implementors) consistently separate:
1. The **voter master record** (address, DOB, registration status) — updated in place on each new county file.
2. The **election participation history** — immutable once certified, tagged per election.

This spec follows that industry standard split. Geocode coordinates (lat/lng on voters table) are expensive to produce and should survive rollovers unchanged.

### 3.5 PostgreSQL / SQLite Archival Best Practices

- **SQLite WAL mode**: Enable WAL (Write-Ahead Logging) during the archive transaction for better concurrency; already implied by the single-writer local model.
- **SQLite ATTACH / backup**: For offline backup at rollover time, `sqlite3 voter_platform.db ".backup backup_YYYYMMDD.db"` produces a transactionally consistent copy.
- **Export as CSV**: CSV is the most portable, long-lived archive format for election data (outlives any application version).
- **Compression**: ZIP is appropriate for bundling multiple CSV files; keep raw SQLite backup as secondary artifact.
- For PostgreSQL-scale contexts: table partitioning by `cycle_id` would be the upgrade path, but this is out of scope for the current SQLite deployment.

### 3.6 UI/UX Best Practices for Destructive Operations

- **Multi-step confirmation**: For any operation that alters existing data, require a typed confirmation string (e.g., type the cycle name) before proceeding.
- **Progress feedback**: Long-running archive operations (snapshot, export build) must show progress to prevent user restarts.
- **Clear consequence labeling**: Distinguish "Archive & Keep All Data" from "Archive & Clear Election History" visually.
- **Irreversibility indicators**: Operations that can be undone should show green; operations that can't (e.g., purge) should show red.

---

## 4. Proposed Feature Architecture

### 4.1 Conceptual Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Election Cycles Layer                   │
│                                                         │
│  ┌──────────────────┐      ┌───────────────────────┐   │
│  │  election_cycles  │      │ cycle_analytics_       │   │
│  │  (named cycles)  │◄────►│ snapshots (JSON stats) │   │
│  └────────┬─────────┘      └───────────────────────┘   │
│           │                                             │
│     cycle_id FK (nullable = "current unarchived")       │
│           │                                             │
│  ┌────────▼──────────────────────────────────────────┐  │
│  │  election_history  (tagged rows or NULL = current) │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────▼──────────────────────────────────────────┐  │
│  │  saved_routes (tagged rows or NULL = current)      │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────▼──────────────────────────────────────────┐  │
│  │  import_logs (tagged rows or NULL = current)       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  voters table — NO cycle_id — evergreen master file     │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Archive / Rollover Operation (Transaction Steps)

When a user initiates "Archive Current Cycle":

```
BEGIN TRANSACTION
  1. INSERT INTO election_cycles (name, description, election_date, cycle_type, status, archived_at)
     → returns new cycle_id

  2. UPDATE election_history SET cycle_id = <new_id> WHERE cycle_id IS NULL
     → tags all unarchived election records

  3. UPDATE saved_routes SET cycle_id = <new_id> WHERE cycle_id IS NULL
     → tags all unarchived routes

  4. UPDATE import_logs SET cycle_id = <new_id> WHERE cycle_id IS NULL
     → tags all unarchived imports

  5. Take analytics snapshot:
     INSERT INTO cycle_analytics_snapshots (cycle_id, total_voters, super_voters, ...)
     → frozen point-in-time stats

  6. [OPTIONAL] If user checked "Reset election history for new cycle":
     - Does not DELETE — tags are already applied
     - Sets election_history for current cycle as complete; new imports will start with NULL cycle_id
     - Recalculate super_voter flags based ONLY on unarchived (current) election_history

  7. UPDATE election_cycles SET status = 'active', voters_count = ..., total_election_records = ...
     → finalize the cycle record

COMMIT
  → On success: trigger export job in background
  → On failure: full rollback, cycle record removed
```

### 4.3 "Current" vs "Archived" Query Pattern

**Current data** (default application behavior — unchanged from today):
```sql
SELECT * FROM election_history WHERE cycle_id IS NULL;
SELECT * FROM saved_routes WHERE cycle_id IS NULL;
```

**Archived cycle data**:
```sql
SELECT * FROM election_history WHERE cycle_id = 3;
SELECT * FROM saved_routes WHERE cycle_id = 3;
```

No existing queries need to change initially since `cycle_id` is nullable and all existing rows will have `cycle_id = NULL` until the first archive operation. Adding `WHERE cycle_id IS NULL` to existing queries is the only migration needed for correctness after first rollover.

### 4.4 Export Bundle Format

On archive, the backend generates a ZIP file at `data/backups/cycle_<id>_<slug>.zip` containing:

```
cycle_2024_general/
├── metadata.json              # Cycle name, dates, counts, export timestamp
├── voters.csv                 # Full voter list (voters table snapshot)
├── election_history.csv       # All election_history rows for this cycle_id
├── precincts.csv              # Precinct stats at time of archive
├── saved_routes.csv           # Route summaries (route_data JSON inline)
├── analytics_snapshot.json    # Full analytics snapshot JSON
└── README.txt                 # Field definitions and import instructions
```

---

## 5. Database Schema Changes

### 5.1 New Table: `election_cycles`

```sql
-- Migration 010: Add election cycles support
CREATE TABLE IF NOT EXISTS election_cycles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,              -- e.g., "2024 General Election"
    description     TEXT,                       -- Optional notes
    election_date   TEXT,                       -- ISO-8601: "2024-11-05"
    cycle_type      TEXT DEFAULT 'general',     -- 'primary', 'general', 'runoff', 'special', 'other'
    status          TEXT DEFAULT 'active',      -- 'active', 'archived', 'deleted'
    archived_at     DATETIME,
    archived_by     TEXT,
    voters_count    INTEGER DEFAULT 0,
    super_voters_count INTEGER DEFAULT 0,
    total_election_records INTEGER DEFAULT 0,
    routes_count    INTEGER DEFAULT 0,
    import_count    INTEGER DEFAULT 0,
    export_path     TEXT,                       -- Relative path to ZIP bundle, if generated
    notes           TEXT,
    deleted_at      DATETIME,                   -- Soft delete timestamp
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_election_cycles_status
    ON election_cycles(status);

CREATE INDEX IF NOT EXISTS idx_election_cycles_date
    ON election_cycles(election_date);
```

### 5.2 New Table: `cycle_analytics_snapshots`

```sql
CREATE TABLE IF NOT EXISTS cycle_analytics_snapshots (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id              INTEGER NOT NULL UNIQUE,
    total_voters          INTEGER DEFAULT 0,
    super_voters          INTEGER DEFAULT 0,
    geocoded_voters       INTEGER DEFAULT 0,
    never_voted_count     INTEGER DEFAULT 0,
    total_precincts       INTEGER DEFAULT 0,
    election_codes        TEXT,   -- JSON array: ["E_1","E_2","E_3"]
    overall_turnout_rate  REAL,   -- 0.0–1.0
    early_vote_rate       REAL,
    republican_count      INTEGER DEFAULT 0,
    democrat_count        INTEGER DEFAULT 0,
    independent_count     INTEGER DEFAULT 0,
    turnout_by_precinct   TEXT,   -- JSON: [{precinct, voted, total, rate}, ...]
    party_by_precinct     TEXT,   -- JSON
    super_voter_by_precinct TEXT, -- JSON
    age_distribution      TEXT,   -- JSON: [{ageGroup, count}, ...]
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cycle_id) REFERENCES election_cycles(id) ON DELETE CASCADE
);
```

### 5.3 Alter Existing Tables — Add `cycle_id` Column

```sql
-- election_history: tag each record with the cycle it was archived into
ALTER TABLE election_history ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id);
CREATE INDEX IF NOT EXISTS idx_election_history_cycle ON election_history(cycle_id);

-- saved_routes: tag routes with their election cycle
ALTER TABLE saved_routes ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id);
CREATE INDEX IF NOT EXISTS idx_saved_routes_cycle ON saved_routes(cycle_id);

-- import_logs: record which cycle each import belongs to
ALTER TABLE import_logs ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id);
CREATE INDEX IF NOT EXISTS idx_import_logs_cycle ON import_logs(cycle_id);
```

> **Note**: SQLite supports `ALTER TABLE ... ADD COLUMN` for nullable columns. Since `cycle_id` allows NULL and has no DEFAULT constraint conflict, these migrations are safe on existing databases.

### 5.4 Complete Schema After Migration 010

| Table | Change |
|---|---|
| `election_cycles` | **New** — Named cycle registry |
| `cycle_analytics_snapshots` | **New** — Frozen analytics per cycle |
| `election_history` | **+** `cycle_id INTEGER NULL FK` |
| `saved_routes` | **+** `cycle_id INTEGER NULL FK` |
| `import_logs` | **+** `cycle_id INTEGER NULL FK` |
| `voters` | **No change** — evergreen master |
| `precincts` | **No change** — recalculated live |
| `geocoding_cache` | **No change** — shared across cycles |
| `route_cache` | **No change** — pure distance cache |
| `geocoding_jobs` | **No change** |
| `api_quotas` / `api_usage` | **No change** |

---

## 6. API Endpoint Definitions

All new endpoints live under `/api/election-cycles`. Input validation uses `express-validator`; responses follow the existing `{ success, data, error }` envelope.

### 6.1 `GET /api/election-cycles` — List All Cycles

**Query parameters:**
- `status` (optional): `active` | `archived` | `deleted` (default: excludes deleted)
- `limit` (optional): integer 1–100 (default: 50)
- `offset` (optional): integer ≥ 0 (default: 0)

**Response 200:**
```json
{
  "success": true,
  "total": 3,
  "data": [
    {
      "id": 1,
      "name": "2024 General Election",
      "description": "November 2024 general election voter file",
      "election_date": "2024-11-05",
      "cycle_type": "general",
      "status": "active",
      "archived_at": "2025-01-10T14:32:00Z",
      "voters_count": 18542,
      "super_voters_count": 4210,
      "total_election_records": 47300,
      "routes_count": 12,
      "import_count": 3,
      "export_path": "data/backups/cycle_1_2024_general.zip",
      "created_at": "2025-01-10T14:32:00Z"
    }
  ]
}
```

**Error 400:** Validation failure with `details` array.

---

### 6.2 `GET /api/election-cycles/current` — Current (Unarchived) Cycle Status

Returns a summary of data that would be captured if archiving now.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "unarchived_election_records": 28841,
    "unarchived_routes": 7,
    "unarchived_imports": 2,
    "total_voters": 21004,
    "super_voters": 5102,
    "geocoded_voters": 19800,
    "election_codes": ["E_1", "E_2", "E_3", "E_4"],
    "last_import_at": "2026-02-14T09:15:00Z"
  }
}
```

---

### 6.3 `GET /api/election-cycles/:id` — Get Cycle Detail

**Path params:** `id` — integer cycle ID  
**Response 200:**
```json
{
  "success": true,
  "data": {
    "cycle": { /* election_cycles row */ },
    "analyticsSnapshot": { /* cycle_analytics_snapshots row, parsed JSON fields */ }
  }
}
```
**Error 404:** `{ "success": false, "error": "Cycle not found" }`

---

### 6.4 `GET /api/election-cycles/:id/analytics` — Analytics Snapshot for a Cycle

Returns the frozen analytics snapshot in the same shape as `/api/analytics/dashboard` for direct UI reuse.

**Response 200:**
```json
{
  "success": true,
  "cycleId": 1,
  "cycleName": "2024 General Election",
  "data": {
    "totals": {
      "voters": 18542,
      "superVoters": 4210,
      "geocoded": 17000,
      "precincts": 8
    },
    "turnout": {
      "overall": 0.312,
      "earlyVote": 0.108,
      "electionDay": 0.204
    },
    "partyDistribution": { "R": 7200, "D": 3100, "I": 8242 },
    "precinctSummary": [ /* array */ ],
    "electionCodes": ["E_1","E_2","E_3","E_4"]
  }
}
```

---

### 6.5 `POST /api/election-cycles/archive` — Create Archive (Rollover)

This is the primary action endpoint. It runs the entire archive transaction.

**Request body:**
```json
{
  "name": "2024 General Election",
  "description": "November 2024 general election voter file — Obion County",
  "election_date": "2024-11-05",
  "cycle_type": "general",
  "reset_election_history": false,
  "generate_export": true,
  "notes": "Archived before importing 2026 primary data"
}
```

**Validation rules:**
- `name`: required, string, 1–100 chars, trimmed
- `description`: optional, string, max 500 chars
- `election_date`: optional, ISO-8601 date string
- `cycle_type`: optional, one of `primary | general | runoff | special | other`
- `reset_election_history`: optional, boolean (default false) — if true, marks super_voter as recalculated against empty history post-archive
- `generate_export`: optional, boolean (default true)

**Response 202 Accepted** (archive is async for large datasets):
```json
{
  "success": true,
  "message": "Archive initiated",
  "data": {
    "cycleId": 4,
    "status": "archiving",
    "jobId": "arc_20260311_143200"
  }
}
```

**Polling:** Client polls `GET /api/election-cycles/archive/status/:jobId` until `status` is `complete` or `failed`.

**Alternative for small datasets**: If `election_history` count < 50,000, execute synchronously and return 200 with full cycle object.

**Error 409 Conflict:**
```json
{ "success": false, "error": "Archive already in progress — only one archive operation at a time" }
```

---

### 6.6 `GET /api/election-cycles/archive/status/:jobId` — Poll Archive Progress

**Response 200:**
```json
{
  "success": true,
  "jobId": "arc_20260311_143200",
  "status": "archiving",          // "queued" | "archiving" | "snapshotting" | "exporting" | "complete" | "failed"
  "progress": 72,                  // 0–100
  "step": "Tagging election history records",
  "cycleId": 4,
  "error": null
}
```

---

### 6.7 `GET /api/election-cycles/:id/export` — Download Export Bundle

Streams the ZIP file for download. Generates the file if it does not yet exist.

**Response 200:** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="cycle_1_2024_general.zip"`

**Error 404:** Cycle not found or export not available.  
**Error 503:** Export is still being generated.

---

### 6.8 `DELETE /api/election-cycles/:id` — Soft-Delete a Cycle

Sets `deleted_at = NOW()` and `status = 'deleted'`. Does NOT delete `election_history` rows — they retain their `cycle_id` and remain queryable.

**Request body:**
```json
{ "confirm": "DELETE 2024 General Election" }
```
The `confirm` field must exactly match the cycle name (case-insensitive) as an extra safeguard.

**Response 200:**
```json
{ "success": true, "message": "Cycle soft-deleted. Election history records are preserved." }
```

---

### 6.9 `DELETE /api/election-cycles/:id/purge` — Hard Purge (Permanent)

**Requires admin confirmation.** Permanently deletes the cycle record AND all tagged `election_history` rows, `saved_routes`, and the export ZIP file.

**Request body:**
```json
{ "confirm": "PERMANENTLY DELETE 2024 General Election", "delete_export": true }
```

**Response 200:**
```json
{
  "success": true,
  "deleted": {
    "cycle": 1,
    "election_history_rows": 47300,
    "saved_routes": 12,
    "export_removed": true
  }
}
```

---

### 6.10 Error Responses (All Endpoints)

```json
{
  "success": false,
  "error": "Human readable error message",
  "details": [/* express-validator errors, if applicable */],
  "timestamp": "2026-03-11T14:32:00.000Z"
}
```

---

## 7. Frontend Component Plan

### 7.1 New Route: `/archive`

Add to `NAV_ITEMS` in `frontend/src/main.js`:
```js
{ path: '/archive', label: 'Archive', icon: '<archive-svg-path>' }
```

Register in `registerRoutes()` with `renderArchive` from a new `frontend/src/pages/Archive.js`.

### 7.2 Archive Page Layout (`Archive.js`)

```
┌─────────────────────────────────────────────────────────────────┐
│  Archive & Election Cycles                                      │
│  Preserve voter data snapshots between election cycles          │
├────────────────────────────┬────────────────────────────────────┤
│  CURRENT CYCLE STATUS      │  PAST CYCLES (table)               │
│  ┌────────────────────┐   │  ┌──────────────────────────────┐  │
│  │ 28,841             │   │  │ Name │ Date │ Voters │ Export │  │
│  │ Unarchived records │   │  │ 2024 General │ ...           │  │
│  │                    │   │  │ 2022 Primary │ ...           │  │
│  │ [Archive Now] btn  │   │  └──────────────────────────────┘  │
│  └────────────────────┘   │                                    │
└────────────────────────────┴────────────────────────────────────┘
```

**Sections:**

1. **Current Cycle Summary Card**
   - Unarchived elections records count, routes count, last import date
   - Primary CTA: `[Archive Current Cycle]` button (opens modal)
   - Secondary: `[Download Current Data as CSV]` quick export without full archive

2. **Past Cycles Table**
   Columns: Name / Election Date / Type / Voters / Status / Actions  
   Actions per row:
   - 📥 Download ZIP
   - 📊 View Analytics (navigates to `/archive/:id/analytics` sub-view or modal)
   - 🗑 Delete (opens delete confirmation modal)

3. **Cycle Detail Side Panel / Sub-page** (rendered inline when a cycle row is clicked)
   - Shows frozen analytics snapshot: totals, turnout chart, party distribution, precinct summary
   - Same visual treatment as Dashboard but labeled "Archived: [cycle name]"

### 7.3 Archive Creation Modal

Triggered by `[Archive Current Cycle]` button. Multi-step modal:

**Step 1 — Name This Cycle**
```
┌──────────────────────────────────────────────────┐
│  Archive Current Election Cycle                  │
│                                                  │
│  Cycle Name *  [2024 General Election        ]   │
│  Description   [Optional notes...            ]   │
│  Election Date [2024-11-05                   ]   │
│  Type          ● General  ○ Primary  ○ Other     │
│                                                  │
│  [Cancel]                         [Next →]       │
└──────────────────────────────────────────────────┘
```

**Step 2 — Rollover Options**
```
┌──────────────────────────────────────────────────┐
│  Prepare for New Cycle                           │
│                                                  │
│  ☑  Generate ZIP export bundle                  │
│                                                  │
│  □  Reset election history after archiving       │
│     ⚠  This will remove E_1/E_2 history from    │
│        the active dataset. The archived copy     │
│        is preserved. Recommended before          │
│        importing a new voter file.               │
│                                                  │
│  [← Back]                   [Review Summary →]  │
└──────────────────────────────────────────────────┘
```

**Step 3 — Confirmation**
```
┌──────────────────────────────────────────────────┐
│  Confirm Archive                                 │
│                                                  │
│  You are about to archive:                       │
│  • 28,841 election history records               │
│  • 7 saved routes                                │
│  • 2 import logs                                 │
│                                                  │
│  Under the name: "2024 General Election"         │
│                                                  │
│  Type the cycle name to confirm:                 │
│  [                                          ]    │
│                                                  │
│  [Cancel]          [Archive Now — Irreversible]  │
└──────────────────────────────────────────────────┘
```

**Step 4 — Progress**
```
┌──────────────────────────────────────────────────┐
│  Archiving in Progress...                        │
│                                                  │
│  ████████████░░░░░░  72%                         │
│  Tagging election history records...             │
│                                                  │
│  Please do not close this window.                │
└──────────────────────────────────────────────────┘
```

### 7.4 Cycle Selector on Dashboard / Analytics

Add a `<select>` cycle-picker at the top of the Dashboard and Analytics pages:

```
Viewing: [Current Data ▼]  ← dropdown lists all archived cycles + "Current Data"
```

When a past cycle is selected:
- Dashboard reads from `GET /api/election-cycles/:id/analytics`
- Shows an amber banner: "📦 Viewing archived data: 2024 General Election"
- Analytics endpoint reads frozen snapshot (no live DB queries)
- Voters/Map pages are unaffected (they always show current voter addresses)

### 7.5 State Management

All archive state is managed locally in each page module (no global store needed). The Archive page uses a simple `fetchAndRender` pattern consistent with the existing codebase. The cycle picker state is persisted in `sessionStorage` so it survives tab navigation within a session.

### 7.6 API Client Extensions (`frontend/src/api/client.js`)

Add the following functions:

```js
export const fetchCycles = () => apiFetch('/api/election-cycles');
export const fetchCurrentCycleStatus = () => apiFetch('/api/election-cycles/current');
export const fetchCycle = (id) => apiFetch(`/api/election-cycles/${id}`);
export const fetchCycleAnalytics = (id) => apiFetch(`/api/election-cycles/${id}/analytics`);
export const archiveCycle = (payload) => apiFetch('/api/election-cycles/archive', { method: 'POST', body: JSON.stringify(payload) });
export const pollArchiveStatus = (jobId) => apiFetch(`/api/election-cycles/archive/status/${jobId}`);
export const deleteCycle = (id, confirm) => apiFetch(`/api/election-cycles/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm }) });
export const downloadCycleExport = (id) => window.open(`/api/election-cycles/${id}/export`, '_blank');
```

---

## 8. Step-by-Step Implementation Plan

### Phase 1: Database & Migration (Est. 0.5 days)

1. Create `backend/migrations/010_add_election_cycles.js`
   - Create `election_cycles` table
   - Create `cycle_analytics_snapshots` table
   - ALTER `election_history` ADD COLUMN `cycle_id`
   - ALTER `saved_routes` ADD COLUMN `cycle_id`
   - ALTER `import_logs` ADD COLUMN `cycle_id`
   - Add all indexes

2. Update `scripts/setup.js` to include new tables in the `CREATE TABLE IF NOT EXISTS` block (for fresh installs).

3. Run migration on development DB: `node backend/migrations/010_add_election_cycles.js`

4. Verify with `scripts/check-schema-temp.js` or equivalent.

### Phase 2: Backend Models & Services (Est. 1 day)

1. **Create `backend/models/election-cycle.js`**
   - `create(data)` — INSERT INTO election_cycles
   - `findAll(filters)` — list cycles
   - `findById(id)` — get single cycle with snapshot
   - `updateStats(id, stats)` — update voters_count etc.
   - `softDelete(id)` — set deleted_at
   - `hardPurge(id)` — delete cycle + cascade

2. **Create `backend/services/archive-service.js`**
   - `getCurrentCycleStatus()` — count unarchived records
   - `archiveCycle(options)` — runs the full archive transaction:
     - Validates no archive already in progress (in-memory lock)
     - BEGIN TRANSACTION
     - INSERT election_cycles
     - UPDATE election_history / saved_routes / import_logs
     - Collect analytics data (reuse AnalyticsService queries but scoped to NULL cycle_id)
     - INSERT cycle_analytics_snapshots
     - If reset_election_history: recalculate super_voter flags
     - UPDATE election_cycles with final counts
     - COMMIT
   - `getArchiveStatus(jobId)` — return progress for async operations
   - `generateExportBundle(cycleId)` — build ZIP from CSV exports
   - `getCycleAnalyticsSnapshot(cycleId)` — return snapshot in dashboard shape

3. **Update `backend/services/analytics-service.js`**
   - Add `cycleId` filter parameter to `getDashboardMetrics()` and `getTurnoutAnalysis()`
   - When `cycleId` is provided, query `election_history WHERE cycle_id = ?`
   - When `cycleId` is NULL (current), query `election_history WHERE cycle_id IS NULL`

4. **Update `backend/models/voter.js`**
   - `recalculateAllSuperVoters()`: add clause `WHERE cycle_id IS NULL` to the election_history subquery so super_voter status only counts current-cycle elections after a rollover.

### Phase 3: Backend Routes (Est. 0.5 days)

1. **Create `backend/routes/election-cycles.js`**
   - Implement all 9 endpoints defined in Section 6
   - Use `express-validator` for all input validation
   - Handle async job pattern for `POST /archive`

2. **Register in `backend/server.js`**
   ```js
   const electionCyclesRouter = require('./routes/election-cycles');
   app.use('/api/election-cycles', electionCyclesRouter);
   ```

### Phase 4: Export Bundle Generator (Est. 0.5 days)

1. Add `archiver` npm package (or use Node.js built-in `zlib` + `fs` streams) for ZIP generation.

2. Implement `generateExportBundle(cycleId)` in `archive-service.js`:
   - Query `election_history WHERE cycle_id = ?`
   - Query `voters` (full snapshot — all voters regardless of cycle)
   - Query `saved_routes WHERE cycle_id = ?`
   - Query `precincts`
   - Write each as CSV to temp dir
   - Bundle into ZIP at `data/backups/cycle_<id>_<slug>.zip`
   - Update `election_cycles.export_path`
   - Clean up temp files

3. Stream ZIP in GET export endpoint.

### Phase 5: Frontend Archive Page (Est. 1 day)

1. Create `frontend/src/pages/Archive.js`
   - `renderArchive(container)` following existing page pattern
   - Current cycle status card
   - Past cycles table with actions
   - Cycle detail sub-view (inline expand)

2. Create multi-step modal component (pure JS, appended to DOM)
   - Step navigation (validation per step)
   - Archive progress polling loop
   - Success/failure feedback

3. Add `/archive` to `NAV_ITEMS` in `main.js` and `registerRoutes`.

### Phase 6: Dashboard / Analytics Cycle Selector (Est. 0.5 days)

1. Update `frontend/src/pages/Dashboard.js`
   - Add cycle picker at page top
   - Fetch cycle list on render
   - On cycle change: re-fetch analytics from appropriate endpoint
   - Show archived banner with amber styling

2. Update `frontend/src/pages/Analytics.js`
   - Same cycle picker integration

3. Update `frontend/src/api/client.js` with new functions.

### Phase 7: Testing & Validation (Est. 0.5 days)

1. Manual test: import a test CSV, archive, verify rows have cycle_id set.
2. Test fresh import after archive: new import_logs / election_history should have cycle_id = NULL.
3. Test export download.
4. Test soft-delete and purge flows.
5. Test Dashboard cycle selector shows frozen vs live analytics.
6. Verify super_voter recalculation only uses unarchived records.
7. Run `scripts/validate-build.js`.

---

## 9. Migration Strategy

### 9.1 Migration File: `backend/migrations/010_add_election_cycles.js`

```js
/**
 * Migration 010: Add Election Cycle Archive Support
 * 
 * - Creates election_cycles table (named cycle registry)
 * - Creates cycle_analytics_snapshots table (frozen analytics per cycle)
 * - Adds nullable cycle_id FK to: election_history, saved_routes, import_logs
 * 
 * All new columns are nullable — existing data requires no backfill.
 * All existing rows implicitly belong to the "current unarchived" state (NULL cycle_id).
 */

const database = require('../config/database');

async function migrate() {
  console.log('Running migration 010: Add election cycle archive support...');

  try {
    await database.connect();

    // 1. election_cycles table
    await database.run(`
      CREATE TABLE IF NOT EXISTS election_cycles (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        name                    TEXT NOT NULL,
        description             TEXT,
        election_date           TEXT,
        cycle_type              TEXT DEFAULT 'general',
        status                  TEXT DEFAULT 'active',
        archived_at             DATETIME,
        archived_by             TEXT,
        voters_count            INTEGER DEFAULT 0,
        super_voters_count      INTEGER DEFAULT 0,
        total_election_records  INTEGER DEFAULT 0,
        routes_count            INTEGER DEFAULT 0,
        import_count            INTEGER DEFAULT 0,
        export_path             TEXT,
        notes                   TEXT,
        deleted_at              DATETIME,
        created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Created table: election_cycles');

    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_election_cycles_status
        ON election_cycles(status)
    `);
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_election_cycles_date
        ON election_cycles(election_date)
    `);

    // 2. cycle_analytics_snapshots table
    await database.run(`
      CREATE TABLE IF NOT EXISTS cycle_analytics_snapshots (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_id                INTEGER NOT NULL UNIQUE,
        total_voters            INTEGER DEFAULT 0,
        super_voters            INTEGER DEFAULT 0,
        geocoded_voters         INTEGER DEFAULT 0,
        never_voted_count       INTEGER DEFAULT 0,
        total_precincts         INTEGER DEFAULT 0,
        election_codes          TEXT,
        overall_turnout_rate    REAL,
        early_vote_rate         REAL,
        republican_count        INTEGER DEFAULT 0,
        democrat_count          INTEGER DEFAULT 0,
        independent_count       INTEGER DEFAULT 0,
        turnout_by_precinct     TEXT,
        party_by_precinct       TEXT,
        super_voter_by_precinct TEXT,
        age_distribution        TEXT,
        created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cycle_id) REFERENCES election_cycles(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Created table: cycle_analytics_snapshots');

    // 3. Add cycle_id to election_history
    await database.run(`
      ALTER TABLE election_history ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id)
    `);
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_election_history_cycle ON election_history(cycle_id)
    `);
    console.log('✅ Added column: election_history.cycle_id');

    // 4. Add cycle_id to saved_routes
    await database.run(`
      ALTER TABLE saved_routes ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id)
    `);
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_saved_routes_cycle ON saved_routes(cycle_id)
    `);
    console.log('✅ Added column: saved_routes.cycle_id');

    // 5. Add cycle_id to import_logs
    await database.run(`
      ALTER TABLE import_logs ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id)
    `);
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_import_logs_cycle ON import_logs(cycle_id)
    `);
    console.log('✅ Added column: import_logs.cycle_id');

    console.log('✅ Migration 010 completed successfully');
    return true;

  } catch (error) {
    console.error('❌ Migration 010 failed:', error);
    throw error;
  }
}

exports.up = migrate;

if (require.main === module) {
  migrate()
    .then(() => { console.log('Migration complete.'); process.exit(0); })
    .catch(err => { console.error('Fatal error:', err); process.exit(1); });
}
```

### 9.2 Running Migrations on Existing Database

```bash
# From project root (C:\Voter)
node backend/migrations/010_add_election_cycles.js
```

Or, if an automated migration runner exists (check `database.js` initialization):

```js
// In database.js connect() after schema validation — add 010 to the migration list
```

### 9.3 Backward Compatibility

- All new `cycle_id` columns are nullable — existing queries without `WHERE cycle_id IS NULL` continue to return all records (current + archived). This is safe for the first rollover because no rows have cycle_id set yet.
- After the first archive operation, application code should add `WHERE cycle_id IS NULL` to election_history queries that are intended for the current state. This is a non-breaking change since the existing query results remain identical until the first archive.
- The `super_voter` recalculation must be updated before the first rollover (Phase 2, step 4) to avoid counting archived history.

---

## 10. Risk Analysis & Mitigations

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| **Archive transaction fails midway** — partial tagging of election_history | High | Low | Wrap entire operation in `BEGIN IMMEDIATE TRANSACTION` / `ROLLBACK`. Validate cycle record does not exist before committing. |
| **Super voter flags incorrect after rollover** — counting archived election history as current | High | Medium | In `recalculateAllSuperVoters()`, add `WHERE cycle_id IS NULL` to the election_history subquery. Add automated test. |
| **Large dataset causes timeout** — 50,000+ election_history rows take too long to tag | Medium | Low (Obion County has ~18K voters) | Async job pattern with progress polling (Section 6.5–6.6). For current scale, synchronous execution is fine. |
| **Export ZIP is too large** — memory issues building ZIP in-process | Low | Low | Use streaming ZIP construction (`archiver` library with `stream` API). Temp files per CSV, then zip stream. |
| **User archives accidentally** — before they meant to | Medium | Medium | Three-step modal with typed confirmation of cycle name. Cannot be dismissed by clicking outside the modal during the archiving step. |
| **SQLite ALTER TABLE fails** — on very old SQLite versions that restrict ALTER TABLE | Low | Low | Migration 010 uses only `ADD COLUMN` (supported since SQLite 3.1.3, 2005). Check `PRAGMA user_version` compatibility. |
| **Cycle picker performance** — loading all cycles on every Dashboard render | Low | Low | Cycles list is tiny (< 20 items over a decade); cache in `sessionStorage` for 60 seconds. |
| **election_history rows orphaned** — after hard purge if FK constraints off | Medium | Low | Ensure `PRAGMA foreign_keys = ON` (already set in `database.js`). `ON DELETE CASCADE` in cycle_analytics_snapshots; election_history rows have nullable FK so they orphan gracefully (cycle_id becomes invalid but row remains — acceptable for purge scenario). Add explicit DELETE in purge service. |
| **ZIP export path traversal** — export_path stored in DB could be manipulated | Medium | Low | Always construct export_path server-side: `path.join(__dirname, '../../data/backups', sanitizedFilename)`. Never accept export_path from client. Validate sanitizedFilename with `/^cycle_\d+_[a-z0-9_]+\.zip$/`. |
| **Concurrent archive operations** — two users trigger archive simultaneously (unlikely for local app) | Low | Very Low | In-memory boolean lock `archiveInProgress` in archive-service. Return HTTP 409 if lock is held. |
| **No rollback for "reset election history"** — user resets and then regrets | High | Low | Make clear in UI that reset only removes records from the active (unarchived) view. The archived cycle retains them. Provide "Undo Reset" by re-queryin archived records — technically data is still in DB with cycle_id set. |

---

## Appendix A: File Change Summary

| File | Action | Notes |
|---|---|---|
| `backend/migrations/010_add_election_cycles.js` | **Create** | New migration |
| `backend/models/election-cycle.js` | **Create** | New model |
| `backend/services/archive-service.js` | **Create** | Core archive logic |
| `backend/routes/election-cycles.js` | **Create** | API endpoints |
| `backend/server.js` | **Edit** | Register new route |
| `backend/models/voter.js` | **Edit** | Update `recalculateAllSuperVoters()` to filter `cycle_id IS NULL` |
| `backend/services/analytics-service.js` | **Edit** | Add `cycleId` filter parameter |
| `scripts/setup.js` | **Edit** | Add new tables to fresh-install schema |
| `frontend/src/pages/Archive.js` | **Create** | New page |
| `frontend/src/pages/Dashboard.js` | **Edit** | Add cycle picker |
| `frontend/src/pages/Analytics.js` | **Edit** | Add cycle picker |
| `frontend/src/main.js` | **Edit** | Add `/archive` nav item |
| `frontend/src/api/client.js` | **Edit** | Add cycle API functions |
| `package.json` | **Edit** | Add `archiver` dependency for ZIP generation |

---

## Appendix B: NPM Dependency

`archiver` (npm) — widely used, maintained, MIT license:
```bash
npm install archiver
```
Used in `archive-service.js` for ZIP bundle generation. If preferred to avoid a new dependency, Node.js built-in `zlib` + manual TAR/streaming approach is an alternative, but `archiver` is simpler for multi-file ZIP.

---

*End of Specification*
