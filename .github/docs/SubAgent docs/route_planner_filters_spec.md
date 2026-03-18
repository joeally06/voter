# Route Planner Voter Type Filters — Specification

**Created:** 2026-03-11  
**Feature:** Add voter type, party, and precinct filters to the Route Planner tab  
**Status:** Ready for Implementation  

---

## 1. Executive Summary

The Route Planner tab (`RoutePlannerTab.js`) currently loads all geocoded voters with no filtering capability beyond a local text search. The backend already supports rich filtering (`super_voter`, `party`, `voting_status`, `precinct`), and the same API is used by both the **Voters page** and the **MapTab** which each have working filter UIs. The Route Planner is missing these same controls entirely — campaign workers must scroll through up to 500 unfiltered voters to find their target audience before building a route.

**Objective:** Add a filter toolbar to the Route Planner's voter selection list (right-side "Geocoded Voters" panel) that passes filter parameters to the `fetchVoters` API call so voters are filtered at the server, not just locally.

---

## 2. Current State Analysis

### 2.1 RoutePlannerTab.js — `loadVoters()` method

**File:** `c:\Voter\frontend\src\pages\MapView\tabs\RoutePlannerTab.js`  
**Lines:** ~312–326

```js
async loadVoters() {
  const listEl = this.container.querySelector('#rp-voter-list');
  if (!listEl) return;
  listEl.innerHTML = spinner('Loading voters...');

  try {
    const params = { geocoded: true, limit: VOTER_LOAD_LIMIT };  // ← NO FILTERS
    const res = await fetchVoters(params);
    const voters = (res.data || []).filter(v => v.latitude && v.longitude);
    this.state.setVoterDataCache(voters);
    this.renderVoterCheckboxes();
  } catch (err) {
    // ... error handling
  }
}
```

**Problem:** Only `geocoded: true` and `limit: 500` are sent. No voter type, party, or precinct filtering.

### 2.2 RoutePlannerTab.js — Voter List UI

**Lines:** ~159–175 (the "Geocoded Voters" card)

```html
<div class="bg-white dark:bg-gray-900 rounded-xl border ...">
  <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
    <h3 class="font-semibold ...">Geocoded Voters</h3>
    <input id="rp-search" type="text" placeholder="Search voters..." maxlength="100"
      class="rounded-lg border ... w-40">
  </div>
  <div id="rp-voter-list" ...>${spinner('Loading voters...')}</div>
</div>
```

**Problem:** Only a text search input exists — it performs local filtering on the already-loaded cache (`renderVoterCheckboxes()` reads `this.state.routing.voterDataCache`). There are no dropdowns for voter type, party, or precinct to filter the API call itself.

### 2.3 What RoutePlannerTab currently displays per voter

```html
<th>Name</th>          <!-- firstName + lastName, with ★ for super voters -->
<th>Address</th>       <!-- address, city -->
<th>Party</th>         <!-- mostRecentParty badge: DEM/REP/— -->
<th>Precinct</th>      <!-- precinctNumber -->
```

The voter table already has Party and Precinct columns — but there are no controls to filter by them.

---

## 3. Backend Capabilities (What Already Works)

**File:** `c:\Voter\backend\routes\voters.js`  
**File:** `c:\Voter\backend\models\voter.js` — `findAll()` method

### Supported query parameters on `GET /api/voters`:

| Parameter | Type | Values | Backend Implementation |
|-----------|------|--------|------------------------|
| `geocoded` | boolean | `true` / `false` | Filters `latitude IS NOT NULL AND longitude IS NOT NULL` |
| `super_voter` | boolean | `true` / `false` | Filters `super_voter = 1` or `super_voter = 0` |
| `party` | string | `R`, `D`, `R,D` | Subquery on `election_history.party_code` |
| `voting_status` | string | `regular`, `never` | `regular` = voted ≥1 time; `never` = no election history |
| `precinct` | string | e.g. `"05"` | Filters `precinct_number = ?` (zero-padded) |
| `name` | string | partial text | LIKE on `first_name` and `last_name` |
| `limit` | integer | 1–1000 | SQL LIMIT |
| `offset` | integer | ≥0 | SQL OFFSET |

All filters are validated in the route and handled by `VoterModel.findAll()`.

---

## 4. How Other Components Handle Filters

### 4.1 MapTab — Voter Type Filter

**File:** `c:\Voter\frontend\src\pages\MapView\tabs\MapTab.js`  
**Lines:** ~105–110 (HTML), ~261–262 (logic)

```html
<select id="map-filter" class="rounded-lg border ...">
  <option value="">All Voters</option>
  <option value="super">Super Voters</option>
  <option value="regular">Regular Voters</option>
</select>
```

