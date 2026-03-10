# Comprehensive Issue Audit & Fix Plan

**Date:** February 16, 2026 (Updated: March 10, 2026)  
**Audited by:** GitHub Copilot  
**Scope:** Full codebase audit — backend, frontend, configuration, infrastructure

---

## 🎯 Implementation Status

| Phase | Status | Grade | Completed |
|-------|--------|-------|----------|
| **Critical Issues (CRIT-01 to CRIT-04)** | ✅ COMPLETE | A+ (98%) | Feb 17, 2026 |
| **Major Issues (MAJ-01 to MAJ-06)** | ✅ COMPLETE | A+ (98%) | Mar 10, 2026 |
| **Moderate Issues (MOD-01 to MOD-08)** | 🔄 PENDING | — | — |
| **Minor Issues (MIN-01 to MIN-06)** | 🔄 PENDING | — | — |

---

## Reference Data Format

The app processes Tennessee voter registration CSV files. The reference file is **`LEWIS - DIST. 2.csv`** (Lewis County, District 2). Understanding this format is essential for all fixes.

### CSV Column Structure

| Column | Example | Maps To (DB) | Notes |
|--------|---------|---------------|-------|
| `STATE_ID` | `31001` | `voter_id` | Unique state voter identifier |
| `LNAME` | `AANONSEN` | `last_name` | Last name (uppercase) |
| `FNAME` | `NICHOLAS R` | `first_name` | First name + middle initial (uppercase) |
| `TITLE` | `MR`, `MRS`, `JR` | *(not stored)* | Honorific — often empty |
| `ADDRESS` | `557 S THOMPSON ST` | `address` | Street address |
| `ADDRESS2` | `APT 307` | *(partial)* | Secondary address — often empty |
| `CITY` | `WOODLAND MILLS` | `city` | City name |
| `STATE` | `TN` | `state` | State abbreviation — always `TN` in this dataset |
| `ZIP` | `38271` or `38261-7295` | `zip_code` | ZIP code, some with +4 extension |
| `DOB` | `1957-12-17` | `date_of_birth` | Date of birth (YYYY-MM-DD) |
| `PCT_NBR` | `2-4`, `2-1` | `precinct_number` | Precinct number (district-precinct format) |
| `MAIL` | `557 S THOMPSON ST` | *(not stored)* | Mailing address |
| `MAIL2` | *(empty)* | *(not stored)* | Mailing address line 2 |
| `MAILCITY` | `UNION CITY` | *(not stored)* | Mailing city |
| `MAILSTATE` | `TN` | *(not stored)* | Mailing state |
| `MAILZIP` | `38261` | *(not stored)* | Mailing ZIP |
| `MNAME` | *(empty)* | *(not stored)* | Middle name — often empty |
| `E_1` | `YDY`, `YRN`, `NRY` | `election_history` | Election 1 voting record |
| `E_2` | `YRY`, `YDN`, *(empty)* | `election_history` | Election 2 voting record |

### Election History Code Format (E_1, E_2, etc.)

Each election column contains a **3-character code** (or is empty for no participation):

| Position | Values | Meaning |
|----------|--------|---------|
| 1st char | `Y` / `N` | **Voted** — Y = voted, N = did not vote |
| 2nd char | `D` / `R` / `G` / `I` / ` ` | **Party** — Democrat, Republican, Green, Independent, or blank |
| 3rd char | `Y` / `N` | **Early Voted** — Y = early/absentee, N = election day |

Examples: `YDY` = Voted, Democrat, Early voted · `YRN` = Voted, Republican, Election day · `NRY` = Did not vote (rest ignored) · *(empty)* = No participation data

### Key Data Characteristics

- **Geography:** All voters in Union City / Woodland Mills, TN (ZIP 38261/38271)
- **Precinct format:** `2-1`, `2-4` — the app's `sanitizePrecinct()` function needs to handle this hyphenated format
- **CSV header mapping:** Headers like `LNAME` → `last_name`, `STATE_ID` → `voter_id`, `PCT_NBR` → `precinct_number` are handled in `csv-parser.js` field mappings
- **Election columns are dynamic:** The CSV can have `E_1` through `E_N` — the parser uses regex `/^e_(\d+)$/i` to find all of them
- **Party codes from election data** (position 2 of E_* values) are mapped to the `party_affiliation` field — this is the ONLY source of party data in the CSV
- **`TITLE` column** includes suffixes like `JR` alongside honorifics like `MR`/`MRS` — currently discarded during import

