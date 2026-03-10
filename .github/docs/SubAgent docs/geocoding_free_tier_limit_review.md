# Geocoding Free Tier Limit — Code Review

**Review Date:** 2026-02-17  
**Spec Reference:** `.github/docs/SubAgent docs/geocoding_free_tier_limit_spec.md`  
**Reviewer:** Automated Code Review Agent

---

## 1. Build Validation

| File | Syntax Check | Result |
|------|-------------|--------|
| `backend/services/quota-manager.js` | `node -c` | ✅ PASS |
| `backend/routes/geocode.js` | `node -c` | ✅ PASS |
| `backend/services/geocoding-job-service.js` | `node -c` | ✅ PASS |
| `backend/services/geocoding-service.js` | `node -c` | ✅ PASS |
| `backend/services/distance-matrix-service.js` | `node -c` | ✅ PASS |
| `backend/server.js` | `node -c` | ✅ PASS |
| `backend/routes/routes.js` | `node -c` | ✅ PASS |
| `frontend/src/api/client.js` | `npx acorn` | ✅ PASS |
| `frontend/src/pages/MapView.js` | `npx acorn` | ✅ PASS |

**Build Result: SUCCESS** — All 9 files pass syntax validation.

---

## 2. Spec Compliance Checklist

| # | Spec Requirement | Status | Notes |
|---|-----------------|--------|-------|
| 3.1A | Monthly limits in QuotaManager constructor | ✅ Done | 10,000 defaults, env var configurable |
| 3.1B | `checkMonthlyQuota()` method | ✅ Done | Throws with `isMonthlyExhausted`, `resetDate` |
| 3.1C | `getMonthlyUsage()` with `SUM(call_count)` + date filter | ✅ Done | Uses `COALESCE(SUM(call_count), 0)` |
| 3.1D | `checkQuota()` calls monthly check first | ✅ Done | Line 97: `await this.checkMonthlyQuota(apiName, callCount)` |
| 3.1E | `getMonthlyQuotaStatus()` method | ✅ Done | Returns limit, used, remaining, percentUsed, isExhausted, resetDate |
| 3.2 | Monthly check in GeocodingService | ✅ Done | Via `checkQuota()` → `checkMonthlyQuota()` chain |
| 3.3 | Monthly check in DistanceMatrixService | ✅ Done | Already calls `checkQuota()` at 3 call sites |
| 3.4A | Track Dynamic Maps loads backend endpoint | ✅ Done | `POST /api/geocode/track-map-load` |
| 3.4B | Frontend tracks map loads | ✅ Done | `await trackMapLoad()` after `new google.maps.Map()` |
| 3.5 | Quota-status endpoint includes monthly data | ✅ Done | `monthly: monthlyStatus` in response |
| 3.6 | Geocoding stats endpoint includes monthly | ✅ Done | `monthlyQuota: monthlyGeocoding` |
| 3.7 | Fix geocoding cache hit tracking | ✅ Done | `incrementCacheHit` / `incrementCacheMiss` in job service |
| 3.8 | Update .env.example | ⚠️ NOT Done | Still shows outdated 40,000/month and DAILY_QUOTA_LIMIT=10000 |
| 3.9A | HTTP 429 for monthly exhaustion | ✅ Done | batch endpoint, track-map-load |
| 3.9B | Frontend quota warning UI | ✅ Done | Color-coded bars, warnings at 80%/95% |
| 3.9C | Batch pre-check | ⚠️ Partial | Job created BEFORE quota check (order bug) |
| Spec §3.8 | Daily defaults corrected to 333/day | ✅ Done | In QuotaManager constructor |
| Spec §3.8 | Backward compat with old env vars | ✅ Done | `DAILY_QUOTA_LIMIT` fallback preserved |
| Spec item | Job pausing on monthly quota | ✅ Done | PAUSED status with error message in job service |
| Spec item | `GET /api/geocode/monthly-quota` endpoint | ✅ Done | Returns all API monthly statuses |

---

## 3. Findings

### CRITICAL — Must Fix

#### C1. Batch Endpoint Creates Job BEFORE Monthly Quota Check

**File:** `backend/routes/geocode.js`, lines 65–78  
**Issue:** The `POST /api/geocode/batch` handler calls `jobService.createJob()` (line 65) which triggers `setImmediate(() => this.processJob(jobId))` — starting async processing — BEFORE the monthly quota check on lines 68–78. Even if the 429 response is sent, the job is already created and running.

**Spec Reference:** Section 3.9C specifies the pre-check should happen BEFORE creating the job.

**Impact:** When monthly quota is exhausted, a geocoding job will be created and start executing before the endpoint returns 429. The inner `processJob()` loop does have its own monthly check (which will pause the job), but there's a race condition and the response is misleading — it returns 429 suggesting the job wasn't started, but it was.

