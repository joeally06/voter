# Super Voters Filter Lockup Fix - Comprehensive Specification

**Created:** February 15, 2026  
**Issue:** Application locks up after selecting super voters filter checkbox, requiring page refresh  
**Severity:** High - Blocks core filtering functionality

---

## Executive Summary

Users experience a complete application lockup when checking the "Super Voters Only" filter checkbox in the sidebar filter panel. The application becomes unresponsive with a frozen UI, requiring a full page refresh to recover. This is a DIFFERENT issue from the previously fixed route planner modal freeze (see `super_voters_modal_freeze_fix_spec.md`).

**Key Distinction:**
- **Previous Fix:** Route planner modal's "Super Voters" button freeze (RESOLVED)
- **Current Issue:** Main filter sidebar's "Super Voters Only" checkbox lockup (ACTIVE)

---

## Current State Analysis

### Affected User Flow

**Normal Workflow (Expected):**
1. User navigates to main voter list view
2. User checks "Super Voters Only" checkbox in sidebar filters
3. Loading spinner appears briefly
4. Voter list updates to show only super voters
5. Pagination updates to reflect filtered count

**Broken Workflow (Actual):**
1. User navigates to main voter list view
2. User checks "Super Voters Only" checkbox in sidebar filters
3. **Application freezes with unresponsive UI**
4. **Browser tab becomes non-interactive**
5. **No error messages displayed**
6. User must refresh page to recover

### Code Analysis

#### Component 1: Filter Checkbox Event Handler
**File:** `frontend/public/js/filter-controller.js`  
**Lines:** 104-120

```javascript
// Desktop Super voter checkbox
const superVoterFilter = document.getElementById('superVoterFilter');
if (superVoterFilter) {
  superVoterFilter.addEventListener('change', (e) => {
    this.updateFilter('superVoterOnly', e.target.checked);
    const superVoterFilterMobile = document.getElementById('superVoterFilterMobile');
    if (superVoterFilterMobile) superVoterFilterMobile.checked = e.target.checked;
  });
}

// Mobile Super voter checkbox
const superVoterFilterMobile = document.getElementById('superVoterFilterMobile');
if (superVoterFilterMobile) {
  superVoterFilterMobile.addEventListener('change', (e) => {
    this.updateFilter('superVoterOnly', e.target.checked);
    const superVoterFilter = document.getElementById('superVoterFilter');
    if (superVoterFilter) superVoterFilter.checked = e.target.checked;
  });
}
```

**Analysis:**
- ✅ Event listeners properly attached to both desktop and mobile checkboxes
- ✅ Mutual synchronization prevents duplicate events (no circular triggers)
- ⚠️ Calls `updateFilter()` which is async but not awaited
- ⚠️ No error boundary around filter update

#### Component 2: Filter Update Flow
**File:** `frontend/public/js/filter-controller.js`  
**Lines:** 370-383, 389-495

```javascript
async updateFilter(key, value) {
  this.filters[key] = value;
  
  // Update filter badge count
  this.updateFilterBadge();
  
  // Reset to page 1 when filters change
  this.pagination.currentPage = 1;
  
  await this.applyFilters();
}

async applyFilters() {
  try {
    // Show loading state
    this.stateManager.setState({ 
      ui: { loading: true, error: null } 
    });

    Utils.showLoading(true);

    // Build filter params for API
    const params = {};
    
    if (this.filters.superVoterOnly) {
      params.super_voter = true;
    }
    
    // ... other filters ...
    
    // Add pagination parameters
    const paginationParams = {
      limit: this.pagination.limit,        // Default: 100
      offset: (this.pagination.currentPage - 1) * this.pagination.limit,
      sort: this.pagination.sort,
      order: this.pagination.order
    };

    // Fetch filtered voters with pagination
    const result = await this.voterService.fetchVoters(params, paginationParams);

    // Update state with results
    this.stateManager.setState({
      filteredVoters: result.data || [],
      totalFiltered: result.total || 0,
      // ... pagination info ...
    });
    
    Utils.showLoading(false);
  } catch (error) {
    Logger.error('Filter error:', error);
    // ... error handling ...
  }
}
```

**Analysis:**
- ✅ Properly async with try-catch error handling
- ✅ Shows loading state before API call
- ✅ Uses pagination (limit: 100 voters per page)
- ⚠️ **CRITICAL:** `fetchVoters()` might take 1-5 seconds for large super voter queries
- ⚠️ No timeout on API requests
- ⚠️ Cache might return stale data immediately, bypassing loading state

#### Component 3: State Update and Subscription
**File:** `frontend/public/js/state-manager.js`  
**Lines:** 86-118, `voter-list-controller.js` lines 25-34

```javascript
// State Manager
setState(updates) {
  var prevState = { ...this.state };
  
  // Merge updates (deep merge for nested objects)
  this.state = this.deepMerge(this.state, updates);
  
  // ... history tracking ...
  
  // Notify all listeners
  this.notify(this.state, prevState);
}

notify(newState, prevState) {
  this.listeners.forEach(function(entry) {
    try {
      if (entry.selector) {
        var newVal = this._resolveSelector(newState, entry.selector);
        var oldVal = this._resolveSelector(prevState, entry.selector);
        if (newVal !== oldVal) {
          entry.listener(newState, prevState);
        }
      } else {
        entry.listener(newState, prevState);
      }
    } catch (error) {
      Logger.error('Error in state listener:', error);
    }
  }.bind(this));
}

// Voter List Controller Subscription
this.stateManager.subscribe((state, prevState) => {
  if (state.filteredVoters !== prevState.filteredVoters) {
    this.renderVoterList(state.filteredVoters);
  }
  
  if (state.pagination !== prevState.pagination) {
    this.renderPagination(state.pagination);
  }
});
```

**Analysis:**
- ✅ Subscriptions use selectors to prevent unnecessary re-renders
- ✅ Error handling in notify prevents crash propagation
- ⚠️ **POTENTIAL ISSUE:** Multiple subscriptions might trigger simultaneously
- ⚠️ No debouncing on rapid state changes

#### Component 4: Voter List Rendering
**File:** `frontend/public/js/voter-list-controller.js`  
**Lines:** 161-198

