# Route Export & Mobile Integration - Implementation Specification

**Document Version:** 1.0  
**Date:** February 15, 2026  
**Feature:** Route Export & Mobile Integration (Improvement #2)  
**Status:** Implementation Ready

---

## Executive Summary

This specification details the implementation of comprehensive route export and mobile integration features for the Voter Platform's route planning system. The feature enables seamless transition from desktop route planning to mobile field execution through multiple export formats including direct mobile app integration, printable route sheets, shareable URLs, and offline storage.

**Key Deliverables:**
- Google Maps & Apple Maps deep linking with multi-waypoint support
- Shareable route URLs with database persistence
- CSV export for address lists
- Offline JSON export for progressive web app (PWA) functionality
- Print-optimized HTML view (PDF generation optional for future phase)

---

## Current State Analysis

### Existing Implementation

**Backend (`backend/routes/routes.js`):**
- ✅ `POST /api/routes/calculate` - Calculates optimized routes
- ✅ Route response includes ordered locations, distance, duration, metrics
- ✅ Support for multiple travel modes (walking, driving, bicycling)
- ✅ Progressive routing with sparse distance matrix (94-96% API reduction)
- ❌ No route persistence/storage mechanism
- ❌ No export-specific endpoints

**Frontend (`frontend/public/js/route-planner-controller.js`):**
- ✅ Route calculation and display with polylines and markers
- ✅ Voter selection and route optimization UI
- ✅ Route results display (distance, duration, stops)
- ✅ Export buttons present in HTML (`exportCSV`, `exportGoogleMaps`)
- ❌ No event listeners bound to export buttons
- ❌ No export functionality implemented
- ❌ No shareable URL generation

**Frontend UI (`frontend/public/index.html` lines 419-432):**
```html
<!-- Export Options -->
<div id="routeExportOptions" class="mt-3 space-y-2">
    <p class="text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Export Route</p>
    <div class="grid grid-cols-2 gap-2">
        <button class="btn-secondary btn-sm justify-center" id="exportCSV">
            <i class="bi bi-filetype-csv"></i>
            <span>CSV</span>
        </button>
        <button class="btn-success btn-sm justify-center" id="exportGoogleMaps">
            <i class="bi bi-google"></i>
            <span>Maps</span>
        </button>
    </div>
</div>
```

**Current Route Data Structure:**
```javascript
// Response from /api/routes/calculate
{
  success: true,
  route: {
    locations: [
      {
        voterId: 123,
        lat: 36.5040,
        lng: -89.1872,
        address: "123 Main St",
        city: "Memphis",
        firstName: "John",
        lastName: "Doe"
      }
      // ... more locations
    ],
    totalDistance: 5.2,      // miles
    totalDuration: 78,        // minutes
    metrics: {
      totalDistanceMiles: 5.2,
      totalDurationMinutes: 78,
      optimizationTimeMs: 450,
      averageDistanceBetweenStops: 0.26,
      // ... additional metrics
    }
  }
}
```

### Gap Analysis

| Feature | Current State | Required State |
|---------|---------------|----------------|
| **Google Maps URL** | ❌ Not implemented | ✅ Deep link with waypoints |
| **Apple Maps URL** | ❌ Not implemented | ✅ Deep link with waypoints |
| **Shareable Route URL** | ❌ Not implemented | ✅ Database storage + unique ID |
| **CSV Export** | ⚠️ Button exists, no implementation | ✅ Full implementation |
| **JSON Export** | ❌ Not implemented | ✅ Offline-compatible format |
| **Print View** | ❌ Not implemented | ✅ Print-optimized HTML |
| **Route Persistence** | ❌ No database table | ✅ `saved_routes` table |
| **UI Controls** | ⚠️ Limited (2 buttons) | ✅ Comprehensive export menu |

---

## Research Findings & Best Practices

### 1. Google Maps URL Scheme

**Documentation Source:** [Google Maps URL Scheme Documentation](https://developers.google.com/maps/documentation/urls/get-started)

**Base URL Format:**
```
https://www.google.com/maps/dir/?api=1&origin=LAT,LNG&destination=LAT,LNG&waypoints=LAT,LNG|LAT,LNG|...&travelmode=MODE
```

**Key Constraints:**
- ✅ Maximum 10 waypoints (including origin and destination)
- ✅ Waypoints separated by pipe `|` character
- ✅ Travel modes: `driving`, `walking`, `bicycling`, `transit`
- ✅ No authentication required (public URL)
- ⚠️ For routes with 10+ stops, must split into multiple routes

**Handling 10+ Location Routes:**
```javascript
// Strategy: Create multiple route segments
// Example: 25 locations → 3 routes of 8-9 locations each
// Route 1: Stops 1-9 (start → 1-8 → waypoint at 9)
// Route 2: Stops 9-17 (pickup at 9 → 10-16 → waypoint at 17)
// Route 3: Stops 17-25 (pickup at 17 → 18-25 → end)
```

**URL Encoding Requirements:**
- Coordinates: Use decimal format (no encoding needed)
- Addresses: URL-encode if using address strings instead of coordinates
- Special characters: `|` for waypoint separation (no encoding)

**Example URLs:**

*Simple Route (5 stops):*
```
https://www.google.com/maps/dir/?api=1
  &origin=36.5040,-89.1872
  &destination=36.5050,-89.1880
  &waypoints=36.5042,-89.1875|36.5045,-89.1877|36.5048,-89.1879
  &travelmode=walking
```

*Route with Place Names (alternative):*
```
https://www.google.com/maps/dir/?api=1
  &origin=Memphis+City+Hall
  &destination=Beale+Street
  &waypoints=Court+Square|Main+Street
  &travelmode=walking
```

### 2. Apple Maps URL Scheme

**Documentation Source:** [Apple Maps URL Scheme Reference](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html)

**Base URL Format:**
```
http://maps.apple.com/?saddr=START&daddr=DEST+to:WAYPOINT1+to:WAYPOINT2&dirflg=MODE
```

**Alternative (iOS-specific):**
```
maps://?saddr=START&daddr=DEST+to:WAYPOINT1+to:WAYPOINT2&dirflg=MODE
```

**Key Constraints:**
- ✅ Supports multiple waypoints using `+to:` syntax
- ✅ No hard limit on waypoint count (practical limit ~20-25)
- ⚠️ Less predictable behavior than Google Maps
- ✅ Direction flags: `d` (driving), `w` (walking), not well-documented for bicycling

**Waypoint Format:**
- Coordinates: `LAT,LNG`
- Addresses: URL-encoded address string
- Separator: `+to:` between waypoints

**Example URL:**
```
http://maps.apple.com/?saddr=36.5040,-89.1872
  &daddr=36.5050,-89.1880+to:36.5042,-89.1875+to:36.5045,-89.1877
  &dirflg=w
```

**Platform Detection:**
```javascript
// Detect iOS for Apple Maps fallback
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isMacOS = /Macintosh/.test(navigator.userAgent);

if (isIOS || isMacOS) {
  // Prefer Apple Maps on Apple devices
  window.location.href = appleMapsUrl;
} else {
  // Use Google Maps on other platforms
  window.open(googleMapsUrl, '_blank');
}
```

### 3. Shareable Route URL Best Practices

**Security Considerations:**
- Generate cryptographically secure random IDs (32+ characters)
- Use URL-safe Base64 encoding or UUID v4
- Optionally require authentication for viewing sensitive voter data
- Implement rate limiting to prevent enumeration attacks

**ID Generation Examples:**
```javascript
// Method 1: crypto.randomBytes
const crypto = require('crypto');
const routeId = crypto.randomBytes(16).toString('base64url'); // e.g., "Xy7z9A2Bc3Def4Gh"

// Method 2: UUID v4
const { v4: uuidv4 } = require('uuid');
const routeId = uuidv4(); // e.g., "550e8400-e29b-41d4-a716-446655440000"
```

**URL Structure:**
```
https://voter-platform.example.com/routes/share/[ROUTE_ID]
```

**Database Schema:**
```sql
CREATE TABLE saved_routes (
  id TEXT PRIMARY KEY,                    -- Unique route ID (UUID or random)
  user_id INTEGER,                        -- Optional: user who created route
  route_name TEXT,                        -- Optional: friendly name
  route_data JSON NOT NULL,               -- Full route configuration
  travel_mode TEXT DEFAULT 'walking',     -- walking, driving, bicycling
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  accessed_at DATETIME,                   -- Last access timestamp
  access_count INTEGER DEFAULT 0,         -- Track usage
  expires_at DATETIME,                    -- Optional: expiration (e.g., 30 days)
  is_public BOOLEAN DEFAULT 1             -- Public vs. private routes
);

CREATE INDEX idx_saved_routes_user ON saved_routes(user_id);
CREATE INDEX idx_saved_routes_created ON saved_routes(created_at);
CREATE INDEX idx_saved_routes_expires ON saved_routes(expires_at);
```

**Route Data JSON Structure:**
```json
{
  "version": "1.0",
  "routeId": "abc123xyz",
  "createdAt": "2026-02-15T10:30:00Z",
  "startLocation": {
    "lat": 36.5040,
    "lng": -89.1872,
    "address": null
  },
  "locations": [
    {
      "voterId": 123,
      "lat": 36.5042,
      "lng": -89.1875,
      "address": "123 Main St",
      "city": "Memphis",
      "firstName": "John",
      "lastName": "Doe",
      "sequence": 1
    }
  ],
  "travelMode": "walking",
  "algorithm": "hybrid",
  "metrics": {
    "totalDistanceMiles": 5.2,
    "totalDurationMinutes": 78,
    "stopCount": 25
  }
}
```

### 4. Offline JSON Format

**Goals:**
- Enable offline route access in progressive web apps (PWAs)
- Human-readable format for debugging
- Include all necessary data for route reconstruction
- Support import/export workflow

**Recommended Format:**
```json
{
  "exportVersion": "1.0",
  "exportedAt": "2026-02-15T10:30:00Z",
  "platform": "Voter Platform v1.0",
  "route": {
    "id": "abc123xyz",
    "name": "Downtown Canvass - Feb 15",
    "travelMode": "walking",
    "startLocation": {
      "lat": 36.5040,
      "lng": -89.1872,
      "label": "Campaign Office"
    },
    "stops": [
      {
        "sequence": 1,
        "voterId": 123,
        "lat": 36.5042,
        "lng": -89.1875,
        "address": "123 Main St",
        "city": "Memphis",
        "state": "TN",
        "zip": "38103",
        "firstName": "John",
        "lastName": "Doe",
        "notes": ""
      }
    ],
    "metrics": {
      "totalStops": 25,
      "totalDistanceMiles": 5.2,
      "totalDurationMinutes": 78,
      "estimatedCompletionTime": "2.5 hours"
    },
    "optimization": {
      "algorithm": "hybrid",
      "optimizationTimeMs": 450,
      "apiCallReduction": "94.2%"
    }
  },
  "exportOptions": {
    "includeVoterDetails": true,
    "includeMetrics": true,
    "format": "json"
  }
}
```

**File Naming Convention:**
```javascript
// Format: route_YYYYMMDD_HHMMSS.json
const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
const filename = `route_${timestamp}.json`;
// Example: route_20260215_103045.json
```

### 5. CSV Export Format

**Use Case:** Simple address list for manual entry into navigation apps or printout

**Format:**
```csv
Sequence,Voter ID,First Name,Last Name,Full Address,City,State,Zip,Latitude,Longitude,Phone,Notes
1,123,John,Doe,"123 Main St",Memphis,TN,38103,36.5042,-89.1875,(901) 555-0100,
2,456,Jane,Smith,"456 Oak Ave",Memphis,TN,38104,36.5045,-89.1877,(901) 555-0200,Super voter
...
```

**Implementation:**
```javascript
function generateRouteCSV(route) {
  const headers = ['Sequence', 'Voter ID', 'First Name', 'Last Name', 'Full Address', 
                   'City', 'State', 'Zip', 'Latitude', 'Longitude', 'Phone', 'Notes'];
  
  const rows = route.locations.map((loc, idx) => [
    idx + 1,
    loc.voterId,
    loc.firstName,
    loc.lastName,
    `"${loc.address}"`, // Quote to handle commas
    loc.city,
    loc.state || 'TN',
    loc.zip || '',
    loc.lat,
    loc.lng,
    loc.phone || '',
    loc.notes || ''
  ]);
  
  return [headers, ...rows]
    .map(row => row.join(','))
    .join('\n');
}
```

### 6. Print-Optimized HTML

**Goals:**
- Clean, printer-friendly layout
- Include turn-by-turn directions (if available from future enhancement)
- Show voter details and sequence
- Responsive to different paper sizes (Letter, A4)

**Layout Structure:**
```html
<!DOCTYPE html>
<html>
<head>
  <title>Route Sheet - [Date]</title>
  <style>
    @media print {
      @page { margin: 0.5in; }
      body { font-family: Arial, sans-serif; }
      .no-print { display: none; }
      .page-break { page-break-before: always; }
    }
  </style>
</head>
<body>
  <div class="route-header">
    <h1>Canvassing Route - [Date]</h1>
    <p>Travel Mode: Walking | Total Distance: 5.2 mi | Est. Duration: 1h 18m</p>
  </div>
  
  <div class="route-summary">
    <h2>Route Overview</h2>
    <p>Total Stops: 25</p>
    <p>Route Type: Optimized (Hybrid Algorithm)</p>
  </div>
  
  <div class="stop-list">
    <h2>Turn-by-Turn Stops</h2>
    <ol>
      <li>
        <strong>John Doe</strong> - 123 Main St, Memphis, TN 38103<br>
        <small>Voter ID: 123 | Phone: (901) 555-0100</small>
      </li>
      <!-- ... more stops ... -->
    </ol>
  </div>
  
  <div class="qr-code no-print">
    <!-- QR code for mobile access (future enhancement) -->
  </div>
</body>
</html>
```

**Print CSS Best Practices:**
```css
@media print {
  /* Remove backgrounds to save ink */
  * { background: white !important; color: black !important; }
  
  /* Ensure page breaks don't split items */
  li { page-break-inside: avoid; }
  
  /* Show URLs for links */
  a[href]:after { content: " (" attr(href) ")"; }
  
  /* Hide interactive elements */
  button, .no-print { display: none !important; }
}
```

---

## Technical Specification

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
├─────────────────────────────────────────────────────────────┤
│  Route Planner Controller                                   │
│  ├── Export Menu UI (dropdown/buttons)                      │
│  ├── URL Builders                                           │
│  │   ├── buildGoogleMapsUrl()                               │
│  │   ├── buildAppleMapsUrl()                                │
│  │   └── buildShareableUrl()                                │
│  ├── Export Functions                                       │
│  │   ├── exportToGoogleMaps()                               │
│  │   ├── exportToAppleMaps()                                │
│  │   ├── exportToCSV()                                      │
│  │   ├── exportToJSON()                                     │
│  │   ├── shareRoute()                                       │
│  │   └── printRoute()                                       │
│  └── Event Listeners                                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     BACKEND API                             │
├─────────────────────────────────────────────────────────────┤
│  Route Export Endpoints (/api/routes/)                      │
│  ├── POST /save          - Save route to database           │
│  ├── GET /:routeId       - Retrieve saved route             │
│  ├── PUT /:routeId       - Update saved route               │
│  ├── DELETE /:routeId    - Delete saved route               │
│  └── GET /:routeId/print - Generate print view              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                       DATABASE                              │
├─────────────────────────────────────────────────────────────┤
│  Table: saved_routes                                        │
│  ├── id (TEXT PRIMARY KEY)                                  │
│  ├── user_id (INTEGER, nullable)                            │
│  ├── route_name (TEXT, nullable)                            │
│  ├── route_data (JSON)                                      │
│  ├── travel_mode (TEXT)                                     │
│  ├── created_at (DATETIME)                                  │
│  ├── accessed_at (DATETIME)                                 │
│  ├── access_count (INTEGER)                                 │
│  ├── expires_at (DATETIME, nullable)                        │
│  └── is_public (BOOLEAN)                                    │
└─────────────────────────────────────────────────────────────┘
```

### Backend Implementation

#### 1. Database Migration

**File:** `backend/migrations/008_add_saved_routes_table.js`

```javascript
/**
 * Migration: Add saved_routes table for route sharing and persistence
 */

exports.up = function(db) {
  return db.run(`
    CREATE TABLE IF NOT EXISTS saved_routes (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      route_name TEXT,
      route_data JSON NOT NULL,
      travel_mode TEXT DEFAULT 'walking',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      accessed_at DATETIME,
      access_count INTEGER DEFAULT 0,
      expires_at DATETIME,
      is_public BOOLEAN DEFAULT 1,
      
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `).then(() => {
    return db.run(`CREATE INDEX idx_saved_routes_user ON saved_routes(user_id)`);
  }).then(() => {
    return db.run(`CREATE INDEX idx_saved_routes_created ON saved_routes(created_at)`);
  }).then(() => {
    return db.run(`CREATE INDEX idx_saved_routes_expires ON saved_routes(expires_at)`);
  });
};

exports.down = function(db) {
  return db.run(`DROP TABLE IF EXISTS saved_routes`);
};
```

#### 2. Saved Route Model

**File:** `backend/models/saved-route.js` (NEW)

```javascript
/**
 * Saved Route Model
 * Handles persistence and retrieval of shareable routes
 */

const Database = require('../config/database');
const crypto = require('crypto');

class SavedRouteModel {
  /**
   * Generate a unique route ID
   * @returns {string} URL-safe random ID
   */
  static generateRouteId() {
    return crypto.randomBytes(16).toString('base64url');
  }

  /**
   * Save a route to the database
   * @param {Object} routeData - Route configuration and locations
   * @param {Object} options - Optional metadata (userId, routeName, expiresIn)
   * @returns {Promise<string>} Route ID
   */
  async saveRoute(routeData, options = {}) {
    const db = await Database.getDb();
    const routeId = SavedRouteModel.generateRouteId();
    
    const {
      userId = null,
      routeName = null,
      travelMode = 'walking',
      expiresIn = null, // Milliseconds until expiration
      isPublic = true
    } = options;
    
    const expiresAt = expiresIn 
      ? new Date(Date.now() + expiresIn).toISOString() 
      : null;
    
    // Store route data as JSON string
    const routeDataJson = JSON.stringify({
      version: '1.0',
      ...routeData,
      savedAt: new Date().toISOString()
    });
    
    await db.run(
      `INSERT INTO saved_routes 
       (id, user_id, route_name, route_data, travel_mode, expires_at, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [routeId, userId, routeName, routeDataJson, travelMode, expiresAt, isPublic ? 1 : 0]
    );
    
    console.log(`✅ Route saved with ID: ${routeId}`);
    return routeId;
  }

  /**
   * Retrieve a saved route by ID
   * @param {string} routeId - Route identifier
   * @returns {Promise<Object|null>} Route data or null if not found/expired
   */
  async getRoute(routeId) {
    const db = await Database.getDb();
    
    const route = await db.get(
      `SELECT * FROM saved_routes WHERE id = ?`,
      [routeId]
    );
    
    if (!route) {
      return null;
    }
    
    // Check expiration
    if (route.expires_at) {
      const expiresAt = new Date(route.expires_at);
      if (expiresAt < new Date()) {
        console.log(`⚠️ Route ${routeId} has expired`);
        return null;
      }
    }
    
    // Update access tracking
    await this.trackAccess(routeId);
    
    // Parse JSON route data
    const routeData = JSON.parse(route.route_data);
    
    return {
      id: route.id,
      userId: route.user_id,
      routeName: route.route_name,
      travelMode: route.travel_mode,
      createdAt: route.created_at,
      accessedAt: route.accessed_at,
      accessCount: route.access_count,
      expiresAt: route.expires_at,
      isPublic: route.is_public === 1,
      routeData
    };
  }

  /**
   * Track route access (update accessed_at and increment access_count)
   * @param {string} routeId - Route identifier
   */
  async trackAccess(routeId) {
    const db = await Database.getDb();
    
    await db.run(
      `UPDATE saved_routes 
       SET accessed_at = CURRENT_TIMESTAMP, 
           access_count = access_count + 1
       WHERE id = ?`,
      [routeId]
    );
  }

  /**
   * Delete a saved route
   * @param {string} routeId - Route identifier
   * @param {number} userId - Optional: verify ownership before deletion
   * @returns {Promise<boolean>} Success status
   */
  async deleteRoute(routeId, userId = null) {
    const db = await Database.getDb();
    
    let query = 'DELETE FROM saved_routes WHERE id = ?';
    let params = [routeId];
    
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    
    const result = await db.run(query, params);
    
    return result.changes > 0;
  }

  /**
   * Clean up expired routes (run periodically)
   * @returns {Promise<number>} Number of deleted routes
   */
  async cleanupExpiredRoutes() {
    const db = await Database.getDb();
    
    const result = await db.run(
      `DELETE FROM saved_routes 
       WHERE expires_at IS NOT NULL 
       AND expires_at < CURRENT_TIMESTAMP`
    );
    
    console.log(`🗑️ Cleaned up ${result.changes} expired routes`);
    return result.changes;
  }

  /**
   * Get routes by user ID
   * @param {number} userId - User identifier
   * @param {number} limit - Maximum routes to return
   * @returns {Promise<Array>} List of routes
   */
  async getRoutesByUser(userId, limit = 50) {
    const db = await Database.getDb();
    
    const routes = await db.all(
      `SELECT id, route_name, travel_mode, created_at, accessed_at, access_count
       FROM saved_routes
       WHERE user_id = ?
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    
    return routes;
  }
}

module.exports = SavedRouteModel;
```

#### 3. Route Export API Endpoints

**File:** `backend/routes/routes.js` (UPDATE - Add new endpoints)

```javascript
// Add these imports at the top
const SavedRouteModel = require('../models/saved-route');

// ... existing endpoints ...

/**
 * POST /api/routes/save
 * Save a calculated route for sharing
 * 
 * Request body:
 * {
 *   routeData: { locations, metrics, startLocation, ... },
 *   options: { routeName, travelMode, expiresIn }
 * }
 */
router.post('/save', [
  body('routeData')
    .isObject()
    .withMessage('routeData is required'),
  body('routeData.locations')
    .isArray({ min: 1 })
    .withMessage('Route must have at least one location'),
  body('options')
    .optional()
    .isObject(),
  validate
], async (req, res) => {
  try {
    const { routeData, options = {} } = req.body;
    
    // Create saved route instance
    const savedRouteModel = new SavedRouteModel();
    
    // Default expiration: 30 days
    const expiresIn = options.expiresIn || (30 * 24 * 60 * 60 * 1000);
    
    const routeId = await savedRouteModel.saveRoute(routeData, {
      ...options,
      expiresIn
    });
    
    // Build shareable URL
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const shareableUrl = `${baseUrl}/routes/share/${routeId}`;
    
    res.json({
      success: true,
      routeId,
      shareableUrl,
      expiresAt: new Date(Date.now() + expiresIn).toISOString()
    });
    
  } catch (error) {
    console.error('Route save error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save route',
      message: error.message
    });
  }
});

/**
 * GET /api/routes/:routeId
 * Retrieve a saved route by ID
 */
router.get('/:routeId', async (req, res) => {
  try {
    const { routeId } = req.params;
    
    const savedRouteModel = new SavedRouteModel();
    const route = await savedRouteModel.getRoute(routeId);
    
    if (!route) {
      return res.status(404).json({
        success: false,
        error: 'Route not found or expired'
      });
    }
    
    res.json({
      success: true,
      route
    });
    
  } catch (error) {
    console.error('Route retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve route',
      message: error.message
    });
  }
});

/**
 * DELETE /api/routes/:routeId
 * Delete a saved route (optional authentication for ownership check)
 */
router.delete('/:routeId', async (req, res) => {
  try {
    const { routeId } = req.params;
    // Optional: get userId from authentication middleware
    // const userId = req.user?.id;
    
    const savedRouteModel = new SavedRouteModel();
    const deleted = await savedRouteModel.deleteRoute(routeId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Route not found or already deleted'
      });
    }
    
    res.json({
      success: true,
      message: 'Route deleted successfully'
    });
    
  } catch (error) {
    console.error('Route deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete route',
      message: error.message
    });
  }
});

