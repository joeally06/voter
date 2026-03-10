/**
 * Quota Manager Service
 * Tracks and manages API quota usage across all Google Maps APIs
 * 
 * Features:
 * - Daily quota tracking per API
 * - Warning thresholds (70%, 80%, 90%, 95%)
 * - Cache hit/miss tracking
 * - Monthly quota summaries
 * - Automatic quota enforcement
 */

const database = require('../config/database');

class QuotaManager {
  constructor() {
    // Daily quota limits per API (safety net per-day)
    this.quotaLimits = {
      geocoding: parseInt(process.env.DAILY_GEOCODING_QUOTA || process.env.DAILY_QUOTA_LIMIT) || 333,
      distance_matrix: parseInt(process.env.DAILY_DISTANCE_MATRIX_QUOTA || process.env.DISTANCE_MATRIX_DAILY_QUOTA) || 333,
      directions: parseInt(process.env.DAILY_DIRECTIONS_QUOTA || process.env.DIRECTIONS_DAILY_QUOTA) || 100
    };

    // Monthly limits per API (hard cap for free tier — 10,000/month)
    this.monthlyLimits = {
      geocoding: parseInt(process.env.MONTHLY_GEOCODING_LIMIT) || 10000,
      distance_matrix: parseInt(process.env.MONTHLY_DISTANCE_MATRIX_LIMIT) || 10000,
      dynamic_maps: parseInt(process.env.MONTHLY_DYNAMIC_MAPS_LIMIT) || 10000,
      directions: parseInt(process.env.MONTHLY_DIRECTIONS_LIMIT) || 10000
    };
    
    // Warning thresholds
    this.warningThresholds = [70, 80, 90, 95];
  }

  /**
   * Get today's date in YYYY-MM-DD format
   * 
   * @returns {string} Current date
   */
  getTodayDate() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get or create today's usage record for an API
   * 
   * @param {string} apiName - API name (geocoding, distance_matrix, etc.)
   * @returns {Promise<Object>} Usage record
   */
  async getOrCreateUsageRecord(apiName) {
    const today = this.getTodayDate();
    
    let usage = await database.get(`
      SELECT * FROM api_usage
      WHERE api_name = ? AND call_date = ?
    `, [apiName, today]);
    
    if (!usage) {
      await database.run(`
        INSERT INTO api_usage (
          api_name, call_date, call_count, cache_hits, cache_misses
        ) VALUES (?, ?, 0, 0, 0)
      `, [apiName, today]);
      
      usage = {
        api_name: apiName,
        call_date: today,
        call_count: 0,
        cache_hits: 0,
        cache_misses: 0
      };
    }
    
    return usage;
  }

