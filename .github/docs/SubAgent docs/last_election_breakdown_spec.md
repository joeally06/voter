# Last Election Breakdown - Feature Specification

## Summary

Add a "Last Election Breakdown" analytics section to the Voter Platform Analytics page, showing:
1. How many people voted in the last (most recent) election
2. Age distribution of those voters
3. Precinct breakdown of those voters

---

## 1. Current State Analysis

### 1.1 Database Schema (Relevant Tables)

**`voters` table:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `voter_id` | TEXT UNIQUE | State voter ID |
| `last_name` | TEXT | Last name |
| `first_name` | TEXT | First name |
| `address` | TEXT | Street address |
| `city` | TEXT | City |
| `state` | TEXT | State code (e.g. TN) |
| `zip_code` | TEXT | ZIP code |
| `precinct_number` | TEXT | Precinct (zero-padded, e.g. "01") |
| `date_of_birth` | TEXT | ISO-8601 (YYYY-MM-DD), nullable |
| `latitude` | REAL | Geocoded lat |
| `longitude` | REAL | Geocoded lng |
| `geocoding_quality` | TEXT | Quality score |
| `super_voter` | BOOLEAN | 0/1 flag |
| `created_at` | DATETIME | Record creation |
| `updated_at` | DATETIME | Last update |

**`election_history` table:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `voter_id` | TEXT FK→voters.voter_id | Voter reference |
| `election_code` | TEXT | Election identifier (e.g. `E_1`, `E_5`) |
| `voted` | BOOLEAN | 0/1 whether voter participated |
| `party_code` | TEXT | Party affiliation (`R`, `D`, `I`, or NULL) |
| `early_voted` | BOOLEAN | 0/1 early voting flag |
| `created_at` | DATETIME | Record creation |

**`precincts` table:**
| Column | Type | Description |
|--------|------|-------------|
| `precinct_number` | TEXT UNIQUE | Precinct ID (zero-padded) |
| `name` | TEXT | Precinct name |
| `total_voters` | INTEGER | Total registered voters |
| `active_voters` | INTEGER | Active voters |
| `super_voters` | INTEGER | Super voter count |

### 1.2 Election Code Format

Election history codes are parsed from CSV `E_*` columns (e.g. `E_1`, `E_2`, ..., `E_10`). The CSV value format is `YDY` (Voted/Party/EarlyVoted). The codebase also includes sorting logic for year-prefixed codes (`2024G`, `2024P`) but the primary data source uses the `E_N` format.

**Determining "last election":** The "last" (most recent) election is the one with the highest election number. For `E_N` codes, this is `MAX(CAST(SUBSTR(election_code, 3) AS INTEGER))`. For safety we should also handle year-prefixed codes by falling back to `MAX(election_code)`.

### 1.3 Existing Analytics Endpoints

| Endpoint | Service Method | Description |
|----------|----------------|-------------|
| `GET /api/analytics/dashboard` | `getDashboardMetrics()` | Overview totals |
| `GET /api/analytics/turnout` | `getTurnoutAnalysis(filters)` | Turnout stats by election |
| `GET /api/analytics/voting-patterns` | `getVotingPatterns(filters)` | Cross-election patterns |
| `GET /api/analytics/super-voters` | `getSuperVoterAnalysis(filters)` | Super voter analysis |
| `GET /api/analytics/party-affiliation` | `getPartyAffiliation(filters)` | Party distribution |
| `GET /api/analytics/demographics` | `getDemographics(filters)` | City/zip/age distribution |
| `GET /api/analytics/engagement-levels` | `getEngagementLevels(filters)` | Never/occasional/super |
| `GET /api/analytics/non-voter-demographics` | `getNonVoterDemographics(filters)` | Non-voter age analysis |
| `GET /api/analytics/non-voters-by-precinct` | `getNonVotersByPrecinct()` | Precinct non-voter severity |

### 1.4 Frontend Architecture

- **Framework:** Vanilla JS SPA with hash-based routing (`router.js`)
- **Styling:** TailwindCSS with dark mode (`dark:` classes)
- **Charting:** No charting library — uses CSS progress bars, cards, and HTML tables
- **UI Components:** Shared helpers in `frontend/src/components/ui.js`: `statCard()`, `spinner()`, `errorBox()`, `sectionHeading()`, `buildTable()`, `fmt()`, `pct()`, `escapeHtml()`
- **API Client:** Centralized in `frontend/src/api/client.js` — exports named functions calling a shared `request()` helper
- **Page Pattern:** Each page exports an `async render*(container)` function that fetches data via the API client and renders HTML into the container

