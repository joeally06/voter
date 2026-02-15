/**
 * Integration Tests for Complete Import Workflow
 * Tests end-to-end import process from file upload to database storage
 */

const { processImport, getImportErrors } = require('../../backend/services/import-processor');
const VoterModel = require('../../backend/models/voter');
const database = require('../../backend/config/database');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Import Flow Integration', () => {
    let testDbPath;
    let testDir;
    let voterModel;

    beforeAll(async () => {
        // Create temporary test database
        testDbPath = path.join(os.tmpdir(), `test-import-${Date.now()}.db`);
        process.env.DB_PATH = testDbPath;

        // Create test files directory
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-test-'));

        // Connect to database
        await database.connect();

        // Initialize database schema
        await database.run(`
            CREATE TABLE IF NOT EXISTS voters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voter_id TEXT UNIQUE NOT NULL,
                last_name TEXT NOT NULL,
                first_name TEXT NOT NULL,
                address TEXT NOT NULL,
                city TEXT NOT NULL,
                zip_code TEXT NOT NULL,
                precinct_number TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                geocoding_quality TEXT,
                super_voter INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await database.run(`
            CREATE TABLE IF NOT EXISTS election_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voter_id TEXT NOT NULL,
                election_code TEXT NOT NULL,
                voted INTEGER DEFAULT 0,
                party_code TEXT,
                early_voted INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (voter_id) REFERENCES voters(voter_id)
            )
        `);

        await database.run(`
            CREATE TABLE IF NOT EXISTS precincts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                precinct_number TEXT UNIQUE NOT NULL,
                name TEXT,
                total_voters INTEGER DEFAULT 0,
                active_voters INTEGER DEFAULT 0,
                super_voters INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await database.run(`
            CREATE TABLE IF NOT EXISTS import_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                file_size INTEGER,
                status TEXT DEFAULT 'pending',
                records_processed INTEGER DEFAULT 0,
                records_successful INTEGER DEFAULT 0,
                records_failed INTEGER DEFAULT 0,
                error_message TEXT,
                start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                end_time DATETIME
            )
        `);

        await database.run(`
            CREATE TABLE IF NOT EXISTS import_errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_id INTEGER NOT NULL,
                record_number INTEGER,
                error_type TEXT,
                error_message TEXT,
                record_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (import_id) REFERENCES import_logs(id)
            )
        `);

        await database.run(`
            CREATE TABLE IF NOT EXISTS geocoding_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                address_hash TEXT UNIQUE NOT NULL,
                original_address TEXT NOT NULL,
                formatted_address TEXT,
                latitude REAL,
                longitude REAL,
                quality_score REAL,
                place_id TEXT,
                components TEXT,
                cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        voterModel = new VoterModel();
    });

    afterAll(async () => {
        // Clean up test database and files
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    beforeEach(async () => {
        // Ensure no open transactions from previous tests
        try {
            await database.run('ROLLBACK');
        } catch (e) {
            // Ignore error if no transaction is active
        }
        
        // Temporarily disable foreign keys for cleanup
        await database.run('PRAGMA foreign_keys = OFF');
        
        // Clear tables before each test (children first to avoid FK violations)
        await database.run('DELETE FROM import_errors');
        await database.run('DELETE FROM election_history');
        await database.run('DELETE FROM voters');
        await database.run('DELETE FROM import_logs');
        await database.run('DELETE FROM precincts');
        await database.run('DELETE FROM geocoding_cache');
        
        // Re-enable foreign keys
        await database.run('PRAGMA foreign_keys = ON');
    });

    describe('CSV Import Workflow', () => {
        test('should complete full CSV import successfully', async () => {
            // Create test CSV file
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05
TN12345679,JOHNSON,MARY,456 OAK AVE,TROY,38260,03
TN12345680,WILLIAMS,ROBERT,789 ELM ST,OBION,38240,01`;

            const csvPath = path.join(testDir, 'test.csv');
            fs.writeFileSync(csvPath, csvContent);

            // Create import log
            const logResult = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['test.csv', Buffer.byteLength(csvContent), 'pending']
            );

            // Process import
            const result = await processImport(logResult.lastID, csvPath, 'csv', { importMode: 'replace' });

            expect(result.success).toBe(true);
            expect(result.successCount).toBe(3);
            expect(result.failedCount).toBe(0);

            // Verify voters were created
            const voters = await database.all('SELECT * FROM voters');
            expect(voters).toHaveLength(3);

            // Verify import log was updated
            const log = await database.get('SELECT * FROM import_logs WHERE id = ?', [logResult.lastID]);
            expect(log.status).toBe('completed');
            expect(log.records_successful).toBe(3);
        });

        test('should handle CSV import with validation errors', async () => {
            // Create CSV with some invalid records
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05
INVALID,,,INCOMPLETE,TROY,38260,03
TN12345680,WILLIAMS,ROBERT,789 ELM ST,OBION,38240,01`;

            const csvPath = path.join(testDir, 'invalid.csv');
            fs.writeFileSync(csvPath, csvContent);

            const logResult = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['invalid.csv', Buffer.byteLength(csvContent), 'pending']
            );

            const result = await processImport(logResult.lastID, csvPath, 'csv', { importMode: 'replace' });

            expect(result.success).toBe(true);
            expect(result.failedCount).toBeGreaterThan(0);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test('should respect deduplication mode - skip', async () => {
            // First import
            const csvContent1 = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05`;

            const csvPath1 = path.join(testDir, 'first.csv');
            fs.writeFileSync(csvPath1, csvContent1);

            const logResult1 = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['first.csv', Buffer.byteLength(csvContent1), 'pending']
            );

            await processImport(logResult1.lastID, csvPath1, 'csv', { importMode: 'replace' });

            // Second import with same voter_id but different address - should skip
            const csvContent2 = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,456 NEW STREET,UNION CITY,38261,05`;

            const csvPath2 = path.join(testDir, 'second.csv');
            fs.writeFileSync(csvPath2, csvContent2);

            const logResult2 = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['second.csv', Buffer.byteLength(csvContent2), 'pending']
            );

            await processImport(logResult2.lastID, csvPath2, 'csv', { importMode: 'skip' });

            // Verify address was NOT updated
            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', ['TN12345678']);
            expect(voter.address).toBe('123 MAIN ST');
        });

        test('should respect deduplication mode - replace', async () => {
            // First import
            const csvContent1 = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05`;

            const csvPath1 = path.join(testDir, 'first-replace.csv');
            fs.writeFileSync(csvPath1, csvContent1);

            const logResult1 = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['first-replace.csv', Buffer.byteLength(csvContent1), 'pending']
            );

            await processImport(logResult1.lastID, csvPath1, 'csv', { importMode: 'replace' });

            // Second import - should replace
            const csvContent2 = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,456 NEW STREET,UNION CITY,38261,05`;

            const csvPath2 = path.join(testDir, 'second-replace.csv');
            fs.writeFileSync(csvPath2, csvContent2);

            const logResult2 = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['second-replace.csv', Buffer.byteLength(csvContent2), 'pending']
            );

            await processImport(logResult2.lastID, csvPath2, 'csv', { importMode: 'replace' });

            // Verify address WAS updated
            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', ['TN12345678']);
            expect(voter.address).toBe('456 NEW STREET');
        });
    });

    describe('Batch Processing', () => {
        test('should process large imports in batches', async () => {
            // Create CSV with more than BATCH_SIZE records (normally 500)
            const records = [];
            records.push('voter_id,last_name,first_name,address,city,zip_code,precinct_number');
            
            for (let i = 1; i <= 600; i++) {
                records.push(`TN${String(i).padStart(8, '0')},LASTNAME${i},FIRSTNAME${i},${i} MAIN ST,UNION CITY,38261,05`);
            }

            const csvContent = records.join('\n');
            const csvPath = path.join(testDir, 'large.csv');
            fs.writeFileSync(csvPath, csvContent);

            const logResult = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['large.csv', Buffer.byteLength(csvContent), 'pending']
            );

            const result = await processImport(logResult.lastID, csvPath, 'csv', { importMode: 'replace' });

            expect(result.success).toBe(true);
            expect(result.successCount).toBe(600);

            // Verify all records were created
            const count = await database.get('SELECT COUNT(*) as total FROM voters');
            expect(count.total).toBe(600);
        });

        test('should track progress during batch processing', async () => {
            // Create CSV with multiple batches
            const records = [];
            records.push('voter_id,last_name,first_name,address,city,zip_code,precinct_number');
            
            for (let i = 1; i <= 100; i++) {
                records.push(`TN${String(i).padStart(8, '0')},LASTNAME${i},FIRSTNAME${i},${i} MAIN ST,UNION CITY,38261,05`);
            }

            const csvContent = records.join('\n');
            const csvPath = path.join(testDir, 'progress.csv');
            fs.writeFileSync(csvPath, csvContent);

            const logResult = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['progress.csv', Buffer.byteLength(csvContent), 'pending']
            );

            await processImport(logResult.lastID, csvPath, 'csv', { importMode: 'replace' });

            // Verify final progress
            const log = await database.get('SELECT * FROM import_logs WHERE id = ?', [logResult.lastID]);
            expect(log.records_processed).toBe(100);
            expect(log.records_successful).toBe(100);
        });

        test('should rollback failed batches atomically', async () => {
            // Create CSV where all records will fail validation
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
INVALID,,,,,,
INVALID2,,,,,,
INVALID3,,,,,,`;

            const csvPath = path.join(testDir, 'invalid-batch.csv');
            fs.writeFileSync(csvPath, csvContent);

            const logResult = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['invalid-batch.csv', Buffer.byteLength(csvContent), 'pending']
            );

            await processImport(logResult.lastID, csvPath, 'csv', { importMode: 'replace' });

            // Verify no voters were created
            const count = await database.get('SELECT COUNT(*) as total FROM voters');
            expect(count.total).toBe(0);
        });
    });

    describe('Error Logging', () => {
        test('should log import errors to database', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
INVALID,,,,,,`;

            const csvPath = path.join(testDir, 'error-log.csv');
            fs.writeFileSync(csvPath, csvContent);

            const logResult = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['error-log.csv', Buffer.byteLength(csvContent), 'pending']
            );

            await processImport(logResult.lastID, csvPath, 'csv', { importMode: 'replace' });

            // Retrieve errors
            const errors = await getImportErrors(logResult.lastID, 10);
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0].errorMessage).toBeDefined();
        });
    });

    describe('Precinct Statistics', () => {
        test('should update precinct statistics after import', async () => {
            const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05
TN12345679,JOHNSON,MARY,456 OAK AVE,UNION CITY,38261,05
TN12345680,WILLIAMS,ROBERT,789 ELM ST,UNION CITY,38261,03`;

            const csvPath = path.join(testDir, 'precinct-stats.csv');
            fs.writeFileSync(csvPath, csvContent);

            const logResult = await database.run(
                'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                ['precinct-stats.csv', Buffer.byteLength(csvContent), 'pending']
            );

            await processImport(logResult.lastID, csvPath, 'csv', { importMode: 'replace' });

            // Verify precinct statistics
            const precinct05 = await database.get('SELECT * FROM precincts WHERE precinct_number = ?', ['05']);
            expect(precinct05.total_voters).toBe(2);

            const precinct03 = await database.get('SELECT * FROM precincts WHERE precinct_number = ?', ['03']);
            expect(precinct03.total_voters).toBe(1);
        });
    });
});
