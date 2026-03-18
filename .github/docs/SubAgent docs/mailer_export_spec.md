# Physical Mailer Export — Implementation Specification

**Feature:** Physical Mailer Export  
**Date:** 2026-03-16  
**Status:** Ready for Implementation

---

## 1. Summary of Findings

### What Exists (Leverage These)

| Asset | Location | Notes |
|---|---|---|
| `csv-writer` npm package | `package.json` (root) | Already installed, used for CSV export |
| `pdfmake` npm package | `frontend/package.json` | Already installed (`^0.3.6`), used in Analytics |
| `pdfmake-generator.js` | `frontend/src/utils/pdfmake-generator.js` | Full utility — import pattern, styles, progress modal |
| `csv-export.js` | `frontend/src/utils/csv-export.js` | `toCSV`, `downloadCSV`, `escapeCSVField` helpers |
| `VoterModel.findAll()` | `backend/models/voter.js` | Full filter logic — precinct, party, super_voter, name |
| `voters.js` route | `backend/routes/voters.js` | Filter query parameter patterns and validation |
| Filter UI pattern | `frontend/src/pages/Voters.js` | Grid filter row, debounced reload pattern |
| CSV download pattern | `frontend/src/pages/NeverVoted.js` | Blob download via `URL.createObjectURL()` |
| `ui.js` helpers | `frontend/src/components/ui.js` | `sectionHeading`, `spinner`, `errorBox`, `buildTable`, `emptyState`, `debounce`, `fmt` |
| API client | `frontend/src/api/client.js` | `get()` helper; handles `text/csv` content-type |
| Navigation | `frontend/src/main.js` | `NAV_ITEMS` array + `registerRoutes()` |

### What Must Be Added

| Item | Type | Why |
|---|---|---|
| `backend/routes/mailer.js` | New file | Mailer-specific endpoints |
| `frontend/src/pages/Mailer.js` | New file | Mailer UI page |
| `frontend/src/utils/mailer-pdf.js` | New file | Avery 5160 pdfmake label generator |
| Route registration in `backend/server.js` | Edit | Mount `/api/mailer` |
| Nav + route entry in `frontend/src/main.js` | Edit | Add tab + route |
| Client function in `frontend/src/api/client.js` | Edit | `fetchMailerCount`, `exportMailerCsv`, `fetchMailerVoters` |

### Filters Currently Missing in VoterModel

`VoterModel.findAll()` does **not** support `city` or `zip_code` filters — these must be built directly in the mailer route SQL query (not delegated to VoterModel).

---

## 2. Key Architecture Decisions

### Decision 1: PDF Generation on Frontend (not Backend)

**Decision:** Generate Avery 5160 PDF entirely on the frontend using **pdfmake** (already installed in `frontend/package.json`).

**Rationale:**
- `pdfmake ^0.3.6` is already in `frontend/package.json` and used in `pdfmake-generator.js`
- Adding pdfkit to the backend would require a new npm install and introduces a server dependency
- Frontend PDF avoids server-side file streaming complexity
- pdfmake supports precise table-based layouts — ideal for label sheets
- The Analytics page already proves the pdfmake pattern works well

### Decision 2: CSV Export on Backend

**Decision:** Serve CSV via `GET /api/mailer/export?format=csv`, using `csv-writer` already installed in root.

**Rationale:**
- Consistent with the NeverVoted CSV export pattern (backend generates CSV, sets `Content-Type: text/csv`)
- `api/client.js` already handles `text/csv` content-type by returning `res.text()`
- Server-side protects against large data sets and keeps encoding consistent

### Decision 3: Separate `GET /api/mailer/voters` for PDF Data

**Decision:** Add `GET /api/mailer/voters?...filters...&limit=5000` to retrieve voter data for frontend PDF generation.

**Rationale:**
- `/api/voters` has a hard `max: 1000` limit in validation
- The mailer needs up to 5000 voters for large label runs
- A dedicated endpoint with a raised limit (5000) is safer than changing the existing voters endpoint

### Decision 4: No New npm Packages Required

All required libraries are already installed:
- `pdfmake` (frontend) — PDF label generation
- `csv-writer` (root) — backend CSV export
- `express-validator` (root) — input validation

---

## 3. New npm Packages Required

**None.** All required packages are already installed.

