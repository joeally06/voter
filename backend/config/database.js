const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const log = require('../utils/logger');

/**
 * Database configuration and connection management
 */

/**
 * Find project root by searching for package.json
 * This enables the server to run from any subdirectory (backend/, scripts/, etc.)
 * @param {string} startPath - Starting directory for search (defaults to __dirname)
 * @returns {string} Absolute path to project root
 * @throws {Error} If package.json not found (not in Voter project)
 */
function findProjectRoot(startPath = __dirname) {
    let currentPath = startPath;
    const rootPath = path.parse(currentPath).root;
    
    while (currentPath !== rootPath) {
        if (fs.existsSync(path.join(currentPath, 'package.json'))) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    
    throw new Error(
        'Could not find project root (package.json not found). ' +
        'Ensure server is run from the Voter project directory.'
    );
}

class Database {
    constructor() {
        // IMPROVED: Use project root for absolute path resolution
        // Supports running from any subdirectory (backend/, scripts/, etc.)
        const projectRoot = findProjectRoot();
        
        // Get database path from environment or use default
        let dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'voter_platform.db');
        
        // CRITICAL: Convert relative paths to absolute using project root
        // This ensures DB_PATH=./data/voter_platform.db works correctly regardless of CWD
        if (!path.isAbsolute(dbPath)) {
            dbPath = path.join(projectRoot, dbPath);
        }
        
        this.dbPath = dbPath;
        this.db = null;
        this.isConnected = false;
        
        // VALIDATION: Log resolved path for debugging
        console.log(`📂 Database path: ${this.dbPath}`);
    }

    /**
     * Initialize database connection
     * Idempotent: returns immediately if already connected
     */
    async connect() {
        // Idempotent: if already connected, skip re-connection
        if (this.isConnected && this.db) {
            return this;
        }

        return new Promise((resolve, reject) => {
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            this.db = new sqlite3.Database(this.dbPath, async (err) => {
                if (err) {
                    console.error('Database connection failed:', err.message);
                    reject(err);
                } else {
                    log.info('Connected to SQLite database');
                    this.isConnected = true;
                    
                    // Enable foreign keys
                    this.db.run('PRAGMA foreign_keys = ON');
                    
                    // VALIDATION: Validate schema exists
                    try {
                        const tables = await this.all(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        );
                        const requiredTables = ['voters', 'precincts', 'election_history'];
                        const existingTables = tables.map(t => t.name);
                        const missingTables = requiredTables.filter(t => !existingTables.includes(t));
                        
                        if (missingTables.length > 0) {
                            console.error('❌ DATABASE SCHEMA ERROR: Missing required tables:', missingTables);
                            console.error('🔧 Run setup script to initialize database:');
                            console.error('   npm run setup');
                            reject(new Error(`Missing tables: ${missingTables.join(', ')}`));
                            return;
                        }
                        
                        log.info(`Database schema validated (${existingTables.length} tables)`);

                        // Apply pending migrations (idempotent — safe to run on every startup)
                        try {
                            await require('../migrations/010_add_election_cycles').up(this);
                        } catch (migrationErr) {
                            console.warn('⚠️  Migration 010 warning:', migrationErr.message);
                        }
                    } catch (validationError) {
                        console.error('❌ Schema validation failed:', validationError);
                        reject(validationError);
                        return;
                    }
                    
                    resolve(this);
                }
            });
        });
    }

    /**
     * Guard: throws if database is not connected
     * @private
     */
    _ensureConnected() {
        if (!this.db || !this.isConnected) {
            throw new Error(
                'Database not connected. Call await database.connect() before executing queries.'
            );
        }
    }

    /**
     * Execute a single SQL query
     * @param {string} sql - SQL query
     * @param {array} params - Query parameters
     */
    run(sql, params = []) {
        this._ensureConnected();
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    // Return both id and lastID for compatibility
                    resolve({ id: this.lastID, lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    /**
     * Get a single row
     * @param {string} sql - SQL query
     * @param {array} params - Query parameters
     */
    get(sql, params = []) {
        this._ensureConnected();
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    /**
     * Get multiple rows
     * @param {string} sql - SQL query
     * @param {array} params - Query parameters
     */
    all(sql, params = []) {
        this._ensureConnected();
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Execute operations in a database transaction
     * Supports both callback-based and statement array-based transactions
     * @param {Function|Array} callbackOrStatements - Async callback function or array of {sql, params} objects
     * @returns {Promise} Resolves with callback result or statement results, rejects on error with automatic rollback
     */
    async transaction(callbackOrStatements) {
        this._ensureConnected();

        // Check if callback function was passed
        if (typeof callbackOrStatements === 'function') {
            const callback = callbackOrStatements;
            
            // Begin transaction
            await this.run('BEGIN TRANSACTION');
            
            try {
                // Execute the callback function
                const result = await callback();
                
                // Commit transaction if callback succeeded
                await this.run('COMMIT');
                return result;
                
            } catch (error) {
                // Callback threw error, rollback transaction
                try {
                    await this.run('ROLLBACK');
                } catch (rollbackErr) {
                    console.error('Rollback failed:', rollbackErr);
                }
                throw error;
            }
        }
        
        // Legacy support: array of statements
        const statements = callbackOrStatements;
        return new Promise((resolve, reject) => {
            // Capture db reference to avoid 'this' context loss in SQLite callbacks
            // Inside function(err) callbacks, 'this' refers to SQLite statement result
            // (provides .lastID and .changes), NOT the Database wrapper instance
            const db = this.db;
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                const results = [];
                let hasError = false;

                statements.forEach((stmt, index) => {
                    if (hasError) return;

                    db.run(stmt.sql, stmt.params || [], function(err) {
                        if (err) {
                            hasError = true;
                            db.run('ROLLBACK');
                            reject(err);
                        } else {
                            results.push({ index, id: this.lastID, changes: this.changes });
                            
                            if (results.length === statements.length) {
                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(results);
                                    }
                                });
                            }
                        }
                    });
                });
            });
        });
    }

    /**
     * Get database statistics
     * Returns comprehensive statistics including voter counts, geocoding progress, and super voters
     */
    async getStats() {
        try {
            // Helper: safely run a COUNT query, returning defaultVal if table is missing
            const safeCount = async (query, defaultVal = 0) => {
                try {
                    const result = await this.get(query);
                    return result ? Object.values(result)[0] : defaultVal;
                } catch (e) {
                    console.warn(`Stats query failed: ${e.message}`);
                    return defaultVal;
                }
            };

            const totalVoters = await safeCount('SELECT COUNT(*) as count FROM voters');
            const geocodedVoters = await safeCount('SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL');
            const totalPrecincts = await safeCount('SELECT COUNT(*) as count FROM precincts');
            const cacheSize = await safeCount('SELECT COUNT(*) as count FROM geocoding_cache');
            const superVoters = await safeCount('SELECT COUNT(*) as count FROM voters WHERE super_voter = 1');

            return {
                totalVoters,
                geocodedVoters,
                totalPrecincts,
                superVoters,
                cacheSize,
                geocodingProgress: totalVoters > 0 ? (geocodedVoters / totalVoters * 100).toFixed(1) : 0
            };
        } catch (error) {
            console.error('Error getting database stats:', error);
            return null;
        }
    }

    /**
     * Close database connection
     */
    close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err.message);
                    } else {
                        console.log('Database connection closed');
                    }
                    this.isConnected = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Create backup of database
     */
    async backup() {
        const backupDir = process.env.DB_BACKUP_PATH || path.join(__dirname, '../../data/backups');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `voter_platform_${timestamp}.db`);

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            fs.copyFile(this.dbPath, backupPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`Database backup created: ${backupPath}`);
                    resolve(backupPath);
                }
            });
        });
    }

    /**
     * Optimize database performance
     */
    async optimize() {
        try {
            await this.run('VACUUM');
            await this.run('ANALYZE');
            console.log('Database optimized');
        } catch (error) {
            console.error('Error optimizing database:', error);
        }
    }
}

// Singleton instance
const database = new Database();

// Graceful shutdown
process.on('SIGINT', async () => {
    log.info('Shutting down database connection...');
    await database.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await database.close();
    process.exit(0);
});

module.exports = database;