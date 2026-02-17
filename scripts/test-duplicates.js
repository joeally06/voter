/**
 * Test for duplicate voter IDs in CSV
 */

const { parseCSV } = require('../backend/parsers/csv-parser');
const path = require('path');

async function checkDuplicates() {
    const csvFile = path.join(__dirname, 'LEWIS - DIST. 2.csv');
    
    console.log('Parsing CSV file...');
    const parseResult = await parseCSV(csvFile);
    
    console.log(`Total records parsed: ${parseResult.totalCount}`);
    
    // Track voter IDs
    const voterIdMap = new Map();
    const duplicates = [];
    
    parseResult.records.forEach((record, index) => {
        const voterId = record.voter_id;
        
        if (voterIdMap.has(voterId)) {
            duplicates.push({
                voterId,
                firstOccurrence: voterIdMap.get(voterId),
                secondOccurrence: index + 1,
                firstRecord: parseResult.records[voterIdMap.get(voterId) - 1],
                secondRecord: record
            });
        } else {
            voterIdMap.set(voterId, index + 1);
        }
    });
    
    console.log(`\n=== DUPLICATE CHECK ===`);
    console.log(`Unique voter IDs: ${voterIdMap.size}`);
    console.log(`Total records: ${parseResult.totalCount}`);
    console.log(`Duplicates found: ${duplicates.length}`);
    
    if (duplicates.length > 0) {
        console.log(`\n=== DUPLICATE DETAILS ===`);
        duplicates.forEach((dup, idx) => {
            console.log(`\n${idx + 1}. Voter ID: ${dup.voterId}`);
            console.log(`   First: Record #${dup.firstOccurrence} - ${dup.firstRecord.first_name} ${dup.firstRecord.last_name}, ${dup.firstRecord.address}`);
            console.log(`   Second: Record #${dup.secondOccurrence} - ${dup.secondRecord.first_name} ${dup.secondRecord.last_name}, ${dup.secondRecord.address}`);
        });
    }
    
    // Also check for empty voter IDs
    const emptyIds = parseResult.records.filter((r, idx) => !r.voter_id || r.voter_id === '');
    console.log(`\n=== EMPTY VOTER IDs ===`);
    console.log(`Records with empty voter_id: ${emptyIds.length}`);
    
    if (emptyIds.length > 0 && emptyIds.length <= 10) {
        emptyIds.forEach((record, idx) => {
            const recordNum = parseResult.records.indexOf(record) + 1;
            console.log(`  Record #${recordNum}: ${record.first_name} ${record.last_name}, ${record.address}`);
        });
    }
}

checkDuplicates().catch(console.error);
