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
const { query, param, validationResult } = require('express-validator');
const database = require('../config/database');
const VoterModel = require('../models/voter');

/**
 * INPUT VALIDATION: Helper middleware to check validation results
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};

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
            `SELECT p.* FROM precincts p
             WHERE p.precinct_number IN (SELECT DISTINCT precinct_number FROM voters)
             ORDER BY p.precinct_number`
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
 * - super_voter: Filter for super voters (true/false)
 * - geocoded: Filter by geocoding status (true/false)
 * - limit: Number of results (default: 50)
 * - offset: Pagination offset (default: 0)
 * - sort: Sort field (default: 'last_name')
 * - order: Sort direction (default: 'asc')
 * 
 * Phase 2 Implementation: FUNCTIONAL
 */
router.get('/:number/voters', [
    param('number').isString().trim().withMessage('Precinct number must be a valid string'),
    query('super_voter').optional().isBoolean().withMessage('super_voter must be true or false'),
    query('geocoded').optional().isBoolean().withMessage('geocoded must be true or false'),
    query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer'),
    query('sort').optional().isIn(['last_name', 'first_name', 'precinct_number', 'city', 'zip_code']).withMessage('Invalid sort field'),
    query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be asc or desc'),
    validate
], async (req, res, next) => {
    try {
        // Validate precinct exists
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

        // Build filters for VoterModel
        const voterModel = new VoterModel();
        const filters = {
            precinct: req.params.number,
            super_voter: req.query.super_voter,
            geocoded: req.query.geocoded
        };
        
        const pagination = {
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0,
            sort: req.query.sort || 'last_name',
            order: req.query.order || 'asc'
        };
        
        // Get voters using existing VoterModel
        const result = await voterModel.findAll(filters, pagination);
        
        // Add calculated age and age group to each voter
        const dataWithAge = result.data.map(voter => ({
            ...voter,
            age: VoterModel.calculateAge(voter.dateOfBirth),
            ageGroup: VoterModel.getAgeGroup(voter.dateOfBirth)
        }));
        
        res.json({
            success: true,
            precinct: req.params.number,
            data: dataWithAge,
            total: result.total,
            limit: pagination.limit,
            offset: pagination.offset
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
 * - Super voters count and percentage
 * - Geocoded voters count and percentage
 * - Party affiliation breakdown
 * - Average participation rate
 * - Top elections by participation
 * 
 * Phase 4 Implementation: FUNCTIONAL
 */
router.get('/:number/stats', [
    param('number').isString().trim().withMessage('Precinct number must be a valid string'),
    validate
], async (req, res, next) => {
    try {
        // Validate precinct exists
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

        // Execute all statistics queries
        
        // 1. Total voters
        const totalVoters = await database.get(
            'SELECT COUNT(*) as count FROM voters WHERE precinct_number = ?',
            [req.params.number]
        );
        
        // 2. Super voters
        const superVoters = await database.get(
            'SELECT COUNT(*) as count FROM voters WHERE precinct_number = ? AND super_voter = 1',
            [req.params.number]
        );
        
        // 3. Geocoded voters (have both latitude and longitude)
        const geocodedVoters = await database.get(
            'SELECT COUNT(*) as count FROM voters WHERE precinct_number = ? AND latitude IS NOT NULL AND longitude IS NOT NULL',
            [req.params.number]
        );
        
        // 4. Party breakdown (most recent party affiliation for each voter)
        const partyBreakdown = await database.all(`
            SELECT 
                eh.party_code as party,
                COUNT(DISTINCT v.voter_id) as count
            FROM voters v
            LEFT JOIN election_history eh ON v.voter_id = eh.voter_id
            WHERE v.precinct_number = ?
              AND eh.party_code IS NOT NULL
              AND eh.id = (
                  SELECT id FROM election_history 
                  WHERE voter_id = v.voter_id 
                    AND party_code IS NOT NULL
                  /* Sort chronologically: year DESC, then General > Runoff > Primary */
                  ORDER BY SUBSTR(election_code, 1, 4) DESC,
                    CASE SUBSTR(election_code, -1)
                      WHEN 'G' THEN 1
                      WHEN 'R' THEN 2
                      WHEN 'P' THEN 3
                      ELSE 4
                    END ASC
                  LIMIT 1
              )
            GROUP BY eh.party_code
            ORDER BY count DESC
        `, [req.params.number]);
        
        // 5. Average participation rate (per voter)
        const avgParticipation = await database.get(`
            SELECT AVG(
                CASE 
                    WHEN totalElections > 0 
                    THEN CAST(electionsVoted AS FLOAT) / totalElections * 100 
                    ELSE 0 
                END
            ) as average
            FROM (
                SELECT 
                    v.voter_id,
                    (
                        SELECT COUNT(*)
                        FROM election_history
                        WHERE election_history.voter_id = v.voter_id
                    ) as totalElections,
                    (
                        SELECT COUNT(*) 
                        FROM election_history 
                        WHERE election_history.voter_id = v.voter_id 
                          AND voted = 1
                    ) as electionsVoted
                FROM voters v
                WHERE v.precinct_number = ?
            ) subquery
        `, [req.params.number]);
        
        // 6. Top elections by participation
        const topElections = await database.all(`
            SELECT 
                election_code,
                COUNT(*) as voters_participated
            FROM election_history eh
            JOIN voters v ON eh.voter_id = v.voter_id
            WHERE v.precinct_number = ? AND eh.voted = 1
            GROUP BY election_code
            ORDER BY voters_participated DESC
            LIMIT 5
        `, [req.params.number]);

        // Format response
        const total = totalVoters.count;
        const superCount = superVoters.count;
        const geocodedCount = geocodedVoters.count;
        
        const stats = {
            totalVoters: total,
            superVoters: superCount,
            superVoterPercentage: total > 0 ? parseFloat((superCount / total * 100).toFixed(1)) : 0,
            geocodedVoters: geocodedCount,
            geocodingPercentage: total > 0 ? parseFloat((geocodedCount / total * 100).toFixed(1)) : 0,
            partyBreakdown: Object.fromEntries(
                partyBreakdown.map(p => [p.party, p.count])
            ),
            averageParticipationRate: avgParticipation.average ? parseFloat(avgParticipation.average.toFixed(1)) : 0,
            topElectionParticipation: Object.fromEntries(
                topElections.map(e => [e.election_code, e.voters_participated])
            )
        };
        
        res.json({
            success: true,
            precinct: req.params.number,
            precinctName: precinct.name,
            stats
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
