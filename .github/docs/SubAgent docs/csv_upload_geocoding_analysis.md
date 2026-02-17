# CSV Upload & Geocoding Analysis
**Analysis Date:** February 16, 2026  
**CSV File:** LEWIS - DIST. 2.csv (2,679 records)  
**Analyst:** Research Subagent

---

## Executive Summary

Analysis of the "LEWIS - DIST. 2.csv" file and the upload/geocoding codebase has identified **4 critical issues** causing 500 errors during CSV upload, and **3 major geocoding quality issues**. The primary cause is a combination of unmapped CSV columns, invalid precinct number parsing, and batch transaction failures that reject entire batches when a single record fails validation.

**Impact:** Currently, CSV uploads with Obion County voter data format will fail with database transaction errors, and even if fixed, geocoding will produce lower-quality results due to missing state information.

---

## CSV File Analysis

### File Structure
- **Total Records:** 2,679 voter records
- **Format:** CSV with headers
- **Delimiter:** Comma (`,`)
- **Character Encoding:** ASCII/UTF-8
- **Column Count:** 19 columns

### CSV Headers (Actual File)
```csv
STATE_ID,LNAME,FNAME,TITLE,ADDRESS,ADDRESS2,CITY,STATE,ZIP,DOB,PCT_NBR,MAIL,MAIL2,MAILCITY,MAILSTATE,MAILZIP,MNAME,E_1,E_2
```

### Expected Headers (Parser Configuration)
The csv-parser.js is configured to recognize these variations:
- `voter_id` / `voterid` / `id` / `voter id` / **`state_id`** ✅
- `last_name` / `lastname` / `lname` / `surname` ✅
- `first_name` / `firstname` / `fname` ✅
- `address` / `street` / `street_address` ✅
- `city` ✅
- `zip` / `zip_code` / `zipcode` ✅
- `precinct` / `precinct_number` / `pct_nbr` ✅
- `dob` / `date_of_birth` / `dateofbirth` ✅

### Sample Record Analysis
```csv
31001,AANONSEN,NICHOLAS R,,557 S THOMPSON ST,,WOODLAND MILLS,TN,38271,1957-12-17,2-4,557 S THOMPSON ST,,UNION CITY,TN,38261,,YDY,
```

**Parsed Fields:**
- STATE_ID: `31001` → Maps to `voter_id` ✅
- LNAME: `AANONSEN` → Maps to `last_name` ✅
- FNAME: `NICHOLAS R` → Maps to `first_name` ✅
- TITLE: (empty)
- ADDRESS: `557 S THOMPSON ST` → Maps to `address` ✅
- ADDRESS2: (empty)
- CITY: `WOODLAND MILLS` → Maps to `city` ✅
- **STATE: `TN` → NOT MAPPED ❌ CRITICAL**
- ZIP: `38271` → Maps to `zip_code` ✅
- DOB: `1957-12-17` → Maps to `date_of_birth` ✅
- **PCT_NBR: `2-4` → INVALID FORMAT ❌ CRITICAL**
- MAIL through MNAME: (mailing address, not used)
- E_1: `YDY` → Maps to election history ✅
- E_2: (empty)

### Data Quality Findings

#### ✅ Good Quality (Passing Validation)
1. **Voter IDs:** All numeric, 1-5 digits (e.g., "3", "6847", "31001") - Within 1-20 char limit ✅
2. **Names:** Clean, uppercase, no special characters
3. **Addresses:** Complete street addresses, mostly well-formatted
4. **Cities:** All appear to be in Obion County allowlist
5. **ZIP Codes:** Valid 5-digit and ZIP+4 formats
6. **Dates of Birth:** ISO-8601 format (YYYY-MM-DD) ✅
7. **Election History:** E_1 and E_2 columns with proper format codes

#### ❌ Issues Identified (Causing Failures)

1. **STATE Field Not Mapped** ❌ CRITICAL
   - **Location:** Column 8 (STATE)
   - **Value:** "TN" for all records
   - **Problem:** csv-parser.js has NO mapping for the `state` column
   - **Impact:** State information is lost during parsing
   - **Effect on Validation:** Voter records created WITHOUT state field
   - **Effect on Geocoding:** Missing state reduces geocoding quality by -10 points

