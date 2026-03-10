/**
 * Route Planning API Routes
 * Phase 5: Distance Matrix API integration and route optimization
 * Phase 6: Route Export & Mobile Integration
 * 
 * Endpoints:
 * - POST /api/routes/calculate - Calculate optimal route for voter list
 * - POST /api/routes/distance-matrix - Get distance/duration matrix
 * - GET /api/routes/quota-status - API quota usage status
 * - GET /api/routes/cache-stats - Route cache statistics
 * - POST /api/routes/save - Save route and generate shareable ID
 * - GET /api/routes/:routeId - Retrieve saved route by ID
 * - DELETE /api/routes/:routeId - Delete saved route
 * - GET /api/routes/:routeId/print - Generate print-friendly HTML view
 * - POST /api/routes/cleanup-expired - Clean up expired routes (maintenance)
 */

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const router = express.Router();

const RouteOptimizerService = require('../services/route-optimizer-service');
const DistanceMatrixService = require('../services/distance-matrix-service');
const RouteCacheService = require('../services/route-cache-service');
const QuotaManager = require('../services/quota-manager');
const VoterModel = require('../models/voter');
const SavedRouteModel = require('../models/saved-route');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

/**
 * POST /api/routes/calculate
 * Calculate optimized route for list of voters
 * 
 * Request body:
 * {
 *   voterIds: [123, 456, 789],
 *   startLocation: { lat: 36.5040, lng: -89.1872 },
 *   mode: "walking",
 *   algorithm: "hybrid"
 * }
 */
router.post('/calculate', [
  body('voterIds')
    .isArray({ min: 1 })
    .withMessage('voterIds must be non-empty array'),
  body('voterIds.*')
    .isInt()
    .withMessage('Each voterId must be an integer'),
  body('startLocation')
    .isObject()
    .withMessage('startLocation is required'),
  body('startLocation.lat')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Valid latitude required'),
  body('startLocation.lng')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Valid longitude required'),
  body('mode')
    .optional()
    .isIn(['driving', 'walking', 'bicycling'])
    .withMessage('Mode must be driving, walking, or bicycling'),
  body('algorithm')
    .optional()
    .isIn(['nearest_neighbor', '2opt', 'hybrid'])
    .withMessage('Algorithm must be nearest_neighbor, 2opt, or hybrid'),
  validate
], async (req, res) => {
  try {
    const {
      voterIds,
      startLocation,
      mode = 'walking',
      algorithm = 'hybrid'
    } = req.body;

    console.log(`📍 Calculating route for ${voterIds.length} voters (${mode}, ${algorithm})`);

    // Fetch voter locations
    const voterModel = new VoterModel();
    const voters = await voterModel.getVotersByIds(voterIds);

    if (!voters || voters.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No voters found for provided IDs'
      });
    }

    // Filter voters with valid coordinates
    const validVoters = voters.filter(v => v.latitude && v.longitude);

    if (validVoters.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No voters have geocoded addresses'
      });
    }

    // Build locations array
    const locations = validVoters.map(v => ({
      voterId: v.voter_id,
      lat: v.latitude,
      lng: v.longitude,
      address: v.residential_address,
      city: v.residential_city,
      firstName: v.first_name,
      lastName: v.last_name
    }));

    // Optimize route
    const optimizer = new RouteOptimizerService();
    const route = await optimizer.optimizeRoute(
      locations,
      startLocation,
      mode,
      algorithm
    );

    // Get quota status
    const quotaManager = new QuotaManager();
    const quotaStatus = await quotaManager.getQuotaStatus('distance_matrix');

    res.json({
      success: true,
      route,
      quotaStatus,
      metadata: {
        requestedVoters: voterIds.length,
        includedVoters: validVoters.length,
        skippedVoters: voterIds.length - validVoters.length
      }
    });

  } catch (error) {
    console.error('Route calculation error:', error);

    // Handle quota exceeded errors
    if (error.quotaError || error.message.includes('quota')) {
      // Determine appropriate HTTP status code
      let statusCode = 429; // Default: Too Many Requests
      let errorType = 'API quota exceeded';
      
      if (error.isMonthlyExhausted) {
        // Monthly quota exhausted
        statusCode = 429;
        errorType = 'Monthly quota exceeded';
        return res.status(statusCode).json({
          success: false,
          error: errorType,
          message: error.message,
          monthlyUsage: error.monthlyUsage,
          monthlyLimit: error.monthlyLimit,
          resetsOn: error.resetDate
        });
      } else if (error.isExhausted) {
        // Quota is actually exhausted - use 403 Forbidden
        statusCode = 403;
        errorType = 'Daily quota exhausted';
      } else if (error.isOversized || error.message.includes('too large')) {
        // Request is too large - use 400 Bad Request
        statusCode = 400;
        errorType = 'Request too large';
      } else if (error.message.includes('would exceed')) {
        // Preventive block - use 400 Bad Request
        statusCode = 400;
        errorType = 'Request would exceed quota';
      }
      
      return res.status(statusCode).json({
        success: false,
        error: errorType,
        message: error.message,
        quotaInfo: {
          currentUsage: error.currentUsage,
          requestedCalls: error.requestedCalls,
          quota: error.quota,
          maxAllowed: error.maxAllowed,
          resetTime: new Date().setHours(24, 0, 0, 0) // Midnight tonight
        }
      });
    }

    res.status(500).json({
      success: false,
      error: 'Route calculation failed',
      message: error.message
    });
  }
});

