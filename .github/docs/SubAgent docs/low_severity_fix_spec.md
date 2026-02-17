# Low Severity Fix Specification

**Date:** 2026-02-16  
**Source:** Error Audit (`error_audit.md`)  
**Issues:** L1, L2, L3, L4, L5  

---

## Table of Contents

- [L1: Database Connection Check Redundancy](#l1-database-connection-check-redundancy)
- [L2: instanceof SparseDistanceMatrix Fragility](#l2-instanceof-sparsedistancematrix-fragility)
- [L3: Duplicate Sanitization Functions Across Parsers](#l3-duplicate-sanitization-functions-across-parsers)
- [L4: Foreign Key to Non-Existent users Table](#l4-foreign-key-to-non-existent-users-table)
- [L5: Error Handler Gap for Non-GET Unknown Routes](#l5-error-handler-gap-for-non-get-unknown-routes)

---

## L1: Database Connection Check Redundancy

### File
`backend/config/database.js`

### Problem
The `connect()` method resolves to `undefined`, meaning callers do `await database.connect()` and then use the singleton `database` directly for all queries. The `isConnected` flag is set but never checked before query execution. If a caller forgets to call `connect()`, queries silently fail with cryptic errors instead of reporting "not connected".

Additionally, multiple callers across the codebase (scripts, migrations, test files) must always remember to call `database.connect()` before using the database. There is no auto-connect or guard mechanism.

### Current Code

**`backend/config/database.js` — `connect()` method (lines 62–104):**
```javascript
async connect() {
    return new Promise((resolve, reject) => {
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.db = new sqlite3.Database(this.dbPath, async (err) => {
            if (err) {
                console.error('Database connection failed:', err.message);
                reject(err);
            } else {
                console.log('✅ Connected to SQLite database');
                this.isConnected = true;
                
                // Enable foreign keys
                this.db.run('PRAGMA foreign_keys = ON');
                
                // VALIDATION: Validate schema exists
                try {
                    const tables = await this.all(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    );
                    // ... schema validation ...
                    resolve();
                } catch (validationError) {
                    console.error('❌ Schema validation failed:', validationError);
                    reject(validationError);
                    return;
                }
                
                resolve();
            }
        });
    });
}
```

**`backend/config/database.js` — `run()`, `get()`, `all()` methods (lines 110–155):**
```javascript
run(sql, params = []) {
    return new Promise((resolve, reject) => {
        this.db.run(sql, params, function(err) {  // No connection check
            // ...
        });
    });
}
```

### Proposed Fix

1. Make `connect()` idempotent — if already connected, return immediately.
2. Add a private `_ensureConnected()` guard that throws a descriptive error if `this.db` is null.
3. Add the guard to `run()`, `get()`, and `all()`.
4. Make `connect()` return the database instance for method chaining (optional convenience).

**Changes to `backend/config/database.js`:**

```javascript
// CHANGE 1: Make connect() idempotent and return 'this' for chaining
async connect() {
    // Idempotent: if already connected, skip re-connection
    if (this.isConnected && this.db) {
        return this;
    }
    
    return new Promise((resolve, reject) => {
        // ... (existing implementation unchanged) ...
        // CHANGE: resolve(this) instead of resolve()
        //   At the end of the success path:
        resolve(this);  // was: resolve()
    });
}

// CHANGE 2: Add connection guard helper
_ensureConnected() {
    if (!this.db || !this.isConnected) {
        throw new Error(
            'Database not connected. Call await database.connect() before executing queries.'
        );
    }
}

// CHANGE 3: Add guard to run(), get(), all()
run(sql, params = []) {
    this._ensureConnected();
    return new Promise((resolve, reject) => {
        this.db.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ id: this.lastID, lastID: this.lastID, changes: this.changes });
            }
        });
    });
}

get(sql, params = []) {
    this._ensureConnected();
    return new Promise((resolve, reject) => {
        this.db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

all(sql, params = []) {
    this._ensureConnected();
    return new Promise((resolve, reject) => {
        this.db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}
```

### Risks & Side Effects
- **None** — adding a guard is purely additive. Existing callers already call `connect()` first.
- Idempotent `connect()` prevents accidental double-connection (e.g., if a script incorrectly calls connect twice).
- The `resolve(this)` change is backward-compatible because all callers use `await database.connect()` as a void call (they ignore the return value).

---

## L2: instanceof SparseDistanceMatrix Fragility

### File
`backend/services/route-optimizer-service.js` (lines 54–55)

### Problem
The `instanceof` check navigates through `this.distanceMatrixService.constructor.SparseDistanceMatrix`, which is fragile. The fallback `constructor.name === 'SparseDistanceMatrix'` breaks with minification. Both approaches are unreliable compared to a direct import or duck-typing.

### Current Code

**`backend/services/route-optimizer-service.js` (lines 1, 54–55):**
```javascript
const DistanceMatrixService = require('./distance-matrix-service');

// ... inside optimizeRoute() ...

// Check if we're using progressive mode
const isProgressive = distanceMatrix instanceof this.distanceMatrixService.constructor.SparseDistanceMatrix ||
                      distanceMatrix.constructor.name === 'SparseDistanceMatrix';
```

**`backend/services/distance-matrix-service.js` (lines 27, 643):**
```javascript
class SparseDistanceMatrix {
  // ...
}

module.exports = DistanceMatrixService;
module.exports.SparseDistanceMatrix = SparseDistanceMatrix;
```

### Proposed Fix

**Option A (RECOMMENDED): Import `SparseDistanceMatrix` directly**

Change the import in `route-optimizer-service.js` to destructure the named export, then use a simple `instanceof`:

**Changes to `backend/services/route-optimizer-service.js`:**

```javascript
// Line 17 — CHANGE import to also destructure SparseDistanceMatrix
const DistanceMatrixService = require('./distance-matrix-service');
const { SparseDistanceMatrix } = require('./distance-matrix-service');

// Lines 54-55 — CHANGE the instanceof check
const isProgressive = distanceMatrix instanceof SparseDistanceMatrix;
```

This is the cleanest approach:
- Single `instanceof` check against the directly imported class
- No fragile `constructor.name` string comparison
- No navigation through `this.distanceMatrixService.constructor`
- Works correctly with minification

### Risks & Side Effects
- **None** — `SparseDistanceMatrix` is already exported from `distance-matrix-service.js` via `module.exports.SparseDistanceMatrix = SparseDistanceMatrix;` (line 643). The import is safe.
- The `instanceof` check is the idiomatic JavaScript approach and works with the same module system (CommonJS) used throughout the project.

---

## L3: Duplicate Sanitization Functions Across Parsers

### Files
- `backend/parsers/csv-parser.js`
- `backend/parsers/dbf-parser.js`

### Problem
Four utility functions are duplicated across both parser files with identical (now that M3 is fixed) implementations:
1. `sanitizeText(value, maxLength)` — CSV lines 413–425, DBF lines 267–278
2. `sanitizeZipCode(value)` — CSV lines 457–473, DBF lines 286–302
3. `sanitizePrecinct(value)` — CSV lines 487–496, DBF lines 310–319
4. `sanitizeDate(value)` — CSV lines 506–555, DBF lines 328–377

This creates a maintenance burden: any fix to one copy must be manually replicated to the other.

### Current Code — Side-by-Side Comparison

**`sanitizeText` — csv-parser.js (lines 413–425):**
```javascript
function sanitizeText(value, maxLength = 255) {
    if (!value || value === null || value === undefined) {
        return '';
    }
    
    return value
        .toString()
        .trim()
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
        .substring(0, maxLength)
        .toUpperCase();
}
```

**`sanitizeText` — dbf-parser.js (lines 267–278):**
```javascript
function sanitizeText(value, maxLength = 255) {
    if (!value || value === null || value === undefined) {
        return '';
    }
    
    return value
        .toString()
        .trim()
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
        .substring(0, maxLength)
        .toUpperCase();
}
```

(Identical — same for `sanitizeZipCode`, `sanitizePrecinct`, and `sanitizeDate`)

### Proposed Fix

**Create `backend/parsers/parser-utils.js`** with the shared functions, then update both parsers to import from it.

#### Step 1: Create `backend/parsers/parser-utils.js`

```javascript
/**
 * Shared Parser Utilities
 * Common sanitization functions used by both CSV and DBF parsers.
 * Extracted to eliminate duplication and ensure consistent behavior.
 */

/**
 * Sanitize text fields - trim, uppercase, remove non-printable characters
 * @param {string|number|null|undefined} value - Text value to sanitize
 * @param {number} [maxLength=255] - Maximum length (characters will be truncated)
 * @returns {string} Sanitized text (uppercase, printable ASCII only) or empty string if input is null/undefined
 */
function sanitizeText(value, maxLength = 255) {
    if (!value || value === null || value === undefined) {
        return '';
    }
    
    return value
        .toString()
        .trim()
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
        .substring(0, maxLength)
        .toUpperCase();
}

/**
 * Sanitize and validate ZIP code format
 * Accepts 5-digit or ZIP+4 format (12345 or 12345-6789)
 * @param {string|number|null|undefined} value - ZIP code value
 * @returns {string} Sanitized ZIP code in valid format, or invalid string if format cannot be normalized
 */
function sanitizeZipCode(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim().replace(/[^0-9-]/g, '');
    
    // Validate format (5 digits or ZIP+4)
    if (!/^\d{5}(-\d{4})?$/.test(cleaned)) {
        // Try to extract just the 5-digit ZIP
        const match = cleaned.match(/(\d{5})/);
        if (match) {
            return match[1];
        }
        return cleaned; // Return as-is, will fail validation later
    }
    
    return cleaned;
}

/**
 * Sanitize precinct number — PRESERVE ORIGINAL FORMAT
 * Do NOT strip hyphens to preserve district-precinct format like "2-4"
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

/**
 * Sanitize and validate date of birth
 * Accepts ISO-8601 format (YYYY-MM-DD) and common US formats (MM/DD/YYYY)
 * Returns NULL for invalid dates to maintain data quality
 * @param {string|null|undefined} value - Date string to sanitize
 * @returns {string|null} ISO-8601 formatted date (YYYY-MM-DD) or null if invalid
 */
function sanitizeDate(value) {
    if (!value || value === null || value === undefined) {
        return null;
    }
    
    const cleaned = value.toString().trim();
    if (cleaned === '') {
        return null;
    }
    
    // Try parsing as-is (ISO-8601 format: YYYY-MM-DD)
    let parsedDate = new Date(cleaned);
    
    // Try parsing MM/DD/YYYY format (common in US data files)
    if (isNaN(parsedDate.getTime())) {
        const match = cleaned.match(/^(\d{1,2})[\/ \-](\d{1,2})[\/ \-](\d{4})$/);
        if (match) {
            const [, month, day, year] = match;
            parsedDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
        }
    }
    
    // Validate parsed date is a real date
    if (isNaN(parsedDate.getTime())) {
        console.warn(`Invalid date format: ${cleaned}`);
        return null;
    }
    
    // Check for future dates (birth date cannot be in the future)
    const today = new Date();
    if (parsedDate > today) {
        console.warn(`Future date of birth rejected: ${cleaned}`);
        return null;
    }
    
    // Check for unrealistic dates (before 1900)
    const minDate = new Date('1900-01-01');
    if (parsedDate < minDate) {
        console.warn(`Unrealistic date of birth (before 1900): ${cleaned}`);
    }
    
    // Return ISO-8601 format (YYYY-MM-DD)
    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const day = String(parsedDate.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

module.exports = {
    sanitizeText,
    sanitizeZipCode,
    sanitizePrecinct,
    sanitizeDate
};
```

#### Step 2: Update `backend/parsers/csv-parser.js`

Add import at top of file (after existing requires, around line 4):
```javascript
const { sanitizeText, sanitizeZipCode, sanitizePrecinct, sanitizeDate } = require('./parser-utils');
```

Delete the following local function definitions:
- `sanitizeText` (lines 413–425)
- `sanitizeZipCode` (lines 457–473)
- `sanitizePrecinct` (lines 487–496)
- `sanitizeDate` (lines 506–555)

**Keep** the `normalizeAddress` function (lines 435–455) — it's CSV-specific and NOT duplicated in the DBF parser.

#### Step 3: Update `backend/parsers/dbf-parser.js`

Add import at top of file (after existing requires, around line 6):
```javascript
const { sanitizeText, sanitizeZipCode, sanitizePrecinct, sanitizeDate } = require('./parser-utils');
```

Delete the following local function definitions:
- `sanitizeText` (lines 267–278)
- `sanitizeZipCode` (lines 286–302)
- `sanitizePrecinct` (lines 310–319)
- `sanitizeDate` (lines 328–377)

### Risks & Side Effects
- **Low risk** — the extracted functions are byte-for-byte identical after the M3 fix that already unified them.
- Both parsers call these functions in the same way (`sanitizeText(value)`, `sanitizeZipCode(value)`, etc.) so the interface is unchanged.
- The `normalizeAddress` function stays in `csv-parser.js` because it's only used there.
- No changes to module exports for either parser, so external callers are unaffected.

---

## L4: Foreign Key to Non-Existent `users` Table

### Files
- `backend/migrations/008_add_saved_routes.js` (line 19)
- `scripts/setup.js` (saved_routes section, around line 243)

### Problem
The `saved_routes` table declares `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`, but no `users` table exists anywhere in the codebase. SQLite doesn't enforce FK constraints by default (`PRAGMA foreign_keys` is OFF), so this hasn't caused runtime errors. However, `backend/config/database.js` line 82 runs `PRAGMA foreign_keys = ON`, which means FK enforcement IS active after the server's `connect()` method runs. This could cause INSERT failures if a non-null `user_id` is provided.

**Note:** The `setup-saved-routes-table.js` file at the project root already has the correct fix — it creates the table WITHOUT the FK constraint. The migration and setup.js are the only remaining files with the bad FK.

### Current Code

**`backend/migrations/008_add_saved_routes.js` (full file):**
```javascript
exports.up = function(db) {
  return db.run(`
    CREATE TABLE IF NOT EXISTS saved_routes (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      route_name TEXT,
      route_data JSON NOT NULL,
      travel_mode TEXT DEFAULT 'walking',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      accessed_at DATETIME,
      access_count INTEGER DEFAULT 0,
      expires_at DATETIME,
      is_public BOOLEAN DEFAULT 1,
      
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `).then(() => {
    // ... indexes ...
  });
};
```

**`scripts/setup.js` (around line 243):**
```sql
CREATE TABLE IF NOT EXISTS saved_routes (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    route_name TEXT,
    route_data JSON NOT NULL,
    travel_mode TEXT DEFAULT 'walking',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accessed_at DATETIME,
    access_count INTEGER DEFAULT 0,
    expires_at DATETIME,
    is_public BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

### Proposed Fix

Remove the `FOREIGN KEY` constraint line from both files. Keep `user_id INTEGER` as a plain column — it can still be used for user association when/if a `users` table is added in the future.

**Change 1 — `backend/migrations/008_add_saved_routes.js`:**

```javascript
exports.up = function(db) {
  return db.run(`
    CREATE TABLE IF NOT EXISTS saved_routes (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      route_name TEXT,
      route_data JSON NOT NULL,
      travel_mode TEXT DEFAULT 'walking',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      accessed_at DATETIME,
      access_count INTEGER DEFAULT 0,
      expires_at DATETIME,
      is_public BOOLEAN DEFAULT 1
    )
  `).then(() => {
    // ... indexes (unchanged) ...
  });
};
```

Key change: Remove the trailing comma after `is_public BOOLEAN DEFAULT 1,` and delete the `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL` line.

**Change 2 — `scripts/setup.js`:**

```sql
CREATE TABLE IF NOT EXISTS saved_routes (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    route_name TEXT,
    route_data JSON NOT NULL,
    travel_mode TEXT DEFAULT 'walking',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    accessed_at DATETIME,
    access_count INTEGER DEFAULT 0,
    expires_at DATETIME,
    is_public BOOLEAN DEFAULT 1
);
```

Same change: Remove trailing comma after `is_public` line and delete the FK line.

### Risks & Side Effects
- **None** — the FK was non-functional (references a non-existent table). Removing it eliminates a potential failure mode.
- `user_id` remains as a plain INTEGER column for future use.
- Existing data is unaffected — SQLite `CREATE TABLE IF NOT EXISTS` means the table won't be recreated if it already exists with data.
- The `setup-saved-routes-table.js` root script already has the correct schema (no FK), so it requires no changes.

---

## L5: Error Handler Gap for Non-GET Unknown Routes

### File
`backend/server.js`

### Problem
The SPA catch-all (around line 378) only handles GET requests:
```javascript
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});
```

This correctly passes unknown `/api/*` GET requests through to the 404 handler. But for completeness, the issue is about ensuring ALL HTTP methods for unknown `/api/*` routes get a consistent JSON 404 response.

Currently:
- `GET /api/nonexistent` → passes through SPA catch-all (path check) → reaches 404 handler ✅
- `POST /api/nonexistent` → skips SPA catch-all (not GET) → reaches 404 handler ✅
- `GET /nonexistent` → caught by SPA catch-all → serves index.html ✅ (correct SPA behavior)
- `POST /nonexistent` → skips SPA catch-all → reaches generic 404 handler → returns JSON ⚠️ (inconsistent with SPA behavior for non-API routes)

The issue is specifically about non-API routes with non-GET methods. A `POST /nonexistent` returns JSON `{"error": "Not Found"}` instead of what the SPA would handle. This is technically correct (a POST to a non-API non-existent URL SHOULD get a 404), but the fix should make the behavior more explicit.

### Current Code

**`backend/server.js` — SPA catch-all (around line 378):**
```javascript
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});
```

**`backend/server.js` — 404 handler (around line 388):**
```javascript
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});
```

### Proposed Fix

Add an explicit API 404 handler **before** the SPA catch-all to catch ALL HTTP methods for `/api/*` routes. This makes the routing intent crystal clear:

1. All `/api/*` routes (any method) that don't match a registered handler → JSON 404
2. All other GET routes → SPA (index.html)
3. All other non-GET routes → generic 404

**Changes to `backend/server.js`:**

Replace the SPA catch-all and 404 handler block with:

```javascript
// ============================================================================
// FRONTEND ROUTING
// ============================================================================

/**
 * API 404 handler — catch ALL methods for unmatched /api/* routes
 * Must come BEFORE the SPA catch-all to ensure API requests get JSON responses
 */
app.all('/api/*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `API route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});

/**
 * Serve index.html for all non-API GET routes (SPA support)
 */
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * 404 handler for non-GET requests to non-API routes
 */
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});
```

**Key improvements:**
1. `app.all('/api/*', ...)` explicitly catches any HTTP method to unmatched API paths → always returns JSON
2. The SPA catch-all no longer needs the `if (req.path.startsWith('/api/'))` guard — API routes are already handled above
3. The generic 404 handler catches any remaining unmatched routes (non-GET, non-API)

### Risks & Side Effects
- **Low risk** — the order of middleware matters, so the `app.all('/api/*')` handler MUST be placed after all `app.use('/api/...')` route mounts but before the SPA catch-all. This is the same position as the current SPA catch-all.
- The SPA catch-all `app.get('*')` can drop its `/api/` path check since API routes are handled first.
- The generic 404 `app.use(...)` now only catches non-GET requests to non-API paths, which is correct behavior.

---

## Implementation Order

| Order | Issue | File(s) | Effort | Dependencies |
|-------|-------|---------|--------|--------------|
| 1 | **L4** | `008_add_saved_routes.js`, `setup.js` | Trivial | None |
| 2 | **L2** | `route-optimizer-service.js` | Trivial | None |
| 3 | **L1** | `database.js` | Low | None |
| 4 | **L5** | `server.js` | Low | None |
| 5 | **L3** | `csv-parser.js`, `dbf-parser.js`, NEW `parser-utils.js` | Medium | None |

Rationale:
- L4 is a single-line deletion in two files — lowest risk, fastest to verify
- L2 is a one-line import + one-line change
- L1 adds safety guards — should be tested with a server restart
- L5 changes middleware ordering — needs manual route testing
- L3 introduces a new file and modifies two existing files — highest change surface, do last

---

## Validation Checklist

After implementation, verify:

- [ ] **L1**: Server starts successfully; scripts that call `database.connect()` still work; calling a query method without `connect()` throws a descriptive error
- [ ] **L2**: Route optimization still correctly detects progressive mode; `SparseDistanceMatrix` is importable from `distance-matrix-service.js`
- [ ] **L3**: Both CSV and DBF parsing produce identical sanitization results; `parser-utils.js` is correctly imported; no duplicate function definitions remain
- [ ] **L4**: `saved_routes` table creation succeeds without FK errors; `PRAGMA foreign_keys = ON` no longer causes issues
- [ ] **L5**: `GET /api/nonexistent` → JSON 404; `POST /api/nonexistent` → JSON 404; `GET /nonexistent` → index.html; `POST /nonexistent` → JSON 404
- [ ] **Overall**: `node -c backend/server.js` passes; `node -c backend/config/database.js` passes; `node -c backend/services/route-optimizer-service.js` passes; `node -c backend/parsers/csv-parser.js` passes; `node -c backend/parsers/dbf-parser.js` passes; server starts and serves API requests correctly