/**
 * GET /api/routes/:routeId/print
 * Generate print-friendly HTML view of route
 */
router.get('/:routeId/print', async (req, res) => {
  try {
    const { routeId } = req.params;
    
    const savedRouteModel = new SavedRouteModel();
    const route = await savedRouteModel.getRoute(routeId);
    
    if (!route) {
      return res.status(404).send('<h1>Route not found or expired</h1>');
    }
    
    // Generate print-optimized HTML
    const html = generatePrintView(route);
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    console.error('Print view error:', error);
    res.status(500).send('<h1>Error generating print view</h1>');
  }
});

/**
 * Helper function to generate print-friendly HTML
 * @param {Object} route - Route data
 * @returns {string} HTML string
 */
function generatePrintView(route) {
  const { routeData, travelMode, routeName, createdAt } = route;
  const { locations, metrics, startLocation } = routeData;
  
  const date = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const stopsList = locations.map((loc, idx) => `
    <li class="stop-item">
      <div class="stop-number">${idx + 1}</div>
      <div class="stop-details">
        <strong>${loc.firstName} ${loc.lastName}</strong><br>
        ${loc.address}, ${loc.city || ''}<br>
        <small>Voter ID: ${loc.voterId} | Phone: ${loc.phone || 'N/A'}</small>
      </div>
    </li>
  `).join('');
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Route Sheet - ${routeName || date}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    
    .route-header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #333;
    }
    
    .route-header h1 {
      font-size: 24px;
      margin-bottom: 10px;
    }
    
    .route-summary {
      background: #f5f5f5;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 5px;
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 10px;
    }
    
    .summary-item {
      text-align: center;
    }
    
    .summary-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
    }
    
    .summary-value {
      font-size: 20px;
      font-weight: bold;
      color: #333;
    }
    
    .stop-list {
      list-style: none;
    }
    
    .stop-item {
      display: flex;
      gap: 15px;
      padding: 15px;
      margin-bottom: 10px;
      border: 1px solid #ddd;
      border-radius: 5px;
      page-break-inside: avoid;
    }
    
    .stop-number {
      background: #4285F4;
      color: white;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      flex-shrink: 0;
    }
    
    .stop-details {
      flex: 1;
    }
    
    .stop-details strong {
      font-size: 16px;
      color: #333;
    }
    
    .stop-details small {
      color: #666;
      font-size: 12px;
    }
    
    @media print {
      @page {
        margin: 0.5in;
      }
      
      body {
        padding: 0;
      }
      
      .no-print {
        display: none !important;
      }
      
      .route-summary {
        background: white;
        border: 1px solid #ddd;
      }
      
      .stop-item {
        page-break-inside: avoid;
      }
    }
    
    @media screen {
      .print-button {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: #4285F4;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      }
      
      .print-button:hover {
        background: #357AE8;
      }
    }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">🖨️ Print</button>
  
  <div class="route-header">
    <h1>${routeName || 'Canvassing Route'}</h1>
    <p>${date}</p>
  </div>
  
  <div class="route-summary">
    <h2 style="margin-bottom: 10px;">Route Overview</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <div class="summary-label">Total Stops</div>
        <div class="summary-value">${locations.length}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Distance</div>
        <div class="summary-value">${metrics?.totalDistanceMiles?.toFixed(1) || 'N/A'} mi</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Duration</div>
        <div class="summary-value">${Math.floor((metrics?.totalDurationMinutes || 0) / 60)}h ${(metrics?.totalDurationMinutes || 0) % 60}m</div>
      </div>
    </div>
    <p style="margin-top: 15px;"><strong>Travel Mode:</strong> ${travelMode.charAt(0).toUpperCase() + travelMode.slice(1)}</p>
  </div>
  
  <h2 style="margin-bottom: 15px;">Stop List</h2>
  <ul class="stop-list">
    ${stopsList}
  </ul>
  
  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px;">
    <p>Generated by Voter Platform | Route ID: ${route.id}</p>
  </div>
</body>
</html>
  `;
}

// Add cleanup task (optional - can be scheduled with cron or called periodically)
router.post('/cleanup-expired', async (req, res) => {
  try {
    const savedRouteModel = new SavedRouteModel();
    const deletedCount = await savedRouteModel.cleanupExpiredRoutes();
    
    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} expired routes`,
      deletedCount
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      message: error.message
    });
  }
});