---

## 4. File-by-File Implementation Specification

---

### 4.1 `backend/routes/mailer.js` (NEW FILE)

**Purpose:** Three endpoints for mailer feature — count, CSV export, voter data for PDF.

**Reuse:** Build filter logic inline (not via VoterModel) since VoterModel.findAll doesn't support city/zip_code filters and has a 1000-row limit.

#### Filter Parameters (all optional, all query string)

| Param | Type | Validation | DB Column |
|---|---|---|---|
| `precinct` | string | max 3 chars | `v.precinct_number` (padded to 2 chars) |
| `party` | string | `R`, `D`, or `R,D` | via `election_history.party_code` subquery |
| `super_voter` | boolean | `true` or `false` | `v.super_voter` |
| `city` | string | max 100 chars, trimmed | `v.city LIKE ?` (partial match) |
| `zip_code` | string | max 10 chars, trimmed | `v.zip_code = ?` (exact match) |
| `limit` | integer | 1–5000 | LIMIT clause (default: 5000) |

#### Shared Filter Builder Function

```js
/**
 * Build SQL WHERE clause and params array from mailer filters.
 * @param {Object} filters
 * @returns {{ whereClause: string, params: any[] }}
 */
function buildFilters(filters) {
  const conditions = [];
  const params = [];

  if (filters.precinct) {
    conditions.push('v.precinct_number = ?');
    params.push(filters.precinct.toString().padStart(2, '0'));
  }

  if (filters.super_voter !== undefined && filters.super_voter !== '') {
    conditions.push('v.super_voter = ?');
    params.push(filters.super_voter === true || filters.super_voter === 'true' ? 1 : 0);
  }

  if (filters.city) {
    conditions.push('v.city LIKE ?');
    params.push(`%${filters.city}%`);
  }

  if (filters.zip_code) {
    conditions.push('v.zip_code = ?');
    params.push(filters.zip_code);
  }

  if (filters.party) {
    const parties = filters.party.split(',').map(p => p.trim().toUpperCase());
    const placeholders = parties.map(() => '?').join(',');
    conditions.push(`
      v.voter_id IN (
        SELECT DISTINCT voter_id
        FROM election_history
        WHERE party_code IN (${placeholders})
          AND cycle_id IS NULL
      )
    `);
    params.push(...parties);
  }

  const whereClause = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : '';

  return { whereClause, params };
}
```

#### Endpoint 1: `GET /api/mailer/count`

```
Query params: precinct, party, super_voter, city, zip_code
Response: { success: true, count: <number> }
```

SQL template:
```sql
SELECT COUNT(*) as count
FROM voters v
<whereClause>
```

#### Endpoint 2: `GET /api/mailer/export?format=csv`

```
Query params: precinct, party, super_voter, city, zip_code, limit (max 5000)
Response: Content-Type: text/csv
          Content-Disposition: attachment; filename="mailer-export-YYYY-MM-DD.csv"
          Body: CSV text
```

CSV Headers (mail merge format):
```
FirstName,LastName,Address,City,State,ZipCode
```

SQL template:
```sql
SELECT
  v.first_name  AS FirstName,
  v.last_name   AS LastName,
  v.address     AS Address,
  v.city        AS City,
  v.state       AS State,
  v.zip_code    AS ZipCode
FROM voters v
<whereClause>
ORDER BY v.last_name ASC, v.first_name ASC
LIMIT <limit>
```

Use `csv-writer` (`createObjectCsvStringifier`) to generate CSV string, then send via `res.set(...)` and `res.send(csvString)`.

**DO NOT** use `res.download()` or temp files — build string in memory and send directly.

Pattern from `csv-writer`:
```js
const { createObjectCsvStringifier } = require('csv-writer');

const csvStringifier = createObjectCsvStringifier({
  header: [
    { id: 'FirstName', title: 'FirstName' },
    { id: 'LastName',  title: 'LastName'  },
    { id: 'Address',   title: 'Address'   },
    { id: 'City',      title: 'City'      },
    { id: 'State',     title: 'State'     },
    { id: 'ZipCode',   title: 'ZipCode'   },
  ]
});

const csvString = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(rows);
const dateStr = new Date().toISOString().split('T')[0];

res.set({
  'Content-Type': 'text/csv; charset=utf-8',
  'Content-Disposition': `attachment; filename="mailer-export-${dateStr}.csv"`,
});
res.send('\uFEFF' + csvString); // BOM for Excel compatibility
```

