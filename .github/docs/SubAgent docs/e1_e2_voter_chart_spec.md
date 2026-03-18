# E_1/E_2 Voter Chart Specification

**Created:** March 11, 2026  
**Research Phase:** Complete  
**Status:** Ready for Implementation

---

## Executive Summary

This specification details the implementation of a new comparative chart on the Analytics page that displays total voter turnout across multiple elections (specifically E_1 and E_2, but extensible to any election codes). The chart will provide visual comparison of voter participation across different election cycles.

---

## Current State Analysis

### Analytics.js Architecture

**Location:** `frontend/src/pages/Analytics.js`

**Current Chart Implementations:**

1. **Engagement Levels Chart** (Doughnut)
   - Lines 320-340
   - Shows: Never Voted, Occasional (1-3), Super Voters (4+)
   - Data source: `fetchEngagement()` API call

2. **Party Affiliation Chart** (Pie)
   - Lines 370-415
   - Shows: Democrat (D), Republican (R), Independent (I)
   - Data source: `fetchPartyAffil()` API call

3. **Demographics Chart** (Pie)
   - Lines 485-515
   - Shows: Voter distribution by city (top 12)
   - Data source: `fetchDemographics()` API call

4. **Last Election - Age Distribution Chart** (Pie)
   - Lines 260-285
   - Shows: Age group breakdown for selected election
   - Data source: `fetchLastElectionBreakdown()` with election code filter

**Architecture Pattern:**
- Render functions create HTML with canvas elements
- `initializeCharts()` function called after DOM ready (100ms setTimeout)
- Charts stored in `chartInstances` Map for cleanup
- Uses `chartConfigs` from `chart-utils.js` for consistent styling

### Backend Data Sources

#### Election History Table Structure
**Location:** `scripts/setup.js`, lines 72-81

```sql
CREATE TABLE IF NOT EXISTS election_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT,
    election_code TEXT,          -- E_1, E_2, E_3, etc.
    voted BOOLEAN DEFAULT 0,      -- 1 if voted, 0 if not
    party_code TEXT,
    early_voted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (voter_id) REFERENCES voters(voter_id)
);
```

#### Available API Endpoints

**1. Get Election Codes:**
- **Route:** `GET /api/analytics/election-codes`
- **Backend:** `backend/routes/analytics.js`, lines 499-510
- **Service:** `AnalyticsService.getElectionCodes()`, lines 1169-1192
- **Returns:** Array of election codes sorted newest-first
  ```json
  ["E_5", "E_4", "E_3", "E_2", "E_1"]
  ```

**2. Get Last Election Breakdown:**
- **Route:** `GET /api/analytics/last-election-breakdown?electionCode=E_1`
- **Backend:** `backend/routes/analytics.js`, lines 530-545
- **Service:** `AnalyticsService.getLastElectionBreakdown()`, lines 1202-1399
- **Returns:** Detailed election statistics including:
  ```json
  {
    "election": {
      "electionCode": "E_1",
      "totalRegistered": 12500,
      "totalVoted": 8300,
      "turnoutRate": 66.4,
      "earlyVoted": 3200,
      "electionDayVoted": 5100
    },
    "ageBreakdown": [...],
    "precinctBreakdown": [...],
    "summary": {...}
  }
  ```

### Data Access Pattern

**Election Code Meaning:**
- E_1, E_2, E_3, etc. represent different elections
- Numeric suffix indicates election sequence (E_5 is newer than E_1)
- Stored in `election_history` table with `voted` boolean flag
- Each voter can have multiple election_history records (one per election)

**Current Frontend Data Flow:**
1. `renderAnalytics()` fetches all data via `Promise.allSettled()` at line 47
2. Election codes fetched: `fetchElectionCodes()` (line 49)
3. Dropdown created with all election codes (lines 165-175)
4. Selecting election triggers `onElectionChange` event (lines 120-145)
5. New election data fetched and section re-rendered

---

## Research: Best Practices

### Chart.js Comparative Charts

**Recommended Chart Type:** Bar Chart (Grouped or Stacked)

**Why Bar Chart?**
1. **Clear Comparisons:** Easier to compare values across multiple elections than pie charts
2. **Extensibility:** Can easily add more elections (E_3, E_4, etc.) without cluttering
3. **Readability:** Bar heights provide intuitive visual comparison
4. **Existing Support:** Chart.js BarController already registered in chart-utils.js (line 18)