  /**
   * Check if quota allows new API calls
   * 
   * @param {string} apiName - API name
   * @param {number} callCount - Number of calls to make (default: 1)
   * @returns {Promise<Object>} Quota status
   * @throws {Error} If quota is exhausted
   */
  async checkQuota(apiName, callCount = 1) {
    // Check monthly limit FIRST (higher priority)
    await this.checkMonthlyQuota(apiName, callCount);

    const usage = await this.getOrCreateUsageRecord(apiName);
    const quota = this.quotaLimits[apiName] || 1000;
    
    const currentUsage = usage.call_count || 0;
    const projectedUsage = currentUsage + callCount;
    const percentUsed = (projectedUsage / quota) * 100;
    const currentPercent = (currentUsage / quota * 100);
    
    // Block requests at 95% quota
    if (percentUsed >= 95) {
      // Calculate maximum allowed request size
      const maxAllowed = Math.floor(quota * 0.95 - currentUsage);
      const remainingToday = quota - currentUsage;
      
      // Determine if this is oversized request or actual quota exhaustion
      const isOversized = callCount > quota * 0.5; // Request is >50% of daily quota
      const isExhausted = currentUsage >= quota * 0.95; // Already at/near quota limit
      
      let errorMessage;
      
      if (isExhausted) {
        // Actual quota exhaustion (403 error)
        errorMessage = 
          `Daily ${apiName} quota exhausted. ` +
          `Current usage: ${currentUsage}/${quota} (${currentPercent.toFixed(1)}%). ` +
          `Requested: +${callCount.toLocaleString()} calls. ` +
          `Quota resets at midnight UTC. Try again tomorrow.`;
      } else if (isOversized) {
        // Oversized request (400 error)
        const suggestedMax = Math.floor(Math.sqrt(maxAllowed)); // For NxN matrix: sqrt of max calls
        errorMessage = 
          `Request too large for remaining ${apiName} quota. ` +
          `Current usage: ${currentUsage}/${quota} (${currentPercent.toFixed(1)}%). ` +
          `Requested: +${callCount.toLocaleString()} calls. ` +
          `Would reach: ${projectedUsage.toLocaleString()}/${quota} (${percentUsed.toFixed(1)}%). ` +
          `Maximum allowed now: ${maxAllowed.toLocaleString()} calls. ` +
          (apiName === 'distance_matrix' 
            ? `Suggestion: Reduce voter count to ~${suggestedMax} or fewer, or try again tomorrow.`
            : `Suggestion: Reduce request size to ${maxAllowed.toLocaleString()} or fewer items, or try again tomorrow.`);
      } else {
        // Preventive block for request that would exceed quota (400 error)
        errorMessage = 
          `${apiName} request would exceed daily quota. ` +
          `Current usage: ${currentUsage}/${quota} (${currentPercent.toFixed(1)}%). ` +
          `Requested: +${callCount.toLocaleString()} calls. ` +
          `Would reach: ${projectedUsage.toLocaleString()}/${quota} (${percentUsed.toFixed(1)}%). ` +
          `Remaining today: ${remainingToday} calls. ` +
          `Quota resets at midnight UTC.`;
      }
      
      // Add metadata to error for HTTP status code determination
      const error = new Error(errorMessage);
      error.quotaError = true;
      error.isOversized = isOversized;
      error.isExhausted = isExhausted;
      error.currentUsage = currentUsage;
      error.requestedCalls = callCount;
      error.quota = quota;
      error.maxAllowed = maxAllowed;
      
      throw error;
    }
    
    // Warn at thresholds
    for (const threshold of this.warningThresholds) {
      if (percentUsed >= threshold && percentUsed < threshold + 5) {
        console.warn(
          `⚠️  ${apiName} quota at ${percentUsed.toFixed(1)}% ` +
          `(${currentUsage + callCount}/${quota})`
        );
        break;
      }
    }
    
    const cacheHitRate = (usage.cache_hits + usage.cache_misses) > 0
      ? (usage.cache_hits / (usage.cache_hits + usage.cache_misses)) * 100
      : 0;
    
    return {
      allowed: true,
      quota,
      used: currentUsage,
      remaining: quota - currentUsage,
      percentUsed: (currentUsage / quota) * 100,
      cacheHitRate: parseFloat(cacheHitRate.toFixed(1))
    };
  }

  /**
   * Increment API call counter
   * 
   * @param {string} apiName - API name
   * @param {number} count - Number of calls to add (default: 1)
   * @returns {Promise<boolean>} Success status
   */
  async incrementApiCall(apiName, count = 1) {
    try {
      const today = this.getTodayDate();
      
      await database.run(`
        INSERT INTO api_usage (
          api_name, call_date, call_count, cache_hits, cache_misses, updated_at
        ) VALUES (?, ?, ?, 0, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(api_name, call_date) DO UPDATE SET
          call_count = call_count + ?,
          updated_at = CURRENT_TIMESTAMP
      `, [apiName, today, count, count]);
      
      return true;
      
    } catch (error) {
      console.error('API call increment error:', error.message);
      return false;
    }
  }

  /**
   * Increment cache hit counter
   * 
   * @param {string} apiName - API name
   * @param {number} count - Number of hits to add (default: 1)
   * @returns {Promise<boolean>} Success status
   */
  async incrementCacheHit(apiName, count = 1) {
    try {
      const today = this.getTodayDate();
      
      await database.run(`
        INSERT INTO api_usage (
          api_name, call_date, call_count, cache_hits, cache_misses, updated_at
        ) VALUES (?, ?, 0, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(api_name, call_date) DO UPDATE SET
          cache_hits = cache_hits + ?,
          updated_at = CURRENT_TIMESTAMP
      `, [apiName, today, count, count]);
      
      return true;
      
    } catch (error) {
      console.error('Cache hit increment error:', error.message);
      return false;
    }
  }