### 1.5 Frontend Analytics Page (Current Sections)

The `renderAnalytics(container)` function in `Analytics.js` currently:
1. Fetches 5 APIs in parallel via `Promise.allSettled()`
2. Renders:
   - **Overview Cards** — Total Voters, Super Voters, Precincts, Geocoded (grid of `statCard`)
   - **Engagement Levels** — Progress bars (Never Voted, Occasional, Super Voters)
   - **Party Affiliation** — Color-coded cards (R/D/other)
   - **Non-Voters by Precinct** — Sortable table with severity badges
   - **Demographics** — Distribution by city with progress bars

---

## 2. Proposed Solution

### 2.1 New API Endpoint

**`GET /api/analytics/last-election-breakdown`**

Query parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `precinct` | string | No | Filter by precinct number (2 digits) |

Response structure:
```json
{
  "success": true,
  "timestamp": "2026-02-17T...",
  "queryTime": 42,
  "data": {
    "election": {
      "electionCode": "E_5",
      "totalRegistered": 12500,
      "totalVoted": 8750,
      "turnoutRate": 70.0,
      "earlyVoted": 3200,
      "electionDayVoted": 5550,
      "earlyVoteRate": 36.57
    },
    "ageBreakdown": [
      {
        "ageGroup": "18-24",
        "count": 420,
        "percentage": 4.8,
        "earlyVoteRate": 22.5
      },
      {
        "ageGroup": "25-34",
        "count": 1100,
        "percentage": 12.57,
        "earlyVoteRate": 30.1
      },
      // ... other age groups
      {
        "ageGroup": "Unknown",
        "count": 50,
        "percentage": 0.57,
        "earlyVoteRate": 10.0
      }
    ],
    "precinctBreakdown": [
      {
        "precinctNumber": "01",
        "precinctName": "Precinct 01",
        "voted": 650,
        "registered": 900,
        "turnoutRate": 72.22,
        "earlyVoteRate": 35.0,
        "partyBreakdown": {
          "democrat": 280,
          "republican": 310,
          "independent": 20,
          "unknown": 40
        }
      }
      // ... other precincts
    ],
    "summary": {
      "highestTurnoutPrecinct": "03",
      "lowestTurnoutPrecinct": "07",
      "largestAgeGroup": "55-64",
      "medianAgeGroup": "45-54"
    }
  }
}
```

### 2.2 Backend Changes

#### 2.2.1 Analytics Service — New Method

**File:** `backend/services/analytics-service.js`

Add method `getLastElectionBreakdown(filters)`:

