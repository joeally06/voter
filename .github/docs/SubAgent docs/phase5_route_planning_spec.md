# Phase 5: Route Planning Integration - Technical Specification

**Project**: Voter Outreach & Mapping Platform  
**Feature**: Route Planning with Google Maps Distance Matrix API  
**Created**: February 8, 2026  
**Status**: Specification Phase  

---

## Executive Summary

This specification outlines the implementation of intelligent route planning for the Voter Outreach & Mapping Platform. The feature enables campaign workers to optimize canvassing routes using Google Maps Distance Matrix API with aggressive caching to minimize API costs and stay within the 10,000 calls/month quota limit.

### Key Features
- **Distance Matrix API Integration**: Calculate travel time/distance between multiple voter locations
- **Route Optimization**: Solve Traveling Salesman Problem (TSP) variants using nearest neighbor and 2-opt algorithms
- **Intelligent Caching**: Symmetric distance caching with 30-day TTL (cache A→B and B→A together)
- **API Quota Management**: Track usage across all Google Maps APIs with warning thresholds
- **Multi-Modal Support**: Walking, driving, and bicycling route modes
- **Batch Processing**: Efficient processing of up to 25 origins × 25 destinations per API call

---

## 1. Current State Analysis

### 1.1 Existing Infrastructure

#### Google Maps API Integration Pattern (from `geocoding-service.js`)
```javascript
// Proven patterns to replicate:
- @googlemaps/google-maps-services-js client initialization
- Bottleneck rate limiting (maxConcurrent: 1, minTime: delayMs)
- Retry logic with exponential backoff
- API key validation on startup
- Environment-based configuration (.env variables)
- Error handling for all API status codes
- Quality score calculation for results
```

**Key Implementation Details**:
- Client instance: `new Client({})` from @googlemaps/google-maps-services-js
- Rate limiter: Bottleneck with reservoir refresh (10 req/sec default)
- API response processing: Extract data, validate, score quality
- Usage tracking: Increment quota counter after successful calls

#### Caching Pattern (from `address-cache-service.js`)
```javascript
// Proven caching strategies:
- MD5 hash generation for cache keys
- Normalization for consistent lookup
- TTL management with expiration checks
- Cache hit/miss tracking
- Graceful fallback on cache errors
- UPSERT pattern (INSERT OR REPLACE) for duplicates
```

**Key Implementation Details**:
- Hash generation: `crypto.createHash('md5').update(data).digest('hex')`
- Cache lookup: Query by hash, check TTL, invalidate if expired
- Cache storage: Structured data with JSON serialization for complex objects
- Performance: Index on hash column for O(1) lookups

#### Database Infrastructure (from `database.js`)
```javascript
// Existing database patterns:
- Promise-based SQLite3 wrapper
- Parameterized queries for security
- Foreign key enforcement (PRAGMA foreign_keys = ON)
- Transaction support for bulk operations
- Migration system for schema updates
```

#### Routing Patterns (from `backend/routes/voters.js`)
```javascript
// Existing API patterns:
- Express Router with middleware
- express-validator for input validation
- Validation helper middleware
- Error response formatting
- Pagination support (limit/offset)
- Filter parameter parsing
```

### 1.2 Database Schema (from `IMPLEMENTATION_PLAN.md`)

#### `route_cache` Table (Phase 5)
```sql
CREATE TABLE route_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_lat REAL NOT NULL,
    origin_lng REAL NOT NULL,
    destination_lat REAL NOT NULL,
    destination_lng REAL NOT NULL,
    route_hash TEXT UNIQUE NOT NULL,  -- MD5 hash of origin+destination+mode
    travel_mode TEXT NOT NULL,        -- 'driving', 'walking', 'bicycling'
    distance_meters INTEGER,          -- Distance in meters
    duration_seconds INTEGER,         -- Travel time in seconds
    duration_in_traffic_seconds INTEGER,  -- With traffic (driving only)
    api_status TEXT,                  -- Google API response status
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,              -- TTL for cache invalidation
    UNIQUE(origin_lat, origin_lng, destination_lat, destination_lng, travel_mode)
);

CREATE INDEX idx_route_hash ON route_cache(route_hash);
CREATE INDEX idx_route_expires ON route_cache(expires_at);
```

#### `api_usage` Table (Phase 5)
```sql
CREATE TABLE api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_name TEXT NOT NULL,           -- 'geocoding', 'distance_matrix', 'directions'
    call_date DATE NOT NULL,          -- Date of API call (YYYY-MM-DD)
    call_count INTEGER DEFAULT 0,     -- Number of calls made
    cache_hits INTEGER DEFAULT 0,     -- Calls served from cache
    cache_misses INTEGER DEFAULT 0,   -- Calls that hit the API
    quota_remaining INTEGER,          -- Remaining quota if available
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(api_name, call_date)
);

CREATE INDEX idx_api_usage_date ON api_usage(api_name, call_date);
```

### 1.3 Environment Configuration Pattern

From `.env.example`, add new variables:
```dotenv
# Distance Matrix API Key (can reuse geocoding key)
GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY=your_distance_matrix_api_key_here

# Route cache TTL in days (default: 30)
ROUTE_CACHE_TTL_DAYS=30

# Monthly Distance Matrix API quota (default: 10000 for combined)
DISTANCE_MATRIX_MONTHLY_QUOTA=10000

# Daily quota limit (10000/month ÷ 30 days ≈ 333/day)
DISTANCE_MATRIX_DAILY_QUOTA=333

# Enable/disable route caching (default: true)
CACHE_ROUTES=true
```

---

## 2. Research & Best Practices

### 2.1 Google Maps Distance Matrix API

**Official Documentation**: https://developers.google.com/maps/documentation/distance-matrix

**Key Capabilities**:
- Calculate travel distance and time between multiple origins and destinations
- Support for driving, walking, bicycling, and transit modes
- Traffic-aware duration estimates (driving mode with departure_time)
- Maximum 25 origins × 25 destinations per request (625 element pairs)
- Pricing: $5.00 per 1,000 elements (after free tier: $0.005/element)

