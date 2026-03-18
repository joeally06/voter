# Google Routes API Migration Specification

**Date:** March 10, 2026  
**Project:** Voter Outreach & Mapping Platform  
**Migration:** Distance Matrix API (Legacy) → Routes API Compute Route Matrix  
**Status:** Research & Planning Phase

---

## Executive Summary

This specification documents the migration from Google's legacy Distance Matrix API to the new Routes API (Compute Route Matrix). The Distance Matrix API is marked as "Legacy" and Google recommends migrating to the Routes API for improved features, better performance, and future-proof architecture.

**Key Benefits of Migration:**
- ✅ **Modern API design** with gRPC streaming support
- ✅ **Enhanced features**: Traffic-aware routing, two-wheel routing, toll calculations
- ✅ **Better error handling** with per-element status codes
- ✅ **Field masking** for optimized response sizes and reduced costs
- ✅ **Future-proof** - active development and new features
- ⚠️ **Breaking changes** require code modifications

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Research Sources](#research-sources)
3. [API Comparison: Distance Matrix vs Routes API](#api-comparison)
4. [Architecture Changes Required](#architecture-changes-required)
5. [Implementation Plan](#implementation-plan)
6. [Dependencies & Requirements](#dependencies--requirements)
7. [Risk Assessment & Mitigations](#risk-assessment--mitigations)
8. [Testing Strategy](#testing-strategy)
9. [Rollback Plan](#rollback-plan)

---

## Current State Analysis

### Files Using Distance Matrix API

| File | Purpose | API Calls | Key Methods |
|------|---------|-----------|-------------|
| `backend/services/distance-matrix-service.js` | Core API wrapper with caching | Direct | `getDistance()`, `getDistances()`, `getDistanceMatrix()`, `makeDistanceMatrixRequest()` |
| `backend/services/route-optimizer-service.js` | TSP solver using distance data | Indirect | `optimizeRoute()`, `nearestNeighborRoute()`, `twoOptImprovement()` |
| `backend/services/route-cache-service.js` | Route caching (symmetric) | N/A | `getCachedRoute()`, `setCachedRoute()` |
| `backend/routes/routes.js` | Route planning endpoints | Indirect | `POST /api/routes/calculate`, `POST /api/routes/distance-matrix` |
| `backend/config/api-keys.js` | API key management | N/A | `distanceMatrixApiKey` |

### Current Implementation Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Client Request                            │
│              POST /api/routes/calculate                         │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              route-optimizer-service.js                         │
│  - optimizeRoute()                                              │
│  - nearestNeighborRoute()                                       │
│  - twoOptImprovement()                                          │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│            distance-matrix-service.js                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ SparseDistanceMatrix (Progressive Mode)                  │   │
│  │ - Lazy-loads distances on demand                         │   │
│  │ - Reduces API calls by 94-96%                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                             ↓                                   │
│  buildDistanceMatrix() → getDistance()/getDistances()           │
│                             ↓                                   │
│  makeDistanceMatrixRequest()                                    │
│  ├─ Check route-cache-service (symmetric cache)                │
│  ├─ Check quota-manager                                         │
│  └─ Call: this.client.distancematrix() ← LEGACY API           │
│                             ↓                                   │
│     @googlemaps/google-maps-services-js v3.4.2                 │
│     Client.distancematrix() method                             │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         Google Distance Matrix API (Legacy)                     │
│  GET https://maps.googleapis.com/maps/api/distancematrix/json  │
│  - Query params: origins, destinations, mode, key              │
│  - Response: rows[] with elements[]                            │
└─────────────────────────────────────────────────────────────────┘
```

### Current API Usage Patterns

#### 1. Single Distance Request
```javascript
// backend/services/distance-matrix-service.js:202-276
const apiData = await this.makeDistanceMatrixRequest([origin], [destination], mode);
const element = apiData.rows[0]?.elements[0];

if (element && element.status === 'OK') {
  return {
    distance: element.distance.value,      // meters
    duration: element.duration.value,      // seconds
    durationInTraffic: element.duration_in_traffic?.value,
    status: element.status,
    source: 'api'
  };
}
```

#### 2. Batch Distance Request (1-to-N)
```javascript
// backend/services/distance-matrix-service.js:278-399
const apiData = await this.makeDistanceMatrixRequest([origin], uncachedDests, mode);

for (let i = 0; i < uncachedIndices.length; i++) {
  const element = apiData.rows[0]?.elements[i];
  // Process each destination
}
```

#### 3. Full Distance Matrix (N×N)
```javascript
// backend/services/distance-matrix-service.js:401-557
const apiData = await this.makeDistanceMatrixRequest(batchOrigins, batchDests, mode);

for (let i = 0; i < batch.length; i++) {
  const element = apiData.rows[i]?.elements[0];
  results[originIdx][destIdx] = {
    distance: element.distance.value,
    duration: element.duration.value,
    // ...
  };
}
```

#### 4. Progressive/Sparse Matrix (Lazy Loading)
```javascript
// SparseDistanceMatrix class (lines 24-157)
async get(i, j) {
  // Check if already loaded
  const key = `${i},${j}`;
  if (this.data.has(key)) {
    return this.data.get(key);
  }
  
  // Lazy load single distance
  const distance = await this.service.getDistance(
    this.locations[i],
    this.locations[j],
    this.mode
  );
  
  // Store both directions (symmetric)
  this.data.set(key, distance);
  this.data.set(`${j},${i}`, distance);
  
  return distance;
}
```

### Current API Parameters

```javascript
// backend/services/distance-matrix-service.js:559-598
await this.client.distancematrix({
  params: {
    origins: ['36.5040,-89.1872'],        // lat,lng string array
    destinations: ['36.5100,-89.1900'],   // lat,lng string array
    mode: 'driving',                      // driving|walking|bicycling|transit
    units: 'metric',                      // metric|imperial
    key: this.apiKey                      // API key
  },
  timeout: 10000
})
```

### Current Response Structure

```javascript
{
  status: 'OK',
  rows: [
    {
      elements: [
        {
          status: 'OK',
          distance: { value: 822, text: '0.8 km' },
          duration: { value: 160, text: '3 mins' },
          duration_in_traffic: { value: 180, text: '3 mins' }  // Optional
        }
      ]
    }
  ]
}
```

### Current Caching Strategy

**Route Cache Service** (`backend/services/route-cache-service.js`):
- **Symmetric caching**: A→B cached as B→A automatically via canonical hash
- **Hash algorithm**: MD5 of sorted coordinates + mode
- **TTL**: 30 days (configurable via `ROUTE_CACHE_TTL_DAYS`)
- **Storage**: SQLite `route_cache` table with columns:
  - `route_hash` (PRIMARY KEY)
  - `origin_lat`, `origin_lng`, `destination_lat`, `destination_lng`
  - `travel_mode`, `distance_meters`, `duration_seconds`
  - `duration_in_traffic_seconds`, `api_status`
  - `cached_at`, `expires_at`

**Cache effectiveness:**
- 94-96% reduction in API calls via progressive routing
- Symmetric caching doubles cache hit rate
- Combined with SparseDistanceMatrix for optimal efficiency

### Current Rate Limiting & Quota

**Rate Limiting** (Bottleneck):
```javascript
this.limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 100,                    // 100ms between requests
  reservoir: 10,                   // 10 requests per second
  reservoirRefreshAmount: 10,
  reservoirRefreshInterval: 1000
});
```

**Quota Management** (`backend/services/quota-manager.js`):
- Tracks daily API usage per service (`distance_matrix`)
- Database table: `api_quota_usage`
- Methods:
  - `checkQuota(service, count)` - Verify quota before calls
  - `incrementApiCall(service, count)` - Track usage
  - `incrementCacheHit/Miss(service, count)` - Track cache stats

---

## Research Sources

### 1. **Official Google Routes API Documentation**
   - **URL:** https://developers.google.com/maps/documentation/routes
   - **Key Findings:**
     - Routes API includes two methods: Compute Routes and Compute Route Matrix
     - Compute Route Matrix replaces Distance Matrix API
     - Supports up to 625 route elements (origins × destinations)
     - gRPC streaming for faster results (not available in REST)
     - Field masking required for cost optimization

### 2. **Compute Route Matrix Overview**
   - **URL:** https://developers.google.com/maps/documentation/routes/compute-route-matrix-over
   - **Key Findings:**
     - Origin/destination limits: 50 by address/place ID
     - Element limits: 625 (non-transit), 100 (transit/traffic-aware-optimal)
     - Server-side streaming returns results as available (gRPC only)
     - Better use case for dispatch scheduling and warehouse optimization

### 3. **Compute Route Matrix API Reference**
   - **URL:** https://developers.google.com/maps/documentation/routes/compute_route_matrix
   - **Key Findings:**
     - REST endpoint: `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`
     - Requires `X-Goog-Api-Key` header (not query param)
     - Requires `X-Goog-FieldMask` header for field selection
     - Response includes `originIndex` and `destinationIndex` for mapping
     - Element-level error handling (not just response-level)

### 4. **Distance Matrix API (Legacy)**
   - **URL:** https://developers.google.com/maps/documentation/distance-matrix
   - **Key Findings:**
     - Marked as "Legacy" - migration recommended
     - Uses query parameters (different from Routes API)
     - Single response format (not streaming)
     - Limited to 25×25 matrix per request

### 5. **Routes API Usage and Billing**
   - **URL:** https://developers.google.com/maps/documentation/routes/usage-and-billing
   - **Key Findings:**
     - Three SKU tiers: Essentials, Pro, Enterprise
     - Essentials: Basic features, max 10 waypoints
     - Pro: Advanced features (traffic-aware, traffic-aware-optimal)
     - Enterprise: Two-wheel routing, enterprise features
     - Rate limits: 3,000 EPM (elements per minute)
     - Pricing varies by tier and region

### 6. **Node.js Client Library (@googlemaps/google-maps-services-js)**
   - **URL:** https://github.com/googlemaps/google-maps-services-js
   - **Key Findings:**
     - Current library (v3.4.2) supports Distance Matrix API (Legacy)
     - **Does NOT support Routes API natively**
     - Routes API requires separate library: `@googlemaps/routing`
     - Migration requires direct HTTP/gRPC calls or new client library
     - Alternative: Use `axios` for REST API calls to Routes API

### 7. **Official Routes API Client Libraries**
   - **URL:** https://developers.google.com/maps/documentation/routes/client-libraries
   - **Key Findings:**
     - Separate client libraries for Routes API:
       - Java: `google-cloud-java/java-maps-routing`
       - Go: `google-cloud-go/maps/routing`
       - Python: `google-maps-routing`
       - Node.js: `@googlemaps/routing`
     - Requires Application Default Credentials (ADC) setup
     - Uses gRPC for better performance
     - REST API available as fallback

### 8. **Google Maps Platform Pricing**
   - **URL:** https://mapsplatform.google.com/pricing/
   - **Key Findings:**
     - Routes API included in subscription plans
     - Subscription tiers: Starter ($100/mo), Essentials ($275/mo), Pro ($1,200/mo)
     - Essentials includes 100,000 monthly calls for Compute Route Matrix
     - Pay-as-you-go pricing available
     - Field masking can reduce costs by limiting response data

---

## API Comparison: Distance Matrix vs Routes API

### Request Structure Comparison

#### Distance Matrix API (Legacy)
```http
GET https://maps.googleapis.com/maps/api/distancematrix/json?
    origins=36.5040,-89.1872|36.5100,-89.1900
    &destinations=36.5200,-89.2000|36.5300,-89.2100
    &mode=driving
    &units=metric
    &key=YOUR_API_KEY
```

**Request Format:**
- HTTP GET with query parameters
- API key in query string
- Location format: `lat,lng` strings separated by `|`
- Simple parameter names

#### Routes API (New)
```http
POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
X-Goog-Api-Key: YOUR_API_KEY
X-Goog-FieldMask: originIndex,destinationIndex,duration,distanceMeters,status,condition
Content-Type: application/json

{
  "origins": [
    {
      "waypoint": {
        "location": {
          "latLng": {
            "latitude": 36.5040,
            "longitude": -89.1872
          }
        }
      }
    }
  ],
  "destinations": [
    {
      "waypoint": {
        "location": {
          "latLng": {
            "latitude": 36.5200,
            "longitude": -89.2000
          }
        }
      }
    }
  ],
  "travelMode": "DRIVE",
  "routingPreference": "TRAFFIC_AWARE"
}
```

**Request Format:**
- HTTP POST with JSON body
- API key in `X-Goog-Api-Key` header
- Field mask in `X-Goog-FieldMask` header (required)
- Location format: Nested JSON objects with `latLng`
- More verbose but structured

### Response Structure Comparison

#### Distance Matrix API (Legacy)
```json
{
  "status": "OK",
  "origin_addresses": ["123 Main St, Union City, TN"],
  "destination_addresses": ["456 Oak Ave, Union City, TN"],
  "rows": [
    {
      "elements": [
        {
          "status": "OK",
          "distance": {
            "value": 822,
            "text": "0.8 km"
          },
          "duration": {
            "value": 160,
            "text": "3 mins"
          },
          "duration_in_traffic": {
            "value": 180,
            "text": "3 mins"
          }
        }
      ]
    }
  ]
}
```

#### Routes API (New)
```json
[
  {
    "originIndex": 0,
    "destinationIndex": 0,
    "status": {},
    "distanceMeters": 822,
    "duration": "160s",
    "condition": "ROUTE_EXISTS"
  }
]
```

**Key Differences:**
- ✅ **Flatter structure** - direct array instead of nested rows/elements
- ✅ **Index-based mapping** - `originIndex`/`destinationIndex` for unordered results
- ✅ **Field masking** - only requested fields returned (cost savings)
- ✅ **Element-level errors** - per-route error handling
- ❌ **No text formatting** - distances in meters, durations as ISO 8601 strings
- ❌ **No address resolution** - must resolve addresses separately

### Feature Comparison

| Feature | Distance Matrix (Legacy) | Routes API (Compute Route Matrix) |
|---------|-------------------------|-----------------------------------|
| **Max origins × destinations** | 625 (25×25) | 625 (not transit), 100 (transit/traffic-aware) |
| **Travel modes** | driving, walking, bicycling, transit | DRIVE, WALK, BICYCLE, TWO_WHEELER, TRANSIT |
| **Field masking** | ❌ Not supported | ✅ Required for cost optimization |
| **Streaming responses** | ❌ Single response | ✅ gRPC streaming (not REST) |
| **Traffic-aware routing** | ✅ `departure_time`, `traffic_model` | ✅ `routingPreference: TRAFFIC_AWARE` |
| **Toll calculation** | ❌ Not supported | ✅ Supported |
| **Two-wheel routing** | ❌ Not supported | ✅ Enterprise tier |
| **Eco-friendly routes** | ❌ Not supported | ✅ Supported |
| **Address resolution** | ✅ Included in response | ❌ Must resolve separately |
| **Text formatting** | ✅ Human-readable text | ❌ Raw values only |
| **API authentication** | Query param `key` | Header `X-Goog-Api-Key` |
| **Request method** | GET | POST |
| **Response format** | Nested rows/elements | Flat array with indices |
| **Error handling** | Response-level | Element-level |
| **Client library** | `@googlemaps/google-maps-services-js` | `@googlemaps/routing` or direct HTTP |
| **Status** | 🔴 Legacy | ✅ Active development |

### Pricing Comparison

**Distance Matrix API (Legacy):**
- Standard: $5 per 1,000 elements
- Advanced: $10 per 1,000 elements (with `departure_time`)

**Routes API (Compute Route Matrix):**
- Essentials: $5 per 1,000 elements (basic features)
- Pro: $10 per 1,000 elements (traffic-aware, advanced features)
- Enterprise: $15 per 1,000 elements (two-wheel routing, toll data)

**Cost Analysis:** Similar pricing structure, but Routes API offers more features at same price points.

---

## Architecture Changes Required

### 1. Migration Approach Options

#### Option A: Direct HTTP Calls (Recommended)
**Pros:**
- ✅ Simple implementation - use existing `axios` library
- ✅ No new dependencies
- ✅ Full control over request/response
- ✅ Easy to test and debug

**Cons:**
- ❌ No gRPC streaming support
- ❌ Manual error handling
- ❌ No built-in retry logic

#### Option B: Official Client Library (`@googlemaps/routing`)
**Pros:**
- ✅ Official Google support
- ✅ gRPC streaming support
- ✅ Built-in retry and error handling
- ✅ TypeScript types included

**Cons:**
- ❌ Additional dependency
- ❌ Requires Application Default Credentials (ADC) setup
- ❌ More complex authentication flow
- ❌ Overkill for simple REST usage

**Decision: Option A (Direct HTTP)**
- Simpler for REST-only usage
- Consistent with existing architecture
- Can migrate to Option B later if gRPC streaming needed

### 2. Service Architecture Changes

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEW ARCHITECTURE                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│      distance-matrix-service.js → route-matrix-service.js      │
│                                                                 │
│  makeDistanceMatrixRequest()  →  makeRouteMatrixRequest()      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Transformation Layer                                       │ │
│  │ - Convert {lat, lng} → {latLng: {latitude, longitude}}    │ │
│  │ - Convert mode → travelMode enum                          │ │
│  │ - Add X-Goog-FieldMask header                             │ │
│  │ - Add X-Goog-Api-Key header                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ↓                                    │
│  axios.post('routes.googleapis.com/distanceMatrix/v2:...')    │
│                            ↓                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Response Transformation                                    │ │
│  │ - Parse ISO 8601 duration → seconds                       │ │
│  │ - Map originIndex/destinationIndex → matrix[i][j]        │ │
│  │ - Convert distanceMeters → same format                    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Required Code Changes

#### File: `backend/services/distance-matrix-service.js`

**Change 1: Update makeDistanceMatrixRequest() method**

Before (Legacy):
```javascript
async makeDistanceMatrixRequest(origins, destinations, mode) {
  const originLocations = origins.map(o => `${o.lat},${o.lng}`);
  const destLocations = destinations.map(d => `${d.lat},${d.lng}`);
  
  const response = await this.limiter.schedule(() =>
    this.client.distancematrix({
      params: {
        origins: originLocations,
        destinations: destLocations,
        mode: mode,
        units: 'metric',
        key: this.apiKey
      },
      timeout: 10000
    })
  );
  
  if (!response.data || response.data.status !== 'OK') {
    throw new Error(`Distance Matrix API error: ${response.data?.status}`);
  }
  
  return response.data;
}
```

After (Routes API):
```javascript
async makeRouteMatrixRequest(origins, destinations, mode) {
  // Transform input to Routes API format
  const requestBody = {
    origins: origins.map(o => ({
      waypoint: {
        location: {
          latLng: {
            latitude: o.lat,
            longitude: o.lng
          }
        }
      }
    })),
    destinations: destinations.map(d => ({
      waypoint: {
        location: {
          latLng: {
            latitude: d.lat,
            longitude: d.lng
          }
        }
      }
    })),
    travelMode: this.convertTravelMode(mode),
    routingPreference: 'TRAFFIC_AWARE'  // Optional: enable traffic data
  };
  
  // Use axios for direct HTTP call
  const response = await this.limiter.schedule(() =>
    axios.post(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition'
        },
        timeout: 10000
      }
    )
  );
  
  // Transform response to match legacy format
  return this.transformRouteMatrixResponse(response.data, origins.length, destinations.length);
}

/**
 * Convert legacy mode to Routes API travelMode enum
 */
convertTravelMode(mode) {
  const modeMap = {
    'driving': 'DRIVE',
    'walking': 'WALK',
    'bicycling': 'BICYCLE',
    'transit': 'TRANSIT'
  };
  return modeMap[mode] || 'DRIVE';
}

/**
 * Transform Routes API response to match Distance Matrix format
 */
transformRouteMatrixResponse(elements, numOrigins, numDestinations) {
  // Create empty matrix
  const matrix = {
    status: 'OK',
    rows: Array(numOrigins).fill(null).map(() => ({
      elements: Array(numDestinations).fill(null)
    }))
  };
  
  // Populate matrix from flat array
  for (const element of elements) {
    const i = element.originIndex;
    const j = element.destinationIndex;
    
    // Parse ISO 8601 duration (e.g., "160s" → 160)
    const durationSeconds = element.duration 
      ? parseInt(element.duration.replace('s', '')) 
      : null;
    
    matrix.rows[i].elements[j] = {
      status: element.condition === 'ROUTE_EXISTS' ? 'OK' : 'ZERO_RESULTS',
      distance: {
        value: element.distanceMeters || 0,
        text: `${(element.distanceMeters / 1000).toFixed(1)} km`
      },
      duration: {
        value: durationSeconds || 0,
        text: `${Math.round(durationSeconds / 60)} mins`
      }
    };
  }
  
  return matrix;
}
```

**Change 2: Update constructor to use axios instead of Client**

Before:
```javascript
const { Client } = require('@googlemaps/google-maps-services-js');

constructor() {
  this.client = new Client({});
  this.apiKey = apiKeys.distanceMatrixApiKey;
  // ...
}
```

After:
```javascript
const axios = require('axios');

constructor() {
  this.apiKey = apiKeys.distanceMatrixApiKey;
  this.routesApiEndpoint = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
  // ...
}
```

**Change 3: Update method names throughout the file**
- `makeDistanceMatrixRequest()` → `makeRouteMatrixRequest()`
- Keep existing method signatures for `getDistance()`, `getDistances()`, `getDistanceMatrix()`
- Internal calls update to new method name

#### File: `backend/config/api-keys.js`

**Change: Add Routes API key support**

```javascript
module.exports = {
    // ... existing keys ...
    
    /** Routes API key (replaces Distance Matrix) */
    routesApiKey: process.env.GOOGLE_MAPS_ROUTES_API_KEY || GOOGLE_MAPS_API_KEY,
    
    /** Legacy: Distance Matrix API key (deprecated) */
    distanceMatrixApiKey: process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY || GOOGLE_MAPS_API_KEY,
    
    validate() {
        const warnings = [];
        
        if (!GOOGLE_MAPS_API_KEY) {
            return { valid: false, warnings: ['GOOGLE_MAPS_API_KEY not set'] };
        }
        
        if (!process.env.GOOGLE_MAPS_ROUTES_API_KEY) {
            warnings.push('GOOGLE_MAPS_ROUTES_API_KEY not set — falling back to GOOGLE_MAPS_API_KEY');
        }
        
        return { valid: true, warnings };
    }
};
```

#### File: `.env` (Environment Configuration)

**Add new environment variables:**

```bash
# Routes API Configuration
GOOGLE_MAPS_ROUTES_API_KEY=your_routes_api_key_here

# Legacy Distance Matrix API (deprecated - remove after migration)
# GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY=your_old_key_here

# Feature flag for migration testing
USE_ROUTES_API=true  # Set to false to use legacy API during testing
```

### 4. Cache Compatibility

**Good News:** No changes required to `route-cache-service.js`

The caching layer operates on **abstract distance data** (lat/lng pairs → distance/duration), so it's **API-agnostic**. The cache hash and storage structure remain unchanged:

```javascript
// Cache hash is API-agnostic
generateRouteHash(lat1, lng1, lat2, lng2, mode) {
  // Works with both Distance Matrix and Routes API
  const data = `${minLat},${minLng}|${maxLat},${maxLng}|${mode}`;
  return crypto.createHash('md5').update(data).digest('hex');
}
```

The transformation layer in `makeRouteMatrixRequest()` ensures the cache receives the same data format regardless of underlying API.

### 5. Backward Compatibility Strategy

**Approach: Feature Flag with Dual Implementation**

```javascript
class DistanceMatrixService {
  constructor() {
    this.useRoutesApi = process.env.USE_ROUTES_API === 'true';
    this.apiKey = this.useRoutesApi 
      ? apiKeys.routesApiKey 
      : apiKeys.distanceMatrixApiKey;
    
    if (!this.useRoutesApi) {
      // Legacy: Keep old Client initialization
      const { Client } = require('@googlemaps/google-maps-services-js');
      this.client = new Client({});
    }
  }
  
  async makeDistanceMatrixRequest(origins, destinations, mode) {
    if (this.useRoutesApi) {
      return this.makeRouteMatrixRequest(origins, destinations, mode);
    } else {
      return this.makeLegacyDistanceMatrixRequest(origins, destinations, mode);
    }
  }
  
  // New Routes API implementation
  async makeRouteMatrixRequest(origins, destinations, mode) {
    // ... (see above)
  }
  
  // Legacy implementation (keep for rollback)
  async makeLegacyDistanceMatrixRequest(origins, destinations, mode) {
    // ... (existing implementation)
  }
}
```

**Benefits:**
- ✅ Zero-downtime migration
- ✅ Easy rollback via environment variable
- ✅ A/B testing capability
- ✅ Gradual rollout

---

## Implementation Plan

### Phase 1: Preparation & Setup (Week 1)

**Tasks:**
1. ✅ Research complete (this document)
2. ⬜ Enable Routes API in Google Cloud Console
   - Navigate to: https://console.cloud.google.com/apis/library/routes.googleapis.com
   - Click "Enable" for Routes API
   - Verify API is enabled in API Library
3. ⬜ Generate new API key for Routes API (optional - can reuse existing key)
   - If using separate key for better quota tracking
4. ⬜ Update `.env` file with new configuration
   ```bash
   GOOGLE_MAPS_ROUTES_API_KEY=your_api_key
   USE_ROUTES_API=false  # Start with false for testing
   ```
5. ⬜ Create feature branch: `feature/routes-api-migration`

**Deliverables:**
- Routes API enabled in Google Cloud
- Environment variables configured
- Feature branch created

### Phase 2: Core Implementation (Week 1-2)

**Tasks:**
1. ⬜ Update `backend/services/distance-matrix-service.js`
   - Add `makeRouteMatrixRequest()` method
   - Add `transformRouteMatrixResponse()` helper
   - Add `convertTravelMode()` helper
   - Implement feature flag logic
2. ⬜ Update `backend/config/api-keys.js`
   - Add `routesApiKey` property
   - Update validation logic
3. ⬜ Install axios if not already present
   ```bash
   npm install axios
   ```
4. ⬜ Write unit tests for new transformation methods
   - Test request body generation
   - Test response parsing
   - Test error handling

**Deliverables:**
- Routes API implementation complete
- Feature flag functional
- Unit tests passing

### Phase 3: Integration Testing (Week 2)

**Tasks:**
1. ⬜ Test single distance request
   - Call `getDistance()` with `USE_ROUTES_API=true`
   - Verify distance/duration match legacy API
   - Check cache integration
2. ⬜ Test batch distance request (1-to-N)
   - Call `getDistances()` with 10 destinations
   - Verify all distances returned correctly
   - Check quota tracking
3. ⬜ Test full distance matrix (N×N)
   - Call `getDistanceMatrix()` with 5×5 matrix
   - Verify matrix structure matches legacy
4. ⬜ Test progressive/sparse matrix
   - Test `SparseDistanceMatrix` with Routes API
   - Verify lazy loading works
   - Check API call reduction stats
5. ⬜ Test edge cases
   - Same location (0 distance)
   - Invalid coordinates
   - API errors
   - Network timeouts
6. ⬜ Test route optimization
   - Run full route calculation with 20 voters
   - Verify optimized route is generated
   - Check API quota usage

**Deliverables:**
- All integration tests passing
- Edge cases handled
- Performance metrics documented

### Phase 4: Performance & Cost Analysis (Week 3)

**Tasks:**
1. ⬜ Compare API response times
   - Distance Matrix API: measure average response time
   - Routes API: measure average response time
   - Document latency differences
2. ⬜ Compare API costs
   - Calculate costs for typical workload (e.g., 100 routes/day)
   - Compare Essentials vs Pro tier costs
   - Factor in field masking savings
3. ⬜ Test rate limits
   - Verify 3,000 EPM (elements per minute) limit
   - Test Bottleneck rate limiter configuration
   - Adjust if needed
4. ⬜ Optimize field mask
   - Test minimal field mask: `originIndex,destinationIndex,duration,distanceMeters`
   - Verify reduced response size
   - Measure cost savings

**Deliverables:**
- Performance comparison report
- Cost analysis
- Optimized field mask configuration

### Phase 5: Gradual Rollout (Week 3-4)

**Tasks:**
1. ⬜ Deploy to staging environment
   - Set `USE_ROUTES_API=true`
   - Run full test suite
   - Monitor error logs
2. ⬜ Canary deployment (10% traffic)
   - Enable Routes API for 10% of requests
   - Monitor quota usage
   - Monitor error rates
   - Compare response times
3. ⬜ Gradual increase (25%, 50%, 75%, 100%)
   - Increase traffic percentage every 2-3 days
   - Monitor metrics at each stage
   - Rollback if issues detected
4. ⬜ Production cutover
   - Set `USE_ROUTES_API=true` for all traffic
   - Monitor closely for 48 hours
   - Keep legacy code for 1 week as safety net

**Deliverables:**
- Staged rollout complete
- 100% traffic on Routes API
- Metrics dashboard showing health

### Phase 6: Cleanup & Documentation (Week 4)

**Tasks:**
1. ⬜ Remove legacy code
   - Delete `makeLegacyDistanceMatrixRequest()` method
   - Remove `@googlemaps/google-maps-services-js` dependency if only used for Distance Matrix
   - Remove `USE_ROUTES_API` feature flag
   - Remove legacy environment variables
2. ⬜ Update documentation
   - Update README.md with Routes API information
   - Update API documentation
   - Update environment variable examples
3. ⬜ Update monitoring dashboards
   - Create Routes API quota dashboard
   - Add Routes API error tracking
4. ⬜ Knowledge transfer
   - Train team on Routes API
   - Document troubleshooting procedures
   - Create runbook for common issues

**Deliverables:**
- Legacy code removed
- Documentation updated
- Team trained

---

## Dependencies & Requirements

### 1. Google Cloud Platform

**Required Actions:**
- ✅ Enable Routes API in Google Cloud Console
  - URL: https://console.cloud.google.com/apis/library/routes.googleapis.com
  - Cost: Free to enable, pay-per-use billing
- ⬜ Configure API key restrictions
  - Restrict key to Routes API only (security best practice)
  - Add IP restrictions if server has static IP
- ⬜ Set up billing alerts
  - Alert at 50%, 75%, 90% of monthly budget
  - Recommended: Start with $100/month budget

### 2. NPM Dependencies

**Current:**
```json
{
  "@googlemaps/google-maps-services-js": "^3.4.2"  // Legacy - can remove after migration
}
```

**Required (already installed):**
```json
{
  "axios": "^1.6.2"  // For HTTP requests to Routes API
}
```

**Optional (if using official client library):**
```json
{
  "@googlemaps/routing": "^1.x.x"  // Official Routes API client (not needed for REST)
}
```

### 3. Environment Variables

**Required:**
```bash
# Routes API Configuration
GOOGLE_MAPS_ROUTES_API_KEY=your_api_key_here

# Feature flag (temporary during migration)
USE_ROUTES_API=true

# Rate limiting (adjust based on quota)
DISTANCE_MATRIX_RATE_LIMIT=50  # Increased from 10 for Routes API
DISTANCE_MATRIX_DELAY_MS=100
```

**Optional:**
```bash
# Routes API specific settings
ROUTES_API_TIMEOUT_MS=10000
ROUTES_API_ROUTING_PREFERENCE=TRAFFIC_AWARE  # or TRAFFIC_UNAWARE
ROUTES_API_FIELD_MASK=originIndex,destinationIndex,duration,distanceMeters,status,condition
```

### 4. Database

**No changes required.** Existing cache structure is compatible:

```sql
-- Existing route_cache table works as-is
CREATE TABLE IF NOT EXISTS route_cache (
  route_hash TEXT PRIMARY KEY,
  origin_lat REAL NOT NULL,
  origin_lng REAL NOT NULL,
  destination_lat REAL NOT NULL,
  destination_lng REAL NOT NULL,
  travel_mode TEXT NOT NULL,
  distance_meters INTEGER,
  duration_seconds INTEGER,
  duration_in_traffic_seconds INTEGER,
  api_status TEXT,
  cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);
```

### 5. API Key Configuration

**Steps:**
1. Log into Google Cloud Console
2. Navigate to "APIs & Services" > "Credentials"
3. Click "Create Credentials" > "API Key"
4. Edit API key:
   - Name: "Routes API - Production"
   - API restrictions: Restrict to "Routes API"
   - Application restrictions: Add server IP (optional but recommended)
5. Copy key to `.env` as `GOOGLE_MAPS_ROUTES_API_KEY`

**Security Best Practices:**
- ✅ Restrict key to Routes API only
- ✅ Add IP whitelist if server has static IP
- ✅ Rotate keys every 6-12 months
- ✅ Never commit keys to version control
- ✅ Use separate keys for dev/staging/production

---

## Risk Assessment & Mitigations

### Risk 1: API Response Format Changes

**Risk Level:** 🟡 Medium

**Description:** Routes API returns data in different format than Distance Matrix API. Parsing errors could break route calculations.

**Impact:**
- Route optimization fails
- Distance calculations incorrect
- User-facing errors

**Mitigation:**
- ✅ Implement robust transformation layer
- ✅ Add comprehensive unit tests for response parsing
- ✅ Use feature flag for gradual rollout
- ✅ Keep legacy code for quick rollback

**Monitoring:**
- Track error rates for `transformRouteMatrixResponse()`
- Alert if distance/duration values are null
- Log mismatched originIndex/destinationIndex

### Risk 2: Rate Limit Changes

**Risk Level:** 🟡 Medium

**Description:** Routes API has different rate limits (3,000 EPM vs Distance Matrix's flexible limits).

**Impact:**
- 429 errors during peak usage
- Route calculations fail
- Degraded user experience

**Mitigation:**
- ✅ Adjust Bottleneck rate limiter configuration
- ✅ Implement exponential backoff retry logic
- ✅ Monitor quota usage in real-time
- ⬜ Consider upgrading to subscription plan if hitting limits

**Monitoring:**
- Dashboard for API call rate (RPM/EPM)
- Alert if 429 errors exceed 1% of requests
- Track quotaManager metrics

### Risk 3: Cost Increase

**Risk Level:** 🟡 Medium

**Description:** Routes API pricing similar but could be higher depending on features used (Pro vs Essentials tier).

**Impact:**
- Increased monthly API costs
- Budget overruns

**Mitigation:**
- ✅ Use minimal field mask to reduce costs
- ✅ Start with Essentials tier (same price as Distance Matrix)
- ✅ Set up billing alerts at 50%, 75%, 90%
- ✅ Leverage existing cache to minimize API calls
- ⬜ Consider subscription plan if usage is predictable

**Cost Comparison (1,000 routes, 10 locations each = 10,000 elements/day):**
- Distance Matrix (Legacy): $5 per 1,000 elements = **$50/month**
- Routes API Essentials: $5 per 1,000 elements = **$50/month**
- Routes API Pro (with traffic): $10 per 1,000 elements = **$100/month**

**Recommendation:** Start with Essentials tier. Upgrade to Pro only if traffic data needed.

### Risk 4: Cache Invalidation

**Risk Level:** 🟢 Low

**Description:** Cached Distance Matrix data might not be compatible with Routes API responses.

**Impact:**
- Cache misses increase
- Higher API usage temporarily
- Increased costs

**Mitigation:**
- ✅ Cache format is API-agnostic (stores distance/duration only)
- ✅ Hash algorithm unchanged
- ✅ No cache migration needed
- ⬜ Monitor cache hit rate for first week after migration

**Expected Outcome:** No impact. Cache should work identically.

### Risk 5: Progressive Routing Compatibility

**Risk Level:** 🟢 Low

**Description:** `SparseDistanceMatrix` lazy-loading relies on `getDistance()` method. Routes API might break this.

**Impact:**
- Progressive routing fails
- API call reduction (94-96%) lost
- Significantly higher costs

**Mitigation:**
- ✅ `getDistance()` method signature unchanged
- ✅ SparseDistanceMatrix operates at abstraction layer above API
- ✅ Test progressive routing extensively in Phase 3

**Expected Outcome:** No impact. Progressive routing should work identically.

### Risk 6: Third-Party Dependency Issues

**Risk Level:** 🟢 Low

**Description:** If using `@googlemaps/routing` library, version changes could break compatibility.

**Impact:**
- Unexpected API changes
- Build failures

**Mitigation:**
- ✅ Use direct HTTP calls with axios (no third-party routing library)
- ✅ Pin axios version in package.json
- ✅ Monitor axios security advisories

**Expected Outcome:** Minimal risk with direct HTTP approach.

### Risk 7: Field Mask Errors

**Risk Level:** 🟡 Medium

**Description:** Routes API requires `X-Goog-FieldMask` header. Incorrect mask could cause errors or return incomplete data.

**Impact:**
- Missing distance/duration data
- Route calculations fail
- Increased costs (if requesting too many fields)

**Mitigation:**
- ✅ Use minimal field mask: `originIndex,destinationIndex,duration,distanceMeters,status,condition`
- ✅ Document required fields clearly
- ✅ Add validation to ensure field mask is set
- ✅ Test with various field masks

**Monitoring:**
- Log warnings if response is missing expected fields
- Alert if field mask header is missing

### Risk 8: Authentication Changes

**Risk Level:** 🟢 Low

**Description:** Routes API uses header-based authentication (`X-Goog-Api-Key`) instead of query param.

**Impact:**
- Authentication errors if header missing
- 403 Forbidden responses

**Mitigation:**
- ✅ Implement header-based auth correctly
- ✅ Keep API key in environment variable
- ✅ Test authentication explicitly

**Expected Outcome:** One-time change, then stable.

### Risk Matrix Summary

| Risk | Likelihood | Impact | Severity | Mitigation Status |
|------|-----------|--------|----------|-------------------|
| API Response Format Changes | Medium | High | 🟡 Medium | ✅ Mitigated |
| Rate Limit Changes | Low | Medium | 🟡 Medium | ✅ Mitigated |
| Cost Increase | Medium | Medium | 🟡 Medium | ✅ Mitigated |
| Cache Invalidation | Low | Low | 🟢 Low | ✅ Mitigated |
| Progressive Routing | Low | High | 🟢 Low | ✅ Mitigated |
| Third-Party Dependencies | Low | Low | 🟢 Low | ✅ Mitigated |
| Field Mask Errors | Medium | Medium | 🟡 Medium | ✅ Mitigated |
| Authentication Changes | Low | Low | 🟢 Low | ✅ Mitigated |

**Overall Risk Assessment:** 🟡 **Low-Medium Risk**

The migration is relatively low-risk due to:
- ✅ Feature flag enables safe rollback
- ✅ Transformation layer isolates API changes
- ✅ Cache remains unchanged
- ✅ Gradual rollout minimizes impact

---

## Testing Strategy

### 1. Unit Tests

**File:** `backend/services/distance-matrix-service.test.js`

**Test Cases:**

```javascript
describe('DistanceMatrixService - Routes API Migration', () => {
  describe('convertTravelMode()', () => {
    test('converts driving to DRIVE', () => {
      expect(service.convertTravelMode('driving')).toBe('DRIVE');
    });
    
    test('converts walking to WALK', () => {
      expect(service.convertTravelMode('walking')).toBe('WALK');
    });
    
    test('defaults unknown mode to DRIVE', () => {
      expect(service.convertTravelMode('flying')).toBe('DRIVE');
    });
  });
  
  describe('transformRouteMatrixResponse()', () => {
    test('transforms single element response', () => {
      const input = [
        {
          originIndex: 0,
          destinationIndex: 0,
          duration: '160s',
          distanceMeters: 822,
          condition: 'ROUTE_EXISTS'
        }
      ];
      
      const result = service.transformRouteMatrixResponse(input, 1, 1);
      
      expect(result.status).toBe('OK');
      expect(result.rows[0].elements[0].status).toBe('OK');
      expect(result.rows[0].elements[0].distance.value).toBe(822);
      expect(result.rows[0].elements[0].duration.value).toBe(160);
    });
    
    test('handles ZERO_RESULTS condition', () => {
      const input = [
        {
          originIndex: 0,
          destinationIndex: 0,
          distanceMeters: 0,
          condition: 'ROUTE_NOT_FOUND'
        }
      ];
      
      const result = service.transformRouteMatrixResponse(input, 1, 1);
      expect(result.rows[0].elements[0].status).toBe('ZERO_RESULTS');
    });
    
    test('handles 2x2 matrix', () => {
      const input = [
        { originIndex: 0, destinationIndex: 0, duration: '100s', distanceMeters: 500, condition: 'ROUTE_EXISTS' },
        { originIndex: 0, destinationIndex: 1, duration: '200s', distanceMeters: 1000, condition: 'ROUTE_EXISTS' },
        { originIndex: 1, destinationIndex: 0, duration: '150s', distanceMeters: 750, condition: 'ROUTE_EXISTS' },
        { originIndex: 1, destinationIndex: 1, duration: '0s', distanceMeters: 0, condition: 'ROUTE_EXISTS' }
      ];
      
      const result = service.transformRouteMatrixResponse(input, 2, 2);
      expect(result.rows.length).toBe(2);
      expect(result.rows[0].elements.length).toBe(2);
      expect(result.rows[1].elements.length).toBe(2);
    });
  });
  
  describe('makeRouteMatrixRequest()', () => {
    test('generates correct request body', async () => {
      const origins = [{ lat: 36.5040, lng: -89.1872 }];
      const destinations = [{ lat: 36.5100, lng: -89.1900 }];
      
      // Mock axios.post to capture request
      const mockPost = jest.spyOn(axios, 'post').mockResolvedValue({
        data: [
          { originIndex: 0, destinationIndex: 0, duration: '160s', distanceMeters: 822, condition: 'ROUTE_EXISTS' }
        ]
      });
      
      await service.makeRouteMatrixRequest(origins, destinations, 'walking');
      
      expect(mockPost).toHaveBeenCalledWith(
        'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
        expect.objectContaining({
          origins: [
            {
              waypoint: {
                location: {
                  latLng: { latitude: 36.5040, longitude: -89.1872 }
                }
              }
            }
          ],
          travelMode: 'WALK'
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Goog-Api-Key': 'test_api_key',
            'X-Goog-FieldMask': expect.stringContaining('originIndex')
          })
        })
      );
      
      mockPost.mockRestore();
    });
  });
});
```

### 2. Integration Tests

**File:** `backend/services/distance-matrix-service.integration.test.js`

**Test Cases:**

```javascript
describe('Distance Matrix Service - Routes API Integration', () => {
  let service;
  
  beforeAll(() => {
    process.env.USE_ROUTES_API = 'true';
    service = new DistanceMatrixService();
  });
  
  test('getDistance() returns valid distance with Routes API', async () => {
    const origin = { lat: 36.5040, lng: -89.1872 };
    const destination = { lat: 36.5100, lng: -89.1900 };
    
    const result = await service.getDistance(origin, destination, 'driving');
    
    expect(result).toMatchObject({
      distance: expect.any(Number),
      duration: expect.any(Number),
      status: 'OK',
      source: expect.stringMatching(/api|cache/)
    });
    
    expect(result.distance).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });
  
  test('getDistances() handles batch request', async () => {
    const origin = { lat: 36.5040, lng: -89.1872 };
    const destinations = [
      { lat: 36.5100, lng: -89.1900 },
      { lat: 36.5200, lng: -89.2000 },
      { lat: 36.5300, lng: -89.2100 }
    ];
    
    const result = await service.getDistances(origin, destinations, 'walking');
    
    expect(result.distances).toHaveLength(3);
    result.distances.forEach(d => {
      expect(d.status).toBe('OK');
      expect(d.distance).toBeGreaterThan(0);
    });
  });
  
  test('SparseDistanceMatrix works with Routes API', async () => {
    const locations = [
      { lat: 36.5040, lng: -89.1872 },
      { lat: 36.5100, lng: -89.1900 },
      { lat: 36.5200, lng: -89.2000 }
    ];
    
    const matrix = await service.buildDistanceMatrix(locations, 'driving');
    
    // Should return SparseDistanceMatrix instance
    expect(matrix).toBeInstanceOf(SparseDistanceMatrix);
    
    // Test lazy loading
    const dist = await matrix.get(0, 1);
    expect(dist.distance).toBeGreaterThan(0);
    
    // Check stats
    const stats = matrix.getStats();
    expect(stats.apiCalls).toBeLessThan(9);  // Should be < N×N
  });
  
  test('cache integration works with Routes API', async () => {
    const origin = { lat: 36.5040, lng: -89.1872 };
    const destination = { lat: 36.5100, lng: -89.1900 };
    
    // First call - should hit API
    const result1 = await service.getDistance(origin, destination, 'driving');
    expect(result1.source).toBe('api');
    
    // Second call - should hit cache
    const result2 = await service.getDistance(origin, destination, 'driving');
    expect(result2.source).toBe('cache');
    
    // Values should match
    expect(result1.distance).toBe(result2.distance);
    expect(result1.duration).toBe(result2.duration);
  });
});
```

### 3. End-to-End Tests

**File:** `tests/e2e/route-optimization.test.js`

**Test Cases:**

```javascript
describe('Route Optimization E2E - Routes API', () => {
  test('calculates route for 10 voters', async () => {
    const response = await request(app)
      .post('/api/routes/calculate')
      .send({
        voterIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        startLocation: { lat: 36.5040, lng: -89.1872 },
        mode: 'walking',
        algorithm: 'hybrid'
      })
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.route).toBeDefined();
    expect(response.body.route.locations).toHaveLength(10);
    expect(response.body.route.totalDistance).toBeGreaterThan(0);
    expect(response.body.route.metrics.distanceMatrixStats).toBeDefined();
  });
  
  test('handles invalid coordinates', async () => {
    const response = await request(app)
      .post('/api/routes/calculate')
      .send({
        voterIds: [999999],  // Non-existent voter
        startLocation: { lat: 36.5040, lng: -89.1872 },
        mode: 'walking'
      })
      .expect(404);
    
    expect(response.body.success).toBe(false);
  });
});
```

### 4. Performance Tests

**File:** `tests/performance/routes-api-benchmark.test.js`

**Test Cases:**

```javascript
describe('Routes API Performance Benchmark', () => {
  test('compares response times: Distance Matrix vs Routes API', async () => {
    const origins = Array(10).fill(null).map(() => generateRandomLocation());
    const destinations = Array(10).fill(null).map(() => generateRandomLocation());
    
    // Legacy Distance Matrix API
    process.env.USE_ROUTES_API = 'false';
    const legacyService = new DistanceMatrixService();
    const legacyStart = Date.now();
    await legacyService.getDistanceMatrix(origins, destinations, 'driving');
    const legacyTime = Date.now() - legacyStart;
    
    // Routes API
    process.env.USE_ROUTES_API = 'true';
    const routesService = new DistanceMatrixService();
    const routesStart = Date.now();
    await routesService.getDistanceMatrix(origins, destinations, 'driving');
    const routesTime = Date.now() - routesStart;
    
    console.log(`Legacy API: ${legacyTime}ms`);
    console.log(`Routes API: ${routesTime}ms`);
    console.log(`Difference: ${routesTime - legacyTime}ms (${((routesTime / legacyTime - 1) * 100).toFixed(1)}%)`);
    
    // Routes API should be within 50% of legacy performance
    expect(routesTime).toBeLessThan(legacyTime * 1.5);
  });
});
```

### 5. Manual Testing Checklist

**Pre-Migration:**
- [ ] Verify current Distance Matrix API is working
- [ ] Document current API quota usage
- [ ] Capture current cache hit rate

**During Migration:**
- [ ] Test Routes API with single distance request
- [ ] Test Routes API with batch request (10 destinations)
- [ ] Test Routes API with full matrix (5×5)
- [ ] Test all travel modes: driving, walking, bicycling
- [ ] Test progressive routing with 20+ locations
- [ ] Verify cache is being populated correctly
- [ ] Check quota usage in Google Cloud Console
- [ ] Monitor error logs for API errors
- [ ] Test route optimization endpoint `/api/routes/calculate`
- [ ] Verify frontend map displays routes correctly

**Post-Migration:**
- [ ] Compare API costs (month-over-month)
- [ ] Verify cache hit rate remains high (>80%)
- [ ] Check for any errors in production logs
- [ ] Monitor response times in production
- [ ] Validate with real user workflows

---

## Rollback Plan

### Scenario 1: Critical Bugs in Production

**Trigger Conditions:**
- Error rate > 5% for Routes API calls
- Route calculations consistently failing
- Significant increase in response time (>2x)
- API quota exhausted unexpectedly

**Rollback Steps:**
1. **Immediate (< 5 minutes):**
   ```bash
   # SSH into production server
   ssh user@production-server
   
   # Edit .env file
   nano /path/to/voter/.env
   
   # Change USE_ROUTES_API to false
   USE_ROUTES_API=false
   
   # Restart application
   pm2 restart voter-backend
   ```

2. **Verify Rollback (5-10 minutes):**
   - Check error logs: `pm2 logs voter-backend`
   - Test route calculation endpoint
   - Verify Distance Matrix API is working
   - Monitor error rates return to normal

3. **Root Cause Analysis (1-2 hours):**
   - Review error logs for Routes API failures
   - Check Google Cloud Console for quota issues
   - Identify transformation layer bugs
   - Document issue for future fix

### Scenario 2: Cost Overruns

**Trigger Conditions:**
- API costs 2x higher than expected
- Billing alert triggered at 90% of budget
- Field mask not reducing costs as expected

**Rollback Steps:**
1. **Immediate mitigation:**
   - Keep Routes API enabled
   - Reduce rate limit temporarily:
     ```bash
     DISTANCE_MATRIX_RATE_LIMIT=5  # Reduce from 50 to 5
     ```
   - Implement stricter quota limits in `quota-manager.js`

2. **Cost optimization (within 24 hours):**
   - Analyze which SKU tier is being charged (Essentials vs Pro)
   - Optimize field mask to minimal required fields
   - Review if `routingPreference: TRAFFIC_AWARE` is needed
   - Consider switching to Pro tier subscription if cost-effective

3. **If cost remains too high:**
   - Rollback to Distance Matrix API (Scenario 1 steps)
   - Investigate cost discrepancy before re-attempting migration

### Scenario 3: Rate Limit Exceeded

**Trigger Conditions:**
- Frequent 429 errors (rate limit exceeded)
- Bottleneck queue backing up
- User-facing errors due to failed route calculations

**Mitigation Steps (No Rollback Needed):**
1. **Adjust rate limiter configuration:**
   ```javascript
   this.limiter = new Bottleneck({
     maxConcurrent: 1,
     minTime: 200,  // Increase delay to 200ms
     reservoir: 5,   // Reduce to 5 requests/second
     reservoirRefreshAmount: 5,
     reservoirRefreshInterval: 1000
   });
   ```

2. **Implement exponential backoff:**
   ```javascript
   const maxRetries = 3;
   let attempt = 0;
   
   while (attempt < maxRetries) {
     try {
       return await this.makeRouteMatrixRequest(origins, destinations, mode);
     } catch (error) {
       if (error.response?.status === 429 && attempt < maxRetries - 1) {
         const delay = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s
         await new Promise(resolve => setTimeout(resolve, delay));
         attempt++;
       } else {
         throw error;
       }
     }
   }
   ```

3. **If issues persist:**
   - Consider upgrading to higher quota tier
   - Or rollback to Distance Matrix API (Scenario 1)

### Scenario 4: Authentication Issues

**Trigger Conditions:**
- 403 Forbidden errors
- "API key not valid" errors
- Authentication failures

**Resolution Steps:**
1. **Verify API key:**
   ```bash
   # Check if Routes API is enabled for the key
   curl -H "X-Goog-Api-Key: $GOOGLE_MAPS_ROUTES_API_KEY" \
     https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
   ```

2. **Check API key restrictions:**
   - Log into Google Cloud Console
   - Navigate to "APIs & Services" > "Credentials"
   - Verify key has Routes API enabled
   - Check IP restrictions if applicable

3. **Temporary fix:**
   - Use fallback API key (main `GOOGLE_MAPS_API_KEY`)
   - Or rollback to Distance Matrix API

### Rollback Testing

**Pre-Migration Rollback Test:**
- [ ] Test setting `USE_ROUTES_API=false` in development
- [ ] Verify Distance Matrix API still works
- [ ] Confirm cache compatibility
- [ ] Document rollback procedure

**Post-Migration Rollback Drill (Week 2):**
- [ ] Schedule planned rollback test (low-traffic time)
- [ ] Execute rollback steps
- [ ] Verify application functionality
- [ ] Re-enable Routes API
- [ ] Document actual rollback time

**Expected Rollback Time:** < 5 minutes (environment variable change + restart)

---

## Success Criteria

### Migration Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Error rate | < 1% | Monitor logs for API errors |
| Response time | < 2x legacy | Compare average response times |
| Cache hit rate | > 80% | Route cache statistics |
| API call reduction | > 90% | Progressive routing stats |
| Cost increase | < 10% | Monthly billing comparison |
| Rollback capability | < 5 min | Time to revert via feature flag |
| Zero data loss | 100% | No lost routes or cache entries |
| User-facing errors | 0 | No route calculation failures |

### Post-Migration Validation (Week 1)

- [ ] Routes API handling 100% of traffic
- [ ] Error rate < 1%
- [ ] Average response time within 20% of legacy
- [ ] Cache hit rate maintained (>80%)
- [ ] No user complaints about route calculations
- [ ] API costs within expected range
- [ ] Documentation updated
- [ ] Team trained on new API

### Long-Term Success (Month 1-3)

- [ ] Cost savings or cost-neutral
- [ ] Improved route quality (if using traffic-aware routing)
- [ ] No major incidents related to Routes API
- [ ] Feature flag removed
- [ ] Legacy code removed
- [ ] Monitoring dashboards operational

---

## Appendix

### A. API Request/Response Examples

#### Distance Matrix API (Legacy) Request
```bash
curl "https://maps.googleapis.com/maps/api/distancematrix/json?\
origins=36.5040,-89.1872|36.5100,-89.1900&\
destinations=36.5200,-89.2000|36.5300,-89.2100&\
mode=driving&\
units=metric&\
key=YOUR_API_KEY"
```

#### Distance Matrix API (Legacy) Response
```json
{
  "status": "OK",
  "origin_addresses": [
    "Union City, TN 38261, USA",
    "Union City, TN 38261, USA"
  ],
  "destination_addresses": [
    "Union City, TN 38261, USA",
    "Union City, TN 38261, USA"
  ],
  "rows": [
    {
      "elements": [
        {
          "status": "OK",
          "distance": { "value": 822, "text": "0.8 km" },
          "duration": { "value": 160, "text": "3 mins" }
        },
        {
          "status": "OK",
          "distance": { "value": 1500, "text": "1.5 km" },
          "duration": { "value": 300, "text": "5 mins" }
        }
      ]
    },
    {
      "elements": [
        {
          "status": "OK",
          "distance": { "value": 1200, "text": "1.2 km" },
          "duration": { "value": 240, "text": "4 mins" }
        },
        {
          "status": "OK",
          "distance": { "value": 900, "text": "0.9 km" },
          "duration": { "value": 180, "text": "3 mins" }
        }
      ]
    }
  ]
}
```

#### Routes API Request
```bash
curl -X POST \
  https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix \
  -H "Content-Type: application/json" \
  -H "X-Goog-Api-Key: YOUR_API_KEY" \
  -H "X-Goog-FieldMask: originIndex,destinationIndex,duration,distanceMeters,status,condition" \
  -d '{
    "origins": [
      {
        "waypoint": {
          "location": {
            "latLng": {
              "latitude": 36.5040,
              "longitude": -89.1872
            }
          }
        }
      },
      {
        "waypoint": {
          "location": {
            "latLng": {
              "latitude": 36.5100,
              "longitude": -89.1900
            }
          }
        }
      }
    ],
    "destinations": [
      {
        "waypoint": {
          "location": {
            "latLng": {
              "latitude": 36.5200,
              "longitude": -89.2000
            }
          }
        }
      },
      {
        "waypoint": {
          "location": {
            "latLng": {
              "latitude": 36.5300,
              "longitude": -89.2100
            }
          }
        }
      }
    ],
    "travelMode": "DRIVE",
    "routingPreference": "TRAFFIC_AWARE"
  }'