  /**
   * Increment cache miss counter
   * 
   * @param {string} apiName - API name
   * @param {number} count - Number of misses to add (default: 1)
   * @returns {Promise<boolean>} Success status
   */
  async incrementCacheMiss(apiName, count = 1) {
    try {
      const today = this.getTodayDate();
      
      await database.run(`
        INSERT INTO api_usage (
          api_name, call_date, call_count, cache_hits, cache_misses, updated_at
        ) VALUES (?, ?, 0, 0, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(api_name, call_date) DO UPDATE SET
          cache_misses = cache_misses + ?,
          updated_at = CURRENT_TIMESTAMP
      `, [apiName, today, count, count]);
      
      return true;
      
    } catch (error) {
      console.error('Cache miss increment error:', error.message);
      return false;
    }
  }

  /**
   * Check if monthly quota allows new API calls
   * 
   * @param {string} apiName - API name
   * @param {number} callCount - Number of calls to make (default: 1)
   * @returns {Promise<Object>} Monthly quota status
   * @throws {Error} If monthly quota is exhausted
   */
  async checkMonthlyQuota(apiName, callCount = 1) {
    const monthlyLimit = this.monthlyLimits[apiName];
    if (!monthlyLimit) return { allowed: true }; // No monthly limit configured

    const monthlyUsage = await this.getMonthlyUsage(apiName);
    const projectedUsage = monthlyUsage + callCount;

    if (projectedUsage > monthlyLimit) {
      // Calculate reset date (1st of next month)
      const now = new Date();
      const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const resetDateStr = resetDate.toISOString().split('T')[0];

      const error = new Error(
        `Monthly ${apiName} quota exceeded. ` +
        `Usage: ${monthlyUsage.toLocaleString()}/${monthlyLimit.toLocaleString()} this month. ` +
        `Requested: +${callCount.toLocaleString()} calls. ` +
        `Quota resets on ${resetDateStr}.`
      );
      error.quotaError = true;
      error.isMonthlyExhausted = true;
      error.monthlyUsage = monthlyUsage;
      error.monthlyLimit = monthlyLimit;
      error.remaining = Math.max(0, monthlyLimit - monthlyUsage);
      error.resetDate = resetDateStr;
      throw error;
    }

    // Warn at thresholds
    const currentPercent = (monthlyUsage / monthlyLimit) * 100;
    for (const threshold of this.warningThresholds) {
      if (currentPercent >= threshold && currentPercent < threshold + 5) {
        console.warn(
          `⚠️  MONTHLY ${apiName} quota at ${currentPercent.toFixed(1)}% ` +
          `(${monthlyUsage.toLocaleString()}/${monthlyLimit.toLocaleString()})`
        );
        break;
      }
    }

    return {
      allowed: true,
      monthlyLimit,
      monthlyUsed: monthlyUsage,
      monthlyRemaining: monthlyLimit - monthlyUsage,
      monthlyPercentUsed: parseFloat(currentPercent.toFixed(1))
    };
  }

  /**
   * Get total API calls for the current month
   * 
   * @param {string} apiName - API name
   * @returns {Promise<number>} Total calls this month
   */
  async getMonthlyUsage(apiName) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startDate = startOfMonth.toISOString().split('T')[0];

    const result = await database.get(`
      SELECT COALESCE(SUM(call_count), 0) as total
      FROM api_usage
      WHERE api_name = ? AND call_date >= ?
    `, [apiName, startDate]);