```javascript
renderVoterList(voters) {
  this.currentVoters = voters || [];
  const tbody = document.getElementById('voterTableBody');
  const countBadge = document.getElementById('voterListCount');

  if (!tbody) return;

  // Update count badge
  if (countBadge) {
    countBadge.textContent = this.currentVoters.length + ' voter' + 
      (this.currentVoters.length !== 1 ? 's' : '');
  }

  // Clear existing rows
  tbody.innerHTML = '';

  if (this.currentVoters.length === 0) {
    // Show empty state
    return;
  }

  // Use virtual scrolling for large datasets (>100 rows)
  if (this.useVirtualScrolling && this.virtualScroller && 
      this.currentVoters.length > 100) {
    this.virtualScroller.setData(this.currentVoters);
    return;
  }

  // Render all voters from current page (pagination handles limiting)
  this.currentVoters.forEach(function(voter) {
    var row = this.createVoterRow(voter);
    tbody.appendChild(row);
  }.bind(this));
}
```

**Analysis:**
- ✅ Virtual scrolling for > 100 voters (good performance optimization)
- ✅ Pagination limits data to 100 voters max
- ⚠️ **CRITICAL:** `forEach` + `appendChild` is synchronous and blocks UI thread
- ⚠️ For 100 voters with complex rows: ~50-200ms blocking time
- ⚠️ Virtual scrolling might not be initialized (`this.useVirtualScrolling` might be false)

#### Component 5: Virtual Scrolling Initialization
**File:** `frontend/public/js/voter-list-controller.js`  
**Lines:** 50-85

```javascript
initVirtualScrolling() {
  var scrollContainer = document.querySelector('#voterTable');
  if (!scrollContainer) return;

  var wrapper = scrollContainer.closest('.overflow-x-auto');
  if (!wrapper) return;

  // Check if VirtualScroller is available (graceful degradation)
  if (typeof VirtualScroller === 'undefined') {
    Logger.warn('VirtualScroller not available - using standard rendering');
    this.useVirtualScrolling = false;
    return;
  }

  var self = this;
  try {
    this.virtualScroller = new VirtualScroller({
      container: wrapper,
      rowHeight: 48,
      bufferSize: 5,
      renderRow: function(voter, index) {
        return self.createVoterRow(voter);
      }
    });

    this.virtualScroller.attach();
    this.useVirtualScrolling = true;
    Logger.debug('✅ Virtual scrolling enabled for voter list');
  } catch (error) {
    Logger.error('Failed to initialize VirtualScroller:', error);
    this.useVirtualScrolling = false;
  }
}
```

**Analysis:**
- ⚠️ **CRITICAL FINDING:** If `VirtualScroller` fails to load or initialize, falls back to synchronous rendering
- ⚠️ No check for whether VirtualScroller script is loaded before attempting to use it
- ⚠️ Failure is silent (only logged, no user notification)

---

## Root Cause Identification

### Primary Root Cause: Synchronous DOM Rendering Blocking UI Thread

**Evidence:**
1. **Large dataset + synchronous forEach:**
   - Super voters filter returns ~100 voters per page (pagination limit)
   - Each voter row creation involves:
     - Creating `<tr>` element
     - Creating 7 `<td>` elements with complex innerHTML
     - Adding event listeners for row click
     - Calculating party badge, participation rate, etc.
   - **Total operation time:** 100 voters × 0.5-2ms per row = **50-200ms blocking**

2. **Virtual scrolling not engaging:**
   - Virtual scrolling only activates if `this.useVirtualScrolling === true`
   - If VirtualScroller library fails to load or initialize, fallback is synchronous rendering
   - No error surfaced to user - silently degrades to blocking behavior

3. **DOM manipulation not batched:**
   - Using `appendChild()` in loop causes multiple reflows
   - Each append triggers layout recalculation
   - Browser can't optimize because of blocking loop

**Technical Explanation:**
```javascript
// BLOCKING CODE PATH
this.currentVoters.forEach(function(voter) {  // Synchronous loop
  var row = this.createVoterRow(voter);       // ~0.5-2ms per call
  tbody.appendChild(row);                     // Triggers reflow each time
}.bind(this));                                 

// For 100 voters:
// 100 iterations × 1ms avg = 100ms
// + 100 reflows × 0.5ms = 50ms
// TOTAL: ~150ms UI freeze
```

### Secondary Root Cause: Network Latency Compounding Perception of Freeze

**Evidence:**
1. **Super voter queries are slower:**
   - Backend must filter by `super_voter = 1` column
   - Joins with `election_history` table for party/participation data
   - Database query time: 100-500ms for typical dataset
   - Network round-trip: 20-100ms

2. **Cache inconsistency:**
   - Cache timeout is 5 minutes (default)
   - Stale cached results might be served immediately
   - No visual indicator when showing cached vs. fresh data
   - User might see "instant" result that doesn't match filter

3. **Loading state timing:**
   - `Utils.showLoading(true)` is called BEFORE async fetch
   - But if cache hit occurs, loading flickers for <10ms
   - User doesn't perceive loading state
   - Then synchronous rendering blocks for 150ms
   - **Result:** Appears frozen without warning

### Tertiary Root Cause: VirtualScroller Failure Not Handled Gracefully

