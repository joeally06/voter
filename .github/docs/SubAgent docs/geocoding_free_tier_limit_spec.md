# Geocoding & Maps API Free Tier Limit Specification

**Created:** 2026-02-17  
**Purpose:** Enforce 10,000 requests/month hard cap for Google Maps Geocoding API and Dynamic Maps API to stay within the free tier.

---

## 1. Current State Analysis

### 1.1 Pricing Tiers (from `Pricing for My Billing Account.csv`)

#### Geocoding API
| Tier | Requests/Month | Price per 1,000 |
|------|---------------|-----------------|
| Free | 0–10,000 | $0.00 |
| Tier 1 | 10,001–100,000 | $5.00 |
| Tier 2 | 100,001–500,000 | $4.00 |
| Tier 3 | 500,001–1,000,000 | $3.00 |
| Tier 4 | 1,000,001–5,000,000 | $1.50 |
| Tier 5 | 5,000,001+ | $0.38 |

#### Dynamic Maps (Frontend Map Loads)
| Tier | Loads/Month | Price per 1,000 |
|------|-------------|-----------------|
| Free | 0–10,000 | $0.00 |
| Tier 1 | 10,001–100,000 | $7.00 |
| Tier 2 | 100,001–500,000 | $5.60 |
| Tier 3 | 500,001–1,000,000 | $4.20 |
| Tier 4 | 1,000,001–5,000,000 | $2.10 |
| Tier 5 | 5,000,001+ | $0.53 |

### 1.2 Current Quota System Architecture

#### QuotaManager (`backend/services/quota-manager.js`)
- **Tracks:** Daily quotas only — no monthly tracking or enforcement
- **Default limits (DAILY):**
  - `geocoding`: `DAILY_QUOTA_LIMIT` env var || **1,333/day** (hardcoded default)
  - `distance_matrix`: `DISTANCE_MATRIX_DAILY_QUOTA` env var || **333/day**
  - `directions`: `DIRECTIONS_DAILY_QUOTA` env var || **100/day**
- **Enforcement:** Blocks at **95% of daily quota** — throws error with `quotaError: true`
- **Storage:** `api_usage` table with daily rows per API (`api_name + call_date` unique constraint)
- **Monthly summary:** Has `getMonthlyQuotaSummary()` method but it is **read-only** — does NOT enforce limits
- **Warning thresholds:** 70%, 80%, 90%, 95%

#### Key Gap: NO monthly quota enforcement exists anywhere in the codebase. The daily limit of 1,333 for geocoding is an approximation of 40,000/month ÷ 30 days, but:
1. There is no actual monthly counter or enforcer
2. The `.env.example` comments say "Google provides 40,000 free requests per month (~1,333/day)" — this is outdated; the free tier is actually 10,000/month
3. The `geocode.js` stats endpoint uses `DAILY_QUOTA_LIMIT || 10000` as a display value (inconsistent with the quota-manager default of 1,333)
4. Dynamic Maps loads are **completely untracked** — no backend counter exists for map loads

### 1.3 Where API Calls Are Made

#### Geocoding API Calls
| Location | Method | Description |
|----------|--------|-------------|
| `backend/services/geocoding-service.js:86` | `geocodeAddress()` → `makeGeocodingRequest()` | Core geocoding: calls `this.client.geocode()` via Google Maps JS client |
| `backend/services/geocoding-service.js:84` | `incrementQuotaUsage()` | Increments `api_usage` table AFTER successful API call |
| `backend/services/geocoding-service.js:330` | `geocodeWithRetry()` | Retry wrapper — calls `geocodeAddress()` up to 3 times |
| `backend/services/geocoding-job-service.js:195` | `processJob()` → batch loop | Calls `geocodingService.geocodeWithRetry()` for each cache miss |
| `backend/routes/geocode.js:149` | `POST /api/geocode/single` | Single address geocoding via REST API |
| `backend/routes/geocode.js:36` | `POST /api/geocode/batch` | Batch geocoding — creates job via `jobService.createJob()` |