```javascript
/**
 * Get breakdown of the last (most recent) election
 * Shows who voted, their age distribution, and precinct distribution
 * 
 * @param {Object} filters - Query filters
 * @param {string} [filters.precinct] - Optional precinct filter
 * @returns {Promise<Object>} Last election breakdown data
 */
async getLastElectionBreakdown(filters = {}) {
  const cacheKey = this._getCacheKey('last_election_breakdown', filters);
  const cached = this._getFromCache(cacheKey);
  if (cached) return cached;

  const startTime = Date.now();

  try {
    // Step 1: Determine the most recent election code
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

    const electionCode = lastElection.election_code;
    let precinctFilter = '';
    const params = [electionCode];

    if (filters.precinct) {
      precinctFilter = 'AND v.precinct_number = ?';
      params.push(filters.precinct);
    }

    // Step 2: Run all breakdown queries in parallel
    const [electionStats, ageBreakdown, precinctBreakdown] = await Promise.all([
      // Overall election stats
      this.db.get(`
        SELECT 
          COUNT(DISTINCT v.id) as totalRegistered,
          COUNT(DISTINCT CASE WHEN e.voted = 1 THEN v.id END) as totalVoted,
          SUM(CASE WHEN e.voted = 1 AND e.early_voted = 1 THEN 1 ELSE 0 END) as earlyVoted,
          SUM(CASE WHEN e.voted = 1 AND (e.early_voted = 0 OR e.early_voted IS NULL) THEN 1 ELSE 0 END) as electionDayVoted
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
        WHERE 1=1 ${precinctFilter}
      `, params),

      // Age breakdown of voters in this election
      this.db.all(`
        SELECT 
          CASE 
            WHEN v.date_of_birth IS NULL THEN 'Unknown'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) < 18 THEN 'Under 18'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 18 AND 24 THEN '18-24'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 25 AND 34 THEN '25-34'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 35 AND 44 THEN '35-44'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 45 AND 54 THEN '45-54'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 55 AND 64 THEN '55-64'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN 65 AND 74 THEN '65-74'
            WHEN CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) >= 75 THEN '75+'
            ELSE 'Unknown'
          END AS ageGroup,
          COUNT(*) as count,
          SUM(CASE WHEN e.early_voted = 1 THEN 1 ELSE 0 END) as earlyVoted
        FROM voters v
        JOIN election_history e ON v.voter_id = e.voter_id
        WHERE e.election_code = ? AND e.voted = 1 ${precinctFilter}
        GROUP BY ageGroup
        ORDER BY 
          CASE ageGroup
            WHEN 'Under 18' THEN 1
            WHEN '18-24' THEN 2
            WHEN '25-34' THEN 3
            WHEN '35-44' THEN 4
            WHEN '45-54' THEN 5
            WHEN '55-64' THEN 6
            WHEN '65-74' THEN 7
            WHEN '75+' THEN 8
            WHEN 'Unknown' THEN 9
          END
      `, params),

      // Precinct breakdown
      this.db.all(`
        SELECT 
          v.precinct_number as precinctNumber,
          p.name as precinctName,
          COUNT(CASE WHEN e.voted = 1 THEN 1 END) as voted,
          (SELECT COUNT(*) FROM voters v2 WHERE v2.precinct_number = v.precinct_number) as registered,
          SUM(CASE WHEN e.voted = 1 AND e.early_voted = 1 THEN 1 ELSE 0 END) as earlyVoted,
          SUM(CASE WHEN e.voted = 1 AND e.party_code = 'D' THEN 1 ELSE 0 END) as democrat,
          SUM(CASE WHEN e.voted = 1 AND e.party_code = 'R' THEN 1 ELSE 0 END) as republican,
          SUM(CASE WHEN e.voted = 1 AND e.party_code = 'I' THEN 1 ELSE 0 END) as independent,
          SUM(CASE WHEN e.voted = 1 AND (e.party_code IS NULL OR e.party_code = '') THEN 1 ELSE 0 END) as unknownParty
        FROM voters v
        LEFT JOIN election_history e ON v.voter_id = e.voter_id AND e.election_code = ?
        LEFT JOIN precincts p ON v.precinct_number = p.precinct_number
        WHERE 1=1 ${precinctFilter}
        GROUP BY v.precinct_number, p.name
        HAVING voted > 0
        ORDER BY v.precinct_number
      `, params)
    ]);

    // Format results
    const totalVoted = electionStats?.totalVoted || 0;
    const totalRegistered = electionStats?.totalRegistered || 0;

    // Find summary stats
    const sortedPrecincts = [...precinctBreakdown].sort((a, b) => {
      const rateA = a.registered > 0 ? a.voted / a.registered : 0;
      const rateB = b.registered > 0 ? b.voted / b.registered : 0;
      return rateB - rateA;
    });
    const knownAgeGroups = ageBreakdown.filter(a => a.ageGroup !== 'Unknown');
    const largestAgeGroup = knownAgeGroups.reduce((max, g) => g.count > (max?.count || 0) ? g : max, null);

    const result = {
      election: {
        electionCode,
        totalRegistered,
        totalVoted,
        turnoutRate: totalRegistered > 0 ? parseFloat((totalVoted / totalRegistered * 100).toFixed(2)) : 0,
        earlyVoted: electionStats?.earlyVoted || 0,
        electionDayVoted: electionStats?.electionDayVoted || 0,
        earlyVoteRate: totalVoted > 0 ? parseFloat(((electionStats?.earlyVoted || 0) / totalVoted * 100).toFixed(2)) : 0
      },
      ageBreakdown: ageBreakdown.map(a => ({
        ageGroup: a.ageGroup,
        count: a.count,
        percentage: totalVoted > 0 ? parseFloat((a.count / totalVoted * 100).toFixed(2)) : 0,
        earlyVoteRate: a.count > 0 ? parseFloat((a.earlyVoted / a.count * 100).toFixed(2)) : 0
      })),
      precinctBreakdown: precinctBreakdown.map(p => ({
        precinctNumber: p.precinctNumber,
        precinctName: p.precinctName || `Precinct ${p.precinctNumber}`,
        voted: p.voted,
        registered: p.registered,
        turnoutRate: p.registered > 0 ? parseFloat((p.voted / p.registered * 100).toFixed(2)) : 0,
        earlyVoteRate: p.voted > 0 ? parseFloat((p.earlyVoted / p.voted * 100).toFixed(2)) : 0,
        partyBreakdown: {
          democrat: p.democrat,
          republican: p.republican,
          independent: p.independent,
          unknown: p.unknownParty
        }
      })),
      summary: {
        highestTurnoutPrecinct: sortedPrecincts.length > 0 ? sortedPrecincts[0].precinctNumber : null,
        lowestTurnoutPrecinct: sortedPrecincts.length > 0 ? sortedPrecincts[sortedPrecincts.length - 1].precinctNumber : null,
        largestAgeGroup: largestAgeGroup?.ageGroup || null
      },
      queryTime: Date.now() - startTime
    };

    this._setCache(cacheKey, result, this.cacheTTL.analytics);
    return result;

  } catch (error) {
    console.error('Last election breakdown error:', error);
    throw new Error('Failed to analyze last election breakdown');
  }
}
```