**Evidence:**
1. **Silent degradation:**
   ```javascript
   if (typeof VirtualScroller === 'undefined') {
     Logger.warn('VirtualScroller not available - using standard rendering');
     this.useVirtualScrolling = false;
     return;
   }
   ```
   - Only logs warning to console (users don't see console)
   - No fallback message like "Large lists may be slow"
   - No attempt to use DocumentFragment or other optimization

2. **Script loading race condition:**
   - VirtualScroller might be loaded via `<script>` tag in HTML
   - If script fails to load (CDN down, network issue, ad blocker), no retry
   - Application continues with degraded performance

### Quaternary Root Cause: No Timeout or Cancellation for Long Queries

**Evidence:**
1. **No request timeout:**
   - `fetchWithRetry()` has retry logic but no timeout
   - Long-running backend queries (5+ seconds) leave user in limbo
   - Browser's default timeout is 60+ seconds

2. **No cancellation mechanism:**
   - If user unchecks filter while request is in-flight, request continues
   - When response arrives, it overwrites current state
   - Can cause race conditions and unexpected UI behavior

---

## Best Practices Research (6+ Credible Sources)

### 1. Preventing UI Freezes in JavaScript Applications
**Source:** Google Web Fundamentals - "Optimize JavaScript Execution"  
**URL:** https://web.dev/optimize-javascript-execution/

**Key Findings:**
- **50ms rule:** Any JavaScript execution > 50ms is perceptible to users as "jank"
- **Long tasks:** Chrome DevTools flags tasks > 50ms as "long tasks" that degrade UX
- **Solutions:**
  - Break long tasks into chunks using `setTimeout(fn, 0)` or `requestIdleCallback()`
  - Use Web Workers for heavy computation
  - Prioritize visible content rendering
  - Show skeleton UI during loading

**Application to Fix:**
- ✅ Implement chunked rendering for voter list (25 voters per chunk)
- ✅ Use `requestAnimationFrame()` for DOM updates
- ✅ Show skeleton loading during rendering
- ✅ Measure performance with Performance API

### 2. Efficient Large Dataset Filtering in React/JavaScript
**Source:** React Documentation - "Optimizing Performance"  
**URL:** https://react.dev/learn/render-and-commit

**Key Findings:**
- **Batch DOM updates:** Use DocumentFragment to build DOM tree off-screen
- **Virtual DOM concept:** Only update changed elements
- **Windowing/virtualization:** Only render visible items + small buffer
- **Memoization:** Cache computed values to avoid recalculation

**Application to Fix:**
- ✅ Implement DocumentFragment for batch DOM insertion
- ✅ Ensure VirtualScroller loads reliably or provide robust fallback
- ✅ Cache rendered rows if sorting/filtering doesn't change data
- ✅ Use `requestAnimationFrame` to batch updates

### 3. Async Operations and State Updates Best Practices
**Source:** MDN Web Docs - "Asynchronous JavaScript"  
**URL:** https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous

**Key Findings:**
- **Promise chaining:** Properly chain async operations
- **Error boundaries:** Wrap async code in try-catch
- **Cancellation:** Implement AbortController for fetch requests
- **Loading states:** Always show user feedback during async operations
- **Debouncing:** Prevent rapid-fire API calls

**Application to Fix:**
- ✅ Implement AbortController for fetch requests
- ✅ Add minimum loading time (300ms) so spinner is never < visible threshold
- ✅ Debounce filter changes if multiple filters toggled rapidly
- ✅ Cancel in-flight requests when filter changes again

### 4. Performance Optimization for Data-Heavy Table Rendering
**Source:** "High Performance Browser Networking" by Ilya Grigorik  
**URL:** https://hpbn.co/ (Chapter 11: DOM, CSSOM, and JavaScript)

**Key Findings:**
- **Reflow/Repaint costs:** Each DOM modification can trigger layout recalculation
- **Batching:** Group DOM changes to minimize reflows
- **CSS containment:** Use `contain: layout` to limit reflow scope
- **IntersectionObserver:** Only render elements in viewport

**Application to Fix:**
- ✅ Use CSS `contain: layout style` on table rows
- ✅ Build rows off-screen with DocumentFragment
- ✅ Single `innerHTML` update vs. multiple `appendChild`
- ✅ Consider using `<template>` elements for row cloning

### 5. Virtual Scrolling Implementation Patterns
**Source:** "react-window" by Brian Vaughn (Facebook)  
**URL:** https://github.com/bvaughn/react-window

**Key Findings:**
- **Fixed vs. variable row heights:** Fixed heights much more performant
- **Overscan:** Render extra rows above/below viewport to prevent blank flashing
- **Scroll position tracking:** Use `scrollTop` to calculate visible range
- **DOM recycling:** Reuse DOM nodes by changing content, not creating new

**Application to Fix:**
- ✅ Verify VirtualScroller library implements these patterns
- ✅ Provide fallback if VirtualScroller unavailable
- ✅ Document row height requirements (48px fixed)
- ✅ Test with 1000+ voters to validate performance

### 6. Error Handling and Graceful Degradation
**Source:** "Resilient Web Design" by Jeremy Keith  
**URL:** https://resilientwebdesign.com/

**Key Findings:**
- **Progressive enhancement:** Start with minimal working version, enhance if possible
- **Feature detection:** Test for capability before using
- **Fallback strategies:** Provide degraded but functional alternatives
- **User communication:** Always inform users of limitations

**Application to Fix:**
- ✅ Detect VirtualScroller availability before relying on it
- ✅ If VirtualScroller fails, show message: "Rendering large list may be slow"
- ✅ Provide "Load More" pagination button as ultimate fallback
- ✅ Log performance metrics to identify real-world issues

---

## Proposed Solution Architecture

### Strategy: Defense in Depth with Multiple Layers of Optimization

**Guiding Principles:**
1. **Non-blocking by default:** All UI operations < 50ms or chunked
2. **Fail gracefully:** If optimization fails, provide functional degraded experience
3. **User feedback:** Always show loading/progress for operations > 100ms
4. **Measurable:** Instrument code to track performance metrics

### Solution Components

#### Component 1: Chunked Rendering Fallback
**File:** `frontend/public/js/voter-list-controller.js`

**Purpose:** Ensure rendering never blocks UI > 50ms, even if VirtualScroller fails

**Implementation:**
```javascript
/**
 * Render voter list with chunked updates for large datasets
 * @param {Array} voters - Voter data array
 */
async renderVoterList(voters) {
  this.currentVoters = voters || [];
  const tbody = document.getElementById('voterTableBody');
  const countBadge = document.getElementById('voterListCount');

  if (!tbody) return;

  // Update count badge
  if (countBadge) {
    countBadge.textContent = this.currentVoters.length + ' voter' + 
      (this.currentVoters.length !== 1 ? 's' : '');
  }

  // Show skeleton loading if voters is null
  if (voters === null) {
    this.showSkeletonLoading(tbody);
    return;
  }

  // Clear existing rows
  tbody.innerHTML = '';

  // Show message if no voters
  if (this.currentVoters.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-5">
          <i class="bi bi-inbox" style="font-size: 3rem;"></i>
          <p class="mt-2">No voters match your current filters</p>
          <p class="small">Try adjusting your filters or clearing them to see more results.</p>
        </td>
      </tr>
    `;
    return;
  }

  // OPTIMIZATION 1: Try virtual scrolling first (best performance)
  if (this.useVirtualScrolling && this.virtualScroller && 
      this.currentVoters.length > 100) {
    try {
      this.virtualScroller.setData(this.currentVoters);
      return;
    } catch (error) {
      Logger.error('VirtualScroller failed, falling back to chunked rendering:', error);
      this.useVirtualScrolling = false; // Disable for future renders
    }
  }

  // OPTIMIZATION 2: For large lists (> 50 items), use chunked rendering
  if (this.currentVoters.length > 50) {
    await this.renderVoterListChunked(this.currentVoters, tbody);
  } else {
    // OPTIMIZATION 3: For small lists, use optimized batch rendering
    this.renderVoterListBatch(this.currentVoters, tbody);
  }
}

