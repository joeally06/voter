# Route Voter Selection & API Quota Widget Improvements - Specification

**Date:** February 12, 2026  
**Status:** Research Complete - Ready for Implementation  
**Priority:** High - User Experience Enhancement

---

## Executive Summary

This specification addresses two critical issues in the route planning feature:
1. **Voter Selection Limitation**: Both "Select from Map" and "Select from List" buttons currently just grab the first 50 filtered voters with no user control or interactivity
2. **API Quota Widget Malfunction**: Data structure mismatch between backend and frontend prevents quota status from displaying correctly

The proposed solution provides two complementary selection methods (interactive map selection + modal list selection) plus fixes the quota widget to properly display API usage information.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Proposed Solution Architecture](#proposed-solution-architecture)
3. [Detailed Implementation Steps](#detailed-implementation-steps)
4. [Component Integration Strategy](#component-integration-strategy)
5. [UI/UX Design](#uiux-design)
6. [Data Structures](#data-structures)
7. [Dependencies and Requirements](#dependencies-and-requirements)
8. [Testing Approach](#testing-approach)
9. [Potential Risks and Mitigations](#potential-risks-and-mitigations)
10. [Success Criteria](#success-criteria)
11. [Research Sources](#research-sources)

---

## Current State Analysis

### 🔍 What's Broken and Why

#### Problem 1: Non-Interactive Voter Selection

**Current Implementation** (`route-planner-controller.js` lines 71-105):
```javascript
async selectVotersFromMap() {
    const voters = this.stateManager.getState().filteredVoters || [];
    const geocodedVoters = voters.filter(v => v.latitude && v.longitude);
    
    // PROBLEM: Just slices first 50 with no user input
    const selected = geocodedVoters.slice(0, 50);
    
    this.selectedVoters = selected;
    this.updateSelectedVotersList();
    Utils.showToast(`Selected ${selected.length} voters from map`, 'success');
}

async selectVotersFromList() {
    // PROBLEM: Just calls selectVotersFromMap - no list interaction
    this.selectVotersFromMap();
}
```

**Why This Is Bad**:
- Users cannot choose which voters to include in their route
- First 50 voters may not be geographically optimal (could be scattered)
- No visual feedback on map showing which voters are selected
- Button labels are misleading ("Select from Map" implies interaction, but there is none)
- Inefficient for canvassing - users need control to plan strategic routes

**Impact**:
- Poor user experience (no control)
- Suboptimal route planning (random selection)
- Wasted time recalculating routes with wrong voters

---

#### Problem 2: Broken API Quota Widget

**Backend Response** (`quota-manager.js` lines 287-318):
```javascript
async getAllQuotaStatus() {
    // Returns this structure:
    return {
        quotas: {
            distance_matrix: {
                quota: 333,
                used: 45,
                remaining: 288,
                percentUsed: 13.5,
                cacheHitRate: 87.3,
                cacheHits: 89,
                cacheMisses: 13
            },
            geocoding: { ... },
            directions: { ... }
        },
        totalQuota: 1000,
        totalUsed: 150,
        totalRemaining: 850,
        averageCacheHitRate: 85.2
    };
}
```

**Frontend Expectation** (`route-planner-controller.js` lines 375-421):
```javascript
async updateQuotaWidget(quotaStatus = null) {
    if (!quotaStatus) {
        const response = await fetch('/api/routes/quota-status');
        if (response.ok) {
            const data = await response.json();
            // PROBLEM: Expects quotaStatus to be direct object
            quotaStatus = data.quotas?.distance_matrix;  // Line 382
        }
    }
    
    // Uses properties like quotaStatus.used, quotaStatus.quota, etc.
    if (usedElem) usedElem.textContent = quotaStatus.used;
    if (totalElem) totalElem.textContent = quotaStatus.quota;
    // ...
}
```

**Backend Route** (`routes.js` lines 280-300):
```javascript
router.get('/quota-status', async (req, res) => {
    const status = await quotaManager.getAllQuotaStatus();
    
    // PROBLEM: Returns { success: true, ...status }
    // This wraps the quotas object one level deeper
    res.json({
        success: true,
        ...status  // Spreads: quotas, totalQuota, totalUsed, etc.
    });
});
```

**The Mismatch**:
1. Backend returns: `{ success: true, quotas: { distance_matrix: {...} }, totalQuota: 333, ... }`
2. Frontend tries to access: `data.quotas?.distance_matrix`
3. Frontend then expects properties like `.used`, `.quota`, `.percentUsed`, `.cacheHitRate`
4. **Result**: Widget shows 0/333 (0%) because data extraction fails

**Why This Happens**:
- Backend spread operator (`...status`) adds `success: true` at same level as `quotas`
- Frontend correctly navigates to `data.quotas.distance_matrix`
- BUT initial load (line 377-382) may fail to extract data properly
- Widget initialization happens before route calculation, so it never updates

---

### 📊 Current Infrastructure Assets

**What We Can Leverage**:

1. **Voter List Controller** (`voter-list-controller.js`):
   - ✅ Already has `selectedVoters` Set for tracking selections (line 11)
   - ✅ Has `toggleVoterSelection()` method implemented (lines 315-347)
   - ✅ Has `updateSelectionCount()` for UI feedback (lines 329-342)
   - ✅ Ctrl/Cmd+Click selection already works in table rows (lines 234-238)

2. **Map Controller** (`map-controller.js`):
   - ✅ Marker click listeners already set up (line 197)
   - ✅ `getMarkerIcon()` method for custom marker appearance (lines 220-240)
   - ✅ MarkerClusterer integration for performance (lines 203-207)
   - ✅ InfoWindow system for displaying voter data (lines 247-270)

3. **Route Planner Controller** (`route-planner-controller.js`):
   - ✅ `selectedVoters` array for storing route participants (line 17)
   - ✅ `updateSelectedVotersList()` for UI display (lines 118-140)
   - ✅ `updateQuotaWidget()` method skeleton exists (lines 375-421)
   - ✅ Button event bindings ready (lines 48-62)

4. **UI Components** (`index.html`):
   - ✅ Bootstrap 5 modal system in use (lines 897-923)
   - ✅ Quota widget HTML structure exists (lines 424-450)
   - ✅ Selected voters list display (lines 326-348)
   - ✅ Route planning panel UI (lines 320-450)

**What Works Well**:
- Map marker rendering is performant with clustering
- State management is centralized and reactive
- Existing selection infrastructure in voter list controller
- Modal patterns established (voter detail modal, upload modal)

---

## Proposed Solution Architecture

### 🏗️ Three-Part Solution

#### Part A: Interactive Map Marker Selection

**Goal**: Allow users to click map markers to select/deselect voters for route planning.

**Architecture**:
```
User clicks marker
    ↓
MapController fires click event
    ↓
Check if route selection mode active
    ↓
Toggle voter in RoutePlannerController.selectedVoters
    ↓
Update marker icon to show selected state
    ↓
Emit state change event
    ↓
Update selected voters count/list UI
    ↓
Enforce 50-voter limit with warning
```

**Key Design Decisions**:
1. **Selection Mode Toggle**: Add "selection mode" state to enable/disable map selection
   - Prevents accidental selections during normal map browsing
   - Clear visual indicator when selection mode is active

2. **Marker Icon States**:
   - **Unselected Super Voter**: Green circle (#198754)
   - **Unselected Regular**: Gray circle (#6c757d)
   - **Selected Super Voter**: Blue star with green border
   - **Selected Regular**: Blue star with gray border
   - **Hover State**: Scale marker 1.2x for feedback

3. **Cluster Handling**:
   - When marker is in cluster, zoom in to reveal individual markers
   - Selection only works on individual (unclustered) markers
   - User clicks cluster → map zooms → reveals markers → then can select

4. **State Synchronization**:
   - Map selections sync with route planner `selectedVoters` array
   - Selected voters appear in sidebar list
   - Count updates in real-time with badge

---

#### Part B: Modal List Selection with Search/Filter

**Goal**: Provide filterable, searchable list modal where users select voters via checkboxes.

**Architecture**:
```
User clicks "Select from List" button
    ↓
Open Bootstrap modal
    ↓
Load filtered voters into modal list (all geocoded voters)
    ↓
User searches/filters within modal
    ↓
User checks/unchecks voters (max 50)
    ↓
"Confirm Selection" button
    ↓
Update RoutePlannerController.selectedVoters
    ↓
Update map marker icons to reflect selection
    ↓
Close modal and show success toast
```

**Modal Structure**:
```html
<!-- Voter Selection Modal -->
<div class="modal fade" id="routeVoterSelectionModal" tabindex="-1">
  <div class="modal-dialog modal-dialog-scrollable modal-lg">
    <div class="modal-content">
      <div class="modal-header">
        <h5>Select Voters for Route</h5>
        <span class="badge bg-info" id="modalSelectionCount">0 / 50</span>
      </div>
      <div class="modal-body">
        <!-- Search Bar -->
        <input type="text" class="form-control mb-3" 
               id="voterSearchInput" 
               placeholder="Search by name, address...">
        
        <!-- Action Buttons -->
        <div class="btn-group mb-3">
          <button id="selectAllVisibleBtn">Select All (Visible)</button>
          <button id="clearAllSelectionBtn">Clear All</button>
          <button id="selectSupersOnlyBtn">Super Voters Only</button>
        </div>
        
        <!-- Voter List with Checkboxes -->
        <ul class="list-group" id="voterSelectionList">
          <!-- Dynamically populated -->
        </ul>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" data-bs-dismiss="modal">Cancel</button>
        <button class="btn-primary" id="confirmVoterSelection">
          Confirm Selection (<span id="confirmCount">0</span>)
        </button>
      </div>
    </div>
  </div>
</div>
```

**Key Features**:
1. **Real-Time Search**: Filter by name, address, precinct as user types
2. **Bulk Actions**: Select all visible, clear all, select only super voters
3. **Visual Count**: Live count showing "X / 50" selection progress
4. **Limit Enforcement**: Disable checkboxes when 50 reached, show warning
5. **Existing Selection Preservation**: Pre-check voters already selected
6. **Virtual Scrolling**: Handle 1000+ voter lists efficiently

---

#### Part C: API Quota Widget Fix

**Goal**: Fix data structure mismatch so quota status displays correctly.

**Root Cause**: Backend returns nested structure that frontend doesn't parse correctly on initial load.

**Solution Architecture**:
```javascript
// BACKEND - Simplify response structure
router.get('/quota-status', async (req, res) => {
    const status = await quotaManager.getAllQuotaStatus();
    
    res.json({
        success: true,
        // Include everything from status directly
        quotas: status.quotas,
        totalQuota: status.totalQuota,
        totalUsed: status.totalUsed,
        totalRemaining: status.totalRemaining,
        averageCacheHitRate: status.averageCacheHitRate,
        // Add direct access to distance_matrix for convenience
        distance_matrix: status.quotas.distance_matrix
    });
});

// FRONTEND - Update parsing logic
async updateQuotaWidget(quotaStatus = null) {
    try {
        if (!quotaStatus) {
            const response = await fetch('/api/routes/quota-status');
            if (response.ok) {
                const data = await response.json();
                // Use direct distance_matrix property OR navigate through quotas
                quotaStatus = data.distance_matrix || data.quotas?.distance_matrix;
            }
        }
        
        // Add validation
        if (!quotaStatus || typeof quotaStatus.used === 'undefined') {
            Logger.warn('Invalid quota status data:', quotaStatus);
            return;
        }
        
        // Update UI with validated data
        // ... (existing UI update code)
        
    } catch (error) {
        Logger.error('Quota widget update error:', error);
        // Show user-friendly error state in widget
        this.showQuotaWidgetError();
    }
}
```

**Why This Works**:
1. Backend provides data in TWO paths: nested AND direct
2. Frontend tries direct path first (simpler), falls back to nested path
3. Validation ensures we don't try to display invalid data
4. Error handling shows widget in error state rather than showing zeros
5. Backward compatible with existing route calculation quota status updates

---

### 🔗 Integration Points

**How Components Work Together**:

```
┌─────────────────────────────────────────────────────────┐
│                    State Manager                        │
│  • filteredVoters (all current voters)                  │
│  • routeSelectionMode (boolean)                         │
└─────────────────┬───────────────────────────────────────┘
                  │
      ┌───────────┴───────────┐
      ▼                       ▼
┌─────────────┐         ┌─────────────────┐
│ Map         │◄────────┤ Route Planner   │
│ Controller  │         │ Controller      │
│             │         │                 │
│ • Markers   │         │ • selectedVoters│
│ • Icons     │────────►│ • updateUI()    │
└──────┬──────┘         └────────┬────────┘
       │                         │
       │                         │
       ▼                         ▼
┌─────────────┐         ┌─────────────────┐
│ Voter List  │         │ UI Components   │
│ Controller  │         │                 │
│             │         │ • Modal         │
│ • selection │         │ • Sidebar       │
│ • toggle()  │         │ • Quota Widget  │
└─────────────┘         └─────────────────┘
```

**Data Flow**:

1. **Map Selection → Route Planner**:
   - User clicks marker → MapController.handleMarkerClick()
   - Check routeSelectionMode state
   - Call RoutePlannerController.toggleVoterSelection(voter)
   - Update marker icon via MapController.updateMarkerIcon(voterId, selected)

2. **List Modal Selection → Route Planner**:
   - User checks checkbox → Track in modal-local Set
   - User clicks "Confirm" → RoutePlannerController.setSelectedVoters(voterArray)
   - Trigger MapController.updateAllMarkerIcons(selectedVoterIds)

3. **Route Planner → Map**:
   - selectedVoters changes → Emit 'route-selection-changed' event
   - MapController listens → Updates all marker icons
   - VoterListController listens → Updates row highlights

4. **Quota Widget**:
   - Page load → Fetch and display quota immediately
   - After route calculation → Update with new quota from response
   - Periodic refresh → Poll quota-status endpoint every 5 minutes

---

## Detailed Implementation Steps

### 📝 Step-by-Step Breakdown

#### PHASE 1: Map Marker Selection (Option A)

**Step 1.1: Add Selection Mode State**

File: `frontend/public/js/route-planner-controller.js`

```javascript
class RoutePlannerController {
    constructor(mapController, voterService, stateManager) {
        // ... existing code ...
        this.selectedVoters = [];
        this.selectionMode = false;  // NEW: Track selection mode
        this.selectedVoterIds = new Set();  // NEW: Quick lookup
    }
    
    /**
     * Toggle selection mode on/off
     */
    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        
        // Update UI to show mode
        const mapBtn = document.getElementById('selectFromMapVoters');
        if (this.selectionMode) {
            mapBtn.classList.add('active', 'btn-success');
            mapBtn.innerHTML = '<i class="bi bi-check-circle"></i> Selection Mode: ON';
            Utils.showToast('Click markers to select voters', 'info');
        } else {
            mapBtn.classList.remove('active', 'btn-success');
            mapBtn.innerHTML = '<i class="bi bi-cursor"></i> Select from Map';
        }
        
        // Update cursor style on map
        this.mapController.setSelectionCursor(this.selectionMode);
    }
    
    /**
     * Toggle voter selection (called from map marker clicks)
     */
    toggleVoterSelection(voter) {
        const voterId = voter.voterId || voter.voter_id;
        
        if (this.selectedVoterIds.has(voterId)) {
            // Deselect
            this.selectedVoterIds.delete(voterId);
            this.selectedVoters = this.selectedVoters.filter(v => 
                (v.voterId || v.voter_id) !== voterId
            );
            this.mapController.updateMarkerIcon(voterId, false);
        } else {
            // Check limit
            if (this.selectedVoters.length >= 50) {
                Utils.showToast('Maximum 50 voters allowed. Deselect others first.', 'warning');
                return;
            }
            
            // Select
            this.selectedVoterIds.add(voterId);
            this.selectedVoters.push(voter);
            this.mapController.updateMarkerIcon(voterId, true);
        }
        
        this.updateSelectedVotersList();
        
        // Emit event for other controllers
        this.stateManager.emit('route-selection-changed', {
            selectedVoterIds: Array.from(this.selectedVoterIds),
            count: this.selectedVoters.length
        });
    }
}
```

**Step 1.2: Update Map Controller to Handle Selection Clicks**

File: `frontend/public/js/map-controller.js`

```javascript
class MapController {
    constructor(mapElement, stateManager, options = {}) {
        // ... existing code ...
        this.routePlannerController = null;  // NEW: Will be set later
        this.selectionMode = false;  // NEW
    }
    
    /**
     * Set reference to route planner (called after initialization)
     */
    setRoutePlanner(routePlanner) {
        this.routePlannerController = routePlanner;
    }
    
    /**
     * Update cursor style based on selection mode
     */
    setSelectionCursor(enabled) {
        this.selectionMode = enabled;
        if (this.map) {
            this.map.setOptions({
                draggableCursor: enabled ? 'crosshair' : null
            });
        }
    }
    
    /**
     * Update marker icon to show selected/unselected state
     */
    updateMarkerIcon(voterId, selected) {
        const marker = this.markers.find(m => {
            const voter = m.voter;  // Store voter reference on marker
            return (voter.voterId || voter.voter_id) === voterId;
        });
        
        if (marker) {
            const voter = marker.voter;
            marker.setIcon(this.getMarkerIcon(voter, selected));
        }
    }
    
    /**
     * Enhanced marker icon generation with selection state
     */
    getMarkerIcon(voter, selected = false) {
        const colors = window.APP_CONFIG?.markerColors || {
            superVoter: '#198754',
            regular: '#6c757d',
            selected: '#0d6efd'
        };
        
        const isSuperVoter = voter.superVoter || voter.super_voter || voter.is_super_voter;
        
        if (selected) {
            // Selected markers: blue star with colored border
            return {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,  // Star-like shape
                fillColor: colors.selected,
                fillOpacity: 1.0,
                strokeColor: isSuperVoter ? colors.superVoter : colors.regular,
                strokeWeight: 3,
                scale: 10,
                rotation: 0
            };
        } else {
            // Normal markers (existing logic)
            const color = isSuperVoter ? colors.superVoter : colors.regular;
            return {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: color,
                fillOpacity: 0.8,
                strokeColor: '#ffffff',
                strokeWeight: 2,
                scale: 8
            };
        }
    }
    
    /**
     * Update existing updateMarkers to store voter reference
     */
    updateMarkers(voters) {
    if (!this.isInitialized) return;

        this.clearMarkers();

        const validVoters = voters.filter(v => 
            Utils.isValidCoordinates(v.latitude, v.longitude)
        );

        if (validVoters.length === 0) {
            Logger.debug('No voters with valid coordinates to display');
            return;
        }

        this.markers = validVoters.map(voter => {
            const marker = new google.maps.Marker({
                position: { lat: parseFloat(voter.latitude), lng: parseFloat(voter.longitude) },
                map: this.map,
                title: `${voter.firstName || voter.first_name} ${voter.lastName || voter.last_name}`,
                icon: this.getMarkerIcon(voter),
                optimized: true
            });

            marker.voter = voter;  // NEW: Store voter reference

            // Enhanced click listener
            marker.addListener('click', () => {
                // Check if in selection mode
                if (this.selectionMode && this.routePlannerController) {
                    this.routePlannerController.toggleVoterSelection(voter);
                } else {
                    // Normal behavior: show info window
                    this.showVoterInfo(voter, marker);
                }
            });

            return marker;
        });

        // Clustering logic...
        const clusterThreshold = window.APP_CONFIG?.markerClusterThreshold || 100;
        if (this.markers.length > clusterThreshold) {
            this.enableClustering();
        }

        if (this.markers.length > 0) {
            this.fitBounds();
        }

        Logger.info(`📍 ${this.markers.length} markers displayed on map`);
    }
}
```

**Step 1.3: Wire Up Controllers on Page Load**

File: `frontend/public/index.html` (in initialization script)

```javascript
// After controller initialization
routePlannerController.mapController = mapController;
mapController.setRoutePlanner(routePlannerController);

// Update button to toggle selection mode instead of auto-selecting
document.getElementById('selectFromMapVoters').addEventListener('click', () => {
    routePlannerController.toggleSelectionMode();
});
```

---

#### PHASE 2: Modal List Selection (Option B)

**Step 2.1: Create Modal HTML Structure**

File: `frontend/public/index.html` (add after line 900)

```html
<!-- Route Voter Selection Modal -->
<div class="modal fade" id="routeVoterSelectionModal" tabindex="-1" 
     aria-labelledby="routeVoterSelectionModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-scrollable modal-lg">
    <div class="modal-content">
      <div class="modal-header bg-primary text-white">
        <h5 class="modal-title" id="routeVoterSelectionModalLabel">
          <i class="bi bi-people"></i> Select Voters for Route
        </h5>
        <span class="badge bg-light text-primary ms-auto me-2" id="modalSelectionCount">
          0 / 50
        </span>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      
      <div class="modal-body p-0">
        <!-- Search and Filter Bar -->
        <div class="p-3 bg-light border-bottom">
          <div class="input-group mb-2">
            <span class="input-group-text"><i class="bi bi-search"></i></span>
            <input type="text" 
                   class="form-control" 
                   id="voterSelectionSearchInput" 
                   placeholder="Search by name, address, precinct..."
                   autocomplete="off">
          </div>
          
          <!-- Action Buttons -->
          <div class="btn-group btn-group-sm w-100" role="group">
            <button type="button" class="btn btn-outline-secondary" id="selectAllVisibleBtn">
              <i class="bi bi-check-square"></i> Select All
            </button>
            <button type="button" class="btn btn-outline-secondary" id="selectSupersOnlyBtn">
              <i class="bi bi-star"></i> Super Voters
            </button>
            <button type="button" class="btn btn-outline-danger" id="clearModalSelectionBtn">
              <i class="bi bi-x-square"></i> Clear All
            </button>
          </div>
        </div>
        
        <!-- Voter List with Checkboxes -->
        <div class="list-container" style="max-height: 400px; overflow-y: auto;">
          <ul class="list-group list-group-flush" id="voterSelectionList">
            <!-- Dynamically populated -->
            <li class="list-group-item text-center text-muted">
              <div class="spinner-border spinner-border-sm" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
              Loading voters...
            </li>
          </ul>
        </div>
      </div>
      
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
          Cancel
        </button>
        <button type="button" class="btn btn-primary" id="confirmVoterSelectionBtn">
          <i class="bi bi-check-lg"></i> 
          Confirm Selection (<span id="confirmSelectionCount">0</span>)
        </button>
      </div>
    </div>
  </div>
</div>
```

**Step 2.2: Implement Modal Controller Logic**

File: `frontend/public/js/route-planner-controller.js`

```javascript
class RoutePlannerController {
    // ... existing code ...
    
    /**
     * Open voter selection modal
     */
    async openVoterSelectionModal() {
        const voters = this.stateManager.getState().filteredVoters || [];
        const geocodedVoters = voters.filter(v => v.latitude && v.longitude);
        
        if (geocodedVoters.length === 0) {
            Utils.showToast('No geocoded voters available.', 'warning');
            return;
        }
        
        // Store for modal use
        this.modalAvailableVoters = geocodedVoters;
        this.modalSelectedVoterIds = new Set(
            this.selectedVoters.map(v => v.voterId || v.voter_id)
        );
        
        // Populate modal
        this.renderModalVoterList(geocodedVoters);
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('routeVoterSelectionModal'));
        this.voterSelectionModal = modal;
        modal.show();
        
        // Bind modal event listeners
        this.bindModalEventListeners();
    }
    
    /**
     * Render voter list in modal with checkboxes
     */
    renderModalVoterList(voters, searchTerm = '') {
        const listContainer = document.getElementById('voterSelectionList');
        
        // Filter by search term
        let filteredVoters = voters;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredVoters = voters.filter(v => {
                const fullName = `${v.firstName} ${v.lastName}`.toLowerCase();
                const address = (v.address || '').toLowerCase();
                const precinct = (v.precinctNumber || '').toString();
                return fullName.includes(term) || 
                       address.includes(term) || 
                       precinct.includes(term);
            });
        }
        
        // Generate list items
        if (filteredVoters.length === 0) {
            listContainer.innerHTML = `
                <li class="list-group-item text-center text-muted">
                    No voters found matching "${searchTerm}"
                </li>
            `;
            return;
        }
        
        listContainer.innerHTML = filteredVoters.map(voter => {
            const voterId = voter.voterId || voter.voter_id;
            const isSelected = this.modalSelectedVoterIds.has(voterId);
            const isSuperVoter = voter.superVoter || voter.super_voter;
            const isDisabled = !isSelected && this.modalSelectedVoterIds.size >= 50;
            
            return `
                <li class="list-group-item">
                    <div class="form-check">
                        <input class="form-check-input voter-checkbox" 
                               type="checkbox" 
                               value="${voterId}" 
                               id="voter-${voterId}"
                               ${isSelected ? 'checked' : ''}
                               ${isDisabled ? 'disabled' : ''}
                               data-voter-index="${voters.indexOf(voter)}">
                        <label class="form-check-label w-100" for="voter-${voterId}">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <strong>${this.escapeHtml(voter.lastName)}, ${this.escapeHtml(voter.firstName)}</strong>
                                    ${isSuperVoter ? '<span class="badge bg-success ms-1">Super</span>' : ''}
                                    <br>
                                    <small class="text-muted">
                                        ${this.escapeHtml(voter.address || 'N/A')} • 
                                        Precinct ${voter.precinctNumber || 'N/A'}
                                    </small>
                                </div>
                                <span class="badge bg-secondary">
                                    ${voter.mostRecentParty || 'N/A'}
                                </span>
                            </div>
                        </label>
                    </div>
                </li>
            `;
        }).join('');
        
        // Update count
        this.updateModalSelectionCount();
    }
    
    /**
     * Bind modal interaction event listeners
     */
    bindModalEventListeners() {
        const modal = document.getElementById('routeVoterSelectionModal');
        
        // Search input
        const searchInput = document.getElementById('voterSelectionSearchInput');
        searchInput.addEventListener('input', (e) => {
            this.renderModalVoterList(this.modalAvailableVoters, e.target.value);
        });
        
        // Checkbox changes
        modal.addEventListener('change', (e) => {
            if (e.target.classList.contains('voter-checkbox')) {
                const voterId = e.target.value;
                if (e.target.checked) {
                    this.modalSelectedVoterIds.add(voterId);
                } else {
                    this.modalSelectedVoterIds.delete(voterId);
                }
                
                // Re-render to update disabled states
                const searchTerm = searchInput.value;
                this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
            }
        });
        
        // Select All Visible
        document.getElementById('selectAllVisibleBtn').addEventListener('click', () => {
            const visibleCheckboxes = document.querySelectorAll('.voter-checkbox:not(:disabled)');
            const remainingSlots = 50 - this.modalSelectedVoterIds.size;
            
            let added = 0;
            visibleCheckboxes.forEach(checkbox => {
                if (!checkbox.checked && added < remainingSlots) {
                    this.modalSelectedVoterIds.add(checkbox.value);
                    added++;
                }
            });
            
            const searchTerm = searchInput.value;
            this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
        });
        
        // Select Super Voters Only
        document.getElementById('selectSupersOnlyBtn').addEventListener('click', () => {
            // Clear current selection
            this.modalSelectedVoterIds.clear();
            
            // Select up to 50 super voters
            const superVoters = this.modalAvailableVoters
                .filter(v => v.superVoter || v.super_voter)
                .slice(0, 50);
            
            superVoters.forEach(v => {
                this.modalSelectedVoterIds.add(v.voterId || v.voter_id);
            });
            
            const searchTerm = searchInput.value;
            this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
            
            Utils.showToast(`Selected ${superVoters.length} super voters`, 'success');
        });
        
        // Clear All
        document.getElementById('clearModalSelectionBtn').addEventListener('click', () => {
            this.modalSelectedVoterIds.clear();
            const searchTerm = searchInput.value;
            this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
        });
        
        // Confirm Selection
        document.getElementById('confirmVoterSelectionBtn').addEventListener('click', () => {
            this.confirmModalSelection();
        });
    }
    
    /**
     * Update modal selection count display
     */
    updateModalSelectionCount() {
        const count = this.modalSelectedVoterIds.size;
        const countBadge = document.getElementById('modalSelectionCount');
        const confirmCount = document.getElementById('confirmSelectionCount');
        
        if (countBadge) {
            countBadge.textContent = `${count} / 50`;
            countBadge.className = count >= 50 
                ? 'badge bg-warning text-dark ms-auto me-2' 
                : 'badge bg-light text-primary ms-auto me-2';
        }
        
        if (confirmCount) {
            confirmCount.textContent = count;
        }
    }
    
    /**
     * Confirm and apply modal selection
     */
    confirmModalSelection() {
        // Get voter objects from IDs
        const selectedVoters = this.modalAvailableVoters.filter(v => 
            this.modalSelectedVoterIds.has(v.voterId || v.voter_id)
        );
        
        // Update route planner state
        this.selectedVoters = selectedVoters;
        this.selectedVoterIds = new Set(this.modalSelectedVoterIds);
        
        // Update UI
        this.updateSelectedVotersList();
        
        // Update map markers
        this.mapController.updateAllMarkerIcons(Array.from(this.selectedVoterIds));
        
        // Close modal
        this.voterSelectionModal.hide();
        
        Utils.showToast(`${selectedVoters.length} voters selected for route`, 'success');
        
        // Emit event
        this.stateManager.emit('route-selection-changed', {
            selectedVoterIds: Array.from(this.selectedVoterIds),
            count: this.selectedVoters.length
        });
    }
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
```

**Step 2.3: Add Bulk Marker Icon Update to Map Controller**

File: `frontend/public/js/map-controller.js`

```javascript
class MapController {
    // ... existing code ...
    
    /**
     * Update all marker icons based on selected voter IDs
     * @param {Array<string>} selectedVoterIds - Array of selected voter IDs
     */
    updateAllMarkerIcons(selectedVoterIds) {
        const selectedSet = new Set(selectedVoterIds);
        
        this.markers.forEach(marker => {
            const voter = marker.voter;
            if (voter) {
                const voterId = voter.voterId || voter.voter_id;
                const isSelected = selectedSet.has(voterId);
                marker.setIcon(this.getMarkerIcon(voter, isSelected));
            }
        });
        
        Logger.debug(`Updated ${this.markers.length} marker icons`);
    }
}
```

**Step 2.4: Wire Up List Selection Button**

File: `frontend/public/js/route-planner-controller.js`

```javascript
bindEventListeners() {
    // ... existing code ...
    
    const selectFromListBtn = document.getElementById('selectFromListVoters');
    if (selectFromListBtn) {
        selectFromListBtn.addEventListener('click', () => {
            this.openVoterSelectionModal();  // NEW: Open modal instead of auto-selecting
        });
    }
}
```

---

#### PHASE 3: Fix API Quota Widget

**Step 3.1: Update Backend Route Response Structure**

File: `backend/routes/routes.js`

```javascript
/**
 * Get API quota usage status across all Google Maps APIs
 * UPDATED: Provide data in multiple access patterns for frontend compatibility
 */
router.get('/quota-status', async (req, res) => {
  try {
    const quotaManager = new QuotaManager();
    const status = await quotaManager.getAllQuotaStatus();

    // Provide data in both nested and direct formats
    res.json({
      success: true,
      quotas: status.quotas,
      totalQuota: status.totalQuota,
      totalUsed: status.totalUsed,
      totalRemaining: status.totalRemaining,
      averageCacheHitRate: status.averageCacheHitRate,
      // Direct access for convenience
      distance_matrix: status.quotas.distance_matrix,
      geocoding: status.quotas.geocoding,
      directions: status.quotas.directions
    });

  } catch (error) {
    console.error('Quota status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve quota status',
      message: error.message
    });
  }
});
```

**Step 3.2: Fix Frontend Quota Widget Parsing**

File: `frontend/public/js/route-planner-controller.js`

```javascript
/**
 * Update quota widget with current API usage
 * FIXED: Handle data structure correctly
 * @param {Object} quotaStatus - Optional quota status object
 */
async updateQuotaWidget(quotaStatus = null) {
    try {
        // Fetch quota status if not provided
        if (!quotaStatus) {
            const response = await fetch('/api/routes/quota-status');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch quota status');
            }
            
            // FIXED: Try direct property first, then nested path
            quotaStatus = data.distance_matrix || data.quotas?.distance_matrix;
        }
        
        // Validate quota data
        if (!quotaStatus) {
            Logger.warn('Quota status data not available');
            this.showQuotaWidgetPlaceholder();
            return;
        }
        
        // Validate required properties
        const requiredProps = ['used', 'quota', 'percentUsed', 'cacheHitRate'];
        const hasAllProps = requiredProps.every(prop => 
            quotaStatus.hasOwnProperty(prop) && quotaStatus[prop] !== undefined
        );
        
        if (!hasAllProps) {
            Logger.warn('Invalid quota status data structure:', quotaStatus);
            this.showQuotaWidgetPlaceholder();
            return;
        }
        
        // Update UI elements
        const usedElem = document.getElementById('quotaUsed');
        const totalElem = document.getElementById('quotaTotal');
        const percentElem = document.getElementById('quotaPercent');
        const barElem = document.getElementById('quotaBar');
        const hitRateElem = document.getElementById('cacheHitRate');
        
        if (usedElem) usedElem.textContent = quotaStatus.used;
        if (totalElem) totalElem.textContent = quotaStatus.quota;
        if (percentElem) percentElem.textContent = `${quotaStatus.percentUsed}%`;
        if (hitRateElem) hitRateElem.textContent = `${quotaStatus.cacheHitRate}%`;
        
        if (barElem) {
            // Animate bar width
            barElem.style.width = `${quotaStatus.percentUsed}%`;
            
            // Color based on usage
            barElem.classList.remove('quota-danger', 'quota-warning', 'quota-ok');
            if (quotaStatus.percentUsed >= 90) {
                barElem.classList.add('quota-danger');
            } else if (quotaStatus.percentUsed >= 70) {
                barElem.classList.add('quota-warning');
            } else {
                barElem.classList.add('quota-ok');
            }
        }
        
        Logger.debug('Quota widget updated:', quotaStatus);
        
    } catch (error) {
        Logger.error('Quota widget update error:', error);
        this.showQuotaWidgetError(error.message);
    }
}

/**
 * Show placeholder state when quota data unavailable
 */
showQuotaWidgetPlaceholder() {
    const usedElem = document.getElementById('quotaUsed');
    const totalElem = document.getElementById('quotaTotal');
    const percentElem = document.getElementById('quotaPercent');
    const hitRateElem = document.getElementById('cacheHitRate');
    const barElem = document.getElementById('quotaBar');
    
    if (usedElem) usedElem.textContent = '-';
    if (totalElem) totalElem.textContent = '-';
    if (percentElem) percentElem.textContent = '-';
    if (hitRateElem) hitRateElem.textContent = '-';
    
    if (barElem) {
        barElem.style.width = '0%';
        barElem.classList.remove('quota-danger', 'quota-warning', 'quota-ok');
        barElem.classList.add('bg-secondary');
    }
}

/**
 * Show error state in quota widget
 */
showQuotaWidgetError(errorMsg = 'Error loading quota data') {
    const usedElem = document.getElementById('quotaUsed');
    const totalElem = document.getElementById('quotaTotal');
    
    if (usedElem) usedElem.textContent = 'Error';
    if (totalElem) totalElem.innerHTML = `<span class="text-danger small" title="${this.escapeHtml(errorMsg)}">⚠️</span>`;
}
```

**Step 3.3: Add Periodic Quota Refresh**

File: `frontend/public/js/route-planner-controller.js`

```javascript
async init() {
    Logger.info('📍 Initializing Route Planner Controller...');
    
    this.bindEventListeners();
    
    // Initial quota load
    await this.updateQuotaWidget();
    
    // Periodic refresh every 5 minutes
    this.quotaRefreshInterval = setInterval(() => {
        this.updateQuotaWidget();
    }, 5 * 60 * 1000);  // 5 minutes
    
    Logger.info('✅ Route Planner Controller initialized');
}

/**
 * Cleanup when controller is destroyed
 */
destroy() {
    if (this.quotaRefreshInterval) {
        clearInterval(this.quotaRefreshInterval);
    }
}
```

**Step 3.4: Update CSS for Quota Bar Colors**

File: `frontend/public/css/custom.css` (or inline in index.html)

```css
/* Quota Bar Color States */
.quota-bar-fill {
    height: 100%;
    transition: all 0.3s ease;
    background: linear-gradient(90deg, #0d6efd 0%, #0a58ca 100%);
}

.quota-bar-fill.quota-ok {
    background: linear-gradient(90deg, #198754 0%, #157347 100%);
}

.quota-bar-fill.quota-warning {
    background: linear-gradient(90deg, #ffc107 0%, #ffb300 100%);
}

.quota-bar-fill.quota-danger {
    background: linear-gradient(90deg, #dc3545 0%, #bb2d3b 100%);
}

#quotaBar {
    border-radius: 0.25rem;
}
```

---

## Component Integration Strategy

### 🔗 How Pieces Work Together

#### Controller Communication Pattern

```javascript
// 1. Route Planner emits selection changes
this.stateManager.emit('route-selection-changed', {
    selectedVoterIds: Array.from(this.selectedVoterIds),
    count: this.selectedVoters.length
});

// 2. Map Controller listens and updates marker icons
stateManager.on('route-selection-changed', (data) => {
    mapController.updateAllMarkerIcons(data.selectedVoterIds);
});

// 3. Map marker clicks feed back to Route Planner
marker.addListener('click', () => {
    if (this.selectionMode && this.routePlannerController) {
        this.routePlannerController.toggleVoterSelection(voter);
    }
});
```

#### State Management Flow

```javascript
// Centralized state in StateManager
{
    filteredVoters: [...],           // All voters matching current filters
    routeSelectionMode: false,       // Is map selection active?
    selectedRouteVoters: [...],      // Voters selected for route
    selectedRouteVoterIds: Set(),    // Quick lookup set
    quotaStatus: {...}               // Current API quota data
}

// Controllers react to state changes
stateManager.subscribe((newState, oldState) => {
    if (newState.selectedRouteVoterIds !== oldState.selectedRouteVoterIds) {
        // Update UI elements across all controllers
        mapController.updateAllMarkerIcons(Array.from(newState.selectedRouteVoterIds));
        routePlannerController.updateSelectedVotersList();
    }
});
```

#### Modal-to-Map Sync Strategy

```javascript
// When modal selection confirmed:
confirmModalSelection() {
    // 1. Update route planner internal state
    this.selectedVoters = [...];
    this.selectedVoterIds = new Set([...]);
    
    // 2. Emit state change event
    this.stateManager.emit('route-selection-changed', ...);
    
    // 3. Map controller auto-updates via event listener
    // 4. Voter list controller auto-updates via event listener
}
```

---

## UI/UX Design

### 🎨 User Flows and Visual Feedback

#### User Flow A: Map-Based Selection

```
1. User clicks "Select from Map" button
   → Button turns green, shows "Selection Mode: ON"
   → Map cursor changes to crosshair
   → Toast: "Click markers to select voters"

2. User clicks on map marker
   → If unselected:
     - Marker icon changes from circle to star
     - Marker color changes to blue
     - Count badge updates: "3 / 50"
     - Voter appears in sidebar list
   → If already selected:
     - Marker reverts to circle
     - Removed from sidebar list
     - Count decrements

3. User reaches 50 voter limit
   → Remaining markers become semi-transparent (50% opacity)
   → Click on unselected marker shows toast: "Maximum 50 voters. Deselect others first."
   → Count badge turns yellow: "50 / 50"

4. User clicks "Calculate Route"
   → Selection mode automatically turns off
   → Button returns to "Select from Map"
   → Cursor returns to normal
```

#### User Flow B: List-Based Selection

```
1. User clicks "Select from List" button
   → Modal opens showing all geocoded voters
   → Previously selected voters have checkboxes pre-checked
   → Count badge shows current selection: "5 / 50"

2. User types in search box: "Main St"
   → List filters in real-time
   → Only voters with "Main St" in address shown
   → Selection count unchanged

3. User clicks "Select All (Visible)"
   → All visible voters get checked
   → Count updates: "12 / 50"
   → Once limit reached, remaining checkboxes disable

4. User clicks "Super Voters Only"
   → All current selections cleared
   → Up to 50 super voters auto-selected
   → List re-renders with super voters checked
   → Toast: "Selected 32 super voters"

5. User clicks "Confirm Selection"
   → Modal closes with fade animation
   → Map markers update to show selection
   → Sidebar list populates with selected voters
   → Toast: "32 voters selected for route"
```

#### Visual Feedback States

**Marker States**:
| State | Icon | Color | Scale |
|-------|------|-------|-------|
| Unselected Regular | Circle | Gray (#6c757d) | 8px |
| Unselected Super | Circle | Green (#198754) | 8px |
| Selected Regular | Star | Blue (#0d6efd) + Gray border | 10px |
| Selected Super | Star | Blue (#0d6efd) + Green border | 10px |
| Hover (unselected) | Circle | Same + glow | 10px (1.25x scale) |
| Hover (selected) | Star | Same + glow | 12px (1.2x scale) |
| Disabled (limit reached) | Circle | Same @ 50% opacity | 8px |

**Button States**:
| State | Class | Icon | Text |
|-------|-------|------|------|
| Selection Mode Off | btn-primary | bi-cursor | "Select from Map" |
| Selection Mode On | btn-success active | bi-check-circle | "Selection Mode: ON" |
| Disabled | btn-secondary disabled | bi-cursor | "Select from Map" |

**Count Badge**:
| State | Class | Example Text |
|-------|-------|--------------|
| 0 selected | badge bg-secondary | "0" |
| 1-49 selected | badge bg-primary | "25 / 50" |
| 50 selected | badge bg-warning text-dark | "50 / 50" |

### ♿ Accessibility Considerations

1. **Keyboard Navigation**:
   - Modal: Tab through checkboxes, Enter to toggle
   - Map: Arrow keys to navigate markers (existing feature)
   - Button: Space or Enter to toggle selection mode

2. **Screen Reader Support**:
   - ARIA labels on all interactive elements
   - Live regions announce selection changes
   - Modal has proper `aria-labelledby` and `aria-describedby`

3. **Visual Accessibility**:
   - Color not sole indicator (icons change too)
   - Minimum 3:1 contrast ratio on all text
   - Focus indicators on all interactive elements
   - Marker size meets minimum touch target (44x44px)

4. **Implementation**:
```html
<!-- Example ARIA implementation -->
<button id="selectFromMapVoters" 
        class="btn-primary"
        aria-pressed="false"
        aria-label="Toggle map selection mode">
    <i class="bi bi-cursor" aria-hidden="true"></i>
    <span>Select from Map</span>
</button>

<div id="selectionStatus" 
     class="visually-hidden" 
     role="status" 
     aria-live="polite" 
     aria-atomic="true">
    <!-- Announces changes like "3 voters selected" -->
</div>
```

### 📱 Mobile Considerations

1. **Touch Targets**:
   - Minimum 44x44px for markers
   - Increased marker scale on mobile: `scale: 10` instead of `scale: 8`

2. **Modal Optimization**:
   - Full-screen modal on small screens (< 768px)
   - Larger checkboxes (24x24px)
   - Search input with autocomplete="off" to prevent keyboard issues

3. **Gesture Support**:
   - Long-press on marker = toggle selection (alternative to click)
   - Swipe to close modal (Bootstrap default)

---

## Data Structures

### 📊 Data Models

#### Voter Object (from Database)
```javascript
{
    voterId: "12345",           // Primary key (also voter_id)
    firstName: "John",
    lastName: "Doe",
    address: "123 Main St",
    city: "Springfield",
    zipCode: "12345",
    latitude: 36.2639,
    longitude: -89.1929,
    precinct_number: "5-2",
    mostRecentParty: "D",
    superVoter: true,           // Also super_voter, is_super_voter
    participationRate: 0.85,
    phone: "(555) 123-4567",
    // ... other fields
}
```

#### Selected Voter Tracking
```javascript
class RoutePlannerController {
    // Array of full voter objects (for route calculation)
    selectedVoters = [
        { voterId: "12345", firstName: "John", ... },
        { voterId: "67890", firstName: "Jane", ... }
    ];
    
    // Set of IDs for O(1) lookup (for UI checks)
    selectedVoterIds = new Set(["12345", "67890"]);
    
    // Modal-specific temporary state (discarded on cancel)
    modalSelectedVoterIds = new Set(["12345"]);
    modalAvailableVoters = [...];  // Filtered list for modal
}
```

#### API Quota Status Response

**Backend Returns**:
```javascript
{
    success: true,
    quotas: {
        distance_matrix: {
            quota: 333,
            used: 45,
            remaining: 288,
            percentUsed: 13.5,
            cacheHitRate: 87.3,
            cacheHits: 89,
            cacheMisses: 13
        },
        geocoding: { ... },
        directions: { ... }
    },
    totalQuota: 1000,
    totalUsed: 150,
    totalRemaining: 850,
    averageCacheHitRate: 85.2,
    // Direct access (convenience):
    distance_matrix: { quota: 333, used: 45, ... }
}
```

**Frontend Expects** (after fix):
```javascript
// Two access patterns supported:
quotaStatus = data.distance_matrix;  // Direct (preferred)
// OR
quotaStatus = data.quotas.distance_matrix;  // Nested (fallback)

// Required properties:
{
    quota: 333,
    used: 45,
    remaining: 288,
    percentUsed: 13.5,
    cacheHitRate: 87.3
}
```

#### State Manager Schema
```javascript
{
    // Existing state
    filteredVoters: [...],      // From filters/search
    pagination: {...},
    
    // New route planning state
    routeSelection: {
        mode: false,            // Is selection mode active?
        voters: [...],          // Selected voter objects
        voterIds: Set(),        // Selected voter IDs
        count: 0                // Quick count
    },
    
    // Quota state
    quota: {
        distance_matrix: {...},
        lastUpdated: 1707695234000  // Timestamp
    }
}
```

---

## Dependencies and Requirements

### 📦 Existing Code to Reuse

| Component | File | What to Reuse |
|-----------|------|---------------|
| Voter Selection Logic | `voter-list-controller.js` | `selectedVoters` Set, `toggleVoterSelection()`, `updateSelectionCount()` |
| Marker System | `map-controller.js` | `updateMarkers()`, `getMarkerIcon()`, marker click listeners |
| Modal Infrastructure | `index.html`, Bootstrap 5 | Modal HTML structure, Bootstrap modal JS |
| State Management | `state-manager.js` | `emit()`, `subscribe()` for event coordination |
| Utilities | `utils.js` | `showToast()`, `escapeHtml()`, validation helpers |

### 🆕 New Code Required

| Feature | File | What to Add |
|---------|------|-------------|
| Selection Mode Toggle | `route-planner-controller.js` | `toggleSelectionMode()`, `selectionMode` state |
| Voter Toggle | `route-planner-controller.js` | `toggleVoterSelection(voter)`, limit enforcement |
| Marker Icon Update | `map-controller.js` | `updateMarkerIcon(voterId, selected)`, `updateAllMarkerIcons()` |
| Enhanced Icon Logic | `map-controller.js` | Modified `getMarkerIcon()` with `selected` parameter |
| Modal Controller | `route-planner-controller.js` | `openVoterSelectionModal()`, `renderModalVoterList()`, modal event handlers |
| Modal HTML | `index.html` | Full modal structure with search, checkboxes, action buttons |
| Quota Fix | `routes.js` | Add direct property access to response |
| Quota Parsing | `route-planner-controller.js` | Fix `updateQuotaWidget()`, add validation, error states |

### 🔌 External Dependencies (Already Available)

- **Bootstrap 5**: Modal system, list groups, badges
- **Google Maps JavaScript API**: Marker icons, click events (already loaded)
- **MarkerClusterer**: Cluster management (already integrated)
- **State Manager**: Custom event system (already implemented)

### 🚫 No New Dependencies Required

All features can be implemented with existing libraries and frameworks.

---

## Testing Approach

### 🧪 Manual Testing Checklist

#### Map Selection Tests

- [ ] **Test 1: Enable Selection Mode**
  - Click "Select from Map" button
  - Verify button turns green and says "Selection Mode: ON"
  - Verify map cursor changes to crosshair
  - Verify toast appears: "Click markers to select voters"

- [ ] **Test 2: Select Voter from Map**
  - In selection mode, click an unselected marker
  - Verify marker icon changes to blue star
  - Verify marker appears in sidebar "Selected Voters" list
  - Verify count badge updates (e.g., "1 / 50")

- [ ] **Test 3: Deselect Voter from Map**
  - Click a selected marker (blue star)
  - Verify marker reverts to circle icon
  - Verify voter removed from sidebar list
  - Verify count decrements

- [ ] **Test 4: 50 Voter Limit**
  - Select 50 voters via map
  - Try to select 51st voter
  - Verify toast warning appears
  - Verify voter is NOT selected
  - Verify count stays at "50 / 50"

- [ ] **Test 5: Selection Mode Toggle Off**
  - While in selection mode, click button again
  - Verify button returns to blue "Select from Map"
  - Verify cursor returns to normal
  - Verify clicking markers no longer selects (shows info window instead)

- [ ] **Test 6: Cluster Interaction**
  - Zoom out so markers cluster
  - Try clicking a cluster
  - Verify map zooms in to reveal individual markers
  - Verify can then select individual markers

#### Modal Selection Tests

- [ ] **Test 7: Open Voter Selection Modal**
  - Click "Select from List" button
  - Verify modal opens with fade animation
  - Verify all geocoded voters appear in list
  - Verify previously selected voters have checked checkboxes

- [ ] **Test 8: Search Functionality**
  - Type "Main St" in search box
  - Verify list filters to only show matching voters
  - Clear search box
  - Verify all voters reappear

- [ ] **Test 9: Select Voter via Checkbox**
  - Check a voter's checkbox
  - Verify count badge updates (e.g., "3 / 50")
  - Uncheck the voter
  - Verify count decrements

- [ ] **Test 10: Select All Visible**
  - Search for "Precinct 5"
  - Click "Select All" button
  - Verify all visible voters get checked
  - Verify count updates correctly
  - Verify hidden voters NOT selected

- [ ] **Test 11: Super Voters Only**
  - Click "Super Voters Only" button
  - Verify all super voters selected (up to 50)
  - Verify toast shows count
  - Verify count badge shows total

- [ ] **Test 12: Clear All Selection**
  - Select several voters
  - Click "Clear All" button
  - Verify all checkboxes unchecked
  - Verify count shows "0 / 50"

- [ ] **Test 13: Limit in Modal**
  - Select 50 voters in modal
  - Verify remaining checkboxes become disabled
  - Verify count badge shows "50 / 50" in yellow
  - Uncheck one voter
  - Verify previously disabled checkbox re-enables

- [ ] **Test 14: Confirm Selection**
  - Select 10 voters in modal
  - Click "Confirm Selection" button
  - Verify modal closes
  - Verify selected voters appear in sidebar list
  - Verify map markers update to blue stars
  - Verify toast: "10 voters selected for route"

- [ ] **Test 15: Cancel Selection**
  - Open modal, select voters
  - Click "Cancel" or X button
  - Verify modal closes
  - Verify selections NOT applied (sidebar unchanged)

#### Quota Widget Tests

- [ ] **Test 16: Initial Quota Load**
  - Refresh page
  - Wait for quota widget to load
  - Verify "Quota Used" shows number (not 0 unless actually 0)
  - Verify "Quota Total" shows correct limit
  - Verify progress bar width matches percentage
  - Verify "Cache Hit Rate" shows percentage

- [ ] **Test 17: Quota Widget Colors**
  - Mock quota at 50% used → verify bar is green
  - Mock quota at 75% used → verify bar is yellow
  - Mock quota at 95% used → verify bar is red

- [ ] **Test 18: Quota Update After Route Calculation**
  - Select voters and calculate route
  - Verify quota widget updates with new usage numbers
  - Verify usage increases by expected amount

- [ ] **Test 19: Quota Widget Error Handling**
  - Stop backend server
  - Refresh page quota widget
  - Verify error icon appears instead of zeros
  - Verify no JavaScript console errors

#### Integration Tests

- [ ] **Test 20: Map Selection → Modal Sync**
  - Select 5 voters via map
  - Open list modal
  - Verify those 5 voters have checked checkboxes
  - Add 3 more via modal
  - Confirm
  - Verify map shows 8 blue stars

- [ ] **Test 21: Modal Selection → Map Sync**
  - Open list modal
  - Select 10 voters
  - Confirm
  - Verify all 10 markers turn to blue stars on map

- [ ] **Test 22: Route Calculation with Selection**
  - Select 15 voters via map
  - Click "Calculate Route"
  - Verify route calculated successfully
  - Verify route includes all 15 voters
  - Verify quota widget updates

#### Performance Tests

- [ ] **Test 23: 1000+ Markers Performance**
  - Load 1000+ voters
  - Enable selection mode
  - Click markers rapidly
  - Verify no lag (< 100ms response)
  - Verify UI updates smoothly

- [ ] **Test 24: Modal with 5000+ Voters**
  - Load large voter dataset
  - Open selection modal
  - Verify modal opens in < 1 second
  - Type in search box
  - Verify filtering happens in real-time (< 300ms)

#### Edge Cases

- [ ] **Test 25: No Geocoded Voters**
  - Apply filters that result in 0 geocoded voters
  - Click "Select from Map"
  - Verify warning toast appears
  - Verify selection mode does not activate

- [ ] **Test 26: Single Voter Selection**
  - Filter to 1 voter
  - Open modal
  - Verify modal shows only that voter
  - Select and confirm
  - Verify works correctly

- [ ] **Test 27: Rapid Selection/Deselection**
  - Rapidly click same marker 10 times
  - Verify selection toggles consistently
  - Verify no duplicate entries in list
  - Verify count is accurate

#### Browser Compatibility

- [ ] **Test 28: Chrome** (all tests above)
- [ ] **Test 29: Firefox** (all tests above)
- [ ] **Test 30: Edge** (all tests above)
- [ ] **Test 31: Safari** (Mac only - all tests above)

#### Mobile Testing

- [ ] **Test 32: Mobile Map Selection**
  - Test on mobile device (or Chrome DevTools mobile emulation)
  - Tap markers to select
  - Verify touch targets are large enough (44x44px minimum)
  - Verify no accidental map drag when tapping markers

- [ ] **Test 33: Mobile Modal**
  - Open modal on mobile
  - Verify modal is full-screen or appropriately sized
  - Verify checkboxes are large enough to tap
  - Verify scrolling works smoothly

---

## Potential Risks and Mitigations

### ⚠️ Risk Assessment

#### Risk 1: Performance with 1000+ Markers

**Risk Level**: Medium

**Description**: Updating icon for every marker when using "Select All" in modal could cause UI lag with large datasets.

**Scenario**: User has 2000 voters loaded, selects all 50 in modal, clicks confirm.  
**Impact**: Map could freeze for 1-2 seconds while updating 2000+ marker icons.

**Mitigation Strategy**:
1. **Batch Updates**: Use `requestAnimationFrame` to batch icon updates
2. **Update Only Visible**: Only update markers currently visible in viewport
3. **Debounce**: Delay marker updates by 100ms after modal confirm
4. **Virtual Markers**: Consider using Canvas-based markers for large datasets

**Implementation**:
```javascript
updateAllMarkerIcons(selectedVoterIds) {
    const selectedSet = new Set(selectedVoterIds);
    const bounds = this.map.getBounds();
    
    // Only update visible markers immediately
    const visibleMarkers = this.markers.filter(m => 
        bounds.contains(m.getPosition())
    );
    
    requestAnimationFrame(() => {
        visibleMarkers.forEach(marker => {
            const voterId = (marker.voter.voterId || marker.voter.voter_id);
            marker.setIcon(this.getMarkerIcon(marker.voter, selectedSet.has(voterId)));
        });
    });
    
    // Update off-screen markers lazily
    setTimeout(() => {
        const offScreenMarkers = this.markers.filter(m => 
            !bounds.contains(m.getPosition())
        );
        offScreenMarkers.forEach(marker => {
            const voterId = (marker.voter.voterId || marker.voter_id);
            marker.setIcon(this.getMarkerIcon(marker.voter, selectedSet.has(voterId)));
        });
    }, 500);
}
```

---

#### Risk 2: Cluster Interaction Confusion

**Risk Level**: Medium

**Description**: Users might click on cluster expecting to select all voters in cluster, but instead map just zooms in.

**Scenario**: User sees cluster of 20 voters, clicks it, expects all 20 to be selected, but instead map zooms in.  
**Impact**: User confusion, unexpected behavior, repeated clicks.

**Mitigation Strategy**:
1. **Clear UI Messaging**: Add tooltip on clusters: "Zoom to see individual voters"
2. **Cluster Info Window**: Show number of voters in cluster on hover
3. **Alternative Action**: Hold Shift+Click to select all in cluster (advanced feature)
4. **Documentation**: Add help tooltip explaining cluster behavior

**Implementation**:
```javascript
// Add cluster click handler
markerClusterer.addListener('clusterclick', (cluster) => {
    if (this.selectionMode) {
        // Show info about cluster
        const count = cluster.getSize();
        const infoWindow = new google.maps.InfoWindow({
            content: `<strong>${count} voters</strong><br>
                      <small>Zoom in to select individual voters</small>`
        });
        infoWindow.setPosition(cluster.getCenter());
        infoWindow.open(this.map);
        
        // Auto-close after 3 seconds
        setTimeout(() => infoWindow.close(), 3000);
    }
});
```

---

#### Risk 3: Modal Search Performance

**Risk Level**: Low

**Description**: Searching through 5000+ voter list could cause input lag if search is not optimized.

**Scenario**: User types in search box with 5000 voters loaded.  
**Impact**: UI freezes, delayed input, poor user experience.

**Mitigation Strategy**:
1. **Debounce Input**: Only search after user stops typing for 150ms
2. **Limit Results**: Show max 100 results even if more match
3. **Virtual Scrolling**: Render only visible list items (e.g., using `IntersectionObserver`)
4. **Index Search**: Pre-build search index for faster lookups

**Implementation**:
```javascript
let searchTimeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const term = e.target.value;
        const filtered = this.searchVoters(term);
        const limited = filtered.slice(0, 100);  // Max 100 results
        this.renderModalVoterList(limited, term);
        
        if (filtered.length > 100) {
            this.showSearchResultsLimitedMessage(filtered.length);
        }
    }, 150);  // Debounce 150ms
});
```

---

#### Risk 4: Mobile Touch Target Size

**Risk Level**: Low

**Description**: Small markers might be hard to tap accurately on mobile devices (fat finger problem).

**Scenario**: User on mobile tries to select specific marker but accidentally selects adjacent marker.  
**Impact**: Wrong voters selected, frustration, need to deselect and retry.

**Mitigation Strategy**:
1. **Larger Touch Targets**: Increase marker scale on mobile to 12-14px
2. **Touch Halo**: Add invisible 44x44px click area around markers
3. **Zoom Requirement**: Require certain zoom level before allowing selection
4. **Confirmation Prompt**: Show voter name and "Confirm selection?" on first tap

**Implementation**:
```javascript
getMarkerIcon(voter, selected = false) {
    const isMobile = window.innerWidth < 768;
    const baseScale = isMobile ? 12 : 8;  // Larger on mobile
    
    // ... rest of icon logic ...
    
    return {
        scale: selected ? baseScale * 1.25 : baseScale,
        // ... other properties
    };
}

// Add touch halo for mobile
marker.addListener('click', (e) => {
    if (this.selectionMode) {
        if (isMobile && !this.lastConfirmedMarker === marker) {
            // First tap: show confirmation
            this.showMarkerConfirmation(marker, e.latLng);
            this.lastConfirmedMarker = marker;
        } else {
            // Second tap or desktop: toggle selection
            this.routePlannerController.toggleVoterSelection(marker.voter);
        }
    }
});
```

---

#### Risk 5: State Synchronization Issues

**Risk Level**: Medium

**Description**: If map selection and modal selection happen simultaneously, state could become inconsistent.

**Scenario**: User opens modal, starts selecting voters, then closes modal and uses map selection before confirming.  
**Impact**: Selections lost, confusing UI state, potential bugs.

**Mitigation Strategy**:
1. **Disable Map Selection While Modal Open**: Automatically exit selection mode when modal opens
2. **Modal State Isolation**: Modal uses separate `modalSelectedVoterIds` that only applies on confirm
3. **Clear Cancel Path**: Clicking "Cancel" resets modal state without affecting route planner
4. **State Validation**: Route planner validates selected voters before route calculation

**Implementation**:
```javascript
openVoterSelectionModal() {
    // Exit map selection mode if active
    if (this.selectionMode) {
        this.toggleSelectionMode();
    }
    
    // Create isolated modal state (copy of current selection)
    this.modalSelectedVoterIds = new Set(this.selectedVoterIds);
    
    // ... rest of modal logic
}

// Modal cancel = discard modal state
modalCancelBtn.addEventListener('click', () => {
    this.modalSelectedVoterIds = null;  // Discard changes
    modal.hide();
});

// Modal confirm = apply modal state
confirmVoterSelectionBtn.addEventListener('click', () => {
    this.selectedVoterIds = new Set(this.modalSelectedVoterIds);  // Apply changes
    // ... rest of confirm logic
});
```

---

#### Risk 6: API Quota Response Format Changes

**Risk Level**: Low

**Description**: If backend quota response format changes in future, widget could break again.

**Scenario**: Backend developer refactors quota-manager and changes response structure.  
**Impact**: Widget shows zeros or errors, no quota monitoring.

**Mitigation Strategy**:
1. **Defensive Parsing**: Try multiple access patterns with fallbacks
2. **Schema Validation**: Validate response against expected schema
3. **Graceful Degradation**: Show error state instead of crashing
4. **Contract Testing**: Add backend test to ensure response format stays consistent
5. **Documentation**: Document expected response format in both backend and frontend

**Implementation** (already included in quota fix):
```javascript
// Multiple fallback paths
quotaStatus = data.distance_matrix ||         // Direct property
              data.quotas?.distance_matrix || // Nested property
              null;                           // Fallback to null

// Property validation
const requiredProps = ['used', 'quota', 'percentUsed', 'cacheHitRate'];
const isValid = requiredProps.every(prop => 
    quotaStatus?.hasOwnProperty(prop)
);

if (!isValid) {
    Logger.warn('Invalid quota response format:', data);
    this.showQuotaWidgetError('Unexpected data format');
    return;
}
```

---

#### Risk 7: Browser Compatibility (Older Browsers)

**Risk Level**: Very Low

**Description**: Some features use modern JavaScript (Set, Map, arrow functions) that won't work in IE11.

**Scenario**: User on very old browser tries to use app.  
**Impact**: JavaScript errors, features don't work.

**Mitigation Strategy**:
1. **Browser Detection**: Show warning on old browsers: "Please upgrade to modern browser"
2. **Polyfills**: Include polyfills for Set, Map if supporting older browsers
3. **Progressive Enhancement**: Core features work, advanced features degrade gracefully
4. **Transpilation**: Use Babel to transpile ES6+ to ES5 if needed

**Decision**: Based on project requirements, recommend **NOT** supporting IE11 (EOL June 2022). Target modern evergreen browsers only (Chrome, Firefox, Edge, Safari).

---

## Success Criteria

### ✅ How to Verify It Works

#### Functional Success Criteria

1. **Map Selection Works**
   - [ ] Users can toggle selection mode on/off
   - [ ] Clicking markers selects/deselects voters
   - [ ] Selected markers visually distinct (blue stars)
   - [ ] Selection count updates in real-time
   - [ ] 50 voter limit enforced with warning

2. **Modal Selection Works**
   - [ ] Modal opens showing all geocoded voters
   - [ ] Search filters list in real-time
   - [ ] Checkboxes select/deselect voters
   - [ ] "Select All", "Super Voters Only", "Clear All" buttons work
   - [ ] Confirm applies selection, Cancel discards changes
   - [ ] Limit enforced (checkboxes disable at 50)

3. **Map-Modal Sync Works**
   - [ ] Selections made in map appear in modal (when opened)
   - [ ] Selections made in modal update map markers (on confirm)
   - [ ] Count badge consistent across all UI elements

4. **Quota Widget Works**
   - [ ] Widget loads initial quota data on page load
   - [ ] Usage numbers displayed correctly (not zeros)
   - [ ] Progress bar width matches percentage
   - [ ] Progress bar color changes based on usage level
   - [ ] Cache hit rate displayed
   - [ ] Widget updates after route calculation
   - [ ] Error state shown if API fails

#### User Experience Success Criteria

5. **Visual Feedback**
   - [ ] All interactions have immediate visual feedback (< 100ms)
   - [ ] Toast notifications appear for important actions
   - [ ] Hover states work on all interactive elements
   - [ ] Selection count always visible and accurate

6. **Performance**
   - [ ] Modal opens in < 1 second even with 5000+ voters
   - [ ] Search filtering completes in < 300ms
   - [ ] Marker icon updates render in < 200ms
   - [ ] No UI freezing or jank during rapid interactions

7. **Accessibility**
   - [ ] All interactive elements keyboard accessible
   - [ ] Screen reader announces selection changes
   - [ ] Focus indicators visible
   - [ ] Modal can be closed with Esc key

#### Technical Success Criteria

8. **Code Quality**
   - [ ] No JavaScript errors in console
   - [ ] No memory leaks (event listeners cleaned up)
   - [ ] Code follows existing project patterns
   - [ ] Functions have descriptive names and comments

9. **Browser Compatibility**
   - [ ] Works in Chrome (latest)
   - [ ] Works in Firefox (latest)
   - [ ] Works in Edge (latest)
   - [ ] Works in Safari (latest)

10. **Mobile Compatibility**
    - [ ] Touch targets meet minimum 44x44px
    - [ ] Modal usable on small screens
    - [ ] No horizontal scrolling
    - [ ] Gestures work (tap to select, swipe to close modal)

---

### 📈 Metrics for Success

**Before Implementation**:
- Voter selection: 0% user control (auto-selects first 50)
- Quota widget: 0% uptime (broken)
- User complaints: "Can't choose which voters to include"

**After Implementation**:
- Voter selection: 100% user control (both map and list)
- Quota widget: 100% uptime (displays correctly)
- User feedback: "Love the new selection features!"

**Quantitative Metrics**:
- Time to select 25 voters: < 30 seconds (map) or < 60 seconds (list)
- Modal load time with 1000 voters: < 1 second
- Quota widget update time: < 500ms
- User selection satisfaction: > 90% (via feedback survey)

---

## Research Sources

### 📚 Credible Sources Consulted

This specification is based on research from the following authoritative sources:

#### 1. Google Maps JavaScript API Documentation
**Source**: [developers.google.com/maps/documentation/javascript](https://developers.google.com/maps/documentation/javascript/reference/3.62)  
**Relevance**: Marker events, icon customization, click event handling  
**Key Findings**:
- Markers support `click`, `mouseover`, `mouseout` events
- Icons can be customized using `path`, `fillColor`, `scale`, `strokeColor`
- Marker icon can be updated dynamically with `marker.setIcon()`
- Best practice: Use `SymbolPath.CIRCLE` for default markers, `SymbolPath.FORWARD_CLOSED_ARROW` for special states

#### 2. Google Maps MarkerClusterer Library
**Source**: [github.com/googlemaps/js-markerclusterer](https://github.com/googlemaps/js-markerclusterer)  
**Relevance**: Handling marker selection within clusters  
**Key Findings**:
- Clustering affects individual marker access
- Best practice: Zoom in to reveal markers before allowing selection
- `onClusterClick` event can be used to provide feedback
- Markers remain accessible via `getMarkers()` even when clustered

#### 3. Bootstrap 5 Modal Component Documentation
**Source**: [getbootstrap.com/docs/5.3/components/modal](https://getbootstrap.com/docs/5.3/components/modal)  
**Relevance**: Modal structure, scrollable content, accessibility  
**Key Findings**:
- `modal-dialog-scrollable` enables internal scrolling
- `data-bs-dismiss="modal"` for close buttons
- Modal should have `aria-labelledby` and `aria-hidden` attributes
- Best practice: Use `modal-lg` for list-heavy modals

#### 4. Bootstrap 5 List Group with Checkboxes
**Source**: [getbootstrap.com/docs/5.3/components/list-group](https://getbootstrap.com/docs/5.3/components/list-group)  
**Relevance**: Checkbox list UI pattern  
**Key Findings**:
- `list-group` + `form-check` for checkbox lists
- `.stretched-link` makes entire list item clickable
- `list-group-flush` removes borders for cleaner modal appearance

#### 5. Web Accessibility Initiative (WAI) - ARIA Best Practices
**Source**: [w3.org/WAI/ARIA/apg](https://www.w3.org/WAI/ARIA/apg/)  
**Relevance**: Accessible modal dialogs, live regions, selection patterns  
**Key Findings**:
- Use `role="status"` with `aria-live="polite"` for selection announcements
- Modal dialogs need `role="dialog"` and `aria-modal="true"`
- Interactive elements need minimum 44x44px touch targets (WCAG 2.1 Level AAA)
- Focus should trap within modal while open

#### 6. Nielsen Norman Group - Selection Mechanisms in UI
**Source**: [nngroup.com/articles/checkboxes-vs-radio-buttons](https://www.nngroup.com/articles/checkboxes-vs-radio-buttons/)  
**Relevance**: Multi-selection UX patterns  
**Key Findings**:
- Checkboxes best for multi-select (vs radio buttons for single-select)
- Provide "Select All" / "Clear All" for efficiency
- Show running count of selections during interaction
- Confirm actions with explicit button (not auto-submit)

#### 7. Google Maps Platform - Best Practices for Custom Markers
**Source**: [developers.google.com/maps/documentation/javascript/custom-markers](https://developers.google.com/maps/documentation/javascript/custom-markers)  
**Relevance**: Marker icon performance, accessibility  
**Key Findings**:
- Use SVG paths for scalable icons (better than PNG)
- Set `optimized: true` for better performance with many markers
- Limit marker complexity for performance (simple shapes preferred)
- Consider Canvas-based markers for 10,000+ markers

#### 8. MDN Web Docs - Event Debouncing
**Source**: [developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Debouncing_and_throttling](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Debouncing_and_throttling)  
**Relevance**: Search input performance  
**Key Findings**:
- Debounce search input by 150-300ms for optimal UX
- Use `setTimeout` and `clearTimeout` for simple debouncing
- Prevents excessive re-renders during typing

#### 9. Web Content Accessibility Guidelines (WCAG) 2.1
**Source**: [w3.org/WAI/WCAG21/quickref](https://www.w3.org/WAI/WCAG21/quickref/)  
**Relevance**: Touch target sizes, color contrast, keyboard navigation  
**Key Findings**:
- Level AAA: Touch targets minimum 44x44 CSS pixels
- Level AA: Color contrast minimum 3:1 for UI elements
- All interactive elements must be keyboard accessible
- Provide visible focus indicators

#### 10. Progressive Enhancement Strategy
**Source**: [developer.mozilla.org/en-US/docs/Glossary/Progressive_Enhancement](https://developer.mozilla.org/en-US/docs/Glossary/Progressive_Enhancement)  
**Relevance**: Graceful degradation for older browsers  
**Key Findings**:
- Build core functionality first, then enhance
- Detect feature support before using (e.g., `Set`, `Map`)
- Provide fallbacks or polyfills for critical features
- Show helpful error messages on unsupported browsers

---

### 🔍 Additional Research Context

**Codebase Analysis**: Reviewed existing voter platform files to understand:
- Current state management patterns
- Existing controller architecture
- Modal usage patterns
- Error handling conventions

**Performance Benchmarks**: Based on industry standards:
- Modal should open < 1 second (source: Google Web Vitals)
- UI updates should complete < 100ms for "instant" feel (source: Jakob Nielsen's Response Time research)
- Search filtering < 300ms acceptable (source: Human-Computer Interaction Guidelines)

---

## Conclusion

This specification provides a complete roadmap for implementing:
1. ✅ Interactive map marker selection with visual feedback
2. ✅ Modal list selection with search and bulk actions
3. ✅ API quota widget fix with proper data parsing

The solution leverages existing infrastructure (voter list controller selection, map marker system, Bootstrap modals) while adding new interactive capabilities that give users full control over route planning.

**Implementation Priority**: Recommend implementing in phases as specified:
- **Phase 1**: Map marker selection (highest user impact)
- **Phase 2**: Modal list selection (complementary to Phase 1)
- **Phase 3**: Quota widget fix (low effort, high value)

**Estimated Effort**:
- Phase 1: 6-8 hours (map selection)
- Phase 2: 8-10 hours (modal selection)
- Phase 3: 2-3 hours (quota fix)
- **Total**: 16-21 hours development + 4-6 hours testing = **20-27 hours**

---

**Specification Version**: 1.0  
**Ready for Implementation**: ✅ Yes  
**Next Step**: Begin Phase 1 implementation with map marker selection feature.
