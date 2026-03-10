/**
 * Voter Routes
 * Handles all voter-related API endpoints
 * 
 * Phase 1: Route stubs with placeholder responses + input validation
 * Phase 2: Full implementation with DBF data integration
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
 * GET /api/voters
 * List all voters with optional filtering
 * 
 * Query parameters:
 * - precinct: Filter by precinct number
 * - name: Search by name (partial match)
 * - super_voter: Filter super voters (true/false)
 * - limit: Number of results (default: 100)
 * - offset: Pagination offset (default: 0)
 * 
 * Phase 2 Implementation Required
 */
router.get('/', [
    query('precinct').optional().isString().trim().withMessage('Precinct must be a valid string'),
    query('name').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
    query('super_voter').optional().isBoolean().withMessage('super_voter must be true or false'),
    query('geocoded').optional().isBoolean().withMessage('geocoded must be true or false'),
    // NEW: Party filter validator - accepts R, D, or R,D
    query('party')
        .optional()
        .isString()
        .trim()
        .matches(/^(R|D|R,D|D,R)$/)
        .withMessage('Party must be R, D, or R,D'),
    // NEW: Voting status filter validator - accepts 'regular' or 'never'
    query('voting_status')
        .optional()
        .isIn(['regular', 'never'])
        .withMessage('Voting status must be "regular" or "never"'),
    query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer'),
    query('sort').optional().isIn(['last_name', 'first_name', 'precinct_number', 'city', 'zip_code']).withMessage('Invalid sort field'),
    query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be asc or desc'),
    validate
], async (req, res, next) => {
    try {
        const voterModel = new VoterModel();
        
        const filters = {
            precinct: req.query.precinct,
            name: req.query.name,
            super_voter: req.query.super_voter,
            geocoded: req.query.geocoded,
            party: req.query.party,              // NEW
            voting_status: req.query.voting_status // NEW
        };
        
        const pagination = {
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0,
            sort: req.query.sort || 'last_name',
            order: req.query.order || 'asc'
        };
        
        const result = await voterModel.findAll(filters, pagination);
        
        // Add calculated age and age group to each voter
        const dataWithAge = result.data.map(voter => ({
            ...voter,
            age: VoterModel.calculateAge(voter.dateOfBirth),
            ageGroup: VoterModel.getAgeGroup(voter.dateOfBirth)
        }));
        
        res.json({
            success: true,
            count: result.data.length,
            total: result.total,
            filters: {
                precinct: filters.precinct || null,
                name: filters.name || null,
                super_voter: filters.super_voter || null,
                geocoded: filters.geocoded || null,
                party: filters.party || null,              // NEW
                voting_status: filters.voting_status || null // NEW
            },
            pagination: {
                limit: pagination.limit,
                offset: pagination.offset,
                sort: pagination.sort,
                order: pagination.order
            },
            data: dataWithAge
        });
    } catch (error) {
        next(error);
    }
});

// IMPORTANT: /search/:query and /precinct/:precinct MUST be registered BEFORE /:id
// Express evaluates routes in registration order. If /:id comes first,
// '/search/smith' matches /:id with id="search", and '/precinct/5' matches
// /:id with id="precinct" — neither named route would ever be reached.

/**
 * GET /api/voters/search/:query
 * Search voters by name or address
 */
router.get('/search/:query', [
    param('query').isString().trim().isLength({ min: 2, max: 100 }).withMessage('Search query must be 2-100 characters'),
    query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('Limit must be between 1 and 200'),
    validate
], async (req, res, next) => {
    try {
        const voterModel = new VoterModel();
        const limit = parseInt(req.query.limit) || 50;
        
        const results = await voterModel.search(req.params.query, limit);
        
        // Add calculated age and age group to each result
        const resultsWithAge = results.map(voter => ({
            ...voter,
            age: VoterModel.calculateAge(voter.dateOfBirth),
            ageGroup: VoterModel.getAgeGroup(voter.dateOfBirth)
        }));
        
        res.json({
            success: true,
            query: req.params.query,
            count: results.length,
            data: resultsWithAge
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/voters/precinct/:precinct
 * Get all voters in a specific precinct with statistics
 */
router.get('/precinct/:precinct', [
    param('precinct').isString().trim().isLength({ min: 1, max: 3 }).withMessage('Precinct must be 1-3 characters'),
    validate
], async (req, res, next) => {
    try {
        const voterModel = new VoterModel();
        const result = await voterModel.findByPrecinct(req.params.precinct);
        
        // Add calculated age and age group to each voter
        const votersWithAge = result.voters.map(voter => ({
            ...voter,
            age: VoterModel.calculateAge(voter.dateOfBirth),
            ageGroup: VoterModel.getAgeGroup(voter.dateOfBirth)
        }));
        
        res.json({
            success: true,
            precinct: result.precinct,
            count: result.voters.length,
            voters: votersWithAge
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/voters/:id
 * Get detailed information for a specific voter
 */
router.get('/:id', [
    param('id').isInt({ min: 1 }).withMessage('Voter ID must be a positive integer'),
    validate
], async (req, res, next) => {
    try {
        const voterModel = new VoterModel();
        const voter = await voterModel.findById(req.params.id);
        
        if (!voter) {
            return res.status(404).json({
                success: false,
                error: 'Voter not found',
                message: `No voter with ID ${req.params.id}`
            });
        }
        
        // Add calculated age and age group
        voter.age = VoterModel.calculateAge(voter.dateOfBirth);
        voter.ageGroup = VoterModel.getAgeGroup(voter.dateOfBirth);
        
        res.json({
            success: true,
            data: voter
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