#### Endpoint 3: `GET /api/mailer/voters` (for frontend PDF generation)

```
Query params: precinct, party, super_voter, city, zip_code, limit (max 5000, default 5000)
Response: { success: true, count: <number>, data: [ { firstName, lastName, address, city, state, zipCode }, ... ] }
```

SQL template:
```sql
SELECT
  v.first_name  AS firstName,
  v.last_name   AS lastName,
  v.address,
  v.city,
  v.state,
  v.zip_code    AS zipCode
FROM voters v
<whereClause>
ORDER BY v.last_name ASC, v.first_name ASC
LIMIT <limit>
```

#### Full Route File Structure

```js
const express = require('express');
const router = express.Router();
const { query, validationResult } = require('express-validator');
const { createObjectCsvStringifier } = require('csv-writer');
const database = require('../config/database');

const validate = (req, res, next) => { /* standard pattern */ };

const filterValidators = [
  query('precinct').optional().isString().trim().isLength({ max: 3 }),
  query('party').optional().isString().trim().matches(/^(R|D|R,D|D,R)$/),
  query('super_voter').optional().isBoolean(),
  query('city').optional().isString().trim().isLength({ max: 100 }),
  query('zip_code').optional().isString().trim().isLength({ max: 10 }),
  query('limit').optional().isInt({ min: 1, max: 5000 }),
  validate,
];

router.get('/count',   filterValidators, handlerCount);
router.get('/export',  [...filterValidators, query('format').optional().isIn(['csv'])], handlerExport);
router.get('/voters',  filterValidators, handlerVoters);

module.exports = router;
```

---

### 4.2 `backend/server.js` (EDIT)

**Change:** Add one line to mount the mailer route, immediately after the archive route registration.

**Location:** In the "API ROUTES" section, after `app.use('/api/archive', ...)`.

```js
// EXISTING LINE (reference point):
app.use('/api/archive', require('./routes/archive')); // Phase 6: Election Cycle Archive

// ADD THIS LINE:
app.use('/api/mailer', require('./routes/mailer')); // Mailer Export
```

---

### 4.3 `frontend/src/utils/mailer-pdf.js` (NEW FILE)

**Purpose:** Pure function that takes an array of voter records and generates/downloads an Avery 5160 label PDF using pdfmake.

#### Avery 5160 Dimensions (in pdfmake points, where 1pt = 1/72 inch)

| Property | Imperial | Points |
|---|---|---|
| Page width | 8.5" | 612 pt |
| Page height | 11" | 792 pt |
| Label width | 2.625" | 189 pt |
| Label height | 1" | 72 pt |
| Columns | 3 | — |
| Rows per page | 10 | — |
| Top margin | 0.5" | 36 pt |
| Bottom margin | 0.5" | 36 pt |
| Left margin | 0.1875" | 13.5 pt |
| Right margin | 0.1875" | 13.5 pt |
| Column gap | 0.125" | 9 pt |

#### pdfmake Table Layout Strategy

pdfmake does not natively support "labels" but does support fixed-height table rows with no borders. The strategy:

1. Convert the flat voter array into rows of 3 (pad last row if needed)
2. Build a pdfmake `table` node with:
   - `widths: [189, 9, 189, 9, 189]` — 3 label columns + 2 gap columns  
   - A `heights` callback returning either `72` (label rows) or `0` (gap rows — not needed since gap is horizontal not vertical)
   - **Actually:** for Avery 5160 there is NO vertical gap between rows, so a simple table with `heights: [72, 72, ...]` works
3. Each label cell contains voter name, address, city/state/zip in small text
4. Cell borders set to `[false, false, false, false]` via `layout`
5. Cell padding set to `[4, 6, 4, 6]` (left, top, right, bottom) — keep text away from label edge

#### Label Cell Content Structure

Each label is a pdfmake cell content object:
```js
{
  stack: [
    { text: `${voter.firstName} ${voter.lastName}`, fontSize: 10, bold: false },
    { text: voter.address || '', fontSize: 9 },
    { text: `${voter.city || ''}, ${voter.state || ''} ${voter.zipCode || ''}`, fontSize: 9 },
  ],
  // no border, margins will be applied via table layout
}
```

