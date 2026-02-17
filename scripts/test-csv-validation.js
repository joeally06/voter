/**
 * Test CSV validation to identify specific failures
 */

const { parseCSV } = require('../backend/parsers/csv-parser');
const path = require('path');

async function testValidation() {
    const csvFile = path.join(__dirname, 'LEWIS - DIST. 2.csv');
    
    console.log('Parsing CSV file...');
    const parseResult = await parseCSV(csvFile);
    
    console.log(`Total records parsed: ${parseResult.totalCount}`);
    
    // Test validation on all records
    let passCount = 0;
    let failCount = 0;
    const failureReasons = {};
    const failedRecords = [];
    
    parseResult.records.forEach((record, index) => {
        const errors = [];
        
        // Required fields
        const requiredFields = [
            'voter_id',
            'last_name',
            'first_name',
            'address',
            'city',
            'zip_code',
            'precinct_number'
        ];
        
        for (const field of requiredFields) {
            if (!record[field] || record[field] === '') {
                errors.push(`Missing ${field}`);
            }
        }
        
        // Voter ID validation
        if (record.voter_id && !/^[A-Z0-9]{1,20}$/i.test(record.voter_id)) {
            errors.push('Invalid voter_id format');
        }
        
        // ZIP code validation
        if (record.zip_code && !/^\d{5}(-\d{4})?$/.test(record.zip_code)) {
            errors.push('Invalid ZIP format');
        }
        
        // Precinct number validation
        if (record.precinct_number && !/^\d{1,3}(-\d{1,3})?$/.test(record.precinct_number)) {
            errors.push('Invalid precinct format');
        }
        
        // City validation
        const validCities = [
            'UNION CITY', 'TROY', 'OBION', 'SOUTH FULTON', 'HORNBEAK',
            'RIVES', 'KENTON', 'WOODLAND MILLS', 'SAMBURG'
        ];
        if (record.city && !validCities.includes(record.city.toUpperCase())) {
            errors.push(`Invalid city: ${record.city}`);
        }
        
        if (errors.length > 0) {
            failCount++;
            
            // Track failure reasons
            errors.forEach(err => {
                failureReasons[err] = (failureReasons[err] || 0) + 1;
            });
            
            // Store first 10 failed records for detailed analysis
            if (failedRecords.length < 10) {
                failedRecords.push({
                    recordNumber: index + 1,
                    errors,
                    data: record
                });
            }
        } else {
            passCount++;
        }
    });
    
    console.log('\n=== VALIDATION RESULTS ===');
    console.log(`✅ Passed: ${passCount}`);
    console.log(`❌ Failed: ${failCount}`);
    
    console.log('\n=== FAILURE BREAKDOWN ===');
    Object.keys(failureReasons)
        .sort((a, b) => failureReasons[b] - failureReasons[a])
        .forEach(reason => {
            console.log(`  ${reason}: ${failureReasons[reason]}`);
        });
    
    console.log('\n=== FIRST 10 FAILED RECORDS ===');
    failedRecords.forEach(fail => {
        console.log(`\nRecord #${fail.recordNumber}:`);
        console.log(`  Errors: ${fail.errors.join(', ')}`);
        console.log(`  voter_id: "${fail.data.voter_id}"`);
        console.log(`  last_name: "${fail.data.last_name}"`);
        console.log(`  first_name: "${fail.data.first_name}"`);
        console.log(`  address: "${fail.data.address}"`);
        console.log(`  city: "${fail.data.city}"`);
        console.log(`  zip_code: "${fail.data.zip_code}"`);
        console.log(`  precinct_number: "${fail.data.precinct_number}"`);
        console.log(`  state: "${fail.data.state}"`);
        console.log(`  date_of_birth: "${fail.data.date_of_birth}"`);
    });
}

testValidation().catch(console.error);