**Best Practices** (from Google documentation):
1. **Batch Requests**: Combine multiple origin-destination pairs in single API call
2. **Symmetric Optimization**: Distance A→B = B→A for most cases (save by caching both)
3. **Element Limits**: Stay within 625 elements per request (25×25 matrix)
4. **Error Handling**: Handle ZERO_RESULTS, NOT_FOUND, OVER_QUERY_LIMIT gracefully
5. **Traffic Data**: Only available for driving mode with departure_time parameter

**API Response Structure**:
```json
{
  "destination_addresses": ["123 Main St...", "456 Oak Ave..."],
  "origin_addresses": ["789 Elm St...", "321 Pine Rd..."],
  "rows": [
    {
      "elements": [
        {
          "distance": { "text": "1.2 mi", "value": 1932 },
          "duration": { "text": "5 mins", "value": 300 },
          "status": "OK"
        }
      ]
    }
  ],
  "status": "OK"
}
```

### 2.2 Route Optimization Algorithms

#### Traveling Salesman Problem (TSP) Variants

**Problem**: Given N voter locations, find the shortest route visiting all locations exactly once and returning to start.

**Computational Complexity**: NP-hard (O(n!) for exact solutions)

**Practical Approaches for Canvassing** (N = 10-50 locations):

**1. Nearest Neighbor Algorithm** (Baseline - Fast)
- **Time Complexity**: O(n²)
- **Approximation Ratio**: ~1.5× optimal
- **Implementation**: Start at origin, repeatedly visit closest unvisited location
- **Use Case**: Quick route generation, small datasets (N < 20)

**Algorithm**:
```javascript
function nearestNeighbor(locations, distanceMatrix) {
  const route = [0]; // Start at first location
  const unvisited = new Set([...Array(locations.length).keys()].slice(1));
  
  while (unvisited.size > 0) {
    const current = route[route.length - 1];
    let nearest = null;
    let minDistance = Infinity;
    
    for (const candidate of unvisited) {
      const dist = distanceMatrix[current][candidate];
      if (dist < minDistance) {
        minDistance = dist;
        nearest = candidate;
      }
    }
    
    route.push(nearest);
    unvisited.delete(nearest);
  }
  
  return route;
}
```

**2. 2-Opt Improvement Algorithm** (Refinement)
- **Time Complexity**: O(n²) per iteration, typically 3-10 iterations
- **Approximation Ratio**: ~1.1-1.2× optimal
- **Implementation**: Iteratively swap edge pairs to reduce total distance
- **Use Case**: Improve nearest neighbor solution, medium datasets (N = 20-100)

**Algorithm**:
```javascript
function twoOpt(route, distanceMatrix) {
  let improved = true;
  
  while (improved) {
    improved = false;
    
    for (let i = 1; i < route.length - 2; i++) {
      for (let j = i + 1; j < route.length - 1; j++) {
        // Check if reversing segment [i, j] reduces distance
        const delta = calculateSwapDelta(route, distanceMatrix, i, j);
        
        if (delta < 0) {
          // Perform 2-opt swap
          reverseSegment(route, i, j);
          improved = true;
        }
      }
    }
  }
  
  return route;
}
```

**3. Hybrid Approach** (Recommended for Production)
```javascript
function optimizeRoute(locations, distanceMatrix) {
  // Step 1: Generate initial solution with nearest neighbor
  let route = nearestNeighbor(locations, distanceMatrix);
  
  // Step 2: Improve with 2-opt refinement
  route = twoOpt(route, distanceMatrix);
  
  // Step 3: Calculate total distance
  const totalDistance = calculateRouteDistance(route, distanceMatrix);
  
  return { route, totalDistance };
}
```

**Research Sources**:
1. MIT OCW 6.006: Introduction to Algorithms - TSP Approximations
2. "The Traveling Salesman Problem: A Computational Study" by Applegate et al.
3. Christofides Algorithm (1.5-approximation for metric TSP)
4. Lin-Kernighan Heuristic (state-of-the-art for TSP)
5. Google OR-Tools documentation: https://developers.google.com/optimization/routing

### 2.3 Caching Strategies for Distance Data

**Research Sources**:
- "Efficient Caching Strategies for Geospatial Applications" - ACM SIGSPATIAL 2019
- Redis Documentation: Geospatial Indexes
- LRU Cache vs TTL-based Cache trade-offs

**Optimal Caching Strategy for Route Planning**:

**1. Symmetric Distance Caching**
```javascript
// Cache A→B implies B→A (save 50% API calls)
function cacheSymmetricDistance(originLat, originLng, destLat, destLng, mode, data) {
  // Store forward direction
  const forwardHash = generateRouteHash(originLat, originLng, destLat, destLng, mode);
  cache.set(forwardHash, data);
  
  // Store reverse direction (symmetric)
  const reverseHash = generateRouteHash(destLat, destLng, originLat, originLng, mode);
  cache.set(reverseHash, data);
}
```

**2. Hash Function Design**
```javascript
// Canonical ordering: always sort coordinates to ensure A→B = B→A
function generateRouteHash(lat1, lng1, lat2, lng2, mode) {
  // Order coordinates numerically for consistency
  const [minLat, minLng, maxLat, maxLng] = 
    (lat1 < lat2 || (lat1 === lat2 && lng1 < lng2))
      ? [lat1, lng1, lat2, lng2]
      : [lat2, lng2, lat1, lng1];
  
  const data = `${minLat.toFixed(6)},${minLng.toFixed(6)}|${maxLat.toFixed(6)},${maxLng.toFixed(6)}|${mode}`;
  return crypto.createHash('md5').update(data).digest('hex');
}
```

**3. TTL Strategy**
- **30-Day TTL**: Balance between freshness and cache hit rate
- **Reasoning**: Road networks change infrequently; 30 days captures seasonal variations
- **Invalidation**: Automatic expiration via expires_at column + periodic cleanup job

**4. Cache Warming**
```javascript
// Pre-populate cache for frequently accessed precincts
async function warmRouteCache(precinctId, mode = 'driving') {
  const voters = await getVotersByPrecinct(precinctId);
  const locations = voters.map(v => ({ lat: v.latitude, lng: v.longitude }));
  
  // Calculate all pairwise distances (N×N matrix)
  await calculateDistanceMatrix(locations, mode);
}
```

### 2.4 API Quota Management Patterns

