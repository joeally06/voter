/**
 * Filter Controller
 * Manages voter filtering and search functionality
 */
class FilterController {
  constructor(voterService, stateManager) {
    this.voterService = voterService;
    this.stateManager = stateManager;
    this.filters = this.getDefaultFilters();
    
    // Pagination state
    this.pagination = {
      currentPage: 1,
      limit: 100,
      sort: 'last_name',
      order: 'asc'
    };
    
    // CRITICAL FIX #4: Subscribe to state changes for counter updates
    // This prevents race conditions by using state-driven UI updates
    this.stateManager.subscribe((state, prevState) => {
      if (state.totalFiltered !== prevState.totalFiltered) {
        this.updateCounters(state.totalFiltered);
      }
    });
  }

  /**
   * Initialize filter controls
   */
  async init() {
    try {
      this.bindEventListeners();
      await this.loadPrecincts();
      await this.loadInitialVoters();
    } catch (error) {
      Logger.error('FilterController.init() error:', error);
      throw error;
    }
  }

  /**
   * Get default filter values
   */
  getDefaultFilters() {
    return {
      precinct: null,
      name: '',
      superVoterOnly: false,
      geocodedOnly: false, // Changed from true - show all voters by default (immediate fix)
      republicanOnly: false,      // NEW: Republican party filter
      democratOnly: false,        // NEW: Democrat party filter
      regularVotersOnly: false,   // NEW: Regular voters filter
      neverVotedOnly: false       // NEW: Never voted filter
    };
  }

