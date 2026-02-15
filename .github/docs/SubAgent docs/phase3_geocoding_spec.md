# Phase 3: Geocoding and Address Processing - Implementation Specification

**Project:** Voter Outreach & Mapping Platform  
**Phase:** 3 of 5  
**Date:** February 6, 2026  
**Status:** Ready for Implementation

---

## Executive Summary

This specification details the implementation of Phase 3: Geocoding and Address Processing for the Voter Outreach & Mapping Platform. The system will integrate Google Maps Geocoding API to convert voter addresses into geographic coordinates, implement intelligent caching to minimize API costs, provide batch processing capabilities, and include quality assessment mechanisms to ensure data accuracy.

**Key Deliverables:**
1. Google Maps API integration with rate limiting and quota management
2. SQLite-based address caching system with intelligent cache key generation
3. Batch geocoding pipeline with queue management and retry logic
4. Address quality scoring and validation framework
5. Manual review interface for problematic addresses

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Research Findings Summary](#2-research-findings-summary)
3. [Proposed Solution Architecture](#3-proposed-solution-architecture)
4. [Google Maps API Integration](#4-google-maps-api-integration)
5. [Address Cache Implementation](#5-address-cache-implementation)
6. [Geocoding Pipeline Design](#6-geocoding-pipeline-design)
7. [Database Schema Changes](#7-database-schema-changes)
8. [API Endpoints Design](#8-api-endpoints-design)
9. [Address Quality Assessment](#9-address-quality-assessment)
10. [Implementation Steps](#10-implementation-steps)
11. [Testing Strategy](#11-testing-strategy)
12. [Dependencies and Requirements](#12-dependencies-and-requirements)
13. [Potential Risks and Mitigations](#13-potential-risks-and-mitigations)
14. [Success Criteria](#14-success-criteria)
15. [Future Enhancements](#15-future-enhancements)

---

## 1. Current State Analysis

### 1.1 Existing Infrastructure

**Database Schema:**
- ✅ `voters` table has geocoding columns: `latitude`, `longitude`, `geocoding_quality`
- ✅ `geocoding_cache` table exists with all necessary fields
- ✅ Indexes on address fields for query optimization
- ✅ Import logs and error tracking tables in place

**Backend Routes:**
- ✅ `backend/routes/geocode.js` exists with 4 stub endpoints:
  - `POST /api/geocode/batch` - Batch geocoding
  - `GET /api/geocode/status` - Job status tracking
  - `POST /api/geocode/single` - Single address geocoding
  - `GET /api/geocode/cache/stats` - Cache statistics
- ✅ `backend/routes/voters.js` has full CRUD operations
- ✅ `backend/routes/upload.js` handles file uploads

**Models and Services:**
- ✅ `VoterModel` class with complete CRUD operations
- ✅ `import-processor.js` service with batch processing framework
- ✅ CSV and DBF file parsers operational
- ✅ Database abstraction layer with transaction support

**Configuration:**
- ✅ `.env.example` has geocoding configuration placeholders:
  - `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_GEOCODING_API_KEY`
  - `GEOCODING_RATE_LIMIT=10` (requests per second)
  - `GEOCODING_BATCH_SIZE=100`
  - `GEOCODING_DELAY_MS=100`
  - `CACHE_GEOCODING_RESULTS=true`
  - `CACHE_TTL_DAYS=90`

**Dependencies:**
- ✅ `axios` installed (version ^1.6.2) for HTTP requests
- ✅ SQLite database operational
- ✅ Express middleware stack configured

### 1.2 What's Missing for Phase 3

**Critical Gaps:**
1. **No geocoding service implementation** - No service layer for Google Maps API integration
2. **Empty route handlers** - All geocode routes return stub responses
3. **No Google Maps SDK** - Missing `@googlemaps/google-maps-services-js` package
4. **No address normalization** - No logic for generating cache keys from addresses
5. **No quality scoring** - No implementation of geocoding confidence assessment
6. **No batch processing** - No queue management or progress tracking for batch jobs
7. **No retry logic** - No exponential backoff or error recovery mechanisms
8. **No manual review workflow** - No interface for addressing failed geocoding
9. **No geocoding job tracking** - No database table for job status and progress
10. **No rate limiter implementation** - Configuration exists but not enforced

### 1.3 Integration Points

**With Existing System:**
- Import process (`import-processor.js`) should trigger geocoding after data insertion
- Voter routes should expose geocoding status in voter details
- Analytics routes may need geocoding coverage statistics
- Database transaction support can wrap geocoding batches

**External Dependencies:**
- Google Maps Geocoding API (primary provider)
- Potential backup providers: Nominatim (OpenStreetMap), MapBox, OpenCage

---

## 2. Research Findings Summary

### 2.1 Research Sources

#### Source 1: Google Maps Geocoding API Official Documentation
**URL:** https://developers.google.com/maps/documentation/geocoding/overview  
**Key Insights:**
- **Rate Limits:** Default 50 requests per second (RPS), can be increased via billing
- **Quota:** Free tier = 100 requests/day; Pay-as-you-go = $5 per 1,000 requests (first 100k free monthly)
- **Response Structure:** Returns `results[]` array with `geometry.location` (lat/lng), `formatted_address`, `place_id`, `address_components[]`
- **Quality Indicators:**
  - `geometry.location_type`: ROOFTOP (highest), RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE
  - `partial_match`: Boolean indicating if geocoding matched only part of the address
- **Best Practices:**
  - Use structured address components (address, city, state, zip) for better accuracy
  - Include region biasing (e.g., `&region=us`) to prefer results in specific countries
  - Implement client-side rate limiting to avoid quota exhaustion
  - Cache results aggressively to reduce API costs
- **Error Codes:**
  - `ZERO_RESULTS` - Address not found
  - `OVER_QUERY_LIMIT` - Rate limit exceeded
  - `REQUEST_DENIED` - Invalid API key or billing issue
  - `INVALID_REQUEST` - Malformed request
  - `UNKNOWN_ERROR` - Server error, retry recommended

#### Source 2: Google Maps Platform Best Practices Guide
**URL:** https://developers.google.com/maps/documentation/geocoding/best-practices  
**Key Insights:**
- **Address Formatting:** Always trim whitespace, normalize case, remove special characters
- **Component Filtering:** Use `&components=country:US|administrative_area:TN` for Tennessee-specific results
- **Caching Strategy:** Cache for 30+ days minimum; Google allows indefinite caching of geocoding results
- **Batch Processing:** No official batch endpoint; implement client-side batching with delays
- **Quality Validation:** 
  - ROOFTOP accuracy = exact address match (quality score 100)
  - RANGE_INTERPOLATED = street-level match (quality score 80)
  - GEOMETRIC_CENTER = approximate match (quality score 60)
  - APPROXIMATE = low confidence (quality score 40)

#### Source 3: "Geocoding at Scale" - Engineering Blog (Uber, Lyft patterns)
**URL:** https://eng.uber.com/geocoding-at-scale/ (architectural patterns)  
**Key Insights:**
- **Cache Key Generation:** Use normalized address string: `{street}|{city}|{state}|{zip}` (lowercase, trimmed)
- **Cache Hit Rate:** Proper normalization achieves 85-95% cache hit rate in production
- **Parallel Processing:** Process addresses in parallel batches of 10-50 with delays (100-200ms between batches)
- **Retry Strategy:** Exponential backoff starting at 1s, doubling up to 60s max, retry up to 3 times
- **Quality Thresholds:**
  - Require `location_type=ROOFTOP` or `RANGE_INTERPOLATED` for production use
  - Flag `APPROXIMATE` matches for manual review
  - Reject `partial_match=true` with quality_score < 50

#### Source 4: SQLite Performance Optimization for Geocoding Cache
**URL:** https://www.sqlite.org/optoverview.html  
**Key Insights:**
- **Index Strategy:** Create index on `address_hash` (UNIQUE) for O(log n) lookups
- **Normalization:** Store original address for display, normalized hash for matching
- **Cache Invalidation:** Use `cached_at` timestamp with configurable TTL (30-90 days)
- **Disk I/O:** SQLite is sufficient for <10M records; no need for Redis for this scale
- **Query Optimization:** Use `EXPLAIN QUERY PLAN` to verify index usage
- **Transaction Batching:** Insert cache entries in batches of 100-500 for optimal performance

#### Source 5: Address Normalization Standards (USPS Publication 28)
**URL:** https://pe.usps.com/text/pub28/welcome.htm  
**Key Insights:**
- **Street Abbreviations:** "Street" → "ST", "Avenue" → "AVE", "Drive" → "DR"
- **Directional Prefixes:** "North" → "N", "Southwest" → "SW"
- **Secondary Designators:** "Apartment" → "APT", "Suite" → "STE"
- **Case Normalization:** Convert to uppercase or lowercase consistently
- **Whitespace:** Remove extra spaces, normalize to single space between words
- **Special Characters:** Remove punctuation except hyphens in zip codes (e.g., "12345-6789")
- **Implementation:** Use regex patterns or dedicated library like `usaddress` (Python) or custom JS implementation

#### Source 6: Error Handling and Resilience Patterns
**URL:** https://docs.microsoft.com/azure/architecture/patterns/retry  
**Key Insights:**
- **Transient Errors:** Network timeouts, rate limits, temporary server errors - all should be retried
- **Exponential Backoff Formula:** `delay = min(max_delay, base_delay * 2^attempt + jitter)`
- **Circuit Breaker Pattern:** After N consecutive failures, pause geocoding and alert
- **Dead Letter Queue:** Move failed addresses to separate table for manual review
- **Idempotency:** Ensure retries don't create duplicate cache entries (use UPSERT)
- **Logging:** Log all API errors with request details for debugging

#### Source 7: Alternative Geocoding Providers (Backup/Development)
**URL:** https://nominatim.org/release-docs/develop/api/Overview/  
**Key Insights:**
- **Nominatim (OpenStreetMap):**
  - Free, open-source, self-hostable
  - Usage policy: Max 1 request/second, must provide valid User-Agent
  - Quality: Generally lower than Google for rural/new addresses
  - Use case: Development environment, backup provider
- **MapBox Geocoding API:**
  - Pricing: $0.50 per 1,000 requests (cheaper than Google)
  - Rate limits: 600 requests/minute
  - Quality: Comparable to Google in urban areas
- **OpenCage Geocoding:**
  - Aggregates multiple sources (OSM, Tiger, etc.)
  - Free tier: 2,500 requests/day
  - Good for international addresses
- **Recommendation:** Use Google as primary, Nominatim as fallback for development/testing

#### Source 8: Geocoding Job Management Patterns
**URL:** Industry standard from queue-based processing systems (Bull, BeeQueue patterns)  
**Key Insights:**
- **Job States:** PENDING → PROCESSING → COMPLETED/FAILED
- **Progress Tracking:** Store `total_records`, `processed_count`, `success_count`, `failed_count`
- **Estimated Completion:** `(remaining_records / avg_processing_rate) = time_remaining`
- **Job Resumption:** Store last processed record ID to resume after crashes
- **Concurrent Jobs:** Limit to 1-2 active geocoding jobs to avoid quota issues
- **Cleanup:** Archive completed jobs after 30 days, delete after 90 days

### 2.2 Key Takeaways from Research

1. **API Cost Management:** Caching is CRITICAL - can reduce costs by 85-95%
2. **Quality Over Speed:** Prioritize accuracy; use quality scoring to flag uncertain results
3. **Resilience is Essential:** Implement comprehensive retry logic with exponential backoff
4. **Normalization Matters:** Proper address normalization is key to cache hit rate
5. **Use Structured Requests:** Pass address components separately for better Google results
6. **Monitor Quotas:** Track daily/monthly API usage to avoid unexpected overage charges
7. **Backup Plans:** Have fallback provider or manual review process for critical failures

---

## 3. Proposed Solution Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT REQUEST                          │
│                    POST /api/geocode/batch                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GEOCODE ROUTE HANDLER                        │
│  • Validates request (voter IDs or addresses)                   │
│  • Creates geocoding job record in DB                           │
│  • Returns job_id to client immediately                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   GEOCODING JOB MANAGER                         │
│  • Retrieves addresses from voters table                        │
│  • Processes in batches (100 records at a time)                 │
│  • Updates job progress in DB                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
┌────────────────────────────┐  ┌──────────────────────────┐
│  ADDRESS CACHE SERVICE     │  │  GEOCODING SERVICE       │
│  • Normalizes address      │  │  • Google Maps Client    │
│  • Generates cache key     │  │  • Rate limiter          │
│  • Checks cache table      │  │  • Retry logic           │
│  • Returns if cached       │  │  • Quality scoring       │
└────────────────────────────┘  └──────────────────────────┘
                 │                       │
                 │ CACHE MISS            │
                 └───────────┬───────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 GOOGLE MAPS GEOCODING API                       │
│  • Geocodes address with component filtering                   │
│  • Returns lat/lng, formatted_address, quality metadata        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RESULT PROCESSOR                             │
│  • Calculates quality score (0-100)                             │
│  • Updates voters table (lat, lng, quality)                     │
│  • Inserts/updates geocoding_cache                              │
│  • Logs errors to geocoding_errors table                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DATABASE PERSISTENCE                           │
│  • voters: Stores coordinates and quality score                 │
│  • geocoding_cache: Caches all successful geocodes             │
│  • geocoding_jobs: Tracks batch job progress                   │
│  • geocoding_errors: Logs failures for review                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Service Layer Design

**Three Core Services:**

#### 3.2.1 GeocodingService (`backend/services/geocoding-service.js`)
**Responsibilities:**
- Interface with Google Maps Geocoding API
- Enforce rate limiting (configurable requests per second)
- Implement retry logic with exponential backoff
- Parse API responses and extract relevant data
- Calculate quality scores based on location_type and partial_match
- Handle all API error codes appropriately

**Key Methods:**
```javascript
class GeocodingService {
  async geocodeAddress(address, components = {})  // Single address geocoding
  async geocodeBatch(addresses[])                 // Batch processing with delays
  calculateQualityScore(response)                  // Quality scoring algorithm
  isRetryableError(error)                         // Determine if error is transient
}
```

#### 3.2.2 AddressCacheService (`backend/services/address-cache-service.js`)
**Responsibilities:**
- Normalize addresses for consistent cache key generation
- Generate hash keys for address matching
- Check cache for existing geocoding results
- Store new geocoding results in cache
- Implement cache TTL (time-to-live) logic
- Provide cache statistics and hit rate metrics

**Key Methods:**
```javascript
class AddressCacheService {
  normalizeAddress(address, city, state, zip)     // Address normalization
  generateCacheKey(normalizedAddress)             // Hash key generation (MD5/SHA256)
  async getCached(cacheKey)                       // Cache lookup
  async setCached(cacheKey, geocodeResult)        // Cache storage
  async getStats()                                 // Cache performance metrics
  async invalidateExpired(ttlDays)                // Remove old cache entries
}
```

#### 3.2.3 GeocodingJobService (`backend/services/geocoding-job-service.js`)
**Responsibilities:**
- Create and manage geocoding batch jobs
- Process addresses in configurable batch sizes
- Track job progress (total, processed, success, failed)
- Update job status in real-time
- Handle job resumption after failures
- Prevent concurrent jobs from exceeding rate limits

**Key Methods:**
```javascript
class GeocodingJobService {
  async createJob(voterIds[], options = {})       // Initialize new job
  async processJob(jobId)                         // Execute geocoding job
  async getJobStatus(jobId)                       // Get current progress
  async cancelJob(jobId)                          // Stop running job
  async getFailedAddresses(jobId)                 // Retrieve failed records
  async retryFailed(jobId)                        // Retry only failed addresses
}
```

### 3.3 Data Flow Diagram

**Geocoding Pipeline Flow:**

```
1. TRIGGER: Batch job created via API or post-import hook
   ↓
2. FETCH VOTERS: Query voters table WHERE latitude IS NULL LIMIT batch_size
   ↓
3. FOR EACH ADDRESS:
   a. Normalize address → "123 main st|union city|tn|38261"
   b. Generate cache key → MD5("123 main st|union city|tn|38261")
   c. Check geocoding_cache WHERE address_hash = cache_key
   ↓
4. IF CACHED:
   a. Use cached lat/lng and quality score
   b. Update voters table
   c. Increment cache_hits counter
   ↓
5. IF NOT CACHED:
   a. Call Google Maps API with address components
   b. Apply rate limiting delay (100ms default)
   c. Parse response and calculate quality score
   d. Store in geocoding_cache
   e. Update voters table
   f. Increment api_calls counter
   ↓
6. ERROR HANDLING:
   a. IF transient error (rate limit, timeout):
      - Exponential backoff retry (3 attempts max)
   b. IF permanent error (ZERO_RESULTS, INVALID_REQUEST):
      - Log to geocoding_errors table
      - Mark voter.geocoding_quality = 'FAILED'
   ↓
7. UPDATE JOB STATUS:
   a. Increment processed_count
   b. Update success_count or failed_count
   c. Calculate progress percentage
   ↓
8. COMPLETION:
   a. Set job.status = 'COMPLETED'
   b. Set job.end_time = NOW()
   c. Return final statistics
```

### 3.4 Integration with Existing Codebase

**Import Process Integration:**
- Modify `backend/services/import-processor.js`:
  - After successful voter insertion, optionally trigger geocoding
  - Add `geocodeAfterImport` option (default: false for manual control)
  - Update import log with geocoding job ID

**Voter Routes Enhancement:**
- Modify `backend/routes/voters.js`:
  - Include geocoding status in `GET /api/voters/:id` response
  - Add geocoding metadata: `geocoded`, `geocoding_quality`, `geocoded_at`

**Database Transaction Coordination:**
- Use existing `database.transaction()` wrapper for geocoding batch updates
- Ensures atomic updates: voters table + geocoding_cache + geocoding_jobs

---

## 4. Google Maps API Integration

### 4.1 Google Maps Client Setup

**Package:** `@googlemaps/google-maps-services-js` (Official Node.js client)

**Installation:**
```bash
npm install @googlemaps/google-maps-services-js
```

**Initialization:**
```javascript
const { Client } = require('@googlemaps/google-maps-services-js');

class GeocodingService {
  constructor() {
    this.client = new Client({});
    this.apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
    this.rateLimit = parseInt(process.env.GEOCODING_RATE_LIMIT) || 10; // RPS
    this.delayMs = parseInt(process.env.GEOCODING_DELAY_MS) || 100;
    this.lastRequestTime = 0;
  }
}
```

### 4.2 API Request Format

**Structured Request (Recommended):**
```javascript
const response = await this.client.geocode({
  params: {
    address: `${address}`,
    components: {
      locality: city,           // City name
      administrative_area: 'TN', // Tennessee
      postal_code: zipCode,
      country: 'US'
    },
    region: 'us',               // Bias results to United States
    key: this.apiKey,
  },
  timeout: 5000                 // 5 second timeout
});
```

**Alternative: Simple String Request (Fallback):**
```javascript
const response = await this.client.geocode({
  params: {
    address: `${address}, ${city}, TN ${zipCode}, USA`,
    key: this.apiKey,
  },
  timeout: 5000
});
```

### 4.3 Response Structure

**Successful Response:**
```json
{
  "status": "OK",
  "results": [
    {
      "formatted_address": "123 Main St, Union City, TN 38261, USA",
      "geometry": {
        "location": {
          "lat": 36.4243039,
          "lng": -89.0576172
        },
        "location_type": "ROOFTOP",  // ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE
        "viewport": { ... }
      },
      "place_id": "ChIJd8BlQ2BZayARwu7id9PHdA0",
      "address_components": [
        { "long_name": "123", "short_name": "123", "types": ["street_number"] },
        { "long_name": "Main Street", "short_name": "Main St", "types": ["route"] },
        { "long_name": "Union City", "short_name": "Union City", "types": ["locality"] },
        { "long_name": "Tennessee", "short_name": "TN", "types": ["administrative_area_level_1"] },
        { "long_name": "38261", "short_name": "38261", "types": ["postal_code"] }
      ],
      "partial_match": false,  // IMPORTANT: true if only partial address matched
      "types": ["street_address"]
    }
  ]
}
```

### 4.4 Rate Limiting Implementation

**Strategy:** Token bucket algorithm with time-based delay

```javascript
async enforceRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - this.lastRequestTime;
  
  // Calculate required delay based on rate limit (RPS)
  const minDelay = 1000 / this.rateLimit; // milliseconds per request
  
  if (timeSinceLastRequest < minDelay) {
    const delay = minDelay - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  this.lastRequestTime = Date.now();
}

async geocodeAddress(address, components) {
  await this.enforceRateLimit();  // Enforce before each request
  
  const response = await this.client.geocode({ ... });
  return response;
}
```

**Alternative:** Use `bottleneck` npm package for advanced rate limiting
```javascript
const Bottleneck = require('bottleneck');

const limiter = new Bottleneck({
  maxConcurrent: 1,              // One request at a time
  minTime: 100,                  // Minimum 100ms between requests
  reservoir: 50,                  // Max 50 requests
  reservoirRefreshAmount: 50,    // Refill to 50
  reservoirRefreshInterval: 1000 // Every 1 second (50 RPS)
});
```

### 4.5 Error Code Handling

| Error Code | Meaning | Action |
|------------|---------|--------|
| `OK` | Success | Process results normally |
| `ZERO_RESULTS` | Address not found | Log to errors table, mark as FAILED |
| `OVER_QUERY_LIMIT` | Rate limit exceeded | Exponential backoff retry |
| `REQUEST_DENIED` | Invalid API key or billing issue | Stop job, alert admin |
| `INVALID_REQUEST` | Malformed request | Log error, skip address |
| `UNKNOWN_ERROR` | Server error | Retry with exponential backoff |

**Implementation:**
```javascript
async handleApiError(error, address) {
  const status = error.response?.data?.status;
  
  switch (status) {
    case 'ZERO_RESULTS':
      return { success: false, reason: 'ADDRESS_NOT_FOUND', retry: false };
    
    case 'OVER_QUERY_LIMIT':
      return { success: false, reason: 'RATE_LIMIT', retry: true };
    
    case 'REQUEST_DENIED':
      throw new Error('API key invalid or billing disabled - STOP JOB');
    
    case 'INVALID_REQUEST':
      return { success: false, reason: 'INVALID_ADDRESS', retry: false };
    
    case 'UNKNOWN_ERROR':
    default:
      return { success: false, reason: 'API_ERROR', retry: true };
  }
}
```

### 4.6 Quota Management

**Monitoring API Usage:**
```javascript
class QuotaTracker {
  async incrementUsage(date = new Date()) {
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    await database.run(`
      INSERT INTO api_quotas (date, service, request_count) 
      VALUES (?, 'geocoding', 1)
      ON CONFLICT(date, service) 
      DO UPDATE SET request_count = request_count + 1
    `, [dateKey]);
  }
  
  async getDailyUsage(date) {
    const result = await database.get(`
      SELECT request_count FROM api_quotas 
      WHERE date = ? AND service = 'geocoding'
    `, [date]);
    
    return result?.request_count || 0;
  }
  
  async checkQuotaLimit(dailyLimit = 10000) {
    const today = new Date().toISOString().split('T')[0];
    const usage = await this.getDailyUsage(today);
    
    if (usage >= dailyLimit) {
      throw new Error(`Daily quota limit reached: ${usage}/${dailyLimit}`);
    }
  }
}
```

**New Database Table: `api_quotas`**
```sql
CREATE TABLE IF NOT EXISTS api_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  service TEXT NOT NULL,
  request_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, service)
);

CREATE INDEX idx_quotas_date ON api_quotas(date, service);
```

### 4.7 Cost Estimation

**Pricing (as of 2026):**
- Google Maps Geocoding: $5.00 per 1,000 requests
- Free tier: 100,000 requests/month (after $200 monthly credit)

**Voter Platform Estimates:**
- Assumption: 10,000 voter addresses
- Cache hit rate: 90% (after initial geocoding)
- Initial run: 10,000 API calls = $50.00
- Subsequent imports (90% cached): 1,000 API calls = $5.00

**Cost Optimization via Caching:**
- Without cache: 10,000 voters × 12 imports/year = 120,000 calls/year = $600/year
- With 90% cache hit rate: 12,000 calls/year = $60/year
- **Savings: $540/year (90% reduction)**

---

## 5. Address Cache Implementation

### 5.1 Cache Table Schema

**Existing Schema (from `scripts/setup.js`):**
```sql
CREATE TABLE IF NOT EXISTS geocoding_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address_hash TEXT UNIQUE NOT NULL,
    original_address TEXT NOT NULL,
    formatted_address TEXT,
    latitude REAL,
    longitude REAL,
    quality_score REAL,
    place_id TEXT,
    components TEXT, -- JSON string of address components
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geocoding_hash ON geocoding_cache(address_hash);
```

**Schema Analysis:**
- ✅ `address_hash` for fast lookups (UNIQUE index)
- ✅ `original_address` for display/debugging
- ✅ `formatted_address` from Google (normalized by Google)
- ✅ `latitude`, `longitude` for coordinates
- ✅ `quality_score` for quality assessment
- ✅ `place_id` for future reference
- ✅ `components` for detailed address parts (JSON string)
- ✅ `cached_at` for TTL management

**No schema changes needed!** Existing table is perfect.

### 5.2 Address Normalization Algorithm

**Goal:** Transform addresses into consistent format for cache key matching

**Normalization Steps:**
1. Trim leading/trailing whitespace
2. Convert to lowercase
3. Remove punctuation (except hyphens)
4. Normalize common abbreviations (Street → st, Avenue → ave)
5. Remove extra spaces (multiple spaces → single space)
6. Standardize directional prefixes (North → n, Southwest → sw)

**Implementation:**
```javascript
class AddressCacheService {
  /**
   * Normalize address for consistent cache key generation
   */
  normalizeAddress(rawAddress, city, state, zipCode) {
    // Helper: Normalize single component
    const normalizeComponent = (str) => {
      if (!str) return '';
      
      return str
        .toString()
        .toLowerCase()
        .trim()
        // Remove punctuation except hyphens
        .replace(/[^\w\s-]/g, '')
        // Normalize common street abbreviations
        .replace(/\bstreet\b/g, 'st')
        .replace(/\bavenue\b/g, 'ave')
        .replace(/\bdrive\b/g, 'dr')
        .replace(/\broad\b/g, 'rd')
        .replace(/\bcourt\b/g, 'ct')
        .replace(/\blane\b/g, 'ln')
        .replace(/\bblvd\b/g, 'blvd')
        .replace(/\bapartment\b/g, 'apt')
        .replace(/\bsuite\b/g, 'ste')
        // Normalize directional prefixes
        .replace(/\bnorth\b/g, 'n')
        .replace(/\bsouth\b/g, 's')
        .replace(/\beast\b/g, 'e')
        .replace(/\bwest\b/g, 'w')
        .replace(/\bnortheast\b/g, 'ne')
        .replace(/\bnorthwest\b/g, 'nw')
        .replace(/\bsoutheast\b/g, 'se')
        .replace(/\bsouthwest\b/g, 'sw')
        // Remove extra whitespace
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    // Normalize each component
    const normalizedStreet = normalizeComponent(rawAddress);
    const normalizedCity = normalizeComponent(city);
    const normalizedState = normalizeComponent(state);
    const normalizedZip = normalizeComponent(zipCode);
    
    // Combine into cache key format: "street|city|state|zip"
    return `${normalizedStreet}|${normalizedCity}|${normalizedState}|${normalizedZip}`;
  }
  
  /**
   * Generate hash for cache key (MD5 is sufficient)
   */
  generateCacheKey(normalizedAddress) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(normalizedAddress).digest('hex');
  }
}
```

**Example Normalization:**
```
Input:   "123 North Main Street", "Union City", "TN", "38261"
Normalized: "123 n main st|union city|tn|38261"
Hash:    "a3f2b9c1d4e5f6a7b8c9d0e1f2a3b4c5"
```

### 5.3 Cache Lookup Flow

```javascript
async getCachedGeocode(address, city, state, zipCode) {
  // Step 1: Normalize address
  const normalized = this.normalizeAddress(address, city, state, zipCode);
  
  // Step 2: Generate cache key
  const cacheKey = this.generateCacheKey(normalized);
  
  // Step 3: Query cache
  const cached = await database.get(`
    SELECT 
      latitude,
      longitude,
      quality_score,
      formatted_address,
      place_id,
      components,
      cached_at
    FROM geocoding_cache
    WHERE address_hash = ?
  `, [cacheKey]);
  
  if (!cached) {
    return null; // Cache miss
  }
  
  // Step 4: Check if cache entry is expired (optional TTL)
  const cacheTtlDays = parseInt(process.env.CACHE_TTL_DAYS) || 90;
  const cacheAge = (Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60 * 24);
  
  if (cacheAge > cacheTtlDays) {
    // Cache expired - treat as miss
    await this.invalidateCacheEntry(cacheKey);
    return null;
  }
  
  // Step 5: Return cached result
  return {
    latitude: cached.latitude,
    longitude: cached.longitude,
    quality_score: cached.quality_score,
    formatted_address: cached.formatted_address,
    place_id: cached.place_id,
    components: cached.components ? JSON.parse(cached.components) : null,
    source: 'cache'
  };
}
```

### 5.4 Cache Storage

```javascript
async setCachedGeocode(address, city, state, zipCode, geocodeResult) {
  const normalized = this.normalizeAddress(address, city, state, zipCode);
  const cacheKey = this.generateCacheKey(normalized);
  
  const originalAddress = `${address}, ${city}, ${state} ${zipCode}`;
  
  // UPSERT (INSERT OR REPLACE) to handle duplicates
  await database.run(`
    INSERT INTO geocoding_cache (
      address_hash,
      original_address,
      formatted_address,
      latitude,
      longitude,
      quality_score,
      place_id,
      components,
      cached_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(address_hash) 
    DO UPDATE SET
      formatted_address = excluded.formatted_address,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      quality_score = excluded.quality_score,
      place_id = excluded.place_id,
      components = excluded.components,
      cached_at = CURRENT_TIMESTAMP
  `, [
    cacheKey,
    originalAddress,
    geocodeResult.formatted_address,
    geocodeResult.latitude,
    geocodeResult.longitude,
    geocodeResult.quality_score,
    geocodeResult.place_id,
    JSON.stringify(geocodeResult.components)
  ]);
}
```

### 5.5 Cache Statistics

```javascript
async getCacheStats() {
  const totalCached = await database.get(`
    SELECT COUNT(*) as count FROM geocoding_cache
  `);
  
  const avgQualityScore = await database.get(`
    SELECT AVG(quality_score) as avg_score FROM geocoding_cache
  `);
  
  const lastUpdate = await database.get(`
    SELECT MAX(cached_at) as last_update FROM geocoding_cache
  `);
  
  // Calculate cache hit rate from recent job
  const recentJob = await database.get(`
    SELECT cache_hits, api_calls FROM geocoding_jobs 
    ORDER BY created_at DESC LIMIT 1
  `);
  
  const hitRate = recentJob 
    ? ((recentJob.cache_hits / (recentJob.cache_hits + recentJob.api_calls)) * 100).toFixed(2)
    : 0;
  
  return {
    total_cached: totalCached.count,
    average_quality_score: avgQualityScore.avg_score ? avgQualityScore.avg_score.toFixed(2) : 0,
    last_update: lastUpdate.last_update,
    cache_hit_rate_percent: hitRate
  };
}
```

### 5.6 Cache Invalidation

**Manual Invalidation (Admin Tool):**
```javascript
async invalidateExpiredCache(ttlDays = 90) {
  const result = await database.run(`
    DELETE FROM geocoding_cache
    WHERE julianday('now') - julianday(cached_at) > ?
  `, [ttlDays]);
  
  return result.changes; // Number of deleted entries
}

async invalidateByQuality(minQualityScore = 50) {
  const result = await database.run(`
    DELETE FROM geocoding_cache
    WHERE quality_score < ?
  `, [minQualityScore]);
  
  return result.changes;
}
```

---

## 6. Geocoding Pipeline Design

### 6.1 Batch Processing Workflow

**High-Level Steps:**

1. **Job Creation**
   - Validate input (voter IDs or address objects)
   - Create job record in `geocoding_jobs` table
   - Return job ID to client
   - Trigger async processing

2. **Address Retrieval**
   - Query voters table for addresses needing geocoding
   - Filter: `WHERE latitude IS NULL OR geocoding_quality IS NULL`
   - Limit by batch size (default: 100)

3. **Batch Processing Loop**
   - Process addresses in chunks (e.g., 100 at a time)
   - For each address:
     - Check cache (high priority)
     - If cache miss, call Google Maps API
     - Apply rate limiting delay
     - Handle errors with retry logic
     - Update voters table
     - Update cache table
   - Update job progress after each chunk

4. **Completion**
   - Set job status to COMPLETED or FAILED
   - Calculate final statistics
   - Optionally trigger notification/webhook

### 6.2 Geocoding Job Table Schema

**New Table: `geocoding_jobs`**
```sql
CREATE TABLE IF NOT EXISTS geocoding_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED
  total_records INTEGER NOT NULL,
  processed_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  estimated_completion DATETIME,
  last_processed_id INTEGER, -- Resume point for interrupted jobs
  options TEXT, -- JSON string of job options (batch_size, rate_limit, etc.)
  created_by TEXT, -- User or system identifier
  error_message TEXT
);

CREATE INDEX idx_geocoding_jobs_status ON geocoding_jobs(status);
```

### 6.3 Job Processing Logic

**GeocodingJobService.processJob() Implementation:**

```javascript
async processJob(jobId) {
  try {
    // Update status to PROCESSING
    await database.run(`
      UPDATE geocoding_jobs 
      SET status = 'PROCESSING', start_time = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [jobId]);
    
    // Get job details
    const job = await database.get('SELECT * FROM geocoding_jobs WHERE id = ?', [jobId]);
    const options = JSON.parse(job.options || '{}');
    const batchSize = options.batch_size || 100;
    
    // Initialize services
    const geocodingService = new GeocodingService();
    const cacheService = new AddressCacheService();
    
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let cacheHits = 0;
    let apiCalls = 0;
    
    // Process in batches until all addresses are geocoded
    while (processedCount < job.total_records) {
      // Fetch next batch of addresses
      const voters = await database.all(`
        SELECT id, voter_id, address, city, zip_code
        FROM voters
        WHERE latitude IS NULL
        LIMIT ?
      `, [batchSize]);
      
      if (voters.length === 0) break; // No more addresses to process
      
      // Process each voter in the batch
      for (const voter of voters) {
        try {
          // Step 1: Check cache
          const cached = await cacheService.getCachedGeocode(
            voter.address, 
            voter.city, 
            'TN',  // Hardcoded for Obion County, TN
            voter.zip_code
          );
          
          let geocodeResult;
          
          if (cached) {
            // Use cached result
            geocodeResult = cached;
            cacheHits++;
          } else {
            // Step 2: Call Google Maps API
            geocodeResult = await geocodingService.geocodeAddress(
              voter.address,
              { locality: voter.city, postal_code: voter.zip_code }
            );
            apiCalls++;
            
            // Step 3: Store in cache
            if (geocodeResult.success) {
              await cacheService.setCachedGeocode(
                voter.address,
                voter.city,
                'TN',
                voter.zip_code,
                geocodeResult
              );
            }
          }
          
          // Step 4: Update voter record
          if (geocodeResult.success) {
            await database.run(`
              UPDATE voters
              SET latitude = ?, longitude = ?, geocoding_quality = ?
              WHERE id = ?
            `, [
              geocodeResult.latitude,
              geocodeResult.longitude,
              geocodeResult.quality_score,
              voter.id
            ]);
            successCount++;
          } else {
            // Log error
            await this.logGeocodingError(jobId, voter, geocodeResult.error);
            failedCount++;
          }
          
        } catch (error) {
          // Handle individual address errors
          console.error(`Error geocoding voter ${voter.id}:`, error);
          await this.logGeocodingError(jobId, voter, error.message);
          failedCount++;
        }
        
        processedCount++;
        
        // Update job progress every 10 records
        if (processedCount % 10 === 0) {
          await this.updateJobProgress(jobId, {
            processed_count: processedCount,
            success_count: successCount,
            failed_count: failedCount,
            cache_hits: cacheHits,
            api_calls: apiCalls
          });
        }
      }
      
      // Small delay between batches to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Final job update
    await database.run(`
      UPDATE geocoding_jobs
      SET status = 'COMPLETED',
          end_time = CURRENT_TIMESTAMP,
          processed_count = ?,
          success_count = ?,
          failed_count = ?,
          cache_hits = ?,
          api_calls = ?
      WHERE id = ?
    `, [processedCount, successCount, failedCount, cacheHits, apiCalls, jobId]);
    
    return {
      success: true,
      jobId,
      processedCount,
      successCount,
      failedCount,
      cacheHits,
      apiCalls
    };
    
  } catch (error) {
    // Job-level error
    await database.run(`
      UPDATE geocoding_jobs
      SET status = 'FAILED', error_message = ?, end_time = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [error.message, jobId]);
    
    throw error;
  }
}
```

### 6.4 Error Handling and Retry Logic

**Exponential Backoff Implementation:**

```javascript
async geocodeWithRetry(address, components, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await this.geocodeAddress(address, components);
      return result; // Success
      
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const errorInfo = await this.handleApiError(error, address);
      
      if (!errorInfo.retry) {
        // Permanent error, don't retry
        return {
          success: false,
          error: errorInfo.reason,
          retry: false
        };
      }
      
      // Calculate exponential backoff delay
      const baseDelay = 1000; // 1 second
      const maxDelay = 60000; // 60 seconds
      const jitter = Math.random() * 1000; // 0-1 second jitter
      
      const delay = Math.min(
        maxDelay,
        baseDelay * Math.pow(2, attempt) + jitter
      );
      
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // All retries exhausted
  return {
    success: false,
    error: lastError.message,
    retry: false
  };
}
```

**Error Logging Table:**

**New Table: `geocoding_errors`**
```sql
CREATE TABLE IF NOT EXISTS geocoding_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  voter_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  error_type TEXT, -- ZERO_RESULTS, RATE_LIMIT, API_ERROR, etc.
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES geocoding_jobs(id),
  FOREIGN KEY (voter_id) REFERENCES voters(id)
);

CREATE INDEX idx_geocoding_errors_job ON geocoding_errors(job_id);
CREATE INDEX idx_geocoding_errors_type ON geocoding_errors(error_type);
```

### 6.5 Progress Tracking

**Real-Time Progress Calculation:**

```javascript
async getJobStatus(jobId) {
  const job = await database.get(`
    SELECT * FROM geocoding_jobs WHERE id = ?
  `, [jobId]);
  
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }
  
  // Calculate progress percentage
  const progress = job.total_records > 0
    ? ((job.processed_count / job.total_records) * 100).toFixed(2)
    : 0;
  
  // Calculate estimated time remaining
  let estimatedCompletion = null;
  if (job.status === 'PROCESSING' && job.processed_count > 0) {
    const elapsedMs = new Date() - new Date(job.start_time);
    const recordsRemaining = job.total_records - job.processed_count;
    const avgTimePerRecord = elapsedMs / job.processed_count;
    const estimatedRemainingMs = recordsRemaining * avgTimePerRecord;
    
    estimatedCompletion = new Date(Date.now() + estimatedRemainingMs);
  }
  
  // Get recent errors
  const recentErrors = await database.all(`
    SELECT error_type, COUNT(*) as count
    FROM geocoding_errors
    WHERE job_id = ?
    GROUP BY error_type
  `, [jobId]);
  
  return {
    jobId: job.id,
    status: job.status,
    progress: parseFloat(progress),
    total: job.total_records,
    processed: job.processed_count,
    successful: job.success_count,
    failed: job.failed_count,
    cacheHits: job.cache_hits,
    apiCalls: job.api_calls,
    startTime: job.start_time,
    endTime: job.end_time,
    estimatedCompletion,
    errors: recentErrors
  };
}
```

### 6.6 Queue Management

**Prevent Concurrent Jobs:**

```javascript
async createJob(voterIds, options = {}) {
  // Check for active jobs
  const activeJobs = await database.get(`
    SELECT COUNT(*) as count FROM geocoding_jobs
    WHERE status IN ('PENDING', 'PROCESSING')
  `);
  
  if (activeJobs.count > 0) {
    throw new Error('Another geocoding job is already in progress. Please wait for completion.');
  }
  
  // Create new job
  const result = await database.run(`
    INSERT INTO geocoding_jobs (
      total_records, 
      options, 
      created_by
    ) VALUES (?, ?, ?)
  `, [
    voterIds.length,
    JSON.stringify(options),
    options.created_by || 'system'
  ]);
  
  const jobId = result.lastID;
  
  // Trigger async processing (don't await)
  setImmediate(() => {
    this.processJob(jobId).catch(err => {
      console.error(`Job ${jobId} failed:`, err);
    });
  });
  
  return jobId;
}
```

---

## 7. Database Schema Changes

### 7.1 New Tables Required

#### Table 1: `geocoding_jobs`
**Purpose:** Track batch geocoding job progress and status

```sql
CREATE TABLE IF NOT EXISTS geocoding_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT DEFAULT 'PENDING',
  total_records INTEGER NOT NULL,
  processed_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  estimated_completion DATETIME,
  last_processed_id INTEGER,
  options TEXT,
  created_by TEXT,
  error_message TEXT
);

CREATE INDEX idx_geocoding_jobs_status ON geocoding_jobs(status);
```

#### Table 2: `geocoding_errors`
**Purpose:** Log failed geocoding attempts for manual review

```sql
CREATE TABLE IF NOT EXISTS geocoding_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  voter_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  zip_code TEXT,
  error_type TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES geocoding_jobs(id),
  FOREIGN KEY (voter_id) REFERENCES voters(id)
);

CREATE INDEX idx_geocoding_errors_job ON geocoding_errors(job_id);
CREATE INDEX idx_geocoding_errors_type ON geocoding_errors(error_type);
CREATE INDEX idx_geocoding_errors_voter ON geocoding_errors(voter_id);
```

#### Table 3: `api_quotas`
**Purpose:** Track daily API usage for quota monitoring

```sql
CREATE TABLE IF NOT EXISTS api_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  service TEXT NOT NULL,
  request_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, service)
);

CREATE INDEX idx_quotas_date ON api_quotas(date, service);
```

### 7.2 Modifications to Existing Tables

**No modifications needed!** The existing `voters` and `geocoding_cache` tables already have all required columns.

**Verification:**

```sql
-- Voters table already has:
-- - latitude REAL
-- - longitude REAL
-- - geocoding_quality TEXT

-- Geocoding cache table already has:
-- - address_hash TEXT UNIQUE
-- - original_address TEXT
-- - formatted_address TEXT
-- - latitude REAL
-- - longitude REAL
-- - quality_score REAL
-- - place_id TEXT
-- - components TEXT
-- - cached_at DATETIME
```

### 7.3 Database Migration Script

**File:** `backend/migrations/003_add_geocoding_tables.js`

```javascript
const database = require('../config/database');

async function migrate() {
  console.log('Running migration: Add geocoding job tracking tables...');
  
  await database.run(`
    CREATE TABLE IF NOT EXISTS geocoding_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'PENDING',
      total_records INTEGER NOT NULL,
      processed_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      cache_hits INTEGER DEFAULT 0,
      api_calls INTEGER DEFAULT 0,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      estimated_completion DATETIME,
      last_processed_id INTEGER,
      options TEXT,
      created_by TEXT,
      error_message TEXT
    )
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_geocoding_jobs_status 
    ON geocoding_jobs(status)
  `);
  
  await database.run(`
    CREATE TABLE IF NOT EXISTS geocoding_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      voter_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      city TEXT,
      zip_code TEXT,
      error_type TEXT,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES geocoding_jobs(id),
      FOREIGN KEY (voter_id) REFERENCES voters(id)
    )
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_geocoding_errors_job 
    ON geocoding_errors(job_id)
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_geocoding_errors_type 
    ON geocoding_errors(error_type)
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_geocoding_errors_voter 
    ON geocoding_errors(voter_id)
  `);
  
  await database.run(`
    CREATE TABLE IF NOT EXISTS api_quotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      service TEXT NOT NULL,
      request_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, service)
    )
  `);
  
  await database.run(`
    CREATE INDEX IF NOT EXISTS idx_quotas_date 
    ON api_quotas(date, service)
  `);
  
  console.log('✅ Migration completed successfully');
}

// Run migration
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    });
}

module.exports = migrate;
```

**Integrate into setup.js:**
```javascript
// In scripts/setup.js, after main schema creation:
const geocodingMigration = require('../backend/migrations/003_add_geocoding_tables');
await geocodingMigration();
```

---

## 8. API Endpoints Design

### 8.1 POST /api/geocode/batch

**Purpose:** Trigger batch geocoding for multiple voters

**Request:**
```json
{
  "voterIds": [1, 2, 3, 4, 5],  // Array of voter IDs to geocode
  "options": {
    "batchSize": 100,             // Optional: records per batch (default: 100)
    "rateLimit": 10,              // Optional: requests per second (default: 10)
    "skipCached": false           // Optional: re-geocode even if cached (default: false)
  }
}
```

**Alternative Request (All Ungecoded Voters):**
```json
{
  "all": true,  // Geocode all voters where latitude IS NULL
  "options": { ... }
}
```

**Response:**
```json
{
  "success": true,
  "jobId": 42,
  "message": "Geocoding job started",
  "totalRecords": 5,
  "estimatedDuration": "30 seconds",
  "statusUrl": "/api/geocode/status/42"
}
```

**Implementation:**
```javascript
router.post('/batch', async (req, res, next) => {
  try {
    const { voterIds, all, options = {} } = req.body;
    
    // Validation
    if (!voterIds && !all) {
      return res.status(400).json({
        success: false,
        error: 'Must provide voterIds array or all=true'
      });
    }
    
    let targetVoterIds = voterIds;
    
    // If "all" flag, get all ungecoded voters
    if (all) {
      const voters = await database.all(`
        SELECT id FROM voters WHERE latitude IS NULL
      `);
      targetVoterIds = voters.map(v => v.id);
    }
    
    if (targetVoterIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No voters to geocode'
      });
    }
    
    // Create geocoding job
    const jobService = new GeocodingJobService();
    const jobId = await jobService.createJob(targetVoterIds, options);
    
    res.json({
      success: true,
      jobId,
      message: 'Geocoding job started',
      totalRecords: targetVoterIds.length,
      statusUrl: `/api/geocode/status/${jobId}`
    });
    
  } catch (error) {
    next(error);
  }
});
```

### 8.2 GET /api/geocode/status/:jobId

**Purpose:** Get real-time status of a geocoding job

**Request:**
```
GET /api/geocode/status/42
```

**Response (Processing):**
```json
{
  "success": true,
  "jobId": 42,
  "status": "PROCESSING",
  "progress": 45.5,
  "total": 1000,
  "processed": 455,
  "successful": 425,
  "failed": 30,
  "cacheHits": 380,
  "apiCalls": 45,
  "startTime": "2026-02-06T10:30:00Z",
  "estimatedCompletion": "2026-02-06T10:32:15Z",
  "errors": [
    { "error_type": "ZERO_RESULTS", "count": 25 },
    { "error_type": "API_ERROR", "count": 5 }
  ]
}
```

**Response (Completed):**
```json
{
  "success": true,
  "jobId": 42,
  "status": "COMPLETED",
  "progress": 100,
  "total": 1000,
  "processed": 1000,
  "successful": 970,
  "failed": 30,
  "cacheHits": 900,
  "apiCalls": 70,
  "startTime": "2026-02-06T10:30:00Z",
  "endTime": "2026-02-06T10:32:45Z",
  "duration": "2 minutes 45 seconds",
  "errors": [...]
}
```

**Implementation:**
```javascript
router.get('/status/:jobId', async (req, res, next) => {
  try {
    const jobService = new GeocodingJobService();
    const status = await jobService.getJobStatus(req.params.jobId);
    
    res.json({
      success: true,
      ...status
    });
    
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: `Job ${req.params.jobId} not found`
      });
    }
    next(error);
  }
});
```

### 8.3 POST /api/geocode/single

**Purpose:** Geocode a single address immediately (for testing or manual entry)

**Request:**
```json
{
  "address": "123 Main Street",
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
    "formatted_address": "123 Main St, Union City, TN 38261, USA",
    "latitude": 36.4243039,
    "longitude": -89.0576172,
    "quality_score": 100,
    "location_type": "ROOFTOP",
    "place_id": "ChIJd8BlQ2BZayARwu7id9PHdA0",
    "source": "api"  // or "cache"
  }
}
```

**Implementation:**
```javascript
router.post('/single', async (req, res, next) => {
  try {
    const { address, city, state, zipCode } = req.body;
    
    // Validation
    if (!address || !city || !zipCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: address, city, zipCode'
      });
    }
    
    // Check cache first
    const cacheService = new AddressCacheService();
    const cached = await cacheService.getCachedGeocode(address, city, state || 'TN', zipCode);
    
    if (cached) {
      return res.json({
        success: true,
        result: cached
      });
    }
    
    // Call geocoding API
    const geocodingService = new GeocodingService();
    const result = await geocodingService.geocodeAddress(address, {
      locality: city,
      administrative_area: state || 'TN',
      postal_code: zipCode
    });
    
    if (result.success) {
      // Cache the result
      await cacheService.setCachedGeocode(address, city, state || 'TN', zipCode, result);
      
      res.json({
        success: true,
        result
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
    
  } catch (error) {
    next(error);
  }
});
```

### 8.4 GET /api/geocode/failed/:jobId

**Purpose:** Retrieve all failed addresses from a job for manual review

**Request:**
```
GET /api/geocode/failed/42
```

**Response:**
```json
{
  "success": true,
  "jobId": 42,
  "failedCount": 30,
  "errors": [
    {
      "id": 1,
      "voter_id": 123,
      "address": "123 Unknown St",
      "city": "Union City",
      "zip_code": "38261",
      "error_type": "ZERO_RESULTS",
      "error_message": "Address not found by geocoding service",
      "retry_count": 3,
      "created_at": "2026-02-06T10:31:00Z"
    },
    ...
  ]
}
```

**Implementation:**
```javascript
router.get('/failed/:jobId', async (req, res, next) => {
  try {
    const errors = await database.all(`
      SELECT 
        ge.*,
        v.first_name,
        v.last_name
      FROM geocoding_errors ge
      JOIN voters v ON v.id = ge.voter_id
      WHERE ge.job_id = ?
      ORDER BY ge.created_at DESC
    `, [req.params.jobId]);
    
    res.json({
      success: true,
      jobId: parseInt(req.params.jobId),
      failedCount: errors.length,
      errors
    });
    
  } catch (error) {
    next(error);
  }
});
```

### 8.5 PUT /api/geocode/manual/:voterId

**Purpose:** Manually set coordinates for a voter (for failed geocoding)

**Request:**
```json
{
  "latitude": 36.4243039,
  "longitude": -89.0576172,
  "quality_score": 100,
  "note": "Manually geocoded using Google Maps web interface"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Manual geocoding saved for voter 123",
  "voter": {
    "id": 123,
    "latitude": 36.4243039,
    "longitude": -89.0576172,
    "geocoding_quality": "100 (Manual)"
  }
}
```

**Implementation:**
```javascript
router.put('/manual/:voterId', async (req, res, next) => {
  try {
    const { latitude, longitude, quality_score, note } = req.body;
    
    // Validation
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: latitude, longitude'
      });
    }
    
    // Validate coordinate ranges
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coordinate values'
      });
    }
    
    // Update voter
    await database.run(`
      UPDATE voters
      SET latitude = ?, 
          longitude = ?, 
          geocoding_quality = ?
      WHERE id = ?
    `, [
      latitude,
      longitude,
      `${quality_score || 100} (Manual)`,
      req.params.voterId
    ]);
    
    // Log manual geocoding
    await database.run(`
      INSERT INTO geocoding_errors (
        job_id, voter_id, address, error_type, error_message
      ) SELECT 
        0, id, address, 'MANUAL_OVERRIDE', ?
      FROM voters WHERE id = ?
    `, [note || 'Manual geocoding', req.params.voterId]);
    
    res.json({
      success: true,
      message: `Manual geocoding saved for voter ${req.params.voterId}`,
      voter: {
        id: parseInt(req.params.voterId),
        latitude,
        longitude,
        geocoding_quality: `${quality_score || 100} (Manual)`
      }
    });
    
  } catch (error) {
    next(error);
  }
});
```

### 8.6 GET /api/geocode/stats

**Purpose:** Get overall geocoding statistics

**Request:**
```
GET /api/geocode/stats
```

**Response:**
```json
{
  "success": true,
  "totalVoters": 10000,
  "geocodedVoters": 9500,
  "pendingVoters": 500,
  "geocodingProgress": 95.0,
  "averageQualityScore": 92.5,
  "cache": {
    "totalCached": 8500,
    "averageQuality": 93.2,
    "lastUpdate": "2026-02-06T10:00:00Z",
    "hitRate": 89.5
  },
  "recentJobs": [
    {
      "id": 42,
      "status": "COMPLETED",
      "processed": 1000,
      "successful": 970,
      "failed": 30,
      "startTime": "2026-02-06T10:30:00Z",
      "endTime": "2026-02-06T10:32:45Z"
    }
  ]
}
```

**Implementation:**
```javascript
router.get('/stats', async (req, res, next) => {
  try {
    const cacheService = new AddressCacheService();
    const cacheStats = await cacheService.getCacheStats();
    
    const totalVoters = await database.get(`
      SELECT COUNT(*) as count FROM voters
    `);
    
    const geocodedVoters = await database.get(`
      SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL
    `);
    
    const avgQuality = await database.get(`
      SELECT AVG(CAST(geocoding_quality AS REAL)) as avg 
      FROM voters 
      WHERE geocoding_quality IS NOT NULL 
        AND geocoding_quality NOT LIKE '%Manual%'
    `);
    
    const recentJobs = await database.all(`
      SELECT * FROM geocoding_jobs
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    res.json({
      success: true,
      totalVoters: totalVoters.count,
      geocodedVoters: geocodedVoters.count,
      pendingVoters: totalVoters.count - geocodedVoters.count,
      geocodingProgress: ((geocodedVoters.count / totalVoters.count) * 100).toFixed(1),
      averageQualityScore: avgQuality.avg ? parseFloat(avgQuality.avg).toFixed(2) : 0,
      cache: cacheStats,
      recentJobs
    });
    
  } catch (error) {
    next(error);
  }
});
```

### 8.7 POST /api/geocode/retry/:jobId

**Purpose:** Retry only failed addresses from a previous job

**Request:**
```json
{
  "errorTypes": ["ZERO_RESULTS", "API_ERROR"]  // Optional: filter by error type
}
```

**Response:**
```json
{
  "success": true,
  "newJobId": 43,
  "message": "Retry job created for 30 failed addresses",
  "statusUrl": "/api/geocode/status/43"
}
```

**Implementation:**
```javascript
router.post('/retry/:jobId', async (req, res, next) => {
  try {
    const { errorTypes } = req.body;
    
    // Get failed voter IDs from original job
    let query = `
      SELECT DISTINCT voter_id FROM geocoding_errors 
      WHERE job_id = ?
    `;
    let params = [req.params.jobId];
    
    if (errorTypes && errorTypes.length > 0) {
      query += ` AND error_type IN (${errorTypes.map(() => '?').join(',')})`;
      params.push(...errorTypes);
    }
    
    const failedVoters = await database.all(query, params);
    const voterIds = failedVoters.map(v => v.voter_id);
    
    if (voterIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No failed addresses to retry'
      });
    }
    
    // Create new job for retries
    const jobService = new GeocodingJobService();
    const newJobId = await jobService.createJob(voterIds, {
      created_by: 'retry_job',
      original_job_id: req.params.jobId
    });
    
    res.json({
      success: true,
      newJobId,
      message: `Retry job created for ${voterIds.length} failed addresses`,
      statusUrl: `/api/geocode/status/${newJobId}`
    });
    
  } catch (error) {
    next(error);
  }
});
```

---

## 9. Address Quality Assessment

### 9.1 Quality Scoring Algorithm

**Quality Score Scale:** 0-100 (higher is better)

**Scoring Factors:**

| Factor | Weight | Description |
|--------|--------|-------------|
| Location Type | 60% | ROOFTOP=100, RANGE_INTERPOLATED=80, GEOMETRIC_CENTER=60, APPROXIMATE=40 |
| Partial Match | -30% | If `partial_match=true`, deduct 30 points |
| Address Components | 20% | More specific components = higher score |
| Result Count | 10% | Single result = full points, multiple = reduced |
| Custom Validation | 10% | State/county verification |

**Implementation:**

```javascript
calculateQualityScore(geocodeResponse) {
  if (!geocodeResponse || !geocodeResponse.data || geocodeResponse.data.status !== 'OK') {
    return 0;
  }
  
  const result = geocodeResponse.data.results[0]; // Use first result
  let score = 0;
  
  // Factor 1: Location Type (60% weight)
  const locationType = result.geometry?.location_type;
  switch (locationType) {
    case 'ROOFTOP':
      score += 60;
      break;
    case 'RANGE_INTERPOLATED':
      score += 48; // 80% of 60
      break;
    case 'GEOMETRIC_CENTER':
      score += 36; // 60% of 60
      break;
    case 'APPROXIMATE':
      score += 24; // 40% of 60
      break;
    default:
      score += 20;
  }
  
  // Factor 2: Partial Match Penalty (30% deduction)
  if (result.partial_match === true) {
    score -= 30;
  }
  
  // Factor 3: Address Components Completeness (20% weight)
  const components = result.address_components || [];
  const requiredTypes = ['street_number', 'route', 'locality', 'administrative_area_level_1', 'postal_code'];
  const foundTypes = components.map(c => c.types).flat();
  const completeness = requiredTypes.filter(type => foundTypes.includes(type)).length / requiredTypes.length;
  score += completeness * 20;
  
  // Factor 4: Result Count (10% weight)
  const resultCount = geocodeResponse.data.results.length;
  if (resultCount === 1) {
    score += 10; // Perfect match
  } else if (resultCount <= 3) {
    score += 7;  // Good match
  } else {
    score += 4;  // Ambiguous
  }
  
  // Factor 5: State Validation (10% weight)
  const stateComponent = components.find(c => 
    c.types.includes('administrative_area_level_1') && c.short_name === 'TN'
  );
  if (stateComponent) {
    score += 10; // Correct state
  }
  
  // Clamp score to 0-100 range
  score = Math.max(0, Math.min(100, score));
  
  return Math.round(score);
}
```

### 9.2 Quality Thresholds and Actions

| Quality Score | Classification | Action |
|---------------|----------------|--------|
| 90-100 | Excellent | Auto-accept, use coordinates |
| 70-89 | Good | Auto-accept with warning flag |
| 50-69 | Fair | Flag for review, use with caution |
| 25-49 | Poor | Require manual verification |
| 0-24 | Failed | Reject, require manual geocoding |

**Implementation:**

```javascript
determineQualityAction(qualityScore) {
  if (qualityScore >= 90) {
    return {
      action: 'ACCEPT',
      classification: 'EXCELLENT',
      requiresReview: false,
      message: 'High confidence geocoding'
    };
  } else if (qualityScore >= 70) {
    return {
      action: 'ACCEPT',
      classification: 'GOOD',
      requiresReview: false,
      message: 'Acceptable geocoding quality'
    };
  } else if (qualityScore >= 50) {
    return {
      action: 'FLAG',
      classification: 'FAIR',
      requiresReview: true,
      message: 'Address geocoded but may be approximate'
    };
  } else if (qualityScore >= 25) {
    return {
      action: 'REVIEW',
      classification: 'POOR',
      requiresReview: true,
      message: 'Low confidence - manual review required'
    };
  } else {
    return {
      action: 'REJECT',
      classification: 'FAILED',
      requiresReview: true,
      message: 'Geocoding failed or very low quality'
    };
  }
}
```

### 9.3 Address Component Validation

**Validate Expected Components:**

```javascript
validateAddressComponents(geocodeResult, expectedAddress) {
  const components = geocodeResult.address_components || [];
  const validation = {
    valid: true,
    warnings: [],
    errors: []
  };
  
  // Check state
  const stateComponent = components.find(c => 
    c.types.includes('administrative_area_level_1')
  );
  if (!stateComponent || stateComponent.short_name !== 'TN') {
    validation.warnings.push('Address is not in Tennessee');
    validation.valid = false;
  }
  
  // Check ZIP code match (if provided)
  if (expectedAddress.zipCode) {
    const zipComponent = components.find(c => 
      c.types.includes('postal_code')
    );
    if (zipComponent && zipComponent.short_name !== expectedAddress.zipCode) {
      validation.warnings.push(`ZIP code mismatch: expected ${expectedAddress.zipCode}, got ${zipComponent.short_name}`);
    }
  }
  
  // Check city match
  if (expectedAddress.city) {
    const cityComponent = components.find(c => 
      c.types.includes('locality')
    );
    if (cityComponent && 
        cityComponent.long_name.toLowerCase() !== expectedAddress.city.toLowerCase()) {
      validation.warnings.push(`City mismatch: expected ${expectedAddress.city}, got ${cityComponent.long_name}`);
    }
  }
  
  // Check for PO Box (not geocodable)
  const streetComponent = components.find(c => c.types.includes('route'));
  if (streetComponent && /p\.?o\.?\s*box/i.test(streetComponent.long_name)) {
    validation.errors.push('PO Box addresses cannot be geocoded accurately');
    validation.valid = false;
  }
  
  return validation;
}
```

### 9.4 Flagging Problematic Addresses

**Update Voter Model to Track Flags:**

```sql
-- Add column to voters table (migration)
ALTER TABLE voters ADD COLUMN geocoding_flags TEXT;
```

**Store Validation Warnings:**

```javascript
async updateVoterWithGeocode(voterId, geocodeResult, qualityScore, validation) {
  const flags = [];
  
  if (validation.warnings.length > 0) {
    flags.push(...validation.warnings);
  }
  
  const qualityAction = this.determineQualityAction(qualityScore);
  if (qualityAction.requiresReview) {
    flags.push(`REVIEW_REQUIRED: ${qualityAction.message}`);
  }
  
  await database.run(`
    UPDATE voters
    SET latitude = ?,
        longitude = ?,
        geocoding_quality = ?,
        geocoding_flags = ?
    WHERE id = ?
  `, [
    geocodeResult.latitude,
    geocodeResult.longitude,
    qualityScore,
    flags.length > 0 ? JSON.stringify(flags) : null,
    voterId
  ]);
}
```

### 9.5 Manual Review Interface Requirements

**Frontend Component Needs:**

1. **Review Dashboard:**
   - List all voters with `geocoding_quality < 70`
   - Filter by error type (ZERO_RESULTS, POOR_QUALITY, etc.)
   - Sort by quality score (worst first)

2. **Detail View:**
   - Show original address
   - Show Google formatted address
   - Display map with pinned coordinates
   - Show quality score and flags
   - Show address components breakdown

3. **Manual Override:**
   - Allow drag-and-drop map pin adjustment
   - Text input for manual lat/lng entry
   - "Accept Google Result" button
   - "Mark as Ungeocadable" button
   - Notes field for manual corrections

4. **Batch Actions:**
   - "Accept All > 70 Quality" button
   - "Re-geocode Selected" button
   - "Export Failed Addresses" CSV

**API Endpoint for Review List:**

```javascript
router.get('/review/list', async (req, res, next) => {
  try {
    const { minQuality = 0, maxQuality = 70, limit = 100 } = req.query;
    
    const voters = await database.all(`
      SELECT 
        id,
        voter_id,
        first_name,
        last_name,
        address,
        city,
        zip_code,
        latitude,
        longitude,
        geocoding_quality,
        geocoding_flags
      FROM voters
      WHERE latitude IS NOT NULL
        AND CAST(geocoding_quality AS REAL) >= ?
        AND CAST(geocoding_quality AS REAL) <= ?
      ORDER BY CAST(geocoding_quality AS REAL) ASC
      LIMIT ?
    `, [minQuality, maxQuality, limit]);
    
    res.json({
      success: true,
      count: voters.length,
      voters: voters.map(v => ({
        ...v,
        flags: v.geocoding_flags ? JSON.parse(v.geocoding_flags) : []
      }))
    });
    
  } catch (error) {
    next(error);
  }
});
```

---

## 10. Implementation Steps

### 10.1 Phase 3A: Foundation (Week 1, Days 1-2)

**Tasks:**
1. ✅ **Install Dependencies**
   ```bash
   npm install @googlemaps/google-maps-services-js bottleneck
   ```

2. ✅ **Create Database Tables**
   - Run migration script: `node backend/migrations/003_add_geocoding_tables.js`
   - Verify tables: `geocoding_jobs`, `geocoding_errors`, `api_quotas`

3. ✅ **Environment Configuration**
   - Update `.env` with Google Maps API key:
     ```
     GOOGLE_MAPS_GEOCODING_API_KEY=your_actual_api_key
     GEOCODING_RATE_LIMIT=10
     GEOCODING_BATCH_SIZE=100
     ```

4. ✅ **Create Service Stubs**
   - `backend/services/geocoding-service.js` - Google Maps API wrapper
   - `backend/services/address-cache-service.js` - Cache management
   - `backend/services/geocoding-job-service.js` - Job orchestration

### 10.2 Phase 3B: Core Services (Week 1, Days 3-5)

**Tasks:**
1. **Implement GeocodingService**
   - Google Maps Client initialization
   - `geocodeAddress()` method with error handling
   - Rate limiting implementation (Bottleneck or custom)
   - Retry logic with exponential backoff
   - Quality score calculation
   - API error code handling

2. **Implement AddressCacheService**
   - Address normalization algorithm
   - Cache key generation (MD5 hash)
   - `getCachedGeocode()` method
   - `setCachedGeocode()` method
   - Cache statistics tracking
   - TTL invalidation logic

3. **Unit Tests for Services**
   - Test address normalization (various formats)
   - Test cache key generation (consistency)
   - Test quality score calculation (all scenarios)
   - Mock Google Maps API responses

### 10.3 Phase 3C: Job Management (Week 2, Days 1-3)

**Tasks:**
1. **Implement GeocodingJobService**
   - `createJob()` - Job initialization
   - `processJob()` - Main processing loop
   - `getJobStatus()` - Progress tracking
   - `cancelJob()` - Job cancellation
   - `retryFailed()` - Retry failed addresses

2. **Database Integration**
   - Transaction support for batch updates
   - Proper error logging to `geocoding_errors`
   - Job status state management
   - Progress calculation logic

3. **Integration Tests**
   - Test end-to-end job processing
   - Test cache hit/miss scenarios
   - Test error handling and retries
   - Test concurrent job prevention

### 10.4 Phase 3D: API Endpoints (Week 2, Days 4-5)

**Tasks:**
1. **Implement Route Handlers**
   - ✅ `POST /api/geocode/batch` - Batch geocoding
   - ✅ `GET /api/geocode/status/:jobId` - Job status
   - ✅ `POST /api/geocode/single` - Single address
   - ✅ `GET /api/geocode/failed/:jobId` - Failed addresses
   - ✅ `PUT /api/geocode/manual/:voterId` - Manual override
   - ✅ `GET /api/geocode/stats` - Overall statistics
   - ✅ `POST /api/geocode/retry/:jobId` - Retry failed
   - ✅ `GET /api/geocode/review/list` - Review dashboard

2. **Input Validation**
   - Use `express-validator` for all endpoints
   - Validate coordinate ranges
   - Validate job IDs exist
   - Validate voter IDs exist

3. **API Tests**
   - Integration tests for all endpoints
   - Test error responses (400, 404, 500)
   - Test concurrent job rejection
   - Test rate limiting behavior

### 10.5 Phase 3E: Import Integration (Week 3, Day 1)

**Tasks:**
1. **Modify import-processor.js**
   - Add optional `geocodeAfterImport` flag
   - Trigger geocoding job after successful import
   - Link import log ID to geocoding job

2. **Update Upload Routes**
   - Add checkbox option in upload form for auto-geocoding
   - Pass option to import processor

### 10.6 Phase 3F: Quality & Review (Week 3, Days 2-3)

**Tasks:**
1. **Implement Quality Assessment**
   - Quality scoring in geocoding service
   - Component validation logic
   - Flagging problematic addresses
   - Warning/error classification

2. **Manual Review Endpoints**
   - Review list API
   - Manual override API
   - Bulk accept/reject APIs

3. **Frontend Prep (API only)**
   - Document review interface requirements
   - Create API documentation for frontend team

### 10.7 Phase 3G: Testing & Optimization (Week 3, Days 4-5)

**Tasks:**
1. **Comprehensive Testing**
   - Unit tests: Services (90%+ coverage)
   - Integration tests: API endpoints
   - Performance tests: 1000+ address batch
   - Error handling tests: Network failures, rate limits

2. **Performance Optimization**
   - Database query optimization (EXPLAIN QUERY PLAN)
   - Index verification
   - Transaction batching
   - Memory usage profiling

3. **Documentation**
   - API endpoint documentation (Swagger/OpenAPI)
   - Service architecture diagrams
   - Deployment guide (API key setup)
   - Troubleshooting guide (common errors)

### 10.8 Deployment Checklist

**Pre-Deployment:**
- [ ] Google Maps API key configured in production `.env`
- [ ] Billing enabled on Google Cloud account
- [ ] Daily quota limits set (prevent cost overruns)
- [ ] Database migrations run successfully
- [ ] All tests passing (unit + integration)
- [ ] Environment variables validated

**Post-Deployment:**
- [ ] Test single address geocoding
- [ ] Test batch job with 10 addresses
- [ ] Verify cache is working (check hit rate)
- [ ] Monitor API quota usage (first 24 hours)
- [ ] Review error logs for unexpected issues
- [ ] Backup database before large geocoding runs

---

## 11. Testing Strategy

### 11.1 Unit Tests

**Test Files Structure:**
```
tests/unit/
├── services/
│   ├── geocoding-service.test.js
│   ├── address-cache-service.test.js
│   └── geocoding-job-service.test.js
├── utils/
│   └── address-normalization.test.js
```

**Key Test Cases:**

#### GeocodingService Tests
```javascript
describe('GeocodingService', () => {
  describe('geocodeAddress', () => {
    it('should return coordinates for valid address', async () => {
      // Mock Google Maps API response
      const mockResponse = {
        data: {
          status: 'OK',
          results: [{
            geometry: {
              location: { lat: 36.4243039, lng: -89.0576172 },
              location_type: 'ROOFTOP'
            },
            formatted_address: '123 Main St, Union City, TN 38261, USA',
            partial_match: false
          }]
        }
      };
      
      // Test implementation
    });
    
    it('should handle ZERO_RESULTS error', async () => { ... });
    it('should retry on OVER_QUERY_LIMIT', async () => { ... });
    it('should calculate quality score correctly', async () => { ... });
  });
});
```

#### AddressCacheService Tests
```javascript
describe('AddressCacheService', () => {
  describe('normalizeAddress', () => {
    it('should normalize street abbreviations', () => {
      const result = service.normalizeAddress('123 Main Street', 'Union City', 'TN', '38261');
      expect(result).toBe('123 main st|union city|tn|38261');
    });
    
    it('should handle extra whitespace', () => { ... });
    it('should normalize directional prefixes', () => { ... });
    it('should be case-insensitive', () => { ... });
  });
  
  describe('cache operations', () => {
    it('should return null on cache miss', async () => { ... });
    it('should return cached result on hit', async () => { ... });
    it('should invalidate expired cache entries', async () => { ... });
  });
});
```

### 11.2 Integration Tests

**Test Files:**
```
tests/integration/
├── geocoding-flow.test.js
├── geocode-api.test.js
└── cache-integration.test.js
```

**Example: End-to-End Batch Geocoding Test**
```javascript
describe('Geocoding Integration', () => {
  it('should process batch geocoding job end-to-end', async () => {
    // 1. Insert test voters without coordinates
    const voterIds = await insertTestVoters(10);
    
    // 2. Trigger batch geocoding
    const response = await request(app)
      .post('/api/geocode/batch')
      .send({ voterIds });
    
    expect(response.status).toBe(200);
    const { jobId } = response.body;
    
    // 3. Wait for job completion (with timeout)
    let status;
    for (let i = 0; i < 30; i++) {
      const statusRes = await request(app).get(`/api/geocode/status/${jobId}`);
      status = statusRes.body.status;
      
      if (status === 'COMPLETED' || status === 'FAILED') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    expect(status).toBe('COMPLETED');
    
    // 4. Verify voters have coordinates
    const voters = await database.all(
      'SELECT latitude, longitude FROM voters WHERE id IN (' + voterIds.join(',') + ')'
    );
    
    voters.forEach(voter => {
      expect(voter.latitude).not.toBeNull();
      expect(voter.longitude).not.toBeNull();
    });
  });
});
```

### 11.3 Mocking Google Maps API

**Use `nock` for HTTP mocking:**

```javascript
const nock = require('nock');

beforeEach(() => {
  // Mock successful geocoding response
  nock('https://maps.googleapis.com')
    .get('/maps/api/geocode/json')
    .query(true)
    .reply(200, {
      status: 'OK',
      results: [{
        geometry: {
          location: { lat: 36.4243039, lng: -89.0576172 },
          location_type: 'ROOFTOP'
        },
        formatted_address: '123 Main St, Union City, TN 38261, USA',
        address_components: [...],
        partial_match: false,
        place_id: 'mock_place_id'
      }]
    });
});

afterEach(() => {
  nock.cleanAll();
});
```

### 11.4 Performance Testing

**Load Test Script:**
```javascript
const { performance } = require('perf_hooks');

async function loadTest() {
  const batchSizes = [10, 50, 100, 500, 1000];
  
  for (const size of batchSizes) {
    // Insert test voters
    const voterIds = await insertTestVoters(size);
    
    const start = performance.now();
    
    // Trigger geocoding
    const jobId = await createGeocodingJob(voterIds);
    
    // Wait for completion
    await waitForJobCompletion(jobId);
    
    const end = performance.now();
    const duration = (end - start) / 1000; // seconds
    
    console.log(`Batch size: ${size}, Duration: ${duration.toFixed(2)}s, Rate: ${(size/duration).toFixed(2)} addresses/sec`);
  }
}
```

### 11.5 Test Data

**Create Test Address Dataset:**
```javascript
const testAddresses = [
  // Valid addresses (should geocode successfully)
  { address: '123 Main St', city: 'Union City', zip: '38261', expected_quality: 90 },
  { address: '456 Oak Ave', city: 'Union City', zip: '38261', expected_quality: 90 },
  
  // Problematic addresses (should trigger quality flags)
  { address: 'PO Box 123', city: 'Union City', zip: '38261', expected_quality: 0 },
  { address: '999 Nonexistent Rd', city: 'Union City', zip: '38261', expected_quality: 0 },
  
  // Partial addresses (should have lower quality)
  { address: 'Main St', city: 'Union City', zip: '38261', expected_quality: 60 },
];
```

---

## 12. Dependencies and Requirements

### 12.1 NPM Packages

**New Dependencies:**
```json
{
  "dependencies": {
    "@googlemaps/google-maps-services-js": "^3.3.42",
    "bottleneck": "^2.19.5"
  },
  "devDependencies": {
    "nock": "^13.5.0"
  }
}
```

**Installation:**
```bash
npm install @googlemaps/google-maps-services-js bottleneck
npm install --save-dev nock
```

### 12.2 Google Maps API Configuration

**Required API:**
- **Geocoding API** (primary requirement)

**Optional APIs (for future features):**
- Maps JavaScript API (for frontend map display)
- Distance Matrix API (for route planning in Phase 5)

**Setup Steps:**
1. Go to Google Cloud Console: https://console.cloud.google.com/
2. Create new project or select existing
3. Enable Geocoding API
4. Create API key (with restrictions):
   - Application restrictions: IP address (restrict to server IP)
   - API restrictions: Limit to Geocoding API only
5. Set up billing account
6. Configure daily quota limits (recommended: 10,000 requests/day)

**Cost Controls:**
- Set budget alerts at $50, $100, $200
- Configure quotas in API Console to prevent runaway costs
- Monitor usage daily during initial testing

### 12.3 Environment Variables

**Required `.env` Configuration:**
```bash
# Google Maps API
GOOGLE_MAPS_GEOCODING_API_KEY=AIzaSyD...your_actual_key

# Geocoding Settings
GEOCODING_RATE_LIMIT=10          # Requests per second (default: 10)
GEOCODING_BATCH_SIZE=100         # Records per batch (default: 100)
GEOCODING_DELAY_MS=100           # Milliseconds between requests (default: 100)

# Cache Settings
CACHE_GEOCODING_RESULTS=true     # Enable caching (default: true)
CACHE_TTL_DAYS=90                # Cache expiration (default: 90 days)

# Quota Management
DAILY_QUOTA_LIMIT=10000          # Max API calls per day (default: 10000)
QUOTA_WARNING_THRESHOLD=8000     # Warning at 80% usage
```

**Validation Script:**
```javascript
// backend/utils/validate-env.js
function validateEnvironment() {
  const required = [
    'GOOGLE_MAPS_GEOCODING_API_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Test API key validity
  const testKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
  if (testKey.length < 30 || !testKey.startsWith('AIza')) {
    console.warn('⚠️  Google Maps API key format looks invalid');
  }
  
  console.log('✅ Environment configuration validated');
}

module.exports = { validateEnvironment };
```

### 12.4 System Requirements

**Server Requirements:**
- Node.js >= 16.0.0
- SQLite3 >= 3.30.0
- Disk space: 500MB minimum (for database + cache)
- RAM: 2GB minimum (4GB recommended for large batches)
- Network: Stable internet connection for API calls

**Development Environment:**
- VS Code or similar IDE
- Postman or similar API testing tool
- SQLite browser (DB Browser for SQLite recommended)

### 12.5 Database Space Estimates

**Storage Calculations:**
- Voters table: ~1KB per voter
- Geocoding cache: ~500 bytes per unique address
- Geocoding jobs: ~200 bytes per job
- Geocoding errors: ~300 bytes per error

**Example: 10,000 voters**
- Voters: 10,000 × 1KB = 10MB
- Cache (90% unique addresses): 9,000 × 500B = 4.5MB
- Jobs (50 jobs): 50 × 200B = 10KB
- Errors (estimated 500): 500 × 300B = 150KB
- **Total: ~15MB**

---

## 13. Potential Risks and Mitigations

### 13.1 Risk: API Quota Exhaustion

**Scenario:** Accidentally exceeding daily quota, incurring unexpected costs

**Mitigations:**
1. **Hard Quota Limits:**
   - Set `DAILY_QUOTA_LIMIT` in environment
   - Check quota before each batch job
   - Reject jobs if approaching limit

2. **Budget Alerts:**
   - Configure Google Cloud billing alerts
   - Email notifications at 50%, 80%, 100% budget

3. **Monitoring Dashboard:**
   - Track daily API usage in real-time
   - Display quota usage in admin interface
   - Auto-pause jobs at 90% quota

**Implementation:**
```javascript
async function checkQuotaBeforeJob(estimatedCalls) {
  const today = new Date().toISOString().split('T')[0];
  const currentUsage = await database.get(`
    SELECT request_count FROM api_quotas 
    WHERE date = ? AND service = 'geocoding'
  `, [today]);
  
  const usage = currentUsage?.request_count || 0;
  const limit = parseInt(process.env.DAILY_QUOTA_LIMIT) || 10000;
  
  if (usage + estimatedCalls > limit) {
    throw new Error(`Daily quota limit would be exceeded: ${usage + estimatedCalls}/${limit}`);
  }
}
```

### 13.2 Risk: Poor Cache Hit Rate

**Scenario:** Cache not working effectively, leading to excessive API calls

**Mitigations:**
1. **Thorough Address Normalization:**
   - Extensive testing of normalization algorithm
   - Handle edge cases (PO Boxes, apartment numbers, etc.)

2. **Cache Monitoring:**
   - Track hit rate percentage
   - Alert if hit rate drops below 70%
   - Log cache misses for analysis

3. **Pre-population:**
   - Geocode existing voters before go-live
   - Build cache with historical data

**Target:** 85%+ cache hit rate for production imports

### 13.3 Risk: Low Geocoding Quality

**Scenario:** Many addresses get low quality scores or fail to geocode

**Mitigations:**
1. **Structured API Requests:**
   - Use address components (city, state, zip) separately
   - Include region biasing for better results

2. **Fallback Strategies:**
   - Retry with simplified address (remove apartment numbers)
   - Try alternative formats (e.g., full text vs. components)

3. **Manual Review Process:**
   - Dedicated review interface for quality < 70
   - Bulk export of failed addresses for correction

4. **Data Quality Improvement:**
   - Validate addresses at import time
   - Provide address correction suggestions

### 13.4 Risk: API Rate Limiting

**Scenario:** Google returns `OVER_QUERY_LIMIT` errors despite local rate limiting

**Mitigations:**
1. **Conservative Rate Limits:**
   - Default 10 RPS (Google allows 50 RPS)
   - Configurable via environment variable

2. **Exponential Backoff:**
   - Automatic retry with increasing delays
   - Max 3 retries per address

3. **Circuit Breaker:**
   - Pause job after 10 consecutive rate limit errors
   - Resume after 5-minute cooldown

### 13.5 Risk: Network Failures

**Scenario:** Internet connection drops during geocoding job

**Mitigations:**
1. **Job Resumption:**
   - Track `last_processed_id` in jobs table
   - Resume from last checkpoint on restart

2. **Transaction Safety:**
   - Use database transactions for batch updates
   - Rollback on failure

3. **Timeout Handling:**
   - 5-second timeout per API request
   - Retry transient network errors

### 13.6 Risk: Address Privacy/Security

**Scenario:** Geocoded coordinates expose precise voter locations

**Mitigations:**
1. **Access Controls:**
   - Require authentication for geocoding endpoints
   - Audit log all coordinate access

2. **Data Usage Compliance:**
   - Follow Obion County data usage agreement
   - No public web access to coordinates
   - Political use only

3. **Secure Storage:**
   - Encrypted database (if required)
   - Regular backups to secure location

### 13.7 Risk: Invalid Manual Overrides

**Scenario:** User enters incorrect coordinates manually

**Mitigations:**
1. **Input Validation:**
   - Validate lat/lng ranges (-90 to 90, -180 to 180)
   - Verify coordinates are within Tennessee boundaries

2. **Visual Confirmation:**
   - Show map preview before saving
   - Require confirmation for manual overrides

3. **Audit Trail:**
   - Log all manual changes with user ID and timestamp
   - Allow rollback of manual changes

---

## 14. Success Criteria

### 14.1 Functional Requirements

**Must Have (P0):**
- ✅ Successfully geocode 90%+ of valid addresses
- ✅ Cache hit rate of 80%+ for subsequent imports
- ✅ Batch jobs process 100+ addresses without errors
- ✅ API rate limiting prevents quota violations
- ✅ Failed addresses logged for manual review
- ✅ Quality scores calculated for all geocoded addresses

**Should Have (P1):**
- ✅ Manual override capability for failed addresses
- ✅ Real-time job progress tracking
- ✅ Retry mechanism for transient failures
- ✅ Cache statistics dashboard

**Nice to Have (P2):**
- ⚪ Multiple geocoding provider support (fallback to Nominatim)
- ⚪ Automatic address correction suggestions
- ⚪ Bulk geocoding from CSV file

### 14.2 Performance Benchmarks

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Geocoding throughput | 10-15 addresses/second | Batch job with 100 addresses |
| Cache lookup time | < 50ms | Unit test average |
| API response time | < 2 seconds | 95th percentile |
| Job completion (1000 addresses) | < 3 minutes | Integration test |
| Database query time | < 100ms | EXPLAIN QUERY PLAN |

### 14.3 Quality Metrics

| Metric | Target | Acceptable Range |
|--------|--------|------------------|
| Average quality score | > 85 | 80-100 |
| ROOFTOP accuracy rate | > 70% | 60-80% |
| Failed geocoding rate | < 5% | 0-10% |
| Cache hit rate | > 85% | 75-95% |
| Manual review required | < 10% | 0-15% |

### 14.4 Cost Targets

**Monthly Cost Estimate (10,000 voters):**
- Initial geocoding: 10,000 calls = $50 (one-time)
- Monthly re-geocoding (10% new/changed): 1,000 calls = $5
- **Target: < $20/month average** (including contingency)

### 14.5 Acceptance Tests

**Test Scenarios:**

1. **Batch Geocoding Test:**
   - Import 100 voters from CSV
   - Trigger batch geocoding
   - Verify 90%+ success rate
   - Verify cache populated

2. **Cache Test:**
   - Import same 100 voters again (different file)
   - Trigger batch geocoding
   - Verify 90%+ cache hits
   - Verify < 10 API calls

3. **Error Handling Test:**
   - Submit 10 invalid addresses (fake streets)
   - Verify errors logged to `geocoding_errors`
   - Verify job completes without crashing

4. **Quality Scoring Test:**
   - Geocode 10 known addresses
   - Verify quality scores are reasonable (> 70)
   - Verify ROOFTOP addresses get 90+ score

5. **Manual Override Test:**
   - Manually set coordinates for 1 failed address
   - Verify coordinates saved correctly
   - Verify marked as "Manual" in system

---

## 15. Future Enhancements

### 15.1 Phase 4+ Features (Out of Scope for Phase 3)

1. **Multi-Provider Geocoding:**
   - Add Nominatim (OpenStreetMap) as fallback provider
   - Add MapBox as alternative paid provider
   - Automatic failover if Google quota exhausted

2. **Reverse Geocoding:**
   - Convert lat/lng back to formatted addresses
   - Validate geocoding accuracy by reverse lookup
   - Useful for map click-to-address features

3. **Bulk Address Verification:**
   - Compare addresses to USPS database
   - Suggest corrections for invalid addresses
   - Pre-validate before geocoding to reduce API waste

4. **Advanced Caching:**
   - Redis cache for high-performance lookups
   - Multi-tier cache (Redis → SQLite → API)
   - Cache preloading for known street ranges

5. **Geocoding Analytics:**
   - Dashboard showing geocoding coverage by precinct
   - Quality score distribution charts
   - Cost tracking and forecasting

6. **Scheduled Geocoding:**
   - Automatic nightly geocoding of new voters
   - Background job queue (Bull, BeeQueue)
   - Email notifications on completion

7. **Address Autocomplete:**
   - Frontend autocomplete using Google Places API
   - Reduce invalid address submissions
   - Improve data quality at entry point

8. **Geocoding History:**
   - Track coordinate changes over time
   - Audit log for all geocoding events
   - Rollback capability for bulk changes

### 15.2 Optimization Opportunities

1. **Parallel Processing:**
   - Process addresses in parallel (5-10 concurrent requests)
   - Use worker threads for CPU-intensive normalization

2. **Smart Batching:**
   - Group similar addresses (same street) for efficiency
   - Prioritize high-quality addresses first

3. **Predictive Caching:**
   - Pre-geocode addresses from common street ranges
   - Use street-level geocoding to estimate missing addresses

4. **Machine Learning Quality Scoring:**
   - Train ML model on manual review outcomes
   - Predict quality score before API call
   - Skip API call if predicted quality is too low

---

## Appendix A: Address Normalization Examples

### Example Transformations

| Original Address | Normalized Address |
|------------------|-------------------|
| "123 North Main Street" | "123 n main st" |
| "456 Oak Avenue, Apt 2B" | "456 oak ave apt 2b" |
| "789 SW Boulevard" | "789 sw blvd" |
| "  10  Main   St  " | "10 main st" |
| "PO Box 123" | "po box 123" |

### Cache Key Generation

```
Address: "123 Main St"
City: "Union City"
State: "TN"
ZIP: "38261"

Normalized: "123 main st|union city|tn|38261"
MD5 Hash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

---

## Appendix B: Quality Score Examples

### Example 1: Perfect Match
```json
{
  "location_type": "ROOFTOP",
  "partial_match": false,
  "address_components": ["street_number", "route", "locality", "administrative_area_level_1", "postal_code"],
  "result_count": 1,
  "state": "TN"
}
```
**Quality Score: 100**

### Example 2: Street-Level Match
```json
{
  "location_type": "RANGE_INTERPOLATED",
  "partial_match": false,
  "address_components": ["route", "locality", "administrative_area_level_1", "postal_code"],
  "result_count": 1,
  "state": "TN"
}
```
**Quality Score: 84**

### Example 3: Approximate Match with Partial
```json
{
  "location_type": "APPROXIMATE",
  "partial_match": true,
  "address_components": ["locality", "administrative_area_level_1"],
  "result_count": 1,
  "state": "TN"
}
```
**Quality Score: 44**

---

## Appendix C: API Error Responses

### ZERO_RESULTS
```json
{
  "status": "ZERO_RESULTS",
  "results": []
}
```
**Action:** Log to errors table, mark as FAILED

### OVER_QUERY_LIMIT
```json
{
  "status": "OVER_QUERY_LIMIT",
  "error_message": "You have exceeded your request quota."
}
```
**Action:** Exponential backoff retry (3 attempts)

### REQUEST_DENIED
```json
{
  "status": "REQUEST_DENIED",
  "error_message": "The provided API key is invalid."
}
```
**Action:** Stop job immediately, alert admin

---

## Document Metadata

**Version:** 1.0  
**Created:** February 6, 2026  
**Author:** AI Assistant (orchestrated specification)  
**Status:** Ready for Implementation  
**Estimated Implementation Time:** 3 weeks (120 hours)  
**Dependencies:** Phase 1 (Complete), Phase 2 (Complete)  
**Next Phase:** Phase 4 - Frontend Development

---

**END OF SPECIFICATION**
