/**
 * Voter List Controller
 * Manages voter list display with party affiliation and voting history
 */
class VoterListController {
    constructor(voterService, stateManager) {
        this.voterService = voterService;
        this.stateManager = stateManager;
        this.currentVoters = [];
        this.voterDetailModal = null;
        this.selectedVoters = new Set(); // Track selected voters
        this.sortColumn = null; // Current sort column
        this.sortDirection = 'asc'; // Current sort direction
    }

    /**
     * Initialize the voter list controller
     */
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
            
            // Subscribe to pagination changes
            if (state.pagination !== prevState.pagination) {
                this.renderPagination(state.pagination);
            }
        });
        
        // Attach pagination event listeners
        this.attachPaginationListeners();

        // Initialize sortable table headers
        this.initializeSortableHeaders();

        // Initialize virtual scrolling
        this.initVirtualScrolling();

        Logger.info('\u2705 Voter List Controller initialized with Phase 4 enhancements');
    }

    /**
     * Initialize virtual scrolling for large voter lists
     */
    initVirtualScrolling() {
        var scrollContainer = document.querySelector('#voterTable');
        if (!scrollContainer) return;

        // The scrollable wrapper is the parent div with overflow
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

    /**
     * Initialize sortable table headers
     */
    initializeSortableHeaders() {
        const table = document.getElementById('voterTable');
        if (!table) return;

        const headers = table.querySelectorAll('thead th[data-sortable="true"]');
        headers.forEach(header => {
            header.classList.add('vp-sortable-header');
            header.style.cursor = 'pointer';
            
            header.addEventListener('click', () => {
                const column = header.dataset.column;
                this.sortByColumn(column);
            });
        });
    }

    /**
     * Sort voters by column
     * @param {string} column - Column name to sort by
     */
    sortByColumn(column) {
        // Toggle sort direction if same column, otherwise default to ascending
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }

        // Update header classes
        var headers = document.querySelectorAll('.vp-sortable-header');
        headers.forEach(function(h) {
            h.classList.remove('vp-sortable-header--asc', 'vp-sortable-header--desc');
            h.setAttribute('aria-sort', 'none');
        });

        var activeHeader = document.querySelector('[data-column="' + column + '"]');
        if (activeHeader) {
            activeHeader.classList.add('vp-sortable-header--' + this.sortDirection);
            activeHeader.setAttribute('aria-sort', this.sortDirection === 'asc' ? 'ascending' : 'descending');
        }

        // Perform sort
        this.currentVoters.sort((a, b) => {
            let aVal = a[column];
            let bVal = b[column];

            // Handle null/undefined
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Type-specific comparison
            if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = bVal.toLowerCase();
            }

            if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        // Re-render table
        this.renderVoterList(this.currentVoters);
    }

    /**
     * Render the voter list table with skeleton loading support
     * @param {Array} voters - Array of voter objects
     */
    renderVoterList(voters) {
        this.currentVoters = voters || [];
        const tbody = document.getElementById('voterTableBody');
        const countBadge = document.getElementById('voterListCount');

        if (!tbody) return;

        // Update count badge
        if (countBadge) {
            countBadge.textContent = this.currentVoters.length + ' voter' + (this.currentVoters.length !== 1 ? 's' : '');
        }

        // Show skeleton loading if voters is null (loading state)
        if (voters === null) {
            this.showSkeletonLoading(tbody);
            return;
        }

        // Clear existing rows
        tbody.innerHTML = '';

        // Show message if no voters
        if (this.currentVoters.length === 0) {
            tbody.innerHTML = '\n                <tr>\n                    <td colspan="7" class="text-center text-muted py-5">\n                        <i class="bi bi-inbox" style="font-size: 3rem;"></i>\n                        <p class="mt-2">No voters match your current filters</p>\n                        <p class="small">Try adjusting your filters or clearing them to see more results.</p>\n                    </td>\n                </tr>\n            ';
            return;
        }

        // Use virtual scrolling for large datasets (>100 rows)
        if (this.useVirtualScrolling && this.virtualScroller && this.currentVoters.length > 100) {
            this.virtualScroller.setData(this.currentVoters);
            return;
        }

        // Render all voters from current page (pagination handles limiting)
        this.currentVoters.forEach(function(voter) {
            var row = this.createVoterRow(voter);
            tbody.appendChild(row);
        }.bind(this));
    }

    /**
     * Show skeleton loading for voter table
     * @param {HTMLElement} tbody - Table body element
     */
    showSkeletonLoading(tbody) {
        tbody.innerHTML = '';
        
        // Create 10 skeleton rows
        for (let i = 0; i < 10; i++) {
            const row = document.createElement('tr');
            row.className = 'vp-skeleton-table-row';
            
            // Create skeleton cells
            for (let j = 0; j < 7; j++) {
                const cell = document.createElement('td');
                const skeleton = document.createElement('div');
                skeleton.className = 'vp-skeleton vp-skeleton-table-cell';
                
                // Vary widths for more realistic appearance
                const widths = ['100%', '75%', '50%', '60%', '80%', '70%', '90%'];
                skeleton.style.width = widths[j % widths.length];
                
                cell.appendChild(skeleton);
                row.appendChild(cell);
            }
            
            tbody.appendChild(row);
        }
    }

    /**
     * Create a table row for a voter with Phase 4 interactions
     * @param {Object} voter - Voter data object
     * @returns {HTMLElement} Table row element
     */
    createVoterRow(voter) {
        const row = document.createElement('tr');
        row.dataset.voterId = voter.id;
        row.className = 'vp-table-row--interactive';
        
        // Add selection state if voter is selected
        if (this.selectedVoters.has(voter.id)) {
            row.classList.add('vp-table-row--selected');
        }

        // Row click handler for selection (Ctrl/Cmd + Click)
        row.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                this.toggleVoterSelection(voter.id, row);
            }
        });

        // Full name
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `
            <strong>${this.escapeHtml(voter.lastName)}, ${this.escapeHtml(voter.firstName)}</strong>
        `;
        row.appendChild(nameCell);

        // Address
        const addressCell = document.createElement('td');
        addressCell.innerHTML = `
            <small>${this.escapeHtml(voter.address || 'N/A')}<br>
            ${this.escapeHtml(voter.city || '')}, ${this.escapeHtml(voter.zipCode || '')}</small>
        `;
        row.appendChild(addressCell);

        // Party affiliation
        const partyCell = document.createElement('td');
        const partyBadge = this.getPartyBadge(voter.mostRecentParty);
        partyCell.innerHTML = partyBadge;
        row.appendChild(partyCell);

        // Precinct
        const precinctCell = document.createElement('td');
        precinctCell.innerHTML = `
            <span class="badge bg-secondary">${voter.precinctNumber || 'N/A'}</span>
        `;
        row.appendChild(precinctCell);

        // Super voter status
        const statusCell = document.createElement('td');
        statusCell.innerHTML = voter.superVoter
            ? '<span class="badge bg-success"><i class="bi bi-star-fill"></i> Super Voter</span>'
            : '<span class="badge bg-light text-dark">Regular</span>';
        row.appendChild(statusCell);

        // Participation rate
        const participationCell = document.createElement('td');
        const participationRate = voter.participationRate || 0;
        const progressColor = participationRate >= 75 ? 'success' : participationRate >= 50 ? 'warning' : 'danger';
        participationCell.innerHTML = `
            <div class="progress" style="height: 20px;">
                <div class="progress-bar bg-${progressColor}" role="progressbar" 
                     style="width: ${participationRate}%" 
                     aria-valuenow="${participationRate}" 
                     aria-valuemin="0" 
                     aria-valuemax="100">
                    ${participationRate}%
                </div>
            </div>
            <small class="text-muted">${voter.electionsVoted || 0}/${voter.totalElections || 0} elections</small>
        `;
        row.appendChild(participationCell);

        // Actions
        const actionsCell = document.createElement('td');
        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn btn-sm btn-outline-primary vp-btn';
        viewBtn.innerHTML = '<i class="bi bi-eye"></i> Details';
        viewBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent row click
            this.showVoterDetails(voter.id);
        };
        actionsCell.appendChild(viewBtn);
        row.appendChild(actionsCell);

        return row;
    }

    /**
     * Toggle voter selection
     * @param {number} voterId - Voter ID
     * @param {HTMLElement} row - Table row element
     */
    toggleVoterSelection(voterId, row) {
        if (this.selectedVoters.has(voterId)) {
            this.selectedVoters.delete(voterId);
            row.classList.remove('vp-table-row--selected');
        } else {
            this.selectedVoters.add(voterId);
            row.classList.add('vp-table-row--selected');
        }

        // Update selection count badge
        this.updateSelectionCount();
    }

    /**
     * Update selection count display
     */
    updateSelectionCount() {
        const count = this.selectedVoters.size;
        const badge = document.getElementById('voterSelectionCount');
        if (badge) {
            if (count > 0) {
                badge.textContent = `${count} selected`;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    /**
     * Clear all voter selections
     */
    clearSelections() {
        this.selectedVoters.clear();
        const rows = document.querySelectorAll('.vp-table-row--selected');
        rows.forEach(row => row.classList.remove('vp-table-row--selected'));
        this.updateSelectionCount();
    }

    /**
     * Get party affiliation badge HTML
     * @param {string} partyCode - Party code (D/R/I/null)
     * @returns {string} HTML for party badge
     */
    getPartyBadge(partyCode) {
        if (!partyCode) {
            return '<span class="badge bg-secondary">Unknown</span>';
        }

        const parties = {
            'D': { label: 'Democrat', color: 'primary', icon: 'bi-circle-fill' },
            'R': { label: 'Republican', color: 'danger', icon: 'bi-circle-fill' },
            'I': { label: 'Independent', color: 'warning', icon: 'bi-circle' },
            'L': { label: 'Libertarian', color: 'info', icon: 'bi-circle' },
            'G': { label: 'Green', color: 'success', icon: 'bi-circle' }
        };

        const party = parties[partyCode.toUpperCase()] || { label: partyCode, color: 'secondary', icon: 'bi-circle' };
        return `<span class="badge bg-${party.color}"><i class="${party.icon}"></i> ${party.label}</span>`;
    }

    /**
     * Show detailed voter information modal
     * @param {number} voterId - Voter database ID
     */
    async showVoterDetails(voterId) {
        try {
            // Fetch full voter details including election history
            const response = await fetch(`/api/voters/${voterId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch voter details');
            }

            const result = await response.json();
            const voter = result.data;

            // Populate modal with voter data
            document.getElementById('detailName').textContent = `${voter.firstName} ${voter.lastName}`;
            document.getElementById('detailVoterId').textContent = voter.voterId || 'N/A';
            document.getElementById('detailAddress').textContent = voter.address || 'N/A';
            document.getElementById('detailCityZip').textContent = `${voter.city || 'N/A'}, ${voter.zipCode || 'N/A'}`;
            document.getElementById('detailPrecinct').textContent = voter.precinctNumber || 'N/A';
            
            const partyBadge = this.getPartyBadge(voter.electionHistory?.[0]?.partyCode);
            document.getElementById('detailParty').innerHTML = partyBadge;
            
            document.getElementById('detailSuperVoter').innerHTML = voter.superVoter
                ? '<span class="badge bg-success"><i class="bi bi-star-fill"></i> Yes</span>'
                : '<span class="badge bg-light text-dark">No</span>';

            const totalElections = voter.electionHistory?.length || 0;
            const votedElections = voter.electionHistory?.filter(e => e.voted).length || 0;
            const participationRate = totalElections > 0 ? Math.round((votedElections / totalElections) * 100) : 0;
            document.getElementById('detailParticipation').innerHTML = `
                <span class="badge bg-info">${votedElections}/${totalElections}</span> 
                <span class="text-muted">(${participationRate}%)</span>
            `;

            const hasGeo = voter.latitude && voter.longitude;
            document.getElementById('detailGeocoded').innerHTML = hasGeo
                ? '<span class="badge bg-success"><i class="bi bi-geo-alt-fill"></i> Yes</span>'
                : '<span class="badge bg-secondary">No</span>';

            // Render election history table
            this.renderElectionHistory(voter.electionHistory || []);

            // Show modal
            if (this.voterDetailModal) {
                this.voterDetailModal.show();
            }
        } catch (error) {
            Logger.error('Error fetching voter details:', error);
            if (window.Toast) {
                window.Toast.error('Failed to load voter details', { title: 'Error' });
            }
        }
    }

    /**
     * Render election history table in modal
     * @param {Array} electionHistory - Array of election records
     */
    renderElectionHistory(electionHistory) {
        const tbody = document.getElementById('electionHistoryBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (electionHistory.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-muted">No election history available</td>
                </tr>
            `;
            return;
        }

        // Sort by election code (most recent first)
        const sorted = [...electionHistory].sort((a, b) => b.electionCode.localeCompare(a.electionCode));

        sorted.forEach(election => {
            const row = document.createElement('tr');
            
            // Election code/name
            const electionCell = document.createElement('td');
            electionCell.textContent = this.formatElectionCode(election.electionCode);
            row.appendChild(electionCell);

            // Voted status
            const votedCell = document.createElement('td');
            votedCell.innerHTML = election.voted
                ? '<span class="badge bg-success"><i class="bi bi-check-circle-fill"></i> Yes</span>'
                : '<span class="badge bg-secondary">No</span>';
            row.appendChild(votedCell);

            // Party
            const partyCell = document.createElement('td');
            partyCell.innerHTML = this.getPartyBadge(election.partyCode);
            row.appendChild(partyCell);

            // Early vote
            const earlyCell = document.createElement('td');
            earlyCell.innerHTML = election.earlyVoted
                ? '<span class="badge bg-info">Early</span>'
                : '<span class="badge bg-light text-dark">Regular</span>';
            row.appendChild(earlyCell);

            tbody.appendChild(row);
        });
    }

    /**
     * Format election code for display
     * @param {string} code - Election code (e.g., 'E_1', 'E_2')
     * @returns {string} Formatted election name
     */
    formatElectionCode(code) {
        if (!code) return 'Unknown';
        
        // Try to parse election code format: E_1, E_2, etc.
        const parts = code.split('_');
        if (parts.length === 2 && parts[0] === 'E') {
            const electionNumber = parseInt(parts[1]);
            return `Election ${electionNumber}`;
        }
        
        return code;
    }

    /**
     * Attach event listeners to pagination controls
     */
    attachPaginationListeners() {
        // Page size selector
        const pageSizeSelect = document.getElementById('voterPageSize');
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                const newSize = parseInt(e.target.value);
                
                // Get filter controller from global scope (set by app.js)
                if (window.app && window.app.filterController) {
                    window.app.filterController.changePageSize(newSize);
                }
            });
        }
    }

    /**
     * Render pagination controls
     * @param {Object} pagination - Pagination metadata from state
     */
    renderPagination(pagination) {
        if (!pagination) return;
        
        // Update "Showing X to Y of Z" display
        const showingStart = document.getElementById('voterShowingStart');
        const showingEnd = document.getElementById('voterShowingEnd');
        const showingTotal = document.getElementById('voterShowingTotal');
        
        if (showingStart) {
            showingStart.textContent = pagination.total > 0 ? pagination.offset + 1 : 0;
        }
        if (showingEnd) {
            showingEnd.textContent = Math.min(
                pagination.offset + pagination.limit,
                pagination.total
            );
        }
        if (showingTotal) {
            showingTotal.textContent = pagination.total.toLocaleString();
        }
        
        // Update pagination controls
        const paginationEl = document.getElementById('voterListPagination');
        if (!paginationEl) return;
        
        const { currentPage, totalPages } = pagination;
        
        // Button base classes
        const btnBase = 'px-3 py-1.5 text-sm font-medium border transition-colors';
        const btnEnabled = 'text-secondary-600 dark:text-secondary-300 bg-white dark:bg-secondary-700 border-secondary-300 dark:border-secondary-600 hover:bg-secondary-50 dark:hover:bg-secondary-600 cursor-pointer';
        const btnDisabled = 'text-secondary-400 dark:text-secondary-500 bg-secondary-100 dark:bg-secondary-800 border-secondary-200 dark:border-secondary-700 cursor-not-allowed';
        const btnActive = 'text-white bg-primary-600 border-primary-600 dark:bg-primary-500 dark:border-primary-500';
        
        // If no data, show disabled controls
        if (totalPages === 0) {
            paginationEl.innerHTML = `
                <button class="${btnBase} ${btnDisabled} rounded-l-md" disabled aria-disabled="true">
                    <i class="bi bi-chevron-left" aria-hidden="true"></i> Previous
                </button>
                <button class="${btnBase} ${btnDisabled} rounded-r-md" disabled aria-disabled="true">
                    Next <i class="bi bi-chevron-right" aria-hidden="true"></i>
                </button>
            `;
            return;
        }
        
        let html = '';
        
        // Previous button
        const prevDisabled = currentPage === 1;
        html += `
            <button class="${btnBase} ${prevDisabled ? btnDisabled : btnEnabled} rounded-l-md flex items-center gap-1" 
                    data-page="${currentPage - 1}" 
                    ${prevDisabled ? 'disabled aria-disabled="true"' : ''}
                    aria-label="Go to previous page">
                <i class="bi bi-chevron-left" aria-hidden="true"></i> Previous
            </button>
        `;
        
        // Page numbers (show max 5 pages around current)
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);
        
        // Show first page if not in range
        if (startPage > 1) {
            html += `
                <button class="${btnBase} ${btnEnabled} border-l-0" data-page="1" aria-label="Go to page 1">1</button>
            `;
            if (startPage > 2) {
                html += `
                    <span class="${btnBase} ${btnDisabled} border-l-0" aria-hidden="true">...</span>
                `;
            }
        }
        
        // Page number buttons
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === currentPage;
            html += `
                <button class="${btnBase} ${isActive ? btnActive : btnEnabled} border-l-0" 
                        data-page="${i}" 
                        ${isActive ? 'aria-current="page"' : `aria-label="Go to page ${i}"`}>
                    ${i}
                </button>
            `;
        }
        
        // Show last page if not in range
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += `
                    <span class="${btnBase} ${btnDisabled} border-l-0" aria-hidden="true">...</span>
                `;
            }
            html += `
                <button class="${btnBase} ${btnEnabled} border-l-0" data-page="${totalPages}" 
                        aria-label="Go to page ${totalPages}">${totalPages}</button>
            `;
        }
        
        // Next button
        const nextDisabled = currentPage === totalPages;
        html += `
            <button class="${btnBase} ${nextDisabled ? btnDisabled : btnEnabled} rounded-r-md border-l-0 flex items-center gap-1" 
                    data-page="${currentPage + 1}"
                    ${nextDisabled ? 'disabled aria-disabled="true"' : ''}
                    aria-label="Go to next page">
                Next <i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
        `;
        
        paginationEl.innerHTML = html;
        
        // Attach click handlers to all pagination buttons
        paginationEl.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Don't handle disabled buttons
                if (btn.disabled) return;
                
                const pageNumber = parseInt(btn.dataset.page);
                
                if (pageNumber && window.app && window.app.filterController) {
                    window.app.filterController.goToPage(pageNumber);
                }
            });
        });
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
window.VoterListController = VoterListController;
