/**
 * Target List Controller
 * Manages the never-voted voters target list with filtering, search, and export
 */
class TargetListController {
  constructor(voterService, stateManager) {
    this.voterService = voterService;
    this.stateManager = stateManager;
    this.currentPage = 1;
    this.limit = 100;
    this.filters = {
      ageMin: 18,
      ageMax: 120,
      precinct: null,
      city: null,
      geocoded: 'all',
      search: null,
      sort: 'lastName',
      order: 'asc'
    };
  }

  /**
   * Initialize the target list controller
   */
  async init() {
    await this.loadFilterOptions();
    this.attachEventListeners();
    await this.loadTargetList();
    Logger.info('✅ Target list initialized');
  }

  /**
   * Load filter options (precincts and cities)
   */
  async loadFilterOptions() {
    try {
      const state = this.stateManager.getState();
      
      // Get precincts from analytics data
      const precincts = state.analytics?.precincts || [];
      const precinctSelect = document.getElementById('targetPrecinctFilter');
      
      if (precinctSelect && precincts.length > 0) {
        precinctSelect.innerHTML = '<option value="">All Precincts</option>' +
          precincts.map(p => 
            `<option value="${p.precinctNumber}">${p.name || 'Precinct ' + p.precinctNumber}</option>`
          ).join('');
      }

      // Get unique cities from demographics
      const demographics = state.analytics?.demographics;
      if (demographics && demographics.byCity) {
        const cities = demographics.byCity.map(c => c.city).filter(c => c && c !== 'Unknown');
        const citySelect = document.getElementById('targetCityFilter');
        
        if (citySelect) {
          citySelect.innerHTML = '<option value="">All Cities</option>' +
            cities.map(city => `<option value="${city}">${city}</option>`).join('');
        }
      }
    } catch (error) {
      Logger.error('Failed to load filter options:', error);
    }
  }

