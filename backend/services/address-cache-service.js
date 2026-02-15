/**
 * Address Cache Service
 * Manages geocoding cache for cost optimization
 * 
 * Features:
 * - Address normalization for consistent cache keys
 * - MD5 hash generation for cache lookup
 * - Cache CRUD operations
 * - TTL (Time-To-Live) management
 * - Cache statistics and performance metrics
 */

const crypto = require('crypto');
const database = require('../config/database');

class AddressCacheService {
  constructor() {
    this.cacheTtlDays = parseInt(process.env.CACHE_TTL_DAYS) || 90;
    this.cacheEnabled = process.env.CACHE_GEOCODING_RESULTS !== 'false';
  }

  /**
   * Normalize address for consistent cache key generation
   * 
   * Transformations:
   * - Convert to lowercase
   * - Trim whitespace
   * - Remove punctuation (except hyphens)
   * - Normalize common abbreviations
   * - Standardize directional prefixes
   * 
   * @param {string} rawAddress - Original street address
   * @param {string} city - City name
   * @param {string} state - State abbreviation
   * @param {string} zipCode - ZIP code
   * @returns {string} Normalized address in format "street|city|state|zip"
   */
  normalizeAddress(rawAddress, city, state, zipCode) {
    /**
     * Normalize a single address component
     * @private
     */
    const normalizeComponent = (str) => {
      if (!str) return '';
      
      return str
        .toString()
        .toLowerCase()
        .trim()
        // Remove punctuation except hyphens
        .replace(/[^\w\s-]/g, '')
        // Normalize common street abbreviations
        .replace(/\bstreet\b/g, 'st')
        .replace(/\bavenue\b/g, 'ave')
        .replace(/\bdrive\b/g, 'dr')
        .replace(/\broad\b/g, 'rd')
        .replace(/\bcourt\b/g, 'ct')
        .replace(/\blane\b/g, 'ln')
        .replace(/\bboulevard\b/g, 'blvd')
        .replace(/\bapartment\b/g, 'apt')
        .replace(/\bsuite\b/g, 'ste')
        .replace(/\bbuilding\b/g, 'bldg')
        .replace(/\bparkway\b/g, 'pkwy')
        .replace(/\bcircle\b/g, 'cir')
        .replace(/\bplace\b/g, 'pl')
        // Normalize directional prefixes
        .replace(/\bnorth\b/g, 'n')
        .replace(/\bsouth\b/g, 's')
        .replace(/\beast\b/g, 'e')
        .replace(/\bwest\b/g, 'w')
        .replace(/\bnortheast\b/g, 'ne')
        .replace(/\bnorthwest\b/g, 'nw')
        .replace(/\bsoutheast\b/g, 'se')
        .replace(/\bsouthwest\b/g, 'sw')
        // Remove extra whitespace
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Normalize each component
    const normalizedStreet = normalizeComponent(rawAddress);
    const normalizedCity = normalizeComponent(city);
    const normalizedState = normalizeComponent(state);
    const normalizedZip = normalizeComponent(zipCode);

    // Combine into cache key format: "street|city|state|zip"
    return `${normalizedStreet}|${normalizedCity}|${normalizedState}|${normalizedZip}`;
  }

  /**
   * Generate MD5 hash for cache key
   * 
   * @param {string} normalizedAddress - Normalized address string
   * @returns {string} MD5 hash (32 characters)
   */
  generateCacheKey(normalizedAddress) {
    return crypto
      .createHash('md5')
      .update(normalizedAddress)
      .digest('hex');
  }

  /**
   * Get cached geocoding result
   * 
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - State abbreviation (default: 'TN')
   * @param {string} zipCode - ZIP code
   * @returns {Promise<Object|null>} Cached result or null if not found/expired
   */
  async getCachedGeocode(address, city, state = 'TN', zipCode) {
    if (!this.cacheEnabled) {
      return null; // Caching disabled
    }

    try {
      // Step 1: Normalize address
      const normalized = this.normalizeAddress(address, city, state, zipCode);
      
      // Step 2: Generate cache key
      const cacheKey = this.generateCacheKey(normalized);
      
      // Step 3: Query cache
      const cached = await database.get(`
        SELECT 
          latitude,
          longitude,
          quality_score,
          formatted_address,
          place_id,
          components,
          cached_at
        FROM geocoding_cache
        WHERE address_hash = ?
      `, [cacheKey]);
      
      if (!cached) {
        return null; // Cache miss
      }
      
      // Step 4: Check if cache entry is expired
      const cacheAge = (Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60 * 24);
      
      if (cacheAge > this.cacheTtlDays) {
        // Cache expired - invalidate and treat as miss
        await this.invalidateCacheEntry(cacheKey);
        return null;
      }
      
      // Step 5: Return cached result
      return {
        latitude: cached.latitude,
        longitude: cached.longitude,
        quality_score: cached.quality_score,
        formatted_address: cached.formatted_address,
        place_id: cached.place_id,
        components: cached.components ? JSON.parse(cached.components) : null,
        source: 'cache',
        cached_at: cached.cached_at
      };
      
    } catch (error) {
      console.error('Cache lookup error:', error.message);
      return null; // Fail gracefully
    }
  }

  /**
   * Store geocoding result in cache
   * 
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - State abbreviation
   * @param {string} zipCode - ZIP code
   * @param {Object} geocodeResult - Geocoding result to cache
   * @returns {Promise<boolean>} Success status
   */
  async setCachedGeocode(address, city, state, zipCode, geocodeResult) {
    if (!this.cacheEnabled) {
      return false; // Caching disabled
    }

    try {
      const normalized = this.normalizeAddress(address, city, state, zipCode);
      const cacheKey = this.generateCacheKey(normalized);
      
      const originalAddress = `${address}, ${city}, ${state} ${zipCode}`;
      
      // UPSERT (INSERT OR REPLACE) to handle duplicates
      await database.run(`
        INSERT INTO geocoding_cache (
          address_hash,
          original_address,
          formatted_address,
          latitude,
          longitude,
          quality_score,
          place_id,
          components,
          cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(address_hash) 
        DO UPDATE SET
          formatted_address = excluded.formatted_address,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          quality_score = excluded.quality_score,
          place_id = excluded.place_id,
          components = excluded.components,
          cached_at = CURRENT_TIMESTAMP
      `, [
        cacheKey,
        originalAddress,
        geocodeResult.formatted_address || null,
        geocodeResult.latitude,
        geocodeResult.longitude,
        geocodeResult.quality_score,
        geocodeResult.place_id || null,
        geocodeResult.components ? JSON.stringify(geocodeResult.components) : null
      ]);
      
      return true;
      
    } catch (error) {
      console.error('Cache storage error:', error.message);
      return false;
    }
  }

  /**
   * Invalidate a specific cache entry
   * 
   * @param {string} cacheKey - MD5 hash of normalized address
   * @returns {Promise<boolean>} Success status
   */
  async invalidateCacheEntry(cacheKey) {
    try {
      await database.run(`
        DELETE FROM geocoding_cache
        WHERE address_hash = ?
      `, [cacheKey]);
      
      return true;
    } catch (error) {
      console.error('Cache invalidation error:', error.message);
      return false;
    }
  }

  /**
   * Invalidate expired cache entries
   * 
   * @param {number} ttlDays - Age threshold in days (default: from config)
   * @returns {Promise<number>} Number of deleted entries
   */
  async invalidateExpiredCache(ttlDays = null) {
    const threshold = ttlDays || this.cacheTtlDays;
    
    try {
      const result = await database.run(`
        DELETE FROM geocoding_cache
        WHERE julianday('now') - julianday(cached_at) > ?
      `, [threshold]);
      
      return result.changes || 0;
    } catch (error) {
      console.error('Expired cache cleanup error:', error.message);
      return 0;
    }
  }

  /**
   * Invalidate cache entries by quality score
   * 
   * @param {number} minQualityScore - Minimum quality threshold
   * @returns {Promise<number>} Number of deleted entries
   */
  async invalidateByQuality(minQualityScore = 50) {
    try {
      const result = await database.run(`
        DELETE FROM geocoding_cache
        WHERE quality_score < ?
      `, [minQualityScore]);
      
      return result.changes || 0;
    } catch (error) {
      console.error('Quality-based cache cleanup error:', error.message);
      return 0;
    }
  }

  /**
   * Get cache statistics
   * 
   * @returns {Promise<Object>} Cache performance metrics
   */
  async getCacheStats() {
    try {
      const totalCached = await database.get(`
        SELECT COUNT(*) as count FROM geocoding_cache
      `);
      
      const avgQualityScore = await database.get(`
        SELECT AVG(quality_score) as avg_score FROM geocoding_cache
      `);
      
      const lastUpdate = await database.get(`
        SELECT MAX(cached_at) as last_update FROM geocoding_cache
      `);
      
      const qualityDistribution = await database.all(`
        SELECT 
          CASE 
            WHEN quality_score >= 90 THEN 'Excellent (90-100)'
            WHEN quality_score >= 70 THEN 'Good (70-89)'
            WHEN quality_score >= 50 THEN 'Fair (50-69)'
            WHEN quality_score >= 25 THEN 'Poor (25-49)'
            ELSE 'Failed (0-24)'
          END as quality_range,
          COUNT(*) as count
        FROM geocoding_cache
        GROUP BY quality_range
        ORDER BY MIN(quality_score) DESC
      `);
      
      // Calculate cache hit rate from recent geocoding job
      const recentJob = await database.get(`
        SELECT cache_hits, api_calls FROM geocoding_jobs 
        WHERE status = 'COMPLETED'
        ORDER BY end_time DESC LIMIT 1
      `);
      
      const hitRate = recentJob && (recentJob.cache_hits + recentJob.api_calls) > 0
        ? ((recentJob.cache_hits / (recentJob.cache_hits + recentJob.api_calls)) * 100).toFixed(2)
        : 0;
      
      return {
        total_cached: totalCached?.count || 0,
        average_quality_score: avgQualityScore?.avg_score 
          ? parseFloat(avgQualityScore.avg_score).toFixed(2) 
          : 0,
        last_update: lastUpdate?.last_update || null,
        cache_hit_rate_percent: parseFloat(hitRate),
        quality_distribution: qualityDistribution,
        ttl_days: this.cacheTtlDays,
        cache_enabled: this.cacheEnabled
      };
      
    } catch (error) {
      console.error('Cache stats error:', error.message);
      return {
        total_cached: 0,
        average_quality_score: 0,
        error: error.message
      };
    }
  }

  /**
   * Clear all cache entries
   * 
   * WARNING: This will force re-geocoding of all addresses
   * 
   * @returns {Promise<number>} Number of deleted entries
   */
  async clearCache() {
    try {
      const result = await database.run(`DELETE FROM geocoding_cache`);
      return result.changes || 0;
    } catch (error) {
      console.error('Cache clear error:', error.message);
      return 0;
    }
  }

  /**
   * Get cache entry for specific address (for debugging)
   * 
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - State abbreviation
   * @param {string} zipCode - ZIP code
   * @returns {Promise<Object|null>} Full cache entry details
   */
  async getCacheEntryDetails(address, city, state, zipCode) {
    try {
      const normalized = this.normalizeAddress(address, city, state, zipCode);
      const cacheKey = this.generateCacheKey(normalized);
      
      const entry = await database.get(`
        SELECT * FROM geocoding_cache WHERE address_hash = ?
      `, [cacheKey]);
      
      if (entry && entry.components) {
        entry.components = JSON.parse(entry.components);
      }
      
      return entry ? {
        ...entry,
        normalized_address: normalized,
        cache_key: cacheKey
      } : null;
      
    } catch (error) {
      console.error('Cache entry lookup error:', error.message);
      return null;
    }
  }
}

module.exports = AddressCacheService;
