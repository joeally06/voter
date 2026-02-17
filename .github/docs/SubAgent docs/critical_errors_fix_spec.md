# Critical Errors Fix — Implementation Specification

**Date:** February 16, 2026  
**Source:** `.github/docs/SubAgent docs/error_audit.md`  
**Scope:** 5 Critical Errors (C1–C5)

---

## Overview

This spec provides exact implementation details for all 5 critical errors identified in the error audit. Each fix includes the exact file, line ranges, current code, and replacement code.

---

## C1: `this` Context Loss in Legacy Transaction

**File:** `backend/config/database.js`  
**Lines:** 195–227

**Problem:** Inside SQLite `db.run()` callbacks using `function(err)` syntax, `this` refers to the SQLite statement result object (providing `.lastID` and `.changes`), NOT the Database wrapper instance. Lines 209 and 213 call `this.db.run('ROLLBACK')` and `this.db.run('COMMIT', ...)` but `this.db` is undefined in that context.

**Fix:** Capture `this.db` in a local variable `const db = this.db;` before entering the callback chain. Replace all `this.db.run(...)` and `this.db.serialize(...)` calls within the method body with `db.run(...)` and `db.serialize(...)`. Keep `function(err)` callbacks (not arrow functions) so that `this.lastID` and `this.changes` still work correctly inside the inner callback.

**Exact replacement — old code (lines 195-227):**
```javascript
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                
                const results = [];
                let hasError = false;

                statements.forEach((stmt, index) => {
                    if (hasError) return;

                    this.db.run(stmt.sql, stmt.params || [], function(err) {
                        if (err) {
                            hasError = true;
                            this.db.run('ROLLBACK');
                            reject(err);
                        } else {
                            results.push({ index, id: this.lastID, changes: this.changes });
                            
                            if (results.length === statements.length) {
                                this.db.run('COMMIT', (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(results);
                                    }
                                });
                            }
                        }
                    });
                });
            });
        });
    }
```

**New code:**
```javascript
        return new Promise((resolve, reject) => {
            // Capture db reference to avoid 'this' context loss in SQLite callbacks
            // Inside function(err) callbacks, 'this' refers to SQLite statement result
            // (provides .lastID and .changes), NOT the Database wrapper instance
            const db = this.db;
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                const results = [];
                let hasError = false;

                statements.forEach((stmt, index) => {
                    if (hasError) return;

                    db.run(stmt.sql, stmt.params || [], function(err) {
                        if (err) {
                            hasError = true;
                            db.run('ROLLBACK');
                            reject(err);
                        } else {
                            results.push({ index, id: this.lastID, changes: this.changes });
                            
                            if (results.length === statements.length) {
                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(results);
                                    }
                                });
                            }
                        }
                    });
                });
            });
        });
    }
```

---

## C2: Route Ordering — `/:id` Shadows `/search/:query`

**File:** `backend/routes/voters.js`  
**Lines:** 123 (`/:id`) and 155 (`/search/:query`)

**Problem:** Express evaluates routes in registration order. `/:id` is registered first, so `/api/voters/search/smith` matches `/:id` with `id = "search"`, the `isInt` validator rejects it, and the `/search/:query` route is never reached.

**Fix:** Move the entire `/search/:query` route block to appear BEFORE the `/:id` route block. The search route currently spans from line ~151 to ~182. It must be moved before line ~119.

**Implementation approach:**
1. Cut the entire `/search/:query` route block (including JSDoc comment, router.get, validator, handler)
2. Paste it before the `/:id` route block
3. Add a comment explaining why search must come first

---

## C3: SQL Injection in `createJob`

**File:** `backend/services/geocoding-job-service.js`  
**Line:** 44-46

**Problem:** `voterIds` array is directly string-interpolated into SQL via `${voterIds.join(',')}`.

**Old code:**
```javascript
      const validVoters = await database.all(`
        SELECT id FROM voters WHERE id IN (${voterIds.join(',')})
      `);
```

**New code:**
```javascript
      // Use parameterized query to prevent SQL injection
      const placeholders = voterIds.map(() => '?').join(',');
      const validVoters = await database.all(
        `SELECT id FROM voters WHERE id IN (${placeholders})`,
        voterIds
      );
```

---

## C4: SQL Injection in `retryFailedAddresses`

**File:** `backend/services/geocoding-job-service.js`  
**Lines:** 509-512

**Problem:** Same pattern as C3 — `voterIds` interpolated directly into SQL in an UPDATE statement.

**Old code:**
```javascript
      await database.run(`
        UPDATE voters
        SET latitude = NULL, longitude = NULL, geocoding_quality = NULL
        WHERE id IN (${voterIds.join(',')})
      `);
```

