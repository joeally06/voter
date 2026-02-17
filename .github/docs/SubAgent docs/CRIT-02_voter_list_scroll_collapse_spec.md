# CRIT-02: Voter List Collapses on Scroll — Fix Specification

**Date:** February 17, 2026  
**Issue:** When scrolling the voter list, it collapses on itself  
**Priority:** CRITICAL

---

## Root Cause Analysis

The primary collapse scenario is:

1. State change triggers `renderVoterList()` in `voter-list-controller.js`
2. Controller does `tbody.innerHTML = ''` at line ~254 — **BEFORE** calling `virtualScroller.setData()`
3. `setData()` calls `render()`
4. `render()` finds `viewportHeight = 0` (container not visible/not laid out) → degenerate range → early return
5. tbody is now empty and stays empty → **COLLAPSE**

Additionally, during normal scroll events:
- The VirtualScroller's `innerHTML = ''` at line 140 runs AFTER validation guards pass, which is correct
- But if `container.clientHeight` returns 0 (e.g., during layout reflow), the range calculation produces a degenerate result and the existing content was already cleared by the controller

---

## Files to Modify

### 1. `c:\Voter\frontend\public\js\voter-list-controller.js` (868 lines)

#### Fix A: Remove premature `tbody.innerHTML = ''` before VirtualScroller path

**Current code (line ~254):**
```javascript
// Clear existing rows
tbody.innerHTML = '';

// Show message if no voters
if (this.currentVoters.length === 0) { ... }

// CRITICAL FIX: Use virtual scrolling only for very large datasets (>200 rows)
if (this.useVirtualScrolling && this.virtualScroller && this.currentVoters.length > 200) {
    try {
        this.virtualScroller.setData(this.currentVoters);
```

**Problem:** `tbody.innerHTML = ''` runs unconditionally, then `virtualScroller.setData()` may fail or bail on validation, leaving tbody empty.

**Fix:** Move `tbody.innerHTML = ''` to AFTER the virtual scroller check — only clear when using batch/chunked rendering paths:

```javascript
// Show message if no voters
if (this.currentVoters.length === 0) {
    tbody.innerHTML = '...empty state...';
    return;
}

// Use virtual scrolling for large datasets - VirtualScroller manages its own tbody clearing
if (this.useVirtualScrolling && this.virtualScroller && this.currentVoters.length > 200) {
    try {
        this.virtualScroller.setData(this.currentVoters);
        this.logPerformance(startTime, this.currentVoters.length, 'virtual');
        return;
    } catch (error) {
        Logger.error('VirtualScroller failed:', error);
        this.useVirtualScrolling = false;
    }
}

// Only clear tbody when we're about to do batch/chunked rendering (non-virtual path)
tbody.innerHTML = '';
```

#### Fix B: Add re-entrancy guard to prevent render loops

**Current code (line ~30-35):**
```javascript
this.stateManager.subscribe((state, prevState) => {
    if (state.filteredVoters !== prevState.filteredVoters) {
        this.renderVoterList(state.filteredVoters);
    }
});
```

**Fix:** Add a `_rendering` flag to prevent re-entrancy:

In the constructor, add:
```javascript
this._rendering = false;
```

In `renderVoterList()`, add at the top:
```javascript
if (this._rendering) {
    Logger.debug('renderVoterList: skipping re-entrant call');
    return;
}
this._rendering = true;
```

And at the end (in a finally block or at each exit point):
```javascript
this._rendering = false;
```

#### Fix C: Increase VirtualScroller threshold to 500 rows

Change the threshold from 200 to 500 to reduce exposure to the VirtualScroller's bugs for medium datasets:

```javascript
if (this.useVirtualScrolling && this.virtualScroller && this.currentVoters.length > 500) {
```

### 2. `c:\Voter\frontend\public\js\virtual-scroller.js` (197 lines)

#### Fix D: Handle zero-height container gracefully

**Current code (line ~86-87):**
```javascript
const scrollTop = this.container.scrollTop;
const viewportHeight = this.container.clientHeight;
```

**Fix:** If `viewportHeight` is 0, fall back to a reasonable default or schedule a deferred re-render:

```javascript
const scrollTop = this.container.scrollTop;
let viewportHeight = this.container.clientHeight;

// CRITICAL FIX: Handle zero-height container (hidden/not-laid-out)
if (viewportHeight <= 0) {
    Logger.warn('VirtualScroller: Container has zero height, deferring render');
    // Schedule a deferred render when the container may be laid out
    if (!this._deferredRender) {
        this._deferredRender = requestAnimationFrame(() => {
            this._deferredRender = null;
            this.render();
        });
    }
    return;
}
```

#### Fix E: Use DocumentFragment for atomic tbody swap

Instead of `this.tbody.innerHTML = ''` followed by individual appends, build in a fragment first:

```javascript
// Build new content in a DocumentFragment (no reflows until appended)
const fragment = document.createDocumentFragment();

// Top spacer
const topHeight = startIndex * this.rowHeight;
this.topSpacer.innerHTML = '<td colspan="7" style="height: ' + topHeight + 'px; padding: 0; border: none;"></td>';
fragment.appendChild(this.topSpacer);

for (var i = startIndex; i < endIndex; i++) {
    if (this.data[i]) {
        var row = this.renderRow(this.data[i], i);
        if (row) {
            fragment.appendChild(row);
        }
    }
}

var bottomSpace = (this.data.length - endIndex) * this.rowHeight;
this.bottomSpacer.innerHTML = '<td colspan="7" style="height: ' + Math.max(0, bottomSpace) + 'px; padding: 0; border: none;"></td>';
fragment.appendChild(this.bottomSpacer);

// Atomic swap — clear and append in one operation
this.tbody.innerHTML = '';
this.tbody.appendChild(fragment);
```

#### Fix F: Clean up deferred render in destroy()

```javascript
destroy() {
    this.container.removeEventListener('scroll', this._onScroll);
    if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
    }
    if (this._deferredRender) {
        cancelAnimationFrame(this._deferredRender);
        this._deferredRender = null;
    }
    this.data = [];
    this.visibleRange = { start: -1, end: -1 };
}
```

---

## Summary of Changes

| Fix | File | Description |
|-----|------|-------------|
| A | voter-list-controller.js | Move `tbody.innerHTML = ''` below VirtualScroller path |
| B | voter-list-controller.js | Add re-entrancy guard (`_rendering` flag) |
| C | voter-list-controller.js | Increase VS threshold from 200 to 500 |
| D | virtual-scroller.js | Handle zero-height container with deferred re-render |
| E | virtual-scroller.js | Use DocumentFragment for atomic tbody updates |
| F | virtual-scroller.js | Clean up deferred render in destroy() |
