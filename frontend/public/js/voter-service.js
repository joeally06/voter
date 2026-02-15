/**
 * Voter Service
 * API communication layer for voter data
 */
class VoterService {
  constructor(baseUrl = window.APP_CONFIG?.apiBaseUrl || '/api') {
    this.baseUrl = baseUrl;
    this.cache = new Map();
    // Use configuration for cache timeout, fallback to 5 minutes
    this.cacheTimeout = window.APP_CONFIG?.cacheTimeoutMs || (5 * 60 * 1000);
    // Use configuration for cache size, fallback to 50
    this.maxCacheSize = window.APP_CONFIG?.maxCacheSize || 50;
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }

  /**
   * Fetch voters with optional filters
   * @param {Object} filters - Filter parameters
   * @param {Object} pagination - Pagination parameters
   * @returns {Promise<Object>} Voters data
   */
  async fetchVoters(filters = {}, pagination = {}) {
    const params = { ...filters, ...pagination };
    const cacheKey = this.generateCacheKey('voters', params);
    
    // RECOMMENDED FIX #7: Improved cache with stats tracking
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const queryString = this.buildQueryString(params);
      const response = await this.fetchWithRetry(`${this.baseUrl}/voters?${queryString}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch voters: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Cache result with LRU eviction
      this.setCache(cacheKey, data);
      
      return data;
    } catch (error) {
      Logger.error('Error fetching voters:', error);
      throw error;
    }
  }

  /**
   * Generate strong cache key
   * RECOMMENDED FIX #7: Better cache key generation
   * @param {string} prefix - Key prefix
   * @param {Object} params - Parameters
   * @returns {string} Cache key
   */
  generateCacheKey(prefix, params) {
    // Sort keys for consistent ordering
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});
    
    return `${prefix}:${JSON.stringify(sortedParams)}`;
  }

  /**
   * Get from cache with stats tracking
   * RECOMMENDED FIX #7: Cache statistics
   * @param {string} key - Cache key
   * @returns {*} Cached value or null
   */
  getFromCache(key) {
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      
      // Check if expired
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.cacheStats.hits++;
        const hitRate = this.getCacheHitRate();
        Logger.debug(`📦 Cache hit: ${key.substring(0, 50)}... (${hitRate}% hit rate)`);
        return cached.data;
      } else {
        // Remove expired entry
        this.cache.delete(key);
        Logger.debug(`⏰ Cache expired: ${key.substring(0, 50)}...`);
      }
    }
    
    this.cacheStats.misses++;
    return null;
  }

  /**
   * Set cache with LRU eviction
   * RECOMMENDED FIX #7: LRU cache eviction
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   */
  setCache(key, data) {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.cacheStats.evictions++;
      Logger.debug(`🗑️ Cache evicted: ${oldestKey.substring(0, 50)}...`);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Get cache hit rate percentage
   * @returns {number} Hit rate percentage
   */
  getCacheHitRate() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return total > 0 ? Math.round((this.cacheStats.hits / total) * 100) : 0;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      ...this.cacheStats,
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRate: this.getCacheHitRate()
    };
  }

  /**
   * Fetch single voter by ID
   * @param {number} id - Voter ID
   * @returns {Promise<Object>} Voter data
   */
  async fetchVoter(id) {
    try {
      const response = await fetch(`${this.baseUrl}/voters/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch voter: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      Logger.error('Error fetching voter:', error);
      throw error;
    }
  }

