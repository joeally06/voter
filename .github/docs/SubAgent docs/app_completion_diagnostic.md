# Voter Outreach Platform - Server Startup Diagnostic Report

**Date:** February 7, 2026  
**Issue:** Server fails to start with exit code 1 (npm start)  
**Status:** ✅ ROOT CAUSE IDENTIFIED

---

## Executive Summary

### 🔴 CRITICAL BLOCKER IDENTIFIED

**Root Cause:** Port 3000 is already in use by a background Node.js process (PID 22472)

**Error Message:**
```
Error: listen EADDRINUSE: address already in use ::1:3000
    at Server.setupListenHandle [as _listen2] (node:net:1939:16)
```

**Impact:** Prevents new server instances from starting, causing all `npm start` commands to fail with exit code 1.

**Process Details:**
- **Process ID:** 22472
- **Process Name:** node.exe
- **Start Time:** 2/7/2026 9:44:13 AM
- **Port:** 3000 (LISTEN state)
- **Path:** C:\Program Files\nodejs\node.exe

### ✅ POSITIVE FINDINGS

1. ✅ Database operational (voter_platform.db exists, queries work)
2. ✅ Configuration complete (.env file exists with all required variables)
3. ✅ Google Maps API keys configured
4. ✅ Dependencies installed (npm install successful)
5. ✅ Directory structure correct
6. ✅ No code errors in server.js or configuration files
7. ✅ API endpoints work when server is running (confirmed via /api/config)

---

## Detailed Analysis

### 1. Port Conflict Investigation

**Command Used:**
```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object State, OwningProcess, ProcessName
```

**Results:**
| State    | OwningProcess | ProcessName |
|----------|---------------|-------------|
| Listen   | 22472         | node        |
| TimeWait | 0             | Idle        |
| TimeWait | 0             | Idle        |

**Analysis:**
- Process 22472 is actively listening on port 3000
- Two TIME_WAIT connections exist (normal, will clear automatically)
- No other processes competing for the port
- The listening process has been running since 9:44 AM (current diagnostic at ~10:00 AM+)

### 2. Server Configuration Review

**File:** [backend/server.js](backend/server.js)

**Startup Sequence:**
1. Load environment variables via `dotenv.config()`
2. Initialize Express app with middleware
3. Initialize database connection (`initializeDatabase()`)
4. Mount API routes
5. Start server listening on PORT (default: 3000)

**Port Configuration:**
```javascript
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
```

