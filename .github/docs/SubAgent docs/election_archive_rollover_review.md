# Election Archive / Rollover Feature — Code Review

**Project:** Voter Outreach & Mapping Platform  
**Feature:** Election Cycle Archive & Rollover  
**Review Date:** 2026-03-11  
**Reviewer:** Automated code review agent  
**Reference Spec:** `.github/docs/SubAgent docs/election_archive_rollover_spec.md`

---

## Review Summary

| Item | Result |
|------|--------|
| Build — `node -e "require('./config/database.js')"` | ✅ SUCCESS (exit 0) |
| Build — `node -e "require('./routes/archive.js')"` | ✅ SUCCESS (exit 0) |
| Build — `npm run build` (frontend, Vite) | ✅ SUCCESS (chunk-size warning is pre-existing) |
| Overall Assessment | **NEEDS_REFINEMENT** |

---

## Score Table

| Category | Score | Grade | Notes |
|----------|-------|-------|-------|
| Specification Compliance | 62% | D+ | Several spec endpoints + async job model not implemented; API path prefix deviates |
| Best Practices | 90% | A- | Parameterised SQL, express-validator, escapeHtml, proper transaction — solid |
| Functionality | 72% | C+ | Core create/rollover/delete works; super-voter recalc & analytics queries break post-rollover |
| Code Quality | 88% | B+ | Clean, well-commented, consistent style; one dead helper function |
| Security | 97% | A+ | No injection vectors, filename sanitised, input validated; minor lock concern |
| Performance | 83% | B | Pre-transaction analytics collection is fine; no index missing; JS bundle too large (pre-existing) |
| Consistency | 85% | B+ | Matches codebase conventions well; API prefix inconsistency vs spec |
| Build Success | 100% | A+ | All three validation commands passed |

**Overall Grade: C+ (72%)**

---

## CRITICAL Findings (Must Fix)

### CRIT-1 — `recalculateAllSuperVoters()` ignores `cycle_id`

**File:** `backend/models/voter.js` (line 587)  
**Severity:** CRITICAL — will produce wrong results after first rollover

After a rollover all `election_history` rows are tagged with a `cycle_id`, leaving `cycle_id IS NULL` empty for the upcoming cycle. The current `recalculateAllSuperVoters()` query counts participation across **all** election_history with no `cycle_id` filter:

```sql
SELECT voted FROM election_history
WHERE election_history.voter_id = voters.voter_id
ORDER BY ...
LIMIT ?
```

After the first rollover, the subquery returns zero rows (nothing is `NULL` anymore), marking every voter as **not** a super voter (super_voter = 0). The spec (Section 8, Phase 2.4) explicitly requires adding `AND cycle_id IS NULL`.

**Fix:** In `recalculateAllSuperVoters()`, the inner query must add `AND cycle_id IS NULL` to both the `COUNT(DISTINCT election_code)` lookup and the per-voter `election_history` subquery. Similarly, the `COUNT(DISTINCT election_code)` that determines the threshold must also scope to `WHERE cycle_id IS NULL`.

---

### CRIT-2 — Analytics, Voters, and Never-Voted queries cross cycle boundaries after rollover

**Files:** `backend/routes/analytics.js`, `backend/routes/voters.js`, `backend/routes/never-voted.js`  
**Severity:** CRITICAL — stale/incorrect data displayed after first rollover

The spec (Section 4.3 and Section 8, Phase 2.3) requires that after migration 010 is applied, all production queries that touch `election_history` must add `WHERE cycle_id IS NULL` to scope to the current (not-yet-archived) cycle.

Currently **none** of the analytics, voters, or never-voted routes have been updated. After the first rollover:
- All `election_history` rows will be non-NULL → queries return empty sets
- Dashboard turnout, party distribution, super voter counts will all read 0 or incorrect figures
- Never Voted page will show the entire voter file as "never voted"
- All precinct-level analytics break

**Fix:** Every query that reads `election_history` in the live (non-archive) path must add `AND eh.cycle_id IS NULL` or `WHERE cycle_id IS NULL`. This is a broad set of changes touching `analytics-service.js`, the analytics route, the voters route, and the never-voted route.

---

## RECOMMENDED Findings (Should Fix)

### REC-1 — API URL prefix deviates from spec

**Files:** `backend/server.js` (line ~325), `backend/routes/archive.js` (header comment), `frontend/src/api/client.js`  
**Spec reference:** Section 6 — "All new endpoints live under `/api/election-cycles`"