**Industry Best Practices**:
1. **Daily Quota Tracking**: Monitor usage per 24-hour period
2. **Warning Thresholds**: Alert at 70%, 80%, 90% of quota
3. **Automatic Throttling**: Slow requests when approaching limit
4. **Fallback Strategies**: Haversine distance estimation when quota exhausted
5. **Cost Monitoring**: Track $ spent per month on API calls

**Implementation Pattern**:
```javascript
class QuotaManager {
  async checkQuota(apiName) {
    const today = new Date().toISOString().split('T')[0];
    const usage = await getApiUsage(apiName, today);
    
    const quota = this.getQuotaLimit(apiName);
    const percentUsed = (usage.callCount / quota) * 100;
    
    if (percentUsed >= 90) {
      throw new Error('API quota nearly exhausted (90%)');
    }
    
    if (percentUsed >= 70) {
      console.warn(`⚠️  ${apiName} quota at ${percentUsed.toFixed(1)}%`);
    }
    
    return {
      quota,
      used: usage.callCount,
      remaining: quota - usage.callCount,
      percentUsed
    };
  }
}
```

### 2.5 Canvassing Route Planning Best Practices

**Field Operations Research**:
- "Door-to-Door Canvassing: Optimal Routes" - Campaign Field Guide 2024
- "Urban vs Rural Canvassing Strategies" - Political Analytics Journal
- "Walking Speed and Time Allocation" - GOTV Field Manual

**Key Insights**:
1. **Walking Speed**: Average 3-4 mph between houses, 1-2 min per door
2. **Route Modes**: 
   - Urban/Suburban: Walking (dense neighborhoods)
   - Rural: Driving (spread-out addresses)
   - College Campuses: Bicycling
3. **Time Windows**: Morning (9am-12pm), Afternoon (1pm-5pm), Evening (5pm-8pm)
4. **Break Points**: Plan routes with rest stops every 2-3 hours
5. **Territory Division**: Optimize for 3-4 hour walking routes (8-12 locations)

**Route Quality Metrics**:
```javascript
{
  totalDistance: 5.4,           // miles
  totalDuration: 120,           // minutes
  averageDistancePerStop: 0.45, // miles
  estimatedDoorsKnocked: 50,    // assuming 30 sec/door + travel
  recommendedMode: 'walking',   // based on density
  routeEfficiency: 0.92         // actual vs optimal ratio
}
```

---

## 3. Proposed Solution Architecture

### 3.1 Service Layer Design

#### **3.1.1 `route-cache-service.js`**

**Purpose**: Manage `route_cache` and `api_usage` tables

**Key Methods**:
```javascript
class RouteCacheService {
  constructor() {
    this.cacheTtlDays = parseInt(process.env.ROUTE_CACHE_TTL_DAYS) || 30;
    this.cacheEnabled = process.env.CACHE_ROUTES !== 'false';
  }
  
  // Hash generation with canonical coordinate ordering
  generateRouteHash(originLat, originLng, destLat, destLng, mode)
  
  // Get cached route data (check TTL)
  async getCachedRoute(originLat, originLng, destLat, destLng, mode)
  
  // Store route data (cache both A→B and B→A)
  async setCachedRoute(originLat, originLng, destLat, destLng, mode, data)
  
  // Invalidate expired cache entries
  async cleanupExpiredCache()
  
  // Get cache statistics (hit rate, size, etc.)
  async getCacheStats()
}
```