**Fix:** Move the monthly quota check above `jobService.createJob()`:
```javascript
// Check monthly quota FIRST
const quotaManager = new QuotaManager();
const monthlyStatus = await quotaManager.getMonthlyQuotaStatus('geocoding');
if (monthlyStatus.isExhausted) {
    return res.status(429).json({ ... });
}
// THEN create the job
const jobId = await jobService.createJob(targetVoterIds, options);
```

#### C2. `estimatedApiCalls` Not Used in Pre-Check Comparison

**File:** `backend/routes/geocode.js`, lines 70–72  
**Issue:** The spec calls for checking `monthlyStatus.used + estimatedApiCalls > monthlyStatus.limit`, but the code only checks `monthlyStatus.isExhausted` (i.e., usage already at/over limit). This means a batch of 5,000 addresses won't be blocked even if only 100 requests remain.

The `estimatedApiCalls` variable is computed but never actually used in any comparison.

**Fix:** Add a projected-usage check:
```javascript
if (monthlyStatus.isExhausted || (monthlyStatus.used + estimatedApiCalls > monthlyStatus.limit)) {
    return res.status(429).json({
        ...
        estimatedApiCalls,
        suggestion: `Reduce batch to ~${monthlyStatus.remaining * 5} addresses (est. ${monthlyStatus.remaining} API calls) or wait until quota resets`
    });
}
```

---

### RECOMMENDED — Should Fix

#### R1. `.env.example` Not Updated

**File:** `.env.example`, line 82–84  
**Issue:** Still contains outdated documentation:
- Comment says "Google provides 40,000 free requests per month (~1,333/day)" — should say 10,000
- Default value is `DAILY_QUOTA_LIMIT=10000` — doesn't match the new 333/day default
- Missing new environment variables: `MONTHLY_GEOCODING_LIMIT`, `MONTHLY_DISTANCE_MATRIX_LIMIT`, `MONTHLY_DYNAMIC_MAPS_LIMIT`, `MONTHLY_DIRECTIONS_LIMIT`, `DAILY_GEOCODING_QUOTA`, `DAILY_DISTANCE_MATRIX_QUOTA`, `DAILY_DIRECTIONS_QUOTA`

**Spec Reference:** Section 3.8 explicitly lists .env.example updates.

**Fix:** Update section to:
```dotenv
# Monthly hard caps (Google Maps free tier = 10,000/month per API)
MONTHLY_GEOCODING_LIMIT=10000
MONTHLY_DISTANCE_MATRIX_LIMIT=10000
MONTHLY_DYNAMIC_MAPS_LIMIT=10000
MONTHLY_DIRECTIONS_LIMIT=10000

# Daily safety limits (10,000/month ÷ 30 = ~333/day)
DAILY_GEOCODING_QUOTA=333
DAILY_DISTANCE_MATRIX_QUOTA=333
DAILY_DIRECTIONS_QUOTA=100

# [DEPRECATED] Use DAILY_GEOCODING_QUOTA instead
# DAILY_QUOTA_LIMIT=10000
```

#### R2. No Pre-Check for Dynamic Maps Quota Before Loading Google Maps Script

**File:** `frontend/src/pages/MapView.js`, lines 119–133  
**Issue:** The spec (Section 3.4B) calls for checking whether the Dynamic Maps monthly quota is exhausted BEFORE loading the Google Maps script, and displaying a quota-exceeded message instead of the map. Currently, the map loads first and tracking happens AFTER — so the user consumes a billable map load even when the quota is exhausted.

**Fix:** Before `loadGoogleMapsScript()`, check monthly quota:
```javascript
const quotaResp = await fetchMonthlyQuota();
if (quotaResp?.monthly?.dynamic_maps?.isExhausted) {
    container.querySelector('#map-canvas').innerHTML = `<div>Monthly Map Quota Exceeded</div>`;
    return;
}
await loadGoogleMapsScript(config.googleMapsApiKey);
```

#### R3. `track-map-load` Endpoint Error Handling Inconsistency

**File:** `backend/routes/geocode.js`, lines 508–527  
**Issue:** The `POST /api/geocode/track-map-load` and `GET /api/geocode/monthly-quota` endpoints catch errors and return `res.status(500).json(...)` directly, whereas all other endpoints in the same router use `next(error)` to delegate to Express error middleware. This inconsistency means global error handlers (logging, formatting) won't apply to these endpoints.

**Fix:** Change both endpoints to use the `next(error)` pattern or add `(req, res, next)` signature and call `next(error)`.

#### R4. Multiple QuotaManager Instantiations Per Request

**File:** `backend/routes/geocode.js` (lines 68, 340, 510, 535)  
**Issue:** `new QuotaManager()` is created inline in the batch endpoint, stats endpoint, track-map-load, and monthly-quota handlers. The `jobService` already has `this.quotaManager` as an instance property. Creating multiple instances isn't harmful (no shared state to corrupt), but it's inconsistent with the pattern used in the services layer.

**Fix:** Either use a shared module-level instance:
```javascript
const quotaManager = new QuotaManager();
```
Or access `jobService.quotaManager` where the jobService is already in scope.

---

### OPTIONAL — Nice to Have

