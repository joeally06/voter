# Major Issues — Code Review

**Date:** February 16, 2026  
**Reviewer:** Automated Code Review  
**Reference Spec:** `.github/docs/SubAgent docs/MAJOR_ISSUES_SPEC.md`  
**Build Status:** SUCCESS (all `node -c` syntax checks passed)

---

## Overall Assessment: **NEEDS_REFINEMENT**

Two spec requirements were not implemented, and one issue fix (MAJ-01) was only partially completed — with 18 additional snake_case fallback instances missed in `route-planner-controller.js`.

---

## Findings by Issue

### MAJ-01: Voter Data Field Name Mismatch (snake_case Removal)

**Status: PARTIALLY IMPLEMENTED**

#### `frontend/public/js/map-controller.js` — FULLY COMPLETE

All snake_case fallbacks have been removed per spec:
- Line 194: `voter.voterId` only (no `voter.voter_id` fallback) ✅  
- Line 212: `voter.voterId` only ✅  
- Line 246: `voter.firstName` / `voter.lastName` only ✅  
- Line 297: `voter.superVoter` only ✅  
- Lines 333–338: All fallbacks removed ✅  
- Line 354: `voter.superVoter` only ✅  

Grep search confirms zero remaining snake_case references in this file.

#### `frontend/public/js/route-planner-controller.js` — INCOMPLETE

**CRITICAL**: The spec listed 4 line-level fixes (lines 160, 342, 344, 365). Those 4 were implemented correctly. However, **18 additional snake_case fallback instances** exist throughout the file that the spec did not identify and the implementation did not address:

| Line | Code | Fallback Pattern |
|------|------|-----------------|
| 208 | `v.voterId \|\| v.voter_id` | `voter_id` in modal initialization |
| 256 | `v.precinctNumber \|\| v.precinct_number` | `precinct_number` in search filter |
| 265 | `v.voterId \|\| v.voter_id` | `voter_id` in valid-ID filter |
| 483 | `v.superVoter \|\| v.super_voter \|\| v.is_super_voter` | `super_voter`, `is_super_voter` in super-voter quick-select |
| 484 | `(v.voterId \|\| v.voter_id)` × 2 | `voter_id` in super-voter filter |
| 501 | `v.voterId \|\| v.voter_id` | `voter_id` in super-voter add loop |
| 573 | `v.voterId \|\| v.voter_id` | `voter_id` in `confirmModalSelection()` |
| 1455 | `loc.voterId \|\| loc.voter_id` | `voter_id` in JSON export |
| 1462 | `loc.firstName \|\| loc.first_name` | `first_name` in JSON export |
| 1463 | `loc.lastName \|\| loc.last_name` | `last_name` in JSON export |
| 1538 | `loc.voterId \|\| loc.voter_id` | `voter_id` in CSV export |
| 1539 | `loc.firstName \|\| loc.first_name` | `first_name` in CSV export |
| 1540 | `loc.lastName \|\| loc.last_name` | `last_name` in CSV export |
| 1637 | `loc.firstName \|\| loc.first_name` | `first_name` in print view |
| 1637 | `loc.lastName \|\| loc.last_name` | `last_name` in print view |
| 1637 | `loc.voterId \|\| loc.voter_id` | `voter_id` in print view |

**Severity: CRITICAL** — These are the same class of dead-code fallback that MAJ-01 was designed to remove. Leaving them creates inconsistency and masks potential data flow bugs.

---

### MAJ-03: Service Worker Network-First for JS/CSS

**Status: FULLY IMPLEMENTED** ✅

The fetch event handler in `frontend/public/sw.js` now includes a JS/CSS check *before* the cache-first fallback:

```javascript
// JS and CSS files: network-first to always get latest code
if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(networkFirstWithCache(event.request));
    return;
}
```

- Correctly placed after HTML/navigation check and before the generic cache-first fallback
- Other static assets (images, fonts, manifest) remain on cache-first — preserves performance
- No issues introduced

---

### MAJ-04: Database `getStats()` — `safeCount()` Helper

**Status: PARTIALLY IMPLEMENTED**

#### `backend/config/database.js` — IMPLEMENTED (minor deviation) ✅

The `safeCount()` helper was implemented with a slightly different signature than spec:

| Aspect | Spec | Implementation |
|--------|------|----------------|
| Signature | `safeCount(query, label)` | `safeCount(query, defaultVal = 0)` |
| Result access | `result?.count ?? 0` | `result ? Object.values(result)[0] : defaultVal` |
| Warning msg | `⚠️ getStats: Failed to query ${label}: ${error.message}` | `Stats query failed: ${e.message}` |

