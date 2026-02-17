/**
 * Import Processor Service
 * Orchestrates the complete import workflow for voter data
 * Handles parsing, validation, batch insertion, and progress tracking
 */

const database = require('../config/database');
const VoterModel = require('../models/voter');
const { parseDBF } = require('../parsers/dbf-parser');
const { parseCSV } = require('../parsers/csv-parser');

const BATCH_SIZE = 500; // Records per transaction

// Environment-aware logging: suppress verbose output in production
const isDev = process.env.NODE_ENV !== 'production';
const log = {
  info: (...args) => isDev && console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  always: (...args) => console.log(...args)
};

/**
 * Process a file import
 * @param {number} importId - Import log ID
 * @param {string} filePath - Path to file
 * @param {string} fileType - 'dbf' or 'csv'
 * @param {Object} options - Import options
 */
async function processImport(importId, filePath, fileType, options = {}) {
    const { importMode = 'replace' } = options;
    const voterModel = new VoterModel();

    try {
        // Update status to processing
        await updateImportStatus(importId, 'processing', null);

        // Parse file based on type
        log.info(`Starting ${fileType.toUpperCase()} import from: ${filePath}`);
        const parseResult = fileType === 'dbf' 
            ? await parseDBF(filePath)
            : await parseCSV(filePath, options);

        if (!parseResult.success || parseResult.records.length === 0) {
            throw new Error('No valid records found in file');
        }

        log.info(`Parsed ${parseResult.totalCount} records`);

        // Process records in batches
        const totalRecords = parseResult.records.length;

        // Store total record count for accurate progress tracking (M2 fix)
        await database.run(
            'UPDATE import_logs SET total_records = ? WHERE id = ?',
            [totalRecords, importId]
        );
        let processedCount = 0;
        let successCount = 0;
        let failedCount = 0;
        const errors = [];

        // Process in batches
        for (let i = 0; i < totalRecords; i += BATCH_SIZE) {
            const batch = parseResult.records.slice(i, i + BATCH_SIZE);
            
            const batchResult = await processBatch(
                batch, 
                importId, 
                importMode, 
                voterModel,
                i + 1 // Start record number for this batch
            );

            successCount += batchResult.successCount;
            failedCount += batchResult.failedCount;
            processedCount += batch.length;
            
            if (batchResult.errors.length > 0) {
                errors.push(...batchResult.errors);
            }

            // Update progress
            await updateImportProgress(importId, processedCount, successCount, failedCount);

            // Log progress
            const progress = ((processedCount / totalRecords) * 100).toFixed(1);
            log.info(`Progress: ${processedCount}/${totalRecords} (${progress}%) - Success: ${successCount}, Failed: ${failedCount}`);
        }

        // Update precinct statistics
        log.info('Updating precinct statistics...');
        await voterModel.recalculateAllPrecinctStats();

        // Calculate super voters (for both CSV and DBF imports with election history)
        log.info('Calculating super voter status...');
        await voterModel.recalculateAllSuperVoters();

        // Set final status
        const finalStatus = failedCount === totalRecords ? 'failed' : 'completed';
        const errorMessage = failedCount === totalRecords 
            ? 'All records failed validation'
            : null;

        await updateImportStatus(importId, finalStatus, errorMessage);

        log.info(`Import completed: ${successCount} successful, ${failedCount} failed`);

        return {
            success: true,
            processedCount,
            successCount,
            failedCount,
            errors: errors.slice(0, 100) // Limit error array size
        };

    } catch (error) {
        console.error('Import processing error:', error);
        await updateImportStatus(importId, 'failed', error.message);
        
        throw error;
    }
}

/**
 * Process a batch of records with PER-RECORD error handling
 * CRITICAL FIX: Process records individually instead of atomic batch transaction
 * This allows partial success - valid records are saved even if some fail
 * @param {Array} records - Batch of voter records to process
 * @param {number} importId - Import log ID for tracking
 * @param {string} importMode - Import mode: 'skip', 'replace', or 'flag'
 * @param {VoterModel} voterModel - Voter model instance for database operations
 * @param {number} startRecordNumber - Starting record number for this batch (for error reporting)
 * @returns {Promise<Object>} Batch processing results containing success/failure counts and errors
 * @throws {Error} If database transaction fails critically
 */
