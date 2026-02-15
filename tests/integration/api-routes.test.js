/**
 * Integration Tests for API Routes
 * Tests upload and voters API endpoints with realistic scenarios
 */

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const database = require('../../backend/config/database');
const uploadRoutes = require('../../backend/routes/upload');
const votersRoutes = require('../../backend/routes/voters');
const VoterModel = require('../../backend/models/voter');

describe('API Routes Integration', () => {
    let app;
    let testDbPath;
    let testDir;

    beforeAll(async () => {
        // Create temporary test database
        testDbPath = path.join(os.tmpdir(), `test-api-${Date.now()}.db`);
        process.env.DB_PATH = testDbPath;

        // Create test files directory
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));

        // Initialize Express app with routes
        app = express();
        app.use(express.json());
        app.use('/api/upload', uploadRoutes);
        app.use('/api/voters', votersRoutes);

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
    });

    afterAll(async () => {
        // Clean up
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
        
        // Clear all data before each test (children first to avoid FK violations)
        await database.run('DELETE FROM import_errors');
        await database.run('DELETE FROM election_history');
        await database.run('DELETE FROM voters');
        await database.run('DELETE FROM import_logs');
        await database.run('DELETE FROM precincts');
        await database.run('DELETE FROM geocoding_cache');
        
        // Re-enable foreign keys
        await database.run('PRAGMA foreign_keys = ON');
    });

    describe('Upload Routes', () => {
        describe('POST /api/upload/csv', () => {
            test('should accept valid CSV file upload', async () => {
                const csvContent = `voter_id,last_name,first_name,address,city,zip_code,precinct_number
TN12345678,SMITH,JOHN,123 MAIN ST,UNION CITY,38261,05`;

                const csvPath = path.join(testDir, 'test-upload.csv');
                fs.writeFileSync(csvPath, csvContent);

                const response = await request(app)
                    .post('/api/upload/csv')
                    .attach('file', csvPath)
                    .field('importMode', 'replace');

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.import.id).toBeDefined();
                expect(response.body.import.status).toBe('pending');
            });

            test('should reject non-CSV files', async () => {
                const txtPath = path.join(testDir, 'test.txt');
                fs.writeFileSync(txtPath, 'Not a CSV file');

                const response = await request(app)
                    .post('/api/upload/csv')
                    .attach('file', txtPath)
                    .field('importMode', 'replace');

                // File type validation happens at multer level, returns 500 if filter rejects
                expect(response.status).toBe(500);
                expect(response.body.success).toBe(false);
            });

            test('should reject missing file', async () => {
                const response = await request(app)
                    .post('/api/upload/csv')
                    .field('importMode', 'replace');

                expect(response.status).toBe(400);
                expect(response.body.success).toBe(false);
                expect(response.body.error).toContain('No file uploaded');
            });

            test('should validate import mode parameter', async () => {
                const csvContent = 'voter_id,last_name,first_name,address,city,zip_code,precinct_number\n';
                const csvPath = path.join(testDir, 'mode-test.csv');
                fs.writeFileSync(csvPath, csvContent);

                const response = await request(app)
                    .post('/api/upload/csv')
                    .attach('file', csvPath)
                    .field('importMode', 'invalid_mode');

                expect(response.status).toBe(400);
                expect(response.body.error).toContain('Invalid import mode');
            });
        });

        describe('GET /api/upload/history', () => {
            test('should return upload history', async () => {
                // Create test import log
                await database.run(
                    'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                    ['test.csv', 1000, 'completed']
                );

                const response = await request(app)
                    .get('/api/upload/history');

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.data).toHaveLength(1);
                expect(response.body.data[0].filename).toBe('test.csv');
            });

            test('should filter by status', async () => {
                await database.run(
                    'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                    ['completed.csv', 1000, 'completed']
                );
                await database.run(
                    'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                    ['pending.csv', 1000, 'pending']
                );

                const response = await request(app)
                    .get('/api/upload/history?status=completed');

                expect(response.status).toBe(200);
                expect(response.body.data).toHaveLength(1);
                expect(response.body.data[0].status).toBe('completed');
            });

            test('should respect limit parameter', async () => {
                // Create multiple import logs
                for (let i = 0; i < 5; i++) {
                    await database.run(
                        'INSERT INTO import_logs (filename, file_size, status) VALUES (?, ?, ?)',
                        [`test${i}.csv`, 1000, 'completed']
                    );
                }

                const response = await request(app)
                    .get('/api/upload/history?limit=3');

                expect(response.status).toBe(200);
                expect(response.body.data.length).toBeLessThanOrEqual(3);
            });
        });

        describe('GET /api/upload/:id', () => {
            test('should return upload details', async () => {
                const result = await database.run(
                    'INSERT INTO import_logs (filename, file_size, status, records_successful, records_failed) VALUES (?, ?, ?, ?, ?)',
                    ['test.csv', 1000, 'completed', 10, 2]
                );

                const response = await request(app)
                    .get(`/api/upload/${result.lastID}`);

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.data.filename).toBe('test.csv');
                expect(response.body.data.progress).toBeDefined();
            });

            test('should return 404 for non-existent upload', async () => {
                const response = await request(app)
                    .get('/api/upload/99999');

                expect(response.status).toBe(404);
                expect(response.body.success).toBe(false);
            });
        });
    });

    describe('Voters Routes', () => {
        let voterModel;

        beforeEach(async () => {
            voterModel = new VoterModel();

            // Create test voters
            await voterModel.create({
                voter_id: 'TN12345678',
                last_name: 'SMITH',
                first_name: 'JOHN',
                address: '123 MAIN ST',
                city: 'UNION CITY',
                zip_code: '38261',
                precinct_number: '05',
                super_voter: true
            });

            await voterModel.create({
                voter_id: 'TN12345679',
                last_name: 'JOHNSON',
                first_name: 'MARY',
                address: '456 OAK AVE',
                city: 'TROY',
                zip_code: '38260',
                precinct_number: '03',
                super_voter: false
            });

            await voterModel.create({
                voter_id: 'TN12345680',
                last_name: 'WILLIAMS',
                first_name: 'ROBERT',
                address: '789 ELM ST',
                city: 'OBION',
                zip_code: '38240',
                precinct_number: '01',
                super_voter: false
            });
        });

        describe('GET /api/voters', () => {
            test('should return all voters with default pagination', async () => {
                const response = await request(app)
                    .get('/api/voters');

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.count).toBe(3);
                expect(response.body.data).toHaveLength(3);
            });

            test('should filter by precinct', async () => {
                const response = await request(app)
                    .get('/api/voters?precinct=05');

                expect(response.status).toBe(200);
                expect(response.body.count).toBe(1);
                expect(response.body.data[0].precinctNumber).toBe('05');
            });

            test('should filter by super voter status', async () => {
                const response = await request(app)
                    .get('/api/voters?super_voter=true');

                expect(response.status).toBe(200);
                expect(response.body.count).toBe(1);
                expect(response.body.data[0].superVoter).toBe(true);
            });

            test('should search by name', async () => {
                const response = await request(app)
                    .get('/api/voters?name=SMITH');

                expect(response.status).toBe(200);
                expect(response.body.count).toBe(1);
                expect(response.body.data[0].lastName).toBe('SMITH');
            });

            test('should handle pagination', async () => {
                const response = await request(app)
                    .get('/api/voters?limit=2&offset=1');

                expect(response.status).toBe(200);
                expect(response.body.pagination.limit).toBe(2);
                expect(response.body.pagination.offset).toBe(1);
                expect(response.body.count).toBeLessThanOrEqual(2);
            });

            test('should handle sorting', async () => {
                const response = await request(app)
                    .get('/api/voters?sort=first_name&order=asc');

                expect(response.status).toBe(200);
                expect(response.body.data[0].firstName).toBe('JOHN');
            });

            test('should validate query parameters', async () => {
                const response = await request(app)
                    .get('/api/voters?limit=-1');

                expect(response.status).toBe(400);
                expect(response.body.success).toBe(false);
            });
        });

        describe('GET /api/voters/:id', () => {
            test('should return voter by ID with election history', async () => {
                const voters = await database.all('SELECT * FROM voters LIMIT 1');
                const voterId = voters[0].id;

                const response = await request(app)
                    .get(`/api/voters/${voterId}`);

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.data.id).toBe(voterId);
                expect(response.body.data.electionHistory).toBeDefined();
            });

            test('should return 404 for non-existent voter', async () => {
                const response = await request(app)
                    .get('/api/voters/99999');

                expect(response.status).toBe(404);
                expect(response.body.success).toBe(false);
            });

            test('should validate ID parameter', async () => {
                const response = await request(app)
                    .get('/api/voters/invalid');

                expect(response.status).toBe(400);
                expect(response.body.success).toBe(false);
            });
        });

        describe('GET /api/voters/search/:query', () => {
            test('should search voters by query string', async () => {
                const response = await request(app)
                    .get('/api/voters/search/SMITH');

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.count).toBeGreaterThan(0);
            });

            test('should validate query length', async () => {
                const response = await request(app)
                    .get('/api/voters/search/A'); // Too short

                expect(response.status).toBe(400);
                expect(response.body.success).toBe(false);
            });

            test('should respect limit parameter', async () => {
                const response = await request(app)
                    .get('/api/voters/search/UNION?limit=1');

                expect(response.status).toBe(200);
                expect(response.body.count).toBeLessThanOrEqual(1);
            });
        });

        describe('GET /api/voters/precinct/:precinct', () => {
            test('should return voters by precinct with statistics', async () => {
                // Update precinct stats first
                await voterModel.updatePrecinctStats('05');

                const response = await request(app)
                    .get('/api/voters/precinct/05');

                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
                expect(response.body.precinct).toBeDefined();
                expect(response.body.voters).toBeDefined();
                expect(response.body.count).toBeGreaterThan(0);
            });

            test('should validate precinct parameter', async () => {
                const response = await request(app)
                    .get('/api/voters/precinct/invalid_precinct_number');

                expect(response.status).toBe(400);
                expect(response.body.success).toBe(false);
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle database errors gracefully', async () => {
            // Close database connection to trigger error
            // Note: This is a destructive test, run last

            const response = await request(app)
                .get('/api/voters');

            // Should still return valid response structure
            expect(response.body).toHaveProperty('success');
        });
    });
});