Gap columns between label columns are empty `{ text: '' }` cells with `border: [false,false,false,false]`.

#### Full Export Function Signature

```js
/**
 * Generate and download Avery 5160 mailing label PDF
 * @param {Array<{firstName, lastName, address, city, state, zipCode}>} voters
 * @param {string} [filename] - Optional filename override
 */
export async function generateMailingLabelsPDF(voters, filename) { ... }
```

#### pdfMake Import Pattern

Copy the import pattern from `pdfmake-generator.js`:
```js
import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as pdfFontsModule from 'pdfmake/build/vfs_fonts';

const pdfMake = pdfMakeModule.default || pdfMakeModule;
const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default || pdfFontsModule;
pdfMake.vfs = vfs;
```

#### Document Definition

```js
const docDefinition = {
  pageSize: 'LETTER',
  pageOrientation: 'portrait',
  pageMargins: [13.5, 36, 13.5, 36], // [left, top, right, bottom]
  content: [
    {
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 4,
        paddingRight: () => 4,
        paddingTop: () => 6,
        paddingBottom: () => 0,
      },
      table: {
        widths: [189, 9, 189, 9, 189],
        heights: (rowIndex) => 72,
        body: tableRows, // array of 3-label rows with 2 gap cells
      }
    }
  ],
  defaultStyle: {
    font: 'Roboto',
    fontSize: 10,
  }
};

pdfMake.createPdf(docDefinition).download(filename || `mailing-labels-${dateStr}.pdf`);
```

#### Building tableRows

```js
// chunk voters into groups of 3 (pad last group)
function chunkVoters(voters) {
  const rows = [];
  for (let i = 0; i < voters.length; i += 3) {
    const group = voters.slice(i, i + 3);
    while (group.length < 3) group.push(null); // pad with nulls
    rows.push(group);
  }
  return rows;
}

// build one table row = [label1, gap, label2, gap, label3]
function buildTableRow(group) {
  return [
    buildLabelCell(group[0]),
    { text: '', border: [false, false, false, false] }, // gap col
    buildLabelCell(group[1]),
    { text: '', border: [false, false, false, false] }, // gap col
    buildLabelCell(group[2]),
  ];
}

function buildLabelCell(voter) {
  if (!voter) {
    return { text: '', border: [false, false, false, false] };
  }
  return {
    border: [false, false, false, false],
    stack: [
      {
        text: `${voter.firstName || ''} ${voter.lastName || ''}`.trim(),
        fontSize: 10,
        margin: [0, 0, 0, 2],
      },
      {
        text: voter.address || '',
        fontSize: 9,
        margin: [0, 0, 0, 2],
      },
      {
        text: [voter.city, voter.state, voter.zipCode]
          .filter(Boolean)
          .join(', ')
          .replace(', ', ', ') // city, state zipcode format
          // actually: `${city}, ${state} ${zipCode}`
          ,
        fontSize: 9,
      },
    ],
  };
}
```

**Note:** The city/state/zip line should be formatted as: `${city}, ${state} ${zipCode}` — e.g., "Union City, TN 38261"

---

### 4.4 `frontend/src/pages/Mailer.js` (NEW FILE)

**Purpose:** The Mailer page — filter UI, live count, preview table, export buttons.

#### Page Structure (HTML template)

```
┌─────────────────────────────────────────────────────────────┐
│ Heading: "Mailing Labels" / subtitle                        │
├─────────────────────────────────────────────────────────────┤
│ Filter Panel (white card)                                   │
│   [Precinct]  [Party dropdown]  [Super Voter dropdown]     │
│   [City]      [ZIP Code]        [Limit input]              │
├─────────────────────────────────────────────────────────────┤
│ Count Bar: "X voters match your filters"                    │
├─────────────────────────────────────────────────────────────┤
│ Export Buttons:                                             │
│   [📄 Download PDF Labels]  [📊 Download CSV Mail Merge]   │
├─────────────────────────────────────────────────────────────┤
│ Preview Table (first 10 entries)                           │
│   Name | Address | City | State | ZIP                      │
└─────────────────────────────────────────────────────────────┘
```

#### Filter Controls