  /**
   * Attach event listeners to filter controls
   */
  attachEventListeners() {
    // Age range filter
    const ageFilter = document.getElementById('targetAgeFilter');
    if (ageFilter) {
      ageFilter.addEventListener('change', (e) => {
        const [min, max] = e.target.value.split('-').map(Number);
        this.filters.ageMin = min;
        this.filters.ageMax = max;
        this.currentPage = 1;
        this.loadTargetList();
      });
    }

    // Precinct filter
    const precinctFilter = document.getElementById('targetPrecinctFilter');
    if (precinctFilter) {
      precinctFilter.addEventListener('change', (e) => {
        const selected = Array.from(e.target.selectedOptions).map(o => o.value).filter(v => v);
        this.filters.precinct = selected.length > 0 ? selected.join(',') : null;
        this.currentPage = 1;
        this.loadTargetList();
      });
    }

    // City filter
    const cityFilter = document.getElementById('targetCityFilter');
    if (cityFilter) {
      cityFilter.addEventListener('change', (e) => {
        const selected = Array.from(e.target.selectedOptions).map(o => o.value).filter(v => v);
        this.filters.city = selected.length > 0 ? selected.join(',') : null;
        this.currentPage = 1;
        this.loadTargetList();
      });
    }

    // Geocoded filter
    const geocodedFilter = document.getElementById('targetGeocodedFilter');
    if (geocodedFilter) {
      geocodedFilter.addEventListener('change', (e) => {
        this.filters.geocoded = e.target.checked ? 'true' : 'all';
        this.currentPage = 1;
        this.loadTargetList();
      });
    }

    // Search with debounce
    const searchInput = document.getElementById('targetSearchInput');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          this.filters.search = e.target.value || null;
          this.currentPage = 1;
          this.loadTargetList();
        }, 500);
      });
    }

    // Sort headers
    document.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const sortField = th.dataset.sort;
        if (this.filters.sort === sortField) {
          this.filters.order = this.filters.order === 'asc' ? 'desc' : 'asc';
        } else {
          this.filters.sort = sortField;
          this.filters.order = 'asc';
        }
        this.loadTargetList();
      });
    });

    // Export button
    const exportBtn = document.getElementById('exportTargetListBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportToCSV();
      });
    }
  }

  /**
   * Load the target list from API
   */
  async loadTargetList() {
    try {
      const params = {
        limit: this.limit,
        offset: (this.currentPage - 1) * this.limit,
        sort: this.filters.sort,
        order: this.filters.order
      };

      if (this.filters.ageMin) params.ageMin = this.filters.ageMin;
      if (this.filters.ageMax) params.ageMax = this.filters.ageMax;
      if (this.filters.precinct) params.precinct = this.filters.precinct;
      if (this.filters.city) params.city = this.filters.city;
      if (this.filters.geocoded !== 'all') params.geocoded = this.filters.geocoded;
      if (this.filters.search) params.search = this.filters.search;

      const response = await this.voterService.getNeverVotedVoters(params);

      if (response.success) {
        this.renderTable(response.data);
        this.updatePagination(response.pagination);
        
        const totalCount = response.pagination.total.toLocaleString();
        const countBadge = document.getElementById('targetListCount');
        if (countBadge) {
          countBadge.textContent = `${totalCount} voters`;
        }
      }
    } catch (error) {
      Logger.error('Failed to load target list:', error);
      if (window.Utils) {
        Utils.showToast('Failed to load target list', 'error');
      }
    }
  }

  /**
   * Render the target list table
   * @param {Array} voters - Array of voter objects
   */
  renderTable(voters) {
    const tbody = document.getElementById('targetTableBody');
    if (!tbody) return;

    if (voters.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-muted py-4">
            <i class="bi bi-inbox"></i> No voters match the current filters
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = voters.map(voter => `
      <tr>
        <td>${this.escapeHtml(voter.lastName)}, ${this.escapeHtml(voter.firstName)}</td>
        <td>${voter.age || 'N/A'}</td>
        <td>${this.escapeHtml(voter.address)}</td>
        <td>${this.escapeHtml(voter.city)}</td>
        <td>${voter.precinctNumber}${voter.precinctName ? ' - ' + this.escapeHtml(voter.precinctName) : ''}</td>
        <td>${voter.zipCode}</td>
        <td class="text-center">
          ${voter.isGeocoded 
            ? '<i class="bi bi-check-circle-fill text-success" title="Geocoded"></i>' 
            : '<i class="bi bi-x-circle text-muted" title="Not geocoded"></i>'}
        </td>
        <td>
          <button class="btn btn-sm btn-outline-primary" 
                  onclick="window.showVoterOnMap && window.showVoterOnMap(${voter.latitude}, ${voter.longitude})"
                  ${!voter.isGeocoded ? 'disabled' : ''}
                  title="View on map">
            <i class="bi bi-geo-alt"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  /**
   * Update pagination controls
   * @param {Object} pagination - Pagination metadata
   */
  updatePagination(pagination) {
    const showingStart = document.getElementById('showingStart');
    const showingEnd = document.getElementById('showingEnd');
    const showingTotal = document.getElementById('showingTotal');

    if (showingStart) showingStart.textContent = pagination.total > 0 ? pagination.offset + 1 : 0;
    if (showingEnd) showingEnd.textContent = Math.min(pagination.offset + pagination.limit, pagination.total);
    if (showingTotal) showingTotal.textContent = pagination.total.toLocaleString();

    const paginationEl = document.getElementById('targetListPagination');
    if (!paginationEl) return;

    const totalPages = pagination.totalPages;
    const currentPage = pagination.currentPage;

    let html = '';

    // Previous button
    html += `
      <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage - 1}">Previous</a>
      </li>
    `;

    // Page numbers (show max 5 pages around current)
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
      html += `
        <li class="page-item ${i === currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>
      `;
    }

    // Next button
    html += `
      <li class="page-item ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${currentPage + 1}">Next</a>
      </li>
    `;

    paginationEl.innerHTML = html;

    // Attach click handlers
    paginationEl.querySelectorAll('a.page-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (!e.target.parentElement.classList.contains('disabled') && 
            !e.target.parentElement.classList.contains('active')) {
          this.currentPage = parseInt(e.target.dataset.page);
          this.loadTargetList();
        }
      });
    });
  }

  /**
   * Export target list to CSV
   * RECOMMENDED FIX #5: Added warning for large exports
   */
  async exportToCSV() {
    try {
      // Get current total from pagination display
      const totalElement = document.getElementById('showingTotal');
      const total = totalElement ? parseInt(totalElement.textContent.replace(/,/g, '')) : 0;
      
      // Warn if exporting more than 1000 rows
      if (total > 1000) {
        const confirmed = confirm(
          `Export ${total.toLocaleString()} voters? This may take a moment and result in a large file.`
        );
        if (!confirmed) {
          return; // User cancelled
        }
      }

      const params = {
        export: 'csv',
        sort: this.filters.sort,
        order: this.filters.order
      };

      if (this.filters.ageMin) params.ageMin = this.filters.ageMin;
      if (this.filters.ageMax) params.ageMax = this.filters.ageMax;
      if (this.filters.precinct) params.precinct = this.filters.precinct;
      if (this.filters.city) params.city = this.filters.city;
      if (this.filters.geocoded !== 'all') params.geocoded = this.filters.geocoded;
      if (this.filters.search) params.search = this.filters.search;

      await this.voterService.getNeverVotedVoters(params);

      if (window.Utils) {
        Utils.showToast(
          total > 500 ? 'CSV export started - this may take a moment...' : 'CSV export started',
          'success'
        );
      }
    } catch (error) {
      Logger.error('Export failed:', error);
      if (window.Utils) {
        Utils.showToast('Failed to export CSV', 'error');
      }
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Make available globally
window.TargetListController = TargetListController;
