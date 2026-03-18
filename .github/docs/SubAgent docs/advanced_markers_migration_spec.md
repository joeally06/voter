# Google Maps AdvancedMarkerElement Migration Specification

**Date:** March 10, 2026  
**Status:** Research Complete - Ready for Implementation  
**Priority:** High (Deprecation Warning Active)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [API Comparison](#api-comparison)
4. [Migration Strategy](#migration-strategy)
5. [PinElement Styling Approach](#pinelement-styling-approach)
6. [MarkerClusterer Compatibility](#markerclusterer-compatibility)
7. [Implementation Plan](#implementation-plan)
8. [Risk Assessment](#risk-assessment)
9. [Testing Strategy](#testing-strategy)
10. [Rollback Plan](#rollback-plan)

---

## Executive Summary

### Issue
Google Maps JavaScript API v3.56+ (February 21, 2024) deprecated `google.maps.Marker` and recommends migrating to `google.maps.marker.AdvancedMarkerElement`. The application currently shows deprecation warnings in the browser console.

### Impact
- **17 instances** of `google.maps.Marker` usage across codebase
- Primary files affected: `mapUtils.js`, `MapTab.js`, `RoutePlannerTab.js`
- Legacy files (`MapView.js`, `MapView.old.js`) also contain deprecated usage

### Solution
Phased migration to AdvancedMarkerElement with backward-compatible wrapper approach and PinElement-based styling to match current visual appearance.

---

## Current State Analysis

### Files Using google.maps.Marker

#### Primary Implementation (Active)
1. **frontend/src/pages/MapView/utils/mapUtils.js**
   - Line 43: `createVoterMarker()` - Creates markers for individual voters
   - Line 67: `createRouteMarker()` - Creates numbered markers for route stops
   - Line 98: `createStartMarker()` - Creates arrow marker for route start location
   - Line 176: `clusterIcon()` - References `google.maps.Marker.MAX_ZINDEX`
   - Lines 182-192: Helper functions expecting `google.maps.Marker[]` types

2. **frontend/src/pages/MapView/tabs/MapTab.js**
   - Line 315: Cluster renderer creating markers dynamically
   - Line 353: `marker.setIcon()` - Dynamic icon updates for selection state
   - Line 354: `marker.setZIndex()` - Dynamic z-index updates

3. **frontend/src/pages/MapView/tabs/RoutePlannerTab.js**
   - Uses `createStartMarker()` from mapUtils.js (indirect usage)

#### Legacy Files (May be deprecated, but present in workspace)
4. **frontend/src/pages/MapView.js** (3 instances)
5. **frontend/src/pages/MapView.old.js** (3 instances)

### Current Marker Types and Styling

#### 1. Voter Markers (Normal State)
```javascript
{
  path: google.maps.SymbolPath.CIRCLE,
  scale: 7,
  fillColor: isSuperVoter ? '#16a34a' : '#6366f1', // green or indigo
  fillOpacity: 0.8,
  strokeColor: '#fff',
  strokeWeight: 1.5,
}
```
- **Super voters**: Green circles (#16a34a)
- **Regular voters**: Indigo circles (#6366f1)

#### 2. Voter Markers (Selected State)
```javascript
{
  path: google.maps.SymbolPath.CIRCLE,
  scale: 10,
  fillColor: '#f59e0b',  // amber
  fillOpacity: 1.0,
  strokeColor: '#d97706',
  strokeWeight: 3,
}
```
- Larger amber circles (#f59e0b) with darker border
- Used when voter is added to route

#### 3. Route Stop Markers
```javascript
{
  position: pos,
  label: { text: String(index + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
  icon: {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 14,
    fillColor: '#3b82f6',  // blue
    fillOpacity: 1.0,
    strokeColor: '#1d4ed8',
    strokeWeight: 2,
  },
  zIndex: 1000 + index,
  title: `Stop ${index + 1}: ${location.firstName} ${location.lastName}`,
}
```
- Numbered blue circles with sequential labels

#### 4. Start Location Marker
```javascript
{
  icon: {
    path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
    scale: 8,
    fillColor: '#22c55e',  // green
    fillOpacity: 1.0,
    strokeColor: '#fff',
    strokeWeight: 2,
  },
  title: 'Start Location',
  zIndex: 2000,
}
```
- Green arrow pointing backward

#### 5. Cluster Markers (Dynamic)
```javascript
{
  label: { text: String(count), color: '#ffffff', fontSize: '12px', fontWeight: 'bold' },
  icon: {
    path: google.maps.SymbolPath.CIRCLE,
    scale: Math.min(count / 3 + 15, 50),  // dynamic scaling
    fillColor: color,  // red/amber/blue/green based on count
    fillOpacity: 0.9,
    strokeColor: '#ffffff',
    strokeWeight: 2
  },
  zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count
}
```
- Color-coded by cluster size: red (>100), amber (>50), blue (>10), green (≤10)
- Dynamic size scaling based on count

### Current Map Configuration

```javascript
map = new google.maps.Map(canvas, {
  center: config.mapCenter,
  zoom: config.mapZoom,
  mapTypeControl: true,
  streetViewControl: false,
  styles: darkMode ? darkMapStyle : [],
});
```

**Critical Finding:** No `mapId` is currently configured, which is **required** for AdvancedMarkerElement.

### MarkerClusterer Version

- **Library:** `@googlemaps/markerclusterer` v2.6.2
- **Algorithm:** `GridAlgorithm` with `maxZoom: 15`
- **Custom Renderer:** Yes, uses custom cluster icon generation

---

## API Comparison

### Loading Libraries

#### Before (Current)
```javascript
export function loadGoogleMapsScript(apiKey) {
  // ...
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
  // ...
}
```

#### After (Required)
```javascript
export function loadGoogleMapsScript(apiKey) {
  // ...
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker,geometry`;
  // ...
}

// Alternative: Dynamic import (preferred for future-proofing)
const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");
```

### Map Initialization

#### Before
```javascript
map = new google.maps.Map(canvas, {
  center: { lat: 36.2639, lng: -89.1929 },
  zoom: 11,
});
```

#### After
```javascript
map = new google.maps.Map(canvas, {
  center: { lat: 36.2639, lng: -89.1929 },
  zoom: 11,
  mapId: 'VOTER_PLATFORM_MAP_ID',  // REQUIRED for AdvancedMarkerElement
});
```

**Map ID Requirements:**
- Can use `'DEMO_MAP_ID'` for testing
- Production requires creating a Map ID in Google Cloud Console
- Map ID links to a specific Map Style (can use default or custom)

### Basic Marker Creation

#### Before
```javascript
const marker = new google.maps.Marker({
  map: map,
  position: { lat: 37.4, lng: -122.0 },
  title: 'Location',
  icon: {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: '#6366f1',
    fillOpacity: 0.8,
    strokeColor: '#fff',
    strokeWeight: 1.5,
  },
});
```

#### After
```javascript
const pin = new google.maps.marker.PinElement({
  background: '#6366f1',
  borderColor: '#fff',
  scale: 1.0,        // Approximate equivalent
  glyphColor: 'transparent',  // To hide default glyph
});

const marker = new google.maps.marker.AdvancedMarkerElement({
  map: map,
  position: { lat: 37.4, lng: -122.0 },
  title: 'Location',
  content: pin.element,
});
```

### Key API Differences

| Feature | google.maps.Marker | google.maps.marker.AdvancedMarkerElement |
|---------|-------------------|------------------------------------------|
| **Namespace** | `google.maps.Marker` | `google.maps.marker.AdvancedMarkerElement` |
| **Library Required** | None (built-in) | `marker` library |
| **Map ID Required** | No | **Yes** (critical) |
| **Icon Property** | `icon` (object or URL) | `content` (DOM element or PinElement) |
| **Custom Styling** | Icon object with SVG path | PinElement properties or HTML element |
| **Event Listeners** | `marker.addListener('click', fn)` | Same API |
| **Position** | `marker.setPosition(latLng)` | `marker.position = latLng` (property assignment) |
| **Map Assignment** | `marker.setMap(map)` | `marker.map = map` (property assignment) |
| **Visibility** | `marker.setVisible(bool)` | Not available; use `marker.map = null` instead |
| **Z-Index** | `marker.setZIndex(n)` | `marker.zIndex = n` (property assignment) |
| **Title** | `marker.setTitle(str)` | `marker.title = str` (property assignment) |
| **Draggable** | `marker.setDraggable(bool)` | Not available in base class |
| **Animation** | `marker.setAnimation(anim)` | Not directly supported |
| **Custom Properties** | Can attach directly: `marker._voterId = id` | Same capability |

### Methods No Longer Available

- `setIcon()` → Replace with updating `content` property
- `setVisible()` → Use `marker.map = null` or `marker.map = mapInstance`
- `setDraggable()` → Not supported in base AdvancedMarkerElement

### Property Access Changes

```javascript
// Before
marker.setPosition(newPos);
marker.setZIndex(100);
marker.setMap(null);

// After
marker.position = newPos;
marker.zIndex = 100;
marker.map = null;
```

---

## Migration Strategy

### Approach: Backward-Compatible Wrapper Pattern

Create a unified marker creation API that returns markers compatible with existing code patterns.

### Phase 1: Infrastructure Setup
1. Add Map ID to configuration
2. Load marker library
3. Create PinElement utility functions
4. Build MarkerWrapper class

### Phase 2: Utility Function Migration
1. Update `mapUtils.js` functions to use AdvancedMarkerElement
2. Maintain existing function signatures for compatibility
3. Replace icon objects with PinElement instances

### Phase 3: Cluster Renderer Update
1. Update cluster renderer in `MapTab.js`
2. Ensure MarkerClusterer compatibility

### Phase 4: Legacy Code Cleanup
1. Remove or update deprecated `MapView.js` and `MapView.old.js`
2. Update TypeScript types (if applicable)

### Phase 5: Testing & Validation
1. Visual regression testing (marker appearance)
2. Interaction testing (click, selection, info windows)
3. Performance testing (clustering with large datasets)

---

## PinElement Styling Approach

### PinElement API

```javascript
const pin = new google.maps.marker.PinElement({
  background: '#6366f1',     // Background color
  borderColor: '#fff',       // Border color
  glyphColor: 'white',       // Icon/text color
  scale: 1.0,                // Size multiplier (default 1.0)
  glyph: 'A',                // Text or URL
  glyphText: '1',            // Alternative to glyph for text
});
```

### Mapping Current Styles to PinElement

#### 1. Voter Marker (Normal)

**Current Icon:**
```javascript
{
  path: google.maps.SymbolPath.CIRCLE,
  scale: 7,
  fillColor: '#6366f1',     // indigo for regular, #16a34a for super
  fillOpacity: 0.8,
  strokeColor: '#fff',
  strokeWeight: 1.5,
}
```

**PinElement Equivalent:**
```javascript
new google.maps.marker.PinElement({
  background: isSuperVoter ? '#16a34a' : '#6366f1',
  borderColor: '#fff',
  scale: 0.7,  // Approximate visual match (default pin is larger than scale 7 circle)
  glyphColor: 'transparent',  // Hide default glyph
  glyph: '',   // Empty to hide glyph entirely
});
```

**Note:** PinElement uses a teardrop shape by default, not a circle. To achieve exact visual parity:

**Option A: Use Custom HTML with Circle SVG**
```javascript
const circle = document.createElement('div');
circle.innerHTML = `
  <svg width="18" height="18" viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="7" fill="${color}" stroke="#fff" stroke-width="1.5" opacity="0.8"/>
  </svg>
`;

new google.maps.marker.AdvancedMarkerElement({
  content: circle,
  // ...
});
```

**Option B: Accept PinElement Teardrop Shape (Recommended)**
- Modern, consistent appearance
- Better visibility on map
- Easier to maintain
- Google-recommended styling

**Recommendation:** Use **Option B** (PinElement with teardrop) for cleaner implementation, unless exact visual match is critical for user training/brand consistency.

#### 2. Selected Voter Marker

**Current:**
```javascript
{
  scale: 10,
  fillColor: '#f59e0b',
  strokeColor: '#d97706',
  strokeWeight: 3,
}
```

**PinElement Equivalent:**
```javascript
new google.maps.marker.PinElement({
  background: '#f59e0b',
  borderColor: '#d97706',
  scale: 1.0,
  glyphColor: 'white',
  glyph: '✓',  // Optional checkmark to indicate selection
});
```

#### 3. Route Stop Marker (with Number Label)

**Current:**
```javascript
{
  label: { text: String(index + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
  icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#3b82f6', ... },
}
```

**PinElement Equivalent:**
```javascript
new google.maps.marker.PinElement({
  background: '#3b82f6',
  borderColor: '#1d4ed8',
  scale: 1.0,
  glyphColor: 'white',
  glyphText: String(index + 1),  // Number displayed in pin
});
```

#### 4. Start Location Marker (Arrow)

**Current:**
```javascript
{
  path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
  scale: 8,
  fillColor: '#22c55e',
}
```

**PinElement Alternative:**
```javascript
// Option A: Use emoji glyph
new google.maps.marker.PinElement({
  background: '#22c55e',
  borderColor: '#fff',
  scale: 1.0,
  glyphColor: 'white',
  glyph: '▶',  // Right arrow
});

// Option B: Use custom HTML with arrow SVG (more control)
const arrowDiv = document.createElement('div');
arrowDiv.innerHTML = `
  <svg width="24" height="24" viewBox="0 0 24 24">
    <path d="M12 4l-8 8h16z" fill="#22c55e" stroke="#fff" stroke-width="2"/>
  </svg>
`;
new google.maps.marker.AdvancedMarkerElement({ content: arrowDiv, ... });
```

**Recommendation:** Use **Option A** (emoji glyph) for simplicity.

#### 5. Cluster Markers

**Current:**
```javascript
{
  label: { text: String(count), color: '#ffffff', ... },
  icon: { 
    path: google.maps.SymbolPath.CIRCLE, 
    scale: Math.min(count / 3 + 15, 50),
    fillColor: color,  // dynamic based on count
  }
}
```

**PinElement Equivalent:**
```javascript
const scale = Math.min(count / 20 + 0.5, 2.0);  // Adjusted for PinElement sizing

new google.maps.marker.PinElement({
  background: getClusterColor(count),  // red/amber/blue/green
  borderColor: '#ffffff',
  scale: scale,
  glyphColor: 'white',
  glyphText: String(count),
});
```

### Helper Function: getClusterColor()

```javascript
function getClusterColor(count) {
  if (count > 100) return '#ef4444';   // red
  if (count > 50) return '#f59e0b';    // amber
  if (count > 10) return '#3b82f6';    // blue
  return '#10b981';                     // green
}
```

---

## MarkerClusterer Compatibility

### Current Implementation

```javascript
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { GridAlgorithm } from '@googlemaps/markerclusterer';

this.clusterer = new MarkerClusterer({
  map: this.state.map.instance,
  markers,
  algorithm: new GridAlgorithm({ maxZoom: 15 }),
  renderer: {
    render: ({ count, position }, stats) => {
      // Custom renderer returning google.maps.Marker
      return new google.maps.Marker({ ... });
    }
  }
});
```

### Updated Implementation

**Good News:** `@googlemaps/markerclusterer` v2.0+ fully supports AdvancedMarkerElement!

Official example from Google:
```typescript
const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");

const markers = locations.map((position, i) => {
  const pinGlyph = new PinElement({ glyph: labels[i], glyphColor: "white" });
  return new AdvancedMarkerElement({ position, content: pinGlyph.element });
});

new MarkerClusterer({ markers, map });
```

### Custom Cluster Renderer Update

```javascript
renderer: {
  render: ({ count, position }, stats) => {
    const scale = Math.min(count / 20 + 0.5, 2.0);
    const color = getClusterColor(count);
    
    const pin = new google.maps.marker.PinElement({
      background: color,
      borderColor: '#ffffff',
      scale: scale,
      glyphColor: 'white',
      glyphText: String(count),
    });
    
    return new google.maps.marker.AdvancedMarkerElement({
      position,
      content: pin.element,
      zIndex: 100000 + count,
    });
  }
}
```

**Key Changes:**
1. Return `AdvancedMarkerElement` instead of `Marker`
2. Use `PinElement` for cluster styling
3. Replace `google.maps.Marker.MAX_ZINDEX` constant with fixed high value (e.g., 100000)

---

## Implementation Plan

### Step 1: Configuration Updates

**File:** `backend/config/api-keys.js` or environment configuration

**Add:**
```javascript
// For development/testing
GOOGLE_MAPS_MAP_ID: 'DEMO_MAP_ID'

// For production (after creating in Google Cloud Console)
GOOGLE_MAPS_MAP_ID: process.env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'
```

**File:** `frontend/src/pages/MapView/utils/mapUtils.js`

**Update `loadGoogleMapsScript()`:**
```javascript
export function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker,geometry`;  // Added 'marker'
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}
```

### Step 2: Create Helper Functions

**File:** `frontend/src/pages/MapView/utils/mapUtils.js`

**Add new functions:**

```javascript
/**
 * Create a PinElement for voter markers
 * @param {boolean} isSuperVoter - Whether voter is a super voter
 * @param {boolean} isSelected - Whether voter is selected for route
 * @returns {google.maps.marker.PinElement}
 */
function createVoterPin(isSuperVoter, isSelected) {
  if (isSelected) {
    return new google.maps.marker.PinElement({
      background: '#f59e0b',
      borderColor: '#d97706',
      scale: 1.0,
      glyphColor: 'white',
      glyph: '',  // Hide glyph or use '✓' for checkmark
    });
  }
  
  return new google.maps.marker.PinElement({
    background: isSuperVoter ? '#16a34a' : '#6366f1',
    borderColor: '#fff',
    scale: 0.7,
    glyphColor: 'transparent',
    glyph: '',
  });
}

/**
 * Create a PinElement for route stop markers
 * @param {number} index - Stop number (0-based)
 * @returns {google.maps.marker.PinElement}
 */
function createRouteStopPin(index) {
  return new google.maps.marker.PinElement({
    background: '#3b82f6',
    borderColor: '#1d4ed8',
    scale: 1.0,
    glyphColor: 'white',
    glyphText: String(index + 1),
  });
}

/**
 * Create a PinElement for start location marker
 * @returns {google.maps.marker.PinElement}
 */
function createStartLocationPin() {
  return new google.maps.marker.PinElement({
    background: '#22c55e',
    borderColor: '#fff',
    scale: 1.0,
    glyphColor: 'white',
    glyph: '▶',
  });
}

/**
 * Create a PinElement for cluster markers
 * @param {number} count - Number of markers in cluster
 * @returns {google.maps.marker.PinElement}
 */
function createClusterPin(count) {
  const scale = Math.min(count / 20 + 0.5, 2.0);
  const color = count > 100 ? '#ef4444' :
                count > 50 ? '#f59e0b' :
                count > 10 ? '#3b82f6' : '#10b981';
  
  return new google.maps.marker.PinElement({
    background: color,
    borderColor: '#ffffff',
    scale: scale,
    glyphColor: 'white',
    glyphText: String(count),
  });
}
```

### Step 3: Update Marker Creation Functions

**File:** `frontend/src/pages/MapView/utils/mapUtils.js`

**Update `createVoterMarker()`:**

```javascript
/**
 * Create a marker for a voter
 * @param {Object} voter - Voter data
 * @param {Object} state - MapState instance
 * @param {Function} onClick - Click handler
 * @returns {google.maps.marker.AdvancedMarkerElement}
 */
export function createVoterMarker(voter, state, onClick) {
  const isSelected = state.routing.selectedVoterIds.has(voter.id);
  const pin = createVoterPin(voter.superVoter, isSelected);
  
  const marker = new google.maps.marker.AdvancedMarkerElement({
    position: { lat: parseFloat(voter.latitude), lng: parseFloat(voter.longitude) },
    content: pin.element,
    title: `${voter.firstName} ${voter.lastName}`,
    zIndex: isSelected ? 1000 : 1,
  });
  
  marker._voterId = voter.id;
  marker._voterData = voter;
  marker._pinElement = pin;  // Store for later updates
  marker.addListener('click', () => onClick(voter));
  
  return marker;
}
```

**Update `createRouteMarker()`:**

```javascript
/**
 * Create a route stop marker
 * @param {Object} location - Stop location data
 * @param {number} index - Stop number (0-based)
 * @param {google.maps.Map} map - Map instance
 * @returns {google.maps.marker.AdvancedMarkerElement}
 */
export function createRouteMarker(location, index, map) {
  const pos = { lat: parseFloat(location.lat), lng: parseFloat(location.lng) };
  const pin = createRouteStopPin(index);
  
  const marker = new google.maps.marker.AdvancedMarkerElement({
    position: pos,
    map,
    content: pin.element,
    zIndex: 1000 + index,
    title: `Stop ${index + 1}: ${location.firstName || ''} ${location.lastName || ''}`,
  });
  
  return marker;
}
```

**Update `createStartMarker()`:**

```javascript
/**
 * Create a start location marker
 * @param {Object} location - Start location {lat, lng}
 * @param {google.maps.Map} map - Map instance
 * @returns {google.maps.marker.AdvancedMarkerElement}
 */
export function createStartMarker(location, map) {
  const pin = createStartLocationPin();
  
  return new google.maps.marker.AdvancedMarkerElement({
    position: location,
    map,
    content: pin.element,
    title: 'Start Location',
    zIndex: 2000,
  });
}
```

**Remove deprecated icon functions (no longer needed):**
- `voterMarkerIcon()`
- `selectedMarkerIcon()`
- `clusterIcon()`

**Update `clearMarkers()`:**

```javascript
/**
 * Clear all markers from map
 * @param {google.maps.marker.AdvancedMarkerElement[]} markers - Array of markers to clear
 */
export function clearMarkers(markers) {
  if (!Array.isArray(markers)) return;
  markers.forEach(m => m.map = null);  // Changed from m.setMap(null)
}
```

### Step 4: Update Dynamic Marker Styling

**File:** `frontend/src/pages/MapView/tabs/MapTab.js`

**Update `updateMarkerStyles()`:**

```javascript
/**
 * Update marker visual styles based on selection state
 * Re-renders cluster to reflect changes
 */
updateMarkerStyles() {
  const markers = this.state.map.markers;
  if (!markers) return;

  markers.forEach(marker => {
    const v = marker._voterData;
    if (!v) return;

    const isSelected = this.state.routing.selectedVoterIds.has(v.id);
    
    // Create new pin with updated styling
    const newPin = createVoterPin(v.superVoter, isSelected);
    marker.content = newPin.element;  // Update content (replaces setIcon)
    marker.zIndex = isSelected ? 1000 : 1;  // Property assignment (replaces setZIndex)
    marker._pinElement = newPin;  // Update stored reference
  });

  // Re-cluster to update visuals
  if (this.clusterer) {
    this.clusterer.render();
  }
}
```

**Note:** Need to import `createVoterPin` helper function at the top of the file.

### Step 5: Update Cluster Renderer

**File:** `frontend/src/pages/MapView/tabs/MapTab.js`

**Update `updateMarkers()`:**

```javascript
updateMarkers(markers) {
  // Clear existing clusterer
  if (this.clusterer) {
    this.clusterer.clearMarkers();
    this.clusterer = null;
  }

  // Create new clusterer with AdvancedMarkerElement
  this.clusterer = new MarkerClusterer({
    map: this.state.map.instance,
    markers,
    algorithm: new GridAlgorithm({ maxZoom: 15 }),
    renderer: {
      render: ({ count, position }, stats) => {
        const pin = createClusterPin(count);  // Use new helper
        
        return new google.maps.marker.AdvancedMarkerElement({
          position,
          content: pin.element,
          zIndex: 100000 + count,  // Replaced MAX_ZINDEX constant
        });
      }
    }
  });

  this.state.setMarkers(markers);
}
```

**Import required:**
```javascript
import { createVoterPin, createClusterPin } from '../utils/mapUtils.js';
```

### Step 6: Update Map Initialization

**File:** `frontend/src/pages/MapView/tabs/MapTab.js`

**Update `initializeMap()`:**

```javascript
async initializeMap() {
  const config = this.state.config;
  const canvas = this.container.querySelector('#map-canvas');
  if (!canvas) return;

  try {
    const mapInstance = new google.maps.Map(canvas, {
      center: config.mapCenter,
      zoom: config.mapZoom,
      mapTypeControl: true,
      streetViewControl: false,
      styles: this.state.ui.darkMode ? darkMapStyle : [],
      mapId: config.mapId || 'DEMO_MAP_ID',  // REQUIRED for AdvancedMarkerElement
    });

    this.state.setMap(mapInstance);

    // Initialize info window
    const infoWindow = new google.maps.InfoWindow();
    this.state.setInfoWindow(infoWindow);

    // Track map load for quota
    try {
      await trackMapLoad();
    } catch (e) {
      console.warn('Failed to track map load:', e.message);
    }
  } catch (err) {
    canvas.innerHTML = `
      <div class="text-center text-red-500 p-4">
        <p class="font-medium">Failed to load map</p>
        <p class="text-sm mt-1">${escapeHtml(err.message)}</p>
      </div>`;
  }
}
```

### Step 7: Update Type Annotations (if using TypeScript/JSDoc)

**File:** `frontend/src/pages/MapView/utils/mapUtils.js`

**Update JSDoc comments:**

```javascript
/**
 * @param {google.maps.marker.AdvancedMarkerElement[]} markers - Array of markers
 */

/**
 * @returns {google.maps.marker.AdvancedMarkerElement}
 */
```

### Step 8: Legacy File Cleanup

**Decision Required:** Determine if `MapView.js` and `MapView.old.js` are still in use.

**Option A:** If files are deprecated
- Delete `frontend/src/pages/MapView.js`
- Delete `frontend/src/pages/MapView.old.js`

**Option B:** If files are still referenced
- Apply same migration steps as above
- Consider consolidating into single implementation

**Recommended Action:** Check git history and import statements to verify usage, then remove if deprecated.

---

## Risk Assessment

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Map ID not configured** | AdvancedMarkerElement won't render | Use `'DEMO_MAP_ID'` for testing; create production Map ID early |
| **Visual appearance changes** | Users confused by new marker style | Provide side-by-side comparison; consider soft launch |
| **Breaking changes in clusterer** | Markers not displaying in clusters | Thoroughly test clustering before deployment |
| **Dynamic marker updates fail** | Selection state not visually updating | Test all interaction patterns (add/remove from route) |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Performance regression** | Slower rendering with large datasets | Benchmark before/after; optimize if needed |
| **Browser compatibility** | Issues on older browsers | Test on target browser versions; consider polyfills |
| **Library version conflicts** | MarkerClusterer incompatibility | Verify `@googlemaps/markerclusterer` v2.6.2 supports AdvancedMarkerElement |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Info window positioning** | Windows appear in wrong location | Verify anchor point behavior on new markers |
| **Dark mode styling** | Pin colors don't match dark theme | Test dark mode thoroughly; adjust colors if needed |

---

## Testing Strategy

### Unit Tests

1. **Marker creation functions**
   - Test `createVoterMarker()` returns AdvancedMarkerElement
   - Test `createRouteMarker()` with various indices
   - Test `createStartMarker()` with different positions
   - Test pin creation with different states (selected/unselected, super/regular)

2. **Helper functions**
   - Test `clearMarkers()` with AdvancedMarkerElement array
   - Test `fitBoundsToMarkers()` compatibility

### Integration Tests

1. **Map initialization**
   - Verify map loads with required mapId
   - Verify marker library is loaded
   - Test with DEMO_MAP_ID and production Map ID

2. **Marker interactions**
   - Click on voter marker triggers info window
   - Add voter to route updates marker appearance
   - Remove voter from route reverts marker appearance
   - Hover shows correct title text

3. **Clustering behavior**
   - Markers cluster correctly at various zoom levels
   - Custom cluster renderer displays count
   - Cluster colors match expected thresholds
   - Clicking cluster zooms correctly

4. **Route planning**
   - Start marker displays correctly
   - Route stop markers show sequential numbers
   - Route polyline renders properly
   - Clearing route removes all markers

### Visual Regression Testing

**Critical Comparison Points:**
1. Voter markers (normal state) - before/after screenshots
2. Selected voter markers - before/after screenshots
3. Cluster markers at various sizes - before/after screenshots
4. Route markers with numbers - before/after screenshots
5. Start location marker - before/after screenshots

**Recommended Tool:** Percy, Chromatic, or manual screenshot comparison

### Performance Testing

**Metrics to track:**
1. Initial map load time (with marker library)
2. Time to render 500 markers
3. Time to cluster 500 markers
4. Time to update marker styles (selection change)
5. Memory usage comparison

**Acceptance Criteria:**
- No more than 10% degradation in any metric
- Marker rendering completes within 2 seconds for 500 markers

### Browser Compatibility Testing

**Target Browsers:**
- Chrome 120+
- Firefox 120+
- Safari 17+
- Edge 120+

**Test on each:**
- Map loads with markers
- Clustering works correctly
- Marker interactions function
- No console errors

---

## Rollback Plan

### Preparation

1. **Create feature flag**
   ```javascript
   const USE_ADVANCED_MARKERS = config.useAdvancedMarkers ?? false;
   ```

2. **Maintain both code paths initially**
   ```javascript
   export function createVoterMarker(voter, state, onClick, useAdvanced = USE_ADVANCED_MARKERS) {
     if (useAdvanced) {
       // AdvancedMarkerElement code
     } else {
       // Legacy google.maps.Marker code
     }
   }
   ```

### Rollback Trigger Conditions

Initiate rollback if any of the following occur in production:

1. **Critical failure:** Markers not rendering at all
2. **Performance:** >20% degradation in load time
3. **User impact:** >5% increase in error reports
4. **Browser issues:** Compatibility problems on target browsers

### Rollback Steps

1. **Immediate (< 5 minutes)**
   - Set feature flag: `config.useAdvancedMarkers = false`
   - Deploy updated configuration
   - Clear CDN cache if applicable

2. **Short-term (< 1 hour)**
   - If feature flag insufficient, revert to previous git commit
   - Deploy previous stable version
   - Verify all marker functionality restored

3. **Post-rollback investigation**
   - Collect error logs and user reports
   - Identify root cause
   - Fix issues in development environment
   - Re-test thoroughly before re-deployment

### Monitoring After Deployment

**Key Metrics (first 48 hours):**
- JavaScript errors related to markers (should be 0)
- Map load success rate (should be >99%)
- User complaints about map visualization (should be <1%)
- Performance metrics (should be within ±10% of baseline)

**Alert thresholds:**
- Error rate > 1% → Investigate immediately
- Error rate > 5% → Consider rollback
- Complete failure to load markers → Immediate rollback

---

## Post-Migration Tasks

### 1. Create Production Map ID

**Steps:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/studio/maps)
2. Create a new Map ID for the Voter Platform
3. Associate with a map style (default or custom)
4. Update `config.mapId` with production Map ID

### 2. Update Documentation

**Files to update:**
- `README.md` - Note Map ID requirement
- `docs/SETUP.md` - Add Map ID configuration instructions
- API documentation - Update marker-related methods

### 3. Remove Deprecated Code

**After successful migration (1-2 weeks post-launch):**
- Remove legacy `google.maps.Marker` code paths
- Remove feature flag
- Clean up unused icon generation functions
- Delete `MapView.old.js` if deprecated

### 4. Performance Optimization (if needed)

**If performance issues arise:**
- Implement marker virtualization for large datasets
- Use marker clustering more aggressively (lower maxZoom)
- Consider lazy-loading markers outside viewport

### 5. Enhance with AdvancedMarkerElement Features

**Future improvements possible with new API:**
- HTML-based custom markers (e.g., profile photos)
- Collision behavior control
- Altitude/3D positioning (if 3D maps enabled)
- Enhanced accessibility features

---

## Resources

### Official Documentation

1. **Migration Guide**  
   https://developers.google.com/maps/documentation/javascript/advanced-markers/migration

2. **AdvancedMarkerElement Reference**  
   https://developers.google.com/maps/documentation/javascript/reference/advanced-markers#AdvancedMarkerElement

3. **PinElement Reference**  
   https://developers.google.com/maps/documentation/javascript/reference/advanced-markers#PinElement

4. **Basic Customization**  
   https://developers.google.com/maps/documentation/javascript/advanced-markers/basic-customization

5. **Marker Clustering Guide**  
   https://developers.google.com/maps/documentation/javascript/marker-clustering

6. **MarkerClusterer GitHub**  
   https://github.com/googlemaps/js-markerclusterer

### Code Examples

1. **Official Advanced Markers Sample**  
   https://developers.google.com/maps/documentation/javascript/examples/advanced-markers-basic

2. **Clustering with Advanced Markers**  
   https://developers.google.com/maps/documentation/javascript/examples/marker-clustering

3. **Custom PinElement Styling**  
   https://developers.google.com/maps/documentation/javascript/examples/advanced-markers-basic-style

---

## Success Criteria

### Migration is considered successful when:

✅ All markers render correctly using AdvancedMarkerElement  
✅ No deprecation warnings in browser console  
✅ Visual appearance matches current design (or approved new design)  
✅ All marker interactions function correctly (click, selection, info windows)  
✅ Clustering works with custom renderer  
✅ Performance metrics are within acceptable range (±10% of baseline)  
✅ No increase in user-reported issues  
✅ All target browsers supported  
✅ Legacy code removed (after stabilization period)  
✅ Documentation updated

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| **Phase 1: Infrastructure Setup** | 2 hours | Map ID configuration, library loading |
| **Phase 2: Utility Function Migration** | 4 hours | Helper functions, marker creation |
| **Phase 3: Cluster Renderer Update** | 3 hours | Phase 2 complete |
| **Phase 4: Legacy Code Cleanup** | 2 hours | Decision on legacy file usage |
| **Phase 5: Testing & Validation** | 8 hours | All phases complete |
| **Phase 6: Deployment** | 1 hour | Testing complete, rollback plan ready |
| **Phase 7: Monitoring & Stabilization** | 48 hours | Deployment complete |

**Total Estimated Effort:** 20 hours (excluding monitoring period)

---

## Approval & Sign-off

**Prepared by:** GitHub Copilot (Research Agent)  
**Date:** March 10, 2026  
**Status:** Awaiting Implementation Approval  

**Requires approval from:**
- [ ] Technical Lead (architecture review)
- [ ] Product Owner (visual changes approval)
- [ ] QA Lead (testing strategy approval)

---

**End of Specification Document**