Use same CSS class patterns as `Voters.js`:
```
rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none
```

| Control | Type | ID | Options |
|---|---|---|---|
| Precinct | `<input type="text">` | `#m-precinct` | max 3 chars |
| Party | `<select>` | `#m-party` | All / Republican (R) / Democrat (D) |
| Super Voter | `<select>` | `#m-super` | All / Super Voters Only / Non-Super Voters |
| City | `<input type="text">` | `#m-city` | max 100 chars |
| ZIP Code | `<input type="text">` | `#m-zip` | max 10 chars |
| Limit | `<input type="number">` | `#m-limit` | 1–5000, default 5000 |

#### Live Count

- Call `GET /api/mailer/count` with current filters on every filter change (debounced 350ms)
- Display: `"X voters match your filters"` with count formatted via `fmt()`
- Show spinner while loading count
- Count element ID: `#m-count`

#### State Object

```js
let state = {
  filters: {
    precinct: undefined,
    party: undefined,
    super_voter: undefined,
    city: undefined,
    zip_code: undefined,
    limit: 5000,
  },
  count: 0,
  previewData: [],
  loading: false,
};
```

#### Preview Table

- Load first 10 entries for preview on filter change (same debounce as count, combine both calls)
- Call `GET /api/mailer/voters` with `limit=10` for preview
- Use `buildTable()` from `ui.js`
- Columns: Name (Last, First), Address, City, State, ZIP
- Show spinner while loading; show `emptyState()` if no results

#### Export Buttons Component

```html
<div class="flex flex-wrap gap-3">
  <button id="m-export-pdf"
    class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition">
    <svg ...> <!-- document icon --> </svg>
    Download PDF Labels
  </button>
  <button id="m-export-csv"
    class="flex items-center gap-2 bg-success-600 hover:bg-success-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition">
    <svg ...> <!-- table/csv icon --> </svg>
    Download CSV Mail Merge
  </button>
</div>
```

- Buttons are **disabled** when `state.count === 0` or `state.loading === true`
- Show `showToast()` notifications on success/failure (import from `main.js`)

#### PDF Export Handler

```js
container.querySelector('#m-export-pdf').addEventListener('click', async () => {
  const btn = container.querySelector('#m-export-pdf');
  btn.disabled = true;
  showToast('Fetching voter data for PDF...', 'info');
  try {
    const response = await fetchMailerVoters(state.filters);
    const voters = response.data || [];
    if (voters.length === 0) {
      showToast('No voters match current filters', 'warning');
      return;
    }
    showToast(`Generating PDF labels for ${fmt(voters.length)} voters...`, 'info');
    await generateMailingLabelsPDF(voters);
    showToast('PDF labels downloaded successfully', 'success');
  } catch (err) {
    showToast('PDF export failed: ' + err.message, 'error');
  } finally {
    btn.disabled = state.count === 0;
  }
});
```

#### CSV Export Handler

```js
container.querySelector('#m-export-csv').addEventListener('click', async () => {
  const btn = container.querySelector('#m-export-csv');
  btn.disabled = true;
  showToast('Generating CSV mail merge file...', 'info');
  try {
    const csvText = await exportMailerCsv(state.filters);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mailer-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('CSV mail merge file downloaded', 'success');
  } catch (err) {
    showToast('CSV export failed: ' + err.message, 'error');
  } finally {
    btn.disabled = state.count === 0;
  }
});
```

#### Full renderMailer Function Outline

```js
export async function renderMailer(container) {
  container.innerHTML = `...HTML template...`;
  // Wire up filter inputs
  // Set up debounced reload() that calls loadCount() + loadPreview()
  // Wire up export buttons
  // Initial load
  reload();
}

async function loadCount(container) { ... } // calls /api/mailer/count
async function loadPreview(container) { ... } // calls /api/mailer/voters?limit=10
```

---

### 4.5 `frontend/src/api/client.js` (EDIT)

**Add three new exported functions** after the existing Archive section:

```js
// ── Mailer Export ─────────────────────────────────────────────────

export const fetchMailerCount   = (filters = {}) => get('/mailer/count', filters);
export const exportMailerCsv    = (filters = {}) => get('/mailer/export', { ...filters, format: 'csv' });
export const fetchMailerVoters  = (filters = {}) => get('/mailer/voters', filters);
```

