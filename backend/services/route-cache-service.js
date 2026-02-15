/**
 * Route Cache Service
 * Manages route_cache table for Distance Matrix API cost optimization
 * 
 * Features:
 * - Symmetric caching (A→B implies B→A)
 * - MD5 hash generation with canonical coordinate ordering
 * - TTL (Time-To-Live) management (30-day default)
 * - Cache statistics and performance metrics
 * - Automatic cleanup of expired entries
 */

const crypto = require('crypto');
const database = require('../config/database');

class RouteCacheService {
  constructor() {
    this.cacheTtlDays = parseInt(process.env.ROUTE_CACHE_TTL_DAYS) || 30;
    this.cacheEnabled = process.env.CACHE_ROUTES !== 'false';
  }

  /**
   * Generate canonical route hash for cache lookup
   * 
   * Uses canonical coordinate ordering to ensure A→B = B→A
   * Coordinates are sorted numerically to guarantee consistency
   * 
   * @param {number} lat1 - Origin latitude
   * @param {number} lng1 - Origin longitude
   * @param {number} lat2 - Destination latitude
   * @param {number} lng2 - Destination longitude
   * @param {string} mode - Travel mode (driving, walking, bicycling)
   * @returns {string} MD5 hash (32 characters)
   */
  generateRouteHash(lat1, lng1, lat2, lng2, mode) {
    // Round to 6 decimal places (~10cm precision)
    const roundLat1 = parseFloat(lat1.toFixed(6));
    const roundLng1 = parseFloat(lng1.toFixed(6));
    const roundLat2 = parseFloat(lat2.toFixed(6));
    const roundLng2 = parseFloat(lng2.toFixed(6));
    
    // Canonical ordering: sort coordinates to ensure A→B = B→A
    const [minLat, minLng, maxLat, maxLng] = 
      (roundLat1 < roundLat2 || (roundLat1 === roundLat2 && roundLng1 < roundLng2))
        ? [roundLat1, roundLng1, roundLat2, roundLng2]
        : [roundLat2, roundLng2, roundLat1, roundLng1];
    
    // Generate hash: "lat1,lng1|lat2,lng2|mode"
    const data = `${minLat},${minLng}|${maxLat},${maxLng}|${mode}`;
    
    return crypto
      .createHash('md5')
      .update(data)
      .digest('hex');
  }

  /**
   * Get cached route data
   * 
   * @param {number} originLat - Origin latitude
   * @param {number} originLng - Origin longitude
   * @param {number} destLat - Destination latitude
   * @param {number} destLng - Destination longitude
   * @param {string} mode - Travel mode
   * @returns {Promise<Object|null>} Cached route data or null if not found/expired
   */
  async getCachedRoute(originLat, originLng, destLat, destLng, mode) {
    if (!this.cacheEnabled) {
      return null;
    }

    try {
      const hash = this.generateRouteHash(originLat, originLng, destLat, destLng, mode);
      
      const cached = await database.get(`
        SELECT 
          distance_meters,
          duration_seconds,
          duration_in_traffic_seconds,
          api_status,
          cached_at,
          expires_at
        FROM route_cache
        WHERE route_hash = ?
      `, [hash]);
      
      if (!cached) {
        return null; // Cache miss
      }
      
      // Check if cache entry is expired
      const now = new Date();
      const expiresAt = new Date(cached.expires_at);
      
      if (now > expiresAt) {
        // Cache expired - invalidate and treat as miss
        await this.invalidateCacheEntry(hash);
        return null;
      }
      
      // Return cached data
      return {
        distance: cached.distance_meters,
        duration: cached.duration_seconds,
        durationInTraffic: cached.duration_in_traffic_seconds,
        status: cached.api_status,
        source: 'cache',
        cached_at: cached.cached_at
      };
      
    } catch (error) {
      console.error('Route cache lookup error:', error.message);
      return null; // Fail gracefully
    }
  }

