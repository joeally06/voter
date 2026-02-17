# High Severity Fix Specification

**Created:** 2026-02-16  
**Status:** Ready for Implementation  
**Scope:** 5 high-severity issues (H1–H5)

---

## H1: Missing Columns in `setup.js` Schema

### Problem
The `voters` table CREATE TABLE in [scripts/setup.js](scripts/setup.js#L53-L67) is missing two columns that were added by later migrations:
- `date_of_birth TEXT DEFAULT NULL` — added by migration 004
- `state TEXT DEFAULT 'TN'` — added by migration 007

A fresh `npm run setup` creates a voters table without these columns, causing runtime errors in code that references them (e.g., age-based analytics, state filtering).

### Current Code (setup.js lines 53–67)
```javascript
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
```

### Replacement Code
```javascript
CREATE TABLE IF NOT EXISTS voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT UNIQUE,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    precinct_number TEXT NOT NULL,
    date_of_birth TEXT DEFAULT NULL,
    state TEXT DEFAULT 'TN',
    latitude REAL,
    longitude REAL,
    geocoding_quality TEXT,
    super_voter BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Additional Index
Add after the existing index block (after line 128):
```sql
CREATE INDEX IF NOT EXISTS idx_voters_dob ON voters(date_of_birth);
```

### Dependencies
- Migration 004 (`backend/migrations/004_add_date_of_birth.js`) — defines `date_of_birth` as TEXT DEFAULT NULL
- Migration 007 (`backend/migrations/007_add_state_column.js`) — defines `state` as TEXT DEFAULT 'TN'

---

## H2: Missing Migration Tables in `setup.js`

### Problem
Six tables created by migrations 003, 006, and 008 are **not** present in [scripts/setup.js](scripts/setup.js). A fresh setup requires running all migrations manually afterward or the app will crash when accessing geocoding, route planning, or saved-route features.

**Tables present in setup.js:** `voters`, `election_history`, `precincts`, `geocoding_cache`, `import_logs`, `import_errors`

**Tables missing from setup.js:**

| Table | Source Migration | Purpose |
|-------|-----------------|---------|
| `geocoding_jobs` | 003 | Batch geocoding job tracking |
| `geocoding_errors` | 003 | Failed geocoding attempts log |
| `api_quotas` | 003 | Daily API usage monitoring |
| `route_cache` | 006 | Distance/duration caching |
| `api_usage` | 006 | API quota usage tracking |
| `saved_routes` | 008 | Route sharing & persistence |

### Replacement Code
Insert the following SQL **after** the `import_errors` table definition (after line 124) and **before** the existing CREATE INDEX statements (line 127):

```sql
-- Geocoding job tracking table (Migration 003)
CREATE TABLE IF NOT EXISTS geocoding_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'PENDING',
    total_records INTEGER NOT NULL,
    processed_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    api_calls INTEGER DEFAULT 0,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    estimated_completion DATETIME,
    last_processed_id INTEGER,
    options TEXT,
    created_by TEXT,
    error_message TEXT
);

-- Geocoding errors table (Migration 003)
CREATE TABLE IF NOT EXISTS geocoding_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    voter_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    city TEXT,
    zip_code TEXT,
    error_type TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES geocoding_jobs(id),
    FOREIGN KEY (voter_id) REFERENCES voters(id)
);

-- API quotas table (Migration 003)
CREATE TABLE IF NOT EXISTS api_quotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    service TEXT NOT NULL,
    request_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, service)
);

-- Route cache table (Migration 006)
CREATE TABLE IF NOT EXISTS route_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_lat REAL NOT NULL,
    origin_lng REAL NOT NULL,
    destination_lat REAL NOT NULL,
    destination_lng REAL NOT NULL,
    route_hash TEXT UNIQUE NOT NULL,
    travel_mode TEXT NOT NULL,
    distance_meters INTEGER,
    duration_seconds INTEGER,
    duration_in_traffic_seconds INTEGER,
    api_status TEXT,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    UNIQUE(origin_lat, origin_lng, destination_lat, destination_lng, travel_mode)
);

-- API usage table (Migration 006)
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_name TEXT NOT NULL,
    call_date DATE NOT NULL,
    call_count INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    quota_remaining INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(api_name, call_date)
);

-- Saved routes table (Migration 008)
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

### Additional Indexes
Add after the existing indexes (after the `idx_import_errors_import` index):

```sql
CREATE INDEX IF NOT EXISTS idx_geocoding_jobs_status ON geocoding_jobs(status);
CREATE INDEX IF NOT EXISTS idx_geocoding_errors_job ON geocoding_errors(job_id);
CREATE INDEX IF NOT EXISTS idx_geocoding_errors_type ON geocoding_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_geocoding_errors_voter ON geocoding_errors(voter_id);
CREATE INDEX IF NOT EXISTS idx_quotas_date ON api_quotas(date, service);
CREATE INDEX IF NOT EXISTS idx_route_hash ON route_cache(route_hash);
CREATE INDEX IF NOT EXISTS idx_route_expires ON route_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage(api_name, call_date);
CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_routes_created ON saved_routes(created_at);
CREATE INDEX IF NOT EXISTS idx_saved_routes_expires ON saved_routes(expires_at);
```

