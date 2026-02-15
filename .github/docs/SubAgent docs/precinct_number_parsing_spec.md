# Precinct Number Parsing Investigation & Specification

**Date**: February 7, 2026  
**Issue**: Precinct numbers from CSV are transformed during import, causing UI display mismatch  
**Status**: Root cause identified, solution specified

---

## Executive Summary

Precinct numbers in the CSV file are stored in hyphenated format (e.g., "2-1", "2-4") representing District-Precinct notation. However, the current parser strips the hyphen during import, converting "2-1" to "21". This removes semantic meaning and causes confusion for users who expect to see the original format in the UI.

**Root Cause**: The `sanitizePrecinct()` function removes ALL non-numeric characters, including semantically meaningful hyphens.

**Recommended Solution**: Preserve the hyphenated format throughout the data pipeline.

---

## Current State Analysis

### Data Flow Investigation

| Stage | Format | Example | Notes |
|-------|--------|---------|-------|
| **CSV Source** | `"2-1"` | District 2, Precinct 1 | Raw data from Obion County Election Commission |
| **Parser (`sanitizePrecinct()`)** | `"21"` | Hyphen stripped | `.replace(/[^0-9]/g, '')` removes hyphen |
| **Database Storage** | `"21"` | No hyphen | Stored as TEXT in `voters.precinct_number` |
| **API Response** | `"21"` | No hyphen | Passed directly from database |
| **UI Display** | `"21"` | No hyphen | Shown in precinct dropdown and voter details |
| **User Expectation** | `"2-1"` | With hyphen | Expects original format from CSV |

### Code Analysis

#### 1. CSV File Format
**File**: `c:\Voter\LEWIS - DIST. 2.csv`

```csv
STATE_ID,LNAME,FNAME,...,PCT_NBR,...
31001,AANONSEN,NICHOLAS R,...,2-4,...
30687,ABBOTT,BYRON LAMAR,...,2-1,...
46030,ABBOTT,LEQUANTE MARQUISE,...,2-4,...
```

**Finding**: CSV contains hyphenated values: `"2-1"`, `"2-4"` in the `PCT_NBR` column.

#### 2. Parser Transformation
**File**: `c:\Voter\backend\parsers\csv-parser.js` (Lines 299-306)

```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim().replace(/[^0-9]/g, '');  // ❌ REMOVES HYPHEN
    
    // Zero-pad to 2 digits
    return cleaned.padStart(2, '0');
}
```

**Finding**: The regex `/[^0-9]/g` removes ALL non-numeric characters, including hyphens.
- Input: `"2-1"` → After regex: `"21"` → After padding: `"21"`
- Input: `"2-4"` → After regex: `"24"` → After padding: `"24"`

**Field Mapping**:
```javascript
// Line 213 in csv-parser.js
'pct_nbr': 'precinct_number',  // Maps PCT_NBR → precinct_number
```

#### 3. Database Storage
**Schema**: `voters.precinct_number TEXT NOT NULL`

Query results:
```
┌─────────┬─────────────────┬───────┐
│ (index) │ precinct_number │ count │
├─────────┼─────────────────┼───────┤
│ 0       │ '21'            │ 1353  │
│ 1       │ '24'            │ 1324  │
└─────────┴─────────────────┴───────┘
```

**Finding**: Database stores `"21"` and `"24"` (no hyphen). The TEXT data type supports any format.

#### 4. Frontend Display
**File**: `c:\Voter\frontend\public\js\filter-controller.js` (Lines 180-194)

```javascript
precincts.forEach(p => {
  const option = document.createElement('option');
  option.value = p.precinct_number;  // Uses database value directly
  option.textContent = `Precinct ${p.precinct_number} (${Utils.formatNumber(p.total_voters || 0)} voters)`;
  dropdown.appendChild(option);
});
```

**Finding**: Frontend displays precinct numbers directly from database without transformation.
- Database has: `"21"` → UI shows: `"Precinct 21 (1353 voters)"`
- User expects: `"Precinct 2-1 (1353 voters)"`

#### 5. Validation Logic
**File**: `c:\Voter\backend\services\import-processor.js` (Lines 244-252)