module.exports = router;
```

### Frontend Implementation

#### 1. Route Planner Controller Additions

**File:** `frontend/public/js/route-planner-controller.js` (UPDATE)

```javascript
// Add these methods to the RoutePlannerController class

/**
 * Bind event listeners - UPDATE to include export buttons
 */
bindEventListeners() {
    const calculateBtn = document.getElementById('calculateRoute');
    const selectFromMapBtn = document.getElementById('selectFromMapVoters');
    const selectFromListBtn = document.getElementById('selectFromListVoters');
    const clearSelectionBtn = document.getElementById('clearRouteSelection');
    
    // NEW: Export button listeners
    const exportCSVBtn = document.getElementById('exportCSV');
    const exportGoogleMapsBtn = document.getElementById('exportGoogleMaps');
    
    if (calculateBtn) {
        calculateBtn.addEventListener('click', () => this.calculateRoute());
    }
    
    if (selectFromMapBtn) {
        selectFromMapBtn.addEventListener('click', () => this.toggleSelectionMode());
    }
    
    if (selectFromListBtn) {
        selectFromListBtn.addEventListener('click', () => this.openVoterSelectionModal());
    }
    
    if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', () => this.clearSelection());
    }
    
    // NEW: Bind export buttons
    if (exportCSVBtn) {
        exportCSVBtn.addEventListener('click', () => this.exportToCSV());
    }
    
    if (exportGoogleMapsBtn) {
        exportGoogleMapsBtn.addEventListener('click', () => this.openExportModal());
    }
}

