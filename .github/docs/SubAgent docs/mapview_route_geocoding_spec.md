# MapView.js Enhancement Specification
## Route Planning, Geocoding UI & Saved Routes Integration

**Created:** 2026-02-17  
**Status:** Specification Complete  
**Target File:** `frontend/src/pages/MapView.js`

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Backend API Inventory](#2-backend-api-inventory)
3. [Frontend API Client Inventory](#3-frontend-api-client-inventory)
4. [Gap Analysis](#4-gap-analysis)
5. [Implementation Plan](#5-implementation-plan)
6. [UI Design Specifications](#6-ui-design-specifications)
7. [Code Patterns & Style Guide](#7-code-patterns--style-guide)
8. [Dependencies](#8-dependencies)
9. [Data Flow Diagrams](#9-data-flow-diagrams)

---

## 1. Current State Analysis

### 1.1 Current MapView.js (202 lines)

**Location:** `frontend/src/pages/MapView.js`

**What exists:**
- Google Maps initialization with API key from `/api/config`
- Voter marker plotting (circle markers, colored by super_voter status)
- Precinct dropdown filter (populated from `fetchPrecincts()`)
- Super voter / regular voter filter dropdown
- "Load Voters" button to refresh markers
- InfoWindow popups showing voter name, address, super_voter status, precinct
- Dark mode map styling support
- Marker cleanup on page leave
- Limits to 1000 geocoded voters per load
- Map auto-fits bounds to displayed markers
- Loads `geometry` library from Google Maps

**Imports used:**
```javascript
import { fetchConfig, fetchVoters, fetchPrecincts } from '../api/client.js';
import { sectionHeading, spinner, errorBox, fmt, escapeHtml } from '../components/ui.js';
import { showToast } from '../main.js';
```

**State variables:**
```javascript
let map = null;
let markers = [];
let infoWindow = null;
```

### 1.2 Backend Services (Fully Built)

| Service | Status | Description |
|---------|--------|-------------|
| `route-optimizer-service.js` | ✅ Complete | TSP solver with Nearest Neighbor + 2-Opt + Hybrid algorithms |
| `distance-matrix-service.js` | ✅ Complete | Google Distance Matrix API with caching, progressive/sparse mode |
| `route-cache-service.js` | ✅ Complete | Symmetric distance caching with MD5 hashing, TTL management |
| `geocoding-service.js` | ✅ Complete | Google Geocoding API with rate limiting, retry, quality scoring |
| `geocoding-job-service.js` | ✅ Complete | Batch geocoding orchestration with job tracking |
| `address-cache-service.js` | ✅ Complete | Address normalization and geocode result caching |
| `quota-manager.js` | ✅ Complete | API usage tracking across all Google Maps APIs |

### 1.3 Backend Routes (Fully Built)

| Route File | Status | Endpoint Count |
|------------|--------|----------------|
| `routes/routes.js` | ✅ Complete | 10 endpoints |
| `routes/geocode.js` | ✅ Complete | 10 endpoints |
| `routes/voters.js` | ✅ Complete | 4 endpoints |

### 1.4 Models (Fully Built)

| Model | Status | Key Methods |
|-------|--------|-------------|
| `voter.js` | ✅ Complete | `getVotersByIds()`, `findAll()`, `search()` |
| `saved-route.js` | ✅ Complete | `saveRoute()`, `getRoute()`, `deleteRoute()`, `getRoutesByUser()` |

---

## 2. Backend API Inventory

### 2.1 Route Planning Endpoints (`/api/routes/`)

#### `POST /api/routes/calculate`
**Purpose:** Calculate optimized canvassing route for a list of voters  
**Request:**
```json
{
  "voterIds": [123, 456, 789],
  "startLocation": { "lat": 36.5040, "lng": -89.1872 },
  "mode": "walking",        // "driving" | "walking" | "bicycling"
  "algorithm": "hybrid"     // "nearest_neighbor" | "2opt" | "hybrid"
}
```
**Response:**
```json
{
  "success": true,
  "route": {
    "locations": [
      { "voterId": 123, "lat": 36.504, "lng": -89.187, "address": "...", "firstName": "...", "lastName": "..." }
    ],
    "totalDistance": 15234,
    "totalDuration": 1823,
    "metrics": {
      "totalDistance": 15234,
      "totalDuration": 1823,
      "stopCount": 10,
      "averageDistancePerStop": 1523,
      "totalDistanceMiles": 9.46,
      "totalDurationMinutes": 30,
      "averageDistancePerStopFeet": 4997,
      "routeEfficiency": 0.72,
      "recommendedMode": "driving",
      "optimizationTimeMs": 8234,
      "distanceMatrixStats": { "apiCalls": 127, "cacheHits": 23, "lazyLoads": 150 },
      "apiCallReduction": "94.9%"
    },
    "algorithm": "hybrid"
  },
  "quotaStatus": { ... },
  "metadata": {
    "requestedVoters": 10,
    "includedVoters": 10,
    "skippedVoters": 0
  }
}
```

#### `POST /api/routes/distance-matrix`
**Purpose:** Raw distance/duration matrix between locations  
**Request:**
```json
{
  "origins": [{ "lat": 36.5040, "lng": -89.1872 }],
  "destinations": [{ "lat": 36.5045, "lng": -89.1875 }],
  "mode": "driving"
}
```
**Response:**
```json
{
  "success": true,
  "matrix": [[{ "distance": 1234, "duration": 120, "status": "OK" }]],
  "cacheStats": { "totalPairs": 1, "cacheHits": 0, "cacheMisses": 1, "hitRate": "0.0" }
}
```

#### `GET /api/routes/quota-status`
**Purpose:** API quota usage across all Google Maps APIs  
**Response:**
```json
{
  "success": true,
  "quotas": { "distance_matrix": {...}, "geocoding": {...}, "directions": {...} },
  "totalQuota": 30000,
  "totalUsed": 1234,
  "totalRemaining": 28766,
  "averageCacheHitRate": 45.2
}
```

#### `GET /api/routes/cache-stats`
**Purpose:** Route cache performance metrics  
**Response:**
```json
{
  "success": true,
  "cacheStats": {
    "totalRoutes": 1500,
    "activeRoutes": 1200,
    "expiredRoutes": 300,
    "cacheSize": "0.29 MB",
    "modeDistribution": { "driving": 800, "walking": 400 },
    "hitRate": { "month": 65 }
  }
}
```

#### `POST /api/routes/save`
**Purpose:** Save a calculated route for sharing  
**Request:**
```json
{
  "routeData": {
    "locations": [...],
    "metrics": {...},
    "startLocation": { "lat": 36.5, "lng": -89.1 }
  },
  "options": {
    "routeName": "Downtown Canvassing",
    "travelMode": "walking",
    "expiresIn": 2592000000
  }
}
```
**Response:**
```json
{
  "success": true,
  "routeId": "abc123...",
  "shareableUrl": "http://localhost:3000/routes/share/abc123...",
  "expiresAt": "2026-03-19T..."
}
```

#### `GET /api/routes/:routeId`
**Purpose:** Retrieve a saved route  
**Response:**
```json
{
  "success": true,
  "route": {
    "id": "abc123...",
    "routeName": "Downtown Canvassing",
    "travelMode": "walking",
    "createdAt": "...",
    "accessCount": 3,
    "routeData": {
      "locations": [...],
      "metrics": {...}
    }
  }
}
```

#### `DELETE /api/routes/:routeId`
**Purpose:** Delete a saved route  
**Response:** `{ "success": true, "message": "Route deleted successfully" }`

#### `GET /api/routes/:routeId/print`
**Purpose:** Generate print-friendly HTML view of route  
**Response:** Full HTML page with route sheet, formatted for printing

#### `POST /api/routes/cache-cleanup`
**Purpose:** Manually trigger expired cache cleanup  
**Response:** `{ "success": true, "deletedCount": 42 }`

#### `POST /api/routes/cleanup-expired`
**Purpose:** Clean up expired saved routes  
**Response:** `{ "success": true, "deletedCount": 5 }`

### 2.2 Geocoding Endpoints (`/api/geocode/`)

#### `POST /api/geocode/batch`
**Purpose:** Start batch geocoding job  
**Request:**
```json
{
  "voterIds": [1, 2, 3],     // Specific voter IDs
  "all": true,                // OR geocode all ungeocoded voters
  "options": { "useCache": true }
}
```
**Response:**
```json
{
  "success": true,
  "jobId": 12,
  "totalRecords": 500,
  "estimatedDuration": "1 minutes 15 seconds",
  "statusUrl": "/api/geocode/jobs/12"
}
```

#### `GET /api/geocode/jobs/:id`
**Purpose:** Get geocoding job status and progress  
**Response:**
```json
{
  "success": true,
  "jobId": 12,
  "status": "PROCESSING",    // PENDING | PROCESSING | COMPLETED | FAILED | CANCELLED
  "progress": 45.5,
  "total": 500,
  "processed": 227,
  "successful": 210,
  "failed": 17,
  "cacheHits": 150,
  "apiCalls": 77,
  "estimatedCompletion": "2026-02-17T...",
  "errors": [{ "error_type": "ZERO_RESULTS", "count": 12 }]
}
```

#### `POST /api/geocode/single`
**Purpose:** Geocode a single address immediately  
**Request:**
```json
{
  "address": "123 Main St",
  "city": "Union City",
  "state": "TN",
  "zipCode": "38261"
}
```
**Response:**
```json
{
  "success": true,
  "result": {
    "latitude": 36.4314,
    "longitude": -89.0573,
    "formatted_address": "123 Main St, Union City, TN 38261",
    "quality_score": 95,
    "location_type": "ROOFTOP"
  }
}
```

#### `GET /api/geocode/stats`
**Purpose:** Comprehensive geocoding statistics  
**Response:**
```json
{
  "success": true,
  "totalVoters": 5000,
  "geocodedVoters": 4200,
  "pendingVoters": 800,
  "geocodingProgress": 84.0,
  "averageQualityScore": "82.50",
  "cache": { "total_cached": 3500, "cache_hit_rate_percent": 65.2 },
  "recentJobs": [...],
  "apiUsage": { "today": 200, "dailyLimit": 10000, "percentUsed": 2.0 }
}
```

#### `GET /api/geocode/failed/:jobId`
**Purpose:** List failed geocoding addresses from a job  
**Response:**
```json
{
  "success": true,
  "failedCount": 17,
  "errors": [
    { "voter_id": 123, "address": "...", "error_type": "ZERO_RESULTS", "error_message": "..." }
  ]
}
```

#### `PUT /api/geocode/manual/:voterId`
**Purpose:** Manually set coordinates for a voter  
**Request:**
```json
{
  "latitude": 36.4314,
  "longitude": -89.0573,
  "quality_score": 100,
  "note": "Corrected via satellite imagery"
}
```

#### `POST /api/geocode/retry/:jobId`
**Purpose:** Retry failed addresses from a previous job  
**Request:** `{ "errorTypes": ["ZERO_RESULTS", "API_ERROR"] }`  
**Response:**
```json
{
  "success": true,
  "newJobId": 15,
  "message": "Retry job created for 17 failed addresses"
}
```

#### `GET /api/geocode/review`
**Purpose:** Get addresses with low quality scores needing manual review  
**Query params:** `?minQuality=0&maxQuality=70&limit=100`  
**Response:**
```json
{
  "success": true,
  "count": 25,
  "voters": [
    { "id": 123, "first_name": "...", "latitude": 36.4, "longitude": -89.0, "geocoding_quality": "45" }
  ]
}
```

#### `GET /api/geocode/cache/stats` (Legacy)
**Purpose:** Geocoding cache statistics

#### `GET /api/geocode/status` (Legacy)
**Purpose:** Redirects to `/api/geocode/jobs/:id`

### 2.3 Voter Endpoints (`/api/voters/`)

#### `GET /api/voters`
**Query params:** `precinct`, `name`, `super_voter`, `geocoded`, `party`, `voting_status`, `limit`, `offset`, `sort`, `order`  
**Key for MapView:** `geocoded=true` returns voters with coordinates for mapping; `geocoded=false` returns voters needing geocoding.

#### `GET /api/voters/search/:query`
**Purpose:** Search voters by name or address (partial match)

#### `GET /api/voters/:id`
**Purpose:** Get detailed voter with election history

#### `GET /api/voters/precinct/:precinct`
**Purpose:** Get all voters in a precinct with statistics

---

## 3. Frontend API Client Inventory

**Location:** `frontend/src/api/client.js`

### 3.1 Route Planning Functions (ALL EXIST)

| Function | Backend Endpoint | Used in MapView? |
|----------|-----------------|-------------------|
| `calcRoute(body)` | `POST /api/routes/calculate` | ❌ Not used |
| `calcDistMatrix(body)` | `POST /api/routes/distance-matrix` | ❌ Not used |
| `fetchQuotaStatus()` | `GET /api/routes/quota-status` | ❌ Not used |
| `fetchCacheStats()` | `GET /api/routes/cache-stats` | ❌ Not used |
| `cleanCache()` | `POST /api/routes/cache-cleanup` | ❌ Not used |
| `saveRoute(body)` | `POST /api/routes/save` | ❌ Not used |
| `fetchRoute(id)` | `GET /api/routes/:id` | ❌ Not used |
| `deleteRoute(id)` | `DELETE /api/routes/:id` | ❌ Not used |
| `cleanExpiredRoutes()` | `POST /api/routes/cleanup-expired` | ❌ Not used |

### 3.2 Geocoding Functions (ALL EXIST)

| Function | Backend Endpoint | Used in MapView? |
|----------|-----------------|-------------------|
| `startBatchGeocode(body)` | `POST /api/geocode/batch` | ❌ Not used |
| `fetchGeoJob(id)` | `GET /api/geocode/jobs/:id` | ❌ Not used |
| `geocodeSingle(body)` | `POST /api/geocode/single` | ❌ Not used |
| `fetchGeoFailed(id)` | `GET /api/geocode/failed/:id` | ❌ Not used |
| `manualGeocode(voterId, body)` | `PUT /api/geocode/manual/:voterId` | ❌ Not used |
| `fetchGeoStats()` | `GET /api/geocode/stats` | ❌ Not used |
| `retryGeoJob(id, body)` | `POST /api/geocode/retry/:id` | ❌ Not used |
| `fetchGeoReview(params)` | `GET /api/geocode/review` | ❌ Not used |

### 3.3 Voter Functions (Some Used)

| Function | Used in MapView? |
|----------|-------------------|
| `fetchVoters(filters)` | ✅ Used (geocoded voters for markers) |
| `searchVoters(query)` | ❌ Not used |
| `fetchVotersByPrecinct(n)` | ❌ Not used |
| `fetchVoter(id)` | ❌ Not used |

### 3.4 Other Functions Used

| Function | Used in MapView? |
|----------|-------------------|
| `fetchConfig()` | ✅ Used (API key) |
| `fetchPrecincts()` | ✅ Used (precinct dropdown) |

---

## 4. Gap Analysis

### 4.1 Critical Frontend Gaps

| Feature | Backend | Frontend Client | MapView UI |
|---------|---------|-----------------|------------|
| Route optimization | ✅ Full TSP solver | ✅ `calcRoute()` | ❌ **No UI** |
| Route display on map | ✅ Returns ordered locations | ✅ Available | ❌ **No polyline/directions rendering** |
| Route save/load | ✅ Full CRUD | ✅ `saveRoute()`, `fetchRoute()`, `deleteRoute()` | ❌ **No UI** |
| Route sharing/print | ✅ Print HTML endpoint | ✅ Available | ❌ **No UI** |
| Geocoding status | ✅ Full stats + progress | ✅ `fetchGeoStats()` | ❌ **No UI** |
| Batch geocoding trigger | ✅ Job system | ✅ `startBatchGeocode()` | ❌ **No UI** |
| Geocoding progress tracking | ✅ Real-time job status | ✅ `fetchGeoJob()` | ❌ **No UI** |
| Manual geocoding | ✅ Coordinate override | ✅ `manualGeocode()` | ❌ **No UI** |
| Voter selection for routes | ✅ `getVotersByIds()` | ✅ Available | ❌ **No selection mechanism** |
| Start location picker | N/A (frontend concern) | N/A | ❌ **No map click handler** |
| Travel mode selection | ✅ driving/walking/bicycling | ✅ In request body | ❌ **No UI** |
| Quota monitoring | ✅ Full status endpoint | ✅ `fetchQuotaStatus()` | ❌ **No UI** |
| Google Maps Directions API | ❌ Not loaded | ❌ N/A | ❌ **`directions` library not loaded** |

### 4.2 Summary

**Backend completeness: ~100%** — All route planning, geocoding, caching, and saved route APIs are fully implemented.

**Frontend client completeness: ~100%** — All API client functions exist and are correctly wired up.

**MapView UI completeness: ~15%** — Only basic marker plotting exists. Zero route planning, geocoding management, or saved route UI features are implemented.

---

## 5. Implementation Plan

### 5.1 Architecture Overview

The enhanced MapView will have **4 major panels/sections** alongside the existing map:

1. **Map Controls Bar** (enhanced from existing)
2. **Route Planning Panel** (new sidebar/drawer)
3. **Geocoding Status Panel** (new collapsible section)
4. **Saved Routes Panel** (new sidebar/drawer)

### 5.2 Feature Breakdown

#### Feature A: Enhanced Voter Selection & Map Interaction

**A1. Voter selection mode**
- Add a "Select Voters" toggle button to the controls bar
- When active, clicking a marker adds/removes it from a selection set
- Selected markers get a distinct style (larger, outlined, numbered)
- Selection counter shows `X voters selected`
- "Clear Selection" button
- "Select All Visible" button

**A2. Start location picker**
- "Set Start Location" button
- Click on map to place a draggable start pin
- Or use browser geolocation: "Use My Location" button
- Start pin is displayed as a distinct marker (house icon or green pin)
- Coordinates displayed in a small info box

**A3. Enhanced InfoWindow**
- Add a "Add to Route" / "Remove from Route" button in each voter's InfoWindow popup
- Show geocoding quality score
- Show election participation info

#### Feature B: Route Planning Panel

**B1. Route configuration**
- Travel mode selector: Walking / Driving / Bicycling (radio buttons or segmented control)
- Algorithm selector: Nearest Neighbor / 2-Opt / Hybrid (dropdown, default: hybrid)
- "Calculate Route" button (disabled until ≥1 voter selected + start location set)

**B2. Route calculation flow**
1. User clicks "Calculate Route"
2. Show loading spinner with "Optimizing route for X voters..."
3. Call `calcRoute({ voterIds, startLocation, mode, algorithm })`
4. On success: render route on map + show route stats
5. On error: show toast with error message (quota exceeded, no geocoded addresses, etc.)

**B3. Route visualization on map**
- Draw a Google Maps Polyline connecting ordered locations
- Alternatively, use Directions Service for road-following paths (requires `directions` library)
- Number each stop with custom numbered markers (1, 2, 3...)
- Start location gets a special "S" or house marker
- Clicking a route stop marker shows stop details + leg distance/duration to next stop

**B4. Route statistics display**
- Total distance (miles)
- Total duration (minutes/hours)
- Number of stops
- Average distance per stop (feet)
- Route efficiency score
- Recommended travel mode
- Optimization time
- Progressive routing stats (API calls saved)

**B5. Route actions**
- "Save Route" button → opens modal to name the route → calls `saveRoute()`
- "Print Route" button → opens print view in new tab (`/api/routes/:id/print`)
- "Share Route" button → copies shareable URL to clipboard
- "Clear Route" button → removes route visualization
- "Export Route" → future: CSV of stops

#### Feature C: Geocoding Management Panel

**C1. Geocoding statistics card**
- Load stats on mount: `fetchGeoStats()`
- Display: total voters, geocoded count, pending count, progress bar percentage
- Average quality score
- API usage today (calls / daily limit)

**C2. Batch geocoding trigger**
- "Geocode All Pending" button → calls `startBatchGeocode({ all: true })`
- "Geocode Selected Precinct" button → filters voter IDs by selected precinct
- Confirmation dialog showing estimated duration

**C3. Geocoding job progress tracker**
- After starting a job, poll `fetchGeoJob(jobId)` every 3 seconds
- Show progress bar with percentage
- Show real-time stats: processed / total, success / failed, cache hits / API calls
- Estimated completion time
- "Cancel" button (would need cancel endpoint — exists in `cancelJob()` in service but no route exposed)
- Auto-refresh map markers when job completes

**C4. Geocoded vs ungeocoded visualization**
- Toggle to show ungeocoded voters as gray markers at approximate precinct center
- Or show a summary card: "800 voters without coordinates"

**C5. Quality review integration**
- "Review Low Quality" button → shows voters with quality < 70
- Manual geocode override: click marker → enter corrected coordinates

#### Feature D: Saved Routes Panel

**D1. Saved routes list**
- On mount: fetch saved routes (need to add a "list all routes" endpoint, or use a local storage approach)
- Display as a list with: route name, date created, stop count, travel mode, access count
- Click to load onto map

**D2. Load saved route**
- Call `fetchRoute(routeId)`
- Plot route on map with stop markers and polyline
- Show route statistics

**D3. Delete saved route**
- Delete button on each list item
- Confirmation dialog
- Call `deleteRoute(routeId)`

**D4. Route sharing**
- Copy link button for shareable URL
- Print button opens `/api/routes/:routeId/print` in new tab

### 5.3 State Management

Expand the module-level state:

```javascript
// Existing
let map = null;
let markers = [];
let infoWindow = null;

// New - Route Planning
let selectedVoterIds = new Set();
let selectedMarkers = new Map();          // voterId → marker reference
let startLocation = null;                 // { lat, lng }
let startMarker = null;                   // Google Maps Marker
let routePolyline = null;                 // Google Maps Polyline
let routeStopMarkers = [];               // Numbered stop markers
let currentRoute = null;                  // Last calculated route response
let directionsRenderer = null;           // Google Maps DirectionsRenderer

// New - Geocoding
let geocodingJobId = null;
let geocodingPollInterval = null;

// New - Saved Routes
let savedRoutes = [];                     // Cached list of saved routes

// New - UI State
let activePanel = null;                   // 'route' | 'geocoding' | 'saved' | null
let isSelectMode = false;
```

### 5.4 Implementation Order

**Phase 1: Foundation** (Prerequisite infrastructure)
1. Update `loadGoogleMapsScript()` to load `directions` library alongside `geometry`
2. Add expanded module-level state variables
3. Restructure HTML template for sidebar/panel layout
4. Add new imports from `api/client.js`

**Phase 2: Voter Selection** (A1, A2, A3)
1. Implement select mode toggle
2. Implement marker click-to-select
3. Implement start location picker
4. Implement enhanced InfoWindow

**Phase 3: Route Planning** (B1–B5)
1. Build route configuration UI
2. Implement route calculation with `calcRoute()`
3. Implement route polyline rendering
4. Implement route statistics display
5. Implement route save/print/share actions

**Phase 4: Geocoding** (C1–C5)
1. Build geocoding stats card
2. Implement batch geocoding trigger
3. Implement job progress polling
4. Implement ungeocoded voter display

**Phase 5: Saved Routes** (D1–D4)
1. Build saved routes list panel
2. Implement load/delete/share for saved routes

---

## 6. UI Design Specifications

### 6.1 Overall Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Voter Map  (section heading)                                    │
├──────────────────────────────────────────────────────────────────┤
│  ┌─ Controls Bar ──────────────────────────────────────────────┐ │
│  │ [Precinct ▾] [Filter ▾] [Travel Mode ▾] [Select Mode □]    │ │
│  │ [Load Voters] [Calculate Route] [Geocoding ▾] [Saved ▾]    │ │
│  │ X voters plotted · Y selected · Start: set/not set          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Collapsible Side Panel ────┐ ┌─ Map Canvas ─────────────┐  │
│  │                             │ │                           │  │
│  │  [Route Planning]           │ │    Google Map             │  │
│  │  [Geocoding Status]         │ │    with markers           │  │
│  │  [Saved Routes]             │ │    and route lines        │  │
│  │                             │ │                           │  │
│  │  (shows active panel        │ │                           │  │
│  │   content)                  │ │                           │  │
│  │                             │ │                           │  │
│  └─────────────────────────────┘ └───────────────────────────┘  │
│                                                                  │
│  ┌─ Route Statistics (shown after route calculated) ───────────┐ │
│  │  Distance: 5.2mi  Duration: 42min  Stops: 15  Efficiency: 72% │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Geocoding Status Bar (collapsible) ────────────────────────┐ │
│  │  4200/5000 geocoded (84%) ████████████░░░░  API: 200/10000  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Controls Bar (Enhanced)

```html
<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
  <!-- Row 1: Filters + Actions -->
  <div class="flex flex-wrap items-center gap-3">
    <!-- Existing: Precinct dropdown -->
    <select id="map-precinct">...</select>
    
    <!-- Existing: Voter filter dropdown -->
    <select id="map-filter">...</select>
    
    <!-- NEW: Travel mode selector -->
    <select id="map-travel-mode">
      <option value="walking">🚶 Walking</option>
      <option value="driving">🚗 Driving</option>
      <option value="bicycling">🚴 Bicycling</option>
    </select>
    
    <!-- Existing: Load Voters button -->
    <button id="map-reload">Load Voters</button>
    
    <!-- NEW: Select mode toggle -->
    <button id="map-select-mode" class="...">
      Select Voters
    </button>
    
    <!-- NEW: Action buttons -->
    <button id="map-calc-route" disabled>Calculate Route</button>
    
    <div class="ml-auto flex items-center gap-3">
      <button id="map-geocoding-btn">📍 Geocoding</button>
      <button id="map-saved-btn">💾 Saved Routes</button>
    </div>
  </div>
  
  <!-- Row 2: Status bar -->
  <div class="flex items-center gap-4 mt-2 text-sm text-gray-500">
    <span id="map-count">0 voters plotted</span>
    <span id="map-selected-count" class="hidden">0 selected</span>
    <span id="map-start-status">Start: not set</span>
  </div>
</div>
```

### 6.3 Side Panel

```html
<div id="map-side-panel" class="hidden w-80 bg-white dark:bg-gray-900 rounded-xl border 
  border-gray-200 dark:border-gray-700 overflow-y-auto max-h-[600px]">
  
  <!-- Panel header with close button -->
  <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
    <h3 id="panel-title" class="font-semibold text-gray-900 dark:text-white">Panel</h3>
    <button id="panel-close" class="text-gray-400 hover:text-gray-600">✕</button>
  </div>
  
  <!-- Panel content -->
  <div id="panel-content" class="p-4">
    <!-- Dynamic content based on active panel -->
  </div>
</div>
```

### 6.4 Route Planning Panel Content

```html
<!-- When active panel = 'route' -->
<div class="space-y-4">
  <!-- Selection summary -->
  <div class="text-sm">
    <p><strong>Selected:</strong> <span id="route-voter-count">0</span> voters</p>
    <p><strong>Start:</strong> <span id="route-start-info">Not set</span></p>
  </div>
  
  <!-- Algorithm selector -->
  <div>
    <label class="text-xs font-semibold uppercase text-gray-500">Algorithm</label>
    <select id="route-algorithm" class="w-full mt-1 rounded-lg border ...">
      <option value="hybrid">Hybrid (recommended)</option>
      <option value="nearest_neighbor">Nearest Neighbor</option>
      <option value="2opt">2-Opt Improvement</option>
    </select>
  </div>
  
  <!-- Calculate button -->
  <button id="route-calculate" class="w-full bg-primary-600 ... disabled:opacity-50" disabled>
    Calculate Route
  </button>
  
  <!-- Route results (shown after calculation) -->
  <div id="route-results" class="hidden space-y-3">
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
        <p class="text-xs text-gray-500">Distance</p>
        <p class="text-lg font-bold" id="route-distance">--</p>
      </div>
      <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
        <p class="text-xs text-gray-500">Duration</p>
        <p class="text-lg font-bold" id="route-duration">--</p>
      </div>
      <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
        <p class="text-xs text-gray-500">Stops</p>
        <p class="text-lg font-bold" id="route-stops">--</p>
      </div>
      <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
        <p class="text-xs text-gray-500">Efficiency</p>
        <p class="text-lg font-bold" id="route-efficiency">--</p>
      </div>
    </div>
    
    <!-- Stop list -->
    <div class="border rounded-lg divide-y max-h-60 overflow-y-auto">
      <div id="route-stop-list">
        <!-- Populated dynamically -->
      </div>
    </div>
    
    <!-- Route actions -->
    <div class="flex gap-2">
      <button id="route-save" class="flex-1 bg-green-600 ...">💾 Save</button>
      <button id="route-print" class="flex-1 bg-blue-600 ...">🖨️ Print</button>
      <button id="route-clear" class="flex-1 bg-gray-600 ...">✕ Clear</button>
    </div>
  </div>
</div>
```

### 6.5 Geocoding Panel Content

```html
<!-- When active panel = 'geocoding' -->
<div class="space-y-4">
  <!-- Stats overview -->
  <div id="geo-stats" class="space-y-2">
    <div class="flex justify-between text-sm">
      <span>Geocoded</span>
      <span id="geo-coded-count">--/--</span>
    </div>
    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div id="geo-progress-bar" class="bg-green-500 h-2 rounded-full" style="width: 0%"></div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs text-gray-500">
      <span>Quality: <strong id="geo-quality">--</strong></span>
      <span>API: <strong id="geo-api-usage">--</strong></span>
    </div>
  </div>
  
  <!-- Actions -->
  <div class="space-y-2">
    <button id="geo-batch-all" class="w-full bg-amber-600 ...">
      📍 Geocode All Pending
    </button>
    <button id="geo-refresh-stats" class="w-full bg-gray-200 ...">
      🔄 Refresh Stats
    </button>
  </div>
  
  <!-- Job progress (hidden until job starts) -->
  <div id="geo-job-progress" class="hidden space-y-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
    <div class="flex justify-between text-sm">
      <span>Job #<span id="geo-job-id">--</span></span>
      <span id="geo-job-status">--</span>
    </div>
    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div id="geo-job-bar" class="bg-blue-500 h-2 rounded-full transition-all" style="width: 0%"></div>
    </div>
    <div class="text-xs text-gray-500">
      <span id="geo-job-detail">0/0 processed</span>
    </div>
  </div>
</div>
```

### 6.6 Saved Routes Panel Content

```html
<!-- When active panel = 'saved' -->
<div class="space-y-4">
  <div id="saved-routes-list" class="space-y-2">
    <!-- Dynamically populated -->
    <!-- Each saved route item: -->
    <div class="border rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
      <div class="flex justify-between items-start">
        <div>
          <p class="font-medium text-sm">Route Name</p>
          <p class="text-xs text-gray-500">Feb 15, 2026 · 15 stops · Walking</p>
        </div>
        <div class="flex gap-1">
          <button class="text-blue-500 hover:text-blue-700 text-xs" data-action="load">Load</button>
          <button class="text-red-500 hover:text-red-700 text-xs" data-action="delete">Delete</button>
        </div>
      </div>
    </div>
  </div>
  
  <p id="saved-routes-empty" class="text-sm text-gray-400 text-center py-4 hidden">
    No saved routes yet
  </p>
</div>
```

### 6.7 Marker Styles

```javascript
// Regular voter (existing)
const regularMarkerIcon = {
  path: google.maps.SymbolPath.CIRCLE,
  scale: 7,
  fillColor: '#6366f1',      // Indigo
  fillOpacity: 0.8,
  strokeColor: '#fff',
  strokeWeight: 1.5,
};

// Super voter (existing)
const superVoterMarkerIcon = {
  path: google.maps.SymbolPath.CIRCLE,
  scale: 7,
  fillColor: '#16a34a',      // Green
  fillOpacity: 0.8,
  strokeColor: '#fff',
  strokeWeight: 1.5,
};

// Selected voter (new)
const selectedMarkerIcon = {
  path: google.maps.SymbolPath.CIRCLE,
  scale: 10,
  fillColor: '#f59e0b',      // Amber
  fillOpacity: 1.0,
  strokeColor: '#d97706',
  strokeWeight: 3,
};

// Start location (new)
const startLocationIcon = {
  path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
  scale: 8,
  fillColor: '#22c55e',      // Green-500
  fillOpacity: 1.0,
  strokeColor: '#fff',
  strokeWeight: 2,
};

// Route stop numbered marker (new) — use custom label
function createStopMarker(position, stopNumber, map) {
  return new google.maps.Marker({
    position,
    map,
    label: {
      text: String(stopNumber),
      color: '#fff',
      fontSize: '11px',
      fontWeight: 'bold',
    },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 14,
      fillColor: '#3b82f6',   // Blue-500
      fillOpacity: 1.0,
      strokeColor: '#1d4ed8',
      strokeWeight: 2,
    },
    zIndex: 1000 + stopNumber,
  });
}
```

---

## 7. Code Patterns & Style Guide

### 7.1 Import Pattern (match existing)

```javascript
// Add these imports to MapView.js
import {
  fetchConfig, fetchVoters, fetchPrecincts,         // existing
  calcRoute, saveRoute, fetchRoute, deleteRoute,     // route planning
  fetchQuotaStatus,                                  // quota monitoring
  startBatchGeocode, fetchGeoJob, fetchGeoStats,     // geocoding
  manualGeocode                                      // manual geocode
} from '../api/client.js';

import {
  sectionHeading, spinner, errorBox, fmt, escapeHtml, statCard  // add statCard
} from '../components/ui.js';

import { showToast } from '../main.js';
```

### 7.2 Function Pattern (match existing async pattern)

```javascript
// All async operations follow this pattern:
async function someAction() {
  try {
    // Show loading state
    someElement.textContent = 'Loading...';
    
    // Call API
    const result = await apiFunction(params);
    
    // Update UI with result
    renderResult(result);
    
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}
```

### 7.3 Event Listener Pattern (match existing)

```javascript
// Wire up event handlers after initial render
container.querySelector('#button-id').addEventListener('click', () => handlerFunction(container));
```

### 7.4 HTML Template Pattern (match existing inline template style)

```javascript
container.innerHTML = `
  ${sectionHeading('Title', 'Subtitle')}
  <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
    <!-- content -->
  </div>
`;
```

### 7.5 Cleanup Pattern (match existing)

```javascript
export async function renderMap(container) {
  // ... setup ...
  
  // Return cleanup function
  return () => {
    clearMarkers();
    clearRoute();
    clearGeocodingPoll();
    map = null;
  };
}
```

### 7.6 Tailwind CSS Classes Used in Codebase

- Containers: `bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700`
- Buttons (primary): `bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition`
- Buttons (secondary): `bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm font-medium transition`
- Buttons (success): `bg-green-600 hover:bg-green-700 text-white ...`
- Buttons (warning): `bg-amber-600 hover:bg-amber-700 text-white ...`
- Buttons (danger): `bg-red-600 hover:bg-red-700 text-white ...`
- Selects: `rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none`
- Text (heading): `text-gray-900 dark:text-white`
- Text (secondary): `text-sm text-gray-500 dark:text-gray-400`
- Cards: Reuse `statCard()` from ui.js for metric displays

---

## 8. Dependencies

### 8.1 Google Maps Libraries to Load

**Current:** `geometry` only  
**Required:** `geometry,directions,places`

Update the script URL:
```javascript
script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry,directions`;
```

The `directions` library is needed for:
- `google.maps.DirectionsService` - to get road-following route paths
- `google.maps.DirectionsRenderer` - to render route polylines on the map

### 8.2 No New NPM Packages Required

All API client functions are already implemented. The Google Maps JavaScript API handles:
- Polyline rendering (`google.maps.Polyline`)
- Directions rendering (`google.maps.DirectionsRenderer`)
- Custom markers with labels
- Map click events for start location

### 8.3 Backend Considerations

**No backend changes needed** — all endpoints exist and are tested.

**One minor gap:** The saved routes model has `getRoutesByUser(userId)` but there's no REST endpoint for listing all saved routes. Options:
1. Add `GET /api/routes/list` endpoint (preferred)
2. Store route IDs in localStorage and fetch individually
3. Use a simple `GET /api/routes/list` → query all non-expired routes

**Recommendation:** Add a lightweight endpoint to list saved routes. However, this can be deferred by storing route IDs in localStorage initially.

---

## 9. Data Flow Diagrams

### 9.1 Route Calculation Flow

```
User selects voters on map
        │
        ▼
User sets start location (click map or geolocation)
        │
        ▼
User clicks "Calculate Route"
        │
        ▼
Frontend: calcRoute({ voterIds: [...], startLocation, mode, algorithm })
        │
        ▼
Backend: POST /api/routes/calculate
  ├── Fetch voters by IDs (VoterModel.getVotersByIds)
  ├── Filter to geocoded voters only
  ├── Build distance matrix (progressive/sparse)
  ├── Run TSP algorithm (nearest_neighbor / 2opt / hybrid)
  ├── Calculate metrics
  └── Return ordered locations + metrics
        │
        ▼
Frontend: Receive route response
  ├── Draw polyline on map connecting ordered locations
  ├── Place numbered stop markers
  ├── Display route statistics panel
  └── Enable save/print/share buttons
```

### 9.2 Geocoding Job Flow

```
User clicks "Geocode All Pending"
        │
        ▼
Frontend: startBatchGeocode({ all: true })
        │
        ▼
Backend: POST /api/geocode/batch
  ├── Find all voters where latitude IS NULL
  ├── Create geocoding job record
  ├── Start async processing (setImmediate)
  └── Return jobId immediately
        │
        ▼
Frontend: Start polling fetchGeoJob(jobId) every 3 seconds
        │
        ▼
[Poll loop]
  ├── Update progress bar (progress %)
  ├── Update stats (processed/total, success/failed, cache hits)
  ├── Show estimated completion time
  └── Check status === 'COMPLETED' or 'FAILED'
        │
        ▼
Job complete:
  ├── Stop polling
  ├── Show completion toast
  ├── Refresh geocoding stats
  └── Auto-reload map voters (to show newly geocoded)
```

### 9.3 Saved Route Flow

```
Route calculated on map
        │
        ▼
User clicks "Save Route"
  ├── Modal: enter route name
  └── Call saveRoute({ routeData, options: { routeName, travelMode } })
        │
        ▼
Backend returns routeId + shareableUrl
        │
        ▼
Frontend: 
  ├── Store routeId in localStorage list
  ├── Show success toast with shareable URL
  └── Update saved routes panel
        
─────────────────────────────────────
        
User opens Saved Routes panel
        │
        ▼
Frontend: Read routeIds from localStorage
  ├── For each: fetchRoute(id) 
  └── Display list with name, date, stops
        │
        ▼
User clicks "Load"
  ├── fetchRoute(routeId)
  ├── Plot route on map (polyline + numbered markers)
  └── Show route statistics
        
User clicks "Delete"
  ├── deleteRoute(routeId)
  ├── Remove from localStorage
  └── Remove from list
        
User clicks "Print"
  └── window.open(`/api/routes/${routeId}/print`, '_blank')
        
User clicks "Share"
  └── navigator.clipboard.writeText(shareableUrl)
```

---

## Appendix A: Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/pages/MapView.js` | **Major Rewrite** | Add all route planning, geocoding, and saved routes UI |
| `frontend/src/api/client.js` | **Minor Add** | Add `fetchSavedRoutes()` function if list endpoint is created |
| `backend/routes/routes.js` | **Minor Add** | Add `GET /api/routes/list` endpoint (optional) |

## Appendix B: Estimated Complexity

| Feature | Estimated Lines | Effort |
|---------|----------------|--------|
| Enhanced controls bar | ~80 | Low |
| Voter selection mode | ~120 | Medium |
| Start location picker | ~60 | Low |
| Route planning panel | ~200 | High |
| Route map visualization | ~150 | High |
| Route statistics display | ~80 | Low |
| Route save/print/share | ~100 | Medium |
| Geocoding status panel | ~120 | Medium |
| Batch geocoding + polling | ~100 | Medium |
| Saved routes panel | ~150 | Medium |
| State management + cleanup | ~50 | Low |
| **Total** | **~1,210** | **High** |

Current MapView.js: 202 lines → Enhanced: ~1,400 lines

## Appendix C: Testing Checklist

- [ ] Map loads with voter markers (existing behavior preserved)
- [ ] Precinct filter works (existing behavior preserved)
- [ ] Super voter filter works (existing behavior preserved)
- [ ] Select mode activates/deactivates
- [ ] Clicking markers in select mode toggles selection
- [ ] Start location can be placed by clicking map
- [ ] "Use My Location" geolocation works
- [ ] Route calculates successfully with selected voters + start
- [ ] Route polyline renders on map
- [ ] Numbered stop markers display correctly
- [ ] Route statistics show correct values
- [ ] Route save creates saved route with ID
- [ ] Route print opens correct URL in new tab
- [ ] Route share copies URL to clipboard
- [ ] Route clear removes all route visuals
- [ ] Geocoding stats load on panel open
- [ ] Batch geocoding starts and returns job ID
- [ ] Job progress polls and updates correctly
- [ ] Geocoding completion auto-refreshes map
- [ ] Saved routes list displays routes
- [ ] Load saved route renders on map
- [ ] Delete saved route removes it
- [ ] Cleanup function properly disposes all resources
- [ ] Dark mode styling works for all new elements
- [ ] Mobile/responsive layout doesn't break