### Dependencies
- Migration 003 (`backend/migrations/003_add_geocoding_tables.js`)
- Migration 006 (`backend/migrations/006_add_route_planning_tables.js`)
- Migration 008 (`backend/migrations/008_add_saved_routes.js`)

---

## H3: Hardcoded Voter Count `2677`

### Problem
In [backend/models/voter.js line 617](backend/models/voter.js#L617), the total voter count is hardcoded as `2677`:
```javascript
console.log(`✅ ${count.total} voters marked as super voters (${Math.round(count.total / 2677 * 100)}% of total)`);
```
This produces incorrect percentages when the voter count changes. The total should be queried dynamically.

### Current Code (voter.js lines 612–618)
```javascript
        // Count how many are now super voters
        const count = await database.get(
            'SELECT COUNT(*) as total FROM voters WHERE super_voter = 1'
        );
        
        console.log(`✅ ${count.total} voters marked as super voters (${Math.round(count.total / 2677 * 100)}% of total)`);
        return count.total;
```

### Replacement Code
```javascript
        // Count how many are now super voters
        const count = await database.get(
            'SELECT COUNT(*) as total FROM voters WHERE super_voter = 1'
        );
        
        const totalVoters = await database.get(
            'SELECT COUNT(*) as total FROM voters'
        );
        const pct = totalVoters.total > 0 ? Math.round(count.total / totalVoters.total * 100) : 0;
        console.log(`✅ ${count.total} voters marked as super voters (${pct}% of ${totalVoters.total} total)`);
        return count.total;
```

### Dependencies
- None beyond the existing `database` instance already in scope.

---

## H4: Truncated JSDoc Comment

### Problem
In [backend/routes/analytics.js line 69](backend/routes/analytics.js#L69), the JSDoc block for the turnout endpoint is malformed — the route definition is missing and the opening line reads `/** with comparative analysis` instead of documenting the route:

```javascript
/** with comparative analysis
 * 
 * Query parameters:
```

This appears to be a truncated/corrupted version of `/** GET /api/analytics/turnout - Get election turnout statistics with comparative analysis`.

### Current Code (analytics.js lines 69–70)
```javascript
/** with comparative analysis
 * 
```

### Replacement Code
```javascript
/**
 * GET /api/analytics/turnout - Get election turnout statistics with comparative analysis
 *
```

### Dependencies
- None. Pure documentation fix.

---

## H5: SPA Catch-All Before 404 Handler

### Problem
In [backend/server.js lines 306–323](backend/server.js#L306-L323), the SPA catch-all route `app.get('*', ...)` is registered **before** the 404 handler. Because `app.get('*')` matches every GET request not already handled (including undefined `/api/*` paths), the 404 JSON handler on line 318 can **never** be reached for GET requests. Any GET to a non-existent API endpoint (e.g., `GET /api/nonexistent`) returns `index.html` with status 200 instead of a proper 404 JSON response.

### Current Code (server.js lines 305–323)
```javascript
/**
 * Serve index.html for all non-API routes (SPA support)
 */
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * 404 handler for undefined routes
 */
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});
```

### Replacement Code
```javascript
/**
 * Serve index.html for all non-API routes (SPA support)
 * API routes that fall through are passed to the 404 handler below.
 */
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * 404 handler for undefined routes
 */
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString()
    });
});
```

### Key Change
- The catch-all now calls `next()` for any path starting with `/api/`, letting it fall through to the 404 handler.
- Non-API GET requests still receive `index.html` (standard SPA behavior).

### Dependencies
- None. The `next` parameter is already available via Express middleware convention.

---

## Implementation Plan

### Order of Operations
All five fixes are independent; they can be applied in any order. Suggested sequence:

1. **H1 + H2** — both in `scripts/setup.js`, apply together in one edit pass
2. **H3** — `backend/models/voter.js` (line ~617)
3. **H4** — `backend/routes/analytics.js` (line ~69)
4. **H5** — `backend/server.js` (lines ~305–323)

### Validation Steps
After implementation:
1. `node -c scripts/setup.js` — syntax check
2. `node -c backend/models/voter.js` — syntax check
3. `node -c backend/routes/analytics.js` — syntax check
4. `node -c backend/server.js` — syntax check
5. Start server: `node backend/server.js` — verify no startup crash
6. Test undefined API route: `curl http://localhost:3000/api/nonexistent` — should return 404 JSON
7. Test SPA route: `curl http://localhost:3000/some-page` — should return index.html

### Risk Assessment
| Fix | Risk | Notes |
|-----|------|-------|
| H1 | Low | Only affects fresh setups; existing DBs already have columns via migrations |
| H2 | Low | Only affects fresh setups; `CREATE TABLE IF NOT EXISTS` is idempotent |
| H3 | Low | Adds one extra DB query; negligible performance impact |
| H4 | None | Pure documentation fix |
| H5 | Low | Must ensure `/api/` prefix check is correct; all API routes use `/api/` prefix |