/**
 * Open export modal with multiple format options
 * NEW METHOD
 */
openExportModal() {
    if (!this.currentRoute) {
        Utils.showToast('No route to export', 'warning');
        return;
    }
    
    // Create modal HTML
    const modalHtml = `
        <div class="modal fade" id="exportModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Export Route</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="text-sm text-secondary-600 mb-4">
                            Choose how you'd like to export your ${this.currentRoute.locations.length}-stop route
                        </p>
                        
                        <div class="space-y-3">
                            <button class="btn-primary w-full justify-start" onclick="routePlanner.exportToGoogleMaps()">
                                <i class="bi bi-google"></i>
                                <span>Open in Google Maps</span>
                            </button>
                            
                            <button class="btn-secondary w-full justify-start" onclick="routePlanner.exportToAppleMaps()">
                                <i class="bi bi-map"></i>
                                <span>Open in Apple Maps</span>
                            </button>
                            
                            <hr class="my-2">
                            
                            <button class="btn-secondary w-full justify-start" onclick="routePlanner.shareRoute()">
                                <i class="bi bi-link-45deg"></i>
                                <span>Copy Shareable Link</span>
                            </button>
                            
                            <button class="btn-secondary w-full justify-start" onclick="routePlanner.exportToJSON()">
                                <i class="bi bi-download"></i>
                                <span>Download JSON (Offline)</span>
                            </button>
                            
                            <button class="btn-secondary w-full justify-start" onclick="routePlanner.exportToCSV()">
                                <i class="bi bi-filetype-csv"></i>
                                <span>Download CSV (Address List)</span>
                            </button>
                            
                            <button class="btn-secondary w-full justify-start" onclick="routePlanner.printRoute()">
                                <i class="bi bi-printer"></i>
                                <span>Print Route Sheet</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Inject modal into DOM if not exists
    if (!document.getElementById('exportModal')) {
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    
    // Show modal using Bootstrap
    const modal = new bootstrap.Modal(document.getElementById('exportModal'));
    modal.show();
}

/**
 * Export route to Google Maps
 * NEW METHOD
 */
exportToGoogleMaps() {
    if (!this.currentRoute) return;
    
    const travelMode = document.getElementById('travelMode')?.value || 'walking';
    const locations = this.currentRoute.locations;
    
    // Check if route exceeds Google Maps waypoint limit
    if (locations.length > 9) {
        // Google Maps allows max 10 waypoints (including origin and destination)
        // For 10+ locations, we need to split into multiple routes or warn user
        const confirmed = confirm(
            `This route has ${locations.length} stops. Google Maps supports up to 9 waypoints.\n\n` +
            `Would you like to open the first 9 stops? You'll need to navigate remaining stops separately.`
        );
        
        if (!confirmed) return;
    }
    
    const url = this.buildGoogleMapsUrl(locations, travelMode);
    window.open(url, '_blank');
    
    Utils.showToast('Opening in Google Maps...', 'success');
    
    // Close modal if open
    const modal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modal) modal.hide();
}