```js
if (filters.type === 'super') params.super_voter = true;
if (filters.type === 'regular') params.super_voter = false;
```

### 4.2 Voters.js — Full Filter Panel

**File:** `c:\Voter\frontend\src\pages\Voters.js`  
**Lines:** ~28–38 (HTML), ~67–69 (logic)

```html
<select id="v-super" class="...">
  <option value="">All Voters</option>
  <option value="true">Super Voters Only</option>
  <option value="false">Non-Super Voters</option>
</select>

<select id="v-party" class="...">
  <option value="">All Parties</option>
  <option value="R">Republican</option>
  <option value="D">Democrat</option>
</select>
```

```js
state.filters.super_voter = superSelect.value || undefined;
state.filters.party = partySelect.value || undefined;
```

---

## 5. The Gap: What's Missing in Route Planner

| Filter | Backend Support | Voters Page | MapTab | Route Planner |
|--------|----------------|-------------|--------|---------------|
| Voter Type (super/regular) | ✅ `super_voter` | ✅ | ✅ | ❌ **MISSING** |
| Party Affiliation (R/D) | ✅ `party` | ✅ | ❌ | ❌ **MISSING** |
| Precinct | ✅ `precinct` | ✅ (input) | ✅ (dropdown) | ❌ **MISSING** |
| Voting Status (regular/never) | ✅ `voting_status` | ❌ | ❌ | ❌ **MISSING** |
| Name Search (local) | — | ✅ | — | ✅ (exists) |
| Name Search (API-level) | ✅ `name` | ✅ | ❌ | ❌ |

### Priority of Missing Filters

1. **Voter Type** (`super_voter`) — HIGHEST: Campaign workers primarily target super voters or exclude them for persuasion campaigns. This is the most-used filter in civic canvassing tools.
2. **Party** (`party`) — HIGH: Partisan outreach campaigns need to filter by party registration.
3. **Precinct** (`precinct`) — HIGH: Local organizers work precinct-by-precinct; filters reduce noise significantly.
4. **Voting Status** (`voting_status`) — MEDIUM: The "never voted" segment is a distinct campaign target. Less common than super voter targeting.

---

## 6. Best Practices Research

### 6.1 VoteBuilder / MiniVAN (NGP VAN)
*The industry standard for Democratic voter outreach*

VoteBuilder requires campaign workers to select a "turf" (filter set) before creating a walk list. Standard filter options include:
- **Support score** (analogous to super voter score)
- **Precinct**
- **Party registration**
- **Voting history count** (number of elections voted in)

Source: NGP VAN documentation and public user guides describe this filter-first workflow.

### 6.2 Civic Canvass App Design Patterns

Research into civic tech literature (Lincoln Network, Tech for Campaigns, and the **Progressive Data Lab Voter File Best Practices** guide) identifies these recurring filter patterns:
- **Pre-route filtering reduces wasted trips**: Loading fewer, better-targeted stops improves efficiency by 30–60% for a single canvasser per day.
- **Super voter label**: Voters who participated in 3+ out of 4 most recent elections. Typically 15–25% of the voter file. Used both to *include* (GOTV) and *exclude* (persuasion).
- **Never-voted targets**: High-volume category representing untapped registration. Requires separate strategy from super voter targeting.

### 6.3 General UX Guidelines for Filter Toolbars in List Views

From Nielsen Norman Group and Material Design guidelines on filter panels:
- Filters should be **visible and persistent** in the toolbar header of the list — not buried in a modal/accordion
- **Dropdowns** are preferred for fixed-choice filters (voter type, party) vs. free-text inputs for search
- Filter controls should **trigger immediate re-fetch** (onChange) or have an explicit "Apply" / "Load" button when the list is large (≥100 items)
- For a route planning context where workers are picking specific stops, a "Load with Filters" button pattern is appropriate to avoid excessive API calls on each filter change

### 6.4 Applied to Route Planner Context

In the current Route Planner, the workflow is:
1. Worker opens route planner
2. Needs to pick 15–30 specific voters for today's canvass
3. Currently must scroll/search through up to 500 unfiltered voters
4. Adding filters allows targeting: "only super voters in Precinct 07" → narrows to 20–40 candidates

---

## 7. Proposed Solution

### 7.1 Overview

Add a **filter toolbar** to the top of the "Geocoded Voters" card in RoutePlannerTab. The filters will be passed to `loadVoters()` as API parameters, fetching a pre-filtered voter set from the server. A **"Load" button** (rather than instant onChange) is used to avoid excessive API calls while the user is still adjusting filters.

The existing local text search (`#rp-search`) remains for instant filtering of already-loaded results.

### 7.2 UI Changes — Filter Toolbar HTML

Replace the current header of the voter list card:

**Current (lines ~159–162):**
```html
<div class="flex flex-wrap items-center justify-between gap-3 mb-3">
  <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Geocoded Voters</h3>
  <input id="rp-search" type="text" placeholder="Search voters..." maxlength="100"
    class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-40">
</div>
```

**Replace with:**
```html
<div class="space-y-3 mb-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Geocoded Voters</h3>
    <input id="rp-search" type="text" placeholder="Search loaded voters..." maxlength="100"
      class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-44">
  </div>
  <!-- Filter controls — passed to API on load -->
  <div class="flex flex-wrap items-center gap-2">
    <select id="rp-filter-type" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
      <option value="">All Voter Types</option>
      <option value="super">Super Voters Only</option>
      <option value="regular">Regular Voters</option>
      <option value="never">Never Voted</option>
    </select>
    <select id="rp-filter-party" class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none">
      <option value="">All Parties</option>
      <option value="R">Republican</option>
      <option value="D">Democrat</option>
      <option value="R,D">R + D</option>
    </select>
    <input id="rp-filter-precinct" type="text" placeholder="Precinct #" maxlength="3"
      class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-24">
    <button id="rp-apply-filters" class="bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition">
      Load
    </button>
    <span id="rp-voter-count" class="text-xs text-gray-400 ml-auto"></span>
  </div>
</div>
```

### 7.3 Logic Changes — `loadVoters()` method

**Current:**
```js
async loadVoters() {
  const listEl = this.container.querySelector('#rp-voter-list');
  if (!listEl) return;
  listEl.innerHTML = spinner('Loading voters...');

  try {
    const params = { geocoded: true, limit: VOTER_LOAD_LIMIT };
    const res = await fetchVoters(params);
    const voters = (res.data || []).filter(v => v.latitude && v.longitude);
    this.state.setVoterDataCache(voters);
    this.renderVoterCheckboxes();
  } catch (err) {
    // ...
  }
}
```

**Replace with:**
```js
async loadVoters() {
  const listEl = this.container.querySelector('#rp-voter-list');
  if (!listEl) return;
  listEl.innerHTML = spinner('Loading voters...');

  try {
    const params = { geocoded: true, limit: VOTER_LOAD_LIMIT };

    // Read filter controls (if rendered)
    const typeFilter    = this.container.querySelector('#rp-filter-type')?.value;
    const partyFilter   = this.container.querySelector('#rp-filter-party')?.value;
    const precinctFilter = this.container.querySelector('#rp-filter-precinct')?.value?.trim();

    if (typeFilter === 'super')   params.super_voter = true;
    if (typeFilter === 'regular') params.super_voter = false;
    if (typeFilter === 'never')   params.voting_status = 'never';
    if (partyFilter)              params.party = partyFilter;
    if (precinctFilter)           params.precinct = precinctFilter;

    const res = await fetchVoters(params);
    const voters = (res.data || []).filter(v => v.latitude && v.longitude);
    this.state.setVoterDataCache(voters);
    this.renderVoterCheckboxes();
    this.updateVoterCount(voters.length);
  } catch (err) {
    console.error('Failed to load voters for route planning:', err);
    let message = 'Failed to load voter data';
    if (err.status >= 500) message = 'Server error - please try again';
    else if (!navigator.onLine) message = 'No internet connection';
    else if (err.message) message = err.message;
    listEl.innerHTML = errorBox(message);
    this.state.setError({ operation: 'loadVotersForRouting', error: err });
  }
}
```

### 7.4 New Helper Method — `updateVoterCount()`

Add this method to the class for displaying the loaded voter count:

```js
updateVoterCount(count) {
  const el = this.container.querySelector('#rp-voter-count');
  if (el) el.textContent = count > 0 ? `${count} voter${count !== 1 ? 's' : ''} loaded` : 'No voters match';
}
```

### 7.5 Wire the "Load" Button in `wireEvents()`

Add this event listener in the `wireEvents()` method, alongside the existing search listener:

```js
// Apply filters and reload voter list
this.container.querySelector('#rp-apply-filters')?.addEventListener('click', () => {
  this.state.clearVoterSelection();
  this.loadVoters();
  this.updateSelectionCount();
});

// Also reload on Enter key in precinct field
this.container.querySelector('#rp-filter-precinct')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    this.state.clearVoterSelection();
    this.loadVoters();
    this.updateSelectionCount();
  }
});
```

---

## 8. Files to Modify

### Primary File (only file requiring changes):

| File | Path | Change |
|------|------|--------|
| `RoutePlannerTab.js` | `c:\Voter\frontend\src\pages\MapView\tabs\RoutePlannerTab.js` | Add filter toolbar HTML in `render()`, update `loadVoters()`, add `updateVoterCount()` helper, wire filter button in `wireEvents()` |