**Startup Function:**
```javascript
const startServer = async () => {
    await initializeDatabase();  // ✅ This succeeds (verified by output)
    
    app.listen(PORT, HOST, () => { // ❌ This fails with EADDRINUSE
        console.log(`🚀 Server running at http://${HOST}:${PORT}`);
    });
};
```

**Verified Working Components:**
- ✅ Database initialization succeeds (outputs: "✅ Connected to SQLite database")
- ✅ Database stats retrieved successfully (2677 voters, 2 precincts)
- ✅ No errors in middleware setup
- ✅ No errors in route mounting
- ❌ **FAILURE POINT:** `app.listen()` fails when trying to bind to port 3000

### 3. Environment Variables Audit

**File Located:** [.env](.env) ✅  
**Template Located:** [.env.example](.env.example) ✅

#### Required Environment Variables

| Variable | Status | Current Value | Purpose |
|----------|--------|---------------|---------|
| **CRITICAL (Server)** |
| `NODE_ENV` | ✅ Configured | development | Environment mode |
| `PORT` | ✅ Configured | 3000 | Server port |
| `HOST` | ✅ Configured | localhost | Server host |
| **CRITICAL (Google Maps)** |
| `GOOGLE_MAPS_API_KEY` | ✅ Configured | AIzaSy...IjVSM | Frontend Maps display |
| `GOOGLE_MAPS_GEOCODING_API_KEY` | ✅ Configured | AIzaSy...IjVSM | Geocoding service |
| **DATABASE** |
| `DB_PATH` | ✅ Configured | ./data/voter_platform.db | Database file path |
| `DB_BACKUP_PATH` | ✅ Configured | ./data/backups/ | Backup directory |
| **GEOCODING** |
| `GEOCODING_RATE_LIMIT` | ✅ Configured | 10 | Requests/second limit |
| `GEOCODING_BATCH_SIZE` | ✅ Configured | 100 | Batch processing size |
| `GEOCODING_DELAY_MS` | ✅ Configured | 100 | Delay between requests |
| `DAILY_QUOTA_LIMIT` | ⚠️ Missing | (default: 10000) | Daily API quota |
| **SECURITY** |
| `SESSION_SECRET` | ✅ Configured | voter-platform... | Session encryption |
| `CORS_ORIGIN` | ✅ Configured | http://localhost:3000 | CORS policy |
| **LOGGING** |
| `LOG_LEVEL` | ✅ Configured | info | Log verbosity |
| `LOG_FILE` | ✅ Configured | ./logs/app.log | Log file path |
| **FEATURES** |
| `ENABLE_ROUTE_PLANNING` | ✅ Configured | true | Route planning feature |
| `ENABLE_DATA_EXPORT` | ✅ Configured | true | Data export feature |
| `ENABLE_ANALYTICS` | ✅ Configured | true | Analytics feature |
| `MAP_MARKER_CLUSTERING` | ✅ Configured | true | Map clustering |
| **CACHE** |
| `CACHE_GEOCODING_RESULTS` | ✅ Configured | true | Geocoding cache |
| `CACHE_TTL_DAYS` | ✅ Configured | 90 | Cache lifetime |
| **FRONTEND OPTIONAL** |
| `LOCATION_NAME` | ⚠️ Missing | (default: Obion County, TN) | Display name |
| `MAP_CENTER_LAT` | ⚠️ Missing | (default: 36.2639) | Map center latitude |
| `MAP_CENTER_LNG` | ⚠️ Missing | (default: -89.1929) | Map center longitude |
| `MAP_DEFAULT_ZOOM` | ⚠️ Missing | (default: 11) | Initial zoom level |
| `MAP_MAX_AUTO_ZOOM` | ⚠️ Missing | (default: 16) | Max auto-zoom |
| `ORGANIZATION_NAME` | ⚠️ Missing | (default: Obion County...) | Org display name |
| `COPYRIGHT_YEAR` | ⚠️ Missing | (default: 2026) | Copyright year |
| `APP_VERSION` | ⚠️ Missing | (default: 4.0.0) | App version display |
| `MARKER_CLUSTER_THRESHOLD` | ⚠️ Missing | (default: 100) | Clustering threshold |
| `CLUSTER_RADIUS` | ⚠️ Missing | (default: 100) | Cluster radius pixels |
| `MARKER_COLOR_SUPER` | ⚠️ Missing | (default: #198754) | Super voter marker |
| `MARKER_COLOR_REGULAR` | ⚠️ Missing | (default: #6c757d) | Regular voter marker |
| `CACHE_TIMEOUT_MS` | ⚠️ Missing | (default: 300000) | Frontend cache timeout |
| `MAX_CACHE_SIZE` | ⚠️ Missing | (default: 50) | Frontend cache size |
| `DEFAULT_PAGE_SIZE` | ⚠️ Missing | (default: 1000) | Pagination size |
| `MAX_UPLOAD_SIZE_BYTES` | ⚠️ Missing | (default: 104857600) | Max upload size |
| `UPLOAD_POLL_MIN_MS` | ⚠️ Missing | (default: 1000) | Min polling interval |
| `UPLOAD_POLL_MAX_MS` | ⚠️ Missing | (default: 10000) | Max polling interval |
| `MAX_RETRY_ATTEMPTS` | ⚠️ Missing | (default: 3) | Network retry count |
| `CHART_COLORS` | ⚠️ Missing | (default: array) | Chart color palette |

**Notes:**
- ⚠️ Missing variables use default values defined in code (non-blocking)
- All CRITICAL variables are properly configured
- Google Maps API keys are production keys (AIzaSy... format)

### 4. Database Status

**Database Path:** `c:\Voter\data\voter_platform.db`  
**Status:** ✅ EXISTS

**Verification Test:**
```powershell
Test-Path "c:\Voter\data\voter_platform.db"
# Result: True
```

**Connection Test:**
```javascript
// From server startup output:
✅ Connected to SQLite database
📊 Database Stats: {
  totalVoters: 2677,
  geocodedVoters: 0,
  totalPrecincts: 2,
  superVoters: 0,
  cacheSize: 0,
  geocodingProgress: '0.0'
}
```

**Analysis:**
- Database file exists at expected location
- Connection successful
- Schema initialized (voters, precincts tables exist)
- Data populated (2,677 voters across 2 precincts)
- Geocoding not yet performed (0 geocoded voters)

### 5. Directory Structure Validation

**Expected Structure:**
```
c:\Voter\
├── .env ✅ EXISTS
├── .env.example ✅ EXISTS
├── .gitignore ✅ EXISTS
├── package.json ✅ EXISTS
├── backend/
│   ├── server.js ✅ EXISTS
│   ├── config/
│   │   └── database.js ✅ EXISTS
│   ├── routes/ ✅ EXISTS (5 route files)
│   ├── services/ ✅ EXISTS
│   ├── models/ ✅ EXISTS
│   └── parsers/ ✅ EXISTS
├── data/
│   ├── voter_platform.db ✅ EXISTS
│   ├── backups/ ✅ EXISTS (empty)
│   ├── cache/ ✅ EXISTS (empty)
│   ├── processed/ ✅ EXISTS (empty)
│   └── raw/ ✅ EXISTS (30+ CSV files)
├── frontend/
│   └── public/ ✅ EXISTS
├── logs/ ✅ EXISTS (empty - no errors logged)
└── node_modules/ ✅ EXISTS (dependencies installed)
```

**Status:** ✅ ALL REQUIRED DIRECTORIES AND FILES PRESENT

### 6. Logs Analysis

**Logs Directory:** `c:\Voter\logs`  
**Status:** Empty (no error logs)

**Analysis:**
- No application error logs generated
- Indicates the server never reached the logging phase
- Failure occurs during the `app.listen()` call before request handling begins
- This is consistent with a port binding error (crashes before logging initialized)

### 7. Dependency Status

**package.json Scripts:**
```json
"scripts": {
  "start": "node backend/server.js",
  "dev": "nodemon backend/server.js",
  "test": "jest"
}
```

**npm install Status:**
```
Terminal Output: Exit Code: 0 ✅
```

**Critical Dependencies:**
| Package | Version | Status |
|---------|---------|--------|
| express | ^4.18.2 | ✅ Installed |
| dotenv | ^16.3.1 | ✅ Installed |
| sqlite3 | ^5.1.6 | ✅ Installed |
| helmet | ^7.1.0 | ✅ Installed |
| cors | ^2.8.5 | ✅ Installed |
| @googlemaps/google-maps-services-js | ^3.4.2 | ✅ Installed |

**Status:** ✅ ALL DEPENDENCIES INSTALLED

### 8. API Route Files Validation

**Route Files:**
1. ✅ [backend/routes/voters.js](backend/routes/voters.js)
2. ✅ [backend/routes/precincts.js](backend/routes/precincts.js)
3. ✅ [backend/routes/geocode.js](backend/routes/geocode.js)
4. ✅ [backend/routes/analytics.js](backend/routes/analytics.js)
5. ✅ [backend/routes/upload.js](backend/routes/upload.js)

**Route Mounting (from server.js):**
```javascript
app.use('/api/voters', require('./routes/voters'));      // ✅ No errors
app.use('/api/precincts', require('./routes/precincts')); // ✅ No errors
app.use('/api/geocode', require('./routes/geocode'));     // ✅ No errors
app.use('/api/analytics', require('./routes/analytics')); // ✅ No errors
app.use('/api/upload', require('./routes/upload'));       // ✅ No errors
```

**Status:** ✅ ALL ROUTES LOAD WITHOUT ERRORS

**Evidence:** Server output shows database initialization completes successfully before the port binding error occurs, confirming all require() statements succeed.

### 9. Frontend File Validation

**Frontend Structure:**
```
frontend/public/
├── index.html ✅ EXISTS
├── css/
│   └── styles.css ✅ EXISTS
└── js/
    ├── app.js ✅ EXISTS
    ├── config.js ✅ EXISTS
    ├── map-controller.js ✅ EXISTS
    └── (other JS files) ✅ EXISTS