**Key design decisions:**
- Reuses the existing caching pattern (`_getCacheKey`, `_getFromCache`, `_setCache`)
- Determines "last election" dynamically by querying the highest `E_N` code
- Runs age/precinct queries in parallel with `Promise.all()` (consistent with existing service pattern)
- Uses the same age grouping SQL (CASE/WHEN on `date_of_birth`) already used in `getDemographics()` and `getNonVoterDemographics()`

#### 2.2.2 Analytics Route — New Endpoint

**File:** `backend/routes/analytics.js`

Add before `module.exports = router;`:

```javascript
/**
 * GET /api/analytics/last-election-breakdown
 * Get breakdown of the most recent election: who voted, age distribution, precinct distribution
 *
 * Query parameters:
 * - precinct: Filter by precinct number (2 digits, optional)
 *
 * Returns:
 * - Election summary (total voted, turnout rate, early vote stats)
 * - Age group breakdown of voters
 * - Precinct-level breakdown with party data
 * - Summary highlights (highest/lowest turnout precincts, largest age group)
 *
 * Example: GET /api/analytics/last-election-breakdown
 * Example: GET /api/analytics/last-election-breakdown?precinct=05
 */
router.get('/last-election-breakdown', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const filters = {
            precinct: req.query.precinct
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

**Pattern consistency:** Follows exact same structure as existing routes (validation middleware, `AnalyticsService` instantiation, `filters` object, response format, error forwarding to `next(error)`).

### 2.3 Frontend Changes

#### 2.3.1 API Client — New Export

**File:** `frontend/src/api/client.js`

Add to the Analytics section:

```javascript
export const fetchLastElectionBreakdown = (p = {}) => get('/analytics/last-election-breakdown', p);
```

#### 2.3.2 Analytics Page — New Section

**File:** `frontend/src/pages/Analytics.js`

**Import change:**
```javascript
import { fetchDashboard, fetchEngagement, fetchPartyAffil, fetchNonVoterPrecinct, fetchDemographics, fetchLastElectionBreakdown } from '../api/client.js';
```

**Data fetching change — add 6th API call:**
```javascript
const [dashboard, engagement, party, nonVoterPct, demographics, lastElection] = await Promise.allSettled([
  fetchDashboard(),
  fetchEngagement(),
  fetchPartyAffil(),
  fetchNonVoterPrecinct(),
  fetchDemographics(),
  fetchLastElectionBreakdown(),
]);
```

**Extract result:**
```javascript
const leb = lastElection.status === 'fulfilled' ? (lastElection.value.data || lastElection.value) : null;
```

**Render in template — add after Overview Cards, before Engagement Levels:**
```javascript
<!-- Last Election Breakdown -->
${leb ? renderLastElectionBreakdown(leb) : ''}
```

#### 2.3.3 New Render Function: `renderLastElectionBreakdown(data)`

```javascript
function renderLastElectionBreakdown(data) {
  const election = data.election;
  if (!election) return '';

  return `
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-1">Last Election Breakdown</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">Election: ${escapeHtml(election.electionCode)}</p>

      <!-- Summary Stats Row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        ${statCard('Voted', fmt(election.totalVoted), pct(election.turnoutRate) + ' turnout', 'primary')}
        ${statCard('Registered', fmt(election.totalRegistered), '', 'gray')}
        ${statCard('Early Voted', fmt(election.earlyVoted), pct(election.earlyVoteRate), 'success')}
        ${statCard('Election Day', fmt(election.electionDayVoted), '', 'warning')}
      </div>

      <!-- Age Distribution -->
      ${renderAgeBreakdown(data.ageBreakdown)}

      <!-- Precinct Breakdown -->
      ${renderPrecinctTurnout(data.precinctBreakdown)}
    </div>`;
}
```

#### 2.3.4 New Render Function: `renderAgeBreakdown(ageData)`

```javascript
function renderAgeBreakdown(ageData) {
  if (!Array.isArray(ageData) || ageData.length === 0) return '';
  
  const maxCount = Math.max(...ageData.map(a => a.count));

  return `
    <div class="mb-6">
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Voters by Age Group</h4>
      <div class="space-y-2">
        ${ageData.map(a => {
          const barWidth = maxCount > 0 ? (a.count / maxCount * 100) : 0;
          return `
            <div class="flex items-center gap-3">
              <span class="text-xs font-medium w-16 text-gray-600 dark:text-gray-400">${escapeHtml(a.ageGroup)}</span>
              <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div class="bg-primary-500 h-3 rounded-full transition-all" style="width: ${barWidth}%"></div>
              </div>
              <span class="text-xs text-gray-500 w-24 text-right">${fmt(a.count)} (${pct(a.percentage)})</span>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}
