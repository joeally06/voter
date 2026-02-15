/**
 * Precinct Routes
 * Handles all precinct-related API endpoints
 * 
 * Phase 1: Basic precinct data retrieval (FUNCTIONAL)
 * Phase 2: Voter statistics integration
 * Phase 4: Advanced analytics and filtering
 */

const express = require('express');
const router = express.Router();
const database = require('../config/database');

/**
 * GET /api/precincts
 * List all precincts with statistics
 * 
 * Returns array of precinct objects with voter counts
 * Phase 1: FUNCTIONAL - Returns initial precinct data
 */
router.get('/', async (req, res, next) => {
    try {
        const precincts = await database.all(
            'SELECT * FROM precincts ORDER BY precinct_number'
        );
        
        res.json({
            success: true,
            count: precincts.length,
            data: precincts
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/precincts/:number
 * Get detailed information for a specific precinct
 * 
 * Parameters:
 * - number: Precinct number (e.g., '01', '02')
 * 
 * Returns:
 * - Precinct details
 * - Voter statistics
 * - Super voter counts
 * 
 * Phase 1: FUNCTIONAL - Returns basic precinct data
 * Phase 2: Will include voter counts after DBF import
 */
router.get('/:number', async (req, res, next) => {
    try {
        const precinct = await database.get(
            'SELECT * FROM precincts WHERE precinct_number = ?',
            [req.params.number]
        );
        
        if (!precinct) {
            return res.status(404).json({
                success: false,
                error: 'Precinct not found',
                message: `No precinct with number ${req.params.number}`
            });
        }
        
        res.json({
            success: true,
            data: precinct
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/precincts/:number/voters
 * Get all voters in a specific precinct
 * 
 * Parameters:
 * - number: Precinct number
 * 
 * Query parameters:
 * - super_voters_only: Filter for super voters (true/false)
 * - limit: Number of results
 * - offset: Pagination offset
 * 
 * Phase 2 Implementation Required
 */
router.get('/:number/voters', async (req, res, next) => {
    try {
        // Phase 2: Implement voter listing by precinct
        res.json({
            message: 'Precinct voters endpoint - Implementation pending',
            phase: 2,
            precinct: req.params.number,
            filters: req.query,
            note: 'This endpoint will return all voters in the specified precinct'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/precincts/:number/stats
 * Get detailed statistics for a precinct
 * 
 * Returns:
 * - Total voters
 * - Active voters
 * - Super voters
 * - Party affiliation breakdown
 * - Turnout statistics
 * 
 * Phase 4 Implementation Required
 */
router.get('/:number/stats', async (req, res, next) => {
    try {
        // Phase 4: Implement advanced statistics
        res.json({
            message: 'Precinct statistics endpoint - Implementation pending',
            phase: 4,
            precinct: req.params.number,
            note: 'This endpoint will return detailed voter analytics'
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
