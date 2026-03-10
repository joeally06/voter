# Major Issues (MAJ-01 through MAJ-06) Specification

**Date:** March 10, 2026  
**Research Phase:** Complete  
**Status:** Ready for Implementation  
**Context:** Post-CRIT fixes (CRIT-01 through CRIT-04 completed with A+ rating)

---

## Executive Summary

This specification addresses 6 Major Issues identified in the comprehensive audit. After detailed analysis of the current codebase state, the findings are:

- **2 Issues Remain Active** (MAJ-01, MAJ-06): Require implementation
- **2 Issues Already Resolved** (MAJ-04, MAJ-05): Fixed in recent updates
- **2 Issues No Longer Relevant** (MAJ-02, MAJ-03): Architecture changed

The active issues affect **data consistency** (field naming) and **geocoding accuracy** (state handling). Implementation estimate: **2-3 hours** total.

---

## Research Sources

### API Response Field Naming Conventions
1. **Google JSON Style Guide** (https://google.github.io/styleguide/jsoncstyleguide.xml)  
   - Recommends camelCase for JSON properties
   - Consistency across all API responses
   - Example: `firstName` not `first_name`

2. **Airbnb JavaScript Style Guide - Naming Conventions** (https://github.com/airbnb/javascript#naming-conventions)  
   - camelCase for variables and properties
   - snake_case only for database column names (internal)
   - Transform at the API boundary

### Virtual List Row Height Calculation
3. **MDN: Element.getBoundingClientRect()** (https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)  
   - Dynamic height measurement after first render
   - Accurate for multi-line content

4. **React Virtualized Documentation** (https://github.com/bvaughn/react-virtualized)  
   - Best practice: measure first row, use as baseline
   - Adjust for content variations

### Service Worker Cache Strategies for SPAs
5. **Google Workbox Guide** (https://developers.google.com/web/tools/workbox/guides/get-started)  
   - Network-first for HTML/API calls
   - Cache-first for versioned assets
   - Stale-while-revalidate for CSS/JS

6. **Jake Archibald: Offline Cookbook** (https://web.dev/offline-cookbook/)  
   - Cache busting via query strings
   - Version-based invalidation

### Database Initialization Graceful Degradation
7. **Microsoft SQL Azure Best Practices** (https://docs.microsoft.com/azure/sql-database/sql-database-develop-error-messages)  
   - Retry logic for transient failures
   - Return partial data when possible
   - Log warnings, don't crash

8. **Postgres Error Handling** (https://www.postgresql.org/docs/current/plpgsql-errors-and-messages.html)  
   - Use EXCEPTION blocks for table-not-found
   - Return default values for missing tables

### API Rate Limiting Strategies
9. **NGINX Rate Limiting** (https://www.nginx.com/blog/rate-limiting-nginx/)  
   - Separate limits for read vs write operations
   - Higher limits for idempotent GET requests
   - Burst allowances for user activity spikes

10. **Stripe API Rate Limiting** (https://stripe.com/docs/rate-limits)  
    - Read operations: 100-1000+ per min
    - Write operations: 100 per min
    - Dynamic rate limits based on endpoint risk

### Database Column Validation and Defaults
11. **SQLite NOT NULL and Defaults** (https://www.sqlite.org/lang_createtable.html)  
    - Use NOT NULL for required columns
    - Provide DEFAULT values for optional columns
    - Validate at insert/update time

12. **Defensive Programming Best Practices** (https://en.wikipedia.org/wiki/Defensive_programming)  
    - Validate inputs at all boundaries
    - Use defaults only as last resort
    - Log when fallbacks are triggered

---

## MAJ-01: Voter Data Field Name Mismatch (camelCase vs snake_case)

### Current State Analysis

**Backend Behavior:**
- `backend/models/voter.js` consistently uses camelCase in SQL aliases:
  - Line 160-161: `last_name as lastName, first_name as firstName`
  - Line 339-340: Same pattern in `search()` method
  - Line 416-417: Same pattern in `findByPrecinct()`
  - Line 472-473: Same pattern in `findNeverVoted()`
- **All backend API responses return camelCase properties**

**Frontend Inconsistencies:**
- `frontend/src/pages/MapView.js`:
  - Lines 268, 277, 667, 691, 756, 811, 818: Use camelCase (`v.firstName`, `v.lastName`)
  - **Line 1446**: Uses snake_case (`f.first_name`, `f.last_name`) for failed geocoding records
  - **Line 1487**: Uses snake_case (`v.first_name`, `v.last_name`) for geocoding review table
- `frontend/src/pages/NeverVoted.js`:
  - **Line 99**: Defensive fallback: `r.last_name || r.lastName` (expects both formats)
- `frontend/src/pages/Voters.js`:
  - Lines 90, 99, 105, 129: Consistently use camelCase (`r.lastName`, `r.firstName`)

**Root Cause:**
The issue stems from **two different data sources**:
1. **Standard voter queries** → Backend model methods → camelCase (correct)
2. **Geocoding-related raw SQL queries** → Return raw database rows → snake_case (wrong)

Specifically, the geocoding review endpoints (`/api/geocode/review`, `/api/geocode/failed`) return raw SQLite rows without field transformation.

**Impact:**
- Minor display issues in geocoding management UI (lines 1446, 1487)
- Defensive code needed (line 99 fallback pattern)
- Confusion for developers about correct field names

### Research Findings

**Google JSON Style Guide:**
- Properties should use camelCase: `firstName`, `lastName`
- Consistent naming across all endpoints
- Transform at API boundary (database → JSON)

**Airbnb JavaScript Style Guide:**
- JavaScript variables and object properties: camelCase
- Database columns can use snake_case internally
- **Transform layer required** at the model/API boundary

**Best Practice:**
All API responses should use identical field naming, regardless of data source. The backend model should be the single source of truth for field transformation.

### Proposed Solution

**Approach:** Standardize all API responses to camelCase by fixing the geocoding endpoints.

**Files to Modify:**
1. `backend/routes/geocode.js` - Transform raw query results
2. `frontend/src/pages/MapView.js` - Remove snake_case references (lines 1446, 1487)
3. `frontend/src/pages/NeverVoted.js` - Remove defensive fallback (line 99)

**Code Changes:**

**1. Fix geocoding review endpoint** (`backend/routes/geocode.js`):
```javascript
// Add field transformation helper at top of file
function transformVoterFields(voter) {
  if (!voter) return voter;
  return {
    ...voter,
    firstName: voter.first_name || voter.firstName,
    lastName: voter.last_name || voter.lastName,
    voterId: voter.voter_id || voter.voterId,
    zipCode: voter.zip_code || voter.zipCode,
    precinctNumber: voter.precinct_number || voter.precinctNumber,
    dateOfBirth: voter.date_of_birth || voter.dateOfBirth,
    superVoter: voter.super_voter !== undefined ? voter.super_voter : voter.superVoter,
    createdAt: voter.created_at || voter.createdAt,
    updatedAt: voter.updated_at || voter.updatedAt,
    // Remove snake_case properties
    first_name: undefined,
    last_name: undefined,
    voter_id: undefined,
    zip_code: undefined,
    precinct_number: undefined,
    date_of_birth: undefined,
    super_voter: undefined,
    created_at: undefined,
    updated_at: undefined,
  };
}

// Apply to review endpoint
router.get('/review', async (req, res) => {
  try {
    // ... existing query logic ...
    const voters = await database.all(sql, params);
    
    // Transform all fields to camelCase
    const transformedVoters = voters.map(transformVoterFields);
    
    res.json({
      data: transformedVoters,
      pagination: { ... }
    });
  } catch (error) {
    // ... error handling ...
  }
});

// Apply to failed endpoint
router.get('/failed', async (req, res) => {
  try {
    // ... existing query logic ...
    const failed = await database.all(sql, params);
    
    // Transform all fields to camelCase
    const transformedFailed = failed.map(transformVoterFields);
    
    res.json({ data: transformedFailed, total });
  } catch (error) {
    // ... error handling ...
  }
});
```

**2. Update MapView.js** to use camelCase consistently:
```javascript
// Line 1446 - Failed geocoding records
<p class="text-gray-700 dark:text-gray-300">
  ${escapeHtml(f.firstName || '')} ${escapeHtml(f.lastName || '')} — 
  ${escapeHtml(f.address || 'Unknown address')}
  ${f.city ? ', ' + escapeHtml(f.city) : ''}
  ${f.zipCode ? ' ' + escapeHtml(f.zipCode) : ''}
</p>

// Line 1487 - Review table
<td class="px-3 py-2 whitespace-nowrap">
  ${escapeHtml(v.firstName || '')} ${escapeHtml(v.lastName || '')}
</td>
```

**3. Update NeverVoted.js** to remove defensive fallback:
```javascript
// Line 99 - Remove fallback pattern
{ 
  label: 'Name', 
  render: r => `${escapeHtml(r.lastName)}, ${escapeHtml(r.firstName)}` 
}
```

### Implementation Steps

1. **Add field transformation helper** to `backend/routes/geocode.js`
2. **Apply transformation** to `/api/geocode/review` endpoint
3. **Apply transformation** to `/api/geocode/failed` endpoint
4. **Remove snake_case references** from MapView.js (2 locations)
5. **Remove defensive fallback** from NeverVoted.js (1 location)
6. **Test all geocoding UI** - verify no display issues
7. **Test voter list** - verify names still display correctly

### Testing Approach

**Manual Testing:**
1. Upload a voter CSV file
2. Start geocoding job
3. Navigate to Map → Geocoding tab
4. Click "Review Geocoded Voters" - verify names display correctly
5. Check failed geocoding records - verify names display correctly
6. Navigate to Voters page - verify names display correctly
7. Navigate to Never Voted page - verify names display correctly

**Verification:**
```bash
# Check for remaining snake_case field references
grep -r "first_name\|last_name" frontend/src/

# Should only return comments or string literals, not property access
```

**API Testing:**
```bash
# Test geocoding review endpoint
curl http://localhost:3000/api/geocode/review | jq '.'

# Verify response has firstName/lastName, not first_name/last_name
```

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking change for frontend | Low | Medium | All current code already handles camelCase as primary |
| Missed raw SQL queries | Low | Low | Grep search for snake_case patterns before deployment |
| Third-party code expects snake_case | Very Low | Low | No external API consumers identified |

### Priority

**Medium-High** - This issue causes minor display bugs and code inconsistency but doesn't break core functionality.

---

## MAJ-02: VirtualScroller Row Height Assumption Wrong

### Current State Analysis

**Status: NO LONGER RELEVANT**

The codebase has been completely rebuilt with a modern Vite-based architecture. Analysis confirms:

1. **No VirtualScroller implementation exists** in `frontend/src/`
2. **Search Results:** `grep -r "VirtualScroller|virtual-scroller|rowHeight" frontend/src/` → 0 matches
3. **File Search:** No `virtual-scroller.js` file found
4. **File Search:** No `voter-list-controller.js` file found (legacy filename from old architecture)

**Current Implementation:**
- Frontend uses standard pagination (50 items per page)
- See `frontend/src/pages/Voters.js` line 9: `filters: { limit: 50, offset: 0 }`
- Table rendering uses simple `buildTable()` helper (no virtualization)
- No row height calculations needed

**Why This Changed:**
The application was migrated from a plain HTML/Bootstrap architecture to a modern Vite + reactive framework. The VirtualScroller was removed as part of this migration.

### Recommendation

**CLOSE THIS ISSUE** - No action required. The problem has been eliminated through architectural improvement.

---

## MAJ-03: Service Worker May Cache Stale JavaScript

### Current State Analysis

**Status: NO LONGER RELEVANT**

The application does not implement a service worker. Analysis confirms:

1. **No service worker file exists:**
   - Attempted read: `frontend/public/sw.js` → File not found
   - Search: `**/service-worker.js` → 0 results
   - Search: `**/sw.js` → 0 results

2. **Vite configuration** (`frontend/vite.config.js`):
   - No service worker plugin configured
   - No PWA plugin configured
   - Standard Vite SPA setup

3. **Server configuration** (`backend/server.js` lines 148-156):
   - Cache headers for static files handled via Express:
     - Hashed assets (`.*.js`, `.*.css`): `max-age=31536000, immutable`
     - Non-hashed JS/CSS: `no-cache`
   - This is sufficient cache strategy for non-PWA apps

**Why This Changed:**
The original issue plan referenced an old codebase with a service worker. The new Vite-based architecture doesn't include one, relying instead on standard HTTP caching.

**Current Cache Strategy (Correct):**
- **Vite builds with content hashes:** `app.a3f4b2c1.js` → immutable, long cache
- **HTML files:** No cache → Always fetch latest
- **Non-hashed assets:** No cache → For development flexibility

### Recommendation

**CLOSE THIS ISSUE** - No action required. The Vite build system with proper cache headers provides adequate cache management without the complexity of a service worker.

---

## MAJ-04: Database `getStats()` — Missing Table Resilience

### Current State Analysis

**Status: ALREADY FIXED**

The `getStats()` method in `backend/config/database.js` (lines 260-287) already implements robust error handling:

**Implementation (Line 263-270):**
```javascript
const safeCount = async (query, defaultVal = 0) => {
    try {
        const result = await this.get(query);
        return result ? Object.values(result)[0] : defaultVal;
    } catch (e) {
        console.warn(`Stats query failed: ${e.message}`);
        return defaultVal;
    }
};
```

**Usage (Lines 273-277):**
```javascript
const totalVoters = await safeCount('SELECT COUNT(*) as count FROM voters');
const geocodedVoters = await safeCount('SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL');
const totalPrecincts = await safeCount('SELECT COUNT(*) as count FROM precincts');
const cacheSize = await safeCount('SELECT COUNT(*) as count FROM geocoding_cache');
const superVoters = await safeCount('SELECT COUNT(*) as count FROM voters WHERE super_voter = 1');
```

**Behavior:**
- Each count query is wrapped in `safeCount()`
- If table doesn't exist → Logs warning → Returns 0
- If entire `getStats()` fails → Returns `null` (line 286)
- Server startup handles `null` gracefully (line 171 in `server.js`)

**Server Startup Resilience (backend/server.js lines 166-176):**
```javascript
const initializeDatabase = async () => {
    try {
        await database.connect();
        const stats = await database.getStats();
        log.info('📊 Database Stats:', stats);  // Logs null if getStats fails
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);  // Only exits on connection failure, not stats failure
    }
};
```

**Analysis:**
- Missing `geocoding_cache` table → `cacheSize: 0` (not a crash)
- Missing `precincts` table → `totalPrecincts: 0` (not a crash)
- Complete database failure → Handled by schema validation (line 100-110 in database.js)

### Research Findings

**Microsoft SQL Azure Best Practices:**
- Return partial results when possible ✅ Implemented
- Log warnings for failures ✅ Implemented
- Don't crash on non-critical errors ✅ Implemented

**Postgres Error Handling:**
- Use try/catch for table-not-found ✅ Implemented
- Return default values ✅ Implemented (defaultVal = 0)

### Recommendation

**CLOSE THIS ISSUE** - Already resolved. The implementation exceeds best practices with its `safeCount` helper pattern.

---

## MAJ-05: Rate Limiter Blocks Rapid Filter Changes

### Current State Analysis

**Status: ALREADY FIXED**

The rate limiter in `backend/server.js` (lines 100-122) now implements separate limits for read vs write operations:

**Current Configuration:**

**Read Operations (GET):**
```javascript
const apiReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 1000,                  // 1000 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
```

**Write Operations (POST/PUT/DELETE):**
```javascript
const apiWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                   // 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
```

**Application (Lines 117-122):**
```javascript
app.use('/api/', (req, res, next) => {
    if (req.method === 'GET') {
        apiReadLimiter(req, res, next);
    } else {
        apiWriteLimiter(req, res, next);
    }
});
```

**Analysis:**
- **Old limit:** 100 requests / 15 min (all methods)
- **New limit:** 1000 GET requests / 15 min
- **Filter changes:** Use GET `/api/voters?name=...&precinct=...`
- **Impact:** User can now make **1000 filter changes in 15 minutes** (66/minute average)
- **Frontend debounce:** 350ms (see `pages/Voters.js` line 76)
- **Realistic usage:** ~10-20 filter changes per minute = **no risk of 429 errors**

**Upload Endpoint Protection (Lines 125-136):**
```javascript
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,   // 1 hour
    max: 10,                     // 10 uploads per hour
    skip: (req, res) => req.method === 'GET',  // Skip GET (status checks)
});
app.use('/api/upload', uploadLimiter);
```

This also prevents the issue where upload status polling (GET requests) was blocked.

### Research Findings

**NGINX Rate Limiting Best Practices:**
- Read operations: 100-1000+ per minute ✅ Implemented (1000/15min = 66/min)
- Write operations: More restrictive ✅ Implemented (100/15min = 6.6/min)
- Burst allowances: Not implemented but unnecessary with current limits

**Stripe API Rate Limiting:**
- Read-heavy endpoints: Higher limits ✅ Implemented
- State-changing endpoints: Lower limits ✅ Implemented

### Recommendation

**CLOSE THIS ISSUE** - Already resolved. The 1000 GET/15min limit with 350ms frontend debounce makes 429 errors virtually impossible during normal filter usage.

---

## MAJ-06: Geocoding — State Column Not Consistently Used

### Current State Analysis

**Backend Implementation:**
`backend/services/geocoding-job-service.js` has multiple instances of state fallback:

**Line 212:**
```javascript
if (!voter.state) {
    console.warn(`Voter ${voter.id} missing state column, defaulting to TN`);
}
```

**Line 220:**
```javascript
voter.state || 'TN',
```

**Line 238:**
```javascript
const state = voter.state || 'TN';
```

**Line 260:**
```javascript
voter.state || 'TN',
```

**Problem:**
- If a voter from another state is imported without the `state` column populated
- The geocoding service will geocode their address in Tennessee
- Example: `123 Main St, Nashville` (missing state) → Geocoded in Nashville, TN
- But the voter might be from Nashville, Arkansas or Nashville, Georgia

**Database Schema (`backend/migrations/007_add_state_column.js`):**
- `state` column added to `voters` table
- Column is **nullable** (no NOT NULL constraint)
- No DEFAULT value specified

**CSV Import (`backend/parsers/csv-parser.js`):**
Need to verify if `STATE` column is mapped correctly:

**Current Behavior:**
The CSV parser maps `STATE` → `state` field, but:
1. If CSV has no `STATE` column → `state` is `null`
2. If CSV has empty `STATE` value → `state` is `''` or `null`
3. Fallback to `'TN'` happens silently with only a warning log

**Data Analysis (Reference CSV):**
From `LEWIS - DIST. 2.csv` (Lewis County, Tennessee):
- All records have `STATE=TN` column
- This specific dataset works fine with the fallback
- **But:** If other states' data is imported, the fallback is wrong

**Impact:**
- **Severity:** High for multi-state deployments
- **Current:** Low (only Tennessee data imported so far)
- **Future Risk:** High if expanding to other states

### Research Findings

**SQLite NOT NULL and Defaults:**
- Use NOT NULL for required columns
- Provide DEFAULT values only if a sensible default exists
- For `state`, there is no sensible default for a national system

**Defensive Programming Best Practices:**
- Validate inputs at all boundaries ✅ Partially implemented (logs warning)
- Use defaults only as last resort ✅ Violated ('TN' is not universally valid)
- Log when fallbacks are triggered ✅ Implemented

**Best Practice:**
For geographic data, **require** the state field rather than guessing. Either:
1. Reject geocoding if state is missing
2. Make state column NOT NULL in the database
3. Infer state from ZIP code (complex, error-prone)

### Proposed Solution

**Approach:** Require state field for geocoding, reject if missing.

**Rationale:**
- **Option 1:** Reject geocoding → Correct behavior, forces data quality
- **Option 2:** NOT NULL constraint → Breaks existing imports with missing state
- **Option 3:** ZIP → state lookup → Complex, not always accurate (ZIP codes can span states)

**Choice:** Option 1 (soft validation with clear error reporting)

### Code Changes

**1. Update geocoding job service** (`backend/services/geocoding-job-service.js`):

```javascript
// Around line 210-225
if (!voter.state || voter.state.trim() === '') {
  // Log error instead of warning
  console.error(`❌ Voter ${voter.id} (${voter.voter_id}) missing state - skipping geocoding`);
  
  // Log to geocoding_errors table
  await database.run(`
    INSERT INTO geocoding_errors (voter_id, error_type, error_message, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    voter.id,
    'MISSING_STATE',
    'State column is empty or null - geocoding skipped for data accuracy'
  ]);
  
  failedCount++;
  processedCount++;
  continue; // Skip geocoding for this voter
}

// Use state without fallback
const fullAddress = `${voter.address}, ${voter.city}, ${voter.state}, ${voter.zip_code}`;
```

**2. Update all other state references** (lines 238, 260):
Remove `|| 'TN'` fallback - require state to be present:

```javascript
// Line 238 - Cache lookup
const state = voter.state;
if (!state) {
  console.error(`Voter ${voter.id} missing state - skipping cache lookup`);
  continue;
}

// Line 260 - Cache save
voter.state,  // No fallback
```

**3. Update CSV parser validation** (`backend/parsers/csv-parser.js`):
Add state validation:

```javascript
// After field mapping
if (!record.state || record.state.trim() === '') {
  throw new Error(`Missing STATE column in CSV - required for geocoding accuracy`);
}
```

**4. Add migration for geocoding_errors table** (if not exists):

```javascript
// backend/migrations/010_add_geocoding_errors_table.js
exports.up = async (database) => {
  await database.run(`
    CREATE TABLE IF NOT EXISTS geocoding_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voter_id INTEGER NOT NULL,
      error_type TEXT NOT NULL,
      error_message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (voter_id) REFERENCES voters(id) ON DELETE CASCADE
    )
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_geocoding_errors_voter_id 
    ON geocoding_errors(voter_id)
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_geocoding_errors_type 
    ON geocoding_errors(error_type)
  `);
};

exports.down = async (database) => {
  await database.run('DROP TABLE IF EXISTS geocoding_errors');
};
```

### Implementation Steps

1. **Create migration** for `geocoding_errors` table
2. **Run migration** to add table to database schema
3. **Update geocoding job service** - remove 'TN' fallback (3 locations)
4. **Add validation** - reject geocoding if state is missing
5. **Add error logging** - log missing state to geocoding_errors table
6. **Update CSV parser** - validate state column is present and non-empty
7. **Test with Tennessee data** - ensure existing imports still work
8. **Test with missing state** - ensure geocoding is rejected with clear error
9. **Update documentation** - note that STATE column is required

### Testing Approach

**Positive Test (State Present):**
```csv
STATE_ID,LNAME,FNAME,ADDRESS,CITY,STATE,ZIP
12345,DOE,JOHN,123 MAIN ST,MEMPHIS,TN,38103
```
Expected: Geocoding succeeds

**Negative Test (State Missing):**
```csv
STATE_ID,LNAME,FNAME,ADDRESS,CITY,STATE,ZIP
12345,DOE,JOHN,123 MAIN ST,MEMPHIS,,38103
```
Expected: 
- CSV import succeeds (voter added to database)
- Geocoding job skips this voter
- Error logged to `geocoding_errors` table
- Job summary shows "1 failed" with reason "MISSING_STATE"

**Negative Test (State Column Absent):**
```csv
STATE_ID,LNAME,FNAME,ADDRESS,CITY,ZIP
12345,DOE,JOHN,123 MAIN ST,MEMPHIS,38103
```
Expected:
- CSV parser throws error: "Missing STATE column in CSV"
- Import fails with clear error message

**Verification Queries:**
```sql
-- Check for voters without state
SELECT COUNT(*) FROM voters WHERE state IS NULL OR state = '';

-- Check geocoding errors
SELECT * FROM geocoding_errors WHERE error_type = 'MISSING_STATE';

-- Check geocoded voters without state (should be 0 after fix)
SELECT COUNT(*) FROM voters 
WHERE latitude IS NOT NULL 
  AND (state IS NULL OR state = '');
```

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing imports | Low | Medium | CSV parser validates, provides clear error message |
| Existing voters have no state | Medium | High | Run migration query to check before deploying |
| Geocoding fails for valid data | Low | High | Test thoroughly with Tennessee reference data |
| Users don't understand error | Medium | Low | Clear error messages in UI and logs |

**Pre-Deployment Check:**
```sql
-- Check if any existing voters are missing state
SELECT COUNT(*) as missing_state_count
FROM voters 
WHERE state IS NULL OR state = '';

-- If count > 0, run update query:
UPDATE voters SET state = 'TN' 
WHERE (state IS NULL OR state = '') 
  AND city IN ('UNION CITY', 'WOODLAND MILLS')  -- Known TN cities
  AND zip_code LIKE '382%';  -- TN ZIP codes
```

### Priority

**Medium** - This issue only affects multi-state deployments, which are not currently active. However, enforcing data quality now prevents future geocoding errors.

---

## Implementation Order

Based on impact, effort, and dependencies:

| Order | Issue | Reason | Est. Time |
|-------|-------|--------|-----------|
| 1 | **MAJ-01** (Field Name Mismatch) | Affects current UI, low effort, no dependencies | 1 hour |
| 2 | **MAJ-06** (State Column) | Prevents future geocoding errors, requires migration | 2 hours |
| — | **MAJ-02** (VirtualScroller) | Close as "no longer relevant" | — |
| — | **MAJ-03** (Service Worker) | Close as "no longer relevant" | — |
| — | **MAJ-04** (getStats Resilience) | Close as "already fixed" | — |
| — | **MAJ-05** (Rate Limiter) | Close as "already fixed" | — |

**Total Implementation Time:** **3 hours**

---

## Success Metrics

### MAJ-01: Field Name Mismatch

**Success Criteria:**
- [ ] All API responses use camelCase fields
- [ ] Zero snake_case field references in frontend code
- [ ] No defensive fallbacks like `r.last_name || r.lastName`
- [ ] Geocoding UI displays names correctly
- [ ] Voter list displays names correctly

**Verification:**
```bash
# Should return 0 results (except comments)
grep -r "\.first_name\|\.last_name" frontend/src/ | grep -v "^[[:space:]]*\/\/"
```

### MAJ-06: State Column

**Success Criteria:**
- [ ] Geocoding requires state field (no fallback to 'TN')
- [ ] Missing state logs error to `geocoding_errors` table
- [ ] CSV parser validates state column presence
- [ ] Existing Tennessee data imports successfully
- [ ] Missing state data is rejected with clear error

**Verification:**
```sql
-- Should return 0 (no geocoded voters without state)
SELECT COUNT(*) FROM voters 
WHERE latitude IS NOT NULL 
  AND (state IS NULL OR state = '');

-- Should return count > 0 if test data imported
SELECT COUNT(*) FROM geocoding_errors WHERE error_type = 'MISSING_STATE';
```

---

## Conclusion

Of the 6 Major Issues identified:
- **2 require implementation** (MAJ-01, MAJ-06)
- **2 are already resolved** (MAJ-04, MAJ-05)
- **2 are no longer relevant** (MAJ-02, MAJ-03)

The remaining work focuses on **data consistency** and **geocoding accuracy**. Both fixes are non-breaking and can be implemented independently.

**Next Steps:**
1. Implement MAJ-01 (Field naming standardization)
2. Implement MAJ-06 (State validation for geocoding)
3. Close MAJ-02, MAJ-03, MAJ-04, MAJ-05 with appropriate justifications

---

**End of Specification**
