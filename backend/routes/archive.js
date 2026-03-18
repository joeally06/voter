/**
 * Archive Routes
 * Manages election cycle archives — list, create, rollover, export, and soft-delete cycles.
 *
 * Mounted at: /api/archive
 *
 * Endpoints:
 *   GET    /api/archive/cycles            — list all cycles
 *   POST   /api/archive/cycles            — create a new (upcoming) cycle
 *   GET    /api/archive/cycles/:id        — get cycle details + analytics snapshot
 *   GET    /api/archive/cycles/:id/export — download cycle data as JSON
 *   POST   /api/archive/cycles/:id/rollover — archive all current untagged records
 *   DELETE /api/archive/cycles/:id        — soft-delete a cycle
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const database = require('../config/database');

/**
 * Validation middleware — returns 400 with detail array on failure
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array(),
            timestamp: new Date().toISOString()
        });
    }
    next();
};

// In-memory lock — prevents concurrent archive/rollover operations
let archiveInProgress = false;

// ── GET /api/archive/current-status ──────────────────────────────────────────

/**
 * Return counts of current (unarchived) records.
 * Used by the Archive page to show what will be included in the next rollover.
 */
router.get('/current-status', async (req, res, next) => {
    try {
        const [ehRow, srRow, ilRow] = await Promise.all([
            database.get('SELECT COUNT(*) as cnt FROM election_history WHERE cycle_id IS NULL'),
            database.get('SELECT COUNT(*) as cnt FROM saved_routes WHERE cycle_id IS NULL'),
            database.get('SELECT COUNT(*) as cnt FROM import_logs WHERE cycle_id IS NULL')
        ]);

        res.json({
            success: true,
            data: {
                election_history_count: ehRow ? ehRow.cnt : 0,
                saved_routes_count: srRow ? srRow.cnt : 0,
                import_logs_count: ilRow ? ilRow.cnt : 0
            }
        });
    } catch (err) {
        next(err);
    }
});

// ── GET /api/archive/cycles ───────────────────────────────────────────────────

/**
 * List all election cycles.
 * Query: status (active|archived|deleted), limit (1–100), offset (≥0)
 */
