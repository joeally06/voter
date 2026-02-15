/**
 * Migration: Add Geocoding Job Tracking Tables
 * 
 * Creates three new tables:
 * 1. geocoding_jobs - Track batch geocoding job progress
 * 2. geocoding_errors - Log failed geocoding attempts
 * 3. api_quotas - Monitor daily API usage
 */

const database = require('../config/database');

async function migrate() {
  console.log('Running migration: Add geocoding job tracking tables...');
  
  try {
    // Initialize database connection
    await database.connect();
    
    // Table 1: geocoding_jobs
    await database.run(`
      CREATE TABLE IF NOT EXISTS geocoding_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT DEFAULT 'PENDING',
        total_records INTEGER NOT NULL,
        processed_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        cache_hits INTEGER DEFAULT 0,
        api_calls INTEGER DEFAULT 0,
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        estimated_completion DATETIME,
        last_processed_id INTEGER,
        options TEXT,
        created_by TEXT,
        error_message TEXT
      )
    `);
    
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_geocoding_jobs_status 
      ON geocoding_jobs(status)
    `);
    
    console.log('✅ Created table: geocoding_jobs');
    
    // Table 2: geocoding_errors
    await database.run(`
      CREATE TABLE IF NOT EXISTS geocoding_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        voter_id INTEGER NOT NULL,
        address TEXT NOT NULL,
        city TEXT,
        zip_code TEXT,
        error_type TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES geocoding_jobs(id),
        FOREIGN KEY (voter_id) REFERENCES voters(id)
      )
    `);
    
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_geocoding_errors_job 
      ON geocoding_errors(job_id)
    `);
    
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_geocoding_errors_type 
      ON geocoding_errors(error_type)
    `);
    
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_geocoding_errors_voter 
      ON geocoding_errors(voter_id)
    `);
    
    console.log('✅ Created table: geocoding_errors');
    
    // Table 3: api_quotas
    await database.run(`
      CREATE TABLE IF NOT EXISTS api_quotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        service TEXT NOT NULL,
        request_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, service)
      )
    `);
    
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_quotas_date 
      ON api_quotas(date, service)
    `);
    
    console.log('✅ Created table: api_quotas');
    
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
