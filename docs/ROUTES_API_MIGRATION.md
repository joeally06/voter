# Routes API Migration Guide

## Overview

This document provides step-by-step instructions for migrating from Google's legacy Distance Matrix API to the new Routes API (Compute Route Matrix).

**Status:** ✅ Implementation Complete  
**Implementation Date:** March 10, 2026  
**Feature Flag:** `USE_ROUTES_API` (default: false for safe rollback)

---

## What Changed?

### Routes API Benefits
- ✅ Modern API design with better performance
- ✅ Enhanced features (traffic-aware routing, toll calculations)
- ✅ Better error handling with per-element status codes
- ✅ Field masking for optimized response sizes and reduced costs
- ✅ Future-proof - active development and new features
- ✅ Higher rate limits (3,000 EPM vs legacy limits)

### Key Implementation Details
- **Backend Service:** `backend/services/distance-matrix-service.js` updated
- **API Configuration:** `backend/config/api-keys.js` updated
- **Feature Flag:** `USE_ROUTES_API` environment variable controls migration
- **Backward Compatibility:** Legacy Distance Matrix API code preserved for rollback
- **Cache Compatible:** Existing route cache works unchanged
- **Rate Limiting:** Adjusted for Routes API higher limits (50 EPS default)

---

## Quick Start

### 1. Enable Routes API in Google Cloud

1. Visit [Google Cloud Console - Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com)
2. Click **"Enable"**
3. Wait for API to activate (usually instant)

### 2. Configure API Key

**Option A: Use existing key (simplest)**
```bash
# Your existing GOOGLE_MAPS_API_KEY will work
# Routes API uses same key restrictions as other Google Maps APIs
```