#### Distance Matrix API Calls
| Location | Method | Description |
|----------|--------|-------------|
| `backend/services/distance-matrix-service.js:253` | `getDistance()` → `makeDistanceMatrixRequest()` | Single origin→dest distance |
| `backend/services/distance-matrix-service.js:337` | `getDistances()` → `makeDistanceMatrixRequest()` | 1-to-N batch distances |
| `backend/services/distance-matrix-service.js:433` | `getDistanceMatrix()` → `makeDistanceMatrixRequest()` | NxN matrix |
| `backend/services/distance-matrix-service.js:587` | `makeDistanceMatrixRequest()` | Core API call: `this.client.distancematrix()` |

#### Dynamic Maps API Calls (Frontend)
| Location | Method | Description |
|----------|--------|-------------|
| `frontend/src/pages/MapView.js:115` | `loadGoogleMapsScript()` | Loads Google Maps JS API script tag |
| `frontend/src/pages/MapView.js:121` | `new google.maps.Map()` | Creates map instance — THIS is the "Dynamic Maps" billable event |
| `frontend/src/pages/MapView.js:1465` | Script src | `maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry` |

**Note:** Each `new google.maps.Map()` creation (or page reload) counts as 1 Dynamic Maps load. The map is created each time the user navigates to the Map tab. There is **no backend tracking** for this.

### 1.4 Database Schema for Tracking

#### `api_usage` table (created in `backend/migrations/006_add_route_planning_tables.js` and `scripts/setup.js`)
```sql
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_name TEXT NOT NULL,        -- 'geocoding', 'distance_matrix', 'directions'
    call_date DATE NOT NULL,       -- YYYY-MM-DD
    call_count INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    quota_remaining INTEGER,       -- Currently unused
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(api_name, call_date)
);
```

#### `api_quotas` table (legacy, from `backend/migrations/003_add_geocoding_tables.js`)
```sql
CREATE TABLE IF NOT EXISTS api_quotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    service TEXT NOT NULL,
    request_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, service)
);
```
**Note:** `api_quotas` is the **legacy** table. The QuotaManager exclusively uses `api_usage`. The old `api_quotas` table is no longer written to.

### 1.5 How Caching Works (Does NOT Count Against Quota)

#### Geocoding Cache (`geocoding_cache` table)
- **AddressCacheService** (`backend/services/address-cache-service.js`): Normalizes address → MD5 hash → checks `geocoding_cache` table
- **TTL:** 90 days (configurable via `CACHE_TTL_DAYS`)
- **Flow in GeocodingJobService:** Check cache FIRST → only call API on miss → store result in cache on success
- **Quota impact:** `incrementQuotaUsage()` is only called in `geocodeAddress()` after actual API calls, NOT for cache hits
- **Cache hit tracking:** QuotaManager's `incrementCacheHit()` is NOT called by geocoding service (only by distance-matrix-service). This is a gap.

#### Route Cache (`route_cache` table)
- **RouteCacheService** (`backend/services/route-cache-service.js`): Symmetric hashing (A→B = B→A)
- **TTL:** 30 days (configurable via `ROUTE_CACHE_TTL_DAYS`)
- **Flow in DistanceMatrixService:** Check cache FIRST → only call API for misses → cache successful results
- **Quota impact:** `incrementApiCall()` is called ONLY for actual API calls. Cache hits correctly tracked via `incrementCacheHit()`.

### 1.6 Cache Hit Tracking Gap

The **geocoding service** does NOT call `quotaManager.incrementCacheHit('geocoding')` or `quotaManager.incrementCacheMiss('geocoding')` anywhere. Only the `geocoding_jobs` table tracks cache_hits per job. The `api_usage` table for geocoding has `cache_hits=0, cache_misses=0` always.

The **distance matrix service** correctly calls both `incrementCacheHit()` and `incrementCacheMiss()`.

---

