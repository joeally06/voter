/**
 * Check existing voters in database
 */

const database = require('../backend/config/database');

async function checkDatabase() {
    try {
        await database.connect();
        
        // Count total voters
        const totalResult = await database.get('SELECT COUNT(*) as total FROM voters');
        console.log(`Total voters in database: ${totalResult.total}`);
        
        // Check if any voters match the CSV file
        // Get a sample of voter IDs from first few records
        const sampleIds = ['31001', '30687', '46030', '42556', '45672', '30792'];
        
        console.log('\n=== Checking sample voter IDs from CSV ===');
        for (const id of sampleIds) {
            const voter = await database.get('SELECT * FROM voters WHERE voter_id = ?', [id]);
            if (voter) {
                console.log(`✓ Found: ${id} - ${voter.first_name} ${voter.last_name}`);
            } else {
                console.log(`✗ Not found: ${id}`);
            }
        }
        
        // Check how many from the CSV already exist
        const csvIds = [
            '31001', '30687', '46030', '42556', '45672', '30792', '44843', '25653', '30492', '13103',
            '45239', '6847', '6851', '6855', '6856', '40230', '35856', '6862', '40276', '42443'
        ];
        
        const placeholders = csvIds.map(() => '?').join(',');
        const existingCount = await database.get(
            `SELECT COUNT(*) as count FROM voters WHERE voter_id IN (${placeholders})`,
            csvIds
        );
        
        console.log(`\n=== CSV overlap analysis ===`);
        console.log(`Sample size: ${csvIds.length} voter IDs from CSV`);
        console.log(`Already in database: ${existingCount.count}`);
        console.log(`New records: ${csvIds.length - existingCount.count}`);
        
        if (totalResult.total > 0) {
            const percentage = ((existingCount.count / csvIds.length) * 100).toFixed(1);
            console.log(`Overlap percentage: ${percentage}% (based on sample)`);
            
            // Estimate total overlaps
            const estimatedOverlap = Math.round((2677 * percentage) / 100);
            console.log(`\nEstimated overlaps in full CSV: ~${estimatedOverlap} records`);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkDatabase();
