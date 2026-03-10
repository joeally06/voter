/**
 * Geocoding Routes
 * Handles all geocoding-related API endpoints
 * 
 * Phase 3: Complete Google Maps API integration
 * 
 * Endpoints:
 * 1. POST /api/geocode/batch - Batch geocoding
 * 2. GET /api/geocode/jobs/:id - Job status
 * 3. POST /api/geocode/single - Single address geocoding
 * 4. GET /api/geocode/failed - Failed addresses list
 * 5. PUT /api/geocode/manual/:voterId - Manual geocode override
 * 6. GET /api/geocode/stats - Geocoding statistics
 * 7. POST /api/geocode/retry/:jobId - Retry failed addresses
 * 8. GET /api/geocode/review - Addresses needing review
 */

const express = require('express');
const router = express.Router();
const database = require('../config/database');
const GeocodingService = require('../services/geocoding-service');
const AddressCacheService = require('../services/address-cache-service');
const GeocodingJobService = require('../services/geocoding-job-service');
const QuotaManager = require('../services/quota-manager');

// Initialize services (shared instances)
const jobService = new GeocodingJobService();
const geocodingService = new GeocodingService();
const cacheService = new AddressCacheService();
const quotaManager = new QuotaManager();

/**
 * Transform voter fields from snake_case to camelCase
 * Ensures consistent API responses regardless of data source
 * MAJ-01: Field Name Standardization
 */
function transformVoterFields(voter) {
  if (!voter) return voter;
  return {
    ...voter,
    firstName: voter.first_name || voter.firstName,
    lastName: voter.last_name || voter.lastName,
    voterId: voter.voter_id || voter.voterId,
    zipCode: voter.zip_code || voter.zipCode,
    precinctNumber: voter.precinct_number || voter.precinctNumber,
    dateOfBirth: voter.date_of_birth || voter.dateOfBirth,
    superVoter: voter.super_voter !== undefined ? voter.super_voter : voter.superVoter,
    createdAt: voter.created_at || voter.createdAt,
    updatedAt: voter.updated_at || voter.updatedAt,
    geocodingQuality: voter.geocoding_quality || voter.geocodingQuality,
    // Remove snake_case properties
    first_name: undefined,
    last_name: undefined,
    voter_id: undefined,
    zip_code: undefined,
    precinct_number: undefined,
    date_of_birth: undefined,
    super_voter: undefined,
    created_at: undefined,
    updated_at: undefined,
    geocoding_quality: undefined
  };
}

/**
 * POST /api/geocode/batch
 * Start batch geocoding for multiple voters
 */
router.post('/batch', async (req, res, next) => {
    try {
        const { voterIds, all, options = {} } = req.body;
        
        // Validation
        if (!voterIds && !all) {
            return res.status(400).json({
                success: false,
                error: 'Must provide voterIds array or all=true'
            });
        }
        
        let targetVoterIds = voterIds;
        
        // If "all" flag, get all ungecoded voters
        if (all) {
            const voters = await database.all(`
                SELECT id FROM voters WHERE latitude IS NULL
            `);
            targetVoterIds = voters.map(v => v.id);
        }
        
        if (!targetVoterIds || targetVoterIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No voters to geocode'
            });
        }
        
        // Check monthly quota BEFORE creating the job
        const monthlyStatus = await quotaManager.getMonthlyQuotaStatus('geocoding');
        const estimatedApiCalls = Math.ceil(targetVoterIds.length * 0.2); // ~80% cache hit rate

        if (monthlyStatus.isExhausted || (monthlyStatus.used + estimatedApiCalls > monthlyStatus.limit)) {
            return res.status(429).json({
                success: false,
                error: monthlyStatus.isExhausted
                    ? 'Monthly geocoding quota exceeded'
                    : 'Insufficient monthly geocoding quota for this batch',
                monthlyUsage: monthlyStatus.used,
                monthlyLimit: monthlyStatus.limit,
                remaining: monthlyStatus.remaining,
                estimatedNeeded: estimatedApiCalls,
                resetsOn: monthlyStatus.resetDate,
                suggestion: monthlyStatus.isExhausted
                    ? 'Wait until quota resets on the 1st of next month'
                    : `Reduce batch to ~${Math.floor(monthlyStatus.remaining * 5)} addresses (est. ${monthlyStatus.remaining} API calls) or wait until quota resets`
            });
        }
        
        // Create geocoding job (only after quota check passes)
        const jobId = await jobService.createJob(targetVoterIds, options);
        
        // Estimate duration
        const estimatedSeconds = Math.ceil(targetVoterIds.length * 0.15);
        const estimatedDuration = estimatedSeconds > 60 
            ? `${Math.floor(estimatedSeconds / 60)} minutes ${estimatedSeconds % 60} seconds`
            : `${estimatedSeconds} seconds`;
        
        res.json({
            success: true,
            jobId,
            message: 'Geocoding job started',
            totalRecords: targetVoterIds.length,
            estimatedDuration,
            statusUrl: `/api/geocode/jobs/${jobId}`
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/geocode/jobs/:id
 * Get status and progress of a geocoding job
 */
router.get('/jobs/:id', async (req, res, next) => {
    try {
        const jobId = parseInt(req.params.id);
        
        if (isNaN(jobId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid job ID'
            });
        }
        
        const status = await jobService.getJobStatus(jobId);
        
        res.json({
            success: true,
            ...status
        });
        
    } catch (error) {
        if (error.message.includes('not found')) {
            return res.status(404).json({
                success: false,
                error: `Job ${req.params.id} not found`
            });
        }
        next(error);
    }
});

/**
 * POST /api/geocode/single
 * Geocode a single address immediately
 */
router.post('/single', async (req, res, next) => {
    try {
        const { address, city, state, zipCode } = req.body;
        
        // MAJ-06: Validate required fields including state
        if (!address || !city || !zipCode) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: address, city, zipCode'
            });
        }
        
        if (!state || state.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: state - required for geocoding accuracy'
            });
        }
        
        // Check cache first
        const cached = await cacheService.getCachedGeocode(
            address, 
            city, 
            state, 
            zipCode
        );
        
        if (cached) {
            return res.json({
                success: true,
                result: cached
            });
        }
        
        // Call geocoding API
        const result = await geocodingService.geocodeAddress(address, {
            locality: city,
            administrative_area: state,
            postal_code: zipCode
        });
        
        if (result.success) {
            // Cache the result
            await cacheService.setCachedGeocode(
                address, 
                city, 
                state, 
                zipCode, 
                result
            );
            
            res.json({
                success: true,
                result
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                error_type: result.error_type
            });
        }
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/geocode/failed/:jobId
 * Get all failed addresses from a specific job
 */
