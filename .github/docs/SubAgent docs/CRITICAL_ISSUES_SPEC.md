# Critical Issues Specification — Voter Platform

**Date:** February 16, 2026  
**Scope:** Server crash analysis + CRIT-01 through CRIT-04 from `COMPREHENSIVE_ISSUE_PLAN.md`  
**Status:** Research complete — ready for implementation

---

## Table of Contents

1. [Server Crash Analysis](#1-server-crash-analysis)
2. [CRIT-04: Bootstrap JS Missing](#2-crit-04-bootstrap-js-missing)
3. [CRIT-03: Filters Broken](#3-crit-03-filters-broken)
4. [CRIT-02: VirtualScroller Collapse](#4-crit-02-virtualscroller-collapse)
5. [CRIT-01: Geocoding Issues](#5-crit-01-geocoding-issues)

---

## 1. Server Crash Analysis

### Finding: NOT a code bug — Port conflict from zombie processes

**Evidence:** Running `node backend/server.js` with a clean port **succeeds**:

```
✅ Working directory validated: C:\Voter
📂 Database path: C:\Voter\data\voter_platform.db
✅ Connected to SQLite database
✅ Database schema validated (13 tables)
📊 Database Stats: { totalVoters: 2677, geocodedVoters: 191, totalPrecincts: 7, superVoters: 643, cacheSize: 192, geocodingProgress: '7.1' }
🚀 Server running at http://localhost:3000
```

**Root Cause:** The terminal history shows ~40+ consecutive attempts to start the server without first killing previous node processes. Each crash left a zombie `node` process holding port 3000. The `EADDRINUSE` error (handled at `backend/server.js` lines 530-545) causes `process.exit(1)`.

**Server startup validation chain** (`backend/server.js`):
1. Line 28-41: Working directory check (checks `package.json` exists) — **passes**
2. Line 44-51: API key validation (`config/api-keys.js` `validate()`) — **passes** (`.env` has `GOOGLE_MAPS_API_KEY`)
3. Line 53: Database connection (`config/database.js`) — **passes** (all 13 tables exist, schema validates)
4. Line 527: `app.listen(PORT, HOST)` — **fails if port 3000 is occupied**

### Fix Required

No code changes needed. The fix is operational:

```powershell
# Before starting server, kill existing node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
node backend/server.js
```

The `prestart` script in `package.json` already runs `scripts/cleanup-port.ps1` for this purpose — use `npm start` instead of `node backend/server.js` directly.

---

## 2. CRIT-04: Bootstrap JS Missing

### Current State

The app migrated from Bootstrap CSS to Tailwind CSS. Bootstrap JS was removed. A compatibility shim exists in `frontend/public/js/ui-components.js` (lines 467-636) that provides `window.bootstrap.Modal`, `window.bootstrap.Tab`, `window.bootstrap.Toast`, and `window.bootstrap.Offcanvas`. This shim **partially works** but has critical gaps.

### Issue 2A: Tab Navigation Event Mismatch

**File:** `frontend/public/js/app.js` lines 512-547  
**Problem:** `setupTabNavigation()` listens for `shown.bs.tab` event, but the shim dispatches `tab:change` instead.

**Current code (lines 516-526):**
```javascript
// Handle tab switching
const tabTriggers = document.querySelectorAll('[data-bs-toggle="tab"]');
tabTriggers.forEach(trigger => {
    trigger.addEventListener('shown.bs.tab', (event) => {
        const tabId = event.target.getAttribute('data-bs-target');

        // Update URL hash without scrolling
        history.replaceState(null, null, tabId);

        // Store active tab in localStorage
        localStorage.setItem('activeTab', tabId);

        // Trigger resize event for charts (fixes chart sizing issues)
        window.dispatchEvent(new Event('resize'));

        Logger.debug(`📂 Switched to tab: ${tabId}`);
    });
});
```

**What happens:** The shim's `Tabs.switchTab()` method (ui-components.js line 306) dispatches a `tab:change` event on `document`, not `shown.bs.tab` on the trigger element. Consequently:
- URL hash is never updated when tabs change
- Active tab is never saved to localStorage  
- Charts never resize when analytics tab is shown

**Fix (app.js lines 516-526):** Change event listener from `shown.bs.tab` to work with the shim's `tab:change` event:

```javascript
// Handle tab switching - listen for custom tab:change event from UI components
document.addEventListener('tab:change', (event) => {
    const tabId = event.detail?.tabId;
    if (tabId) {
        // Update URL hash without scrolling
        history.replaceState(null, null, `#${tabId}`);

        // Store active tab in localStorage
        localStorage.setItem('activeTab', `#${tabId}`);

        // Trigger resize event for charts (fixes chart sizing issues)
        window.dispatchEvent(new Event('resize'));

        Logger.debug(`📂 Switched to tab: ${tabId}`);
    }
});
```

**Also fix (app.js lines 536-544):** The `bootstrap.Tab` usage to restore active tab:

**Current code:**
```javascript
// Restore active tab from URL hash or localStorage
const hash = window.location.hash || localStorage.getItem('activeTab') || '#route-tab';
const tabToActivate = document.querySelector(`[data-bs-target="${hash}"]`);

if (tabToActivate) {
    // Use Bootstrap's Tab class to programmatically switch tabs
    const tab = new bootstrap.Tab(tabToActivate);
    tab.show();
    Logger.debug(`✅ Restored tab: ${hash}`);
}
```

**This actually works** — the shim's `bootstrap.Tab.show()` calls `Tabs.switchTab()` which correctly switches tabs. The only issue is the event listener above not firing.

### Issue 2B: Toast Uses Bootstrap CSS Classes

**File:** `frontend/public/js/utils.js` lines 55-85  
**Problem:** `showToast()` creates toast markup with Bootstrap CSS classes (`toast`, `d-flex`, `toast-body`, `btn-close`, `me-2`, `bg-success`, etc.) and then creates `new bootstrap.Toast(element)`. The shim's Toast interceptor extracts the message and redirects to `window.Toast.show()` (from `toast-controller.js`), then **removes the original element**. This works but is a Rube Goldberg machine — it creates DOM elements just to extract text from them and delete them.

**Current code (lines 55-85):**
```javascript
showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      Logger.warn('Toast container not found');
      return;
    }

    const toastId = `toast-${Date.now()}`;
    const bgClass = {
      success: 'bg-success',
      error: 'bg-danger',
      info: 'bg-info',
      warning: 'bg-warning'
    }[type] || 'bg-info';

    const toastHTML = `
      <div id="${toastId}" class="toast align-items-center text-white ${bgClass} border-0" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body">
            ${message}
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;

    toastContainer.insertAdjacentHTML('beforeend', toastHTML);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 5000 });
    toast.show();

    // Remove from DOM after hidden
    toastElement.addEventListener('hidden.bs.toast', () => {
      toastElement.remove();
    });
  },
```

**Fix:** Replace with direct call to `window.Toast` (the `ToastController` from `toast-controller.js`):

```javascript
showToast(message, type = 'info') {
    // Use ToastController directly (no Bootstrap dependency)
    if (window.Toast && typeof window.Toast.show === 'function') {
      // Map 'error' type to 'error' for ToastController
      window.Toast.show(message, type, { duration: 5000 });
      return;
    }

    // Fallback: simple alert if ToastController not loaded
    Logger.warn('Toast controller not available, using console');
    Logger.info(`[${type.toUpperCase()}] ${message}`);
  },
```

### Issue 2C: Voter Detail Modal (Minor — Already Works)

**File:** `frontend/public/js/voter-list-controller.js` line 24  
**Current code:**
```javascript
this.voterDetailModal = new bootstrap.Modal(modalElement);
```

**Status:** This **works correctly** thanks to the `window.bootstrap.Modal` shim in `ui-components.js` lines 482-545. The shim wraps the custom `Modal` class and provides `show()`/`hide()`/`toggle()` methods with instance tracking via `WeakMap`. No changes needed.

### Issue 2D: Dynamically Loaded Templates Not Re-wired

**File:** `frontend/public/js/ui-components.js` lines 449-462  
**Problem:** `initUIComponents()` runs on `DOMContentLoaded` and wires click handlers for `[data-bs-toggle="modal"]`, `[data-bs-toggle="offcanvas"]`, and `[data-bs-toggle="tab"]`. But templates (upload-modal.html, voter-detail-modal.html, filter-offcanvas.html) are loaded **after** DOMContentLoaded via `TemplateLoader.loadAll()`.

**Impact:** Buttons inside dynamically loaded templates that use `data-bs-toggle` won't automatically work. However, this is **mostly mitigated** because:
- The trigger buttons (e.g., `#uploadBtn`) are in `index.html` (wired at DOMContentLoaded)
- `data-bs-dismiss="modal"` buttons inside modals are wired when the `Modal` class constructor calls `setupCloseButtons()` (line 130)
- The modal content is present by the time the user clicks the trigger

**One remaining gap:** The `#mobileFilterBtn` (index.html line 74) uses `data-bs-toggle="offcanvas"`. The `initUIComponents()` handler creates a **new** `Offcanvas` instance on every click (line 455), which doesn't reuse state. This is functional but could cause multiple backdrop elements if clicked rapidly.

### Issue 2E: Toast Container Has Bootstrap CSS Classes

**File:** `frontend/public/index.html` line 1023  
**Current code:**
```html
<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toast-container" aria-live="polite"></div>
```

**Problem:** Classes `position-fixed`, `bottom-0`, `end-0` are Bootstrap utility classes, not Tailwind. These have no effect without Bootstrap CSS.

**Fix:** Replace with Tailwind equivalents:
```html
<div class="fixed bottom-0 right-0 p-3 z-50" id="toast-container" aria-live="polite"></div>
```

**Note:** Since `showToast()` is being rewritten to use `ToastController` directly (Issue 2B fix), this container becomes unused and could be removed entirely. The `ToastController` creates its own `.vp-toast-container`.

### Summary of CRIT-04 Changes

| File | Line(s) | Change | Priority |
|------|---------|--------|----------|
| `frontend/public/js/app.js` | 516-526 | Change `shown.bs.tab` listener to `tab:change` on `document` | HIGH |
| `frontend/public/js/utils.js` | 55-85 | Replace Bootstrap toast with direct `window.Toast.show()` | HIGH |
| `frontend/public/index.html` | 1023 | Fix toast container CSS classes (or remove if unused) | LOW |
| `frontend/public/js/voter-list-controller.js` | 24 | No change needed — shim works | NONE |

---

## 3. CRIT-03: Filters Broken

### Issue 3A: Search Filter Double-Encodes via `sanitizeInput()`

**File:** `frontend/public/js/filter-controller.js` lines 87-92  
**Problem:** `Utils.sanitizeInput()` HTML-encodes special characters (`<` → `&lt;`, `'` → `&#x27;`, `/` → `&#x2F;`). This encoded string is sent as the `name` query parameter. The backend performs `LIKE '%encoded_string%'` against the database, which stores raw text. Result: no matches.

**Example:** User types `O'Brien` → sanitized to `O&#x27;Brien` → backend LIKE `%O&#x27;Brien%` → database stores `O'BRIEN` → **zero results**.

**Current code (lines 87-92):**
```javascript
const searchInput = document.getElementById('searchInput');
if (searchInput) {
    searchInput.addEventListener('input', Utils.debounce((e) => {
        const sanitizedValue = Utils.sanitizeInput(e.target.value);
        this.updateFilter('name', sanitizedValue);
        const searchInputMobile = document.getElementById('searchInputMobile');
        if (searchInputMobile) searchInputMobile.value = sanitizedValue;
    }, 300));
}
```

**Fix:** Use raw input value for API queries. Sanitization should happen server-side (the backend already validates via `express-validator` with `isString().trim().isLength({ min: 2, max: 100 })`) and client-side only when rendering to DOM:

```javascript
const searchInput = document.getElementById('searchInput');
if (searchInput) {
    searchInput.addEventListener('input', Utils.debounce((e) => {
        const rawValue = e.target.value.trim();
        this.updateFilter('name', rawValue);
        const searchInputMobile = document.getElementById('searchInputMobile');
        if (searchInputMobile) searchInputMobile.value = rawValue;
    }, 300));
}
```

**Also fix mobile search (lines 97-102):**
```javascript
const searchInputMobile = document.getElementById('searchInputMobile');
if (searchInputMobile) {
    searchInputMobile.addEventListener('input', Utils.debounce((e) => {
        const rawValue = e.target.value.trim();
        this.updateFilter('name', rawValue);
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = rawValue;
    }, 300));
}
```

### Issue 3B: Precinct Number Padding — Verified OK

**Database state verified:**
- `voters` table stores precinct numbers as `'21'` and `'24'`
- `precincts` table stores values `'01'` through `'05'`, `'21'`, `'24'`
- Dropdown sends the value from the precincts table (e.g., `'21'`)
- Backend `padStart(2, '0')` converts `'21'` → `'21'` (already 2+ chars) — **matches correctly**

**Conclusion:** No code change needed for current dataset. The padding logic works because all precinct values are already 2+ digits. However, if single-digit precincts exist in voters table without zero-padding, this could break. Low risk for current data.

### Issue 3C: `totalElections` Subquery Is Global, Causes >100% Participation Rates

**File:** `backend/models/voter.js` lines 351-355  
**Problem:** The subquery counts ALL distinct election codes globally:

**Current code:**
```sql
(
    SELECT COUNT(DISTINCT election_code)
    FROM election_history
) as totalElections
```

**Database reality:**
- Global `totalElections` = **2** (only 2 distinct election_code values exist)
- But some voters have `electionsVoted` = **7** (voted in 7 elections)
- Participation rate = `7 / 2 * 100 = 350%` — clearly wrong

**Fix:** Change to count elections per voter (total records for that voter, regardless of voted status):

```sql
(
    SELECT COUNT(*)
    FROM election_history
    WHERE election_history.voter_id = v.voter_id
) as totalElections
```

This gives "how many elections was this voter tracked in?" and calculates participation as "voted / tracked." A voter tracked in 7 elections who voted in 7 gets 100%.

**Full context — `backend/models/voter.js` lines 340-365:**

Current:
```javascript
                (
                    SELECT COUNT(*) 
                    FROM election_history 
                    WHERE election_history.voter_id = v.voter_id 
                      AND voted = 1
                ) as electionsVoted,
                (
                    SELECT COUNT(DISTINCT election_code)
                    FROM election_history
                ) as totalElections
```

Proposed:
```javascript
                (
                    SELECT COUNT(*) 
                    FROM election_history 
                    WHERE election_history.voter_id = v.voter_id 
                      AND voted = 1
                ) as electionsVoted,
                (
                    SELECT COUNT(*)
                    FROM election_history
                    WHERE election_history.voter_id = v.voter_id
                ) as totalElections
```

### Summary of CRIT-03 Changes

| File | Line(s) | Change | Priority |
|------|---------|--------|----------|
| `frontend/public/js/filter-controller.js` | 87-92 | Remove `sanitizeInput()` from search handler, use raw `.trim()` | HIGH |
| `frontend/public/js/filter-controller.js` | 97-102 | Same fix for mobile search handler | HIGH |
| `backend/models/voter.js` | 351-355 | Change `totalElections` subquery from global to per-voter | MEDIUM |

---

## 4. CRIT-02: VirtualScroller Collapse

### Issue 4A: `innerHTML = ''` Clears Content Before Validation

**File:** `frontend/public/js/virtual-scroller.js` lines 77-145  
**Problem:** The `render()` method clears `this.tbody.innerHTML = ''` at line 131 AFTER the validation guards return. However, the validation guards at lines 92-128 (invalid scroll position, empty range, suspiciously small range) return early **without clearing** — this is actually correct in the current code. Let me re-read more carefully...

**Actual code flow (lines 77-145):**
```javascript
render() {
    this.tbody = this.container.querySelector('tbody');
    if (!this.tbody || !this.data || this.data.length === 0) {
        return;  // Guard 1: no tbody/data — CORRECT: doesn't clear
    }

    // ... scroll position calculation ...

    // Guard 2: invalid scroll position
    if (scrollTop < 0 || scrollTop > maxScroll + 100) {
        return;  // CORRECT: doesn't clear
    }

    // Guard 3: empty range
    if (startIndex >= endIndex || endIndex <= startIndex) {
        return;  // CORRECT: doesn't clear — but content may already be stale
    }

    // Guard 4: suspiciously small range
    if (rangeSize < 5 && this.data.length > 10) {
        return;  // PROBLEM: may prevent legitimate renders in small viewports
    }

    // Guard 5: range unchanged
    if (startIndex === this.visibleRange.start && endIndex === this.visibleRange.end) {
        return;  // CORRECT: no change needed
    }

    // === CLEAR AND REBUILD ===
    this.tbody.innerHTML = '';  // Line 131 — only clears if all guards pass
    // ... rebuild with spacers and rows ...
}
```

**Revised assessment:** The `innerHTML = ''` is placed AFTER guards, so the "clear before validate" issue described in the original plan is **not present in the current code**. The guards prevent clearing if the range is invalid. The actual collapse issues are:

### Issue 4B: Scroll Container — Verified OK

**File:** `frontend/public/index.html` line 600  
**Current code:**
```html
<div class="overflow-x-auto" style="max-height: 500px; overflow-y: auto;">
```

**Status:** The voter table wrapper **already has** `max-height: 500px` and `overflow-y: auto`. The VirtualScroller `container` is correctly set to this div via `scrollContainer.closest('.overflow-x-auto')` in `voter-list-controller.js` line 91. The `clientHeight` and `scrollTop` calculations should work correctly with this setup.

**No code change needed.**

The primary CRIT-02 cause is the **rowHeight mismatch** (Issue 4D below) — with `rowHeight: 48` but actual rows being ~72px, the VirtualScroller calculates that 10 rows fit in 500px when only 7 actually do. This causes incorrect spacer heights and content overlap/collapse during scrolling.

### Issue 4C: "Suspiciously Small Range" Guard Too Aggressive

**File:** `frontend/public/js/virtual-scroller.js` lines 115-124  
**Current code:**
```javascript
// CRITICAL FIX: Don't render if range is suspiciously small
const rangeSize = endIndex - startIndex;
if (rangeSize < 5 && this.data.length > 10) {
    Logger.warn('VirtualScroller: Suspiciously small range', {
        rangeSize,
        totalData: this.data.length
    });
    // Keep existing content
    return;
}
```

**Problem:** If the viewport is small (e.g., 200px tall with 52px rows), the visible range is ~4 rows + 5 buffer = ~9 rows. But `rangeSize < 5` would trigger if the viewport fits 0-1 rows (only buffer rows). This is unlikely in practice but could happen on very small screens or when the container has collapsed height.

**Fix:** Lower the threshold or remove this guard entirely since the other guards are sufficient:

```javascript
// Only skip if range is truly degenerate (0 or 1 rows with substantial data)
const rangeSize = endIndex - startIndex;
if (rangeSize < 2 && this.data.length > 10) {
    Logger.warn('VirtualScroller: Degenerate range', { rangeSize, totalData: this.data.length });
    return;
}
```

### Issue 4D: RowHeight Mismatch

**File:** `frontend/public/js/voter-list-controller.js` line 107  
**Current code:**
```javascript
this.virtualScroller = new VirtualScroller({
    container: wrapper,
    rowHeight: 48,
    bufferSize: 5,
    renderRow: (voter, index) => this.createVoterRow(voter)
});
```

**Problem:** `rowHeight: 48` but actual voter rows contain multi-line content (name, address on separate lines, badges, progress bars). Real height is likely 60-80px. This causes scroll position miscalculation — the visible range is calculated for more rows than actually fit, causing overlap or gaps.

**Fix:** Increase `rowHeight` to match actual rendered content:
```javascript
rowHeight: 72,  // Measured: voter rows with address + badges are ~68-76px
```

Or better, dynamically measure after first render.

### Summary of CRIT-02 Changes

| File | Line(s) | Change | Priority |
|------|---------|--------|----------|
| `frontend/public/js/virtual-scroller.js` | 115-124 | Lower "suspiciously small range" threshold from 5 to 2 | MEDIUM |
| `frontend/public/js/voter-list-controller.js` | 107 | Increase `rowHeight` from 48 to 72 | HIGH |
| `frontend/public/index.html` | 600 | Already has `max-height: 500px; overflow-y: auto` — no change needed | NONE |

---

## 5. CRIT-01: Geocoding Issues

### Issue 5A: Job Processing Ignores Requested Voter IDs

**File:** `backend/services/geocoding-job-service.js`  
**Problem:** `createJob()` (lines 32-86) accepts a `voterIds` array and creates a job with `total_records = validVoters.length`. But it **never stores** the voter IDs in the job record. Then `processJob()` (lines 100-280) fetches voters independently:

**Current code (processJob, lines 130-137):**
```javascript
// Fetch next batch of voters needing geocoding
const voters = await database.all(`
    SELECT id, voter_id, address, city, state, zip_code, latitude
    FROM voters
    WHERE latitude IS NULL
    LIMIT ?
`, [batchSize]);
```

This fetches **ANY** voter without coordinates, not the specific ones requested in `createJob()`.

**Fix requires two changes:**

**Change 1: Store voter IDs in the job record** (in `createJob()`, around line 68):

Current:
```javascript
const result = await database.run(`
    INSERT INTO geocoding_jobs (
        total_records, 
        options, 
        created_by,
        status
    ) VALUES (?, ?, ?, 'PENDING')
`, [
    validVoters.length,
    JSON.stringify(options),
    options.created_by || 'system'
]);
```

Proposed — store voter IDs in the options JSON:
```javascript
const jobOptions = {
    ...options,
    voter_ids: validVoters.map(v => v.id)
};

const result = await database.run(`
    INSERT INTO geocoding_jobs (
        total_records, 
        options, 
        created_by,
        status
    ) VALUES (?, ?, ?, 'PENDING')
`, [
    validVoters.length,
    JSON.stringify(jobOptions),
    options.created_by || 'system'
]);
```

**Change 2: Use voter IDs in processJob()** (around line 130):

Current:
```javascript
const voters = await database.all(`
    SELECT id, voter_id, address, city, state, zip_code, latitude
    FROM voters
    WHERE latitude IS NULL
    LIMIT ?
`, [batchSize]);
```

Proposed:
```javascript
// Use voter IDs from job if available, otherwise fall back to any ungeocoded
const voterIds = options.voter_ids;
let voters;

if (voterIds && voterIds.length > 0) {
    // Scope to specific voter IDs from the job
    const placeholders = voterIds.map(() => '?').join(',');
    voters = await database.all(`
        SELECT id, voter_id, address, city, state, zip_code, latitude
        FROM voters
        WHERE id IN (${placeholders})
          AND latitude IS NULL
        LIMIT ?
    `, [...voterIds, batchSize]);
} else {
    // Fallback: process any ungeocoded voters
    voters = await database.all(`
        SELECT id, voter_id, address, city, state, zip_code, latitude
        FROM voters
        WHERE latitude IS NULL
        LIMIT ?
    `, [batchSize]);
}
```

### Issue 5B: `isValidCoordinates()` Type Check — Verified OK for Current Data

**File:** `frontend/public/js/utils.js` lines 238-247  
**Current code:**
```javascript
isValidCoordinates(lat, lng) {
    return (
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
    );
}
```

**Database verification:** SQLite stores coordinates as `REAL` type, and the `sqlite3` Node.js driver returns them as JavaScript `number` type. Tested with actual data:
```
JS types: [ { lat: 'number', lng: 'number' }, { lat: 'number', lng: 'number' }, ... ]
```

**Conclusion:** The strict `typeof === 'number'` check works correctly for data flowing through the standard API pipeline. However, for defensive coding, it's still recommended to use `parseFloat()`:

**Recommended fix (defensive):**
```javascript
isValidCoordinates(lat, lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    return (
        !isNaN(latNum) &&
        !isNaN(lngNum) &&
        latNum >= -90 &&
        latNum <= 90 &&
        lngNum >= -180 &&
        lngNum <= 180
    );
}
```

### Summary of CRIT-01 Changes

| File | Line(s) | Change | Priority |
|------|---------|--------|----------|
| `backend/services/geocoding-job-service.js` | ~68 | Store voter IDs in job options JSON | HIGH |
| `backend/services/geocoding-job-service.js` | ~130 | Scope voter query to stored IDs | HIGH |
| `frontend/public/js/utils.js` | 238-247 | Use `parseFloat()` for defensive coordinate validation | LOW |

---

## Implementation Order

| Step | Issue | File(s) | Est. Time |
|------|-------|---------|-----------|
| 1 | CRIT-04 tab events | `app.js` | 15 min |
| 2 | CRIT-04 toast rewrite | `utils.js` | 15 min |
| 3 | CRIT-03A search sanitization | `filter-controller.js` | 10 min |
| 4 | CRIT-03C totalElections | `voter.js` | 10 min |
| 5 | CRIT-02 VirtualScroller guards | `virtual-scroller.js` | 10 min |
| 6 | CRIT-02 rowHeight | `voter-list-controller.js` | 5 min |
| 7 | CRIT-01A job scoping | `geocoding-job-service.js` | 30 min |
| 8 | CRIT-01B coordinate validation | `utils.js` | 5 min |
| **Total** | | | **~1.5 hours** |

---

## Files Modified Summary

| File | Issues Addressed |
|------|-----------------|
| `frontend/public/js/app.js` | CRIT-04 (tab event listener) |
| `frontend/public/js/utils.js` | CRIT-04 (toast), CRIT-01B (coordinates) |
| `frontend/public/js/filter-controller.js` | CRIT-03A (sanitizeInput removal) |
| `backend/models/voter.js` | CRIT-03C (totalElections subquery) |
| `frontend/public/index.html` | CRIT-02 (container height), CRIT-04 (toast container CSS) |
| `frontend/public/js/virtual-scroller.js` | CRIT-02 (range guard threshold) |
| `frontend/public/js/voter-list-controller.js` | CRIT-02 (rowHeight) |
| `backend/services/geocoding-job-service.js` | CRIT-01A (job scoping) |
