/**
 * Recalculate Super Voter Status
 * Runs the updated dynamic threshold calculation
 */

const database = require('../backend/config/database');
const VoterModel = require('../backend/models/voter');

async function recalculateSuperVoters() {
    try {
        console.log('🔄 Connecting to database...');
        await database.connect();
        
        console.log('🔄 Recalculating super voter status...\n');
        const voterModel = new VoterModel();
        const count = await voterModel.recalculateAllSuperVoters();
        
        console.log('\n✅ Super voter recalculation complete!');
        console.log(`📊 Total super voters: ${count}`);
        
        await database.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

recalculateSuperVoters();
