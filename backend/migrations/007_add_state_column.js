const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../data/voter_platform.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        process.exit(1);
    }
    console.log('Connected to database');
});

db.serialize(() => {
    console.log('Starting migration 007: Add state column...');

    // Add state column
    db.run(`
        ALTER TABLE voters 
        ADD COLUMN state TEXT DEFAULT 'TN'
    `, (err) => {
        if (err) {
            console.error('Error adding state column:', err);
            process.exit(1);
        }
        console.log('✓ Added state column');
    });

    // Update all existing voters to have TN as state
    db.run(`
        UPDATE voters 
        SET state = 'TN' 
        WHERE state IS NULL OR state = ''
    `, function(err) {
        if (err) {
            console.error('Error updating state values:', err);
            process.exit(1);
        }
        console.log(`✓ Updated ${this.changes} voters with state = 'TN'`);
    });

    // Verify the update
    db.get(`
        SELECT COUNT(*) as count 
        FROM voters 
        WHERE state = 'TN'
    `, (err, row) => {
        if (err) {
            console.error('Error verifying update:', err);
            process.exit(1);
        }
        console.log(`✓ Verified: ${row.count} voters now have state = 'TN'`);
        console.log('\nMigration 007 completed successfully!');
        
        db.close(() => {
            process.exit(0);
        });
    });
});
