/**
 * Migration: Add Indexes for Party and Voting Filters
 * 
 * Creates indexes to improve performance of new filtering queries:
 * - Party affiliation filtering (Republican/Democrat)
 * - Voting status filtering (regular voters/never voted)
 * 
 * These indexes optimize the subquery JOINs used in the voter filtering system
 */

const database = require('../config/database');

async function migrate() {
  console.log('Running migration: Add filter optimization indexes...');
  
  try {
    await database.connect();
    
    // Index for party_code filtering
    // Improves performance when filtering by Republican/Democrat affiliation
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_election_history_party 
      ON election_history(party_code)
    `);
    
    console.log('✅ Created index: idx_election_history_party');
    
    // Index for voted status filtering
    // Improves performance when filtering regular voters vs never-voted
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_election_history_voted 
      ON election_history(voted)
    `);
    
    console.log('✅ Created index: idx_election_history_voted');
    
    // Composite index for voter_id + voted
    // Optimizes counting elections voted per voter
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_election_history_voter_voted 
      ON election_history(voter_id, voted)
    `);
    
    console.log('✅ Created index: idx_election_history_voter_voted');
    
    console.log('✅ Filter optimization indexes created successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration if executed directly
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration complete. Exiting...');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error during migration:', err);
      process.exit(1);
    });
}

module.exports = { migrate };
