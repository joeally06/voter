/**
 * Quick setup script to create saved_routes table
 */

const database = require('../backend/config/database');

async function setupTable() {
  try {
    await database.connect();
    console.log('✅ Database connected');
    
    // Create saved_routes table
    await database.run(`
      CREATE TABLE IF NOT EXISTS saved_routes (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        route_name TEXT,
        route_data JSON NOT NULL,
        travel_mode TEXT DEFAULT 'walking',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        accessed_at DATETIME,
        access_count INTEGER DEFAULT 0,
        expires_at DATETIME,
        is_public BOOLEAN DEFAULT 1
      )
    `);
    console.log('✅ saved_routes table created');
    
    // Create indexes
    await database.run(`CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_saved_routes_created ON saved_routes(created_at)`);
    await database.run(`CREATE INDEX IF NOT EXISTS idx_saved_routes_expires ON saved_routes(expires_at)`);
    console.log('✅ Indexes created');
    
    await database.close();
    console.log('✅ Setup complete!');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

setupTable();