**Option B: Create dedicated Routes API key (recommended for production)**
1. Visit [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **"Create Credentials"** > **"API Key"**
3. Click **"Restrict Key"** for the new key:
   - Name: "Routes API - Production"
   - API restrictions: Select "Routes API"
   - Application restrictions: Add server IP (optional but recommended)
4. Copy the key

### 3. Update Environment Variables

Add to your `.env` file:

```bash
# Enable Routes API
USE_ROUTES_API=true

# Optional: Use dedicated Routes API key
GOOGLE_MAPS_ROUTES_API_KEY=your_routes_api_key_here

# Optional: Adjust rate limit for Routes API (default: 50 EPS)
DISTANCE_MATRIX_RATE_LIMIT=50
```

### 4. Restart Server

```bash
npm start
```

**Expected log output:**
```
🚀 Using Google Routes API (Compute Route Matrix)
```

---

## Step-by-Step Migration Plan

### Phase 1: Testing (Day 1)

**Goal:** Verify Routes API works without breaking existing functionality

1. **Keep legacy API active initially:**
   ```bash
   USE_ROUTES_API=false
   ```

2. **Verify current functionality:**
   - Test route calculations: `/api/routes/calculate`
   - Check distance matrix generation
   - Verify caching works
   - Note current API quota usage

3. **Enable Routes API in test environment:**
   ```bash
   USE_ROUTES_API=true
   ```

4. **Test all route features:**
   - Single distance request
   - Batch distance requests (1-to-N)
   - Full distance matrix (N×N)
   - Progressive routing (sparse matrix)
   - Route optimization
   - Different travel modes (driving, walking, bicycling)

5. **Monitor for issues:**
   - Check logs for errors
   - Verify distances match legacy API (±5% acceptable due to routing differences)
   - Confirm cache is being populated
   - Check API quota usage in [Google Cloud Console](https://console.cloud.google.com/apis/dashboard)

### Phase 2: Gradual Rollout (Days 2-7)

**Goal:** Deploy to production with monitoring

1. **Deploy to staging:**
   ```bash
   # Staging .env
   USE_ROUTES_API=true
   ROUTES_API_ROUTING_PREFERENCE=TRAFFIC_UNAWARE  # Cost-effective tier
   ```

2. **Run full test suite:**
   - Integration tests
   - End-to-end route calculations
   - Performance benchmarks
   - Load testing (if available)

3. **Deploy to production (non-peak hours):**
   ```bash
   # Production .env
   USE_ROUTES_API=true
   DISTANCE_MATRIX_RATE_LIMIT=50
   ```

4. **Monitor closely for 24-48 hours:**
   - Error rates (target: <1%)
   - Response times (should be similar to legacy)
   - API costs (check billing alerts)
   - Cache hit rate (should remain >80%)
   - User reports

### Phase 3: Optimization (Week 2)

**Goal:** Fine-tune configuration for best performance and cost

1. **Review performance metrics:**
   - Average response time
   - API call volume
   - Cache effectiveness
   - Cost per thousand routes

2. **Consider traffic-aware routing (optional):**
   ```bash
   # Enable more accurate routing with traffic data
   # Note: Increases cost from Essentials to Pro tier
   ROUTES_API_ROUTING_PREFERENCE=TRAFFIC_AWARE
   ```

3. **Optimize field mask (if needed):**
   ```bash
   # Minimal fields (default - most cost-effective)
   ROUTES_API_FIELD_MASK=originIndex,destinationIndex,duration,distanceMeters,status,condition
   
   # Add traffic data (requires TRAFFIC_AWARE routing preference)
   # ROUTES_API_FIELD_MASK=originIndex,destinationIndex,duration,distanceMeters,status,condition,travelAdvisory
   ```

4. **Adjust rate limits based on usage:**
   ```bash
   # Conservative (lower API costs)
   DISTANCE_MATRIX_RATE_LIMIT=25
   
   # Aggressive (faster route calculations)
   DISTANCE_MATRIX_RATE_LIMIT=100
   ```

### Phase 4: Cleanup (Week 3+)

**Goal:** Remove legacy code after successful migration

**⚠️ Wait at least 2 weeks with zero issues before cleanup**

1. **Verify migration success:**
   - [ ] Zero errors related to Routes API
   - [ ] Performance meets or exceeds legacy API
   - [ ] Costs are acceptable
   - [ ] Team is comfortable with new API

2. **Remove legacy code (optional):**
   - Remove `makeLegacyDistanceMatrixRequest()` method
   - Remove `USE_ROUTES_API` feature flag checks
   - Remove legacy environment variables
   - Update documentation

3. **Consider removing old dependency:**
   ```bash
   # If Distance Matrix was the only use of @googlemaps/google-maps-services-js
   npm uninstall @googlemaps/google-maps-services-js
   ```

---

## Rollback Procedure

### Emergency Rollback (< 5 minutes)

If critical issues occur:

1. **Edit .env file:**
   ```bash
   USE_ROUTES_API=false
   ```

2. **Restart server:**
   ```bash
   npm start
   # Or: pm2 restart voter-backend
   ```

3. **Verify rollback:**
   - Check logs show: "Using legacy Distance Matrix API"
   - Test route calculation
   - Monitor error rates return to normal

### When to Rollback

Rollback immediately if:
- ❌ Error rate > 5% for Routes API calls
- ❌ Route calculations consistently failing
- ❌ Response time > 2x legacy performance
- ❌ API quota exhausted unexpectedly
- ❌ API costs significantly higher than expected (>50%)
- ❌ Critical user-facing issues

### After Rollback

1. **Review logs:**
   ```bash
   # Check for Routes API errors
   grep "Routes API" logs/*.log
   ```

2. **Identify root cause:**
   - API authentication issues?
   - Rate limiting problems?
   - Field mask errors?
   - Response transformation bugs?

3. **Fix and retry:**
   - Address identified issues
   - Test in staging environment
   - Re-deploy when fixed

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_ROUTES_API` | `false` | Enable Routes API (`true`) or use legacy API (`false`) |
| `GOOGLE_MAPS_ROUTES_API_KEY` | Falls back to `GOOGLE_MAPS_API_KEY` | Routes API key |
| `ROUTES_API_ENDPOINT` | `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix` | API endpoint |
| `ROUTES_API_TIMEOUT_MS` | `10000` | Request timeout (ms) |
| `ROUTES_API_ROUTING_PREFERENCE` | `TRAFFIC_UNAWARE` | Routing mode: `TRAFFIC_UNAWARE` or `TRAFFIC_AWARE` |
| `ROUTES_API_FIELD_MASK` | `originIndex,destinationIndex,duration,distanceMeters,status,condition` | Response fields (cost optimization) |
| `DISTANCE_MATRIX_RATE_LIMIT` | `50` (Routes API) / `10` (legacy) | Queries per second |
| `DISTANCE_MATRIX_DELAY_MS` | `100` | Minimum delay between requests (ms) |

### Routing Preferences

| Preference | Cost Tier | Use Case |
|------------|-----------|----------|
| `TRAFFIC_UNAWARE` | Essentials ($5/1K elements) | Default, static routing without traffic |
| `TRAFFIC_AWARE` | Pro ($10/1K elements) | Real-time traffic data for optimal routes |

### Rate Limits

**Routes API Limits:**
- **Elements per minute:** 3,000 EPM
- **Recommended rate:** 50 EPS (queries per second)
- **Max origins × destinations:** 625 elements per request (non-transit)

**Conservative Settings:**
```bash
DISTANCE_MATRIX_RATE_LIMIT=25
DISTANCE_MATRIX_DELAY_MS=200
```

**Aggressive Settings:**
```bash
DISTANCE_MATRIX_RATE_LIMIT=100
DISTANCE_MATRIX_DELAY_MS=50
```

---

## Monitoring & Debugging

### Check API Usage

**Google Cloud Console:**
1. Visit [APIs Dashboard](https://console.cloud.google.com/apis/dashboard)
2. Select "Routes API"
3. View metrics:
   - Requests (last 30 days)
   - Errors (track error rate)
   - Latency (average response time)

### Application Logs

**Routes API Request:**
```
Routes API request: 5 origins × 10 destinations (50 elements)
```

**Successful Response:**
```
🚀 Using Google Routes API (Compute Route Matrix)
```

**Rollback Active:**
```
⚠️  Using legacy Distance Matrix API (consider migrating to Routes API)
```

### Common Errors

**403 Forbidden:**
```
Routes API authentication failed - check API key and restrictions
```
**Fix:** Verify API key has Routes API enabled

**429 Rate Limit:**
```
Routes API rate limit exceeded (3,000 elements per minute)
```
**Fix:** Reduce `DISTANCE_MATRIX_RATE_LIMIT` or upgrade quota

**400 Bad Request:**
```
Routes API bad request: Invalid field mask
```
**Fix:** Check `ROUTES_API_FIELD_MASK` syntax (comma-separated, no spaces)

---

## Cost Comparison

### Pricing Tiers

| Tier | Cost per 1,000 elements | Features |
|------|------------------------|----------|
| **Essentials** | $5 | Basic routing, same as legacy Distance Matrix |
| **Pro** | $10 | Traffic-aware routing, advanced features |
| **Enterprise** | $15 | Two-wheel routing, toll data |

### Example Calculations

**Scenario: 100 routes/day, 10 locations each = 1,000 elements/day**

| API | Monthly Cost | Notes |
|-----|--------------|-------|
| Legacy Distance Matrix | $150 | Standard tier |
| Routes API (Essentials) | $150 | Same cost, better features |
| Routes API (Pro) | $300 | With traffic-aware routing |

**With 94% cache hit rate (progressive routing):**
- Actual API calls: 60 elements/day (not cached)
- Monthly cost: ~$9 (Essentials) or ~$18 (Pro)

**Recommendation:** Start with Essentials tier (`TRAFFIC_UNAWARE`) to maintain cost parity with legacy API.

---

## Troubleshooting Guide

### Issue: Routes API returns empty response

**Symptoms:** All distances are 0, route calculations fail

**Diagnosis:**
```bash
# Check field mask
echo $ROUTES_API_FIELD_MASK
# Should be: originIndex,destinationIndex,duration,distanceMeters,status,condition
```

**Fix:** Verify field mask includes required fields

---

### Issue: Distances don't match legacy API

**Symptoms:** Routes are different (±10-20%)

**Explanation:** Routes API uses more advanced routing algorithms and may suggest different paths.

**Fix:** This is expected behavior. Routes API provides more accurate routes. If discrepancy is >20%, investigate further.

---

### Issue: Cache hit rate dropped

**Symptoms:** API usage increased after migration

**Diagnosis:**
```bash
# Check cache stats in route calculation response
# Look for: cacheHitRate field
```

**Fix:** Cache format is unchanged. Increased API usage likely due to new routes. Monitor for 1 week to stabilize.

---

### Issue: High API costs

**Symptoms:** Billing alerts triggered, costs >50% higher

**Diagnosis:**
1. Check routing preference: `echo $ROUTES_API_ROUTING_PREFERENCE`
2. Verify field mask optimization
3. Review API call volume in Cloud Console

**Fix:**
- Use `TRAFFIC_UNAWARE` (Essentials tier)
- Ensure progressive routing enabled: `PROGRESSIVE_ROUTING_ENABLED=true`
- Reduce rate limit to slow down requests: `DISTANCE_MATRIX_RATE_LIMIT=25`

---

## Support & Resources

### Documentation
- [Routes API Overview](https://developers.google.com/maps/documentation/routes)
- [Compute Route Matrix Reference](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [Routes API Pricing](https://developers.google.com/maps/documentation/routes/usage-and-billing)

### Internal Documentation
- Implementation Spec: `.github/docs/SubAgent docs/routes_api_migration_spec.md`
- Environment Template: `.env.routes-api.template`
- Service Code: `backend/services/distance-matrix-service.js`

### Getting Help
- Google Maps Platform Discord: https://discord.gg/f4hvx8Rp2q
- Stack Overflow: [google-routes-api](https://stackoverflow.com/questions/tagged/google-routes-api)
- Google Issue Tracker: https://issuetracker.google.com/issues/new?component=1244012

---

## Success Metrics

### Week 1 Post-Migration

- [ ] Error rate < 1%
- [ ] Response time within 20% of legacy
- [ ] Cache hit rate > 80%
- [ ] API costs within expected range
- [ ] Zero user complaints

### Month 1 Post-Migration

- [ ] Stable performance
- [ ] Cost-neutral or cost-saving
- [ ] No major incidents
- [ ] Team comfortable with Routes API
- [ ] Documentation complete

---

## Next Steps

After successful migration:

1. **Monitor continuously** for 2-4 weeks
2. **Consider traffic-aware routing** if needed for better accuracy
3. **Optimize rate limits** based on actual usage patterns
4. **Remove legacy code** after confidence period (optional)
5. **Update team documentation** and runbooks

---

**Migration Completed:** Once stable for 2+ weeks with zero issues  
**Rollback Available:** Legacy code preserved for emergency rollback  
**Support:** See [Support & Resources](#support--resources) section above