router.get('/failed/:jobId', async (req, res, next) => {
    try {
        const jobId = parseInt(req.params.jobId);
        
        if (isNaN(jobId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid job ID'
            });
        }
        
        const errors = await jobService.getFailedAddresses(jobId);
        
        // MAJ-01: Transform fields to camelCase
        const transformedErrors = errors.map(transformVoterFields);
        
        res.json({
            success: true,
            jobId,
            failedCount: transformedErrors.length,
            errors: transformedErrors
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/geocode/manual/:voterId
 * Manually set coordinates for a voter
 */
router.put('/manual/:voterId', async (req, res, next) => {
    try {
        const voterId = parseInt(req.params.voterId);
        const { latitude, longitude, quality_score, note } = req.body;
        
        // Validation
        if (isNaN(voterId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid voter ID'
            });
        }
        
        if (latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: latitude, longitude'
            });
        }
        
        // Validate coordinate ranges
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinate values (lat: -90 to 90, lng: -180 to 180)'
            });
        }
        
        // Update voter
        await database.run(`
            UPDATE voters
            SET latitude = ?, 
                longitude = ?, 
                geocoding_quality = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            latitude,
            longitude,
            `${quality_score || 100} (Manual)`,
            voterId
        ]);
        
        // Log manual geocoding
        await database.run(`
            INSERT INTO geocoding_errors (
                job_id, voter_id, address, error_type, error_message
            ) SELECT 
                0, id, address, 'MANUAL_OVERRIDE', ?
            FROM voters WHERE id = ?
        `, [note || 'Manual geocoding', voterId]);
        
        res.json({
            success: true,
            message: `Manual geocoding saved for voter ${voterId}`,
            voter: {
                id: voterId,
                latitude,
                longitude,
                geocoding_quality: `${quality_score || 100} (Manual)`
            }
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/geocode/stats
 * Get overall geocoding statistics
 */
router.get('/stats', async (req, res, next) => {
    try {
        // Get cache statistics
        const cacheStats = await cacheService.getCacheStats();
        
        // Get voter statistics
        const totalVoters = await database.get(`
            SELECT COUNT(*) as count FROM voters
        `);
        
        const geocodedVoters = await database.get(`
            SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL
        `);
        
        const avgQuality = await database.get(`
            SELECT AVG(CAST(geocoding_quality AS REAL)) as avg 
            FROM voters 
            WHERE geocoding_quality IS NOT NULL 
                AND geocoding_quality NOT LIKE '%Manual%'
        `);
        
        // Get recent jobs
        const recentJobs = await database.all(`
            SELECT * FROM geocoding_jobs
            ORDER BY start_time DESC
            LIMIT 5
        `);
        
        // Get API usage today
        const today = new Date().toISOString().split('T')[0];
        const todayUsage = await geocodingService.getDailyUsage(today);
        const dailyLimit = parseInt(process.env.DAILY_GEOCODING_QUOTA || process.env.DAILY_QUOTA_LIMIT) || 333;
        
        // Get monthly quota status
        const monthlyGeocoding = await quotaManager.getMonthlyQuotaStatus('geocoding');
        
        res.json({
            success: true,
            totalVoters: totalVoters.count,
            geocodedVoters: geocodedVoters.count,
            pendingVoters: totalVoters.count - geocodedVoters.count,
            geocodingProgress: totalVoters.count > 0
                ? parseFloat(((geocodedVoters.count / totalVoters.count) * 100).toFixed(1))
                : 0,
            averageQualityScore: avgQuality?.avg 
                ? parseFloat(avgQuality.avg).toFixed(2) 
                : 0,
            cache: cacheStats,
            recentJobs,
            apiUsage: {
                today: todayUsage,
                dailyLimit,
                percentUsed: parseFloat(((todayUsage / dailyLimit) * 100).toFixed(1))
            },
            monthlyQuota: monthlyGeocoding
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/geocode/retry/:jobId
 * Retry failed addresses from a previous job
 */
router.post('/retry/:jobId', async (req, res, next) => {
    try {
        const jobId = parseInt(req.params.jobId);
        const { errorTypes } = req.body;
        
        if (isNaN(jobId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid job ID'
            });
        }
        
        // Get count of failed addresses
        const failedAddresses = await jobService.getFailedAddresses(jobId, errorTypes);
        
        if (failedAddresses.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No failed addresses to retry'
            });
        }
        
        // Create retry job
        const newJobId = await jobService.retryFailedAddresses(jobId, errorTypes);
        
        res.json({
            success: true,
            newJobId,
            message: `Retry job created for ${failedAddresses.length} failed addresses`,
            originalJobId: jobId,
            statusUrl: `/api/geocode/jobs/${newJobId}`
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/geocode/review
 * Get addresses needing manual review (low quality scores)
 */
router.get('/review', async (req, res, next) => {
    try {
        const minQuality = parseInt(req.query.minQuality) || 0;
        const maxQuality = parseInt(req.query.maxQuality) || 70;
        const limit = parseInt(req.query.limit) || 100;
        
        const voters = await database.all(`
            SELECT 
                id,
                voter_id,
                first_name,
                last_name,
                address,
                city,
                zip_code,
                latitude,
                longitude,
                geocoding_quality
            FROM voters
            WHERE latitude IS NOT NULL
                AND geocoding_quality IS NOT NULL
                AND geocoding_quality NOT LIKE '%Manual%'
                AND CAST(geocoding_quality AS REAL) >= ?
                AND CAST(geocoding_quality AS REAL) <= ?
            ORDER BY CAST(geocoding_quality AS REAL) ASC
            LIMIT ?
        `, [minQuality, maxQuality, limit]);
        
        // MAJ-01: Transform fields to camelCase
        const transformedVoters = voters.map(transformVoterFields);
        
        res.json({
            success: true,
            count: transformedVoters.length,
            voters: transformedVoters
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/geocode/cache/stats (Legacy compatibility)
 */
router.get('/cache/stats', async (req, res, next) => {
    try {
        const cacheStats = await cacheService.getCacheStats();
        
        res.json({
            success: true,
            ...cacheStats
        });
        
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/geocode/status (Legacy - redirects to jobs/:id)
 */
router.get('/status', async (req, res, next) => {
    try {
        const jobId = req.query.jobId;
        
        if (!jobId) {
            return res.status(400).json({
                success: false,
                error: 'Missing jobId query parameter. Use /api/geocode/jobs/:id instead'
            });
        }
        
        // Redirect to new endpoint
        res.redirect(`/api/geocode/jobs/${jobId}`);
        
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/geocode/track-map-load
 * Track a Dynamic Maps load for monthly quota enforcement
 */
router.post('/track-map-load', async (req, res, next) => {
    try {

        // Check monthly limit before allowing map load
        const status = await quotaManager.getMonthlyQuotaStatus('dynamic_maps');

        if (status.isExhausted) {
            return res.status(429).json({
                success: false,
                error: 'Monthly Dynamic Maps quota exceeded',
                monthlyUsage: status.used,
                monthlyLimit: status.limit,
                resetsOn: status.resetDate
            });
        }

        // Increment counter
        await quotaManager.incrementApiCall('dynamic_maps', 1);

        // Return updated status
        const updatedStatus = await quotaManager.getMonthlyQuotaStatus('dynamic_maps');

        res.json({
            success: true,
            quota: updatedStatus
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/geocode/monthly-quota
 * Get monthly quota status for all tracked APIs
 */
router.get('/monthly-quota', async (req, res, next) => {
    try {
        const monthlyStatus = await quotaManager.getMonthlyQuotaStatus();

        res.json({
            success: true,
            monthly: monthlyStatus
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
