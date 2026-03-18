/**
 * Centralized API Key Configuration
 * Single source of truth for all Google Maps API keys
 * 
 * Supports per-service keys for production (separate quotas),
 * but falls back to a single shared key for development.
 * 
 * Migration Status: Added Routes API support with backward compatibility
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

module.exports = {
    /** Google Maps JavaScript API key (frontend map rendering) */
    mapsApiKey: GOOGLE_MAPS_API_KEY || '',
    
    /** Geocoding API key (address → lat/lng) */
    geocodingApiKey: process.env.GOOGLE_MAPS_GEOCODING_API_KEY || GOOGLE_MAPS_API_KEY,
    
    /** Routes API key (NEW - Compute Route Matrix) */
    routesApiKey: process.env.GOOGLE_MAPS_ROUTES_API_KEY || GOOGLE_MAPS_API_KEY,
    
    /** Distance Matrix API key (LEGACY - for rollback only) */
    distanceMatrixApiKey: process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY || GOOGLE_MAPS_API_KEY,
    
    /**
     * Validate that at least the base API key is configured.
     * Called at server startup.
     * @returns {{ valid: boolean, warnings: string[] }}
     */
    validate() {
        const warnings = [];
        
        if (!GOOGLE_MAPS_API_KEY) {
            return { 
                valid: false, 
                warnings: ['GOOGLE_MAPS_API_KEY not set in .env'] 
            };
        }
        
        if (!process.env.GOOGLE_MAPS_GEOCODING_API_KEY) {
            warnings.push('GOOGLE_MAPS_GEOCODING_API_KEY not set — falling back to GOOGLE_MAPS_API_KEY');
        }
        
        // Check Routes API configuration
        const useRoutesApi = process.env.USE_ROUTES_API === 'true';
        if (useRoutesApi && !process.env.GOOGLE_MAPS_ROUTES_API_KEY) {
            warnings.push('Routes API enabled but GOOGLE_MAPS_ROUTES_API_KEY not set — falling back to GOOGLE_MAPS_API_KEY');
        }
        
        // Legacy Distance Matrix API warning
        if (!useRoutesApi && !process.env.GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY) {
            warnings.push('GOOGLE_MAPS_DISTANCE_MATRIX_API_KEY not set — falling back to GOOGLE_MAPS_API_KEY');
        }
        
        return { valid: true, warnings };
    }
};
