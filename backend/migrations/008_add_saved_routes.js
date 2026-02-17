/**
 * Migration: Add saved_routes table for route sharing and persistence
 * Enables shareable URLs, offline exports, and route storage
 */

exports.up = function(db) {
  return db.run(`
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
  `).then(() => {
    return db.run(`CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id)`);
  }).then(() => {
    return db.run(`CREATE INDEX IF NOT EXISTS idx_saved_routes_created ON saved_routes(created_at)`);
  }).then(() => {
    return db.run(`CREATE INDEX IF NOT EXISTS idx_saved_routes_expires ON saved_routes(expires_at)`);
  }).then(() => {
    console.log('✅ Migration 008: saved_routes table created successfully');
  });
};

exports.down = function(db) {
  return db.run(`DROP TABLE IF EXISTS saved_routes`).then(() => {
    console.log('✅ Migration 008: saved_routes table dropped successfully');
  });
};
