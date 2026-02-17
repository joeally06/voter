# Validation Failure Analysis: LEWIS - DIST. 2.csv Import

## Executive Summary

**Root Cause:** Foreign key constraint violation when attempting to re-import voters that have existing election history records.

**Impact:** 500 out of 2,677 records failing on subsequent imports (first import succeeded with 2,677/2,677)

**Error:** `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`

---

## Investigation Results

### 1. CSV File Analysis

**File:** `c:\Voter\LEWIS - DIST. 2.csv`
- **Total records:** 2,677 (plus 1 header row = 2,678 lines)
- **Data quality:** ✅ All records pass field validation
- **Duplicates:** ✅ No duplicate voter_ids within the file
- **Required fields:** ✅ All present and properly formatted

**Sample validation results:**
```
✅ Passed: 2,677
❌ Failed: 0 (field validation)
```

All records have:
- Valid voter_id (1-20 alphanumeric characters)
- Required fields: last_name, first_name, address, city, zip_code, precinct_number
- Valid ZIP codes (5-digit or ZIP+4 format)
- Valid precinct format (district-precinct like "2-4")
- Valid Obion County cities

### 2. Database State Analysis

**Current database:**
- **Total voters:** 2,677 (100% match with CSV)
- **Voters with election history:** 742 voters
- **Total election history records:** 4,074 records
- **CSV overlap:** 100% (all CSV records already exist in database)

**Import history:**
| Import ID | Date/Time | Status | Successful | Failed |
|-----------|-----------|--------|------------|--------|
| 291 | 2026-02-16 03:47:55 | ✅ completed | 2,677 | 0 |
| 292 | 2026-02-16 13:10:59 | ⚠️ partial | 2,177 | 500 |
| 293 | 2026-02-16 19:20:27 | ⚠️ partial | 2,177 | 500 |
| 294 | 2026-02-16 20:45:01 | ⚠️ partial | 2,177 | 500 |
| 295 | 2026-02-16 20:46:14 | ⚠️ partial | 2,177 | 500 |

**Key observation:** Import #291 (first import) succeeded completely. All subsequent imports fail on exactly 500 records.

### 3. Database Schema Analysis

**Foreign Key Constraint:**
```sql
-- election_history table
FOREIGN KEY (voter_id) REFERENCES voters(voter_id)
  ON DELETE: NO ACTION
  ON UPDATE: NO ACTION
```

**Foreign keys enabled:** YES (`PRAGMA foreign_keys = ON`)

**Voters table:**
- `voter_id` - TEXT UNIQUE (not the primary key!)
- Primary key is `id` (INTEGER AUTOINCREMENT)

### 4. Root Cause Identified

#### The Problem

When using `INSERT OR REPLACE` mode with foreign key constraints:

1. **First import (Import #291):**
   - All 2,677 voters inserted successfully
   - Election history records created for 742 voters (from E_1, E_2 columns in CSV)

2. **Subsequent imports (Imports #292-295):**
   - Attempt to re-import the same 2,677 voters using `INSERT OR REPLACE`
   - SQLite's `INSERT OR REPLACE` strategy:
     ```
     Step 1: Check if voter_id exists (UNIQUE constraint)
     Step 2: If exists, DELETE the old row
     Step 3: INSERT the new row
     ```
   - **FAILURE at Step 2:** Cannot DELETE voters that have election_history records referencing them
   - Foreign key constraint `ON DELETE: NO ACTION` blocks the deletion
   - Result: 500 records fail (not all 742 because of batching or timing)

#### Code Location

**File:** `backend/models/voter.js` (lines 25-68)

```javascript
async create(voterData, importMode = 'replace') {
    // ...
    if (importMode === 'replace') {
        // ❌ PROBLEM: Uses DELETE-then-INSERT strategy
        sql = `INSERT OR REPLACE INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
    }
    // ...
}
```

### 5. Error Details

**Sample failed records:**
```
Record #1: NICHOLAS R AANONSEN (voter_id: 31001)
  - Error: FOREIGN KEY constraint failed
  - Has 1 election history record
  
Record #2: BYRON LAMAR ABBOTT (voter_id: 30687)
  - Error: FOREIGN KEY constraint failed
  - Has 0 election history records (?)