```

#### Routes API Response
```json
[
  {
    "originIndex": 0,
    "destinationIndex": 0,
    "status": {},
    "distanceMeters": 822,
    "duration": "160s",
    "condition": "ROUTE_EXISTS"
  },
  {
    "originIndex": 0,
    "destinationIndex": 1,
    "status": {},
    "distanceMeters": 1500,
    "duration": "300s",
    "condition": "ROUTE_EXISTS"
  },
  {
    "originIndex": 1,
    "destinationIndex": 0,
    "status": {},
    "distanceMeters": 1200,
    "duration": "240s",
    "condition": "ROUTE_EXISTS"
  },
  {
    "originIndex": 1,
    "destinationIndex": 1,
    "status": {},
    "distanceMeters": 900,
    "duration": "180s",
    "condition": "ROUTE_EXISTS"
  }
]
```

### B. Environment Variable Template

```bash
# ============================================
# Google Maps API Configuration
# ============================================

# Main API Key (used as fallback)
GOOGLE_MAPS_API_KEY=your_main_api_key_here

# Geocoding API Key (separate quota tracking)
GOOGLE_MAPS_GEOCODING_API_KEY=your_geocoding_api_key_here

# Routes API Key (NEW - for migration)
GOOGLE_MAPS_ROUTES_API_KEY=your_routes_api_key_here

