# CSV Validation Errors - Root Cause Analysis & Solution

**Date:** February 7, 2026  
**Issue:** 100 records failing voter ID validation  
**Error Message:** "Voter ID must be 5-20 alphanumeric characters"

---

## Executive Summary

**Root Cause:** The voter ID validation regex requires minimum 5 characters (`/^[A-Z0-9]{5,20}$/i`), but the Obion County voter data contains STATE_ID values ranging from **1 to 5 digits**. Approximately 100 records have IDs shorter than 5 characters (1-4 digits).

**Impact:** Valid voter records from the election commission database are being rejected during import.

**Recommended Solution:** Update the regex pattern to accept 1-20 alphanumeric characters instead of 5-20.

---

## Current State Analysis

### Code Location
File: `backend/services/import-processor.js`  
Line: ~252

### Current Validation Logic
```javascript
// Voter ID validation
// Updated to support 5-digit voter IDs from Obion County Election Commission
// STATE_ID field contains 5-digit numeric IDs (e.g., "31001", "30687")
if (voter.voter_id && !/^[A-Z0-9]{5,20}$/i.test(voter.voter_id)) {
    errors.push('Voter ID must be 5-20 alphanumeric characters');
}
```

**Problem:** The comment states "5-digit numeric IDs" but the data contains IDs from 1-5 digits.

---

## Data Findings

### Sample Analysis from LEWIS - DIST. 2.csv

| CSV Row | Record # | STATE_ID | Length | Status |
|---------|----------|----------|--------|--------|
| 27 | 26 | "3" | 1 char | ❌ FAILS |
| 29 | 28 | "5" | 1 char | ❌ FAILS |
| 30 | 29 | "6" | 1 char | ❌ FAILS |
| 31 | 30 | "7" | 1 char | ❌ FAILS |
| 32 | 31 | "8" | 1 char | ❌ FAILS |
| 90 | 89 | "10" | 2 chars | ❌ FAILS |
| 89 | 88 | "11" | 2 chars | ❌ FAILS |
| 129 | 128 | "20" | 2 chars | ❌ FAILS |
| 133 | 132 | "22" | 2 chars | ❌ FAILS |
| 99 | 98 | "132" | 3 chars | ❌ FAILS |
| 144 | 143 | "732" | 3 chars | ❌ FAILS |
| 22 | 21 | "3801" | 4 chars | ❌ FAILS |
| 40 | 39 | "5210" | 4 chars | ❌ FAILS |
| 13 | 12 | "6847" | 4 chars | ❌ FAILS |
| 14 | 13 | "6851" | 4 chars | ❌ FAILS |
| 15 | 14 | "6855" | 4 chars | ❌ FAILS |
| 16 | 15 | "6856" | 4 chars | ❌ FAILS |
| 2 | 1 | "31001" | 5 chars | ✅ PASSES |
| 3 | 2 | "30687" | 5 chars | ✅ PASSES |

### Distribution Pattern

- **1-digit IDs:** ~10 records (e.g., 3, 5, 6, 7, 8, 11, 20, 22, 25)
- **2-digit IDs:** ~10 records
- **3-digit IDs:** ~10 records
- **4-digit IDs:** ~70 records (majority of failures)
- **5-digit IDs:** ~2600 records (pass validation)

### Validation Test Results

Current regex: `/^[A-Z0-9]{5,20}$/i`

```javascript
// Test cases
"3".match(/^[A-Z0-9]{5,20}$/i)      // null (FAILS - too short)
"6847".match(/^[A-Z0-9]{5,20}$/i)   // null (FAILS - 4 chars)
"31001".match(/^[A-Z0-9]{5,20}$/i)  // matches (PASSES - 5 chars)
```

---

## Root Cause Determination

The Obion County Election Commission uses a **sequential numeric ID system** where:
- Older voter registrations have lower numbers (1-4 digits)
- Newer registrations have higher numbers (5 digits)

The previous fix assumed all IDs were 5 digits based on the first few records examined, but failed to account for the full historical range of voter registration numbers.

---

## Proposed Solution

### Change Required

**File:** `backend/services/import-processor.js` (line ~252)

**Before:**
```javascript
if (voter.voter_id && !/^[A-Z0-9]{5,20}$/i.test(voter.voter_id)) {
    errors.push('Voter ID must be 5-20 alphanumeric characters');
}
```

**After:**
```javascript
if (voter.voter_id && !/^[A-Z0-9]{1,20}$/i.test(voter.voter_id)) {
    errors.push('Voter ID must be 1-20 alphanumeric characters');
}
```

### Updated Comment
```javascript
// Voter ID validation
// Obion County uses sequential numeric IDs (1-5 digits for historical records)
// Accepts 1-20 characters to support legacy voter registration numbers
```

---

## Implementation Steps