**Alternative Considered:** Line Chart
- Good for trends over time
- Less effective for showing absolute voter counts
- Better suited when there are 5+ elections to compare

### Chart.js Configuration for Comparison Data

**Best Practice Pattern:**
```javascript
{
  labels: ['E_1', 'E_2'],  // Election codes as X-axis labels
  datasets: [
    {
      label: 'Total Registered',
      data: [12500, 13200],
      backgroundColor: '#6b7280',  // gray
      borderColor: '#6b7280',
      borderWidth: 1,
      borderRadius: 4
    },
    {
      label: 'Total Voted',
      data: [8300, 9100],
      backgroundColor: '#3b82f6',  // primary blue
      borderColor: '#3b82f6',
      borderWidth: 1,
      borderRadius: 4
    }
  ]
}
```

### Styling Consistency

**Color Palette (from chart-utils.js, lines 35-45):**
- Primary: `#3b82f6` (blue-500)
- Success: `#10b981` (green-500)
- Warning: `#f59e0b` (amber-500)
- Gray: `#6b7280` (gray-500)

**CSS Classes (Tailwind patterns from Analytics.js):**
- Section container: `bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6`
- Section heading: `font-semibold text-gray-900 dark:text-white mb-4`
- Grid layout: `grid grid-cols-1 lg:grid-cols-2 gap-6`

---

## Proposed Solution

### Architecture Overview

**New Component:** Election Comparison Chart Section

**Placement:** Between "Last Election Breakdown" and "Engagement Levels" sections
- After line 106 in Analytics.js (after last election section renders)
- Before line 109 (engagement section)

**Data Flow:**
1. Fetch election codes (already done at page load)
2. For each election code (default: E_1 and E_2), fetch election breakdown
3. Extract `totalRegistered` and `totalVoted` from each response
4. Aggregate data into chart-friendly format
5. Render grouped bar chart comparing elections

### Implementation Components

#### 1. New Render Function

**Function Name:** `renderElectionComparisonChart()`

**Location:** Add to Analytics.js after `renderLastElectionBreakdown()` (after line 230)

**Signature:**
```javascript
function renderElectionComparisonChart(electionData, selectedElections = ['E_1', 'E_2'])
```

**Parameters:**
- `electionData`: Object mapping election codes to their breakdown data
  ```javascript
  {
    'E_1': { election: { totalRegistered: 12500, totalVoted: 8300 }, ... },
    'E_2': { election: { totalRegistered: 13200, totalVoted: 9100 }, ... }
  }
  ```
- `selectedElections`: Array of election codes to display (default: E_1 and E_2)

**Returns:** HTML string containing:
- Section wrapper with consistent styling
- Multi-select dropdown for choosing elections to compare
- Canvas element for chart: `<canvas id="election-comparison-chart" width="400" height="300"></canvas>`
- Summary stats cards showing:
  - Average turnout rate across selected elections
  - Highest turnout election
  - Lowest turnout election
  - Trend indicator (increasing/decreasing participation)

#### 2. Chart Initialization Function

**Function Name:** `initializeElectionComparisonChart()`

**Location:** Add to Analytics.js after `initializeLastElectionCharts()` (after line 675)

**Signature:**
```javascript
function initializeElectionComparisonChart(electionData, selectedElections)
```

**Implementation:**
```javascript
function initializeElectionComparisonChart(electionData, selectedElections) {
  const canvas = document.getElementById('election-comparison-chart');
  if (!canvas) return;

  // Extract data for selected elections
  const labels = selectedElections;
  const registeredData = selectedElections.map(code => 
    electionData[code]?.election?.totalRegistered || 0
  );
  const votedData = selectedElections.map(code => 
    electionData[code]?.election?.totalVoted || 0
  );

  // Create chart data using barChart config
  const chartData = chartConfigs.barChart(
    labels,
    [
      {
        label: 'Total Registered',
        data: registeredData,
        backgroundColor: colors.gray,
        borderColor: colors.gray,
        borderWidth: 1,
        borderRadius: 4
      },
      {
        label: 'Total Voted',
        data: votedData,
        backgroundColor: colors.primary,
        borderColor: colors.primary,
        borderWidth: 1,
        borderRadius: 4
      }
    ]
  );

  // Chart options
  const options = {
    responsive: true,
    maintainAspectRatio: true,
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function(value) {
            return fmt(value); // Use formatting utility
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      },
      x: {
        grid: {
          display: false
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            return `${context.dataset.label}: ${fmt(context.parsed.y)}`;
          }
        }
      }
    }
  };

  const chart = createChart(canvas, 'bar', chartData, options);
  if (chart) {
    chartInstances.set('election-comparison', chart);
  }
}
```

