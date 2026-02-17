/**
 * Check import logs and errors
 */

const database = require('../backend/config/database');

async function checkImportLogs() {
    try {
        await database.connect();
        
        // Get most recent imports
        const imports = await database.all(`
            SELECT * FROM import_logs 
            ORDER BY id DESC 
            LIMIT 5
        `);
        
        console.log('=== RECENT IMPORTS ===');
        imports.forEach(imp => {
            console.log(`\nImport ID: ${imp.id}`);
            console.log(`File: ${imp.filename}`);
            console.log(`Status: ${imp.status}`);
            console.log(`Processed: ${imp.records_processed}`);
            console.log(`Successful: ${imp.records_successful}`);
            console.log(`Failed: ${imp.records_failed}`);
            console.log(`Start: ${imp.start_time}`);
            console.log(`End: ${imp.end_time}`);
            if (imp.error_message) {
                console.log(`Error: ${imp.error_message}`);
            }
        });
        
        // Get the most recent import with failures
        const recentImportWithFailures = imports.find(imp => imp.records_failed > 0);
        
        if (recentImportWithFailures) {
            console.log(`\n=== ERRORS FROM IMPORT #${recentImportWithFailures.id} ===`);
            
            const errors = await database.all(`
                SELECT * FROM import_errors 
                WHERE import_id = ? 
                LIMIT 20
            `, [recentImportWithFailures.id]);
            
            console.log(`Total errors logged: ${errors.length}`);
            
            // Group errors by type
            const errorsByType = {};
            const errorsByMessage = {};
            
            errors.forEach(err => {
                errorsByType[err.error_type] = (errorsByType[err.error_type] || 0) + 1;
                errorsByMessage[err.error_message] = (errorsByMessage[err.error_message] || 0) + 1;
            });
            
            console.log('\n=== ERROR TYPES ===');
            Object.keys(errorsByType).forEach(type => {
                console.log(`  ${type}: ${errorsByType[type]}`);
            });
            
            console.log('\n=== ERROR MESSAGES (Top 10) ===');
            Object.keys(errorsByMessage)
                .sort((a, b) => errorsByMessage[b] - errorsByMessage[a])
                .slice(0, 10)
                .forEach(msg => {
                    console.log(`  (${errorsByMessage[msg]}x) ${msg}`);
                });
            
            console.log('\n=== SAMPLE FAILED RECORDS ===');
            errors.slice(0, 5).forEach(err => {
                console.log(`\nRecord #${err.record_number}:`);
                console.log(`  Type: ${err.error_type}`);
                console.log(`  Message: ${err.error_message}`);
                if (err.record_data) {
                    try {
                        const data = JSON.parse(err.record_data);
                        console.log(`  voter_id: ${data.voter_id}`);
                        console.log(`  name: ${data.first_name} ${data.last_name}`);
                        console.log(`  address: ${data.address}, ${data.city}`);
                        console.log(`  precinct: ${data.precinct_number}`);
                    } catch (e) {
                        console.log(`  Data: ${err.record_data.substring(0, 100)}`);
                    }
                }
            });
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkImportLogs();