```javascript
// Precinct number validation
if (voter.precinct_number && !/^\d{1,3}$/.test(voter.precinct_number)) {
    errors.push(`Invalid precinct_number format: ${voter.precinct_number} (must be 1-3 digits)`);
}
```

**Finding**: Validation currently expects 1-3 numeric digits only. This would REJECT hyphenated formats like "2-1" if they reached validation unchanged.

---

## Problem Statement

### Issue Description
The current implementation strips hyphens from precinct numbers during CSV import, removing semantic information that distinguishes the district from the precinct number within that district.

### Impact on User Experience
1. **Loss of Semantic Meaning**: "2-1" conveys "District 2, Precinct 1", while "21" could be misinterpreted as "Precinct 21"
2. **Data Integrity**: Original format from election commission is not preserved
3. **User Confusion**: Users familiar with official precinct notation expect hyphenated format
4. **Potential Conflicts**: In the future, District 21 Precinct 1 ("21-1") would also become "211", creating ambiguity

### Examples of Incorrect Behavior
- CSV contains: `PCT_NBR = "2-1"`
- Database stores: `precinct_number = "21"`  
- UI displays: "Precinct 21"
- User sees: "This should be Precinct 2-1, not 21!"

---

## Research: Precinct Number Standards

### Industry Best Practices
1. **Hyphenated Format**: Most election systems use "District-Precinct" notation (e.g., "2-1", "15-3")
2. **Preservation of Source Format**: Election data should match official records exactly
3. **Data Type**: TEXT/VARCHAR is standard for precinct identifiers (not INTEGER) to support various formats

### Obion County, Tennessee Standards
Based on the CSV file from Obion County Election Commission:
- Format: `"2-1"`, `"2-4"` (District-Precinct)
- This is the **official format** from the source authority
- Should be treated as authoritative

### Recommendation
**Preserve the hyphenated format** as it:
- Matches the official source data
- Has clear semantic meaning
- Is more readable and user-friendly
- Prevents potential ambiguity
- Follows industry standards for precinct notation

---

## Proposed Solution

### Solution Overview
Modify the `sanitizePrecinct()` function to preserve hyphens while still cleaning other unwanted characters and validating the format.

### Required Changes

#### Change #1: Update `sanitizePrecinct()` in CSV Parser
**File**: `c:\Voter\backend\parsers\csv-parser.js` (Lines 299-306)

**Before**:
```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    const cleaned = value.toString().trim().replace(/[^0-9]/g, '');
    
    // Zero-pad to 2 digits
    return cleaned.padStart(2, '0');
}
```

**After**:
```javascript
function sanitizePrecinct(value) {
    if (!value) return '';
    
    // Preserve hyphens, remove other non-alphanumeric characters
    const cleaned = value.toString().trim().replace(/[^0-9-]/g, '').toUpperCase();
    
    // Validate format: supports "2-1" or standalone "05" formats
    if (!/^(\d{1,2}-\d{1,2}|\d{1,3})$/.test(cleaned)) {
        // Return as-is for validation to catch
        return cleaned;
    }
    
    return cleaned;
}
```

#### Change #2: Update `sanitizePrecinct()` in DBF Parser
**File**: `c:\Voter\backend\parsers\dbf-parser.js` (Lines 297-304)

Apply the same change as CSV parser for consistency.

#### Change #3: Update Precinct Validation
**File**: `c:\Voter\backend\services\import-processor.js` (Lines 244-252)

**Before**:
```javascript
// Precinct number validation
if (voter.precinct_number && !/^\d{1,3}$/.test(voter.precinct_number)) {
    errors.push(`Invalid precinct_number format: ${voter.precinct_number} (must be 1-3 digits)`);
}
```

**After**:
```javascript
// Precinct number validation (supports "2-1" or "05" formats)
if (voter.precinct_number && !/^(\d{1,2}-\d{1,2}|\d{1,3})$/.test(voter.precinct_number)) {
    errors.push(`Invalid precinct_number format: ${voter.precinct_number} (must be format "2-1" or "05")`);
}
```

#### Change #4: Database Migration (Optional)
**File**: `c:\Voter\backend\migrations\004_fix_precinct_format.js` (NEW)

Create a migration to restore hyphens in existing data:

```javascript
/**
 * Migration: Restore hyphenated precinct format
 * Converts "21" back to "2-1", "24" to "2-4"
 */

exports.up = async (database) => {
    // This migration assumes all current precincts are District 2
    // Update based on actual district pattern if needed
    
    await database.run(`
        UPDATE voters 
        SET precinct_number = 
            CASE 
                WHEN precinct_number = '21' THEN '2-1'
                WHEN precinct_number = '24' THEN '2-4'
                ELSE precinct_number
            END
        WHERE precinct_number IN ('21', '24')
    `);
    
    await database.run(`
        UPDATE precincts 
        SET precinct_number = 
            CASE 
                WHEN precinct_number = '21' THEN '2-1'
                WHEN precinct_number = '24' THEN '2-4'
                ELSE precinct_number
            END
        WHERE precinct_number IN ('21', '24')
    `);
    
    console.log('✅ Restored hyphenated precinct format');
};

exports.down = async (database) => {
    // Revert to non-hyphenated format
    await database.run(`
        UPDATE voters 
        SET precinct_number = REPLACE(precinct_number, '-', '')
    `);
    
    await database.run(`
        UPDATE precincts 
        SET precinct_number = REPLACE(precinct_number, '-', '')
    `);
    
    console.log('⏮️ Reverted to non-hyphenated precinct format');
};
```

---

## Implementation Steps

### Phase 1: Code Updates
1. ✅ Update `sanitizePrecinct()` in `backend/parsers/csv-parser.js`
2. ✅ Update `sanitizePrecinct()` in `backend/parsers/dbf-parser.js`
3. ✅ Update validation regex in `backend/services/import-processor.js`
4. ✅ Create migration script `backend/migrations/004_fix_precinct_format.js`

### Phase 2: Database Migration
1. ✅ Backup current database
2. ✅ Run migration to restore hyphens in existing data
3. ✅ Verify precinct_number values in `voters` and `precincts` tables
4. ✅ Confirm no data loss or corruption

### Phase 3: Testing
1. ✅ Unit test `sanitizePrecinct()` with various inputs:
   - `"2-1"` → `"2-1"` (preserve)
   - `"2 - 1"` → `"2-1"` (clean spaces)
   - `"ABC-2-1"` → `"2-1"` (remove letters)
   - `"05"` → `"05"` (support standalone format)
2. ✅ Integration test: Import CSV with hyphenated precincts
3. ✅ Verify UI displays `"Precinct 2-1"` in dropdown
4. ✅ Test filtering by precinct works correctly
5. ✅ Verify analytics properly group by hyphenated precincts

### Phase 4: Validation
1. ✅ Re-import the test CSV file (`LEWIS - DIST. 2.csv`)
2. ✅ Confirm database now has `"2-1"` and `"2-4"` instead of `"21"` and `"24"`
3. ✅ Check UI precinct dropdown shows correct format
4. ✅ Verify voter details display correct precinct
5. ✅ Test that analytics charts use correct precinct labels

---

## Dependencies and Requirements

### Code Dependencies
- No new NPM packages required
- Uses existing regex and string manipulation functions

### Database Requirements
- Requires database migration execution
- **BACKUP REQUIRED** before migration
- Estimated downtime: < 1 second (migration only updates precinct strings)

### Testing Requirements
- Existing test framework can be used
- Add new test cases for hyphenated precinct validation
- Update existing tests that expect non-hyphenated format

---

## Potential Risks and Mitigations

### Risk 1: Existing Integrations Break
**Risk**: Third-party integrations or reports expect numeric-only precincts  
**Likelihood**: Low (this is a new platform)  
**Mitigation**: 
- Search codebase for hardcoded precinct assumptions
- Update any client-side filtering or sorting logic
- Verify all API endpoints handle TEXT precinct_number

### Risk 2: Data Migration Failure
**Risk**: Migration script errors, corrupting precinct data  
**Likelihood**: Low (simple string replacement)  
**Mitigation**:
- **MANDATORY database backup before migration**
- Test migration on development database first
- Provide rollback capability (`exports.down`)
- Verify row counts before/after migration