/**
 * Build Google Maps URL with waypoints
 * NEW METHOD
 * 
 * @param {Array} locations - Route locations
 * @param {string} travelMode - walking, driving, or bicycling
 * @returns {string} Google Maps URL
 */
buildGoogleMapsUrl(locations, travelMode = 'walking') {
    // Limit to first 9 waypoints due to Google Maps restriction
    const maxWaypoints = Math.min(locations.length, 9);
    const limitedLocations = locations.slice(0, maxWaypoints);
    
    // Get start location from state or use first voter location
    const startLocation = this.stateManager.getState().routing?.startLocation || {
        lat: limitedLocations[0].lat,
        lng: limitedLocations[0].lng
    };
    
    // Build URL components
    const origin = `${startLocation.lat},${startLocation.lng}`;
    const destination = `${limitedLocations[limitedLocations.length - 1].lat},${limitedLocations[limitedLocations.length - 1].lng}`;
    
    // Waypoints (all locations except the last one, which is the destination)
    const waypoints = limitedLocations.slice(0, -1)
        .map(loc => `${loc.lat},${loc.lng}`)
        .join('|');
    
    // Map travel mode to Google Maps format
    const modeMap = {
        'walking': 'walking',
        'driving': 'driving',
        'bicycling': 'bicycling'
    };
    const googleMode = modeMap[travelMode] || 'walking';
    
    // Construct URL
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    
    if (waypoints) {
        url += `&waypoints=${waypoints}`;
    }
    
    url += `&travelmode=${googleMode}`;
    
    return url;
}

/**
 * Export route to Apple Maps
 * NEW METHOD
 */
exportToAppleMaps() {
    if (!this.currentRoute) return;
    
    const travelMode = document.getElementById('travelMode')?.value || 'walking';
    const locations = this.currentRoute.locations;
    
    const url = this.buildAppleMapsUrl(locations, travelMode);
    
    // Detect if on iOS/macOS
    const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    
    if (isAppleDevice) {
        window.location.href = url; // Use location.href on Apple devices
    } else {
        window.open(url, '_blank'); // Use window.open on other platforms
    }
    
    Utils.showToast('Opening in Apple Maps...', 'success');
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modal) modal.hide();
}

/**
 * Build Apple Maps URL with waypoints
 * NEW METHOD
 * 
 * @param {Array} locations - Route locations
 * @param {string} travelMode - walking, driving, or bicycling
 * @returns {string} Apple Maps URL
 */
buildAppleMapsUrl(locations, travelMode = 'walking') {
    // Get start location
    const startLocation = this.stateManager.getState().routing?.startLocation || {
        lat: locations[0].lat,
        lng: locations[0].lng
    };
    
    const origin = `${startLocation.lat},${startLocation.lng}`;
    
    // Build destination with waypoints using +to: syntax
    const destination = locations
        .map(loc => `${loc.lat},${loc.lng}`)
        .join('+to:');
    
    // Map travel mode to Apple Maps format
    const modeMap = {
        'walking': 'w',
        'driving': 'd',
        'bicycling': 'w' // Apple Maps doesn't have bicycling, use walking
    };
    const appleMode = modeMap[travelMode] || 'w';
    
    // Construct URL
    const url = `http://maps.apple.com/?saddr=${origin}&daddr=${destination}&dirflg=${appleMode}`;
    
    return url;
}

/**
 * Share route via shareable link
 * NEW METHOD
 */
async shareRoute() {
    if (!this.currentRoute) return;
    
    try {
        Utils.showToast('Saving route...', 'info');
        
        // Prepare route data
        const routeData = {
            startLocation: this.stateManager.getState().routing?.startLocation,
            locations: this.currentRoute.locations,
            metrics: this.currentRoute.metrics
        };
        
        const travelMode = document.getElementById('travelMode')?.value || 'walking';
        const routeName = prompt('Enter a name for this route (optional):') || null;
        
        // Save route via API
        const response = await fetch('/api/routes/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                routeData,
                options: {
                    travelMode,
                    routeName,
                    expiresIn: 30 * 24 * 60 * 60 * 1000 // 30 days
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to save route');
        }
        
        // Copy shareable URL to clipboard
        await navigator.clipboard.writeText(data.shareableUrl);
        
        Utils.showToast('✅ Shareable link copied to clipboard!', 'success');
        
        // Show link in modal (optional)
        alert(`Route saved!\n\nShareable link (copied to clipboard):\n${data.shareableUrl}\n\nExpires: ${new Date(data.expiresAt).toLocaleDateString()}`);
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Share route error:', error);
        Utils.showToast('Failed to create shareable link: ' + error.message, 'danger');
    }
}

/**
 * Export route to JSON file
 * NEW METHOD
 */
exportToJSON() {
    if (!this.currentRoute) return;
    
    const travelMode = document.getElementById('travelMode')?.value || 'walking';
    const algorithm = document.getElementById('algorithm')?.value || 'hybrid';
    
    // Build comprehensive JSON export
    const exportData = {
        exportVersion: '1.0',
        exportedAt: new Date().toISOString(),
        platform: 'Voter Platform v1.0',
        route: {
            name: prompt('Enter route name (optional):') || `Route ${new Date().toLocaleDateString()}`,
            travelMode,
            algorithm,
            startLocation: this.stateManager.getState().routing?.startLocation,
            stops: this.currentRoute.locations.map((loc, idx) => ({
                sequence: idx + 1,
                voterId: loc.voterId,
                lat: loc.lat,
                lng: loc.lng,
                address: loc.address,
                city: loc.city,
                state: loc.state || 'TN',
                zip: loc.zip || '',
                firstName: loc.firstName,
                lastName: loc.lastName,
                phone: loc.phone || '',
                notes: loc.notes || ''
            })),
            metrics: this.currentRoute.metrics
        }
    };
    
    // Convert to JSON string
    const jsonString = JSON.stringify(exportData, null, 2);
    
    // Create blob and download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Generate filename
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    const filename = `route_${timestamp}.json`;
    
    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    URL.revokeObjectURL(url);
    
    Utils.showToast('✅ JSON file downloaded', 'success');
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modal) modal.hide();
}

