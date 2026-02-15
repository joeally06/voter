/**
 * Unit Tests for Voter Model
 * Tests CRUD operations, deduplication, and super voter calculations
 */

const VoterModel = require('../../../backend/models/voter');
const database = require('../../../backend/config/database');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Voter Model', () => {
    let testDbPath;
    let voterModel;

    beforeAll(async () => {
        // Create temporary test database
        testDbPath = path.join(os.tmpdir(), `test-voter-${Date.now()}.db`);
        process.env.DB_PATH = testDbPath;

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
                records_processed INTEGER DEFAULT 0,
                records_successful INTEGER DEFAULT 0,
                records_failed INTEGER DEFAULT 0,
                start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                end_time DATETIME,
                status TEXT DEFAULT 'pending',
                error_message TEXT
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
        // Clean up test database
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(async () => {
        // Clear tables before each test (children first to avoid FK violations)
        await database.run('DELETE FROM import_errors');
        await database.run('DELETE FROM election_history');
        await database.run('DELETE FROM voters');
        await database.run('DELETE FROM import_logs');
        await database.run('DELETE FROM precincts');
        await database.run('DELETE FROM geocoding_cache');
    });

    describe('create', () => {
        const sampleVoter = {
            voter_id: 'TN12345678',
            last_name: 'SMITH',
            first_name: 'JOHN',
            address: '123 MAIN ST',
            city: 'UNION CITY',
            zip_code: '38261',
            precinct_number: '05',
            super_voter: false
        };

        test('should create a new voter with replace mode (default)', async () => {
            const result = await voterModel.create(sampleVoter);

            expect(result.id).toBeGreaterThan(0);
            expect(result.changes).toBe(1);

            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', ['TN12345678']);
            expect(voter).toBeDefined();
            expect(voter.last_name).toBe('SMITH');
        });

        test('should update existing voter with replace mode', async () => {
            // Create initial voter
            await voterModel.create(sampleVoter, 'replace');

            // Update with new data
            const updatedVoter = { ...sampleVoter, address: '456 ELM ST' };
            const result = await voterModel.create(updatedVoter, 'replace');

            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', ['TN12345678']);
            expect(voter.address).toBe('456 ELM ST');
        });

        test('should skip duplicate voter with skip mode', async () => {
            // Create initial voter
            await voterModel.create(sampleVoter, 'replace');

            // Try to create duplicate with skip mode
            const duplicateVoter = { ...sampleVoter, address: '456 ELM ST' };
            await voterModel.create(duplicateVoter, 'skip');

            // Address should remain unchanged
            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', ['TN12345678']);
            expect(voter.address).toBe('123 MAIN ST');
        });

        test('should throw error for duplicate voter with flag mode', async () => {
            // Create initial voter
            await voterModel.create(sampleVoter, 'replace');

            // Try to create duplicate with flag mode
            const duplicateVoter = { ...sampleVoter };
            await expect(voterModel.create(duplicateVoter, 'flag')).rejects.toThrow('Duplicate voter_id');
        });

        test('should throw error for invalid import mode', async () => {
            await expect(voterModel.create(sampleVoter, 'invalid')).rejects.toThrow('Invalid import mode');
        });

        test('should handle super_voter boolean to integer conversion', async () => {
            const superVoter = { ...sampleVoter, super_voter: true };
            await voterModel.create(superVoter);

            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', ['TN12345678']);
            expect(voter.super_voter).toBe(1);
        });
    });

    describe('createElectionHistory', () => {
        beforeEach(async () => {
            // Create a voter first
            await voterModel.create({
                voter_id: 'TN12345678',
                last_name: 'SMITH',
                first_name: 'JOHN',
                address: '123 MAIN ST',
                city: 'UNION CITY',
                zip_code: '38261',
                precinct_number: '05'
            });
        });

        test('should create election history record', async () => {
            const historyData = {
                electionCode: 'E_1',
                voted: true,
                partyCode: 'R',
                earlyVoted: false
            };

            const result = await voterModel.createElectionHistory('TN12345678', historyData);

            expect(result.id).toBeGreaterThan(0);

            const history = await database.get(
                'SELECT * FROM election_history WHERE voter_id = ? AND election_code = ?',
                ['TN12345678', 'E_1']
            );

            expect(history).toBeDefined();
            expect(history.voted).toBe(1);
            expect(history.party_code).toBe('R');
            expect(history.early_voted).toBe(0);
        });

        test('should handle boolean to integer conversion', async () => {
            const historyData = {
                electionCode: 'E_2',
                voted: true,
                partyCode: 'D',
                earlyVoted: true
            };

            await voterModel.createElectionHistory('TN12345678', historyData);

            const history = await database.get(
                'SELECT * FROM election_history WHERE election_code = ?',
                ['E_2']
            );

            expect(history.voted).toBe(1);
            expect(history.early_voted).toBe(1);
        });
    });

    describe('findById', () => {
        test('should find voter by ID with election history', async () => {
            // Create voter
            const result = await voterModel.create({
                voter_id: 'TN12345678',
                last_name: 'SMITH',
                first_name: 'JOHN',
                address: '123 MAIN ST',
                city: 'UNION CITY',
                zip_code: '38261',
                precinct_number: '05'
            });

            // Add election history
            await voterModel.createElectionHistory('TN12345678', {
                electionCode: 'E_1',
                voted: true,
                partyCode: 'R',
                earlyVoted: false
            });

            const voter = await voterModel.findById(result.id);

            expect(voter).toBeDefined();
            expect(voter.voterId).toBe('TN12345678');
            expect(voter.lastName).toBe('SMITH');
            expect(voter.firstName).toBe('JOHN');
            expect(voter.superVoter).toBe(false);
            expect(voter.electionHistory).toHaveLength(1);
            expect(voter.electionHistory[0].voted).toBe(true);
        });

        test('should return null for non-existent ID', async () => {
            const voter = await voterModel.findById(99999);
            expect(voter).toBeNull();
        });

        test('should convert database integers to booleans', async () => {
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

            const voters = await database.all('SELECT * FROM voters LIMIT 1');
            const voter = await voterModel.findById(voters[0].id);

            expect(typeof voter.superVoter).toBe('boolean');
            expect(voter.superVoter).toBe(true);
        });
    });

    describe('findAll', () => {
        beforeEach(async () => {
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
        });

        test('should return all voters with default pagination', async () => {
            const result = await voterModel.findAll();

            expect(result.data).toHaveLength(2);
            expect(result.total).toBe(2);
            expect(result.limit).toBe(100);
            expect(result.offset).toBe(0);
        });

        test('should filter by precinct', async () => {
            const result = await voterModel.findAll({ precinct: '05' });

            expect(result.data).toHaveLength(1);
            expect(result.data[0].precinctNumber).toBe('05');
        });

        test('should filter by super voter status', async () => {
            const result = await voterModel.findAll({ super_voter: true });

            expect(result.data).toHaveLength(1);
            expect(result.data[0].superVoter).toBe(true);
        });

        test('should search by name', async () => {
            const result = await voterModel.findAll({ name: 'SMITH' });

            expect(result.data).toHaveLength(1);
            expect(result.data[0].lastName).toBe('SMITH');
        });

        test('should handle pagination', async () => {
            const result = await voterModel.findAll({}, { limit: 1, offset: 0 });

            expect(result.data).toHaveLength(1);
            expect(result.limit).toBe(1);
            expect(result.offset).toBe(0);
        });

        test('should handle sorting', async () => {
            const result = await voterModel.findAll({}, { sort: 'first_name', order: 'asc' });

            expect(result.data[0].firstName).toBe('JOHN');
            expect(result.data[1].firstName).toBe('MARY');
        });
    });

    describe('calculateSuperVoter', () => {
        beforeEach(async () => {
            await voterModel.create({
                voter_id: 'TN12345678',
                last_name: 'SMITH',
                first_name: 'JOHN',
                address: '123 MAIN ST',
                city: 'UNION CITY',
                zip_code: '38261',
                precinct_number: '05'
            });
        });

        test('should mark voter as super voter with 4 of 5 elections', async () => {
            // Add 4 elections where voter participated
            for (let i = 1; i <= 5; i++) {
                await voterModel.createElectionHistory('TN12345678', {
                    electionCode: `E_${i}`,
                    voted: i <= 4, // Voted in first 4, not 5th
                    partyCode: null,
                    earlyVoted: false
                });
            }

            const isSuperVoter = await voterModel.calculateSuperVoter('TN12345678');

            expect(isSuperVoter).toBe(true);

            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', ['TN12345678']);
            expect(voter.super_voter).toBe(1);
        });

        test('should not mark voter as super voter with less than 4 elections', async () => {
            // Add 3 elections where voter participated
            for (let i = 1; i <= 5; i++) {
                await voterModel.createElectionHistory('TN12345678', {
                    electionCode: `E_${i}`,
                    voted: i <= 3, // Voted in first 3 only
                    partyCode: null,
                    earlyVoted: false
                });
            }

            const isSuperVoter = await voterModel.calculateSuperVoter('TN12345678');

            expect(isSuperVoter).toBe(false);
        });

        test('should return false with less than 3 elections total', async () => {
            // Add only 2 elections
            for (let i = 1; i <= 2; i++) {
                await voterModel.createElectionHistory('TN12345678', {
                    electionCode: `E_${i}`,
                    voted: true,
                    partyCode: null,
                    earlyVoted: false
                });
            }

            const isSuperVoter = await voterModel.calculateSuperVoter('TN12345678');

            expect(isSuperVoter).toBe(false);
        });
    });

    describe('updatePrecinctStats', () => {
        beforeEach(async () => {
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
                city: 'UNION CITY',
                zip_code: '38261',
                precinct_number: '05',
                super_voter: false
            });
        });

        test('should update precinct statistics', async () => {
            const stats = await voterModel.updatePrecinctStats('05');

            expect(stats.total).toBe(2);
            expect(stats.super_voters).toBe(1);

            const precinct = await database.get('SELECT * FROM precincts WHERE precinct_number = ?', ['05']);
            expect(precinct.total_voters).toBe(2);
            expect(precinct.super_voters).toBe(1);
        });

        test('should create precinct if it does not exist', async () => {
            await voterModel.updatePrecinctStats('05');

            const precinct = await database.get('SELECT * FROM precincts WHERE precinct_number = ?', ['05']);
            expect(precinct).toBeDefined();
            expect(precinct.name).toBe('Precinct 05');
        });
    });
});