## 2. Gaps in Current Quota Enforcement

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | **No monthly quota enforcement** — only daily quotas exist | CRITICAL | Could exceed 10,000/month free tier and incur charges |
| 2 | **Daily default (1,333) doesn't match free tier** — 1,333 × 30 = 39,990, should be ~333/day for 10,000/month | HIGH | Default settings allow 4x the free tier |
| 3 | **No Dynamic Maps load tracking** — frontend map loads are not counted | HIGH | Dynamic Maps charges accrue unmonitored |
| 4 | **Geocoding cache hits not tracked in `api_usage`** — only distance_matrix tracks cache hits | LOW | Inaccurate reporting; no enforcement impact |
| 5 | **`quota_remaining` column always NULL** — never populated | LOW | Wasted column; could be repurposed for monthly remaining |
| 6 | **`.env.example` says 40,000 free/month** — outdated; should say 10,000 | MEDIUM | Misleading documentation |
| 7 | **Stats endpoint uses `DAILY_QUOTA_LIMIT || 10000`** — inconsistent with quota-manager default of 1,333 | MEDIUM | Confusing dashboard |

---

## 3. Proposed Implementation Changes

### 3.1 New Monthly Quota Enforcement in QuotaManager

**File:** `backend/services/quota-manager.js`

#### A. Add Monthly Limits
```javascript
constructor() {
    // Daily quota limits per API (safety net per-day)
    this.quotaLimits = {
        geocoding: parseInt(process.env.DAILY_GEOCODING_QUOTA) || 333,
        distance_matrix: parseInt(process.env.DAILY_DISTANCE_MATRIX_QUOTA) || 333,
        directions: parseInt(process.env.DAILY_DIRECTIONS_QUOTA) || 100
    };

    // NEW: Monthly limits per API (hard cap for free tier)
    this.monthlyLimits = {
        geocoding: parseInt(process.env.MONTHLY_GEOCODING_LIMIT) || 10000,
        distance_matrix: parseInt(process.env.MONTHLY_DISTANCE_MATRIX_LIMIT) || 10000,
        dynamic_maps: parseInt(process.env.MONTHLY_DYNAMIC_MAPS_LIMIT) || 10000,
        directions: parseInt(process.env.MONTHLY_DIRECTIONS_LIMIT) || 10000
    };

    // Warning thresholds (percent of monthly limit)
    this.warningThresholds = [70, 80, 90, 95];
}
```

#### B. Add `checkMonthlyQuota()` Method
```javascript
async checkMonthlyQuota(apiName, callCount = 1) {
    const monthlyLimit = this.monthlyLimits[apiName];
    if (!monthlyLimit) return { allowed: true }; // No monthly limit configured

    const monthlyUsage = await this.getMonthlyUsage(apiName);
    const projectedUsage = monthlyUsage + callCount;
    const percentUsed = (projectedUsage / monthlyLimit) * 100;

    if (projectedUsage > monthlyLimit) {
        const error = new Error(
            `Monthly ${apiName} quota exceeded. ` +
            `Usage: ${monthlyUsage.toLocaleString()}/${monthlyLimit.toLocaleString()} this month. ` +
            `Requested: +${callCount.toLocaleString()} calls. ` +
            `Quota resets on the 1st of next month.`
        );
        error.quotaError = true;
        error.isMonthlyExhausted = true;
        error.monthlyUsage = monthlyUsage;
        error.monthlyLimit = monthlyLimit;
        error.remaining = Math.max(0, monthlyLimit - monthlyUsage);
        throw error;
    }

    // Warn at thresholds
    const currentPercent = (monthlyUsage / monthlyLimit) * 100;
    for (const threshold of this.warningThresholds) {
        if (currentPercent >= threshold && currentPercent < threshold + 5) {
            console.warn(
                `⚠️  MONTHLY ${apiName} quota at ${currentPercent.toFixed(1)}% ` +
                `(${monthlyUsage}/${monthlyLimit})`
            );
            break;
        }
    }

    return {
        allowed: true,
        monthlyLimit,
        monthlyUsed: monthlyUsage,
        monthlyRemaining: monthlyLimit - monthlyUsage,
        monthlyPercentUsed: parseFloat(currentPercent.toFixed(1))
    };
}
```

#### C. Add `getMonthlyUsage()` Method
```javascript
async getMonthlyUsage(apiName) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startDate = startOfMonth.toISOString().split('T')[0];

    const result = await database.get(`
        SELECT COALESCE(SUM(call_count), 0) as total
        FROM api_usage
        WHERE api_name = ? AND call_date >= ?
    `, [apiName, startDate]);

    return result?.total || 0;
}
```