The spec defines all endpoints under `/api/election-cycles`. The implementation mounts the router at `/api/archive`. The client.js has been updated consistently to use `/archive/cycles`, so no functional breakage yet — but anything that generates or bookmarks the old spec URL will fail. If the spec's URL convention is intentional, at minimum the spec comment in the router file should be updated so future developers aren't confused.

**Fix:** Either rename the mount point from `/api/archive` to `/api/election-cycles` (update `server.js`, `archive.js` header, and `client.js`), or update the spec to document the chosen path as the canonical one.

---

### REC-2 — `GET /api/archive/current` status endpoint not implemented

**Spec reference:** Section 6.2  
**File:** `backend/routes/archive.js`

The spec defines a `GET /api/election-cycles/current` endpoint returning unarchived record counts (election_history, routes, imports, total_voters, super_voters, geocoded, election_codes, last_import_at). The `Archive.js` page's `fetchCurrentStatus()` function is a stub that just calls the cycles list and returns early with no real data.

The page stat cards only summarise archived/active cycles from the list — users have no view of the "current unarchived" volume before deciding to archive.

**Fix:** Implement the `/current` endpoint and wire `fetchCurrentStatus()` to call it, then render the "Current Cycle" stat card with live unarchived counts.

---

### REC-3 — Export returns JSON, spec requires ZIP bundle

**Spec reference:** Section 4.4, Section 6.7  
**File:** `backend/routes/archive.js` (`GET /cycles/:id/export`)

The spec defines a ZIP file containing separate CSV files (voters.csv, election_history.csv, precincts.csv, saved_routes.csv, analytics_snapshot.json, metadata.json, README.txt). The implementation returns a single JSON document. The download is functional for data recovery but:
- ZIP + CSV is the standard election-data interchange format
- JSON with 100k election history rows in one payload is slow to open in any common tool

Note: The spec export route also omits voter addresses from the JSON payload — the `voters` table is not included in the export bundle, which means the archive cannot stand alone as a self-contained record.

**Fix:** Add ZIP generation (using `archiver` npm package or Node `zlib`), writing voters.csv, election_history.csv, precincts.csv, and metadata.json as separate files in the bundle. Update the `Content-Type` header to `application/zip`. Add `voters` table data to the export.

---

### REC-4 — Rollover of existing active cycle lacks typed confirmation

**File:** `frontend/src/pages/Archive.js` (`openRolloverModal`)  
**Spec reference:** Section 7.3 Step 3

When the user clicks the "Rollover" action on an *existing* active cycle in the table, the `openRolloverModal()` function shows only a two-button "Are you sure?" dialog — no typed cycle name required. In contrast, the full create+rollover flow in `openArchiveModal()` requires typing the name.

Both paths call `POST /cycles/:id/rollover` which is the same irreversible database operation. The inconsistency means a mis-click on the quick-rollover button causes unintended archiving with no friction.

**Fix:** Add a text input to `openRolloverModal()` requiring the user to type the cycle name before the "Archive Now" button becomes enabled, matching the confirmation pattern in `openArchiveModal()`.

---

### REC-5 — `GET /api/archive/cycles/:id/analytics` endpoint not implemented

**Spec reference:** Section 6.4  
**File:** `backend/routes/archive.js`

The spec defines a dedicated analytics endpoint that returns the frozen snapshot in dashboard shape, reusable for a cycle picker on Dashboard/Analytics pages. The `GET /cycles/:id` endpoint does return the snapshot inline, but the spec wanted a separate endpoint aligned to the dashboard API shape for direct substitution.

**Fix:** Either add a dedicated `/cycles/:id/analytics` endpoint that reformats the snapshot in `{ totals, turnout, partyDistribution, precinctSummary, electionCodes }` shape, or document that `/cycles/:id` serves this purpose and update the spec.

---

### REC-6 — Dashboard and Analytics pages have no cycle picker

**Spec reference:** Section 7.4  
**Files:** `frontend/src/pages/Dashboard.js`, `frontend/src/pages/Analytics.js`

The spec requires a `<select>` cycle-picker at the top of Dashboard and Analytics, allowing users to view frozen analytics from past cycles with an amber "Viewing archived data: …" banner. This was not implemented.

**Fix:** Add a `renderCyclePicker()` helper that fetches archived cycles and renders a `<select>`. When a past cycle is selected, re-fetch the analytics snapshot from `/api/archive/cycles/:id` and render it in the existing layout with the archived banner.

---