    return result?.total || 0;
  }

  /**
   * Get monthly quota status for one or all APIs
   * 
   * @param {string|null} apiName - API name (null for all)
   * @returns {Promise<Object>} Monthly quota status
   */
  async getMonthlyQuotaStatus(apiName = null) {
    const results = {};
    const apis = apiName ? [apiName] : Object.keys(this.monthlyLimits);

    // Calculate reset date (1st of next month)
    const now = new Date();
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const resetDateStr = resetDate.toISOString().split('T')[0];

    for (const api of apis) {
      const usage = await this.getMonthlyUsage(api);
      const limit = this.monthlyLimits[api] || 10000;
      results[api] = {
        limit,
        used: usage,
        remaining: Math.max(0, limit - usage),
        percentUsed: parseFloat(((usage / limit) * 100).toFixed(1)),
        isExhausted: usage >= limit,
        resetDate: resetDateStr
      };
    }

    return apiName ? results[apiName] : results;
  }

  /**
   * Get current quota status for an API
   * 
   * @param {string} apiName - API name
   * @returns {Promise<Object>} Quota status
   */
  async getQuotaStatus(apiName) {
    try {
      const usage = await this.getOrCreateUsageRecord(apiName);
      const quota = this.quotaLimits[apiName] || 1000;
      
      const percentUsed = (usage.call_count / quota) * 100;
      const cacheHitRate = (usage.cache_hits + usage.cache_misses) > 0
        ? (usage.cache_hits / (usage.cache_hits + usage.cache_misses)) * 100
        : 0;

      // Include monthly data
      const monthlyStatus = await this.getMonthlyQuotaStatus(apiName);
      
      return {
        quota,
        used: usage.call_count || 0,
        remaining: quota - (usage.call_count || 0),
        percentUsed: parseFloat(percentUsed.toFixed(1)),
        cacheHitRate: parseFloat(cacheHitRate.toFixed(1)),
        cacheHits: usage.cache_hits || 0,
        cacheMisses: usage.cache_misses || 0,
        monthly: monthlyStatus
      };
      
    } catch (error) {
      console.error('Quota status error:', error.message);
      return null;
    }
  }

  /**
   * Get quota status for all APIs
   * 
   * @returns {Promise<Object>} Combined quota status
   */
  async getAllQuotaStatus() {
    try {
      const quotas = {};
      let totalQuota = 0;
      let totalUsed = 0;
      let totalCacheHits = 0;
      let totalCacheMisses = 0;
      
      for (const apiName of Object.keys(this.quotaLimits)) {
        const status = await this.getQuotaStatus(apiName);
        quotas[apiName] = status;
        
        totalQuota += status.quota;
        totalUsed += status.used;
        totalCacheHits += status.cacheHits;
        totalCacheMisses += status.cacheMisses;
      }
      
      const totalRequests = totalCacheHits + totalCacheMisses;
      const averageCacheHitRate = totalRequests > 0
        ? (totalCacheHits / totalRequests) * 100
        : 0;
      
      return {
        quotas,
        totalQuota,
        totalUsed,
        totalRemaining: totalQuota - totalUsed,
        averageCacheHitRate: parseFloat(averageCacheHitRate.toFixed(1))
      };
      
    } catch (error) {
      console.error('All quota status error:', error.message);
      return null;
    }
  }

  /**
   * Get monthly quota summary
   * 
   * @param {string} apiName - API name (optional, gets all if not specified)
   * @returns {Promise<Object>} Monthly summary
   */
  async getMonthlyQuotaSummary(apiName = null) {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      const startDate = startOfMonth.toISOString().split('T')[0];
      
      let query = `
        SELECT 
          api_name,
          SUM(call_count) as total_calls,
          SUM(cache_hits) as total_cache_hits,
          SUM(cache_misses) as total_cache_misses,
          COUNT(DISTINCT call_date) as days_active
        FROM api_usage
        WHERE call_date >= ?
      `;
      
      const params = [startDate];
      
      if (apiName) {
        query += ' AND api_name = ?';
        params.push(apiName);
      }
      
      query += ' GROUP BY api_name';
      
      const results = await database.all(query, params);
      
      const summary = results.map(row => {
        const totalRequests = row.total_cache_hits + row.total_cache_misses;
        const cacheHitRate = totalRequests > 0
          ? (row.total_cache_hits / totalRequests) * 100
          : 0;
        
        return {
          apiName: row.api_name,
          totalCalls: row.total_calls,
          totalCacheHits: row.total_cache_hits,
          totalCacheMisses: row.total_cache_misses,
          cacheHitRate: parseFloat(cacheHitRate.toFixed(1)),
          daysActive: row.days_active
        };
      });
      
      return apiName ? summary[0] || null : summary;
      
    } catch (error) {
      console.error('Monthly summary error:', error.message);
      return null;
    }
  }
}

module.exports = QuotaManager;