async function processBatch(records, importId, importMode, voterModel, startRecordNumber) {
    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    // CRITICAL FIX: Process each record individually to allow partial success
    // Instead of batch transaction, handle each record separately
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const recordNumber = startRecordNumber + i;

        try {
            // Step 1: Validate record
            validateVoter(record);

            // Step 2: Insert voter record (individual transaction)
            await voterModel.create(record, importMode);

            // Step 3: Insert election history if present
            if (record.electionHistory && record.electionHistory.length > 0) {
                for (const history of record.electionHistory) {
                    try {
                        await voterModel.createElectionHistory(record.voter_id, history);
                    } catch (historyError) {
                        // Log election history error but don't fail the voter record
                        log.warn(`Failed to save election history for voter ${record.voter_id}:`, historyError.message);
                    }
                }
            }

            // Success!
            successCount++;

        } catch (error) {
            // Record failed - log detailed error and continue with next record
            failedCount++;
            
            // Determine error type
            const errorType = error.message.includes('UNIQUE constraint') ? 'duplicate' :
                             error.message.includes('Missing required field') ? 'validation' :
                             error.message.includes('City must be') ? 'validation' :
                             'database';
            
            errors.push({
                recordNumber,
                errorType,
                errorMessage: error.message,
                recordData: JSON.stringify(record).substring(0, 500) // Limit size
            });
            
            // Log individual failure for debugging
            log.warn(`Record ${recordNumber} failed: ${error.message}`);
        }
    }

    // Log errors to database
    if (errors.length > 0) {
        await logImportErrors(importId, errors);
    }

    return {
        successCount,
        failedCount,
        errors
    };
}

/**
 * Validate a voter record against business rules
 * @param {Object} voter - Voter record to validate
 * @param {string} voter.voter_id - State voter ID (1-20 alphanumeric characters)
 * @param {string} voter.last_name - Last name (required)
 * @param {string} voter.first_name - First name (required)
 * @param {string} voter.address - Street address (minimum 3 characters)
 * @param {string} voter.city - City name (required)
 * @param {string} voter.zip_code - ZIP code (5 digits or ZIP+4 format)
 * @param {string} voter.precinct_number - Precinct number (1-3 digits)
 * @throws {Error} If any validation rule fails (concatenated error messages)
 */
function validateVoter(voter) {
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
        if (!voter[field] || voter[field] === '') {
            errors.push(`Missing required field: ${field}`);
        }
    }

    // Voter ID validation
    // Updated to support 1-5 digit voter IDs from Obion County Election Commission
    // STATE_ID field contains numeric IDs ranging from 1-5 digits (e.g., "3", "132", "6847", "31001")
    if (voter.voter_id && !/^[A-Z0-9]{1,20}$/i.test(voter.voter_id)) {
        errors.push('Voter ID must be 1-20 alphanumeric characters');
    }

    // ZIP code validation
    if (voter.zip_code && !/^\d{5}(-\d{4})?$/.test(voter.zip_code)) {
        errors.push('ZIP code must be 5 digits or ZIP+4 format');
    }

    // Precinct number validation
    // CRITICAL FIX: Allow district-precinct format like "2-4" or numeric format
    if (voter.precinct_number && !/^\d{1,3}(-\d{1,3})?$/.test(voter.precinct_number)) {
        errors.push('Precinct number must be 1-3 digits or district-precinct format (e.g., "2-4")');
    }

    // Obion County city allowlist validation
    const validCities = [
        'UNION CITY', 'TROY', 'OBION', 'SOUTH FULTON', 'HORNBEAK',
        'RIVES', 'KENTON', 'WOODLAND MILLS', 'SAMBURG'
    ];
    if (voter.city && !validCities.includes(voter.city.toUpperCase())) {
        errors.push(`City must be in Obion County: ${validCities.join(', ')}`);
    }

    // Name validation
    if (voter.last_name && voter.last_name.length < 1) {
        errors.push('Last name cannot be empty');
    }

    if (voter.first_name && voter.first_name.length < 1) {
        errors.push('First name cannot be empty');
    }

    // Address validation
    if (voter.address && voter.address.length < 3) {
        errors.push('Address must be at least 3 characters');
    }

    if (errors.length > 0) {
        throw new Error(errors.join('; '));
    }
}

