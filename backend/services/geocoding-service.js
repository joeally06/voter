/**
 * Geocoding Service
 * Handles Google Maps Geocoding API integration
 * 
 * Features:
 * - Google Maps API client wrapper
 * - Rate limiting to prevent quota exhaustion
 * - Retry logic with exponential backoff
 * - Quality score calculation
 * - Error handling for all API error codes
 */

const { Client } = require('@googlemaps/google-maps-services-js');
const Bottleneck = require('bottleneck');
const database = require('../config/database');
const QuotaManager = require('./quota-manager');
const apiKeys = require('../config/api-keys');

class GeocodingService {
  constructor() {
    // Initialize Google Maps Client
    this.client = new Client({});
    this.apiKey = apiKeys.geocodingApiKey;
    
    // Rate limiting configuration
    const rateLimit = parseInt(process.env.GEOCODING_RATE_LIMIT) || 10; // Requests per second
    const delayMs = parseInt(process.env.GEOCODING_DELAY_MS) || 100;
    
    // Create rate limiter using Bottleneck
    this.limiter = new Bottleneck({
      maxConcurrent: 1,              // One request at a time
      minTime: delayMs,              // Minimum delay between requests
      reservoir: rateLimit,          // Max requests
      reservoirRefreshAmount: rateLimit,
      reservoirRefreshInterval: 1000 // Per second
    });
    
    // Unified quota manager (uses api_usage table)
    this.quotaManager = new QuotaManager();

    // Validate API key
    if (!this.apiKey || this.apiKey === 'your_geocoding_api_key_here') {
      console.warn('⚠️  Warning: Google Maps API key not configured. Geocoding will fail.');
    }
  }

  /**
   * Geocode a single address
   * 
   * @param {string} address - Street address
   * @param {Object} components - Address components (city, state, zip)
   * @returns {Promise<Object>} Geocoding result with coordinates and quality score
   */
  async geocodeAddress(address, components = {}) {
    // Validate inputs
    if (!address || address.trim() === '') {
      return {
        success: false,
        error: 'Address is required',
        error_type: 'INVALID_REQUEST'
      };
    }

    // Check API key
    if (!this.apiKey || this.apiKey === 'your_geocoding_api_key_here') {
      return {
        success: false,
        error: 'Google Maps API key not configured',
        error_type: 'REQUEST_DENIED'
      };
    }

    try {
      // Use rate limiter to schedule the API call
      const response = await this.limiter.schedule(() => 
        this.makeGeocodingRequest(address, components)
      );
      
      // Track API usage
      await this.incrementQuotaUsage();
      
      return response;
      
    } catch (error) {
      console.error('Geocoding error:', error.message);
      return {
        success: false,
        error: error.message,
        error_type: 'API_ERROR'
      };
    }
  }

  /**
   * Make the actual geocoding API request
   * 
   * @private
   */
  async makeGeocodingRequest(address, components) {
    try {
      const params = {
        address: address,
        key: this.apiKey,
        region: 'us' // Bias results to United States
      };

      // CRITICAL FIX: Add component filtering with state support
      // This improves geocoding quality by providing geographic constraints
      if (components.locality || components.administrative_area || components.postal_code || components.state) {
        const componentParts = [];
        if (components.locality) componentParts.push(`locality:${components.locality}`);
        // State takes priority over administrative_area
        if (components.state) {
          componentParts.push(`administrative_area:${components.state}`);
        } else if (components.administrative_area) {
          componentParts.push(`administrative_area:${components.administrative_area}`);
        }
        if (components.postal_code) componentParts.push(`postal_code:${components.postal_code}`);
        params.components = componentParts.join('|');
      }

      const response = await this.client.geocode({
        params: params,
        timeout: 5000 // 5 second timeout
      });

      return this.processGeocodingResponse(response);
      
    } catch (error) {
      return this.handleApiError(error, address);
    }
  }

  /**
   * Process Google Maps API response
   * 
   * @private
   */
  processGeocodingResponse(response) {
    const status = response.data?.status;
    
    if (status !== 'OK') {
      return {
        success: false,
        error: `Geocoding failed: ${status}`,
        error_type: status
      };
    }

    if (!response.data.results || response.data.results.length === 0) {
      return {
        success: false,
        error: 'No results found',
        error_type: 'ZERO_RESULTS'
      };
    }

    const result = response.data.results[0];
    const location = result.geometry?.location;
    
    if (!location) {
      return {
        success: false,
        error: 'No location data in response',
        error_type: 'INVALID_RESPONSE'
      };
    }

    // Calculate quality score
    const qualityScore = this.calculateQualityScore(response);

    return {
      success: true,
      latitude: location.lat,
      longitude: location.lng,
      formatted_address: result.formatted_address,
      place_id: result.place_id,
      location_type: result.geometry.location_type,
      partial_match: result.partial_match || false,
      quality_score: qualityScore,
      components: result.address_components,
      source: 'api'
    };
  }