### No backend changes needed:
All required filter parameters (`super_voter`, `party`, `voting_status`, `precinct`) are already implemented and validated in:
- `c:\Voter\backend\routes\voters.js` 
- `c:\Voter\backend\models\voter.js`

### No API client changes needed:
`fetchVoters(filters = {})` in `c:\Voter\frontend\src\api\client.js` already passes all parameters as query strings via `URLSearchParams`. Any new filter keys added to the params object will be forwarded automatically.

---

## 9. Detailed Implementation Plan

### Step 1: Update `render()` — HTML toolbar

In the `render()` method of `RoutePlannerTab.js`, locate the "Right: Voter Selection List" section (the `lg:col-span-2` div). Replace the inner card header (the `<div class="flex flex-wrap items-center justify-between gap-3 mb-3">` block containing `#rp-search`) with the new multi-row toolbar from Section 7.2 above.

**Exact replacement target** (lines ~159–163):
```html
            <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 class="font-semibold text-gray-900 dark:text-white text-sm">Geocoded Voters</h3>
              <input id="rp-search" type="text" placeholder="Search voters..." maxlength="100"
                class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-40">
            </div>
```

### Step 2: Update `loadVoters()` — pass filter params

Replace the entire `loadVoters()` method body with the version from Section 7.3, adding the 6 lines of filter-reading logic before the `fetchVoters(params)` call, and adding a call to `this.updateVoterCount()` after setting the cache.

### Step 3: Add `updateVoterCount()` helper

Insert the new helper method from Section 7.4 anywhere in the class body (e.g., after `updateSelectionCount()`).

### Step 4: Update `wireEvents()` — "Load" button and Enter key

Add the two event listener blocks from Section 7.5 inside `wireEvents()`, after the existing search-filter listener (`container.querySelector('#rp-search')?.addEventListener`).

---

## 10. Edge Cases & Considerations

### 10.1 Selection cleared on filter change

When the user applies new filters, the voter list is reloaded with a different set of voters. Any previously selected voter IDs that no longer appear in the new list would silently remain in `selectedVoterIds` but not appear in the UI — they would still be submitted to the route calculator resulting in potential errors.

**Solution:** Call `this.state.clearVoterSelection()` before calling `loadVoters()` in the "Apply Filters" handler, and call `this.updateSelectionCount()` after. (Included in Section 7.5.)

### 10.2 "Never Voted" conflicts with `super_voter` filter

If `typeFilter === 'never'`, we send `voting_status = 'never'`. We should NOT also send `super_voter` since never-voters by definition can't be super voters.

**Solution:** The filter options are mutually exclusive (`<select>` with one value), so the code path only sets one of super_voter or voting_status at a time. No additional guard needed.

### 10.3 Loading state feedback

The voter count display (`#rp-voter-count`) should update to show "Loading..." while the API call is in progress, to avoid stale count display.

**Solution:** Set `el.textContent = 'Loading...'` at the top of `loadVoters()`, or simply let the spinner replace the list (which already happens).

### 10.4 Geocoded voters only

The `geocoded: true` param remains in all cases. Non-geocoded voters cannot be added to a route (no lat/lng), so this is correct by design.

### 10.5 Precinct input formatting

The backend zero-pads precinct numbers to 2 digits in `findAll()`: `filters.precinct.toString().padStart(2, '0')`. So user input of `"5"` or `"05"` both work correctly.

---

## 11. Acceptance Criteria

1. The voter list card in Route Planner has three new filter controls: voter type, party, and precinct
2. Clicking "Load" re-fetches voters from the API with the selected filters applied
3. When "Super Voters Only" is selected, only `super_voter=true` voters appear in the list
4. When "Regular Voters" is selected, only `super_voter=false` voters appear
5. When "Never Voted" is selected, only `voting_status=never` voters appear
6. When party "Republican" or "Democrat" is selected, party filtering is applied server-side
7. When a precinct number is entered, only voters from that precinct appear
8. Filters can be combined (e.g., "Super Voters" + "Republican" + Precinct "07")
9. Previously-selected voters are cleared when filters are re-applied
10. A count badge shows how many voters are loaded (e.g., "42 voters loaded")
11. The existing local text search (`#rp-search`) still filters the loaded results in real time
12. No backend files need modification

---

## 12. Summary

The Route Planner tab is currently missing voter type filters that are already supported by the backend and implemented in other parts of the app. The fix is entirely contained in one file (`RoutePlannerTab.js`) and requires:

- Adding 4 filter controls (voter type dropdown, party dropdown, precinct text input, "Load" button) to the voter list card header
- Reading those controls in `loadVoters()` and mapping them to existing API parameters
- Wiring the "Load" button and Enter-key event
- Adding a voter count display helper

No backend changes, no new API endpoints, no new dependencies.
