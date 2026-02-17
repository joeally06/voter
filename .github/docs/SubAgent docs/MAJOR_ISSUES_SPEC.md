# Major Issues — Implementation Specification

**Date:** February 16, 2026  
**Scope:** MAJ-01, MAJ-03, MAJ-04, MAJ-05, MAJ-06  
**Reference:** `.github/docs/COMPREHENSIVE_ISSUE_PLAN.md`

---

## Table of Contents

1. [MAJ-01: Voter Data Field Name Mismatch](#maj-01-voter-data-field-name-mismatch)
2. [MAJ-03: Service Worker May Cache Stale JavaScript](#maj-03-service-worker-may-cache-stale-javascript)
3. [MAJ-04: Database getStats() — Missing Table Resilience](#maj-04-database-getstats--missing-table-resilience)
4. [MAJ-05: Rate Limiter Blocks Rapid Filter Changes](#maj-05-rate-limiter-blocks-rapid-filter-changes)
5. [MAJ-06: Geocoding — State Column Not Consistently Used](#maj-06-geocoding--state-column-not-consistently-used)
6. [Priority Order](#priority-order)

---

## MAJ-01: Voter Data Field Name Mismatch

### Analysis

**Backend returns camelCase.** Every SQL query in `backend/models/voter.js` uses `AS` aliases to convert snake_case DB columns to camelCase:

| DB Column | API Field | Source Lines |
|-----------|-----------|-------------|
| `last_name` | `lastName` | `voter.js` L152, L325 |
| `first_name` | `firstName` | `voter.js` L153, L326 |
| `zip_code` | `zipCode` | `voter.js` L158, L330 |
| `precinct_number` | `precinctNumber` | `voter.js` L159, L331 |
| `voter_id` | `voterId` | `voter.js` L151, L324 |
| `super_voter` | `superVoter` | `voter.js` L165, L337 |
| `date_of_birth` | `dateOfBirth` | `voter.js` L160, L332 |

The `never-voted.js` route also returns camelCase (`lastName`, `firstName`) at lines 181-182.

**Conclusion:** The backend consistently returns **camelCase**. All snake_case fallbacks in the frontend are unnecessary dead code.

### Files With Issues

#### File 1: `frontend/public/js/map-controller.js`

**Issue A — Line 246:** Fallback pattern for marker title
```javascript
// CURRENT (line 246):
title: `${voter.firstName || voter.first_name} ${voter.lastName || voter.last_name}`,

// PROPOSED:
title: `${voter.firstName} ${voter.lastName}`,
```

**Issue B — Line 297:** Fallback for super voter check
```javascript
// CURRENT (line 297):
const isSuperVoter = voter.superVoter || voter.super_voter || voter.is_super_voter;

// PROPOSED:
const isSuperVoter = voter.superVoter;
```

**Issue C — Lines 333-338:** Fallbacks in `showVoterInfo()`
```javascript
// CURRENT (lines 333-338):
const firstName = Utils.escapeHtml(voter.firstName || voter.first_name || '');
const lastName = Utils.escapeHtml(voter.lastName || voter.last_name || '');
const address = Utils.escapeHtml(voter.address || 'N/A');
const city = Utils.escapeHtml(voter.city || '');
const zipCode = Utils.escapeHtml(voter.zipCode || voter.zip_code || '');
const precinctNumber = Utils.escapeHtml(voter.precinctNumber || voter.precinct_number || 'N/A');

// PROPOSED (lines 333-338):
const firstName = Utils.escapeHtml(voter.firstName || '');
const lastName = Utils.escapeHtml(voter.lastName || '');
const address = Utils.escapeHtml(voter.address || 'N/A');
const city = Utils.escapeHtml(voter.city || '');
const zipCode = Utils.escapeHtml(voter.zipCode || '');
const precinctNumber = Utils.escapeHtml(voter.precinctNumber || 'N/A');
```

**Issue D — Line 354:** Duplicate super voter fallback
```javascript
// CURRENT (line 354):
const isSuperVoter = voter.superVoter || voter.super_voter || voter.is_super_voter;

// PROPOSED:
const isSuperVoter = voter.superVoter;
```

#### File 2: `frontend/public/js/route-planner-controller.js`

**Issue E — Line 160:** voterId fallback
```javascript
// CURRENT (line 160):
const voterId = voter.voterId || voter.voter_id;

// PROPOSED:
const voterId = voter.voterId;
```

**Issue F — Line 342:** voterId fallback (duplicate)
```javascript
// CURRENT (line 342):
const voterId = voter.voterId || voter.voter_id;

// PROPOSED:
const voterId = voter.voterId;
```

**Issue G — Line 344:** super voter fallback
```javascript
// CURRENT (line 344):
const isSuperVoter = voter.superVoter || voter.super_voter || voter.is_super_voter;

// PROPOSED:
const isSuperVoter = voter.superVoter;
```

**Issue H — Line 365:** precinctNumber fallback
```javascript
// CURRENT (line 365):
Precinct ${this.escapeHtml((voter.precinctNumber || voter.precinct_number || 'N/A').toString())}

// PROPOSED:
Precinct ${this.escapeHtml((voter.precinctNumber || 'N/A').toString())}
```

#### File 3: `frontend/public/js/map-controller.js` — Line 194, 212

**Issue I — Line 194:** voterId fallback
```javascript
// CURRENT (line 194):
return (voter.voterId || voter.voter_id) === voterId;

// PROPOSED:
return voter.voterId === voterId;
```

**Issue J — Line 212:** voterId fallback
```javascript
// CURRENT (line 212):
const voterId = voter.voterId || voter.voter_id;

// PROPOSED:
const voterId = voter.voterId;
```

#### Files That Are Already Correct (camelCase only)

- `frontend/public/js/voter-list-controller.js` — Uses `voter.lastName`, `voter.firstName`, `voter.address`, `voter.city`, `voter.zipCode`, `voter.precinctNumber`, `voter.superVoter`, `voter.voterId`, `voter.mostRecentParty`, `voter.participationRate`, `voter.electionsVoted`, `voter.totalElections` throughout (lines 444, 451-452, 458, 465, 471, 478, 490, 591-595, 600, 604-605, 612, 618). **No changes needed.**
- `frontend/public/js/target-list-controller.js` — Uses `voter.lastName`, `voter.firstName`, `voter.address`, `voter.city`, `voter.precinctNumber`, `voter.zipCode` (lines 212-217). **No changes needed.**

### Summary of MAJ-01 Changes

| File | Lines | Change |
|------|-------|--------|
| `frontend/public/js/map-controller.js` | 194 | Remove `voter.voter_id` fallback |
| `frontend/public/js/map-controller.js` | 212 | Remove `voter.voter_id` fallback |
| `frontend/public/js/map-controller.js` | 246 | Remove `voter.first_name` and `voter.last_name` fallbacks |
| `frontend/public/js/map-controller.js` | 297 | Remove `voter.super_voter` and `voter.is_super_voter` fallbacks |
| `frontend/public/js/map-controller.js` | 333-334 | Remove `voter.first_name` and `voter.last_name` fallbacks |
| `frontend/public/js/map-controller.js` | 337-338 | Remove `voter.zip_code` and `voter.precinct_number` fallbacks |
| `frontend/public/js/map-controller.js` | 354 | Remove `voter.super_voter` and `voter.is_super_voter` fallbacks |
| `frontend/public/js/route-planner-controller.js` | 160 | Remove `voter.voter_id` fallback |
| `frontend/public/js/route-planner-controller.js` | 342 | Remove `voter.voter_id` fallback |
| `frontend/public/js/route-planner-controller.js` | 344 | Remove `voter.super_voter` and `voter.is_super_voter` fallbacks |
| `frontend/public/js/route-planner-controller.js` | 365 | Remove `voter.precinct_number` fallback |

**Total: 11 line-level changes across 2 files.**

---

## MAJ-03: Service Worker May Cache Stale JavaScript

### Analysis

**File:** `frontend/public/sw.js`

**Current Caching Strategy:**
- **API calls** (`/api/*`): Network-first with cache fallback (line 82) — **CORRECT**
- **Navigation/HTML**: Network-first with cache fallback (line 88) — **CORRECT**
- **Static assets (CSS, JS, images)**: **Cache-first** with network fallback (line 93) — **PROBLEMATIC**

The service worker pre-caches all JS files during install (lines 13-34 in `STATIC_ASSETS` array). Once cached, the `cacheFirstWithNetwork()` strategy at line 93 serves the cached version forever — new deployments won't reach users until:
1. The `CACHE_NAME` version string is changed (currently `'voter-platform-v2-20260215'`), AND
2. The user's browser re-registers the service worker

**The Problem:**
- JS and CSS files use cache-first strategy (line 93: `event.respondWith(cacheFirstWithNetwork(event.request))`)
- Even if the server has updated JS files, users get stale cached versions
- The `CACHE_NAME` version bump mechanism requires manual intervention on every deploy

### Proposed Fix

Change JS and CSS files to use **network-first** strategy (like API calls already do), while keeping images/fonts on cache-first for performance.

**File:** `frontend/public/sw.js`

```javascript
// CURRENT (lines 80-94):
// Fetch: strategy depends on request type
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests (CDN libraries, Google Maps, etc.)
    if (url.origin !== self.location.origin) return;

    // API calls: network-first with cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // Navigation/HTML: network-first with cache fallback
    if (event.request.mode === 'navigate' || event.request.headers.get('accept').indexOf('text/html') !== -1) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // Static assets (CSS, JS, images): cache-first with network fallback
    event.respondWith(cacheFirstWithNetwork(event.request));
});

// PROPOSED (lines 80-100):
// Fetch: strategy depends on request type
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip cross-origin requests (CDN libraries, Google Maps, etc.)
    if (url.origin !== self.location.origin) return;

    // API calls: network-first with cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // Navigation/HTML: network-first with cache fallback
    if (event.request.mode === 'navigate' || event.request.headers.get('accept').indexOf('text/html') !== -1) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // JS and CSS files: network-first to ensure latest code is always served
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        event.respondWith(networkFirstWithCache(event.request));
        return;
    }

    // Other static assets (images, fonts, manifest): cache-first with network fallback
    event.respondWith(cacheFirstWithNetwork(event.request));
});
```

### Summary of MAJ-03 Changes

| File | Lines | Change |
|------|-------|--------|
| `frontend/public/sw.js` | 93 (before final `respondWith`) | Add JS/CSS network-first check block before the cache-first fallback |

**Total: 1 insertion (5 lines) in 1 file.**

---

## MAJ-04: Database getStats() — Missing Table Resilience

### Analysis

**File:** `backend/config/database.js`, lines 260-282

**Current code:**
```javascript
async getStats() {
    try {
        const voterCount = await this.get('SELECT COUNT(*) as count FROM voters');
        const geocodedCount = await this.get('SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL');
        const precinctCount = await this.get('SELECT COUNT(*) as count FROM precincts');
        const cacheSize = await this.get('SELECT COUNT(*) as count FROM geocoding_cache');
        const superVoterCount = await this.get('SELECT COUNT(*) as count FROM voters WHERE super_voter = 1');

        return {
            totalVoters: voterCount.count,
            geocodedVoters: geocodedCount.count,
            totalPrecincts: precinctCount.count,
            superVoters: superVoterCount.count,
            cacheSize: cacheSize.count,
            geocodingProgress: voterCount.count > 0 ? (geocodedCount.count / voterCount.count * 100).toFixed(1) : 0
        };
    } catch (error) {
        console.error('Error getting database stats:', error);
        return null;
    }
}
```

**Problem:** If ANY table doesn't exist (e.g., `precincts` or `geocoding_cache` not created because migrations haven't run), the entire method throws and returns `null`. The outer try/catch catches the error, but all stats are lost.

**Callers:**

1. **`backend/server.js` line 146** — Startup initialization:
```javascript
const stats = await database.getStats();
console.log('📊 Database Stats:', stats);
```
If `stats` is `null`, it just prints `null` — no crash, but no useful info either.

2. **`backend/server.js` line 275** — Health check endpoint:
```javascript
const stats = await database.getStats();
res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: stats,
    uptime: process.uptime()
});
```
If `stats` is `null`, the health endpoint reports `database: null` but still says `status: 'healthy'` — misleading.

### Proposed Fix

Wrap each individual query in try/catch to return partial stats instead of nothing.

**File:** `backend/config/database.js`

```javascript
// CURRENT (lines 260-282):
async getStats() {
    try {
        const voterCount = await this.get('SELECT COUNT(*) as count FROM voters');
        const geocodedCount = await this.get('SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL');
        const precinctCount = await this.get('SELECT COUNT(*) as count FROM precincts');
        const cacheSize = await this.get('SELECT COUNT(*) as count FROM geocoding_cache');
        // CRITICAL FIX: Added super_voter count query as required by frontend health status
        const superVoterCount = await this.get('SELECT COUNT(*) as count FROM voters WHERE super_voter = 1');

        return {
            totalVoters: voterCount.count,
            geocodedVoters: geocodedCount.count,
            totalPrecincts: precinctCount.count,
            superVoters: superVoterCount.count,  // CRITICAL FIX: Added missing field
            cacheSize: cacheSize.count,
            geocodingProgress: voterCount.count > 0 ? (geocodedCount.count / voterCount.count * 100).toFixed(1) : 0
        };
    } catch (error) {
        console.error('Error getting database stats:', error);
        return null;
    }
}

// PROPOSED (lines 260-298):
async getStats() {
    const safeCount = async (query, label) => {
        try {
            const result = await this.get(query);
            return result?.count ?? 0;
        } catch (error) {
            console.warn(`⚠️ getStats: Failed to query ${label}:`, error.message);
            return 0;
        }
    };

    try {
        const totalVoters = await safeCount('SELECT COUNT(*) as count FROM voters', 'voters');
        const geocodedVoters = await safeCount('SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL', 'geocoded voters');
        const totalPrecincts = await safeCount('SELECT COUNT(*) as count FROM precincts', 'precincts');
        const cacheSize = await safeCount('SELECT COUNT(*) as count FROM geocoding_cache', 'geocoding cache');
        const superVoters = await safeCount('SELECT COUNT(*) as count FROM voters WHERE super_voter = 1', 'super voters');

        return {
            totalVoters,
            geocodedVoters,
            totalPrecincts,
            superVoters,
            cacheSize,
            geocodingProgress: totalVoters > 0 ? (geocodedVoters / totalVoters * 100).toFixed(1) : 0
        };
    } catch (error) {
        console.error('Error getting database stats:', error);
        return null;
    }
}
```

Additionally, fix the health endpoint to handle null stats properly:

**File:** `backend/server.js`

```javascript
// CURRENT (lines 273-289):
app.get('/api/health', async (req, res) => {
    try {
        const stats = await database.getStats();
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: stats,
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// PROPOSED (lines 273-290):
app.get('/api/health', async (req, res) => {
    try {
        const stats = await database.getStats();
        res.json({
            status: stats ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            database: stats || { error: 'Unable to retrieve database statistics' },
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});
```

### Summary of MAJ-04 Changes

| File | Lines | Change |
|------|-------|--------|
| `backend/config/database.js` | 260-282 | Replace `getStats()` with `safeCount()` wrapper pattern |
| `backend/server.js` | 276-279 | Handle null stats in health endpoint (status: 'degraded') |

**Total: 2 changes across 2 files.**

---

## MAJ-05: Rate Limiter Blocks Rapid Filter Changes

### Analysis

**File:** `backend/server.js`, lines 89-99

**Current Configuration:**
```javascript
// Line 90-96:
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Line 99:
app.use('/api/', apiLimiter);
```

**The Problem:**
- **100 requests per 15 minutes** for ALL `/api/` routes, including read-only GET requests
- A user typing in the search box triggers a debounced API call (~300ms debounce). Rapid filter combinations (precinct dropdown + name search + checkbox) can generate 5-10 requests per second
- The `/api/voters` endpoint is hit on every filter change, page change, and initial load
- A user actively filtering the voter list can easily exhaust 100 requests in 2-3 minutes
- Result: 429 "Too Many Requests" errors that break the UI

**Upload endpoint** already has a smart `skip` function (lines 104-112) that exempts GET requests:
```javascript
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    skip: (req, res) => {
        return req.method === 'GET';
    }
});
```

### Proposed Fix

Apply rate limiting only to mutation endpoints (POST/PUT/DELETE) on the general limiter, and increase the GET-specific limit significantly. Use a two-tier approach:

**File:** `backend/server.js`

```javascript
// CURRENT (lines 89-99):
// SECURITY ENHANCEMENT: Rate limiting to prevent API abuse and DoS attacks
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// PROPOSED (lines 89-111):
// SECURITY ENHANCEMENT: Rate limiting to prevent API abuse and DoS attacks
// Read-only (GET) requests get a higher limit since filtering/pagination is read-heavy
const apiReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Higher limit for read-only requests (filtering, pagination, searching)
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'GET', // Only apply to GET requests
});

// Mutation (POST/PUT/DELETE) requests get a stricter limit
const apiWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Strict limit for mutations
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'GET', // Only apply to non-GET requests
});

// Apply both limiters to API routes
app.use('/api/', apiReadLimiter);
app.use('/api/', apiWriteLimiter);
```

### Summary of MAJ-05 Changes

| File | Lines | Change |
|------|-------|--------|
| `backend/server.js` | 89-99 | Replace single `apiLimiter` with `apiReadLimiter` (1000 req/15min GET) and `apiWriteLimiter` (100 req/15min POST/PUT/DELETE) |

**Total: 1 change in 1 file (replace 10 lines with 20 lines).**

---

## MAJ-06: Geocoding — State Column Not Consistently Used

### Analysis

**The Chain of Data:**

1. **CSV Parser** (`backend/parsers/csv-parser.js` line 238):
   - ✅ Parses `state` field from CSV: `state: sanitizeText(normalizedFields.state)`
   - ✅ Has field mappings for `'state'`, `'st'`, `'mailstate'` → `'state'` (lines 210-212)

2. **Import Processor** (`backend/services/import-processor.js`):
   - ⚠️ `validateVoter()` (lines 207-276) does NOT include `state` in `requiredFields` array (line 220)
   - The `state` field is passed through but not validated

3. **Voter Model** (`backend/models/voter.js` lines 28-31):
   - ✅ `create()` includes `state` in the fields list (line 31): `'state'`
   - ✅ Stores `state` to DB when provided

4. **Database Migration** (`backend/migrations/007_add_state_column.js`):
   - ✅ Column exists with `DEFAULT 'TN'`
   - ✅ All existing records set to 'TN'

5. **Geocoding Job Service** (`backend/services/geocoding-job-service.js`):
   - Lines 148-149: Fetches `state` column from voters table: `SELECT id, voter_id, address, city, state, zip_code, latitude FROM voters`
   - Line 175: `voter.state || 'TN'` — for cache lookup
   - Line 191: `const state = voter.state || 'TN';` — for API geocoding
   - Line 211: `voter.state || 'TN'` — for caching result

**The Problem:**
The state column is properly parsed, stored, and fetched. The `|| 'TN'` fallbacks are defensive coding for legacy records that might not have the `state` column populated. Since migration 007 backfills all existing records with `'TN'`, and new imports parse `state` from CSV, the fallback is **mostly harmless** for the current Tennessee-only dataset.

However, if voters from other states are imported in the future, there are TWO issues:
1. The `state` field is **not validated** during import — a record with missing `state` would get stored as `NULL`, and the geocoding would silently fall back to `'TN'`
2. The `DEFAULT 'TN'` in the migration means any INSERT without an explicit `state` value gets `'TN'`

### Proposed Fix

**Fix 1:** Add state validation in import-processor to warn when state is missing (not a hard requirement since all current data is TN)

**File:** `backend/services/import-processor.js`

```javascript
// CURRENT (lines 218-226):
    // Required fields
    const requiredFields = [
        'voter_id',
        'last_name',
        'first_name',
        'address',
        'city',
        'zip_code',
        'precinct_number'
    ];

// PROPOSED (lines 218-227):
    // Required fields
    const requiredFields = [
        'voter_id',
        'last_name',
        'first_name',
        'address',
        'city',
        'zip_code',
        'precinct_number',
        'state'
    ];
```

**Fix 2:** Improve the geocoding fallback to log a warning when using the default

**File:** `backend/services/geocoding-job-service.js`

```javascript
// CURRENT (line 191):
              const state = voter.state || 'TN';

// PROPOSED (line 191):
              const state = voter.state || 'TN';
              if (!voter.state) {
                console.warn(`⚠️ Voter ${voter.id} missing state — defaulting to 'TN'`);
              }
```

**Fix 3:** Update the migration default value comment to make the assumption explicit

No code change needed — this is a documentation note. The `DEFAULT 'TN'` in migration 007 is correct for the current dataset but should be revisited if multi-state support is added.

### Summary of MAJ-06 Changes

| File | Lines | Change |
|------|-------|--------|
| `backend/services/import-processor.js` | 218-226 | Add `'state'` to required fields array |
| `backend/services/geocoding-job-service.js` | 191 | Add warning log when state fallback is used |

**Total: 2 changes across 2 files.**

---

## Priority Order

Based on user impact and risk:

| Priority | Issue | Est. Time | Rationale |
|----------|-------|-----------|-----------|
| **1** | **MAJ-05** Rate Limiter | 15 min | Users actively hitting 429 errors when filtering — breaks core workflow |
| **2** | **MAJ-01** Field Name Mismatch | 30 min | Can cause undefined values displayed in map markers and route planner |
| **3** | **MAJ-04** getStats() Resilience | 20 min | Prevents misleading health checks and startup failures on fresh DBs |
| **4** | **MAJ-03** Service Worker Cache | 15 min | Users get stale JS after every deploy — ongoing operational pain |
| **5** | **MAJ-06** State Column | 10 min | Low risk for current TN-only dataset; important for multi-state future |

**Total estimated effort:** ~1.5 hours

---

## Complete Change Manifest

| # | File | Type | Lines |
|---|------|------|-------|
| 1 | `frontend/public/js/map-controller.js` | Edit | 194, 212, 246, 297, 333-334, 337-338, 354 |
| 2 | `frontend/public/js/route-planner-controller.js` | Edit | 160, 342, 344, 365 |
| 3 | `frontend/public/sw.js` | Edit | Insert before line 93 |
| 4 | `backend/config/database.js` | Edit | 260-282 (rewrite `getStats()`) |
| 5 | `backend/server.js` | Edit | 89-99 (rate limiter), 276-279 (health status) |
| 6 | `backend/services/import-processor.js` | Edit | 218-226 (add state to required fields) |
| 7 | `backend/services/geocoding-job-service.js` | Edit | 191 (add state fallback warning) |

**Total: 7 files, ~20 individual line changes.**