  /**
   * Calculate quality score based on geocoding result
   * 
   * Score factors:
   * - Location type (60%): ROOFTOP=60, RANGE_INTERPOLATED=48, GEOMETRIC_CENTER=36, APPROXIMATE=24
   * - Partial match penalty (-30%)
   * - Address completeness (20%)
   * - Result count (10%)
   * - State validation (10%)
   * 
   * @param {Object} geocodeResponse - Google Maps API response
   * @returns {number} Quality score (0-100)
   */
  calculateQualityScore(geocodeResponse) {
    if (!geocodeResponse?.data || geocodeResponse.data.status !== 'OK') {
      return 0;
    }

    const result = geocodeResponse.data.results[0];
    let score = 0;

    // Factor 1: Location Type (60% weight)
    const locationType = result.geometry?.location_type;
    switch (locationType) {
      case 'ROOFTOP':
        score += 60;
        break;
      case 'RANGE_INTERPOLATED':
        score += 48; // 80% of 60
        break;
      case 'GEOMETRIC_CENTER':
        score += 36; // 60% of 60
        break;
      case 'APPROXIMATE':
        score += 24; // 40% of 60
        break;
      default:
        score += 20;
    }

    // Factor 2: Partial Match Penalty (30% deduction)
    if (result.partial_match === true) {
      score -= 30;
    }

    // Factor 3: Address Components Completeness (20% weight)
    const components = result.address_components || [];
    const requiredTypes = ['street_number', 'route', 'locality', 'administrative_area_level_1', 'postal_code'];
    const foundTypes = components.flatMap(c => c.types);
    const completeness = requiredTypes.filter(type => foundTypes.includes(type)).length / requiredTypes.length;
    score += completeness * 20;

    // Factor 4: Result Count (10% weight)
    const resultCount = geocodeResponse.data.results.length;
    if (resultCount === 1) {
      score += 10; // Perfect match
    } else if (resultCount <= 3) {
      score += 7;  // Good match
    } else {
      score += 4;  // Ambiguous
    }

    // Factor 5: State Validation (10% weight)
    const stateComponent = components.find(c => 
      c.types.includes('administrative_area_level_1') && c.short_name === 'TN'
    );
    if (stateComponent) {
      score += 10; // Correct state
    }

    // Clamp score to 0-100 range
    score = Math.max(0, Math.min(100, score));
    
    return Math.round(score);
  }

  /**
   * Handle API errors
   * 
   * @private
   */
  async handleApiError(error, address) {
    const status = error.response?.data?.status;
    const errorMessage = error.response?.data?.error_message || error.message;

    switch (status) {
      case 'ZERO_RESULTS':
        return {
          success: false,
          error: 'Address not found',
          error_type: 'ZERO_RESULTS',
          retry: false
        };
      
      case 'OVER_QUERY_LIMIT':
      case 'OVER_DAILY_LIMIT':
        return {
          success: false,
          error: 'API quota limit exceeded',
          error_type: 'RATE_LIMIT',
          retry: true
        };
      
      case 'REQUEST_DENIED':
        return {
          success: false,
          error: `API request denied: ${errorMessage}`,
          error_type: 'REQUEST_DENIED',
          retry: false
        };
      
      case 'INVALID_REQUEST':
        return {
          success: false,
          error: 'Invalid geocoding request',
          error_type: 'INVALID_REQUEST',
          retry: false
        };
      
      case 'UNKNOWN_ERROR':
      default:
        return {
          success: false,
          error: `Geocoding API error: ${errorMessage}`,
          error_type: 'API_ERROR',
          retry: true
        };
    }
  }

  /**
   * Geocode with retry logic (exponential backoff)
   * 
   * @param {string} address - Street address
   * @param {Object} components - Address components
   * @param {number} maxRetries - Maximum retry attempts (default: 3)
   * @returns {Promise<Object>} Geocoding result
   */
  async geocodeWithRetry(address, components, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.geocodeAddress(address, components);
        
        if (result.success) {
          return result; // Success
        }

        // Check if error is retryable
        if (!result.retry) {
          return result; // Don't retry permanent errors
        }

        lastError = result;

        // Calculate exponential backoff delay
        const baseDelay = 1000; // 1 second
        const maxDelay = 60000; // 60 seconds
        const jitter = Math.random() * 1000; // 0-1 second jitter
        
        const delay = Math.min(
          maxDelay,
          baseDelay * Math.pow(2, attempt) + jitter
        );

        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms for address: ${address}`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        lastError = {
          success: false,
          error: error.message,
          error_type: 'EXCEPTION',
          retry: true
        };
      }
    }

    // All retries exhausted
    return lastError || {
      success: false,
      error: 'Max retries exceeded',
      error_type: 'MAX_RETRIES'
    };
  }

  /**
   * Increment API quota usage counter
   * 
   * @private
   */
  async incrementQuotaUsage() {
    try {
      // Use unified QuotaManager (api_usage table) instead of legacy api_quotas table
      await this.quotaManager.incrementApiCall('geocoding', 1);
    } catch (error) {
      console.error('Failed to update quota:', error.message);
    }
  }

  /**
   * Get daily API usage
   * 
   * @param {string} date - Date in YYYY-MM-DD format (default: today)
   * @returns {Promise<number>} Request count for the date
   */
  async getDailyUsage(date = null) {
    try {
      const dateKey = date || new Date().toISOString().split('T')[0];
      
      // Use unified api_usage table instead of legacy api_quotas table
      const result = await database.get(`
        SELECT call_count FROM api_usage 
        WHERE api_name = 'geocoding' AND call_date = ?
      `, [dateKey]);
      
      return result?.call_count || 0;
    } catch (error) {
      console.error('Failed to get quota usage:', error.message);
      return 0;
    }
  }

  /**
   * Check if daily quota limit would be exceeded
   * 
   * @param {number} estimatedCalls - Number of API calls about to be made
   * @throws {Error} If quota limit would be exceeded
   */
  async checkQuotaLimit(estimatedCalls) {
    // Delegate to unified QuotaManager for consistent quota enforcement
    // QuotaManager uses api_usage table and provides richer error messages
    await this.quotaManager.checkQuota('geocoding', estimatedCalls);
  }
}

module.exports = GeocodingService;