#### D. Modify `checkQuota()` to Also Check Monthly
The existing `checkQuota()` method should call `checkMonthlyQuota()` **before** checking daily:
```javascript
async checkQuota(apiName, callCount = 1) {
    // Check monthly limit FIRST (higher priority)
    await this.checkMonthlyQuota(apiName, callCount);

    // Then check daily limit (existing logic)
    // ... existing daily check code ...
}
```

#### E. Add `getMonthlyQuotaStatus()` Method
```javascript
async getMonthlyQuotaStatus(apiName = null) {
    const results = {};
    const apis = apiName ? [apiName] : Object.keys(this.monthlyLimits);

    for (const api of apis) {
        const usage = await this.getMonthlyUsage(api);
        const limit = this.monthlyLimits[api] || 10000;
        results[api] = {
            limit,
            used: usage,
            remaining: Math.max(0, limit - usage),
            percentUsed: parseFloat(((usage / limit) * 100).toFixed(1)),
            isExhausted: usage >= limit
        };
    }

    return apiName ? results[apiName] : results;
}
```

### 3.2 Integrate Monthly Check into GeocodingService

**File:** `backend/services/geocoding-service.js`

In `geocodeAddress()`, add monthly quota check BEFORE making the API call:
```javascript
async geocodeAddress(address, components = {}) {
    // ... existing validation ...

    // Check monthly quota BEFORE making API call
    await this.quotaManager.checkQuota('geocoding', 1);

    try {
        const response = await this.limiter.schedule(() =>
            this.makeGeocodingRequest(address, components)
        );
        await this.incrementQuotaUsage();
        return response;
    } catch (error) {
        // ... existing error handling ...
    }
}
```

Also in `checkQuotaLimit()` — it already delegates to `this.quotaManager.checkQuota()`, so the monthly check will automatically propagate.

### 3.3 Integrate Monthly Check into DistanceMatrixService

**File:** `backend/services/distance-matrix-service.js`

Already calls `this.quotaManager.checkQuota('distance_matrix', ...)` before API calls at:
- Line ~253 in `getDistance()`
- Line ~337 in `getDistances()`
- Line ~433 in `getDistanceMatrix()`

Since `checkQuota()` will now check monthly first, these all get coverage automatically.

### 3.4 Track Dynamic Maps Loads

#### A. New Backend Endpoint

**File:** `backend/routes/geocode.js` (or new file `backend/routes/maps-usage.js`)

```javascript
/**
 * POST /api/maps/track-load
 * Track a Dynamic Maps load for monthly quota
 */
router.post('/track-load', async (req, res) => {
    try {
        const quotaManager = new QuotaManager();

        // Check monthly limit before allowing map load
        const status = await quotaManager.getMonthlyQuotaStatus('dynamic_maps');

        if (status.isExhausted) {
            return res.status(429).json({
                success: false,
                error: 'Monthly Dynamic Maps quota exceeded',
                quota: status
            });
        }

        // Increment counter
        await quotaManager.incrementApiCall('dynamic_maps', 1);

        res.json({
            success: true,
            quota: status
        });
    } catch (error) {
        // ... error handling ...
    }
});
```

#### B. Frontend Integration

**File:** `frontend/src/pages/MapView.js`

After `new google.maps.Map()` is created, POST to the tracking endpoint:
```javascript
// After map creation
map = new google.maps.Map(container.querySelector('#map-canvas'), { ... });

// Track this map load against monthly quota
try {
    await fetch('/api/maps/track-load', { method: 'POST' });
} catch (e) {
    console.warn('Failed to track map load:', e);
}
```

Also, BEFORE loading the Google Maps script, check if quota is exhausted:
```javascript
// Check Dynamic Maps monthly quota before loading map
try {
    const quotaResp = await fetch('/api/routes/quota-status');
    const quotaData = await quotaResp.json();
    if (quotaData.monthly?.dynamic_maps?.isExhausted) {
        container.querySelector('#map-canvas').innerHTML = `
            <div class="text-center text-gray-500 p-8">
                <p class="font-medium text-red-600">Monthly Map Quota Exceeded</p>
                <p class="text-sm mt-1">10,000 map loads used this month. Quota resets on the 1st.</p>
            </div>`;
        return;
    }
} catch (e) { /* proceed anyway */ }
```

### 3.5 Update Quota Status Endpoint

