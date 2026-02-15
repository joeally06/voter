/**
 * Voter Outreach Platform - Main Application
 * Phase 4: Full-featured voter mapping and analytics platform
 * 
 * This application provides the frontend interface for the Voter Outreach Platform.
 * Includes interactive mapping, filtering, analytics, and responsive UI.
 */

class VoterApp {
    constructor() {
        // Use configuration from window.APP_CONFIG if available, fallback to default
        this.apiBaseUrl = window.APP_CONFIG?.apiBaseUrl || '/api';
        this.initialized = false;
        this.updateInterval = null;
        
        // Phase 4: Initialize new components
        this.stateManager = null;
        this.voterService = null;
        this.uploadService = null;
        this.mapController = null;
        this.filterController = null;
        this.chartController = null;
        this.uploadController = null;
        this.keyboardController = null; // Phase 3: Keyboard navigation
    }

    /**
     * Initialize the application
     * Called when DOM is ready
     */
    async init() {
        Logger.info('🚀 Initializing Voter Outreach Platform...');
        
        try {
            await this.initializeServices();
            await this.checkHealth();
            await this.loadStatus();
            this.setupAutoRefresh();
            await this.loadGoogleMaps();
            await this.initializeControllers();
            this.setupTabNavigation();

            this.initialized = true;
            Logger.info('✅ Application initialized successfully');
            
            // Update phase indicator
            this.updatePhaseIndicator('Phase 4 - Interactive Features Active');
            
        } catch (error) {
            Logger.error('❌ Initialization failed:', error);
            this.displayError('Failed to initialize application. Please check server connection.');
        }
    }

    /**
     * Initialize core services (Phase 4)
     */
    async initializeServices() {
        // Initialize state manager
        this.stateManager = new StateManager();
        
        // Initialize API service
        this.voterService = new VoterService(this.apiBaseUrl);
        
        Logger.info('✅ Core services initialized');
    }

