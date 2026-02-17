# Moderate & Minor Issues — Current State Assessment

**Date:** 2026-02-16  
**Scope:** Research each MOD-xx and MIN-xx issue from the Comprehensive Issue Plan and determine current status.

---

## Summary

| ID | Title | Status | Priority |
|----|-------|--------|----------|
| MOD-01 | `sanitizeInput()` Used Incorrectly | **FIXED** | — |
| MOD-02 | Precincts Route Stub Endpoints | **STILL EXISTS** | Moderate |
| MOD-03 | `totalElections` Count Is Global | **FIXED** (in voter detail) | — |
| MOD-04 | No Error Boundary for Template Loading | **FIXED** | — |
| MOD-05 | Toast Container May Not Exist | **FIXED** | — |
| MOD-06 | `isValidCoordinates()` Fails for String Coordinates | **FIXED** | — |
| MOD-07 | Database Connection Not Closed on Import Errors | **FIXED** | — |
| MOD-08 | Upload UI file accept attribute | **FIXED** | — |
| MIN-01 | Temp files in root | **STILL EXISTS** | Minor |
| MIN-02 | No Input Length Limits | **STILL EXISTS** | Minor |
| MIN-03 | Console Logging in Production | **STILL EXISTS** | Minor |
| MIN-04 | Election History Sort | **STILL EXISTS** | Minor |
| MIN-05 | CSS Build May Be Stale | **FIXED** | — |
| MIN-06 | `window.app.filterController` Coupling | **STILL EXISTS** | Minor |

**Issues still requiring fixes: 6** (1 Moderate, 5 Minor)

---

## Detailed Findings

---

### MOD-01: `sanitizeInput()` Used Incorrectly

**Status: FIXED**

**Analysis:**  
The original issue reported that `Utils.sanitizeInput()` was being applied to API query parameters in `frontend/public/js/filter-controller.js` around line 89. This would HTML-encode characters before sending them to the backend, corrupting search queries containing apostrophes (e.g., `O'Brien` → `O&#x27;Brien`).

**Current state:**  
- `filter-controller.js` lines 83–98: Search input values use `e.target.value.trim()` directly (stored as `rawValue`), with **no call to `sanitizeInput()`**.
- The `sanitizeInput()` function still exists in `frontend/public/js/utils.js` (line 127) and is available for legitimate use cases (DOM rendering), but is **not misused on API parameters**.

**No action needed.**

---

### MOD-02: Precincts Route Stub Endpoints

**Status: STILL EXISTS**

**File:** `backend/routes/precincts.js`

**Evidence:**  
- **Line 94:** `GET /:number/voters` returns `{ message: 'Precinct voters endpoint - Implementation pending', phase: 2 }`
- **Line 122:** `GET /:number/stats` returns `{ message: 'Precinct statistics endpoint - Implementation pending', phase: 4 }`

Both endpoints are complete stubs that return placeholder JSON.

**Fix required:**  
Either:
1. **Implement** the endpoints using `VoterModel` queries filtered by precinct, OR
2. **Return proper 501 Not Implemented** HTTP status codes instead of 200 with a misleading "success" response:
   ```js
   res.status(501).json({ 
     error: 'Not implemented',
     message: 'Precinct voters endpoint is planned for Phase 2' 
   });
   ```
3. Alternatively, remove the stubs entirely if they are not referenced by the frontend.

**Files to modify:** `backend/routes/precincts.js` (lines 90–130)

---

### MOD-03: `totalElections` Count Is Global

**Status: FIXED** (in the voter detail/list context)

**Analysis:**  
The original issue flagged `SELECT COUNT(DISTINCT election_code) FROM election_history` as a global count used for individual voter participation rates.

**Current state:**  
- **Voter list query** (`backend/models/voter.js` lines 352–357): The `totalElections` subquery now counts elections **per voter** — `SELECT COUNT(*) FROM election_history WHERE election_history.voter_id = v.voter_id`. This is correct; it counts the voter's own election history records.
- **`recalculateAllSuperVoters()`** (`backend/models/voter.js` line 563): Still uses the global `COUNT(DISTINCT election_code) FROM election_history`, but this is **intentionally global** — it determines how many elections exist in the dataset to calibrate the super-voter threshold dynamically. This is correct behavior.

**No action needed.** The per-voter participation rate uses voter-specific counts. The global count in `recalculateAllSuperVoters()` is by design.

---

### MOD-04: No Error Boundary for Template Loading

**Status: FIXED**

**Analysis:**  
The concern was that `TemplateLoader.loadAll()` in `index.html` would crash the app if template fetching failed.

**Current state:**  
- `frontend/public/js/template-loader.js`:
  - `load()` (line 20) wraps fetch in try/catch, returns `false` on failure.
  - `loadAll()` (line 55) uses `Promise.allSettled()` — all templates load in parallel and individual failures don't prevent other templates from loading.
  - Failures are logged via `Logger.error()` but don't propagate exceptions.
