/**
 * Migration 010: Add Election Cycle Archive Support
 *
 * - Creates election_cycles table (named cycle registry)
 * - Creates cycle_analytics_snapshots table (frozen analytics per cycle)
 * - Adds nullable cycle_id FK to: election_history, saved_routes, import_logs
 *
 * All new columns are nullable — existing data requires no backfill.
 * All existing rows implicitly belong to the "current unarchived" state (NULL cycle_id).
 * This migration is idempotent: CREATE TABLE IF NOT EXISTS and ALTER TABLE errors
 * for "duplicate column name" are silently ignored on re-runs.
 */

exports.up = async function(db) {
    console.log('Running migration 010: Add election cycle archive support...');

    // 1. Create election_cycles table
    await db.run(`
        CREATE TABLE IF NOT EXISTS election_cycles (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            name                    TEXT NOT NULL,
            description             TEXT,
            election_date           TEXT,
            cycle_type              TEXT DEFAULT 'general',
            status                  TEXT DEFAULT 'active',
            archived_at             DATETIME,
            archived_by             TEXT,
            voters_count            INTEGER DEFAULT 0,
            super_voters_count      INTEGER DEFAULT 0,
            total_election_records  INTEGER DEFAULT 0,
            routes_count            INTEGER DEFAULT 0,
            import_count            INTEGER DEFAULT 0,
            export_path             TEXT,
            notes                   TEXT,
            deleted_at              DATETIME,
            created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.run(`
        CREATE INDEX IF NOT EXISTS idx_election_cycles_status
            ON election_cycles(status)
    `);

    await db.run(`
        CREATE INDEX IF NOT EXISTS idx_election_cycles_date
            ON election_cycles(election_date)
    `);

    console.log('✅ Migration 010: Created table election_cycles');

    // 2. Create cycle_analytics_snapshots table
    await db.run(`
        CREATE TABLE IF NOT EXISTS cycle_analytics_snapshots (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_id                INTEGER NOT NULL UNIQUE,
            total_voters            INTEGER DEFAULT 0,
            super_voters            INTEGER DEFAULT 0,
            geocoded_voters         INTEGER DEFAULT 0,
            never_voted_count       INTEGER DEFAULT 0,
            total_precincts         INTEGER DEFAULT 0,
            election_codes          TEXT,
            overall_turnout_rate    REAL,
            early_vote_rate         REAL,
            republican_count        INTEGER DEFAULT 0,
            democrat_count          INTEGER DEFAULT 0,
            independent_count       INTEGER DEFAULT 0,
            turnout_by_precinct     TEXT,
            party_by_precinct       TEXT,
            super_voter_by_precinct TEXT,
            age_distribution        TEXT,
            created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (cycle_id) REFERENCES election_cycles(id) ON DELETE CASCADE
        )
    `);

    console.log('✅ Migration 010: Created table cycle_analytics_snapshots');

    // 3–5. Add cycle_id to existing tables.
    // ALTER TABLE ADD COLUMN fails with "duplicate column name" if already applied;
    // catch and ignore that specific error to make this migration idempotent.
    const alterStmts = [
        {
            sql: `ALTER TABLE election_history ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id)`,
            idx: `CREATE INDEX IF NOT EXISTS idx_election_history_cycle ON election_history(cycle_id)`,
            label: 'election_history.cycle_id'
        },
        {
            sql: `ALTER TABLE saved_routes ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id)`,
            idx: `CREATE INDEX IF NOT EXISTS idx_saved_routes_cycle ON saved_routes(cycle_id)`,
            label: 'saved_routes.cycle_id'
        },
        {
            sql: `ALTER TABLE import_logs ADD COLUMN cycle_id INTEGER REFERENCES election_cycles(id)`,
            idx: `CREATE INDEX IF NOT EXISTS idx_import_logs_cycle ON import_logs(cycle_id)`,
            label: 'import_logs.cycle_id'
        }
    ];

    for (const stmt of alterStmts) {
        try {
            await db.run(stmt.sql);
            await db.run(stmt.idx);
            console.log(`✅ Migration 010: Added column ${stmt.label}`);
        } catch (err) {
            if (err.message && err.message.toLowerCase().includes('duplicate column name')) {
                console.log(`⚠️  Migration 010: Column already exists (skipping): ${stmt.label}`);
            } else {
                throw err;
            }
        }
    }

    console.log('✅ Migration 010 completed successfully');
};

exports.down = async function(db) {
    // SQLite does not support DROP COLUMN before version 3.35.0.
    // Drop the new tables; cycle_id columns in existing tables cannot be removed.
    await db.run(`DROP TABLE IF EXISTS cycle_analytics_snapshots`);
    await db.run(`DROP TABLE IF EXISTS election_cycles`);
    console.log('✅ Migration 010 down: election_cycles and cycle_analytics_snapshots dropped');
    console.log('⚠️  Migration 010 down: cycle_id columns in election_history/saved_routes/import_logs cannot be removed in older SQLite versions');
};

// Allow running standalone: node backend/migrations/010_add_election_cycles.js
if (require.main === module) {
    const database = require('../config/database');
    database.connect()
        .then(() => exports.up(database))
        .then(() => {
            console.log('Migration complete.');
            process.exit(0);
        })
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        });
}