## OPTIONAL Findings (Nice to Have)

### OPT-1 — `backend/models/election-cycle.js` model not created

The spec (Phase 2.1) recommended extracting cycle DB operations into a dedicated model. Currently all SQL is inline in the route file. Not a functional problem, but adds length to archive.js and limits reuse. Consider refactoring for consistency with the `voter.js` / `saved-route.js` model pattern.

---

### OPT-2 — `backend/services/archive-service.js` service not created

The spec (Phase 2.2) specified an archive service encapsulating the archive transaction logic. The code is currently inline in the rollover route. This works fine but centralising it in a service would allow import-processor.js to auto-archive or at least query cycle status without importing a route file.

---

### OPT-3 — `DELETE /api/election-cycles/:id/purge` not implemented

The spec (Section 6.9) defines a hard purge endpoint that permanently removes the cycle record and all tagged history rows. Soft-delete is present. Hard purge is an edge-case operation (data compliance / disk space) and can be deferred, but noting its absence.

---

### OPT-4 — Race condition between pre-transaction analytics collection and INSERT

**File:** `backend/routes/archive.js` rollover handler (line ~346)

The eleven analytics queries are collected **before** the `database.transaction()` block. A new import running concurrently between the query phase and the UPDATE phase could result in new `election_history` rows (cycle_id = NULL) being tagged into this cycle that weren't counted in the snapshot. For a single-user local app the window is negligible, but for correctness the analytics queries should run **inside** the same transaction.

---

### OPT-5 — `fetchCurrentStatus()` in Archive.js is dead code

**File:** `frontend/src/pages/Archive.js` (lines ~42–49)

```js
async function fetchCurrentStatus() {
    try {
        const res = await fetch('/api/archive/cycles');
        // … just show the cycles list for now
        return res.ok ? await res.json() : null;
    } catch { return null; }
}
```

This function is defined but never called in `renderArchive()`. The function body is also a no-op stub. Remove it or replace it with the real `/current` call when REC-2 is addressed.

---

### OPT-6 — `scripts/setup.js` not updated for fresh installs

The spec (Phase 1, step 2) recommended adding the new tables to `setup.js` so a brand-new install can be bootstrapped without running the migration manually. Currently, the `database.js` `connect()` method auto-runs migration 010 on every startup, which effectively handles it — but `setup.js` would fail to show the new tables in its schema report, and any CI that runs setup.js to validate the schema would see inconsistency.

---

## Detailed File Notes

### `backend/migrations/010_add_election_cycles.js`
✅ Idempotent via `CREATE TABLE IF NOT EXISTS` and catch on duplicate-column errors  
✅ Correct SQLite FK syntax with `ON DELETE CASCADE` on snapshot  
✅ Has `exports.up` / `exports.down` pattern matching other migrations  
✅ `down()` includes correct warning that `DROP COLUMN` cannot be done in older SQLite  
✅ Standalone executable with `if (require.main === module)`  
⚠️ `down()` drops tables but also drops indexes — indexes on `election_history`, `saved_routes`, `import_logs` for `cycle_id` will remain after `down()` because they are on tables not being dropped. Minor, but worth noting.

---

### `backend/routes/archive.js`
✅ All SQL uses parameterized queries — no injection vectors  
✅ `express-validator` used on every endpoint with proper middleware pattern  
✅ Export filename sanitized: `replace(/[^a-zA-Z0-9_-]/g, '_')` prevents path traversal  
✅ Archive endpoint correctly registered before `/:id` to prevent route shadowing  
✅ `archiveInProgress` flag prevents concurrent rollovers  
✅ Transaction wraps all mutation steps atomically with proper ROLLBACK on error  
✅ Analytics snapshot uses `INSERT OR REPLACE` (idempotent on re-run)  
⚠️ `archiveInProgress` is in-memory; a server restart mid-transaction resets the lock (acceptable for local app)  
❌ See CRIT-2: queries collecting pre-transaction analytics do not scope `cycle_id IS NULL` — but this is a downstream concern; the snapshot capture itself is correct (it filters by `cycle_id IS NULL` in the `ehRow`, `srRow`, `ilRow` counts and the analytics queries)  
❌ See REC-3: export JSON, not ZIP  
❌ Missing `/current`, `/:id/analytics`, and `/purge` endpoints (REC-2, REC-5, OPT-3)

---