**New code:**
```javascript
      // Use parameterized query to prevent SQL injection
      const retryPlaceholders = voterIds.map(() => '?').join(',');
      await database.run(
        `UPDATE voters
        SET latitude = NULL, longitude = NULL, geocoding_quality = NULL
        WHERE id IN (${retryPlaceholders})`,
        voterIds
      );
```

---

## C5: Table Name Mismatch — `api_quotas` vs `api_usage`

**File:** `backend/services/geocoding-service.js`  
**Lines:** Multiple sections

**Problem:** Two separate quota tracking systems exist:
- `api_quotas` table (migration 003): Used only by `geocoding-service.js`
- `api_usage` table (migration 006): Used by `quota-manager.js`, `route-optimizer-service.js`, `distance-matrix-service.js`

These never share data, so geocoding quota usage is invisible to the rest of the system.

**Fix approach:** Modify `geocoding-service.js` to use `QuotaManager` (which uses the `api_usage` table) instead of direct SQL against `api_quotas`. This unifies all API tracking into a single table.

### Step 1: Add QuotaManager import

After the existing `require` statements (around line 15), add:
```javascript
const QuotaManager = require('./quota-manager');
```

### Step 2: Initialize QuotaManager in constructor

After the `this.limiter` setup block (around line 40), add:
```javascript
    // Unified quota manager (uses api_usage table)
    this.quotaManager = new QuotaManager();
```

### Step 3: Replace `incrementQuotaUsage()` method (lines 376-389)

**Old code:**
```javascript
  async incrementQuotaUsage() {
    try {
      const date = new Date().toISOString().split('T')[0];
      
      await database.run(`
        INSERT INTO api_quotas (date, service, request_count) 
        VALUES (?, 'geocoding', 1)
        ON CONFLICT(date, service) 
        DO UPDATE SET request_count = request_count + 1
      `, [date]);
    } catch (error) {
      console.error('Failed to update quota:', error.message);
    }
  }
```

**New code:**
```javascript
  async incrementQuotaUsage() {
    try {
      // Use unified QuotaManager (api_usage table) instead of legacy api_quotas table
      await this.quotaManager.incrementApiCall('geocoding', 1);
    } catch (error) {
      console.error('Failed to update quota:', error.message);
    }
  }
```

### Step 4: Replace `getDailyUsage()` method (lines 397-413)

**Old code:**
```javascript
  async getDailyUsage(date = null) {
    try {
      const dateKey = date || new Date().toISOString().split('T')[0];
      
      const result = await database.get(`
        SELECT request_count FROM api_quotas 
        WHERE date = ? AND service = 'geocoding'
      `, [dateKey]);
      
      return result?.request_count || 0;
    } catch (error) {
      console.error('Failed to get quota usage:', error.message);
      return 0;
    }
  }
```

**New code:**
```javascript
  async getDailyUsage(date = null) {
    try {
      const dateKey = date || new Date().toISOString().split('T')[0];
      
      // Use unified api_usage table instead of legacy api_quotas table
      const result = await database.get(`
        SELECT call_count FROM api_usage 
        WHERE api_name = 'geocoding' AND call_date = ?
      `, [dateKey]);
      
      return result?.call_count || 0;
    } catch (error) {
      console.error('Failed to get quota usage:', error.message);
      return 0;
    }
  }
```

### Step 5: Replace `checkQuotaLimit()` method (lines 421-431)

**Old code:**
```javascript
  async checkQuotaLimit(estimatedCalls) {
    const dailyLimit = parseInt(process.env.DAILY_QUOTA_LIMIT) || 10000;
    const currentUsage = await this.getDailyUsage();
    
    if (currentUsage + estimatedCalls > dailyLimit) {
      throw new Error(
        `Daily quota limit would be exceeded: ${currentUsage + estimatedCalls}/${dailyLimit}. ` +
        `Current usage: ${currentUsage}, Estimated calls: ${estimatedCalls}`
      );
    }
  }
```

**New code:**
```javascript
  async checkQuotaLimit(estimatedCalls) {
    // Delegate to unified QuotaManager for consistent quota enforcement
    // QuotaManager uses api_usage table and provides richer error messages
    await this.quotaManager.checkQuota('geocoding', estimatedCalls);
  }
```

---

## Files Modified

| File | Errors Fixed |
|------|-------------|
| `backend/config/database.js` | C1 |
| `backend/routes/voters.js` | C2 |
| `backend/services/geocoding-job-service.js` | C3, C4 |
| `backend/services/geocoding-service.js` | C5 |

## Validation

After implementation, verify:
1. `node -c backend/config/database.js` — syntax check passes
2. `node -c backend/routes/voters.js` — syntax check passes
3. `node -c backend/services/geocoding-job-service.js` — syntax check passes
4. `node -c backend/services/geocoding-service.js` — syntax check passes
5. `node backend/server.js` — server starts without errors