#### O1. `PAUSED` Not Checked in Active Jobs Guard

**File:** `backend/services/geocoding-job-service.js`, line 43  
**Issue:** The `createJob()` method checks for active jobs with `status IN ('PENDING', 'PROCESSING')`, but doesn't include `'PAUSED'`. A paused job (from monthly quota exhaustion) could coexist with a new job creation, potentially leading to data races if the paused job resumes (e.g., manual status change or restart).

**Fix:** Consider including `'PAUSED'` in the active jobs check.

#### O2. `quota_remaining` Column Still Unused

**File:** `api_usage` table schema  
**Issue:** The `quota_remaining` column is always `NULL`. Could be populated with `monthlyLimit - monthlyUsage` for convenient querying, but this is noted as optional in the spec.

#### O3. Frontend Could Display Dynamic Maps Monthly Usage

**File:** `frontend/src/pages/MapView.js`  
**Issue:** The geocoding stats panel displays monthly geocoding usage, but there's no visible UI for Dynamic Maps monthly usage. Users can't see how many map loads they've consumed.

---

## 4. Code Quality Analysis

### Best Practices ✅
- Proper JSDoc documentation on all new methods
- Consistent error handling with descriptive error messages
- Error objects include metadata (`isMonthlyExhausted`, `monthlyUsage`, `monthlyLimit`, `resetDate`)
- `COALESCE(SUM())` prevents NULL in SQL aggregation
- Warning thresholds at 70/80/90/95% with console warnings
- Backward compatibility maintained for old env var names

### Consistency ✅
- Monthly quota check follows same pattern as daily check
- Error thrown with `.quotaError = true` flag — matches existing convention
- Database queries use parameterized statements throughout
- Services layer delegates to QuotaManager — single source of truth
- Frontend API client follows same `export const fn = () => method(path)` pattern

### Maintainability ✅
- Clear separation: QuotaManager handles all quota logic, services consume it
- Monthly limits configurable via environment variables
- No hardcoded magic numbers (defaults are documented)
- Frontend warning thresholds (80%, 95%) match backend warning pattern

### Security ✅
- No SQL injection vectors (all queries parameterized)
- No sensitive data exposed in API responses
- API key validation preserved in geocoding and distance matrix services
- Rate limiting via Bottleneck still in place

### Performance
- `getMonthlyUsage()` runs `SUM(call_count)` query on `api_usage` table each time — this table is indexed by `(api_name, call_date)` unique constraint, so the query should be performant
- Monthly check adds one additional DB query per API call — acceptable overhead
- Frontend `trackMapLoad()` is fire-and-forget with a `try/catch` that warns on failure — non-blocking

---

## 5. Summary Score Table

| Category | Score | Grade | Notes |
|----------|-------|-------|-------|
| Specification Compliance | 85% | B+ | 2 items not implemented (.env.example, batch pre-check order) |
| Best Practices | 95% | A | Excellent documentation, error handling, env var config |
| Functionality | 90% | A- | Monthly enforcement works; batch pre-check has order bug |
| Code Quality | 95% | A | Clean, well-documented, follows existing patterns |
| Security | 100% | A+ | No new vulnerabilities introduced |
| Performance | 95% | A | Acceptable overhead; monthly query uses indexed columns |
| Consistency | 90% | A- | Minor inconsistency in error handling pattern (R3, R4) |
| Build Success | 100% | A+ | All 9 files pass syntax validation |

---

**Overall Grade: A- (93%)**

---

## 6. Overall Assessment: **NEEDS_REFINEMENT**

Two CRITICAL issues must be addressed before approval:
1. **C1**: Batch endpoint creates job before quota check — fix ordering
2. **C2**: `estimatedApiCalls` unused — add projected-usage comparison

Additionally, RECOMMENDED items R1 (.env.example) and R2 (frontend pre-check) should be addressed for full spec compliance.

---

## 7. Affected File Paths

### Files Reviewed
- `backend/services/quota-manager.js`
- `backend/routes/geocode.js`
- `backend/services/geocoding-job-service.js`
- `backend/services/geocoding-service.js`
- `backend/services/distance-matrix-service.js`
- `backend/routes/routes.js`
- `backend/server.js`
- `frontend/src/api/client.js`
- `frontend/src/pages/MapView.js`
- `.env.example`

### Files Requiring Changes
| Priority | File | Issue |
|----------|------|-------|
| CRITICAL | `backend/routes/geocode.js` | C1: Move quota check before job creation; C2: Use estimatedApiCalls |
| RECOMMENDED | `.env.example` | R1: Update documentation and add new env vars |
| RECOMMENDED | `frontend/src/pages/MapView.js` | R2: Pre-check dynamic maps quota before script load |
| RECOMMENDED | `backend/routes/geocode.js` | R3: Use `next(error)` in track-map-load and monthly-quota |
| RECOMMENDED | `backend/routes/geocode.js` | R4: Use shared QuotaManager instance |
| OPTIONAL | `backend/services/geocoding-job-service.js` | O1: Include PAUSED in active jobs check |