/**
 * POST /api/routes/distance-matrix
 * Get distance/duration matrix for multiple locations
 * 
 * Request body:
 * {
 *   origins: [{ lat: 36.5040, lng: -89.1872 }],
 *   destinations: [{ lat: 36.5045, lng: -89.1875 }],
 *   mode: "driving"
 * }
 */
router.post('/distance-matrix', [
  body('origins')
    .isArray({ min: 1 })
    .withMessage('origins must be non-empty array'),
  body('destinations')
    .isArray({ min: 1 })
    .withMessage('destinations must be non-empty array'),
  body('mode')
    .optional()
    .isIn(['driving', 'walking', 'bicycling'])
    .withMessage('Mode must be driving, walking, or bicycling'),
  validate
], async (req, res) => {
  try {
    const {
      origins,
      destinations,
      mode = 'driving'
    } = req.body;

    // Validate location objects
    for (const loc of [...origins, ...destinations]) {
      if (!loc.lat || !loc.lng) {
        return res.status(400).json({
          success: false,
          error: 'All locations must have lat and lng properties'
        });
      }
    }

    // Get distance matrix
    const service = new DistanceMatrixService();
    const result = await service.getDistanceMatrix(origins, destinations, mode);

    res.json({
      success: true,
      matrix: result.matrix,
      cacheStats: result.cacheStats
    });

  } catch (error) {
    console.error('Distance matrix error:', error);

    if (error.quotaError || error.message.includes('quota')) {
      // Determine appropriate HTTP status code
      let statusCode = 429; // Default: Too Many Requests
      let errorType = 'API quota exceeded';
      
      if (error.isMonthlyExhausted) {
        // Monthly quota exhausted
        statusCode = 429;
        errorType = 'Monthly quota exceeded';
        return res.status(statusCode).json({
          success: false,
          error: errorType,
          message: error.message,
          monthlyUsage: error.monthlyUsage,
          monthlyLimit: error.monthlyLimit,
          resetsOn: error.resetDate
        });
      } else if (error.isExhausted) {
        // Quota is actually exhausted - use 403 Forbidden
        statusCode = 403;
        errorType = 'Daily quota exhausted';
      } else if (error.isOversized || error.message.includes('too large')) {
        // Request is too large - use 400 Bad Request
        statusCode = 400;
        errorType = 'Request too large';
      } else if (error.message.includes('would exceed')) {
        // Preventive block - use 400 Bad Request
        statusCode = 400;
        errorType = 'Request would exceed quota';
      }
      
      return res.status(statusCode).json({
        success: false,
        error: errorType,
        message: error.message,
        quotaInfo: {
          currentUsage: error.currentUsage,
          requestedCalls: error.requestedCalls,
          quota: error.quota,
          maxAllowed: error.maxAllowed,
          resetTime: new Date().setHours(24, 0, 0, 0) // Midnight tonight
        }
      });
    }

    res.status(500).json({
      success: false,
      error: 'Distance matrix calculation failed',
      message: error.message
    });
  }
});

/**
 * GET /api/routes/quota-status
 * Get API quota usage status across all Google Maps APIs
 * UPDATED: Provide data in multiple access patterns for frontend compatibility
 */
router.get('/quota-status', async (req, res) => {
  try {
    const quotaManager = new QuotaManager();
    const status = await quotaManager.getAllQuotaStatus();
    const monthlyStatus = await quotaManager.getMonthlyQuotaStatus();

    // Provide data in both nested and direct formats for backward compatibility
    res.json({
      success: true,
      quotas: status.quotas,
      totalQuota: status.totalQuota,
      totalUsed: status.totalUsed,
      totalRemaining: status.totalRemaining,
      averageCacheHitRate: status.averageCacheHitRate,
      // Direct access for convenience (backward compatibility)
      distance_matrix: status.quotas.distance_matrix,
      geocoding: status.quotas.geocoding,
      directions: status.quotas.directions,
      // Monthly data
      monthly: monthlyStatus
    });

  } catch (error) {
    console.error('Quota status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve quota status',
      message: error.message
    });
  }
});