  /**
   * Store route data in cache
   * 
   * Due to canonical hash ordering, this automatically caches both
   * A→B and B→A with a single INSERT
   * 
   * @param {number} originLat - Origin latitude
   * @param {number} originLng - Origin longitude
   * @param {number} destLat - Destination latitude
   * @param {number} destLng - Destination longitude
   * @param {string} mode - Travel mode
   * @param {Object} data - Route data (distance, duration, etc.)
   * @returns {Promise<boolean>} Success status
   */
  async setCachedRoute(originLat, originLng, destLat, destLng, mode, data) {
    if (!this.cacheEnabled) {
      return false;
    }

    try {
      const hash = this.generateRouteHash(originLat, originLng, destLat, destLng, mode);
      const expiresAt = new Date(Date.now() + this.cacheTtlDays * 24 * 60 * 60 * 1000);
      
      // UPSERT pattern: INSERT OR REPLACE to handle duplicates
      await database.run(`
        INSERT INTO route_cache (
          origin_lat, origin_lng, destination_lat, destination_lng,
          route_hash, travel_mode, distance_meters, duration_seconds,
          duration_in_traffic_seconds, api_status, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(route_hash) DO UPDATE SET
          distance_meters = excluded.distance_meters,
          duration_seconds = excluded.duration_seconds,
          duration_in_traffic_seconds = excluded.duration_in_traffic_seconds,
          api_status = excluded.api_status,
          cached_at = CURRENT_TIMESTAMP,
          expires_at = excluded.expires_at
      `, [
        originLat, originLng, destLat, destLng,
        hash, mode, data.distance, data.duration,
        data.durationInTraffic || null, data.status, expiresAt.toISOString()
      ]);
      
      return true;
      
    } catch (error) {
      console.error('Route cache storage error:', error.message);
      return false;
    }
  }

  /**
   * Invalidate a specific cache entry
   * 
   * @param {string} hash - Route hash to invalidate
   * @returns {Promise<boolean>} Success status
   */
  async invalidateCacheEntry(hash) {
    try {
      await database.run(`
        DELETE FROM route_cache WHERE route_hash = ?
      `, [hash]);
      return true;
    } catch (error) {
      console.error('Cache invalidation error:', error.message);
      return false;
    }
  }

  /**
   * Clean up expired cache entries
   * 
   * @returns {Promise<number>} Number of entries deleted
   */
  async cleanupExpiredCache() {
    try {
      const result = await database.run(`
        DELETE FROM route_cache WHERE expires_at < datetime('now')
      `);
      
      const deletedCount = result.changes || 0;
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} expired route cache entries`);
      }
      
      return deletedCount;
      
    } catch (error) {
      console.error('Cache cleanup error:', error.message);
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
      const stats = await database.get(`
        SELECT 
          COUNT(*) as total_routes,
          SUM(CASE WHEN expires_at > datetime('now') THEN 1 ELSE 0 END) as active_routes,
          SUM(CASE WHEN expires_at <= datetime('now') THEN 1 ELSE 0 END) as expired_routes,
          COUNT(DISTINCT travel_mode) as mode_count
        FROM route_cache
      `);
      
      const modeDistribution = await database.all(`
        SELECT 
          travel_mode,
          COUNT(*) as count
        FROM route_cache
        WHERE expires_at > datetime('now')
        GROUP BY travel_mode
      `);
      
      const avgAge = await database.get(`
        SELECT 
          AVG(julianday('now') - julianday(cached_at)) as avg_age_days
        FROM route_cache
        WHERE expires_at > datetime('now')
      `);
      
      return {
        totalRoutes: stats.total_routes || 0,
        activeRoutes: stats.active_routes || 0,
        expiredRoutes: stats.expired_routes || 0,
        modeDistribution: modeDistribution.reduce((acc, row) => {
          acc[row.travel_mode] = row.count;
          return acc;
        }, {}),
        averageCacheTtl: avgAge.avg_age_days ? 
          parseFloat((this.cacheTtlDays - avgAge.avg_age_days).toFixed(1)) : 0
      };
      
    } catch (error) {
      console.error('Cache stats error:', error.message);
      return null;
    }
  }
}

module.exports = RouteCacheService;