/**
 * Update import log status in database
 * @param {number} importId - Import log ID to update
 * @param {string} status - New status: 'pending', 'processing', 'completed', or 'failed'
 * @param {string|null} errorMessage - Error message if status is 'failed', null otherwise
 * @returns {Promise<void>}
 */
async function updateImportStatus(importId, status, errorMessage) {
    const sql = `
        UPDATE import_logs 
        SET status = ?, 
            error_message = ?,
            end_time = CASE WHEN ? IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE end_time END
        WHERE id = ?
    `;

    await database.run(sql, [status, errorMessage, status, importId]);
}

/**
 * Update import progress counters in database
 * @param {number} importId - Import log ID to update
 * @param {number} processed - Total number of records processed so far
 * @param {number} successful - Number of successfully imported records
 * @param {number} failed - Number of failed records
 * @returns {Promise<void>}
 */
async function updateImportProgress(importId, processed, successful, failed) {
    const sql = `
        UPDATE import_logs 
        SET records_processed = ?,
            records_successful = ?,
            records_failed = ?
        WHERE id = ?
    `;

    await database.run(sql, [processed, successful, failed, importId]);
}

/**
 * Log import errors to database for review and debugging
 * @param {number} importId - Import log ID
 * @param {Array<Object>} errors - Array of error objects
 * @param {number} errors[].recordNumber - Record number that failed
 * @param {string} errors[].errorType - Error type: 'validation' or 'database'
 * @param {string} errors[].errorMessage - Detailed error message
 * @param {string} errors[].recordData - JSON string of failed record data (truncated)
 * @returns {Promise<void>}
 */
async function logImportErrors(importId, errors) {
    // Create import_errors table if it doesn't exist
    await database.run(`
        CREATE TABLE IF NOT EXISTS import_errors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER NOT NULL,
            record_number INTEGER,
            error_type TEXT,
            error_message TEXT,
            record_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (import_id) REFERENCES import_logs(id)
        )
    `);

    // Insert errors in batches to avoid overwhelming database
    const batchSize = 100;
    for (let i = 0; i < errors.length; i += batchSize) {
        const batch = errors.slice(i, i + batchSize);
        
        for (const error of batch) {
            try {
                await database.run(
                    `INSERT INTO import_errors (import_id, record_number, error_type, error_message, record_data)
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        importId,
                        error.recordNumber,
                        error.errorType,
                        error.errorMessage.substring(0, 500), // Limit message length
                        error.recordData
                    ]
                );
            } catch (err) {
                console.error('Failed to log error:', err);
            }
        }
    }
}

/**
 * Retrieve import errors for a specific import job
 * @param {number} importId - Import log ID to query
 * @param {number} [limit=100] - Maximum number of errors to return (default: 100)
 * @returns {Promise<Array<Object>>} Array of error records with recordNumber, errorType, errorMessage, recordData, and createdAt
 */
async function getImportErrors(importId, limit = 100) {
    try {
        const errors = await database.all(
            `SELECT 
                record_number as recordNumber,
                error_type as errorType,
                error_message as errorMessage,
                record_data as recordData,
                created_at as createdAt
             FROM import_errors 
             WHERE import_id = ? 
             ORDER BY record_number
             LIMIT ?`,
            [importId, limit]
        );

        return errors;
    } catch (error) {
        // Table might not exist yet
        return [];
    }
}

/**
 * Get summarized import error statistics grouped by error type and message
 * @param {number} importId - Import log ID to summarize
 * @returns {Promise<Array<Object>>} Array of error summaries with errorType, errorMessage, and count
 */
async function getImportErrorSummary(importId) {
    try {
        const summary = await database.all(
            `SELECT 
                error_type as errorType,
                error_message as errorMessage,
                COUNT(*) as count
             FROM import_errors 
             WHERE import_id = ? 
             GROUP BY error_type, error_message
             ORDER BY count DESC`,
            [importId]
        );

        return summary;
        } catch (error) {
        return [];
    }
}

module.exports = {
    processImport,
    getImportErrors,
    getImportErrorSummary,
    BATCH_SIZE
};