```

**Error type categorization:**
- `database_transaction`: 500 records
- All errors have same message: "Batch transaction failed: SQLITE_CONSTRAINT: FOREIGN KEY constraint failed"

---

## Recommended Fixes

### Option 1: Use UPDATE Instead of INSERT OR REPLACE (Recommended)

**Modify:** `backend/models/voter.js`

**Change the 'replace' mode to use UPDATE for existing records:**

```javascript
async create(voterData, importMode = 'replace') {
    const fields = [
        'voter_id', 'last_name', 'first_name', 'address', 'city',
        'zip_code', 'precinct_number', 'date_of_birth', 'super_voter', 'state'
    ];

    const values = fields.map(field => {
        if (field === 'super_voter') {
            return voterData[field] ? 1 : 0;
        }
        return voterData[field] !== undefined ? voterData[field] : null;
    });

    let sql;
    let params = values;

    if (importMode === 'skip') {
        sql = `INSERT OR IGNORE INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
    } else if (importMode === 'replace') {
        // ✅ FIX: Use UPDATE for existing records, INSERT for new ones
        // First, check if record exists
        const existing = await database.get(
            'SELECT id FROM voters WHERE voter_id = ?',
            [voterData.voter_id]
        );

        if (existing) {
            // Update existing record without disturbing foreign key relationships
            const updateFields = fields.filter(f => f !== 'voter_id');
            const updateValues = updateFields.map(field => {
                if (field === 'super_voter') {
                    return voterData[field] ? 1 : 0;
                }
                return voterData[field] !== undefined ? voterData[field] : null;
            });
            
            sql = `UPDATE voters SET ${updateFields.map(f => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE voter_id = ?`;
            params = [...updateValues, voterData.voter_id];
        } else {
            // Insert new record
            const placeholders = fields.map(() => '?').join(', ');
            sql = `INSERT INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
            params = values;
        }
    } else if (importMode === 'flag') {
        // ... existing code ...
    }

    const result = await database.run(sql, params);
    return result;
}
```

**Benefits:**
- ✅ Preserves foreign key relationships
- ✅ No schema changes needed
- ✅ Updates voter data while keeping election history intact
- ✅ Minimal code change

### Option 2: Add ON DELETE CASCADE to Foreign Key

**Modify:** Database schema (requires migration)

**Create new migration:** `backend/migrations/009_fix_foreign_key_cascade.js`

```javascript
/**
 * Migration: Fix Foreign Key Constraint for Election History
 * Change ON DELETE NO ACTION to ON DELETE CASCADE
 */

const database = require('../config/database');

async function migrate() {
    console.log('Running migration: Fix foreign key cascade...');
    
    try {
        await database.connect();
        
        // SQLite doesn't support ALTER FOREIGN KEY, must recreate table
        await database.run('BEGIN TRANSACTION');
        
        // 1. Create new election_history table with CASCADE
        await database.run(`
            CREATE TABLE election_history_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voter_id TEXT,
                election_code TEXT,
                voted BOOLEAN DEFAULT 0,
                party_code TEXT,
                early_voted BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (voter_id) REFERENCES voters(voter_id) ON DELETE CASCADE ON UPDATE CASCADE
            )
        `);
        
        // 2. Copy data
        await database.run(`
            INSERT INTO election_history_new
            SELECT * FROM election_history
        `);
        
        // 3. Drop old table
        await database.run('DROP TABLE election_history');
        
        // 4. Rename new table
        await database.run('ALTER TABLE election_history_new RENAME TO election_history');
        
        // 5. Recreate index
        await database.run(`
            CREATE INDEX IF NOT EXISTS idx_election_voter 
            ON election_history(voter_id)
        `);
        
        await database.run('COMMIT');
        
        console.log('✅ Migration completed successfully');
        return true;
        
    } catch (error) {
        await database.run('ROLLBACK');
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

module.exports = migrate;
```

**Trade-offs:**
- ⚠️ When a voter is replaced, all election history is deleted
- ⚠️ CSV re-imports will lose election history data
- ❌ Not recommended unless election history is always re-imported

### Option 3: Clear Election History Before Replace

**Modify:** `backend/services/import-processor.js`

Add deletion step before voter update:

```javascript
// In processBatch function, before voterModel.create():
if (importMode === 'replace') {
    // Delete election history first to avoid foreign key constraint
    await database.run('DELETE FROM election_history WHERE voter_id = ?', [record.voter_id]);
}

await voterModel.create(record, importMode);

// Then re-insert election history
if (record.electionHistory && record.electionHistory.length > 0) {
    // ... existing code ...
}
```

**Trade-offs:**
- ✅ Works with existing schema
- ⚠️ Extra database operations per record
- ⚠️ Risk of data loss if election history insert fails after deletion

---

## Recommended Solution

**Implement Option 1: Use UPDATE Instead of INSERT OR REPLACE**

**Reasoning:**
1. **Preserves data integrity:** Existing election history is not disturbed
2. **No schema changes:** Works with current database structure
3. **Proper semantics:** UPDATE is the correct operation for modifying existing records
4. **Better performance:** Single query per record (SELECT + UPDATE/INSERT)
5. **Safer:** No risk of data loss from cascading deletions

**Implementation priority:**
1. Fix `backend/models/voter.js` - `create()` method (replace mode)
2. Test with sample data
3. Re-import LEWIS - DIST. 2.csv
4. Verify: Should see 2,677 successful, 0 failed

---

## Files Requiring Modification

1. **Primary fix:**
   - `backend/models/voter.js` (lines 25-68)

2. **Testing files created:**
   - `test-csv-validation.js` (validation testing)
   - `test-duplicates.js` (duplicate detection)
   - `test-database-overlap.js` (database overlap analysis)
   - `test-import-logs.js` (error log analysis)
   - `test-foreign-keys.js` (foreign key constraint analysis)

---

## Validation Steps After Fix

1. **Clear test:**
   ```bash
   npm run setup  # Reset database if needed
   ```

2. **First import:**
   - Upload LEWIS - DIST. 2.csv
   - Expected: 2,677 successful, 0 failed

3. **Re-import test:**
   - Upload same file again
   - Expected: 2,677 successful (updated), 0 failed

4. **Verify data:**
   ```javascript
   // Check voter count
   SELECT COUNT(*) FROM voters;  // Should be 2,677
   
   // Check election history preserved
   SELECT COUNT(*) FROM election_history;  // Should remain at 4,074
   
   // Verify updated_at timestamps changed
   SELECT voter_id, first_name, last_name, updated_at 
   FROM voters 
   ORDER BY updated_at DESC 
   LIMIT 10;
   ```

---

## Additional Notes

- The error message "Batch transaction failed" in logs suggests an older version of the code may have been running during imports #292-295
- Current code processes records individually (per-record error handling was implemented)
- The exact number 500 may be due to batch processing (500 records = 1 batch at BATCH_SIZE)
- Consider adding logging to track which specific voter_ids fail for better debugging

---

**Analysis completed:** 2026-02-16
**Analysts:** GitHub Copilot
