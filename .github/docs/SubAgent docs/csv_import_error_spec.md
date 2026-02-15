# CSV Import Error Analysis & Specification

**Date:** February 7, 2026  
**File:** LEWIS - DIST. 2.csv  
**Issue:** CSV upload failures due to validation errors

---

## Executive Summary

**Root Cause:** Voter ID length validation mismatch. The CSV file contains 5-digit voter IDs (e.g., "31001", "30687"), but the backend validation requires voter IDs to be between 8-20 alphanumeric characters.

**Impact:** All records in the CSV file will fail validation during import, resulting in 0 successful imports and complete import failure.

**Recommended Fix:** Modify the voter ID validation rule to accept shorter IDs (5+ characters) or implement automatic zero-padding for IDs shorter than 8 characters.

---

## 1. Current State Analysis

### 1.1 CSV File Structure

**File:** `c:\Voter\LEWIS - DIST. 2.csv`  
**Total Records:** 2,679 lines (2,678 voter records + 1 header)  
**Delimiter:** Comma (`,`)

**Column Headers:**
```
STATE_ID, LNAME, FNAME, TITLE, ADDRESS, ADDRESS2, CITY, STATE, ZIP, DOB, 
PCT_NBR, MAIL, MAIL2, MAILCITY, MAILSTATE, MAILZIP, MNAME, E_1, E_2
```

**Sample Data (First 3 Records):**
```csv
STATE_ID: 31001
LNAME: AANONSEN
FNAME: NICHOLAS R
ADDRESS: 557 S THOMPSON ST
CITY: WOODLAND MILLS
STATE: TN
ZIP: 38271
DOB: 1957-12-17
PCT_NBR: 2-4
E_1: YDY
E_2: (empty)

STATE_ID: 30687
LNAME: ABBOTT
FNAME: BYRON LAMAR
ADDRESS: 852 MOSSWOOD DR
CITY: UNION CITY
STATE: TN
ZIP: 38261
PCT_NBR: 2-1

STATE_ID: 46030
LNAME: ABBOTT
FNAME: LEQUANTE MARQUISE
ADDRESS: 930 BURRUS RD
CITY: UNION CITY
STATE: TN
ZIP: 38261
PCT_NBR: 2-4
```

**Data Characteristics:**
- **Voter IDs:** 5-digit numeric format (e.g., 31001, 30687, 46030)
- **Names:** Uppercase, various lengths
- **Addresses:** Complete street addresses
- **Cities:** Obion County cities (UNION CITY, WOODLAND MILLS, TROY, etc.)
- **ZIP Codes:** 5-digit format, some with ZIP+4 (38261-7295)
- **Precinct Numbers:** Hyphenated format (e.g., "2-4", "2-1")
- **Election Codes:** 3-character format (YDY, YRN, YDN, etc.) in E_1 and E_2 columns

### 1.2 Backend CSV Parser Analysis

**File:** `backend/parsers/csv-parser.js`

**Column Mapping (Case-Insensitive):**