# Legacy Distance Matrix API Key (DEPRECATED - remove after migration)
# GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY=your_old_key_here

# ============================================
# Routes API Feature Flag
# ============================================

# Set to "true" to use Routes API, "false" for legacy Distance Matrix API
USE_ROUTES_API=true

# ============================================
# Routes API Configuration
# ============================================

# Routes API endpoint (default: production)
ROUTES_API_ENDPOINT=https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix

# Routes API timeout (milliseconds)
ROUTES_API_TIMEOUT_MS=10000

# Routes API routing preference (TRAFFIC_AWARE or TRAFFIC_UNAWARE)
ROUTES_API_ROUTING_PREFERENCE=TRAFFIC_AWARE

# Routes API field mask (comma-separated, no spaces)
ROUTES_API_FIELD_MASK=originIndex,destinationIndex,duration,distanceMeters,status,condition

# ============================================
# Rate Limiting Configuration
# ============================================

# Rate limit for Distance Matrix / Routes API (queries per second)
DISTANCE_MATRIX_RATE_LIMIT=50

# Minimum delay between API calls (milliseconds)
DISTANCE_MATRIX_DELAY_MS=100

# ============================================
# Progressive Routing Configuration
# ============================================

# Enable progressive routing (lazy-loading of distances)
PROGRESSIVE_ROUTING_ENABLED=true

