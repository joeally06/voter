/**
 * Saved Route Model
 * Handles persistence and retrieval of shareable routes
 */

const Database = require('../config/database');
const crypto = require('crypto');

class SavedRouteModel {
  /**
   * Generate a unique route ID
   * @returns {string} URL-safe random ID
   */
  static generateRouteId() {
    return crypto.randomBytes(16).toString('base64url');
  }

  /**
   * Save a route to the database
   * @param {Object} routeData - Route configuration and locations
   * @param {Object} options - Optional metadata (userId, routeName, expiresIn)
   * @returns {Promise<string>} Route ID
   */
  async saveRoute(routeData, options = {}) {
    const db = await Database.getDb();
    const routeId = SavedRouteModel.generateRouteId();
    
    const {
      userId = null,
      routeName = null,
      travelMode = 'walking',
      expiresIn = null, // Milliseconds until expiration
      isPublic = true
    } = options;
    
    const expiresAt = expiresIn 
      ? new Date(Date.now() + expiresIn).toISOString() 
      : null;
    
    // Store route data as JSON string
    const routeDataJson = JSON.stringify({
      version: '1.0',
      ...routeData,
      savedAt: new Date().toISOString()
    });
    
    await db.run(
      `INSERT INTO saved_routes 
       (id, user_id, route_name, route_data, travel_mode, expires_at, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [routeId, userId, routeName, routeDataJson, travelMode, expiresAt, isPublic ? 1 : 0]
    );
    
    console.log(`✅ Route saved with ID: ${routeId}`);
    return routeId;
  }

  /**
   * Retrieve a saved route by ID
   * @param {string} routeId - Route identifier
   * @returns {Promise<Object|null>} Route data or null if not found/expired
   */
  async getRoute(routeId) {
    const db = await Database.getDb();
    
    const route = await db.get(
      `SELECT * FROM saved_routes WHERE id = ?`,
      [routeId]
    );
    
    if (!route) {
      return null;
    }
    
    // Check expiration
    if (route.expires_at) {
      const expiresAt = new Date(route.expires_at);
      if (expiresAt < new Date()) {
        console.log(`⚠️ Route ${routeId} has expired`);
        return null;
      }
    }
    
    // Update access tracking
    await this.trackAccess(routeId);
    
    // Parse JSON route data
    const routeData = JSON.parse(route.route_data);
    
    return {
      id: route.id,
      userId: route.user_id,
      routeName: route.route_name,
      travelMode: route.travel_mode,
      createdAt: route.created_at,
      accessedAt: route.accessed_at,
      accessCount: route.access_count,
      expiresAt: route.expires_at,
      isPublic: route.is_public === 1,
      routeData
    };
  }

  /**
   * Track route access (update accessed_at and increment access_count)
   * @param {string} routeId - Route identifier
   */
  async trackAccess(routeId) {
    const db = await Database.getDb();
    
    await db.run(
      `UPDATE saved_routes 
       SET accessed_at = CURRENT_TIMESTAMP, 
           access_count = access_count + 1
       WHERE id = ?`,
      [routeId]
    );
  }

  /**
   * Delete a saved route
   * @param {string} routeId - Route identifier
   * @param {number} userId - Optional: verify ownership before deletion
   * @returns {Promise<boolean>} Success status
   */
  async deleteRoute(routeId, userId = null) {
    const db = await Database.getDb();
    
    let query = 'DELETE FROM saved_routes WHERE id = ?';
    let params = [routeId];
    
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    
    const result = await db.run(query, params);
    
    return result.changes > 0;
  }

  /**
   * Clean up expired routes (run periodically)
   * @returns {Promise<number>} Number of deleted routes
   */
  async cleanupExpiredRoutes() {
    const db = await Database.getDb();
    
    const result = await db.run(
      `DELETE FROM saved_routes 
       WHERE expires_at IS NOT NULL 
       AND expires_at < CURRENT_TIMESTAMP`
    );
    
    console.log(`🗑️ Cleaned up ${result.changes} expired routes`);
    return result.changes;
  }

  /**
   * Get routes by user ID
   * @param {number} userId - User identifier
   * @param {number} limit - Maximum routes to return
   * @returns {Promise<Array>} List of routes
   */
  async getRoutesByUser(userId, limit = 50) {
    const db = await Database.getDb();
    
    const routes = await db.all(
      `SELECT id, route_name, travel_mode, created_at, accessed_at, access_count
       FROM saved_routes
       WHERE user_id = ?
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    
    return routes;
  }
}

module.exports = SavedRouteModel;