```

**Static File Serving (from server.js):**
```javascript
app.use(express.static(path.join(__dirname, '../frontend/public')));
```

**Status:** ✅ FRONTEND FILES PRESENT AND CONFIGURED

### 10. Google Maps API Configuration

**API Keys Found:**
- **GOOGLE_MAPS_API_KEY:** AIzaSyCNpNpEIHuzr56OKPq8QNTe8xwsm_IjVSM
- **GOOGLE_MAPS_GEOCODING_API_KEY:** AIzaSyCNpNpEIHuzr56OKPq8QNTe8xwsm_IjVSM

**Usage Locations:**
1. **Frontend:** [backend/server.js](backend/server.js#L123) - `/api/config` endpoint
2. **Geocoding Service:** [backend/services/geocoding-service.js](backend/services/geocoding-service.js#L21)

**Implementation:**
```javascript
// Server endpoint that provides API key to frontend
app.get('/api/config', (req, res) => {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    // ... other config
});
```

**Status:** ✅ API KEYS CONFIGURED (both keys use the same value)

**Security Note:**
- API key is exposed to frontend (expected for client-side Maps SDK)
- Consider API key restrictions in Google Cloud Console:
  - HTTP referrer restrictions (localhost, production domain)
  - API restrictions (Maps JavaScript API, Geocoding API only)

---

## Missing Files Analysis

### Files That DO NOT EXIST (But May Be Needed)

**None identified.** All required files for server startup are present.

### Files That DO EXIST (Inventory)

| File | Status | Purpose |
|------|--------|---------|
| `.env` | ✅ Exists | Production environment variables |
| `.env.example` | ✅ Exists | Template for environment setup |
| `.gitignore` | ✅ Exists | Git exclusion rules |
| `package.json` | ✅ Exists | Dependencies and scripts |
| `backend/server.js` | ✅ Exists | Main application entry point |
| `backend/config/database.js` | ✅ Exists | Database connection manager |
| `data/voter_platform.db` | ✅ Exists | SQLite database file |

**Conclusion:** No missing files blocking server startup.

---

## Recommended Fix Approach

### Immediate Fix (Resolve Port Conflict)

#### Option 1: Kill Existing Process (Recommended)
```powershell
# Stop the node process using port 3000
Stop-Process -Id 22472 -Force

