/**
 * Migration: Add total_records column to import_logs table
 * Enables accurate progress tracking during file imports (M2 fix)
 * 
 * Previously, progress was calculated as records_processed / (successful + failed),
 * which always yielded ~100%. Now total_records stores the count from parsing,
 * allowing real progress: records_processed / total_records.
 */

exports.up = function(db) {
  return db.run(`
    ALTER TABLE import_logs ADD COLUMN total_records INTEGER DEFAULT 0
  `).then(() => {
    // Backfill existing rows: set total_records = records_processed for completed imports
    return db.run(`
      UPDATE import_logs SET total_records = records_processed 
      WHERE status IN ('completed', 'failed') AND records_processed > 0
    `);
  }).then(() => {
    console.log('✅ Migration 009: total_records column added to import_logs');
  });
};

exports.down = function(db) {
  // SQLite does not support DROP COLUMN before 3.35.0
  // For older SQLite versions, this is a no-op
  console.log('⚠️  Migration 009 down: total_records column cannot be removed in older SQLite versions');
  return Promise.resolve();
};
