const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('data/voter_platform.db');

db.all('SELECT name FROM sqlite_master WHERE type = "table" ORDER BY name', (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Database tables:');
        rows.forEach(row => console.log('  -', row.name));
    }
    db.close();
});