/**
 * GET /api/routes/cache-stats
 * Get route cache performance statistics
 */
router.get('/cache-stats', async (req, res) => {
  try {
    const cacheService = new RouteCacheService();
    const stats = await cacheService.getCacheStats();

    // Calculate cache size estimate
    const cacheSizeBytes = stats.totalRoutes * 200; // Rough estimate
    const cacheSizeMB = (cacheSizeBytes / (1024 * 1024)).toFixed(2);

    // Get quota manager for hit rate data
    const quotaManager = new QuotaManager();
    const monthlyData = await quotaManager.getMonthlyQuotaSummary('distance_matrix');

    res.json({
      success: true,
      cacheStats: {
        totalRoutes: stats.totalRoutes,
        activeRoutes: stats.activeRoutes,
        expiredRoutes: stats.expiredRoutes,
        cacheSize: `${cacheSizeMB} MB`,
        averageCacheTtl: stats.averageCacheTtl,
        modeDistribution: stats.modeDistribution,
        hitRate: {
          month: monthlyData?.cacheHitRate || 0
        }
      }
    });

  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cache statistics',
      message: error.message
    });
  }
});

/**
 * POST /api/routes/cache-cleanup
 * Manually trigger cache cleanup (remove expired entries)
 */
router.post('/cache-cleanup', async (req, res) => {
  try {
    const cacheService = new RouteCacheService();
    const deletedCount = await cacheService.cleanupExpiredCache();

    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} expired cache entries`,
      deletedCount
    });

  } catch (error) {
    console.error('Cache cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache cleanup failed',
      message: error.message
    });
  }
});

// ============================================================================
// ROUTE EXPORT & SHARING ENDPOINTS
// ============================================================================

/**
 * POST /api/routes/save
 * Save a calculated route for sharing
 * 
 * Request body:
 * {
 *   routeData: { locations, metrics, startLocation, ... },
 *   options: { routeName, travelMode, expiresIn }
 * }
 */
router.post('/save', [
  body('routeData')
    .isObject()
    .withMessage('routeData is required'),
  body('routeData.locations')
    .isArray({ min: 1 })
    .withMessage('Route must have at least one location'),
  body('options')
    .optional()
    .isObject(),
  validate
], async (req, res) => {
  try {
    const { routeData, options = {} } = req.body;
    
    // Create saved route instance
    const savedRouteModel = new SavedRouteModel();
    
    // Default expiration: 30 days
    const expiresIn = options.expiresIn || (30 * 24 * 60 * 60 * 1000);
    
    const routeId = await savedRouteModel.saveRoute(routeData, {
      ...options,
      expiresIn
    });
    
    // Build shareable URL
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const shareableUrl = `${baseUrl}/routes/share/${routeId}`;
    
    res.json({
      success: true,
      routeId,
      shareableUrl,
      expiresAt: new Date(Date.now() + expiresIn).toISOString()
    });
    
  } catch (error) {
    console.error('Route save error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save route',
      message: error.message
    });
  }
});

/**
 * GET /api/routes/:routeId
 * Retrieve a saved route by ID
 */
router.get('/:routeId', async (req, res) => {
  try {
    const { routeId } = req.params;
    
    const savedRouteModel = new SavedRouteModel();
    const route = await savedRouteModel.getRoute(routeId);
    
    if (!route) {
      return res.status(404).json({
        success: false,
        error: 'Route not found or expired'
      });
    }
    
    res.json({
      success: true,
      route
    });
    
  } catch (error) {
    console.error('Route retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve route',
      message: error.message
    });
  }
});

/**
 * DELETE /api/routes/:routeId
 * Delete a saved route (optional authentication for ownership check)
 */
router.delete('/:routeId', async (req, res) => {
  try {
    const { routeId } = req.params;
    // Optional: get userId from authentication middleware
    // const userId = req.user?.id;
    
    const savedRouteModel = new SavedRouteModel();
    const deleted = await savedRouteModel.deleteRoute(routeId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Route not found or already deleted'
      });
    }
    
    res.json({
      success: true,
      message: 'Route deleted successfully'
    });
    
  } catch (error) {
    console.error('Route deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete route',
      message: error.message
    });
  }
});

/**
 * GET /api/routes/:routeId/print
 * Generate print-friendly HTML view of route
 */
router.get('/:routeId/print', async (req, res) => {
  try {
    const { routeId } = req.params;
    
    const savedRouteModel = new SavedRouteModel();
    const route = await savedRouteModel.getRoute(routeId);
    
    if (!route) {
      return res.status(404).send('<h1>Route not found or expired</h1>');
    }
    
    // Generate print-optimized HTML
    const html = generatePrintView(route);
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    console.error('Print view error:', error);
    res.status(500).send('<h1>Error generating print view</h1>');
  }
});

/**
 * Helper function to generate print-friendly HTML
 * @param {Object} route - Route data
 * @returns {string} HTML string
 */
function generatePrintView(route) {
  const { routeData, travelMode, routeName, createdAt } = route;
  const { locations, metrics, startLocation } = routeData;
  
  const date = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const stopsList = locations.map((loc, idx) => `
    <li class="stop-item">
      <div class="stop-number">${idx + 1}</div>
      <div class="stop-details">
        <strong>${escapeHtml(loc.firstName || '')} ${escapeHtml(loc.lastName || '')}</strong><br>
        ${escapeHtml(loc.address || '')}, ${escapeHtml(loc.city || '')}<br>
        <small>Voter ID: ${loc.voterId || 'N/A'} | Phone: ${escapeHtml(loc.phone || 'N/A')}</small>
      </div>
    </li>
  `).join('');
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Route Sheet - ${escapeHtml(routeName || date)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    
    .route-header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #333;
    }
    
    .route-header h1 {
      font-size: 24px;
      margin-bottom: 10px;
    }
    
    .route-summary {
      background: #f5f5f5;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 5px;
    }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 10px;
    }
    
    .summary-item {
      text-align: center;
    }
    
    .summary-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
    }
    
    .summary-value {
      font-size: 20px;
      font-weight: bold;
      color: #333;
    }
    
    .stop-list {
      list-style: none;
    }
    
    .stop-item {
      display: flex;
      gap: 15px;
      padding: 15px;
      margin-bottom: 10px;
      border: 1px solid #ddd;
      border-radius: 5px;
      page-break-inside: avoid;
    }
    
    .stop-number {
      background: #4285F4;
      color: white;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      flex-shrink: 0;
    }
    
    .stop-details {
      flex: 1;
    }
    
    .stop-details strong {
      font-size: 16px;
      color: #333;
    }
    
    .stop-details small {
      color: #666;
      font-size: 12px;
    }
    
    @media print {
      @page {
        margin: 0.5in;
      }
      
      body {
        padding: 0;
      }
      
      .no-print {
        display: none !important;
      }
      
      .route-summary {
        background: white;
        border: 1px solid #ddd;
      }
      
      .stop-item {
        page-break-inside: avoid;
      }
    }
    
    @media screen {
      .print-button {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: #4285F4;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      }
      
      .print-button:hover {
        background: #357AE8;
      }
    }
  </style>
</head>
<body>
  <button class="print-button no-print" onclick="window.print()">🖨️ Print</button>
  
  <div class="route-header">
    <h1>${escapeHtml(routeName || 'Canvassing Route')}</h1>
    <p>${date}</p>
  </div>
  
  <div class="route-summary">
    <h2 style="margin-bottom: 10px;">Route Overview</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <div class="summary-label">Total Stops</div>
        <div class="summary-value">${locations.length}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Distance</div>
        <div class="summary-value">${metrics?.totalDistanceMiles?.toFixed(1) || 'N/A'} mi</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">Duration</div>
        <div class="summary-value">${Math.floor((metrics?.totalDurationMinutes || 0) / 60)}h ${(metrics?.totalDurationMinutes || 0) % 60}m</div>
      </div>
    </div>
    <p style="margin-top: 15px;"><strong>Travel Mode:</strong> ${escapeHtml(travelMode.charAt(0).toUpperCase() + travelMode.slice(1))}</p>
  </div>
  
  <h2 style="margin-bottom: 15px;">Stop List</h2>
  <ul class="stop-list">
    ${stopsList}
  </ul>
  
  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px;">
    <p>Generated by Voter Platform | Route ID: ${route.id}</p>
  </div>
</body>
</html>
  `;
}

/**
 * Helper function to escape HTML (prevent XSS)
 * @param {string} unsafe - Unsafe string
 * @returns {string} Escaped string
 */
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * POST /api/routes/cleanup-expired
 * Clean up expired routes (can be scheduled with cron)
 */
router.post('/cleanup-expired', async (req, res) => {
  try {
    const savedRouteModel = new SavedRouteModel();
    const deletedCount = await savedRouteModel.cleanupExpiredRoutes();
    
    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} expired routes`,
      deletedCount
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      message: error.message
    });
  }
});

module.exports = router;