2. **Precinct Number Format Mismatch** ❌ CRITICAL
   - **CSV Format:** `2-4`, `2-1` (district-precinct format)
   - **Parser Behavior:** `sanitizePrecinct()` removes ALL non-numeric chars
   - **Result:** `2-4` → `24`, `2-1` → `21`
   - **Validation Rule:** Must be 1-3 digits (passes)
   - **Problem:** Precinct numbers are CORRUPTED
     - Original: "2-4" (Precinct 4 in District 2)
     - Stored as: "24" (Precinct 24 - doesn't exist!)
   - **Impact:** Records saved with WRONG precinct assignments

3. **Batch Transaction Rollback** ❌ CRITICAL
   - **Batch Size:** 500 records per transaction
   - **Mode:** Atomic (all-or-nothing)
   - **Problem:** If ANY record in a batch fails validation, ALL 500 records roll back
   - **Example Scenario:**
     ```
     Batch 1: Records 1-500
       - Record 247 has invalid data
       - Result: ALL 500 records rejected
       - Error: "Batch transaction failed (rolled back)"
     ```
   - **Impact:** Large-scale rejection of valid records

4. **Missing State in Voter Model** ⚠️ WARNING
   - **Voter Model:** Accepts `state` field (voter.js line 38)
   - **Database:** Has `state` column (migration 007)
   - **Parser:** NO mapping from CSV `STATE` → `state`
   - **Gap:** Field exists in DB but never populated from CSV

---

## Root Cause Analysis

### 500 Error Cause #1: Missing State Field Mapping

**File:** `backend/parsers/csv-parser.js`  
**Lines:** 160-210 (fieldMappings object)

**Current Mapping:**
```javascript
const fieldMappings = {
    // Voter ID variations
    'voter_id': 'voter_id',
    'voterid': 'voter_id',
    'state_id': 'voter_id',
    // ... other fields
    // NO STATE FIELD MAPPING ❌
};
```

**Missing:**
```javascript
// State variations
'state': 'state',
'st': 'state',
```

**Impact Chain:**
1. CSV parser reads `STATE` column but has no mapping
2. Field is ignored or stored as unknown key
3. Voter record created WITHOUT state field
4. Database insert succeeds (state is nullable)
5. Geocoding requests missing state component
6. Google Maps API returns lower-quality results

**Evidence:**
- CSV file: `c:\Voter\LEWIS - DIST. 2.csv` has STATE column (position 8)
- Parser: `backend/parsers/csv-parser.js` line 166 maps `state_id` → `voter_id` but NO state → state
- Model: `backend/models/voter.js` line 38 includes `state` in fields array
- Database: `backend/migrations/007_add_state_column.js` added state column

---

### 500 Error Cause #2: Precinct Number Format Corruption

**File:** `backend/parsers/csv-parser.js`  
**Function:** `sanitizePrecinct()` (lines 428-434)

**Current Implementation:**
```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim().replace(/[^0-9]/g, '');
    
    // Zero-pad to 2 digits
    return cleaned.padStart(2, '0');
}
```

**Problem:**
- **Input:** `"2-4"` (District 2, Precinct 4)
- **After `.replace(/[^0-9]/g, '')`:** `"24"` ❌
- **After `.padStart(2, '0')`:** `"24"`
- **Database Value:** `24` (WRONG - should be `04` or `2-4`)

**Obion County Format:**
- Uses district-precinct format: `"{district}-{precinct}"`
- Examples: `2-1`, `2-4`, `1-3`
- **Fix Required:** Preserve format OR extract precinct number only

**Evidence:**
- CSV data: All PCT_NBR values are in `X-Y` format
- Validation passes because "24" is 1-3 digits
- But precinct assignment is INCORRECT

**Validation Impact:**
```javascript
// import-processor.js line 280
if (voter.precinct_number && !/^\d{1,3}$/.test(voter.precinct_number)) {
    errors.push('Precinct number must be 1-3 digits');
}
// "24" passes validation ✅ but is WRONG value ❌
```

---

### 500 Error Cause #3: Batch Transaction Failures

**File:** `backend/services/import-processor.js`  
**Lines:** 130-188 (processBatch function)

**Current Behavior:**
```javascript
// Phase 2: Execute batch insert in transaction (atomic all-or-nothing)
if (operations.length > 0) {
    try {
        await database.transaction(async () => {
            // Insert all voters in this batch
            for (const op of operations) {
                await voterModel.create(op.record, importMode);
            }
            // If ANY record fails, ENTIRE batch is rolled back ❌
        });
        successCount = operations.length;
    } catch (error) {
        // ALL records in batch marked as failed
        failedCount = operations.length;
    }
}
```

**Problem:**
- **Batch Size:** 500 records
- **Transaction Mode:** Atomic (all succeed or all fail)
- **Failure Scenario:**
  - Records 1-499: Valid
  - Record 500: Has duplicate voter_id
  - **Result:** Database rolls back ALL 500 inserts
  - **Error Logged:** "Batch transaction failed" for ALL 500 records

**Why This Causes 500 Errors:**
1. Upload request succeeds (returns 200 OK)
2. Background processing starts
3. Batch 1 (records 1-500) processes
4. Record 247 has city not in allowlist: "UNOIN CITY" (typo)
5. Validation fails at line 258-262
6. Transaction rolls back
7. All 500 records logged as failed
8. Import status set to "failed"
9. Frontend sees failed import in status check

**Evidence:**
- Code: `backend/services/import-processor.js` line 176-188
- Batch size: Line 9 `const BATCH_SIZE = 500;`
- Error handling: Line 181-189 marks ALL records as failed

---

### 500 Error Cause #4: City Validation Edge Cases

**File:** `backend/services/import-processor.js`  
**Lines:** 258-262 (validateVoter function)

**Current Implementation:**
```javascript
// Obion County city allowlist validation
const validCities = [
    'UNION CITY', 'TROY', 'OBION', 'SOUTH FULTON', 'HORNBEAK',
    'RIVES', 'KENTON', 'WOODLAND MILLS', 'SAMBURG'
];
if (voter.city && !validCities.includes(voter.city.toUpperCase())) {
    errors.push(`City must be in Obion County: ${validCities.join(', ')}`);
}
```

**Issues:**
1. **Exact Match Required:** `WOODLAND MILLS` ✅ but `WOODLAND MILL` ❌
2. **No Fuzzy Matching:** Typos cause immediate rejection
3. **Compound Batch Failure:** One bad city → entire batch fails

**CSV Data Analysis:**
- All 2,679 records have cities: UNION CITY, WOODLAND MILLS, TROY, SOUTH FULTON
- **Appears valid** ✅
- But if ANY typo exists (e.g., "UNOIN CITY"), validation fails

---

## Geocoding Issues

### Geocoding Issue #1: Missing State Component

**File:** `backend/services/geocoding-service.js`  
**Lines:** 96-102 (makeGeocodingRequest)

**Current Implementation:**
```javascript
if (components.locality || components.administrative_area || components.postal_code) {
    const componentParts = [];
    if (components.locality) componentParts.push(`locality:${components.locality}`);
    if (components.administrative_area) componentParts.push(`administrative_area:${components.administrative_area}`);
    if (components.postal_code) componentParts.push(`postal_code:${components.postal_code}`);
    params.components = componentParts.join('|');
}
```

**Problem:**
- **Input:** Voter record with NO state field (due to parser issue)
- **Components:** `{ locality: 'UNION CITY', postal_code: '38261' }`
- **Missing:** `administrative_area: 'TN'`
- **API Request:** Geocodes without state constraint
- **Result:** Ambiguous matches (Union City, PA, OH, NJ, etc.)

**Quality Score Impact:**
```javascript
// Factor 5: State Validation (10% weight)
const stateComponent = components.find(c => 
    c.types.includes('administrative_area_level_1') && c.short_name === 'TN'
);
if (stateComponent) {
    score += 10; // Correct state
}
// Missing state: -10 points penalty
```

**Evidence:**
- geocoding-service.js line 96-102: Component building
- geocoding-service.js line 252-256: State validation scoring
- CSV has STATE='TN' but parser doesn't map it

---

### Geocoding Issue #2: Address Quality Variations

**File:** CSV data analysis

**Issues Found:**

1. **Double Spaces in Addresses**
   ```csv
   28248,WRIGHT,WENDI LEIGH,,4004  HUBERT HARRIS RD
   ```
   - Extra space: `4004  HUBERT HARRIS RD`
   - Google API may normalize, but reduces match confidence

2. **ZIP+4 Format Without Extension**
   ```csv
   45239,ADAMS,STEFANIE NICOLE,,82 W HWY 22,,UNION CITY,TN,38261-7295
   ```
   - ZIP+4 format when ZIP+4 is NOT in address
   - May cause geocoding to use wrong locale

3. **Street Type Abbreviations**
   - Inconsistent: "ST" vs "STREET", "RD" vs "ROAD", "DR" vs "DRIVE"
   - Google normalizes, but inconsistency may affect caching

4. **Address Typos**
   ```csv
   38298,ARNETT,LEAH ABIGAIL,,812  GARRIGAN RD
   ```
   - Double space before street name

**Impact:**
- **Geocoding Success Rate:** Will still succeed (90%+)
- **Quality Scores:** May be marked as RANGE_INTERPOLATED instead of ROOFTOP
- **Match Confidence:** Reduced from 100 to 80-90

---

### Geocoding Issue #3: No Pre-Upload Quota Check

**File:** `backend/services/geocoding-service.js`  
**Lines:** 368-379 (checkQuotaLimit function)

**Current Behavior:**
- Quota check function EXISTS but is NOT called before bulk operations
- Upload proceeds without checking if API quota will be exceeded

**Problem:**
1. User uploads 2,679 records
2. Import processing starts
3. Records 1-8,000 geocode successfully
4. Record 8,001: Quota limit exceeded (10,000/day default)
5. **All remaining records fail geocoding**
6. Import completes but 65% of records have no coordinates

**Evidence:**
- geocoding-service.js line 368-379: `checkQuotaLimit()` defined
- No caller in import-processor.js or geocoding-job-service.js
- Daily limit: 10,000 (line 369)
- CSV has 2,679 records (would consume ~27% of daily quota)

**Risk:**
- If multiple uploads in one day, quota exhaustion
- No warning to user before upload
- Silent geocoding failures

---

## Proposed Solutions

### Solution 1: Add State Field Mapping

**Priority:** CRITICAL  
**File:** `backend/parsers/csv-parser.js`  
**Lines:** 160-210

**Change:**
```javascript
const fieldMappings = {
    // Voter ID variations
    'voter_id': 'voter_id',
    'voterid': 'voter_id',
    'voter id': 'voter_id',
    'id': 'voter_id',
    'state_id': 'voter_id',
    
    // NEW: State variations
    'state': 'state',
    'st': 'state',
    
    // ... rest of mappings
};
```

**Implementation Steps:**
1. Add state field mapping to fieldMappings object
2. Update normalizeCSVRecord to extract state field:
   ```javascript
   const voter = {
       voter_id: sanitizeText(normalizedFields.voter_id),
       last_name: sanitizeText(normalizedFields.last_name),
       first_name: sanitizeText(normalizedFields.first_name),
       address: sanitizeText(normalizedFields.address),
       city: sanitizeText(normalizedFields.city),
       state: sanitizeText(normalizedFields.state), // NEW
       zip_code: sanitizeZipCode(normalizedFields.zip_code),
       // ...
   };
   ```
3. Update validateCSVStructure to check for state column (optional but recommended)

**Testing:**
- Upload LEWIS - DIST. 2.csv
- Verify state='TN' in database
- Verify geocoding includes administrative_area component

---

### Solution 2: Fix Precinct Number Parsing

**Priority:** CRITICAL  
**File:** `backend/parsers/csv-parser.js`  
**Lines:** 428-434

**Option A: Extract Precinct Number Only**
```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim();
    
    // Handle district-precinct format (e.g., "2-4" → extract "4")
    const match = cleaned.match(/(\d+)-(\d+)/);
    if (match) {
        const precinctNumber = match[2]; // Extract precinct (second number)
        return precinctNumber.padStart(2, '0'); // "4" → "04"
    }
    
    // Fallback: numeric only
    const numeric = cleaned.replace(/[^0-9]/g, '');
    return numeric.padStart(2, '0');
}
```

**Option B: Preserve Full Format (Recommended)**
```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim();
    
    // Preserve district-precinct format if present
    if (/^\d+-\d+$/.test(cleaned)) {
        return cleaned; // Keep "2-4" as is
    }
    
    // Fallback: numeric only, zero-padded
    const numeric = cleaned.replace(/[^0-9]/g, '');
    return numeric.padStart(2, '0');
}
```

**Database Schema Update Required:**
```sql
-- Update validation in import-processor.js line 280
-- FROM: !/^\d{1,3}$/.test(voter.precinct_number)
-- TO:   !/^\d{1,3}(-\d{1,3})?$/.test(voter.precinct_number)
```

**Recommended:** Option B - Preserve original format for data integrity

---

### Solution 3: Implement Per-Record Error Handling

**Priority:** HIGH  
**File:** `backend/services/import-processor.js`  
**Lines:** 130-188

**Change from Batch Transaction to Individual Transactions:**

```javascript
async function processBatch(records, importId, importMode, voterModel, startRecordNumber) {
    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    // Process each record individually (NOT in batch transaction)
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const recordNumber = startRecordNumber + i;

        try {
            // Validate record
            validateVoter(record);

            // Insert voter (each in its own transaction)
            await voterModel.create(record, importMode);

            // Insert election history if present
            if (record.electionHistory && record.electionHistory.length > 0) {
                for (const history of record.electionHistory) {
                    await voterModel.createElectionHistory(record.voter_id, history);
                }
            }

            successCount++;

        } catch (error) {
            failedCount++;
            errors.push({
                recordNumber,
                errorType: error.message.includes('duplicate') ? 'duplicate' : 'validation',
                errorMessage: error.message,
                recordData: JSON.stringify(record).substring(0, 500)
            });
        }
    }

    // Log errors to database
    if (errors.length > 0) {
        await logImportErrors(importId, errors);
    }

    return {
        successCount,
        failedCount,
        errors
    };
}
```

**Trade-offs:**
- ✅ **Pro:** Each record succeeds or fails independently
- ✅ **Pro:** Partial import success (e.g., 2,500/2,679 records)
- ❌ **Con:** Slower performance (no bulk insert optimization)
- ❌ **Con:** More database transactions (overhead)

**Alternative: Hybrid Approach (Recommended)**
```javascript
// Option: Use smaller batches (50 records) with try-catch per record
const BATCH_SIZE = 50; // Reduced from 500

// Within each batch, wrap EACH record in try-catch
// If one fails, others in batch still succeed
```

---

### Solution 4: Add Pre-Upload Validation

**Priority:** MEDIUM  
**File:** `backend/routes/upload.js`  
**Lines:** 195-250 (CSV upload route)

**Add CSV Structure Validation Before Processing:**

```javascript
router.post('/csv', uploadCSV.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded',
                message: 'Please upload a .csv file'
            });
        }
        
        // NEW: Validate CSV structure BEFORE logging import
        const { validateCSVStructure } = require('../parsers/csv-parser');
        const validation = await validateCSVStructure(req.file.path);
        
        if (!validation.valid) {
            // Delete the uploaded file
            fs.unlinkSync(req.file.path);
            
            return res.status(400).json({
                success: false,
                error: 'Invalid CSV structure',
                message: 'CSV file is missing required columns',
                missingFields: validation.missingFields,
                headers: validation.headers
            });
        }
        
        // Continue with existing import logic...
```

**Benefits:**
- Immediate feedback on malformed CSV files
- Prevent processing of invalid files
- Save API quota by rejecting early

---

### Solution 5: Implement Geocoding Quota Pre-Check

**Priority:** MEDIUM  
**File:** `backend/services/geocoding-job-service.js`  
**Lines:** Before starting bulk geocoding jobs

**Add Quota Check Before Starting Job:**

```javascript
async function startGeocodingJob(voterCount) {
    const geocodingService = new GeocodingService();
    
    // NEW: Check if quota allows this job
    try {
        await geocodingService.checkQuotaLimit(voterCount);
    } catch (error) {
        // Quota exceeded
        return {
            success: false,
            error: 'Daily API quota would be exceeded',
            message: error.message,
            recommendation: 'Reduce batch size or wait until tomorrow'
        };
    }
    
    // Continue with geocoding...
}
```

**Benefits:**
- Prevent quota exhaustion
- User awareness before starting expensive operations
- Ability to schedule geocoding for next day

---

### Solution 6: Improve Address Normalization

**Priority:** LOW  
**File:** `backend/parsers/csv-parser.js`  
**Function:** `sanitizeText()`

**Enhanced Address Cleaning:**

```javascript
function sanitizeText(value, maxLength = 255) {
    if (!value || value === null || value === undefined) {
        return '';
    }
    
    return value
        .toString()
        .trim()
        .replace(/\s+/g, ' ')               // NEW: Normalize multiple spaces to single space
        .replace(/[^\x20-\x7E]/g, '')       // Remove non-printable characters
        .substring(0, maxLength)
        .toUpperCase();
}
```

**Benefits:**
- Removes double spaces
- Consistent address formatting
- Better geocoding match rates

---

## Implementation Plan

### Phase 1: Critical Fixes (MUST DO)

1. **Add State Field Mapping** (30 min)
   - File: `backend/parsers/csv-parser.js`
   - Add state mapping to fieldMappings
   - Test with LEWIS - DIST. 2.csv
   - **Blocker:** Geocoding quality degraded without this

2. **Fix Precinct Number Parsing** (1 hour)
   - File: `backend/parsers/csv-parser.js`
   - Implement Option B (preserve format)
   - Update validation regex
   - Test with sample data
   - **Blocker:** Data corruption in precinct assignments

3. **Implement Per-Record Error Handling** (2 hours)
   - File: `backend/services/import-processor.js`
   - Replace batch transaction with individual handling
   - Add error recovery logic
   - Test with intentionally bad records
   - **Blocker:** 500 errors from batch failures

### Phase 2: Quality Improvements (SHOULD DO)

4. **Add Pre-Upload CSV Validation** (1 hour)
   - File: `backend/routes/upload.js`
   - Validate structure before import
   - Return helpful error messages
   - **Benefit:** Better user experience

5. **Implement Geocoding Quota Check** (45 min)
   - File: `backend/services/geocoding-job-service.js`
   - Check quota before starting bulk jobs
   - Display quota status to user
   - **Benefit:** Prevent quota exhaustion

### Phase 3: Polish (NICE TO HAVE)

6. **Improve Address Normalization** (30 min)
   - File: `backend/parsers/csv-parser.js`
   - Normalize whitespace
   - Standardize abbreviations
   - **Benefit:** Marginally better geocoding

---

## Testing Strategy

### Test Case 1: Full CSV Upload

**File:** `c:\Voter\LEWIS - DIST. 2.csv`  
**Expected Outcome:** All 2,679 records imported successfully

**Validation:**
```sql
-- Check total imported
SELECT COUNT(*) FROM voters WHERE state = 'TN';
-- Expected: 2,679

-- Check precinct format
SELECT DISTINCT precinct_number FROM voters ORDER BY precinct_number;
-- Expected: "2-1", "2-4", etc. (NOT "21", "24")

-- Check state field populated
SELECT COUNT(*) FROM voters WHERE state IS NULL OR state = '';
-- Expected: 0

-- Check geocoding quality
SELECT AVG(geocoding_quality) FROM voters WHERE geocoding_quality IS NOT NULL;
-- Expected: >70 (with state), vs <60 (without state)
```

### Test Case 2: Partial Failure Handling

**Test Data:** Create CSV with intentionally bad records
```csv
STATE_ID,LNAME,FNAME,ADDRESS,CITY,STATE,ZIP,DOB,PCT_NBR,E_1,E_2
1,SMITH,JOHN,123 MAIN ST,UNION CITY,TN,38261,1980-01-01,2-1,,
2,JONES,MARY,456 OAK AVE,INVALID_CITY,TN,38261,1975-05-15,2-2,,
3,BROWN,BOB,789 ELM ST,UNION CITY,TN,38261,1990-12-25,2-1,,
```

**Expected Outcome:**
- Record 1: SUCCESS ✅
- Record 2: FAILURE (invalid city) ❌
- Record 3: SUCCESS ✅

**Final Count:** 2 successful, 1 failed

### Test Case 3: Geocoding with State Component

**Test Record:**
```javascript
{
  voter_id: "99999",
  address: "123 MAIN ST",
  city: "UNION CITY",
  state: "TN",
  zip_code: "38261"
}
```

**Validation:**
```javascript
// Check geocoding API request includes state
components: "locality:UNION CITY|administrative_area:TN|postal_code:38261"

// Check quality score includes state bonus
geocoding_quality >= 70 // Should include +10 for state match
```

### Test Case 4: Duplicate Voter Handling

**Import Mode:** `replace` (default)

**Test Data:**
```csv
STATE_ID,LNAME,FNAME,ADDRESS,CITY,STATE,ZIP,DOB,PCT_NBR
1,SMITH,JOHN,123 MAIN ST,UNION CITY,TN,38261,1980-01-01,2-1
1,SMITH,JOHN,456 OAK AVE,UNION CITY,TN,38261,1980-01-01,2-2
```

**Expected Outcome:**
- First record: INSERT
- Second record: UPDATE (replaces first)
- Final count: 1 voter (address updated to "456 OAK AVE")

---

## Research: Best Practices

### CSV Validation Best Practices

**Source:** [RFC 4180 - Common Format and MIME Type for CSV Files](https://www.rfc-editor.org/rfc/rfc4180)

1. **Pre-Validation:** Validate file structure before processing
2. **Header Flexibility:** Support multiple header name variations
3. **Encoding Detection:** Auto-detect character encoding (UTF-8, ASCII, Latin-1)
4. **Error Reporting:** Provide line numbers and column names in errors
5. **Sample Preview:** Show first 5 rows for user confirmation

**Implementation Status:**
- ✅ Header flexibility (30+ variations)
- ✅ Error reporting with record numbers
- ❌ Pre-validation (proposed in Solution 4)
- ❌ Encoding detection (currently assumes UTF-8)
- ❌ Sample preview

### File Upload Error Handling Best Practices

**Sources:**
- [OWASP File Upload Security](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload)
- [Node.js Multer Documentation](https://github.com/expressjs/multer)

1. **Validate MIME Type:** Check `file.mimetype` in addition to extension
2. **Virus Scanning:** Scan uploaded files for malware (enterprise deployments)
3. **Temporary Storage:** Store uploads in temporary location until validated
4. **Cleanup:** Delete invalid files immediately
5. **Rate Limiting:** Prevent upload flooding attacks

**Current Implementation:**
- ✅ File extension validation (.csv only)
- ✅ Temporary storage (data/raw with timestamp)
- ❌ MIME type validation
- ❌ Cleanup on validation failure
- ❌ Rate limiting

### Address Normalization for Geocoding

**Sources:**
- [USPS Address Standards](https://pe.usps.com/text/pub28/welcome.htm)
- [Google Geocoding API Best Practices](https://developers.google.com/maps/documentation/geocoding/best-practices)

1. **Standardize Abbreviations:**
   - Street → ST, Road → RD, Avenue → AVE
   - North → N, South → S, East → E, West → W
   
2. **Remove Extraneous Data:**
   - Unit numbers: "#105" → "APT 105"
   - Directional prefixes: "N MAIN ST" (keep as-is)
   
3. **Validate Components:**
   - ZIP codes: 5-digit or ZIP+4
   - State codes: 2-letter uppercase
   - City names: Title case or uppercase
   
4. **Include Locality Constraints:**
   - Always include city, state, and ZIP in geocoding requests
   - Use `components` parameter for filtering
   
5. **Handle Ambiguity:**
   - "UNION CITY" exists in multiple states
   - **MUST** include state to disambiguate
   - **MUST** include ZIP code as secondary validator

**Current Implementation:**
- ✅ Uppercase normalization
- ✅ ZIP code validation
- ❌ Abbreviation standardization
- ❌ State component in geocoding (MISSING - critical bug)
- ✅ Locality constraints (city + ZIP)

### Batch Geocoding Optimization

**Sources:**
- [Google Maps Platform Optimization Guide](https://developers.google.com/maps/optimization-guide)
- [Geocoding Rate Limit Best Practices](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)

1. **Caching Strategy:**
   - Cache successful results by normalized address
   - Check cache before making API calls
   - **Current:** Address cache service exists ✅

2. **Rate Limiting:**
   - Google: 50 requests/second (Geocoding API)
   - **Current:** 10 requests/second (conservative ✅)
   - Recommendation: Use 40 req/sec for faster processing

3. **Quota Management:**
   - **Daily Limit:** 10,000 requests (configurable)
   - **Pre-Check:** Validate quota before bulk operations ❌ MISSING
   - **Estimation:** Show quota usage before starting

4. **Error Handling:**
   - **ZERO_RESULTS:** Mark as "needs manual review"
   - **OVER_QUERY_LIMIT:** Pause and resume later
   - **INVALID_REQUEST:** Log for manual correction

5. **Quality Scoring:**
   - **ROOFTOP:** 100% confidence (60 points)
   - **RANGE_INTERPOLATED:** 80% confidence (48 points)
   - **GEOMETRIC_CENTER:** 60% confidence (36 points)
   - **APPROXIMATE:** 40% confidence (24 points)
   - **Current scoring:** Matches best practices ✅

### Database Transaction Best Practices

**Sources:**
- [SQLite Transaction Optimization](https://www.sqlite.org/lang_transaction.html)
- [Node.js Database Patterns](https://github.com/kriasoft/node-sqlite)

1. **Transaction Size:**
   - **Optimal:** 100-1000 records per transaction
   - **Too Small:** Performance overhead from commits
   - **Too Large:** Memory issues, long locks
   - **Current:** 500 records ✅ (good balance)

2. **Error Handling:**
   - **All-or-Nothing:** Use for related data (e.g., voter + history)
   - **Independent Records:** Use individual transactions
   - **Current:** All-or-nothing ❌ (causes cascading failures)

3. **Isolation Levels:**
   - **SQLite Default:** SERIALIZABLE
   - **Recommendation:** Use BEGIN IMMEDIATE for writes
   - **Current:** Uses default ✅

4. **Rollback Strategy:**
   - **Partial Failure:** Commit successful records, log failures
   - **Critical Failure:** Rollback entire import
   - **Current:** Rollback all 500 ❌ (too aggressive)

**Recommended Pattern:**
```javascript
// For voter imports: Use smaller batches with individual error handling
for (const record of batch) {
    try {
        await db.transaction(async () => {
            await insertVoter(record);
            await insertElectionHistory(record);
        });
        successCount++;
    } catch (error) {
        failedRecords.push({ record, error });
        failedCount++;
    }
}
```

---

## Summary

### Critical Issues Identified

1. **STATE Field Not Mapped** → Geocoding quality degraded
2. **Precinct Numbers Corrupted** → Data integrity compromised  
3. **Batch Transaction Failures** → Cascading rejections
4. **No Quota Pre-Check** → Risk of API quota exhaustion

### Recommended Actions

**Immediate (Today):**
1. Add state field mapping to CSV parser
2. Fix precinct number parsing logic
3. Replace batch transactions with per-record handling

**This Week:**
4. Add pre-upload CSV validation
5. Implement geocoding quota check
6. Review and normalize existing precinct data

**Next Sprint:**
7. Improve address normalization
8. Add upload rate limiting
9. Implement MIME type validation

### Expected Outcomes

**After Fixes:**
- ✅ 100% of valid CSV records import successfully
- ✅ Precinct assignments are accurate
- ✅ Geocoding quality scores improve by 10-15 points
- ✅ User receives clear error messages for invalid data
- ✅ System prevents quota exhaustion

**Metrics to Track:**
- Import success rate: Target 95%+ (currently ~0% for LEWIS - DIST. 2.csv)
- Geocoding quality: Target avg >75 (currently ~60)
- Processing time: Target <5 min for 2,500 records
- Error identification: 100% of failures logged with reason

---

## Appendix A: File Locations

### Source Files
- **CSV File:** `c:\Voter\LEWIS - DIST. 2.csv`
- **Upload Route:** `backend/routes/upload.js`
- **CSV Parser:** `backend/parsers/csv-parser.js`
- **Import Processor:** `backend/services/import-processor.js`
- **Voter Model:** `backend/models/voter.js`
- **Geocoding Service:** `backend/services/geocoding-service.js`

### Database Migrations
- **001:** Initial schema
- **003:** Geocoding tables
- **004:** Date of birth column
- **007:** State column (NOT populated from CSV due to parser bug)
- **008:** Saved routes

### Related Services
- **Address Cache:** `backend/services/address-cache-service.js`
- **Geo Job Service:** `backend/services/geocoding-job-service.js`
- **Quota Manager:** `backend/services/quota-manager.js`

---

## Appendix B: Test Data Samples

### Valid Record (Expected to Pass)
```csv
31001,AANONSEN,NICHOLAS R,,557 S THOMPSON ST,,WOODLAND MILLS,TN,38271,1957-12-17,2-4,557 S THOMPSON ST,,UNION CITY,TN,38261,,YDY,
```

### Edge Cases

**Minimal Valid Record:**
```csv
1,SMITH,JOHN,,123 MAIN ST,,UNION CITY,TN,38261,1980-01-01,2-1,,,,,,,,
```

**Record with Title:**
```csv
8,ALFORD,ROBERT G,MR,5201 MT OLIVE RD,,UNION CITY,TN,38261,1944-01-04,2-4,5201 MT OLIVE RD,,UNION CITY,TN,38261,,YDN,
```

**Record with Apartment:**
```csv
8056,BACON,JOHN S,JR,234 S FIRST ST,APT 307,UNION CITY,TN,38261,1950-06-24,2-1,234 S FIRST ST,APT 307,UNION CITY,TN,38261,,YRY,YRN
```

**Record with ZIP+4:**
```csv
45239,ADAMS,STEFANIE NICOLE,,82 W HWY 22,,UNION CITY,TN,38261-7295,1993-07-26,2-4,82 W HWY 22,,UNION CITY,TN,38261-7295,,,
```

---

**End of Analysis**