    /**
     * Load Google Maps API dynamically from backend configuration
     * This allows the API key to be stored securely in .env file
     */
    async loadGoogleMaps() {
        try {
            // Check if already loaded
            if (typeof google !== 'undefined' && google.maps) {
                Logger.info('✅ Google Maps API already loaded');
                return true;
            }

            // Fetch configuration from backend
            const response = await fetch('/api/config');
            if (!response.ok) {
                throw new Error('Failed to fetch configuration');
            }
            
            const config = await response.json();
            
            if (!config.googleMapsApiKey) {
                Logger.warn('⚠️ Google Maps API key not configured in .env file');
                Utils.showToast('Map features unavailable: API key not configured', 'warning');
                return false;
            }
            
            Logger.debug('🔑 Loading Google Maps API...');
            
            // Load Google Maps script dynamically
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&callback=Function.prototype`;
                script.async = true;
                script.defer = true;
                
                script.onload = () => {
                    Logger.info('✅ Google Maps API loaded successfully');
                    resolve(true);
                };
                
                script.onerror = () => {
                    Logger.error('❌ Failed to load Google Maps API');
                    if (window.gm_authFailure) {
                        window.gm_authFailure();
                    }
                    Utils.showToast('Failed to load Google Maps. Please check your API key.', 'danger');
                    reject(new Error('Google Maps API load failed'));
                };
                
                document.head.appendChild(script);
            });
        } catch (error) {
            Logger.error('❌ Failed to load Google Maps configuration:', error);
            Utils.showToast('Failed to load map configuration.', 'danger');
            return false;
        }
    }

    /**
     * Initialize all controllers (Phase 4)
     * RECOMMENDED FIX #5: Error boundaries for graceful degradation
     */
    async initializeControllers() {
        const results = await Promise.allSettled([
            // Initialize Map Controller with error boundary
            this.initWithErrorBoundary('MapController', async () => {
                if (typeof google !== 'undefined' && google.maps) {
                    const mapElement = document.getElementById('map');
                    if (mapElement) {
                        this.mapController = new MapController(mapElement, this.stateManager);
                        await this.mapController.init();
                    } else {
                        throw new Error('Map container element not found');
                    }
                } else {
                    throw new Error('Google Maps API not available - check API key configuration');
                }
            }),

            // Initialize Filter Controller with error boundary
            this.initWithErrorBoundary('FilterController', async () => {
                this.filterController = new FilterController(this.voterService, this.stateManager);
                await this.filterController.init();
                
                // Make accessible globally for pagination
                if (!window.app) window.app = {};
                window.app.filterController = this.filterController;
            }),

            // Initialize Chart Controller with error boundary
            this.initWithErrorBoundary('ChartController', async () => {
                if (typeof Chart !== 'undefined') {
                    this.chartController = new ChartController(this.voterService, this.stateManager);
                    await this.chartController.init();
                } else {
                    throw new Error('Chart.js not available');
                }
            }),

            // Initialize Voter List Controller with error boundary
            this.initWithErrorBoundary('VoterListController', async () => {
                this.voterListController = new VoterListController(this.voterService, this.stateManager);
                await this.voterListController.init();
            }),

            // CRITICAL FIX #3: Initialize Target List Controller with error boundary
            // Added initialization for never-voted voters target list feature
            this.initWithErrorBoundary('TargetListController', async () => {
                this.targetListController = new TargetListController(this.voterService, this.stateManager);
                await this.targetListController.init();
            }),

            // Initialize Upload Controller with error boundary
            this.initWithErrorBoundary('UploadController', async () => {
                this.uploadService = new UploadService('/api/upload');
                this.uploadController = new UploadController(this.uploadService);
                await this.uploadController.init();
            }),

            // Phase 5: Initialize Route Planner Controller with error boundary
            this.initWithErrorBoundary('RoutePlannerController', async () => {
                if (typeof google !== 'undefined' && google.maps && this.mapController) {
                    this.routePlannerController = new RoutePlannerController(
                        this.mapController, 
                        this.voterService, 
                        this.stateManager
                    );
                    await this.routePlannerController.init();
                    
                    // Connect map controller to route planner for selection mode
                    this.mapController.setRoutePlanner(this.routePlannerController);
                } else {
                    throw new Error('Route planner requires Google Maps');
                }
            }),

            // Phase 3: Initialize Keyboard Controller with error boundary
            this.initWithErrorBoundary('KeyboardController', async () => {
                if (typeof KeyboardController !== 'undefined') {
                    this.keyboardController = new KeyboardController();
                    // Setup keyboard help button click handler
                    const helpBtn = document.getElementById('keyboard-help-btn');
                    if (helpBtn) {
                        helpBtn.addEventListener('click', () => {
                            this.keyboardController.toggleHelpOverlay();
                        });
                    }
                } else {
                    throw new Error('KeyboardController not available');
                }
            })
        ]);

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        Logger.info(`✅ ${successCount}/${results.length} controllers initialized`);
        
        if (successCount === 0) {
            Utils.showToast('Warning: Core features failed to initialize. Please refresh the page.', 'warning');
        } else if (successCount < results.length) {
            Utils.showToast('Some features may be limited. Application running in degraded mode.', 'info');
        }
        
        // Setup keyboard shortcuts after controllers are initialized
        this.setupKeyboardShortcuts();
    }

    /**
     * Initialize controller with error boundary
     * RECOMMENDED FIX #5: Graceful degradation
     * @param {string} name - Controller name
     * @param {Function} initFunc - Initialization function
     */
    async initWithErrorBoundary(name, initFunc) {
        try {
            await initFunc();
            Logger.info(`✅ ${name} initialized`);
            return true;
        } catch (error) {
            Logger.error(`❌ ${name} initialization failed:`, error);
            Utils.showToast(`${name.replace('Controller', '')} features unavailable.`, 'warning');
            return false;
        }
    }

    /**
     * Setup global keyboard shortcuts
     * RECOMMENDED FIX #6: Enhanced keyboard navigation
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Alt+F: Open filters (mobile)
            if (e.altKey && e.key === 'f') {
                const filterBtn = document.getElementById('mobileFilterBtn');
                if (filterBtn) {
                    filterBtn.click();
                    e.preventDefault();
                }
            }
            
            // Alt+E: Export data
            if (e.altKey && e.key === 'e') {
                const exportBtn = document.getElementById('exportBtn');
                if (exportBtn && !exportBtn.disabled) {
                    exportBtn.click();
                    e.preventDefault();
                }
            }
            
            // Alt+C: Clear filters
            if (e.altKey && e.key === 'c') {
                const clearBtn = document.getElementById('clearFilters');
                if (clearBtn) {
                    clearBtn.click();
                    e.preventDefault();
                }
            }
            
            // Escape: Close modals and offcanvas
            if (e.key === 'Escape') {
                const offcanvas = document.querySelector('.offcanvas.show');
                if (offcanvas) {
                    const bsOffcanvas = bootstrap.Offcanvas.getInstance(offcanvas);
                    if (bsOffcanvas) bsOffcanvas.hide();
                }
            }
        });
        
        Logger.info('⌨️ Keyboard shortcuts enabled (Alt+F, Alt+E, Alt+C, Esc)');
    }

    /**
     * Update phase indicator badge
     * @param {string} text - Phase text to display
     */
    updatePhaseIndicator(text) {
        const indicator = document.getElementById('phase-indicator');
        if (indicator) {
            indicator.textContent = text;
            indicator.className = 'badge bg-success status-badge';
        }
    }

    /**
     * Check server health status
     * @returns {Promise<Object>} Health check data
     */
    async checkHealth() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/health`);
            
            if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
            }
            