# Wait for port to release
Start-Sleep -Seconds 2

# Start the server
npm start
```

#### Option 2: Kill All Node Processes
```powershell
# Stop all node processes (use with caution)
Get-Process -Name node | Stop-Process -Force

# Wait for port to release
Start-Sleep -Seconds 2

# Start the server
npm start
```

#### Option 3: Use Different Port
```powershell
# Modify .env file:
# Change: PORT=3000
# To:     PORT=3001

# Update CORS_ORIGIN accordingly:
# CORS_ORIGIN=http://localhost:3001

# Then run:
npm start
```

### Preventive Measures

#### 1. Add Port Cleanup Script

**File:** `package.json`
```json
"scripts": {
  "start": "node backend/server.js",
  "start:clean": "pwsh -Command \"Get-Process -Name node | Where-Object {$_.MainWindowTitle -match 'server.js'} | Stop-Process -Force; npm start\"",
  "dev": "nodemon backend/server.js",
  "test": "jest"
}
```

**Usage:**
```powershell
npm run start:clean
```

#### 2. Implement Graceful Port Handling

**Add to [backend/server.js](backend/server.js)** (after line 306, before `startServer()`):

```javascript
/**
 * Enhanced error handler for port conflicts
 */
const handleServerError = (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n❌ ERROR: Port ${PORT} is already in use`);
        console.error(`\nTo fix this issue, try one of the following:\n`);
        console.error(`1. Kill the process using port ${PORT}:`);
        console.error(`   Get-Process -Name node | Stop-Process -Force\n`);
        console.error(`2. Use a different port in your .env file:\n   PORT=3001\n`);
        console.error(`3. Find and stop the specific process:`);
        console.error(`   Get-NetTCPConnection -LocalPort ${PORT}\n`);
        process.exit(1);
    } else {
        console.error('❌ Server Error:', error);
        process.exit(1);
    }
};

// Update startServer function to handle errors
const startServer = async () => {
    await initializeDatabase();
    
    const server = app.listen(PORT, HOST, () => {
        console.log(`\n🚀 Server running at http://${HOST}:${PORT}`);
        console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🗺️  Google Maps API: ${process.env.GOOGLE_MAPS_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
        console.log('\n✅ Ready to accept requests\n');
    });
    
    // Add error handler for port conflicts
    server.on('error', handleServerError);
};
```

#### 3. Use Process Manager (Production)

**For production deployments, use PM2:**
```powershell
npm install -g pm2