  /**
   * Fetch all precincts
   * @returns {Promise<Object>} Precincts data
   */
  async fetchPrecincts() {
    const cacheKey = 'precincts';
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/precincts`);
      if (!response.ok) {
        throw new Error(`Failed to fetch precincts: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Cache result
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      
      return data;
    } catch (error) {
      Logger.error('Error fetching precincts:', error);
      throw error;
    }
  }

  /**
   * Fetch analytics data
   * @param {string} type - Analytics type (voting-patterns, turnout, super-voters)
   * @param {Object} filters - Optional filters
   * @returns {Promise<Object>} Analytics data
   */
  async fetchAnalytics(type, filters = {}) {
    const params = this.buildQueryString(filters);
    
    try {
      const response = await fetch(`${this.baseUrl}/analytics/${type}?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${type} analytics: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      Logger.error(`Error fetching ${type} analytics:`, error);
      throw error;
    }
  }
  /**
   * Get demographics analytics
   * @param {Object} filters - Optional filters (precinct, groupBy)
   * @returns {Promise<Object>} Demographics data
   */
  async getDemographics(filters = {}) {
    const params = this.buildQueryString(filters);
    const url = `${this.baseUrl}/analytics/demographics${params ? '?' + params : ''}`;
    
    try {
      const response = await this.fetchWithRetry(url);
      if (!response.ok) {
        throw new Error(`Demographics fetch failed: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      Logger.error('Error fetching demographics:', error);
      throw error;
    }
  }
  /**
   * Get party affiliation analytics
   * @param {Object} filters - Optional filters (precinct, trendAnalysis)
   * @returns {Promise<Object>} Party affiliation data
   */
  async getPartyAffiliation(filters = {}) {
    return this.fetchAnalytics('party-affiliation', filters);
  }

  /**
   * Get voting patterns analytics
   * @param {Object} filters - Optional filters (precinct, electionCodes)
   * @returns {Promise<Object>} Voting patterns data
   */
  async getVotingPatterns(filters = {}) {
    return this.fetchAnalytics('voting-patterns', filters);
  }

  /**
   * Get turnout analytics
   * @param {Object} filters - Optional filters (electionCode, precinct)
   * @returns {Promise<Object>} Turnout data
   */
  async getTurnoutAnalysis(filters = {}) {
    return this.fetchAnalytics('turnout', filters);
  }

  /**
   * Fetch system health status
   * @returns {Promise<Object>} Health data
   */
  async fetchHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      Logger.error('Error fetching health:', error);
      throw error;
    }
  }

  /**
   * Fetch geocoding statistics
   * @returns {Promise<Object>} Geocoding stats
   */
  async fetchGeocodingStats() {
    try {
      const response = await fetch(`${this.baseUrl}/geocode/stats`);
      if (!response.ok) {
        throw new Error(`Failed to fetch geocoding stats: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      Logger.error('Error fetching geocoding stats:', error);
      throw error;
    }
  }

  /**
   * Build query string from parameters
   * @param {Object} params - Parameters object
   * @returns {string} Query string
   */
  buildQueryString(params) {
    return Object.entries(params)
      .filter(([_, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  }

  /**
   * Get voter engagement levels
   * @returns {Promise<Object>} Engagement level data
   */
  async getVoterEngagement() {
    const cacheKey = 'voter_engagement';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}/analytics/engagement-levels`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch engagement levels: ${response.status}`);
      }
      
      const data = await response.json();
      this.setCache(cacheKey, data);
      
      return data;
    } catch (error) {
      Logger.error('Error fetching voter engagement:', error);
      throw error;
    }
  }

  /**
   * Get non-voters by age demographics
   * @returns {Promise<Object>} Non-voter age demographics
   */
  async getNonVotersByAge() {
    const cacheKey = 'non_voters_by_age';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}/analytics/non-voter-demographics`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch non-voter demographics: ${response.status}`);
      }
      
      const data = await response.json();
      this.setCache(cacheKey, data);
      
      return data;
    } catch (error) {
      Logger.error('Error fetching non-voter demographics:', error);
      throw error;
    }
  }

  /**
   * Get non-voters by precinct
   * @returns {Promise<Object>} Non-voter precinct data
   */
  async getNonVotersByPrecinct() {
    const cacheKey = 'non_voters_by_precinct';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}/analytics/non-voters-by-precinct`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch non-voters by precinct: ${response.status}`);
      }
      
      const data = await response.json();
      this.setCache(cacheKey, data);
      
      return data;
    } catch (error) {
      Logger.error('Error fetching non-voters by precinct:', error);
      throw error;
    }
  }

  /**
   * Get never-voted voters with filters
   * @param {Object} filters - Filter parameters
   * @returns {Promise<Object>} Never-voted voters data
   */
  async getNeverVotedVoters(filters = {}) {
    const cacheKey = this.generateCacheKey('never_voted', filters);
    
    // Don't cache for exports
    if (!filters.export) {
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;
    }

    try {
      const queryString = this.buildQueryString(filters);
      const response = await this.fetchWithRetry(`${this.baseUrl}/voters/never-voted?${queryString}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch never-voted voters: ${response.status}`);
      }
      
      // Handle CSV export
      if (filters.export === 'csv') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `never-voted-voters-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        return { success: true };
      }
      
      const data = await response.json();
      
      if (!filters.export) {
        this.setCache(cacheKey, data);
      }
      
      return data;
    } catch (error) {
      Logger.error('Error fetching never-voted voters:', error);
      throw error;
    }
  }

  /**
   * Clear service cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheStats = { hits: 0, misses: 0, evictions: 0 };
    Logger.debug('🧹 Service cache cleared');
  }

  /**
   * Fetch with retry logic
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Response>} Fetch response
   */
  async fetchWithRetry(url, options = {}, maxRetries = window.APP_CONFIG?.maxRetryAttempts || 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        
        if (response.ok) {
          return response;
        }
        
        // Don't retry for client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Client error: ${response.status}`);
        }
        
        lastError = new Error(`Server error: ${response.status}`);
        
      } catch (error) {
        lastError = error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        Logger.debug(`🔄 Retry attempt ${i + 1}/${maxRetries}...`);
      }
    }
    
    throw lastError;
  }
}

// Make available globally
window.VoterService = VoterService;