**Assessment:** Functionally equivalent. The `Object.values(result)[0]` approach is more generic (doesn't rely on the alias name). The warning message is less descriptive but adequate. **OPTIONAL** improvement: add the `label` parameter for better diagnostics.

#### `backend/server.js` Health Endpoint — **NOT IMPLEMENTED**

**CRITICAL**: The spec required the health endpoint to handle `null` stats with `status: 'degraded'`:

```javascript
// SPEC REQUIRED:
status: stats ? 'healthy' : 'degraded',
database: stats || { error: 'Unable to retrieve database statistics' },

// CURRENT (unchanged):
status: 'healthy',
database: stats,
```

If `getStats()` returns `null` (outer catch triggered), the health endpoint reports `status: 'healthy'` with `database: null` — misleading for monitoring tools.

**Severity: CRITICAL** — Defeats the purpose of the `safeCount()` resilience pattern since the health endpoint doesn't reflect degraded state.

---

### MAJ-05: Rate Limiter Split (Read vs Write)

**Status: FULLY IMPLEMENTED** ✅

The implementation uses a dispatcher middleware approach instead of the spec's `skip`-function approach:

```javascript
// IMPLEMENTATION (cleaner than spec):
app.use('/api/', (req, res, next) => {
    if (req.method === 'GET') {
        apiReadLimiter(req, res, next);
    } else {
        apiWriteLimiter(req, res, next);
    }
});
```

| Aspect | Value |
|--------|-------|
| Read limit | 1000 requests / 15 min ✅ |
| Write limit | 100 requests / 15 min ✅ |
| Upload limiter | GET-skip preserved ✅ |

**Assessment:** The dispatcher approach is arguably *better* than the spec's dual-middleware with `skip` functions, because only one limiter runs per request instead of two (one skipping). No issues.

---

### MAJ-06: Geocoding State Column

**Status: PARTIALLY IMPLEMENTED**

#### `backend/services/geocoding-job-service.js` — IMPLEMENTED ✅

Warning log added at line 173:
```javascript
if (!voter.state) {
    console.warn(`⚠️ Voter ${voter.id} missing state, defaulting to TN`);
}
```

Correctly placed before the cache lookup, ensuring the warning fires on every affected voter. No issues.

#### `backend/services/import-processor.js` — **NOT IMPLEMENTED**

The spec required adding `'state'` to the `requiredFields` array (line 211). The current array still only contains:
```javascript
const requiredFields = [
    'voter_id', 'last_name', 'first_name', 
    'address', 'city', 'zip_code', 'precinct_number'
];
```

`'state'` is absent. Records imported without a `state` field will pass validation, get stored as `NULL`, and silently fall back to `'TN'` during geocoding.

**Severity: RECOMMENDED** — For the current TN-only dataset this has no impact, but it creates a data integrity gap if multi-state data is ever imported.

---

## Summary of Findings

### CRITICAL (must fix)

| # | Finding | File | Lines |
|---|---------|------|-------|
| C1 | 18 snake_case fallback instances not removed | `route-planner-controller.js` | 208, 256, 265, 483–484, 501, 573, 1455, 1462–1463, 1538–1540, 1637 |
| C2 | Health endpoint does not report `'degraded'` status when stats are null | `backend/server.js` | 291–292 |

### RECOMMENDED (should fix)

| # | Finding | File | Lines |
|---|---------|------|-------|
| R1 | `'state'` not added to import-processor `requiredFields` | `backend/services/import-processor.js` | 211–219 |
| R2 | `safeCount()` warning message lacks table label for diagnostics | `backend/config/database.js` | 266 |

### OPTIONAL (nice to have)

| # | Finding | File | Lines |
|---|---------|------|-------|
| O1 | Service worker `CACHE_NAME` still has hardcoded date `20260215` — consider build-time hash | `frontend/public/sw.js` | 8 |

---

## Build Validation

```
> node -c backend/server.js              ✅ PASSED
> node -c backend/config/database.js     ✅ PASSED
> node -c backend/services/geocoding-job-service.js  ✅ PASSED
```

**Build Result: SUCCESS** — All modified backend files have valid JavaScript syntax.

---

## Summary Score Table

| Category | Score | Grade | Notes |
|----------|-------|-------|-------|
| Specification Compliance | 65% | D | 2 spec items not implemented, 1 partially |
| Best Practices | 90% | A- | safeCount pattern, rate limiter split done well |
| Functionality | 80% | B- | Core fixes work; missed snake_case instances are dead code but inconsistent |
| Code Quality | 85% | B+ | Clean implementation where applied; minor diagnostic gaps |
| Security | 95% | A | Rate limiter correctly protects mutation endpoints |
| Performance | 100% | A+ | Network-first for JS/CSS, dispatcher limiter approach efficient |
| Consistency | 60% | D- | Half the snake_case instances cleaned, half remain — worst outcome for consistency |
| Build Success | 100% | A+ | All syntax checks pass |

**Overall Grade: C+ (72%)**

---

## Affected Files

| File | Status |
|------|--------|
| `backend/server.js` | MAJ-05 ✅, MAJ-04 health endpoint ❌ |
| `frontend/public/js/map-controller.js` | MAJ-01 ✅ |
| `frontend/public/js/route-planner-controller.js` | MAJ-01 partial (4/22 instances) ❌ |
| `frontend/public/sw.js` | MAJ-03 ✅ |
| `backend/config/database.js` | MAJ-04 safeCount ✅ (minor deviation) |
| `backend/services/geocoding-job-service.js` | MAJ-06 state warning ✅ |
| `backend/services/import-processor.js` | MAJ-06 state required field ❌ |