/**
 * Export route to CSV file
 * NEW METHOD
 */
exportToCSV() {
    if (!this.currentRoute) return;
    
    const locations = this.currentRoute.locations;
    
    // Build CSV content
    const headers = [
        'Sequence',
        'Voter ID',
        'First Name',
        'Last Name',
       'Full Address',
        'City',
        'State',
        'Zip',
        'Latitude',
        'Longitude',
        'Phone',
        'Notes'
    ];
    
    const rows = locations.map((loc, idx) => [
        idx + 1,
        loc.voterId,
        loc.firstName || '',
        loc.lastName || '',
        `"${loc.address || ''}"`, // Quote to handle commas in addresses
        loc.city || '',
        loc.state || 'TN',
        loc.zip || '',
        loc.lat,
        loc.lng,
        loc.phone || '',
        loc.notes || ''
    ]);
    
    const csvContent = [headers, ...rows]
        .map(row => row.join(','))
        .join('\n');
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `route_${timestamp}.csv`;
    
    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    URL.revokeObjectURL(url);
    
    Utils.showToast('✅ CSV file downloaded', 'success');
    
    // Close modal if open
    const modal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
    if (modal) modal.hide();
}

/**
 * Print route sheet
 * NEW METHOD
 */
async printRoute() {
    if (!this.currentRoute) return;
    
    try {
        // Option 1: Generate print view locally
        const printWindow = window.open('', '_blank');
        printWindow.document.write(this.generatePrintHTML());
        printWindow.document.close();
        
        // Wait for content to load, then trigger print dialog
        printWindow.onload = () => {
            printWindow.print();
        };
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('exportModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Print error:', error);
        Utils.showToast('Failed to generate print view: ' + error.message, 'danger');
    }
}

/**
 * Generate print-optimized HTML
 * NEW METHOD
 * 
 * @returns {string} HTML string
 */
