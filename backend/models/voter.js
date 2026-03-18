/**
 * Voter Model
 * Handles CRUD operations for voter records
 * Includes validation, deduplication, and super voter calculation
 */

const database = require('../config/database');

// Environment-aware logging: suppress verbose output in production
const isDev = process.env.NODE_ENV !== 'production';
const log = {
  info: (...args) => isDev && console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};

class VoterModel {
    /**
     * Create or update a voter record with deduplication support
     * @param {Object} voterData - Voter information
     * @param {string} voterData.voter_id - State voter ID (unique identifier)
     * @param {string} voterData.last_name - Last name
     * @param {string} voterData.first_name - First name
     * @param {string} voterData.address - Street address
     * @param {string} voterData.city - City name
     * @param {string} voterData.zip_code - ZIP code
     * @param {string} voterData.precinct_number - Precinct number
     * @param {boolean} [voterData.super_voter=false] - Super voter status
     * @param {string} [importMode='replace'] - Deduplication mode: 'skip' (ignore duplicates), 'replace' (update existing), or 'flag' (throw error on duplicate)
     * @returns {Promise<Object>} Result object with id and changes count
     * @throws {Error} If importMode is 'flag' and voter_id already exists, or if importMode is invalid
     */
    async create(voterData, importMode = 'replace') {
        const fields = [
            'voter_id',
            'last_name',
            'first_name',
            'address',
            'city',
            'state',  // State code (e.g., 'TN') - included to capture CSV data
            'zip_code',
            'precinct_number',
            'date_of_birth',
            'super_voter'
        ];

        // Filter out undefined values and ensure we have the required fields
        const values = fields.map(field => {
            if (field === 'super_voter') {
                return voterData[field] ? 1 : 0;
            }
            return voterData[field] !== undefined ? voterData[field] : null;
        });

        const placeholders = fields.map(() => '?').join(', ');
        let sql;
        let params = values;

        if (importMode === 'skip') {
            // Skip if voter_id already exists
            sql = `INSERT OR IGNORE INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
        } else if (importMode === 'replace') {
            // FIX: Use UPDATE for existing records, INSERT for new ones
            // This prevents foreign key constraint violations by avoiding DELETE operations
            // on voters with election_history records
            const existing = await database.get(
                'SELECT id FROM voters WHERE voter_id = ?',
                [voterData.voter_id]
            );

            if (existing) {
                // Update existing record without disturbing foreign key relationships
                // Exclude voter_id from update since it's the unique identifier
                const updateFields = fields.filter(f => f !== 'voter_id');
                const updateValues = updateFields.map(field => {
                    if (field === 'super_voter') {
                        return voterData[field] ? 1 : 0;
                    }
                    return voterData[field] !== undefined ? voterData[field] : null;
                });
                
                sql = `UPDATE voters SET ${updateFields.map(f => `${f} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE voter_id = ?`;
                params = [...updateValues, voterData.voter_id];
            } else {
                // Insert new record
                sql = `INSERT INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
                params = values;
            }
        } else if (importMode === 'flag') {
            // Check for existing voter first
            const existing = await database.get(
                'SELECT id FROM voters WHERE voter_id = ?',
                [voterData.voter_id]
            );
            if (existing) {
                throw new Error(`Duplicate voter_id: ${voterData.voter_id} (existing ID: ${existing.id})`);
            }
            sql = `INSERT INTO voters (${fields.join(', ')}) VALUES (${placeholders})`;
        } else {
            throw new Error(`Invalid import mode: ${importMode}`);
        }

        const result = await database.run(sql, params);
        return result;
    }

    /**
     * Create an election history record for a voter
     * @param {string} voterId - State voter ID (must match existing voter record)
     * @param {Object} historyData - Election history data
     * @param {string} historyData.electionCode - Election identifier (e.g., 'E_1', 'E_2')
     * @param {boolean} historyData.voted - Whether voter participated
     * @param {string|null} historyData.partyCode - Party affiliation ('R', 'D', 'I', or null)
     * @param {boolean} historyData.earlyVoted - Whether voter voted early
     * @returns {Promise<Object>} Result object with lastID and changes
     * @throws {Error} If database insertion fails
     */
    async createElectionHistory(voterId, historyData) {
        const sql = `
            INSERT INTO election_history (voter_id, election_code, voted, party_code, early_voted)
            VALUES (?, ?, ?, ?, ?)
        `;
        
        const result = await database.run(sql, [
            voterId,
            historyData.electionCode,
            historyData.voted ? 1 : 0,
            historyData.partyCode,
            historyData.earlyVoted ? 1 : 0
        ]);

        return result;
    }

    /**
     * Find a voter by database ID with election history
     * @param {number} id - Database ID (primary key)
     * @returns {Promise<Object|null>} Voter record with camelCased fields and election history array, or null if not found
     * @property {number} id - Database ID
     * @property {string} voterId - State voter ID
     * @property {string} lastName - Last name
     * @property {string} firstName - First name
     * @property {string} address - Street address
     * @property {string} city - City name
     * @property {string} zipCode - ZIP code
     * @property {string} precinctNumber - Precinct number
     * @property {number|null} latitude - Geocoded latitude
     * @property {number|null} longitude - Geocoded longitude
     * @property {string|null} geocodingQuality - Geocoding quality score
     * @property {boolean} superVoter - Super voter status
     * @property {string} createdAt - Creation timestamp
     * @property {string} updatedAt - Last update timestamp
     * @property {Array<Object>} electionHistory - Array of election participation records
     */
    async findById(id) {
        const voter = await database.get(
            `SELECT 
                id,
                voter_id as voterId,
                last_name as lastName,
                first_name as firstName,
                address,
                city,
                state,
                zip_code as zipCode,
                precinct_number as precinctNumber,
                date_of_birth as dateOfBirth,
                latitude,
                longitude,
                geocoding_quality as geocodingQuality,
                super_voter as superVoter,
                created_at as createdAt,
                updated_at as updatedAt
            FROM voters 
            WHERE id = ?`,
            [id]
        );

        if (!voter) {
            return null;
        }

        // Convert integer booleans to actual booleans
        voter.superVoter = voter.superVoter === 1;

        // Fetch election history
        const electionHistory = await database.all(
            `SELECT 
                election_code as electionCode,
                voted,
                party_code as partyCode,
                early_voted as earlyVoted
            FROM election_history
            WHERE voter_id = ?
            -- Sort chronologically: year ASC, then Primary > Runoff > General
            ORDER BY SUBSTR(election_code, 1, 4) ASC,
              CASE SUBSTR(election_code, -1)
                WHEN 'P' THEN 1
                WHEN 'R' THEN 2
                WHEN 'G' THEN 3
                ELSE 4
              END ASC`,
            [voter.voterId]
        );

        // Convert integer booleans in election history
        voter.electionHistory = electionHistory.map(eh => ({
            ...eh,
            voted: eh.voted === 1,
            earlyVoted: eh.earlyVoted === 1
        }));

        return voter;
    }

    /**
     * Find all voters with optional filtering and pagination
     * @param {Object} [filters={}] - Filter criteria
     * @param {string} [filters.precinct] - Filter by precinct number
     * @param {string} [filters.name] - Search by name (partial match on first or last name)
     * @param {boolean} [filters.super_voter] - Filter by super voter status
     * @param {boolean} [filters.geocoded] - Filter by geocoding status
     * @param {string} [filters.party] - Filter by party: 'R', 'D', or 'R,D' for both
     * @param {string} [filters.voting_status] - Filter by status: 'regular' or 'never'
     * @param {Object} [pagination={}] - Pagination options
     * @param {number} [pagination.limit=100] - Number of results per page (max: 1000)
     * @param {number} [pagination.offset=0] - Number of records to skip
     * @param {string} [pagination.sort='last_name'] - Sort field: 'last_name', 'first_name', 'precinct_number', 'city', or 'zip_code'
     * @param {string} [pagination.order='asc'] - Sort order: 'asc' or 'desc'
     * @returns {Promise<Object>} Results object containing data array, total count, limit, and offset
     * @property {Array<Object>} data - Array of voter records with camelCased fields
     * @property {number} total - Total number of matching records (without pagination)
     * @property {number} limit - Applied limit
     * @property {number} offset - Applied offset
     */
    async findAll(filters = {}, pagination = {}) {
        const { limit = 100, offset = 0, sort = 'last_name', order = 'asc' } = pagination;
        const conditions = [];
        const params = [];

        // Build WHERE conditions
        if (filters.precinct) {
            conditions.push('v.precinct_number = ?');
            params.push(filters.precinct.toString().padStart(2, '0'));
        }

        if (filters.name) {
            conditions.push('(v.last_name LIKE ? OR v.first_name LIKE ?)');
            const namePattern = `%${filters.name}%`;
            params.push(namePattern, namePattern);
        }

        if (filters.super_voter !== undefined) {
            conditions.push('v.super_voter = ?');
            params.push(filters.super_voter === true || filters.super_voter === 'true' ? 1 : 0);
        }

        // Geocoded filter - check for latitude/longitude presence
        if (filters.geocoded !== undefined) {
            if (filters.geocoded === true || filters.geocoded === 'true') {
                // Only voters with coordinates
                conditions.push('v.latitude IS NOT NULL');
                conditions.push('v.longitude IS NOT NULL');
            } else if (filters.geocoded === false || filters.geocoded === 'false') {
                // Only voters WITHOUT coordinates (useful for geocoding queue)
                conditions.push('(v.latitude IS NULL OR v.longitude IS NULL)');
            }
        }

        // NEW: Party affiliation filter
        // Filters voters based on their party registration from election history
        if (filters.party) {
            const parties = filters.party.split(',').map(p => p.trim().toUpperCase());
            
            if (parties.length === 1) {
                // Single party filter (R or D)
                conditions.push(`
                    v.voter_id IN (
                        SELECT DISTINCT voter_id 
                        FROM election_history 
                        WHERE party_code = ?
                          AND cycle_id IS NULL
                    )
                `);
                params.push(parties[0]);
            } else {
                // Multiple parties (R,D)
                const placeholders = parties.map(() => '?').join(',');
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

        // NEW: Voting status filter (regular / never-voted)
        // Regular = voters who have voted at least once
        // Never = voters with no election history records
        if (filters.voting_status === 'regular') {
            // Voters who have voted at least once in current cycle
            conditions.push(`
                v.voter_id IN (
                    SELECT DISTINCT voter_id 
                    FROM election_history 
                    WHERE voted = 1
                      AND cycle_id IS NULL
                )
            `);
        } else if (filters.voting_status === 'never') {
            // Voters with no election history in current cycle (never voted)
            conditions.push(`
                v.voter_id NOT IN (
                    SELECT DISTINCT voter_id 
                    FROM election_history
                    WHERE cycle_id IS NULL
                )
            `);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Validate sort field
        const validSortFields = ['last_name', 'first_name', 'precinct_number', 'city', 'zip_code'];
        const sortField = validSortFields.includes(sort) ? sort : 'last_name';
        const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        // Get total count
        const countResult = await database.get(
            `SELECT COUNT(*) as total FROM voters v ${whereClause}`,
            params
        );

        // Get paginated data with geocoding and election data
        const data = await database.all(
            `SELECT 
                v.id,
                v.voter_id as voterId,
                v.last_name as lastName,
                v.first_name as firstName,
                v.address,
                v.city,
                v.state,
                v.zip_code as zipCode,
                v.precinct_number as precinctNumber,
                v.date_of_birth as dateOfBirth,
                v.latitude,
                v.longitude,
                v.geocoding_quality as geocodingQuality,
                v.super_voter as superVoter,
                v.created_at as createdAt,
                (
                    SELECT party_code 
                    FROM election_history 
                    WHERE election_history.voter_id = v.voter_id 
                      AND party_code IS NOT NULL
                      AND cycle_id IS NULL
                    /* Sort chronologically: year DESC, then General > Runoff > Primary */
                    ORDER BY SUBSTR(election_code, 1, 4) DESC,
                      CASE SUBSTR(election_code, -1)
                        WHEN 'G' THEN 1
                        WHEN 'R' THEN 2
                        WHEN 'P' THEN 3
                        ELSE 4
                      END ASC
                    LIMIT 1
                ) as mostRecentParty,
                (
                    SELECT COUNT(*) 
                    FROM election_history 
                    WHERE election_history.voter_id = v.voter_id 
                      AND voted = 1
                      AND cycle_id IS NULL
                ) as electionsVoted,
                (
                    SELECT COUNT(*)
                    FROM election_history
                    WHERE election_history.voter_id = v.voter_id
                      AND cycle_id IS NULL
                ) as totalElections
            FROM voters v
            ${whereClause}
            ORDER BY ${sortField} ${sortOrder}
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        // Convert integer booleans and calculate participation rate
        const convertedData = data.map(voter => ({
            ...voter,
            superVoter: voter.superVoter === 1,
            participationRate: voter.totalElections > 0 
                ? Math.round((voter.electionsVoted / voter.totalElections) * 100) 
                : 0
        }));

        return {
            data: convertedData,
            total: countResult.total,
            limit,
            offset
        };
    }

    /**
     * Search voters by name or address using LIKE queries
     * @param {string} query - Search query text (minimum 2 characters recommended)
     * @param {number} [limit=50] - Maximum number of results to return
     * @returns {Promise<Array<Object>>} Array of matching voter records with camelCased fields
     * @throws {Error} If database query fails
     */
    async search(query, limit = 50) {
        const searchPattern = `%${query}%`;
        
        const results = await database.all(
            `SELECT 
                id,
                voter_id as voterId,
                last_name as lastName,
                first_name as firstName,
                address,
                city,
                zip_code as zipCode,
                precinct_number as precinctNumber,
                date_of_birth as dateOfBirth,
                super_voter as superVoter
            FROM voters 
            WHERE 
                last_name LIKE ? OR 
                first_name LIKE ? OR 
                address LIKE ?
            ORDER BY last_name, first_name
            LIMIT ?`,
            [searchPattern, searchPattern, searchPattern, limit]
        );

        // Convert integer booleans
        return results.map(voter => ({
            ...voter,
            superVoter: voter.superVoter === 1
        }));
    }

    /**
     * Get voters by precinct with precinct statistics
     * @param {string} precinctNumber - Precinct number (will be zero-padded to 2 digits)
     * @returns {Promise<Object>} Object containing precinct info and voters array
     * @property {Object} precinct - Precinct metadata
     * @property {string} precinct.number - Zero-padded precinct number
     * @property {string} precinct.name - Precinct name
     * @property {number} precinct.totalVoters - Total registered voters
     * @property {number} precinct.superVoters - Number of super voters
     * @property {Array<Object>} voters - Array of voter records in this precinct
     */
    async findByPrecinct(precinctNumber) {
        const paddedPrecinct = precinctNumber.toString().padStart(2, '0');

        // Get precinct info
        const precinct = await database.get(
            `SELECT 
                precinct_number as number,
                name,
                total_voters as totalVoters,
                super_voters as superVoters
            FROM precincts 
            WHERE precinct_number = ?`,
            [paddedPrecinct]
        );

        // Get voters in precinct
        const voters = await database.all(
            `SELECT 
                id,
                voter_id as voterId,
                last_name as lastName,
                first_name as firstName,
                address,
                date_of_birth as dateOfBirth,
                super_voter as superVoter
            FROM voters 
            WHERE precinct_number = ?
            ORDER BY last_name, first_name`,
            [paddedPrecinct]
        );

        // Convert integer booleans
        const convertedVoters = voters.map(voter => ({
            ...voter,
            superVoter: voter.superVoter === 1
        }));

        return {
            precinct: precinct || {
                number: paddedPrecinct,
                name: `Precinct ${paddedPrecinct}`,
                totalVoters: voters.length,
                superVoters: voters.filter(v => v.superVoter === 1).length
            },
            voters: convertedVoters
        };
    }

    /**
     * Calculate and update super voter status for a single voter
     * Super voter = voted in at least 4 of the last 5 elections
     * @param {string} voterId - State voter ID
     * @returns {Promise<boolean>} True if voter qualifies as super voter, false otherwise
     * @throws {Error} If database operations fail
     */
    async calculateSuperVoter(voterId) {
        const history = await database.all(
            `SELECT election_code, voted 
             FROM election_history 
             WHERE voter_id = ?
               AND cycle_id IS NULL
             /* Sort chronologically: year DESC, then General > Runoff > Primary */
             ORDER BY SUBSTR(election_code, 1, 4) DESC,
               CASE SUBSTR(election_code, -1)
                 WHEN 'G' THEN 1
                 WHEN 'R' THEN 2
                 WHEN 'P' THEN 3
                 ELSE 4
               END ASC
             LIMIT 5`,
            [voterId]
        );

        if (history.length < 3) {
            // Need at least 3 elections to determine super voter status
            return false;
        }

        const votedCount = history.filter(h => h.voted === 1).length;
        const isSuperVoter = votedCount >= 4;

        // Update voter record
        await database.run(
            'UPDATE voters SET super_voter = ? WHERE voter_id = ?',
            [isSuperVoter ? 1 : 0, voterId]
        );

        return isSuperVoter;
    }

    /**
     * Update precinct statistics (voter counts)
     * Recalculates total and super voter counts for a specific precinct
     * @param {string} precinctNumber - Precinct number (will be zero-padded to 2 digits)
     * @returns {Promise<Object>} Statistics object with total and super_voters counts
     * @property {number} total - Total registered voters in precinct
     * @property {number} super_voters - Number of super voters in precinct
     */
    async updatePrecinctStats(precinctNumber) {
        const paddedPrecinct = precinctNumber.toString().padStart(2, '0');

        const stats = await database.get(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN super_voter = 1 THEN 1 ELSE 0 END) as super_voters
            FROM voters 
            WHERE precinct_number = ?`,
            [paddedPrecinct]
        );

        // Ensure precinct exists
        await database.run(
            `INSERT OR IGNORE INTO precincts (precinct_number, name) 
             VALUES (?, ?)`,
            [paddedPrecinct, `Precinct ${paddedPrecinct}`]
        );

        // Update statistics
        await database.run(
            `UPDATE precincts 
             SET total_voters = ?, 
                 active_voters = ?, 
                 super_voters = ?
             WHERE precinct_number = ?`,
            [stats.total, stats.total, stats.super_voters || 0, paddedPrecinct]
        );

        return stats;
    }

    /**
     * Batch update super voter status for all voters in database
     * Uses optimized batch UPDATE instead of individual queries (N+1 fix)
     * Should be run after bulk imports to recalculate all statuses
     * @returns {Promise<number>} Number of voters marked as super voters
     */
    async recalculateAllSuperVoters() {
        // ENHANCED: Dynamic threshold based on available election data
        
        // Step 1: Count total elections in current (unarchived) cycle
        const electionCount = await database.get(
            `SELECT COUNT(DISTINCT election_code) as total FROM election_history WHERE cycle_id IS NULL`
        );
        
        const totalElections = electionCount.total;
        
        // Step 2: Define threshold dynamically
        // - If 5+ elections: require 4 out of 5 (80%)
        // - If 2-4 elections: require 100% participation
        // - If 1 election: require 1 vote (100%)
        
        let threshold, lookback;
        if (totalElections >= 5) {
            threshold = 4;
            lookback = 5;
        } else if (totalElections >= 2) {
            threshold = totalElections;  // 100% participation
            lookback = totalElections;
        } else {
            threshold = 1;
            lookback = 1;
        }
        
        log.info(`Super voter calculation: ${threshold} votes in last ${lookback} elections (${totalElections} total elections available)`);
        
        // Step 3: Update flags with dynamic threshold
        const result = await database.run(`
            UPDATE voters 
            SET super_voter = (
                SELECT CASE 
                    WHEN COUNT(CASE WHEN eh.voted = 1 THEN 1 END) >= ? 
                    THEN 1 
                    ELSE 0 
                END
                FROM (
                    SELECT voted 
                    FROM election_history 
                    WHERE election_history.voter_id = voters.voter_id 
                      AND cycle_id IS NULL
                    /* Sort chronologically: year DESC, then General > Runoff > Primary */
                    ORDER BY SUBSTR(election_code, 1, 4) DESC,
                      CASE SUBSTR(election_code, -1)
                        WHEN 'G' THEN 1
                        WHEN 'R' THEN 2
                        WHEN 'P' THEN 3
                        ELSE 4
                      END ASC
                    LIMIT ?
                ) eh
            )
            WHERE EXISTS (
                SELECT 1 FROM election_history 
                WHERE election_history.voter_id = voters.voter_id
                  AND cycle_id IS NULL
            )
        `, [threshold, lookback]);
        
        // Count how many are now super voters
        const count = await database.get(
            'SELECT COUNT(*) as total FROM voters WHERE super_voter = 1'
        );
        
        const totalResult = await database.get('SELECT COUNT(*) as total FROM voters');
        const percentage = totalResult.total > 0 ? Math.round(count.total / totalResult.total * 100) : 0;
        log.info(`✅ ${count.total} voters marked as super voters (${percentage}% of total)`);
        return count.total;
    }

    /**
     * Batch update statistics for all precincts
     * Recalculates voter counts for every precinct with voters
     * @returns {Promise<number>} Number of precincts updated
     */
    async recalculateAllPrecinctStats() {
        // Remove stale precincts that have no matching voters
        await database.run(
            'DELETE FROM precincts WHERE precinct_number NOT IN (SELECT DISTINCT precinct_number FROM voters)'
        );

        const precincts = await database.all('SELECT DISTINCT precinct_number FROM voters');
        
        for (const precinct of precincts) {
            await this.updatePrecinctStats(precinct.precinct_number);
        }

        return precincts.length;
    }

    /**
     * Calculate age from date of birth
     * Accounts for birthday not yet occurred this year
     * @param {string|null} dateOfBirth - ISO-8601 date string (YYYY-MM-DD)
     * @returns {number|null} Age in years, or null if DOB is missing/invalid
     */
    static calculateAge(dateOfBirth) {
        if (!dateOfBirth) return null;
        
        const today = new Date();
        const birthDate = new Date(dateOfBirth);
        
        // Validate date
        if (isNaN(birthDate.getTime())) return null;
        
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        // Adjust if birthday hasn't occurred this year yet
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        
        return age >= 0 ? age : null;
    }

    /**
     * Get age group from date of birth
     * Uses standard demographic age buckets for political analytics
     * @param {string|null} dateOfBirth - ISO-8601 date string (YYYY-MM-DD)
     * @returns {string} Age group label (e.g., '18-24', '65-74', 'Unknown')
     */
    static getAgeGroup(dateOfBirth) {
        const age = VoterModel.calculateAge(dateOfBirth);
        
        if (age === null) return 'Unknown';
        if (age < 18) return 'Under 18';
        if (age >= 18 && age <= 24) return '18-24';
        if (age >= 25 && age <= 34) return '25-34';
        if (age >= 35 && age <= 44) return '35-44';
        if (age >= 45 && age <= 54) return '45-54';
        if (age >= 55 && age <= 64) return '55-64';
        if (age >= 65 && age <= 74) return '65-74';
        if (age >= 75) return '75+';
        return 'Unknown';
    }

    /**
     * Get voters by array of IDs
     * Phase 5: Route Planning Integration
     * 
     * @param {Array<number>} voterIds - Array of voter IDs
     * @returns {Promise<Array>} Array of voter records with geocoding data
     */
    async getVotersByIds(voterIds) {
        if (!voterIds || voterIds.length === 0) {
            return [];
        }

        const placeholders = voterIds.map(() => '?').join(', ');
        
        const voters = await database.all(
            `SELECT 
                id,
                voter_id,
                last_name,
                first_name,
                address as residential_address,
                city as residential_city,
                zip_code,
                precinct_number,
                latitude,
                longitude,
                geocoding_quality,
                super_voter
            FROM voters 
            WHERE id IN (${placeholders})`,
            voterIds
        );

        return voters;
    }
}

module.exports = VoterModel;
