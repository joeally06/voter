/**
 * Re-import Election History Script
 * Re-processes existing CSV files to extract and populate election history data
 * Run this after updating the CSV parser to support election history extraction
 */

const path = require('path');
const fs = require('fs').promises;
const database = require('../backend/config/database');
const VoterModel = require('../backend/models/voter');
const { parseCSV } = require('../backend/parsers/csv-parser');

const RAW_DATA_DIR = path.join(__dirname, '..', 'data', 'raw');

/**
 * Main re-import function
 */
async function reimportElectionHistory() {
    console.log('=== Election History Re-Import Tool ===\n');
    
    try {
        // Initialize database connection
        await database.connect();
        
        // Get all CSV files from raw data directory
        const files = await fs.readdir(RAW_DATA_DIR);
        const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));
        
        if (csvFiles.length === 0) {
            console.log('No CSV files found in data/raw/');
            return;
        }
        
        console.log(`Found ${csvFiles.length} CSV file(s):\n`);
        csvFiles.forEach((file, idx) => {
            console.log(`  ${idx + 1}. ${file}`);
        });
        console.log('');
        
        // Select most recent file (highest timestamp)
        const mostRecent = csvFiles.sort().reverse()[0];
        const filePath = path.join(RAW_DATA_DIR, mostRecent);
        
        console.log(`Processing most recent file: ${mostRecent}\n`);
        
        // Parse the CSV file
        console.log('Parsing CSV file...');
        const parseResult = await parseCSV(filePath);
        
        if (!parseResult.success || parseResult.records.length === 0) {
            console.error('Failed to parse CSV file or no records found');
            return;
        }
        
        console.log(`✓ Parsed ${parseResult.totalCount} records\n`);
        
        // Count records with election history
        const recordsWithHistory = parseResult.records.filter(r => 
            r.electionHistory && r.electionHistory.length > 0
        );
        
        console.log(`✓ Found ${recordsWithHistory.length} voters with election history\n`);
        
        if (recordsWithHistory.length === 0) {
            console.log('No election history data found in CSV. Check CSV format (E_1, E_2 columns).');
            return;
        }
        
        // Show sample election data
        const sample = recordsWithHistory[0];
        console.log('Sample election history data:');
        console.log(`  Voter: ${sample.first_name} ${sample.last_name} (${sample.voter_id})`);
        console.log(`  Elections: ${sample.electionHistory.length}`);
        sample.electionHistory.slice(0, 3).forEach(eh => {
            console.log(`    - ${eh.electionCode}: Voted=${eh.voted}, Party=${eh.partyCode || 'N/A'}, Early=${eh.earlyVoted}`);
        });
        console.log('');
        
        // Clear existing election history (fresh start)
        console.log('Clearing existing election history records...');
        const deleteResult = await database.run('DELETE FROM election_history');
        console.log(`✓ Deleted ${deleteResult.changes || 0} existing records\n`);
        
        // Insert new election history records
        console.log('Inserting election history records...');
        const voterModel = new VoterModel();
        let totalInserted = 0;
        let votersProcessed = 0;
        let votersNotFound = 0;
        
        for (const record of recordsWithHistory) {
            votersProcessed++;
            
            // Check if voter exists in database
            const existingVoter = await database.get(
                'SELECT id FROM voters WHERE voter_id = ?',
                [record.voter_id]
            );
            
            if (!existingVoter) {
                votersNotFound++;
                continue;
            }
            
            // Insert each election history record
            for (const history of record.electionHistory) {
                try {
                    await voterModel.createElectionHistory(record.voter_id, history);
                    totalInserted++;
                } catch (error) {
                    console.error(`  Error inserting history for voter ${record.voter_id}: ${error.message}`);
                }
            }
            
            // Progress indicator
            if (votersProcessed % 100 === 0) {
                console.log(`  Processed ${votersProcessed}/${recordsWithHistory.length} voters...`);
            }
        }
        
        console.log(`✓ Inserted ${totalInserted} election history records`);
        console.log(`✓ Processed ${votersProcessed - votersNotFound}/${votersProcessed} voters`);
        if (votersNotFound > 0) {
            console.log(`  ⚠ ${votersNotFound} voters not found in database (skipped)`);
        }
        console.log('');
        
        // Recalculate super voter status
        console.log('Recalculating super voter status...');
        const superVoterCount = await voterModel.recalculateAllSuperVoters();
        console.log(`✓ Marked ${superVoterCount} voters as super voters\n`);
        
        // Update precinct statistics
        console.log('Updating precinct statistics...');
        const precinctCount = await voterModel.recalculateAllPrecinctStats();
        console.log(`✓ Updated ${precinctCount} precinct(s)\n`);
        
        // Show summary statistics
        console.log('=== Summary ===');
        const stats = await database.get(`
            SELECT 
                COUNT(DISTINCT voter_id) as unique_voters,
                COUNT(*) as total_records,
                COUNT(DISTINCT election_code) as unique_elections,
                SUM(CASE WHEN voted = 1 THEN 1 ELSE 0 END) as votes_cast
            FROM election_history
        `);
        
        console.log(`Unique voters with history: ${stats.unique_voters}`);
        console.log(`Total election records: ${stats.total_records}`);
        console.log(`Unique elections: ${stats.unique_elections}`);
        console.log(`Total votes cast: ${stats.votes_cast}`);
        console.log(`Super voters: ${superVoterCount}`);
        
        // Show election breakdown
        console.log('\nElection participation breakdown:');
        const electionStats = await database.all(`
            SELECT 
                election_code,
                COUNT(*) as total_voters,
                SUM(CASE WHEN voted = 1 THEN 1 ELSE 0 END) as voted,
                SUM(CASE WHEN party_code = 'D' THEN 1 ELSE 0 END) as democrat,
                SUM(CASE WHEN party_code = 'R' THEN 1 ELSE 0 END) as republican,
                SUM(CASE WHEN early_voted = 1 THEN 1 ELSE 0 END) as early_votes
            FROM election_history
            GROUP BY election_code
            ORDER BY election_code
        `);
        
        electionStats.forEach(stat => {
            const turnout = ((stat.voted / stat.total_voters) * 100).toFixed(1);
            console.log(`  ${stat.election_code}: ${stat.voted}/${stat.total_voters} voted (${turnout}%) - D:${stat.democrat} R:${stat.republican} Early:${stat.early_votes}`);
        });
        
        console.log('\n✓ Re-import completed successfully!');
        
    } catch (error) {
        console.error('\n✗ Error during re-import:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        // Close database connection
        await database.close();
    }
}

// Run the script
reimportElectionHistory();