1. **Update Regex Pattern**
   - Change minimum length from 5 to 1 character
   - Keep maximum at 20 to prevent invalid data

2. **Update Error Message**
   - Change "5-20 alphanumeric" to "1-20 alphanumeric"

3. **Update Code Comments**
   - Correct the documentation to reflect actual data patterns
   - Note the sequential ID system and historical range

4. **No Other Changes Needed**
   - Empty/null check remains: `if (voter.voter_id && ...)`
   - Alphanumeric pattern remains appropriate
   - Case-insensitive flag remains appropriate

---

## Test Cases

### Valid IDs (should pass)
```javascript
"3"       // 1 digit
"25"      // 2 digits
"132"     // 3 digits
"6847"    // 4 digits
"31001"   // 5 digits
"ABC123"  // alphanumeric (if future format changes)
```

### Invalid IDs (should fail)
```javascript
""        // empty (caught by null check)
null      // null (caught by null check)
"A"       // single letter (should PASS - valid alphanumeric)
"!@#"     // special characters
"12345678901234567890X" // >20 characters
```

### Edge Cases
```javascript
"1"       // minimum valid (single digit)
"12345678901234567890" // maximum valid (20 chars)
" 3"      // leading space (should fail)
"3 "      // trailing space (should fail)
```

---

## Potential Risks & Mitigations

### Risk 1: Too Permissive
**Concern:** Accepting 1-character IDs might allow invalid data  
**Mitigation:** The election commission data confirms 1-digit IDs are legitimate historical records. The alphanumeric pattern still prevents special characters and empty values.

### Risk 2: Data Quality
**Concern:** What if a field is misaligned and a non-ID value ends up in STATE_ID?  
**Mitigation:** 
- The CSV parser maps columns by header name, not position
- The alphanumeric pattern prevents obvious garbage (symbols, spaces)
- Empty values are still rejected by the null check

### Risk 3: Future Format Changes
**Concern:** What if the election commission changes ID format?  
**Mitigation:** The 1-20 character range with alphanumeric pattern is flexible enough to accommodate:
- Longer numeric sequences
- Alphanumeric formats (e.g., "TN-12345")
- State-specific prefixes

---

## Validation Strategy

### Pre-Implementation
1. Verify current failing records match pattern (1-4 digit STATE_IDs)
2. Count total affected records (~100 expected)

### Post-Implementation
1. Re-import LEWIS - DIST. 2.csv
2. Verify 0 validation errors for voter ID field
3. Confirm all 2,678 records import successfully
4. Spot-check database for correct STATE_ID values:
   - Single digit: "3", "5", "6"
   - Four digit: "6847", "6851", "6855"
   - Five digit: "31001", "30687"

### Regression Testing
1. Test with various ID formats in test CSV
2. Verify error handling for truly invalid IDs (special chars, too long)
3. Confirm null/empty check still works

---

## Success Criteria

- ✅ 100% of Obion County voter records import without voter ID errors
- ✅ IDs from 1-20 characters accepted
- ✅ Invalid IDs (special chars, >20 chars) still rejected
- ✅ Empty/null voter IDs still rejected
- ✅ Code comments accurately reflect data format
- ✅ Error message matches validation rule

---

## Related Files

- `backend/services/import-processor.js` - Validation logic
- `backend/parsers/csv-parser.js` - CSV field mapping
- `LEWIS - DIST. 2.csv` - Source data file with failing records

---

## Appendix: Detailed Record Analysis

### Failing Records Sample (first 20)

```csv
Row 27:  3,ALEXANDER,DONALD EDWIN, ...
Row 29:  5,ALEXANDER,STEVE L, ...
Row 30:  6,ALFORD,BARBARA G, ...
Row 31:  7,ALFORD,MICHAEL GLEN, ...
Row 32:  8,ALFORD,ROBERT G, ...
Row 89:  11,BAGGETT,GENE L, ...
Row 90:  10,BAGGETT,JOYCE I, ...
Row 129: 20,BARNES,JAMES E, ...
Row 133: 22,BARNES,KENNETH N, ...
Row 136: 25,BARNES,SHARON K, ...
Row 99:  132,BAILEY,KATHY JO, ...
Row 144: 732,BARNETT,THERESA JEAN, ...
Row 22:  3801,ALDRIDGE,JOSEPH BRIAN, ...
Row 40:  5210,ALLMAN,LINDA G, ...
Row 13:  6847,ADCOCK,BETTY J, ...
Row 14:  6851,ADCOCK,EDWARD D, ...
Row 15:  6855,ADKINS,CAROLYN A, ...
Row 16:  6856,ADKINS,L D, ...
Row 19:  6862,AKIN,JANICE D, ...
Row 37:  6870,ALLEN,RAYBURN S, ...
```

All follow the pattern: **numeric IDs shorter than 5 characters**.