generatePrintHTML() {
    const travelMode = document.getElementById('travelMode')?.value || 'walking';
    const locations = this.currentRoute.locations;
    const metrics = this.currentRoute.metrics;
    
    const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const stopsList = locations.map((loc, idx) => `
        <li class="stop-item">
            <div class="stop-number">${idx + 1}</div>
            <div class="stop-details">
                <strong>${loc.firstName} ${loc.lastName}</strong><br>
                ${loc.address}, ${loc.city || ''}<br>
                <small>Voter ID: ${loc.voterId} | Phone: ${loc.phone || 'N/A'}</small>
            </div>
        </li>
    `).join('');
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Route Sheet - ${date}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: 0 auto; }
        .route-header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #333; }
        .route-header h1 { font-size: 24px; margin-bottom: 10px; }
        .route-summary { background: #f5f5f5; padding: 15px; margin-bottom: 20px; border-radius: 5px; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 10px; }
        .summary-item { text-align: center; }
        .summary-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .summary-value { font-size: 20px; font-weight: bold; color: #333; }
        .stop-list { list-style: none; }
        .stop-item { display: flex; gap: 15px; padding: 15px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 5px; page-break-inside: avoid; }
        .stop-number { background: #4285F4; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0; }
        .stop-details { flex: 1; }
        .stop-details strong { font-size: 16px; color: #333; }
        .stop-details small { color: #666; font-size: 12px; }
        @media print {
            @page { margin: 0.5in; }
            body { padding: 0; }
            .route-summary { background: white; border: 1px solid #ddd; }
            .stop-item { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    <div class="route-header">
        <h1>Canvassing Route</h1>
        <p>${date}</p>
    </div>
    
    <div class="route-summary">
        <h2 style="margin-bottom: 10px;">Route Overview</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <div class="summary-label">Total Stops</div>
                <div class="summary-value">${locations.length}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Distance</div>
                <div class="summary-value">${metrics?.totalDistanceMiles?.toFixed(1) || 'N/A'} mi</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Duration</div>
                <div class="summary-value">${Math.floor((metrics?.totalDurationMinutes || 0) / 60)}h ${(metrics?.totalDurationMinutes || 0) % 60}m</div>
            </div>
        </div>
        <p style="margin-top: 15px;"><strong>Travel Mode:</strong> ${travelMode.charAt(0).toUpperCase() + travelMode.slice(1)}</p>
    </div>
    
    <h2 style="margin-bottom: 15px;">Stop List</h2>
    <ul class="stop-list">
        ${stopsList}
    </ul>
    
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px;">
        <p>Generated by Voter Platform</p>
    </div>
</body>
</html>
    `;
}

// Add helper method for HTML escaping (security)
escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
```

#### 2. Frontend UI Updates

**File:** `frontend/public/index.html` (UPDATE export section)

Replace the existing export options section (lines 419-432) with:

```html
<!-- Export Options -->
<div id="routeExportOptions" class="mt-3 space-y-2">
    <p class="text-xs font-medium text-secondary-500 dark:text-secondary-400 uppercase tracking-wider">Export Route</p>
    <div class="grid grid-cols-2 gap-2">
        <button class="btn-secondary btn-sm justify-center" id="exportCSV" title="Download CSV address list">
            <i class="bi bi-filetype-csv"></i>
            <span>CSV</span>
        </button>
        <button class="btn-success btn-sm justify-center" id="exportGoogleMaps" title="Export to navigation apps">
            <i class="bi bi-share"></i>
            <span>Export</span>
        </button>
    </div>
    <p class="text-xs text-secondary-500 dark:text-secondary-400 flex items-start gap-1">
        <i class="bi bi-info-circle flex-shrink-0 mt-0.5"></i>
        <span>Export to Google Maps, Apple Maps, or save for offline use</span>
    </p>
</div>
```

---

## Error Handling & Validation

### Frontend Validation

```javascript
// Before exporting, validate route exists
if (!this.currentRoute || !this.currentRoute.locations || this.currentRoute.locations.length === 0) {
    Utils.showToast('No route to export. Please calculate a route first.', 'warning');
    return;
}

// Validate clipboard API support for shareable links
if (!navigator.clipboard) {
    // Fallback: show copyable text input instead
    const input = document.createElement('input');
    input.value = shareableUrl;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
}

// Validate route size for Google Maps
if (locations.length > 9) {
    const proceed = confirm(
        `This route has ${locations.length} stops. Due to Google Maps limits (max 9 waypoints), ` +
        `only the first 9 stops will be included.\n\nContinue?`
    );
    if (!proceed) return;
}
```

### Backend Validation

```javascript
// Validate route data structure before saving
function validateRouteData(routeData) {
    if (!routeData || typeof routeData !== 'object') {
        throw new Error('Invalid route data: must be an object');
    }
    
    if (!Array.isArray(routeData.locations) || routeData.locations.length === 0) {
        throw new Error('Invalid route data: locations array required');
    }
    
    // Validate each location has required properties
    for (const loc of routeData.locations) {
        if (!loc.lat || !loc.lng) {
            throw new Error('Invalid location: missing lat/lng coordinates');
        }
        
        if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
            throw new Error('Invalid location: lat/lng must be numbers');
        }
        
        if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) {
            throw new Error('Invalid location: lat/lng out of range');
        }
    }
    
    return true;
}
```

### Rate Limiting

```javascript
// Middleware for route save endpoint (prevent abuse)
const rateLimit = require('express-rate-limit');

const saveRouteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Max 20 route saves per 15 minutes
    message: 'Too many route saves. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

router.post('/save', saveRouteLimiter, [/* ... validation ... */], async (req, res) => {
    // ... handler ...
});
```

---

## Testing Approach

### Unit Tests

**File:** `tests/unit/route-export.test.js` (NEW)

```javascript
const assert = require('assert');
const SavedRouteModel = require('../../backend/models/saved-route');

describe('Route Export - Unit Tests', () => {
    describe('SavedRouteModel', () => {
        it('should generate unique route IDs', () => {
            const id1 = SavedRouteModel.generateRouteId();
            const id2 = SavedRouteModel.generateRouteId();
            
            assert.ok(id1);
            assert.ok(id2);
            assert.notStrictEqual(id1, id2);
            assert.strictEqual(typeof id1, 'string');
            assert.ok(id1.length >= 16); // At least 16 characters
        });
        
        it('should validate route data structure', () => {
            const validRoute = {
                locations: [
                    { lat: 36.5, lng: -89.2, voterId: 123 }
                ]
            };
            
            assert.doesNotThrow(() => validateRouteData(validRoute));
        });
        
        it('should reject invalid route data', () => {
            const invalidRoutes = [
                null,
                {},
                { locations: [] },
                { locations: [{ lat: 'invalid', lng: -89.2 }] },
                { locations: [{ lat: 91, lng: -89.2 }] } // Lat out of range
            ];
            
            invalidRoutes.forEach(route => {
                assert.throws(() => validateRouteData(route));
            });
        });
    });
    
    describe('URL Builders (Frontend)', () => {
        it('should build valid Google Maps URL', () => {
            const locations = [
                { lat: 36.5040, lng: -89.1872 },
                { lat: 36.5042, lng: -89.1875 }
            ];
            
            const url = buildGoogleMapsUrl(locations, 'walking');
            
            assert.ok(url.includes('https://www.google.com/maps/dir/'));
            assert.ok(url.includes('travelmode=walking'));
            assert.ok(url.includes('36.5040,-89.1872'));
        });
        
        it('should limit Google Maps waypoints to 9', () => {
            const locations = Array.from({ length: 15 }, (_, i) => ({
                lat: 36.5 + i * 0.001,
                lng: -89.2 + i * 0.001
            }));
            
            const url = buildGoogleMapsUrl(locations, 'walking');
            
            // Count waypoints in URL (should be max 9)
            const waypointCount = (url.match(/waypoints=[^&]+/)[0].match(/\|/g) || []).length + 1;
            assert.ok(waypointCount <= 9);
        });
    });
});
```

### Integration Tests

**File:** `tests/integration/route-export.test.js` (NEW)

```javascript
const request = require('supertest');
const app = require('../../backend/server');
const Database = require('../../backend/config/database');

describe('Route Export - Integration Tests', () => {
    before(async () => {
        // Initialize test database
        await Database.getDb();
    });
    
    describe('POST /api/routes/save', () => {
        it('should save a valid route and return shareable URL', async () => {
            const routeData = {
                locations: [
                    { lat: 36.5040, lng: -89.1872, voterId: 1, address: '123 Main St' },
                    { lat: 36.5042, lng: -89.1875, voterId: 2, address: '456 Oak Ave' }
                ],
                metrics: {
                    totalDistanceMiles: 0.5,
                    totalDurationMinutes: 10
                }
            };
            
            const res = await request(app)
                .post('/api/routes/save')
                .send({ routeData })
                .expect(200);
            
            assert.strictEqual(res.body.success, true);
            assert.ok(res.body.routeId);
            assert.ok(res.body.shareableUrl);
            assert.ok(res.body.shareableUrl.includes(res.body.routeId));
        });
        
        it('should reject invalid route data', async () => {
            const invalidData = {
                locations: [] // Empty locations
            };
            
            const res = await request(app)
                .post('/api/routes/save')
                .send({ routeData: invalidData })
                .expect(400);
            
            assert.strictEqual(res.body.success, false);
        });
    });
    
    describe('GET /api/routes/:routeId', () => {
        let savedRouteId;
        
        before(async () => {
            // Save a route for testing
            const routeData = {
                locations: [{ lat: 36.5, lng: -89.2, voterId: 1 }],
                metrics: {}
            };
            
            const res = await request(app)
                .post('/api/routes/save')
                .send({ routeData });
            
            savedRouteId = res.body.routeId;
        });
        
        it('should retrieve a saved route by ID', async () => {
            const res = await request(app)
                .get(`/api/routes/${savedRouteId}`)
                .expect(200);
            
            assert.strictEqual(res.body.success, true);
            assert.ok(res.body.route);
            assert.strictEqual(res.body.route.id, savedRouteId);
        });
        
        it('should return 404 for non-existent route', async () => {
            const res = await request(app)
                .get('/api/routes/invalid-route-id-12345')
                .expect(404);
            
            assert.strictEqual(res.body.success, false);
        });
    });
});
```

### Manual Testing Checklist

- [ ] **Google Maps Export**
  - [ ] Works with 5-stop route
  - [ ] Works with 9-stop route (max waypoints)
  - [ ] Shows warning for 10+ stop routes
  - [ ] Opens in new tab
  - [ ] Correct travel mode applied

- [ ] **Apple Maps Export**
  - [ ] Works on iOS devices
  - [ ] Works on macOS devices
  - [ ] Falls back gracefully on non-Apple platforms
  - [ ] Multiple waypoints preserved

- [ ] **Shareable URL**
  - [ ] Route saves successfully
  - [ ] Shareable URL copied to clipboard
  - [ ] Accessing shareable URL loads route correctly
  - [ ] Route expires after 30 days
  - [ ] Access count increments

- [ ] **CSV Export**
  - [ ] File downloads with correct filename
  - [ ] All voter details included
  - [ ] Proper CSV formatting (quoted addresses)
  - [ ] Opens correctly in Excel/Google Sheets

- [ ] **JSON Export**
  - [ ] File downloads with timestamp filename
  - [ ] Valid JSON structure
  - [ ] All route data preserved
  - [ ] Can be re-imported (future feature)

- [ ] **Print View**
  - [ ] Opens in new window
  - [ ] Print-optimized layout
  - [ ] All stops visible
  - [ ] Page breaks work correctly
  - [ ] Metrics displayed accurately

---

## Dependencies

### Backend

**New npm packages:**
- None required (uses built-in Node.js crypto module)

**Optional (future enhancements):**
- `puppeteer` - For server-side PDF generation (not required for MVP)
- `qrcode` - For QR code generation in print views
-`express-rate-limit` - For rate limiting route saves (recommended)

### Frontend

**Existing dependencies:**
- Bootstrap 5 (for modal UI)
- Bootstrap Icons (for UI icons)

**No additional packages required.**

---

## Implementation Steps

### Phase 1: Backend Foundation (4-6 hours)

1. **Create database migration** (1 hour)
   - Create `backend/migrations/008_add_saved_routes_table.js`
   - Test migration up/down
   - Run migration on development database

2. **Implement SavedRouteModel** (2-3 hours)
   - Create `backend/models/saved-route.js`
   - Implement save, retrieve, delete methods
   - Add route ID generation
   - Add expiration logic
   - Write unit tests

3. **Add API endpoints** (2-3 hours)
   - Update `backend/routes/routes.js`
   - Add POST /api/routes/save
   - Add GET /api/routes/:routeId
   - Add DELETE /api/routes/:routeId
   - Add GET /api/routes/:routeId/print
   - Add validation middleware
   - Test with Postman/curl

### Phase 2: Frontend Export Functions (6-8 hours)

4. **Implement URL builders** (2 hours)
   - Add `buildGoogleMapsUrl()` method
   - Add `buildAppleMapsUrl()` method
   - Test with various route sizes
   - Handle edge cases (empty routes, 10+ waypoints)

5. **Implement export methods** (3-4 hours)
   - Add `exportToGoogleMaps()`
   - Add `exportToAppleMaps()`
   - Add `exportToCSV()`
   - Add `exportToJSON()`
   - Add `shareRoute()`
   - Add `printRoute()`
   - Bind event listeners

6. **Create export modal UI** (1-2 hours)
   - Add `openExportModal()` method
   - Design modal layout with all export options
   - Test modal interactions
   - Add tooltips and help text

### Phase 3: Testing & Refinement (4-6 hours)

7. **Write tests** (2-3 hours)
   - Create unit tests for URL builders
   - Create integration tests for API endpoints
   - Test route validation logic
   - Test expiration/cleanup

8. **Manual testing** (1-2 hours)
   - Test all export formats on desktop
   - Test Google Maps/Apple Maps on mobile
   - Test print view on various browsers
   - Test shareable URLs

9. **Bug fixes and polish** (1 hour)
   - Fix any issues found during testing
   - Add error messages and user feedback
   - Optimize performance

### Phase 4: Documentation (1-2 hours)

10. **Update documentation**
    - Add API endpoint documentation
    - Update README with export features
    - Create user guide for export functionality
    - Document known limitations

---

## Estimated Effort Breakdown

| Task | Estimated Time |
|------|----------------|
| **Backend Implementation** | 4-6 hours |
| - Database migration | 1 hour |
| - SavedRouteModel | 2-3 hours |
| - API endpoints | 2-3 hours |
| **Frontend Implementation** | 6-8 hours |
| - URL builders | 2 hours |
| - Export methods | 3-4 hours |
| - Export modal UI | 1-2 hours |
| **Testing** | 4-6 hours |
| - Unit/integration tests | 2-3 hours |
| - Manual testing | 1-2 hours |
| - Bug fixes | 1 hour |
| **Documentation** | 1-2 hours |
| **TOTAL** | **15-22 hours** |

**Sprint Estimate:** 2-3 days (assuming 8-hour workdays)

---

## Known Limitations & Future Enhancements

### Current Limitations

1. **Google Maps Waypoint Limit:**
   - Maximum 9 waypoints per URL
   - Routes with 10+ stops require manual splitting
   - **Mitigation:** Warn user and export first 9 stops

2. **Apple Maps Platform Support:**
   - Limited documentation for Apple Maps URL scheme
   - Bicycling mode not officially supported
   - **Mitigation:** Fall back to walking mode for bicycling

3. **No Server-Side PDF Generation:**
   - Print view uses client-side print dialog
   - No downloadable PDF file
   - **Mitigation:** Plan PDF generation for future phase

4. **No Authentication/Authorization:**
   - Saved routes are accessible via URL alone
   - No owner verification
   - **Mitigation:** Add authentication in future phase

5. **No Route Import:**
   - JSON export is one-way (no import feature)
   - Cannot load previously exported routes
   - **Mitigation:** Implement import in future phase

### Future Enhancements

1. **Turn-by-Turn Directions Export:**
   - Requires Improvement #1 implementation
   - Include detailed directions in print view
   - Add street names and maneuver instructions

2. **QR Codes for Mobile Access:**
   - Add QR code to print view
   - Scan QR code to open route on mobile device
   - Requires QR code library (`qrcode` npm package)

3. **PDF Generation:**
   - Server-side PDF rendering with Puppeteer
   - Downloadable PDF files
   - Custom branding/headers

4. **Route Templates:**
   - Save commonly used routes as templates
   - Quick-load templates for recurring canvassing areas

5. **Multi-Route Splitting:**
   - Automatic splitting of large routes into Google Maps-compatible segments
   - Generate multiple URLs for 10+ stop routes

6. **PWA Offline Support:**
   - Service worker for offline route access
   - Cache routes in IndexedDB
   - Sync with server when online

---

## Success Criteria

### Functional Requirements

- ✅ Users can export routes to Google Maps (max 9 waypoints)
- ✅ Users can export routes to Apple Maps (all waypoints)
- ✅ Users can generate shareable URLs for routes
- ✅ Users can download CSV address lists
- ✅ Users can download JSON route files for offline use
- ✅ Users can print route sheets
- ✅ Routes are persisted in database with 30-day expiration
- ✅ Shareable URLs are accessible without authentication

### Non-Functional Requirements

- ✅ Export operations complete within 2 seconds
- ✅ Shareable URLs are cryptographically secure (16+ character IDs)
- ✅ Database migration completes without errors
- ✅ All export formats maintain data accuracy (no data loss)
- ✅ Print view is optimized for paper (Letter/A4 sizes)
- ✅ Code coverage: >80% for new backend code

### User Experience

- ✅ Export menu is intuitive and discoverable
- ✅ Clear feedback for all export operations
- ✅ Graceful error handling with user-friendly messages
- ✅ Mobile detection for platform-specific navigation apps
- ✅ Consistent UI patterns with existing features

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Google Maps waypoint limit causes user confusion** | High | Medium | Clear warning dialog + limit first 9 stops |
| **Apple Maps URL scheme inconsistencies** | Medium | Low | Test on multiple iOS/macOS versions |
| **Shareable URL enumeration attacks** | Low | Medium | Use cryptographically secure IDs (16+ chars) |
| **Database storage growth** | Low | Low | Implement 30-day expiration + cleanup task |
| **Browser compatibility for clipboard API** | Low | Low | Fallback to manual copy/paste |
| **Print CSS rendering issues** | Medium | Low | Test on major browsers (Chrome, Firefox, Safari) |

---

## Conclusion

This specification provides a comprehensive blueprint for implementing Route Export & Mobile Integration features in the Voter Platform. The feature addresses the critical gap between desktop route planning and mobile field execution, enabling seamless workflow transitions with multiple export formats.

**Key Deliverables:**
- 6 export formats (Google Maps, Apple Maps, shareable URL, CSV, JSON, print)
- Backend route persistence with database storage
- Secure shareable URLs with expiration
- Print-optimized route sheets
- Comprehensive error handling and validation

**Implementation Timeline:** 15-22 hours (2-3 sprint days)

**Next Steps:**
1. Review and approve specification
2. Create implementation tickets
3. Begin Phase 1: Backend foundation
4. Iterate through phases with testing at each step

---

**Document Status:** ✅ Implementation Ready  
**Prepared By:** GitHub Copilot (Claude Sonnet 4.5)  
**Review Required:** Development Team Lead  
**Estimated Completion:** 2-3 sprint days after approval
