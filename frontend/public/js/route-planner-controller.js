/**
 * Route Planning Controller
 * Phase 5: Route optimization for canvassing operations
 * 
 * Features:
 * - Voter selection for route planning
 * - Travel mode selection (walking, driving, bicycling)
 * - Route optimization algorithms
 * - Visual route display on map
 * - Turn-by-turn directions
 * - API quota monitoring
 */

class RoutePlannerController {
    constructor(mapController, voterService, stateManager) {
        this.mapController = mapController;
        this.voterService = voterService;
        this.stateManager = stateManager;
        
        this.selectedVoters = [];
        this.selectedVoterIds = new Set();  // Quick lookup for selections
        this.selectionMode = false;  // Map selection mode toggle
        this.currentRoute = null;
        this.routePath = null;
        this.routeMarkers = [];
        
        // Modal-specific state (temporary until confirmed)
        this.modalAvailableVoters = [];
        this.modalSelectedVoterIds = new Set();
        this.voterSelectionModal = null;
        
        this.init();
    }

    /**
     * Initialize the route planner
     */
    async init() {
        Logger.info('📍 Initializing Route Planner Controller...');
        
        // Bind event listeners
        this.bindEventListeners();
        
        // Load quota status
        await this.updateQuotaWidget();
        
        // Periodic quota refresh every 5 minutes
        this.quotaRefreshInterval = setInterval(() => {
            this.updateQuotaWidget();
        }, 5 * 60 * 1000);
        
        Logger.info('✅ Route Planner Controller initialized');
    }

    /**
     * Bind UI event listeners
     */
    bindEventListeners() {
        const calculateBtn = document.getElementById('calculateRoute');
        const selectFromMapBtn = document.getElementById('selectFromMapVoters');
        const selectFromListBtn = document.getElementById('selectFromListVoters');
        const clearSelectionBtn = document.getElementById('clearRouteSelection');
        
        // Export button listeners
        const exportCSVBtn = document.getElementById('exportCSV');
        const exportGoogleMapsBtn = document.getElementById('exportGoogleMaps');
        
        if (calculateBtn) {
            calculateBtn.addEventListener('click', () => this.calculateRoute());
        }
        
        if (selectFromMapBtn) {
            selectFromMapBtn.addEventListener('click', () => this.toggleSelectionMode());
        }
        
        if (selectFromListBtn) {
            selectFromListBtn.addEventListener('click', () => this.openVoterSelectionModal());
        }
        
        if (clearSelectionBtn) {
            clearSelectionBtn.addEventListener('click', () => this.clearSelection());
        }
        
        // Bind export buttons
        if (exportCSVBtn) {
            exportCSVBtn.addEventListener('click', () => this.exportToCSV());
        }
        
        if (exportGoogleMapsBtn) {
            exportGoogleMapsBtn.addEventListener('click', () => this.openExportModal());
        }
    }

    /**
     * Toggle map selection mode on/off
     */
    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        
        const mapBtn = document.getElementById('selectFromMapVoters');
        if (this.selectionMode) {
            mapBtn.classList.add('active', 'btn-success');
            mapBtn.classList.remove('btn-primary');
            mapBtn.innerHTML = '<i class="bi bi-check-circle"></i> Selection Mode: ON';
            mapBtn.setAttribute('aria-pressed', 'true');
            Utils.showToast('Click markers on map to select/deselect voters', 'info');
        } else {
            mapBtn.classList.remove('active', 'btn-success');
            mapBtn.classList.add('btn-primary');
            mapBtn.innerHTML = '<i class="bi bi-cursor"></i> Select from Map';
            mapBtn.setAttribute('aria-pressed', 'false');
        }
        