---

### 4.6 `frontend/src/main.js` (EDIT)

#### Add Import

```js
import { renderMailer } from './pages/Mailer.js';
```

#### Add to NAV_ITEMS Array

Add after the `archive` entry:
```js
{ path: '/mailer', label: 'Mailer', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
```

#### Add to registerRoutes Call

```js
{ path: '/mailer', title: 'Mailing Labels', render: renderMailer },
```

---

## 5. Complete File List

### New Files
1. `c:\Voter\backend\routes\mailer.js`
2. `c:\Voter\frontend\src\pages\Mailer.js`
3. `c:\Voter\frontend\src\utils\mailer-pdf.js`

### Modified Files
4. `c:\Voter\backend\server.js` — add `app.use('/api/mailer', ...)`
5. `c:\Voter\frontend\src\main.js` — add nav item, import, route registration
6. `c:\Voter\frontend\src\api\client.js` — add 3 mailer API functions

---

## 6. Detailed Implementation Notes

### 6.1 Security & Validation

- All filter parameters validated with `express-validator` (same pattern as `voters.js`)
- `limit` capped at 5000 via `isInt({ min: 1, max: 5000 })`
- SQL uses parameterized queries (never string interpolation of user values)
- Party filter uses `.toUpperCase()` before use
- Precinct padded to 2-char with `padStart(2, '0')` (matches existing voter model)
- City uses `LIKE` with `%value%` — no SQL injection risk since parameterized
- `zip_code` uses exact match `= ?`

### 6.2 Error Handling

**Backend:**
- Return `{ success: false, error: 'Validation failed', details: [...] }` for validation errors (status 400)
- Return `{ success: false, error: 'Internal Server Error' }` for DB errors (status 500)
- Use `next(error)` for unexpected errors (consistent with existing routes)

**Frontend:**
- Count endpoint failure: show inline error message (not toast), allow retry
- PDF generation failure: show error toast
- CSV export failure: show error toast
- All loading states: show spinner while fetching, disable export buttons

### 6.3 Performance Considerations

- Count endpoint executes a `COUNT(*)` query — fast, indexed on precinct/super_voter
- Voter data endpoint returns up to 5000 rows — frontend should show a warning if count > 2000
  - Add warning: `"Large export: generating labels for X voters. This may take a moment."`
- pdfmake PDF generation for 5000 voters (1667 pages) may take 5–15 seconds — show progress toast
- Debounce filter changes at 350ms to avoid thrashing count/preview endpoints

### 6.4 pdfmake Table Width Calculation

```
Page width (points): 612
Left margin: 13.5
Right margin: 13.5
Available width: 612 - 13.5 - 13.5 = 585 pt

Three label columns: 3 × 189 = 567 pt
Two column gaps:     2 × 9   = 18 pt
Total content width: 567 + 18 = 585 pt ✓ Exact fit
```

Table widths array: `[189, 9, 189, 9, 189]`

**Vertical layout check:**
```
Top margin: 36 pt (0.5")
10 rows × 72 pt = 720 pt
Bottom margin: 36 pt (0.5")
Total used: 36 + 720 + 36 = 792 pt ✓ Exact page height
```

### 6.5 CSV Mail Merge Headers

Exact field mapping from database to CSV output:

| CSV Header | SQL Column | Notes |
|---|---|---|
| `FirstName` | `v.first_name` | AS-IS |
| `LastName` | `v.last_name` | AS-IS |
| `Address` | `v.address` | AS-IS |
| `City` | `v.city` | AS-IS |
| `State` | `v.state` | Usually 'TN' |
| `ZipCode` | `v.zip_code` | AS-IS |

The CSV file must include UTF-8 BOM (`\uFEFF`) for Excel compatibility (consistent with existing `csv-export.js` pattern).

### 6.6 Loading & Disabled States

- On initial page load: call reload() immediately
- During count/preview loading: disable export buttons, show spinner in count area
- When count = 0: keep export buttons disabled with title tooltip "No voters match current filters"
- After successful count: enable export buttons, update count display

### 6.7 Page Count Info

Display page count alongside voter count:
```
"X voters match your filters — Y pages of 30 labels"
where Y = Math.ceil(X / 30)
```

---

