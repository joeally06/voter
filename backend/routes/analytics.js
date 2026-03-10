/**
 * Analytics Routes
 * Handles all analytics and reporting endpoints
 * 
 * Features:
 * - Dashboard metrics aggregation
 * - Voting pattern analysis across elections
 * - Turnout calculations with comparisons
 * - Super voter identification
 * - Party affiliation distribution
 * - Input validation and error handling
 * - Response caching for performance
 */

const express = require('express');
const router = express.Router();
const { query, validationResult } = require('express-validator');
const AnalyticsService = require('../services/analytics-service');

/**
 * INPUT VALIDATION: Helper middleware to check validation results
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            message: 'Invalid query parameters',
            details: errors.array(),
            timestamp: new Date().toISOString()
        });
    }
    next();
};

/**
 * GET /api/analytics/dashboard
 * Get comprehensive dashboard metrics in a single response
 * 
 * Returns:
 * - Total counts (voters, super voters, precincts, geocoded)
 * - Percentages (super voter rate, geocoding progress)
 * - Recent activity (last import details)
 * - Precinct-level summary with super voter rates
 * 
 * Example: GET /api/analytics/dashboard
 */
router.get('/dashboard', async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const metrics = await analyticsService.getDashboardMetrics();
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: metrics.queryTime,
            data: {
                totals: metrics.totals,
                percentages: metrics.percentages,
                recentActivity: metrics.recentActivity,
                precinctSummary: metrics.precinctSummary
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/turnout
 * Returns voter turnout data with comparative analysis
 *
 * Query parameters:
 * - electionCode: Specific election to analyze (optional)
 * - precinct: Filter by precinct number (2 digits, optional)
 * - groupBy: Group results by 'precinct' or 'party' (optional, not yet implemented)
 * - compareWith: Compare with another election code (optional)
 * 
 * Returns:
 * - Overall turnout statistics (rates, early vs election day)
 * - Turnout breakdown by precinct
 * - Comparison with previous election (if compareWith provided)
 * - Time-based analysis (early voting vs election day)
 * 
 * Example: GET /api/analytics/turnout?electionCode=E_5&compareWith=E_4
 */
router.get('/turnout', [
    query('electionCode')
        .optional()
        .isString()
        .trim()
        .matches(/^[A-Z0-9_]+$/)
        .withMessage('Invalid election code format'),
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    query('groupBy')
        .optional()
        .isIn(['precinct', 'party'])
        .withMessage('Group by must be "precinct" or "party"'),
    query('compareWith')
        .optional()
        .isString()
        .trim()
        .matches(/^[A-Z0-9_]+$/)
        .withMessage('Invalid comparison election code format'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        
        const filters = {
            electionCode: req.query.electionCode,
            precinct: req.query.precinct,
            groupBy: req.query.groupBy,
            compareWith: req.query.compareWith
        };
        
        const result = await analyticsService.getTurnoutAnalysis(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/voting-patterns
 * Analyze voting patterns across elections
 * 
 * Query parameters:
 * - precinct: Filter by precinct number (2 digits, optional)
 * - electionCodes: Comma-separated election codes (optional)
 * - partyCode: Party filter (R, D, or I, optional)
 * - minElections: Minimum elections voted (1-10, default: 1, optional)
 * 
 * Returns:
 * - Voting frequency distribution
 * - Party trends over elections
 * - Early voting statistics
 * - Turnout by precinct
 * 
 * Example: GET /api/analytics/voting-patterns?precinct=01&minElections=3
 */
router.get('/voting-patterns', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    query('electionCodes')
        .optional()
        .isString()
        .trim()
        .matches(/^[A-Z0-9_]+(,[A-Z0-9_]+)*$/)
        .withMessage('Invalid election codes format (use comma-separated alphanumeric codes)'),
    query('partyCode')
        .optional()
        .isIn(['R', 'D', 'I', ''])
        .withMessage('Party code must be R (Republican), D (Democrat), or I (Independent)'),
    query('minElections')
        .optional()
        .isInt({ min: 1, max: 10 })
        .toInt()
        .withMessage('Min elections must be between 1 and 10'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        
        const filters = {
            precinct: req.query.precinct,
            electionCodes: req.query.electionCodes 
                ? req.query.electionCodes.split(',').map(c => c.trim())
                : null,
            partyCode: req.query.partyCode,
            minElections: req.query.minElections || 1
        };
        
        const result = await analyticsService.getVotingPatterns(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/super-voters
 * Identify and analyze super voters (high-frequency voters)
 * 
 * Query parameters:
 * - threshold: Minimum number of elections to qualify (1-10, default: 4, optional)
 * - precinct: Filter by precinct number (2 digits, optional)
 * - includeHistory: Include detailed voting history (true/false, optional)
 * 
 * Returns:
 * - Summary statistics (total voters, super voter count and rate)
 * - Geographic distribution across precincts
 * - Party affiliation breakdown of super voters
 * - Participation patterns (early voting preferences)
 * 
 * Example: GET /api/analytics/super-voters?threshold=5&precinct=01
 */
router.get('/super-voters', [
    query('threshold')
        .optional()
        .isInt({ min: 1, max: 10 })
        .toInt()
        .withMessage('Threshold must be between 1 and 10'),
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    query('includeHistory')
        .optional()
        .isBoolean()
        .toBoolean()
        .withMessage('includeHistory must be true or false'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        
        const threshold = req.query.threshold || 4;
        const filters = {
            threshold: threshold,
            precinct: req.query.precinct,
            includeHistory: req.query.includeHistory || false
        };
        
        const result = await analyticsService.getSuperVoterAnalysis(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            threshold: threshold,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/party-affiliation
 * Analyze party affiliation trends and geographic concentration
 * 
 * Query parameters:
 * - precinct: Filter by precinct number (2 digits, optional)
 * - electionCodes: Comma-separated election codes for trend analysis (optional)
 * - trendAnalysis: Include historical trends (true/false, optional)
 * 
 * Returns:
 * - Current party distribution and percentages
 * - Trends across elections (if trendAnalysis=true)
 * - Geographic concentration by precinct
 * - Strongest party per precinct
 * 
 * Example: GET /api/analytics/party-affiliation?trendAnalysis=true&electionCodes=E_1,E_2,E_3
 */
router.get('/party-affiliation', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    query('electionCodes')
        .optional()
        .isString()
        .trim()
        .matches(/^[A-Z0-9_]+(,[A-Z0-9_]+)*$/)
        .withMessage('Invalid election codes format (use comma-separated alphanumeric codes)'),
    query('trendAnalysis')
        .optional()
        .isBoolean()
        .toBoolean()
        .withMessage('trendAnalysis must be true or false'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        
        const filters = {
            precinct: req.query.precinct,
            electionCodes: req.query.electionCodes 
                ? req.query.electionCodes.split(',').map(c => c.trim())
                : null,
            trendAnalysis: req.query.trendAnalysis || false
        };
        
        const result = await analyticsService.getPartyAffiliation(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/demographics
 * Analyze demographic distribution of voters
 * 
 * Query parameters:
 * - precinct: Filter by precinct number (2 digits, optional)
 * - groupBy: Group results by 'city', 'zip', or 'precinct' (optional)
 * 
 * Returns:
 * - Voter distribution by city
 * - Voter distribution by zip code
 * - Registration trends and statistics
 * - Super voter rates by geographic area
 * 
 * Example: GET /api/analytics/demographics?groupBy=city
 */
router.get('/demographics', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    query('groupBy')
        .optional()
        .isIn(['city', 'zip', 'precinct'])
        .withMessage('Group by must be "city", "zip", or "precinct"'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        
        const filters = {
            precinct: req.query.precinct,
            groupBy: req.query.groupBy || 'city'
        };
        
        const result = await analyticsService.getDemographics(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/engagement-levels
 * Get voter engagement level breakdown (never voted, occasional, super voters)
 * 
 * Query parameters:
 * - precinct: Filter by precinct number (2 digits, optional)
 * 
 * Returns:
 * - Counts and percentages for each engagement category
 * - Never voted: 0 elections participated
 * - Occasional voters: 1-3 elections participated
 * - Super voters: 4+ elections participated
 * 
 * Example: GET /api/analytics/engagement-levels?precinct=05
 */
router.get('/engagement-levels', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const filters = {
            precinct: req.query.precinct
        };
        
        const result = await analyticsService.getEngagementLevels(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/non-voter-demographics
 * Get non-voter demographics by age group
 * 
 * Query parameters:
 * - precinct: Filter by precinct number (2 digits, optional)
 * 
 * Returns:
 * - Never-voted voter counts and percentages by age group
 * - Summary statistics including highest/lowest rate age groups
 * - Breakdown of engagement levels within each age group
 * 
 * Example: GET /api/analytics/non-voter-demographics
 */
router.get('/non-voter-demographics', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const filters = {
            precinct: req.query.precinct
        };
        
        const result = await analyticsService.getNonVoterDemographics(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/non-voters-by-precinct
 * Get non-voters by precinct with severity levels
 * 
 * Returns:
 * - Precinct-level non-voter analysis
 * - Severity indicators (critical ≥80%, high ≥60%, medium ≥40%, low <40%)
 * - Summary counts by severity level
 * 
 * Example: GET /api/analytics/non-voters-by-precinct
 */
router.get('/non-voters-by-precinct', async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const result = await analyticsService.getNonVotersByPrecinct();
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/election-codes
 * Returns all distinct election codes that have voting data.
 * Used to populate the election selector dropdown.
 *
 * Example: GET /api/analytics/election-codes
 */
router.get('/election-codes', async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const codes = await analyticsService.getElectionCodes();

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: codes
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/analytics/last-election-breakdown
 * Get breakdown of the most recent election: who voted, age distribution, precinct distribution
 *
 * Query parameters:
 * - precinct: Filter by precinct number (2 digits, optional)
 * - electionCode: Specific election code to analyze (optional, e.g. E_1, E_2)
 *
 * Returns:
 * - Election summary (total voted, turnout rate, early vote stats)
 * - Age group breakdown of voters
 * - Precinct-level breakdown with party data
 * - Summary highlights (highest/lowest turnout precincts, largest age group)
 *
 * Example: GET /api/analytics/last-election-breakdown
 * Example: GET /api/analytics/last-election-breakdown?precinct=05
 * Example: GET /api/analytics/last-election-breakdown?electionCode=E_2
 */
router.get('/last-election-breakdown', [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .matches(/^\d{2}$/)
        .withMessage('Precinct must be 2 digits'),
    query('electionCode')
        .optional()
        .isString()
        .trim()
        .matches(/^[A-Z0-9_]+$/)
        .withMessage('Invalid election code format'),
    validate
], async (req, res, next) => {
    try {
        const analyticsService = new AnalyticsService();
        const filters = {
            precinct: req.query.precinct,
            electionCode: req.query.electionCode
        };
        
        const result = await analyticsService.getLastElectionBreakdown(filters);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            queryTime: result.queryTime,
            filters: filters,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
