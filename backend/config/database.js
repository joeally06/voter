const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * Database configuration and connection management
 */

class Database {
    constructor() {
        this.dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/voter_platform.db');
        this.db = null;
        this.isConnected = false;
    }

    /**
     * Initialize database connection
     */
    async connect() {
        return new Promise((resolve, reject) => {
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Database connection failed:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Connected to SQLite database');
                    this.isConnected = true;
                    
                    // Enable foreign keys
                    this.db.run('PRAGMA foreign_keys = ON');
                    
                    resolve();
                }
            });
        });
    }

    /**
     * Execute a single SQL query
     * @param {string} sql - SQL query
     * @param {array} params - Query parameters
     */
    run(sql, params = []) {
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
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                
                const results = [];
                let hasError = false;

                statements.forEach((stmt, index) => {
                    if (hasError) return;

                    this.db.run(stmt.sql, stmt.params || [], function(err) {
                        if (err) {
                            hasError = true;
                            this.db.run('ROLLBACK');
                            reject(err);
                        } else {
                            results.push({ index, id: this.lastID, changes: this.changes });
                            
                            if (results.length === statements.length) {
                                this.db.run('COMMIT', (err) => {
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
            const voterCount = await this.get('SELECT COUNT(*) as count FROM voters');
            const geocodedCount = await this.get('SELECT COUNT(*) as count FROM voters WHERE latitude IS NOT NULL');
            const precinctCount = await this.get('SELECT COUNT(*) as count FROM precincts');
            const cacheSize = await this.get('SELECT COUNT(*) as count FROM geocoding_cache');
            // CRITICAL FIX: Added super_voter count query as required by frontend health status
            const superVoterCount = await this.get('SELECT COUNT(*) as count FROM voters WHERE super_voter = 1');

            return {
                totalVoters: voterCount.count,
                geocodedVoters: geocodedCount.count,
                totalPrecincts: precinctCount.count,
                superVoters: superVoterCount.count,  // CRITICAL FIX: Added missing field
                cacheSize: cacheSize.count,
                geocodingProgress: voterCount.count > 0 ? (geocodedCount.count / voterCount.count * 100).toFixed(1) : 0
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
    console.log('\n⏹️  Shutting down database connection...');
    await database.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await database.close();
    process.exit(0);
});

module.exports = database;