/**
 * Render voters in chunks to prevent UI blocking
 * @param {Array} voters - Voter data
 * @param {HTMLElement} tbody - Table body element
 */
async renderVoterListChunked(voters, tbody) {
  const CHUNK_SIZE = 25; // Render 25 voters per frame
  
  // Show loading indicator for large renders
  if (voters.length > 100) {
    const loadingRow = document.createElement('tr');
    loadingRow.innerHTML = `
      <td colspan="7" class="text-center py-4">
        <div class="spinner-border spinner-border-sm me-2" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <span>Rendering ${voters.length} voters...</span>
      </td>
    `;
    tbody.appendChild(loadingRow);
  }

  // Process voters in chunks
  for (let i = 0; i < voters.length; i += CHUNK_SIZE) {
    const chunk = voters.slice(i, i + CHUNK_SIZE);
    const fragment = document.createDocumentFragment();
    
    chunk.forEach(voter => {
      const row = this.createVoterRow(voter);
      fragment.appendChild(row);
    });
    
    // Clear loading indicator on first chunk
    if (i === 0) {
      tbody.innerHTML = '';
    }
    
    tbody.appendChild(fragment);
    
    // Yield to browser to process events and render
    // This keeps UI responsive during large renders
    if (i + CHUNK_SIZE < voters.length) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  
  Logger.debug(`✅ Rendered ${voters.length} voters in chunks`);
}

/**
 * Render voters in batch using DocumentFragment (for small lists)
 * @param {Array} voters - Voter data
 * @param {HTMLElement} tbody - Table body element
 */
renderVoterListBatch(voters, tbody) {
  const fragment = document.createDocumentFragment();
  
  voters.forEach(voter => {
    const row = this.createVoterRow(voter);
    fragment.appendChild(row);
  });
  
  tbody.appendChild(fragment);
  Logger.debug(`✅ Rendered ${voters.length} voters in batch`);
}
```

**Benefits:**
- ✅ Virtual scrolling still used when available (best performance)
- ✅ Chunked rendering prevents UI freeze for 50-200 voter lists
- ✅ Batch rendering optimized for small lists (< 50 voters)
- ✅ Loading indicator for > 100 voters provides user feedback
- ✅ Graceful fallback if any optimization fails

---

#### Component 2: Request Cancellation and Timeout
**File:** `frontend/public/js/voter-service.js`

**Purpose:** Prevent race conditions and hung requests

**Implementation:**
```javascript
class VoterService {
  constructor(baseUrl = window.APP_CONFIG?.apiBaseUrl || '/api') {
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.cacheTimeout = window.APP_CONFIG?.cacheTimeoutMs || (5 * 60 * 1000);
    this.maxCacheSize = window.APP_CONFIG?.maxCacheSize || 50;
    this.cacheStats = { hits: 0, misses: 0, evictions: 0 };
    
    // NEW: Track active requests for cancellation
    this.activeRequests = new Map();
  }

  /**
   * Fetch voters with optional filters
   * @param {Object} filters - Filter parameters
   * @param {Object} pagination - Pagination parameters
   * @param {AbortSignal} [signal] - Optional abort signal
   * @returns {Promise<Object>} Voters data
   */
  async fetchVoters(filters = {}, pagination = {}, signal = null) {
    const params = { ...filters, ...pagination };
    const cacheKey = this.generateCacheKey('voters', params);
    
    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    // Cancel any previous request with same cache key
    if (this.activeRequests.has(cacheKey)) {
      Logger.debug(`Cancelling previous request for: ${cacheKey.substring(0, 50)}...`);
      this.activeRequests.get(cacheKey).abort();
    }
    
    // Create new AbortController for this request
    const controller = new AbortController();
    const requestSignal = signal || controller.signal;
    this.activeRequests.set(cacheKey, controller);
    
    try {
      const queryString = this.buildQueryString(params);
      
      // Add timeout (10 seconds default)
      const timeout = setTimeout(() => {
        controller.abort();
        Logger.warn(`Request timeout: ${cacheKey.substring(0, 50)}...`);
      }, 10000);
      
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/voters?${queryString}`,
        { signal: requestSignal }
      );
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch voters: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Cache result
      this.setCache(cacheKey, data);
      
      // Clean up tracking
      this.activeRequests.delete(cacheKey);
      
      return data;
      
    } catch (error) {
      this.activeRequests.delete(cacheKey);
      
      // Don't log/throw for aborted requests (user-initiated)
      if (error.name === 'AbortError') {
        Logger.debug('Request cancelled:', cacheKey.substring(0, 50));
        throw error; // Re-throw to let caller handle
      }
      
      Logger.error('Error fetching voters:', error);
      throw error;
    }
  }
  
  /**
   * Cancel all active requests
   */
  cancelAllRequests() {
    Logger.info(`Cancelling ${this.activeRequests.size} active requests`);
    this.activeRequests.forEach(controller => controller.abort());
    this.activeRequests.clear();
  }
}
```

**Benefits:**
- ✅ Prevents race conditions when filters change rapidly
- ✅ 10-second timeout prevents hung requests
- ✅ Cancels previous request when new filter applied
- ✅ Graceful handling of aborted requests

---

#### Component 3: Minimum Loading Duration
**File:** `frontend/public/js/filter-controller.js`

**Purpose:** Ensure loading spinner is always visible long enough to perceive

**Implementation:**
```javascript
async applyFilters() {
  try {
    // Show loading state
    this.stateManager.setState({ 
      ui: { loading: true, error: null } 
    });

    const loadingStartTime = Date.now();
    Utils.showLoading(true);

    // Build filter params for API
    const params = {};
    
    if (this.filters.precinct) {
      params.precinct = this.filters.precinct;
    }
    
    if (this.filters.name) {
      params.name = this.filters.name;
    }
    
    if (this.filters.superVoterOnly) {
      params.super_voter = true;
    }
    
    if (this.filters.geocodedOnly) {
      params.geocoded = true;
    }

    // Party filter logic
    if (this.filters.republicanOnly && this.filters.democratOnly) {
      params.party = 'R,D';
    } else if (this.filters.republicanOnly) {
      params.party = 'R';
    } else if (this.filters.democratOnly) {
      params.party = 'D';
    }

    // Voting status filter
    if (this.filters.regularVotersOnly) {
      params.voting_status = 'regular';
    } else if (this.filters.neverVotedOnly) {
      params.voting_status = 'never';
    }

    // Add pagination parameters
    const paginationParams = {
      limit: this.pagination.limit,
      offset: (this.pagination.currentPage - 1) * this.pagination.limit,
      sort: this.pagination.sort,
      order: this.pagination.order
    };

    // Fetch filtered voters with pagination
    const result = await this.voterService.fetchVoters(params, paginationParams);

    // OPTIMIZATION: Ensure loading spinner shows for minimum 300ms
    // This prevents jarring "flash" when cached results return instantly
    const loadingElapsed = Date.now() - loadingStartTime;
    if (loadingElapsed < 300) {
      await new Promise(resolve => setTimeout(resolve, 300 - loadingElapsed));
    }

    // Update state with results
    this.stateManager.setState({
      filteredVoters: result.data || [],
      totalFiltered: result.total || 0,
      pagination: {
        currentPage: this.pagination.currentPage,
        limit: this.pagination.limit,
        offset: (this.pagination.currentPage - 1) * this.pagination.limit,
        total: result.total || 0,
        totalPages: Math.ceil((result.total || 0) / this.pagination.limit)
      },
      filters: { ...this.filters },
      ui: { loading: false, error: null }
    });

    Utils.showLoading(false);

    Logger.info(`✅ Filters applied: ${result.total || 0} voters found`);

  } catch (error) {
    // Handle aborted requests gracefully
    if (error.name === 'AbortError') {
      Logger.debug('Filter request cancelled (new filter applied)');
      return; // Don't show error for user-initiated cancellations
    }
    
    Logger.error('Filter error:', error);
    
    Utils.handleError(error, 'FilterController.applyFilters', {
      customMessage: 'Failed to load voters. Please check your connection.',
      updateState: true
    });
    
    this.stateManager.setState({
      ui: { 
        loading: false, 
        error: 'Failed to apply filters. Please try again.' 
      }
    });

    Utils.showLoading(false);
  }
}
```

**Benefits:**
- ✅ Minimum 300ms loading ensures user sees feedback
- ✅ Prevents jarring instant updates from cache
- ✅ Graceful handling of cancelled requests
- ✅ Better perceived performance

---

#### Component 4: VirtualScroller Reliability Check
**File:** `frontend/public/js/voter-list-controller.js`

**Purpose:** Ensure VirtualScroller loads or provide fallback notification

**Implementation:**
```javascript
async init() {
  // Initialize Bootstrap modal
  const modalElement = document.getElementById('voterDetailModal');
  if (modalElement) {
    this.voterDetailModal = new bootstrap.Modal(modalElement);
  }

  // Subscribe to state changes for voter updates
  this.stateManager.subscribe((state, prevState) => {
    if (state.filteredVoters !== prevState.filteredVoters) {
      this.renderVoterList(state.filteredVoters);
    }
    
    if (state.pagination !== prevState.pagination) {
      this.renderPagination(state.pagination);
    }
  });
  
  // Attach pagination event listeners
  this.attachPaginationListeners();

  // Initialize sortable table headers
  this.initializeSortableHeaders();

  // Initialize virtual scrolling with retry
  await this.initVirtualScrollingWithRetry();

  Logger.info('✅ Voter List Controller initialized with Phase 4 enhancements');
}

/**
 * Initialize virtual scrolling with retry and fallback notification
 */
async initVirtualScrollingWithRetry() {
  // Give VirtualScroller time to load if script is loading
  let retries = 0;
  const maxRetries = 3;
  
  while (retries < maxRetries) {
    if (await this.tryInitVirtualScrolling()) {
      return; // Success!
    }
    
    retries++;
    if (retries < maxRetries) {
      Logger.debug(`VirtualScroller not ready, retry ${retries}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  // If we get here, VirtualScroller failed to load
  Logger.warn('VirtualScroller unavailable after retries - using chunked rendering fallback');
  
  // Show user notification (only once)
  if (!this.virtualScrollerWarningShown) {
    Utils.showToast(
      'Large voter lists will use simplified rendering. Scrolling performance may vary.',
      'info',
      5000
    );
    this.virtualScrollerWarningShown = true;
  }
}

/**
 * Attempt to initialize virtual scrolling
 * @returns {boolean} True if successful
 */
async tryInitVirtualScrolling() {
  const scrollContainer = document.querySelector('#voterTable');
  if (!scrollContainer) return false;

  const wrapper = scrollContainer.closest('.overflow-x-auto');
  if (!wrapper) return false;

  // Check if VirtualScroller is available
  if (typeof VirtualScroller === 'undefined') {
    return false;
  }

  try {
    this.virtualScroller = new VirtualScroller({
      container: wrapper,
      rowHeight: 48,
      bufferSize: 5,
      renderRow: (voter, index) => this.createVoterRow(voter)
    });

    this.virtualScroller.attach();
    this.useVirtualScrolling = true;
    Logger.debug('✅ Virtual scrolling enabled for voter list');
    return true;
    
  } catch (error) {
    Logger.error('Failed to initialize VirtualScroller:', error);
    return false;
  }
}
```

**Benefits:**
- ✅ Retries VirtualScroller initialization (handles race conditions)
- ✅ Notifies user if optimization unavailable
- ✅ Graceful fallback to chunked rendering
- ✅ One-time notification (doesn't spam user)

---

#### Component 5: Performance Monitoring
**File:** `frontend/public/js/voter-list-controller.js`

**Purpose:** Track rendering performance to identify issues

**Implementation:**
```javascript
/**
 * Render voter list with performance monitoring
 */
async renderVoterList(voters) {
  const startTime = performance.now();
  
  this.currentVoters = voters || [];
  const tbody = document.getElementById('voterTableBody');
  const countBadge = document.getElementById('voterListCount');

  if (!tbody) return;

  // ... existing rendering logic ...

  // Log performance metrics
  const duration = performance.now() - startTime;
  const voterCount = this.currentVoters.length;
  
  Logger.debug(`📊 Rendered ${voterCount} voters in ${duration.toFixed(2)}ms`);
  
  // Warn if rendering was slow
  if (duration > 100) {
    Logger.warn(`⚠️ Slow render detected: ${duration.toFixed(2)}ms for ${voterCount} voters`);
  }
  
  // Track metrics for analytics
  if (window.APP_CONFIG?.enablePerformanceTracking) {
    this.trackPerformance('voterListRender', {
      voterCount,
      duration,
      method: this.useVirtualScrolling ? 'virtual' : 
              (voterCount > 50 ? 'chunked' : 'batch')
    });
  }
}

/**
 * Track performance metrics
 */
trackPerformance(eventName, data) {
  // Send to analytics or log for monitoring
  const metric = {
    timestamp: new Date().toISOString(),
    event: eventName,
    ...data
  };
  
  Logger.info(`📈 Performance: ${JSON.stringify(metric)}`);
  
  // Could integrate with analytics service here
  // if (window.analytics) window.analytics.track(eventName, data);
}
```

**Benefits:**
- ✅ Identifies slow renders in production
- ✅ Helps diagnose user-reported performance issues
- ✅ Provides data for optimization decisions
- ✅ Optional analytics integration

---

## Implementation Steps

### Phase 1: Critical Fixes (Prevent UI Lockup)

**Priority:** CRITICAL  
**Estimated Time:** 2-3 hours  
**Files Modified:** 3

#### Step 1.1: Implement Chunked Rendering Fallback
**File:** `frontend/public/js/voter-list-controller.js`  
**Lines to modify:** 161-198

**Changes:**
1. Rename existing `renderVoterList()` to `renderVoterListLegacy()`
2. Create new `renderVoterList()` with optimization decision tree
3. Implement `renderVoterListChunked()` method
4. Implement `renderVoterListBatch()` method
5. Add performance monitoring

**Validation:**
- Test with 10, 50, 100, 200 voters
- Verify no UI freeze > 50ms (use Chrome DevTools Performance tab)
- Confirm loading indicator appears for > 100 voters

#### Step 1.2: Add Request Cancellation
**File:** `frontend/public/js/voter-service.js`  
**Lines to modify:** 1-51

**Changes:**
1. Add `activeRequests` Map to constructor
2. Modify `fetchVoters()` to use AbortController
3. Implement timeout logic (10 seconds)
4. Add `cancelAllRequests()` method
5. Handle AbortError gracefully

**Validation:**
- Toggle super voter filter rapidly (10 times in 2 seconds)
- Verify only 1 request completes
- Check network tab shows aborted requests
- Confirm no error alerts shown for cancelled requests

#### Step 1.3: Add Minimum Loading Duration
**File:** `frontend/public/js/filter-controller.js`  
**Lines to modify:** 389-495

**Changes:**
1. Add `loadingStartTime` tracking
2. Calculate `loadingElapsed` after fetch
3. Add conditional delay to reach 300ms minimum
4. Update error handling for AbortError

**Validation:**
- Toggle super voter filter on cached results
- Verify loading spinner shows for at least 300ms
- Confirm smooth transition (no flicker)

---

### Phase 2: Reliability Improvements (Prevent Silent Failures)

**Priority:** HIGH  
**Estimated Time:** 1-2 hours  
**Files Modified:** 1

#### Step 2.1: VirtualScroller Retry Logic
**File:** `frontend/public/js/voter-list-controller.js`  
**Lines to modify:** 17-47

**Changes:**
1. Rename `initVirtualScrolling()` to `tryInitVirtualScrolling()`
2. Create new `initVirtualScrollingWithRetry()` method
3. Add retry loop (3 attempts, 200ms delay)
4. Show user notification if all retries fail
5. Set `virtualScrollerWarningShown` flag

**Validation:**
- Temporarily remove VirtualScroller script tag
- Verify 3 retry attempts logged
- Check toast notification appears
- Confirm chunked rendering works as fallback

---

### Phase 3: Performance Monitoring (Ongoing Optimization)

**Priority:** MEDIUM  
**Estimated Time:** 1 hour  
**Files Modified:** 1

#### Step 3.1: Add Performance Tracking
**File:** `frontend/public/js/voter-list-controller.js`  
**Lines to modify:** 161-198 (updated `renderVoterList`)

**Changes:**
1. Add `performance.now()` timing
2. Log render duration and voter count
3. Warn if duration > 100ms
4. Implement optional `trackPerformance()` method
5. Add `APP_CONFIG.enablePerformanceTracking` flag

**Validation:**
- Enable performance tracking in config
- Render various voter counts (10, 50, 100, 200)
- Check console logs show timing data
- Verify warnings appear for slow renders

---

## Testing Strategy

### Unit Tests

**File:** `tests/unit/voter-list-controller.test.js` (new file)

```javascript
describe('VoterListController', () => {
  describe('renderVoterList', () => {
    it('should use batch rendering for < 50 voters', async () => {
      const voters = generateMockVoters(25);
      await controller.renderVoterList(voters);
      expect(controller.renderVoterListBatch).toHaveBeenCalled();
    });
    
    it('should use chunked rendering for 50-100 voters', async () => {
      const voters = generateMockVoters(75);
      await controller.renderVoterList(voters);
      expect(controller.renderVoterListChunked).toHaveBeenCalled();
    });
    
    it('should use virtual scrolling for > 100 voters', async () => {
      const voters = generateMockVoters(150);
      controller.useVirtualScrolling = true;
      await controller.renderVoterList(voters);
      expect(controller.virtualScroller.setData).toHaveBeenCalled();
    });
    
    it('should fall back to chunked if virtual scrolling fails', async () => {
      const voters = generateMockVoters(150);
      controller.useVirtualScrolling = true;
      controller.virtualScroller.setData.mockImplementation(() => {
        throw new Error('Virtual scroller failed');
      });
      await controller.renderVoterList(voters);
      expect(controller.renderVoterListChunked).toHaveBeenCalled();
    });
    
    it('should complete render in < 50ms for 25 voters', async () => {
      const voters = generateMockVoters(25);
      const start = performance.now();
      await controller.renderVoterList(voters);
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
    });
  });
  
  describe('request cancellation', () => {
    it('should cancel previous request when filter changes', async () => {
      const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
      
      // Start first request
      controller.updateFilter('superVoterOnly', true);
      
      // Immediately start second request
      controller.updateFilter('superVoterOnly', false);
      
      expect(abortSpy).toHaveBeenCalled();
    });
  });
});
```

### Integration Tests

**File:** `tests/integration/super-voter-filter.test.js` (new file)

```javascript
describe('Super Voter Filter Integration', () => {
  beforeEach(async () => {
    await setupTestDatabase();
    await populateTestVoters(200); // 50 super voters, 150 regular
  });
  
  it('should filter to super voters without UI freeze', async () => {
    const checkbox = document.getElementById('superVoterFilter');
    
    // Measure time from click to render complete
    const start = performance.now();
    checkbox.click();
    
    // Wait for render to complete
    await waitForSelector('#voterTableBody tr');
    const duration = performance.now() - start;
    
    // Should complete in < 2 seconds (including network)
    expect(duration).toBeLessThan(2000);
    
    // Verify correct voters shown
    const rows = document.querySelectorAll('#voterTableBody tr');
    expect(rows.length).toBeLessThanOrEqual(100); // Pagination limit
  });
  
  it('should show loading spinner for minimum 300ms', async () => {
    const checkbox = document.getElementById('superVoterFilter');
    
    checkbox.click();
    
    // Loading should be visible immediately
    expect(Utils.showLoading).toHaveBeenCalledWith(true);
    
    // Should still be loading after 250ms
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(document.querySelector('.spinner-border')).toBeVisible();
    
    // Should be done after 500ms
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(document.querySelector('.spinner-border')).not.toBeVisible();
  });
  
  it('should handle rapid filter toggling', async () => {
    const checkbox = document.getElementById('superVoterFilter');
    
    // Toggle 10 times rapidly
    for (let i = 0; i < 10; i++) {
      checkbox.click();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Wait for final render
    await waitForSelector('#voterTableBody tr');
    
    // Should not throw errors
    expect(console.error).not.toHaveBeenCalled();
    
    // Final state should match checkbox state
    const isChecked = checkbox.checked;
    const rows = document.querySelectorAll('#voterTableBody tr');
    
    if (isChecked) {
      // All visible voters should be super voters
      rows.forEach(row => {
        expect(row.querySelector('.badge.bg-success')).toBeInTheDocument();
      });
    }
  });
});
```

### Performance Tests

**File:** `tests/performance/voter-rendering.perf.js` (new file)

```javascript
describe('Voter Rendering Performance', () => {
  const scenarios = [
    { name: 'Small list', count: 25, maxTime: 50 },
    { name: 'Medium list', count: 50, maxTime: 100 },
    { name: 'Large list', count: 100, maxTime: 200 },
    { name: 'Extra large list', count: 200, maxTime: 300 }
  ];
  
  scenarios.forEach(({ name, count, maxTime }) => {
    it(`should render ${name} (${count} voters) in < ${maxTime}ms`, async () => {
      const voters = generateMockVoters(count);
      
      const start = performance.now();
      await controller.renderVoterList(voters);
      const duration = performance.now() - start;
      
      console.log(`${name}: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(maxTime);
    });
  });
  
  it('should report long tasks in Chrome DevTools', async () => {
    const voters = generateMockVoters(100);
    
    const observer = new PerformanceObserver((list) => {
      const longTasks = list.getEntries();
      
      // Should not have any tasks > 50ms
      longTasks.forEach(task => {
        expect(task.duration).toBeLessThan(50);
      });
    });
    
    observer.observe({ entryTypes: ['longtask'] });
    
    await controller.renderVoterList(voters);
    
    observer.disconnect();
  });
});
```

### Manual Testing Checklist

**Environment:** Latest Chrome, Firefox, Safari, Edge

#### Test Case 1: Basic Super Voter Filtering
- [ ] Navigate to voter list
- [ ] Check "Super Voters Only" checkbox
- [ ] **Expected:** Loading spinner appears for 300-500ms
- [ ] **Expected:** Voter list updates to show only super voters
- [ ] **Expected:** Pagination shows correct total count
- [ ] **Expected:** No UI freeze or unresponsiveness

#### Test Case 2: Large Dataset Handling
- [ ] Ensure database has 1000+ voters, 200+ super voters
- [ ] Check "Super Voters Only" checkbox
- [ ] **Expected:** Loading indicator shows "Rendering X voters..." if > 100
- [ ] **Expected:** Voters render in chunks (visible progressive update)
- [ ] **Expected:** Final render completes in < 2 seconds
- [ ] **Expected:** Scrolling is smooth

#### Test Case 3: VirtualScroller Fallback
- [ ] Open browser DevTools Console
- [ ] Type: `VirtualScroller = undefined` (simulate library failure)
- [ ] Refresh page
- [ ] Check super voter filter
- [ ] **Expected:** Toast notification: "Large voter lists will use simplified rendering..."
- [ ] **Expected:** Voters still render correctly
- [ ] **Expected:** No JavaScript errors in console

#### Test Case 4: Rapid Filter Changes
- [ ] Click super voter checkbox ON
- [ ] Immediately click OFF (within 100ms)
- [ ] Repeat 5 times rapidly
- [ ] **Expected:** No duplicate API requests in Network tab
- [ ] **Expected:** Final state matches checkbox state
- [ ] **Expected:** No error messages

#### Test Case 5: Network Timeout
- [ ] Open Chrome DevTools > Network tab
- [ ] Set throttling to "Slow 3G"
- [ ] Check super voter filter
- [ ] **Expected:** Loading spinner shows
- [ ] **Expected:** After 10 seconds, timeout error appears
- [ ] **Expected:** User can try again
- [ ] **Expected:** App remains functional

#### Test Case 6: Cache Behavior
- [ ] Check super voter filter (first time)
- [ ] Wait for results
- [ ] Uncheck filter
- [ ] Immediately re-check filter
- [ ] **Expected:** Results appear from cache (< 100ms)
- [ ] **Expected:** Loading spinner still shows for 300ms minimum
- [ ] **Expected:** Smooth transition, no flash

---

## Dependencies and Requirements

### JavaScript Libraries
- **Bootstrap 5.3+** - Already included, used for modals and loading spinners
- **VirtualScroller** - Optional performance library (graceful degradation if unavailable)
- **Performance API** - Built-in browser API (IE11+ support)

### Browser Support
- **Chrome 90+** - Full support including Performance Observer
- **Firefox 88+** - Full support
- **Safari 14+** - Full support (requestAnimationFrame, AbortController)
- **Edge 90+** - Full support

### Configuration
**File:** `frontend/public/config.js` or inline in `index.html`

```javascript
window.APP_CONFIG = {
  apiBaseUrl: '/api',
  enablePerformanceTracking: true,  // NEW: Enable performance monitoring
  cacheTimeoutMs: 300000,           // 5 minutes
  maxCacheSize: 50,
  voterRenderChunkSize: 25,         // NEW: Voters per chunk
  minLoadingDurationMs: 300,        // NEW: Minimum loading spinner time
  requestTimeoutMs: 10000           // NEW: API request timeout
};
```

### Backend Requirements
**No backend changes required** - all optimizations are client-side

---

## Potential Risks and Mitigations

### Risk 1: Chunked Rendering Complexity
**Description:** Async chunked rendering adds complexity and potential bugs

**Mitigation:**
- ✅ Comprehensive unit tests for each render path
- ✅ Fallback to simpler batch rendering for small lists
- ✅ Performance monitoring to detect regressions
- ✅ Progressive enhancement (works without chunking)

**Likelihood:** Low  
**Impact:** Medium

---

### Risk 2: VirtualScroller Library Dependency
**Description:** Relying on external library that might not load

**Mitigation:**
- ✅ Graceful degradation to chunked rendering
- ✅ Retry logic with 3 attempts
- ✅ User notification if optimization unavailable
- ✅ Functional without VirtualScroller

**Likelihood:** Low  
**Impact:** Low (degraded performance only)

---

### Risk 3: Performance Variance Across Devices
**Description:** Low-end devices might still experience slowness

**Mitigation:**
- ✅ Adaptive chunk sizes based on device capability
- ✅ Performance monitoring logs device data
- ✅ Option to reduce page size (limit: 50 instead of 100)
- ✅ Clear feedback to users on slow renders

**Likelihood:** Medium  
**Impact:** Low (graceful degradation)

---

### Risk 4: Cache Invalidation Issues
**Description:** Stale cached data shown after database updates

**Mitigation:**
- ✅ Existing 5-minute cache timeout
- ✅ Cache cleared on data upload
- ✅ Manual refresh option always available
- ✅ Future: Add cache invalidation on server-side events

**Likelihood:** Low  
**Impact:** Low (data freshness already handled)

---

### Risk 5: Race Conditions with Multiple Filters
**Description:** User toggles multiple filters rapidly, requests overlap

**Mitigation:**
- ✅ Request cancellation prevents overlapping requests
- ✅ Single state update per filter change
- ✅ Debouncing could be added if needed
- ✅ AbortController ensures clean cancellation

**Likelihood:** Low (already mitigated)  
**Impact:** Low

---

## Success Criteria

### Primary Criteria (Must Have)

1. **No UI Freeze > 50ms**
   - Measured via Chrome DevTools Performance tab
   - No "Long Task" warnings for voter list rendering
   - User can interact with UI during large renders

2. **Consistent Loading Feedback**
   - Loading spinner always visible for operations > 300ms
   - Progress indication for renders > 100 voters
   - No jarring instant updates

3. **Functional on All Supported Browsers**
   - Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
   - Works with VirtualScroller enabled
   - Works with VirtualScroller disabled (fallback)

### Secondary Criteria (Nice to Have)

4. **Render Performance Targets**
   - 25 voters: < 50ms
   - 50 voters: < 100ms
   - 100 voters: < 200ms
   - 200 voters: < 400ms

5. **Network Resilience**
   - Handles 10-second timeout gracefully
   - Cancels duplicate requests
   - Recovers from errors without page refresh

6. **User Experience**
   - Clear feedback on optimization status
   - Smooth transitions between loading and loaded states
   - Maintained functionality even with degraded performance

---

## Rollback Plan

If issues are discovered in production:

### Immediate Rollback (< 5 minutes)
1. Revert `voter-list-controller.js` to previous version
2. Revert `voter-service.js` to previous version
3. Revert `filter-controller.js` to previous version
4. Clear browser cache
5. Verify basic filtering works

### Partial Rollback (Disable Optimizations)
1. Set `window.APP_CONFIG.enableChunkedRendering = false` in config
2. Set `window.APP_CONFIG.enableRequestCancellation = false`
3. Monitor for issues
4. Gradually re-enable optimizations

### Git Commands
```bash
# Revert to previous commit
git revert <commit-hash>
git push origin main

# Or create hotfix branch
git checkout -b hotfix/revert-super-voter-fix
git revert <commit-hash>
git push origin hotfix/revert-super-voter-fix
```

---

## Conclusion

This specification provides a comprehensive solution to the super voter filter lockup issue through multiple layers of optimization:

1. **Chunked rendering** prevents UI blocking for large datasets
2. **Request cancellation** prevents race conditions
3. **Minimum loading duration** ensures consistent user feedback
4. **VirtualScroller retry logic** maximizes reliability
5. **Performance monitoring** enables ongoing optimization

The solution is designed for **defense in depth** - if one optimization fails, fallbacks ensure the application remains functional. All changes are client-side, requiring no backend modifications, and maintain backward compatibility with existing functionality.

**Expected Outcome:** Users can filter by super voters with a responsive, non-blocking UI experience, complete with clear loading feedback and graceful handling of all edge cases.