            const data = await response.json();
            Logger.debug('💚 Health Check:', data);
            return data;
        } catch (error) {
            Logger.error('❌ Health check error:', error);
            throw error;
        }
    }

    /**
     * Load and display system status
     */
    async loadStatus() {
        const statusDiv = document.getElementById('status-info');
        
        // Skip if status-info element doesn't exist (e.g., in new Tailwind UI)
        if (!statusDiv) {
            Logger.debug('ℹ️ status-info element not found, skipping legacy status display');
            return;
        }
        
        try {
            const health = await this.checkHealth();
            
            // Build status display HTML
            const statusHTML = `
                <div class="row text-center">
                    <div class="col-md-2">
                        <div class="p-3">
                            <i class="bi bi-activity text-success" style="font-size: 2rem;"></i>
                            <p class="fw-bold mt-2 mb-0">Server Status</p>
                            <span class="badge bg-success">${health.status}</span>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="p-3">
                            <i class="bi bi-people text-primary" style="font-size: 2rem;"></i>
                            <p class="fw-bold mt-2 mb-0">Total Voters</p>
                            <p class="mb-0 h4">${health.database.totalVoters || 0}</p>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="p-3">
                            <i class="bi bi-geo-alt text-info" style="font-size: 2rem;"></i>
                            <p class="fw-bold mt-2 mb-0">Geocoded</p>
                            <p class="mb-0 h4">${health.database.geocodedVoters || 0}</p>
                            <small class="text-muted">${health.database.geocodingProgress}%</small>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="p-3">
                            <i class="bi bi-map text-warning" style="font-size: 2rem;"></i>
                            <p class="fw-bold mt-2 mb-0">Precincts</p>
                            <p class="mb-0 h4">${health.database.totalPrecincts || 0}</p>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="p-3">
                            <i class="bi bi-star text-danger" style="font-size: 2rem;"></i>
                            <p class="fw-bold mt-2 mb-0">Super Voters</p>
                            <p class="mb-0 h4">${health.database.superVoters || 0}</p>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="p-3">
                            <i class="bi bi-clock text-secondary" style="font-size: 2rem;"></i>
                            <p class="fw-bold mt-2 mb-0">Uptime</p>
                            <p class="mb-0">${this.formatUptime(health.uptime)}</p>
                        </div>
                    </div>
                </div>
                <div class="row mt-3">
                    <div class="col-12">
                        <div class="alert alert-info d-flex align-items-center" role="alert">
                            <i class="bi bi-info-circle-fill me-2"></i>
                            <div>
                                <strong>Phase 1 Complete!</strong> Infrastructure is ready. 
                                Next step: Upload DBF voter data files in Phase 2.
                            </div>
                        </div>
                    </div>
                </div>
                <div class="row">
                    <div class="col-12 text-end">
                        <small class="text-muted">
                            <i class="bi bi-clock-history"></i> 
                            Last updated: ${new Date(health.timestamp).toLocaleString()}
                        </small>
                    </div>
                </div>
            `;
            
            statusDiv.innerHTML = statusHTML;
            
        } catch (error) {
            statusDiv.innerHTML = `
                <div class="alert alert-danger d-flex align-items-center" role="alert">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    <div>
                        <strong>Error:</strong> Failed to load system status. 
                        Please ensure the server is running.
                    </div>
                </div>
            `;
        }
    }

    /**
     * Setup auto-refresh for status display
     * Refreshes every 30 seconds
     */
    setupAutoRefresh() {
        // Refresh status every 30 seconds
        this.updateInterval = setInterval(() => {
            Logger.debug('🔄 Auto-refreshing status...');
            this.loadStatus();
        }, 30000);
        
        Logger.debug('⏱️  Auto-refresh enabled (30s interval)');
    }

    /**
     * Display error message
     * @param {string} message - Error message to display
     */
    displayError(message) {
        const statusDiv = document.getElementById('status-info');
        
        // Skip if status-info element doesn't exist
        if (!statusDiv) {
            Logger.error('❌ App Error:', message);
            // Show toast instead if available
            if (window.Toast && window.Toast.show) {
                window.Toast.show(message, 'error');
            }
            return;
        }
        
        statusDiv.innerHTML = `
            <div class="alert alert-danger d-flex align-items-center" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                <div>
                    <strong>Error:</strong> ${message}
                </div>
            </div>
        `;
    }

    /**
     * Format uptime in human-readable format
     * @param {number} seconds - Uptime in seconds
     * @returns {string} Formatted uptime string
     */
    formatUptime(seconds) {
        if (!seconds) return 'N/A';
        
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (days > 0) {
            return `${days}d ${hours}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Setup tab navigation with URL hash support
     * Phase 1 UI Modernization
     */
    setupTabNavigation() {
        Logger.debug('🗂️  Setting up tab navigation...');

        // Handle tab switching
        const tabTriggers = document.querySelectorAll('[data-bs-toggle="tab"]');
        tabTriggers.forEach(trigger => {
            trigger.addEventListener('shown.bs.tab', (event) => {
                const tabId = event.target.getAttribute('data-bs-target');

                // Update URL hash without scrolling
                history.replaceState(null, null, tabId);

                // Store active tab in localStorage
                localStorage.setItem('activeTab', tabId);

                // Trigger resize event for charts (fixes chart sizing issues)
                window.dispatchEvent(new Event('resize'));

                Logger.debug(`📂 Switched to tab: ${tabId}`);
            });
        });

        // Restore active tab from URL hash or localStorage
        const hash = window.location.hash || localStorage.getItem('activeTab') || '#route-tab';
        const tabToActivate = document.querySelector(`[data-bs-target="${hash}"]`);

        if (tabToActivate) {
            // Use Bootstrap's Tab class to programmatically switch tabs
            const tab = new bootstrap.Tab(tabToActivate);
            tab.show();
            Logger.debug(`✅ Restored tab: ${hash}`);
        } else {
            Logger.debug('✅ Default tab (Route Planning) activated');
        }
    }

    /**
     * Cleanup on page unload
     */
    cleanup() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            Logger.debug('🧹 Auto-refresh stopped');
        }
        
        // Phase 4: Cleanup controllers
        if (this.chartController) {
            this.chartController.destroy();
        }
        
        if (this.voterService) {
            this.voterService.clearCache();
        }
    }
}

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

// Create global app instance
let voterApp;

/**
 * Initialize app when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    voterApp = new VoterApp();
    voterApp.init();
});

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    if (voterApp) {
        voterApp.cleanup();
    }
});

// Application info logged at debug level
Logger.debug('Voter Outreach Platform v4.0.0 initialized');
