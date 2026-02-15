/**
 * Migration: Add Route Planning Tables
 * Phase 5: Distance Matrix API caching and quota tracking
 * 
 * Creates:
 * - route_cache: Store distance/duration between location pairs
 * - api_usage: Track API quota usage across all Google Maps APIs
 */

const database = require('../config/database');

async function migrate() {
  console.log('Running migration: 006_add_route_planning_tables');
  
  try {
    await database.connect();
    
    // Create route_cache table
    await database.run(`
      CREATE TABLE IF NOT EXISTS route_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin_lat REAL NOT NULL,
        origin_lng REAL NOT NULL,
        destination_lat REAL NOT NULL,
        destination_lng REAL NOT NULL,
        route_hash TEXT UNIQUE NOT NULL,
        travel_mode TEXT NOT NULL,
        distance_meters INTEGER,
        duration_seconds INTEGER,
        duration_in_traffic_seconds INTEGER,
        api_status TEXT,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        UNIQUE(origin_lat, origin_lng, destination_lat, destination_lng, travel_mode)
      )
    `);
    
    console.log('✅ Created table: route_cache');
    
    // Create indexes for route_cache
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_route_hash ON route_cache(route_hash)
    `);
    
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_route_expires ON route_cache(expires_at)
    `);
    
    console.log('✅ Created indexes for route_cache');
    
    // Create api_usage table
    await database.run(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_name TEXT NOT NULL,
        call_date DATE NOT NULL,
        call_count INTEGER DEFAULT 0,
        cache_hits INTEGER DEFAULT 0,
        cache_misses INTEGER DEFAULT 0,
        quota_remaining INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(api_name, call_date)
      )
    `);
    
    console.log('✅ Created table: api_usage');
    
    // Create index for api_usage
    await database.run(`
      CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage(api_name, call_date)
    `);
    
    console.log('✅ Created indexes for api_usage');
    
    console.log('✅ Migration 006 completed: Route planning tables created successfully');
    return true;
    
  } catch (error) {
    console.error('❌ Migration 006 failed:', error);
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
