# Election Dropdown Selector — Specification

## Overview

Add a dropdown `<select>` to the **Last Election Breakdown** analytics section so users can switch between all available elections (E_1, E_2, …) instead of only seeing the auto-detected latest election.

---

## Current State Analysis

### Backend — `backend/services/analytics-service.js`

- **Method:** `getLastElectionBreakdown(filters = {})` (line 1172)
- **Auto-detection query** (lines 1183–1195): selects the single `election_code` from `election_history` with `voted = 1`, ordered by the integer suffix of `E_*` codes descending, `LIMIT 1`.
- **Filters:** only `precinct` is supported today.
- **Caching:** uses `_getCacheKey('last_election_breakdown', filters)` + 15-minute TTL.
- **Parallel queries:** `electionStats`, `ageBreakdown`, `precinctBreakdown` — all parameterised on the resolved `electionCode`.

### Backend — `backend/routes/analytics.js`

- **Route:** `GET /api/analytics/last-election-breakdown` (line 508)
- Accepts optional `precinct` query param (2-digit string).
- Passes `{ precinct }` to the service method.

### Frontend — `frontend/src/pages/Analytics.js`

- `renderAnalytics(container)` fetches all analytics data via `Promise.allSettled` and renders the entire page into `container.innerHTML` as one big template literal.
- `renderLastElectionBreakdown(data)` is a pure function that returns an HTML string; it receives the full response data and reads `data.election.electionCode`.
- No interactive controls exist inside this section today.

### Frontend — `frontend/src/api/client.js`

- `fetchLastElectionBreakdown = (p = {}) => get('/analytics/last-election-breakdown', p)` — already passes arbitrary params as query-string keys, so adding `electionCode` requires zero changes to this function.

---

## Proposed Solution

### 1. New Service Method — `getElectionCodes()`

**File:** `backend/services/analytics-service.js`

Add immediately before `getLastElectionBreakdown`:

```js
/**
 * Return all distinct election codes that have at least one voted record.
 * Ordered newest-first using the same E_* numeric-suffix logic.
 * @returns {Promise<string[]>} e.g. ['E_5', 'E_4', 'E_3', 'E_2', 'E_1']
 */
async getElectionCodes() {
  const cacheKey = 'election_codes';
  const cached = this._getFromCache(cacheKey);
  if (cached) return cached;

  const rows = await this.db.all(`
    SELECT election_code
    FROM election_history
    WHERE voted = 1
    GROUP BY election_code
    ORDER BY
      CASE
        WHEN election_code LIKE 'E_%'
        THEN CAST(SUBSTR(election_code, 3) AS INTEGER)
        ELSE 0
      END DESC,
      election_code DESC
  `);

  const codes = rows.map(r => r.election_code);
  this._setCache(cacheKey, codes, this.cacheTTL.analytics);
  return codes;
}
```

**Key decisions:**
- Reuses the same ordering logic already in `getLastElectionBreakdown` so "first item = latest".
- Cached for 15 minutes (same analytics TTL).
- Returns a flat string array — lightweight payload for the dropdown.

---

### 2. Modify `getLastElectionBreakdown` — accept optional `electionCode`

**File:** `backend/services/analytics-service.js`

Change the auto-detection block (lines ~1183-1195) to honour an incoming `filters.electionCode`:

```js
async getLastElectionBreakdown(filters = {}) {
  const cacheKey = this._getCacheKey('last_election_breakdown', filters);
  const cached = this._getFromCache(cacheKey);
  if (cached) return cached;

  const startTime = Date.now();

  try {
    let electionCode;

    // If caller supplied a specific election code, use it directly
    if (filters.electionCode) {
      electionCode = filters.electionCode;
    } else {
      // Step 1: Determine the most recent election code (existing behaviour)
      const lastElection = await this.db.get(`
        SELECT election_code 
        FROM election_history 
        WHERE voted = 1
        GROUP BY election_code 
        ORDER BY 
          CASE 
            WHEN election_code LIKE 'E_%' 
            THEN CAST(SUBSTR(election_code, 3) AS INTEGER) 
            ELSE 0 
          END DESC,
          election_code DESC
        LIMIT 1
      `);

      if (!lastElection) {
        return { election: null, ageBreakdown: [], precinctBreakdown: [], summary: null, queryTime: Date.now() - startTime };
      }
      electionCode = lastElection.election_code;
    }

    // remainder unchanged — uses `electionCode` variable
    ...
```

Because `filters.electionCode` is now part of `filters`, the cache key will naturally differ per election, so no cache-key changes are needed.

---

### 3. New Route — `GET /api/analytics/election-codes`

**File:** `backend/routes/analytics.js`

