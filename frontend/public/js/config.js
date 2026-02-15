/**
 * Configuration Module
 * Loads and manages application configuration from backend
 * 
 * This module provides centralized configuration management by fetching
 * settings from the backend /api/config endpoint. All frontend components
 * should use window.APP_CONFIG for dynamic values instead of hardcoding.
 */

// Global configuration object
window.APP_CONFIG = null;

/**
 * Load application configuration from backend
 * @returns {Promise<Object>} Configuration object
 */
async function loadAppConfig() {
    try {
        Logger.info('📥 Loading application configuration...');
        
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`Failed to load configuration: ${response.status} ${response.statusText}`);
        }
        
        window.APP_CONFIG = await response.json();
        Logger.info('✅ Application configuration loaded successfully');
        Logger.debug('📍 Location:', window.APP_CONFIG.locationName);
        Logger.debug('🗺️  Map Center:', window.APP_CONFIG.mapCenter);
        
        return window.APP_CONFIG;
    } catch (error) {
        Logger.error('❌ Failed to load configuration from server:', error);
        Logger.warn('⚠️  Using default configuration values');
        
        // Set defaults as fallback
        window.APP_CONFIG = getDefaultConfig();
        return window.APP_CONFIG;
    }
}

/**
 * Get default configuration values
 * Used as fallback when server configuration is unavailable
 * @returns {Object} Default configuration
 */
function getDefaultConfig() {
    return {
        // API Configuration
        apiBaseUrl: '/api',
        uploadApiUrl: '/api/upload',
        
        // Geographic Settings
        locationName: 'Obion County, TN',
        mapCenter: { lat: 36.2639, lng: -89.1929 },
        mapZoom: 11,
        maxAutoZoom: 16,
        
        // Organization Settings
        organizationName: 'Obion County Election Commission',
        copyrightYear: new Date().getFullYear(),
        appVersion: '4.0.0',
        
        // Map Display Configuration
        markerClusterThreshold: 100,
        clusterRadius: 100,
        markerColors: {
            superVoter: '#198754',
            regular: '#6c757d'
        },
        
        // Performance Configuration
        cacheTimeoutMs: 300000, // 5 minutes
        maxCacheSize: 50,
        defaultPageSize: 1000,
        
        // Upload Configuration
        maxUploadSizeBytes: 104857600, // 100MB
        uploadPolling: {
            minInterval: 1000,
            maxInterval: 10000
        },
        
        // Network Configuration
        maxRetryAttempts: 3,
        
        // Styling Configuration
        chartColors: [
            '#0d6efd', '#198754', '#dc3545', '#ffc107',
            '#0dcaf0', '#6c757d', '#6f42c1', '#fd7e14',
            '#20c997', '#d63384'
        ],
        
        // Feature Flags
        features: {
            routePlanning: false,
            dataExport: true,
            analytics: true,
            markerClustering: true
        },
        
        // Google Maps (will be loaded from server if available)
        googleMapsApiKey: ''
    };
}

/**
 * Update dynamic UI elements with configuration values
 * Called after configuration is loaded
 */
function updateDynamicUIElements() {
    if (!window.APP_CONFIG) {
        Logger.warn('⚠️  Configuration not loaded, skipping UI updates');
        return;
    }
    
    // Update location badge
    const locationBadge = document.querySelector('.px-2.py-1.bg-white.text-gray-700:first-of-type');
    if (locationBadge && locationBadge.textContent.includes('County')) {
        locationBadge.textContent = window.APP_CONFIG.locationName;
        Logger.debug('✅ Updated location badge:', window.APP_CONFIG.locationName);
    }
    
    // Update footer with organization info, copyright year, and version
    const footer = document.querySelector('footer small');
    if (footer) {
        const year = window.APP_CONFIG.copyrightYear || new Date().getFullYear();
        const org = window.APP_CONFIG.organizationName || 'Obion County Election Commission';
        const version = window.APP_CONFIG.appVersion || 'Phase 4.0';
        
        // Preserve existing links
        footer.innerHTML = `
            Voter Outreach Platform &copy; ${year} | ${org}<br>
            <span id="app-version">${version}</span> | 
            <a href="#" class="text-muted">Documentation</a> | 
            <a href="#" class="text-muted">Support</a>
        `;
        Logger.debug('✅ Updated footer: ' + org + ' © ' + year + ' | Version ' + version);
    }
}

