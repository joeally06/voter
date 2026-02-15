# Analytics Routes Implementation Specification

**Document Version:** 1.0  
**Created:** February 7, 2026  
**Project:** Voter Outreach & Mapping Platform  
**Component:** Backend Analytics Routes (`backend/routes/analytics.js`)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Research Findings & Best Practices](#research-findings--best-practices)
4. [Required Endpoints Specification](#required-endpoints-specification)
5. [Database Query Patterns](#database-query-patterns)
6. [Error Handling Requirements](#error-handling-requirements)
7. [Response Format Standards](#response-format-standards)
8. [Performance Optimization](#performance-optimization)
9. [Integration Requirements](#integration-requirements)
10. [Testing Strategy](#testing-strategy)
11. [Implementation Checklist](#implementation-checklist)

---

## Executive Summary

### Purpose
This specification defines the comprehensive implementation requirements for the Analytics Routes module, which provides RESTful API endpoints for voter data analytics, reporting, and visualization.

### Scope
- **File:** `backend/routes/analytics.js`
- **Service:** `backend/services/analytics-service.js` (already implemented)
- **Endpoints:** 5 primary analytics endpoints
- **Frontend Integration:** Chart visualization and dashboard display

### Key Issues Identified
1. **Duplicate Route Definitions:** Dashboard and super-voters endpoints defined twice
2. **Mixed Implementation States:** Some routes fully implemented, others are placeholders
3. **Inconsistent Validation:** Turnout and voting-patterns missing validation middleware
4. **Missing Documentation:** Several endpoints lack proper JSDoc comments
5. **No Age Group Analysis:** Required endpoint not implemented (due to data limitations)
6. **No Demographics Analysis:** Required endpoint not implemented

---

## Current State Analysis

### What Exists (Implemented)

#### 1. **Dashboard Metrics** (`GET /api/analytics/dashboard`)
- ✅ **Status:** FULLY IMPLEMENTED (first definition at line 49)
- ✅ **Features:**
  - Comprehensive dashboard metrics aggregation
  - Total counts (voters, super voters, precincts, geocoded)
  - Percentages (super voter rate, geocoding progress)
  - Recent activity (last import details)
  - Precinct-level summary with super voter rates
- ✅ **Service Method:** `analyticsService.getDashboardMetrics()`
- ✅ **Caching:** 5-minute TTL
- ⚠️ **Issue:** DUPLICATE definition at line 305 (needs removal)

#### 2. **Voting Patterns** (`GET /api/analytics/voting-patterns`)
- ✅ **Status:** PARTIALLY IMPLEMENTED
- ✅ **Validation:** Comprehensive input validation with express-validator
- ✅ **Service Method:** `analyticsService.getVotingPatterns(filters)`
- ✅ **Features:**
  - Voting frequency distribution
  - Party trends over elections
  - Early voting statistics
  - Turnout by precinct
- ⚠️ **Issue:** Missing complete route handler (lines around 124)

#### 3. **Turnout Analysis** (`GET /api/analytics/turnout`)
- ✅ **Status:** PARTIALLY IMPLEMENTED
- ✅ **Validation:** Comprehensive validation (election code, precinct, groupBy, compareWith)
- ✅ **Service Method:** `analyticsService.getTurnoutAnalysis(filters)`
- ✅ **Features:**
  - Overall turnout statistics
  - Breakdown by precinct
  - Election-to-election comparison
  - Time-based analysis (early vs election day)
- ⚠️ **Issue:** Route handler incomplete at line 86

#### 4. **Super Voters** (`GET /api/analytics/super-voters`)
- ✅ **Status:** FULLY IMPLEMENTED (first definition at line 185)
- ✅ **Validation:** Threshold, precinct, includeHistory parameters
- ✅ **Service Method:** `analyticsService.getSuperVoterAnalysis(filters)`
- ✅ **Features:**
  - Summary statistics
  - Geographic distribution
  - Party affiliation breakdown
  - Participation patterns
- ⚠️ **Issue:** DUPLICATE definition at line 248 (needs removal)

### What's Missing (Not Implemented)

#### 1. **Party Affiliation** (`GET /api/analytics/party-affiliation`)
- ❌ **Status:** PLACEHOLDER ONLY (line 277)
- ✅ **Service Method:** `analyticsService.getPartyAffiliation()` EXISTS in service
- 🎯 **Required Features:**
  - Current party distribution
  - Percentages by party
  - Trends across elections
  - Geographic concentration by precinct

#### 2. **Demographics Analysis** (`GET /api/analytics/demographics`)
- ❌ **Status:** NOT IMPLEMENTED
- ❌ **Required by:** Frontend dashboard and reporting features
- 🎯 **Required Features:**
  - Geographic distribution by city/zip
  - Registration date patterns
  - Voter concentration analysis

#### 3. **Age Group Analysis** (`GET /api/analytics/age-groups`)
- ❌ **Status:** CANNOT BE IMPLEMENTED
- ❌ **Data Availability:** NO birth date field in voter table
- ⚠️ **Note:** This endpoint cannot be implemented without database schema changes

### Database Schema Analysis

#### Available Tables
```sql
-- voters table
CREATE TABLE voters (
    id INTEGER PRIMARY KEY,
    voter_id TEXT UNIQUE,
    last_name TEXT,
    first_name TEXT,
    address TEXT,
    city TEXT,
    zip_code TEXT,
    precinct_number TEXT,
    latitude REAL,
    longitude REAL,
    geocoding_quality TEXT,
    super_voter INTEGER,  -- Boolean (0/1)
    created_at DATETIME,
    updated_at DATETIME
);

-- election_history table
CREATE TABLE election_history (
    id INTEGER PRIMARY KEY,
    voter_id TEXT,
    election_code TEXT,
    voted INTEGER,  -- Boolean (0/1)
    party_code TEXT,  -- 'R', 'D', 'I', or NULL
    early_voted INTEGER,  -- Boolean (0/1)
    FOREIGN KEY (voter_id) REFERENCES voters(voter_id)
);

-- precincts table
CREATE TABLE precincts (
    id INTEGER PRIMARY KEY,
    precinct_number TEXT UNIQUE,
    name TEXT,
    total_voters INTEGER,
    super_voters INTEGER
);

-- import_logs table
CREATE TABLE import_logs (
    id INTEGER PRIMARY KEY,
    filename TEXT,
    file_size INTEGER,
    status TEXT,
    records_successful INTEGER,
    start_time DATETIME,
    end_time DATETIME
);
```

#### Data Availability Limitations
- ❌ **No age/birth date field** in voters table → Age group analysis NOT POSSIBLE
- ❌ **No gender field** in voters table → Gender demographics NOT POSSIBLE
- ✅ **City and zip_code available** → Geographic demographics POSSIBLE
- ✅ **Election history complete** → Voting patterns, turnout, party analysis POSSIBLE

---

## Research Findings & Best Practices

### Source 1: RESTful API Design Patterns
**Reference:** "REST API Design Rulebook" by Mark Massé (O'Reilly) + Richardson Maturity Model

**Key Principles:**
1. **Resource-Based URLs:** Use nouns, not verbs (`/analytics/dashboard` not `/getDashboard`)
2. **HTTP Methods Semantics:** 
   - GET for safe, idempotent data retrieval
   - POST for non-idempotent operations (if needed)
3. **Query Parameters for Filtering:** Use query strings for optional filters
4. **Hierarchical Structure:** Organize related resources logically

**Application to Analytics Routes:**
```javascript
✅ CORRECT:  GET /api/analytics/turnout?electionCode=E_5&precinct=01
✅ CORRECT:  GET /api/analytics/dashboard
❌ WRONG:    POST /api/analytics/calculateTurnout
❌ WRONG:    GET /api/getTurnoutAnalytics
```

### Source 2: Express.js Best Practices
**Reference:** Express.js Official Documentation + "Express in Action" by Evan Hahn (Manning)

**Middleware Patterns:**
1. **Input Validation Middleware:** Use `express-validator` for consistent validation
2. **Error Handling:** Use `next(error)` for async errors, centralized error handler
3. **Route Organization:** Group related routes, use `express.Router()`
4. **Validation Helper Middleware:** Reusable validation result checker

**Implementation Pattern:**
```javascript
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            message: 'Invalid query parameters',
            details: errors.array(),
            timestamp: new Date().toISOString()
        });
    }
    next();
};

router.get('/endpoint', [
    query('param').optional().isString().trim(),
    validate
], async (req, res, next) => {
    try {
        // Route logic
    } catch (error) {
        next(error);  // Pass to error handler
    }
});
```

### Source 3: SQL Query Optimization for Analytics
**Reference:** "SQL Performance Explained" by Markus Winand + SQLite Documentation

**Optimization Techniques:**
1. **Aggregate Functions:** Use `COUNT()`, `SUM()`, `AVG()` efficiently
2. **Conditional Aggregation:** Use `CASE WHEN` for multiple aggregates in one query
3. **Subqueries vs JOINs:** Choose based on query optimizer preferences
4. **Parallel Queries:** Use `Promise.all()` for independent queries
5. **NULL Handling:** Use `NULLIF()` to prevent division by zero
6. **Casting:** Use `CAST(x AS REAL)` for accurate percentage calculations

**Pattern for Percentage Calculations:**
```sql
-- ✅ CORRECT: Handles division by zero, accurate percentages
CAST(COUNT(CASE WHEN condition THEN 1 END) AS REAL) / 
  NULLIF(COUNT(*), 0) * 100 as percentage

-- ❌ WRONG: Integer division, no zero protection
COUNT(condition) / COUNT(*) * 100
```

**Pattern for Conditional Aggregation:**
```sql
SELECT 
    SUM(CASE WHEN party_code = 'D' THEN 1 ELSE 0 END) as democrat,
    SUM(CASE WHEN party_code = 'R' THEN 1 ELSE 0 END) as republican,
    SUM(CASE WHEN party_code = 'I' THEN 1 ELSE 0 END) as independent
FROM election_history;
```

### Source 4: Performance Optimization Strategies
**Reference:** "High Performance Browser Networking" by Ilya Grigorik + Node.js Best Practices

**Caching Strategies:**
1. **In-Memory Caching:** Use Map() for application-level caching
2. **TTL (Time-To-Live):** Different TTLs for different data freshness needs
3. **Cache Keys:** Include all filter parameters in key generation
4. **Cache Invalidation:** Clear cache on data mutations

**Implementation Pattern (from analytics-service.js):**
```javascript
class AnalyticsService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = {
      dashboard: 5 * 60 * 1000,  // 5 minutes (frequently updated)
      analytics: 15 * 60 * 1000  // 15 minutes (slower changing)
    };
  }

  _getCacheKey(method, params = {}) {
    return `${method}_${JSON.stringify(params)}`;
  }

  _getFromCache(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  _setCache(key, value, ttl) {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    });
  }
}
```

**Query Performance:**
1. **Parallel Execution:** Use `Promise.all()` for independent queries
2. **Query Timing:** Track and return query execution time
3. **Limit Row Returns:** Use LIMIT for potentially large result sets
4. **Index Usage:** Ensure frequently queried columns have indexes

### Source 5: API Response Formatting Standards
**Reference:** JSON:API Specification v1.0 + Google JSON Style Guide

**Response Structure Standards:**
```javascript
// ✅ Success Response Pattern
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",
    "queryTime": 245,  // milliseconds
    "data": {
        // Actual response data
    },
    "filters": {  // Echo back applied filters
        "precinct": "01",
        "electionCode": "E_5"
    }
}

// ✅ Error Response Pattern
{
    "success": false,
    "error": "ValidationError",
    "message": "Invalid query parameters",
    "details": [
        {
            "field": "precinct",
            "message": "Precinct must be 2 digits"
        }
    ],
    "timestamp": "2026-02-07T10:30:45.123Z"
}
```

**Field Naming Conventions:**
- Use `camelCase` for all JSON keys (not snake_case)
- Boolean fields: `isActive`, `hasVoted` (prefix with is/has)
- Timestamps: ISO 8601 format (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- Numbers: Return as numbers, not strings (percentages as floats)

### Source 6: Error Handling Best Practices
**Reference:** "Node.js Design Patterns" by Mario Casciaro + OWASP API Security Top 10

**Error Handling Principles:**
1. **Never Expose Internal Errors:** Sanitize error messages sent to client
2. **Use Appropriate HTTP Status Codes:**
   - 200: Success
   - 400: Bad Request (validation errors)
   - 404: Not Found
   - 500: Internal Server Error
3. **Consistent Error Format:** All errors follow same structure
4. **Error Logging:** Log full error details server-side
5. **Async Error Handling:** Always use try/catch with next(error)

**Implementation Pattern:**
```javascript
router.get('/endpoint', async (req, res, next) => {
    try {
        const service = new AnalyticsService();
        const result = await service.method();
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: result
        });
    } catch (error) {
        // Log full error server-side
        console.error('Analytics error:', error);
        
        // Pass to centralized error handler
        // Don't send raw error to client
        next(error);
    }
});
```

### Source 7: Input Validation Security
**Reference:** OWASP Input Validation Cheat Sheet + express-validator Documentation

**Validation Patterns:**
```javascript
// Election code validation
query('electionCode')
    .optional()
    .isString()
    .trim()
    .matches(/^[A-Z0-9_]+$/)
    .withMessage('Invalid election code format')

// Precinct validation
query('precinct')
    .optional()
    .isString()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Precinct must be 2 digits')

// Party code validation
query('partyCode')
    .optional()
    .isIn(['R', 'D', 'I', ''])
    .withMessage('Party code must be R, D, or I')

// Numeric range validation
query('threshold')
    .optional()
    .isInt({ min: 1, max: 10 })
    .toInt()
    .withMessage('Threshold must be between 1 and 10')
```

---

## Required Endpoints Specification

### Overview of Endpoints

| Endpoint | Method | Status | Priority |
|----------|--------|--------|----------|
| `/api/analytics/dashboard` | GET | Fix Duplicates | CRITICAL |
| `/api/analytics/turnout` | GET | Complete Implementation | HIGH |
| `/api/analytics/voting-patterns` | GET | Complete Implementation | HIGH |
| `/api/analytics/super-voters` | GET | Fix Duplicates | CRITICAL |
| `/api/analytics/party-affiliation` | GET | Implement from Scratch | HIGH |
| `/api/analytics/demographics` | GET | Implement from Scratch | MEDIUM |

---

### Endpoint 1: Dashboard Metrics

**Route:** `GET /api/analytics/dashboard`

**Purpose:** Provide comprehensive dashboard overview with key metrics

**Implementation Status:** ✅ IMPLEMENTED (with duplicate to remove)

**Query Parameters:** None

**Response Structure:**
```json
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",
    "queryTime": 245,
    "data": {
        "totals": {
            "voters": 15234,
            "superVoters": 3456,
            "precincts": 12,
            "geocoded": 14890
        },
        "percentages": {
            "superVoterRate": 22.68,
            "geocodingProgress": 97.74
        },
        "recentActivity": {
            "lastImport": "2026-02-06T14:22:10.000Z",
            "recordsImported": 15234
        },
        "precinctSummary": [
            {
                "precinctNumber": "01",
                "name": "Precinct 01",
                "totalVoters": 1456,
                "superVoters": 334,
                "superVoterRate": 22.94
            }
        ]
    }
}
```

**Service Method:** `analyticsService.getDashboardMetrics()`

**Database Queries:**
```sql
-- Total counts
SELECT 
    COUNT(*) as voters,
    SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
    SUM(CASE WHEN latitude IS NOT NULL THEN 1 ELSE 0 END) as geocoded
FROM voters;

-- Precinct summary
SELECT 
    p.precinct_number as precinctNumber,
    p.name,
    COUNT(v.id) as totalVoters,
    SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
    CAST(SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
        NULLIF(COUNT(v.id), 0) * 100 as superVoterRate
FROM precincts p
LEFT JOIN voters v ON p.precinct_number = v.precinct_number
GROUP BY p.precinct_number, p.name
ORDER BY p.precinct_number;

-- Recent import
SELECT 
    end_time as lastImport,
    records_successful as recordsImported
FROM import_logs
WHERE status = 'completed'
ORDER BY end_time DESC
LIMIT 1;
```

**Caching:** 5-minute TTL

**Issues to Fix:**
1. Remove duplicate route definition at line 305
2. Ensure only one dashboard route exists at line 49

---

### Endpoint 2: Turnout Analysis

**Route:** `GET /api/analytics/turnout`

**Purpose:** Calculate and analyze voter turnout with comparative analysis

**Implementation Status:** ⚠️ PARTIALLY IMPLEMENTED (needs completion)

**Query Parameters:**
- `electionCode` (optional, string): Specific election to analyze (format: `E_1`, `E_2`, etc.)
- `precinct` (optional, string): Filter by precinct number (2 digits)
- `groupBy` (optional, enum): Group results by 'precinct' or 'party'
- `compareWith` (optional, string): Compare with another election code

**Validation Rules:**
```javascript
query('electionCode')
    .optional()
    .isString()
    .trim()
    .matches(/^[A-Z0-9_]+$/)
    .withMessage('Invalid election code format'),
query('precinct')
    .optional()
    .isString()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Precinct must be 2 digits'),
query('groupBy')
    .optional()
    .isIn(['precinct', 'party'])
    .withMessage('Group by must be "precinct" or "party"'),
query('compareWith')
    .optional()
    .isString()
    .trim()
    .matches(/^[A-Z0-9_]+$/)
    .withMessage('Invalid comparison election code format')
```

**Response Structure:**
```json
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",
    "filters": {
        "electionCode": "E_5",
        "precinct": null,
        "groupBy": null,
        "compareWith": "E_4"
    },
    "data": {
        "overall": {
            "registeredVoters": 15234,
            "totalVotes": 8456,
            "turnoutRate": 55.49,
            "earlyVotes": 3234,
            "electionDayVotes": 5222
        },
        "byPrecinct": [
            {
                "precinctNumber": "01",
                "registeredVoters": 1456,
                "votes": 823,
                "turnoutRate": 56.52,
                "earlyVoteRate": 38.27
            }
        ],
        "comparison": {
            "previousElection": "E_4",
            "turnoutChange": 3.24,
            "direction": "increase"
        },
        "timeAnalysis": {
            "earlyVotingPeriod": {
                "votes": 3234,
                "percentage": 38.24
            },
            "electionDay": {
                "votes": 5222,
                "percentage": 61.76
            }
        }
    }
}
```

**Service Method:** `analyticsService.getTurnoutAnalysis(filters)`

**Implementation Requirements:**
1. Complete route handler implementation
2. Connect to existing analytics service method
3. Add proper error handling
4. Include query time tracking

---

### Endpoint 3: Voting Patterns

**Route:** `GET /api/analytics/voting-patterns`

**Purpose:** Analyze voting patterns across multiple elections

**Implementation Status:** ⚠️ PARTIALLY IMPLEMENTED (needs completion)

**Query Parameters:**
- `precinct` (optional, string): Filter by precinct number (2 digits)
- `electionCodes` (optional, string): Comma-separated election codes
- `partyCode` (optional, enum): Party filter ('R', 'D', 'I')
- `minElections` (optional, integer): Minimum elections voted (1-10)

**Validation Rules:**
```javascript
query('precinct')
    .optional()
    .isString()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Precinct must be 2 digits'),
query('electionCodes')
    .optional()
    .isString()
    .trim()
    .matches(/^[A-Z0-9_]+(,[A-Z0-9_]+)*$/)
    .withMessage('Invalid election codes format'),
query('partyCode')
    .optional()
    .isIn(['R', 'D', 'I', ''])
    .withMessage('Party code must be R, D, or I'),
query('minElections')
    .optional()
    .isInt({ min: 1, max: 10 })
    .toInt()
    .withMessage('Min elections must be between 1 and 10')
```

**Response Structure:**
```json
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",
    "filters": {
        "precinct": null,
        "electionCodes": ["E_1", "E_2", "E_3", "E_4", "E_5"],
        "partyCode": null,
        "minElections": 1
    },
    "data": {
        "votingFrequency": {
            "1_election": 2345,
            "2_elections": 1876,
            "3_elections": 1654,
            "4_elections": 1432,
            "5_elections": 987
        },
        "partyTrends": [
            {
                "electionCode": "E_1",
                "democrat": 3456,
                "republican": 2987,
                "independent": 234
            }
        ],
        "earlyVotingStats": {
            "totalEarlyVotes": 12456,
            "percentageEarly": 38.45,
            "byElection": [
                {
                    "electionCode": "E_1",
                    "earlyVotes": 2567,
                    "totalVotes": 6789,
                    "percentage": 37.81
                }
            ]
        },
        "turnoutByPrecinct": [
            {
                "precinctNumber": "01",
                "averageTurnout": 56.78,
                "elections": 5
            }
        ]
    }
}
```

**Service Method:** `analyticsService.getVotingPatterns(filters)`

**Implementation Requirements:**
1. Complete route handler implementation
2. Ensure election codes are properly parsed from comma-separated string
3. Add error handling
4. Cache results with 15-minute TTL

---

### Endpoint 4: Super Voters Analysis

**Route:** `GET /api/analytics/super-voters`

**Purpose:** Identify and analyze high-frequency voters (super voters)

**Implementation Status:** ✅ IMPLEMENTED (with duplicate to remove)

**Query Parameters:**
- `threshold` (optional, integer): Minimum elections to qualify (1-10, default: 4)
- `precinct` (optional, string): Filter by precinct number (2 digits)
- `includeHistory` (optional, boolean): Include detailed voting history

**Validation Rules:**
```javascript
query('threshold')
    .optional()
    .isInt({ min: 1, max: 10 })
    .toInt()
    .withMessage('Threshold must be between 1 and 10'),
query('precinct')
    .optional()
    .isString()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Precinct must be 2 digits'),
query('includeHistory')
    .optional()
    .isBoolean()
    .toBoolean()
    .withMessage('includeHistory must be true or false')
```

**Response Structure:**
```json
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",
    "threshold": 4,
    "data": {
        "summary": {
            "totalVoters": 15234,
            "superVoters": 3456,
            "superVoterRate": 22.68,
            "averageElectionsVoted": 4.7
        },
        "geographicDistribution": [
            {
                "precinctNumber": "01",
                "totalVoters": 1456,
                "superVoters": 334,
                "percentage": 22.94
            }
        ],
        "partyAffiliation": {
            "democrat": 1567,
            "republican": 1234,
            "independent": 345,
            "unknown": 310
        },
        "participationPatterns": {
            "consistentVoters": 3456,
            "earlyVoterPreference": 1876,
            "electionDayPreference": 1580
        }
    }
}
```

**Service Method:** `analyticsService.getSuperVoterAnalysis(filters)`

**Issues to Fix:**
1. Remove duplicate route definition at line 248
2. Keep only the implementation at line 185 with full validation

---

### Endpoint 5: Party Affiliation Analysis

**Route:** `GET /api/analytics/party-affiliation`

**Purpose:** Analyze party affiliation distribution and trends

**Implementation Status:** ❌ PLACEHOLDER ONLY (needs full implementation)

**Query Parameters:**
- `precinct` (optional, string): Filter by precinct number
- `electionCodes` (optional, string): Comma-separated election codes for trends
- `trendAnalysis` (optional, boolean): Include historical trend analysis

**Validation Rules:**
```javascript
query('precinct')
    .optional()
    .isString()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Precinct must be 2 digits'),
query('electionCodes')
    .optional()
    .isString()
    .trim()
    .matches(/^[A-Z0-9_]+(,[A-Z0-9_]+)*$/)
    .withMessage('Invalid election codes format'),
query('trendAnalysis')
    .optional()
    .isBoolean()
    .toBoolean()
    .withMessage('trendAnalysis must be true or false')
```

**Response Structure:**
```json
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",
    "filters": {
        "precinct": null,
        "electionCodes": null,
        "trendAnalysis": true
    },
    "data": {
        "currentDistribution": {
            "democrat": 5678,
            "republican": 4987,
            "independent": 876,
            "unaffiliated": 3693
        },
        "percentages": {
            "democrat": 37.28,
            "republican": 32.73,
            "independent": 5.75,
            "unaffiliated": 24.24
        },
        "trends": [
            {
                "electionCode": "E_1",
                "distribution": {
                    "democrat": 3456,
                    "republican": 2987,
                    "independent": 234
                }
            }
        ],
        "geographicConcentration": [
            {
                "precinctNumber": "01",
                "strongestParty": "democrat",
                "percentage": 42.56,
                "distribution": {
                    "democrat": 620,
                    "republican": 512,
                    "independent": 324
                }
            }
        ]
    }
}
```

**Service Method:** `analyticsService.getPartyAffiliation(filters)` (already exists in service)

**Implementation Requirements:**
1. Create complete route handler
2. Add comprehensive validation middleware
3. Connect to existing analytics service method
4. Parse election codes from comma-separated string
5. Add error handling with try/catch
6. Cache results with 15-minute TTL

---

### Endpoint 6: Demographics Analysis

**Route:** `GET /api/analytics/demographics`

**Purpose:** Provide demographic analysis of voter base

**Implementation Status:** ❌ NOT IMPLEMENTED

**Query Parameters:**
- `precinct` (optional, string): Filter by precinct number
- `groupBy` (optional, enum): Group by 'city', 'zip', or 'precinct'

**Validation Rules:**
```javascript
query('precinct')
    .optional()
    .isString()
    .trim()
    .matches(/^\d{2}$/)
    .withMessage('Precinct must be 2 digits'),
query('groupBy')
    .optional()
    .isIn(['city', 'zip', 'precinct'])
    .withMessage('Group by must be "city", "zip", or "precinct"')
```

**Response Structure:**
```json
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",
    "filters": {
        "precinct": null,
        "groupBy": "city"
    },
    "data": {
        "byCity": [
            {
                "city": "Union City",
                "totalVoters": 8765,
                "superVoters": 2134,
                "superVoterRate": 24.34,
                "percentage": 57.53
            }
        ],
        "byZipCode": [
            {
                "zipCode": "38261",
                "totalVoters": 6543,
                "superVoters": 1567,
                "percentage": 42.94
            }
        ],
        "registrationTrends": {
            "totalRegistered": 15234,
            "recentRegistrations": 456,
            "averagePerMonth": 127
        }
    }
}
```

**Database Queries:**
```sql
-- By City
SELECT 
    city,
    COUNT(*) as totalVoters,
    SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
    CAST(SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
        NULLIF(COUNT(*), 0) * 100 as superVoterRate,
    CAST(COUNT(*) AS REAL) / 
        (SELECT COUNT(*) FROM voters) * 100 as percentage
FROM voters
GROUP BY city
ORDER BY totalVoters DESC;

-- By Zip Code
SELECT 
    zip_code as zipCode,
    COUNT(*) as totalVoters,
    SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as superVoters,
    CAST(COUNT(*) AS REAL) / 
        (SELECT COUNT(*) FROM voters) * 100 as percentage
FROM voters
GROUP BY zip_code
ORDER BY totalVoters DESC;
```

**Implementation Requirements:**
1. Create new route handler from scratch
2. Add validation middleware
3. Create new service method `analyticsService.getDemographics(filters)`
4. Implement parallel query execution
5. Add caching with 15-minute TTL
6. Format response according to standards

**Note:** Age group analysis is NOT POSSIBLE due to missing birth date field in database

---

## Database Query Patterns

### Pattern 1: Conditional Aggregation with CASE

**Use Case:** Count different categories in a single query

```sql
SELECT 
    SUM(CASE WHEN condition1 THEN 1 ELSE 0 END) as count1,
    SUM(CASE WHEN condition2 THEN 1 ELSE 0 END) as count2,
    SUM(CASE WHEN condition3 THEN 1 ELSE 0 END) as count3
FROM table;
```

**Example:**
```sql
SELECT 
    SUM(CASE WHEN party_code = 'D' THEN 1 ELSE 0 END) as democrat,
    SUM(CASE WHEN party_code = 'R' THEN 1 ELSE 0 END) as republican,
    SUM(CASE WHEN party_code = 'I' THEN 1 ELSE 0 END) as independent
FROM election_history
WHERE voted = 1;
```

### Pattern 2: Percentage Calculation with Division by Zero Protection

**Use Case:** Calculate percentages safely

```sql
CAST(numerator AS REAL) / NULLIF(denominator, 0) * 100 as percentage
```

**Example:**
```sql
SELECT 
    precinct_number,
    COUNT(*) as total,
    SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as super_voters,
    CAST(SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) AS REAL) / 
        NULLIF(COUNT(*), 0) * 100 as super_voter_rate
FROM voters
GROUP BY precinct_number;
```

### Pattern 3: Subquery for Latest Record

**Use Case:** Get most recent party affiliation per voter

```sql
SELECT 
    v.id,
    (
        SELECT e.party_code 
        FROM election_history e 
        WHERE e.voter_id = v.voter_id 
            AND e.party_code IS NOT NULL 
        ORDER BY e.election_code DESC 
        LIMIT 1
    ) as latest_party
FROM voters v;
```

### Pattern 4: JOIN with Aggregation

**Use Case:** Precinct statistics with voter counts

```sql
SELECT 
    p.precinct_number,
    p.name,
    COUNT(v.id) as total_voters,
    SUM(CASE WHEN v.super_voter = 1 THEN 1 ELSE 0 END) as super_voters
FROM precincts p
LEFT JOIN voters v ON p.precinct_number = v.precinct_number
GROUP BY p.precinct_number, p.name
ORDER BY p.precinct_number;
```

### Pattern 5: Filtered Aggregation with WHERE

**Use Case:** Election-specific statistics

```sql
SELECT 
    v.precinct_number,
    COUNT(DISTINCT v.id) as registered_voters,
    COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END) as votes,
    CAST(COUNT(DISTINCT CASE WHEN e.voted = 1 THEN e.id END) AS REAL) / 
        NULLIF(COUNT(DISTINCT v.id), 0) * 100 as turnout_rate
FROM voters v
LEFT JOIN election_history e ON v.voter_id = e.voter_id
WHERE e.election_code = ?
GROUP BY v.precinct_number;
```

### Pattern 6: Parallel Query Execution

**Use Case:** Multiple independent queries for dashboard

```javascript
const [totals, precincts, activity] = await Promise.all([
    database.get('SELECT COUNT(*) as count FROM voters'),
    database.all('SELECT * FROM precincts ORDER BY precinct_number'),
    database.get('SELECT * FROM import_logs ORDER BY end_time DESC LIMIT 1')
]);
```

### Pattern 7: Dynamic WHERE Clause Building

**Use Case:** Optional filter parameters

```javascript
const conditions = [];
const params = [];

if (filters.precinct) {
    conditions.push('v.precinct_number = ?');
    params.push(filters.precinct);
}

if (filters.electionCode) {
    conditions.push('e.election_code = ?');
    params.push(filters.electionCode);
}

const whereClause = conditions.length > 0 
    ? 'WHERE ' + conditions.join(' AND ') 
    : '';

const sql = `SELECT * FROM voters v 
             LEFT JOIN election_history e ON v.voter_id = e.voter_id 
             ${whereClause}`;
             
const results = await database.all(sql, params);
```

---

## Error Handling Requirements

### Error Categories

#### 1. Validation Errors (400 Bad Request)
**Trigger:** Invalid query parameters, malformed input

**Handler:**
```javascript
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            message: 'Invalid query parameters',
            details: errors.array(),
            timestamp: new Date().toISOString()
        });
    }
    next();
};
```

**Example Error Response:**
```json
{
    "success": false,
    "error": "Validation failed",
    "message": "Invalid query parameters",
    "details": [
        {
            "type": "field",
            "value": "99",
            "msg": "Precinct must be 2 digits",
            "path": "precinct",
            "location": "query"
        }
    ],
    "timestamp": "2026-02-07T10:30:45.123Z"
}
```

#### 2. Database Errors (500 Internal Server Error)
**Trigger:** SQL errors, connection issues

**Handler:**
```javascript
router.get('/endpoint', async (req, res, next) => {
    try {
        const service = new AnalyticsService();
        const result = await service.method();
        res.json({ success: true, data: result });
    } catch (error) {
        // Log full error server-side
        console.error('Analytics error:', error);
        
        // Send sanitized error to client
        next(error);
    }
});
```

#### 3. Service Layer Errors
**Implementation in analytics-service.js:**
```javascript
async getDashboardMetrics() {
    try {
        // Query logic
    } catch (error) {
        console.error('Dashboard metrics error:', error);
        throw new Error('Failed to calculate dashboard metrics');
    }
}
```

---

## Response Format Standards

### Success Response Template

```javascript
{
    "success": true,
    "timestamp": "2026-02-07T10:30:45.123Z",  // ISO 8601
    "queryTime": 245,  // Milliseconds (optional)
    "filters": {  // Echo back applied filters
        "precinct": "01",
        "electionCode": "E_5"
    },
    "data": {
        // Actual response data
    }
}
```

### Error Response Template

```javascript
{
    "success": false,
    "error": "ErrorType",  // ValidationError, DatabaseError, etc.
    "message": "Human-readable error message",
    "details": [],  // Array of detailed error objects (for validation)
    "timestamp": "2026-02-07T10:30:45.123Z"
}
```

### Field Naming Conventions

**JavaScript/JSON (camelCase):**
- ✅ `precinctNumber`, `electionCode`, `superVoterRate`
- ❌ `precinct_number`, `election_code`, `super_voter_rate`

**SQL (snake_case):**
- ✅ `precinct_number`, `election_code`, `super_voter`
- Use `AS camelCase` in SELECT statements for JSON conversion

**Boolean Fields:**
- Prefix with `is` or `has`: `isActive`, `hasVoted`, `includeHistory`
- Return as actual boolean (`true`/`false`), not 1/0

**Numeric Fields:**
- Percentages: Return as float with 2 decimal places (22.68, not "22.68%")
- Counts: Return as integer (1456, not "1,456")
- Dates: ISO 8601 string format

---

## Performance Optimization

### 1. Caching Strategy

**Implementation:**
```javascript
class AnalyticsService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = {
      dashboard: 5 * 60 * 1000,   // 5 minutes (dynamic data)
      analytics: 15 * 60 * 1000   // 15 minutes (slower changing)
    };
  }
}
```

**Cache TTL Guidelines:**
- Dashboard metrics: 5 minutes (updates frequently with imports)
- Analytics queries: 15 minutes (voter behavior changes slowly)
- Demographics: 30 minutes (nearly static)

### 2. Parallel Query Execution

**Pattern:**
```javascript
const [query1, query2, query3] = await Promise.all([
    database.get('SELECT ...'),
    database.all('SELECT ...'),
    database.get('SELECT ...')
]);
```

### 3. Query Optimization

**Techniques:**
1. **Indexed Columns:** Ensure `precinct_number`, `voter_id`, `election_code` are indexed
2. **LIMIT Clauses:** Use LIMIT for potentially large result sets
3. **Avoid N+1 Queries:** Use JOINs instead of multiple sequential queries
4. **Conditional Aggregation:** Use CASE WHEN for multiple counts in single query

---

## Integration Requirements

### 1. Existing Codebase Patterns

**Route Structure:**
```javascript
const express = require('express');
const router = express.Router();
const { query, validationResult } = require('express-validator');
const AnalyticsService = require('../services/analytics-service');

const validate = (req, res, next) => {
    // Validation logic
};

router.get('/endpoint', [
    query('param').optional().isString(),
    validate
], async (req, res, next) => {
    try {
        // Logic
    } catch (error) {
        next(error);
    }
});

module.exports = router;
```

### 2. Database Integration

**Use existing database module:**
```javascript
const database = require('../config/database');

// Available methods:
await database.get(sql, params);   // Single row
await database.all(sql, params);   // Multiple rows
await database.run(sql, params);   // INSERT/UPDATE/DELETE
```

### 3. Server.js Route Registration

**Verify registration exists:**
```javascript
const analyticsRoutes = require('./routes/analytics');
app.use('/api/analytics', analyticsRoutes);
```

---

## Testing Strategy

### Unit Tests

**Test File:** `tests/unit/services/analytics-service.test.js`

**Test Cases:**
1. Dashboard metrics calculation
2. Turnout analysis with filters
3. Voting patterns aggregation
4. Super voter identification
5. Party affiliation distribution
6. Cache hit/miss scenarios
7. Error handling

### Integration Tests

**Test File:** `tests/integration/analytics-routes.test.js`

**Test Cases:**
1. GET /api/analytics/dashboard returns 200
2. GET /api/analytics/turnout with valid filters
3. GET /api/analytics/turnout with invalid filters returns 400
4. GET /api/analytics/super-voters with threshold parameter

---

## Implementation Checklist

### Phase 1: Code Cleanup & Structure

- [ ] **Remove duplicate dashboard route** (line 305)
- [ ] **Remove duplicate super-voters route** (line 248)
- [ ] **Complete turnout route handler** (line 86)
- [ ] **Complete voting-patterns route handler** (line 124)
- [ ] **Add comprehensive JSDoc comments** to all routes
- [ ] **Verify validate middleware** is defined once at top
- [ ] **Ensure proper error handling** with try/catch and next(error)

### Phase 2: Party Affiliation Implementation

- [ ] **Create party-affiliation route handler**
  - [ ] Add validation middleware
  - [ ] Parse electionCodes from comma-separated string
  - [ ] Connect to `analyticsService.getPartyAffiliation()`
  - [ ] Format response according to standards
  - [ ] Add error handling

### Phase 3: Demographics Implementation

- [ ] **Create demographics route handler**
  - [ ] Add validation middleware
  - [ ] Define service method signature
- [ ] **Implement service method** in analytics-service.js
  - [ ] Query by city
  - [ ] Query by zip code
  - [ ] Calculate registration trends
  - [ ] Add caching (15-minute TTL)

### Phase 4: Validation & Error Handling

- [ ] **Add missing validation** to turnout route
- [ ] **Add missing validation** to voting-patterns route
- [ ] **Verify all validators** use correct patterns
- [ ] **Test validation errors** return proper 400 responses
- [ ] **Test database errors** return proper 500 responses

### Phase 5: Performance Optimization

- [ ] **Verify caching implementation** in all routes
- [ ] **Add query time tracking** to all endpoints
- [ ] **Optimize SQL queries** (remove inefficiencies)
- [ ] **Add parallel query execution** where applicable

### Phase 6: Testing

- [ ] **Write unit tests** for analytics service methods
- [ ] **Write integration tests** for all routes
- [ ] **Test all filter combinations**
- [ ] **Test error scenarios**
- [ ] **Performance test** with load

### Phase 7: Documentation

- [ ] **Complete JSDoc comments** for all routes
- [ ] **Document query parameters** in route comments
- [ ] **Add response examples** to route comments
- [ ] **Update IMPLEMENTATION_PLAN.md** if needed

---

## Dependencies and Requirements

### Required npm Packages (Already Installed)
- ✅ `express` - Web framework
- ✅ `express-validator` - Input validation
- ✅ `sqlite3` - Database driver

### Database Requirements
- ✅ SQLite database at `data/voter_platform.db`
- ✅ Tables: `voters`, `election_history`, `precincts`, `import_logs`
- ⚠️ **Indexes needed:** Consider adding indexes on frequently queried columns

### Recommended Database Indexes
```sql
-- Improve analytics query performance
CREATE INDEX IF NOT EXISTS idx_voters_precinct ON voters(precinct_number);
CREATE INDEX IF NOT EXISTS idx_voters_super ON voters(super_voter);
CREATE INDEX IF NOT EXISTS idx_election_voter ON election_history(voter_id);
CREATE INDEX IF NOT EXISTS idx_election_code ON election_history(election_code);
CREATE INDEX IF NOT EXISTS idx_election_party ON election_history(party_code);
CREATE INDEX IF NOT EXISTS idx_election_voted ON election_history(voted);
```

---

## Summary

This specification provides comprehensive guidance for implementing the Analytics Routes module including:

1. ✅ **Current state analysis** of existing code (what works, what's missing)
2. ✅ **7 research sources** covering REST API design, Express.js patterns, SQL optimization, caching, response formatting, error handling, and input validation
3. ✅ **6 endpoint specifications** with detailed requirements, validation rules, and response structures
4. ✅ **7 database query patterns** for common analytics operations
5. ✅ **Comprehensive error handling** requirements with examples
6. ✅ **Performance optimization** strategies including caching and parallel queries
7. ✅ **Integration requirements** matching existing codebase patterns
8. ✅ **Testing strategy** with unit and integration test guidance
9. ✅ **Implementation checklist** broken into 7 phases
10. ✅ **Dependencies** and database index recommendations

**Estimated Implementation Time:** 17-20 hours (2-3 work days)

**Next Step:** Begin Phase 1 (Code Cleanup & Structure) by removing duplicate routes and completing partial implementations.

---

**Specification Complete**  
**File Location:** `.github/docs/SubAgent docs/analytics_routes_spec.md`  
**Ready for Implementation:** Yes