#### 3. Chart Configuration Helper

**Function Name:** `chartConfigs.electionComparisonChart()`

**Location:** Add to `frontend/src/utils/chart-utils.js` after `demographicsChart()` (after line 360)

**Signature:**
```javascript
electionComparisonChart(electionData, selectedElections)
```

**Implementation:**
```javascript
/**
 * Create election comparison chart (grouped bar chart)
 * @param {Object} electionData - Map of election codes to breakdown data
 * @param {Array} selectedElections - Array of election codes to display
 * @returns {Object} Chart configuration object
 */
electionComparisonChart(electionData, selectedElections) {
  const labels = selectedElections;
  const registeredData = selectedElections.map(code => 
    electionData[code]?.election?.totalRegistered || 0
  );
  const votedData = selectedElections.map(code => 
    electionData[code]?.election?.totalVoted || 0
  );

  return this.barChart(
    labels,
    [
      {
        label: 'Total Registered',
        data: registeredData,
        backgroundColor: colors.gray,
        borderColor: colors.gray
      },
      {
        label: 'Total Voted',
        data: votedData,
        backgroundColor: colors.primary,
        borderColor: colors.primary
      }
    ]
  );
}
```

#### 4. Data Fetching Strategy

**Approach:** Parallel data fetching for all elections at page load

**Modification to `renderAnalytics()`:**

**Current (lines 47-58):**
```javascript
const [dashboard, engagement, party, nonVoterPct, demographics, lastElection, electionCodes] = await Promise.allSettled([
  fetchDashboard(),
  fetchEngagement(),
  fetchPartyAffil(),
  fetchNonVoterPrecinct(),
  fetchDemographics(),
  fetchLastElectionBreakdown(),
  fetchElectionCodes(),
]);
```

**Updated:**
```javascript
// First, get election codes
const codesResult = await fetchElectionCodes();
const codes = codesResult?.data || codesResult || [];

// Fetch breakdown for first 5 elections (or fewer if not available)
const electionCodesToFetch = codes.slice(0, 5);
const electionBreakdownPromises = electionCodesToFetch.map(code =>
  fetchLastElectionBreakdown({ electionCode: code })
);

// Fetch all data in parallel
const [dashboard, engagement, party, nonVoterPct, demographics, lastElection, ...electionBreakdowns] = await Promise.allSettled([
  fetchDashboard(),
  fetchEngagement(),
  fetchPartyAffil(),
  fetchNonVoterPrecinct(),
  fetchDemographics(),
  fetchLastElectionBreakdown(), // Default to most recent
  ...electionBreakdownPromises
]);

// Map election breakdowns to object
const electionData = {};
electionBreakdowns.forEach((result, idx) => {
  if (result.status === 'fulfilled') {
    const data = result.value?.data || result.value;
    if (data?.election?.electionCode) {
      electionData[data.election.electionCode] = data;
    }
  }
});
```

**Rationale:**
- Fetches up to 5 elections at page load for immediate comparison
- Non-blocking: Uses Promise.allSettled to prevent failures from blocking page
- Efficient: Parallel requests minimize load time
- Scalable: Can adjust number of elections fetched based on performance

#### 5. HTML Section Integration

**Location:** Add to `renderAnalytics()` container.innerHTML at line 106

**HTML Structure:**
```html
<!-- Election Comparison Chart -->
<div id="election-comparison-section">
  ${electionData && Object.keys(electionData).length >= 2 
    ? renderElectionComparisonChart(electionData, ['E_1', 'E_2']) 
    : ''}
</div>
```