### Data Relevance to Known Issues

| Issue | Data Connection |
|-------|-----------------|
| **CRIT-01** (Geocoding) | Addresses like `557 S THOMPSON ST, WOODLAND MILLS, TN 38271` should be geocodable via Google Maps API |
| **CRIT-03** (Filters) | Precinct numbers are `2-1`, `2-4` — filter must match this exact format, not zero-padded versions |
| **MOD-03** (totalElections) | Only 2 election columns (`E_1`, `E_2`) in this file — a voter with `YDY` in E_1 and empty E_2 voted in 1 of 2 elections (50%), not 1 of 8 |
| **MAJ-06** (State column) | All records have `STATE=TN` — the hardcoded `'TN'` fallback works here but won't for multi-state data |

---

## Table of Contents

1. [Critical Issues (Must Fix)](#1-critical-issues-must-fix)
2. [Major Issues (Should Fix)](#2-major-issues-should-fix)
3. [Moderate Issues (Recommended)](#3-moderate-issues-recommended)
4. [Minor Issues (Nice to Have)](#4-minor-issues-nice-to-have)
5. [Implementation Priority & Order](#5-implementation-priority--order)

---

## 1. Critical Issues (Must Fix)

### ✅ CRIT-01: Google Maps Geocoding — Only 7.1% Geocoded (191 of 2,677 voters)

**STATUS: COMPLETED** (Feb 17, 2026) | Review: A+ (98%)

**User Report:** "The geo location is not working correctly"

**Root Cause:** Multiple compounding issues:

| # | Issue | File | Details |
|---|-------|------|---------|
| A | **Geocoding job doesn't scope to the job's voter IDs** | `backend/services/geocoding-job-service.js` (line ~130) | `processJob()` creates a job with specific `voterIds` but the processing loop fetches ANY voter with `latitude IS NULL` — it ignores which voters were requested and just processes random ungeocoded voters. The `total_records` count is based on the original voterIds array, but the processing fetches voters independently. |
| B | **Coordinate validation passes strings, not numbers** | `frontend/public/js/utils.js` (line ~239) | `isValidCoordinates()` checks `typeof lat === 'number'` but coordinates come from SQLite as strings. The map won't show voters with string coordinates even when geocoding succeeds. |

> **Note:** `checkQuotaLimit()` (line 418), `geocodeWithRetry()` (line 324), and `incrementQuotaUsage()` (line 380) all exist in `geocoding-service.js` and are properly implemented with retry logic, exponential backoff, and quota management via `QuotaManager`.

**Fix Plan:**
1. Fix `processJob()` to use the voter IDs from job creation, not a blanket `WHERE latitude IS NULL`
2. Fix `isValidCoordinates()` to handle string-typed numbers by using `parseFloat()` first
3. Verify the geocoding pipeline end-to-end by running a small batch
4. Investigate whether the low 7.1% geocoding rate is caused by API key quota limits, rate limiting, or job scoping issues

---

### ✅ CRIT-02: Voter List Collapses on Scroll

**STATUS: COMPLETED** (Feb 17, 2026) | Review: A+ (98%)

**User Report:** "When you scroll on the voter list it collapses on itself"

**Root Cause:** VirtualScroller + rendering interaction bugs:

| # | Issue | File | Details |
|---|-------|------|---------|
| A | **VirtualScroller clears tbody on every render** | `frontend/public/js/virtual-scroller.js` (line ~118) | `this.tbody.innerHTML = '';` wipes all content on each scroll event. If `render()` calculates a bad range (empty or too small), it bails out with `return` but the tbody has already been cleared — causing visible collapse. |
| B | **"Suspiciously small range" guard blocks legitimate small-window renders** | `virtual-scroller.js` (line ~120-130) | If the viewport is small or partially hidden, the range check `rangeSize < 5 && data.length > 10` returns early, but content was already cleared (see A). |
| C | **`container` misidentified** | `voter-list-controller.js` (line ~89-92) | VirtualScroller `container` is set to `wrapper` (the `overflow-x-auto` div) but `scrollTop` is read from this container. If the actual scroll container is the parent card or the window, `scrollTop` will always be 0, causing the visible range to freeze at the top or collapse. |
| D | **State subscription triggers re-render loops** | `voter-list-controller.js` (line ~30-35) | Every `setState()` with `filteredVoters` triggers `renderVoterList()` which triggers VirtualScroller, which may re-trigger if scroll position changes. |
| E | **No fixed height on scroll container** | `frontend/public/index.html` | The voter table wrapper has no explicit `height` or `max-height` CSS. VirtualScroller needs a fixed-height container with overflow to calculate visible rows. Without it, `clientHeight` is the full content height, making the visible range calculation wrong. |

**Fix Plan:**
1. **Move `innerHTML = ''` below the range validation guards** in VirtualScroller — never clear before confirming the new range is valid
2. Add explicit `max-height` and `overflow-y: auto` to the voter table container
3. Verify the scroll container used by VirtualScroller matches the actual scrolling element
4. Add a `MIN_RENDER_THRESHOLD` constant and ensure content is never cleared without replacement
5. Consider disabling VirtualScroller entirely for datasets under 500 rows (current threshold of 200 is too aggressive for a feature with bugs)

---

### ✅ CRIT-03: Filters Do Not Work

**STATUS: COMPLETED** (Feb 17, 2026) | Review: A+ (98%)

**User Report:** "The filters do not work"

**Root Cause:** Multiple backend and frontend issues:

| # | Issue | File | Details |
|---|-------|------|---------|
| A | **Search filter sanitization double-encodes** | `frontend/public/js/filter-controller.js` (line ~89) | `Utils.sanitizeInput()` replaces `<` with `&lt;`, `/` with `&#x2F;`, etc. This sanitized string is then sent as the `name` query parameter to the backend. The backend LIKE query searches for `%&lt;...%` in the database, which will never match actual voter names. Any name with an apostrophe (O'Brien) gets mangled to `O&#x27;Brien`. |
| B | **Precinct number padding mismatch** | `backend/models/voter.js` (line ~230) | The filter pads precinct to 2 digits: `filters.precinct.toString().padStart(2, '0')`. But if the precinct dropdown sends values like `"1"` and the DB stores them as `"1"` (not `"01"`), no results will match. Need to verify DB storage format matches padding. |
| C | **Boolean filter type coercion** | `backend/routes/voters.js` (line ~47) | `query('super_voter').optional().isBoolean()` — express-validator's `isBoolean()` only accepts `"true"/"false"` strings, but the frontend sends actual boolean `true` via query string which becomes the string `"true"`. This might work, but `query('geocoded').optional().isBoolean()` has the same issue. |
| D | **`totalElections` subquery is global, not per-voter** | `backend/models/voter.js` (line ~350) | The subquery `SELECT COUNT(DISTINCT election_code) FROM election_history` counts ALL elections globally (no WHERE clause), not elections available to each voter. This means participation rate is calculated against all elections ever held, even for newly registered voters. |
| E | **Party filter sends `R,D` but validator uses strict regex** | `backend/routes/voters.js` (line ~52) | The regex `^(R|D|R,D|D,R)$` is correct but the frontend sends `party=R,D` as a query string parameter. URL encoding could cause issues with commas. |

**Fix Plan:**
1. **Remove `sanitizeInput()` from the search filter input handler** — it's for HTML output, not for API query parameters. Use plain text for API calls, escape only on HTML render
2. Verify precinct number format in the database vs. what the dropdown sends
3. Fix the `totalElections` subquery to be voter-specific or use a consistent total
4. Test all filter combinations end-to-end

---

### ✅ CRIT-04: Bootstrap JS Missing — Tab Navigation, Modals, Toasts Broken

**STATUS: COMPLETED** (Feb 17, 2026) | Review: A+ (98%)

**Root Cause:** The app migrated to Tailwind CSS but still references Bootstrap JS components:

| # | Issue | File | Details |
|---|-------|------|---------|
| A | **No Bootstrap JS loaded** | `frontend/public/index.html` | Bootstrap CSS was replaced by Tailwind, and Bootstrap JS was removed. But the code still uses `data-bs-toggle="tab"`, `data-bs-toggle="modal"`, `data-bs-toggle="offcanvas"`, `bootstrap.Modal`, `bootstrap.Tab`, `bootstrap.Offcanvas`, `bootstrap.Toast` throughout. |
| B | **`ui-components.js` partially replaces Modal/Offcanvas** | `frontend/public/js/ui-components.js` | This file provides custom `Modal` and `Offcanvas` classes but they're not wired as `bootstrap.Modal` etc. Code in `app.js` line ~519 calls `new bootstrap.Tab(tabToActivate)` which will throw `ReferenceError: bootstrap is not defined`. |
| C | **Toasts use `bootstrap.Toast`** | `frontend/public/js/utils.js` (line ~79) | `new bootstrap.Toast(toastElement)` — this will crash since bootstrap JS isn't loaded. |
| D | **Voter detail modal uses `bootstrap.Modal`** | `voter-list-controller.js` (line ~27) | `new bootstrap.Modal(modalElement)` — crashes without Bootstrap JS. |

**Fix Plan:**
1. **Option A (Quick):** Add Bootstrap JS bundle back via CDN: `<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>`
2. **Option B (Clean):** Complete the Tailwind migration — update all `bootstrap.*` references to use the custom `Modal`, `Offcanvas` classes from `ui-components.js`, replace tabs with custom implementation, replace toasts with `toast-controller.js`
3. Option A is recommended for immediate stability; Option B for long-term

---

## 2. Major Issues (Should Fix)

### ✅ MAJ-01: Voter Data Field Name Mismatch (camelCase vs snake_case)

**STATUS: COMPLETED** (Mar 10, 2026) | Review: A+ (98%)

**Implementation:** Added `transformVoterFields()` function to standardize camelCase across all geocoding endpoints. Removed snake_case fallbacks in frontend.

| # | Issue | File | Details |
|---|-------|------|---------|
| A | **Backend returns camelCase, frontend sometimes uses snake_case** | `voter-list-controller.js` (line ~476-495) | `createVoterRow()` references `voter.lastName` and `voter.firstName`, etc. but some places reference `voter.last_name` and `voter.first_name`. The backend model returns camelCase (`lastName`, `firstName`) but some code paths may receive raw SQL results. |
| B | **MapController handles both formats with fallbacks** | `map-controller.js` (line ~246) | `voter.firstName || voter.first_name` — this defensive code suggests the issue is known but not consistently fixed. |

**Fix Plan:** Standardize on camelCase from the backend (already mostly done) and remove all snake_case fallbacks after verifying all API responses.

---

### ✅ MAJ-02: VirtualScroller Row Height Assumption Wrong

**STATUS: NO LONGER RELEVANT** (Mar 10, 2026)

**Resolution:** App rebuilt with modern Vite architecture. VirtualScroller no longer exists; uses standard pagination (50 items/page).

| Issue | File | Details |
|-------|------|---------|
| **Fixed `rowHeight: 48`** | `voter-list-controller.js` (line ~93) | The actual voter table rows contain multi-line content (address with line break, progress bars, badges). Real height is likely 60-80px. This causes the scroll position calculation to be off, resulting in rows being skipped or overlapping. |

**Fix Plan:** Measure actual row height dynamically after first render, or increase `rowHeight` to match actual content.

---

### ✅ MAJ-03: Service Worker May Cache Stale JavaScript

**STATUS: NO LONGER RELEVANT** (Mar 10, 2026)

**Resolution:** No service worker exists in current codebase. Vite handles cache busting via content hashes. Express sets proper cache headers.

| Issue | File | Details |
|-------|------|---------|
| **Service worker caches all static assets** | `frontend/public/sw.js` | If the SW caches old JS files, users get the old code even after fixes are deployed. The version query string `?v=20260215-fix2` helps but only if the SW respects it. |

**Fix Plan:** Update SW to use a network-first strategy for JS files, or add a version check mechanism.

---

### ✅ MAJ-04: Database `getStats()` — Missing Table Resilience

**STATUS: ALREADY RESOLVED** (Mar 10, 2026)

**Resolution:** Code already implements `safeCount()` helper with try/catch. Missing tables return 0 instead of crashing. Implementation exceeds best practices.

| Issue | File | Details |
|-------|------|---------|
| **`getStats()` queries may fail if tables don't exist** | `backend/config/database.js` (line 260) | `getStats()` exists and returns voter/geocoded/precinct/superVoter/cache counts. However, if `geocoding_cache` or other tables aren't created (e.g., migrations not run), the query will throw and crash server startup. The method has a top-level try/catch returning `null`, but the server.js startup code at line ~149 may not handle `null` gracefully. |

**Fix Plan:** Ensure server.js handles `null` from `getStats()` gracefully at startup. Consider wrapping individual count queries in try/catch to return partial stats rather than nothing.

---

### ✅ MAJ-05: Rate Limiter Blocks Rapid Filter Changes

**STATUS: ALREADY RESOLVED** (Mar 10, 2026)

**Resolution:** Rate limiter already split: 1000 GET requests/15min, 100 POST/15min. Frontend debounce: 350ms. 429 errors virtually impossible during normal use.

| Issue | File | Details |
|-------|------|---------|
| **100 requests per 15 minutes for ALL `/api/` routes** | `backend/server.js` (line ~96) | When a user types in the search box, each keystroke triggers a debounced API call (300ms). Rapid filtering can exhaust the 100-request limit quickly, especially with precinct + name + checkbox combinations. Users get 429 errors. |

**Fix Plan:** Increase the rate limit for read-only GET requests, or apply rate limiting only to mutation endpoints (POST/PUT/DELETE).

---

### ✅ MAJ-06: Geocoding — State Column Not Consistently Used

**STATUS: COMPLETED** (Mar 10, 2026) | Review: A+ (98%)

**Implementation:** Added state validation to reject geocoding if state is missing. Removed all 'TN' fallbacks from geocoding service. Logs MISSING_STATE errors to database.

| Issue | File | Details |
|-------|------|---------|
| **Default hardcoded to 'TN'** | `backend/services/geocoding-job-service.js` (line ~188) | `voter.state \|\| 'TN'` — falls back to Tennessee for all voters. If voters from other states are imported, they'll be geocoded to Tennessee addresses. |

**Fix Plan:** Ensure the `state` column is populated during import and used consistently. Add validation.

---

## 3. Moderate Issues (Recommended)

### MOD-01: `sanitizeInput()` Used Incorrectly Throughout

The `sanitizeInput()` function HTML-encodes special characters. This is correct for **rendering** user input into HTML, but it's being used on **API query parameters** (filter-controller.js), which corrupts the search data:

- `O'Brien` → `O&#x27;Brien` → SQL `LIKE '%O&#x27;Brien%'` → **no match**
- `<script>` → `&lt;script&gt;` (this IS correct for HTML rendering)

**Fix:** Use raw text for API parameters, escape only when inserting into DOM.

---

### MOD-02: Precincts Route Still Has Stub Endpoints

| Endpoint | Status |
|----------|--------|
| `GET /api/precincts/:number/voters` | Returns "Implementation pending" message |
| `GET /api/precincts/:number/stats` | Returns "Implementation pending" message |

**Fix:** Implement these endpoints or remove them to avoid confusion.

---

### MOD-03: `totalElections` Count Is Global

In `backend/models/voter.js` line ~350, the subquery:
```sql
(SELECT COUNT(DISTINCT election_code) FROM election_history) as totalElections
```
Counts ALL elections globally. A voter registered for 2 elections will show 2/8 = 25% participation even if they voted in both.

**Fix:** Change to count only elections where the voter has records, or use a configuration constant for "total elections held."

---

### MOD-04: No Error Boundary for Template Loading

`TemplateLoader.loadAll()` in index.html initialization (line ~1288) loads HTML partials. If any template file 404s, the entire init fails and the app shows an error screen.

**Fix:** Make template loading failures non-fatal with fallback empty containers.

---

### MOD-05: Toast Container May Not Exist

`Utils.showToast()` looks for `#toast-container` in the DOM. If the template loading fails (MOD-04) or the element isn't defined, toasts silently fail and no error is shown to the user.

**Fix:** Create toast container dynamically if not found.

---

### MOD-06: Map — `isValidCoordinates()` Fails for String Coordinates

The SQLite database stores coordinates as REAL but JavaScript receives them as strings in some cases. `Utils.isValidCoordinates()` uses strict `typeof lat === 'number'` check.

**Fix:**
```javascript
isValidCoordinates(lat, lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    return !isNaN(latNum) && !isNaN(lngNum) && 
           latNum >= -90 && latNum <= 90 && 
           lngNum >= -180 && lngNum <= 180;
}
```

---

### MOD-07: Database Connection Not Closed on Import Errors

`backend/services/import-processor.js` processes file imports asynchronously. If the import throws an unhandled exception, the database transaction may be left open.

**Fix:** Add proper try/finally blocks around import transactions.

---

### MOD-08: Multer Only Accepts `.dbf` and `.csv` — But Upload UI May Show Other Types

The upload controller may allow users to select files the backend will reject, causing confusing errors.

**Fix:** Add `accept=".dbf,.csv"` to the file input element in the upload modal.

---

## 4. Minor Issues (Nice to Have)

### MIN-01: Excessive Temp Files in Project Root

22 `tmpclaude-*` directories in the project root are development artifacts.

**Fix:** Delete them and add `tmpclaude-*` to `.gitignore`.

---

### MIN-02: No Input Length Limits on Frontend

Search input allows unlimited text length on the frontend, but the backend validates 2-100 characters. Long searches will silently fail.

**Fix:** Add `maxlength="100"` to search inputs.

---

### MIN-03: Console Logging in Production

The backend outputs extensive console logging (emojis, status messages) that would be noisy in production.

**Fix:** Use a logging framework (winston/pino) with configurable log levels.

---

### MIN-04: Election History Sort by `electionCode` String

`ORDER BY election_code DESC` sorts election codes alphabetically. `E_9` sorts after `E_10` because `"9" > "1"` in string comparison.

**Fix:** Add a proper date column to election_history or use zero-padded codes (`E_01`, `E_02`).

---

### MIN-05: CSS Build May Be Stale

`npm run prestart` runs `npm run build:css` which rebuilds Tailwind. If the build fails, the app starts with stale CSS.

**Fix:** Add error checking to the prestart script.

---

### MIN-06: `window.app.filterController` Coupling

The voter-list-controller directly accesses `window.app.filterController` for pagination (line ~814). This creates a tight global coupling.

**Fix:** Use events or the state manager for cross-controller communication.

---

## 5. Implementation Priority & Order

### ✅ Phase 1: Get the App Running (Day 1) - COMPLETED Feb 17, 2026

| Priority | Issue | Est. Time | Impact | Status |
|----------|-------|-----------|--------|--------|
| 1 | **CRIT-04** — Fix Bootstrap JS / UI components | 1-2 hours | Tabs, modals, toasts all broken | ✅ DONE |
| 2 | **CRIT-03A** — Remove sanitizeInput from API filters | 30 min | Filters completely non-functional | ✅ DONE |
| 3 | **MOD-06** — Fix `isValidCoordinates()` for string coords | 15 min | Map shows 0 voters despite geocoded data | ✅ DONE |
| 4 | **CRIT-02A/B** — Fix VirtualScroller clear-before-validate | 1 hour | Voter list disappears on scroll | ✅ DONE |

### ✅ Phase 2: Fix Core Features (Day 2-3) - COMPLETED Feb 17 & Mar 10, 2026

| Priority | Issue | Est. Time | Impact | Status |
|----------|-------|-----------|--------|--------|
| 5 | **CRIT-01A** — Fix job processing to use correct voter IDs | 1 hour | Geocoding processes wrong voters | ✅ DONE |
| 6 | **CRIT-01B / MOD-06** — Fix `isValidCoordinates()` for string coords | 15 min | Map shows 0 voters despite geocoded data | ✅ DONE |
| 7 | **CRIT-02C/E** — Fix VirtualScroller container height | 1 hour | Scroll calculation wrong | ✅ DONE |
| 8 | **CRIT-03B** — Verify precinct number format consistency | 1 hour | Precinct filter fails | ✅ DONE |
| 9 | **CRIT-03D** — Fix totalElections subquery (MOD-03) | 30 min | Participation rates wrong | ✅ DONE |
| 10 | **MAJ-01** — Standardize camelCase field names | 1 hour | Inconsistent data display | ✅ DONE |
| 11 | **MAJ-02** — Fix VirtualScroller row height | 30 min | Rows skip/overlap | ✅ N/A (no longer exists) |
| 12 | **MAJ-05** — Adjust rate limiter for GET requests | 30 min | Users get 429 errors | ✅ Already fixed |
| 13 | **MAJ-06** — Fix state column usage in geocoding | 30 min | Wrong state geocoding | ✅ DONE |

### 🔄 Phase 3: Stability & Polish (Pending)

| Priority | Issue | Est. Time | Impact | Status |
|----------|-------|-----------|--------|--------|
| 14 | **MOD-02** — Implement stub precinct endpoints | 2 hours | Dead endpoints | ⏳ PENDING |
| 15 | **MOD-04/05** — Error boundaries for templates/toasts | 1 hour | App crashes on partial failures | ⏳ PENDING |
| 16 | **MOD-01** — Remove sanitizeInput from non-API uses | 1 hour | Dead code cleanup | ⏳ PENDING |
| 17 | **MOD-07** — Database connection cleanup on import errors | 1 hour | Transaction leaks | ⏳ PENDING |
| 18 | **MOD-08** — Add file accept attribute to upload | 15 min | User confusion | ⏳ PENDING |

### 🔄 Phase 4: Cleanup (Pending)

| Priority | Issue | Est. Time | Impact | Status |
|----------|-------|-----------|--------|--------|
| 19 | **MIN-01** — Clean up temp files | 15 min | Repo hygiene | ⏳ PENDING |
| 20 | **MAJ-03** — Service worker cache strategy | 1 hour | Stale code for users | ✅ N/A (no SW exists) |
| 21 | **MIN-02/03/04** — Input limits, logging, sort fixes | 2 hours | Polish | ⏳ PENDING |
| 22 | **MIN-05/06** — CSS build checks, coupling fixes | 1 hour | Polish | ⏳ PENDING |

---

## Summary

| Severity | Count | Completed | Remaining | Key Theme |
|----------|-------|-----------|-----------|--------|
| **Critical** | 4 issues (13 sub-items) | ✅ 4/4 (100%) | — | Geocoding job scoping + coord validation, list collapses, filters fail, UI framework missing |
| **Major** | 6 issues | ✅ 6/6 (100%) | — | Data format mismatches (2 fixed), rate limits/stats (2 already resolved), VirtualScroller/SW (2 N/A) |
| **Moderate** | 8 issues | 1 partial | 7 issues | Incorrect sanitization, stub endpoints, coordinate types |
| **Minor** | 6 issues | — | 6 issues | Temp files, input limits, logging, sort order |

**Estimated remaining effort:** ~8-10 hours for Moderate issues, ~2-3 hours for Minor issues

---

## ✅ Completed Work Summary

### Critical Issues (Feb 17, 2026) - Grade: A+ (98%)
- ✅ **CRIT-01**: Fixed geocoding job scoping and coordinate validation
- ✅ **CRIT-02**: Resolved VirtualScroller collapse issues with re-entrancy guards
- ✅ **CRIT-03**: Fixed filters by removing sanitizeInput and fixing totalElections
- ✅ **CRIT-04**: Replaced Bootstrap JS with custom UI components

### Major Issues (Mar 10, 2026) - Grade: A+ (98%)
- ✅ **MAJ-01**: Standardized camelCase field naming across geocoding endpoints
- ✅ **MAJ-02**: N/A - VirtualScroller no longer exists (app rebuilt)
- ✅ **MAJ-03**: N/A - Service worker no longer exists (Vite cache busting)
- ✅ **MAJ-04**: Already resolved - safeCount() implemented
- ✅ **MAJ-05**: Already resolved - rate limiter properly configured
- ✅ **MAJ-06**: Fixed state validation, removed 'TN' fallbacks

**Review Documentation:**
- Critical Issues: `.github/docs/SubAgent docs/CRITICAL_ISSUES_review.md`
- CRIT-02 Detailed: `.github/docs/SubAgent docs/CRIT-02_voter_list_scroll_collapse_review.md`
- Major Issues: `.github/docs/SubAgent docs/MAJ_ISSUES_review.md`

---

## 📝 Next Steps

The app is now fully functional with all critical bugs fixed. Remaining work focuses on:
|----------|-------|-----------|
1. **Moderate Issues (MOD-01 through MOD-08):** Stub endpoints, error boundaries, dead code cleanup (~8-10 hours)
2. **Minor Issues (MIN-01 through MIN-06):** Temp files, input validation, logging improvements (~2-3 hours)

The single highest-impact remaining item is **MOD-02 (implementing stub precinct endpoints)** to provide complete API functionality.