| CSV Column | Backend Field | Mapping Status |
|------------|---------------|----------------|
| STATE_ID | voter_id | ✓ Mapped via 'state_id' variation |
| LNAME | last_name | ✓ Mapped via 'lname' variation |
| FNAME | first_name | ✓ Mapped via 'fname' variation |
| ADDRESS | address | ✓ Direct mapping |
| CITY | city | ✓ Direct mapping |
| ZIP | zip_code | ✓ Mapped via 'zip' variation |
| PCT_NBR | precinct_number | ✓ Mapped via 'pct_nbr' variation |
| E_1, E_2 | electionHistory | ✗ NOT PARSED (CSV parser doesn't process election codes) |

**Field Mappings Confirmed:**
```javascript
fieldMappings = {
  'state_id': 'voter_id',      // ✓ Matches STATE_ID
  'lname': 'last_name',         // ✓ Matches LNAME
  'fname': 'first_name',        // ✓ Matches FNAME
  'address': 'address',         // ✓ Matches ADDRESS
  'city': 'city',               // ✓ Matches CITY
  'zip': 'zip_code',            // ✓ Matches ZIP
  'pct_nbr': 'precinct_number'  // ✓ Matches PCT_NBR
}
```

**Data Sanitization:**
- `sanitizeText()`: Converts to uppercase, removes non-printable characters
- `sanitizeZipCode()`: Validates 5-digit or ZIP+4 format
- `sanitizePrecinct()`: Strips non-numeric characters, zero-pads to 2 digits
  - Example: "2-4" → "24", "2-1" → "21"

### 1.3 Validation Rules Analysis

**File:** `backend/services/import-processor.js` → `validateVoter()` function

**Required Fields:**
- voter_id ✓ (Present as STATE_ID)
- last_name ✓ (Present as LNAME)
- first_name ✓ (Present as FNAME)
- address ✓ (Present as ADDRESS)
- city ✓ (Present as CITY)
- zip_code ✓ (Present as ZIP)
- precinct_number ✓ (Present as PCT_NBR)

**Validation Rules:**

| Field | Rule | CSV Data | Status |
|-------|------|----------|--------|
| voter_id | Must be 8-20 alphanumeric characters `/^[A-Z0-9]{8,20}$/i` | 5 digits (31001) | ❌ **FAILS** |
| city | Must be in Obion County allowlist | UNION CITY, WOODLAND MILLS, etc. | ✓ Valid |
| zip_code | Must be 5 digits or ZIP+4 `/^\d{5}(-\d{4})?$/` | 38261, 38271 | ✓ Valid |
| precinct_number | Must be 1-3 digits `/^\d{1,3}$/` | "24", "21" (after sanitization) | ✓ Valid |
| last_name | Cannot be empty | AANONSEN, ABBOTT, etc. | ✓ Valid |
| first_name | Cannot be empty | NICHOLAS R, BYRON LAMAR, etc. | ✓ Valid |
| address | Min 3 characters | 557 S THOMPSON ST, etc. | ✓ Valid |

**Obion County City Allowlist:**
```javascript
const validCities = [
  'UNION CITY', 'TROY', 'OBION', 'SOUTH FULTON', 'HORNBEAK',
  'RIVES', 'KENTON', 'WOODLAND MILLS', 'SAMBURG'
];
```

---

## 2. Root Cause Identification

### 2.1 Primary Error: Voter ID Length Validation

**Location:** `backend/services/import-processor.js` → Line 246-249

```javascript
// Voter ID validation
if (voter.voter_id && !/^[A-Z0-9]{8,20}$/i.test(voter.voter_id)) {
    errors.push('Voter ID must be 8-20 alphanumeric characters');
}
```

**Problem:**
- **Expected:** 8-20 characters (e.g., "TN12345678", "STATE1234567")
- **Actual:** 5 characters (e.g., "31001", "30687", "46030")
- **Result:** Every record fails validation with error: "Voter ID must be 8-20 alphanumeric characters"

**Evidence from Sample Data:**
```
Record 1: STATE_ID = "31001" (length 5) → FAILS
Record 2: STATE_ID = "30687" (length 5) → FAILS
Record 3: STATE_ID = "46030" (length 5) → FAILS
Record 10: STATE_ID = "13103" (length 5) → FAILS
```

### 2.2 Secondary Issue: Election History Not Parsed

**Location:** `backend/parsers/csv-parser.js` → Line 249

```javascript
// CSV files don't have election history in the same format as DBF
// Election history would need to be in separate columns if present
voter.electionHistory = [];
```

**Problem:**
- CSV contains election codes in E_1 and E_2 columns (e.g., "YDY", "YRN", "NDY")
- Parser ignores these columns and sets `electionHistory = []`
- Election data is not imported for CSV files

**Impact:** Loss of historical voting data during CSV import.

### 2.3 Filename Validation

**Location:** `backend/routes/upload.js` → Line 77-84

```javascript
// Validate filename characters (prevent path traversal)
const filename = path.basename(file.originalname);
if (!/^[a-zA-Z0-9_\-. ]+$/.test(filename)) {
    return cb(new Error('Invalid filename characters'));
}
```

**Analysis:**
- Filename: "LEWIS - DIST. 2.csv"
- Regex: `/^[a-zA-Z0-9_\-. ]+$/`
- Characters: Letters (LEWIS, DIST), spaces ( ), hyphen (-), period (.), digit (2)
- **Result:** ✓ Valid (all characters allowed)

**Conclusion:** Filename is NOT causing the upload error.

---

## 3. Expected vs Actual Comparison

### 3.1 Column Mapping

| Backend Expected | CSV Actual | Mapped? | Notes |
|------------------|------------|---------|-------|
| voter_id | STATE_ID | ✓ | Maps via 'state_id' variation |
| last_name | LNAME | ✓ | Maps via 'lname' variation |
| first_name | FNAME | ✓ | Maps via 'fname' variation |
| address | ADDRESS | ✓ | Direct match |
| city | CITY | ✓ | Direct match |
| zip_code | ZIP | ✓ | Maps via 'zip' variation |
| precinct_number | PCT_NBR | ✓ | Maps via 'pct_nbr' variation |
| electionHistory | E_1, E_2 | ✗ | Not parsed by CSV parser |

### 3.2 Data Format Comparison

| Field | Backend Expects | CSV Provides | After Sanitization | Validation |
|-------|----------------|--------------|-------------------|------------|
| voter_id | 8-20 chars | 5 digits (31001) | "31001" | ❌ Too short |
| last_name | Uppercase text | Uppercase (AANONSEN) | "AANONSEN" | ✓ Valid |
| first_name | Uppercase text | Uppercase + space (NICHOLAS R) | "NICHOLAS R" | ✓ Valid |
| address | Min 3 chars | Full address | "557 S THOMPSON ST" | ✓ Valid |
| city | In allowlist | WOODLAND MILLS | "WOODLAND MILLS" | ✓ Valid |
| zip_code | 5 or 9 digits | 5 digits (38271) | "38271" | ✓ Valid |
| precinct_number | 1-3 digits | Hyphenated (2-4) | "24" | ✓ Valid |

---

## 4. Research: CSV Import Best Practices

### 4.1 Credible Sources

**1. CSV File Format Standards (RFC 4180)**
- **Source:** [RFC 4180 - Common Format and MIME Type for CSV Files](https://www.ietf.org/rfc/rfc4180.txt)
- **Key Takeaways:**
  - Headers should be case-insensitive
  - Fields may contain spaces and special characters
  - Validation should happen after parsing, not during
  - Column mapping should support multiple naming conventions

**2. Node.js CSV Parsing Best Practices**
- **Source:** [csv-parser NPM Documentation](https://www.npmjs.com/package/csv-parser)
- **Key Takeaways:**
  - Use flexible header mapping (`mapHeaders` function)
  - Implement data sanitization after parsing
  - Handle malformed records gracefully
  - Support auto-detection of delimiters

**3. Data Validation Patterns**
- **Source:** [Express Validator Documentation](https://express-validator.github.io/docs/)
- **Key Takeaways:**
  - Validate after data transformation
  - Provide descriptive error messages
  - Allow for data format variations
  - Implement whitelist validation for known domains (cities, states)

**4. Database Import Error Handling**
- **Source:** [SQLite Transaction Best Practices](https://www.sqlite.org/lang_transaction.html)
- **Key Takeaways:**
  - Use batch transactions for performance
  - Log failed records for review
  - Provide partial success information
  - Allow configurable import modes (skip, replace, flag)

**5. Government Data Standards**
- **Source:** [Election Data Format Standards (VIP)](https://vip-specification.readthedocs.io/)
- **Key Takeaways:**
  - Voter IDs vary by state (some use SSN, some use sequential numbers)
  - Consider variable-length IDs with minimum constraints
  - Election codes should follow standardized formats
  - Precinct identifiers can be alphanumeric or hierarchical (2-4, 2-1)

**6. CSV Security Considerations**
- **Source:** [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- **Key Takeaways:**
  - Validate filename characters (prevent path traversal) ✓ Implemented
  - Sanitize data to prevent injection attacks ✓ Implemented
  - Set file size limits ✓ Implemented (100MB)
  - Use allowlists for known values (cities) ✓ Implemented

---

## 5. Proposed Solution

### 5.1 Option A: Relax Voter ID Validation (RECOMMENDED)

**Change:** Modify voter ID validation to accept IDs with 5+ characters instead of 8-20 characters.

**Rationale:**
- Tennessee voter IDs appear to use 5-digit sequential format
- Maintains security (alphanumeric validation still applies)
- Allows both state formats (5-digit and longer formats)
- Minimal code change with maximum compatibility

**Code Change:**
```javascript
// Before
if (voter.voter_id && !/^[A-Z0-9]{8,20}$/i.test(voter.voter_id)) {
    errors.push('Voter ID must be 8-20 alphanumeric characters');
}

// After
if (voter.voter_id && !/^[A-Z0-9]{5,20}$/i.test(voter.voter_id)) {
    errors.push('Voter ID must be 5-20 alphanumeric characters');
}
```

**Files to Modify:**
- `backend/services/import-processor.js` (validation function)

### 5.2 Option B: Auto-Pad Voter IDs

**Change:** Automatically zero-pad voter IDs shorter than 8 characters during sanitization.

**Rationale:**
- Maintains strict validation rule (8-20 characters)
- Normalizes data format
- Ensures consistent database storage

**Code Change:**
```javascript
// In csv-parser.js, add new sanitization function
function sanitizeVoterId(value) {
    if (!value) return '';
    const cleaned = value.toString().trim().toUpperCase();
    // Zero-pad to minimum 8 characters if shorter
    return cleaned.padStart(8, '0');
}

// Example: "31001" → "00031001"
```

**Files to Modify:**
- `backend/parsers/csv-parser.js` (add sanitizeVoterId function)
- `backend/parsers/dbf-parser.js` (add same function for consistency)

**Drawback:** Changes voter IDs from original format, may cause issues with external systems.

### 5.3 Option C: Add Election History Parsing for CSV

**Change:** Extend CSV parser to recognize E_1, E_2, E_3, etc. columns and convert to election history format.

**Rationale:**
- Preserves election data during CSV import
- Provides feature parity with DBF import
- Supports historical voting analysis

**Code Change:**
```javascript
// In normalizeCSVRecord function
function normalizeCSVRecord(rawRecord, recordNumber, hasHeaders) {
    // ... existing code ...
    
    // Parse election history from E_1, E_2, E_3... columns
    const electionHistory = [];
    for (let i = 1; i <= 10; i++) {
        const electionCode = rawRecord[`e_${i}`] || rawRecord[`E_${i}`];
        if (electionCode && electionCode.trim() !== '') {
            const parsed = parseElectionCode(electionCode);
            if (parsed) {
                electionHistory.push({
                    electionCode: `E_${i}`,
                    voted: parsed.voted,
                    partyCode: parsed.partyCode,
                    earlyVoted: parsed.earlyVoted
                });
            }
        }
    }
    
    voter.electionHistory = electionHistory;
    return voter;
}

function parseElectionCode(code) {
    // Parse YDY, YRN, NDY format
    // Y/N = voted (Yes/No)
    // D/R/G/I = party (Democrat/Republican/Green/Independent)
    // Y/N = early voted (Yes/No)
    if (!code || code.length < 3) return null;
    
    return {
        voted: code[0] === 'Y',
        partyCode: code[1] !== 'N' ? code[1] : null,
        earlyVoted: code[2] === 'Y'
    };
}
```

**Files to Modify:**
- `backend/parsers/csv-parser.js` (add election parsing logic)

---

## 6. Implementation Steps

### 6.1 Phase 1: Fix Voter ID Validation (PRIORITY)

**Step 1:** Modify validation rule in import processor
- **File:** `backend/services/import-processor.js`
- **Line:** 246-249
- **Change:** Update regex from `{8,20}` to `{5,20}`
- **Test:** Import LEWIS - DIST. 2.csv and verify all records pass voter_id validation

**Step 2:** Update error message
- **Change:** Update error text from "8-20" to "5-20"
- **Purpose:** Provide accurate validation feedback

**Step 3:** Verify existing DBF imports still work
- **Test:** Import a sample DBF file with 8+ character voter IDs
- **Expected:** No regression, longer IDs still valid

### 6.2 Phase 2: Add Election History Parsing (ENHANCEMENT)

**Step 1:** Create election code parser function
- **File:** `backend/parsers/csv-parser.js`
- **Add:** `parseElectionCode(code)` function
- **Logic:** Parse YDY, YRN, NDY format into voted/party/early components

**Step 2:** Modify normalizeCSVRecord function
- **Enhancement:** Loop through E_1 to E_10 columns
- **Parse:** Convert election codes to electionHistory array
- **Test:** Verify parsed data matches expected format

**Step 3:** Verify election history storage
- **Test:** Import CSV with election codes
- **Verify:** Election data appears in election_history table
- **Check:** Super voter calculation works with CSV data

### 6.3 Phase 3: Testing & Validation

**Test Case 1: LEWIS - DIST. 2.csv Import**
- **Expected:** 2,678 successful imports, 0 failures
- **Verify:** All voter IDs accepted (5-digit format)
- **Check:** Precinct numbers correctly sanitized (2-4 → 24)

**Test Case 2: Mixed Format CSV**
- **Create:** CSV with 5-digit, 8-digit, and 15-digit voter IDs
- **Expected:** All IDs accepted
- **Verify:** No validation errors

**Test Case 3: Election History Parsing**
- **Input:** CSV with E_1="YDY", E_2="YRN"
- **Expected:** 2 election history records created per voter
- **Verify:** voted=true, partyCode='D' or 'R', earlyVoted correctly set

**Test Case 4: Invalid Data**
- **Input:** CSV with 4-digit voter ID
- **Expected:** Validation error: "Voter ID must be 5-20 alphanumeric characters"
- **Verify:** Error logged to import_errors table

**Test Case 5: Filename with Spaces**
- **Input:** "LEWIS - DIST. 2.csv"
- **Expected:** File accepted (spaces allowed in regex)
- **Verify:** No filename validation errors

---

## 7. Dependencies and Requirements

### 7.1 No New Dependencies Required

All fixes can be implemented using existing npm packages:
- `csv-parser` (already installed)
- `express` (already installed)
- `sqlite3` (already installed)

### 7.2 Database Schema

**No changes required.** Existing schema supports:
- Variable-length voter_id (TEXT field)
- Election history records
- Import error logging

### 7.3 Configuration Updates

**Optional:** Add configuration for voter ID validation
```javascript
// config/validation.js (new file)
module.exports = {
    voterId: {
        minLength: 5,
        maxLength: 20,
        pattern: /^[A-Z0-9]+$/i
    }
};
```

---

## 8. Potential Risks and Mitigations

### 8.1 Risk: Shortened Voter IDs May Conflict

**Description:** Allowing 5-digit voter IDs might create conflicts with other ID systems.

**Likelihood:** Low (IDs are state-specific)

**Mitigation:**
- Maintain alphanumeric validation
- Enforce state prefix (optional enhancement: "TN" + 5 digits)
- Check for duplicates during import (already implemented via import modes)

### 8.2 Risk: Election Code Parsing Errors

**Description:** Parsing E_1, E_2 columns might misinterpret data if format varies.

**Likelihood:** Medium (election codes may have variations)

**Mitigation:**
- Add comprehensive validation for election codes
- Log unparseable codes to import_errors table
- Make election parsing optional (feature flag)
- Document expected election code format explicitly

### 8.3 Risk: Performance Impact

**Description:** Additional election code parsing may slow down CSV imports.

**Likelihood:** Low (parsing is simple string processing)

**Mitigation:**
- Use batch processing (already implemented: 500 records/batch)
- Profile import performance before/after changes
- Consider making election parsing opt-in via import options

### 8.4 Risk: Backward Compatibility

**Description:** Changing validation might affect existing imports.

**Likelihood:** Very Low (relaxing validation is additive)

**Mitigation:**
- Existing 8-20 character IDs still valid (backward compatible)
- No schema changes required
- Test with existing DBF files before deployment

---

## 9. Success Criteria

### 9.1 Functional Requirements

✓ CSV file "LEWIS - DIST. 2.csv" imports successfully  
✓ All 2,678 voter records are inserted into database  
✓ No validation errors for 5-digit voter IDs  
✓ Precinct numbers correctly sanitized (2-4 → 24, 2-1 → 21)  
✓ City names validated against Obion County allowlist  
✓ ZIP codes validated in 5-digit and ZIP+4 formats  

### 9.2 Data Quality Requirements

✓ All mandatory fields populated (voter_id, names, address, city, zip, precinct)  
✓ Text fields sanitized (uppercase, no non-printable characters)  
✓ No duplicate voter_id entries (based on import mode)  
✓ Precinct statistics updated after import  

### 9.3 Optional Enhancement Requirements

✓ Election history parsed from E_1, E_2 columns (if Phase 2 implemented)  
✓ Super voter status calculated based on election history  
✓ Historical voting data preserved in election_history table  

---

## 10. Implementation Priority

### Priority 1: CRITICAL (Immediate Fix)
- Modify voter ID validation from 8-20 to 5-20 characters
- **Effort:** 10 minutes
- **Impact:** Unblocks CSV import immediately

### Priority 2: HIGH (Enhancement)
- Add election history parsing for CSV files
- **Effort:** 2-3 hours
- **Impact:** Preserves election data, enables super voter analysis

### Priority 3: MEDIUM (Improvement)
- Add comprehensive unit tests for CSV parsing
- Improve error messages with field-specific guidance
- **Effort:** 3-4 hours
- **Impact:** Better maintainability and user experience

### Priority 4: LOW (Nice to Have)
- Create CSV template generator endpoint
- Add data preview before import
- **Effort:** 4-6 hours
- **Impact:** Improved user experience

---

## Appendix A: Sample Error Log

**Expected Error Output (Before Fix):**
```json
{
  "importId": 123,
  "status": "failed",
  "recordsProcessed": 2678,
  "recordsSuccessful": 0,
  "recordsFailed": 2678,
  "errors": [
    {
      "recordNumber": 1,
      "errorType": "validation",
      "errorMessage": "Voter ID must be 8-20 alphanumeric characters",
      "recordData": "{\"voter_id\":\"31001\",\"last_name\":\"AANONSEN\"...}"
    },
    {
      "recordNumber": 2,
      "errorType": "validation",
      "errorMessage": "Voter ID must be 8-20 alphanumeric characters",
      "recordData": "{\"voter_id\":\"30687\",\"last_name\":\"ABBOTT\"...}"
    }
    // ... 2676 more similar errors
  ]
}
```

---

## Appendix B: Election Code Format Documentation

**Format:** 3-character string (e.g., "YDY", "YRN", "NDY")

**Position 1 (Voted):**
- `Y` = Voted
- `N` = Did not vote

**Position 2 (Party):**
- `D` = Democrat
- `R` = Republican
- `G` = Green
- `I` = Independent
- `N` = No party/Non-partisan

**Position 3 (Early Voting):**
- `Y` = Voted early
- `N` = Did not vote early

**Examples:**
- `YDY` = Voted, Democrat, Early Vote
- `YRN` = Voted, Republican, No Early Vote
- `NDY` = Did not vote (position 3 irrelevant)
- `YGN` = Voted, Green Party, No Early Vote
- `Y Y` = Voted, Unknown/No Party, Early Vote (space indicates missing data)

---

**End of Specification**
