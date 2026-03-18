# Flyer Creator — Full Implementation Specification

**Date:** 2026-03-16  
**Feature:** Two-sided campaign flyer creator with fabric.js canvas editor and pdfmake PDF export  
**Status:** Research complete — ready for implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Codebase Patterns Documented](#2-codebase-patterns-documented)
3. [Complete File List](#3-complete-file-list)
4. [Dependency Changes](#4-dependency-changes)
5. [Backend: No New Files Needed](#5-backend-no-new-files-needed)
6. [Frontend: main.js Modifications](#6-frontend-mainjs-modifications)
7. [Frontend: FlyerCreator.js — Full Structure](#7-frontend-flyercreatorjs--full-structure)
8. [Frontend: flyer-pdf.js — Full Structure](#8-frontend-flyer-pdfjs--full-structure)
9. [pdfmake Document Definition (Two-Sided)](#9-pdfmake-document-definition-two-sided)
10. [fabric.js Initialization Pattern](#10-fabricjs-initialization-pattern)
11. [Voter Filter Fields](#11-voter-filter-fields)
12. [Image Storage Approach](#12-image-storage-approach)
13. [OKLCH Color Workaround](#13-oklch-color-workaround)
14. [API Endpoints Used](#14-api-endpoints-used)
15. [Wire-Frame / UI Flow](#15-wire-frame--ui-flow)
16. [Security Considerations](#16-security-considerations)

---

## 1. Executive Summary

The Flyer Creator is a two-step, entirely client-side feature:

| Step | Description |
|------|-------------|
| **Step 1 — Design** | User uploads a background image; a fabric.js canvas editor lets them drag/resize/style text boxes on top |
| **Step 2 — Recipients** | User picks voters using the same filter UI as the Mailer page |
| **Export** | pdfmake generates a multi-page PDF: pages alternate [front, voter_back, front, voter_back, …] for duplex printing |

**Key design decisions:**
- **No new backend files.** The image is stored client-side as base64; voter data reuses the existing `/api/mailer/voters` and `/api/mailer/count` endpoints.
- **fabric.js v6** installed as an npm package and imported as ESM (Vite-compatible).
- **pdfmake** (already installed) handles PDF generation — no OKLCH workaround needed (pdfmake renders natively, does not use html2canvas).
- **Alternating pages** (front, back, front, back …) so the user can print duplex on a single pass.

---

## 2. Codebase Patterns Documented

### 2.1 Router Pattern (`router.js`)

```js
// router.js exports:
registerRoutes(routeList)   // called once in main.js bootstrap
startRouter(container)      // called once; listens to hashchange
navigateTo(path)            // programmatic navigation
getCurrentPath()            // returns window.location.hash.slice(1) || '/'

// Each route object:
{ path: '/some-path', title: 'Page Title', render: renderFunction }

// render function signature:
async function renderXxx(container) {
  container.innerHTML = '...';
  // wire up events
  return () => { /* optional cleanup */ };  // cleanup called on nav away
}
```

### 2.2 Nav Item Pattern (`main.js`)

```js
// NAV_ITEMS array at top of main.js:
const NAV_ITEMS = [
  { path: '/',        label: 'Dashboard',     icon: '...' }, // SVG path d attr
  { path: '/mailer',  label: 'Mailer',        icon: '...' },
  // NEW:
  { path: '/flyer',   label: 'Flyer Creator', icon: '...' },
];

// Tab links use: href="#${item.path}" and dataset.path = item.path
// Active tab detection: link.dataset.path === getCurrentPath()
```

### 2.3 Mailer State & Filter Pattern (`Mailer.js`)

```js
// Module-level state, reset on each renderMailer() call:
let state = {
  filters: {
    precinct:    undefined,  // string | undefined
    party:       undefined,  // 'R' | 'D' | undefined
    super_voter: undefined,  // 'true' | 'false' | undefined
    city:        undefined,
    zip_code:    undefined,
    limit:       5000,
  },
  count:       0,
  previewData: [],
  loading:     false,
};

// Debounced reload:
const reload = debounce(() => {
  state.filters.precinct = precinctInput.value.trim() || undefined;
  // ... sync all filter inputs to state.filters
  loadCount(container);
  loadPreview(container);
}, 350);

// Count loader:
async function loadCount(container) {
  const res = await fetchMailerCount(state.filters); // GET /api/mailer/count
  state.count = res.count || 0;
  // update UI, enable/disable export buttons
}

// Preview loader:
async function loadPreview(container) {
  const res = await fetchMailerVoters({ ...state.filters, limit: 10 });
  // render table with columns: Name, Address, City, State, ZIP
}
```

### 2.4 pdfmake Pattern (`mailer-pdf.js`)

```js
// Import pattern (handles CommonJS/ESM shape):
import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as pdfFontsModule from 'pdfmake/build/vfs_fonts';

const pdfMake = pdfMakeModule.default || pdfMakeModule;
const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default || pdfFontsModule;
pdfMake.vfs = vfs;

// Document definition:
const docDefinition = {
  pageSize: 'LETTER',
  pageOrientation: 'portrait',
  pageMargins: [left, top, right, bottom],  // in points (1/72")
  content: [ /* content items */ ],
  defaultStyle: { font: 'Roboto', fontSize: 10 },
};

// Generate and download:
pdfMake.createPdf(docDefinition).download('filename.pdf');
```

### 2.5 API Client Pattern (`client.js`)

```js
// All calls go through base `request()` helper
const get  = (path, params, signal) => request('GET', path, { params, signal });
const post = (path, body)           => request('POST', path, { body });

// FormData uploads (file inputs) — no Content-Type header:
const fd = new FormData();
fd.append('fieldName', file);
return post('/upload/route', fd);

// Existing mailer endpoints (REUSED for flyer):
export const fetchMailerCount  = (filters = {}) => get('/mailer/count', filters);
export const fetchMailerVoters = (filters = {}) => get('/mailer/voters', filters);
```

### 2.6 Multer Upload Pattern (`upload.js`)

```js
// Storage: save to data/raw with timestamp prefix
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../data/raw')),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});

// Security: validate extension + filename characters
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.allowed') return cb(new Error('Only .allowed files are accepted'));
    if (!/^[a-zA-Z0-9_\-. ]+$/.test(path.basename(file.originalname)))
      return cb(new Error('Invalid filename characters'));
    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

// Usage: router.post('/route', upload.single('file'), handler)
```

### 2.7 UI Components (`ui.js`)

Available helpers to use in FlyerCreator.js:
- `sectionHeading(title, subtitle)` — page heading HTML string
- `spinner(text)` — loading spinner HTML
- `errorBox(message)` — error box HTML
- `emptyState(message)` — empty state HTML
- `buildTable(columns, rows)` — table HTML (same columns as Mailer preview)
- `fmt(n)` — number with commas
- `escapeHtml(str)` — XSS-safe HTML escaping
- `debounce(fn, ms)` — debounce helper

### 2.8 Route Mounting (`server.js`)

```js
// Pattern for mounting new route modules:
app.use('/api/mailer',  require('./routes/mailer'));
// NEW route would be:
app.use('/api/flyer',   require('./routes/flyer'));
// NOTE: No new backend route is needed for this feature (see §5).
```

---

## 3. Complete File List

### Files to CREATE (new)

| File | Purpose |
|------|---------|
| `frontend/src/pages/FlyerCreator.js` | Main page component — canvas editor (step 1) + voter filter (step 2) |
| `frontend/src/utils/flyer-pdf.js` | pdfmake PDF generator for two-sided flyer |

### Files to MODIFY (existing)

| File | Change Summary |
|------|---------------|
| `frontend/src/main.js` | Add `FlyerCreator` nav item + import + route registration |
| `frontend/package.json` | Add `"fabric": "^6.4.0"` to dependencies |

### Files NOT changed

- `backend/server.js` — no new route mounting needed
- `backend/routes/mailer.js` — reused as-is (endpoints already support flyer's voter filter)
- `frontend/src/api/client.js` — only add two new export lines (see §14)
- `frontend/src/utils/color-converter.js` — NOT needed (pdfmake doesn't use html2canvas)

---

## 4. Dependency Changes

### `frontend/package.json`

**Add to `"dependencies"`:**
```json
"fabric": "^6.4.0"
```

fabric.js v6 ships full ESM, TypeScript types, and is Vite-compatible without any special config.

**Final dependencies section:**
```json
"dependencies": {
  "@googlemaps/markerclusterer": "^2.6.2",
  "@tailwindcss/vite": "^4.1.18",
  "chart.js": "^4.5.1",
  "fabric": "^6.4.0",
  "html2pdf.js": "^0.14.0",
  "pdfmake": "^0.3.6",
  "tailwindcss": "^4.1.18",
  "vite": "^7.3.1"
}
```

---

## 5. Backend: No New Files Needed

The flyer feature is **entirely client-side**:

1. **Image storage** — User's uploaded flyer background image is read by the browser `FileReader` API as base64 and stored in module state. Never uploaded to server.
2. **Voter data** — Reuses existing `GET /api/mailer/voters` and `GET /api/mailer/count` endpoints with identical filter parameters.
3. **PDF generation** — Done client-side by pdfmake (already used by `mailer-pdf.js`).

**No changes to `backend/server.js`, `backend/routes/`, or any backend file.**

---

## 6. Frontend: `main.js` Modifications

### 6.1 Add import (top of file, with other page imports)

`c:\Voter\frontend\src\main.js`

**Location:** After the `import { renderMailer }` line at the top.

```js
// ADD this import line:
import { renderFlyerCreator } from './pages/FlyerCreator.js';
```

### 6.2 Add nav item (NAV_ITEMS array)

**Location:** In the `NAV_ITEMS` array, after the `'/mailer'` entry.

```js
// ADD this entry at the end of NAV_ITEMS:
{ path: '/flyer', label: 'Flyer Creator', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
```

### 6.3 Add route registration (registerRoutes call)

**Location:** In the `registerRoutes([...])` array, after the `'/mailer'` route entry.

```js
// ADD this route:
{ path: '/flyer', title: 'Flyer Creator', render: renderFlyerCreator },
```

### 6.4 Full diff of `main.js` changes

```diff
 import { renderMailer } from './pages/Mailer.js';
+import { renderFlyerCreator } from './pages/FlyerCreator.js';

 const NAV_ITEMS = [
   { path: '/',          label: 'Dashboard',    icon: '...' },
   { path: '/voters',    label: 'Voters',       icon: '...' },
   { path: '/never-voted', label: 'Never Voted', icon: '...' },
   { path: '/upload',    label: 'Upload',       icon: '...' },
   { path: '/map',       label: 'Map',          icon: '...' },
   { path: '/analytics', label: 'Analytics',    icon: '...' },
   { path: '/archive',   label: 'Archive',      icon: '...' },
   { path: '/mailer',    label: 'Mailer',       icon: '...' },
+  { path: '/flyer',     label: 'Flyer Creator', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
 ];

 registerRoutes([
   { path: '/',            title: 'Dashboard',      render: renderDashboard },
   { path: '/voters',      title: 'Voters',         render: renderVoters },
   { path: '/never-voted', title: 'Never Voted',    render: renderNeverVoted },
   { path: '/upload',      title: 'Upload',         render: renderUpload },
   { path: '/map',         title: 'Map',            render: renderMap },
   { path: '/analytics',   title: 'Analytics',      render: renderAnalytics },
   { path: '/archive',     title: 'Archive',        render: renderArchive },
   { path: '/mailer',      title: 'Mailing Labels', render: renderMailer },
+  { path: '/flyer',       title: 'Flyer Creator',  render: renderFlyerCreator },
 ]);
```

---

## 7. Frontend: `FlyerCreator.js` — Full Structure

**Full path:** `c:\Voter\frontend\src\pages\FlyerCreator.js`

### 7.1 Imports

```js
import { Canvas, IText, FabricImage } from 'fabric';
import { fetchMailerCount, fetchMailerVoters } from '../api/client.js';
import {
  sectionHeading, spinner, errorBox, buildTable,
  emptyState, fmt, escapeHtml, debounce,
} from '../components/ui.js';
import { showToast } from '../main.js';
import { generateFlyerPDF } from '../utils/flyer-pdf.js';
```

### 7.2 Module-level state

Reset completely on each `renderFlyerCreator()` call:

```js
let state = {
  // Step management
  step: 1,                   // 1 = design front, 2 = select voters

  // Canvas / image
  canvas: null,              // fabric.Canvas instance
  frontImageBase64: null,    // original image as base64 data URL (from FileReader)
  canvasDataUrl: null,       // JPEG data URL from canvas.toDataURL() — set when advancing to step 2

  // Voter filters (identical to Mailer)
  filters: {
    precinct:    undefined,
    party:       undefined,
    super_voter: undefined,
    city:        undefined,
    zip_code:    undefined,
    limit:       500,        // default lower for flyers
  },

  // Voter data
  count:       0,
  previewData: [],
  loading:     false,
};
```

### 7.3 Main render function

```js
/**
 * Entry point — called by the router when navigating to /flyer.
 * Resets state, renders step 1, returns cleanup function.
 *
 * @param {HTMLElement} container — the #page-content element
 * @returns {Function} cleanup function (disposes fabric canvas)
 */
export async function renderFlyerCreator(container) {
  // 1. Reset state
  state = { /* ... full reset as shown in §7.2 */ };

  // 2. Render step 1 (design canvas)
  renderStep1(container);

  // 3. Return cleanup to router (disposes fabric canvas on page leave)
  return () => {
    if (state.canvas) {
      state.canvas.dispose();
      state.canvas = null;
    }
  };
}
```

### 7.4 Step 1: Canvas Design UI

```js
/**
 * Render step 1: background image upload + fabric.js canvas editor.
 *
 * Layout:
 *   [sectionHeading]
 *   [upload zone] [→ shows filename after upload]
 *   [canvas area]
 *     [canvas-el]         ← 550×713px letter-size preview
 *     [toolbar overlay]   ← positioned above canvas
 *   [text property panel] ← shown when a text object is selected
 *   [Next button bar]     ← disabled until image is loaded
 */
function renderStep1(container) {
  container.innerHTML = `
    ${sectionHeading('Flyer Creator', 'Design your flyer front, then generate address backs for each voter')}

    <!-- Progress indicator -->
    <div class="flex items-center gap-4 mb-6 text-sm">
      <span class="flex items-center gap-2 font-semibold text-primary-600 dark:text-primary-400">
        <span class="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold">1</span>
        Design Front
      </span>
      <span class="flex-1 border-t border-gray-300 dark:border-gray-600"></span>
      <span class="flex items-center gap-2 text-gray-400 dark:text-gray-500">
        <span class="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-xs">2</span>
        Choose Recipients
      </span>
    </div>

    <!-- Upload zone -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 transition p-6 mb-4 text-center cursor-pointer" id="fc-upload-zone">
      <input type="file" id="fc-image-input" accept="image/jpeg,image/png,image/webp" class="hidden" />
      <svg class="mx-auto h-10 w-10 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
      <p class="text-sm text-gray-600 dark:text-gray-400" id="fc-upload-label">
        <span class="font-semibold text-primary-600 dark:text-primary-400">Click to upload</span> or drag and drop a background image
      </p>
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">JPEG, PNG, or WebP · Recommended: 8.5" × 11" at 150 dpi (1275×1650 px)</p>
    </div>

    <!-- Canvas toolbar (add text, delete) -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3 mb-2 flex flex-wrap gap-2 items-center" id="fc-toolbar">
      <button id="fc-add-text" class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        Add Text
      </button>
      <button id="fc-delete-obj" disabled class="flex items-center gap-2 bg-danger-600 hover:bg-danger-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-sm font-medium transition">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
        Delete Selected
      </button>
      <span class="text-xs text-gray-400 dark:text-gray-500 ml-2">Click to select · Double-click to edit text · Drag to move</span>
    </div>

    <!-- Text property panel (hidden until text object selected) -->
    <div id="fc-props-panel" class="hidden bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Text Properties</h3>
      <div class="flex flex-wrap gap-3 items-center">
        <!-- Font size -->
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          Size:
          <input type="number" id="fc-prop-size" min="8" max="200" value="24"
            class="w-16 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100" />
        </label>

        <!-- Font family -->
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          Font:
          <select id="fc-prop-font"
            class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Georgia">Georgia</option>
            <option value="Verdana">Verdana</option>
            <option value="Impact">Impact</option>
            <option value="Courier New">Courier New</option>
          </select>
        </label>

        <!-- Color -->
        <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          Color:
          <input type="color" id="fc-prop-color" value="#ffffff"
            class="w-8 h-8 rounded cursor-pointer border border-gray-300 dark:border-gray-600" />
        </label>

        <!-- Bold -->
        <button id="fc-prop-bold" data-active="false"
          class="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          B
        </button>

        <!-- Italic -->
        <button id="fc-prop-italic" data-active="false"
          class="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-sm italic text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          I
        </button>

        <!-- Align -->
        <select id="fc-prop-align"
          class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
    </div>

    <!-- Canvas container (letter-size aspect ratio) -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 overflow-auto">
      <div class="relative inline-block border border-gray-300 dark:border-gray-600 shadow-sm" id="fc-canvas-wrapper" style="width:550px;height:713px;">
        <canvas id="fc-canvas" width="550" height="713"></canvas>
        <!-- Placeholder text when no image uploaded -->
        <div id="fc-canvas-placeholder" class="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-800 pointer-events-none">
          <svg class="w-16 h-16 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <p class="text-sm">Upload a background image to begin</p>
        </div>
      </div>
    </div>

    <!-- Navigation bar -->
    <div class="flex items-center justify-between">
      <p class="text-sm text-gray-500 dark:text-gray-400" id="fc-canvas-status">No image loaded</p>
      <button id="fc-next-btn" disabled
        class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-sm font-medium transition">
        Next: Choose Recipients
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </button>
    </div>
  `;

  // Initialize fabric canvas
  const canvasEl = container.querySelector('#fc-canvas');
  initFabricCanvas(canvasEl, container);

  // Wire up upload zone
  wireUploadZone(container);

  // Wire toolbar
  wireToolbar(container);

  // Wire "Next" button
  container.querySelector('#fc-next-btn').addEventListener('click', () => {
    if (!state.frontImageBase64) return;
    // Capture canvas state as JPEG before advancing
    state.canvasDataUrl = state.canvas.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: 2 });
    state.step = 2;
    renderStep2(container);
  });
}
```

### 7.5 fabric.js Canvas Initialization

```js
/**
 * Initialize the fabric.js Canvas on the given canvas element.
 * Stores the instance in state.canvas.
 * Wires up selection events to show/hide the property panel.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {HTMLElement} container — page container (for querySelector)
 */
function initFabricCanvas(canvasEl, container) {
  state.canvas = new Canvas(canvasEl, {
    width: 550,
    height: 713,          // 8.5 : 11 ratio, scaled to fit most screens
    backgroundColor: '#f9fafb',  // light gray placeholder background
    selection: true,              // enable multi-selection with click-drag
    preserveObjectStacking: true, // keep z-order consistent
  });

  // ── Selection event handlers ──────────────────────────────────────
  state.canvas.on('selection:created', (e) => {
    updatePropsPanel(e.selected[0], container);
  });
  state.canvas.on('selection:updated', (e) => {
    updatePropsPanel(e.selected[0], container);
  });
  state.canvas.on('selection:cleared', () => {
    container.querySelector('#fc-props-panel').classList.add('hidden');
    container.querySelector('#fc-delete-obj').disabled = true;
  });

  // Live-update props panel when object is modified (e.g. during resize)
  state.canvas.on('object:modified', () => {
    const obj = state.canvas.getActiveObject();
    if (obj) updatePropsPanel(obj, container);
  });
}
```

### 7.6 Image Upload Handler

```js
/**
 * Wire the upload zone and file input.
 * Reads the file as base64, sets it as the fabric canvas background.
 *
 * SECURITY: Only accepts image/jpeg, image/png, image/webp.
 * Max file size: 10 MB enforced client-side.
 */
function wireUploadZone(container) {
  const zone  = container.querySelector('#fc-upload-zone');
  const input = container.querySelector('#fc-image-input');

  // Click zone → trigger file input
  zone.addEventListener('click', () => input.click());

  // Drag-and-drop
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('border-primary-400', 'bg-primary-50', 'dark:bg-primary-900/10');
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file, container);
  });

  // File input change
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file, container);
  });
}

/**
 * Validate and load the selected image file into the fabric canvas background.
 *
 * @param {File} file
 * @param {HTMLElement} container
 */
async function handleImageFile(file, container) {
  // Validate MIME type (client-side safety check)
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimes.includes(file.type)) {
    showToast('Only JPEG, PNG, or WebP images are supported', 'error');
    return;
  }

  // Validate size (max 10 MB)
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image must be smaller than 10 MB', 'error');
    return;
  }

  showToast('Loading image…', 'info');

  try {
    // Read as base64 Data URL
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    // Store in state
    state.frontImageBase64 = dataUrl;

    // Load into fabric canvas as background image
    await loadCanvasBackground(dataUrl, container);

    // Update UI
    container.querySelector('#fc-upload-label').innerHTML =
      `<span class="font-semibold text-success-600 dark:text-success-400">✓ ${escapeHtml(file.name)}</span> — click to replace`;
    container.querySelector('#fc-canvas-placeholder').classList.add('hidden');
    container.querySelector('#fc-canvas-status').textContent =
      `Background loaded (${Math.round(file.size / 1024)} KB)`;
    container.querySelector('#fc-next-btn').disabled = false;

    showToast('Background image loaded', 'success');
  } catch (err) {
    showToast('Failed to load image: ' + err.message, 'error');
  }
}

/**
 * Set the fabric canvas background to the provided data URL.
 * Scales the image to fill the canvas width (maintaining aspect ratio).
 *
 * @param {string} dataUrl — base64 image data URL
 * @param {HTMLElement} container
 */
async function loadCanvasBackground(dataUrl, container) {
  // Fabric v6: FabricImage.fromURL returns a Promise
  const img = await FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });
  img.scaleToWidth(state.canvas.width);

  state.canvas.backgroundImage = img;
  state.canvas.requestRenderAll();
}
```

### 7.7 Toolbar (Add Text / Delete)

```js
/**
 * Wire the canvas toolbar buttons: "Add Text" and "Delete Selected".
 */
function wireToolbar(container) {
  // Add Text button
  container.querySelector('#fc-add-text').addEventListener('click', () => {
    const text = new IText('Your text here', {
      left: 50,
      top: 50,
      fontFamily: 'Arial',
      fontSize: 28,
      fill: '#ffffff',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textAlign: 'left',
      editable: true,
      selectable: true,
      // Shadow for readability on any background
      shadow: { color: 'rgba(0,0,0,0.8)', blur: 4, offsetX: 1, offsetY: 1 },
    });

    state.canvas.add(text);
    state.canvas.setActiveObject(text);
    state.canvas.requestRenderAll();
    showToast('Text added — double-click to edit', 'info');
  });

  // Delete Selected button
  container.querySelector('#fc-delete-obj').addEventListener('click', () => {
    const active = state.canvas.getActiveObject();
    if (!active) return;
    state.canvas.remove(active);
    state.canvas.discardActiveObject();
    state.canvas.requestRenderAll();
  });
}
```

### 7.8 Text Property Panel

```js
/**
 * Show the property panel and populate it with the selected object's properties.
 * If the object is not an IText, shows minimal panel but still shows delete button.
 *
 * @param {fabric.Object} obj — selected fabric object
 * @param {HTMLElement} container
 */
function updatePropsPanel(obj, container) {
  const panel     = container.querySelector('#fc-props-panel');
  const deleteBtn = container.querySelector('#fc-delete-obj');

  deleteBtn.disabled = false;

  if (!obj || !(obj instanceof IText)) {
    // Non-text objects: show delete but hide text props
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  // Populate controls with current object values
  container.querySelector('#fc-prop-size').value  = Math.round(obj.fontSize || 24);
  container.querySelector('#fc-prop-font').value  = obj.fontFamily || 'Arial';
  container.querySelector('#fc-prop-color').value = obj.fill || '#ffffff';
  container.querySelector('#fc-prop-align').value = obj.textAlign || 'left';
  syncToggleButton(container.querySelector('#fc-prop-bold'),   obj.fontWeight === 'bold');
  syncToggleButton(container.querySelector('#fc-prop-italic'), obj.fontStyle === 'italic');

  // Wire change events (replace old listeners by cloning nodes)
  replaceEventListeners(container, '#fc-prop-size', 'input', (e) => {
    const obj = state.canvas.getActiveObject();
    if (obj instanceof IText) { obj.set({ fontSize: parseInt(e.target.value, 10) || 24 }); state.canvas.requestRenderAll(); }
  });
  replaceEventListeners(container, '#fc-prop-font', 'change', (e) => {
    const obj = state.canvas.getActiveObject();
    if (obj instanceof IText) { obj.set({ fontFamily: e.target.value }); state.canvas.requestRenderAll(); }
  });
  replaceEventListeners(container, '#fc-prop-color', 'input', (e) => {
    const obj = state.canvas.getActiveObject();
    if (obj instanceof IText) { obj.set({ fill: e.target.value }); state.canvas.requestRenderAll(); }
  });
  replaceEventListeners(container, '#fc-prop-align', 'change', (e) => {
    const obj = state.canvas.getActiveObject();
    if (obj instanceof IText) { obj.set({ textAlign: e.target.value }); state.canvas.requestRenderAll(); }
  });
  replaceEventListeners(container, '#fc-prop-bold', 'click', () => {
    const btn = container.querySelector('#fc-prop-bold');
    const obj = state.canvas.getActiveObject();
    if (!(obj instanceof IText)) return;
    const isBold = obj.fontWeight === 'bold';
    obj.set({ fontWeight: isBold ? 'normal' : 'bold' });
    syncToggleButton(btn, !isBold);
    state.canvas.requestRenderAll();
  });
  replaceEventListeners(container, '#fc-prop-italic', 'click', () => {
    const btn = container.querySelector('#fc-prop-italic');
    const obj = state.canvas.getActiveObject();
    if (!(obj instanceof IText)) return;
    const isItalic = obj.fontStyle === 'italic';
    obj.set({ fontStyle: isItalic ? 'normal' : 'italic' });
    syncToggleButton(btn, !isItalic);
    state.canvas.requestRenderAll();
  });
}

/**
 * Helper: sync a toggle button's visual state (active = highlighted).
 */
function syncToggleButton(btn, isActive) {
  btn.dataset.active = isActive ? 'true' : 'false';
  btn.classList.toggle('bg-primary-100', isActive);
  btn.classList.toggle('dark:bg-primary-900/40', isActive);
  btn.classList.toggle('text-primary-700', isActive);
  btn.classList.toggle('dark:text-primary-300', isActive);
}

/**
 * Helper: Replace a DOM element's event listener safely (prevent duplicate events).
 * Uses element cloning to remove all old listeners before adding the new one.
 */
function replaceEventListeners(container, selector, event, handler) {
  const el = container.querySelector(selector);
  if (!el) return;
  const clone = el.cloneNode(true);
  el.parentNode.replaceChild(clone, el);
  clone.addEventListener(event, handler);
}
```

### 7.9 Step 2: Voter Selection UI

```js
/**
 * Render step 2: voter filter panel + live count + preview + Generate PDF button.
 * This step is nearly identical to Mailer.js — same filter fields, same API calls.
 *
 * @param {HTMLElement} container
 */
function renderStep2(container) {
  container.innerHTML = `
    ${sectionHeading('Choose Recipients', 'Filter voters who will receive a personalized flyer back')}

    <!-- Progress indicator -->
    <div class="flex items-center gap-4 mb-6 text-sm">
      <button id="fc-back-btn" class="flex items-center gap-2 text-primary-600 dark:text-primary-400 hover:underline font-medium">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back to Design
      </button>
      <span class="flex-1 border-t border-gray-300 dark:border-gray-600"></span>
      <span class="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-semibold">
        <span class="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold">2</span>
        Choose Recipients
      </span>
    </div>

    <!-- Canvas thumbnail (front preview) -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6 flex items-center gap-4">
      <img id="fc-front-thumb" src="${escapeHtml(state.canvasDataUrl)}" alt="Flyer front preview"
        class="w-24 h-auto rounded border border-gray-200 dark:border-gray-600 shadow-sm" style="max-height:120px;object-fit:contain;" />
      <div>
        <p class="text-sm font-semibold text-gray-900 dark:text-white">Flyer Front Designed ✓</p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">The PDF will alternate: [front page] → [voter address page] → [front page] → … for duplex printing.</p>
        <button id="fc-redesign-btn" class="text-xs text-primary-600 dark:text-primary-400 hover:underline mt-1">Redesign front</button>
      </div>
    </div>

    <!-- Filter panel (identical to Mailer filters) -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <input id="fc-precinct" type="text" placeholder="Precinct #" maxlength="3"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
        <select id="fc-party"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
          <option value="">All Parties</option>
          <option value="R">Republican</option>
          <option value="D">Democrat</option>
        </select>
        <select id="fc-super"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-900 dark:text-gray-100">
          <option value="">All Voters</option>
          <option value="true">Super Voters Only</option>
          <option value="false">Non-Super Voters</option>
        </select>
        <input id="fc-city" type="text" placeholder="City" maxlength="100"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
        <input id="fc-zip" type="text" placeholder="ZIP Code" maxlength="10"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
        <input id="fc-limit" type="number" placeholder="Max voters (default 500)" min="1" max="2000" value="500"
          class="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500" />
      </div>
    </div>

    <!-- Count bar -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 mb-6">
      <div id="fc-count">${spinner('Calculating...')}</div>
    </div>

    <!-- Generate button -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Export</h3>
      <button id="fc-generate-btn" disabled
        title="No voters match current filters"
        class="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition">
        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        Generate Two-Sided PDF
      </button>
    </div>

    <!-- Preview table -->
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview (first 10 results)</h3>
      <div id="fc-preview">${spinner('Loading preview...')}</div>
    </div>
  `;

  // ── Back button ──────────────────────────────────────────────────
  container.querySelector('#fc-back-btn').addEventListener('click', () => {
    state.step = 1;
    renderStep1(container);
    // Restore canvas state (re-init fabric and restore design)
    const canvasEl = container.querySelector('#fc-canvas');
    initFabricCanvas(canvasEl, container);
    wireUploadZone(container);
    wireToolbar(container);
    if (state.frontImageBase64) {
      loadCanvasBackground(state.frontImageBase64, container);
      container.querySelector('#fc-canvas-placeholder').classList.add('hidden');
      container.querySelector('#fc-next-btn').disabled = false;
    }
  });

  // ── Redesign button ─────────────────────────────────────────────
  container.querySelector('#fc-redesign-btn').addEventListener('click', () => {
    state.step = 1;
    renderStep1(container);
    const canvasEl = container.querySelector('#fc-canvas');
    initFabricCanvas(canvasEl, container);
    wireUploadZone(container);
    wireToolbar(container);
    if (state.frontImageBase64) {
      loadCanvasBackground(state.frontImageBase64, container);
      container.querySelector('#fc-canvas-placeholder').classList.add('hidden');
      container.querySelector('#fc-next-btn').disabled = false;
    }
  });

  // ── Filter refs ──────────────────────────────────────────────────
  const precinctInput = container.querySelector('#fc-precinct');
  const partySelect   = container.querySelector('#fc-party');
  const superSelect   = container.querySelector('#fc-super');
  const cityInput     = container.querySelector('#fc-city');
  const zipInput      = container.querySelector('#fc-zip');
  const limitInput    = container.querySelector('#fc-limit');

  // ── Debounced reload ─────────────────────────────────────────────
  const reload = debounce(() => {
    state.filters.precinct    = precinctInput.value.trim() || undefined;
    state.filters.party       = partySelect.value || undefined;
    state.filters.super_voter = superSelect.value || undefined;
    state.filters.city        = cityInput.value.trim() || undefined;
    state.filters.zip_code    = zipInput.value.trim() || undefined;
    const limitVal = parseInt(limitInput.value, 10);
    state.filters.limit = (limitVal >= 1 && limitVal <= 2000) ? limitVal : 500;
    loadCount(container);
    loadPreview(container);
  }, 350);

  precinctInput.addEventListener('input', reload);
  partySelect.addEventListener('change', reload);
  superSelect.addEventListener('change', reload);
  cityInput.addEventListener('input', reload);
  zipInput.addEventListener('input', reload);
  limitInput.addEventListener('input', reload);

  // ── Generate PDF ─────────────────────────────────────────────────
  container.querySelector('#fc-generate-btn').addEventListener('click', async () => {
    const btn = container.querySelector('#fc-generate-btn');
    btn.disabled = true;
    showToast('Fetching voter data…', 'info');

    try {
      const res = await fetchMailerVoters(state.filters);
      const voters = res.data || [];

      if (voters.length === 0) {
        showToast('No voters match current filters', 'warning');
        return;
      }

      showToast(`Generating ${voters.length * 2}-page duplex PDF…`, 'info');
      const dateStr = new Date().toISOString().split('T')[0];
      await generateFlyerPDF(state.canvasDataUrl, voters, `flyer-${dateStr}.pdf`);
      showToast('Flyer PDF downloaded successfully', 'success');
    } catch (err) {
      showToast('PDF generation failed: ' + err.message, 'error');
    } finally {
      btn.disabled = state.count === 0;
    }
  });

  // ── Initial load ─────────────────────────────────────────────────
  loadCount(container);
  loadPreview(container);
}
```

### 7.10 Count & Preview Loaders (Step 2)

```js
/**
 * Load voter count from /api/mailer/count and update UI.
 * Identical pattern to Mailer.js loadCount().
 */
async function loadCount(container) {
  const countEl    = container.querySelector('#fc-count');
  const generateBtn = container.querySelector('#fc-generate-btn');

  countEl.innerHTML = spinner('Calculating…');
  if (generateBtn) generateBtn.disabled = true;

  try {
    const res = await fetchMailerCount(state.filters);
    state.count = res.count || 0;

    countEl.innerHTML = state.count > 0
      ? `<span class="font-semibold text-gray-900 dark:text-gray-100">${fmt(state.count)}</span>
         <span> voters match — PDF will have </span>
         <span class="font-semibold text-primary-600 dark:text-primary-400">${fmt(state.count * 2)} pages</span>
         <span class="text-gray-400 dark:text-gray-500"> (${state.count} front + ${state.count} back)</span>`
      : `<span class="text-gray-500 dark:text-gray-400">No voters match your filters</span>`;

    if (generateBtn) {
      generateBtn.disabled = state.count === 0;
      generateBtn.title = state.count > 0
        ? `Generate ${state.count * 2}-page duplex PDF for ${fmt(state.count)} voters`
        : 'No voters match current filters';
    }
  } catch (err) {
    countEl.innerHTML = `<span class="text-danger-600 dark:text-danger-400">Error: ${escapeHtml(err.message)}</span>`;
  }
}

/**
 * Load voter preview (first 10) from /api/mailer/voters and render table.
 * Identical column pattern to Mailer.js loadPreview().
 */
async function loadPreview(container) {
  const previewEl = container.querySelector('#fc-preview');
  if (!previewEl) return;
  previewEl.innerHTML = spinner('Loading preview…');

  try {
    const res = await fetchMailerVoters({ ...state.filters, limit: 10 });
    const rows = res.data || [];

    if (rows.length === 0) {
      previewEl.innerHTML = emptyState('No voters match your filters');
      return;
    }

    const columns = [
      { label: 'Name',    render: r => `${escapeHtml(r.lastName || '—')}, ${escapeHtml(r.firstName || '')}` },
      { label: 'Address', render: r => escapeHtml(r.address || '—') },
      { label: 'City',    render: r => escapeHtml(r.city    || '—') },
      { label: 'State',   render: r => escapeHtml(r.state   || '—') },
      { label: 'ZIP',     render: r => escapeHtml(r.zipCode || '—') },
    ];

    previewEl.innerHTML = buildTable(columns, rows);
  } catch (err) {
    previewEl.innerHTML = errorBox(err.message);
  }
}
```

### 7.11 `client.js` Additions

Add these two lines to `frontend/src/api/client.js` (after the existing mailer exports at the end):

```js
// Already exist — REUSED by flyer (no changes needed):
// export const fetchMailerCount  = (filters = {}) => get('/mailer/count', filters);
// export const fetchMailerVoters = (filters = {}) => get('/mailer/voters', filters);

// NOTE: No new API endpoints needed for flyer — it reuses mailer endpoints entirely.
```

`client.js` requires **zero changes**. FlyerCreator.js imports `fetchMailerCount` and `fetchMailerVoters` directly.

---

## 8. Frontend: `flyer-pdf.js` — Full Structure

**Full path:** `c:\Voter\frontend\src\utils\flyer-pdf.js`

### 8.1 Imports (same pattern as mailer-pdf.js)

```js
import * as pdfMakeModule from 'pdfmake/build/pdfmake';
import * as pdfFontsModule from 'pdfmake/build/vfs_fonts';

// Handle both ESM default exports and CommonJS module shapes
const pdfMake = pdfMakeModule.default || pdfMakeModule;
const vfs = pdfFontsModule.pdfMake?.vfs || pdfFontsModule.default || pdfFontsModule;
pdfMake.vfs = vfs;
```

### 8.2 Layout constants

```js
// US Letter in pdfmake points (1 point = 1/72 inch)
const PAGE_WIDTH  = 612;   // 8.5"
const PAGE_HEIGHT = 792;   // 11"

// Address block layout on voter back pages
const ADDR_TOP_MARGIN   = 288; // ~4" from top (centers address vertically on a letter page)
const ADDR_SIDE_MARGIN  = 90;  // 1.25" side margins for address block
```

### 8.3 Internal helpers

```js
/**
 * Build a pdfmake content item for ONE front-of-flyer page.
 * The canvas data URL (JPEG) fills the entire page with zero margins.
 * pageBreak: 'after' tells pdfmake to start the next item on a new page.
 *
 * @param {string} canvasDataUrl — JPEG base64 data URL from fabric canvas.toDataURL()
 * @param {boolean} [addPageBreak=true] — whether to force a page break after this item
 * @returns {Object} pdfmake content item
 */
function buildFrontPage(canvasDataUrl, addPageBreak = true) {
  return {
    image: canvasDataUrl,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    ...(addPageBreak ? { pageBreak: 'after' } : {}),
  };
}

/**
 * Build a pdfmake content item for ONE voter address back page.
 * Centers the voter's name and address vertically and horizontally.
 *
 * Layout (on a letter page with zero document margins):
 *   - A single-cell table spanning the full page width
 *   - Cell height = PAGE_HEIGHT, verticalAlignment = 'center'
 *   - Cell content = name, address, city/state/zip
 *
 * @param {{ firstName, lastName, address, city, state, zipCode }} voter
 * @param {boolean} [addPageBreak=true]
 * @returns {Object} pdfmake content item
 */
function buildVoterBackPage(voter, addPageBreak = true) {
  const name = `${voter.firstName || ''} ${voter.lastName || ''}`.trim();
  const address = voter.address || '';
  const cityStateZip = `${voter.city || ''}, ${voter.state || ''} ${voter.zipCode || ''}`.replace(/^, /, '');

  return {
    // A single-cell table lets pdfmake vertically center the address
    table: {
      widths: ['*'],
      heights: [PAGE_HEIGHT],
      body: [[
        {
          stack: [
            { text: name,         fontSize: 18, bold: true, color: '#111827', margin: [0, 0, 0, 8] },
            { text: address,      fontSize: 14, color: '#374151', margin: [0, 0, 0, 4] },
            { text: cityStateZip, fontSize: 14, color: '#374151' },
          ],
          border:             [false, false, false, false],
          alignment:          'center',
          verticalAlignment:  'center',
        },
      ]],
    },
    layout: 'noBorders',
    margin: [ADDR_SIDE_MARGIN, 0, ADDR_SIDE_MARGIN, 0],
    ...(addPageBreak ? { pageBreak: 'after' } : {}),
  };
}

/**
 * Build the full alternating content array:
 * [front₁, back₁, front₂, back₂, … frontN, backN]
 *
 * For duplex printing each leaf has the flyer front on one side
 * and a unique voter address on the reverse.
 *
 * @param {string} canvasDataUrl
 * @param {Array}  voters
 * @returns {Array} pdfmake content array
 */
function buildAlternatingContent(canvasDataUrl, voters) {
  const content = [];

  voters.forEach((voter, i) => {
    const isLast = i === voters.length - 1;
    // Front page for this voter
    content.push(buildFrontPage(canvasDataUrl, true /* always break after front */));
    // Voter back page
    content.push(buildVoterBackPage(voter, !isLast));
  });

  return content;
}
```

### 8.4 Public API

```js
/**
 * Generate and download a two-sided flyer PDF.
 *
 * Page layout (for N voters):
 *   Page 1:  Flyer front (full-bleed canvas image)
 *   Page 2:  Voter 1 address (centered on page)
 *   Page 3:  Flyer front (repeated)
 *   Page 4:  Voter 2 address
 *   …        (alternates for all voters)
 *
 * @param {string} canvasDataUrl — JPEG base64 data URL (from fabric canvas.toDataURL())
 * @param {Array<{firstName, lastName, address, city, state, zipCode}>} voters
 * @param {string} [filename] — optional filename override
 */
export async function generateFlyerPDF(canvasDataUrl, voters, filename) {
  if (!canvasDataUrl) throw new Error('No flyer front image provided');
  if (!voters || voters.length === 0) throw new Error('No voters provided');

  const dateStr    = new Date().toISOString().split('T')[0];
  const outputName = filename || `flyer-${dateStr}.pdf`;

  const docDefinition = {
    pageSize:        'LETTER',
    pageOrientation: 'portrait',
    pageMargins:     [0, 0, 0, 0],    // zero margins — front image is full-bleed

    content: buildAlternatingContent(canvasDataUrl, voters),

    defaultStyle: {
      font: 'Roboto',
    },
  };

  pdfMake.createPdf(docDefinition).download(outputName);
}
```

---

## 9. pdfmake Document Definition (Two-Sided)

### 9.1 Complete document definition (annotated)

```js
const docDefinition = {
  // Page size: US Letter (612pt × 792pt)
  pageSize: 'LETTER',

  // Portrait orientation (flyer is taller than wide)
  pageOrientation: 'portrait',

  // ZERO margins — the front image is full-bleed (covers entire page)
  // The voter address pages manage their own visual margins via cell padding
  pageMargins: [0, 0, 0, 0],

  content: [
    // For each voter, pdfmake renders alternating front/back pages:

    // ── FRONT PAGE (voter 1) ─────────────────────────────────
    {
      // `image` must be a base64 data URL string: "data:image/jpeg;base64,..."
      // This is the output of: canvas.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: 2 })
      image: canvasDataUrl,

      // width=612 + height=792 exactly fills the 612×792pt content area (since margins=[0,0,0,0])
      width:  612,
      height: 792,

      // Force a page break AFTER this image → voter back page starts on page 2
      pageBreak: 'after',
    },

    // ── BACK PAGE (voter 1 address) ──────────────────────────
    {
      // Single-cell table: vertically centers the address on the full page
      table: {
        widths:  ['*'],          // single column spanning full width
        heights: [792],          // single row spanning full page height
        body: [[
          {
            stack: [
              // Voter name — larger, bold
              { text: 'Jane Doe', fontSize: 18, bold: true, color: '#111827', margin: [0, 0, 0, 8] },
              // Street address
              { text: '123 Main St', fontSize: 14, color: '#374151', margin: [0, 0, 0, 4] },
              // City, State ZIP
              { text: 'Union City, TN 38261', fontSize: 14, color: '#374151' },
            ],
            border:            [false, false, false, false], // no cell borders
            alignment:         'center',                     // horizontal centering
            verticalAlignment: 'center',                     // vertical centering
          },
        ]],
      },
      layout:    'noBorders',      // suppress default table borders
      margin:    [90, 0, 90, 0],   // 1.25" side margins for address block (90pt = 1.25")

      // Add pageBreak: 'after' on all voter pages EXCEPT the last one
      pageBreak: 'after',  // omit on last voter
    },

    // … pattern repeats for voter 2, 3, … N
  ],

  // Default font (already configured by pdfMake.vfs = vfs)
  defaultStyle: {
    font: 'Roboto',
  },
};
```

### 9.2 Key pdfmake constraints

| Constraint | Explanation |
|-----------|-------------|
| `pageMargins: [0,0,0,0]` | Required for full-bleed front image. Voter pages use margin on the content item itself. |
| `pageBreak: 'after'` on front image | Forces next content to start on a new page. pdfmake also naturally breaks when an image fills the entire content area, but explicit is safer. |
| `heights: [792]` on voter table | Makes the single-cell table span the full page height, enabling `verticalAlignment: 'center'`. |
| `image` must be a data URL | Must start with `data:image/jpeg;base64,...` or `data:image/png;base64,...`. NOT a URL. |
| `multiplier: 2` on canvas export | Doubles the pixel resolution of the exported image (1100×1426px) for a sharper PDF. |

---

## 10. fabric.js Initialization Pattern

### 10.1 Installation

```bash
cd frontend
npm install fabric@^6.4.0
```

### 10.2 Import

```js
// fabric v6 supports named ESM exports — no `import { fabric } from 'fabric'` needed
import { Canvas, IText, FabricImage } from 'fabric';
```

### 10.3 Canvas initialization

```js
const canvas = new Canvas('fc-canvas', {
  width:                 550,     // display width in px
  height:                713,     // display height in px (~8.5:11 ratio: 550 / (8.5/11) = 711.8)
  backgroundColor:       '#f9fafb',
  selection:             true,    // allow rubber-band multi-select
  preserveObjectStacking: true,
});
```

### 10.4 Setting background image

```js
// FabricImage.fromURL returns a Promise in fabric v6
const img = await FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });

// Scale proportionally to canvas width
const scale = canvas.width / img.width;
img.set({ scaleX: scale, scaleY: scale });

// Assign as non-selectable background
canvas.backgroundImage = img;
canvas.requestRenderAll();
```

### 10.5 Adding editable text

```js
const textObj = new IText('Your text here', {
  left:       100,
  top:        80,
  fontFamily: 'Arial',
  fontSize:   28,
  fill:       '#ffffff',          // white text is readable on most flyer backgrounds
  fontWeight: 'normal',
  fontStyle:  'normal',
  textAlign:  'left',
  editable:   true,               // double-click to enter edit mode
  selectable: true,
  shadow: { color: 'rgba(0,0,0,0.75)', blur: 6, offsetX: 1, offsetY: 1 }, // legibility shadow
});

canvas.add(textObj);
canvas.setActiveObject(textObj);
canvas.requestRenderAll();
```

### 10.6 Exporting the canvas for pdfmake

```js
// multiplier: 2 doubles resolution → 1100×1426 px JPEG (sharp enough for letter-size print at ~130 DPI)
// format: 'jpeg' is smaller than PNG and more than adequate for photographic backgrounds
const dataUrl = canvas.toDataURL({
  format:     'jpeg',
  quality:    0.95,
  multiplier: 2,
});
// dataUrl is now: "data:image/jpeg;base64,/9j/4AAQ..." — ready for pdfmake
```

### 10.7 Cleanup (SPA navigation)

```js
// Return from renderFlyerCreator():
return () => {
  if (state.canvas) {
    state.canvas.dispose();  // removes event listeners, DOM references, WebGL context
    state.canvas = null;
  }
};
// The router calls this cleanup function when the user navigates to another tab
```

---

## 11. Voter Filter Fields

The filter panel in Step 2 is **identical** to `Mailer.js`. All fields map directly to query parameters accepted by `GET /api/mailer/count` and `GET /api/mailer/voters`:

| UI Control | HTML ID | State Key | API Param | Validation |
|-----------|---------|-----------|-----------|-----------|
| Text input | `#fc-precinct` | `filters.precinct` | `precinct` | max 3 chars, string |
| Select | `#fc-party` | `filters.party` | `party` | `'R' \| 'D' \| ''` |
| Select | `#fc-super` | `filters.super_voter` | `super_voter` | `'true' \| 'false' \| ''` |
| Text input | `#fc-city` | `filters.city` | `city` | max 100 chars |
| Text input | `#fc-zip` | `filters.zip_code` | `zip_code` | max 10 chars |
| Number input | `#fc-limit` | `filters.limit` | `limit` | 1–2000, default 500 |

The backend (`mailer.js`) already validates all these fields using `express-validator` and builds a parameterized SQL WHERE clause — no backend changes needed.

---

## 12. Image Storage Approach

### Decision: Client-side base64 (no server upload)

**Rationale:**

| Criteria | Client-side base64 | Server upload |
|---------|-------------------|--------------|
| Complexity | Simple — FileReader API | Requires multer endpoint, storage, cleanup |
| Privacy | Image never leaves browser | Image stored on server disk |
| PDF generation | pdfmake embeds base64 directly | Would need to fetch URL back |
| Performance | Slightly larger in memory (~33% overhead) | None |
| Cleanup | Auto-cleaned on page leave | Requires server-side cleanup job |

**For a flyer tool where images are 1–5 MB, this is optimal.**

### Implementation

```js
// Step 1: FileReader reads file → base64 data URL
const reader = new FileReader();
reader.onload = (e) => {
  state.frontImageBase64 = e.target.result; // "data:image/jpeg;base64,..."
};
reader.readAsDataURL(file);

// Step 2: After design, snapshot the composed canvas
state.canvasDataUrl = state.canvas.toDataURL({ format: 'jpeg', quality: 0.95, multiplier: 2 });
// canvasDataUrl captures BOTH the background image AND all text objects as one flat JPEG

// Step 3: pdfmake embeds the composed JPEG directly
docDefinition.content[0].image = state.canvasDataUrl;
```

**Important:** The PDF embeds `state.canvasDataUrl` (the composed canvas JPEG), **not** `state.frontImageBase64`. The canvas JPEG includes all text boxes already rendered into the image, eliminating the need for complex pdfmake absolutePosition tricks.

---

## 13. OKLCH Color Workaround

### pdfmake: NO workaround needed

pdfmake generates PDFs using its own internal PDF renderer — it does **not** use html2canvas or any DOM-to-image conversion. Therefore, the OKLCH-to-RGB conversion in `color-converter.js` is **not needed** for `flyer-pdf.js`.

| PDF library | Uses html2canvas | OKLCH workaround needed |
|------------|-----------------|------------------------|
| html2pdf.js (used by Analytics) | YES | YES — `processHtml2CanvasClone()` |
| pdfmake (used by Mailer + Flyer) | NO | NO |

**fabric.js canvas export:** `canvas.toDataURL()` uses the browser's native `<canvas>` element `toDataURL()` method, which rasterizes everything to JPEG/PNG. The output is a flat pixel bitmap — colors are already converted to RGB at this point. No OKLCH issues.

**Conclusion:** `flyer-pdf.js` does NOT import or use `color-converter.js`.

---

## 14. API Endpoints Used

### Existing endpoints (unchanged, reused)

| Method | Path | Used For |
|--------|------|---------|
| `GET` | `/api/mailer/count` | Live voter count in step 2 filter bar |
| `GET` | `/api/mailer/voters` | Fetch voters for PDF + preview table |

### Parameters for `/api/mailer/voters` and `/api/mailer/count`

```
GET /api/mailer/count?precinct=01&party=R&super_voter=true&city=Union+City&zip_code=38261&limit=500
GET /api/mailer/voters?precinct=01&party=R&super_voter=true&city=Union+City&zip_code=38261&limit=500
```

### Voter response shape (`/api/mailer/voters`)

```json
{
  "success": true,
  "count": 125,
  "data": [
    {
      "firstName": "Jane",
      "lastName":  "Doe",
      "address":   "123 Main St",
      "city":      "Union City",
      "state":     "TN",
      "zipCode":   "38261"
    }
  ]
}
```

### No new API endpoints needed

The entire flyer feature works with existing infrastructure. The image never leaves the client.

---

## 15. Wire-Frame / UI Flow

```
[Tab Bar]  Dashboard | Voters | … | Mailer | Flyer Creator ←NEW
                                                       ↓ click
┌──────────────────────────────── Step 1: Design Front ──────────────────────────────────────┐
│  [Section heading: "Flyer Creator"]                                                         │
│  [Progress: ●1 Design Front ——————— ○2 Choose Recipients]                                  │
│  ┌─────────────────────────────────────────────────────────────────┐                        │
│  │  📷 Click to upload or drag-and-drop a background image          │  ← Upload zone         │
│  │     JPEG, PNG, or WebP · Recommended: 1275×1650 px              │                        │
│  └─────────────────────────────────────────────────────────────────┘                        │
│  [Toolbar] [+ Add Text] [🗑 Delete Selected]   Click to select · Double-click to edit       │
│  [Property panel — hidden until text selected]                                              │
│    Size: [24] Font: [Arial▼] Color: [■] [B] [I] Align: [Left▼]                            │
│  ┌───────────────────────────── Canvas (550×713) ──────────────────────────────────────┐   │
│  │                         [fabric.js canvas]                                           │   │
│  │   Background image fills canvas                                                      │   │
│  │   Text boxes are draggable/resizable                                                 │   │
│  └─────────────────────────────────────────────────────────────────────────────────────┘   │
│  [Status: "Background loaded (2.1 MB)"]             [Next: Choose Recipients →] ←enabled   │
└────────────────────────────────────────────────────────────────────────────────────────────┘

                                          ↓ click "Next"

┌──────────────────────────────── Step 2: Choose Recipients ─────────────────────────────────┐
│  [← Back to Design]                                      [●2 Choose Recipients]             │
│  ┌──────────────────────────────────────────────────┐                                       │
│  │  [thumbnail of flyer front]  Flyer Front ✓        │                                      │
│  │  PDF alternates: front → address → front → …      │  [Redesign front]                   │
│  └──────────────────────────────────────────────────┘                                       │
│  FILTERS:  Precinct [    ] Party [All▼] Super Voter [All▼] City [    ] ZIP [    ] Max [500]│
│  ┌──────────────────────────────────────────────────┐                                       │
│  │  125 voters match — PDF will have 250 pages        │  ← count bar                       │
│  │  (125 front + 125 back)                           │                                       │
│  └──────────────────────────────────────────────────┘                                       │
│  [📄 Generate Two-Sided PDF] ← enabled when count > 0                                      │
│  PREVIEW TABLE: Name | Address | City | State | ZIP                                         │
└────────────────────────────────────────────────────────────────────────────────────────────┘

                                          ↓ click "Generate"

── Calls fetchMailerVoters(filters) → gets voter array
── Calls generateFlyerPDF(canvasDataUrl, voters) → pdfmake → downloads flyer-YYYY-MM-DD.pdf
── PDF structure: [front₁][back₁][front₂][back₂]…[frontN][backN]   (2N pages total)
```

---

## 16. Security Considerations

| Risk | Mitigation |
|------|-----------|
| **Malicious image file** (disguised as JPEG/PNG) | Client validates MIME type (`allowedMimes.includes(file.type)`) AND file size (≤10 MB). Note: MIME sniffing can be bypassed — if a future version uploads to server, multer's `fileFilter` should inspect magic bytes, not just the extension. |
| **XSS via voter data in PDF** | All voter name fields are embedded as pdfmake `text` values (not raw HTML). pdfmake renders text as PDF text primitives — no HTML injection vector. |
| **XSS in canvas UI** | All dynamic values displayed via `escapeHtml()` from `ui.js`. The canvas itself is a bitmap — not a DOM injection surface. |
| **Large image denial-of-service** | Client enforces 10 MB limit before FileReader. For backend-uploaded images (if added later), multer `limits: { fileSize: 10 * 1024 * 1024 }` enforces the same. |
| **Path traversal in filenames** | Not applicable — image is never saved to disk (client-side only). PDF filename is programmatically constructed from `Date.toISOString()`. |
| **canvas.toDataURL() cross-origin** | Sets `{ crossOrigin: 'anonymous' }` when loading image into FabricImage. Without this, calling `toDataURL()` on a tainted canvas throws a SecurityError. All images come from the local FileReader (data URLs), which are always same-origin — this is precautionary for future extensibility. |
| **Excessive voter count** | API enforces `max: 2000` per request; UI limits to 2000; generating 2000×2 = 4000-page PDF is allowed but user is warned. Consider adding a warning at > 200 voters in the count bar. |

---

## Summary

| Item | Value |
|------|-------|
| **New files** | `frontend/src/pages/FlyerCreator.js`, `frontend/src/utils/flyer-pdf.js` |
| **Modified files** | `frontend/src/main.js` (3 lines), `frontend/package.json` (1 line) |
| **Backend changes** | None |
| **New npm packages** | `fabric@^6.4.0` |
| **Route path** | `/flyer` (hash: `#/flyer`) |
| **Nav label** | `Flyer Creator` |
| **PDF library** | pdfmake (already installed) |
| **Canvas library** | fabric.js v6 |
| **Image storage** | Client-side base64 (FileReader → state) |
| **Voter data source** | `GET /api/mailer/voters` (unchanged) |
| **PDF structure** | Alternating: front, voter_back, front, voter_back … (2N pages) |
| **OKLCH workaround** | Not needed (pdfmake doesn't use html2canvas) |
