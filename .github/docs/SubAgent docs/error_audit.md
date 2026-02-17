# Voter Platform — Comprehensive Error Audit

**Date:** February 16, 2026  
**Scope:** Full backend codebase analysis (routes, models, services, parsers, config, migrations, setup)  
**Total Errors Found:** 20 across 4 severity levels

---

## Table of Contents

- [Summary Score Table](#summary-score-table)
- [Critical Errors (5) — ✅ ALL FIXED](#critical-errors)
  - [C1: `this` Context Loss in Legacy Transaction — ✅ FIXED](#c1-this-context-loss-in-legacy-transaction)
  - [C2: Route Ordering — `/:id` Shadows `/search/:query` — ✅ FIXED](#c2-route-ordering--id-shadows-searchquery)
  - [C3: SQL Injection in `createJob` — ✅ FIXED](#c3-sql-injection-in-createjob)
  - [C4: SQL Injection in `retryFailedAddresses` — ✅ FIXED](#c4-sql-injection-in-retryfailedaddresses)
  - [C5: Table Name Mismatch — `api_quotas` vs `api_usage` — ✅ FIXED](#c5-table-name-mismatch--api_quotas-vs-api_usage)
- [High Severity (5) — ✅ ALL FIXED](#high-severity)
  - [H1: Missing Columns in `setup.js` Schema — ✅ FIXED](#h1-missing-columns-in-setupjs-schema)
  - [H2: Missing Migration Tables in `setup.js` — ✅ FIXED](#h2-missing-migration-tables-in-setupjs)
  - [H3: Hardcoded Voter Count `2677` — ✅ FIXED](#h3-hardcoded-voter-count-2677)
  - [H4: Truncated JSDoc Comment — ✅ FIXED](#h4-truncated-jsdoc-comment)
  - [H5: SPA Catch-All Before 404 Handler — ✅ FIXED](#h5-spa-catch-all-before-404-handler)
- [Medium Severity (5) — ✅ ALL FIXED](#medium-severity)
  - [M1: `getVotersByIds` Queries Wrong Column — ✅ FIXED](#m1-getvotersbyids-queries-wrong-column)
  - [M2: Circular Progress Calculation — ✅ FIXED](#m2-circular-progress-calculation)
  - [M3: Precinct Format Inconsistency Between Parsers — ✅ FIXED](#m3-precinct-format-inconsistency-between-parsers)
  - [M4: API Key Environment Variable Naming Confusion — ✅ FIXED](#m4-api-key-environment-variable-naming-confusion)
  - [M5: Middleware Ordering — SPA Catch-All Blocks API 404s — ✅ FIXED](#m5-middleware-ordering--spa-catch-all-blocks-api-404s)
- [Low Severity (5) — ✅ ALL FIXED](#low-severity)
  - [L1: Database Connection Check Redundancy — ✅ FIXED](#l1-database-connection-check-redundancy)
  - [L2: `instanceof SparseDistanceMatrix` Fragility — ✅ FIXED](#l2-instanceof-sparsedistancematrix-fragility)
  - [L3: Duplicate Sanitization Functions Across Parsers — ✅ FIXED](#l3-duplicate-sanitization-functions-across-parsers)
  - [L4: Foreign Key to Non-Existent `users` Table — ✅ FIXED](#l4-foreign-key-to-non-existent-users-table)
  - [L5: Error Handler Gap for Non-GET Unknown Routes — ✅ FIXED](#l5-error-handler-gap-for-non-get-unknown-routes)
- [Architecture Observations](#architecture-observations)
- [Recommended Fix Order](#recommended-fix-order)

---

## Summary Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Core Functionality | 70% | C+ |
| Data Integrity | 55% | D+ |
| Security | 60% | D |
| API Consistency | 50% | F |
| Schema Integrity | 65% | D+ |
| Code Quality | 75% | B- |
| Error Handling | 70% | C+ |
| Documentation | 80% | B |

**Overall Grade: D+ (66%)**

---

## Critical Errors

> ✅ **All 5 critical errors have been fixed** (February 16, 2026)  
> Spec: `.github/docs/SubAgent docs/critical_errors_fix_spec.md`  
> Review: `.github/docs/SubAgent docs/critical_errors_fix_review.md`

### C1: `this` Context Loss in Legacy Transaction

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/config/database.js` |
| **Lines** | 206–214 |
| **Impact** | ROLLBACK and COMMIT operations crash at runtime |
| **Type** | Runtime Error |

**Description:**  
The legacy `transaction()` method uses traditional `function(err)` callbacks for SQLite `db.run()`. Inside these callbacks, `this` refers to the SQLite statement result object (which provides `.lastID` and `.changes`), **not** the Database wrapper instance.

On lines 209 and 213, the code calls `this.db.run('ROLLBACK')` and `this.db.run('COMMIT', ...)` — but `this.db` is `undefined` in this context because `this` is the statement object. This causes a runtime crash whenever a transaction encounters an error or tries to commit.

**Affected Code:**
```javascript
// Line 206-214 — backend/config/database.js
this.db.run(stmt.sql, stmt.params || [], function(err) {
    if (err) {
        hasError = true;
        this.db.run('ROLLBACK');   // BUG: `this` is statement context, not Database
        reject(err);
    } else {
        results.push({ index, id: this.lastID, changes: this.changes });
        
        if (results.length === statements.length) {
            this.db.run('COMMIT', (err) => {   // BUG: same `this` issue
```

**Fix:**  
Capture `this.db` in a variable before the callback (e.g., `const db = this.db;`) and use `db.run('ROLLBACK')` / `db.run('COMMIT')` inside the callback. Note: `.lastID` and `.changes` correctly use the statement `this`, so don't convert to arrow functions.

**Resolution:** Captured `this.db` as `const db` before the callback chain. All `this.db.*` calls replaced with `db.*`. `function(err)` callbacks preserved so `this.lastID`/`this.changes` still work correctly.

---

### C2: Route Ordering — `/:id` Shadows `/search/:query`

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/routes/voters.js` |
| **Lines** | 124 and 155 |
| **Impact** | Voter search endpoint is completely unreachable |
| **Type** | Logic Error |

**Description:**  
Express evaluates routes in registration order. The `/:id` route is registered at **line 124**, while `/search/:query` is registered at **line 155**. When a request comes in for `/api/voters/search/smith`, Express matches `/:id` first (with `id = "search"`), and the `isInt` validator rejects it with a 400 error. The `/search/:query` route is never reached.

**Affected Code:**
```javascript
// Line 124 — registered FIRST
router.get('/:id', [
    param('id').isInt().withMessage('Voter ID must be an integer'),
    ...

// Line 155 — registered SECOND (unreachable)
router.get('/search/:query', [
    param('query').trim().isLength({ min: 2 }).withMessage('Search query must be at least 2 characters'),
    ...
```

**Fix:**  
Move the `/search/:query` route definition **before** the `/:id` route. Express will then match the literal `/search/` path first, and only fall through to `/:id` for numeric IDs.

**Resolution:** Moved `/search/:query` and `/precinct/:precinct` routes before `/:id`. Route order is now: `GET /` → `GET /search/:query` → `GET /precinct/:precinct` → `GET /:id`.

---

### C3: SQL Injection in `createJob`

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/services/geocoding-job-service.js` |
| **Line** | 47 |
| **Impact** | Arbitrary SQL execution via crafted voter IDs |
| **Type** | Security Vulnerability |

**Description:**  
The `voterIds` array is directly string-interpolated into a SQL query without parameterization.

**Affected Code:**
```javascript
// Line 47 — backend/services/geocoding-job-service.js
const validVoters = await database.all(`
    SELECT id FROM voters WHERE id IN (${voterIds.join(',')})
`);
```

**Fix:**  
Use parameterized placeholders:
```javascript
const placeholders = voterIds.map(() => '?').join(',');
const validVoters = await database.all(
    `SELECT id FROM voters WHERE id IN (${placeholders})`,
    voterIds
);
```

---

### C4: SQL Injection in `retryFailedAddresses`

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/services/geocoding-job-service.js` |
| **Lines** | 527–529 |
| **Impact** | Arbitrary SQL execution via voter ID manipulation |
| **Type** | Security Vulnerability |

**Description:**  
Same pattern as C3 — `voterIds` interpolated directly into SQL.

**Affected Code:**
```javascript
// Lines 527-529 — backend/services/geocoding-job-service.js
await database.run(`
    UPDATE voters
    SET latitude = NULL, longitude = NULL, geocoding_quality = NULL
    WHERE id IN (${voterIds.join(',')})
`);
```

**Irony:** The same file correctly uses parameterized queries in `getFailedAddresses`:
```javascript
// Correct pattern used elsewhere in the same file
errorTypes.map(() => '?').join(',')
```

**Fix:**  
Same approach as C3 — use parameterized placeholders.

**Resolution (C3 & C4):** Both SQL injection sites replaced with parameterized `?` placeholders. `voterIds` array passed as parameter array to `database.all()` / `database.run()`.

---

### C5: Table Name Mismatch — `api_quotas` vs `api_usage`

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **Files** | `backend/services/geocoding-service.js` (lines 380–384), `backend/services/quota-manager.js` (lines 47–55) |
| **Migrations** | `003_add_geocoding_tables.js` (lines 84–93), `006_add_route_planning_tables.js` (lines 54–66) |
| **Impact** | Two independent quota systems that never share data; quota limits applied incorrectly |
| **Type** | Architecture / Data Integrity |

**Description:**  
Two completely separate quota tracking systems exist with different table names, column names, and schemas:

| Aspect | `api_quotas` (geocoding-service) | `api_usage` (quota-manager) |
|--------|-----------------------------------|------------------------------|
| **Migration** | 003 | 006 |
| **Key columns** | `date`, `service`, `request_count` | `api_name`, `call_date`, `call_count`, `cache_hits`, `cache_misses` |
| **Used by** | `geocoding-service.js` | `quota-manager.js`, `route-optimizer-service.js`, `distance-matrix-service.js` |

**geocoding-service.js writes to `api_quotas`:**
```javascript
// Line 380-384
await database.run(`
    INSERT INTO api_quotas (date, service, request_count) 
    VALUES (?, 'geocoding', 1)
    ON CONFLICT(date, service) 
    DO UPDATE SET request_count = request_count + 1
`, [date]);
```

**quota-manager.js reads/writes `api_usage`:**
```javascript
// Lines 47-55
let usage = await database.get(`
    SELECT * FROM api_usage
    WHERE api_name = ? AND call_date = ?
`, [apiName, today]);
```

**Fix:**  
Unify into a single table. Migrate `api_quotas` data into `api_usage` and update `geocoding-service.js` to use quota-manager instead of direct SQL.

**Resolution:** Added `QuotaManager` import and instance to `geocoding-service.js`. `incrementQuotaUsage()` now delegates to `quotaManager.incrementApiCall('geocoding', 1)`. `getDailyUsage()` queries the unified `api_usage` table. `checkQuotaLimit()` delegates to `quotaManager.checkQuota()`. No more direct SQL against `api_quotas`.

---

## High Severity

> ✅ **All 5 high severity errors have been fixed** (February 16, 2026)  
> Spec: `.github/docs/SubAgent docs/high_severity_fix_spec.md`  
> Review: `.github/docs/SubAgent docs/high_severity_fix_review.md`

### H1: Missing Columns in `setup.js` Schema

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `scripts/setup.js` |
| **Lines** | 52–68 |
| **Impact** | Fresh database installs may fail if migrations don't run |
| **Type** | Schema Mismatch |

**Description:**  
The `voters` table created in `setup.js` is missing columns that migrations later add:
- **`date_of_birth`** — added by migration 004
- **`state`** — added by migration 007

If `setup.js` runs but migrations don't, any code referencing these columns will fail.

**Affected Code:**
```javascript
// Lines 52-68 — scripts/setup.js
CREATE TABLE IF NOT EXISTS voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT UNIQUE,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    precinct_number TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    geocoding_quality TEXT,
    super_voter BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
// MISSING: date_of_birth TEXT, state TEXT
```

**Fix:**  
Add `date_of_birth TEXT` and `state TEXT` to the base schema, or ensure migrations always run after setup.

**Resolution:** Added `date_of_birth TEXT` and `state TEXT` columns to the voters CREATE TABLE statement in `scripts/setup.js`.

---

### H2: Missing Migration Tables in `setup.js`

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `scripts/setup.js` |
| **Impact** | Fresh installs lack geocoding, route planning, and saved route tables |
| **Type** | Schema Mismatch |

**Description:**  
The setup script creates only the base `voters`, `election_history`, and `precincts` tables. The following tables from migrations are never created in the base schema:

- `geocoding_jobs` (migration 003)
- `geocoding_errors` (migration 003)
- `api_quotas` (migration 003)
- `route_cache` (migration 006)
- `api_usage` (migration 006)
- `saved_routes` (migration 008)

**Fix:**  
Either include all table definitions in `setup.js`, or implement a migration runner that automatically applies pending migrations on startup.

**Resolution:** Added all 6 missing migration tables (`geocoding_jobs`, `geocoding_errors`, `api_quotas`, `route_cache`, `api_usage`, `saved_routes`) with all 11 indexes to `scripts/setup.js`.

---

### H3: Hardcoded Voter Count `2677`

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/models/voter.js` |
| **Line** | 617 |
| **Impact** | Incorrect percentage reported for super voter calculations |
| **Type** | Logic Error |

**Description:**  
A development/testing artifact was left in production code.

**Affected Code:**
```javascript
// Line 617 — backend/models/voter.js
console.log(`✅ ${count.total} voters marked as super voters (${Math.round(count.total / 2677 * 100)}% of total)`);
```

**Fix:**  
Query the actual total voter count:
```javascript
const totalResult = await database.get('SELECT COUNT(*) as total FROM voters');
const percentage = Math.round(count.total / totalResult.total * 100);
console.log(`✅ ${count.total} voters marked as super voters (${percentage}% of total)`);
```

**Resolution:** Replaced hardcoded `2677` with dynamic `SELECT COUNT(*) as total FROM voters` query, with division-by-zero guard.

---

### H4: Truncated JSDoc Comment

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/routes/analytics.js` |
| **Lines** | 69–70 |
| **Impact** | Misleading documentation; IDE tooltips show garbled info |
| **Type** | Documentation |

**Description:**  
The JSDoc block for the turnout endpoint is truncated — it starts mid-sentence.

**Affected Code:**
```javascript
// Lines 69-70 — backend/routes/analytics.js
/** with comparative analysis
 * 
```

**Fix:**  
Replace with proper JSDoc:
```javascript
/**
 * GET /api/analytics/turnout
 * Returns voter turnout data with comparative analysis
 */
```

**Resolution:** Replaced truncated JSDoc with proper `GET /api/analytics/turnout` endpoint documentation.

---

### H5: SPA Catch-All Before 404 Handler

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/server.js` |
| **Lines** | 308–323 |
| **Impact** | Undefined GET API routes serve HTML instead of 404 JSON |
| **Type** | Logic Error |

**Description:**  
The SPA catch-all `app.get('*')` is registered before the 404 handler. Any GET request to a non-existent route (e.g., `GET /api/nonexistent`) receives `index.html` with a 200 status instead of a proper 404 JSON error.

**Affected Code:**
```javascript
// Line 308-310 — SPA catch-all
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// Lines 318-323 — 404 handler (unreachable for GET requests)
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        ...
```

**Fix:**  
Exclude `/api/*` paths from the SPA catch-all:
```javascript
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not Found', message: `Route GET ${req.path} not found` });
    }
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});
```

**Resolution:** Added `/api/` path guard to the SPA catch-all. API requests now fall through via `next()` to the 404 handler instead of receiving `index.html`.

---

## Medium Severity

> ✅ **All 5 medium severity errors have been fixed** (February 16, 2026)  
> Spec: `.github/docs/SubAgent docs/medium_severity_fix_spec.md`  
> Review: `.github/docs/SubAgent docs/medium_severity_fix_review_final.md`

### M1: `getVotersByIds` Queries Wrong Column

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/models/voter.js` |
| **Lines** | 700–712 |
| **Impact** | Returns no results when called with database `id` values |
| **Type** | Logic Error |

**Description:**  
The method queries `WHERE voter_id IN (...)` but callers pass integer primary key `id` values (not text `voter_id` values). For example, `geocoding-job-service.js` passes IDs obtained from `SELECT id FROM voters`.

**Affected Code:**
```javascript
// Lines 700-712 — backend/models/voter.js
const voters = await database.all(
    `SELECT id, voter_id, ...
    FROM voters 
    WHERE voter_id IN (${placeholders})`,
    voterIds
);
```

**Fix:**  
Change `WHERE voter_id IN` to `WHERE id IN`, or document the expected input type clearly and ensure callers pass the correct column values.

**Resolution:** Changed `WHERE voter_id IN` to `WHERE id IN` in `getVotersByIds`. Updated frontend `route-planner-controller.js` to send `v.id` instead of `v.voterId || v.voter_id`.

---

### M2: Circular Progress Calculation

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/routes/upload.js` |
| **Lines** | 328–330 |
| **Impact** | Progress percentage is always ~100% or meaningless |
| **Type** | Logic Error |

**Description:**  
The formula divides `records_processed` by `(records_successful + records_failed)`. Since `records_processed = records_successful + records_failed`, this always yields ~100%.

**Affected Code:**
```javascript
// Lines 328-330 — backend/routes/upload.js
const percent = upload.records_successful > 0 
    ? ((upload.records_processed / (upload.records_successful + upload.records_failed)) * 100).toFixed(1)
    : 0;
```

**Fix:**  
Track `total_records` (total expected) separately and calculate:
```javascript
const percent = upload.total_records > 0
    ? ((upload.records_processed / upload.total_records) * 100).toFixed(1)
    : 0;
```

**Resolution:** Added `total_records INTEGER DEFAULT 0` column to `import_logs` table in `scripts/setup.js`. Created migration `009_add_total_records.js` for existing databases. Updated `import-processor.js` to store total record count after parsing. Fixed progress formula in `upload.js` to use `total_records` as denominator with legacy fallback.

---

### M3: Precinct Format Inconsistency Between Parsers

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **Files** | `backend/parsers/csv-parser.js` (lines 451–459), `backend/parsers/dbf-parser.js` (lines 304–310) |
| **Impact** | Same voter imported from different file types gets different precinct values |
| **Type** | Data Inconsistency |

**Description:**  
The `sanitizePrecinct` function has different implementations in each parser:

| Aspect | CSV Parser | DBF Parser |
|--------|-----------|------------|
| Non-numeric handling | Preserves hyphens | Strips all non-numeric |
| Zero-padding | None | Pads to 2 digits |
| Example: "2-4" | "2-4" | "24" |
| Example: "4" | "4" | "04" |

**CSV Parser:**
```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    const cleaned = value.toString().trim().replace(/[^0-9-]/g, '');
    return cleaned;
}
```

**DBF Parser:**
```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    const cleaned = value.toString().trim().replace(/[^0-9]/g, '');
    return cleaned.padStart(2, '0');
}
```

**Fix:**  
Create a shared utility module with a single `sanitizePrecinct` implementation. Choose one format and apply consistently.

**Resolution:** Updated DBF parser's `sanitizePrecinct` to match the CSV parser's implementation — preserves hyphens (`/[^0-9-]/g`), no zero-padding. Both parsers now produce identical precinct values.

---

### M4: API Key Environment Variable Naming Confusion

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **Files** | `backend/server.js`, `backend/services/geocoding-service.js`, `backend/services/distance-matrix-service.js` |
| **Impact** | Potential runtime failures if env vars are set inconsistently |
| **Type** | Configuration |

**Description:**  
`server.js` validates `GOOGLE_MAPS_API_KEY` on startup, but services may reference the key differently. If the env var name doesn't match across all files, the server starts successfully but API calls fail silently.

**Fix:**  
Centralize API key access through a single config module that validates on load.

**Resolution:** Created centralized `backend/config/api-keys.js` with per-service env var support (`GOOGLE_MAPS_GEOCODING_API_KEY`, `GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY`) and fallback to `GOOGLE_MAPS_API_KEY`. Updated `server.js`, `geocoding-service.js`, and `distance-matrix-service.js` to use the centralized config.

---

### M5: Middleware Ordering — SPA Catch-All Blocks API 404s

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 (resolved by H5 fix) |
| **File** | `backend/server.js` |
| **Impact** | Overlaps with H5; API middleware ordering prevents proper error responses |
| **Type** | Architecture |

**Description:**  
Related to H5 — the middleware chain ordering means:
1. API routes → 2. SPA catch-all → 3. 404 handler → 4. Error handler

Step 2 intercepts all unmatched GET requests before step 3 can provide a proper API error response.

**Fix:**  
Same as H5 — add path-based routing logic to the SPA catch-all.

**Resolution:** Already resolved by the H5 fix. The SPA catch-all now checks `req.path.startsWith('/api/')` and calls `next()` for API requests, allowing them to reach the 404 handler.

---

## Low Severity

> ✅ **All 5 low severity errors have been fixed** (February 16, 2026)  
> Spec: `.github/docs/SubAgent docs/low_severity_fix_spec.md`  
> Review: `.github/docs/SubAgent docs/low_severity_fix_review_final.md`

### L1: Database Connection Check Redundancy

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/config/database.js` |
| **Impact** | Minor code smell; no functional impact |
| **Type** | Code Quality |

**Description:**  
The connection check method returns the database instance itself after verifying connectivity, but callers could just use the singleton directly. The method adds unnecessary complexity.

**Resolution:** Made `connect()` idempotent (returns early if already connected). Added `_ensureConnected()` guard method called at the start of `run()`, `get()`, `all()`, and `transaction()` to ensure the database is connected before any operation.

---

### L2: `instanceof SparseDistanceMatrix` Fragility

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/services/route-optimizer-service.js` |
| **Lines** | 54–55 |
| **Impact** | Progressive routing detection could fail in certain module configurations |
| **Type** | Code Fragility |

**Description:**  
The `instanceof` check navigates through `this.distanceMatrixService.constructor.SparseDistanceMatrix`, and the fallback uses `constructor.name` which breaks with minification.

**Affected Code:**
```javascript
// Lines 54-55
const isProgressive = distanceMatrix instanceof this.distanceMatrixService.constructor.SparseDistanceMatrix ||
                      distanceMatrix.constructor.name === 'SparseDistanceMatrix';
```

**Fix:**  
Import `SparseDistanceMatrix` directly and use a simple `instanceof` check, or use a duck-typing approach (check for a characteristic method like `.getDistance()`).

**Resolution:** Imported `SparseDistanceMatrix` directly from `distance-matrix-service.js`. Replaced the fragile `instanceof` chain and `constructor.name` fallback with a simple `distanceMatrix instanceof SparseDistanceMatrix` check. Unified all other `isProgressive` duck-typing checks throughout the file to also use `instanceof`.

---

### L3: Duplicate Sanitization Functions Across Parsers

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **Files** | `backend/parsers/csv-parser.js`, `backend/parsers/dbf-parser.js` |
| **Impact** | Maintenance burden; potential for divergent behavior |
| **Type** | Code Duplication |

**Description:**  
The following utility functions are duplicated across both parsers with similar (but not identical) implementations:
- `sanitizePrecinct` (different logic — see M3)
- `sanitizeText`
- `sanitizeZipCode`
- `sanitizeDate`

**Fix:**  
Extract shared utilities into `backend/parsers/utils.js` or `backend/utils/sanitizers.js`.

**Resolution:** Created `backend/parsers/parser-utils.js` with all 4 shared sanitization functions (`sanitizeText`, `sanitizeZipCode`, `sanitizePrecinct`, `sanitizeDate`). Updated both `csv-parser.js` and `dbf-parser.js` to import from the shared module. Removed all duplicate function definitions from both parsers.

---

### L4: Foreign Key to Non-Existent `users` Table

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/migrations/008_add_saved_routes.js` |
| **Line** | 19 |
| **Impact** | Dead FK constraint; will break if FK enforcement is enabled |
| **Type** | Schema Integrity |

**Description:**  
The `saved_routes` table has a FK reference to `users(id)`, but no `users` table exists anywhere in the codebase.

**Affected Code:**
```javascript
// Line 19 — backend/migrations/008_add_saved_routes.js
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
```

SQLite doesn't enforce FK constraints by default (`PRAGMA foreign_keys` is OFF), so this doesn't cause runtime errors currently. But it will break if FK enforcement is ever enabled.

**Fix:**  
Either create a `users` table migration, or remove the FK constraint and just keep `user_id` as a plain column.

**Resolution:** Removed the `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL` constraint from both `backend/migrations/008_add_saved_routes.js` and `scripts/setup.js`. The `user_id` column is preserved as a plain column.

---

### L5: Error Handler Gap for Non-GET Unknown Routes

| Property | Value |
|----------|-------|
| **Status** | ✅ **FIXED** — February 16, 2026 |
| **File** | `backend/server.js` |
| **Impact** | Non-GET requests to unknown routes reach 404 handler properly, but GET requests don't |
| **Type** | Inconsistency |

**Description:**  
The SPA catch-all only catches GET requests. POST/PUT/DELETE to undefined routes correctly fall through to the 404 handler. This creates inconsistent error response behavior depending on HTTP method.

**Resolution:** Added `app.all('/api/*')` 404 handler before the SPA catch-all. All HTTP methods (GET, POST, PUT, DELETE, etc.) to unknown `/api/*` routes now consistently receive a 404 JSON response. The SPA catch-all was simplified to only serve `index.html` for non-API routes.

---

## Architecture Observations

### Dual Quota Tracking Systems
The most significant architectural issue is the existence of two parallel, incompatible quota tracking systems:
- **`api_quotas`** (migration 003): Simple date+service+count, used only by geocoding
- **`api_usage`** (migration 006): Richer schema with cache tracking, used by everything else

These should be unified into a single system.

### Schema Fragmentation
The base schema in `setup.js` and the migration-extended schema have diverged significantly. There's no migration runner that ensures all migrations apply automatically. A fresh install via `setup.js` produces an incomplete database.

### No Migration Runner
Migrations exist as standalone files but there's no automated mechanism to detect and run pending migrations on server startup. This is a significant operational risk.

### Frontend Not Audited
The frontend directory contains 21 JavaScript files that were not included in this audit:
```
frontend/public/js/
├── app.js
├── map-controller.js
├── route-planner-controller.js
├── dashboard.js
├── voter-list-controller.js
├── upload-controller.js
├── ... (15 more files)
```
A separate frontend audit is recommended.

---

## Recommended Fix Order

| Priority | Error | Effort | Risk | Status |
|----------|-------|--------|------|--------|
| 1 | **C3/C4** — SQL Injection (2 locations) | Low | Security | ✅ FIXED |
| 2 | **C2** — Route ordering | Low | Broken feature | ✅ FIXED |
| 3 | **C1** — `this` context in transaction | Low | Runtime crash | ✅ FIXED |
| 4 | **C5** — Table name mismatch | Medium | Data integrity | ✅ FIXED |
| 5 | **H5/M5** — SPA catch-all | Low | Incorrect responses | ✅ FIXED |
| 6 | **H3** — Hardcoded `2677` | Low | Incorrect output | ✅ FIXED |
| 7 | **M1** — `getVotersByIds` wrong column | Low | Broken feature | ✅ FIXED |
| 8 | **H1/H2** — Setup.js schema gaps | Medium | Fresh installs | ✅ FIXED |
| 9 | **M3/L3** — Parser inconsistency + duplication | Medium | Data quality | ✅ FIXED |
| 10 | **M2** — Progress calculation | Low | UX | ✅ FIXED |
| 11 | **L4** — Phantom FK | Low | Future-proofing | ✅ FIXED |
| 12 | **L2** — instanceof fragility | Low | Edge cases | ✅ FIXED |
| 13 | **H4** — Truncated JSDoc | Low | Documentation | ✅ FIXED |
| 14 | **M4** — Env var naming | Low | Configuration | ✅ FIXED |
| 15 | **L1/L5** — Minor issues | Low | Code quality | ✅ FIXED |

---

## Appendix: Files Analyzed

| File | Lines | Status |
|------|-------|--------|
| `backend/server.js` | 553 | ✅ Audited |
| `backend/config/database.js` | 330 | ✅ Audited |
| `backend/routes/voters.js` | 207 | ✅ Audited |
| `backend/routes/upload.js` | 330 | ✅ Audited |
| `backend/routes/analytics.js` | 400 | ✅ Audited |
| `backend/routes/geocode.js` | ~200 | ✅ Audited |
| `backend/routes/never-voted.js` | ~150 | ✅ Audited |
| `backend/routes/precincts.js` | ~100 | ✅ Audited |
| `backend/routes/routes.js` | 797 | ✅ Audited |
| `backend/models/voter.js` | 718 | ✅ Audited |
| `backend/models/saved-route.js` | 180 | ✅ Audited |
| `backend/services/geocoding-service.js` | 430 | ✅ Audited |
| `backend/services/geocoding-job-service.js` | 568 | ✅ Audited |
| `backend/services/quota-manager.js` | 360 | ✅ Audited |
| `backend/services/route-optimizer-service.js` | 370 | ✅ Audited |
| `backend/services/distance-matrix-service.js` | 644 | ✅ Audited |
| `backend/services/import-processor.js` | ~300 | ✅ Audited |
| `backend/services/analytics-service.js` | ~400 | ✅ Audited |
| `backend/services/address-cache-service.js` | ~200 | ✅ Audited |
| `backend/services/route-cache-service.js` | ~200 | ✅ Audited |
| `backend/parsers/csv-parser.js` | 601 | ✅ Audited |
| `backend/parsers/dbf-parser.js` | 400 | ✅ Audited |
| `backend/migrations/003_add_geocoding_tables.js` | ~100 | ✅ Audited |
| `backend/migrations/004_add_date_of_birth.js` | ~30 | ✅ Audited |
| `backend/migrations/006_add_route_planning_tables.js` | ~70 | ✅ Audited |
| `backend/migrations/007_add_state_column.js` | ~30 | ✅ Audited |
| `backend/migrations/008_add_saved_routes.js` | ~40 | ✅ Audited |
| `scripts/setup.js` | 242 | ✅ Audited |
| `frontend/public/js/*` (21 files) | — | ❌ Not audited |