**File:** `backend/routes/routes.js` (line ~290, `/api/routes/quota-status`)

Add monthly data to the response:
```javascript
router.get('/quota-status', async (req, res) => {
    try {
        const quotaManager = new QuotaManager();
        const dailyStatus = await quotaManager.getAllQuotaStatus();
        const monthlyStatus = await quotaManager.getMonthlyQuotaStatus();

        res.json({
            success: true,
            // Existing daily data
            quotas: dailyStatus.quotas,
            totalQuota: dailyStatus.totalQuota,
            totalUsed: dailyStatus.totalUsed,
            totalRemaining: dailyStatus.totalRemaining,
            averageCacheHitRate: dailyStatus.averageCacheHitRate,
            // Direct access
            distance_matrix: dailyStatus.quotas.distance_matrix,
            geocoding: dailyStatus.quotas.geocoding,
            directions: dailyStatus.quotas.directions,
            // NEW: Monthly data
            monthly: monthlyStatus
        });
    } catch (error) { /* ... */ }
});
```

### 3.6 Update Geocoding Stats Endpoint

**File:** `backend/routes/geocode.js` (line ~288, `GET /api/geocode/stats`)

Add monthly quota info:
```javascript
// In the stats endpoint, after existing code:
const QuotaManager = require('../services/quota-manager');
const quotaManager = new QuotaManager();
const monthlyGeocoding = await quotaManager.getMonthlyQuotaStatus('geocoding');

res.json({
    // ... existing fields ...
    monthlyQuota: monthlyGeocoding,
    apiUsage: {
        today: todayUsage,
        dailyLimit,
        percentUsed: ...,
        monthlyUsed: monthlyGeocoding.used,
        monthlyLimit: monthlyGeocoding.limit,
        monthlyRemaining: monthlyGeocoding.remaining,
        monthlyPercentUsed: monthlyGeocoding.percentUsed
    }
});
```

### 3.7 Fix Geocoding Cache Hit Tracking

**File:** `backend/services/geocoding-job-service.js`

In the `processJob()` method, after cache hits, track them in `api_usage`:
```javascript
if (cached) {
    geocodeResult = { ...cached, success: cached.latitude != null && cached.longitude != null };
    cacheHits++;
    // NEW: Track cache hit in api_usage table
    await this.geocodingService.quotaManager.incrementCacheHit('geocoding', 1);
} else {
    // ... existing API call code ...
    // NEW: Track cache miss in api_usage table
    await this.geocodingService.quotaManager.incrementCacheMiss('geocoding', 1);
}
```

### 3.8 Update Environment Variable Defaults

**File:** `.env.example`

```dotenv
# ============================================================================
# API QUOTA CONFIGURATION
# ============================================================================

# Monthly hard caps (free tier = 10,000/month per API)
MONTHLY_GEOCODING_LIMIT=10000
MONTHLY_DISTANCE_MATRIX_LIMIT=10000
MONTHLY_DYNAMIC_MAPS_LIMIT=10000
MONTHLY_DIRECTIONS_LIMIT=10000

# Daily safety limits (prevents burning through monthly quota too fast)
# 10,000/month ÷ 30 days ≈ 333/day
DAILY_GEOCODING_QUOTA=333
DAILY_DISTANCE_MATRIX_QUOTA=333
DAILY_DIRECTIONS_QUOTA=100
```

**Deprecate:** `DAILY_QUOTA_LIMIT` env var (replace with `DAILY_GEOCODING_QUOTA` for clarity).

### 3.9 Error Handling When Monthly Limit Reached

#### A. Backend Error Response Format
All quota errors should return consistent structure:
```json
{
    "success": false,
    "error": "Monthly geocoding quota exceeded",
    "quotaInfo": {
        "type": "monthly",
        "apiName": "geocoding",
        "monthlyUsed": 10000,
        "monthlyLimit": 10000,
        "remaining": 0,
        "resetDate": "2026-03-01",
        "dailyUsed": 45,
        "dailyLimit": 333
    }
}
```

HTTP Status Codes:
- `429 Too Many Requests` — both monthly and daily exhaustion
- `403 Forbidden` — if monthly limit would be exceeded (hard block)
- `400 Bad Request` — if request size exceeds remaining quota