### `backend/migrations/010_add_election_cycles.js` ← `backend/config/database.js`
✅ Migration 010 auto-runs inside `connect()` after schema validation — existing installs are migrated automatically on next startup  
✅ Migration errors produce a `console.warn` rather than a hard crash, preventing the server from being unbootable if the migration has already run  
⚠️ Only migration 010 is hard-wired into `connect()`. A future migration system should loop over all pending migrations instead of referencing them by name.

---

### `backend/server.js`
✅ `/api/archive` router correctly registered after all other route modules  
✅ Rate limiter applies to archive endpoints (POST = write limiter at 100/15min)  
✅ No other changes needed to server.js

---

### `frontend/src/main.js`
✅ Archive NAV_ITEM added at correct position (end of tab list)  
✅ SVG icon path correct and consistent with other nav items  
✅ Route registered with `renderArchive` import from correct path  
✅ No regressions introduced

---

### `frontend/src/api/client.js`
✅ `fetchCycles`, `createCycle`, `fetchCycle`, `rolloverCycle`, `deleteCycle`, `downloadCycleExport` all follow existing `get`/`post`/`del` wrapper pattern  
✅ `deleteCycle` correctly uses `request('DELETE', ...)` with a JSON body — the simple `del` wrapper doesn't support a body, so the custom call is appropriate and well-commented  
✅ `downloadCycleExport` uses `window.open` consistent with the existing codebase pattern for browser-side downloads  
❌ `fetchCurrentCycleStatus` and `fetchCycleAnalytics` (mentioned in spec Section 7.6) are not present — needed when REC-2 and REC-5 are fixed

---

### `frontend/src/pages/Archive.js`
✅ Follows existing page pattern (`renderArchive(container)`, spinner → fetch → render)  
✅ `sectionHeading`, `spinner`, `errorBox`, `statCard`, `fmt`, `escapeHtml` all imported from `ui.js` — consistent with all other pages  
✅ `escapeHtml` applied to all user-controlled data rendered into HTML (cycle name, type, etc.)  
✅ Multi-step modal with step progress bar is well-structured and accessible (`role="dialog"`, `aria-modal="true"`)  
✅ Event delegation on table (`container.addEventListener('click', ...)`) is the correct pattern for dynamically rendered rows  
✅ `refresh()` callback correctly re-calls `renderArchive(container)` instead of mutating DOM directly  
⚠️ `fetchCurrentStatus()` is dead code (OPT-5)  
⚠️ Rollover from existing active cycle lacks typed confirmation (REC-4)  
⚠️ Step 2 of the archive modal mentions "Generate ZIP export bundle" semantically but no backend ZIP support exists yet (REC-3)

---

## Priority Recommendations

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 — CRITICAL | CRIT-1: Update `recalculateAllSuperVoters()` to filter `cycle_id IS NULL` | Low (2-line SQL change) |
| 2 — CRITICAL | CRIT-2: Add `WHERE cycle_id IS NULL` to all live `election_history` queries in analytics, voters, never-voted routes | Medium (audit all query files) |
| 3 — RECOMMENDED | REC-4: Add typed confirmation to `openRolloverModal()` | Low (add input field + validation) |
| 4 — RECOMMENDED | REC-2: Implement `GET /current` status endpoint + wire `fetchCurrentStatus()` | Medium |
| 5 — RECOMMENDED | REC-3: Replace JSON export with ZIP bundle | High |
| 6 — RECOMMENDED | REC-6: Dashboard/Analytics cycle picker | High |
| 7 — RECOMMENDED | REC-1: Align API prefix to spec or update spec | Low (rename server.js mount + client.js paths) |
| 8 — OPTIONAL | OPT-5: Remove dead `fetchCurrentStatus()` stub | Trivial |
| 9 — OPTIONAL | OPT-4: Move analytics collection inside transaction | Low |
| 10 — OPTIONAL | OPT-1/2: Extract model and service files | Medium |

---

## Files Reviewed

- `c:\Voter\backend\migrations\010_add_election_cycles.js`
- `c:\Voter\backend\routes\archive.js`
- `c:\Voter\backend\server.js`
- `c:\Voter\backend\config\database.js`
- `c:\Voter\backend\models\voter.js` (for super voter recalculation — critical gap found)
- `c:\Voter\backend\routes\analytics.js` (for cycle_id filtering — critical gap found)
- `c:\Voter\frontend\src\pages\Archive.js`
- `c:\Voter\frontend\src\main.js`
- `c:\Voter\frontend\src\api\client.js`

---

*Review doc path: `.github/docs/SubAgent docs/election_archive_rollover_review.md`*