# Start server with PM2
pm2 start backend/server.js --name voter-platform

# Auto-restart on crashes
pm2 startup

# Monitor status
pm2 status
```

### Step-by-Step Resolution Instructions

**Execute in this exact order:**

```powershell
# Step 1: Navigate to project directory
cd c:\Voter

# Step 2: Kill the process using port 3000
Stop-Process -Id 22472 -Force

# Step 3: Verify port is free
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue

# Step 4: Start the server
npm start

# Expected output:
# ✅ Connected to SQLite database
# 📊 Database Stats: { totalVoters: 2677, ... }
# 🚀 Server running at http://localhost:3000
# ✅ Ready to accept requests
```

**If Step 4 fails, try alternative:**
```powershell
# Alternative: Kill all node processes
Get-Process -Name node | Stop-Process -Force
Start-Sleep -Seconds 3
npm start
```

---

## Additional Observations

### ✅ Positive Indicators (Working Components)

1. **Database Connectivity:** Successfully connects and retrieves stats
2. **Environment Configuration:** All critical variables properly set
3. **Dependency Installation:** All npm packages installed without errors
4. **Code Quality:** No syntax errors, no require() failures
5. **Data Import:** 2,677 voter records successfully imported
6. **API Endpoints:** Previously worked (confirmed via `/api/config` success in terminal history)
7. **File Structure:** Complete directory structure with all expected files

### ⚠️ Areas for Future Enhancement

1. **Session Secret:** Currently using placeholder value (`voter-platform-secret-change-in-production`)
   - Update for production deployment
   - Use cryptographically secure random string

2. **Geocoding Queue:** 0 of 2,677 voters geocoded
   - No blocking issue, but feature not utilized yet
   - Consider running batch geocoding: `npm run geocode`

3. **Log Files:** Empty logs directory
   - Consider enabling file logging for troubleshooting
   - Current setup: `LOG_FILE=./logs/app.log` (configured but not actively writing)

4. **Data Backups:** Empty backups directory
   - Implement regular backup strategy
   - Directory exists: `data/backups/`

5. **Error Handling:** Add specific port conflict handling (see recommended fixes above)

6. **Documentation:** Add troubleshooting guide
   - Common port conflict resolution
   - Environment setup instructions
   - Deployment checklist

---

## Summary Table: Environment Variables

### TIER 1: REQUIRED FOR STARTUP (Must Be Set)

| Variable | Current Value | Status |
|----------|---------------|--------|
| `PORT` | 3000 | ✅ SET |
| `HOST` | localhost | ✅ SET |
| `DB_PATH` | ./data/voter_platform.db | ✅ SET |

### TIER 2: REQUIRED FOR FEATURES (Should Be Set)

| Variable | Current Value | Status |
|----------|---------------|--------|
| `GOOGLE_MAPS_API_KEY` | AIzaSy...IjVSM | ✅ SET |
| `GOOGLE_MAPS_GEOCODING_API_KEY` | AIzaSy...IjVSM | ✅ SET |
| `SESSION_SECRET` | voter-platform... | ⚠️ SET (placeholder) |
| `CORS_ORIGIN` | http://localhost:3000 | ✅ SET |

### TIER 3: OPTIONAL (Has Defaults)

All other variables use code-defined defaults if not specified.

---

## Conclusion

**PRIMARY ISSUE:** Port 3000 conflict with existing Node.js process (PID 22472)

**SEVERITY:** High (blocks all server startup attempts)

**COMPLEXITY:** Low (simple process termination required)

**CONFIGURATION STATUS:** Excellent (all required files and variables present)

**RECOMMENDED ACTION:** Execute immediate fix (kill process 22472) + implement preventive measures

**ESTIMATED TIME TO RESOLVE:** < 1 minute (for immediate fix)

**NEXT STEPS AFTER RESOLUTION:**
1. ✅ Verify server starts successfully
2. ✅ Test API endpoints: `/api/config`, `/api/health`
3. ✅ Access frontend: `http://localhost:3000`
4. ⚠️ Consider running batch geocoding: `npm run geocode`
5. ⚠️ Update SESSION_SECRET for production
6. ⚠️ Implement enhanced error handling (see recommendations)

---

**Report Generated:** February 7, 2026  
**Diagnostic Status:** ✅ COMPLETE  
**Action Required:** Execute recommended fix
