/**
 * Never-Voted Voters Routes
 * Handles retrieval and export of voters who have never participated in elections
 * 
 * Features:
 * - Filterable list of never-voted voters
 * - Age, precinct, city, and geocoding filters
 * - Search by name or address
 * - Pagination for large datasets
 * - CSV export capability
 */

const express = require('express');
const router = express.Router();
const { query, validationResult } = require('express-validator');
const database = require('../config/database');

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
 * GET /api/voters/never-voted
 * Get list of voters who have never participated in any election
 * 
 * Query parameters:
 * - limit: Number of results per page (default: 100, max: 1000)
 * - offset: Pagination offset (default: 0)
 * - precinct: Filter by precinct(s), comma-separated (optional)
 * - city: Filter by city/cities, comma-separated (optional)
 * - ageMin: Minimum age filter (default: 18)
 * - ageMax: Maximum age filter (default: 120)
 * - geocoded: Filter by geocoding status - 'true', 'false', or 'all' (default: 'all')
 * - search: Search by name or address (optional)
 * - sort: Sort field - 'lastName', 'firstName', 'age', 'precinct', 'city' (default: 'lastName')
 * - order: Sort order - 'asc' or 'desc' (default: 'asc')
 * - export: Set to 'csv' to download as CSV file
 * 
 * Returns JSON list or CSV file depending on export parameter
 */
