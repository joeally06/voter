# Phase 2: Data Import System - Comprehensive Specification

**Project:** Voter Outreach & Mapping Platform  
**Phase:** 2 - Data Import and Processing  
**Date:** February 6, 2026  
**Status:** Specification Complete - Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Research Findings](#research-findings)
4. [Proposed Architecture](#proposed-architecture)
5. [Database Schema](#database-schema)
6. [API Endpoints Design](#api-endpoints-design)
7. [File Format Specifications](#file-format-specifications)
8. [Data Validation & Sanitization](#data-validation--sanitization)
9. [Implementation Steps](#implementation-steps)
10. [Dependencies](#dependencies)
11. [Security Considerations](#security-considerations)
12. [Performance Considerations](#performance-considerations)
13. [Testing Approach](#testing-approach)
14. [Risks & Mitigations](#risks--mitigations)

---

## Executive Summary

Phase 2 implements the core data import functionality for the Voter Outreach & Mapping Platform, enabling users to import voter data from DBF (dBASE/Shapefile) and CSV files. The system will parse, validate, deduplicate, and store voter records with comprehensive error handling, progress tracking, and rollback capabilities for failed imports.

**Key Deliverables:**
- DBF and CSV file parsing with data validation
- Batch database insertion with transaction support
- Real-time import progress tracking
- Data deduplication and conflict resolution
- Comprehensive error handling and rollback
- Import history and status reporting
- Full implementation of voter CRUD operations

---

## Current State Analysis

### Existing Infrastructure (Phase 1)

**✅ Completed Components:**

1. **Database Layer** (`backend/config/database.js`)
   - SQLite connection management with singleton pattern
   - Transaction support with automatic rollback
   - Query methods: `run()`, `get()`, `all()`, `transaction()`
   - Database backup and optimization utilities
   - Graceful shutdown handling

2. **Database Schema** (Created by `scripts/setup.js`)
   - `voters` table: Core voter information with geocoding fields
   - `election_history` table: Voting history records
   - `precincts` table: Precinct metadata and statistics
   - `geocoding_cache` table: Address geocoding results cache
   - `import_logs` table: File upload and processing tracking
   - Performance indexes on key fields

3. **Upload Route** (`backend/routes/upload.js`)
   - POST `/api/upload/dbf` - File upload with multer
   - File validation (DBF only, max 100MB)
   - Filename sanitization (path traversal prevention)
   - Import log tracking (filename, size, status)
   - GET `/api/upload/history` - Upload history listing
   - GET `/api/upload/:id` - Individual upload details
   - Rate limiting (10 uploads per hour per IP)

4. **Voter Routes** (`backend/routes/voters.js`)
   - Route stubs with input validation
   - Query parameter validation using express-validator
   - Endpoints awaiting Phase 2 implementation

5. **Server Infrastructure** (`backend/server.js`)
   - Express server with security middleware (helmet, cors)
   - Rate limiting on API and upload routes
   - Request compression and logging
   - Error handling middleware
   - Static file serving

**🔴 Phase 2 Requirements:**

1. **Missing Parsers:**
   - No DBF parser implementation in `backend/parsers/` directory
   - No CSV parser implementation
   - No data transformation logic

2. **Missing Models:**
   - No voter model with CRUD operations
   - No import processor for batch operations
   - No validation schemas

3. **Missing Services:**
   - No import job queue/processor
   - No deduplication service
   - No progress tracking mechanism

4. **Incomplete Routes:**
   - Upload route logs files but doesn't process them
   - Voter routes return placeholder responses only
   - No status tracking endpoints for ongoing imports

---

## Research Findings

### 1. DBF File Parsing in Node.js

**Research Sources:**
- [shapefile npm package](https://www.npmjs.com/package/shapefile) - v0.6.6 (already installed)
- [DBF file format specification](https://www.clicketyclick.dk/databases/xbase/format/dbf.html)
- [MDN: Working with files in Node.js](https://nodejs.org/api/fs.html)

**Key Findings:**

✅ **Recommended Library: shapefile v0.6.6** (already in package.json)
- Industry-standard library for DBF and Shapefile parsing
- Stream-based parsing for memory efficiency with large files
- Promise-based API for modern async/await patterns
- Handles complex field types (character, numeric, date, logical)
- Active maintenance and community support

**Alternative Considered:**
- `dbffile` - Lower-level, requires more manual work
- `shapefile` superior for production use

**DBF Parsing Strategy:**
```javascript
const shapefile = require('shapefile');

// Stream-based reading for memory efficiency
async function readDBF(filePath) {
  const source = await shapefile.openDbf(filePath);
  let result;
  const records = [];
  
  while ((result = await source.read()).done === false) {
    records.push(result.value);
  }
  
  return records;
}
```

### 2. CSV File Parsing Best Practices

**Research Sources:**
- [csv-parser npm package](https://www.npmjs.com/package/csv-parser) - v3.0.0 (installed)
- [Papa Parse documentation](https://www.papaparse.com/docs)
- [Node.js streams best practices](https://nodejs.org/api/stream.html)

**Key Findings:**

✅ **Recommended Library: csv-parser v3.0.0** (already in package.json)
- Stream-based parsing prevents memory overflow
- Automatic header mapping to JavaScript objects
- Strict mode for validation
- Column name normalization
- Error event handling

**Implementation Pattern:**
```javascript
const csv = require('csv-parser');
const fs = require('fs');

async function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const records = [];
    
    fs.createReadStream(filePath)
      .pipe(csv({
        strict: true,
        mapHeaders: ({ header }) => header.trim().toLowerCase()
      }))
      .on('data', (row) => records.push(row))
      .on('error', reject)
      .on('end', () => resolve(records));
  });
}
```

### 3. Voter Data Schema Standards

**Research Sources:**
- [VoteBuilder field standards](https://www.ngpvan.com/content/votebuilder)
- [ERIC (Electronic Registration Information Center) data specifications](https://ericstates.org/)
- [NCOA (National Change of Address) database standards](https://postalpro.usps.com/address-quality)

**Standard Voter Data Fields:**

**Required Fields:**
- `voter_id` - Unique identifier (state voter ID)
- `last_name` - Last name / surname
- `first_name` - First name / given name
- `address` - Street address
- `city` - City name
- `zip_code` - ZIP or ZIP+4 code
- `precinct_number` - Voting precinct

**Optional Fields (Common):**
- `middle_name` - Middle name or initial
- `suffix` - Name suffix (Jr., Sr., III)
- `date_of_birth` - Date of birth (for validation)
- `registration_date` - Voter registration date
- `party_affiliation` - Political party
- `phone` - Contact phone number
- `email` - Email address
- `status` - Active/Inactive/Suspended

**Election History Fields (Obion County Format):**
- `E_1`, `E_2`, `E_3`... - Election participation columns
- Format: `Y` (voted), `N` (did not vote), `R` (Republican primary), `D` (Democratic primary), `E` (early voted)

### 4. Large File Upload Handling

**Research Sources:**
- [multer documentation](https://github.com/expressjs/multer) - v1.4.4 (installed)
- [Node.js streams](https://nodejs.org/api/stream.html)
- [Express best practices for production](https://expressjs.com/en/advanced/best-practice-performance.html)

**Key Findings:**

✅ **Current Implementation:**
- Multer configured with disk storage (good for large files)
- 100MB file size limit (appropriate for voter data)
- Files stored in `data/raw/` with timestamp prefixes

✅ **Best Practices Applied:**
- Disk storage instead of memory storage
- File type validation (DBF only currently)
- Filename sanitization
- Rate limiting (10 uploads/hour)

**Enhancements Needed:**
- Add CSV file type support (`.csv`)
- Implement chunked processing for files >10MB
- Add progress tracking for large file parsing

### 5. Data Deduplication Strategies

**Research Sources:**
- [Fuzzy matching algorithms](https://en.wikipedia.org/wiki/Approximate_string_matching)
- [Levenshtein distance](https://github.com/gustf/js-levenshtein)
- [Database indexing strategies for deduplication](https://use-the-index-luke.com/)

**Key Findings:**

**Primary Key Strategy:**
- Use `voter_id` as primary deduplication key
- voter_id is marked UNIQUE in database schema
- State voter IDs are generally stable and reliable

**Conflict Resolution Options:**

1. **Skip Duplicates** (Default)
   - INSERT OR IGNORE - Skip if voter_id exists
   - Fastest, simplest approach
   - Use for initial bulk imports

2. **Update Existing** (Recommended)
   - INSERT OR REPLACE - Update if voter_id exists
   - Keeps data current with latest file
   - Use for regular data refreshes

3. **Flag Conflicts**
   - Log duplicates for manual review
   - Store original + new data for comparison
   - Use when data accuracy is critical

**Implementation:**
```sql
-- Skip duplicates
INSERT OR IGNORE INTO voters (voter_id, ...) VALUES (?, ...);

-- Update existing
INSERT OR REPLACE INTO voters (voter_id, ...) VALUES (?, ...);

-- Detect conflicts
SELECT COUNT(*) FROM voters WHERE voter_id = ?;
```

### 6. Progress Tracking for Long-Running Imports

**Research Sources:**
- [Bull queue documentation](https://optimalbits.github.io/bull/)
- [Server-Sent Events (SSE) for real-time updates](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [WebSocket alternatives for progress tracking](https://socket.io/docs/v4/)

**Key Findings:**

**Recommended Approach: Database Polling** (No additional dependencies)

✅ **Advantages:**
- Simple implementation using existing `import_logs` table
- No additional infrastructure (queues, Redis, WebSockets)
- Works with current architecture
- Reliable and easy to debug

**Implementation Strategy:**
```javascript
// Update import_logs during processing
await database.run(
  `UPDATE import_logs 
   SET records_processed = ?, 
       records_successful = ?, 
       records_failed = ?,
       status = ?
   WHERE id = ?`,
  [processed, successful, failed, 'processing', importId]
);

// Frontend polls every 2 seconds
GET /api/upload/:id -> { 
  status: 'processing',
  progress: { processed: 1500, total: 5000, percent: 30 }
}
```

**Alternative for Future Enhancement:**
- Bull queue + Redis for background job processing
- Deferred to Phase 5 for advanced features

### 7. Error Handling and Rollback Mechanisms

**Research Sources:**
- [SQLite transaction best practices](https://www.sqlite.org/lang_transaction.html)
- [Node.js error handling patterns](https://nodejs.org/api/errors.html)
- [Express error handling middleware](https://expressjs.com/en/guide/error-handling.html)

**Key Findings:**

**Transaction Strategy:**
- Use batch transactions (e.g., 1000 records per transaction)
- Full file rollback too costly for large imports
- Log failed records for manual review

**Error Categorization:**

1. **File-Level Errors** (Fatal - stop import)
   - File not found / corrupt
   - Invalid file format
   - Unsupported schema

2. **Record-Level Errors** (Non-fatal - log and continue)
   - Missing required fields
   - Data type validation failures
   - Foreign key violations

3. **System Errors** (Fatal - rollback current batch)
   - Database connection lost
   - Disk space exhausted
   - Out of memory

**Implementation Pattern:**
```javascript
try {
  // Process in batches of 1000
  for (let batch of batches) {
    await database.transaction(
      batch.map(record => ({
        sql: 'INSERT INTO voters (...) VALUES (...)',
        params: [...]
      }))
    );
  }
} catch (error) {
  // Rollback current batch only
  // Log error to import_logs
  // Continue with next batch or stop if fatal
}
```

---

## Proposed Architecture

### Data Import Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND                                                    │
│ ┌─────────────┐                                             │
│ │ File Upload │ → Upload DBF/CSV file                       │
│ └─────────────┘                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │ POST /api/upload/dbf or /csv
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ BACKEND - Upload Route                                      │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ 1. Validate File (type, size, name)                 │     │
│ │ 2. Save to data/raw/ with timestamp                 │     │
│ │ 3. Create import_logs entry (status: pending)       │     │
│ │ 4. Return import job ID                             │     │
│ └─────────────────────────────────────────────────────┘     │
└─────────────────────────┬───────────────────────────────────┘
                          │ Trigger async processing
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ IMPORT PROCESSOR SERVICE                                    │
│ ┌─────────────────────────────────────────────────────┐     │
│ │ 1. Update status: processing                        │     │
│ │ 2. Parse file (DBF or CSV)                          │     │
│ │ 3. Validate each record                             │     │
│ │ 4. Transform to database schema                     │     │
│ │ 5. Batch insert (1000 records/transaction)          │     │
│ │ 6. Update progress in import_logs                   │     │
│ │ 7. Handle errors (log & continue)                   │     │
│ │ 8. Update precinct statistics                       │     │
│ │ 9. Update status: completed/failed                  │     │
│ └─────────────────────────────────────────────────────┘     │
└─────────────────────────┬───────────────────────────────────┘
                          │ Store validated data
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ DATABASE (SQLite)                                           │
│ ┌──────────┐  ┌──────────────────┐  ┌──────────┐           │
│ │  voters  │  │ election_history │  │precincts │           │
│ └──────────┘  └──────────────────┘  └──────────┘           │
│ ┌─────────────────┐  ┌──────────────────────────┐          │
│ │ geocoding_cache │  │ import_logs (tracking)   │          │
│ └─────────────────┘  └──────────────────────────┘          │
└─────────────────────────┬───────────────────────────────────┘
                          │ Query results
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ VOTER API ROUTES                                            │
│ GET /api/voters → List with filters                         │
│ GET /api/voters/:id → Individual voter details              │
│ GET /api/voters/search/:query → Search by name/address      │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**1. Upload Route** (`backend/routes/upload.js`)
- Accept file uploads (DBF/CSV)
- Validate file metadata
- Create import log entry
- Trigger import processor
- Return job ID for tracking

**2. Import Processor Service** (`backend/services/import-processor.js`) ⭐ NEW
- Asynchronous file processing
- Parse DBF/CSV files
- Validate and transform records
- Batch database operations
- Progress tracking
- Error handling and logging

**3. DBF Parser** (`backend/parsers/dbf-parser.js`) ⭐ NEW
- Read DBF files using shapefile library
- Extract voter records
- Parse election history columns (E_1, E_2, etc.)
- Return normalized data structure

**4. CSV Parser** (`backend/parsers/csv-parser.js`) ⭐ NEW
- Read CSV files with csv-parser library
- Map headers to database fields
- Validate CSV structure
- Return normalized data structure

**5. Voter Model** (`backend/models/voter.js`) ⭐ NEW
- CRUD operations for voters
- Validation schemas
- Deduplication logic
- Precinct statistics updates

**6. Voter Routes** (`backend/routes/voters.js`)
- Implement GET endpoints
- Filter, search, pagination
- Input validation

---

## Database Schema

### Current Schema (Phase 1 - Established)

**voters** - Core voter information
```sql
CREATE TABLE voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT UNIQUE,              -- State voter ID (dedup key)
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    precinct_number TEXT NOT NULL,
    latitude REAL,                      -- Geocoded coordinates (Phase 3)
    longitude REAL,                     -- Geocoded coordinates (Phase 3)
    geocoding_quality TEXT,             -- Geocoding result quality (Phase 3)
    super_voter BOOLEAN DEFAULT 0,      -- High-frequency voter flag
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**election_history** - Voting history records
```sql
CREATE TABLE election_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT,
    election_code TEXT,                 -- E_1, E_2, E_3, etc.
    voted BOOLEAN DEFAULT 0,            -- Y/N/1/0
    party_code TEXT,                    -- R, D, I, etc.
    early_voted BOOLEAN DEFAULT 0,      -- E indicator
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (voter_id) REFERENCES voters(voter_id)
);
```

**precincts** - Precinct metadata
```sql
CREATE TABLE precincts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    precinct_number TEXT UNIQUE NOT NULL,
    name TEXT,
    total_voters INTEGER DEFAULT 0,
    active_voters INTEGER DEFAULT 0,
    super_voters INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**import_logs** - Import tracking
```sql
CREATE TABLE import_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_size INTEGER,
    records_processed INTEGER DEFAULT 0,    -- Total records parsed
    records_successful INTEGER DEFAULT 0,   -- Successfully inserted
    records_failed INTEGER DEFAULT 0,       -- Validation/insert failures
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    status TEXT DEFAULT 'pending',          -- pending, processing, completed, failed
    error_message TEXT
);
```

### Schema Enhancements for Phase 2

**Option 1: Add error details table** (Recommended)
```sql
CREATE TABLE import_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER,
    record_number INTEGER,              -- Line number in file
    error_type TEXT,                    -- validation, constraint, system
    error_message TEXT,
    record_data TEXT,                   -- JSON string of failed record
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_id) REFERENCES import_logs(id)
);
```

**Rationale:**
- Detailed error tracking for debugging
- Manual review of failed records
- Audit trail for data quality

**Option 2: Extend voters table** (Optional - defer to Phase 5)
```sql
-- Additional fields for enhanced data
ALTER TABLE voters ADD COLUMN middle_name TEXT;
ALTER TABLE voters ADD COLUMN suffix TEXT;
ALTER TABLE voters ADD COLUMN date_of_birth DATE;
ALTER TABLE voters ADD COLUMN party_affiliation TEXT;
ALTER TABLE voters ADD COLUMN registration_date DATE;
ALTER TABLE voters ADD COLUMN status TEXT DEFAULT 'active';
```

**Decision:** Implement Option 1 immediately for error tracking. Defer Option 2 until data requirements are confirmed with actual DBF files.

---

## API Endpoints Design

### Upload Endpoints (Enhanced)

#### POST `/api/upload/dbf`
Upload and process DBF voter data file.

**Request:**
```
Content-Type: multipart/form-data

file: <DBF file>
description: "Q4 2025 voter data" (optional)
importMode: "skip" | "replace" | "flag" (optional, default: "replace")
```

**Response (Success):**
```json
{
  "success": true,
  "message": "File uploaded and queued for processing",
  "import": {
    "id": 42,
    "filename": "1707235200000_voters_q4_2025.dbf",
    "originalName": "voters_q4_2025.dbf",
    "size": 15728640,
    "status": "processing",
    "progress": {
      "processed": 0,
      "successful": 0,
      "failed": 0,
      "total": null
    },
    "startTime": "2026-02-06T10:30:00.000Z"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "File too large",
  "message": "Maximum file size is 100MB"
}
```

#### POST `/api/upload/csv`
Upload and process CSV voter data file.

**Request:**
```
Content-Type: multipart/form-data

file: <CSV file>
description: "Supplemental voter data" (optional)
importMode: "skip" | "replace" | "flag" (optional, default: "replace")
hasHeaders: true | false (optional, default: true)
```

**Response:** Same format as `/api/upload/dbf`

#### GET `/api/upload/:id`
Get detailed status of a specific import job.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 42,
    "filename": "1707235200000_voters_q4_2025.dbf",
    "fileSize": 15728640,
    "status": "processing",
    "progress": {
      "processed": 3500,
      "successful": 3475,
      "failed": 25,
      "total": 5000,
      "percent": 70.0
    },
    "startTime": "2026-02-06T10:30:00.000Z",
    "endTime": null,
    "errorMessage": null,
    "errors": [
      {
        "recordNumber": 145,
        "errorType": "validation",
        "message": "Missing required field: address"
      }
    ]
  }
}
```

#### GET `/api/upload/history`
List recent import jobs with filtering and pagination.

**Query Parameters:**
- `limit` - Number of results (default: 20, max: 100)
- `status` - Filter by status (pending, processing, completed, failed)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "count": 15,
  "total": 42,
  "data": [
    {
      "id": 42,
      "filename": "voters_q4_2025.dbf",
      "status": "completed",
      "recordsProcessed": 5000,
      "recordsSuccessful": 4975,
      "recordsFailed": 25,
      "startTime": "2026-02-06T10:30:00Z",
      "endTime": "2026-02-06T10:35:23Z"
    }
  ]
}
```

### Voter Endpoints (Full Implementation)

#### GET `/api/voters`
List voters with filtering, searching, and pagination.

**Query Parameters:**
- `precinct` - Filter by precinct number (integer)
- `name` - Search by name (partial match, min 2 chars)
- `super_voter` - Filter super voters (true/false)
- `limit` - Results per page (default: 100, max: 1000)
- `offset` - Pagination offset (default: 0)
- `sort` - Sort field (last_name, first_name, precinct_number)
- `order` - Sort order (asc, desc, default: asc)

**Response:**
```json
{
  "success": true,
  "count": 100,
  "total": 5342,
  "filters": {
    "precinct": "05",
    "super_voter": true
  },
  "data": [
    {
      "id": 1234,
      "voterId": "TN12345678",
      "lastName": "Smith",
      "firstName": "John",
      "address": "123 Main St",
      "city": "Union City",
      "zipCode": "38261",
      "precinctNumber": "05",
      "superVoter": true,
      "createdAt": "2026-02-06T10:35:00Z"
    }
  ]
}
```

#### GET `/api/voters/:id`
Get detailed information for a specific voter.

**Parameters:**
- `id` - Voter database ID (integer)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1234,
    "voterId": "TN12345678",
    "lastName": "Smith",
    "firstName": "John",
    "address": "123 Main St",
    "city": "Union City",
    "zipCode": "38261",
    "precinctNumber": "05",
    "latitude": 36.4242,
    "longitude": -89.0576,
    "geocodingQuality": "ROOFTOP",
    "superVoter": true,
    "createdAt": "2026-02-06T10:35:00Z",
    "updatedAt": "2026-02-06T10:35:00Z",
    "electionHistory": [
      {
        "electionCode": "E_1",
        "voted": true,
        "partyCode": "R",
        "earlyVoted": true
      },
      {
        "electionCode": "E_2",
        "voted": true,
        "partyCode": "R",
        "earlyVoted": false
      }
    ]
  }
}
```

#### GET `/api/voters/search/:query`
Search voters by name or address.

**Parameters:**
- `query` - Search term (min 3 characters)

**Query Parameters:**
- `limit` - Results limit (default: 50, max: 200)

**Response:**
```json
{
  "success": true,
  "query": "john smith",
  "count": 12,
  "data": [
    {
      "id": 1234,
      "voterId": "TN12345678",
      "lastName": "Smith",
      "firstName": "John",
      "address": "123 Main St",
      "city": "Union City",
      "zipCode": "38261",
      "precinctNumber": "05",
      "relevance": 0.95
    }
  ]
}
```

#### GET `/api/voters/precinct/:precinct`
Get all voters in a specific precinct with statistics.

**Parameters:**
- `precinct` - Precinct number (e.g., "05")

**Response:**
```json
{
  "success": true,
  "precinct": {
    "number": "05",
    "name": "Precinct 5",
    "totalVoters": 1250,
    "superVoters": 325
  },
  "voters": [
    {
      "id": 1234,
      "voterId": "TN12345678",
      "lastName": "Smith",
      "firstName": "John",
      "address": "123 Main St",
      "superVoter": true
    }
  ]
}
```

---

## File Format Specifications

### DBF File Format (Obion County Election Commission)

**Expected Structure:**

DBF files from Obion County contain voter registration data with election history in columnar format.

**Standard Fields:**
- `VOTER_ID` - Tennessee voter ID (8-10 digits)
- `LNAME` - Last name (uppercase, max 50 chars)
- `FNAME` - First name (uppercase, max 50 chars)
- `ADDRESS` - Street address (max 100 chars)
- `CITY` - City name (max 50 chars)
- `ZIP` - ZIP code (5 or 9 digits)
- `PCT_NBR` - Precinct number (2 digits, zero-padded)

**Election History Columns:**
- `E_1`, `E_2`, `E_3`, `E_4`, `E_5`, ... (up to 20+ elections)
- Values:
  - `Y` - Voted in general election
  - `N` - Did not vote
  - `R` - Voted in Republican primary
  - `D` - Voted in Democratic primary
  - `E` - Early voted (suffix to other values, e.g., "RE", "DE")
  - Empty/Null - Not eligible for that election

**Example DBF Record:**
```
VOTER_ID: TN12345678
LNAME: SMITH
FNAME: JOHN
ADDRESS: 123 MAIN ST
CITY: UNION CITY
ZIP: 38261
PCT_NBR: 05
E_1: RE
E_2: Y
E_3: N
E_4: DE
E_5: Y
```

**Parsing Strategy:**
```javascript
// Parse election history columns
const electionColumns = Object.keys(record).filter(key => key.startsWith('E_'));

const electionHistory = electionColumns.map(electionCode => {
  const value = record[electionCode] || '';
  const upperValue = value.toString().trim().toUpperCase();
  
  return {
    electionCode,
    voted: ['Y', 'R', 'D', 'RE', 'DE'].includes(upperValue),
    partyCode: upperValue.includes('R') ? 'R' : upperValue.includes('D') ? 'D' : null,
    earlyVoted: upperValue.includes('E')
  };
});
```

### CSV File Format

**Accepted Headers (Case-Insensitive):**

CSV files must include at minimum: voter_id, last_name, first_name, address, city, zip_code, precinct_number

**Standard Mapping:**
```
CSV Header          →   Database Field
-----------------------------------------
voter_id            →   voter_id
voter_id           →   voter_id (alternate)
last_name           →   last_name
lastname            →   last_name (alternate)
lname              →   last_name (alternate)
first_name          →   first_name
firstname           →   first_name (alternate)
fname              →   first_name (alternate)
address            →   address
street             →   address (alternate)
city               →   city
zip                →   zip_code
zip_code           →   zip_code
zipcode            →   zip_code (alternate)
precinct           →   precinct_number
precinct_number    →   precinct_number
pct_nbr            →   precinct_number (alternate)
```

**Example CSV Format:**
```csv
voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,Smith,John,123 Main St,Union City,38261,05
TN12345679,Johnson,Mary,456 Oak Ave,Union City,38261,03
TN12345680,Williams,Robert,789 Elm St,Troy,38260,01
```

**CSV Validation Rules:**
1. First row must be headers (configurable with `hasHeaders` param)
2. Minimum required columns: 7 (all required fields)
3. Maximum file size: 100MB
4. Encoding: UTF-8 (with BOM detection)
5. Delimiter: Comma (,) or semicolon (;) - auto-detect
6. Quotes: Double quotes for fields containing commas

---

## Data Validation & Sanitization

### Validation Pipeline

Every imported record passes through a 3-stage validation pipeline:

```
Record → [1. Format Validation] → [2. Business Rules] → [3. Database Constraints] → INSERT
           ↓ FAIL                  ↓ FAIL                ↓ FAIL
         Log Error              Log Error             Log Error + Rollback Batch
```

### Stage 1: Format Validation

**Field-Level Validation:**

```javascript
const validationRules = {
  voter_id: {
    required: true,
    type: 'string',
    minLength: 8,
    maxLength: 20,
    pattern: /^[A-Z0-9]+$/i,
    errorMessage: 'Voter ID must be 8-20 alphanumeric characters'
  },
  
  last_name: {
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 50,
    sanitize: (val) => val.trim().toUpperCase(),
    errorMessage: 'Last name is required (max 50 chars)'
  },
  
  first_name: {
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 50,
    sanitize: (val) => val.trim().toUpperCase(),
    errorMessage: 'First name is required (max 50 chars)'
  },
  
  address: {
    required: true,
    type: 'string',
    minLength: 3,
    maxLength: 200,
    sanitize: (val) => val.trim().toUpperCase(),
    errorMessage: 'Address must be 3-200 characters'
  },
  
  city: {
    required: true,
    type: 'string',
    minLength: 2,
    maxLength: 50,
    sanitize: (val) => val.trim().toUpperCase(),
    errorMessage: 'City is required (max 50 chars)'
  },
  
  zip_code: {
    required: true,
    type: 'string',
    pattern: /^\d{5}(-\d{4})?$/,
    sanitize: (val) => val.trim(),
    errorMessage: 'ZIP code must be 5 digits or ZIP+4 format'
  },
  
  precinct_number: {
    required: true,
    type: 'string',
    pattern: /^\d{1,3}$/,
    sanitize: (val) => val.toString().padStart(2, '0'),
    errorMessage: 'Precinct number must be 1-3 digits'
  }
};
```

### Stage 2: Business Rules Validation

**Cross-Field Validation:**
- Verify precinct_number exists in precincts table (or auto-create)
- Validate city is within Obion County (allowlist)
- Check ZIP code matches city (optional warning, not error)

**Data Quality Checks:**
```javascript
async function businessRulesValidation(record) {
  const warnings = [];
  
  // Check precinct exists
  const precinct = await database.get(
    'SELECT id FROM precincts WHERE precinct_number = ?',
    [record.precinct_number]
  );
  
  if (!precinct) {
    // Auto-create precinct
    await database.run(
      'INSERT OR IGNORE INTO precincts (precinct_number, name) VALUES (?, ?)',
      [record.precinct_number, `Precinct ${record.precinct_number}`]
    );
  }
  
  // Validate Obion County city
  const validCities = ['UNION CITY', 'TROY', 'RIVES', 'OBION', 'KENTON', 'SOUTH FULTON'];
  if (!validCities.includes(record.city)) {
    warnings.push(`Unusual city name: ${record.city}`);
  }
  
  return { valid: true, warnings };
}
```

### Stage 3: Database Constraints

**Enforced by Schema:**
- `voter_id` UNIQUE - Prevents duplicate voter IDs
- `NOT NULL` constraints on required fields
- Foreign key validation for election_history

**Deduplication Handling:**

```javascript
async function insertVoter(record, importMode = 'replace') {
  const fields = ['voter_id', 'last_name', 'first_name', 'address', 'city', 'zip_code', 'precinct_number'];
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map(field => record[field]);
  
  let sql;
  
  if (importMode === 'skip') {
    // INSERT OR IGNORE - Skip if voter_id exists
    sql = `INSERT OR IGNORE INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
  } else if (importMode === 'replace') {
    // INSERT OR REPLACE - Update if voter_id exists
    sql = `INSERT OR REPLACE INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
  } else if (importMode === 'flag') {
    // Check for conflict first
    const existing = await database.get('SELECT id FROM voters WHERE voter_id = ?', [record.voter_id]);
    if (existing) {
      throw new Error(`Duplicate voter_id: ${record.voter_id} (existing ID: ${existing.id})`);
    }
    sql = `INSERT INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
  }
  
  return await database.run(sql, values);
}
```

### Sanitization Rules

**Applied to All Text Fields:**
1. **Trim whitespace** - Remove leading/trailing spaces
2. **Normalize case** - Convert to UPPERCASE (consistent with DBF format)
3. **Remove special characters** - Strip non-printable characters
4. **Validate encoding** - Ensure UTF-8 compatibility

**Security Sanitization:**
1. **SQL Injection Prevention** - Use parameterized queries (already enforced)
2. **Path Traversal Prevention** - Validate filenames (already implemented in upload route)
3. **XSS Prevention** - Escape HTML in API responses (handled by Express)

**Implementation:**
```javascript
function sanitizeText(value, maxLength = 255) {
  if (!value) return null;
  
  return value
    .toString()
    .trim()
    .replace(/[^\x20-\x7E]/g, '') // Remove non-printable chars
    .substring(0, maxLength)
    .toUpperCase();
}
```

---

## Implementation Steps

### Step 1: Database Schema Enhancements

**File:** `scripts/setup.js` or migration script

**Task:** Add `import_errors` table for detailed error tracking

```sql
CREATE TABLE IF NOT EXISTS import_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL,
    record_number INTEGER,
    error_type TEXT,
    error_message TEXT,
    record_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (import_id) REFERENCES import_logs(id)
);

CREATE INDEX IF NOT EXISTS idx_import_errors_import ON import_errors(import_id);
```

**Deliverable:** Migration script or updated setup.js

---

### Step 2: Create DBF Parser

**File:** `backend/parsers/dbf-parser.js` (NEW)

**Responsibilities:**
- Open and read DBF files using shapefile library
- Parse voter records with election history
- Return normalized data structure
- Handle file format errors

**Key Functions:**
```javascript
async function parseDBF(filePath) {
  // Open DBF file
  // Read all records
  // Parse election history columns
  // Return { records, totalCount, elections }
}

function parseElectionHistory(record) {
  // Extract E_1, E_2, ... columns
  // Parse voting indicators
  // Return array of election history objects
}
```

**Deliverable:** Fully functional DBF parser with error handling

---

### Step 3: Create CSV Parser

**File:** `backend/parsers/csv-parser.js` (NEW)

**Responsibilities:**
- Read CSV files with csv-parser library
- Map headers to database fields (flexible mapping)
- Validate CSV structure
- Return normalized data structure

**Key Functions:**
```javascript
async function parseCSV(filePath, options = {}) {
  // Detect delimiter (comma vs semicolon)
  // Parse with csv-parser
  // Map headers to standard fields
  // Return { records, totalCount }
}

function mapCSVHeaders(headers) {
  // Map various header formats to standard fields
  // Return field mapping object
}
```

**Deliverable:** CSV parser with flexible header mapping

---

### Step 4: Create Import Processor Service

**File:** `backend/services/import-processor.js` (NEW)

**Responsibilities:**
- Orchestrate full import workflow
- Validate records
- Batch database insertions
- Update progress
- Handle errors
- Update statistics

**Key Functions:**
```javascript
async function processImport(importId, filePath, fileType, options = {}) {
  // 1. Update status: processing
  // 2. Parse file (DBF or CSV)
  // 3. Validate records
  // 4. Batch insert with transactions
  // 5. Update import_logs progress
  // 6. Handle errors
  // 7. Update precinct statistics
  // 8. Set final status
}

async function processBatch(records, importId, importMode) {
  // Insert batch of records (500-1000)
  // Use database.transaction()
  // Log errors to import_errors table
  // Return success/failure counts
}

async function updatePrecinctStats() {
  // Recalculate voter counts per precinct
  // Update super_voter counts
}
```

**Deliverable:** Complete import processor with progress tracking

---

### Step 5: Create Voter Model

**File:** `backend/models/voter.js` (NEW)

**Responsibilities:**
- CRUD operations for voters
- Validation logic
- Query builders for filtering
- Super voter calculation

**Key Functions:**
```javascript
class VoterModel {
  async create(voterData, importMode = 'replace') {
    // Insert or update voter
    // Return voter ID
  }
  
  async findById(id) {
    // Get voter by database ID
    // Include election history
  }
  
  async findAll(filters = {}, pagination = {}) {
    // List voters with filters
    // Support precinct, name, super_voter filters
    // Pagination support
  }
  
  async search(query, limit = 50) {
    // Search by name or address
    // Use LIKE queries
    // Return relevance-sorted results
  }
  
  async calculateSuperVoter(voterId) {
    // Count elections voted
    // If >= 4 of last 5, mark as super_voter
  }
}
```

**Deliverable:** Voter model with all CRUD operations

---

### Step 6: Enhance Upload Routes

**File:** `backend/routes/upload.js` (UPDATE)

**Changes:**
1. Add CSV file upload endpoint (POST `/api/upload/csv`)
2. Trigger import processor after file upload
3. Support `importMode` parameter (skip/replace/flag)
4. Add error details endpoint (GET `/api/upload/:id/errors`)

**Implementation:**
```javascript
router.post('/dbf', upload.single('file'), async (req, res, next) => {
  try {
    // ... existing file validation ...
    
    // Create import log
    const logResult = await database.run(
      `INSERT INTO import_logs (filename, file_size, status) 
       VALUES (?, ?, 'pending')`,
      [req.file.filename, req.file.size]
    );
    
    const importId = logResult.lastID;
    
    // Trigger async import processing
    processImport(importId, req.file.path, 'dbf', {
      importMode: req.body.importMode || 'replace'
    }).catch(err => {
      console.error('Import processing error:', err);
    });
    
    res.json({
      success: true,
      import: { id: importId, status: 'pending', ... }
    });
  } catch (error) {
    next(error);
  }
});

// New endpoint for CSV uploads
router.post('/csv', uploadCSV.single('file'), async (req, res, next) => {
  // Similar to DBF endpoint
});

// New endpoint for error details
router.get('/:id/errors', async (req, res, next) => {
  const errors = await database.all(
    'SELECT * FROM import_errors WHERE import_id = ? LIMIT 100',
    [req.params.id]
  );
  res.json({ success: true, errors });
});
```

**Deliverable:** Enhanced upload routes with CSV support

---

### Step 7: Implement Voter Routes

**File:** `backend/routes/voters.js` (UPDATE)

**Changes:**
1. Implement GET `/api/voters` with filters
2. Implement GET `/api/voters/:id` with election history
3. Implement GET `/api/voters/search/:query`
4. Implement GET `/api/voters/precinct/:precinct`

**Implementation:**
```javascript
const VoterModel = require('../models/voter');
const voter = new VoterModel();

router.get('/', async (req, res, next) => {
  try {
    const filters = {
      precinct: req.query.precinct,
      name: req.query.name,
      super_voter: req.query.super_voter
    };
    
    const pagination = {
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0
    };
    
    const result = await voter.findAll(filters, pagination);
    
    res.json({
      success: true,
      count: result.data.length,
      total: result.total,
      filters,
      data: result.data
    });
  } catch (error) {
    next(error);
  }
});

// Implement other endpoints similarly
```

**Deliverable:** Fully functional voter API routes

---

### Step 8: Testing & Validation

**File:** `tests/integration/import.test.js` (NEW)

**Test Cases:**
1. **DBF Import Tests**
   - Valid DBF file import
   - Large file handling (>10MB)
   - Election history parsing
   - Duplicate voter handling (all modes)
   - Invalid file format handling

2. **CSV Import Tests**
   - Valid CSV with headers
   - CSV without headers
   - Various header formats (case variations, alternates)
   - Missing required fields
   - Invalid data types

3. **Validation Tests**
   - Required field validation
   - Format validation (zip code, voter ID)
   - Business rules (precinct auto-creation)
   - Sanitization (trim, uppercase)

4. **Deduplication Tests**
   - Skip mode (INSERT OR IGNORE)
   - Replace mode (INSERT OR REPLACE)
   - Flag mode (throw error on duplicate)

5. **Error Handling Tests**
   - Batch transaction rollback
   - Error logging to import_errors table
   - Partial import success

6. **API Tests**
   - GET /api/voters with filters
   - GET /api/voters/:id
   - Search endpoint
   - Precinct endpoint
   - Pagination

**Deliverable:** Comprehensive test suite with >80% coverage

---

### Step 9: Documentation

**Files:**
- `docs/IMPORT_GUIDE.md` - User guide for importing data
- `docs/API.md` - Updated API documentation
- Inline code comments

**Content:**
- Step-by-step import instructions
- File format requirements
- Troubleshooting common errors
- API endpoint documentation with examples
- Code documentation for maintainability

**Deliverable:** Complete user and developer documentation

---

## Dependencies

### Existing Dependencies (Already Installed)

✅ **Production Dependencies:**
```json
{
  "shapefile": "^0.6.6",        // DBF parsing
  "csv-parser": "^3.0.0",       // CSV parsing
  "multer": "^1.4.4",           // File uploads
  "express-validator": "^7.0.0", // Input validation
  "sqlite3": "^5.1.6",          // Database
  "express": "^4.18.2",         // Web framework
  "dotenv": "^16.3.1"           // Environment config
}
```

✅ **Development Dependencies:**
```json
{
  "jest": "^29.7.0",            // Testing framework
  "supertest": "^6.3.3",        // API testing
  "nodemon": "^3.0.2"           // Development auto-restart
}
```

### New Dependencies (To Install)

None required! All necessary packages are already in package.json.

### Optional Future Enhancements

🔮 **Phase 5 Considerations:**
```json
{
  "bull": "^4.11.5",            // Job queue for background processing
  "ioredis": "^5.3.2",          // Redis client for Bull
  "joi": "^17.11.0",            // Schema validation (alternative to custom validation)
  "fast-csv": "^4.3.6"          // Faster CSV parsing (if performance issues)
}
```

**Decision:** Defer Bull/Redis to Phase 5. Current synchronous processing with progress tracking via database polling is sufficient for initial release.

---

## Security Considerations

### 1. File Upload Security

**Implemented:**
- ✅ File type validation (DBF only currently, CSV in Phase 2)
- ✅ File size limit (100MB)
- ✅ Filename sanitization (alphanumeric, underscore, hyphen, space, dot only)
- ✅ Path traversal prevention
- ✅ Rate limiting (10 uploads/hour per IP)

**Phase 2 Enhancements:**
- File content validation (verify DBF/CSV structure before processing)
- Virus scanning integration (optional, using ClamAV)
- Temporary file cleanup (delete after processing)

**Implementation:**
```javascript
// Add file content validation
const fileValidation = {
  dbf: async (filePath) => {
    // Try to open DBF header
    const source = await shapefile.openDbf(filePath);
    await source.read(); // Read one record to verify format
    return true;
  },
  
  csv: async (filePath) => {
    // Verify CSV structure
    const firstLine = await readFirstLine(filePath);
    return firstLine.includes(',') || firstLine.includes(';');
  }
};
```

### 2. SQL Injection Prevention

**Implemented:**
- ✅ Parameterized queries in database.js (prepared statements)
- ✅ Express-validator for input sanitization
- ✅ No string concatenation in SQL queries

**Verification:**
```javascript
// SECURE - Always use parameterized queries
await database.run('SELECT * FROM voters WHERE voter_id = ?', [voterId]);

// NEVER DO THIS (example of what to avoid)
// await database.run(`SELECT * FROM voters WHERE voter_id = '${voterId}'`);
```

### 3. Access Control

**Current State:**
- No authentication/authorization (local-only application)

**Phase 2 Requirements:**
- Document local-only deployment requirement
- Add security warning in documentation
- Consider basic HTTP authentication for future versions

**Future Enhancement (Phase 5):**
```javascript
// Basic authentication middleware
const basicAuth = require('express-basic-auth');

app.use('/api', basicAuth({
  users: { 'admin': process.env.ADMIN_PASSWORD },
  challenge: true
}));
```

### 4. Data Privacy & Compliance

**Voter Data Protection:**
- Local storage only (no cloud transmission)
- No public web access
- Political use only (per data agreement)
- Data backup encryption (future consideration)

**Audit Logging:**
- Import logs track all data changes
- Error logs capture failed access attempts
- User activity logging (future enhancement)

### 5. Denial of Service (DoS) Prevention

**Implemented:**
- ✅ API rate limiting (100 requests/15min per IP)
- ✅ Upload rate limiting (10 uploads/hour per IP)
- ✅ File size limits (100MB)

**Phase 2 Enhancements:**
- Memory usage monitoring during large imports
- CPU throttling for background processing
- Graceful degradation under load

### 6. Error Information Disclosure

**Security Best Practice:**
- Log detailed errors server-side
- Return generic errors to client
- No stack traces in production

**Implementation:**
```javascript
// Error handler middleware (add to server.js)
app.use((err, req, res, next) => {
  console.error('Error:', err); // Detailed server-side log
  
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    // Never send stack trace in production
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});
```

---

## Performance Considerations

### 1. Large File Handling

**Challenge:** DBF files can contain 10,000+ voter records

**Solutions:**

✅ **Stream-Based Parsing** (Already planned)
```javascript
// Memory-efficient streaming
const source = await shapefile.openDbf(filePath);
let result;

while ((result = await source.read()).done === false) {
  batch.push(result.value);
  
  if (batch.length >= 1000) {
    await processBatch(batch);
    batch = [];
  }
}
```

✅ **Batch Database Insertions**
- Insert 500-1000 records per transaction
- Prevents overwhelming database connection
- Enables partial success (continue after batch failure)

**Benchmarks (Estimated):**
- 1,000 records: ~5-10 seconds
- 10,000 records: ~30-60 seconds
- 50,000 records: ~3-5 minutes

### 2. Database Optimization

**Implemented (Phase 1):**
- ✅ Indexes on voters (precinct, name, address, coords)
- ✅ Index on election_history (voter_id)
- ✅ Index on geocoding_cache (address_hash)
- ✅ VACUUM and ANALYZE commands in database.js

**Phase 2 Enhancements:**
- Use WAL (Write-Ahead Logging) mode for concurrent reads during import
- Increase cache size for import operations
- Disable synchronous mode during bulk import (journal_mode)

**Implementation:**
```javascript
// Optimize for bulk import
async function optimizeForImport() {
  await database.run('PRAGMA journal_mode = WAL');
  await database.run('PRAGMA synchronous = NORMAL');
  await database.run('PRAGMA cache_size = -64000'); // 64MB cache
  await database.run('PRAGMA temp_store = MEMORY');
}

async function restoreDefaultSettings() {
  await database.run('PRAGMA synchronous = FULL');
  await database.run('PRAGMA cache_size = -2000'); // 2MB cache
}
```

### 3. Progress Tracking Efficiency

**Database Polling Approach:**
- Frontend polls every 2 seconds
- Low overhead (single SELECT query)
- No additional infrastructure required

**Optimization:**
```javascript
// Efficient progress query
SELECT 
  status, 
  records_processed, 
  records_successful, 
  records_failed,
  CASE 
    WHEN records_processed > 0 
    THEN (records_processed * 100.0 / file_size) 
    ELSE 0 
  END as percent
FROM import_logs 
WHERE id = ?
```

**Future Enhancement (Phase 5):**
- WebSocket or Server-Sent Events for real-time updates
- Reduces polling overhead
- Better user experience for large imports

### 4. Memory Management

**Strategies:**
1. **Stream Processing** - Never load entire file into memory
2. **Batch Processing** - Process in chunks (500-1000 records)
3. **Garbage Collection** - Clear batch arrays after insertion
4. **Connection Pooling** - Reuse database connections

**Memory Monitoring:**
```javascript
// Log memory usage during import
function logMemoryUsage() {
  const used = process.memoryUsage();
  console.log(`Memory: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
}

// Call periodically during import
setInterval(logMemoryUsage, 10000); // Every 10 seconds
```

### 5. Query Performance

**Voter Listing Endpoint:**
- Potential for slow queries with large datasets
- Need pagination and efficient filtering

**Optimizations:**
```javascript
// Use LIMIT and OFFSET for pagination
SELECT * FROM voters 
WHERE precinct_number = ? 
ORDER BY last_name, first_name 
LIMIT ? OFFSET ?

// Use covering indexes
CREATE INDEX idx_voters_precinct_name 
ON voters(precinct_number, last_name, first_name);

// Count optimization (avoid COUNT(*) on large tables)
// Cache total counts in precincts table
SELECT total_voters FROM precincts WHERE precinct_number = ?
```

### 6. Election History Storage

**Challenge:** Multiple election_history records per voter

**Optimization Options:**

**Option A: Separate Rows (Current Design)**
- Pros: Easy to query specific elections, standard relational model
- Cons: More rows (voter with 10 elections = 10 rows)

**Option B: JSON Column (Alternative)**
- Pros: Single row per voter, faster inserts
- Cons: Harder to query individual elections, requires JSON parsing

**Decision: Stick with Option A (Separate Rows)**
- Better for future queries (e.g., "show all voters who voted in E_1")
- SQLite handles thousands of rows efficiently
- Standard relational design

**SQLite JSON support (for future consideration):**
```sql
-- SQLite 3.38+ supports JSON functions
ALTER TABLE voters ADD COLUMN election_history_json TEXT;

-- Store as JSON
UPDATE voters SET election_history_json = 
'[{"election":"E_1","voted":true,"party":"R"}]' 
WHERE voter_id = ?;

-- Query JSON
SELECT * FROM voters 
WHERE json_extract(election_history_json, '$[0].voted') = true;
```

---

## Testing Approach

### Unit Tests

**Test Files:**
- `tests/unit/dbf-parser.test.js`
- `tests/unit/csv-parser.test.js`
- `tests/unit/voter-model.test.js`
- `tests/unit/validation.test.js`

**Test Coverage:**

**DBF Parser (`dbf-parser.test.js`):**
```javascript
describe('DBF Parser', () => {
  test('should parse valid DBF file', async () => {
    const result = await parseDBF('test-data/sample.dbf');
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0]).toHaveProperty('VOTER_ID');
  });
  
  test('should parse election history columns', async () => {
    const result = await parseDBF('test-data/sample.dbf');
    const history = parseElectionHistory(result.records[0]);
    expect(history).toBeArray();
    expect(history[0]).toHaveProperty('electionCode');
    expect(history[0]).toHaveProperty('voted');
  });
  
  test('should handle file not found', async () => {
    await expect(parseDBF('nonexistent.dbf')).rejects.toThrow();
  });
  
  test('should handle corrupt DBF file', async () => {
    await expect(parseDBF('test-data/corrupt.dbf')).rejects.toThrow();
  });
});
```

**CSV Parser (`csv-parser.test.js`):**
```javascript
describe('CSV Parser', () => {
  test('should parse CSV with standard headers', async () => {
    const result = await parseCSV('test-data/voters.csv');
    expect(result.records.length).toBe(100);
  });
  
  test('should map alternate header formats', async () => {
    const result = await parseCSV('test-data/alternate-headers.csv');
    expect(result.records[0].voter_id).toBeDefined();
  });
  
  test('should handle CSV without headers', async () => {
    const result = await parseCSV('test-data/no-headers.csv', { hasHeaders: false });
    expect(result.records.length).toBeGreaterThan(0);
  });
  
  test('should detect semicolon delimiter', async () => {
    const result = await parseCSV('test-data/semicolon.csv');
    expect(result.records.length).toBeGreaterThan(0);
  });
});
```

**Voter Model (`voter-model.test.js`):**
```javascript
describe('Voter Model', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });
  
  test('should create new voter', async () => {
    const voter = new VoterModel();
    const result = await voter.create({
      voter_id: 'TN12345678',
      last_name: 'Smith',
      first_name: 'John',
      address: '123 Main St',
      city: 'Union City',
      zip_code: '38261',
      precinct_number: '05'
    });
    expect(result.id).toBeDefined();
  });
  
  test('should handle duplicate voter_id (replace mode)', async () => {
    const voter = new VoterModel();
    await voter.create({ voter_id: 'TN12345678', ... });
    const result = await voter.create({ voter_id: 'TN12345678', last_name: 'Johnson', ... }, 'replace');
    expect(result.changes).toBe(1);
  });
  
  test('should find voters by precinct', async () => {
    const voter = new VoterModel();
    const result = await voter.findAll({ precinct: '05' });
    expect(result.data).toBeArray();
  });
  
  test('should search voters by name', async () => {
    const voter = new VoterModel();
    const result = await voter.search('John Smith');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests

**Test Files:**
- `tests/integration/import-workflow.test.js`
- `tests/integration/api-endpoints.test.js`

**Import Workflow Test:**
```javascript
describe('Import Workflow', () => {
  test('should complete full DBF import workflow', async () => {
    // 1. Upload file
    const upload = await request(app)
      .post('/api/upload/dbf')
      .attach('file', 'test-data/voters.dbf')
      .expect(200);
    
    const importId = upload.body.import.id;
    
    // 2. Wait for processing (poll status)
    let status = 'processing';
    while (status === 'processing') {
      await sleep(1000);
      const check = await request(app).get(`/api/upload/${importId}`);
      status = check.body.data.status;
    }
    
    // 3. Verify completion
    expect(status).toBe('completed');
    
    // 4. Check voters were imported
    const voters = await request(app).get('/api/voters');
    expect(voters.body.count).toBeGreaterThan(0);
  });
  
  test('should handle import errors gracefully', async () => {
    const upload = await request(app)
      .post('/api/upload/dbf')
      .attach('file', 'test-data/invalid.dbf')
      .expect(200);
    
    const importId = upload.body.import.id;
    
    // Wait for processing
    await sleep(2000);
    
    const result = await request(app).get(`/api/upload/${importId}`);
    expect(result.body.data.status).toBe('failed');
    expect(result.body.data.errorMessage).toBeDefined();
  });
});
```

**API Endpoints Test:**
```javascript
describe('Voter API Endpoints', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  
  test('GET /api/voters should return voter list', async () => {
    const response = await request(app)
      .get('/api/voters')
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeArray();
  });
  
  test('GET /api/voters with precinct filter', async () => {
    const response = await request(app)
      .get('/api/voters?precinct=05')
      .expect(200);
    
    expect(response.body.filters.precinct).toBe('05');
    response.body.data.forEach(voter => {
      expect(voter.precinctNumber).toBe('05');
    });
  });
  
  test('GET /api/voters/:id should return voter details', async () => {
    const response = await request(app)
      .get('/api/voters/1')
      .expect(200);
    
    expect(response.body.data.id).toBe(1);
    expect(response.body.data.electionHistory).toBeArray();
  });
  
  test('GET /api/voters/search/:query should search voters', async () => {
    const response = await request(app)
      .get('/api/voters/search/John')
      .expect(200);
    
    expect(response.body.count).toBeGreaterThan(0);
  });
});
```

### Test Data

**Required Test Files:**
```
tests/
  fixtures/
    sample.dbf              # Valid DBF with 100 voter records
    large.dbf               # Large DBF with 10,000+ records
    corrupt.dbf             # Corrupted DBF file
    voters.csv              # Standard CSV format
    alternate-headers.csv   # CSV with alternate header names
    no-headers.csv          # CSV without header row
    semicolon.csv           # CSV with semicolon delimiter
    invalid-data.csv        # CSV with validation errors
```

**Test Data Generation Script:**
```javascript
// tests/helpers/generate-test-data.js
async function generateTestDBF(outputPath, recordCount = 100) {
  // Generate sample DBF file with realistic voter data
}

async function generateTestCSV(outputPath, recordCount = 100, options = {}) {
  // Generate sample CSV file
}
```

### Performance Tests

**Load Testing:**
```javascript
describe('Performance Tests', () => {
  test('should import 10,000 records in under 2 minutes', async () => {
    const start = Date.now();
    
    const upload = await request(app)
      .post('/api/upload/dbf')
      .attach('file', 'test-data/large.dbf');
    
    // Wait for completion
    await waitForImportCompletion(upload.body.import.id);
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(120000); // 2 minutes
  });
  
  test('should handle 1000 concurrent voter queries', async () => {
    const promises = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(request(app).get('/api/voters?limit=10'));
    }
    
    const results = await Promise.all(promises);
    results.forEach(res => {
      expect(res.status).toBe(200);
    });
  });
});
```

### Test Coverage Goals

**Coverage Targets:**
- **Unit Tests:** >90% code coverage
- **Integration Tests:** All API endpoints, full import workflow
- **Edge Cases:** Error handling, validation failures, boundary conditions

**Run Tests:**
```bash
npm test                    # Run all tests
npm test -- --coverage      # Run with coverage report
npm test -- --watch         # Watch mode for development
```

---

## Risks & Mitigations

### Risk 1: DBF File Format Variations

**Risk:** Obion County DBF files may have unexpected structure or field names

**Likelihood:** Medium  
**Impact:** High (blocks all imports)

**Mitigation:**
1. Request sample DBF file before implementation
2. Build flexible field mapping (like CSV parser)
3. Add DBF structure inspection utility
4. Provide clear error messages for unsupported formats

**Implementation:**
```javascript
// DBF structure inspector utility
async function inspectDBF(filePath) {
  const source = await shapefile.openDbf(filePath);
  const firstRecord = await source.read();
  
  return {
    fields: Object.keys(firstRecord.value),
    sampleRecord: firstRecord.value,
    recordCount: await getDBFRecordCount(filePath)
  };
}
```

### Risk 2: Large File Memory Usage

**Risk:** Processing very large files (50,000+ records) causes out-of-memory errors

**Likelihood:** Low  
**Impact:** Medium (import fails, requires restart)

**Mitigation:**
1. Use stream-based parsing (already planned)
2. Process in small batches (500-1000 records)
3. Monitor memory usage during development
4. Document maximum file size limits
5. Implement memory-based throttling

**Monitoring:**
```javascript
// Memory safeguard
const MAX_MEMORY_MB = 512;

async function checkMemory() {
  const used = process.memoryUsage().heapUsed / 1024 / 1024;
  if (used > MAX_MEMORY_MB) {
    throw new Error(`Memory limit exceeded: ${used}MB > ${MAX_MEMORY_MB}MB`);
  }
}
```

### Risk 3: Data Quality Issues

**Risk:** Voter data contains missing fields, malformed addresses, or inconsistent formatting

**Likelihood:** High  
**Impact:** Medium (some records fail import)

**Mitigation:**
1. Comprehensive validation rules
2. Log all validation failures to import_errors table
3. Continue processing after record-level errors
4. Provide error summary report
5. Manual review interface for failed records

**Error Reporting:**
```javascript
// Generate error summary report
async function getImportErrorSummary(importId) {
  const errors = await database.all(
    `SELECT error_type, error_message, COUNT(*) as count 
     FROM import_errors 
     WHERE import_id = ? 
     GROUP BY error_type, error_message`,
    [importId]
  );
  
  return errors;
}
```

### Risk 4: Deduplication Conflicts

**Risk:** Import mode (skip/replace/flag) doesn't match user expectations

**Likelihood:** Medium  
**Impact:** Low (data inconsistency, user confusion)

**Mitigation:**
1. Default to 'replace' mode (most intuitive for data refreshes)
2. Clearly document each mode in UI and API docs
3. Provide preview of conflicts before import (future enhancement)
4. Add confirmation dialog in frontend for replace mode
5. Log all replacement actions for audit trail

**Documentation:**
```
Import Modes:

- SKIP: Keeps existing data, ignores duplicates
  Use when: Adding new voters to existing database
  
- REPLACE: Updates existing voters with new data
  Use when: Refreshing database with latest voter file
  
- FLAG: Stops import on first duplicate found
  Use when: Ensuring no duplicates exist
```

### Risk 5: Database Corruption During Import

**Risk:** System crash or power loss during import corrupts database

**Likelihood:** Low  
**Impact:** Critical (data loss)

**Mitigation:**
1. Use batch transactions (rollback only current batch)
2. Enable SQLite WAL (Write-Ahead Logging) mode
3. Create automatic backups before imports
4. Document recovery procedures
5. Implement import resume functionality (future)

**Pre-Import Backup:**
```javascript
async function safeImport(importId, filePath, fileType, options) {
  // Create backup before import
  const backupPath = await database.backup();
  console.log(`Backup created: ${backupPath}`);
  
  try {
    await processImport(importId, filePath, fileType, options);
  } catch (error) {
    console.error('Import failed, backup available at:', backupPath);
    throw error;
  }
}
```

### Risk 6: Performance Degradation with Large Datasets

**Risk:** Query performance degrades with 50,000+ voter records

**Likelihood:** Medium  
**Impact:** Medium (slow API responses)

**Mitigation:**
1. Comprehensive database indexing (already implemented)
2. Pagination on all list endpoints
3. Query result caching (future enhancement)
4. Database optimization after large imports
5. Performance benchmarking during testing

**Auto-Optimization:**
```javascript
async function postImportOptimization() {
  console.log('Optimizing database...');
  await database.run('ANALYZE');
  await database.run('VACUUM');
  console.log('Optimization complete');
}
```

### Risk 7: Election History Parsing Complexity

**Risk:** Obion County uses non-standard election history format

**Likelihood:** Medium  
**Impact:** Medium (election history not imported correctly)

**Mitigation:**
1. Request documentation of election code format
2. Build flexible election history parser
3. Support multiple formats (Y/N, R/D, numeric codes)
4. Add election code mapping configuration
5. Log unparseable election codes for review

**Flexible Parser:**
```javascript
function parseElectionCode(value) {
  const str = value.toString().trim().toUpperCase();
  
  // Support multiple formats
  const formats = [
    { pattern: /^Y$/i, voted: true, party: null },
    { pattern: /^N$/i, voted: false, party: null },
    { pattern: /^R$/i, voted: true, party: 'R' },
    { pattern: /^D$/i, voted: true, party: 'D' },
    { pattern: /^RE$/i, voted: true, party: 'R', early: true },
    { pattern: /^DE$/i, voted: true, party: 'D', early: true },
    // Add more patterns as needed
  ];
  
  for (const format of formats) {
    if (format.pattern.test(str)) {
      return format;
    }
  }
  
  // Return null for unparseable codes, log for review
  console.warn('Unparseable election code:', value);
  return null;
}
```

### Risk 8: CSV Format Inconsistencies

**Risk:** CSV files from different sources have varying column names and formats

**Likelihood:** High  
**Impact:** Low (flexible mapping reduces impact)

**Mitigation:**
1. Support multiple header name variations (already planned)
2. Provide CSV template for downloads
3. Add CSV validation before import
4. Allow custom column mapping in UI (future enhancement)
5. Document supported CSV formats

**CSV Template:**
```csv
# Sample CSV Template for Voter Import
# Required columns: voter_id, last_name, first_name, address, city, zip_code, precinct_number
# Optional columns: middle_name, suffix, party_affiliation, phone, email

voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,Smith,John,123 Main St,Union City,38261,05
TN12345679,Johnson,Mary,456 Oak Ave,Union City,38261,03
```

---

## Summary

Phase 2 implements comprehensive data import functionality for the Voter Outreach & Mapping Platform, enabling DBF and CSV file ingestion with robust validation, deduplication, and error handling.

**Key Components:**
1. **DBF Parser** - shapefile library integration
2. **CSV Parser** - csv-parser library with flexible mapping
3. **Import Processor** - Orchestrated batch processing with progress tracking
4. **Voter Model** - Full CRUD operations with validation
5. **Enhanced API Routes** - Upload management and voter querying
6. **Comprehensive Testing** - Unit, integration, and performance tests

**Success Criteria:**
- ✅ Successfully import DBF files with 10,000+ records
- ✅ Support CSV file imports with flexible header mapping
- ✅ Real-time progress tracking for long-running imports
- ✅ Robust error handling with detailed logging
- ✅ Deduplication with multiple conflict resolution modes
- ✅ Query performance <500ms for paginated voter lists
- ✅ >80% test coverage across all components
- ✅ Complete API documentation with examples

**Next Steps:**
1. Review and approve specification
2. Begin implementation following the ordered steps
3. Test with sample Obion County DBF files
4. Document any format variations discovered
5. Proceed to Phase 3 (Geocoding) upon completion

---

**Specification Status:** ✅ COMPLETE - Ready for Implementation

**Recommended Implementation Timeline:** 2-3 weeks (80-120 hours)

**Dependencies for Phase 3:**
- Completed voter database with imported records
- API endpoints for voter querying
- Database ready for geocoding data storage