**Full Section Implementation:**
```javascript
function renderElectionComparisonChart(electionData, selectedElections = ['E_1', 'E_2']) {
  // Validate we have data for at least 2 elections
  const validElections = selectedElections.filter(code => electionData[code]);
  if (validElections.length < 2) {
    return ''; // Don't render if insufficient data
  }

  // Calculate summary statistics
  const turnoutRates = validElections.map(code => 
    electionData[code].election.turnoutRate || 0
  );
  const avgTurnout = turnoutRates.reduce((sum, rate) => sum + rate, 0) / turnoutRates.length;
  const maxTurnout = Math.max(...turnoutRates);
  const minTurnout = Math.min(...turnoutRates);
  const maxElection = validElections[turnoutRates.indexOf(maxTurnout)];
  const minElection = validElections[turnoutRates.indexOf(minTurnout)];

  // Create multi-select options for all available elections
  const allElections = Object.keys(electionData).sort();
  const electionOptions = allElections.map(code => `
    <option value="${escapeHtml(code)}" ${selectedElections.includes(code) ? 'selected' : ''}>
      ${escapeHtml(code)}
    </option>
  `).join('');

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6" id="comparison-section">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-semibold text-gray-900 dark:text-white">Election Turnout Comparison</h3>
        <select id="election-comparison-select" multiple
                class="text-sm bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600
                       text-gray-900 dark:text-gray-100 rounded-lg px-3 py-1.5 focus:ring-2
                       focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
                style="min-width: 120px;">
          ${electionOptions}
        </select>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Comparing: ${validElections.join(', ')}
      </p>

      <!-- Summary Stats Row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${statCard('Avg Turnout', pct(avgTurnout), 'across elections', 'primary')}
        ${statCard('Highest', pct(maxTurnout), escapeHtml(maxElection), 'success')}
        ${statCard('Lowest', pct(minTurnout), escapeHtml(minElection), 'warning')}
        ${statCard('Elections', validElections.length.toString(), 'compared', 'gray')}
      </div>

      <!-- Chart -->
      <div class="mb-4">
        <canvas id="election-comparison-chart" width="400" height="300"></canvas>
      </div>
    </div>
  `;
}
```

#### 6. Event Handling

**Location:** Add event listener to `renderAnalytics()` after line 158

**Implementation:**
```javascript
// Event delegation for election comparison multi-select
const onElectionComparisonChange = async (e) => {
  if (e.target.id !== 'election-comparison-select') return;

  const selectedOptions = Array.from(e.target.selectedOptions);
  const selectedElections = selectedOptions.map(opt => opt.value);

  // Need at least 2 elections
  if (selectedElections.length < 2) {
    console.warn('Select at least 2 elections to compare');
    return;
  }

  const sectionEl = container.querySelector('#comparison-section');
  if (!sectionEl) return;

  // Show loading state
  sectionEl.innerHTML = `<div class="flex items-center justify-center py-12 text-gray-400">${spinner('Loading comparison data...')}</div>`;

  try {
    // Fetch data for any newly selected elections not already loaded
    const missingElections = selectedElections.filter(code => !electionData[code]);
    if (missingElections.length > 0) {
      const fetchPromises = missingElections.map(code =>
        fetchLastElectionBreakdown({ electionCode: code })
      );
      const results = await Promise.allSettled(fetchPromises);
      
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          const data = result.value?.data || result.value;
          if (data?.election?.electionCode) {
            electionData[data.election.electionCode] = data;
          }
        }
      });
    }

    // Re-render section
    sectionEl.outerHTML = renderElectionComparisonChart(electionData, selectedElections);
    
    // Re-initialize chart
    setTimeout(() => {
      // Destroy old chart if exists
      const oldChart = chartInstances.get('election-comparison');
      if (oldChart) destroyChart(oldChart);
      
      // Create new chart
      initializeElectionComparisonChart(electionData, selectedElections);
    }, 100);
    
  } catch (err) {
    sectionEl.innerHTML = `<div class="text-red-500 p-4">Failed to load comparison data: ${escapeHtml(err.message)}</div>`;
  }
};
container.addEventListener('change', onElectionComparisonChange);
```

**Cleanup:** Add to existing cleanup return function (line 157)

---

## API Changes

### No New Backend Endpoints Required

**Rationale:**
- Existing `GET /api/analytics/election-codes` provides all election codes
- Existing `GET /api/analytics/last-election-breakdown?electionCode=X` provides detailed data per election
- No aggregation needed on backend - frontend handles comparison logic

### Potential Optimization (Optional Phase 2)

**New Endpoint:** `GET /api/analytics/election-comparison`

**Query Parameters:**
- `electionCodes`: Comma-separated election codes (e.g., `E_1,E_2,E_3`)

**Returns:**
```json
{
  "success": true,
  "data": {
    "elections": [
      {
        "electionCode": "E_1",
        "totalRegistered": 12500,
        "totalVoted": 8300,
        "turnoutRate": 66.4
      },
      {
        "electionCode": "E_2",
        "totalRegistered": 13200,
        "totalVoted": 9100,
        "turnoutRate": 68.9
      }
    ],
    "summary": {
      "averageTurnout": 67.65,
      "highestTurnout": { "electionCode": "E_2", "rate": 68.9 },
      "lowestTurnout": { "electionCode": "E_1", "rate": 66.4 },
      "participationTrend": "increasing"
    }
  }
}
```

**Benefits:**
- Reduces frontend data processing
- Single request instead of multiple
- Can add trend analysis on backend
- Better caching at backend level

**Implementation:** Add to `backend/services/analytics-service.js` and `backend/routes/analytics.js`

**Priority:** Low - implement after core functionality validated

---

## Implementation Steps

### Phase 1: Core Chart Implementation (Estimated: 2-3 hours)

**Step 1:** Update chart-utils.js
- [ ] Add `electionComparisonChart()` configuration helper
- [ ] Test with sample data in browser console
- **Files:** `frontend/src/utils/chart-utils.js`
- **Lines:** After line 360

**Step 2:** Add render function
- [ ] Create `renderElectionComparisonChart()` function
- [ ] Implement HTML structure with canvas and summary stats
- [ ] Add multi-select dropdown for election selection
- **Files:** `frontend/src/pages/Analytics.js`
- **Lines:** After line 230 (after `renderLastElectionBreakdown()`)

**Step 3:** Add chart initialization
- [ ] Create `initializeElectionComparisonChart()` function
- [ ] Configure bar chart with proper options
- [ ] Register chart instance in `chartInstances` Map
- **Files:** `frontend/src/pages/Analytics.js`
- **Lines:** After line 675 (after `initializeLastElectionCharts()`)

**Step 4:** Update main render function
- [ ] Modify data fetching to get multiple election breakdowns
- [ ] Add election comparison section to container HTML
- [ ] Call initialization function in `initializeCharts()`
- **Files:** `frontend/src/pages/Analytics.js`
- **Lines:** 47-58 (data fetching), 106 (HTML insertion), 567 (chart init)

### Phase 2: Interactivity (Estimated: 1-2 hours)

**Step 5:** Add event handling
- [ ] Implement `onElectionComparisonChange()` event handler
- [ ] Handle dynamic election selection changes
- [ ] Fetch missing election data on demand
- [ ] Update chart when selection changes
- **Files:** `frontend/src/pages/Analytics.js`
- **Lines:** After line 158 (event delegation)

**Step 6:** Add cleanup
- [ ] Ensure chart destruction on navigation
- [ ] Remove event listeners properly
- **Files:** `frontend/src/pages/Analytics.js`
- **Lines:** 157 (return cleanup function)

### Phase 3: Polish & Validation (Estimated: 1 hour)

**Step 7:** Styling consistency
- [ ] Verify Tailwind classes match other sections
- [ ] Test dark mode appearance
- [ ] Check responsive layout on mobile/tablet

**Step 8:** Error handling
- [ ] Handle cases with no election data
- [ ] Handle single election gracefully
- [ ] Display user-friendly errors

**Step 9:** Testing
- [ ] Test with E_1 and E_2 data
- [ ] Test with 3+ elections selected
- [ ] Test with incomplete data
- [ ] Test election selection changes
- [ ] Test chart export functionality

### Phase 4: Documentation (Estimated: 30 minutes)

**Step 10:** Code documentation
- [ ] Add JSDoc comments to new functions
- [ ] Document data structures
- [ ] Add inline comments for complex logic

---

## Dependencies & Requirements

### Required Libraries (Already Available)
- ✅ Chart.js v3+ (registered in chart-utils.js)
- ✅ BarController (registered at line 18)
- ✅ Tailwind CSS (for styling)

### Required Backend APIs (Already Available)
- ✅ `GET /api/analytics/election-codes`
- ✅ `GET /api/analytics/last-election-breakdown`

### Browser Requirements
- Modern browser with ES6+ support
- Canvas API support (all modern browsers)
- No additional polyfills needed

### Data Requirements
- At least 2 elections with voting data in database
- Election codes stored in `election_history` table
- Valid `totalRegistered` and `totalVoted` counts

---

## Potential Risks & Mitigations

### Risk 1: Performance with Many Elections

**Severity:** Medium  
**Impact:** Page load time increases if fetching 10+ elections

**Mitigation:**
- Limit initial fetch to 5 most recent elections
- Lazy-load additional elections on-demand when selected
- Cache election data in memory to avoid re-fetching
- Consider pagination if database has 20+ elections

### Risk 2: Empty or Incomplete Data

**Severity:** Low  
**Impact:** Chart doesn't render or shows empty bars

**Mitigation:**
- Validate data before rendering (line checks in renderElectionComparisonChart)
- Don't render section if fewer than 2 valid elections
- Show informative message: "Select at least 2 elections with data"
- Gracefully handle missing `totalRegistered` or `totalVoted` (default to 0)

### Risk 3: UI Complexity with Multi-Select

**Severity:** Low  
**Impact:** Users may find multi-select dropdown confusing

**Mitigation:**
- Add tooltip: "Hold Ctrl/Cmd to select multiple elections"
- Pre-select E_1 and E_2 by default
- Show selected elections in subtitle text
- Consider checkbox-based UI in future iteration if needed

### Risk 4: Chart Export Compatibility

**Severity:** Low  
**Impact:** New chart may not export correctly to PDF

**Mitigation:**
- Register chart instance with unique key: 'election-comparison'
- Ensure chart added to `chartInstances` Map
- Test PDF export after implementation
- Update `pdfmake-generator.js` if necessary

### Risk 5: Memory Leaks from Chart Instances

**Severity:** Medium  
**Impact:** Browser memory usage increases over time

**Mitigation:**
- Always destroy chart before creating new instance
- Clean up in navigation cleanup function
- Store all charts in `chartInstances` Map for centralized cleanup
- Clear chartInstances on section re-render

---

## Testing Strategy

### Unit Testing (Manual)

**Test Case 1: Basic Rendering**
- Load Analytics page with E_1 and E_2 data
- Verify chart section appears
- Verify bars show correct heights
- Verify summary stats calculate correctly

**Test Case 2: Election Selection**
- Change selected elections in multi-select
- Verify chart updates with new data
- Verify summary stats recalculate

**Test Case 3: Edge Cases**
- Test with only 1 election in database → No chart shown
- Test with 0 elections → No chart shown
- Test with missing totalVoted data → Default to 0

**Test Case 4: Responsiveness**
- Test on desktop (1920x1080)
- Test on tablet (768x1024)
- Test on mobile (375x667)
- Verify chart remains readable

**Test Case 5: Dark Mode**
- Toggle dark mode
- Verify colors adjust correctly
- Verify text remains readable

### Integration Testing

**Test Case 6: Data Flow**
- Verify `fetchElectionCodes()` returns valid codes
- Verify `fetchLastElectionBreakdown()` accepts electionCode param
- Verify parallel data fetching completes
- Verify chart initializes after data loaded

**Test Case 7: Export Functionality**
- Export analytics as PDF
- Verify election comparison chart included
- Verify chart quality in PDF matches screen

**Test Case 8: Navigation**
- Navigate away from Analytics page
- Navigate back to Analytics page
- Verify no duplicate charts
- Verify no memory leaks

### Performance Testing

**Test Case 9: Load Time**
- Measure page load with 2 elections → Target: < 300ms
- Measure page load with 5 elections → Target: < 500ms
- Measure chart re-render time → Target: < 100ms

**Test Case 10: Memory Usage**
- Monitor memory before/after chart creation
- Navigate away and verify cleanup
- Repeat 10 times, verify no memory growth

---

## Success Criteria

### Functional Requirements
- ✅ Chart displays voter turnout comparison for E_1 and E_2
- ✅ Users can select different elections to compare
- ✅ Chart updates dynamically when selection changes
- ✅ Summary stats calculate correctly (avg, highest, lowest)
- ✅ Section integrates seamlessly with existing Analytics page

### Visual Requirements
- ✅ Chart styling matches existing charts
- ✅ Dark mode works correctly
- ✅ Responsive on all screen sizes
- ✅ Consistent with Tailwind design system

### Performance Requirements
- ✅ Page load time increase < 200ms
- ✅ Chart render time < 100ms
- ✅ No memory leaks on navigation

### Code Quality Requirements
- ✅ JSDoc comments on all new functions
- ✅ Consistent with existing code patterns
- ✅ No console errors or warnings
- ✅ Follows ESLint rules

---

## Future Enhancements

### Phase 2 Features (Post-MVP)

1. **Turnout Trend Line**
   - Add line overlay showing turnout % trend
   - Visualize increasing/decreasing participation

2. **Stacked Bar Option**
   - Allow toggling between grouped and stacked bars
   - Show early vs. election day voting breakdown

3. **More Metrics**
   - Add party breakdown comparison
   - Add age group comparison across elections
   - Add precinct-level comparison

4. **Custom Date Ranges**
   - Let users filter elections by date range
   - Group elections by year or election type

5. **Backend Optimization**
   - Implement dedicated `/api/analytics/election-comparison` endpoint
   - Add server-side caching for comparison data
   - Pre-calculate trend indicators

6. **Export Enhancements**
   - Export comparison chart as standalone PNG
   - Export comparison data as CSV
   - Include comparison in analytics reports

---

## Appendices

### Appendix A: Data Structure Examples

**Election Data Object:**
```javascript
{
  'E_1': {
    election: {
      electionCode: 'E_1',
      totalRegistered: 12500,
      totalVoted: 8300,
      turnoutRate: 66.4,
      earlyVoted: 3200,
      electionDayVoted: 5100,
      earlyVoteRate: 38.55
    },
    ageBreakdown: [...],
    precinctBreakdown: [...],
    summary: {...}
  },
  'E_2': {
    election: {
      electionCode: 'E_2',
      totalRegistered: 13200,
      totalVoted: 9100,
      turnoutRate: 68.9,
      earlyVoted: 3800,
      electionDayVoted: 5300,
      earlyVoteRate: 41.76
    },
    ageBreakdown: [...],
    precinctBreakdown: [...],
    summary: {...}
  }
}
```

### Appendix B: File Locations Reference

| File | Purpose | Key Lines |
|------|---------|-----------|
| `frontend/src/pages/Analytics.js` | Main analytics page | 1-700 |
| `frontend/src/utils/chart-utils.js` | Chart configuration helpers | 1-400 |
| `frontend/src/api/client.js` | API client functions | 127-128 (election endpoints) |
| `backend/routes/analytics.js` | Analytics API routes | 499-545 (election endpoints) |
| `backend/services/analytics-service.js` | Analytics business logic | 1169-1399 (election methods) |
| `backend/models/voter.js` | Voter and election history models | 1-200 |
| `scripts/setup.js` | Database schema | 72-81 (election_history table) |

### Appendix C: Chart.js Bar Chart Options

**Recommended Configuration:**
```javascript
{
  type: 'bar',
  data: {
    labels: ['E_1', 'E_2'],
    datasets: [
      {
        label: 'Total Registered',
        data: [12500, 13200],
        backgroundColor: '#6b7280',
        borderColor: '#6b7280',
        borderWidth: 1,
        borderRadius: 4
      },
      {
        label: 'Total Voted',
        data: [8300, 9100],
        backgroundColor: '#3b82f6',
        borderColor: '#3b82f6',
        borderWidth: 1,
        borderRadius: 4
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: true,
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function(value) {
            return fmt(value); // Use number formatter
          }
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            return `${context.dataset.label}: ${fmt(context.parsed.y)}`;
          }
        }
      }
    }
  }
}
```

---

## Conclusion

This specification provides a comprehensive roadmap for implementing an Election Turnout Comparison chart on the Analytics page. The solution leverages existing backend APIs, maintains consistency with current UI patterns, and follows Chart.js best practices.

**Estimated Total Implementation Time:** 4-6 hours  
**Priority:** Medium  
**Complexity:** Low-Medium  
**Risk Level:** Low

The implementation is straightforward with minimal dependencies and clear success criteria. All required data sources and libraries are already available, making this a low-risk enhancement to the analytics dashboard.

---

**Specification Author:** GitHub Copilot (Research Agent)  
**Review Status:** Ready for Implementation Review  
**Next Step:** Implementation Phase (Subagent #2)