router.get('/cycles', [
    query('status')
        .optional()
        .isIn(['active', 'archived', 'deleted'])
        .withMessage('status must be active, archived, or deleted'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('limit must be 1–100'),
    query('offset')
        .optional()
        .isInt({ min: 0 })
        .withMessage('offset must be >= 0'),
    validate
], async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const statusFilter = req.query.status;

        let whereClause = "WHERE status != 'deleted'";
        const params = [];

        if (statusFilter) {
            whereClause = 'WHERE status = ?';
            params.push(statusFilter);
        }

        const [cycles, countRow] = await Promise.all([
            database.all(
                `SELECT * FROM election_cycles ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            ),
            database.get(
                `SELECT COUNT(*) as total FROM election_cycles ${whereClause}`,
                params
            )
        ]);

        res.json({
            success: true,
            total: countRow ? countRow.total : 0,
            data: cycles
        });
    } catch (err) {
        next(err);
    }
});

// ── POST /api/archive/cycles ──────────────────────────────────────────────────

/**
 * Create a new (upcoming) election cycle.
 * Body: name (required), description, election_date, cycle_type, notes
 */
router.post('/cycles', [
    body('name')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('name is required and must be 1–100 characters'),
    body('description')
        .optional()
        .isString()
        .isLength({ max: 500 })
        .withMessage('description must be ≤ 500 characters'),
    body('election_date')
        .optional()
        .isISO8601()
        .withMessage('election_date must be a valid ISO-8601 date (YYYY-MM-DD)'),
    body('cycle_type')
        .optional()
        .isIn(['primary', 'general', 'runoff', 'special', 'other'])
        .withMessage('cycle_type must be primary, general, runoff, special, or other'),
    body('notes')
        .optional()
        .isString()
        .isLength({ max: 1000 })
        .withMessage('notes must be ≤ 1000 characters'),
    validate
], async (req, res, next) => {
    try {
        const {
            name,
            description,
            election_date,
            cycle_type = 'general',
            notes
        } = req.body;

        const result = await database.run(
            `INSERT INTO election_cycles
                (name, description, election_date, cycle_type, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                name.trim(),
                description || null,
                election_date || null,
                cycle_type,
                notes || null
            ]
        );

        const cycle = await database.get(
            'SELECT * FROM election_cycles WHERE id = ?',
            [result.lastID]
        );

        res.status(201).json({ success: true, data: cycle });
    } catch (err) {
        next(err);
    }
});

// ── GET /api/archive/cycles/:id/export ───────────────────────────────────────
// NOTE: Must be registered BEFORE /cycles/:id to avoid ":id" matching "export"

/**
 * Export cycle data as a downloadable JSON file.
 * Includes cycle metadata, analytics snapshot, election history, routes, import logs.
 */
router.get('/cycles/:id/export', [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    validate
], async (req, res, next) => {
    try {
        const cycleId = parseInt(req.params.id);

        const cycle = await database.get(
            'SELECT * FROM election_cycles WHERE id = ?',
            [cycleId]
        );

        if (!cycle) {
            return res.status(404).json({
                success: false,
                error: 'Cycle not found',
                timestamp: new Date().toISOString()
            });
        }

        const [snapshot, electionHistory, savedRoutes, importLogs] = await Promise.all([
            database.get(
                'SELECT * FROM cycle_analytics_snapshots WHERE cycle_id = ?',
                [cycleId]
            ),
            database.all(
                'SELECT * FROM election_history WHERE cycle_id = ? LIMIT 100000',
                [cycleId]
            ),
            database.all(
                'SELECT id, route_name, travel_mode, created_at, access_count FROM saved_routes WHERE cycle_id = ?',
                [cycleId]
            ),
            database.all(
                'SELECT * FROM import_logs WHERE cycle_id = ?',
                [cycleId]
            )
        ]);

        // Parse stored JSON fields in snapshot for readable export
        if (snapshot) {
            ['election_codes', 'turnout_by_precinct', 'party_by_precinct',
             'super_voter_by_precinct', 'age_distribution'].forEach(field => {
                if (snapshot[field]) {
                    try { snapshot[field] = JSON.parse(snapshot[field]); } catch (_) {}
                }
            });
        }

        const exportPayload = {
            metadata: {
                cycle,
                exported_at: new Date().toISOString(),
                format_version: '1.0'
            },
            analytics_snapshot: snapshot || null,
            election_history: electionHistory,
            saved_routes: savedRoutes,
            import_logs: importLogs
        };

        // Build a safe filename: only alphanumeric, hyphens, underscores
        const safeName = `cycle_${cycle.id}_${(cycle.name || 'export')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .substring(0, 50)
            .replace(/_+$/, '')}`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
        res.json(exportPayload);
    } catch (err) {
        next(err);
    }
});

// ── GET /api/archive/cycles/:id ───────────────────────────────────────────────

/**
 * Get a single cycle's details plus its frozen analytics snapshot.
 */
router.get('/cycles/:id', [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    validate
], async (req, res, next) => {
    try {
        const cycleId = parseInt(req.params.id);

        const cycle = await database.get(
            "SELECT * FROM election_cycles WHERE id = ? AND status != 'deleted'",
            [cycleId]
        );

        if (!cycle) {
            return res.status(404).json({
                success: false,
                error: 'Cycle not found',
                timestamp: new Date().toISOString()
            });
        }

        const snapshot = await database.get(
            'SELECT * FROM cycle_analytics_snapshots WHERE cycle_id = ?',
            [cycleId]
        );

        if (snapshot) {
            ['election_codes', 'turnout_by_precinct', 'party_by_precinct',
             'super_voter_by_precinct', 'age_distribution'].forEach(field => {
                if (snapshot[field]) {
                    try { snapshot[field] = JSON.parse(snapshot[field]); } catch (_) {}
                }
            });
        }

        res.json({
            success: true,
            data: { cycle, analyticsSnapshot: snapshot || null }
        });
    } catch (err) {
        next(err);
    }
});

// ── POST /api/archive/cycles/:id/rollover ─────────────────────────────────────

/**
 * Rollover: archive all current untagged election records under this cycle.
 *
 * Runs inside a single SQLite transaction:
 *   1. Tags election_history/saved_routes/import_logs (WHERE cycle_id IS NULL)
 *   2. Captures analytics snapshot
 *   3. Sets cycle status to 'archived' with counts
 *
 * Idempotent: rows already tagged are not re-tagged on a second call.
 */
router.post('/cycles/:id/rollover', [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    validate
], async (req, res, next) => {
    if (archiveInProgress) {
        return res.status(409).json({
            success: false,
            error: 'Archive already in progress — only one archive operation at a time',
            timestamp: new Date().toISOString()
        });
    }

    archiveInProgress = true;

    try {
        const cycleId = parseInt(req.params.id);

        const cycle = await database.get(
            "SELECT * FROM election_cycles WHERE id = ? AND status != 'deleted'",
            [cycleId]
        );

        if (!cycle) {
            archiveInProgress = false;
            return res.status(404).json({
                success: false,
                error: 'Cycle not found',
                timestamp: new Date().toISOString()
            });
        }

        if (cycle.status === 'archived') {
            archiveInProgress = false;
            return res.status(409).json({
                success: false,
                error: 'Cycle is already archived',
                timestamp: new Date().toISOString()
            });
        }

        // Collect pre-archive counts and analytics data (before the transaction)
        const [
            ehRow, srRow, ilRow,
            totalVotersRow, superVotersRow, geocodedRow,
            neverVotedRow, precinctsRow, electionCodesRows,
            turnoutRow, earlyVoteRow
        ] = await Promise.all([
            database.get('SELECT COUNT(*) as cnt FROM election_history WHERE cycle_id IS NULL'),
            database.get('SELECT COUNT(*) as cnt FROM saved_routes WHERE cycle_id IS NULL'),
            database.get('SELECT COUNT(*) as cnt FROM import_logs WHERE cycle_id IS NULL'),
            database.get('SELECT COUNT(*) as cnt FROM voters'),
            database.get('SELECT COUNT(*) as cnt FROM voters WHERE super_voter = 1'),
            database.get('SELECT COUNT(*) as cnt FROM voters WHERE latitude IS NOT NULL'),
            database.get(`
                SELECT COUNT(*) as cnt FROM voters v
                WHERE NOT EXISTS (
                    SELECT 1 FROM election_history eh
                    WHERE eh.voter_id = v.voter_id
                      AND eh.voted = 1
                      AND eh.cycle_id IS NULL
                )
            `),
            database.get('SELECT COUNT(*) as cnt FROM precincts'),
            database.all(
                'SELECT DISTINCT election_code FROM election_history WHERE cycle_id IS NULL ORDER BY election_code'
            ),
            database.get(
                'SELECT COUNT(*) as voted FROM election_history WHERE cycle_id IS NULL AND voted = 1'
            ),
            database.get(
                'SELECT COUNT(*) as cnt FROM election_history WHERE cycle_id IS NULL AND early_voted = 1'
            )
        ]);

        const partyCounts = await database.all(
            `SELECT party_code, COUNT(*) as cnt
             FROM election_history
             WHERE cycle_id IS NULL AND party_code IS NOT NULL
             GROUP BY party_code`
        );

        let rCount = 0, dCount = 0, iCount = 0;
        partyCounts.forEach(p => {
            if (p.party_code === 'R') rCount += p.cnt;
            else if (p.party_code === 'D') dCount += p.cnt;
            else iCount += p.cnt;
        });

        const totalEh = ehRow.cnt || 0;
        const overallTurnout = totalEh > 0 ? turnoutRow.voted / totalEh : 0;
        const earlyVoteRate = totalEh > 0 ? earlyVoteRow.cnt / totalEh : 0;

        const electionCodesJson = JSON.stringify(
            electionCodesRows.map(e => e.election_code)
        );

        // Run the full archive in a single transaction
        await database.transaction(async () => {
            // Tag all currently unarchived records
            await database.run(
                'UPDATE election_history SET cycle_id = ? WHERE cycle_id IS NULL',
                [cycleId]
            );
            await database.run(
                'UPDATE saved_routes SET cycle_id = ? WHERE cycle_id IS NULL',
                [cycleId]
            );
            await database.run(
                'UPDATE import_logs SET cycle_id = ? WHERE cycle_id IS NULL',
                [cycleId]
            );

            // Upsert analytics snapshot (idempotent on re-run)
            await database.run(
                `INSERT OR REPLACE INTO cycle_analytics_snapshots
                    (cycle_id, total_voters, super_voters, geocoded_voters, never_voted_count,
                     total_precincts, election_codes, overall_turnout_rate, early_vote_rate,
                     republican_count, democrat_count, independent_count, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                    cycleId,
                    totalVotersRow.cnt,
                    superVotersRow.cnt,
                    geocodedRow.cnt,
                    neverVotedRow.cnt,
                    precinctsRow.cnt,
                    electionCodesJson,
                    overallTurnout,
                    earlyVoteRate,
                    rCount,
                    dCount,
                    iCount
                ]
            );

            // Finalize the cycle record
            await database.run(
                `UPDATE election_cycles
                 SET status = 'archived',
                     archived_at = CURRENT_TIMESTAMP,
                     voters_count = ?,
                     super_voters_count = ?,
                     total_election_records = ?,
                     routes_count = ?,
                     import_count = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    totalVotersRow.cnt,
                    superVotersRow.cnt,
                    ehRow.cnt,
                    srRow.cnt,
                    ilRow.cnt,
                    cycleId
                ]
            );
        });

        const updatedCycle = await database.get(
            'SELECT * FROM election_cycles WHERE id = ?',
            [cycleId]
        );

        archiveInProgress = false;

        res.json({
            success: true,
            message: 'Archive completed successfully',
            data: {
                cycle: updatedCycle,
                archived: {
                    election_history_rows: ehRow.cnt,
                    saved_routes: srRow.cnt,
                    import_logs: ilRow.cnt
                }
            }
        });
    } catch (err) {
        archiveInProgress = false;
        next(err);
    }
});