#### B. Frontend Quota Warning UI

Display in geocoding panel and map view when approaching limits:
- **70%:** Yellow banner: "7,000/10,000 monthly geocoding requests used"
- **90%:** Orange banner: "9,000/10,000 — approaching monthly limit"
- **95%+:** Red banner: "Only 500 geocoding requests remaining this month"
- **100%:** Red block: "Monthly geocoding quota exceeded. Resets March 1st."

#### C. Batch Geocoding Pre-Check

In `POST /api/geocode/batch`, before creating the job:
```javascript
// Check if batch would exceed monthly quota
const quotaManager = new QuotaManager();
const monthlyStatus = await quotaManager.getMonthlyQuotaStatus('geocoding');
const estimatedApiCalls = Math.ceil(targetVoterIds.length * 0.2); // ~80% cache hit rate

if (monthlyStatus.used + estimatedApiCalls > monthlyStatus.limit) {
    return res.status(429).json({
        success: false,
        error: 'Batch would exceed monthly geocoding quota',
        quota: monthlyStatus,
        estimatedApiCalls,
        suggestion: `Reduce batch to ~${monthlyStatus.remaining} addresses or wait until quota resets`
    });
}
```

### 3.10 No Database Schema Changes Required

The existing `api_usage` table already supports all needed tracking:
- `api_name = 'dynamic_maps'` — new API name for frontend map loads
- Monthly totals computed via `SUM(call_count) WHERE call_date >= first_of_month`
- `quota_remaining` column can optionally be populated but isn't required

No new tables or migrations needed.

---

## 4. Files to Modify (Summary)

| File | Changes |
|------|---------|
| `backend/services/quota-manager.js` | Add monthly limits, `checkMonthlyQuota()`, `getMonthlyUsage()`, `getMonthlyQuotaStatus()`, update `checkQuota()` to check monthly first |
| `backend/services/geocoding-service.js` | Add monthly quota check before API call in `geocodeAddress()`, deprecate `DAILY_QUOTA_LIMIT` references |
| `backend/services/geocoding-job-service.js` | Add cache hit/miss tracking in `api_usage` for geocoding |
| `backend/routes/geocode.js` | Update stats endpoint with monthly data, add monthly pre-check to batch endpoint |
| `backend/routes/routes.js` | Update quota-status endpoint with monthly data |
| `backend/server.js` | Register new maps-usage route (if separate file), or add tracking endpoint to geocode routes |
| `frontend/src/pages/MapView.js` | Track Dynamic Maps loads, show quota warnings, block when exhausted |
| `.env.example` | Add `MONTHLY_*_LIMIT` vars, update comments, deprecate `DAILY_QUOTA_LIMIT` |

---

## 5. Cached Results: NOT Counted Against Quota

Verification that cached results do NOT count against quotas:

1. **Geocoding:** `incrementQuotaUsage()` is called ONLY in `geocodeAddress()` after `this.limiter.schedule(() => this.makeGeocodingRequest(...))` succeeds. Cache hits in `GeocodingJobService.processJob()` skip the API call entirely and never reach `incrementQuotaUsage()`. ✅
2. **Distance Matrix:** `incrementApiCall('distance_matrix', ...)` is called ONLY for `uncachedDests.length` or `batch.length` — cache hits are excluded from the count. ✅
3. **Dynamic Maps:** No caching applicable — each page load is a unique billable event. The browser may cache the JS script file, but the `new google.maps.Map()` call is always billed.

---

## 6. Implementation Priority

1. **CRITICAL:** Add `checkMonthlyQuota()` to QuotaManager (prevents billing charges)
2. **CRITICAL:** Wire monthly check into `checkQuota()` (single enforcement point)
3. **HIGH:** Add Dynamic Maps tracking endpoint and frontend integration
4. **HIGH:** Update quota-status and stats endpoints with monthly data
5. **MEDIUM:** Add frontend quota warning banners
6. **MEDIUM:** Fix geocoding cache hit tracking in `api_usage`
7. **LOW:** Update `.env.example` and documentation
8. **LOW:** Deprecate `DAILY_QUOTA_LIMIT` in favor of `DAILY_GEOCODING_QUOTA`