- `index.html` (line 1284): `await TemplateLoader.loadAll()` is inside a try/catch block (lines 1274-1340) that shows a user-friendly error screen on failure.

**No action needed.** Template loading is resilient to individual failures and the outer initialization has error handling.

---

### MOD-05: Toast Container May Not Exist

**Status: FIXED**

**Analysis:**  
The concern was that `showToast()` might fail if `#toast-container` doesn't exist in the DOM.

**Current state:**  
- `frontend/public/js/utils.js` (line 53): `showToast()` delegates to `window.Toast.show()` (the `ToastController`), with a fallback to `Logger.info()` if Toast isn't loaded.
- `frontend/public/js/toast-controller.js` (line 20-28): `init()` dynamically creates `.vp-toast-container` if it doesn't exist in the DOM:
  ```js
  this.container = document.querySelector('.vp-toast-container');
  if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'vp-toast-container';
      document.body.appendChild(this.container);
  }
  ```
- Additionally, `index.html` line 1019 has a static `#toast-container` div.

**No action needed.** The toast system has both a static fallback element and dynamic creation.

---

### MOD-06: `isValidCoordinates()` Fails for String Coordinates

**Status: FIXED**

**File:** `frontend/public/js/utils.js` (line 217)

**Current state:**  
The function uses `parseFloat()` instead of `typeof` checks:
```js
isValidCoordinates(lat, lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    return (
      !isNaN(latNum) && !isNaN(lngNum) &&
      latNum >= -90 && latNum <= 90 &&
      lngNum >= -180 && lngNum <= 180
    );
}
```

**No action needed.** String coordinates like `"36.5"` are correctly handled via `parseFloat()`.

---

### MOD-07: Database Connection Not Closed on Import Errors

**Status: FIXED**

**File:** `backend/services/import-processor.js`

**Current state:**  
- The `processImport()` function (line 25) has a try/catch block around the entire import workflow.
- On error (line 112), it updates the import status to 'failed' before re-throwing.
- Individual record processing in `processBatch()` (line 133) handles per-record errors gracefully — failed records are logged but don't abort the batch.
- The application uses a singleton SQLite connection via `better-sqlite3` (managed by `config/database.js`), so there's no connection leak concern — there's no per-request connection to forget closing.

**No action needed.** The import processor handles errors at both batch and record levels, and the database connection model doesn't require per-import close.

---

### MOD-08: Upload UI File Accept Attribute

**Status: FIXED**

**File:** `frontend/public/templates/upload-modal.html` (line 32)

**Current state:**  
```html
<input type="file" id="fileInput" class="visually-hidden" accept=".dbf,.csv" aria-label="Select voter data file">
```

**No action needed.** The `accept` attribute is properly set.

---

### MIN-01: Temp Files in Root

**Status: STILL EXISTS**

**Evidence:**  
- Multiple `tmpclaude-*` directories exist in the project root (22+ directories visible in workspace structure).
- `.gitignore` (checked lines 1–56) does **not** contain any pattern for `tmpclaude*` or similar temp patterns.

**Fix required:**
1. Add `tmpclaude-*` pattern to `.gitignore`
2. Delete the existing `tmpclaude-*` directories
3. Consider also adding a general `tmp*` or `tmpclaude*` pattern

**File to modify:** `.gitignore`  
**Directories to delete:** All `tmpclaude-*-cwd` directories in project root

---

### MIN-02: No Input Length Limits

**Status: STILL EXISTS**

**Evidence:**  
No `maxlength` attribute found in any frontend file:
- `frontend/public/index.html` line 157-162: `#searchInput` — no `maxlength`
- `frontend/public/templates/filter-offcanvas.html` line 13: `#searchInputMobile` — no `maxlength`
- `frontend/public/index.html` line 935: `#targetSearchInput` — no `maxlength`
- `frontend/public/index.html` line 1095-1099: `#voterSelectionSearchInput` — no `maxlength`

**Fix required:**  
Add `maxlength="100"` (or similar reasonable limit) to all text search inputs:

| File | Element ID | Line |
|------|-----------|------|
| `frontend/public/index.html` | `searchInput` | ~159 |
| `frontend/public/templates/filter-offcanvas.html` | `searchInputMobile` | ~13 |
| `frontend/public/index.html` | `targetSearchInput` | ~935 |
| `frontend/public/index.html` | `voterSelectionSearchInput` | ~1097 |

Additionally, add server-side length validation in the backend query handlers.

---

### MIN-03: Console Logging in Production

**Status: STILL EXISTS**

**File:** `backend/server.js`

