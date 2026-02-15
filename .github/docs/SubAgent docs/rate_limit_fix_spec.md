# Rate Limit Fix Specification
## 429 (Too Many Requests) Error - Upload Status Polling

**Created:** February 7, 2026  
**Status:** Research Complete - Ready for Implementation  
**Priority:** HIGH - Blocking user experience for uploads

---

## Executive Summary

The upload status polling mechanism is hitting rate limiting errors (429) after approximately 11 requests (5-6 seconds), preventing users from monitoring upload progress. The root cause is conflicting rate limiter configurations where status polling endpoints are subject to both general API limits (100/15min) and stricter upload limits (10/hour).

**Recommended Solution:** Exempt upload status check endpoints from rate limiting using the `skip` function in express-rate-limit.

---

## Root Cause Analysis

### Problem Statement
**Error:** `GET http://localhost:3000/api/upload/239 429 (Too Many Requests)`  
**Location:** [frontend/public/js/upload-service.js:98](frontend/public/js/upload-service.js#L98) in `pollUploadStatus()` method  
**Impact:** Upload progress cannot be monitored, appearing to users as if the upload has stalled

### Rate Limiting Configuration Analysis

#### Current Backend Configuration ([backend/server.js](backend/server.js#L54-L73))

```javascript
// General API Rate Limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                   // 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', apiLimiter);  // Applied to ALL /api/* routes

// Upload-Specific Rate Limiter (STRICTER)
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,   // 1 hour
    max: 10,                     // 10 requests per window
    message: 'Too many file uploads, please try again later.',
});
app.use('/api/upload', uploadLimiter);  // Applied to ALL /api/upload/* routes
```

**Critical Issue:** The endpoint `/api/upload/:id` (status check) is subject to BOTH rate limiters:
1. First evaluated by `apiLimiter`: 100 requests per 15 minutes = 6.67 req/min
2. Then evaluated by `uploadLimiter`: 10 requests per 1 hour = **0.167 req/min** (1 request every 6 minutes)

### Current Polling Behavior Analysis

#### Implementation ([frontend/public/js/upload-service.js:138-199](frontend/public/js/upload-service.js#L138-L199))

```javascript
async pollUploadStatus(uploadId, onProgress = null, interval = 500) {
    const MIN_INTERVAL = 500;   // 500ms minimum
    const MAX_INTERVAL = 5000;  // 5 second maximum
    
    // Adaptive polling with exponential backoff:
    // - Starts at 500ms
    // - When progress changes: resets to 500ms
    // - When no progress: multiplies by 1.5x (up to 5000ms max)
}
```

#### Request Rate Calculations

**Scenario 1: Continuous Progress (worst case)**
- Polling interval: 500ms consistently
- Requests per second: 2
- Requests per minute: **120**
- Requests in 5 seconds: **10 requests** → **Hits 10-request limit immediately**
- Requests in 15 minutes: **1,800** (far exceeds 100-request limit)

**Scenario 2: Stalled Progress (best case with backoff)**
- Starts at 500ms, backs off to 5000ms (5 seconds)
- At maximum interval: 12 requests per minute
- Still **72x higher** than allowed 0.167 req/min

**Time to 429 Error:** 
- With 10-request limit per hour
- At 500ms interval: 500ms × 10 = 5 seconds
- **11th request triggers 429 error**

### Evidence Trail

1. **Initial interval is too aggressive for current limits:**
   - 500ms = 120 req/min
   - Limit allows 0.167 req/min
   - **720x higher than allowed rate**

2. **Maximum backoff still exceeds limits:**
   - 5000ms = 12 req/min
   - Still **72x higher than allowed rate**

3. **Upload limiter was designed for POST /upload, not GET /upload/:id:**
   - Intent: Prevent repeated file upload abuse
   - Unintended consequence: Blocks legitimate status polling

---

## Research Findings

### Source 1: express-rate-limit Documentation
**URL:** https://context7.com/express-rate-limit/express-rate-limit  
**Key Findings:**
- Provides `skip` function to exempt specific requests from rate limiting
- Can evaluate request path, IP, user role, or any request property
- **Best Practice:** Use skip for health checks, status endpoints, and read-only operations

**Code Example:**
```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  skip: (req, res) => {
    // Skip for health check endpoints
    if (req.path === '/health') {
      return true
    }
    return false
  },
})
```

### Source 2: MDN - Server-Sent Events (SSE)
**URL:** https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events  
**Key Findings:**
- Alternative to polling for real-time updates
- Server pushes updates to client over persistent HTTP connection
- Ideal for one-way server-to-client communications (like upload progress)
- **Limitation:** Maximum 6 concurrent SSE connections per browser+domain (without HTTP/2)

**Trade-offs:**
- ✅ Eliminates polling overhead
- ✅ Real-time updates without rate limiting concerns
- ❌ Requires significant backend refactoring
- ❌ Connection limits may affect multi-tab usage
- ❌ Less suitable for short-lived uploads

### Source 3: WebSocket API
**URL:** https://web.dev/articles/websockets-basics  
**Key Findings:**
- Full-duplex bidirectional communication
- Persistent connection with minimal overhead
- Ideal for real-time, low-latency applications

**Trade-offs:**
- ✅ True real-time updates
- ✅ No rate limiting concerns
- ✅ Bi-directional (can handle multiple use cases)
- ❌ Significant infrastructure changes required
- ❌ More complex to implement and maintain
- ❌ Overkill for simple status polling

### Source 4: HTTP Long Polling Best Practices
**Industry Standard Polling Intervals:**
- **Aggressive:** 1-2 seconds (for critical real-time needs)
- **Normal:** 3-5 seconds (balanced approach)
- **Conservative:** 10-30 seconds (low-priority updates)
- **Very Conservative:** 60+ seconds (infrequent updates)

**Adaptive Polling Best Practices:**
- Start with reasonable interval (2-3 seconds, not 500ms)
- Use exponential backoff (1.5x - 2x multiplier)
- Cap maximum interval at 30-60 seconds
- Reset to minimum on progress changes

### Source 5: Rate Limiting Best Practices for Background Operations
**Key Principles:**
1. **Separate limits by operation type:**
   - Write operations (POST, PUT, DELETE): Strict limits
   - Read operations (GET): More lenient or exempt
   - Status checks: Should rarely be limited

2. **Status endpoints should be exempt or have generous limits:**
   - Users need to monitor their operations
   - Read-only with no side effects
   - Minimal server load

3. **Use appropriate HTTP status codes:**
   - 429: Too Many Requests (user action needed)
   - Provide `Retry-After` header when possible

### Source 6: Upload Progress Monitoring Patterns
**Common Approaches:**
1. **Polling (current approach):**
   - Simple to implement
   - Works everywhere
   - Can be inefficient

2. **Server-Sent Events:**
   - Better for long-running operations
   - Server-driven updates
   - Connection limit concerns

3. **WebSockets:**
   - Best for complex real-time needs
   - Higher implementation cost
   - Bidirectional when needed

**Recommendation:** For simple upload monitoring with occasional use, polling with proper rate limiting exemption is most appropriate.

---

## Proposed Solutions

### Solution 1: Exempt Status Endpoints from Rate Limiting (RECOMMENDED)

**Approach:** Use `skip` function to exempt GET `/api/upload/:id` from upload rate limiter

**Implementation:**
```javascript
// backend/server.js

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many file uploads, please try again later.',
    skip: (req, res) => {
        // Skip rate limiting for status checks (GET requests)
        // Only apply to actual uploads (POST requests)
        return req.method === 'GET';
    }
});

app.use('/api/upload', uploadLimiter);
```

**Pros:**
- ✅ Minimal code changes (5 lines)
- ✅ Surgical fix targeting exact issue
- ✅ Maintains rate limiting for actual uploads
- ✅ No frontend changes needed
- ✅ Works with existing adaptive polling
- ✅ Zero user-facing changes
- ✅ Can be deployed immediately

**Cons:**
- ⚠️ Still allows aggressive polling (but harmless read operations)
- ⚠️ Status checks still subject to general API limiter (100/15min - acceptable)

**User Experience Impact:** None - transparent fix

**Performance Impact:** Minimal - GET requests are lightweight

**Security Considerations:** 
- Status endpoints are read-only
- Require valid upload ID (auto-incrementing integer)
- No sensitive data exposure risk
- Still protected by general API rate limiter

---

### Solution 2: Increase Initial Polling Interval

**Approach:** Change initial polling from 500ms to 2000ms (2 seconds)

**Implementation:**
```javascript
// frontend/public/js/upload-service.js

async pollUploadStatus(uploadId, onProgress = null, interval = 2000) {  // Was 500
    const MIN_INTERVAL = 2000;   // Was 500ms
    const MAX_INTERVAL = 30000;  // Was 5000ms (increase to 30s)
    // ... rest of code
}
```

**Pros:**
- ✅ Simple frontend-only fix
- ✅ Reduces server load
- ✅ More respectful of rate limits

**Cons:**
- ❌ Slower progress updates (2s vs 500ms)
- ❌ Degraded user experience
- ❌ Still hits rate limit with stalled imports (2s interval = 30 req/min, limit is 0.167 req/min)
- ❌ Would need 360-second (6 minute) interval to avoid hitting limits
- ❌ 6-minute intervals are unacceptable for UX

**User Experience Impact:** Significant - noticeable delay in progress updates

---

### Solution 3: Create Separate Status Endpoint with Different Limits

**Approach:** Create `/api/status/upload/:id` with generous rate limits

**Implementation:**
```javascript
// backend/server.js

const statusLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,  // Much higher limit for status checks
    message: 'Too many status requests',
});

app.use('/api/status', statusLimiter);

// backend/routes/status.js (new file)
router.get('/upload/:id', async (req, res) => {
    // Same logic as upload.js GET /:id
});
```

**Pros:**
- ✅ Clear separation of concerns
- ✅ Explicit rate limit control for status
- ✅ Maintains strict upload limits

**Cons:**
- ❌ Requires creating new route file
- ❌ Duplicates existing logic
- ❌ Frontend changes required
- ❌ More code to maintain
- ❌ Unnecessary complexity

**User Experience Impact:** None if implemented correctly

---

### Solution 4: Implement Server-Sent Events (SSE)

**Approach:** Replace polling with server-pushed events

**Implementation:**
```javascript
// backend/routes/upload.js
router.get('/:id/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Stream progress updates
    const interval = setInterval(async () => {
        const status = await getUploadStatus(req.params.id);
        res.write(`data: ${JSON.stringify(status)}\n\n`);
        
        if (status.status === 'completed' || status.status === 'failed') {
            clearInterval(interval);
            res.end();
        }
    }, 1000);
});

// frontend/public/js/upload-service.js
async streamUploadStatus(uploadId, onProgress) {
    const eventSource = new EventSource(`/api/upload/${uploadId}/stream`);
    
    eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        onProgress(data);
        
        if (data.status === 'completed' || data.status === 'failed') {
            eventSource.close();
        }
    };
}
```

**Pros:**
- ✅ True real-time updates
- ✅ No rate limiting concerns
- ✅ More efficient than polling
- ✅ Better user experience

**Cons:**
- ❌ Significant backend changes
- ❌ Frontend changes required
- ❌ Connection limit issues (6 per browser+domain)
- ❌ More complex error handling
- ❌ Overkill for occasional uploads
- ❌ Increased server resource usage (persistent connections)

**User Experience Impact:** Positive - faster updates, but implementation risk

**Performance Impact:** Higher memory usage for persistent connections

---

### Solution 5: Hybrid Approach - Exempt + Adjust Polling

**Approach:** Combine Solution 1 + gentler polling intervals

**Implementation:**
```javascript
// backend/server.js - Exempt GET requests
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    skip: (req) => req.method === 'GET'
});

// frontend/public/js/upload-service.js - More conservative intervals
async pollUploadStatus(uploadId, onProgress = null, interval = 1000) {
    const MIN_INTERVAL = 1000;   // 1 second instead of 500ms
    const MAX_INTERVAL = 10000;  // 10 seconds instead of 5s
    // Exponential backoff: 1.5x multiplier (unchanged)
}
```

**Pros:**
- ✅ Best of both worlds
- ✅ Reduces server load while fixing error
- ✅ Still responsive (1s updates)
- ✅ Smoother user experience than current

**Cons:**
- ⚠️ Requires both backend and frontend changes
- ⚠️ Slightly slower than current 500ms (but still good)

**User Experience Impact:** Minimal - 1s updates still feel real-time

---

## Comparison Matrix

| Solution | Complexity | UX Impact | Server Load | Security | Time to Deploy | Recommended |
|----------|-----------|-----------|-------------|----------|----------------|-------------|
| **1. Exempt GET** | Low | None | Low | Good | < 1 hour | ⭐ **YES** |
| **2. Slower Polling** | Very Low | High (negative) | Low | Good | < 30 min | ❌ No |
| **3. Separate Endpoint** | Medium | None | Low | Good | 2-4 hours | ⚠️ Acceptable |
| **4. SSE** | High | High (positive) | Medium | Good | 1-2 days | 🔮 Future |
| **5. Hybrid** | Low-Medium | Minor (positive) | Lower | Good | 1-2 hours | ⭐ **YES** |

---

## Recommended Approach

### Primary Recommendation: **Solution 5 - Hybrid Approach**

**Rationale:**
1. **Immediate Fix:** Exempt GET requests from upload rate limiter
2. **Long-term Optimization:** Adjust polling to be more server-friendly
3. **Best UX:** 1-second updates are still perceived as real-time
4. **Server Efficiency:** Reduces load from 120 req/min to 60 req/min (during progress)
5. **Security:** Maintains all protective limits while allowing legitimate monitoring

### Fallback: **Solution 1 - Exempt GET Only**

If frontend changes are not desired immediately, Solution 1 alone resolves the 429 error completely.

---

## Implementation Steps

### Phase 1: Backend Fix (CRITICAL - Deploy ASAP)

1. **Modify rate limiter in [backend/server.js](backend/server.js#L65-L73)**
   ```javascript
   const uploadLimiter = rateLimit({
       windowMs: 60 * 60 * 1000,
       max: 10,
       message: 'Too many file uploads, please try again later.',
       skip: (req, res) => {
           // Exempt GET requests (status checks) from upload rate limiting
           // Only limit actual file uploads (POST)
           return req.method === 'GET';
       }
   });
   ```

2. **Add comment explaining the exemption**
   - Document why GET requests are skipped
   - Note that status checks are still protected by general API limiter

3. **Test the fix:**
   ```bash
   # Start server
   npm start
   
   # Upload a file and verify polling works
   # Monitor for 429 errors in browser console
   # Verify uploads still rate-limited (POST /api/upload/dbf or /csv)
   ```

### Phase 2: Frontend Optimization (RECOMMENDED - Deploy Soon)

1. **Update polling intervals in [frontend/public/js/upload-service.js](frontend/public/js/upload-service.js#L148-L198)**
   ```javascript
   async pollUploadStatus(uploadId, onProgress = null, interval = 1000) {
       return new Promise((resolve, reject) => {
           let currentInterval = interval;
           let pollTimeout = null;
           let lastProgress = 0;
           const MIN_INTERVAL = 1000;   // 1 second (was 500ms)
           const MAX_INTERVAL = 10000;  // 10 seconds (was 5000ms)
           
           // ... rest unchanged
       });
   }
   ```

2. **Update JSDoc comment to reflect new intervals**

3. **Test user experience:**
   - Upload small file - verify 1s updates feel responsive
   - Upload large file - verify backoff works correctly
   - Test with stalled/failed import - verify max interval reached

### Phase 3: Monitoring & Validation

1. **Add logging to track polling behavior:**
   ```javascript
   // backend/routes/upload.js GET /:id endpoint
   console.log(`Status check for upload ${req.params.id} from ${req.ip}`);
   ```

2. **Monitor for abuse patterns:**
   - Check logs for excessive status checks from single IP
   - Verify general API limiter is catching problems

3. **Consider future enhancements:**
   - WebSocket for real-time updates (Phase 4+)
   - SSE for server-driven progress (Phase 4+)

---

## Testing Strategy

### Unit Tests
```javascript
// tests/unit/server.test.js
describe('Upload Rate Limiter', () => {
    test('should allow GET /api/upload/:id requests', async () => {
        for (let i = 0; i < 20; i++) {
            const res = await request(app).get('/api/upload/1');
            expect(res.status).not.toBe(429);
        }
    });
    
    test('should limit POST /api/upload/dbf requests', async () => {
        const promises = [];
        for (let i = 0; i < 15; i++) {
            promises.push(request(app).post('/api/upload/dbf'));
        }
        const results = await Promise.all(promises);
        const rateLimited = results.some(r => r.status === 429);
        expect(rateLimited).toBe(true);
    });
});
```

### Integration Tests
```javascript
// tests/integration/upload-polling.test.js
describe('Upload Status Polling', () => {
    test('should poll status without rate limit errors', async () => {
        // Simulate rapid polling
        const uploadId = 1;
        for (let i = 0; i < 50; i++) {
            const status = await uploadService.getUploadStatus(uploadId);
            expect(status).toBeDefined();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    });
    
    test('should handle adaptive polling intervals', async () => {
        const intervals = [];
        const mockProgress = jest.fn((data) => {
            intervals.push(Date.now());
        });
        
        await uploadService.pollUploadStatus(1, mockProgress, 1000);
        
        // Verify exponential backoff
        expect(intervals.length).toBeGreaterThan(1);
        // Verify intervals increase when no progress
    });
});
```

### Manual Testing Checklist
- [ ] Upload small file, verify 1s polling updates
- [ ] Upload large file, verify progress updates smoothly
- [ ] Simulate stalled import, verify backoff to 10s
- [ ] Open multiple tabs, upload in each, verify no 429 errors
- [ ] Try rapid uploads (should still be rate-limited)
- [ ] Check network tab for reasonable request frequency
- [ ] Verify console shows no errors
- [ ] Test on slow network connection

---

## Rollback Plan

### If Phase 1 Causes Issues:
```javascript
// Revert backend/server.js to original
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Too many file uploads, please try again later.',
    // Remove skip function
});
```

**Risk:** Very low - only making GET requests exempt (read-only, low risk)

### If Phase 2 Causes UX Issues:
```javascript
// Revert frontend/public/js/upload-service.js to original intervals
async pollUploadStatus(uploadId, onProgress = null, interval = 500) {
    const MIN_INTERVAL = 500;
    const MAX_INTERVAL = 5000;
    // ...
}
```

**Risk:** None - Phase 1 fix prevents 429 errors regardless

---

## Security Considerations

### Rate Limiting Exemption
- **Risk:** Status endpoints could be abused for DoS
- **Mitigation:** Still protected by general API limiter (100/15min)
- **Analysis:** 100 requests per 15 minutes = 6.67 req/min is reasonable for legitimate polling

### Information Disclosure
- **Risk:** Upload IDs are auto-incrementing integers
- **Concern:** Attackers could enumerate upload IDs
- **Current State:** Upload status includes filename, status, progress (no sensitive data)
- **Recommendation:** Consider UUIDs for upload IDs in future (separate issue)

### Amplification Attacks
- **Risk:** Many clients polling same endpoint
- **Mitigation:** Rate limit is per-IP (handled by express-rate-limit)
- **Additional:** Consider adding per-upload-ID throttling if needed

---

## Performance Analysis

### Current State (500ms polling, rate limited)
- Requests per minute: 120 (if progress continuous)
- Fails after: ~11 requests (5 seconds)
- User experience: Broken

### After Solution 1 (500ms polling, not rate limited)
- Requests per minute: 120 (if progress continuous)
- Server load per upload: Minimal (lightweight GET)
- User experience: Excellent (fast updates)
- Concern: Potentially aggressive polling

### After Solution 5 (1000ms polling, not rate limited)
- Requests per minute: 60 during progress, down to 6 after backoff
- Server load per upload: Very reasonable
- User experience: Excellent (perceived real-time)
- **Recommended state**

---

## Future Enhancements

### Phase 4: Consider Server-Sent Events (SSE)
**When:** If upload frequency increases significantly or user requests real-time updates

**Benefits:**
- True server-push architecture
- Zero polling overhead
- Better for long-running imports

**Prerequisites:**
- Monitor upload frequency over 30 days
- Analyze average upload duration
- Assess server resource availability

### Phase 5: Consider WebSockets
**When:** If bidirectional features are needed (e.g., cancel upload, pause/resume)

**Benefits:**
- Full bi-directional communication
- Can support multiple real-time features
- Modern, scalable architecture

**Prerequisites:**
- Business case for bidirectional features
- Infrastructure support for persistent connections
- Development resources for significant refactor

---

## Metrics to Monitor

### Success Metrics (Post-Deployment)
- **Primary:** Zero 429 errors on `/api/upload/:id` endpoints
- **Secondary:** Average polling frequency per upload
- **Tertiary:** Upload completion rates (should improve)

### Performance Metrics
- **Request rate:** `/api/upload/:id` requests per minute
- **Server load:** CPU/memory during active uploads
- **Response times:** GET `/api/upload/:id` P50, P95, P99

### User Experience Metrics
- **Progress update latency:** Time between actual progress and UI update
- **Perceived responsiveness:** User feedback on upload monitoring
- **Error rates:** Any new error types introduced

### Monitoring Commands
```bash
# Count 429 errors in logs
grep "429" logs/server.log | wc -l

# Track status check frequency
grep "GET /api/upload/" logs/server.log | wc -l

# Monitor response times
grep "GET /api/upload/" logs/server.log | awk '{print $NF}'
```

---

## Documentation Updates Needed

1. **[README.md](README.md)** - Note rate limiting configuration
2. **API Documentation** - Document status endpoint rate limit exemption
3. **[backend/server.js](backend/server.js)** - Inline comments explaining skip logic
4. **[frontend/public/js/upload-service.js](frontend/public/js/upload-service.js)** - JSDoc for polling intervals

---

## Conclusion

The 429 error is caused by overly restrictive rate limiting on status check endpoints, which were unintentionally caught by the upload rate limiter designed for POST operations. The hybrid solution (exempt GET + adjust polling intervals) provides:

1. **Immediate fix** for the 429 error
2. **Better UX** with 1-second responsive updates
3. **Server efficiency** through exponential backoff
4. **Security** maintained via general API limits
5. **Simplicity** with minimal code changes

**Estimated Implementation Time:** 1-2 hours  
**Risk Level:** Low  
**User Impact:** High (positive - fixes blocking issue)  

**Next Steps:** Proceed with Phase 1 implementation immediately.

---

## References

1. **express-rate-limit Documentation**
   - https://context7.com/express-rate-limit/express-rate-limit
   - Skip function patterns for exempting endpoints

2. **MDN: Server-Sent Events**
   - https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
   - Alternative to polling for real-time updates

3. **Web.dev: WebSockets Basics**
   - https://web.dev/articles/websockets-basics
   - Full-duplex communication for future consideration

4. **HTTP Status Code 429**
   - RFC 6585: Additional HTTP Status Codes
   - Best practices for rate limiting

5. **Polling Best Practices**
   - Industry standards for status polling intervals
   - Exponential backoff strategies

6. **Node.js Performance**
   - Handling high-frequency requests
   - Memory management for persistent connections

---

**End of Specification**
