/**
 * Migration: Add Date of Birth Field to Voters Table
 * 
 * Adds date_of_birth column to support age-based analytics and demographic segmentation
 * Storage format: ISO-8601 TEXT (YYYY-MM-DD) for SQLite compatibility and readability
 */

const database = require('../config/database');

async function migrate() {
  console.log('Running migration: Add date_of_birth column to voters table...');
  
  try {
    await database.connect();
    
    // Add date_of_birth column (TEXT format, ISO-8601)
    // NULL allowed - DOB is optional field
    await database.run(`
      ALTER TABLE voters 
      ADD COLUMN date_of_birth TEXT DEFAULT NULL
    `);
    
    console.log('✅ Added column: date_of_birth (TEXT, NULL allowed)');
    
    // Create index for age-based queries and demographic analytics
    // Improves performance for WHERE clauses filtering by age
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_voters_dob 
      ON voters(date_of_birth)
    `);
    
    console.log('✅ Created index: idx_voters_dob');
    
    console.log('✅ Migration completed successfully');
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
      console.error('Migration error:', err);
      process.exit(1);
    });
}

module.exports = migrate;