router.get('/', [
    query('limit')
        .optional()
        .isInt({ min: 1, max: 1000 })
        .withMessage('Limit must be between 1 and 1000'),
    query('offset')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Offset must be non-negative'),
    query('ageMin')
        .optional()
        .isInt({ min: 0, max: 150 })
        .withMessage('Age minimum must be between 0 and 150'),
    query('ageMax')
        .optional()
        .isInt({ min: 0, max: 150 })
        .withMessage('Age maximum must be between 0 and 150'),
    query('geocoded')
        .optional()
        .isIn(['true', 'false', 'all'])
        .withMessage('Geocoded must be "true", "false", or "all"'),
    query('sort')
        .optional()
        .isIn(['lastName', 'firstName', 'age', 'precinct', 'city'])
        .withMessage('Sort field must be lastName, firstName, age, precinct, or city'),
    query('order')
        .optional()
        .isIn(['asc', 'desc'])
        .withMessage('Order must be "asc" or "desc"'),
    query('export')
        .optional()
        .isIn(['csv'])
        .withMessage('Export format must be "csv"'),
    validate
], async (req, res, next) => {
    try {
        // Parse query parameters
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const ageMin = parseInt(req.query.ageMin) || 18;
        const ageMax = parseInt(req.query.ageMax) || 120;
        const geocoded = req.query.geocoded || 'all';
        const search = req.query.search || null;
        const sort = req.query.sort || 'lastName';
        const order = req.query.order || 'asc';
        const exportFormat = req.query.export || null;
        
        // Parse multi-value filters
        const precincts = req.query.precinct ? req.query.precinct.split(',').map(p => p.trim()) : null;
        const cities = req.query.city ? req.query.city.split(',').map(c => c.trim()) : null;

        // Build WHERE clause
        let whereConditions = [
            '(SELECT COUNT(*) FROM election_history WHERE voter_id = v.voter_id AND voted = 1) = 0'
        ];
        let params = [];

        // Precinct filter
        if (precincts && precincts.length > 0) {
            const placeholders = precincts.map(() => '?').join(',');
            whereConditions.push(`v.precinct_number IN (${placeholders})`);
            params.push(...precincts);
        }

        // City filter
        if (cities && cities.length > 0) {
            const placeholders = cities.map(() => '?').join(',');
            whereConditions.push(`v.city IN (${placeholders})`);
            params.push(...cities);
        }

        // Age filter
        whereConditions.push(`(CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) BETWEEN ? AND ? OR v.date_of_birth IS NULL)`);
        params.push(ageMin, ageMax);

        // Geocoded filter
        if (geocoded === 'true') {
            whereConditions.push('v.latitude IS NOT NULL AND v.longitude IS NOT NULL');
        } else if (geocoded === 'false') {
            whereConditions.push('(v.latitude IS NULL OR v.longitude IS NULL)');
        }

        // Search filter
        if (search) {
            whereConditions.push(`(v.last_name LIKE ? OR v.first_name LIKE ? OR v.address LIKE ?)`);
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        const whereClause = 'WHERE ' + whereConditions.join(' AND ');

        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(*) as total
            FROM voters v
            ${whereClause}
        `;
        const countResult = await database.get(countQuery, params);
        const totalCount = countResult?.total || 0;

        // Build ORDER BY clause
        let orderByClause = '';
        switch (sort) {
            case 'lastName':
                orderByClause = `v.last_name ${order.toUpperCase()}`;
                break;
            case 'firstName':
                orderByClause = `v.first_name ${order.toUpperCase()}`;
                break;
            case 'age':
                orderByClause = `age ${order.toUpperCase()}`;
                break;
            case 'precinct':
                orderByClause = `v.precinct_number ${order.toUpperCase()}`;
                break;
            case 'city':
                orderByClause = `v.city ${order.toUpperCase()}`;
                break;
            default:
                orderByClause = `v.last_name ${order.toUpperCase()}`;
        }

        // Main query
        const dataQuery = `
            SELECT 
                v.id,
                v.voter_id as voterId,
                v.last_name as lastName,
                v.first_name as firstName,
                v.address,
                v.city,
                v.zip_code as zipCode,
                v.precinct_number as precinctNumber,
                v.date_of_birth as dateOfBirth,
                CAST((julianday('now') - julianday(v.date_of_birth)) / 365.25 AS INTEGER) as age,
                v.latitude,
                v.longitude,
                CASE WHEN v.latitude IS NOT NULL AND v.longitude IS NOT NULL THEN 1 ELSE 0 END as isGeocoded,
                p.name as precinctName
            FROM voters v
            LEFT JOIN precincts p ON v.precinct_number = p.precinct_number
            ${whereClause}
            ORDER BY ${orderByClause}
            ${exportFormat !== 'csv' ? `LIMIT ? OFFSET ?` : ''}
        `;

        const dataParams = exportFormat !== 'csv' 
            ? [...params, limit, offset]
            : params;

        const voters = await database.all(dataQuery, dataParams);

        // Handle CSV export
        if (exportFormat === 'csv') {
            const csvRows = [];
            
            // CSV header
            csvRows.push([
                'Voter ID',
                'Last Name',
                'First Name',
                'Age',
                'Address',
                'City',
                'Zip Code',
                'Precinct',
                'Precinct Name',
                'Latitude',
                'Longitude',
                'Geocoded'
            ].join(','));

            // CSV data rows
            voters.forEach(voter => {
                csvRows.push([
                    voter.voterId || '',
                    `"${(voter.lastName || '').replace(/"/g, '""')}"`,
                    `"${(voter.firstName || '').replace(/"/g, '""')}"`,
                    voter.age || '',
                    `"${(voter.address || '').replace(/"/g, '""')}"`,
                    `"${(voter.city || '').replace(/"/g, '""')}"`,
                    voter.zipCode || '',
                    voter.precinctNumber || '',
                    `"${(voter.precinctName || '').replace(/"/g, '""')}"`,
                    voter.latitude || '',
                    voter.longitude || '',
                    voter.isGeocoded ? 'Yes' : 'No'
                ].join(','));
            });

            const csvContent = csvRows.join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="never-voted-voters-${Date.now()}.csv"`);
            return res.send(csvContent);
        }

        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / limit);
        const currentPage = Math.floor(offset / limit) + 1;

        // Return JSON response
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: voters,
            pagination: {
                total: totalCount,
                limit: limit,
                offset: offset,
                currentPage: currentPage,
                totalPages: totalPages
            },
            filters: {
                precinct: precincts,
                city: cities,
                ageMin: ageMin,
                ageMax: ageMax,
                geocoded: geocoded,
                search: search,
                sort: sort,
                order: order
            }
        });
        
    } catch (error) {
        console.error('Error fetching never-voted voters:', error);
        next(error);
    }
});

module.exports = router;