        // Update map cursor
        this.mapController.setSelectionCursor(this.selectionMode);
    }

    /**
     * Toggle individual voter selection (called from map marker clicks)
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
        
        // Update state for route selection
        this.stateManager.setState({
            routing: {
                selectedVoterIds: Array.from(this.selectedVoterIds),
                count: this.selectedVoters.length
            }
        });
    }

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
        
        // Show modal using custom Modal class (not Bootstrap)
        const modalElement = document.getElementById('routeVoterSelectionModal');
        if (modalElement) {
            // Use custom Modal class from ui-components.js
            if (!this.voterSelectionModal) {
                Logger.info('Creating new Modal instance for voter selection');
                this.voterSelectionModal = new Modal('routeVoterSelectionModal');
            }
            
            Logger.info('Showing voter selection modal');
            this.voterSelectionModal.show();
            
            // Bind modal event listeners (only once)
            if (!this.modalListenersBound) {
                Logger.info('Binding modal event listeners');
                this.bindModalEventListeners();
                this.modalListenersBound = true;
            }
        } else {
            Logger.error('routeVoterSelectionModal element not found in DOM');
            Utils.showToast('Error opening voter selection modal', 'danger');
        }
    }

    /**
     * Render voter list in modal with performance optimizations
     * @param {Array} voters - Voters to display
     * @param {string} searchTerm - Search filter
     */
    async renderModalVoterList(voters, searchTerm = '') {
        const listContainer = document.getElementById('voterSelectionList');
        
        if (!listContainer) return;
        
        try {
            // Filter by search term
            let filteredVoters = voters;
            if (searchTerm) {
                const term = searchTerm.toLowerCase();
                filteredVoters = voters.filter(v => {
                    const fullName = `${v.firstName} ${v.lastName}`.toLowerCase();
                    const address = (v.address || '').toLowerCase();
                    const precinct = (v.precinctNumber || v.precinct_number || '').toString();
                    return fullName.includes(term) || 
                           address.includes(term) || 
                           precinct.includes(term);
                });
            }
            
            // Filter out voters with invalid IDs
            filteredVoters = filteredVoters.filter(v => {
                const voterId = v.voterId || v.voter_id;
                return voterId !== undefined && voterId !== null;
            });
            
            // Handle empty state
            if (filteredVoters.length === 0) {
                listContainer.innerHTML = `
                    <li class="px-6 py-8 text-center text-secondary-500 dark:text-secondary-400">
                        No voters found${searchTerm ? ` matching "${this.escapeHtml(searchTerm)}"` : ''}
                    </li>
                `;
                this.updateModalSelectionCount();
                return;
            }
            
            // PERFORMANCE: Use chunked rendering for large lists
            if (filteredVoters.length > 100) {
                await this.renderLargeVoterList(listContainer, filteredVoters);
            } else {
                // Standard rendering for small lists
                this.renderSmallVoterList(listContainer, filteredVoters);
            }
            
            this.updateModalSelectionCount();
        } catch (error) {
            Logger.error('Error rendering voter list:', error);
            listContainer.innerHTML = `
                <li class="px-6 py-8 text-center text-danger-600 dark:text-danger-400">
                    <i class="bi bi-exclamation-triangle"></i>
                    Error displaying voters. Please try again.
                </li>
            `;
        }
    }
    
    /**
     * Render small voter lists (< 100 voters) synchronously
     */
    renderSmallVoterList(listContainer, voters) {
        const html = voters.map(voter => this.createVoterListItemHTML(voter)).join('');
        listContainer.innerHTML = html;
    }
    
    /**
     * Render large voter lists (>= 100 voters) in chunks to prevent UI freeze
     */
    async renderLargeVoterList(listContainer, voters) {
        // Show loading state
        listContainer.innerHTML = `
            <li class="px-6 py-8 text-center text-secondary-500 dark:text-secondary-400">
                <div class="inline-block animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full"></div>
                <p class="mt-2">Loading ${voters.length} voters...</p>
            </li>
        `;
        
        // Render in chunks to avoid blocking UI
        const CHUNK_SIZE = 50;
        const fragments = [];
        
        for (let i = 0; i < voters.length; i += CHUNK_SIZE) {
            const chunk = voters.slice(i, i + CHUNK_SIZE);
            const chunkHTML = chunk.map(voter => this.createVoterListItemHTML(voter)).join('');
            fragments.push(chunkHTML);
            
            // Yield to browser between chunks
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        // Insert all at once
        listContainer.innerHTML = fragments.join('');
    }
    
    /**
     * Create HTML for a single voter list item
     * Extracted to avoid duplication
     */
    createVoterListItemHTML(voter) {
        const voterId = voter.voterId || voter.voter_id;
        const isSelected = this.modalSelectedVoterIds.has(voterId);
        const isSuperVoter = voter.superVoter || voter.super_voter || voter.is_super_voter;
        const isDisabled = !isSelected && this.modalSelectedVoterIds.size >= 50;
        
        return `
            <li class="px-6 py-4 hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-colors">
                <div class="flex items-start gap-3">
                    <input class="voter-checkbox mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded" 
                           type="checkbox" 
                           value="${this.escapeHtml(voterId.toString())}" 
                           id="voter-${this.escapeHtml(voterId.toString())}"
                           ${isSelected ? 'checked' : ''}
                           ${isDisabled ? 'disabled' : ''}>
                    <label class="flex-1 cursor-pointer" for="voter-${this.escapeHtml(voterId.toString())}">
                        <div class="flex justify-between items-start gap-4">
                            <div class="flex-1">
                                <div class="font-semibold text-secondary-900 dark:text-white">
                                    ${this.escapeHtml(voter.lastName)}, ${this.escapeHtml(voter.firstName)}
                                    ${isSuperVoter ? '<span class="ml-2 px-2 py-0.5 text-xs font-semibold rounded bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300">Super</span>' : ''}
                                </div>
                                <div class="mt-1 text-sm text-secondary-600 dark:text-secondary-400">
                                    ${this.escapeHtml(voter.address || 'N/A')} • 
                                    Precinct ${this.escapeHtml((voter.precinctNumber || voter.precinct_number || 'N/A').toString())}
                                </div>
                            </div>
                            <span class="px-2 py-1 text-xs font-semibold rounded bg-secondary-100 text-secondary-700 dark:bg-secondary-700 dark:text-secondary-300">
                                ${this.escapeHtml(voter.mostRecentParty || 'N/A')}
                            </span>
                        </div>
                    </label>
                </div>
            </li>
        `;
    }

    /**
     * Bind modal interaction event listeners
     */
    bindModalEventListeners() {
        const modal = document.getElementById('routeVoterSelectionModal');
        if (!modal) return;
        
        // Search input with debouncing
        const searchInput = document.getElementById('voterSelectionSearchInput');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.renderModalVoterList(this.modalAvailableVoters, e.target.value);
                }, 150); // 150ms debounce
            });
        }
        
        // Checkbox changes - DEBOUNCED to prevent excessive re-renders
        let updateTimeout = null;
        modal.addEventListener('change', (e) => {
            if (e.target.classList.contains('voter-checkbox')) {
                try {
                    const voterId = e.target.value;
                    
                    // Validate voter ID
                    if (!voterId || voterId === 'undefined' || voterId === 'null') {
                        Logger.warn('Invalid voter ID in checkbox:', voterId);
                        return;
                    }
                    
                    // Update state immediately
                    if (e.target.checked) {
                        this.modalSelectedVoterIds.add(voterId);
                    } else {
                        this.modalSelectedVoterIds.delete(voterId);
                    }
                    
                    // Update count immediately (no re-render needed)
                    this.updateModalSelectionCount();
                    
                    // DEBOUNCED: Only re-render if no more changes within 100ms
                    clearTimeout(updateTimeout);
                    updateTimeout = setTimeout(() => {
                        const searchTerm = searchInput ? searchInput.value : '';
                        this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
                    }, 100);
                    
                } catch (error) {
                    Logger.error('Error handling checkbox change:', error);
                    Utils.showToast('Error updating selection', 'danger');
                }
            }
        });
        
        // Select All Visible
        const selectAllBtn = document.getElementById('selectAllVisibleBtn');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                try {
                    const visibleCheckboxes = document.querySelectorAll('.voter-checkbox:not(:disabled)');
                    const remainingSlots = 50 - this.modalSelectedVoterIds.size;
                    
                    let added = 0;
                    visibleCheckboxes.forEach(checkbox => {
                        const voterId = checkbox.value;
                        if (!checkbox.checked && voterId && voterId !== 'undefined' && added < remainingSlots) {
                            this.modalSelectedVoterIds.add(voterId);
                            added++;
                        }
                    });
                    
                    const searchTerm = searchInput ? searchInput.value : '';
                    this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
                    
                    if (added > 0) {
                        Utils.showToast(`Selected ${added} additional voters`, 'success');
                    } else if (remainingSlots === 0) {
                        Utils.showToast('Already at 50 voter limit', 'info');
                    } else {
                        Utils.showToast('No additional voters to select', 'info');
                    }
                } catch (error) {
                    Logger.error('Error selecting all visible voters:', error);
                    Utils.showToast('Failed to select voters. Please try again.', 'danger');
                }
            });
        }
        
        // Select Super Voters Only
        const selectSupersBtn = document.getElementById('selectSupersOnlyBtn');
        if (selectSupersBtn) {
            selectSupersBtn.addEventListener('click', async () => { // NOW ASYNC
                Logger.info('🌟 Super Voters button clicked');
                
                // Disable button to prevent double-clicks
                selectSupersBtn.disabled = true;
                const originalHTML = selectSupersBtn.innerHTML;
                selectSupersBtn.innerHTML = '<i class="bi bi-hourglass-split animate-spin"></i> <span>Loading...</span>';
                
                try {
                    // Filter for super voters with valid IDs
                    const superVoters = this.modalAvailableVoters
                        .filter(v => {
                            const isSuperVoter = v.superVoter || v.super_voter || v.is_super_voter;
                            const hasValidId = (v.voterId || v.voter_id) !== undefined && (v.voterId || v.voter_id) !== null;
                            return isSuperVoter && hasValidId;
                        })
                        .slice(0, 50);
                    
                    Logger.info('Super voters found:', superVoters.length);
                    
                    if (superVoters.length === 0) {
                        Utils.showToast('No super voters found in filtered results', 'warning');
                        return;
                    }
                    
                    // Clear current selection
                    this.modalSelectedVoterIds.clear();
                    
                    // Add super voters
                    superVoters.forEach(v => {
                        const voterId = v.voterId || v.voter_id;
                        if (voterId !== undefined && voterId !== null) {
                            this.modalSelectedVoterIds.add(voterId);
                        }
                    });
                    
                    Logger.info('Total selected:', this.modalSelectedVoterIds.size);
                    
                    // Re-render with async chunking (prevents UI freeze)
                    const searchTerm = searchInput ? searchInput.value : '';
                    await this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
                    
                    Utils.showToast(`Selected ${this.modalSelectedVoterIds.size} super voters`, 'success');
                    Logger.info('✅ Super Voters selection completed successfully');
                } catch (error) {
                    Logger.error('❌ Error selecting super voters:', error);
                    Utils.showToast('Failed to select super voters. Please try again.', 'danger');
                } finally {
                    // Re-enable button
                    selectSupersBtn.disabled = false;
                    selectSupersBtn.innerHTML = originalHTML;
                }
            });
        } else {
            Logger.warn('selectSupersOnlyBtn not found in DOM');
        }
        
        // Clear All
        const clearModalBtn = document.getElementById('clearModalSelectionBtn');
        if (clearModalBtn) {
            clearModalBtn.addEventListener('click', () => {
                this.modalSelectedVoterIds.clear();
                const searchTerm = searchInput ? searchInput.value : '';
                this.renderModalVoterList(this.modalAvailableVoters, searchTerm);
            });
        }
        
        // Confirm Selection
        const confirmBtn = document.getElementById('confirmVoterSelectionBtn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                this.confirmModalSelection();
            });
        }
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
        if (this.voterSelectionModal) {
            this.voterSelectionModal.hide();
        }
        
        Utils.showToast(`${selectedVoters.length} voters selected for route`, 'success');
        
        // Update state for route selection
        this.stateManager.setState({
            routing: {
                selectedVoterIds: Array.from(this.selectedVoterIds),
                count: this.selectedVoters.length
            }
        });
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = text.toString();
        return div.innerHTML;
    }

    /**
     * Clear voter selection
     */
    clearSelection() {
        this.selectedVoters = [];
        this.selectedVoterIds.clear();
        this.updateSelectedVotersList();
        this.clearRouteDisplay();
        
        // Turn off selection mode if active
        if (this.selectionMode) {
            this.toggleSelectionMode();
        }
        
        // Clear map marker selected states
        this.mapController.updateAllMarkerIcons([]);
        
        Utils.showToast('Selection cleared', 'info');
    }

    /**
     * Update the selected voters list UI
     */
    updateSelectedVotersList() {
        const listElement = document.getElementById('selectedVotersList');
        const countElement = document.getElementById('selectedVotersCount');
        
        if (!listElement || !countElement) return;
        
        countElement.textContent = this.selectedVoters.length;
        
        // Show first 10 voters
        const displayVoters = this.selectedVoters.slice(0, 10);
        
        listElement.innerHTML = displayVoters.map(v => `
            <li class="selected-voter-item">
                ${v.lastName}, ${v.firstName}
                <small>${v.address || v.residential_address}</small>
            </li>
        `).join('');
        
        if (this.selectedVoters.length > 10) {
            listElement.innerHTML += `<li class="text-muted">...and ${this.selectedVoters.length - 10} more</li>`;
        }
    }

    /**
     * Calculate optimized route
     */
    async calculateRoute() {
        if (this.selectedVoters.length === 0) {
            Utils.showToast('Please select voters first', 'warning');
            return;
        }
        
        const mode = document.getElementById('travelMode')?.value || 'walking';
        const algorithm = document.getElementById('routeAlgorithm')?.value || 'hybrid';
        const startLocationInput = document.getElementById('startLocation')?.value;
        
        try {
            // Show loading state
            const calculateBtn = document.getElementById('calculateRoute');
            const originalText = calculateBtn.textContent;
            calculateBtn.disabled = true;
            calculateBtn.textContent = 'Calculating...';
            
            // Get start location (use map center if not specified)
            let startLocation;
            if (startLocationInput && startLocationInput.trim() !== '') {
                // TODO: Geocode the address - for now, use map center
                const mapCenter = this.mapController.map.getCenter();
                startLocation = {
                    lat: mapCenter.lat(),
                    lng: mapCenter.lng()
                };
            } else {
                // Use first voter location as start
                startLocation = {
                    lat: this.selectedVoters[0].latitude,
                    lng: this.selectedVoters[0].longitude
                };
            }
            
            // Build request
            const voterIds = this.selectedVoters.map(v => v.voterId || v.voter_id);
            
            const response = await fetch('/api/routes/calculate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    voterIds,
                    startLocation,
                    mode,
                    algorithm
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Route calculation failed');
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Route calculation failed');
            }
            
            // Store and display route
            this.currentRoute = data.route;
            this.displayRoute(data.route);
            this.updateQuotaWidget(data.quotaStatus);
            
            Utils.showToast('Route calculated successfully', 'success');
            
            // Restore button
            calculateBtn.disabled = false;
            calculateBtn.textContent = originalText;
            
        } catch (error) {
            Logger.error('Route calculation error:', error);
            Utils.showToast(`Error: ${error.message}`, 'error');
            
            document.getElementById('calculateRoute').disabled = false;
            document.getElementById('calculateRoute').textContent = 'Calculate Route';
        }
    }

    /**
     * Display route on map and in UI
     */
    displayRoute(route) {
        if (!route || !route.locations) {
            Logger.error('Invalid route data');
            return;
        }
        
        // Show results section
        const resultsSection = document.getElementById('routeResults');
        if (resultsSection) {
            resultsSection.classList.remove('hidden');
        }
        
        // Update stats
        this.updateRouteStats(route);
        
        // Draw route on map
        this.drawRouteOnMap(route.locations);
        
        // Generate turn-by-turn directions
        this.displayDirections(route.locations);
    }

    /**
     * Update route statistics in UI
     */
    updateRouteStats(route) {
        const distanceElem = document.getElementById('totalDistance');
        const durationElem = document.getElementById('totalDuration');
        const stopCountElem = document.getElementById('stopCount');
        const efficiencyElem = document.getElementById('routeEfficiency');
        
        if (distanceElem) {
            const miles = (route.totalDistance / 1609.34).toFixed(2);
            distanceElem.textContent = `${miles} miles`;
        }
        
        if (durationElem) {
            const minutes = Math.round(route.totalDuration / 60);
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            durationElem.textContent = hours > 0 
                ? `${hours}h ${mins}min` 
                : `${mins} min`;
        }
        
        if (stopCountElem) {
            stopCountElem.textContent = route.locations.length;
        }
        
        if (efficiencyElem && route.metrics) {
            efficiencyElem.textContent = `${(route.metrics.routeEfficiency * 100).toFixed(0)}%`;
        }
    }

    /**
     * Draw route on map
     */
    drawRouteOnMap(locations) {
        // Clear existing route
        this.clearRouteDisplay();
        
        if (!this.mapController.map || locations.length === 0) {
            return;
        }
        
        // Draw polyline
        const path = locations.map(loc => ({
            lat: loc.lat,
            lng: loc.lng
        }));
        
        this.routePath = new google.maps.Polyline({
            path: path,
            geodesic: true,
            strokeColor: '#4285F4',
            strokeOpacity: 1.0,
            strokeWeight: 3
        });
        
        this.routePath.setMap(this.mapController.map);
        
        // Add numbered markers
        this.routeMarkers = locations.map((loc, idx) => {
            const marker = new google.maps.Marker({
                position: { lat: loc.lat, lng: loc.lng },
                map: this.mapController.map,
                label: {
                    text: (idx + 1).toString(),
                    color: 'white',
                    fontWeight: 'bold'
                },
                title: `${loc.lastName}, ${loc.firstName} - ${loc.address}`,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: '#4285F4',
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: '#ffffff',
                    scale: 12
                }
            });
            
            return marker;
        });
        
        // Fit map to route bounds
        const bounds = new google.maps.LatLngBounds();
        locations.forEach(loc => bounds.extend({ lat: loc.lat, lng: loc.lng }));
        this.mapController.map.fitBounds(bounds);
    }

    /**
     * Display turn-by-turn directions
     */
    displayDirections(locations) {
        const directionsElem = document.getElementById('routeDirections');
        
        if (!directionsElem) return;
        
        directionsElem.innerHTML = locations.map((loc, idx) => `
            <li class="route-direction-item">
                <strong>Stop ${idx + 1}:</strong> ${loc.lastName}, ${loc.firstName}<br>
                <small>${loc.address || loc.residential_address}</small>
            </li>
        `).join('');
    }

    /**
     * Clear route display from map
     */
    clearRouteDisplay() {
        // Remove polyline
        if (this.routePath) {
            this.routePath.setMap(null);
            this.routePath = null;
        }
        
        // Remove markers
        this.routeMarkers.forEach(marker => marker.setMap(null));
        this.routeMarkers = [];
    }

    /**
     * Update quota widget with current API usage
     * FIXED: Handle data structure correctly with multiple fallback paths
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
        if (totalElem) {
            totalElem.innerHTML = '<span class="text-danger small" title="' + 
                this.escapeHtml(errorMsg) + '">⚠️</span>';
        }
    }

    // ========================================================================
    // EXPORT FUNCTIONALITY
    // ========================================================================

    /**
     * Open export modal with multiple format options
     */
    openExportModal() {
        if (!this.currentRoute) {
            Utils.showToast('No route to export. Calculate a route first.', 'warning');
            return;
        }
        
        // Create modal HTML if it doesn't exist
        if (!document.getElementById('exportModal')) {
            const modalHtml = `
                <div class="modal fade" id="exportModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content bg-white dark:bg-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-lg">
                            <div class="modal-header border-b border-secondary-200 dark:border-secondary-700 p-4">
                                <h5 class="modal-title text-lg font-semibold text-secondary-900 dark:text-white">Export Route</h5>
                                <button type="button" class="text-secondary-500 hover:text-secondary-700 dark:text-secondary-400 dark:hover:text-secondary-200" data-bs-dismiss="modal" aria-label="Close">
                                    <i class="bi bi-x-lg text-xl"></i>
                                </button>
                            </div>
                            <div class="modal-body p-4">
                                <p class="text-sm text-secondary-600 dark:text-secondary-300 mb-4">
                                    Choose how you'd like to export your ${this.currentRoute.locations.length}-stop route
                                </p>
                                
                                <div class="space-y-2">
                                    <button class="btn-primary w-full justify-start" onclick="window.routePlanner.exportToGoogleMaps()">
                                        <i class="bi bi-google"></i>
                                        <span>Open in Google Maps</span>
                                    </button>
                                    
                                    <button class="btn-secondary w-full justify-start" onclick="window.routePlanner.exportToAppleMaps()">
                                        <i class="bi bi-map"></i>
                                        <span>Open in Apple Maps</span>
                                    </button>
                                    
                                    <hr class="my-3 border-secondary-200 dark:border-secondary-700">
                                    
                                    <button class="btn-secondary w-full justify-start" onclick="window.routePlanner.shareRoute()">
                                        <i class="bi bi-link-45deg"></i>
                                        <span>Copy Shareable Link</span>
                                    </button>
                                    
                                    <button class="btn-secondary w-full justify-start" onclick="window.routePlanner.exportToJSON()">
                                        <i class="bi bi-download"></i>
                                        <span>Download JSON (Offline)</span>
                                    </button>
                                    
                                    <button class="btn-secondary w-full justify-start" onclick="window.routePlanner.exportToCSV()">
                                        <i class="bi bi-filetype-csv"></i>
                                        <span>Download CSV (Address List)</span>
                                    </button>
                                    
                                    <button class="btn-secondary w-full justify-start" onclick="window.routePlanner.printRoute()">
                                        <i class="bi bi-printer"></i>
                                        <span>Print Route Sheet</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
        
        // Show modal using Bootstrap
        const modalElement = document.getElementById('exportModal');
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }

    /**
     * Export route to Google Maps
     */
    exportToGoogleMaps() {
        if (!this.currentRoute) return;
        
        const travelMode = document.getElementById('travelMode')?.value || 'walking';
        const locations = this.currentRoute.locations;
        
        // Check if route exceeds Google Maps waypoint limit
        if (locations.length > 9) {
            const confirmed = confirm(
                `This route has ${locations.length} stops. Google Maps supports up to 9 waypoints.\n\n` +
                `Would you like to open the first 9 stops? You'll need to navigate remaining stops separately.`
            );
            
            if (!confirmed) return;
        }
        
        const url = this.buildGoogleMapsUrl(locations, travelMode);
        window.open(url, '_blank');
        
        Utils.showToast('Opening in Google Maps...', 'success');
        
        // Close modal if open
        const modalElement = document.getElementById('exportModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) modal.hide();
        }
    }

    /**
     * Build Google Maps URL with waypoints
     */
    buildGoogleMapsUrl(locations, travelMode = 'walking') {
        // Limit to first 9 waypoints due to Google Maps restriction
        const maxWaypoints = Math.min(locations.length, 9);
        const limitedLocations = locations.slice(0, maxWaypoints);
        
        // Get start location from state or use first voter location
        const startLocation = this.stateManager.getState().routing?.startLocation || {
            lat: limitedLocations[0].lat || limitedLocations[0].latitude,
            lng: limitedLocations[0].lng || limitedLocations[0].longitude
        };
        
        // Build URL components
        const origin = `${startLocation.lat},${startLocation.lng}`;
        const destination = `${limitedLocations[limitedLocations.length - 1].lat || limitedLocations[limitedLocations.length - 1].latitude},${limitedLocations[limitedLocations.length - 1].lng || limitedLocations[limitedLocations.length - 1].longitude}`;
        
        // Waypoints (all locations except the last one, which is the destination)
        const waypoints = limitedLocations.slice(0, -1)
            .map(loc => `${loc.lat || loc.latitude},${loc.lng || loc.longitude}`)
            .join('|');
        
        // Map travel mode to Google Maps format
        const modeMap = {
            'walking': 'walking',
            'driving': 'driving',
            'bicycling': 'bicycling'
        };
        const googleMode = modeMap[travelMode] || 'walking';
        
        // Construct URL
        let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
        
        if (waypoints) {
            url += `&waypoints=${waypoints}`;
        }
        
        url += `&travelmode=${googleMode}`;
        
        return url;
    }

    /**
     * Export route to Apple Maps
     */
    exportToAppleMaps() {
        if (!this.currentRoute) return;
        
        const travelMode = document.getElementById('travelMode')?.value || 'walking';
        const locations = this.currentRoute.locations;
        
        const url = this.buildAppleMapsUrl(locations, travelMode);
        
        // Detect if on iOS/macOS
        const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
        
        if (isAppleDevice) {
            window.location.href = url; // Use location.href on Apple devices
        } else {
            window.open(url, '_blank'); // Use window.open on other platforms
        }
        
        Utils.showToast('Opening in Apple Maps...', 'success');
        
        // Close modal
        const modalElement = document.getElementById('exportModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) modal.hide();
        }
    }

    /**
     * Build Apple Maps URL with waypoints
     */
    buildAppleMapsUrl(locations, travelMode = 'walking') {
        // Get start location
        const startLocation = this.stateManager.getState().routing?.startLocation || {
            lat: locations[0].lat || locations[0].latitude,
            lng: locations[0].lng || locations[0].longitude
        };
        
        const origin = `${startLocation.lat},${startLocation.lng}`;
        
        // Build destination with waypoints using +to: syntax
        const destination = locations
            .map(loc => `${loc.lat || loc.latitude},${loc.lng || loc.longitude}`)
            .join('+to:');
        
        // Map travel mode to Apple Maps format
        const modeMap = {
            'walking': 'w',
            'driving': 'd',
            'bicycling': 'w' // Apple Maps doesn't have bicycling, use walking
        };
        const appleMode = modeMap[travelMode] || 'w';
        
        // Construct URL
        const url = `http://maps.apple.com/?saddr=${origin}&daddr=${destination}&dirflg=${appleMode}`;
        
        return url;
    }

    /**
     * Share route via shareable link
     */
    async shareRoute() {
        if (!this.currentRoute) return;
        
        try {
            Utils.showToast('Saving route...', 'info');
            
            // Prepare route data
            const routeData = {
                startLocation: this.stateManager.getState().routing?.startLocation,
                locations: this.currentRoute.locations,
                metrics: this.currentRoute.metrics
            };
            
            const travelMode = document.getElementById('travelMode')?.value || 'walking';
            const routeName = prompt('Enter a name for this route (optional):') || null;
            
            // Save route via API
            const response = await fetch('/api/routes/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routeData,
                    options: {
                        travelMode,
                        routeName,
                        expiresIn: 30 * 24 * 60 * 60 * 1000 // 30 days
                    }
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to save route');
            }
            
            // Copy shareable URL to clipboard
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(data.shareableUrl);
                Utils.showToast('✅ Shareable link copied to clipboard!', 'success');
            } else {
                // Fallback for older browsers
                const input = document.createElement('input');
                input.value = data.shareableUrl;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
                Utils.showToast('✅ Shareable link copied!', 'success');
            }
            
            // Show link in alert
            alert(`Route saved!\n\nShareable link (copied to clipboard):\n${data.shareableUrl}\n\nExpires: ${new Date(data.expiresAt).toLocaleDateString()}`);
            
            // Close modal
            const modalElement = document.getElementById('exportModal');
            if (modalElement) {
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
            }
            
        } catch (error) {
            Logger.error('Share route error:', error);
            Utils.showToast('Failed to create shareable link: ' + error.message, 'danger');
        }
    }

    /**
     * Export route to JSON file
     */
    exportToJSON() {
        if (!this.currentRoute) return;
        
        const travelMode = document.getElementById('travelMode')?.value || 'walking';
        const algorithm = document.getElementById('algorithm')?.value || 'hybrid';
        
        // Build comprehensive JSON export
        const exportData = {
            exportVersion: '1.0',
            exportedAt: new Date().toISOString(),
            platform: 'Voter Platform v1.0',
            route: {
                name: prompt('Enter route name (optional):') || `Route ${new Date().toLocaleDateString()}`,
                travelMode,
                algorithm,
                startLocation: this.stateManager.getState().routing?.startLocation,
                stops: this.currentRoute.locations.map((loc, idx) => ({
                    sequence: idx + 1,
                    voterId: loc.voterId || loc.voter_id,
                    lat: loc.lat || loc.latitude,
                    lng: loc.lng || loc.longitude,
                    address: loc.address,
                    city: loc.city,
                    state: loc.state || 'TN',
                    zip: loc.zip || '',
                    firstName: loc.firstName || loc.first_name || '',
                    lastName: loc.lastName || loc.last_name || '',
                    phone: loc.phone || '',
                    notes: loc.notes || ''
                })),
                metrics: this.currentRoute.metrics
            }
        };
        
        // Convert to JSON string
        const jsonString = JSON.stringify(exportData, null, 2);
        
        // Create blob and download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // Generate filename
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
        const filename = `route_${timestamp}.json`;
        
        // Trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        
        Utils.showToast('✅ JSON file downloaded', 'success');
        
        // Close modal
        const modalElement = document.getElementById('exportModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) modal.hide();
        }
    }

    /**
     * Export route to CSV file
     */
    exportToCSV() {
        if (!this.currentRoute) {
            Utils.showToast('No route to export. Calculate a route first.', 'warning');
            return;
        }
        
        const locations = this.currentRoute.locations;
        
        // Build CSV content
        const headers = [
            'Sequence',
            'Voter ID',
            'First Name',
            'Last Name',
            'Full Address',
            'City',
            'State',
            'Zip',
            'Latitude',
            'Longitude',
            'Phone',
            'Notes'
        ];
        
        const rows = locations.map((loc, idx) => [
            idx + 1,
            loc.voterId || loc.voter_id || '',
            loc.firstName || loc.first_name || '',
            loc.lastName || loc.last_name || '',
            `"${loc.address || ''}"`, // Quote to handle commas in addresses
            loc.city || '',
            loc.state || 'TN',
            loc.zip || '',
            loc.lat || loc.latitude || '',
            loc.lng || loc.longitude || '',
            loc.phone || '',
            loc.notes || ''
        ]);
        
        const csvContent = [headers, ...rows]
            .map(row => row.join(','))
            .join('\n');
        
        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        // Generate filename
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `route_${timestamp}.csv`;
        
        // Trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
        
        Utils.showToast('✅ CSV file downloaded', 'success');
        
        // Close modal if open
        const modalElement = document.getElementById('exportModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) modal.hide();
        }
    }

    /**
     * Print route sheet
     */
    async printRoute() {
        if (!this.currentRoute) return;
        
        try {
            // Generate print view locally
            const printWindow = window.open('', '_blank');
            printWindow.document.write(this.generatePrintHTML());
            printWindow.document.close();
            
            // Wait for content to load, then trigger print dialog
            printWindow.onload = () => {
                printWindow.print();
            };
            
            // Close modal
            const modalElement = document.getElementById('exportModal');
            if (modalElement) {
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
            }
            
        } catch (error) {
            Logger.error('Print error:', error);
            Utils.showToast('Failed to generate print view: ' + error.message, 'danger');
        }
    }

    /**
     * Generate print-optimized HTML
     */
    generatePrintHTML() {
        const travelMode = document.getElementById('travelMode')?.value || 'walking';
        const locations = this.currentRoute.locations;
        const metrics = this.currentRoute.metrics;
        
        const date = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        const stopsList = locations.map((loc, idx) => `
            <li class="stop-item">
                <div class="stop-number">${idx + 1}</div>
                <div class="stop-details">
                    <strong>${this.escapeHtml(loc.firstName || loc.first_name || '')} ${this.escapeHtml(loc.lastName || loc.last_name || '')}</strong><br>
                    ${this.escapeHtml(loc.address || '')}, ${this.escapeHtml(loc.city || '')}<br>
                    <small>Voter ID: ${loc.voterId || loc.voter_id || 'N/A'} | Phone: ${this.escapeHtml(loc.phone || 'N/A')}</small>
                </div>
            </li>
        `).join('');
        
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Route Sheet - ${date}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: 0 auto; }
        .route-header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #333; }
        .route-header h1 { font-size: 24px; margin-bottom: 10px; }
        .route-summary { background: #f5f5f5; padding: 15px; margin-bottom: 20px; border-radius: 5px; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 10px; }
        .summary-item { text-align: center; }
        .summary-label { font-size: 12px; color: #666; text-transform: uppercase; }
        .summary-value { font-size: 20px; font-weight: bold; color: #333; }
        .stop-list { list-style: none; }
        .stop-item { display: flex; gap: 15px; padding: 15px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 5px; page-break-inside: avoid; }
        .stop-number { background: #4285F4; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0; }
        .stop-details { flex: 1; }
        .stop-details strong { font-size: 16px; color: #333; }
        .stop-details small { color: #666; font-size: 12px; }
        @media print {
            @page { margin: 0.5in; }
            body { padding: 0; }
            .route-summary { background: white; border: 1px solid #ddd; }
            .stop-item { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    <div class="route-header">
        <h1>Canvassing Route</h1>
        <p>${date}</p>
    </div>
    
    <div class="route-summary">
        <h2 style="margin-bottom: 10px;">Route Overview</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <div class="summary-label">Total Stops</div>
                <div class="summary-value">${locations.length}</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Distance</div>
                <div class="summary-value">${metrics?.totalDistanceMiles?.toFixed(1) || 'N/A'} mi</div>
            </div>
            <div class="summary-item">
                <div class="summary-label">Duration</div>
                <div class="summary-value">${Math.floor((metrics?.totalDurationMinutes || 0) / 60)}h ${(metrics?.totalDurationMinutes || 0) % 60}m</div>
            </div>
        </div>
        <p style="margin-top: 15px;"><strong>Travel Mode:</strong> ${travelMode.charAt(0).toUpperCase() + travelMode.slice(1)}</p>
    </div>
    
    <h2 style="margin-bottom: 15px;">Stop List</h2>
    <ul class="stop-list">
        ${stopsList}
    </ul>
    
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px;">
        <p>Generated by Voter Platform</p>
    </div>
</body>
</html>
        `;
    }

    /**
     * Cleanup when controller is destroyed
     */
    destroy() {
        if (this.quotaRefreshInterval) {
            clearInterval(this.quotaRefreshInterval);
        }
    }
}

// Initialize when needed
window.RoutePlannerController = RoutePlannerController;
