# Medium Severity Issues — Fix Specification

**Date:** February 16, 2026  
**Source:** `.github/docs/SubAgent docs/error_audit.md`  
**Scope:** 5 medium severity issues (M1–M5)  
**Status:** Ready for implementation

---

## Table of Contents

- [M1: `getVotersByIds` Queries Wrong Column](#m1-getvotersbyids-queries-wrong-column)
- [M2: Circular Progress Calculation](#m2-circular-progress-calculation)
- [M3: Precinct Format Inconsistency Between Parsers](#m3-precinct-format-inconsistency-between-parsers)
- [M4: API Key Environment Variable Naming Confusion](#m4-api-key-environment-variable-naming-confusion)
- [M5: Middleware Ordering — SPA Catch-All Blocks API 404s](#m5-middleware-ordering--spa-catch-all-blocks-api-404s)

---

## M1: `getVotersByIds` Queries Wrong Column

### Status: **NEEDS FIX**

### Problem Summary

The `getVotersByIds` method in `VoterModel` queries `WHERE voter_id IN (...)` (the **text** voter registration ID column), but the caller in `routes.js` sends integer primary key `id` values from the frontend. This creates a column mismatch that may silently return no results (or incorrect results due to SQLite type coercion).

### Current Code

**File:** `backend/models/voter.js` — Lines 689–718

```javascript
async getVotersByIds(voterIds) {
    if (!voterIds || voterIds.length === 0) {
        return [];
    }

    const placeholders = voterIds.map(() => '?').join(', ');
    
    const voters = await database.all(
        `SELECT 
            id,
            voter_id,
            last_name,
            first_name,
            address as residential_address,
            city as residential_city,
            zip_code,
            precinct_number,
            latitude,
            longitude,
            geocoding_quality,
            super_voter
        FROM voters 
        WHERE voter_id IN (${placeholders})`,  // ← BUG: queries text voter_id
        voterIds
    );

    return voters;
}
```

### Callers

**Only caller: `backend/routes/routes.js` — Line 91**

```javascript
const voterModel = new VoterModel();
const voters = await voterModel.getVotersByIds(voterIds);
```

The `voterIds` come from `req.body.voterIds`, and the request validation at lines 54–58 requires each to be an integer:

```javascript
body('voterIds')
    .isArray({ min: 1 })
    .withMessage('voterIds must be non-empty array'),
body('voterIds.*')
    .isInt()
    .withMessage('Each voterId must be an integer'),
```

### Frontend Data Flow

**File:** `frontend/public/js/route-planner-controller.js` — Line 708

```javascript
const voterIds = this.selectedVoters.map(v => v.voterId || v.voter_id);
```

The frontend currently sends `voter_id` (text field), NOT `id` (integer PK). This creates a **double mismatch**:
1. The frontend sends text `voter_id` values
2. The `.isInt()` validation only passes if voter_id values happen to be numeric
3. The model queries `WHERE voter_id IN (...)` which happens to match — but only by accident

### Fix

Two changes required for consistency:

**Change 1: `backend/models/voter.js` — Line 712**

```javascript
// BEFORE:
WHERE voter_id IN (${placeholders})`,

// AFTER:
WHERE id IN (${placeholders})`,
```

**Change 2: `frontend/public/js/route-planner-controller.js` — Line 708**

```javascript
// BEFORE:
const voterIds = this.selectedVoters.map(v => v.voterId || v.voter_id);

// AFTER:
const voterIds = this.selectedVoters.map(v => v.id);
```

### Rationale

- Using `id` (integer PK) is consistent with the `.isInt()` validation
- The `id` column is the primary key (indexed, O(log n) lookups)
- All other backend code paths (e.g., `geocoding-job-service.js` line 47) work with integer `id` values
- The frontend voter objects already have an `id` property from the API response

### Risks & Edge Cases

- **Risk:** If any frontend voter objects lack an `id` property, `v.id` would be `undefined`. This is unlikely since all API responses include `id`.
- **Edge case:** The `selectedVoterIds` Set in the frontend uses `voter_id` text values for map marker lookups. This Set is used for UI state only and does NOT affect the API call. No change needed to the Set.
- **No breaking change:** No other code calls `getVotersByIds`.

---

## M2: Circular Progress Calculation

### Status: **NEEDS FIX**

### Problem Summary

The progress percentage calculation in `upload.js` divides `records_processed` by `(records_successful + records_failed)`. Since `records_processed == records_successful + records_failed` (by definition), this always yields ~100% — making the progress indicator useless.

### Current Code

**File:** `backend/routes/upload.js` — Lines 324–337

```javascript
// Calculate progress percentage
let progress = null;
if (upload.records_processed > 0) {
    const total = upload.records_processed; // We don't store total separately  ← acknowledges the problem
    const percent = upload.records_successful > 0 
        ? ((upload.records_processed / (upload.records_successful + upload.records_failed)) * 100).toFixed(1)
        : 0;
    
    progress = {
        processed: upload.records_processed,
        successful: upload.records_successful,
        failed: upload.records_failed,
        percent: parseFloat(percent)
    };
}
```

### Root Cause

The `import_logs` table (defined in `scripts/setup.js` lines 109–120) has no `total_records` column:

```sql
CREATE TABLE IF NOT EXISTS import_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_size INTEGER,
    records_processed INTEGER DEFAULT 0,
    records_successful INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    status TEXT DEFAULT 'pending',
    error_message TEXT
);
```

Meanwhile, the `import-processor.js` service **does** know the total (`parseResult.records.length` at line 42) but never stores it in the database.

### Fix

Three changes required:

**Change 1: Add `total_records` column to `import_logs` table in `scripts/setup.js`**

After `file_size INTEGER,` (line 112), add:

```sql
total_records INTEGER DEFAULT 0,
```

**Change 2: Store `total_records` in `import-processor.js`**

After parsing (line 42), store the total before processing:

```javascript
// CURRENT (line 42):
const totalRecords = parseResult.records.length;

// ADD after line 42 — store total in import_logs:
await database.run(
    'UPDATE import_logs SET total_records = ? WHERE id = ?',
    [totalRecords, importId]
);
```

**Change 3: Fix the progress formula in `upload.js`**

Replace lines 324–337:

```javascript
// Calculate progress percentage
let progress = null;
if (upload.total_records > 0) {
    const percent = ((upload.records_processed / upload.total_records) * 100).toFixed(1);
    
    progress = {
        total: upload.total_records,
        processed: upload.records_processed,
        successful: upload.records_successful,
        failed: upload.records_failed,
        percent: Math.min(parseFloat(percent), 100.0)
    };
} else if (upload.records_processed > 0) {
    // Fallback when total_records is not yet set (legacy imports)
    progress = {
        total: null,
        processed: upload.records_processed,
        successful: upload.records_successful,
        failed: upload.records_failed,
        percent: null
    };
}
```

### Risks & Edge Cases

- **Migration:** Existing `import_logs` rows won't have `total_records`. The fallback branch handles this by returning `percent: null` when `total_records` is 0/null.
- **Schema change:** Adding a column to `import_logs` requires `ALTER TABLE` for existing databases. Since SQLite supports `ALTER TABLE ADD COLUMN`, this can be handled in a new migration file or via the setup script (which uses `CREATE TABLE IF NOT EXISTS`).
- **Timing:** The `total_records` is set after parsing but before batch processing begins, so it's available for any progress queries during processing.

---

## M3: Precinct Format Inconsistency Between Parsers

### Status: **NEEDS FIX**

### Problem Summary

The `sanitizePrecinct` function has different implementations in the CSV and DBF parsers, producing inconsistent database values for the same precinct input.

| Input | CSV Parser Output | DBF Parser Output |
|-------|------------------|-------------------|
| `"2-4"` | `"2-4"` | `"24"` |
| `"1-3"` | `"1-3"` | `"13"` |
| `"4"` | `"4"` | `"04"` |
| `" 2 - 4 "` | `"2-4"` | `"24"` |

### Current Code

**CSV Parser:** `backend/parsers/csv-parser.js` — Lines 451–459

```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    // Preserve hyphens and numbers only, remove other non-alphanumeric chars
    const cleaned = value.toString().trim().replace(/[^0-9-]/g, '');
    
    // Return as-is to preserve district-precinct format like "2-4"
    return cleaned;
}
```

**DBF Parser:** `backend/parsers/dbf-parser.js` — Lines 304–310

```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim().replace(/[^0-9]/g, '');
    
    // Zero-pad to 2 digits
    return cleaned.padStart(2, '0');
}
```

### Correct Behavior

The **CSV parser version is correct**. Obion County, Tennessee uses a district-precinct format like "2-4" (District 2, Precinct 4). The hyphen is semantically meaningful — stripping it collapses "2-4" into "24", which conflates two different precincts.

The DBF parser's zero-padding is also wrong for hyphenated precincts: `"2-4".padStart(2, '0')` does nothing (already >2 chars), but `"4".padStart(2, '0')` → `"04"` which is inconsistent with how the CSV parser handles the same value.

### Fix

**Change: `backend/parsers/dbf-parser.js` — Lines 299–310**

Replace the entire `sanitizePrecinct` function in the DBF parser with the CSV parser's implementation:

```javascript
/**
 * Sanitize precinct number - PRESERVE ORIGINAL FORMAT
 * CRITICAL FIX: Do NOT strip hyphens to preserve district-precinct format like "2-4"
 * Obion County uses format: "{district}-{precinct}" (e.g., "2-4", "1-3")
 * @param {string|number|null|undefined} value - Precinct number (e.g., '2-4', '1-3')
 * @returns {string} Sanitized precinct preserving hyphens and original format
 */
function sanitizePrecinct(value) {
    if (!value) return '';
    
    // Preserve hyphens and numbers only, remove other non-alphanumeric chars
    const cleaned = value.toString().trim().replace(/[^0-9-]/g, '');
    
    // Return as-is to preserve district-precinct format like "2-4"
    return cleaned;
}
```

### Also Addresses L3 (Partial)

This fix aligns the `sanitizePrecinct` implementations across both parsers. The audit also notes L3 (duplicate sanitization functions): `sanitizeText`, `sanitizeZipCode`, and `sanitizeDate` are duplicated with **identical** logic across both parsers. Extracting them into a shared utility module is recommended but is a **separate task** (L3) and not required for M3.

### Risks & Edge Cases

- **Existing data:** If voters were previously imported via DBF with stripped hyphens (e.g., "24" instead of "2-4"), they will have inconsistent precinct_number values. A data migration script may be needed to fix existing records if any DBF imports occurred.
- **Zero-padding removal:** Precincts imported via DBF as "04" will now be "4" on re-import. This is correct (no padding needed) but creates a discrepancy with existing data.
- **Downstream consumers:** Any code that queries by `precinct_number` (e.g., the `/api/precincts` endpoint, analytics queries) should be tested to ensure they work with the hyphenated format.

---

## M4: API Key Environment Variable Naming Confusion

### Status: **NEEDS FIX**

### Problem Summary

Three different Google Maps API key environment variable names are used across the codebase. While they currently happen to work (through fallback chains), this is confusing, fragile, and poorly documented.

### Current State

| File | Variable Name | Purpose |
|------|--------------|---------|
| `backend/server.js` line 47 | `GOOGLE_MAPS_API_KEY` | Startup validation — server exits if missing |
| `backend/server.js` line 172 | `GOOGLE_MAPS_API_KEY` | Served to frontend for Maps JS API |
| `backend/services/geocoding-service.js` line 22 | `GOOGLE_MAPS_GEOCODING_API_KEY` | Geocoding API calls |
| `backend/services/distance-matrix-service.js` line 169 | `GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY \|\| GOOGLE_MAPS_GEOCODING_API_KEY` | Distance Matrix API calls |

**server.js** — Line 47 (startup validation):
```javascript
if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('❌ CRITICAL: GOOGLE_MAPS_API_KEY not found in environment variables');
    process.exit(1);
}
```

**geocoding-service.js** — Line 22 (constructor):
```javascript
this.apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
```

**distance-matrix-service.js** — Line 169 (constructor):
```javascript
this.apiKey = process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY || 
              process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
```

### Problem

1. Server starts successfully with only `GOOGLE_MAPS_API_KEY` set
2. But geocoding silently fails because `GOOGLE_MAPS_GEOCODING_API_KEY` is undefined
3. Distance matrix silently fails for the same reason
4. Users must set 2-3 different env vars that could all be the same key
5. The warning in `geocoding-service.js` (line 43) fires AFTER startup, not at boot

### Fix

**Change 1: Create centralized config — `backend/config/api-keys.js`** (NEW FILE)

```javascript
/**
 * Centralized API Key Configuration
 * Single source of truth for all Google Maps API keys
 * 
 * Supports per-service keys for production (separate quotas),
 * but falls back to a single shared key for development.
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

module.exports = {
    /** Google Maps JavaScript API key (frontend map rendering) */
    mapsApiKey: GOOGLE_MAPS_API_KEY || '',
    
    /** Geocoding API key (address → lat/lng) */
    geocodingApiKey: process.env.GOOGLE_MAPS_GEOCODING_API_KEY || GOOGLE_MAPS_API_KEY,
    
    /** Distance Matrix API key (route distances) */
    distanceMatrixApiKey: process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY || GOOGLE_MAPS_API_KEY,
    
    /**
     * Validate that at least the base API key is configured.
     * Called at server startup.
     * @returns {{ valid: boolean, warnings: string[] }}
     */
    validate() {
        const warnings = [];
        
        if (!GOOGLE_MAPS_API_KEY) {
            return { 
                valid: false, 
                warnings: ['GOOGLE_MAPS_API_KEY not set in .env'] 
            };
        }
        
        if (!process.env.GOOGLE_MAPS_GEOCODING_API_KEY) {
            warnings.push('GOOGLE_MAPS_GEOCODING_API_KEY not set — falling back to GOOGLE_MAPS_API_KEY');
        }
        
        if (!process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY) {
            warnings.push('GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY not set — falling back to GOOGLE_MAPS_API_KEY');
        }
        
        return { valid: true, warnings };
    }
};
```

**Change 2: Update `backend/server.js` startup validation (lines 47–52)**

```javascript
// BEFORE:
if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('❌ CRITICAL: GOOGLE_MAPS_API_KEY not found in environment variables');
    // ...
    process.exit(1);
}

// AFTER:
const apiKeys = require('./config/api-keys');
const keyValidation = apiKeys.validate();
if (!keyValidation.valid) {
    console.error('❌ CRITICAL: GOOGLE_MAPS_API_KEY not found in environment variables');
    console.error('📋 Make sure .env file exists in the project root directory (C:\\Voter\\.env)');
    console.error('📋 The .env file should contain: GOOGLE_MAPS_API_KEY=your_api_key_here');
    console.error('🛑 Server cannot start without Google Maps API key - exiting...');
    process.exit(1);
}
keyValidation.warnings.forEach(w => console.warn(`⚠️  ${w}`));
```

**Change 3: Update `backend/services/geocoding-service.js` (line 22)**

```javascript
// BEFORE:
this.apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;

// AFTER:
const apiKeys = require('../config/api-keys');
// ... (in constructor):
this.apiKey = apiKeys.geocodingApiKey;
```

**Change 4: Update `backend/services/distance-matrix-service.js` (lines 169–170)**

```javascript
// BEFORE:
this.apiKey = process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY || 
              process.env.GOOGLE_MAPS_GEOCODING_API_KEY;

// AFTER:
const apiKeys = require('../config/api-keys');
// ... (in constructor):
this.apiKey = apiKeys.distanceMatrixApiKey;
```

**Change 5: Update `backend/server.js` frontend config (line 172)**

```javascript
// BEFORE:
googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

// AFTER:
googleMapsApiKey: apiKeys.mapsApiKey,
```

### Risks & Edge Cases

- **Backwards compatible:** Users with only `GOOGLE_MAPS_API_KEY` set continue to work — all services fall back to it.
- **Users with separate keys:** Users who already set `GOOGLE_MAPS_GEOCODING_API_KEY` or `GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY` continue to work — per-service keys take precedence.
- **Warning messages:** The startup log now clearly shows which keys are using fallbacks, making configuration issues immediately visible.
- **No breaking change to `.env` format:** Existing `.env` files work as-is.

---

## M5: Middleware Ordering — SPA Catch-All Blocks API 404s

### Status: **ALREADY FIXED** (via H5)

### Verification

The H5 fix (marked as ✅ FIXED in the error audit) already resolves M5. The current code in `backend/server.js` lines 307–312 shows:

```javascript
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();   // ← API requests pass through to 404 handler
    }
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});
```

The 404 handler at lines 320–325 now correctly receives unmatched API GET requests:

```javascript
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});
```

### Conclusion

**No changes needed.** M5 is resolved. The SPA catch-all now correctly delegates API routes to the 404 handler via `next()`.

---

## Implementation Summary

| Issue | Files to Modify | Effort | New Files |
|-------|----------------|--------|-----------|
| **M1** | `backend/models/voter.js`, `frontend/public/js/route-planner-controller.js` | Low | None |
| **M2** | `scripts/setup.js`, `backend/services/import-processor.js`, `backend/routes/upload.js` | Medium | Optional migration |
| **M3** | `backend/parsers/dbf-parser.js` | Low | None |
| **M4** | `backend/config/api-keys.js` (new), `backend/server.js`, `backend/services/geocoding-service.js`, `backend/services/distance-matrix-service.js` | Medium | 1 new file |
| **M5** | None | None | None (already fixed) |

### Recommended Fix Order

1. **M5** — No work needed (already fixed)
2. **M1** — Quick one-line SQL fix + frontend fix. Unblocks correct route planning.
3. **M3** — Quick function replacement. Fixes data consistency for all future imports.
4. **M2** — Schema change + progress formula fix. Improves UX during imports.
5. **M4** — New config module + 3 file updates. Prevents silent API failures.

### Total Files Modified: 7 files + 1 new file

- `backend/models/voter.js` (M1)
- `frontend/public/js/route-planner-controller.js` (M1)
- `backend/parsers/dbf-parser.js` (M3)
- `backend/routes/upload.js` (M2)
- `backend/services/import-processor.js` (M2)
- `scripts/setup.js` (M2)
- `backend/config/api-keys.js` — NEW (M4)
- `backend/server.js` (M4)
- `backend/services/geocoding-service.js` (M4)
- `backend/services/distance-matrix-service.js` (M4)

---

**Spec file path:** `.github/docs/SubAgent docs/medium_severity_fix_spec.md`