Add **before** the `last-election-breakdown` route (around line 490):

```js
/**
 * GET /api/analytics/election-codes
 * Returns all distinct election codes that have voting data.
 * Used to populate the election selector dropdown.
 *
 * Example: GET /api/analytics/election-codes
 */
router.get('/election-codes', async (req, res, next) => {
  try {
    const analyticsService = new AnalyticsService();
    const codes = await analyticsService.getElectionCodes();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: codes
    });
  } catch (error) {
    next(error);
  }
});
```

---

### 4. Modify Existing Route — accept `electionCode` query param

**File:** `backend/routes/analytics.js`

In the `last-election-breakdown` route validation array, add a validator for `electionCode`:

```js
router.get('/last-election-breakdown', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    query('electionCode')
        .optional()
        .isString()
        .trim()
        .matches(/^[A-Z0-9_]+$/)
        .withMessage('Invalid election code format'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const filters = {
            precinct: req.query.precinct,
            electionCode: req.query.electionCode
        };

        const result = await analyticsService.getLastElectionBreakdown(filters);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});
```

---

### 5. New API Client Function — `fetchElectionCodes`

**File:** `frontend/src/api/client.js`

Add next to the existing analytics exports:

```js
export const fetchElectionCodes = () => get('/analytics/election-codes');
```

---

### 6. Frontend — Election Dropdown & Dynamic Re-render

**File:** `frontend/src/pages/Analytics.js`

#### 6a. Import `fetchElectionCodes`

```js
import {
  fetchDashboard, fetchEngagement, fetchPartyAffil,
  fetchNonVoterPrecinct, fetchDemographics,
  fetchLastElectionBreakdown, fetchElectionCodes
} from '../api/client.js';
```

#### 6b. Fetch election codes during page load (add to `Promise.allSettled`)

```js
const [dashboard, engagement, party, nonVoterPct, demographics, lastElection, electionCodes] = await Promise.allSettled([
  fetchDashboard(),
  fetchEngagement(),
  fetchPartyAffil(),
  fetchNonVoterPrecinct(),
  fetchDemographics(),
  fetchLastElectionBreakdown(),
  fetchElectionCodes(),
]);

const codes = electionCodes.status === 'fulfilled'
  ? (electionCodes.value.data || electionCodes.value || [])
  : [];
```

#### 6c. Render a dropdown above the breakdown + wrapper div

Replace the Last Election Breakdown section in the template with:

```js
<!-- Last Election Breakdown -->
<div id="last-election-section">
  ${leb ? renderLastElectionBreakdown(leb, codes) : ''}
</div>
```

#### 6d. Modify `renderLastElectionBreakdown` to include the dropdown

```js
function renderLastElectionBreakdown(data, electionCodes = []) {
  const election = data.election;
  if (!election) return '';

  const currentCode = election.electionCode;

  const dropdown = electionCodes.length > 0 ? `
    <select id="election-code-select"
            class="ml-auto text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600
                   text-gray-900 dark:text-gray-100 rounded-lg px-3 py-1.5 focus:ring-2
                   focus:ring-primary-500 focus:border-primary-500 cursor-pointer">
      ${electionCodes.map(code =>
        `<option value="${escapeHtml(code)}" ${code === currentCode ? 'selected' : ''}>
           ${escapeHtml(code)}
         </option>`
      ).join('')}
    </select>` : '';

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-semibold text-gray-900 dark:text-white">Last Election Breakdown</h3>
        ${dropdown}
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">Election: ${escapeHtml(currentCode)}</p>

      <!-- Summary Stats Row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${statCard('Voted', fmt(election.totalVoted), pct(election.turnoutRate) + ' turnout', 'primary')}
        ${statCard('Registered', fmt(election.totalRegistered), '', 'gray')}
        ${statCard('Early Voted', fmt(election.earlyVoted), pct(election.earlyVoteRate), 'success')}
        ${statCard('Election Day', fmt(election.electionDayVoted), '', 'warning')}
      </div>

      ${renderSummaryHighlights(data.summary)}
      ${renderAgeBreakdown(data.ageBreakdown)}
      ${renderPrecinctTurnout(data.precinctBreakdown)}
    </div>`;
}
```

#### 6e. Attach change event listener after initial render

After `container.innerHTML = ...`, attach the dropdown handler. Store `codes` in the outer scope so the handler can pass them through:

```js
// After container.innerHTML assignment:

const elSelect = container.querySelector('#election-code-select');
if (elSelect) {
  elSelect.addEventListener('change', async (e) => {
    const selectedCode = e.target.value;
    const sectionEl = container.querySelector('#last-election-section');
    if (!sectionEl) return;

    // Show a small loading indicator inside the section
    sectionEl.innerHTML = `<div class="flex items-center justify-center py-12 text-gray-400">${spinner('Loading election data...')}</div>`;

    try {
      const res = await fetchLastElectionBreakdown({ electionCode: selectedCode });
      const newData = res.data || res;
      sectionEl.innerHTML = renderLastElectionBreakdown(newData, codes);

      // Re-attach the event listener to the new dropdown
      const newSelect = sectionEl.querySelector('#election-code-select');
      if (newSelect) {
        newSelect.addEventListener('change', elSelect._handler);
      }
    } catch (err) {
      sectionEl.innerHTML = `<div class="text-red-500 p-4">Failed to load election data: ${escapeHtml(err.message)}</div>`;
    }
  });
  // Store handler reference for re-attachment
  elSelect._handler = elSelect.onchange;
}
```

**Better approach — use event delegation to avoid re-attachment:**

Instead of attaching directly and re-attaching, use a single delegated listener on the container:

```js
container.addEventListener('change', async (e) => {
  if (e.target.id !== 'election-code-select') return;

  const selectedCode = e.target.value;
  const sectionEl = container.querySelector('#last-election-section');
  if (!sectionEl) return;

  sectionEl.innerHTML = `<div class="flex items-center justify-center py-12 text-gray-400">${spinner('Loading election data...')}</div>`;

  try {
    const res = await fetchLastElectionBreakdown({ electionCode: selectedCode });
    const newData = res.data || res;
    sectionEl.innerHTML = renderLastElectionBreakdown(newData, codes);
  } catch (err) {
    sectionEl.innerHTML = `<div class="text-red-500 p-4">Failed to load election data: ${escapeHtml(err.message)}</div>`;
  }
});
```

This is the **recommended approach** — event delegation on the container means no re-attachment is needed when the section re-renders.

---

## File Change Summary

| File | Action | Details |
|------|--------|---------|
| `backend/services/analytics-service.js` | ADD method | `getElectionCodes()` — returns sorted distinct election codes |
| `backend/services/analytics-service.js` | MODIFY method | `getLastElectionBreakdown()` — accept optional `filters.electionCode` |
| `backend/routes/analytics.js` | ADD route | `GET /api/analytics/election-codes` |
| `backend/routes/analytics.js` | MODIFY route | `GET /api/analytics/last-election-breakdown` — add `electionCode` query param + validator |
| `frontend/src/api/client.js` | ADD export | `fetchElectionCodes` |
| `frontend/src/pages/Analytics.js` | MODIFY import | Add `fetchElectionCodes` |
| `frontend/src/pages/Analytics.js` | MODIFY `renderAnalytics` | Fetch election codes, wrap section in `#last-election-section`, add event delegation |
| `frontend/src/pages/Analytics.js` | MODIFY `renderLastElectionBreakdown` | Accept `electionCodes` param, render `<select>` dropdown |

---

## Implementation Steps (ordered)

1. **Backend service** — add `getElectionCodes()` method
2. **Backend service** — modify `getLastElectionBreakdown()` to accept `filters.electionCode`
3. **Backend route** — add `GET /api/analytics/election-codes` route
4. **Backend route** — add `electionCode` validator + pass to filters in existing route
5. **Frontend client** — add `fetchElectionCodes` export
6. **Frontend Analytics.js** — update import, fetch codes in parallel, render dropdown, add event delegation

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Invalid election code submitted via query param | Express-validator `matches(/^[A-Z0-9_]+$/)` rejects bad input; service query will simply return empty results for non-existent codes |
| Large number of election codes | Dropdown naturally scrolls; typically < 10 elections |
| Cache key collision | `filters.electionCode` is included in `_getCacheKey` via `JSON.stringify(params)` — no collision |
| Re-render performance | Only the `#last-election-section` div is replaced — rest of the page stays untouched |
| Event listener lost on re-render | Event delegation on `container` avoids this entirely |
| Race condition (rapid dropdown changes) | Low risk for this use case; could add AbortController if needed in future |

---

## UI Mockup (text)

```
┌─────────────────────────────────────────────────────────────┐
│  Last Election Breakdown                      [ E_2  ▼ ]   │
│  Election: E_2                                              │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  Voted   │ │Registered│ │  Early   │ │ Elec Day │      │
│  │  1,234   │ │  5,678   │ │   890    │ │   344    │      │
│  │ 21.7%    │ │          │ │ 72.3%    │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  Key Highlights ...                                         │
│  Voters by Age Group ...                                    │
│  Turnout by Precinct ...                                    │
└─────────────────────────────────────────────────────────────┘
```

When user selects E_1 from dropdown → section re-renders with E_1 data, dropdown retains selection.
