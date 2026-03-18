/**
 * Mailer Export Routes
 * Provides endpoints for generating mailing label data
 *
 * GET /api/mailer/count   - Returns count of voters matching filters
 * GET /api/mailer/export  - Returns CSV mail merge file
 * GET /api/mailer/voters  - Returns voter data (JSON) for PDF generation
 */

const express = require('express');
const router = express.Router();
const { query, validationResult } = require('express-validator');
const { createObjectCsvStringifier } = require('csv-writer');
const database = require('../config/database');

// ============================================================================
// VALIDATION MIDDLEWARE
// ============================================================================

/**
 * Standard validation result handler — returns 400 on validation failure
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
 * Shared filter validators for all mailer endpoints
 */
const filterValidators = [
    query('precinct')
        .optional()
        .isString()
        .trim()
        .isLength({ max: 3 })
        .withMessage('Precinct must be max 3 characters'),
    query('party')
        .optional()
        .isString()
        .trim()
        .matches(/^(R|D|R,D|D,R)$/)
        .withMessage('Party must be R, D, or R,D'),
    query('super_voter')
        .optional()
        .isBoolean()
        .withMessage('super_voter must be true or false'),
    query('city')
        .optional()
        .isString()
        .trim()
        .isLength({ max: 100 })
        .withMessage('City must be max 100 characters'),
    query('zip_code')
        .optional()
        .isString()
        .trim()
        .isLength({ max: 10 })
        .withMessage('ZIP code must be max 10 characters'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 5000 })
        .withMessage('Limit must be between 1 and 5000'),
    validate,
];

// ============================================================================
// FILTER BUILDER
// ============================================================================

/**
 * Build SQL WHERE clause and params array from mailer filter query params.
 * All user-supplied values go through parameterized placeholders — never interpolated.
 *
 * @param {Object} query - req.query (already validated)
 * @returns {{ whereClause: string, params: any[] }}
 */
function buildFilters(query) {
    const conditions = [];
    const params = [];

    if (query.precinct) {
        conditions.push('v.precinct_number = ?');
        params.push(query.precinct.toString().padStart(2, '0'));
    }

    if (query.super_voter !== undefined && query.super_voter !== '') {
        conditions.push('v.super_voter = ?');
        params.push(query.super_voter === true || query.super_voter === 'true' ? 1 : 0);
    }

    if (query.city) {
        conditions.push('v.city LIKE ?');
        params.push(`%${query.city}%`);
    }

    if (query.zip_code) {
        conditions.push('v.zip_code = ?');
        params.push(query.zip_code);
    }

    if (query.party) {
        const parties = query.party.split(',').map(p => p.trim().toUpperCase()).filter(p => ['R', 'D'].includes(p));
        if (parties.length === 1) {
            // Single party: use subquery against election_history
            conditions.push(`
                v.voter_id IN (
                    SELECT DISTINCT voter_id
                    FROM election_history
                    WHERE party_code = ?
                      AND cycle_id IS NULL
                )
            `);
            params.push(parties[0]);
        } else if (parties.length > 1) {
            const placeholders = parties.map(() => '?').join(', ');
            conditions.push(`
                v.voter_id IN (
                    SELECT DISTINCT voter_id
                    FROM election_history
                    WHERE party_code IN (${placeholders})
                      AND cycle_id IS NULL
                )
            `);
            params.push(...parties);
        }
    }

    const whereClause = conditions.length > 0
        ? 'WHERE ' + conditions.join(' AND ')
        : '';

    return { whereClause, params };
}

// ============================================================================
// ENDPOINT: GET /api/mailer/count
// ============================================================================

router.get('/count', filterValidators, async (req, res, next) => {
    try {
        const { whereClause, params } = buildFilters(req.query);

        const sql = `
            SELECT COUNT(*) AS count
            FROM voters v
            ${whereClause}
        `;

        const row = await database.get(sql, params);

        res.json({
            success: true,
            count: row ? row.count : 0,
        });
    } catch (err) {
        next(err);
    }
});

// ============================================================================
// ENDPOINT: GET /api/mailer/export  (CSV mail merge)
// ============================================================================

router.get(
    '/export',
    [
        ...filterValidators,
        query('format')
            .optional()
            .isIn(['csv'])
            .withMessage('format must be csv'),
    ],
    async (req, res, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 5000);
            const { whereClause, params } = buildFilters(req.query);

            const sql = `
                SELECT
                    v.first_name  AS FirstName,
                    v.last_name   AS LastName,
                    v.address     AS Address,
                    v.city        AS City,
                    v.state       AS State,
                    v.zip_code    AS ZipCode
                FROM voters v
                ${whereClause}
                ORDER BY v.last_name ASC, v.first_name ASC
                LIMIT ?
            `;

            const rows = await database.all(sql, [...params, limit]);

            const csvStringifier = createObjectCsvStringifier({
                header: [
                    { id: 'FirstName', title: 'FirstName' },
                    { id: 'LastName',  title: 'LastName'  },
                    { id: 'Address',   title: 'Address'   },
                    { id: 'City',      title: 'City'      },
                    { id: 'State',     title: 'State'     },
                    { id: 'ZipCode',   title: 'ZipCode'   },
                ],
            });

            const csvString =
                csvStringifier.getHeaderString() +
                csvStringifier.stringifyRecords(rows);

            const dateStr = new Date().toISOString().split('T')[0];

            res.set({
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="mailer-export-${dateStr}.csv"`,
            });

            // UTF-8 BOM for Excel compatibility
            res.send('\uFEFF' + csvString);
        } catch (err) {
            next(err);
        }
    }
);

// ============================================================================
// ENDPOINT: GET /api/mailer/voters  (JSON data for frontend PDF generation)
// ============================================================================

router.get('/voters', filterValidators, async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 5000);
        const { whereClause, params } = buildFilters(req.query);

        const sql = `
            SELECT
                v.first_name  AS firstName,
                v.last_name   AS lastName,
                v.address,
                v.city,
                v.state,
                v.zip_code    AS zipCode
            FROM voters v
            ${whereClause}
            ORDER BY v.last_name ASC, v.first_name ASC
            LIMIT ?
        `;

        const rows = await database.all(sql, [...params, limit]);

        res.json({
            success: true,
            count: rows.length,
            data: rows,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