**Evidence:**  
15 `console.log` statements found throughout `server.js`:
- Line 43: Working directory log
- Line 162: Database stats
- Lines 410, 467, 472-474, 479, 493, 501-502: Shutdown logging
- Lines 517-520: Startup banner

Additionally, `backend/services/import-processor.js` has numerous `console.log` and `console.warn` calls throughout the import pipeline.

**Fix required:**  
Replace raw `console.log()` calls with a structured logger (or the existing `Logger` pattern used in frontend) that respects `NODE_ENV`:
- In production: suppress debug/info logs, only show warnings and errors
- In development: show all logs

Alternatively, conditionally wrap with:
```js
if (process.env.NODE_ENV !== 'production') {
    console.log(...);
}
```

**Primary files to modify:**
- `backend/server.js`
- `backend/services/import-processor.js`

---

### MIN-04: Election History Sort

**Status: STILL EXISTS**

**File:** `backend/models/voter.js`

**Evidence:**  
Election history queries use `ORDER BY election_code DESC` at multiple locations:
- Line 187: `ORDER BY election_code` (ascending — for voter detail view)
- Line 342: `ORDER BY election_code DESC` (for mostRecentParty subquery)
- Line 490: `ORDER BY election_code DESC` (for super voter calculation)
- Line 600: `ORDER BY election_code DESC` (for recalculateAllSuperVoters)

**The problem:** Election codes are typically strings like `"2024G"`, `"2024P"`, `"2022G"`. Lexicographic sorting of these codes works correctly for year ordering (2022 < 2024) but may not correctly differentiate election types within the same year (e.g., `"2024G"` > `"2024P"` alphabetically, but the General election typically occurs after the Primary).

**Fix required:**  
This depends on the actual election code format used. If codes follow the pattern `YYYYX` (year + type letter), the current sort works *adequately* in most cases because:
- Year sorting is correct lexicographically
- Within the same year, `G` (General) < `P` (Primary) alphabetically — which is backwards chronologically

**Recommended fix:** Add an `election_date` column to `election_history` and sort by that, OR create a mapping function that converts election codes to sortable dates. Alternatively, if the data only has one election per year, the current sort is effectively correct.

**Files to modify:** `backend/models/voter.js` (lines 187, 342, 490, 600)

---

### MIN-05: CSS Build May Be Stale

**Status: FIXED**

**File:** `package.json` (line 9)

**Current state:**  
```json
"prestart": "npm run build:css && powershell -ExecutionPolicy Bypass -File scripts/cleanup-port.ps1"
```

The `prestart` script automatically rebuilds CSS before every `npm start`, ensuring output.css is never stale.

**No action needed.**

---

### MIN-06: `window.app.filterController` Coupling

**Status: STILL EXISTS**

**File:** `frontend/public/js/voter-list-controller.js`

**Evidence:**  
4 direct references to `window.app.filterController`:
- **Line 714-715:** Page size change handler: `window.app.filterController.changePageSize(newSize)`
- **Line 848-849:** Pagination click handler: `window.app.filterController.goToPage(pageNumber)`

The `VoterListController` directly accesses the `filterController` through the global `window.app` object, creating tight coupling between the two controllers.

**Fix required:**  
Decouple by using one of:
1. **Event-based communication:** Emit custom events instead of direct calls:
   ```js
   document.dispatchEvent(new CustomEvent('voter:pageSize', { detail: { size: newSize }}));
   ```
2. **Dependency injection:** Pass filterController as a constructor parameter:
   ```js
   constructor(filterController) {
       this.filterController = filterController;
   }
   ```
3. **Callback pattern:** Accept callbacks for page changes in constructor options.

**Files to modify:** `frontend/public/js/voter-list-controller.js` (lines 714-715, 848-849)

---

## Implementation Plan

### Phase 1: Quick Fixes (Minimal Risk)

1. **MIN-01** — Add `tmpclaude*` to `.gitignore`, delete temp directories
2. **MIN-02** — Add `maxlength` attributes to all search inputs
3. **MOD-02** — Change stub endpoints to return 501 status

### Phase 2: Moderate Changes

4. **MIN-03** — Wrap console.log calls in environment checks or use structured logger
5. **MIN-06** — Refactor `window.app.filterController` coupling via events or DI

### Phase 3: Data-Dependent

6. **MIN-04** — Audit election code format, implement proper date-based sorting if needed

---

## Files Requiring Changes

| File | Issues |
|------|--------|
| `.gitignore` | MIN-01 |
| `backend/routes/precincts.js` | MOD-02 |
| `backend/server.js` | MIN-03 |
| `backend/services/import-processor.js` | MIN-03 |
| `backend/models/voter.js` | MIN-04 |
| `frontend/public/index.html` | MIN-02 |
| `frontend/public/templates/filter-offcanvas.html` | MIN-02 |
| `frontend/public/js/voter-list-controller.js` | MIN-06 |
