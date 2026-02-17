/**
 * Check foreign key constraints and election history
 */

const database = require('../backend/config/database');

async function checkForeignKeys() {
    try {
        await database.connect();
        
        // Check if foreign keys are enabled
        const fkStatus = await database.get('PRAGMA foreign_keys');
        console.log(`Foreign keys enabled: ${fkStatus.foreign_keys === 1 ? 'YES' : 'NO'}`);
        
        // Get voter table info
        console.log('\n=== VOTERS TABLE SCHEMA ===');
        const votersInfo = await database.all('PRAGMA table_info(voters)');
        votersInfo.forEach(col => {
            console.log(`  ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}`);
        });
        
        // Get foreign keys for election_history table
        console.log('\n=== ELECTION_HISTORY FOREIGN KEYS ===');
        const fks = await database.all('PRAGMA foreign_key_list(election_history)');
        fks.forEach(fk => {
            console.log(`  Column: ${fk.from} -> ${fk.table}.${fk.to}`);
            console.log(`  On Delete: ${fk.on_delete || 'NO ACTION'}`);
            console.log(`  On Update: ${fk.on_update || 'NO ACTION'}`);
        });
        
        // Check sample voter IDs for election history
        const sampleIds = ['31001', '30687', '46030'];
        console.log('\n=== ELECTION HISTORY FOR SAMPLE VOTERS ===');
        for (const id of sampleIds) {
            const count = await database.get(
                'SELECT COUNT(*) as count FROM election_history WHERE voter_id = ?',
                [id]
            );
            console.log(`  Voter ${id}: ${count.count} election records`);
        }
        
        // Check total election history records
        const totalHistory = await database.get('SELECT COUNT(*) as total FROM election_history');
        console.log(`\nTotal election history records: ${totalHistory.total}`);
        
        // Check if voters with election history are being re-imported
        const votersWithHistory = await database.get(`
            SELECT COUNT(DISTINCT voter_id) as count 
            FROM election_history
        `);
        console.log(`Voters with election history: ${votersWithHistory.count}`);
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkForeignKeys();