# ============================================
# Route Cache Configuration
# ============================================

# Cache TTL in days
ROUTE_CACHE_TTL_DAYS=30

# Enable route caching
CACHE_ROUTES=true
```

### C. Useful Links

**Official Documentation:**
- [Routes API Overview](https://developers.google.com/maps/documentation/routes)
- [Compute Route Matrix Reference](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [Routes API Pricing](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [Distance Matrix API (Legacy)](https://developers.google.com/maps/documentation/distance-matrix)

**Client Libraries:**
- [Google Maps Services JS (Legacy)](https://github.com/googlemaps/google-maps-services-js)
- [Routes API Client Libraries](https://developers.google.com/maps/documentation/routes/client-libraries)

**Migration Resources:**
- [Why Migrate to Routes API](https://developers.google.com/maps/documentation/routes/migrate-routes-why)
- [Migration Guide](https://developers.google.com/maps/documentation/routes/migrate-routes)

**Support:**
- [Stack Overflow - google-routes-api](https://stackoverflow.com/questions/tagged/google-routes-api)
- [Google Maps Platform Issue Tracker](https://issuetracker.google.com/issues/new?component=1244012)
- [Google Maps Platform Discord](https://discord.gg/f4hvx8Rp2q)

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | March 10, 2026 | Orchestrator Agent | Initial specification document |

---

## Approval & Sign-Off

**Prepared By:** Orchestrator Agent  
**Date:** March 10, 2026  
**Status:** ✅ Ready for Phase 2 (Implementation)

**Next Steps:**
1. Enable Routes API in Google Cloud Console
2. Create feature branch: `feature/routes-api-migration`
3. Begin Phase 2 implementation
4. Assign developer for core implementation work

---

**End of Specification Document**