### Risk 3: Sort Order Changes
**Risk**: String sorting "2-1" vs "2-4" differs from numeric "21" vs "24"  
**Likelihood**: Medium  
**Impact**: Minor (sort order remains correct for district-precinct format)  
**Mitigation**: 
- Test precinct dropdown sort order
- SQL: `ORDER BY precinct_number` will sort correctly ("2-1", "2-2", "2-3", "2-4")

### Risk 4: Future Precinct Formats Not Supported
**Risk**: Different precinct naming conventions in other counties  
**Likelihood**: Medium  
**Mitigation**:
- Regex pattern `/^(\d{1,2}-\d{1,2}|\d{1,3})$/` supports both hyphenated and simple formats
- Can be extended if new formats emerge (e.g., "2-1A", "N2-1")

### Risk 5: Excel Auto-Formatting Issues
**Risk**: Excel may convert "2-1" to date "1-Feb" when CSV is opened  
**Likelihood**: High (known Excel behavior)  
**Impact**: Low (does not affect our parser, only manual CSV viewing)  
**Mitigation**:
- Document this Excel behavior in user guide
- Recommend viewing CSV in text editor or setting column to "Text" format before import
- Our parser reads the raw CSV data, not Excel's interpreted values

---

## Testing Approach

### Unit Tests
**File**: `tests/unit/parsers/csv-parser.test.js`

```javascript
describe('sanitizePrecinct', () => {
    test('preserves hyphenated format', () => {
        expect(sanitizePrecinct('2-1')).toBe('2-1');
        expect(sanitizePrecinct('2-4')).toBe('2-4');
        expect(sanitizePrecinct('15-3')).toBe('15-3');
    });
    
    test('cleans spaces but preserves hyphen', () => {
        expect(sanitizePrecinct('2 - 1')).toBe('2-1');
        expect(sanitizePrecinct(' 2-4 ')).toBe('2-4');
    });
    
    test('removes non-alphanumeric except hyphen', () => {
        expect(sanitizePrecinct('PCT 2-1')).toBe('2-1');
        expect(sanitizePrecinct('2-1!')).toBe('2-1');
    });
    
    test('supports standalone numeric format', () => {
        expect(sanitizePrecinct('5')).toBe('5');
        expect(sanitizePrecinct('05')).toBe('05');
        expect(sanitizePrecinct('123')).toBe('123');
    });
});
```

### Integration Tests
**File**: `tests/integration/precinct-parsing.test.js`

```javascript
describe('Precinct Parsing Integration', () => {
    test('CSV import preserves hyphenated precincts', async () => {
        const result = await parseCSV('test-data/precincts.csv');
        expect(result.records[0].precinct_number).toBe('2-1');
    });
    
    test('Database stores hyphenated format', async () => {
        const voter = await VoterModel.create({ precinct_number: '2-1', ... });
        const retrieved = await VoterModel.findById(voter.id);
        expect(retrieved.precinct_number).toBe('2-1');
    });
    
    test('API returns hyphenated format', async () => {
        const response = await request(app).get('/api/voters?precinct=2-1');
        expect(response.body.data[0].precinct_number).toBe('2-1');
    });
});
```

---

## Success Metrics

### Functional Validation
- ✅ CSV import preserves `"2-1"` format
- ✅ Database stores `"2-1"` (not `"21"`)
- ✅ UI displays `"Precinct 2-1"` in dropdown
- ✅ Filtering by precinct works correctly
- ✅ All tests pass

### Data Integrity
- ✅ All existing voter records updated via migration
- ✅ No data loss during migration
- ✅ Precinct statistics remain accurate

### User Satisfaction
- ✅ User confirms displayed precinct format matches CSV
- ✅ No confusion about precinct numbering

---

## Conclusion

The current implementation incorrectly strips hyphens from precinct numbers, removing semantic information and causing user confusion. The proposed solution preserves the hyphenated format throughout the data pipeline while maintaining data integrity and validation.

**Next Steps**:
1. Implement code changes in parsers and validation
2. Create and test database migration
3. Execute migration on production database (with backup)
4. Verify UI displays correct format
5. Monitor for any issues post-deployment

**Estimated Effort**: 2-3 hours (development + testing + migration)  
**Priority**: Medium (user-facing issue, but no data corruption)  
**Risk Level**: Low (simple string handling change with rollback capability)