  /**
   * Bind event listeners to filter controls
   */
  bindEventListeners() {
    // Desktop Precinct dropdown
    const precinctFilter = document.getElementById('precinctFilter');
    if (precinctFilter) {
      precinctFilter.addEventListener('change', (e) => {
        this.updateFilter('precinct', e.target.value || null);
        this.syncMobileFilters();
      });
    }

    // Mobile Precinct dropdown
    const precinctFilterMobile = document.getElementById('precinctFilterMobile');
    if (precinctFilterMobile) {
      precinctFilterMobile.addEventListener('change', (e) => {
        this.updateFilter('precinct', e.target.value || null);
        this.syncDesktopFilters();
      });
    }

    // Desktop Search input (debounced)
    // CRITICAL FIX #2: Apply input sanitization to prevent XSS
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        const sanitizedValue = Utils.sanitizeInput(e.target.value);
        this.updateFilter('name', sanitizedValue);
        const searchInputMobile = document.getElementById('searchInputMobile');
        if (searchInputMobile) searchInputMobile.value = sanitizedValue;
      }, 300));
    }

    // Mobile Search input (debounced)
    // CRITICAL FIX #2: Apply input sanitization to prevent XSS
    const searchInputMobile = document.getElementById('searchInputMobile');
    if (searchInputMobile) {
      searchInputMobile.addEventListener('input', Utils.debounce((e) => {
        const sanitizedValue = Utils.sanitizeInput(e.target.value);
        this.updateFilter('name', sanitizedValue);
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = sanitizedValue;
      }, 300));
    }

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

    // Desktop Geocoded only checkbox
    const geocodedFilter = document.getElementById('geocodedFilter');
    if (geocodedFilter) {
      geocodedFilter.addEventListener('change', (e) => {
        this.updateFilter('geocodedOnly', e.target.checked);
        const geocodedFilterMobile = document.getElementById('geocodedFilterMobile');
        if (geocodedFilterMobile) geocodedFilterMobile.checked = e.target.checked;
      });
    }

    // Mobile Geocoded only checkbox
    const geocodedFilterMobile = document.getElementById('geocodedFilterMobile');
    if (geocodedFilterMobile) {
      geocodedFilterMobile.addEventListener('change', (e) => {
        this.updateFilter('geocodedOnly', e.target.checked);
        const geocodedFilter = document.getElementById('geocodedFilter');
        if (geocodedFilter) geocodedFilter.checked = e.target.checked;
      });
    }

    // NEW: Desktop Republican filter
    const republicanFilter = document.getElementById('republicanFilter');
    if (republicanFilter) {
      republicanFilter.addEventListener('change', (e) => {
        this.updateFilter('republicanOnly', e.target.checked);
        const republicanFilterMobile = document.getElementById('republicanFilterMobile');
        if (republicanFilterMobile) republicanFilterMobile.checked = e.target.checked;
      });
    }

    // NEW: Mobile Republican filter
    const republicanFilterMobile = document.getElementById('republicanFilterMobile');
    if (republicanFilterMobile) {
      republicanFilterMobile.addEventListener('change', (e) => {
        this.updateFilter('republicanOnly', e.target.checked);
        const republicanFilter = document.getElementById('republicanFilter');
        if (republicanFilter) republicanFilter.checked = e.target.checked;
      });
    }

    // NEW: Desktop Democrat filter
    const democratFilter = document.getElementById('democratFilter');
    if (democratFilter) {
      democratFilter.addEventListener('change', (e) => {
        this.updateFilter('democratOnly', e.target.checked);
        const democratFilterMobile = document.getElementById('democratFilterMobile');
        if (democratFilterMobile) democratFilterMobile.checked = e.target.checked;
      });
    }

    // NEW: Mobile Democrat filter
    const democratFilterMobile = document.getElementById('democratFilterMobile');
    if (democratFilterMobile) {
      democratFilterMobile.addEventListener('change', (e) => {
        this.updateFilter('democratOnly', e.target.checked);
        const democratFilter = document.getElementById('democratFilter');
        if (democratFilter) democratFilter.checked = e.target.checked;
      });
    }

    // NEW: Desktop Regular Voters filter
    const regularVotersFilter = document.getElementById('regularVotersFilter');
    if (regularVotersFilter) {
      regularVotersFilter.addEventListener('change', (e) => {
        // Mutual exclusivity: uncheck never-voted if regular is checked
        if (e.target.checked) {
          this.filters.neverVotedOnly = false;
          const neverVotedFilter = document.getElementById('neverVotedFilter');
          const neverVotedFilterMobile = document.getElementById('neverVotedFilterMobile');
          if (neverVotedFilter) neverVotedFilter.checked = false;
          if (neverVotedFilterMobile) neverVotedFilterMobile.checked = false;
        }
        this.updateFilter('regularVotersOnly', e.target.checked);
        const regularVotersFilterMobile = document.getElementById('regularVotersFilterMobile');
        if (regularVotersFilterMobile) regularVotersFilterMobile.checked = e.target.checked;
      });
    }

    // NEW: Mobile Regular Voters filter
    const regularVotersFilterMobile = document.getElementById('regularVotersFilterMobile');
    if (regularVotersFilterMobile) {
      regularVotersFilterMobile.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.filters.neverVotedOnly = false;
          const neverVotedFilter = document.getElementById('neverVotedFilter');
          const neverVotedFilterMobile = document.getElementById('neverVotedFilterMobile');
          if (neverVotedFilter) neverVotedFilter.checked = false;
          if (neverVotedFilterMobile) neverVotedFilterMobile.checked = false;
        }
        this.updateFilter('regularVotersOnly', e.target.checked);
        const regularVotersFilter = document.getElementById('regularVotersFilter');
        if (regularVotersFilter) regularVotersFilter.checked = e.target.checked;
      });
    }

    // NEW: Desktop Never Voted filter
    const neverVotedFilter = document.getElementById('neverVotedFilter');
    if (neverVotedFilter) {
      neverVotedFilter.addEventListener('change', (e) => {
        // Mutual exclusivity: uncheck regular voters if never-voted is checked
        if (e.target.checked) {
          this.filters.regularVotersOnly = false;
          const regularVotersFilter = document.getElementById('regularVotersFilter');
          const regularVotersFilterMobile = document.getElementById('regularVotersFilterMobile');
          if (regularVotersFilter) regularVotersFilter.checked = false;
          if (regularVotersFilterMobile) regularVotersFilterMobile.checked = false;
        }
        this.updateFilter('neverVotedOnly', e.target.checked);
        const neverVotedFilterMobile = document.getElementById('neverVotedFilterMobile');
        if (neverVotedFilterMobile) neverVotedFilterMobile.checked = e.target.checked;
      });
    }

    // NEW: Mobile Never Voted filter
    const neverVotedFilterMobile = document.getElementById('neverVotedFilterMobile');
    if (neverVotedFilterMobile) {
      neverVotedFilterMobile.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.filters.regularVotersOnly = false;
          const regularVotersFilter = document.getElementById('regularVotersFilter');
          const regularVotersFilterMobile = document.getElementById('regularVotersFilterMobile');
          if (regularVotersFilter) regularVotersFilter.checked = false;
          if (regularVotersFilterMobile) regularVotersFilterMobile.checked = false;
        }
        this.updateFilter('neverVotedOnly', e.target.checked);
        const neverVotedFilter = document.getElementById('neverVotedFilter');
        if (neverVotedFilter) neverVotedFilter.checked = e.target.checked;
      });
    }

    // Desktop Clear filters button
    const clearFiltersBtn = document.getElementById('clearFilters');
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        this.clearAllFilters();
      });
    }

    // Mobile Clear filters button
    const clearFiltersBtnMobile = document.getElementById('clearFiltersMobile');
    if (clearFiltersBtnMobile) {
      clearFiltersBtnMobile.addEventListener('click', () => {
        this.clearAllFilters();
      });
    }

    // Desktop Export button
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportFilteredVoters();
      });
    }

    // Mobile Export button
    const exportBtnMobile = document.getElementById('exportBtnMobile');
    if (exportBtnMobile) {
      exportBtnMobile.addEventListener('click', () => {
        this.exportFilteredVoters();
      });
    }
  }

  /**
   * Load precincts for dropdown
   */
  async loadPrecincts() {
    try {
      const result = await this.voterService.fetchPrecincts();
      const precincts = result.data || [];

      // Populate desktop dropdown
      const dropdown = document.getElementById('precinctFilter');
      if (dropdown) {
        dropdown.innerHTML = '<option value="">All Precincts</option>';
        
        precincts.forEach(p => {
          const option = document.createElement('option');
          option.value = p.precinct_number;
          option.textContent = `Precinct ${p.precinct_number} (${Utils.formatNumber(p.total_voters || 0)} voters)`;
          dropdown.appendChild(option);
        });
        
        dropdown.disabled = false;
      }

      // Populate mobile dropdown
      const dropdownMobile = document.getElementById('precinctFilterMobile');
      if (dropdownMobile) {
        dropdownMobile.innerHTML = '<option value="">All Precincts</option>';
        
        precincts.forEach(p => {
          const option = document.createElement('option');
          option.value = p.precinct_number;
          option.textContent = `Precinct ${p.precinct_number} (${Utils.formatNumber(p.total_voters || 0)} voters)`;
          dropdownMobile.appendChild(option);
        });
        
        dropdownMobile.disabled = false;
      }

      // Store precincts in state
      this.stateManager.setState({
        analytics: { precincts }
      });

      Logger.info(`✅ Loaded ${precincts.length} precincts`);
    } catch (error) {
      // RECOMMENDED FIX #8: Use standardized error handling
      Utils.handleError(error, 'FilterController.loadPrecincts', {
        customMessage: 'Failed to load precincts. Some filters may not be available.'
      });
    }
  }

  /**
   * Sync mobile filter controls with desktop
   */
  syncMobileFilters() {
    const precinctFilterMobile = document.getElementById('precinctFilterMobile');
    const precinctFilter = document.getElementById('precinctFilter');
    if (precinctFilterMobile && precinctFilter) {
      precinctFilterMobile.value = precinctFilter.value;
    }
  }

  /**
   * Sync desktop filter controls with mobile
   */
  syncDesktopFilters() {
    const precinctFilter = document.getElementById('precinctFilter');
    const precinctFilterMobile = document.getElementById('precinctFilterMobile');
    if (precinctFilter && precinctFilterMobile) {
      precinctFilter.value = precinctFilterMobile.value;
    }
  }

  /**
   * Load initial voter data
   */
  async loadInitialVoters() {
    await this.applyFilters();
  }

  /**
   * Update a specific filter
   * @param {string} key - Filter key
   * @param {*} value - Filter value
   */
  async updateFilter(key, value) {
    this.filters[key] = value;
    
    // Update filter badge count
    this.updateFilterBadge();
    
    // Reset to page 1 when filters change
    this.pagination.currentPage = 1;
    
    await this.applyFilters();
  }

  /**
   * Apply current filters and fetch voters
   */
  async applyFilters() {
    try {
      // Show loading state
      this.stateManager.setState({ 
        ui: { loading: true, error: null } 
      });

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

      // NEW: Party filter logic
      // Both parties, single party, or none
      if (this.filters.republicanOnly && this.filters.democratOnly) {
        // Both parties selected
        params.party = 'R,D';
      } else if (this.filters.republicanOnly) {
        // Only Republican
        params.party = 'R';
      } else if (this.filters.democratOnly) {
        // Only Democrat
        params.party = 'D';
      }

      // NEW: Voting status filter (mutually exclusive)
      if (this.filters.regularVotersOnly) {
        params.voting_status = 'regular';
      } else if (this.filters.neverVotedOnly) {
        params.voting_status = 'never';
      }

      // Show informational tooltip if user selected logically impossible combination
      if ((this.filters.republicanOnly || this.filters.democratOnly) && 
          this.filters.neverVotedOnly) {
        Logger.info('Note: Party affiliation requires voting history. Results may be empty.');
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

      // Update state with results
      // CRITICAL FIX #4: Remove direct counter update - now handled by state subscription
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

      // Counter update now handled automatically by state subscription
      // this.updateCounters() called via subscribe() in constructor

      Utils.showLoading(false);

      Logger.info(`✅ Filters applied: ${result.total || 0} voters found`);

    } catch (error) {
      Logger.error('Filter error:', error);
      
      // RECOMMENDED FIX #8: Use standardized error handling
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

  /**
   * Go to a specific page
   * @param {number} pageNumber - Page to navigate to (1-based)
   */
  async goToPage(pageNumber) {
    const state = this.stateManager.getState();
    const totalPages = state.pagination?.totalPages || 1;
    
    // Validate page number
    if (pageNumber < 1 || pageNumber > totalPages) {
      Logger.warn(`Invalid page number: ${pageNumber}`);
      return;
    }
    
    this.pagination.currentPage = pageNumber;
    await this.applyFilters();
  }

  /**
   * Go to next page
   */
  async nextPage() {
    const state = this.stateManager.getState();
    const totalPages = state.pagination?.totalPages || 1;
    
    if (this.pagination.currentPage < totalPages) {
      this.pagination.currentPage++;
      await this.applyFilters();
    }
  }

  /**
   * Go to previous page
   */
  async previousPage() {
    if (this.pagination.currentPage > 1) {
      this.pagination.currentPage--;
      await this.applyFilters();
    }
  }

  /**
   * Change page size
   * @param {number} newLimit - New items per page
   */
  async changePageSize(newLimit) {
    this.pagination.limit = newLimit;
    this.pagination.currentPage = 1; // Reset to first page
    await this.applyFilters();
  }

  /**
   * Clear all filters and reset to defaults
   */
  async clearAllFilters() {
    this.filters = this.getDefaultFilters();
    
    // Reset pagination to page 1
    this.pagination.currentPage = 1;
    
    // Reset desktop UI controls
    const precinctFilter = document.getElementById('precinctFilter');
    if (precinctFilter) precinctFilter.value = '';
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    
    const superVoterFilter = document.getElementById('superVoterFilter');
    if (superVoterFilter) superVoterFilter.checked = false;
    
    const geocodedFilter = document.getElementById('geocodedFilter');
    if (geocodedFilter) geocodedFilter.checked = false;

    // NEW: Reset party filters (desktop)
    const republicanFilter = document.getElementById('republicanFilter');
    if (republicanFilter) republicanFilter.checked = false;
    
    const democratFilter = document.getElementById('democratFilter');
    if (democratFilter) democratFilter.checked = false;

    // NEW: Reset voting status filters (desktop)
    const regularVotersFilter = document.getElementById('regularVotersFilter');
    if (regularVotersFilter) regularVotersFilter.checked = false;
    
    const neverVotedFilter = document.getElementById('neverVotedFilter');
    if (neverVotedFilter) neverVotedFilter.checked = false;

    // Reset mobile UI controls
    const precinctFilterMobile = document.getElementById('precinctFilterMobile');
    if (precinctFilterMobile) precinctFilterMobile.value = '';
    
    const searchInputMobile = document.getElementById('searchInputMobile');
    if (searchInputMobile) searchInputMobile.value = '';
    
    const superVoterFilterMobile = document.getElementById('superVoterFilterMobile');
    if (superVoterFilterMobile) superVoterFilterMobile.checked = false;
    
    const geocodedFilterMobile = document.getElementById('geocodedFilterMobile');
    if (geocodedFilterMobile) geocodedFilterMobile.checked = false;

    // NEW: Reset mobile party filters
    const republicanFilterMobile = document.getElementById('republicanFilterMobile');
    if (republicanFilterMobile) republicanFilterMobile.checked = false;
    
    const democratFilterMobile = document.getElementById('democratFilterMobile');
    if (democratFilterMobile) democratFilterMobile.checked = false;

    // NEW: Reset mobile voting status filters
    const regularVotersFilterMobile = document.getElementById('regularVotersFilterMobile');
    if (regularVotersFilterMobile) regularVotersFilterMobile.checked = false;
    
    const neverVotedFilterMobile = document.getElementById('neverVotedFilterMobile');
    if (neverVotedFilterMobile) neverVotedFilterMobile.checked = false;

    this.updateFilterBadge();
    
    await this.applyFilters();

    Utils.showToast('Filters cleared', 'info');
  }

  /**
   * Export filtered voters to CSV
   */
  exportFilteredVoters() {
    const state = this.stateManager.getState();
    const voters = state.filteredVoters;

    if (!voters || voters.length === 0) {
      Utils.showToast('No voters to export', 'warning');
      return;
    }

    // Prepare data for export
    const exportData = voters.map(v => ({
      'First Name': v.first_name,
      'Last Name': v.last_name,
      'Address': v.address,
      'City': v.city,
      'Zip Code': v.zip_code,
      'Precinct': v.precinct_number,
      'Super Voter': v.is_super_voter ? 'Yes' : 'No',
      'Latitude': v.latitude || '',
      'Longitude': v.longitude || ''
    }));

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `voters_export_${timestamp}.csv`;

    Utils.exportToCSV(exportData, filename);
  }

  /**
   * Update filter badge count
   */
  updateFilterBadge() {
    const badge = document.getElementById('filterBadge');
    if (!badge) return;

    let count = 0;
    
    if (this.filters.precinct) count++;
    if (this.filters.name) count++;
    if (this.filters.superVoterOnly) count++;
    if (this.filters.geocodedOnly) count++;
    if (this.filters.republicanOnly) count++;     // NEW
    if (this.filters.democratOnly) count++;       // NEW
    if (this.filters.regularVotersOnly) count++;  // NEW
    if (this.filters.neverVotedOnly) count++;     // NEW

    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  /**
   * Update voter count displays
   * @param {number} count - Filtered voter count
   */
  updateCounters(count) {
    const counter = document.getElementById('voterCount');
    if (counter) {
      counter.textContent = Utils.formatNumber(count);
    }

    const filterInfo = document.getElementById('filterInfo');
    if (filterInfo) {
      if (count === 0) {
        filterInfo.innerHTML = '<small class="text-muted">No voters match your filters</small>';
      } else {
        filterInfo.innerHTML = `<small class="text-muted">${Utils.formatNumber(count)} voter${count !== 1 ? 's' : ''} found</small>`;
      }
    }
  }
}

// Make available globally
window.FilterController = FilterController;