```

#### 2.3.5 New Render Function: `renderPrecinctTurnout(precinctData)`

```javascript
function renderPrecinctTurnout(precinctData) {
  if (!Array.isArray(precinctData) || precinctData.length === 0) return '';

  return `
    <div>
      <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Turnout by Precinct</h4>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            <tr>
              <th class="px-4 py-3 text-left font-semibold">Precinct</th>
              <th class="px-4 py-3 text-left font-semibold">Voted</th>
              <th class="px-4 py-3 text-left font-semibold">Registered</th>
              <th class="px-4 py-3 text-left font-semibold">Turnout</th>
              <th class="px-4 py-3 text-left font-semibold">Early %</th>
              <th class="px-4 py-3 text-left font-semibold">D</th>
              <th class="px-4 py-3 text-left font-semibold">R</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            ${precinctData.map(p => {
              const turnoutColor = p.turnoutRate >= 70 ? 'text-green-600' 
                : p.turnoutRate >= 50 ? 'text-amber-600' 
                : 'text-red-600';
              return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td class="px-4 py-3 font-medium">${escapeHtml(p.precinctNumber)}</td>
                  <td class="px-4 py-3">${fmt(p.voted)}</td>
                  <td class="px-4 py-3">${fmt(p.registered)}</td>
                  <td class="px-4 py-3 font-semibold ${turnoutColor}">${pct(p.turnoutRate)}</td>
                  <td class="px-4 py-3">${pct(p.earlyVoteRate)}</td>
                  <td class="px-4 py-3 text-blue-600">${fmt(p.partyBreakdown.democrat)}</td>
                  <td class="px-4 py-3 text-red-600">${fmt(p.partyBreakdown.republican)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
```

### 2.4 UI/UX Design

The new section will be placed **after the Overview Cards** and **before the Engagement Levels** section on the Analytics page. This gives it prominent placement as the first detailed section.

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Analytics - Voter statistics and insights               │
├─────────────────────────────────────────────────────────┤
│ [Total Voters] [Super Voters] [Precincts] [Geocoded]   │  ← Existing Overview Cards
├─────────────────────────────────────────────────────────┤
│ Last Election Breakdown                                 │  ← NEW SECTION
│ Election: E_5                                           │
│                                                         │
│ [Voted: 8,750] [Registered: 12,500] [Early: 3,200] ... │  ← Summary stat cards
│                                                         │
│ Voters by Age Group                                     │  ← Horizontal bar chart
│ 18-24  ████░░░░░░░░░░░░░░  420 (4.8%)                 │
│ 25-34  ████████░░░░░░░░░░  1,100 (12.6%)              │
│ 35-44  ██████████░░░░░░░░  1,450 (16.6%)              │
│ 45-54  ████████████░░░░░░  1,800 (20.6%)              │
│ 55-64  ██████████████░░░░  2,100 (24.0%)              │
│ 65-74  ██████████░░░░░░░░  1,500 (17.1%)              │
│ 75+    ████░░░░░░░░░░░░░░  380 (4.3%)                 │
│                                                         │
│ Turnout by Precinct                                     │  ← Table
│ ┌──────────┬───────┬──────────┬─────────┬───────┬─┬─┐  │
│ │ Precinct │ Voted │ Register │ Turnout │ Early │D│R│  │
│ ├──────────┼───────┼──────────┼─────────┼───────┼─┼─┤  │
│ │ 01       │  650  │    900   │  72.2%  │ 35.0% │…│…│  │
│ │ 03       │  480  │    650   │  73.8%  │ 40.2% │…│…│  │
│ │ ...      │       │          │         │       │ │ │  │
│ └──────────┴───────┴──────────┴─────────┴───────┴─┴─┘  │
├─────────────────────────────────────────────────────────┤
│ Engagement Levels                                       │  ← Existing section
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

**Styling approach:**
- Wrapped in a `bg-white dark:bg-gray-900 rounded-xl border` card (same as all existing sections)
- Summary row uses the existing `statCard()` helper in a 4-column grid
- Age breakdown uses horizontal CSS progress bars with `bg-primary-500` (consistent with Demographics section)
- Precinct table uses the same table styling as Non-Voters by Precinct section
- Color-coded turnout: green (≥70%), amber (≥50%), red (<50%)
- Party columns: blue for D, red for R (consistent with Party Affiliation section)

---

## 3. Implementation Steps (Ordered)

### Step 1: Backend Service Method
**File:** `backend/services/analytics-service.js`
- Add `getLastElectionBreakdown(filters)` method to `AnalyticsService` class
- Place it after `getNonVotersByPrecinct()` and before the class closing brace
- Follows existing patterns: caching, parallel queries, error handling

### Step 2: Backend Route
**File:** `backend/routes/analytics.js`
- Add `GET /api/analytics/last-election-breakdown` route
- Place it before the existing `module.exports = router;` line
- Include `precinct` query parameter validation (same pattern as other routes)

### Step 3: Frontend API Client
**File:** `frontend/src/api/client.js`
- Add `fetchLastElectionBreakdown` export in the Analytics section

### Step 4: Frontend Analytics Page
**File:** `frontend/src/pages/Analytics.js`

4a. Update import to include `fetchLastElectionBreakdown`
4b. Add 6th API call to `Promise.allSettled()` array
4c. Extract result with `lastElection.value.data` pattern
4d. Add `renderLastElectionBreakdown(leb)` call in the template
4e. Add three new render functions: `renderLastElectionBreakdown()`, `renderAgeBreakdown()`, `renderPrecinctTurnout()`

### Step 5: Test & Validate
- Start backend server and verify endpoint returns correct data
- Verify frontend renders the new section
- Test with precinct filter parameter
- Verify caching works (second request < 1ms)
- Verify dark mode rendering

---

## 4. No Database Migration Required

All required data already exists in the `voters` and `election_history` tables:
- **Election participation:** `election_history.voted` and `election_history.election_code`
- **Age/DOB:** `voters.date_of_birth` (TEXT, ISO-8601 format)
- **Precinct:** `voters.precinct_number`
- **Party:** `election_history.party_code`
- **Early voting:** `election_history.early_voted`

No new tables, columns, or indexes are needed.

---

## 5. Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| No election history data loaded | Return `{ election: null }` gracefully; frontend shows nothing |
| Missing DOB for some voters | Age grouped as "Unknown"; percentage still calculated correctly |
| Election code format inconsistency | Query handles both `E_N` numeric sorting and general `MAX()` fallback |
| Large dataset slow queries | Uses in-memory caching (15-min TTL); parallel Promise.all |
| No third-party dependencies | Pure SQL + existing UI components; zero new packages |

---

## 6. Files Modified (Summary)

| File | Change Type | Description |
|------|-------------|-------------|
| `backend/services/analytics-service.js` | ADD method | `getLastElectionBreakdown(filters)` |
| `backend/routes/analytics.js` | ADD route | `GET /api/analytics/last-election-breakdown` |
| `frontend/src/api/client.js` | ADD export | `fetchLastElectionBreakdown` |
| `frontend/src/pages/Analytics.js` | MODIFY | New import, API call, render functions |