## 7. Implementation Order

1. **Step 1:** Create `backend/routes/mailer.js` with all three endpoints
2. **Step 2:** Edit `backend/server.js` to mount `/api/mailer`
3. **Step 3:** Create `frontend/src/utils/mailer-pdf.js` with pdfmake label generator
4. **Step 4:** Edit `frontend/src/api/client.js` to add three API functions
5. **Step 5:** Create `frontend/src/pages/Mailer.js` full page component
6. **Step 6:** Edit `frontend/src/main.js` to add nav item, import, and route registration

---

## 8. Test Checklist

### Backend Tests
- [ ] `GET /api/mailer/count` with no filters returns total voter count
- [ ] `GET /api/mailer/count?precinct=01` returns correct filtered count
- [ ] `GET /api/mailer/count?party=R` returns only R-party voters
- [ ] `GET /api/mailer/count?super_voter=true` returns only super voters
- [ ] `GET /api/mailer/count?city=Union%20City` returns city-filtered count
- [ ] `GET /api/mailer/count?zip_code=38261` returns zip-exact match count
- [ ] `GET /api/mailer/export?format=csv` returns `Content-Type: text/csv` and correct headers
- [ ] CSV has BOM byte (`\uFEFF`) at start
- [ ] CSV headers exactly: `FirstName,LastName,Address,City,State,ZipCode`
- [ ] `GET /api/mailer/export?limit=6001` returns 400 validation error
- [ ] `GET /api/mailer/voters?limit=10` returns max 10 records

### Frontend Tests
- [ ] Page loads without errors
- [ ] Count updates when filters change (debounced)
- [ ] Export buttons disabled when count = 0
- [ ] PDF download triggers via pdfmake
- [ ] PDF is Avery 5160 compatible (3 columns, 10 rows per page, 30 labels/page)
- [ ] CSV download triggers with correct filename
- [ ] Preview table shows first 10 voters
- [ ] Dark mode styling correct
- [ ] Toast notifications appear on export success/failure
- [ ] Page appears in tab navigation

---

## 9. Reference: Existing Patterns to Follow

### Route Registration Pattern (`server.js` lines 308-315):
```js
app.use('/api/voters/never-voted', require('./routes/never-voted'));
app.use('/api/voters', require('./routes/voters'));
// ... etc
app.use('/api/mailer', require('./routes/mailer')); // ADD HERE
```

### Filter Validation Pattern (`voters.js` lines 33-65):
```js
router.get('/', [
  query('precinct').optional().isString().trim(),
  // ...
  validate
], async (req, res, next) => { ... });
```

### CSV Content-Type Response (based on `client.js` text/csv handling):
The `client.js` `request()` function returns `res.text()` when Content-Type is `text/csv` — the frontend receives the raw CSV string and handles the download.

### pdfmake Import (`pdfmake-generator.js` lines 1-15):
```js
import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as pdfFontsModule from 'pdfmake/build/vfs_fonts';
const pdfMake = pdfMakeModule.default || pdfMakeModule;
const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default || pdfFontsModule;
pdfMake.vfs = vfs;
```

### Debounced Filter Reload (`Voters.js` lines 67-76):
```js
const reload = debounce(() => {
  state.filters.offset = 0;
  state.filters.precinct = precinctInput.value || undefined;
  // ...
  loadVoters(container);
}, 350);
```

### CSV Blob Download (`NeverVoted.js` lines 58-66):
```js
const csv = await exportNeverVotedCsv(state.filters);
const blob = new Blob([csv], { type: 'text/csv' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'filename.csv';
a.click();
URL.revokeObjectURL(a.href);
```

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| pdfmake hangs the browser thread for large PDFs (>1000 labels) | Show toast "Generating PDF for X voters..." before calling pdfmake; future improvement: web worker |
| Missing `state` field in some voter records | Default to empty string in pdfmake template: `voter.state \|\| ''` |
| Missing `address` field | Default to empty string; label still renders with name + city/zip |
| `csv-writer` version incompatibility | Use `createObjectCsvStringifier` (already in codebase package.json `^1.6.0`) |
| City `LIKE` search returns too many results | City is combined with other filters; max 5000 cap prevents overload |
| User exports 5000-label PDF and crashes browser | Add count warning message for > 2000 voters |