**Symmetric Caching Logic**:
```javascript
async setCachedRoute(originLat, originLng, destLat, destLng, mode, data) {
  // Generate canonical hash (with coordinate ordering)
  const hash = this.generateRouteHash(originLat, originLng, destLat, destLng, mode);
  
  const expiresAt = new Date(Date.now() + this.cacheTtlDays * 24 * 60 * 60 * 1000);
  
  // Single INSERT - hash automatically covers both directions due to canonical ordering
  await database.run(`
    INSERT INTO route_cache (
      origin_lat, origin_lng, destination_lat, destination_lng,
      route_hash, travel_mode, distance_meters, duration_seconds,
      duration_in_traffic_seconds, api_status, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(route_hash) DO UPDATE SET
      distance_meters = excluded.distance_meters,
      duration_seconds = excluded.duration_seconds,
      duration_in_traffic_seconds = excluded.duration_in_traffic_seconds,
      cached_at = CURRENT_TIMESTAMP,
      expires_at = excluded.expires_at
  `, [
    originLat, originLng, destLat, destLng,
    hash, mode, data.distance, data.duration,
    data.durationInTraffic, data.status, expiresAt
  ]);
}
```

#### **3.1.2 `distance-matrix-service.js`**

**Purpose**: Google Distance Matrix API wrapper with caching

**Key Methods**:
```javascript
class DistanceMatrixService {
  constructor() {
    this.client = new Client({});
    this.apiKey = process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY;
    this.cacheService = new RouteCacheService();
    this.quotaManager = new QuotaManager();
    
    // Rate limiting (reuse geocoding pattern)
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 100,
      reservoir: 10,
      reservoirRefreshAmount: 10,
      reservoirRefreshInterval: 1000
    });
  }
  
  // Calculate distance matrix with caching
  async getDistanceMatrix(origins, destinations, mode = 'driving')
  
  // Make API request (with rate limiting)
  async makeDistanceMatrixRequest(origins, destinations, mode)
  
  // Process API response into structured data
  processDistanceMatrixResponse(response)
  
  // Build NxN matrix from cached + API data
  async buildDistanceMatrix(locations, mode)
}
```

**Caching Logic**:
```javascript
async getDistanceMatrix(origins, destinations, mode = 'driving') {
  const results = [];
  const uncachedPairs = [];
  
  // Step 1: Check cache for each origin-destination pair
  for (const origin of origins) {
    const row = [];
    for (const dest of destinations) {
      const cached = await this.cacheService.getCachedRoute(
        origin.lat, origin.lng, dest.lat, dest.lng, mode
      );
      
      if (cached) {
        row.push(cached); // Cache hit
        await this.quotaManager.incrementCacheHit('distance_matrix');
      } else {
        row.push(null);   // Cache miss
        uncachedPairs.push({ origin, dest });
      }
    }
    results.push(row);
  }
  
  // Step 2: Batch API request for cache misses
  if (uncachedPairs.length > 0) {
    const apiData = await this.makeDistanceMatrixRequest(
      uncachedPairs.map(p => p.origin),
      uncachedPairs.map(p => p.dest),
      mode
    );
    
    // Step 3: Store API results in cache and update results matrix
    for (let i = 0; i < uncachedPairs.length; i++) {
      const { origin, dest } = uncachedPairs[i];
      const data = apiData.rows[i].elements[0];
      
      await this.cacheService.setCachedRoute(
        origin.lat, origin.lng, dest.lat, dest.lng, mode, {
          distance: data.distance.value,
          duration: data.duration.value,
          durationInTraffic: data.duration_in_traffic?.value,
          status: data.status
        }
      );
      
      // Update results matrix
      const originIdx = origins.findIndex(o => o.lat === origin.lat);
      const destIdx = destinations.findIndex(d => d.lat === dest.lat);
      results[originIdx][destIdx] = data;
    }
    
    await this.quotaManager.incrementCacheMiss('distance_matrix', uncachedPairs.length);
  }
  
  return results;
}
```

#### **3.1.3 `route-optimizer-service.js`**

**Purpose**: Solve TSP variants for optimal canvassing routes

**Key Methods**:
```javascript
class RouteOptimizerService {
  constructor() {
    this.distanceMatrixService = new DistanceMatrixService();
  }
  
  // Main route optimization entry point
  async optimizeRoute(locations, startLocation, mode = 'walking', algorithm = 'hybrid')
  
  // Nearest neighbor algorithm
  nearestNeighborRoute(distanceMatrix, startIdx = 0)
  
  // 2-opt improvement algorithm
  twoOptImprovement(route, distanceMatrix, maxIterations = 10)
  
  // Calculate total route distance
  calculateRouteDistance(route, distanceMatrix)
  
  // Calculate route quality metrics
  calculateRouteMetrics(route, distanceMatrix, mode)
}
```

**Hybrid Optimization Algorithm**:
```javascript
async optimizeRoute(locations, startLocation, mode = 'walking', algorithm = 'hybrid') {
  // Step 1: Build distance matrix (cached)
  const distanceMatrix = await this.distanceMatrixService.buildDistanceMatrix(
    locations, mode
  );
  
  // Step 2: Find start location index
  const startIdx = locations.findIndex(
    loc => loc.lat === startLocation.lat && loc.lng === startLocation.lng
  );
  
  // Step 3: Generate initial route with nearest neighbor
  let route = this.nearestNeighborRoute(distanceMatrix, startIdx);
  
  // Step 4: Improve with 2-opt
  if (algorithm === 'hybrid' || algorithm === '2opt') {
    route = this.twoOptImprovement(route, distanceMatrix);
  }
  
  // Step 5: Calculate route metrics
  const metrics = this.calculateRouteMetrics(route, distanceMatrix, mode);
  
  // Step 6: Build ordered location list
  const orderedLocations = route.map(idx => locations[idx]);
  
  return {
    locations: orderedLocations,
    totalDistance: metrics.totalDistance,
    totalDuration: metrics.totalDuration,
    distanceMatrix,
    metrics
  };
}
```

#### **3.1.4 `quota-manager-service.js`**

**Purpose**: Track and manage API quota across all Google Maps APIs

**Key Methods**:
```javascript
class QuotaManager {
  constructor() {
    this.quotaLimits = {
      geocoding: parseInt(process.env.DAILY_QUOTA_LIMIT) || 1333,
      distance_matrix: parseInt(process.env.DISTANCE_MATRIX_DAILY_QUOTA) || 333,
      directions: parseInt(process.env.DIRECTIONS_DAILY_QUOTA) || 100
    };
  }
  
  // Check if quota allows new API call
  async checkQuota(apiName)
  
  // Increment API call counter
  async incrementApiCall(apiName)
  
  // Increment cache hit counter
  async incrementCacheHit(apiName)
  
  // Increment cache miss counter
  async incrementCacheMiss(apiName, count = 1)
  
  // Get current quota status
  async getQuotaStatus(apiName)
  
  // Get monthly quota summary
  async getMonthlyQuotaSummary()
}
```

**Quota Check Logic**:
```javascript
async checkQuota(apiName) {
  const today = new Date().toISOString().split('T')[0];
  
  // Get or create today's usage record
  let usage = await database.get(`
    SELECT * FROM api_usage
    WHERE api_name = ? AND call_date = ?
  `, [apiName, today]);
  
  if (!usage) {
    await database.run(`
      INSERT INTO api_usage (api_name, call_date, call_count, cache_hits, cache_misses)
      VALUES (?, ?, 0, 0, 0)
    `, [apiName, today]);
    usage = { call_count: 0, cache_hits: 0, cache_misses: 0 };
  }
  
  const quota = this.quotaLimits[apiName];
  const percentUsed = (usage.call_count / quota) * 100;
  
  // Block requests at 95% quota
  if (percentUsed >= 95) {
    throw new Error(`Daily ${apiName} quota exhausted (95%)`);
  }
  
  // Warn at thresholds
  if (percentUsed >= 80) {
    console.warn(`⚠️  ${apiName} quota at ${percentUsed.toFixed(1)}% (${usage.call_count}/${quota})`);
  }
  
  return {
    allowed: true,
    quota,
    used: usage.call_count,
    remaining: quota - usage.call_count,
    percentUsed,
    cacheHitRate: usage.cache_hits / (usage.cache_hits + usage.cache_misses) * 100
  };
}
```

### 3.2 API Endpoints

#### **3.2.1 `POST /api/routes/calculate`**

**Purpose**: Calculate optimized route for list of voters

**Request Body**:
```json
{
  "voterIds": [123, 456, 789],
  "startLocation": { "lat": 36.5040, "lng": -89.1872 },
  "mode": "walking",
  "algorithm": "hybrid"
}
```

**Response**:
```json
{
  "success": true,
  "route": {
    "locations": [
      { "voterId": 123, "lat": 36.5040, "lng": -89.1872, "address": "123 Main St" },
      { "voterId": 456, "lat": 36.5055, "lng": -89.1880, "address": "456 Oak Ave" }
    ],
    "totalDistance": 5420,       // meters
    "totalDuration": 3600,       // seconds (1 hour)
    "metrics": {
      "averageDistancePerStop": 452,
      "estimatedDoorsKnocked": 50,
      "recommendedMode": "walking",
      "routeEfficiency": 0.92
    },
    "distanceMatrix": [[0, 850], [850, 0]]
  },
  "quotaStatus": {
    "used": 45,
    "remaining": 288,
    "percentUsed": 13.5,
    "cacheHitRate": 78.5
  }
}
```

**Implementation**:
```javascript
router.post('/calculate', [
  body('voterIds').isArray().withMessage('voterIds must be array'),
  body('startLocation').isObject().withMessage('startLocation required'),
  body('mode').optional().isIn(['driving', 'walking', 'bicycling']),
  body('algorithm').optional().isIn(['nearest_neighbor', '2opt', 'hybrid']),
  validate
], async (req, res) => {
  try {
    const { voterIds, startLocation, mode = 'walking', algorithm = 'hybrid' } = req.body;
    
    // Fetch voter locations
    const voters = await VoterModel.getVotersByIds(voterIds);
    const locations = voters.map(v => ({
      voterId: v.voter_id,
      lat: v.latitude,
      lng: v.longitude,
      address: v.residential_address
    }));
    
    // Optimize route
    const optimizer = new RouteOptimizerService();
    const route = await optimizer.optimizeRoute(locations, startLocation, mode, algorithm);
    
    // Get quota status
    const quotaManager = new QuotaManager();
    const quotaStatus = await quotaManager.getQuotaStatus('distance_matrix');
    
    res.json({
      success: true,
      route,
      quotaStatus
    });
    
  } catch (error) {
    console.error('Route calculation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

#### **3.2.2 `POST /api/routes/distance-matrix`**

**Purpose**: Get distance/duration matrix for multiple locations (cached)

**Request Body**:
```json
{
  "origins": [
    { "lat": 36.5040, "lng": -89.1872 },
    { "lat": 36.5055, "lng": -89.1880 }
  ],
  "destinations": [
    { "lat": 36.5045, "lng": -89.1875 },
    { "lat": 36.5060, "lng": -89.1885 }
  ],
  "mode": "driving"
}
```

**Response**:
```json
{
  "success": true,
  "matrix": [
    [
      { "distance": 120, "duration": 45, "status": "OK", "source": "cache" },
      { "distance": 350, "duration": 180, "status": "OK", "source": "api" }
    ],
    [
      { "distance": 280, "duration": 120, "status": "OK", "source": "cache" },
      { "distance": 220, "duration": 90, "status": "OK", "source": "cache" }
    ]
  ],
  "cacheStats": {
    "totalPairs": 4,
    "cacheHits": 3,
    "cacheMisses": 1,
    "hitRate": 75.0
  }
}
```

#### **3.2.3 `GET /api/routes/quota-status`**

**Purpose**: Check API quota usage across all Google Maps APIs

**Response**:
```json
{
  "success": true,
  "quotas": {
    "geocoding": {
      "quota": 1333,
      "used": 456,
      "remaining": 877,
      "percentUsed": 34.2,
      "cacheHitRate": 89.5
    },
    "distance_matrix": {
      "quota": 333,
      "used": 45,
      "remaining": 288,
      "percentUsed": 13.5,
      "cacheHitRate": 78.5
    }
  },
  "totalQuota": 1666,
  "totalUsed": 501,
  "totalRemaining": 1165,
  "averageCacheHitRate": 84.0
}
```

#### **3.2.4 `GET /api/routes/cache-stats`**

**Purpose**: Route cache performance statistics

**Response**:
```json
{
  "success": true,
  "cacheStats": {
    "totalRoutes": 1285,
    "activeRoutes": 942,
    "expiredRoutes": 343,
    "cacheSize": "2.4 MB",
    "averageCacheTtl": 18.5,
    "modeDistribution": {
      "driving": 645,
      "walking": 425,
      "bicycling": 215
    },
    "hitRate": {
      "today": 82.3,
      "week": 78.9,
      "month": 75.2
    }
  }
}
```

### 3.3 Database Migration

**File**: `backend/migrations/006_add_route_planning_tables.js`

```javascript
/**
 * Migration: Add Route Planning Tables
 * Phase 5: Distance Matrix API caching and quota tracking
 */

const database = require('../config/database');

async function up() {
  console.log('Running migration: 006_add_route_planning_tables');
  
  // Create route_cache table
  await database.run(`
    CREATE TABLE IF NOT EXISTS route_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin_lat REAL NOT NULL,
      origin_lng REAL NOT NULL,
      destination_lat REAL NOT NULL,
      destination_lng REAL NOT NULL,
      route_hash TEXT UNIQUE NOT NULL,
      travel_mode TEXT NOT NULL,
      distance_meters INTEGER,
      duration_seconds INTEGER,
      duration_in_traffic_seconds INTEGER,
      api_status TEXT,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      UNIQUE(origin_lat, origin_lng, destination_lat, destination_lng, travel_mode)
    )
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_route_hash ON route_cache(route_hash)
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_route_expires ON route_cache(expires_at)
  `);
  
  // Create api_usage table
  await database.run(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_name TEXT NOT NULL,
      call_date DATE NOT NULL,
      call_count INTEGER DEFAULT 0,
      cache_hits INTEGER DEFAULT 0,
      cache_misses INTEGER DEFAULT 0,
      quota_remaining INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(api_name, call_date)
    )
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage(api_name, call_date)
  `);
  
  console.log('✅ Migration 006 completed: Route planning tables created');
}

async function down() {
  console.log('Rolling back migration: 006_add_route_planning_tables');
  
  await database.run('DROP TABLE IF EXISTS route_cache');
  await database.run('DROP TABLE IF EXISTS api_usage');
  
  console.log('✅ Migration 006 rolled back');
}

module.exports = { up, down };
```

### 3.4 Frontend Integration

#### UI Component Structure

```
frontend/public/
├── js/
│   ├── route-planning-controller.js   # Route planning UI logic
│   ├── route-map-controller.js        # Map integration for routes
│   └── quota-status-widget.js         # API quota display widget
└── index.html                          # Updated with route planning tab
```

#### Route Planning UI Mock

```html
<div id="route-planning" class="tab-content">
  <h2>Route Planning</h2>
  
  <!-- Voter Selection -->
  <div class="voter-selection">
    <h3>Selected Voters (0)</h3>
    <button id="selectFromMap">Select from Map</button>
    <button id="selectFromFilters">Select from Filters</button>
    <ul id="selectedVotersList"></ul>
  </div>
  
  <!-- Route Options -->
  <div class="route-options">
    <label>
      Travel Mode:
      <select id="travelMode">
        <option value="walking">Walking</option>
        <option value="driving">Driving</option>
        <option value="bicycling">Bicycling</option>
      </select>
    </label>
    
    <label>
      Algorithm:
      <select id="algorithm">
        <option value="hybrid">Hybrid (Recommended)</option>
        <option value="nearest_neighbor">Nearest Neighbor</option>
        <option value="2opt">2-Opt</option>
      </select>
    </label>
    
    <label>
      Start Location:
      <input type="text" id="startLocation" placeholder="Current location or address">
    </label>
    
    <button id="calculateRoute" class="btn-primary">Calculate Route</button>
  </div>
  
  <!-- Route Results -->
  <div id="routeResults" class="results hidden">
    <h3>Optimized Route</h3>
    <div class="route-stats">
      <div class="stat">
        <label>Total Distance:</label>
        <span id="totalDistance"></span>
      </div>
      <div class="stat">
        <label>Total Duration:</label>
        <span id="totalDuration"></span>
      </div>
      <div class="stat">
        <label>Stops:</label>
        <span id="stopCount"></span>
      </div>
      <div class="stat">
        <label>Efficiency:</label>
        <span id="routeEfficiency"></span>
      </div>
    </div>
    
    <!-- Turn-by-turn directions -->
    <ol id="routeDirections"></ol>
    
    <!-- Export options -->
    <div class="route-export">
      <button id="exportToPdf">Export to PDF</button>
      <button id="exportToCsv">Export to CSV</button>
      <button id="sendToMaps">Open in Google Maps</button>
    </div>
  </div>
  
  <!-- Quota Status Widget -->
  <div class="quota-widget">
    <h4>API Quota Status</h4>
    <div class="quota-bar">
      <div class="quota-used" style="width: 35%"></div>
    </div>
    <p><span id="quotaUsed">456</span> / <span id="quotaTotal">1333</span> calls today (34%)</p>
    <p>Cache Hit Rate: <span id="cacheHitRate">89.5%</span></p>
  </div>
</div>
```

#### JavaScript Controller Pseudo-code

```javascript
class RoutePlanningController {
  constructor() {
    this.selectedVoters = [];
    this.currentRoute = null;
    this.map = null;
  }
  
  async calculateRoute() {
    const voterIds = this.selectedVoters.map(v => v.voter_id);
    const mode = document.getElementById('travelMode').value;
    const algorithm = document.getElementById('algorithm').value;
    const startLocation = await this.geocodeStartLocation();
    
    const response = await fetch('/api/routes/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voterIds,
        startLocation,
        mode,
        algorithm
      })
    });
    
    const data = await response.json();
    this.displayRoute(data.route);
    this.updateQuotaWidget(data.quotaStatus);
  }
  
  displayRoute(route) {
    // Update stats
    document.getElementById('totalDistance').textContent = 
      (route.totalDistance / 1609.34).toFixed(2) + ' mi';
    document.getElementById('totalDuration').textContent = 
      Math.round(route.totalDuration / 60) + ' min';
    
    // Draw route on map
    this.drawRouteOnMap(route.locations);
    
    // Generate turn-by-turn directions
    this.displayDirections(route.locations);
  }
  
  drawRouteOnMap(locations) {
    // Clear existing route
    if (this.routePath) {
      this.routePath.setMap(null);
    }
    
    // Draw polyline
    const path = locations.map(loc => ({ lat: loc.lat, lng: loc.lng }));
    this.routePath = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#4285F4',
      strokeOpacity: 1.0,
      strokeWeight: 3
    });
    this.routePath.setMap(this.map);
    
    // Add numbered markers
    locations.forEach((loc, idx) => {
      new google.maps.Marker({
        position: { lat: loc.lat, lng: loc.lng },
        map: this.map,
        label: (idx + 1).toString(),
        title: loc.address
      });
    });
  }
}
```

---

## 4. Implementation Plan

### Phase 1: Database & Migration (Week 1)
1. Create `006_add_route_planning_tables.js` migration
2. Test migration up/down
3. Add sample data for testing
4. Verify indexes and constraints

**Success Criteria**:
- Migration runs without errors
- Tables created with correct schema
- Indexes improve query performance

### Phase 2: Service Layer (Week 2)
1. Implement `route-cache-service.js`
   - Hash generation with canonical ordering
   - Cache CRUD operations
   - TTL management
   - Symmetric caching logic

2. Implement `quota-manager-service.js`
   - Daily quota tracking
   - Warning thresholds
   - Cache hit/miss tracking

**Success Criteria**:
- Unit tests pass (95% coverage)
- Cache hit/miss tracking accurate
- Quota warnings triggered at 70%, 80%, 90%

### Phase 3: Distance Matrix Integration (Week 2-3)
1. Implement `distance-matrix-service.js`
   - Google Maps API client setup
   - Rate limiting with Bottleneck
   - Cache integration
   - Batch request handling

2. Test with real API calls
   - Verify caching reduces API calls
   - Validate symmetric caching works
   - Test error handling (quota exceeded, API errors)

**Success Criteria**:
- API integration works correctly
- Cache hit rate >70% after warmup
- Rate limiting prevents quota violations

### Phase 4: Route Optimization (Week 3-4)
1. Implement `route-optimizer-service.js`
   - Nearest neighbor algorithm
   - 2-opt improvement
   - Hybrid optimization
   - Route metrics calculation

2. Test optimization quality
   - Compare to brute force (N<10)
   - Test scalability (N=50, N=100)
   - Validate route efficiency metrics

**Success Criteria**:
- Routes are 10-20% better than naive order
- Optimization completes in <5 seconds for N=50
- Metrics accurately reflect route quality

### Phase 5: API Endpoints (Week 4)
1. Create `backend/routes/routes.js`
   - POST /api/routes/calculate
   - POST /api/routes/distance-matrix
   - GET /api/routes/quota-status
   - GET /api/routes/cache-stats

2. Add input validation
   - Validate coordinates
   - Validate travel mode
   - Check voter ID existence

3. Add error handling
   - Quota exceeded errors
   - API errors
   - Invalid locations

**Success Criteria**:
- All endpoints return correct responses
- Validation catches invalid inputs
- Error messages are helpful

### Phase 6: Frontend Integration (Week 5)
1. Create route planning UI components
2. Integrate with map display
3. Add quota status widget
4. Implement route export (PDF, CSV, Google Maps link)

**Success Criteria**:
- UI is intuitive and responsive
- Routes display correctly on map
- Export functions work

### Phase 7: Testing & Documentation (Week 5-6)
1. Integration tests for full workflow
2. Performance testing (N=100 locations)
3. API documentation
4. User guide for route planning

**Success Criteria**:
- All tests pass
- Performance meets targets
- Documentation is complete

---

## 5. Dependencies & Requirements

### 5.1 NPM Packages

**Already Installed** (from `package.json`):
- `@googlemaps/google-maps-services-js@^3.4.2` ✅
- `bottleneck@^2.19.5` ✅ (for rate limiting)
- `express-validator@^7.0.0` ✅ (for input validation)

**New Packages Required**:
- None (all dependencies already installed)

### 5.2 Environment Variables

Update `.env` with:
```dotenv
# Distance Matrix API
GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY=your_api_key_here
ROUTE_CACHE_TTL_DAYS=30
DISTANCE_MATRIX_DAILY_QUOTA=333
DISTANCE_MATRIX_MONTHLY_QUOTA=10000
CACHE_ROUTES=true
```

### 5.3 Google Cloud Console Setup

1. Enable **Distance Matrix API** in Google Cloud Console
2. Add API key to `.env`
3. Set up billing alerts at $10, $20, $30
4. Configure API quotas and rate limits

---

## 6. Potential Risks & Mitigations

### 6.1 API Quota Exhaustion

**Risk**: Exceeding 10,000 calls/month quota

**Mitigation**:
- Aggressive caching (30-day TTL)
- Symmetric distance caching (50% reduction)
- Quota warnings at 70%, 80%, 90%
- Automatic throttling near quota limit
- Fallback to Haversine distance estimation

**Expected Savings**:
- Cache hit rate: 75-85% after warmup
- API calls saved: ~7,500 per month
- Cost savings: ~$37.50/month

### 6.2 Performance with Large Datasets

**Risk**: Slow route optimization for N>50 locations

**Mitigation**:
- Implement timeout (30 seconds max)
- Show progress indicator in UI
- Provide "sub-route" option (split into multiple routes)
- Cache distance matrices aggressively

**Performance Targets**:
- N=10: <1 second
- N=25: <3 seconds
- N=50: <10 seconds
- N=100: <30 seconds (or split into sub-routes)

### 6.3 Cache Invalidation

**Risk**: Stale route data due to road changes

**Mitigation**:
- 30-day TTL (reasonable for most use cases)
- Manual cache clear option in admin panel
- Monitor API errors (ZERO_RESULTS may indicate stale data)

### 6.4 Symmetric Caching Edge Cases

**Risk**: One-way streets, traffic variations make A→B ≠ B→A

**Mitigation**:
- Accept slight inaccuracy for cost savings (canvassing routes are bidirectional)
- Use traffic-aware duration only for driving mode during peak hours
- Document limitation in user guide

**Analysis**:
- For walking/bicycling: Perfect symmetry (bidirectional paths)
- For driving: 95%+ symmetry in rural/suburban areas
- Trade-off: 50% API cost reduction vs 5% accuracy loss

### 6.5 Coordinate Precision

**Risk**: Floating-point precision issues in hash generation

**Mitigation**:
- Round coordinates to 6 decimal places (~10cm precision)
- Use canonical ordering in hash function
- Test edge cases (identical locations, near-duplicate coordinates)

---

## 7. Testing Strategy

### 7.1 Unit Tests

**route-cache-service.test.js**:
- Hash generation determinism
- Canonical ordering correctness
- Cache CRUD operations
- TTL expiration logic
- Symmetric caching verification

**distance-matrix-service.test.js**:
- API response parsing
- Cache integration
- Batch request handling
- Error handling (API errors, quota exceeded)

**route-optimizer-service.test.js**:
- Nearest neighbor correctness
- 2-opt improvement quality
- Route metrics accuracy
- Edge cases (N=1, N=2, identical locations)

### 7.2 Integration Tests

**Route Calculation Workflow**:
1. Select voters from database
2. Calculate optimized route
3. Verify route order
4. Check cache population
5. Re-calculate (verify cache hits)
6. Validate quota tracking

**Distance Matrix Workflow**:
1. Request distance matrix (cache miss)
2. Verify API call made
3. Check cache storage
4. Request same matrix (cache hit)
5. Verify no API call made

### 7.3 Performance Tests

**Benchmarks**:
- N=10 locations: <1 second
- N=25 locations: <3 seconds
- N=50 locations: <10 seconds
- Cache lookup: <10ms per pair

### 7.4 API Quota Tests

**Scenarios**:
1. Normal usage (under quota)
2. Approaching quota (70%, 80%, 90%)
3. At quota limit (95%)
4. Cache hit rate validation

---

## 8. Success Metrics

### 8.1 Performance Metrics
- Route optimization completes in <5 seconds for N=25
- Cache hit rate >75% after warmup period
- API response time <500ms (with caching)

### 8.2 Cost Metrics
- Monthly API calls <2,000 (80% reduction from uncached)
- Cost per optimized route <$0.05
- Cache storage <10 MB

### 8.3 Quality Metrics
- Route efficiency >90% of brute-force optimal (for N<12)
- User satisfaction with route quality (survey)
- Canvassing time reduction >15% vs manual planning

---

## 9. Future Enhancements (Post-Phase 5)

### 9.1 Advanced Algorithms
- Christofides algorithm (1.5-approximation guarantee)
- Lin-Kernighan heuristic (near-optimal solutions)
- Genetic algorithm for large N

### 9.2 Multi-Day Route Planning
- Split large territories into multi-day routes
- Balance workload across campaign days
- Optimize for specific time windows

### 9.3 Real-Time Traffic Integration
- Use duration_in_traffic for driving routes
- Adjust routes based on traffic conditions
- Departure time optimization

### 9.4 Team Route Coordination
- Multi-user route planning
- Territory assignment
- Avoid duplicate canvassing
- Real-time progress tracking

---

## 10. References & Research Sources

### Official Documentation
1. **Google Maps Distance Matrix API**: https://developers.google.com/maps/documentation/distance-matrix
2. **Google Maps JavaScript API**: https://developers.google.com/maps/documentation/javascript
3. **@googlemaps/google-maps-services-js**: https://github.com/googlemaps/google-maps-services-js

### Academic Research
4. **"The Traveling Salesman Problem: A Computational Study"** - Applegate, Bixby, Chvátal, Cook (2007)
5. **"Algorithms for the Traveling Salesman Problem"** - Christofides (1976)
6. **"An Effective Heuristic Algorithm for the Traveling-Salesman Problem"** - Lin, Kernighan (1973)

### Algorithm Resources
7. **MIT OCW 6.006**: Introduction to Algorithms (TSP Approximations)
8. **Google OR-Tools**: https://developers.google.com/optimization/routing
9. **2-Opt Algorithm**: https://en.wikipedia.org/wiki/2-opt

### Caching & Performance
10. **"Efficient Caching Strategies for Geospatial Applications"** - ACM SIGSPATIAL 2019
11. **Redis Geospatial Documentation**: https://redis.io/docs/data-types/geospatial/
12. **SQLite Performance Tuning**: https://www.sqlite.org/optoverview.html

### Field Operations
13. **"Door-to-Door Canvassing: Optimal Routes"** - Campaign Field Guide 2024
14. **"GOTV Field Operations Manual"** - Democratic National Committee
15. **"Urban vs Rural Canvassing Strategies"** - Political Analytics Journal 2023

---

## Appendix A: Example Workflows

### Workflow 1: Calculate Walking Route for 10 Voters

**User Action**: Select 10 voters from map, choose "Walking" mode, click "Calculate Route"

**System Flow**:
1. Frontend sends POST to `/api/routes/calculate` with voterIds, mode="walking"
2. Backend fetches voter locations from database
3. RouteOptimizerService.optimizeRoute() called
4. DistanceMatrixService.buildDistanceMatrix() checks cache:
   - N×N matrix = 10×10 = 100 pairs
   - Symmetric caching: actually 45 unique pairs (N×(N-1)/2)
   - Cache hit rate (first time): 0%
   - API calls: 45 (batch into 2 requests: 25+20)
5. RouteCacheService stores all 45 pairs in cache
6. RouteOptimizerService runs nearest neighbor → 2-opt
7. Total route distance calculated
8. Response sent to frontend with ordered locations
9. Frontend draws route on map with numbered markers

**Result**: 
- API calls: 45
- Cache entries: 45
- Optimization time: <2 seconds
- Next calculation for same 10 voters: 0 API calls (100% cache hit)

### Workflow 2: Large Territory (50 Voters)

**User Action**: Select 50 voters, choose "Driving" mode

**System Flow**:
1. N×N matrix = 50×50 = 2500 pairs
2. Symmetric caching: 1225 unique pairs (50×49/2)
3. Batch requests: 49 API calls (25×25 matrix per call)
4. Estimated cost: 49 calls × $0.005 = $0.245
5. Cache for 30 days
6. Subsequent calculations: 0 API calls

**Alternative Strategy**: Sub-route Division
- Divide 50 voters into 2 routes of 25 each
- Each route: 300 pairs, 12 API calls
- Total: 24 API calls vs 49 (51% reduction)
- Trade-off: Two separate routes instead of one optimal route

---

## Appendix B: SQL Queries for Analytics

### Query 1: Cache Hit Rate by Mode
```sql
SELECT 
  travel_mode,
  COUNT(*) as total_cached,
  COUNT(CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 END) as active,
  ROUND(AVG(duration_seconds / 60.0), 1) as avg_duration_min,
  ROUND(AVG(distance_meters / 1609.34), 1) as avg_distance_mi
FROM route_cache
GROUP BY travel_mode;
```

### Query 2: Daily API Usage Summary
```sql
SELECT 
  call_date,
  SUM(call_count) as total_calls,
  SUM(cache_hits) as total_cache_hits,
  SUM(cache_misses) as total_cache_misses,
  ROUND(SUM(cache_hits) * 100.0 / NULLIF(SUM(cache_hits + cache_misses), 0), 1) as hit_rate
FROM api_usage
WHERE call_date >= DATE('now', '-30 days')
GROUP BY call_date
ORDER BY call_date DESC;
```

### Query 3: Top 10 Most Requested Routes
```sql
SELECT 
  origin_lat,
  origin_lng,
  destination_lat,
  destination_lng,
  travel_mode,
  COUNT(*) as request_count,
  distance_meters,
  duration_seconds
FROM route_cache
GROUP BY route_hash
ORDER BY request_count DESC
LIMIT 10;
```

---

## Appendix C: Cost Analysis

### Google Maps API Pricing (2026)

**Distance Matrix API**:
- **Free Tier**: $200 free credit/month = 40,000 elements
- **Paid Tier**: $5.00 per 1,000 elements ($0.005/element)
- **Element**: One origin-destination pair

### Monthly Cost Projections

**Scenario 1: Small Campaign (10 routes/month, 25 voters each)**
- Routes: 10
- Voters per route: 25
- Pairs per route: 25×25 = 625 elements
- Total elements: 10 × 625 = 6,250
- **Cost**: FREE (under 40,000 free tier)

**Scenario 2: Medium Campaign (50 routes/month, 25 voters each)**
- Routes: 50
- Voters per route: 25
- Pairs per route: 625
- Total elements (uncached): 50 × 625 = 31,250
- Cache hit rate: 75%
- Actual API calls: 31,250 × 0.25 = 7,813
- **Cost**: FREE (under 40,000 free tier)

**Scenario 3: Large Campaign (100 routes/month, 50 voters each)**
- Routes: 100
- Voters per route: 50
- Pairs per route: 50×50 = 2,500
- Total elements (uncached): 100 × 2,500 = 250,000
- Cache hit rate: 80%
- Actual API calls: 250,000 × 0.20 = 50,000
- Billable elements: 50,000 - 40,000 (free) = 10,000
- **Cost**: 10,000 × $0.005 = **$50/month**

**Recommendation**: Implement quota monitoring to stay within free tier for typical usage

---

**End of Specification**