// ── DELETE /api/archive/cycles/:id ───────────────────────────────────────────

/**
 * Soft-delete a cycle (sets status='deleted', deleted_at=NOW()).
 * Election history rows tagged with this cycle_id are preserved.
 *
 * Body: { confirm: "<cycle name>" } — must match cycle name (case-insensitive)
 */
router.delete('/cycles/:id', [
    param('id').isInt({ min: 1 }).withMessage('id must be a positive integer'),
    body('confirm').isString().withMessage('confirm field is required'),
    validate
], async (req, res, next) => {
    try {
        const cycleId = parseInt(req.params.id);

        const cycle = await database.get(
            "SELECT * FROM election_cycles WHERE id = ? AND status != 'deleted'",
            [cycleId]
        );

        if (!cycle) {
            return res.status(404).json({
                success: false,
                error: 'Cycle not found',
                timestamp: new Date().toISOString()
            });
        }

        // Require typed confirmation matching the cycle name
        const confirmText = (req.body.confirm || '').trim().toLowerCase();
        const cycleName = (cycle.name || '').trim().toLowerCase();

        if (confirmText !== cycleName) {
            return res.status(400).json({
                success: false,
                error: 'Confirmation text does not match the cycle name',
                timestamp: new Date().toISOString()
            });
        }

        await database.run(
            `UPDATE election_cycles
             SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [cycleId]
        );

        res.json({
            success: true,
            message: 'Cycle soft-deleted. Election history records are preserved.'
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
